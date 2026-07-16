import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { canonicalJson, hashCanonical } from "../../scripts/lib/pipeline/canonical-json.mjs";
import { writeBinaryAtomic, writeCanonicalJson, writeCanonicalJsonExclusive, readJson } from "../../scripts/lib/pipeline/atomic-store.mjs";
import { assertPathWithin, assertRealPathWithin } from "../../scripts/lib/pipeline/path-policy.mjs";
import { loadProfile, loadHostConfig, validateTargetMinutes } from "../../scripts/lib/pipeline/profile-registry.mjs";
import { validateSchema } from "../../scripts/lib/pipeline/schema-registry.mjs";
import { createJob, loadJob } from "../../scripts/lib/pipeline/job-store.mjs";
import { transitionJob } from "../../scripts/lib/pipeline/state-machine.mjs";
import { buildSuccessEvidence } from "../../scripts/lib/pipeline/success-evidence.mjs";

test("test harness runs as ESM", () => {
  assert.equal(import.meta.url.startsWith("file:"), true);
});

test("canonical JSON normalizes strings and sorts object keys", () => {
  assert.equal(canonicalJson({ z: "e\u0301", a: 1 }), '{"a":1,"z":"é"}');
  assert.equal(hashCanonical({ z: "e\u0301", a: 1 }).length, 64);
  assert.throws(
    () => canonicalJson({ "e\u0301": 1, "é": 2 }),
    /duplicate object key after NFC normalization/
  );
});

