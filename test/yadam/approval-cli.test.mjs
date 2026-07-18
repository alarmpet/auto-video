import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { writeCanonicalJson } from "../../scripts/lib/pipeline/atomic-store.mjs";
import { sha256Bytes, hashCanonical } from "../../scripts/lib/pipeline/canonical-json.mjs";
import { readFileSync, writeFileSync } from "node:fs";

const execFileAsync = promisify(execFile);

test("CLI commands parse and route correctly E2E", async () => {
  const tempJobDir = resolve(`test/yadam/tmp/cli-test-job-${Date.now()}`);
  await rm(tempJobDir, { recursive: true, force: true });
  await mkdir(tempJobDir, { recursive: true });

  try {
    // 1. Setup Request & Config
    const request = {
      schemaVersion: "1.0.0",
      jobId: "job-cli-123",
      profileId: "yadam",
      targetMinutes: 10,
      seed: 42,
      inputMode: "reference",
      source: { kind: "script", value: "hello" },
      createdAt: new Date().toISOString()
    };
    await writeCanonicalJson(join(tempJobDir, "request.json"), request);
    await writeCanonicalJson(join(tempJobDir, "pipeline-state.json"), {
      schemaVersion: "1.0.0",
      jobId: "job-cli-123",
      status: "running",
      durationRepairAttemptsUsed: 0,
      history: []
    });

    const requestHash = sha256Bytes(readFileSync(join(tempJobDir, "request.json")));
    await writeCanonicalJson(join(tempJobDir, "artifact-manifest.json"), {
      schemaVersion: "1.0.0",
      jobId: "job-cli-123",
      artifacts: [
        {
          artifactId: "pipeline-request",
          logicalRole: "pipeline.request",
          path: "request.json",
          sha256: requestHash,
          schemaVersion: "1.0.0",
          producerStage: "job-create",
          gateStatus: "pass",
          dependencyHashes: {},
          dependencyKinds: {},
          dependencyOwners: {}
        }
      ]
    });

    // 2. Test running with invalid command
    try {
      await execFileAsync("node", ["scripts/auto-video-pipeline.mjs", "invalid-cmd"]);
      assert.fail("Should have failed for invalid command");
    } catch (err) {
      const parsed = JSON.parse(err.stdout);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "invalid_cli_argument");
    }

    // 3. Test status command
    const statusRes = await execFileAsync("node", ["scripts/auto-video-pipeline.mjs", "status", "--job", tempJobDir]);
    const parsedStatus = JSON.parse(statusRes.stdout);
    assert.equal(parsedStatus.ok, true);
    assert.equal(parsedStatus.command, "status");
    assert.equal(parsedStatus.result.jobId, "job-cli-123");

    // 4. Seed Concept Options to allow select-concept
    await mkdir(join(tempJobDir, "planning"), { recursive: true });
    const opts = {
      schemaVersion: "1.0.0",
      jobId: "job-cli-123",
      options: [
        { candidateId: "concept-c01", title: "Test Concept Suffix", motifId: "motif-01", synopsis: "Test", castProposals: [], twistCategoryProposals: [] }
      ]
    };
    const optsWrite = await writeCanonicalJson(join(tempJobDir, "planning/concept-options.json"), opts);
    const inputsWrite = await writeCanonicalJson(join(tempJobDir, "planning/concept-inputs.json"), { req: "none" });

    const manifest = JSON.parse(readFileSync(join(tempJobDir, "artifact-manifest.json"), "utf8"));
    manifest.artifacts.push(
      { artifactId: "yadam-concept-options", logicalRole: "yadam.concept.options", path: "planning/concept-options.json", sha256: optsWrite.sha256, schemaVersion: "1.0.0", producerStage: "concept-generation", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} },
      { artifactId: "yadam-concept-inputs", logicalRole: "yadam.concept.inputs", path: "planning/concept-inputs.json", sha256: inputsWrite.sha256, schemaVersion: "1.0.0", producerStage: "concept-generation", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} }
    );
    writeFileSync(join(tempJobDir, "artifact-manifest.json"), JSON.stringify(manifest, null, 2));

    const state = JSON.parse(readFileSync(join(tempJobDir, "pipeline-state.json"), "utf8"));
    state.status = "awaiting_approval";
    state.history.push({
      from: "running", to: "awaiting_approval", stage: "CONCEPT_OPTIONS_READY",
      inputHash: requestHash, outputHash: optsWrite.sha256,
      artifactPaths: ["planning/concept-inputs.json", "planning/concept-options.json"].sort(),
      at: new Date().toISOString()
    });
    writeFileSync(join(tempJobDir, "pipeline-state.json"), JSON.stringify(state, null, 2));

    // 5. Test select-concept CLI command
    let selRes;
    try {
      selRes = await execFileAsync("node", [
        "scripts/auto-video-pipeline.mjs", "select-concept",
        "--job", tempJobDir,
        "--option", "concept-c01",
        "--note", "selected c01"
      ]);
    } catch (err) {
      console.error("SELECT-CONCEPT FAILED. stdout:", err.stdout, "stderr:", err.stderr);
      throw err;
    }
    const parsedSel = JSON.parse(selRes.stdout);
    assert.equal(parsedSel.ok, true);
    assert.equal(parsedSel.result.status, "selection_recorded");
    assert.equal(parsedSel.result.candidateId, "concept-c01");

  } finally {
    await rm(tempJobDir, { recursive: true, force: true });
  }
});
