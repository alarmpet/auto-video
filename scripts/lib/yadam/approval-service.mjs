// scripts/lib/yadam/approval-service.mjs
import { join, dirname, resolve } from "node:path";
import { readFile, open, unlink, mkdir } from "node:fs/promises";
import { loadJob } from "../pipeline/job-store.mjs";
import { writeCanonicalJson, writeCanonicalJsonExclusive } from "../pipeline/atomic-store.mjs";
import { registerArtifact } from "../pipeline/artifact-store.mjs";
import { transitionJob } from "../pipeline/state-machine.mjs";
import { sha256Bytes, hashCanonical, canonicalJson } from "../pipeline/canonical-json.mjs";
import { loadYadamReferences } from "./reference-store.mjs";
import { runYadamJsonStage } from "./codex-json-stage.mjs";

function approvalError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function hashArtifactSet(artifacts) {
  const sorted = artifacts
    .map(({ artifactId, sha256 }) => ({ artifactId, sha256 }))
    .toSorted((left, right) => left.artifactId.localeCompare(right.artifactId));
  if (new Set(sorted.map(({ artifactId }) => artifactId)).size !== sorted.length) {
    throw approvalError("approval_artifact_duplicate", "artifactId values must be unique");
  }
  if (sorted.some(({ sha256 }) => !/^[a-f0-9]{64}$/u.test(sha256))) {
    throw approvalError("approval_artifact_hash_invalid", "artifact sha256 must be lowercase hex");
  }
  return hashCanonical(sorted);
}

function checkIntroHardGates(payload, references) {
  const violations = [];
  if (!Array.isArray(payload.sentences) || payload.sentences.length !== 6) {
    violations.push(`Expected exactly 6 sentences, got ${payload.sentences?.length}`);
    return violations;
  }
  payload.sentences.forEach((s, idx) => {
    if (s.ordinal !== idx + 1) {
      violations.push(`Sentence ${idx + 1} ordinal is incorrect: ${s.ordinal}`);
    }
    if (idx === 5 && s.role !== "cta") {
      violations.push(`Sentence 6 role must be cta, got ${s.role}`);
    }
  });
  if (payload.characterCount < 200 || payload.characterCount > 350) {
    violations.push(`Character count ${payload.characterCount} must be 200..350`);
  }
  return violations;
}

function checkOutlineHardGates(payload, references) {
  const violations = [];
  if (!Array.isArray(payload.beats) || payload.beats.length !== 15) {
    violations.push(`Expected exactly 15 beats, got ${payload.beats?.length}`);
  }
  if (!Array.isArray(payload.twists) || payload.twists.length !== 6) {
    violations.push(`Expected exactly 6 twists, got ${payload.twists?.length}`);
  }
  if (!Array.isArray(payload.emotionPoints) || payload.emotionPoints.length !== 6) {
    violations.push(`Expected exactly 6 emotion points, got ${payload.emotionPoints?.length}`);
  }
  if (!Array.isArray(payload.themePlacements) || payload.themePlacements.length !== 3) {
    violations.push(`Expected exactly 3 theme placements, got ${payload.themePlacements?.length}`);
  }
  if (!Array.isArray(payload.finaleStages) || payload.finaleStages.length !== 5) {
    violations.push(`Expected exactly 5 finale stages, got ${payload.finaleStages?.length}`);
  }
  
  // Check plant and recovery foreshadowing
  if (!Array.isArray(payload.foreshadowing) || payload.foreshadowing.length < 1) {
    violations.push("At least one foreshadowing plant/recovery pair is required");
  } else {
    payload.foreshadowing.forEach((f, idx) => {
      if (!f.plantBeatId || !f.recoveryBeatId) {
        violations.push(`Foreshadowing ${idx + 1} is missing plant or recovery beat ID`);
      }
    });
  }

  // Check ending strings
  if (!Array.isArray(payload.fixedEnding) || JSON.stringify(payload.fixedEnding) !== JSON.stringify(references.beats.fixedEnding)) {
    violations.push("Fixed ending sentences do not match references exactly");
  }

  return violations;
}

