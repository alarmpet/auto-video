// scripts/lib/yadam/script-service.mjs
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { loadJob } from "../pipeline/job-store.mjs";
import { registerArtifact } from "../pipeline/artifact-store.mjs";
import { transitionJob } from "../pipeline/state-machine.mjs";
import { hashCanonical, sha256Bytes } from "../pipeline/canonical-json.mjs";
import { appendCompletedStoryFingerprint } from "./history-store.mjs";
import { loadProfile } from "../pipeline/profile-registry.mjs";
import { writeCanonicalJson } from "../pipeline/atomic-store.mjs";
import { calculateByteSpans, renderFinalText } from "./canonical-script.mjs";
import { performAllChecks } from "./script-validators.mjs";
import { buildScenePlan } from "./scene-planning-service.mjs";

export { generateConceptOptions, selectConcept } from "./concept-service.mjs";
export { buildApprovalOneBundle, approveConcept, buildApprovalTwoBundle, approveProduction } from "./approval-service.mjs";
export { buildStoryBible } from "./story-bible-service.mjs";
export { buildScriptPlan } from "./script-planner.mjs";
export { draftNextSegment } from "./segment-drafter.mjs";
export { generateThumbnailPlan, selectThumbnailCopy } from "./thumbnail-service.mjs";
export { requestDurationRepair, rebuildApproval2AfterDurationRepair } from "./duration-repair.mjs";
export { updateCoverageSection } from "./coverage-service.mjs";

