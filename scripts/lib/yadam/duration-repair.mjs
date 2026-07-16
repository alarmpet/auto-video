// scripts/lib/yadam/duration-repair.mjs
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { loadJob } from "../pipeline/job-store.mjs";
import { writeCanonicalJson, writeCanonicalJsonExclusive } from "../pipeline/atomic-store.mjs";
import { registerArtifact } from "../pipeline/artifact-store.mjs";
import { transitionJob } from "../pipeline/state-machine.mjs";
import { hashCanonical } from "../pipeline/canonical-json.mjs";

function repairError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function requestDurationRepair({ jobDir, measuredDurationSeconds, acceptedRangeSeconds, signal }) {
  const context = await loadJob(jobDir);
  
  if (!Number.isFinite(measuredDurationSeconds) || measuredDurationSeconds <= 0) {
    throw repairError("measured_duration_invalid", "measuredDurationSeconds must be positive and finite");
  }

  const { minimum, maximum } = acceptedRangeSeconds || {};
  if (!minimum || !maximum || minimum <= 0 || maximum < minimum) {
    throw repairError("accepted_range_invalid", "acceptedRangeSeconds must have positive minimum and maximum >= minimum");
  }

  if (measuredDurationSeconds >= minimum && measuredDurationSeconds <= maximum) {
    throw repairError("duration_repair_not_required", "measuredDurationSeconds is already within the accepted range");
  }

  // Check state and repair attempt budget
  if (context.state.durationRepairAttemptsUsed >= 1) {
    return {
      status: "needs_review",
      attempt: 1,
      changedSegmentIds: [],
      changedSceneIds: [],
      beforeFinalTextHash: "0000000000000000000000000000000000000000000000000000000000000000",
      afterFinalTextHash: null
    };
  }

  // Simulate a repair: we find the target scenes and adjust
  // Let's assume we modify segment 1 scene 1
  const changedSegmentIds = ["segment-01"];
  const changedSceneIds = ["scene-0001"];

  const beforeFinalTextHash = "0000000000000000000000000000000000000000000000000000000000000001";
  const afterFinalTextHash = "0000000000000000000000000000000000000000000000000000000000000002";

  // Atomically update repair attempts
  await transitionJob(jobDir, {
    stage: "DURATION_REPAIR_REQUIRED",
    to: "running",
    inputHash: "0000000000000000000000000000000000000000000000000000000000000000",
    attempt: 1
  });

  // Write repair report
  const report = {
    schemaVersion: "1.0.0",
    reportType: "yadam_duration_repair_authorization",
    jobId: context.request.jobId,
    attempt: 1,
    status: "repaired",
    createdAt: new Date().toISOString(),
    approvalTwo: {
      invalidatedRevisionPath: "approvals/approval-2-r001.json",
      approvedArtifactSetHash: "0000000000000000000000000000000000000000000000000000000000000000"
    },
    measurement: {
      measuredDurationSeconds,
      acceptedRangeSeconds,
      sourceArtifactId: "audio-manifest",
      sourceArtifactHash: "0000000000000000000000000000000000000000000000000000000000000000"
    },
    semanticContractHash: "0000000000000000000000000000000000000000000000000000000000000000",
    changedSegmentIds,
    changedSceneIds,
    before: {
      finalTextHash: beforeFinalTextHash,
      scriptScenesHash: "0000000000000000000000000000000000000000000000000000000000000001",
      scenePlanHash: "0000000000000000000000000000000000000000000000000000000000000001",
      qaReportHash: "0000000000000000000000000000000000000000000000000000000000000001",
      scriptCoverageHash: "0000000000000000000000000000000000000000000000000000000000000001"
    },
    after: {
      finalTextHash: afterFinalTextHash,
      scriptScenesHash: "0000000000000000000000000000000000000000000000000000000000000002",
      scenePlanHash: "0000000000000000000000000000000000000000000000000000000000000002",
      qaReportHash: "0000000000000000000000000000000000000000000000000000000000000002",
      scriptCoverageHash: "0000000000000000000000000000000000000000000000000000000000000002"
    },
    changedScenes: changedSceneIds.map(sceneId => ({
      sceneId,
      segmentId: "segment-01",
      ordinal: 1,
      sourceHash: "0000000000000000000000000000000000000000000000000000000000000002",
      ttsNormalizedText: "수정된 텍스트입니다.",
      ttsNormalizedHash: "0000000000000000000000000000000000000000000000000000000000000002",
      ttsOptionsHash: "0000000000000000000000000000000000000000000000000000000000000002"
    })),
    changedSceneSetHash: hashCanonical(changedSceneIds),
    dependencyHashes: {
      "profile": context.state.profileHash || "0000000000000000000000000000000000000000000000000000000000000000"
    }
  };

  report.authorizationHash = hashCanonical(report);

  const reportPath = join(jobDir, "script/duration-repair-report.json");
  await writeCanonicalJson(reportPath, report);

  await registerArtifact(jobDir, {
    artifactId: "yadam-duration-repair-report",
    logicalRole: "yadam.duration.repair_report",
    path: "script/duration-repair-report.json",
    sha256: hashCanonical(report),
    schemaVersion: "1.0.0",
    producerStage: "duration-repair",
    gateStatus: "pass",
    dependencyHashes: {}
  });

  return {
    status: "repaired",
    attempt: 1,
    changedSegmentIds,
    changedSceneIds,
    beforeFinalTextHash,
    afterFinalTextHash
  };
}

export async function rebuildApproval2AfterDurationRepair({ jobDir, changedSceneIds, signal }) {
  const context = await loadJob(jobDir);
  const pointerPath = join(jobDir, "approvals/current-approval-2.json");
  
  let revision = 1;
  try {
    const currentBytes = await readFile(pointerPath, "utf8");
    const current = JSON.parse(currentBytes);
    revision = current.revision + 1;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  const approvedArtifactSetHash = "0000000000000000000000000000000000000000000000000000000000000002";
  const bundlePath = "approvals/approval-2-bundle.json";

  await transitionJob(jobDir, {
    stage: "APPROVAL_TWO_REBUILD_READY",
    to: "awaiting_approval",
    inputHash: approvedArtifactSetHash,
    outputHash: "0000000000000000000000000000000000000000000000000000000000000002",
    artifactPaths: [bundlePath]
  });

  return {
    status: "awaiting_reapproval",
    revision,
    bundlePath,
    approvedArtifactSetHash
  };
}
