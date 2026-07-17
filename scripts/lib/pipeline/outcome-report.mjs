import { existsSync } from "node:fs";
import { readFile, mkdir } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { readJson, writeCanonicalJsonExclusive } from "./atomic-store.mjs";
import { hashCanonical, sha256Bytes } from "./canonical-json.mjs";
import { assertRealPathWithin } from "./path-policy.mjs";
import { registerArtifact } from "./artifact-store.mjs";
import { loadJob } from "./job-store.mjs";

const IDENTIFIER_PATTERN = /^[a-z0-9_-]+$/;

export async function writeOutcomeReport({
  jobDir,
  status,
  errorCode,
  stage,
  inputHash,
  occurredAt,
  error,
  upstreamReportPath
}) {
  const resolvedJobDir = resolve(jobDir);
  await assertRealPathWithin(resolvedJobDir, resolvedJobDir);

  // Validate status
  const validStatuses = ["needs_review", "failed", "cancel_requested", "cancelled"];
  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid outcome status: ${status}`);
  }

  // Validate errorCode and stage patterns
  if (typeof errorCode !== "string" || !IDENTIFIER_PATTERN.test(errorCode)) {
    throw new Error(`Invalid errorCode identifier pattern: ${errorCode}`);
  }
  if (typeof stage !== "string" || !IDENTIFIER_PATTERN.test(stage)) {
    throw new Error(`Invalid stage identifier pattern: ${stage}`);
  }

  // Size-bounded safe error projection
  const safeErrorProjection = {
    name: error ? String(error.name || "Error").slice(0, 128) : null,
    message: error ? String(error.message || "").slice(0, 1024) : null,
    code: error ? (typeof error.code === "string" ? error.code.slice(0, 128) : (typeof error.code === "number" ? String(error.code) : null)) : null
  };

  // Resolve upstream report
  let upstreamReport = null;
  if (upstreamReportPath) {
    const resolvedUpstream = resolve(resolvedJobDir, upstreamReportPath);
    await assertRealPathWithin(resolvedJobDir, resolvedUpstream);
    if (existsSync(resolvedUpstream)) {
      const upstreamBytes = await readFile(resolvedUpstream);
      upstreamReport = {
        path: relative(resolvedJobDir, resolvedUpstream).replaceAll("\\", "/"),
        sha256: sha256Bytes(upstreamBytes)
      };
    }
  }

  // Compute identity hash
  const reportIdentityHash = hashCanonical({
    stageInputHash: inputHash,
    status,
    errorCode,
    safeErrorProjection,
    upstreamReport
  });

  const shortIdentity = reportIdentityHash.slice(0, 12);
  const relativeReportPath = `reviews/outcomes/${status}-${errorCode}-${shortIdentity}.json`;
  const absoluteReportPath = resolve(resolvedJobDir, relativeReportPath);
  await assertRealPathWithin(resolvedJobDir, absoluteReportPath);

  const reportPayload = {
    schemaVersion: "1.0.0",
    status,
    errorCode,
    stage,
    inputHash,
    occurredAt: occurredAt || new Date().toISOString(),
    safeErrorProjection,
    upstreamReport,
    reportIdentityHash
  };

  let writeRes;
  let fileResExists = false;

  try {
    const outcomesDir = resolve(resolvedJobDir, "reviews/outcomes");
    await mkdir(outcomesDir, { recursive: true });
    await assertRealPathWithin(resolvedJobDir, outcomesDir);
    writeRes = await writeCanonicalJsonExclusive(absoluteReportPath, reportPayload);
  } catch (writeErr) {
    if (writeErr.code === "immutable_target_exists" || existsSync(absoluteReportPath)) {
      fileResExists = true;
    } else {
      throw writeErr;
    }
  }

  let finalReportHash;
  if (fileResExists) {
    const existing = await readJson(absoluteReportPath);
    const recomputedExistingIdentity = hashCanonical({
      stageInputHash: existing.inputHash,
      status: existing.status,
      errorCode: existing.errorCode,
      safeErrorProjection: existing.safeErrorProjection,
      upstreamReport: existing.upstreamReport
    });

    if (
      existing.schemaVersion !== "1.0.0" ||
      existing.status !== status ||
      existing.errorCode !== errorCode ||
      existing.stage !== stage ||
      existing.inputHash !== inputHash ||
      recomputedExistingIdentity !== reportIdentityHash ||
      JSON.stringify(existing.safeErrorProjection) !== JSON.stringify(safeErrorProjection) ||
      JSON.stringify(existing.upstreamReport) !== JSON.stringify(upstreamReport)
    ) {
      const conflictErr = new Error("Outcome report mismatch for existing identity file");
      conflictErr.code = "outcome_report_conflict";
      throw conflictErr;
    }
    const existingBytes = await readFile(absoluteReportPath);
    finalReportHash = sha256Bytes(existingBytes);
  } else {
    finalReportHash = writeRes.sha256;
  }

  // Register artifact
  const artifactId = `yadam-outcome-${reportIdentityHash}`;
  const dependencyHashes = {
    stageInput: inputHash
  };
  if (upstreamReport) {
    dependencyHashes.upstreamReport = upstreamReport.sha256;
  }

  const record = {
    artifactId,
    logicalRole: "yadam.outcome.report",
    path: relativeReportPath,
    sha256: finalReportHash,
    schemaVersion: "1.0.0",
    producerStage: "outcome_report",
    gateStatus: "fail",
    dependencyHashes
  };

  const jobBefore = await loadJob(resolvedJobDir);
  const existingRecord = jobBefore.manifest.artifacts?.find(a => a.artifactId === artifactId);

  if (existingRecord) {
    // Validate record matches completely
    if (
      existingRecord.logicalRole !== "yadam.outcome.report" ||
      existingRecord.path !== relativeReportPath ||
      existingRecord.sha256.toLowerCase() !== finalReportHash.toLowerCase() ||
      JSON.stringify(existingRecord.dependencyHashes) !== JSON.stringify(dependencyHashes)
    ) {
      const conflictErr = new Error("Outcome report registry record mismatch");
      conflictErr.code = "outcome_report_conflict";
      throw conflictErr;
    }
  } else {
    // Registry lookup for same artifactId but different path/hash/etc should fail
    const anotherWithSameId = jobBefore.manifest.artifacts?.filter(a => a.artifactId === artifactId);
    if (anotherWithSameId && anotherWithSameId.length > 0) {
      const conflictErr = new Error("Duplicate outcome report record with conflict");
      conflictErr.code = "outcome_report_conflict";
      throw conflictErr;
    }

    await registerArtifact(resolvedJobDir, record);
  }

  // Final cross-check re-read of file and registry together
  const jobAfter = await loadJob(resolvedJobDir);
  const finalRecord = jobAfter.manifest.artifacts?.find(a => a.artifactId === artifactId);
  if (!finalRecord) {
    throw new Error("Outcome report registration failed to persist");
  }

  const finalFileBytes = await readFile(absoluteReportPath);
  const finalFileHash = sha256Bytes(finalFileBytes);
  if (finalFileHash.toLowerCase() !== finalRecord.sha256.toLowerCase()) {
    const conflictErr = new Error("Outcome report registry hash mismatch with file on disk");
    conflictErr.code = "outcome_report_conflict";
    throw conflictErr;
  }

  return {
    reportPath: relativeReportPath,
    reportHash: finalReportHash,
    reportIdentityHash
  };
}
