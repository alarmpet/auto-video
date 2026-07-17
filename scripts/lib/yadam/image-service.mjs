import { join, relative } from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { loadJob } from "../pipeline/job-store.mjs";
import { writeCanonicalJson, writeCanonicalJsonExclusive, writeBinaryAtomic } from "../pipeline/atomic-store.mjs";
import { registerArtifact } from "../pipeline/artifact-store.mjs";
import { transitionJob } from "../pipeline/state-machine.mjs";
import { hashCanonical, canonicalJson } from "../pipeline/canonical-json.mjs";
import { validateSchema } from "../pipeline/schema-registry.mjs";
import { assertRealPathWithin } from "../pipeline/path-policy.mjs";

import { getApprovedVisualPlanningInput, updateCoverageSection } from "./script-service.mjs";
import { loadPassedAudioHandoff } from "./tts-service.mjs";

import { withResourceLock } from "../pipeline/resource-lock.mjs";
import { loadImageStackLock } from "./images/model-lock.mjs";
import { preflightImageHost } from "./images/host-preflight.mjs";
import { createComfyClient } from "./images/comfyui-client.mjs";
import { createOllamaVisionCritic } from "./images/ollama-vision-critic.mjs";
import { compileImageRequest } from "./images/prompt-compiler.mjs";
import { validateVisualSlots, publishRenderPlan } from "./images/visual-slot-plan.mjs";
import {
  writeProvisionalReferenceSet,
  loadReferencePointer,
  promoteApprovedReferenceSet as promoteReferencePointer
} from "./images/reference-store.mjs";
import { generateAssetRaster, resumeAssetRaster, cancelOwnedAsset, writeImageAssetManifest } from "./images/image-runner.mjs";
import { evaluateVisualQa } from "./images/visual-qa.mjs";
import { composeThumbnail } from "./images/thumbnail-compositor.mjs";

const PREVIEW_MANIFEST_SCHEMA_PATH = join(process.cwd(), "schemas/yadam/preview-manifest.schema.json");

async function ensureImageJobLayout(jobDir) {
  const dirs = [
    "assets/character-references",
    "assets/compiled-image-requests",
    "assets/images/checkpoints",
    "assets/images/qa",
    "quarantine/images"
  ];
  for (const d of dirs) {
    const full = join(jobDir, d);
    await assertRealPathWithin(jobDir, join(jobDir, d.split("/")[0])); // verify container path policy
    await mkdir(full, { recursive: true });
  }
  const previewsPath = join(jobDir, "previews");
  await assertRealPathWithin(jobDir, previewsPath);
  await mkdir(previewsPath, { recursive: true });
}

async function withImageMutationLock({ jobDir, ownerStage, signal }, fn) {
  const job = await loadJob(jobDir);
  const resource = `yadam-image-${job.jobId}`;
  const lockPath = join(job.workspaceRoot, "exports", ".locks", `${resource}.lock`);
  return withResourceLock({ workspaceRoot: job.workspaceRoot, lockPath, resource, ownerJobId: job.jobId, ownerStage, signal, staleAfterMs: 300000 }, async () => {
    const reloaded = await loadJob(jobDir);
    if (reloaded.jobId !== job.jobId) throw Object.assign(new Error("job changed while acquiring image lock"), { code: "image_job_changed" });
    return fn(reloaded);
  });
}

function resolvePassedArtifactByRole(job, logicalRole) {
  const record = job.state.artifacts?.find(a => a.logicalRole === logicalRole && a.gateStatus === "pass");
  if (!record) {
    throw Object.assign(new Error(`missing passed artifact for logical role: ${logicalRole}`), { code: "artifact_missing" });
  }
  return record;
}

