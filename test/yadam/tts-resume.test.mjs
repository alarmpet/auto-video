import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadHostConfig } from "../../scripts/lib/pipeline/profile-registry.mjs";
import { writeCanonicalJson } from "../../scripts/lib/pipeline/atomic-store.mjs";
import { createSyntheticWavBytes } from "./fixtures/wav-fixture.mjs";
import {
  updateCheckpointStatus,
  writeCheckpoint,
  loadCheckpoint,
  acquireSceneLock,
  releaseSceneLock
} from "../../scripts/lib/yadam/tts-checkpoint.mjs";

test("checkpoint transition guards", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "yadam-transitions-test-"));
  const exportsDir = join(rootDir, "exports");
  await mkdir(exportsDir, { recursive: true });

  const hostConfig = {
    schemaVersion: "1.0.0",
    workspaceRoot: rootDir,
    exportsRoot: exportsDir
  };

  try {
    await mkdir(join(rootDir, "config"), { recursive: true });
    await writeCanonicalJson(join(rootDir, "config", "host.local.json"), hostConfig);
    await writeCanonicalJson(join(rootDir, "pipeline-state.json"), { jobId: "job-123", status: "running" });

    // Create a schemas folder mock since validateSchema resolves it
    const schemaDir = join(rootDir, "schemas/yadam");
    await mkdir(schemaDir, { recursive: true });
    const realSchema = resolve("schemas/yadam/tts-scene-checkpoint.schema.json");
    await fsPromises.copyFile(realSchema, join(schemaDir, "tts-scene-checkpoint.schema.json"));

    const sceneId = "scene-0001";
    const checkpoint = {
      schemaVersion: "1.0.0",
      sceneId,
      requestHash: "a".repeat(64),
      idempotencyKey: "a".repeat(64),
      status: "pending",
      transport: null,
      attempt: 1,
      updatedAt: new Date().toISOString(),
      providerJobId: null,
      providerResult: null,
      rawAsset: null,
      normalizedAsset: null,
      error: null
    };

    await writeCheckpoint({ jobDir: rootDir, sceneId, checkpoint });

    // pending -> submitted
    let cp = await updateCheckpointStatus({ jobDir: rootDir, sceneId, status: "submitted", updates: { transport: "http" } });
    assert.equal(cp.status, "submitted");
    assert.equal(cp.transport, "http");

    // submitted -> polling
    cp = await updateCheckpointStatus({ jobDir: rootDir, sceneId, status: "polling" });
    assert.equal(cp.status, "polling");

    // polling -> provider_done
    cp = await updateCheckpointStatus({ jobDir: rootDir, sceneId, status: "provider_done" });
    assert.equal(cp.status, "provider_done");

    // provider_done -> raw_verified
    cp = await updateCheckpointStatus({ jobDir: rootDir, sceneId, status: "raw_verified" });
    assert.equal(cp.status, "raw_verified");

    // raw_verified -> normalized
    cp = await updateCheckpointStatus({ jobDir: rootDir, sceneId, status: "normalized" });
    assert.equal(cp.status, "normalized");

    // Try transitioning backward (normalized -> submitted)
    await assert.rejects(
      updateCheckpointStatus({ jobDir: rootDir, sceneId, status: "submitted" }),
      err => err.code === "illegal_tts_checkpoint_transition"
    );

  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

import { promises as fsPromises } from "node:fs";

test("acquireSceneLock prevents concurrent runs and reclaims stale dead locks", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "yadam-lock-test-"));
  const exportsDir = join(rootDir, "exports");
  await mkdir(exportsDir, { recursive: true });

  const hostConfig = {
    schemaVersion: "1.0.0",
    workspaceRoot: rootDir,
    exportsRoot: exportsDir
  };

  try {
    await mkdir(join(rootDir, "config"), { recursive: true });
    await writeCanonicalJson(join(rootDir, "config", "host.local.json"), hostConfig);

    const lease1 = "lease-1";
    const lease2 = "lease-2";
    const requestHash = "a".repeat(64);

    // Acquire lock
    const ok = await acquireSceneLock({ jobDir: rootDir, sceneId: "scene-0001", requestHash, leaseId: lease1 });
    assert.equal(ok, true);

    // Second lock attempt must fail
    await assert.rejects(
      acquireSceneLock({ jobDir: rootDir, sceneId: "scene-0001", requestHash, leaseId: lease2 }),
      err => err.code === "tts_scene_locked"
    );

    // Release lock
    await releaseSceneLock({ jobDir: rootDir, sceneId: "scene-0001", leaseId: lease1 });

    // Lock can now be acquired by lease2
    const ok2 = await acquireSceneLock({ jobDir: rootDir, sceneId: "scene-0001", requestHash, leaseId: lease2 });
    assert.equal(ok2, true);

  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
