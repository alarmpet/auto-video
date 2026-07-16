import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { writeCanonicalJson, readJson } from "./atomic-store.mjs";
import { hashCanonical } from "./canonical-json.mjs";
import { validateSchema } from "./schema-registry.mjs";

const FOLDERS = [
  "planning",
  "script/chapters",
  "approvals",
  "reviews",
  "assets/images",
  "assets/audio/raw",
  "assets/audio/normalized",
  "assets/audio/requests",
  "assets/audio/checkpoints",
  "previews",
  "thumbnail",
  "segments",
  "final/upload-subtitles",
  "compat/hermes",
  "logs",
  "quarantine",
  "quarantine/locks"
];

export async function createJob({ workspaceRoot, request, profile, hostConfig }) {
  // Generate deterministic jobId
  const reqCopy = { ...request };
  delete reqCopy.jobId;
  const hashInput = { requestWithoutJobId: reqCopy, createdAt: request.createdAt };
  const hash = hashCanonical(hashInput);
  const suffix = hash.slice(0, 8);

  const date = new Date(request.createdAt);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  const timestamp = `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
  const jobId = `job-${timestamp}-${suffix}`;

  const exportsRoot = hostConfig.exportsRoot || join(workspaceRoot, "exports");
  const jobDir = resolve(join(exportsRoot, jobId));

  // Reject existing directory
  try {
    const checkState = join(jobDir, "pipeline-state.json");
    await readJson(checkState);
    throw new Error(`Job directory already exists: ${jobDir}`);
  } catch (err) {
    if (err.code !== "ENOENT") {
      throw err;
    }
  }

  // Create folders
  await mkdir(jobDir, { recursive: true });
  for (const f of FOLDERS) {
    await mkdir(join(jobDir, f), { recursive: true });
  }

  // Normalize and validate request
  const requestWithId = { ...request, jobId };
  if (requestWithId.optionalInstructions === undefined) {
    requestWithId.optionalInstructions = "";
  }
  const requestSchemaPath = join(workspaceRoot, "schemas", "pipeline", "request.schema.json");
  const validatedRequest = await validateSchema(requestSchemaPath, requestWithId);

  // Write request.json
  const requestWriteResult = await writeCanonicalJson(join(jobDir, "request.json"), validatedRequest);

  // Create and validate state
  const state = {
    schemaVersion: "1.0.0",
    jobId,
    status: "pending",
    durationRepairAttemptsUsed: 0,
    history: []
  };
  const stateSchemaPath = join(workspaceRoot, "schemas", "pipeline", "pipeline-state.schema.json");
  await validateSchema(stateSchemaPath, state);
  await writeCanonicalJson(join(jobDir, "pipeline-state.json"), state);

  // Create and validate artifact-manifest
  const manifest = {
    schemaVersion: "1.0.0",
    jobId,
    artifacts: [
      {
        artifactId: "pipeline-request",
        logicalRole: "pipeline.request",
        path: "request.json",
        sha256: requestWriteResult.sha256,
        schemaVersion: "1.0.0",
        producerStage: "job-create",
        gateStatus: "pass",
        dependencyHashes: {},
        dependencyKinds: {},
        dependencyOwners: {}
      }
    ]
  };
  const manifestSchemaPath = join(workspaceRoot, "schemas", "pipeline", "artifact-manifest.schema.json");
  await validateSchema(manifestSchemaPath, manifest);
  await writeCanonicalJson(join(jobDir, "artifact-manifest.json"), manifest);

  return {
    jobDir,
    request: validatedRequest,
    state,
    manifest
  };
}

export async function loadJob(jobDir) {
  const resolvedDir = resolve(jobDir);
  const request = await readJson(join(resolvedDir, "request.json"));
  const state = await readJson(join(resolvedDir, "pipeline-state.json"));
  const manifest = await readJson(join(resolvedDir, "artifact-manifest.json"));
  return {
    jobDir: resolvedDir,
    request,
    state,
    manifest
  };
}