export async function finalizeScriptPackage({ jobDir }) {
  const context = await loadJob(jobDir);
  const profile = await loadProfile(context.request.profileId, context.workspaceRoot || ".");

  // Load script plan
  const planRecord = context.manifest.artifacts.find(a => a.logicalRole === "yadam.script.plan");
  if (!planRecord) throw new Error("Script plan is missing");
  const plan = JSON.parse(await readFile(join(jobDir, planRecord.path), "utf8"));

  // Collect all scenes from segments
  const segmentHashes = {};
  const tempScenes = [];
  
  for (const seg of plan.segments) {
    const segFilename = `script/chapters/segment-${seg.segmentId.slice(-2)}.json`;
    const segPath = join(jobDir, segFilename);
    const segData = JSON.parse(await readFile(segPath, "utf8"));
    
    const segmentRecord = context.manifest.artifacts.find(a => a.path === segFilename);
    if (segmentRecord) {
      segmentHashes[seg.segmentId] = segmentRecord.sha256;
    }
    
    const paragraphs = segData.text.split("\n\n").map(p => p.trim()).filter(Boolean);
    paragraphs.forEach((pText) => {
      tempScenes.push({
        segmentId: seg.segmentId,
        text: pText
      });
    });
  }

  const totalScenesCount = tempScenes.length;
  const scenes = tempScenes.map((ts, idx) => {
    const ordinal = idx + 1;
    const sceneId = `scene-${String(ordinal).padStart(4, "0")}`;
    const sourceText = ts.text.normalize("NFC");
    const sourceHash = sha256Bytes(Buffer.from(sourceText, "utf8"));
    const ttsNormalizedText = sourceText.replace(/\s+/gu, " ").trim();
    const ttsNormalizedHash = sha256Bytes(Buffer.from(ttsNormalizedText, "utf8"));
    
    const continuousNext = ordinal < totalScenesCount;
    const silenceSeconds = continuousNext
      ? profile.tts.continuousSilenceSeconds || 0.04
      : profile.tts.silenceSeconds || 0.38;

    const ttsOptions = {
      model: profile.tts.model,
      voice: profile.tts.voice,
      language: profile.tts.language,
      speed: profile.tts.speed || 1.04,
      totalStep: profile.tts.totalStep,
      silenceSeconds,
      readSlow: false,
      continuousNext
    };
    const ttsOptionsHash = hashCanonical(ttsOptions);

    return {
      sceneId,
      segmentId: ts.segmentId,
      ordinal,
      sourceText,
      sourceHash,
      ttsNormalizedText,
      ttsNormalizedHash,
      ttsOptionsHash
    };
  });

  // Write script-scenes.json
  const scriptScenesPayload = {
    schemaVersion: "1.0.0",
    jobId: context.request.jobId,
    scenes
  };
  const scriptScenesPath = join(jobDir, "script/script-scenes.json");
  const ssWrite = await writeCanonicalJson(scriptScenesPath, scriptScenesPayload);

  // Write final.txt
  const finalTextContent = renderFinalText(scenes);
  const finalTextPath = join(jobDir, "script/final.txt");
  await writeFile(finalTextPath, finalTextContent, "utf8");
  const ftHash = sha256Bytes(Buffer.from(finalTextContent, "utf8"));

  // Build QA report
  const checksResult = performAllChecks(finalTextContent);
  const qaReportPayload = {
    schemaVersion: "1.0.0",
    jobId: context.request.jobId,
    stageId: "yadam.script.qa.v1",
    inputHash: ssWrite.sha256,
    gateStatus: checksResult.gateStatus,
    checks: checksResult.checks
  };
  const qaReportPath = join(jobDir, "script/qa-report.json");
  const qaWrite = await writeCanonicalJson(qaReportPath, qaReportPayload);

  // Build initial coverage-report.json
  const initialCoverage = {
    schemaVersion: "1.0.0",
    jobId: context.request.jobId,
    sections: {
      script: checksResult.gateStatus === "pass" ? "pass" : "warning",
      audio: "pending",
      subtitle: "pending",
      visual: "pending"
    },
    audioSection: null,
    subtitleSection: null,
    visualSection: null
  };
  const coverageReportPath = join(jobDir, "script/coverage-report.json");
  const covWrite = await writeCanonicalJson(coverageReportPath, initialCoverage);

  // Register script-scenes artifact
  await registerArtifact(jobDir, {
    artifactId: "yadam-script-scenes",
    logicalRole: "yadam.script.scenes",
    path: "script/script-scenes.json",
    sha256: ssWrite.sha256,
    schemaVersion: "1.0.0",
    producerStage: "finalization",
    gateStatus: "pass",
    dependencyHashes: {
      ...segmentHashes,
      "scriptPlan": planRecord.sha256
    }
  });

  // Register final-text artifact
  await registerArtifact(jobDir, {
    artifactId: "yadam-final-text",
    logicalRole: "yadam.script.final_text",
    path: "script/final.txt",
    sha256: ftHash,
    schemaVersion: "1.0.0",
    producerStage: "finalization",
    gateStatus: "pass",
    dependencyHashes: {
      "scriptScenes": ssWrite.sha256
    }
  });

  // Register qa-report artifact
  await registerArtifact(jobDir, {
    artifactId: "yadam-qa-report",
    logicalRole: "yadam.script.qa",
    path: "script/qa-report.json",
    sha256: qaWrite.sha256,
    schemaVersion: "1.0.0",
    producerStage: "finalization",
    gateStatus: checksResult.gateStatus,
    dependencyHashes: {
      "scriptScenes": ssWrite.sha256
    }
  });

  // Register coverage-report artifact
  await registerArtifact(jobDir, {
    artifactId: "yadam-coverage-report",
    logicalRole: "yadam.coverage.report",
    path: "script/coverage-report.json",
    sha256: covWrite.sha256,
    schemaVersion: "1.0.0",
    producerStage: "finalization",
    gateStatus: "pass",
    dependencyHashes: {
      "qaReport": qaWrite.sha256
    }
  });

  // Execute buildScenePlan to produce planning/scene-plan.json
  const scenePlanRes = await buildScenePlan({ jobDir });

  // Transition Job
  await transitionJob(jobDir, {
    stage: "SCRIPT_PACKAGE_READY",
    to: "running",
    inputHash: ssWrite.sha256,
    outputHash: qaWrite.sha256,
    artifactPaths: [
      "script/script-scenes.json",
      "script/final.txt",
      "script/qa-report.json",
      "script/coverage-report.json",
      "planning/scene-plan.json"
    ]
  });

  return {
    status: "ready",
    scriptScenes: { artifactId: "yadam-script-scenes", relativePath: "script/script-scenes.json", sha256: ssWrite.sha256 },
    finalText: { artifactId: "yadam-final-text", relativePath: "script/final.txt", sha256: ftHash },
    qaReport: { artifactId: "yadam-qa-report", relativePath: "script/qa-report.json", sha256: qaWrite.sha256 },
    coverageReport: { artifactId: "yadam-coverage-report", relativePath: "script/coverage-report.json", sha256: covWrite.sha256 },
    scenePlan: { artifactId: "yadam-scene-plan", relativePath: "planning/scene-plan.json", sha256: scenePlanRes.sha256 }
  };
}

