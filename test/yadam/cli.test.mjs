import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCli } from "../../scripts/lib/pipeline/cli-args.mjs";

const CLI_PATH = "C:/Users/petbl/auto-video/scripts/auto-video-pipeline.mjs";

const definitions = {
  new: {
    profile: { type: "string", required: true },
    mode: { type: "string", required: true, enum: ["reference", "genre"] },
    source: { type: "string", required: true },
    minutes: { type: "integer", required: true },
    seed: { type: "integer", required: true },
    instructions: { type: "string", required: false }
  },
  status: {
    job: { type: "string", required: true }
  },
  preflight: {
    provider: { type: "string", required: true, enum: ["codex"] },
    "no-generate": { type: "boolean", required: false }
  },
  cancel: {
    job: { type: "string", required: true }
  },
  resume: {
    job: { type: "string", required: true }
  }
};

test("parseCli parses valid CLI arguments and rejects duplicates/unknowns", () => {
  const argv = [
    "new",
    "--profile", "yadam",
    "--mode", "genre",
    "--source", "의리와 배신",
    "--minutes", "10",
    "--seed", "42",
    "--instructions", "가족 회복을 강조"
  ];
  const parsed = parseCli(argv, definitions);
  assert.equal(parsed.command, "new");
  assert.equal(parsed.args.profile, "yadam");
  assert.equal(parsed.args.source, "의리와 배신");
  assert.equal(parsed.args.minutes, 10);
  assert.equal(parsed.args.seed, 42);

  const duplicate = [...argv, "--seed", "43"];
  assert.throws(() => parseCli(duplicate, definitions), err => err.code === "invalid_cli_argument");

  const unknown = [...argv, "--unknown", "value"];
  assert.throws(() => parseCli(unknown, definitions), err => err.code === "invalid_cli_argument");
});

test("CLI command execution prints structured JSON outputs", async () => {
  const runCli = (args, env = {}) => {
    return new Promise((resolve) => {
      const child = fork(CLI_PATH, args, { stdio: "pipe", env: { ...process.env, ...env } });
      let stdout = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.on("close", (code) => {
        try {
          resolve({ code, parsed: JSON.parse(stdout.trim()) });
        } catch (e) {
          resolve({ code, raw: stdout });
        }
      });
    });
  };

  const root = await mkdtemp(join(tmpdir(), "yadam-cli-test-"));
  const exportsDir = join(root, "exports");
  await mkdir(exportsDir, { recursive: true });

  try {
    const resNew = await runCli([
      "new",
      "--profile", "yadam",
      "--mode", "genre",
      "--source", "의리와 배신",
      "--minutes", "10",
      "--seed", "42"
    ]);

    assert.equal(resNew.parsed.ok, true);
    assert.equal(resNew.parsed.command, "new");
    assert.ok(resNew.parsed.result.jobDir);
    assert.equal(resNew.parsed.result.status, "pending");

    const jobDir = resNew.parsed.result.jobDir;

    const resStatus = await runCli(["status", "--job", jobDir]);
    assert.equal(resStatus.parsed.ok, true);
    assert.equal(resStatus.parsed.result.status, "pending");

    const resCancel = await runCli(["cancel", "--job", jobDir]);
    assert.equal(resCancel.parsed.ok, true);
    assert.equal(resCancel.parsed.result.status, "cancel_requested");

    const resResume = await runCli(["resume", "--job", jobDir]);
    assert.equal(resResume.parsed.ok, true);
    assert.equal(resResume.parsed.result.nextStage, "planning");

    await rm(jobDir, { recursive: true, force: true });

  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
