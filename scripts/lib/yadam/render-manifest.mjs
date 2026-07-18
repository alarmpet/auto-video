import { readFile, rename, lstat, rm, mkdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { loadJob } from "../pipeline/job-store.mjs";
import { writeCanonicalJsonExclusive, readJson, writeCanonicalJson } from "../pipeline/atomic-store.mjs";
import { registerArtifact } from "../pipeline/artifact-store.mjs";
import { hashCanonical, sha256Bytes } from "../pipeline/canonical-json.mjs";
import { validateSchema } from "../pipeline/schema-registry.mjs";
import { assertPathWithin, assertRealPathWithin } from "../pipeline/path-policy.mjs";
import { loadPassedAudioHandoff } from "./tts-service.mjs";
import { loadPassedImageHandoff } from "./image-service.mjs";
import { loadPassedSubtitleHandoff } from "./subtitle-service.mjs";
import { ensureContainedVideoDirectory } from "./video-layout.mjs";

const RENDER_MANIFEST_SCHEMA = resolve("schemas/yadam/render-manifest.schema.json");

export async function finalizeRenderManifest({ jobDir }) {
  const job = await loadJob(jobDir);
  
  // Load current approval revision pointer
  const approvalPointerPath = join(jobDir, "approvals/current-approval-2.json");
  if (!existsSync(approvalPointerPath)) {
    throw Object.assign(new Error("Approval 2 pointer is missing"), { code: "approval2_not_valid" });
  }
  const approvalPointer = JSON.parse(await readFile(approvalPointerPath, "utf8"));
  if (approvalPointer.status !== "valid") {
    throw Object.assign(new Error("Approval 2 is invalidated"), { code: "approval2_not_valid" });
  }

  // Load handoffs
  const audioHandoff = await loadPassedAudioHandoff(jobDir);
  const imageHandoff = await loadPassedImageHandoff(jobDir);
  const subtitleHandoff = await loadPassedSubtitleHandoff(jobDir);

  // Load coverage report to extract section hashes and revisions
  const coverageReportPath = join(jobDir, "script/coverage-report.json");
  if (!existsSync(coverageReportPath)) {
    throw new Error("missing script/coverage-report.json");
  }
  const coverageReport = JSON.parse(await readFile(coverageReportPath, "utf8"));
  
  if (!coverageReport.audioSection || !coverageReport.visualSection || !coverageReport.subtitleSection) {
    throw new Error("missing coverage sections in coverage-report.json");
  }

  // Verify that subtitle Section matches subtitleHandoff
  if (coverageReport.subtitleSection.sha256 !== subtitleHandoff.subtitleCoverageHash) {
    throw new Error("subtitle coverage mismatch");
  }

  // Load image asset manifest for provenance
  const assetManifestPath = join(jobDir, imageHandoff.imageAssetManifestPath);
  const assetManifest = JSON.parse(await readFile(assetManifestPath, "utf8"));
  const assetBySlot = new Map(assetManifest.assets.map(a => [a.visualSlotId, a]));

  // Calculate dependencies mapping (relative paths to hashes)
  const scriptScenesRec = job.manifest.artifacts?.find(a => a.logicalRole === "yadam.script.scenes" && a.gateStatus === "pass");
  const finalTextRec = job.manifest.artifacts?.find(a => a.logicalRole === "yadam.script.final_text" && a.gateStatus === "pass");
  if (!scriptScenesRec || !finalTextRec) {
    throw new Error("missing passed script artifacts");
  }

  const dependencies = {
    "script/script-scenes.json": scriptScenesRec.sha256,
    "script/final.txt": finalTextRec.sha256,
    [audioHandoff.audioManifestPath]: audioHandoff.audioManifestHash,
    [audioHandoff.audioTimelinePath]: audioHandoff.audioTimelineHash,
    [audioHandoff.renderPlanInputPath]: audioHandoff.renderPlanInputHash,
    [imageHandoff.renderPlanPath]: imageHandoff.renderPlanHash,
    [imageHandoff.imageAssetManifestPath]: imageHandoff.imageAssetManifestHash,
    [imageHandoff.visualQaReportPath]: imageHandoff.visualQaReportHash,
    [imageHandoff.thumbnail.path]: imageHandoff.thumbnail.sha256,
    [imageHandoff.thumbnail.qaPath]: imageHandoff.thumbnail.qaSha256,
    [coverageReport.audioSection.relativePath]: coverageReport.audioSection.sha256,
    [coverageReport.visualSection.relativePath]: coverageReport.visualSection.sha256,
    [coverageReport.subtitleSection.relativePath]: coverageReport.subtitleSection.sha256
  };

  // Add all segment SRTs
  for (const seg of subtitleHandoff.segments) {
    dependencies[seg.srtPath] = seg.srtHash;
  }

  // Check and verify all hashes of files in dependencies
  for (const [relPath, expectedHash] of Object.entries(dependencies)) {
    const abs = join(jobDir, relPath);
    if (!existsSync(abs)) {
      throw new Error(`dependency file does not exist: ${relPath}`);
    }
    const actual = sha256Bytes(await readFile(abs));
    if (actual.toLowerCase() !== expectedHash.toLowerCase()) {
      throw Object.assign(new Error(`render_manifest_dependency_changed: ${relPath}`), {
        code: "render_manifest_dependency_changed"
      });
    }
  }

  // Join visual slots
  const visualSlots = [];
  const imageSlotMap = new Map(imageHandoff.visualSlots.map(s => [s.visualSlotId, s]));

  for (const slot of audioHandoff.visualSlots) {
    const imageSlot = imageSlotMap.get(slot.visualSlotId);
    if (!imageSlot) {
      throw new Error(`visualSlot missing from image handoff: ${slot.visualSlotId}`);
    }
    
    // Check timing difference <= 0.01
    if (Math.abs(slot.startSeconds - imageSlot.startSeconds) > 0.01 || 
        Math.abs(slot.endSeconds - imageSlot.endSeconds) > 0.01) {
      throw new Error(`Timing mismatch for visual slot ${slot.visualSlotId}`);
    }

    const asset = assetBySlot.get(slot.visualSlotId);
    if (!asset) {
      throw new Error(`visualSlot asset missing in asset manifest: ${slot.visualSlotId}`);
    }

    // Verify visual slot image hash matches image handoff
    if (asset.sha256.toLowerCase() !== imageSlot.imageSha256.toLowerCase()) {
      throw new Error(`visualSlot image hash mismatch: ${slot.visualSlotId}`);
    }

    visualSlots.push({
      visualSlotId: slot.visualSlotId,
      visualOrder: slot.visualOrder,
      segmentId: slot.segmentId,
      sourceSceneIds: slot.sourceSceneIds,
      primarySceneId: slot.primarySceneId,
      startSeconds: slot.startSeconds,
      endSeconds: slot.endSeconds,
      durationSeconds: slot.durationSeconds,
      timingBand: slot.timingBand,
      extendedHold: slot.extendedHold || false,
      holdReason: slot.holdReason || null,
      purpose: slot.purpose,
      imagePath: imageSlot.imagePath,
      imageSha256: imageSlot.imageSha256,
      qaStatus: "pass",
      provider: asset.provider || "comfyui",
      model: asset.model || "sdxl",
      workflowPath: asset.workflowPath || "",
      workflowHash: asset.workflowHash || "0".repeat(64),
      checkpointHash: asset.checkpointHash || "0".repeat(64),
      seed: asset.seed || 1,
      generationAttempt: asset.generationAttempt || 1
    });
  }

  // Verify visual slot source scene existence
  const audioSceneIds = new Set(audioHandoff.scenes.map(s => s.sceneId));
  for (const slot of visualSlots) {
    for (const sId of slot.sourceSceneIds) {
      if (!audioSceneIds.has(sId)) {
        throw new Error(`visualSlot ${slot.visualSlotId} references nonexistent scene ${sId}`);
      }
    }
  }

  // Continuity and intro checks
  if (visualSlots.length > 0) {
    if (visualSlots[0].startSeconds > 0.01) {
      throw new Error(`First visual slot must start at 0 (got ${visualSlots[0].startSeconds})`);
    }
    for (let i = 1; i < visualSlots.length; i++) {
      const prev = visualSlots[i - 1];
      const curr = visualSlots[i];
      if (Math.abs(curr.startSeconds - prev.endSeconds) > 0.01) {
        throw new Error(`Visual slots are not continuous: gap/overlap between ${prev.visualSlotId} and ${curr.visualSlotId}`);
      }
    }
    
    const lastVisualEnd = visualSlots[visualSlots.length - 1].endSeconds;
    if (Math.abs(lastVisualEnd - audioHandoff.measuredAudioSeconds) > 0.05) {
      throw new Error(`Last visual slot end ${lastVisualEnd} differs from measured audio seconds ${audioHandoff.measuredAudioSeconds} by more than 0.05s`);
    }
  }

  // Intro visual slot ownership check: intro slots must only belong to segment 1
  // segment 1 is segment-01
  const introVisualSlotIds = [];
  const introSceneIds = [];
  for (const slot of visualSlots) {
    if (slot.timingBand === "intro") {
      if (slot.segmentId !== "segment-01") {
        throw new Error(`Intro visual slot ${slot.visualSlotId} is in later segment: ${slot.segmentId}`);
      }
      introVisualSlotIds.push(slot.visualSlotId);
    }
  }

  for (const scene of audioHandoff.scenes) {
    if (scene.segmentId === "segment-01") {
      // Find if any slot covering this scene is intro
      const sceneSlots = visualSlots.filter(s => s.sourceSceneIds.includes(scene.sceneId));
      if (sceneSlots.some(s => s.timingBand === "intro")) {
        introSceneIds.push(scene.sceneId);
      }
    } else {
      // scene in later segment cannot be intro
      const sceneSlots = visualSlots.filter(s => s.sourceSceneIds.includes(scene.sceneId));
      if (sceneSlots.some(s => s.timingBand === "intro")) {
        throw new Error(`Intro scene ${scene.sceneId} is in later segment: ${scene.segmentId}`);
      }
    }
  }

  // Construct render manifest
  const renderManifest = {
    schemaVersion: "1.0.0",
    profileId: "yadam",
    jobId: job.jobId,
    approvalRevisionPath: approvalPointer.path,
    width: 1920,
    height: 1080,
    fps: 24,
    audioTempoFactor: 1,
    plannedDurationSeconds: audioHandoff.segments.reduce((acc, s) => acc + s.plannedDurationSeconds, 0),
    measuredAudioSeconds: audioHandoff.measuredAudioSeconds,
    renderDurationSeconds: audioHandoff.measuredAudioSeconds,
    script: {
      scenesPath: "script/script-scenes.json",
      scenesHash: scriptScenesRec.sha256,
      finalTextPath: "script/final.txt",
      finalTextHash: finalTextRec.sha256
    },
    dependencies,
    coverage: {
      audio: {
        path: coverageReport.audioSection.relativePath,
        sha256: coverageReport.audioSection.sha256,
        revision: coverageReport.audioSection.revision
      },
      visual: {
        path: coverageReport.visualSection.relativePath,
        sha256: coverageReport.visualSection.sha256,
        revision: coverageReport.visualSection.revision
      },
      subtitle: {
        path: coverageReport.subtitleSection.relativePath,
        sha256: coverageReport.subtitleSection.sha256,
        revision: coverageReport.subtitleSection.revision
      }
    },
    subtitleSetHash: subtitleHandoff.subtitleSetHash,
    scenes: audioHandoff.scenes,
    visualSlots,
    subtitleCues: subtitleHandoff.cues,
    segments: audioHandoff.segments,
    introSceneIds,
    introVisualSlotIds,
    thumbnail: {
      path: imageHandoff.thumbnail.path,
      sha256: imageHandoff.thumbnail.sha256,
      qaPath: imageHandoff.thumbnail.qaPath,
      qaSha256: imageHandoff.thumbnail.qaSha256,
      qaStatus: "pass"
    }
  };

  await validateSchema(RENDER_MANIFEST_SCHEMA, renderManifest);

  const manifestPath = join(jobDir, "render-manifest.json");

  // Reuse logic
  if (existsSync(manifestPath)) {
    try {
      const existing = JSON.parse(await readFile(manifestPath, "utf8"));
      // Validate schema
      await validateSchema(RENDER_MANIFEST_SCHEMA, existing);
      // Check if dependencies match
      let match = true;
      for (const [k, v] of Object.entries(dependencies)) {
        if (existing.dependencies[k] !== v) {
          match = false;
          break;
        }
      }
      if (match && existing.subtitleSetHash === subtitleHandoff.subtitleSetHash && existing.jobId === job.jobId) {
        // Equal manifest, reuse it!
        return { path: "render-manifest.json", sha256: sha256Bytes(await readFile(manifestPath)) };
      }
    } catch {
      // fall through to overwrite/quarantine
    }

    // Stale/failed manifest exists -> quarantine it
    const oldBytes = await readFile(manifestPath);
    const oldHash = sha256Bytes(oldBytes);
    const quarantinePubDir = await ensureContainedVideoDirectory(jobDir, `quarantine/video/publications/render-manifest-${oldHash}`);
    await rename(manifestPath, join(quarantinePubDir, "render-manifest.json"));
    
    // Write invalidation evidence
    const evidence = {
      invalidatedAt: new Date().toISOString(),
      reason: "dependencies_changed_or_corrupted",
      oldHash
    };
    writeFileSync(join(quarantinePubDir, "invalidation-evidence.json"), JSON.stringify(evidence, null, 2), "utf8");
  }

  // Exclusively publish
  const writeRes = await writeCanonicalJsonExclusive(manifestPath, renderManifest);
  
  // Register artifact
  await registerArtifact(jobDir, {
    artifactId: "yadam-render-manifest",
    logicalRole: "yadam.render.manifest",
    path: "render-manifest.json",
    sha256: writeRes.sha256,
    schemaVersion: "1.0.0",
    producerStage: "render-manifest-finalization",
    gateStatus: "pass",
    dependencyHashes: dependencies
  });

  return {
    path: "render-manifest.json",
    sha256: writeRes.sha256
  };
}

export async function loadVerifiedRenderManifest(jobDir) {
  const job = await loadJob(jobDir);
  const manifestRec = job.manifest.artifacts?.find(a => a.logicalRole === "yadam.render.manifest" && a.gateStatus === "pass");
  if (!manifestRec) {
    throw new Error("missing passed render manifest artifact");
  }

  const manifestPath = join(jobDir, manifestRec.path);
  if (!existsSync(manifestPath)) {
    throw new Error("render-manifest.json file does not exist");
  }

  const bytes = await readFile(manifestPath);
  const currentHash = sha256Bytes(bytes);
  if (currentHash.toLowerCase() !== manifestRec.sha256.toLowerCase()) {
    throw new Error("render-manifest.json hash mismatch");
  }

  const manifest = JSON.parse(bytes.toString("utf8"));
  await validateSchema(RENDER_MANIFEST_SCHEMA, manifest);

  // Re-verify that dependencies have not changed
  for (const [relPath, expectedHash] of Object.entries(manifest.dependencies)) {
    const abs = join(jobDir, relPath);
    if (!existsSync(abs)) {
      throw Object.assign(new Error(`render_manifest_dependency_changed: missing ${relPath}`), {
        code: "render_manifest_dependency_changed"
      });
    }
    const actual = sha256Bytes(await readFile(abs));
    if (actual.toLowerCase() !== expectedHash.toLowerCase()) {
      throw Object.assign(new Error(`render_manifest_dependency_changed: ${relPath}`), {
        code: "render_manifest_dependency_changed"
      });
    }
  }

  return {
    path: manifestRec.path,
    sha256: manifestRec.sha256,
    value: manifest
  };
}
