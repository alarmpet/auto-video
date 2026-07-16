import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverCodex, preflightCodex } from "../../scripts/lib/providers/codex-cli.mjs";
import { runCodexStage, runCodexStageWithPolicy } from "../../scripts/lib/pipeline/codex-stage-runner.mjs";
import { createJob } from "../../scripts/lib/pipeline/job-store.mjs";
import { loadProfile, loadHostConfig } from "../../scripts/lib/pipeline/profile-registry.mjs";
import { writeCanonicalJson } from "../../scripts/lib/pipeline/atomic-store.mjs";
import { transitionJob } from "../../scripts/lib/pipeline/state-machine.mjs";

const FAKE_CODEX_PATH = "C:/Users/petbl/auto-video/test/yadam/fixtures/fake-codex.mjs";

test("discoverCodex discovers fake-codex.mjs when configured", async () => {
  const hostConfig = {
    schemaVersion: "1.0.0",
    codex: {
      executable: FAKE_CODEX_PATH,
      versionTimeoutMs: 2000
    }
  };
  const discovered = await discoverCodex(hostConfig);
  assert.equal(discovered.executable, FAKE_CODEX_PATH);
  assert.match(discovered.version, /codex-cli/);
});

test("preflightCodex evaluates instruction source pins correctly", async () => {
  const root = await mkdtemp(join(tmpdir(), "yadam-preflight-"));
  
  const profile = {
    codex: {
      instructionSourcePins: {}
    }
  };

  try {
    const result = await preflightCodex(FAKE_CODEX_PATH, {
      profile,
      workspaceRoot: root
    });
    assert.equal(result.ok, true);

    await writeFile(join(root, "AGENTS.md"), "some rules", "utf8");
    await assert.rejects(
      preflightCodex(FAKE_CODEX_PATH, { profile, workspaceRoot: root }),
      err => err.code === "codex_instruction_source_changed"
    );

    const hash = "6f936082df9994f0d9bba8c26893c5c9d99172eaef02be2d93df8451f3d68042";
    const pinnedProfile = {
      codex: {
        instructionSourcePins: {
          [join(root, "AGENTS.md").replaceAll("\\", "/")]: hash
        }
      }
    };
    const resultPinned = await preflightCodex(FAKE_CODEX_PATH, {
      profile: pinnedProfile,
      workspaceRoot: root
    });
    assert.equal(resultPinned.ok, true);

    await writeFile(join(root, "AGENTS.md"), "changed rules", "utf8");
    await assert.rejects(
      preflightCodex(FAKE_CODEX_PATH, { profile: pinnedProfile, workspaceRoot: root }),
      err => err.code === "codex_instruction_source_changed"
    );

    await writeFile(join(root, "AGENTS.md"), "some rules", "utf8");

    const stageDir = join(root, "stageWorkDir");
    await mkdir(stageDir, { recursive: true });
    await mkdir(join(stageDir, ".codex"), { recursive: true });
    await writeFile(join(stageDir, ".codex", "config.toml"), "some config", "utf8");

    await assert.rejects(
      preflightCodex(FAKE_CODEX_PATH, { profile: pinnedProfile, workspaceRoot: root, stageWorkDir: stageDir }),
      err => err.code === "codex_stage_config_forbidden"
    );

  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runCodexStage success promotes one payload", async () => {
  const root = await mkdtemp(join(tmpdir(), "yadam-runner-"));
  const exportsDir = join(root, "exports");
  await mkdir(exportsDir, { recursive: true });

  const hostConfig = {
    schemaVersion: "1.0.0",
    workspaceRoot: root,
    exportsRoot: exportsDir,
    codex: {
      executable: FAKE_CODEX_PATH,
      versionTimeoutMs: 2000
    }
  };

  const profile = await loadProfile("yadam", "C:/Users/petbl/auto-video");
  const request = {
    schemaVersion: "1.0.0",
    profileId: "yadam",
    inputMode: "genre",
    source: { kind: "genre", value: "test" },
    targetMinutes: 10,
    durationTolerance: 0.20,
    approvalMode: "two-stage",
    seed: 1,
    createdAt: new Date().toISOString()
  };

  try {
    await mkdir(join(root, "config"), { recursive: true });
    await writeCanonicalJson(join(root, "config", "host.local.json"), hostConfig);

    const context = await createJob({ workspaceRoot: root, request, profile, hostConfig });
    const jobDir = context.jobDir;

    process.env.FAKE_CODEX_MODE = "success";

    const testSchemaPath = join(root, "stage-output.schema.json");
    const testSchema = {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "jobId": { "type": "string" },
        "stageId": { "type": "string" },
        "inputHash": { "type": "string" },
        "data": { "type": "object" }
      },
      "required": ["jobId", "stageId", "inputHash", "data"],
      "additionalProperties": false
    };
    await writeCanonicalJson(testSchemaPath, testSchema);

    const inputHash = "0000000000000000000000000000000000000000000000000000000000000001";

    const result = await runCodexStage({
      jobDir,
      stageId: "stage-1",
      prompt: "generate",
      schemaPath: testSchemaPath,
      inputHash,
      timeoutMs: 5000
    });

    assert.equal(result.payload.jobId, context.request.jobId);
    assert.equal(result.payload.data.success, true);
    assert.ok(result.outputHash);
    assert.ok(result.eventsPath);
    assert.equal(result.provenance.model, "gpt-5.6-sol");

    await rm(join(jobDir, "logs", "codex", "stage-1"), { recursive: true, force: true });
    process.env.FAKE_CODEX_MODE = "jsonl-error";
    await assert.rejects(
      runCodexStage({
        jobDir,
        stageId: "stage-1",
        prompt: "generate",
        schemaPath: testSchemaPath,
        inputHash,
        timeoutMs: 5000
      }),
      err => err.code === "codex_event_error" || err.code === "codex_process_failed"
    );

    await rm(join(jobDir, "logs", "codex", "stage-1"), { recursive: true, force: true });
    process.env.FAKE_CODEX_MODE = "malformed-json";
    await assert.rejects(
      runCodexStage({
        jobDir,
        stageId: "stage-1",
        prompt: "generate",
        schemaPath: testSchemaPath,
        inputHash,
        timeoutMs: 5000
      }),
      err => err.code === "codex_malformed_json"
    );

    await rm(join(jobDir, "logs", "codex", "stage-1"), { recursive: true, force: true });
    process.env.FAKE_CODEX_MODE = "schema-error";
    await assert.rejects(
      runCodexStage({
        jobDir,
        stageId: "stage-1",
        prompt: "generate",
        schemaPath: testSchemaPath,
        inputHash,
        timeoutMs: 5000
      }),
      err => err.code === "codex_schema_validation_failed"
    );

    await rm(join(jobDir, "logs", "codex", "stage-1"), { recursive: true, force: true });
    process.env.FAKE_CODEX_MODE = "timeout";
    await assert.rejects(
      runCodexStage({
        jobDir,
        stageId: "stage-1",
        prompt: "generate",
        schemaPath: testSchemaPath,
        inputHash,
        timeoutMs: 500
      }),
      err => err.code === "codex_timeout"
    );

  } finally {
    delete process.env.FAKE_CODEX_MODE;
    await rm(root, { recursive: true, force: true });
  }
});