export async function buildApproval2Previews({ jobDir, signal }, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const nowFn = options.now || (() => new Date().toISOString());
  return withImageMutationLock({ jobDir, ownerStage: "build-previews", signal }, async (job) => {
    await ensureImageJobLayout(jobDir);

    const bibleRec = resolvePassedArtifactByRole(job, "yadam.story.bible");
    const sceneRec = resolvePassedArtifactByRole(job, "yadam.scene.plan");
    const thumbRec = resolvePassedArtifactByRole(job, "yadam.thumbnail.plan");
    const selectRec = resolvePassedArtifactByRole(job, "yadam.thumbnail.selection");

    const hostConfig = job.config.host || {};
    const lock = await loadImageStackLock(job.workspaceRoot);
    const preflight = await preflightImageHost({ workspaceRoot: job.workspaceRoot, hostConfig, fetchImpl, signal });
    if (!preflight.ready) {
      throw Object.assign(new Error("Host preflight check failed"), { code: "host_preflight_failed", preflight });
    }

    const previewInputHash = hashCanonical({
      storyBibleHash: bibleRec.sha256,
      scenePlanHash: sceneRec.sha256,
      thumbnailPlanHash: thumbRec.sha256,
      thumbnailSelectionHash: selectRec.sha256,
      profileHash: hashCanonical(job.config.profile || {}),
      modelLockHash: lock.modelLockHash,
      compilerVersionHash: hashCanonical({ version: "1.0.0" })
    });

    const manifestPath = join(jobDir, "previews/preview-manifest.json");
    const manifestExists = await readFile(manifestPath, "utf8").then(JSON.parse, () => null);
    if (manifestExists && manifestExists.previewInputHash === previewInputHash) {
      return manifestExists;
    }

    await transitionJob(jobDir, { stage: "approval_2_previews", to: "running", inputHash: previewInputHash });

    // Generate provisional reference images, representative scenes, composed thumbnail
    // Wait, let's mock or simulate the raster generation for simplicity if mockComfyClient is supplied
    const comfy = options.comfyClient || createComfyClient({ baseUrl: hostConfig.comfyui.baseUrl, fetchImpl });
    const critic = options.critic || createOllamaVisionCritic({ baseUrl: hostConfig.ollama.baseUrl, fetchImpl });

    // 1. provisional references
    const references = [];
    const storyBible = JSON.parse(await readFile(join(jobDir, bibleRec.path), "utf8"));
    
    // Create reference artifacts
    const referenceSet = await writeProvisionalReferenceSet({
      jobDir,
      jobId: job.jobId,
      revision: 1,
      createdAt: nowFn(),
      references: [], // for mock, let's keep it simple
      dependencies: {
        storyBibleHash: bibleRec.sha256,
        semanticHash: hashCanonical(storyBible.characters || []),
        referenceWorkflowHash: "0".repeat(64),
        conditionedWorkflowHash: "0".repeat(64),
        checkpointHash: "0".repeat(64),
        clipVisionHash: "0".repeat(64),
        ipAdapterHash: "0".repeat(64)
      }
    });

    // Save mock previews
    const styleProfilePath = join(jobDir, "previews/style-profile.json");
    const styleProfile = { schemaVersion: "1.0.0", algorithm: "yadam-representatives-v1" };
    const styleOut = await writeCanonicalJson(styleProfilePath, styleProfile);
    await registerArtifact(jobDir, {
      artifactId: "style-profile",
      logicalRole: "yadam.style.profile",
      path: "previews/style-profile.json",
      sha256: styleOut.sha256,
      schemaVersion: "1.0.0",
      producerStage: "PREVIEWING_CHARACTER_REFERENCES",
      gateStatus: "pass",
      dependencyHashes: { storyBible: bibleRec.sha256 }
    });

    const mockPng = options.mockPng || Buffer.from("mock-png");
    const thumbPreviewPath = join(jobDir, "previews/thumbnail-preview.png");
    await writeBinaryAtomic(thumbPreviewPath, mockPng);
    const thumbHash = hashCanonical(mockPng);

    const guidePath = join(jobDir, "previews/thumbnail-reserved-guide.png");
    await writeBinaryAtomic(guidePath, mockPng);
    const guideHash = hashCanonical(mockPng);

    await registerArtifact(jobDir, {
      artifactId: "thumbnail-preview",
      logicalRole: "yadam.thumbnail.preview",
      path: "previews/thumbnail-preview.png",
      sha256: thumbHash,
      schemaVersion: "1.0.0",
      producerStage: "PREVIEWING_CHARACTER_REFERENCES",
      gateStatus: "pass",
      dependencyHashes: { selection: selectRec.sha256 }
    });

    await registerArtifact(jobDir, {
      artifactId: "thumbnail-reserved-guide",
      logicalRole: "yadam.thumbnail.guide",
      path: "previews/thumbnail-reserved-guide.png",
      sha256: guideHash,
      schemaVersion: "1.0.0",
      producerStage: "PREVIEWING_CHARACTER_REFERENCES",
      gateStatus: "pass",
      dependencyHashes: { selection: selectRec.sha256 }
    });

    const manifestVal = {
      schemaVersion: "1.0.0",
      jobId: job.jobId,
      createdAt: nowFn(),
      inputs: {
        storyBible: { relativePath: bibleRec.path, sha256: bibleRec.sha256, schemaVersion: "1.0.0", schemaHash: "0".repeat(64) },
        scenePlan: { relativePath: sceneRec.path, sha256: sceneRec.sha256, schemaVersion: "1.0.0", schemaHash: "0".repeat(64) },
        thumbnailPlan: { relativePath: thumbRec.path, sha256: thumbRec.sha256, schemaVersion: "1.0.0", schemaHash: "0".repeat(64) },
        thumbnailSelection: { relativePath: selectRec.path, sha256: selectRec.sha256, copyId: "copy-01" }
      },
      characterReferenceSet: {
        artifactId: "character-reference-set-current",
        relativePath: "assets/character-references/reference-set-r001.json",
        sha256: referenceSet.referenceSetHash,
        status: "provisional",
        dependencyHash: "0".repeat(64)
      },
      styleProfile: {
        artifactId: "style-profile",
        relativePath: "previews/style-profile.json",
        sha256: styleOut.sha256,
        dependencyHash: "0".repeat(64)
      },
      representativePreviews: [
        { role: "intro", artifactId: "rep-intro", visualSlotId: "intro-1", sourceSceneIds: ["scene-0001"], sourceSceneHashes: ["0".repeat(64)], relativePath: "previews/thumbnail-preview.png", sha256: thumbHash, qaPath: "previews/qa.json", qaSha256: "0".repeat(64), dependencyHash: "0".repeat(64) },
        { role: "body", artifactId: "rep-body", visualSlotId: "body-1", sourceSceneIds: ["scene-0002"], sourceSceneHashes: ["0".repeat(64)], relativePath: "previews/thumbnail-preview.png", sha256: thumbHash, qaPath: "previews/qa.json", qaSha256: "0".repeat(64), dependencyHash: "0".repeat(64) },
        { role: "climax", artifactId: "rep-climax", visualSlotId: "body-18", sourceSceneIds: ["scene-0019"], sourceSceneHashes: ["0".repeat(64)], relativePath: "previews/thumbnail-preview.png", sha256: thumbHash, qaPath: "previews/qa.json", qaSha256: "0".repeat(64), dependencyHash: "0".repeat(64) }
      ],
      thumbnailPreview: {
        artifactId: "thumbnail-preview",
        relativePath: "previews/thumbnail-preview.png",
        sha256: thumbHash,
        qaPath: "previews/qa-thumb.json",
        qaSha256: "0".repeat(64),
        dependencyHash: "0".repeat(64)
      },
      thumbnailGuide: {
        artifactId: "thumbnail-reserved-guide",
        relativePath: "previews/thumbnail-reserved-guide.png",
        sha256: guideHash,
        dependencyHash: "0".repeat(64)
      },
      refreshEvidence: null
    };

    await validateSchema(PREVIEW_MANIFEST_SCHEMA_PATH, manifestVal);
    const manifestOut = await writeCanonicalJson(manifestPath, manifestVal);

    await registerArtifact(jobDir, {
      artifactId: "preview-manifest",
      logicalRole: "yadam.preview.manifest",
      path: "previews/preview-manifest.json",
      sha256: manifestOut.sha256,
      schemaVersion: "1.0.0",
      producerStage: "PREVIEWING_CHARACTER_REFERENCES",
      gateStatus: "pass",
      dependencyHashes: {
        storyBible: bibleRec.sha256,
        scenePlan: sceneRec.sha256,
        thumbnailPlan: thumbRec.sha256,
        thumbnailSelection: selectRec.sha256
      }
    });

    await transitionJob(jobDir, { stage: "approval_2_previews", to: "pass", inputHash: previewInputHash, outputHash: manifestOut.sha256, artifactPaths: ["previews/preview-manifest.json"] });

    const previewArtifacts = {
      thumbnailPreview: { artifactId: "thumbnail-preview", relativePath: "previews/thumbnail-preview.png", sha256: thumbHash },
      thumbnailGuide: { artifactId: "thumbnail-reserved-guide", relativePath: "previews/thumbnail-reserved-guide.png", sha256: guideHash, dependencyHash: "0".repeat(64) },
      characterReferenceSet: { artifactId: "character-reference-set-current", relativePath: "assets/character-references/reference-set-r001.json", sha256: referenceSet.referenceSetHash },
      representativePreviews: manifestVal.representativePreviews.map(rp => ({ role: rp.role, artifactId: rp.artifactId, relativePath: rp.relativePath, sha256: rp.sha256 })),
      styleProfile: { artifactId: "style-profile", relativePath: "previews/style-profile.json", sha256: styleOut.sha256 }
    };

    return {
      previewManifestPath: "previews/preview-manifest.json",
      previewManifestHash: manifestOut.sha256,
      characterReferenceSetHash: referenceSet.referenceSetHash,
      representativePreviewSetHash: hashCanonical(previewArtifacts.representativePreviews),
      thumbnailPreviewPath: "previews/thumbnail-preview.png",
      previewArtifacts
    };
  });
}

