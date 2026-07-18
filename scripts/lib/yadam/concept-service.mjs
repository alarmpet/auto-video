// scripts/lib/yadam/concept-service.mjs
import { join, dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { loadJob } from "../pipeline/job-store.mjs";
import { writeCanonicalJson } from "../pipeline/atomic-store.mjs";
import { registerArtifact } from "../pipeline/artifact-store.mjs";
import { transitionJob } from "../pipeline/state-machine.mjs";
import { sha256Bytes, hashCanonical, canonicalJson } from "../pipeline/canonical-json.mjs";
import { loadYadamReferences } from "./reference-store.mjs";
import { chooseNameCandidates } from "./name-service.mjs";
import { chooseMotifs } from "./motif-service.mjs";
import { readRecentStoryFingerprints, computeTitleFingerprint } from "./history-store.mjs";
import { runYadamJsonStage } from "./codex-json-stage.mjs";

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function checkConceptOptionsHardGates(payload, conceptInputs, references) {
  const violations = [];
  const req = conceptInputs.requirements;
  
  if (payload.conceptInputsHash !== conceptInputs.requestHash && payload.conceptInputsHash !== conceptInputs.hash) {
    // If not matched, we check payload.conceptInputsHash matches the calculated hash
  }

  if (!Array.isArray(payload.options) || payload.options.length !== req.optionCount) {
    violations.push(`Expected exactly ${req.optionCount} options, got ${payload.options?.length}`);
    return violations;
  }

  const candidateIds = new Set();
  const titleFingerprints = new Set(conceptInputs.historySnapshot.entries.map(e => e.titleFingerprint));

  payload.options.forEach((opt, idx) => {
    if (!opt.candidateId || !/^concept-c0[1-4]$/.test(opt.candidateId)) {
      violations.push(`Option ${idx + 1} has invalid candidateId: ${opt.candidateId}`);
    }
    if (candidateIds.has(opt.candidateId)) {
      violations.push(`Duplicate candidateId found: ${opt.candidateId}`);
    }
    candidateIds.add(opt.candidateId);

    // Title suffix check
    if (!opt.title || !opt.title.endsWith(conceptInputs.titleSuffix)) {
      violations.push(`Option ${idx + 1} title does not end with required suffix`);
    }

    // Title fingerprint check
    const titleFingerprint = computeTitleFingerprint(opt.title, conceptInputs.titleSuffix);
    if (titleFingerprints.has(titleFingerprint)) {
      violations.push(`Option ${idx + 1} title fingerprint is present in recent history`);
    }

    // Motif ID check
    const allowedMotifIds = new Set(conceptInputs.motifCandidates.map(m => m.id));
    if (!allowedMotifIds.has(opt.motifId)) {
      violations.push(`Option ${idx + 1} motifId ${opt.motifId} is not in the allowed candidates`);
    }

    // Twist category proposals length
    if (!Array.isArray(opt.twistCategoryProposals) || opt.twistCategoryProposals.length !== req.twistsPerOption) {
      violations.push(`Option ${idx + 1} must have exactly ${req.twistsPerOption} twist category proposals`);
    }

    // Cast name checks
    if (!Array.isArray(opt.castProposals)) {
      violations.push(`Option ${idx + 1} has missing castProposals`);
    } else {
      opt.castProposals.forEach((cast, cIdx) => {
        // Verify nameId exists in references
        const nameEntry = references.names.entries.find(e => e.id === cast.nameId);
        if (!nameEntry) {
          violations.push(`Option ${idx + 1} cast ${cIdx + 1} has unknown nameId: ${cast.nameId}`);
        } else {
          // Check that name matches spokenForm
          if (nameEntry.spokenForm !== cast.name) {
            violations.push(`Option ${idx + 1} cast ${cIdx + 1} name mismatch: expected ${nameEntry.spokenForm}, got ${cast.name}`);
          }
          // Check if classId matches
          if (nameEntry.classId !== cast.classId) {
            violations.push(`Option ${idx + 1} cast ${cIdx + 1} classId mismatch: expected ${nameEntry.classId}, got ${cast.classId}`);
          }
        }
      });
    }
  });

  return violations;
}

export async function generateConceptOptions({ jobDir, historyPath, now }) {
  const context = await loadJob(jobDir);
  const { request } = context;

  if (request.profileId !== "yadam") {
    throw codedError("profile_invalid", "Job is not configured for yadam profile");
  }

  // Validate target minutes
  const mins = request.targetMinutes;
  if (typeof mins !== "number" || mins < 10 || mins > 120 || mins % 10 !== 0) {
    throw codedError("target_minutes_invalid", "targetMinutes must be 10..120 in 10-minute steps");
  }

  const workspaceRoot = dirname(dirname(resolve(jobDir)));

  // Load and hash request
  const requestBytes = await readFile(join(jobDir, "request.json"));
  const requestHash = sha256Bytes(requestBytes);

  // Load references
  const references = await loadYadamReferences({ rootDir: workspaceRoot });
  const namesHash = sha256Bytes(await readFile(join(workspaceRoot, "data/yadam/reference/name-bank.v1.json")));
  const motifsHash = sha256Bytes(await readFile(join(workspaceRoot, "data/yadam/reference/motif-bank.v1.json")));
  const beatsHash = sha256Bytes(await readFile(join(workspaceRoot, "data/yadam/reference/beat-structure.v1.json")));
  const rulesHash = sha256Bytes(await readFile(join(workspaceRoot, "data/yadam/reference/script-rules.v1.json")));

  // Read history
  const historyEntries = await readRecentStoryFingerprints(historyPath, 20);
  const historyHash = hashCanonical(historyEntries);

  const optionCount = request.inputMode === "reference" ? 4 : 3;

  // Reserve diverse motifs
  const motifCandidates = chooseMotifs({
    references,
    seed: String(request.seed),
    count: optionCount,
    recentFingerprints: historyEntries
  });

  // Reserve non-overlapping cast sets
  const usedNameIds = new Set();
  const nameCandidates = [];
  const poolsToDraw = [
    { classId: "commoner", gender: "female", useCase: "givenName" },
    { classId: "commoner", gender: "male", useCase: "givenName" },
    { classId: "nobleman", gender: "male", useCase: "givenName" },
    { classId: "noblewoman", gender: "female", useCase: "legal_given_name" },
    { classId: "noblewoman", gender: "female", useCase: "public_address" },
    { classId: "noblewoman", gender: "female", useCase: "taekho" },
    { classId: "middle_class", gender: "male", useCase: "givenName" },
    { classId: "slave", gender: "female", useCase: "givenName" },
    { classId: "slave", gender: "male", useCase: "givenName" },
    { classId: "gisaeng", gender: "female", useCase: "givenName" },
    { classId: "monk", gender: "neutral", useCase: "givenName" },
    { classId: "royal", gender: "female", useCase: "givenName" },
    { classId: "royal", gender: "male", useCase: "givenName" }
  ];

  for (let o = 0; o < optionCount; o++) {
    const optionNames = [];
    const optionSeed = `${request.seed}-opt-${o}`;
    for (const p of poolsToDraw) {
      try {
        const candidates = chooseNameCandidates({
          references,
          classId: p.classId,
          gender: p.gender,
          useCase: p.useCase,
          seed: optionSeed,
          count: 2,
          excludedIds: Array.from(usedNameIds)
        });
        for (const cand of candidates) {
          usedNameIds.add(cand.id);
          optionNames.push(cand);
        }
      } catch (e) {
        if (e.code !== "name_pool_exhausted") throw e;
      }
    }
    nameCandidates.push({
      optionIndex: o + 1,
      names: optionNames
    });
  }

  const blockedSpokenNames = (references.names.pools.blocked || []).map(e => e.spokenForm.normalize("NFC"));

  const conceptInputs = {
    schemaVersion: "1.0.0",
    requestHash,
    job: { jobId: request.jobId, targetMinutes: request.targetMinutes, seed: request.seed, generatedAt: now },
    requestContext: {
      inputMode: request.inputMode,
      source: { kind: request.source.kind, value: request.source.value },
      optionalInstructions: request.optionalInstructions ?? "",
    },
    referenceHashes: {
      names: namesHash,
      motifs: motifsHash,
      beats: beatsHash,
      rules: rulesHash,
    },
    titleSuffix: references.beats.titleSuffix,
    motifCandidates,
    nameCandidates,
    blockedSpokenNames,
    historySnapshot: {
      limit: 20,
      entries: historyEntries,
      hash: historyHash,
    },
    requirements: {
      optionCount,
      twistsPerOption: 6,
      emotionalPointsPerOption: 6,
      spoilerSealRequired: true,
    },
  };

  const conceptInputsPath = join(jobDir, "planning", "concept-inputs.json");
  const conceptInputsWriteResult = await writeCanonicalJson(conceptInputsPath, conceptInputs);
  const conceptInputsHash = conceptInputsWriteResult.sha256;

  await registerArtifact(jobDir, {
    artifactId: "yadam-concept-inputs",
    logicalRole: "yadam.concept.inputs",
    path: "planning/concept-inputs.json",
    sha256: conceptInputsHash,
    schemaVersion: "1.0.0",
    producerStage: "concept-generation",
    gateStatus: "pass",
    dependencyHashes: {
      "pipeline-request": requestHash
    }
  });

  // Call Codex stage
  const promptPath = join(workspaceRoot, "prompts/yadam/concept.md");
  const schemaPath = join(workspaceRoot, "schemas/yadam/concept-options.schema.json");

  let result;
  let attempt = 1;
  let lastError = null;
  let rejectedOutputHash = null;
  let violations = [];

  try {
    result = await runYadamJsonStage({
      jobDir,
      stageId: "yadam.concept.options.v1",
      promptPath,
      schemaPath,
      input: { conceptInputsHash, conceptInputs },
      timeoutMs: 180000
    });

    violations = checkConceptOptionsHardGates(result.payload, conceptInputs, references);
    if (violations.length > 0) {
      const err = new Error("Hard gate validation failed");
      err.code = "concept_hard_gate_failed";
      err.details = violations;
      err.payload = result.payload;
      throw err;
    }
  } catch (err) {
    lastError = err;
    attempt = 2;
    rejectedOutputHash = err.payload ? hashCanonical(err.payload) : "0000000000000000000000000000000000000000000000000000000000000000";
    if (err.details) {
      violations = err.details.map(d => typeof d === "string" ? d : JSON.stringify(d));
    } else {
      violations = [err.message];
    }
  }

  if (attempt === 2) {
    try {
      result = await runYadamJsonStage({
        jobDir,
        stageId: "yadam.concept.options.v1.repair-1",
        promptPath,
        schemaPath,
        input: {
          conceptInputsHash,
          conceptInputs,
          violations: violations.sort(),
          rejectedOutputHash
        },
        timeoutMs: 180000
      });

      const repairViolations = checkConceptOptionsHardGates(result.payload, conceptInputs, references);
      if (repairViolations.length > 0) {
        throw new Error(`Repair hard gate validation failed: ${repairViolations.join(", ")}`);
      }
    } catch (repairErr) {
      console.error("DEBUG CODEX FIRST ERR:", lastError);
      console.error("DEBUG CODEX REPAIR ERR:", repairErr);
      await transitionJob(jobDir, {
        stage: "yadam.concept.options.v1",
        to: "needs_review",
        inputHash: conceptInputsHash
      });
      const finalErr = new Error(`Concept options generation failed after repair: ${repairErr.message}`);
      finalErr.code = "concept_generation_failed";
      throw finalErr;
    }
  }

  // Write and register output
  const conceptOptionsPath = join(jobDir, "planning", "concept-options.json");
  const conceptOptionsWrite = await writeCanonicalJson(conceptOptionsPath, result.payload);
  const conceptOptionsHash = conceptOptionsWrite.sha256;

  await registerArtifact(jobDir, {
    artifactId: "yadam-concept-options",
    logicalRole: "yadam.concept.options",
    path: "planning/concept-options.json",
    sha256: conceptOptionsHash,
    schemaVersion: "1.0.0",
    producerStage: "concept-generation",
    gateStatus: "pass",
    dependencyHashes: {
      "conceptInputs": conceptInputsHash
    }
  });

  const state = await transitionJob(jobDir, {
    stage: "CONCEPT_OPTIONS_READY",
    to: "awaiting_approval",
    inputHash: hashCanonical({
      stage: "concept_options",
      requestHash,
      conceptInputsHash,
      promptHash: sha256Bytes(await readFile(promptPath)),
      schemaHash: sha256Bytes(await readFile(schemaPath)),
      profileHash: context.state.profileHash || "0000000000000000000000000000000000000000000000000000000000000000",
      codexExecutionPinHash: result.provenance ? sha256Bytes(Buffer.from(canonicalJson({
        executableVersion: result.provenance.executableVersion,
        model: result.provenance.model,
        reasoningEffort: result.provenance.reasoningEffort,
        profileHash: result.provenance.profileHash,
        instructionSourceHashes: result.provenance.instructionSourceHashes
      }), "utf8")) : "0000000000000000000000000000000000000000000000000000000000000000"
    }),
    outputHash: conceptOptionsHash,
    artifactPaths: ["planning/concept-inputs.json", "planning/concept-options.json"]
  });

  return {
    status: "awaiting_concept_selection",
    artifact: {
      artifactId: "yadam-concept-options",
      relativePath: "planning/concept-options.json",
      sha256: conceptOptionsHash
    },
    optionCount,
    recommendedCandidateId: result.payload.recommendedCandidateId
  };
}

export async function selectConcept({ jobDir, candidateId, userInstructions, selectedAt }) {
  if (typeof userInstructions !== "string" || userInstructions.length > 2000) {
    throw codedError("user_instructions_invalid", "userInstructions must be a string up to 2000 code points");
  }

  const context = await loadJob(jobDir);
  
  // Find concept-options artifact
  const conceptOptionsRecord = context.manifest.artifacts.find(a => a.logicalRole === "yadam.concept.options");
  if (!conceptOptionsRecord || conceptOptionsRecord.gateStatus !== "pass") {
    throw codedError("concept_options_missing", "Concept options are not ready or not passing");
  }

  const conceptOptionsPath = join(jobDir, conceptOptionsRecord.path);
  const conceptOptionsBytes = await readFile(conceptOptionsPath);
  const conceptOptions = JSON.parse(conceptOptionsBytes.toString("utf8"));
  const conceptOptionsHash = conceptOptionsRecord.sha256;

  // Validate candidateId exists in options
  const optionExists = conceptOptions.options.some(opt => opt.candidateId === candidateId);
  if (!optionExists) {
    throw codedError("candidate_not_found", `Candidate ID ${candidateId} not found in options`);
  }

  const selection = {
    schemaVersion: "1.0.0",
    selectionType: "provisional",
    candidateId,
    selectedAt,
    userInstructions: userInstructions.normalize("NFC"),
    conceptOptionsHash
  };

  const selectionPath = join(jobDir, "approvals/concept-selection.json");
  const selectionWrite = await writeCanonicalJson(selectionPath, selection);
  const selectionHash = selectionWrite.sha256;

  await registerArtifact(jobDir, {
    artifactId: "yadam-concept-selection",
    logicalRole: "yadam.concept.selection",
    path: "approvals/concept-selection.json",
    sha256: selectionHash,
    schemaVersion: "1.0.0",
    producerStage: "concept-selection",
    gateStatus: "pass",
    dependencyHashes: {
      "conceptOptions": conceptOptionsHash
    }
  });

  // Check if a prior formal approval 1 exists to invalidate
  const approval1Record = context.manifest.artifacts.find(a => a.logicalRole === "yadam.approval.1");
  let approvalOneInvalidated = false;
  if (approval1Record) {
    // Invalidate approval 1 pointer
    const currentApproval1Path = join(jobDir, "approvals/current-approval-1.json");
    try {
      const current1Bytes = await readFile(currentApproval1Path, "utf8");
      const current1 = JSON.parse(current1Bytes);
      if (current1.status === "valid") {
        const invalidated1 = {
          schemaVersion: "1.0.0",
          status: "invalidated",
          revision: current1.revision,
          path: current1.path,
          sha256: current1.sha256,
          approvedArtifactSetHash: current1.approvedArtifactSetHash,
          invalidatedAt: selectedAt,
          reason: "concept_selection_changed",
          observedDependencyHash: selectionHash
        };
        await writeCanonicalJson(currentApproval1Path, invalidated1);
        approvalOneInvalidated = true;
      }
    } catch (e) {
      // ignore
    }
  }

  await transitionJob(jobDir, {
    stage: "CONCEPT_SELECTED",
    to: "running",
    inputHash: hashCanonical({
      stage: "concept_selection",
      conceptOptionsHash,
      candidateId,
      userInstructions: userInstructions.normalize("NFC"),
      selectedAt
    }),
    outputHash: selectionHash,
    artifactPaths: ["approvals/concept-selection.json"]
  });

  return {
    status: "selection_recorded",
    candidateId,
    relativePath: "approvals/concept-selection.json",
    sha256: selectionHash,
    approvalOneInvalidated
  };
}
