import { promises as fsPromises, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { hashCanonical, writeCanonicalJsonExclusive, readJson } from "../pipeline/atomic-store.mjs";
import { registerArtifact } from "../pipeline/artifact-store.mjs";
import { validateSchema } from "../pipeline/schema-registry.mjs";
import { assertPathWithin } from "../pipeline/path-policy.mjs";

export async function publishAudioNeedsReview({
  jobDir,
  errorCode,
  createdAt,
  measuredAudioSeconds,
  acceptedRangeSeconds,
  repairAttempt,
  providerOrphan,
  evidence
}) {
  // Normalize evidence paths
  const normalizedEvidence = evidence.map(ev => ({
    artifactId: ev.artifactId,
    path: ev.path.replaceAll("\\", "/"),
    sha256: ev.sha256
  }));

  // Sort evidence by artifactId then path
  normalizedEvidence.sort((a, b) => {
    if (a.artifactId !== b.artifactId) {
      return a.artifactId < b.artifactId ? -1 : 1;
    }
    return a.path < b.path ? -1 : 1;
  });

  // Unique artifact IDs check
  const seenIds = new Set();
  for (const ev of normalizedEvidence) {
    if (seenIds.has(ev.artifactId)) {
      throw new Error(`Duplicate artifact ID in needs-review evidence: ${ev.artifactId}`);
    }
    seenIds.add(ev.artifactId);
  }

  // Derive dependency hashes
  const dependencyHashes = Object.fromEntries(
    normalizedEvidence.map(ev => [ev.artifactId, ev.sha256])
  );

  // Read jobId from state
  const statePath = join(jobDir, "pipeline-state.json");
  const state = JSON.parse(await fsPromises.readFile(statePath, "utf8"));
  const jobId = state.jobId;

  // Compute inputHash
  const inputHash = hashCanonical({
    reportType: "yadam_audio_needs_review",
    jobId,
    errorCode,
    measuredAudioSeconds,
    acceptedRangeSeconds,
    repairAttempt,
    providerOrphan,
    evidence: normalizedEvidence,
    dependencyHashes
  });

  const prefix12 = inputHash.slice(0, 12);
  const relativeReviewPath = `assets/audio/reviews/${errorCode}-${prefix12}.json`;
  const absoluteReviewPath = resolve(jobDir, relativeReviewPath);

  // Enforce containment
  assertPathWithin(jobDir, absoluteReviewPath);

  // Check parent
  const reviewsDir = join(jobDir, "assets/audio/reviews");
  if (existsSync(reviewsDir)) {
    const stats = await fsPromises.lstat(reviewsDir);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error("Invalid reviews directory");
    }
  } else {
    await fsPromises.mkdir(reviewsDir, { recursive: true });
  }

  let finalReport;
  let isNew = true;

  if (existsSync(absoluteReviewPath)) {
    const existing = await readJson(absoluteReviewPath);
    // Validate schema & matches
    const schemaPath = join(jobDir, "schemas/yadam/audio-needs-review.schema.json");
    await validateSchema(schemaPath, existing);

    if (
      existing.errorCode === errorCode &&
      existing.measuredAudioSeconds === measuredAudioSeconds &&
      existing.inputHash === inputHash
    ) {
      finalReport = existing;
      isNew = false;
    } else {
      throw new Error("Needs-review report file exists but contents do not match");
    }
  }

  if (isNew) {
    finalReport = {
      schemaVersion: "1.0.0",
      reportType: "yadam_audio_needs_review",
      jobId,
      status: "needs_review",
      errorCode,
      createdAt,
      inputHash,
      measuredAudioSeconds,
      acceptedRangeSeconds,
      repairAttempt,
      providerOrphan,
      evidence: normalizedEvidence,
      dependencyHashes
    };

    const schemaPath = join(jobDir, "schemas/yadam/audio-needs-review.schema.json");
    await validateSchema(schemaPath, finalReport);

    await writeCanonicalJsonExclusive(absoluteReviewPath, finalReport);
  }

  // Register
  const artifactRecord = await registerArtifact(jobDir, {
    artifactId: `yadam-audio-needs-review-${prefix12}`,
    logicalRole: "yadam.audio.needs_review",
    path: relativeReviewPath,
    sha256: inputHash,
    schemaVersion: "1.0.0",
    producerStage: "audio-generation",
    gateStatus: "pass",
    dependencyHashes
  });

  return {
    errorCode,
    reportPath: relativeReviewPath,
    reportHash: inputHash
  };
}
