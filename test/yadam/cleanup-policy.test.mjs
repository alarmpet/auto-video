import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { writeCanonicalJson } from "../../scripts/lib/pipeline/atomic-store.mjs";
import { sha256Bytes } from "../../scripts/lib/pipeline/canonical-json.mjs";
import { planCleanup, executeCleanup } from "../../scripts/lib/pipeline/cleanup-policy.mjs";

test("cleanup containment and Floor protection rules E2E", async () => {
  const tempJobDir = resolve(`test/yadam/tmp/cleanup-ws-${Date.now()}`);
  await rm(tempJobDir, { recursive: true, force: true });
  await mkdir(tempJobDir, { recursive: true });

  try {
    // 1. Setup Request & Config
    const request = { schemaVersion: "1.0.0", jobId: "job-cleanup-123" };
    await writeCanonicalJson(join(tempJobDir, "request.json"), request);
    await writeCanonicalJson(join(tempJobDir, "pipeline-state.json"), { schemaVersion: "1.0.0", jobId: "job-cleanup-123" });
    
    // Register some passed artifacts
    await mkdir(join(tempJobDir, "planning"), { recursive: true });
    await writeFile(join(tempJobDir, "planning/concept-options.json"), "{}");
    const optionsHash = sha256Bytes(readFileSync(join(tempJobDir, "planning/concept-options.json")));

    await writeCanonicalJson(join(tempJobDir, "artifact-manifest.json"), {
      schemaVersion: "1.0.0",
      jobId: "job-cleanup-123",
      artifacts: [
        {
          artifactId: "yadam-concept-options",
          logicalRole: "yadam.concept.options",
          path: "planning/concept-options.json",
          sha256: optionsHash,
          schemaVersion: "1.0.0",
          producerStage: "concept-generation",
          gateStatus: "pass",
          dependencyHashes: {},
          dependencyKinds: {},
          dependencyOwners: {}
        }
      ]
    });

    // 2. Write temp files (should be deleted)
    await writeFile(join(tempJobDir, "planning/temp.tmp-123"), "temp");
    await writeFile(join(tempJobDir, "planning/partial.part"), "partial");
    await mkdir(join(tempJobDir, "quarantine"), { recursive: true });
    await writeFile(join(tempJobDir, "quarantine/bad-audio.wav"), "bad audio");

    // 3. Write final outputs (protected, should NOT be deleted)
    await mkdir(join(tempJobDir, "final"), { recursive: true });
    await writeFile(join(tempJobDir, "final/final-full.mp4"), "full video");

    // 4. Run planCleanup
    const plan = await planCleanup({ jobDir: tempJobDir });
    
    assert.equal(plan.items.length, 3);
    assert.equal(plan.items.some(i => i.path === "planning/temp.tmp-123"), true);
    assert.equal(plan.items.some(i => i.path === "planning/partial.part"), true);
    assert.equal(plan.items.some(i => i.path === "quarantine"), true);

    // Verify final-full.mp4 is NOT in the plan
    assert.equal(plan.items.some(i => i.path.includes("final-full")), false);

    // 5. Test executeCleanup with hash mismatch (should fail)
    try {
      await executeCleanup(plan, { confirmationHash: "wrong-hash" });
      assert.fail("Should have failed for hash mismatch");
    } catch (err) {
      assert.equal(err.code, "confirmation_hash_mismatch");
    }

    // 6. Test executeCleanup with correct hash (should succeed)
    const cleanupRes = await executeCleanup(plan, { confirmationHash: plan.planHash });
    assert.equal(cleanupRes.deletedCount, 3);

    // Verify temp files deleted
    assert.equal(existsSync(join(tempJobDir, "planning/temp.tmp-123")), false);
    assert.equal(existsSync(join(tempJobDir, "planning/partial.part")), false);
    assert.equal(existsSync(join(tempJobDir, "quarantine/bad-audio.wav")), false);

    // Verify protected files exist
    assert.equal(existsSync(join(tempJobDir, "request.json")), true);
    assert.equal(existsSync(join(tempJobDir, "final/final-full.mp4")), true);
    assert.equal(existsSync(join(tempJobDir, "planning/concept-options.json")), true);

  } finally {
    await rm(tempJobDir, { recursive: true, force: true });
  }
});