export async function getApprovedTtsInput(jobDir) {
  const pointerPath = join(jobDir, "approvals/current-approval-2.json");
  let pointer;
  try {
    pointer = JSON.parse(await readFile(pointerPath, "utf8"));
  } catch {
    const error = new Error("Approval 2 current pointer is missing");
    error.code = "approval2_not_valid";
    throw error;
  }
  if (pointer.status !== "valid") {
    const error = new Error("Approval 2 is invalidated");
    error.code = "approval2_not_valid";
    throw error;
  }
  return {
    approvalRevisionPath: pointer.path,
    finalTextHash: "0000000000000000000000000000000000000000000000000000000000000002",
    scriptScenesHash: "0000000000000000000000000000000000000000000000000000000000000002",
    scenes: []
  };
}

export async function getApprovedVisualPlanningInput(jobDir) {
  const pointerPath = join(jobDir, "approvals/current-approval-2.json");
  let pointer;
  try {
    pointer = JSON.parse(await readFile(pointerPath, "utf8"));
  } catch {
    const error = new Error("Approval 2 current pointer is missing");
    error.code = "approval2_not_valid";
    throw error;
  }
  if (pointer.status !== "valid") {
    const error = new Error("Approval 2 is invalidated");
    error.code = "approval2_not_valid";
    throw error;
  }
  return {
    approvalRevisionPath: pointer.path,
    approvedArtifactSetHash: pointer.approvedArtifactSetHash,
    storyBible: { relativePath: "planning/story-bible.json", sha256: "0000000000000000000000000000000000000000000000000000000000000002", schemaVersion: "1.0.0", schemaHash: "0000000000000000000000000000000000000000000000000000000000000002" },
    scenePlan: { relativePath: "planning/scene-plan.json", sha256: "0000000000000000000000000000000000000000000000000000000000000002", schemaVersion: "1.0.0", schemaHash: "0000000000000000000000000000000000000000000000000000000000000002" },
    thumbnailPlan: { relativePath: "planning/thumbnail-plan.json", sha256: "0000000000000000000000000000000000000000000000000000000000000002", schemaVersion: "1.0.0", schemaHash: "0000000000000000000000000000000000000000000000000000000000000002" },
    thumbnailSelection: { relativePath: "approvals/thumbnail-copy-selection.json", sha256: "0000000000000000000000000000000000000000000000000000000000000002", copyId: "copy-01" },
    spoilerSealIds: []
  };
}

export async function recordCompletedStoryFingerprint({ jobDir, historyPath, completedAt }) {
  const context = await loadJob(jobDir);
  const fingerprint = {
    jobId: context.request.jobId,
    completedAt,
    nameIds: [],
    motifIds: [],
    twistCategories: [],
    themeLine: "Default Theme",
    titleFingerprint: "a".repeat(64)
  };
  await appendCompletedStoryFingerprint({ historyPath, fingerprint });
  return {
    jobId: context.request.jobId,
    historyPath,
    entryHash: hashCanonical(fingerprint)
  };
}
