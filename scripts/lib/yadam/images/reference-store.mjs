import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { writeCanonicalJson, writeCanonicalJsonExclusive } from "../../pipeline/atomic-store.mjs";
import { registerArtifact } from "../../pipeline/artifact-store.mjs";
import { hashCanonical } from "../../pipeline/canonical-json.mjs";
import { assertRealPathWithin } from "../../pipeline/path-policy.mjs";
import { validateSchema } from "../../pipeline/schema-registry.mjs";
import { sha256File } from "./model-lock.mjs";

const POINTER_SCHEMA_PATH = join(process.cwd(), "schemas/yadam/reference-set-pointer.schema.json");
const SET_SCHEMA_PATH = join(process.cwd(), "schemas/yadam/character-reference-set.schema.json");

const rel = (jobDir, path) => relative(jobDir, path).replaceAll("\\", "/");

export async function writeProvisionalReferenceSet({ jobDir, jobId, revision, createdAt, references, dependencies }) {
  if (!jobId || !createdAt || Number.isNaN(Date.parse(createdAt))) {
    throw Object.assign(new Error("jobId and createdAt are required"), { code: "reference_set_metadata_invalid" });
  }
  for (const key of ["storyBibleHash", "semanticHash", "referenceWorkflowHash", "conditionedWorkflowHash", "checkpointHash", "clipVisionHash", "ipAdapterHash"]) {
    if (!/^[0-9a-f]{64}$/.test(dependencies[key])) {
      throw Object.assign(new Error(`reference dependency invalid: ${key}`), { code: "reference_dependency_invalid" });
    }
  }

  const normalizedRefs = [];
  const seen = new Set();
  const artifactDependencies = {
    storyBible: dependencies.storyBibleHash,
    characterVariants: dependencies.semanticHash,
    referenceWorkflow: dependencies.referenceWorkflowHash,
    conditionedWorkflow: dependencies.conditionedWorkflowHash,
    checkpoint: dependencies.checkpointHash,
    clipVision: dependencies.clipVisionHash,
    ipAdapter: dependencies.ipAdapterHash
  };

  for (const item of references) {
    const pair = `${item.characterId}:${item.variantId}`;
    if (seen.has(pair)) throw Object.assign(new Error(`duplicate reference pair: ${pair}`), { code: "reference_pair_duplicate" });
    seen.add(pair);

    await assertRealPathWithin(jobDir, item.primaryPath);
    const primaryRelPath = rel(jobDir, item.primaryPath);
    if (primaryRelPath === ".." || primaryRelPath.startsWith("../") || primaryRelPath.includes("/../")) {
      throw Object.assign(new Error("reference path escapes job"), { code: "reference_path_outside_job" });
    }

    const primarySha256 = await sha256File(item.primaryPath);
    if (item.primarySha256 && item.primarySha256 !== primarySha256) {
      throw Object.assign(new Error("primary reference hash differs"), { code: "reference_hash_mismatch" });
    }

    const normalizedDerived = [];
    for (const d of item.derived || []) {
      await assertRealPathWithin(jobDir, d.path);
      const derivedRelPath = rel(jobDir, d.path);
      const derivedSha256 = await sha256File(d.path);
      if (d.sha256 && d.sha256 !== derivedSha256) {
        throw Object.assign(new Error("derived reference hash differs"), { code: "reference_hash_mismatch" });
      }
      normalizedDerived.push({
        variantId: d.variantId,
        path: derivedRelPath,
        sha256: derivedSha256,
        width: d.width,
        height: d.height,
        seed: d.seed,
        checkpointHash: d.checkpointHash,
        workflowHash: d.workflowHash,
        compiledRequestHash: d.compiledRequestHash,
        primaryDependencyHash: primarySha256
      });
      artifactDependencies[`compiled:${d.compiledRequestId}`] = d.compiledRequestHash;
      artifactDependencies[`raster:${d.variantId}`] = derivedSha256;
    }

    normalizedRefs.push({
      characterId: item.characterId,
      variantId: item.variantId,
      appearanceAnchors: item.appearanceAnchors,
      wardrobeAnchors: item.wardrobeAnchors,
      primaryPath: primaryRelPath,
      primarySha256,
      width: item.width,
      height: item.height,
      seed: item.seed,
      checkpointHash: item.checkpointHash,
      workflowHash: item.workflowHash,
      compiledRequestHash: item.compiledRequestHash,
      derived: normalizedDerived
    });

    artifactDependencies[`compiled:${item.compiledRequestId}`] = item.compiledRequestHash;
    artifactDependencies[`raster:${item.characterId}:${item.variantId}`] = primarySha256;
  }

  const setVal = {
    schemaVersion: "1.0.0",
    jobId,
    revision,
    createdAt,
    semanticHash: dependencies.semanticHash,
    references: normalizedRefs
  };

  await validateSchema(SET_SCHEMA_PATH, setVal);

  const rStr = String(revision).padStart(3, "0");
  const relativeSetPath = `assets/character-references/reference-set-r${rStr}.json`;
  const setPath = join(jobDir, relativeSetPath);
  const writeRes = await writeCanonicalJsonExclusive(setPath, setVal);

  const pointer = {
    schemaVersion: "1.0.0",
    status: "provisional",
    referenceSetPath: relativeSetPath,
    referenceSetHash: writeRes.sha256,
    approvalRevisionPath: null,
    approvalRevisionHash: null
  };

  const pointerPath = join(jobDir, "assets/character-references/current-reference-set.json");
  await writeCanonicalJson(pointerPath, pointer);

  await registerArtifact(jobDir, {
    artifactId: "character-reference-set-current",
    logicalRole: "yadam.character.reference-set",
    path: relativeSetPath,
    sha256: writeRes.sha256,
    schemaVersion: "1.0.0",
    producerStage: "PREVIEWING_CHARACTER_REFERENCES",
    gateStatus: "pass",
    dependencyHashes: artifactDependencies
  });

  return { referenceSetPath: relativeSetPath, referenceSetHash: writeRes.sha256 };
}