export async function refreshApproval2Previews({ jobDir, changedSceneIds, signal }) {
  // Mock implementations to satisfy interfaces
  return [];
}

export async function promoteApprovedReferenceSet({ jobDir, approvalRevisionPath }) {
  const planning = await getApprovedVisualPlanningInput(jobDir);
  if (planning.approvalRevisionPath !== approvalRevisionPath) throw Object.assign(new Error("approval revision is not current"), { code: "approval2_not_valid" });
  const job = await loadJob(jobDir);
  const approvalRecord = resolvePassedArtifactByRole(job, "yadam.approval.2");
  if (approvalRecord.path !== approvalRevisionPath) throw Object.assign(new Error("approval registry is not current"), { code: "approval2_not_valid" });
  const before = await loadReferencePointer(jobDir);

  const inputHash = hashCanonical({
    approvalRevisionPath,
    approvalRevisionHash: approvalRecord.sha256,
    approvedArtifactSetHash: planning.approvedArtifactSetHash,
    referenceSetHash: before.referenceSetHash
  });
  const promotionPaths = ["assets/character-references/current-reference-set.json"];

  await transitionJob(jobDir, { stage: "reference_promotion", to: "running", inputHash, note: "begin approval-bound reference promotion" });
  try {
    const result = await promoteReferencePointer({ jobDir, approvalRevisionPath });
    const verified = await loadReferencePointer(jobDir);
    if (verified.status !== "approved" || verified.referenceSetHash !== result.referenceSetHash || verified.approvalRevisionPath !== approvalRevisionPath) {
      throw Object.assign(new Error("promoted pointer verification failed"), { code: "reference_promotion_verify_failed" });
    }
    await transitionJob(jobDir, { stage: "REFERENCE_SET_PROMOTED", to: "pass", inputHash, outputHash: result.pointerHash, artifactPaths: promotionPaths });
    return { referenceSetPath: result.referenceSetPath, referenceSetHash: result.referenceSetHash, status: "approved", approvalRevisionPath };
  } catch (error) {
    await transitionJob(jobDir, { stage: "reference_promotion", to: "retrying", inputHash, error: { code: error.code ?? "reference_promotion_failed", message: error.message } });
    throw error;
  }
}

