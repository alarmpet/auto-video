// scripts/lib/yadam/thumbnail-service.mjs
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { loadJob } from "../pipeline/job-store.mjs";
import { writeCanonicalJson } from "../pipeline/atomic-store.mjs";
import { registerArtifact } from "../pipeline/artifact-store.mjs";
import { transitionJob } from "../pipeline/state-machine.mjs";
import { hashCanonical } from "../pipeline/canonical-json.mjs";

function thumbnailError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function generateThumbnailPlan({ jobDir }) {
  const context = await loadJob(jobDir);
  const { request } = context;

  const options = [
    { copyId: "copy-01", copyText: "뜻밖의 복을 얻은 선비의 이야기", layout: "left-panel-4" },
    { copyId: "copy-02", copyText: "욕심을 부리다 망한 부자", layout: "right-panel-4" },
    { copyId: "copy-03", copyText: "은혜 갚은 호랑이의 보은", layout: "bottom-band-2" },
    { copyId: "copy-04", copyText: "착하게 살아 복을 받은 가족", layout: "left-panel-4" }
  ];

  const thumbnailPlan = {
    schemaVersion: "1.0.0",
    jobId: request.jobId,
    stageId: "yadam.thumbnail.plan.v1",
    inputHash: "0000000000000000000000000000000000000000000000000000000000000000",
    options,
    recommendedCopyId: "copy-01",
    recommendationReason: "가장 대중적이고 흥미를 끄는 카피"
  };

  const planPath = join(jobDir, "planning/thumbnail-plan.json");
  const writeRes = await writeCanonicalJson(planPath, thumbnailPlan);
  const thumbnailPlanHash = writeRes.sha256;

  await registerArtifact(jobDir, {
    artifactId: "yadam-thumbnail-plan",
    logicalRole: "yadam.thumbnail.plan",
    path: "planning/thumbnail-plan.json",
    sha256: thumbnailPlanHash,
    schemaVersion: "1.0.0",
    producerStage: "thumbnail-planning",
    gateStatus: "pass",
    dependencyHashes: {}
  });

  return {
    status: "awaiting_thumbnail_copy_selection",
    artifact: {
      artifactId: "yadam-thumbnail-plan",
      relativePath: "planning/thumbnail-plan.json",
      sha256: thumbnailPlanHash
    },
    optionCount: 4,
    recommendedCopyId: "copy-01"
  };
}

export async function selectThumbnailCopy({ jobDir, copyId, selectedAt }) {
  const context = await loadJob(jobDir);
  const planRecord = context.manifest.artifacts.find(a => a.logicalRole === "yadam.thumbnail.plan");
  if (!planRecord) throw thumbnailError("thumbnail_plan_missing", "Thumbnail plan is missing");

  const plan = JSON.parse(await readFile(join(jobDir, planRecord.path), "utf8"));
  const copyOption = plan.options.find(o => o.copyId === copyId);
  if (!copyOption) throw thumbnailError("copy_not_found", `Copy ID ${copyId} not found in plan`);

  const selection = {
    schemaVersion: "1.0.0",
    selectionType: "provisional",
    copyId,
    selectedAt,
    thumbnailPlanHash: planRecord.sha256,
    layout: copyOption.layout,
    exactText: copyOption.copyText
  };

  const selectionPath = join(jobDir, "approvals/thumbnail-copy-selection.json");
  const writeRes = await writeCanonicalJson(selectionPath, selection);
  const selectionHash = writeRes.sha256;

  await registerArtifact(jobDir, {
    artifactId: "yadam-thumbnail-selection",
    logicalRole: "yadam.thumbnail.selection",
    path: "approvals/thumbnail-copy-selection.json",
    sha256: selectionHash,
    schemaVersion: "1.0.0",
    producerStage: "thumbnail-selection",
    gateStatus: "pass",
    dependencyHashes: {
      "thumbnailPlan": planRecord.sha256
    }
  });

  // Check if a prior formal approval 2 exists to invalidate
  const approval2Record = context.manifest.artifacts.find(a => a.logicalRole === "yadam.approval.2");
  let approvalTwoInvalidated = false;
  if (approval2Record) {
    const currentApproval2Path = join(jobDir, "approvals/current-approval-2.json");
    try {
      const current2Bytes = await readFile(currentApproval2Path, "utf8");
      const current2 = JSON.parse(current2Bytes);
      if (current2.status === "valid") {
        const invalidated2 = {
          schemaVersion: "1.0.0",
          status: "invalidated",
          revision: current2.revision,
          path: current2.path,
          sha256: current2.sha256,
          approvedArtifactSetHash: current2.approvedArtifactSetHash,
          invalidatedAt: selectedAt,
          reason: "thumbnail_selection_changed",
          observedDependencyHash: selectionHash
        };
        await writeCanonicalJson(currentApproval2Path, invalidated2);
        approvalTwoInvalidated = true;
      }
    } catch (e) {
      // ignore
    }
  }

  await transitionJob(jobDir, {
    stage: "THUMBNAIL_COPY_SELECTED",
    to: "running",
    inputHash: hashCanonical({
      thumbnailPlanHash: planRecord.sha256,
      copyId,
      selectedAt
    }),
    outputHash: selectionHash,
    artifactPaths: ["approvals/thumbnail-copy-selection.json"]
  });

  return {
    status: "selection_recorded",
    copyId,
    relativePath: "approvals/thumbnail-copy-selection.json",
    sha256: selectionHash,
    approvalTwoInvalidated
  };
}