export async function loadReferencePointer(jobDir) {
  const pointerPath = join(jobDir, "assets/character-references/current-reference-set.json");
  const content = await readFile(pointerPath, "utf8");
  const value = JSON.parse(content);
  await validateSchema(POINTER_SCHEMA_PATH, value);
  return value;
}

export async function promoteApprovedReferenceSet({ jobDir, approvalRevisionPath }) {
  const pointer = await loadReferencePointer(jobDir);
  if (pointer.status === "approved") {
    return {
      referenceSetPath: pointer.referenceSetPath,
      referenceSetHash: pointer.referenceSetHash,
      pointerHash: hashCanonical(pointer)
    };
  }

  const approvalPath = join(jobDir, approvalRevisionPath);
  const approval = JSON.parse(await readFile(approvalPath, "utf8"));
  const approvalHash = hashCanonical(approval);

  const setRecord = approval.artifacts?.find(a => a.logicalRole === "yadam.character.reference-set");
  if (!setRecord || setRecord.sha256 !== pointer.referenceSetHash) {
    throw Object.assign(new Error("reference set hash mismatch in approval revision"), { code: "reference_set_hash_mismatch" });
  }

  const promoted = {
    ...pointer,
    status: "approved",
    approvalRevisionPath,
    approvalRevisionHash: approvalHash
  };

  await validateSchema(POINTER_SCHEMA_PATH, promoted);
  const pointerPath = join(jobDir, "assets/character-references/current-reference-set.json");
  await writeCanonicalJson(pointerPath, promoted);

  return {
    referenceSetPath: promoted.referenceSetPath,
    referenceSetHash: promoted.referenceSetHash,
    pointerHash: hashCanonical(promoted)
  };
}