test("runCodexStageWithPolicy enforces retry limits", async () => {
  const root = await mkdtemp(join(tmpdir(), "yadam-policy-"));
  const exportsDir = join(root, "exports");
  await mkdir(exportsDir, { recursive: true });

  const hostConfig = {
    schemaVersion: "1.0.0",
    workspaceRoot: root,
    exportsRoot: exportsDir,
    codex: {
      executable: FAKE_CODEX_PATH
    }
  };

  const profile = await loadProfile("yadam", "C:/Users/petbl/auto-video");
  const request = {
    schemaVersion: "1.0.0",
    profileId: "yadam",
    inputMode: "genre",
    source: { kind: "genre", value: "test" },
    targetMinutes: 10,
    durationTolerance: 0.20,
    approvalMode: "two-stage",
    seed: 1,
    createdAt: new Date().toISOString()
  };

  try {
    await mkdir(join(root, "config"), { recursive: true });
    await writeCanonicalJson(join(root, "config", "host.local.json"), hostConfig);

    const context = await createJob({ workspaceRoot: root, request, profile, hostConfig });
    const jobDir = context.jobDir;

    const testSchemaPath = join(root, "stage-output.schema.json");
    const testSchema = {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "jobId": { "type": "string" },
        "stageId": { "type": "string" },
        "inputHash": { "type": "string" },
        "data": { "type": "object" }
      },
      "required": ["jobId", "stageId", "inputHash", "data"],
      "additionalProperties": false
    };
    await writeCanonicalJson(testSchemaPath, testSchema);

    const inputHash = "0000000000000000000000000000000000000000000000000000000000000001";

    process.env.FAKE_CODEX_MODE = "schema-error";
    let lastErr;
    try {
      await runCodexStageWithPolicy({
        jobDir,
        stageId: "stage-1",
        prompt: "generate",
        schemaPath: testSchemaPath,
        inputHash,
        timeoutMs: 5000
      });
    } catch (e) {
      console.error("DEBUG lastErr:", e);
      lastErr = e;
    }
    assert.equal(lastErr.code, "codex_schema_validation_failed");

    await transitionJob(jobDir, {
      stage: "stage-1",
      to: "running",
      inputHash,
      error: { code: lastErr.code, message: lastErr.message }
    });

    process.env.FAKE_CODEX_MODE = "success";
    const successResult = await runCodexStageWithPolicy({
      jobDir,
      stageId: "stage-1",
      prompt: "generate",
      schemaPath: testSchemaPath,
      inputHash,
      timeoutMs: 5000
    });
    assert.equal(successResult.payload.data.success, true);

    await transitionJob(jobDir, {
      stage: "stage-1",
      to: "running",
      inputHash,
      outputHash: successResult.outputHash,
      artifactPaths: []
    });

    await assert.rejects(
      runCodexStageWithPolicy({
        jobDir,
        stageId: "stage-1",
        prompt: "generate",
        schemaPath: testSchemaPath,
        inputHash,
        timeoutMs: 5000
      }),
      err => err.code === "duration_repair_budget_exhausted"
    );

  } finally {
    delete process.env.FAKE_CODEX_MODE;
    await rm(root, { recursive: true, force: true });
  }
});
