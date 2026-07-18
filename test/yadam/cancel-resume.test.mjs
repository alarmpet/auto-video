import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { writeCanonicalJson } from "../../scripts/lib/pipeline/atomic-store.mjs";
import { sha256Bytes } from "../../scripts/lib/pipeline/canonical-json.mjs";
import { runCancelEngine } from "../../scripts/lib/pipeline/cancel-engine.mjs";
import { runResumeEngine } from "../../scripts/lib/pipeline/resume-engine.mjs";

test("cancel and resume engines E2E lifecycle", async () => {
  const tempJobDir = resolve(`test/yadam/tmp/cancel-ws-${Date.now()}`);
  await rm(tempJobDir, { recursive: true, force: true });
  await mkdir(tempJobDir, { recursive: true });

  try {
    // 1. Initial job setup
    const request = {
      schemaVersion: "1.0.0",
      jobId: "job-cancel-123",
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
      jobId: "job-cancel-123",
      status: "running",
      durationRepairAttemptsUsed: 0,
      history: []
    });
    await writeCanonicalJson(join(tempJobDir, "artifact-manifest.json"), {
      schemaVersion: "1.0.0",
      jobId: "job-cancel-123",
      artifacts: [
        {
          artifactId: "pipeline-request",
          logicalRole: "pipeline.request",
          path: "request.json",
          sha256: sha256Bytes(readFileSync(join(tempJobDir, "request.json"))),
          schemaVersion: "1.0.0",
          producerStage: "job-create",
          gateStatus: "pass",
          dependencyHashes: {},
          dependencyKinds: {},
          dependencyOwners: {}
        }
      ]
    });

    // 2. Create some dummy temp files
    await writeFile(join(tempJobDir, ".partial-rendering.part"), "incomplete video bytes");
    await writeFile(join(tempJobDir, "segment.tmp-123"), "temp bytes");

    // 3. Trigger Cancel Engine
    const cancelRes = await runCancelEngine({ jobDir: tempJobDir });
    assert.equal(cancelRes.status, "cancelled");
    assert.equal(cancelRes.quarantinedCount, 2);

    // Verify temp files were moved
    assert.equal(existsSync(join(tempJobDir, ".partial-rendering.part")), false);
    assert.equal(existsSync(join(tempJobDir, "segment.tmp-123")), false);

    // Verify state was set to cancelled
    const state = JSON.parse(readFileSync(join(tempJobDir, "pipeline-state.json"), "utf8"));
    assert.equal(state.status, "cancelled");

    // 4. Trigger Resume Engine
    const resumeRes = await runResumeEngine({ jobDir: tempJobDir });
    assert.equal(resumeRes.jobId, "job-cancel-123");
    assert.equal(resumeRes.status, "cancelled");

  } finally {
    await rm(tempJobDir, { recursive: true, force: true });
  }
});