export async function buildApprovalOneBundle({ jobDir }) {
  const context = await loadJob(jobDir);
  const workspaceRoot = dirname(dirname(resolve(jobDir)));

  // Load selection and options
  const selectionRecord = context.manifest.artifacts.find(a => a.logicalRole === "yadam.concept.selection");
  if (!selectionRecord) throw approvalError("concept_selection_missing", "Concept selection is missing");

  const optionsRecord = context.manifest.artifacts.find(a => a.logicalRole === "yadam.concept.options");
  if (!optionsRecord) throw approvalError("concept_options_missing", "Concept options are missing");

  const selection = JSON.parse(await readFile(join(jobDir, selectionRecord.path), "utf8"));
  const options = JSON.parse(await readFile(join(jobDir, optionsRecord.path), "utf8"));
  const references = await loadYadamReferences({ rootDir: workspaceRoot });

  const selectedCandidate = options.options.find(o => o.candidateId === selection.candidateId);

  // Generate Intro
  const introPromptPath = join(workspaceRoot, "prompts/yadam/story-intro.md");
  const introSchemaPath = join(workspaceRoot, "schemas/yadam/hook-brief.schema.json");

  let introResult;
  let introAttempt = 1;
  let introViolations = [];
  let introRejectedHash = "0000000000000000000000000000000000000000000000000000000000000000";

  const introStageInput = {
    selectedCandidate,
    userInstructions: selection.userInstructions
  };

  try {
    introResult = await runYadamJsonStage({
      jobDir,
      stageId: "yadam.story.intro.v1",
      promptPath: introPromptPath,
      schemaPath: introSchemaPath,
      input: introStageInput,
      timeoutMs: 480000
    });
    introViolations = checkIntroHardGates(introResult.payload, references);
    if (introViolations.length > 0) {
      const err = new Error("Intro hard gate failed");
      err.code = "intro_hard_gate_failed";
      err.details = introViolations;
      err.payload = introResult.payload;
      throw err;
    }
  } catch (err) {
    introAttempt = 2;
    introRejectedHash = err.payload ? hashCanonical(err.payload) : "0000000000000000000000000000000000000000000000000000000000000000";
    introViolations = err.details || [err.message];
  }

  if (introAttempt === 2) {
    introResult = await runYadamJsonStage({
      jobDir,
      stageId: "yadam.story.intro.v1.repair-1",
      promptPath: introPromptPath,
      schemaPath: introSchemaPath,
      input: {
        ...introStageInput,
        violations: introViolations.sort(),
        rejectedOutputHash: introRejectedHash
      },
      timeoutMs: 480000
    });
    const repViolations = checkIntroHardGates(introResult.payload, references);
    if (repViolations.length > 0) {
      throw approvalError("intro_hard_gate_failed", `Intro repair failed: ${repViolations.join(", ")}`);
    }
  }

  const hookBriefPath = join(jobDir, "planning/hook-brief.json");
  const hookWrite = await writeCanonicalJson(hookBriefPath, introResult.payload);
  const hookBriefHash = hookWrite.sha256;

  await registerArtifact(jobDir, {
    artifactId: "yadam-hook-brief",
    logicalRole: "yadam.hook.brief",
    path: "planning/hook-brief.json",
    sha256: hookBriefHash,
    schemaVersion: "1.0.0",
    producerStage: "story-intro",
    gateStatus: "pass",
    dependencyHashes: {
      "conceptSelection": selectionRecord.sha256
    }
  });

  // Generate Outline
  const outlinePromptPath = join(workspaceRoot, "prompts/yadam/outline.md");
  const outlineSchemaPath = join(workspaceRoot, "schemas/yadam/outline.schema.json");

  let outlineResult;
  let outlineAttempt = 1;
  let outlineViolations = [];
  let outlineRejectedHash = "0000000000000000000000000000000000000000000000000000000000000000";

  const outlineStageInput = {
    selectedCandidate,
    userInstructions: selection.userInstructions,
    hookBriefHash,
    fixedEnding: references.beats.fixedEnding
  };

  try {
    outlineResult = await runYadamJsonStage({
      jobDir,
      stageId: "yadam.outline.v1",
      promptPath: outlinePromptPath,
      schemaPath: outlineSchemaPath,
      input: outlineStageInput,
      timeoutMs: 480000
    });
    outlineViolations = checkOutlineHardGates(outlineResult.payload, references);
    if (outlineViolations.length > 0) {
      const err = new Error("Outline hard gate failed");
      err.code = "outline_hard_gate_failed";
      err.details = outlineViolations;
      err.payload = outlineResult.payload;
      throw err;
    }
  } catch (err) {
    outlineAttempt = 2;
    outlineRejectedHash = err.payload ? hashCanonical(err.payload) : "0000000000000000000000000000000000000000000000000000000000000000";
    outlineViolations = err.details || [err.message];
  }

  if (outlineAttempt === 2) {
    outlineResult = await runYadamJsonStage({
      jobDir,
      stageId: "yadam.outline.v1.repair-1",
      promptPath: outlinePromptPath,
      schemaPath: outlineSchemaPath,
      input: {
        ...outlineStageInput,
        violations: outlineViolations.sort(),
        rejectedOutputHash: outlineRejectedHash
      },
      timeoutMs: 480000
    });
    const repViolations = checkOutlineHardGates(outlineResult.payload, references);
    if (repViolations.length > 0) {
      throw approvalError("outline_hard_gate_failed", `Outline repair failed: ${repViolations.join(", ")}`);
    }
  }

  const outlinePath = join(jobDir, "planning/outline.json");
  const outlineWrite = await writeCanonicalJson(outlinePath, outlineResult.payload);
  const outlineHash = outlineWrite.sha256;

  await registerArtifact(jobDir, {
    artifactId: "yadam-outline",
    logicalRole: "yadam.outline",
    path: "planning/outline.json",
    sha256: outlineHash,
    schemaVersion: "1.0.0",
    producerStage: "outline-generation",
    gateStatus: "pass",
    dependencyHashes: {
      "hookBrief": hookBriefHash
    }
  });

  // Build bundle
  const conceptInputsRecord = context.manifest.artifacts.find(a => a.logicalRole === "yadam.concept.inputs");
  const artifactList = [
    { artifactId: "yadam-concept-options", sha256: optionsRecord.sha256 },
    { artifactId: "yadam-concept-selection", sha256: selectionRecord.sha256 },
    { artifactId: "yadam-hook-brief", sha256: hookBriefHash },
    { artifactId: "yadam-outline", sha256: outlineHash }
  ];

  const approvedArtifactSetHash = hashArtifactSet(artifactList);

  const bundle = {
    schemaVersion: "1.0.0",
    documentType: "approval_1_bundle",
    approvedArtifactSetHash,
    artifacts: artifactList,
    selectedCandidate
  };

  const bundlePath = join(jobDir, "approvals/approval-1-bundle.json");
  await writeCanonicalJson(bundlePath, bundle);

  await registerArtifact(jobDir, {
    artifactId: "yadam-approval-1-bundle",
    logicalRole: "yadam.approval.1.bundle",
    path: "approvals/approval-1-bundle.json",
    sha256: sha256Bytes(Buffer.from(canonicalJson(bundle), "utf8")),
    schemaVersion: "1.0.0",
    producerStage: "approval-1-generation",
    gateStatus: "pass",
    dependencyHashes: {
      "conceptOptions": optionsRecord.sha256,
      "conceptSelection": selectionRecord.sha256,
      "hookBrief": hookBriefHash,
      "outline": outlineHash
    }
  });

  await transitionJob(jobDir, {
    stage: "APPROVAL_ONE_BUNDLE_READY",
    to: "awaiting_approval",
    inputHash: hashCanonical({
      stage: "approval_1_bundle",
      conceptInputsHash: conceptInputsRecord.sha256,
      conceptOptionsHash: optionsRecord.sha256,
      conceptSelectionHash: selectionRecord.sha256,
      introPromptHash: sha256Bytes(await readFile(introPromptPath)),
      introSchemaHash: sha256Bytes(await readFile(introSchemaPath)),
      outlinePromptHash: sha256Bytes(await readFile(outlinePromptPath)),
      outlineSchemaHash: sha256Bytes(await readFile(outlineSchemaPath)),
      profileHash: context.state.profileHash || "0000000000000000000000000000000000000000000000000000000000000000",
      codexExecutionPinHash: outlineResult.provenance ? sha256Bytes(Buffer.from(canonicalJson({
        executableVersion: outlineResult.provenance.executableVersion,
        model: outlineResult.provenance.model,
        reasoningEffort: outlineResult.provenance.reasoningEffort,
        profileHash: outlineResult.provenance.profileHash,
        instructionSourceHashes: outlineResult.provenance.instructionSourceHashes
      }), "utf8")) : "0000000000000000000000000000000000000000000000000000000000000000"
    }),
    outputHash: approvedArtifactSetHash,
    artifactPaths: ["approvals/approval-1-bundle.json", "planning/hook-brief.json", "planning/outline.json"].sort()
  });

  return {
    status: "awaiting_approval_1",
    bundlePath: "approvals/approval-1-bundle.json",
    approvedArtifactSetHash
  };
}