test("atomic JSON write returns the on-disk hash", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yadam-store-"));
  try {
    const out = await writeCanonicalJson(join(dir, "value.json"), { b: 2, a: "가" });
    assert.equal(await readFile(out.path, "utf8"), '{"a":"가","b":2}\n');
    assert.equal(out.sha256.length, 64);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("exclusive canonical JSON never replaces an immutable revision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yadam-exclusive-"));
  const path = join(dir, "approval-r001.json");
  try {
    const first = await writeCanonicalJsonExclusive(path, { revision: 1 });
    await assert.rejects(
      writeCanonicalJsonExclusive(path, { revision: 2 }),
      error => error.code === "immutable_target_exists"
    );
    assert.equal(await readFile(path, "utf8"), '{"revision":1}\n');
    assert.equal(first.sha256.length, 64);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("binary atomic write preserves exact bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yadam-binary-"));
  const bytes = Buffer.from([0, 255, 1, 254, 2, 253]);
  try {
    const output = await writeBinaryAtomic(join(dir, "asset.bin"), bytes);
    assert.deepEqual(await readFile(output.path), bytes);
    assert.equal(output.sizeBytes, bytes.length);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("path policy rejects sibling-prefix escapes", () => {
  assert.throws(() => assertPathWithin("C:/jobs/a", "C:/jobs/ab/file.json"), /outside allowed root/);
});

test("real path policy rejects a Windows junction escape", async () => {
  const root = await mkdtemp(join(tmpdir(), "yadam-root-"));
  const outside = await mkdtemp(join(tmpdir(), "yadam-outside-"));
  try {
    await writeFile(join(outside, "secret.txt"), "outside", "utf8");
    await symlink(outside, join(root, "escape"), "junction");
    await assert.rejects(
      assertRealPathWithin(root, join(root, "escape", "secret.txt")),
      /outside allowed root/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("validateTargetMinutes only accepts 10-step values between 10 and 120", () => {
  assert.equal(validateTargetMinutes(10), 10);
  assert.equal(validateTargetMinutes(120), 120);
  assert.equal(validateTargetMinutes(50), 50);
  assert.throws(() => validateTargetMinutes(5), /targetMinutes must be 10..120/);
  assert.throws(() => validateTargetMinutes(15), /targetMinutes must be 10..120/);
  assert.throws(() => validateTargetMinutes(130), /targetMinutes must be 10..120/);
  assert.throws(() => validateTargetMinutes("abc"), /targetMinutes must be 10..120/);
});

test("profile loader isolates yadam and legacy-compatibility profiles", async () => {
  const workspaceRoot = "C:/Users/petbl/auto-video";
  const yadam = await loadProfile("yadam", workspaceRoot);
  assert.equal(yadam.profileId, "yadam");
  assert.deepEqual(yadam.targetMinutes, { min: 10, max: 120, step: 10, durationTolerance: 0.2 });
  assert.equal(yadam.codex.model, "gpt-5.6-sol");
  assert.equal(yadam.codex.reasoningEffort, "ultra");
  assert.equal(yadam.codex.workingDirectoryPolicy, "dedicated-empty-stage-dir");
  assert.equal(yadam.visual.styleId, "yadam-color-manhwa-v1");
  assert.equal(yadam.tts.provider, "supertonic");
  assert.equal(yadam.tts.voice, "M1");
  assert.equal(yadam.tts.speed, 1.04);
  assert.equal(yadam.video.fps, 24);
  assert.equal(typeof yadam.profileHash, "string");
  assert.equal(yadam.profileHash.length, 64);
  assert.throws(() => { yadam.profileId = "changed"; }, TypeError);

  const gguljam = await loadProfile("gguljam-bible", workspaceRoot);
  assert.equal(gguljam.profileId, "gguljam-bible");
  assert.equal(gguljam.mode, "legacy-compatibility");
  assert.equal(gguljam.strictRelease, false);
  assert.equal(gguljam.yadam, undefined);
  assert.throws(() => { gguljam.profileId = "changed"; }, TypeError);

  const hostConfig = await loadHostConfig(workspaceRoot);
  assert.equal(hostConfig.schemaVersion, "1.0.0");
  assert.equal(typeof hostConfig.hostConfigHash, "string");
  assert.throws(() => { hostConfig.schemaVersion = "changed"; }, TypeError);
});

test("schema validation handles request.schema.json rules", async () => {
  const schemaPath = "schemas/pipeline/request.schema.json";
  const validRequest = {
    schemaVersion: "1.0.0",
    jobId: "job-20260716-123456-abcdefab",
    profileId: "yadam",
    inputMode: "genre",
    source: {
      kind: "genre",
      value: "의리와 배신"
    },
    targetMinutes: 10,
    durationTolerance: 0.20,
    approvalMode: "two-stage",
    seed: 42,
    createdAt: "2026-07-16T12:34:56.789Z"
  };

  const validated = await validateSchema(schemaPath, { ...validRequest });
  assert.equal(validated.optionalInstructions, ""); // default value applied

  // Invalid: missing source
  const invalid1 = { ...validRequest };
  delete invalid1.source;
  await assert.rejects(validateSchema(schemaPath, invalid1), {
    name: "SchemaValidationError"
  });

  // Invalid: mismatched inputMode/source.kind
  const invalid2 = {
    ...validRequest,
    inputMode: "reference",
    source: {
      kind: "genre",
      value: "의리와 배신"
    }
  };
  await assert.rejects(validateSchema(schemaPath, invalid2), {
    name: "SchemaValidationError"
  });

  // Invalid: unknown/legacy fields
  const invalid3 = {
    ...validRequest,
    referenceTitle: "some title"
  };
  await assert.rejects(validateSchema(schemaPath, invalid3), {
    name: "SchemaValidationError"
  });
});

test("createJob and loadJob create the job layout, config files and default registry", async () => {
  const root = await mkdtemp(join(tmpdir(), "yadam-workspace-"));
  const exportsDir = join(root, "exports");
  await mkdir(exportsDir, { recursive: true });

  const hostConfig = {
    schemaVersion: "1.0.0",
    workspaceRoot: root,
    exportsRoot: exportsDir,
    codex: {
      executable: "fake-codex.exe",
      verifiedVersion: "0.144.0-alpha.4",
      versionTimeoutMs: 1000
    }
  };

  const profile = await loadProfile("yadam", "C:/Users/petbl/auto-video");

  const request = {
    schemaVersion: "1.0.0",
    profileId: "yadam",
    inputMode: "genre",
    source: {
      kind: "genre",
      value: "가족 사랑"
    },
    targetMinutes: 10,
    durationTolerance: 0.20,
    approvalMode: "two-stage",
    seed: 1234,
    createdAt: "2026-07-16T12:00:00.000Z"
  };

  try {
    const context = await createJob({ workspaceRoot: root, request, profile, hostConfig });
    assert.ok(context.jobDir);
    assert.equal(context.state.status, "pending");
    assert.equal(context.state.durationRepairAttemptsUsed, 0);
    assert.equal(context.manifest.artifacts.length, 1);
    assert.equal(context.manifest.artifacts[0].artifactId, "pipeline-request");

    // Load job and verify
    const loaded = await loadJob(context.jobDir);
    assert.equal(loaded.request.jobId, context.request.jobId);
    assert.equal(loaded.state.jobId, context.state.jobId);
    assert.equal(loaded.manifest.jobId, context.manifest.jobId);

    // Verify folders exist
    const expectedFolders = [
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
    for (const f of expectedFolders) {
      await assertRealPathWithin(context.jobDir, join(context.jobDir, f));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("transitionJob handles locks, attempts, and success evidence conflicts", async () => {
  const root = await mkdtemp(join(tmpdir(), "yadam-transitions-"));
  const exportsDir = join(root, "exports");
  await mkdir(exportsDir, { recursive: true });

  const hostConfig = {
    schemaVersion: "1.0.0",
    workspaceRoot: root,
    exportsRoot: exportsDir,
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
    const context = await createJob({ workspaceRoot: root, request, profile, hostConfig });
    const jobDir = context.jobDir;

    // pending -> running (hash-bound)
    const inputHash = "0000000000000000000000000000000000000000000000000000000000000001";
    let state = await transitionJob(jobDir, {
      stage: "pipeline-start",
      to: "running",
      inputHash
    });
    assert.equal(state.status, "running");
    assert.equal(state.history.length, 1);

    // Identical call returns current state without duplicate row
    let state2 = await transitionJob(jobDir, {
      stage: "pipeline-start",
      to: "running",
      inputHash
    });
    assert.equal(state2.history.length, 1);

    // Mismatched properties for same stage/inputHash throws success_evidence_conflict
    await assert.rejects(
      transitionJob(jobDir, {
        stage: "pipeline-start",
        to: "running",
        inputHash,
        outputHash: "0000000000000000000000000000000000000000000000000000000000000002",
        artifactPaths: ["some/path.json"]
      }),
      err => err.code === "success_evidence_conflict"
    );

    // First transition to completed: running -> completed
    const completedInputHash = "0000000000000000000000000000000000000000000000000000000000000003";
    await transitionJob(jobDir, {
      stage: "pipeline-finish",
      to: "completed",
      inputHash: completedInputHash
    });

    // Try completed -> running
    await assert.rejects(
      transitionJob(jobDir, {
        stage: "pipeline-restart",
        to: "running",
        inputHash: completedInputHash
      }),
      err => err.code === "illegal_state_transition"
    );

    // Reset job state for attempt tests
    await writeCanonicalJson(join(jobDir, "pipeline-state.json"), {
      schemaVersion: "1.0.0",
      jobId: context.state.jobId,
      status: "running",
      durationRepairAttemptsUsed: 0,
      history: []
    });

    // stage DURATION_REPAIR_REQUIRED with attempt:1
    state = await transitionJob(jobDir, {
      stage: "DURATION_REPAIR_REQUIRED",
      to: "running",
      inputHash,
      attempt: 1
    });
    assert.equal(state.durationRepairAttemptsUsed, 1);

    // A second attempt throws duration_repair_budget_exhausted
    await assert.rejects(
      transitionJob(jobDir, {
        stage: "DURATION_REPAIR_REQUIRED",
        to: "running",
        inputHash: "0000000000000000000000000000000000000000000000000000000000000005",
        attempt: 1
      }),
      err => err.code === "duration_repair_budget_exhausted"
    );

    // Attempt on any other stage throws invalid_attempt
    await assert.rejects(
      transitionJob(jobDir, {
        stage: "pipeline-start",
        to: "running",
        inputHash,
        attempt: 1
      }),
      err => err.code === "invalid_attempt"
    );

    // Reject outputHash without artifactPaths
    await assert.rejects(
      transitionJob(jobDir, {
        stage: "pipeline-start",
        to: "running",
        inputHash: "0000000000000000000000000000000000000000000000000000000000000009",
        outputHash: "0000000000000000000000000000000000000000000000000000000000000009"
      })
    );

    // Lock contention tests
    const lockPath = join(jobDir, "pipeline.lock");
    const liveLock = {
      schemaVersion: "1.0.0",
      pid: process.pid,
      leaseId: "livelease",
      acquiredAt: new Date().toISOString()
    };
    await writeCanonicalJson(lockPath, liveLock);
    await assert.rejects(
      transitionJob(jobDir, {
        stage: "pipeline-start",
        to: "running",
        inputHash: "0000000000000000000000000000000000000000000000000000000000000099"
      }),
      err => err.code === "job_locked"
    );

    // Stale timestamp (older than 300s) but with a live PID must remain locked
    const staleLiveLock = {
      schemaVersion: "1.0.0",
      pid: process.pid,
      leaseId: "stalelive",
      acquiredAt: new Date(Date.now() - 400 * 1000).toISOString()
    };
    await writeCanonicalJson(lockPath, staleLiveLock);
    await assert.rejects(
      transitionJob(jobDir, {
        stage: "pipeline-start",
        to: "running",
        inputHash: "0000000000000000000000000000000000000000000000000000000000000099"
      }),
      err => err.code === "job_locked"
    );

    // Stale timestamp with definitely absent PID is moved to quarantine/locks/ and retried
    const staleDeadLock = {
      schemaVersion: "1.0.0",
      pid: 999999, // Def dead pid
      leaseId: "staledead",
      acquiredAt: new Date(Date.now() - 400 * 1000).toISOString()
    };
    await writeCanonicalJson(lockPath, staleDeadLock);
    const transitionedState = await transitionJob(jobDir, {
      stage: "pipeline-start",
      to: "running",
      inputHash: "0000000000000000000000000000000000000000000000000000000000000099"
    });
    assert.equal(transitionedState.status, "running");

    const quarantinedLockPath = join(jobDir, "quarantine/locks/pipeline-staledead.json");
    const quarantined = await readJson(quarantinedLockPath);
    assert.equal(quarantined.leaseId, "staledead");

  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildSuccessEvidence canonicalizes inputs, outputs, and opaque hashes", () => {
  const inputs = [
    { artifactId: "a2", logicalRole: "roleB", path: "in2.json", sha256: "0000000000000000000000000000000000000000000000000000000000000002" },
    { artifactId: "a1", logicalRole: "roleA", path: "in1.json", sha256: "0000000000000000000000000000000000000000000000000000000000000001" }
  ];
  const outputs = [
    { artifactId: "out1", logicalRole: "outRole", path: "out\\path1.json", sha256: "0000000000000000000000000000000000000000000000000000000000000100" }
  ];
  const opaque = {
    modelHash: "0000000000000000000000000000000000000000000000000000000000000200"
  };

  const evidence1 = buildSuccessEvidence("stage-test", inputs, outputs, opaque);
  assert.equal(evidence1.artifactPaths[0], "out/path1.json");

  const inputsShuffled = [inputs[1], inputs[0]];
  const evidence2 = buildSuccessEvidence("stage-test", inputsShuffled, outputs, opaque);
  assert.equal(evidence1.inputHash, evidence2.inputHash);
  assert.equal(evidence1.outputHash, evidence2.outputHash);

  const evidenceOpaqueChanged = buildSuccessEvidence("stage-test", inputs, outputs, {
    modelHash: "0000000000000000000000000000000000000000000000000000000000000201"
  });
  assert.notEqual(evidence1.inputHash, evidenceOpaqueChanged.inputHash);

  const outputsChanged = [
    { artifactId: "out1", logicalRole: "outRole", path: "out\\path1.json", sha256: "0000000000000000000000000000000000000000000000000000000000000101" }
  ];
  const evidenceOutputChanged = buildSuccessEvidence("stage-test", inputs, outputsChanged, opaque);
  assert.equal(evidence1.inputHash, evidenceOutputChanged.inputHash);
  assert.notEqual(evidence1.outputHash, evidenceOutputChanged.outputHash);

  assert.throws(() => buildSuccessEvidence("stage-test", inputs, outputs, { invalidKey: opaque.modelHash }));
});