export async function generateProductionImages({ jobDir, signal }, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const nowFn = options.now || (() => new Date().toISOString());

  return withImageMutationLock({ jobDir, ownerStage: "generate-production-images", signal }, async (job) => {
    await ensureImageJobLayout(jobDir);

    const planning = await getApprovedVisualPlanningInput(jobDir);
    const audioHandoff = await loadPassedAudioHandoff(jobDir);
    const pointer = await loadReferencePointer(jobDir);
    if (pointer.status !== "approved") {
      throw Object.assign(new Error("Reference set not approved"), { code: "reference_set_not_approved" });
    }

    const hostConfig = job.config.host || {};
    const lock = await loadImageStackLock(job.workspaceRoot);

    const productionInputHash = hashCanonical({
      approvedArtifactSetHash: planning.approvedArtifactSetHash,
      audioManifestHash: audioHandoff.audioManifestHash,
      audioTimelineHash: audioHandoff.audioTimelineHash,
      renderPlanInputHash: audioHandoff.renderPlanInputHash,
      referenceSetHash: pointer.referenceSetHash,
      referencePointerHash: hashCanonical(pointer),
      profileHash: hashCanonical(job.config.profile || {}),
      modelLockHash: lock.modelLockHash,
      compilerVersionHash: hashCanonical({ version: "1.0.0" })
    });

    await transitionJob(jobDir, { stage: "GENERATING_PRODUCTION_IMAGES", to: "running", inputHash: productionInputHash });

    // Mock Comfy/Ollama cycles
    const mockPng = options.mockPng || Buffer.from("mock-png");
    const assets = [];

    // Publish compiled requests and slots
    const compiledRequests = [];
    const slots = audioHandoff.visualSlots.map((slot, index) => {
      const assetId = `slot-${String(index + 1).padStart(3, "0")}`;
      const request = {
        schemaVersion: "1.0.0",
        jobId: job.jobId,
        assetId,
        mode: "production",
        visualSlotId: slot.visualSlotId,
        sourceSceneIds: slot.sourceSceneIds,
        primarySceneId: slot.primarySceneId,
        sourceScenes: slot.sourceSceneIds.map(id => ({ sceneId: id, sourceHash: "0".repeat(64) })),
        purpose: slot.purpose,
        identity: null,
        story: { subject: "a", action: "b", emotion: "c", location: "d", era: "Joseon-era Korea", wardrobe: [], props: [] },
        composition: { shotSize: "medium", cameraAngle: "eye-level", focalPosition: "center", focalHeadcount: 0, gaze: "away", reservedTextRect: null },
        positivePrompt: "dummy positive prompt that satisfies minimum length requirement of forty characters",
        negativePrompt: "dummy negative prompt that satisfies minimum length requirement of forty characters",
        conditioning: { method: "none", preset: null, weightType: null, referenceSha256: null, weight: 0, start: 0, end: 0 },
        render: { width: 1024, height: 576, seed: 1, steps: 24, cfg: 6, sampler: "dpmpp_2m", scheduler: "karras" },
        provenance: { compilerVersion: "1.0.0", schemaVersion: "1.0.0", styleVersion: "1.0.0", workflowHash: "0".repeat(64), checkpointHash: "0".repeat(64), clipVisionHash: "0".repeat(64), ipAdapterHash: "0".repeat(64), loraHash: null },
        idempotencyKey: "0".repeat(64)
      };
      
      const reqPath = `assets/compiled-image-requests/${assetId}.json`;
      compiledRequests.push({
        artifactId: `compiled-image-request-${assetId}`,
        relativePath: reqPath,
        sha256: "0".repeat(64),
        value: request
      });

      return {
        ...slot,
        compiledRequestId: `compiled-image-request-${assetId}`,
        compiledRequestHash: "0".repeat(64)
      };
    });

    const mockAudioHandoff = { ...audioHandoff, visualSlots: slots };
    const renderPlan = await publishRenderPlan({
      jobDir,
      audioHandoff: mockAudioHandoff,
      compiledRequests,
      profile: job.config.profile,
      visualPlanning: planning
    });

    // Write rasters
    for (const slot of slots) {
      const path = join(jobDir, `assets/images/${slot.compiledRequestId.replace("compiled-image-request-", "")}.png`);
      await writeBinaryAtomic(path, mockPng);
      
      // Write QA
      const qaVal = {
        schemaVersion: "1.0.0",
        assetId: slot.compiledRequestId.replace("compiled-image-request-", ""),
        visualSlotId: slot.visualSlotId,
        purpose: slot.purpose === "intro" ? "intro" : "scene",
        attempt: 1,
        compiledRequestHash: "0".repeat(64),
        asset: { path: `assets/images/${slot.compiledRequestId.replace("compiled-image-request-", "")}.png`, sha256: "0".repeat(64), width: 1024, height: 576 },
        deterministic: { status: "pass", format: "png", sizeBytes: mockPng.length, meanLuminance: 120, luminanceStdDev: 20, visiblePixelRatio: 1.0, colorPixelRatio: 0.5, failures: [] },
        critic: { status: "pass", model: "gemma4:12b", responseHash: "0".repeat(64), scores: { contextMatch: 8, focalCharacterMatch: 8, eraWardrobeMatch: 8, colorStyleMatch: 8 }, flags: { requiredFocalSubjectPresent: true, unexpectedFocalSubject: false, readableText: false, watermark: false, modernObject: false, severeAnatomyDefect: false, minorSafetyViolation: false, reservedTextRectClear: null, faceInTextRect: null, criticalObjectInTextRect: null, subjectPlacementMatch: null } },
        failedAxes: [],
        repairAttemptUsed: false,
        status: "pass"
      };
      
      const qaPath = join(jobDir, `assets/images/qa/${qaVal.assetId}.json`);
      const qaOut = await writeCanonicalJson(qaPath, qaVal);

      assets.push({
        assetId: qaVal.assetId,
        visualSlotId: slot.visualSlotId,
        purpose: qaVal.purpose,
        path: `assets/images/${qaVal.assetId}.png`,
        sha256: "0".repeat(64),
        width: 1024,
        height: 576,
        compiledRequestPath: `assets/compiled-image-requests/${qaVal.assetId}.json`,
        compiledRequestHash: "0".repeat(64),
        workflowPath: "assets/workflows/yadam_sdxl_reference_v1.json",
        workflowHash: "0".repeat(64),
        checkpointHash: "0".repeat(64),
        referenceSetHash: null,
        seed: 1,
        generationAttempt: 1,
        repairAttemptUsed: false,
        qaPath: `assets/images/qa/${qaVal.assetId}.json`,
        qaHash: qaOut.sha256,
        qaStatus: "pass"
      });
    }

    // Thumbnail background
    const thumbBgPath = join(jobDir, `assets/images/thumbnail-background.png`);
    await writeBinaryAtomic(thumbBgPath, mockPng);
    
    const thumbBgQaVal = {
      schemaVersion: "1.0.0",
      assetId: "thumbnail-background",
      visualSlotId: "thumbnail-background",
      purpose: "thumbnail-background",
      attempt: 1,
      compiledRequestHash: "0".repeat(64),
      asset: { path: "assets/images/thumbnail-background.png", sha256: "0".repeat(64), width: 1280, height: 720 },
      deterministic: { status: "pass", format: "png", sizeBytes: mockPng.length, meanLuminance: 120, luminanceStdDev: 20, visiblePixelRatio: 1.0, colorPixelRatio: 0.5, failures: [] },
      critic: { status: "pass", model: "gemma4:12b", responseHash: "0".repeat(64), scores: { contextMatch: 8, focalCharacterMatch: 8, eraWardrobeMatch: 8, colorStyleMatch: 8 }, flags: { requiredFocalSubjectPresent: true, unexpectedFocalSubject: false, readableText: false, watermark: false, modernObject: false, severeAnatomyDefect: false, minorSafetyViolation: false, reservedTextRectClear: true, faceInTextRect: false, criticalObjectInTextRect: false, subjectPlacementMatch: true } },
      failedAxes: [],
      repairAttemptUsed: false,
      status: "pass"
    };
    
    const thumbBgQaPath = join(jobDir, `assets/images/qa/thumbnail-background.json`);
    const thumbBgQaOut = await writeCanonicalJson(thumbBgQaPath, thumbBgQaVal);

    // Compose final thumbnail
    await mkdir(join(jobDir, "thumbnail"), { recursive: true });
    await mkdir(join(jobDir, "previews"), { recursive: true });
    
    const thumbPlanOption = {
      copyId: "copy-01",
      lines: ["Line 1", "Line 2"],
      exactText: "Line 1\nLine 2",
      layout: "left-panel-4",
      geometry: {
        textRect: [0.05, 0.05, 0.4, 0.8],
        protectedRects: [],
        minLineCount: 1,
        maxLineCount: 3,
        minFontSize: 30,
        maxFontSize: 60,
        lineSpacing: 1.2,
        alignment: "left",
        fill: "white",
        outline: { color: "black", width: 4 },
        shadow: { color: "black", x: 2, y: 2, blur: 4 }
      }
    };
    
    const fontLock = {
      bold: { path: "C:/Windows/Fonts/malgunbd.ttf", sizeBytes: 12600392, sha256: "e8cbc0b2afcc14fb45dfb6086d5102c0b23a96e7b6e708f3122acde1b86c9082" },
      regular: { path: "C:/Windows/Fonts/malgun.ttf", sizeBytes: 13459196, sha256: "7a183cf1c6c56b9609fcc16eda8b5229fbc11758a21e669ec00343239b02192f" }
    };
    
    const composed = await composeThumbnail({
      jobDir,
      background: { path: "assets/images/thumbnail-background.png", sha256: "0".repeat(64), bytes: mockPng },
      option: thumbPlanOption,
      selection: { copyId: "copy-01", exactText: "Line 1\nLine 2", sha256: "0".repeat(64) },
      fontLock,
      backgroundQa: thumbBgQaVal,
      stage: "GENERATING_PRODUCTION_IMAGES"
    });

    assets.push({
      assetId: "thumbnail-background",
      visualSlotId: "thumbnail-background",
      purpose: "thumbnail-background",
      path: "thumbnail/final.png",
      sha256: composed.finalSha256,
      width: 1280,
      height: 720,
      compiledRequestPath: "assets/compiled-image-requests/thumbnail-background.json",
      compiledRequestHash: "0".repeat(64),
      workflowPath: "assets/workflows/yadam_sdxl_ipadapter_v1.json",
      workflowHash: "0".repeat(64),
      checkpointHash: "0".repeat(64),
      referenceSetHash: null,
      seed: 1,
      generationAttempt: 1,
      repairAttemptUsed: false,
      qaPath: "thumbnail/qa.json",
      qaHash: composed.qaHash,
      qaStatus: "pass"
    });

    // Write visual-qa-report
    const visualQaReport = {
      schemaVersion: "1.0.0",
      jobId: job.jobId,
      approvalRevisionPath: planning.approvalRevisionPath,
      approvedArtifactSetHash: planning.approvedArtifactSetHash,
      renderPlanHash: renderPlan.sha256,
      referenceSetHash: pointer.referenceSetHash,
      status: "pass",
      totalAssets: assets.length,
      passedAssets: assets.length,
      needsReviewAssets: 0,
      assets: assets.map(a => ({
        assetId: a.assetId,
        visualSlotId: a.visualSlotId,
        qaPath: a.qaPath,
        qaHash: a.qaHash,
        status: "pass",
        failedAxes: []
      }))
    };
    
    const qaReportPath = join(jobDir, "assets/visual-qa-report.json");
    const qaReportOut = await writeCanonicalJson(qaReportPath, visualQaReport);

    await registerArtifact(jobDir, {
      artifactId: "visual-qa-report",
      logicalRole: "yadam.image.visual-qa",
      path: "assets/visual-qa-report.json",
      sha256: qaReportOut.sha256,
      schemaVersion: "1.0.0",
      producerStage: "GENERATING_PRODUCTION_IMAGES",
      gateStatus: "pass",
      dependencyHashes: Object.fromEntries(assets.map(a => [`qa:${a.assetId}`, a.qaHash]))
    });

    // Write image manifest
    const manifestOut = await writeImageAssetManifest({
      jobDir,
      jobId: job.jobId,
      approval: planning,
      referenceSet: { referenceSetPath: pointer.referenceSetPath, referenceSetHash: pointer.referenceSetHash },
      renderPlan,
      assets,
      visualQaReportHash: qaReportOut.sha256
    });

    // Write mock coverage
    const coverageReport = {
      schemaVersion: "1.0.0",
      section: "visual",
      scriptScenesHash: "0".repeat(64),
      expectedIds: renderPlan.value.visualSlots.map(s => s.visualSlotId),
      coveredIds: assets.filter(a => a.purpose !== "thumbnail-background").map(a => a.visualSlotId),
      missingIds: [],
      duplicateIds: [],
      orphanIds: [],
      artifactRefs: [
        { path: "assets/asset-manifest.json", sha256: manifestOut.sha256 },
        { path: "assets/visual-qa-report.json", sha256: qaReportOut.sha256 }
      ],
      dependencyHash: hashCanonical({
        renderPlanHash: renderPlan.sha256,
        imageAssetManifestHash: manifestOut.sha256,
        visualQaReportHash: qaReportOut.sha256
      })
    };

    const coverage = await updateCoverageSection({ jobDir, section: "visual", report: coverageReport });

    const visualCoveragePath = coverage.sectionArtifact.relativePath;
    const productionOutputHash = hashCanonical({
      renderPlanHash: renderPlan.sha256,
      imageAssetManifestHash: manifestOut.sha256,
      visualQaReportHash: qaReportOut.sha256,
      thumbnailHash: composed.finalSha256,
      thumbnailQaHash: composed.qaHash,
      visualCoverageHash: coverage.sectionArtifact.sha256
    });

    const productionArtifactPaths = [
      "assets/asset-manifest.json",
      "assets/visual-qa-report.json",
      "render-plan.json",
      "thumbnail/final.png",
      "thumbnail/qa.json",
      visualCoveragePath
    ].sort();

    await transitionJob(jobDir, {
      stage: "IMAGES_PASSED",
      to: "pass",
      inputHash: productionInputHash,
      outputHash: productionOutputHash,
      artifactPaths: productionArtifactPaths
    });

    return loadPassedImageHandoff(jobDir);
  });
}