export async function approveConcept({ jobDir, expectedArtifactSetHash, approvedAt, userInstructions }) {
  const context = await loadJob(jobDir);
  const bundleRecord = context.manifest.artifacts.find(a => a.logicalRole === "yadam.approval.1.bundle");
  if (!bundleRecord) throw approvalError("approval_bundle_stale", "Approval bundle record is missing");

  const bundleBytes = await readFile(join(jobDir, bundleRecord.path));
  if (sha256Bytes(bundleBytes) !== bundleRecord.sha256) {
    throw approvalError("approval_bundle_stale", "Approval bundle bytes mismatch registered record");
  }

  const parsedBundle = JSON.parse(bundleBytes.toString("utf8"));
  if (parsedBundle.approvedArtifactSetHash !== expectedArtifactSetHash) {
    throw approvalError("approval_bundle_stale", "Displayed artifact set hash does not match bundle");
  }

  // Load pointer to determine revision
  let revision = 1;
  const pointerPath = join(jobDir, "approvals/current-approval-1.json");
  let supersededPath = null;
  try {
    const currentBytes = await readFile(pointerPath, "utf8");
    const current = JSON.parse(currentBytes);
    revision = current.revision + 1;
    supersededPath = current.path;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  const revisionFilename = `approvals/approval-1-r${String(revision).padStart(3, "0")}.json`;
  const revisionPath = join(jobDir, revisionFilename);

  const approvalObj = {
    schemaVersion: "1.0.0",
    approvalType: "approval_1",
    revision,
    supersedes: supersededPath ? supersededPath.replace(/\\/g, "/") : null,
    approvedAt,
    userInstructions: userInstructions.normalize("NFC"),
    artifacts: parsedBundle.artifacts,
    approvedArtifactSetHash: expectedArtifactSetHash,
    status: "approved"
  };

  let writeResult;
  try {
    writeResult = await writeCanonicalJsonExclusive(revisionPath, approvalObj);
  } catch (err) {
    if (err.code === "immutable_target_exists") {
      throw approvalError("approval_bundle_stale", "Approval revision already exists");
    }
    throw err;
  }

  const revisionFileSha = writeResult.sha256;

  // Update pointer file
  const pointerObj = {
    schemaVersion: "1.0.0",
    status: "valid",
    revision,
    path: revisionFilename,
    sha256: revisionFileSha,
    approvedArtifactSetHash: expectedArtifactSetHash
  };
  await writeCanonicalJson(pointerPath, pointerObj);

  // Register pointer
  const depHashes = {};
  parsedBundle.artifacts.forEach(art => {
    depHashes[art.artifactId] = art.sha256;
  });

  await registerArtifact(jobDir, {
    artifactId: "yadam-approval-1-current",
    logicalRole: "yadam.approval.1",
    path: revisionFilename,
    sha256: revisionFileSha,
    schemaVersion: "1.0.0",
    producerStage: "approval-1",
    gateStatus: "pass",
    dependencyHashes: depHashes
  });

  await transitionJob(jobDir, {
    stage: "APPROVAL_ONE_GRANTED",
    to: "running",
    inputHash: expectedArtifactSetHash,
    outputHash: revisionFileSha,
    artifactPaths: [revisionFilename, "approvals/current-approval-1.json"].sort()
  });

  return {
    status: "approved",
    revision,
    approvalRevisionPath: revisionFilename,
    approvedArtifactSetHash: expectedArtifactSetHash
  };
}

export async function buildApprovalTwoBundle({ jobDir, previewArtifacts }) {
  const context = await loadJob(jobDir);
  // Approval 2 bundle requirements check
  const requiredLogicalRoles = [
    "yadam.script.final_text",
    "yadam.script.scenes",
    "yadam.scene.plan",
    "yadam.story.bible",
    "yadam.script.qa",
    "yadam.coverage.script",
    "yadam.thumbnail.plan",
    "yadam.thumbnail.selection"
  ];

  const artifactList = [];
  for (const role of requiredLogicalRoles) {
    const record = context.manifest.artifacts.find(a => a.logicalRole === role);
    if (!record) {
      throw approvalError("approval_two_artifact_missing", `Required artifact for role ${role} is missing`);
    }
    if (record.gateStatus !== "pass") {
      throw approvalError("approval_two_artifact_not_passed", `Required artifact for role ${role} has gateStatus ${record.gateStatus}`);
    }
    artifactList.push({
      artifactId: record.artifactId,
      logicalRole: record.logicalRole,
      path: record.path,
      sha256: record.sha256,
      schemaVersion: record.schemaVersion || "1.0.0",
      dependencyHashes: record.dependencyHashes || {}
    });
  }

  // Verify previewArtifacts shape and entries
  const previewKeys = ["thumbnailPreview", "thumbnailGuide", "characterReferenceSet", "representativePreviews", "styleProfile"];
  for (const k of previewKeys) {
    if (!previewArtifacts[k]) {
      throw approvalError("approval_two_preview_missing", `Preview artifact key ${k} is missing`);
    }
  }

  const flatPreviews = [
    previewArtifacts.thumbnailPreview,
    previewArtifacts.thumbnailGuide,
    previewArtifacts.characterReferenceSet,
    ...previewArtifacts.representativePreviews,
    previewArtifacts.styleProfile
  ];

  flatPreviews.forEach(item => {
    if (!item.artifactId || !item.relativePath || !item.sha256) {
      throw approvalError("approval_two_preview_invalid", "Preview artifact properties must include artifactId, relativePath, sha256");
    }
    artifactList.push({
      artifactId: item.artifactId,
      logicalRole: "preview",
      path: item.relativePath,
      sha256: item.sha256,
      schemaVersion: "1.0.0",
      dependencyHashes: {}
    });
  });

  const approvedArtifactSetHash = hashArtifactSet(artifactList);

  // Load pointer to determine candidateRevision
  let lastFormalApprovalRevision = 0;
  const pointerPath = join(jobDir, "approvals/current-approval-2.json");
  try {
    const currentBytes = await readFile(pointerPath, "utf8");
    const current = JSON.parse(currentBytes);
    lastFormalApprovalRevision = current.revision;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  const candidateApprovalRevision = lastFormalApprovalRevision + 1;

  const bundle = {
    schemaVersion: "1.0.0",
    documentType: "approval_2_bundle",
    approvedArtifactSetHash,
    artifacts: artifactList,
    candidateApprovalRevision
  };

  const bundlePath = join(jobDir, "approvals/approval-2-bundle.json");
  await writeCanonicalJson(bundlePath, bundle);

  await registerArtifact(jobDir, {
    artifactId: "yadam-approval-2-bundle",
    logicalRole: "yadam.approval.2.bundle",
    path: "approvals/approval-2-bundle.json",
    sha256: sha256Bytes(Buffer.from(canonicalJson(bundle), "utf8")),
    schemaVersion: "1.0.0",
    producerStage: "approval-2-generation",
    gateStatus: "pass",
    dependencyHashes: artifactList.reduce((acc, art) => {
      acc[art.artifactId] = art.sha256;
      return acc;
    }, {})
  });

  await transitionJob(jobDir, {
    stage: "APPROVAL_TWO_BUNDLE_READY",
    to: "awaiting_approval",
    inputHash: hashCanonical({
      stage: "approval_2_bundle",
      approvedArtifactSetHash,
      approvalSchemaHash: "0000000000000000000000000000000000000000000000000000000000000000" // We can use placeholder or load real schema hash
    }),
    outputHash: approvedArtifactSetHash,
    artifactPaths: ["approvals/approval-2-bundle.json"]
  });

  return {
    status: "awaiting_approval_2",
    bundlePath: "approvals/approval-2-bundle.json",
    approvedArtifactSetHash
  };
}

export async function approveProduction({ jobDir, expectedArtifactSetHash, approvedAt, userInstructions }) {
  const context = await loadJob(jobDir);
  const bundleRecord = context.manifest.artifacts.find(a => a.logicalRole === "yadam.approval.2.bundle");
  if (!bundleRecord) throw approvalError("approval_bundle_stale", "Approval 2 bundle record is missing");

  const bundleBytes = await readFile(join(jobDir, bundleRecord.path));
  if (sha256Bytes(bundleBytes) !== bundleRecord.sha256) {
    throw approvalError("approval_bundle_stale", "Approval 2 bundle bytes mismatch registered record");
  }

  const parsedBundle = JSON.parse(bundleBytes.toString("utf8"));
  if (parsedBundle.approvedArtifactSetHash !== expectedArtifactSetHash) {
    throw approvalError("approval_bundle_stale", "Displayed artifact set hash does not match bundle");
  }

  let lastFormalApprovalRevision = 0;
  const pointerPath = join(jobDir, "approvals/current-approval-2.json");
  let supersededPath = null;
  try {
    const currentBytes = await readFile(pointerPath, "utf8");
    const current = JSON.parse(currentBytes);
    lastFormalApprovalRevision = current.revision;
    supersededPath = current.path;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  const revision = lastFormalApprovalRevision + 1;
  const revisionFilename = `approvals/approval-2-r${String(revision).padStart(3, "0")}.json`;
  const revisionPath = join(jobDir, revisionFilename);

  const approvalObj = {
    schemaVersion: "1.0.0",
    approvalType: "approval_2",
    revision,
    supersedes: supersededPath ? supersededPath.replace(/\\/g, "/") : null,
    approvedAt,
    userInstructions: userInstructions.normalize("NFC"),
    artifacts: parsedBundle.artifacts,
    approvedArtifactSetHash: expectedArtifactSetHash,
    status: "approved",
    referencePromotion: {
      from: "provisional",
      setHash: expectedArtifactSetHash,
      to: "approved"
    }
  };

  let writeResult;
  try {
    writeResult = await writeCanonicalJsonExclusive(revisionPath, approvalObj);
  } catch (err) {
    if (err.code === "immutable_target_exists") {
      throw approvalError("approval_bundle_stale", "Approval revision already exists");
    }
    throw err;
  }

  const revisionFileSha = writeResult.sha256;

  // Update pointer
  const pointerObj = {
    schemaVersion: "1.0.0",
    status: "valid",
    revision,
    path: revisionFilename,
    sha256: revisionFileSha,
    approvedArtifactSetHash: expectedArtifactSetHash
  };
  await writeCanonicalJson(pointerPath, pointerObj);

  const depHashes = {};
  parsedBundle.artifacts.forEach(art => {
    depHashes[art.artifactId] = art.sha256;
  });

  await registerArtifact(jobDir, {
    artifactId: "yadam-approval-2-current",
    logicalRole: "yadam.approval.2",
    path: revisionFilename,
    sha256: revisionFileSha,
    schemaVersion: "1.0.0",
    producerStage: "approval-2",
    gateStatus: "pass",
    dependencyHashes: depHashes
  });

  await transitionJob(jobDir, {
    stage: "APPROVAL_TWO_GRANTED",
    to: "running",
    inputHash: expectedArtifactSetHash,
    outputHash: revisionFileSha,
    artifactPaths: [revisionFilename, "approvals/current-approval-2.json"].sort()
  });

  return {
    status: "approved",
    revision,
    approvalRevisionPath: revisionFilename,
    approvedArtifactSetHash: expectedArtifactSetHash
  };
}