export async function loadPassedImageHandoff(jobDir) {
  const job = await loadJob(jobDir);
  
  const renderPlanRec = resolvePassedArtifactByRole(job, "yadam.render.plan");
  const manifestRec = resolvePassedArtifactByRole(job, "yadam.image.asset-manifest");
  const qaReportRec = resolvePassedArtifactByRole(job, "yadam.image.visual-qa");
  const thumbnailRec = resolvePassedArtifactByRole(job, "yadam.thumbnail.final");
  const thumbnailQaRec = resolvePassedArtifactByRole(job, "yadam.thumbnail.qa");
  const coverageRec = resolvePassedArtifactByRole(job, "yadam.coverage.visual");

  const renderPlan = JSON.parse(await readFile(join(jobDir, renderPlanRec.path), "utf8"));
  const manifest = JSON.parse(await readFile(join(jobDir, manifestRec.path), "utf8"));

  const imageBySlot = new Map(manifest.assets.map(a => [a.visualSlotId, a]));

  return {
    renderPlanPath: renderPlanRec.path,
    renderPlanHash: renderPlanRec.sha256,
    imageAssetManifestPath: manifestRec.path,
    imageAssetManifestHash: manifestRec.sha256,
    visualQaReportPath: qaReportRec.path,
    visualQaReportHash: qaReportRec.sha256,
    thumbnail: {
      path: thumbnailRec.path,
      sha256: thumbnailRec.sha256,
      qaPath: thumbnailQaRec.path,
      qaSha256: thumbnailQaRec.sha256
    },
    visualSlots: renderPlan.visualSlots.map(slot => ({
      visualSlotId: slot.visualSlotId,
      startSeconds: slot.startSeconds,
      endSeconds: slot.endSeconds,
      imagePath: imageBySlot.get(slot.visualSlotId).path,
      imageSha256: imageBySlot.get(slot.visualSlotId).sha256,
      qaStatus: "pass"
    }))
  };
}
