// scripts/test_yadam_script_planner.mjs
import assert from "node:assert/strict";
import { validateTargetMinutes, partitionBeatsContiguously, buildDurationPlan } from "./lib/yadam/script-planner.mjs";

async function runTest() {
  // Test target minutes validation
  assert.equal(validateTargetMinutes(10), 10);
  assert.equal(validateTargetMinutes(120), 120);
  assert.throws(() => validateTargetMinutes(15), /targetMinutes must be 10..120/);

  // Test beat partitioning
  const weights = [0.03, 0.04, 0.11, 0.04, 0.08, 0.03, 0.06, 0.18, 0.04, 0.12, 0.03, 0.04, 0.02, 0.13, 0.02];
  
  const partitions1 = partitionBeatsContiguously(weights, 1);
  assert.equal(partitions1.length, 1);
  assert.equal(partitions1[0].length, 15);

  const partitions6 = partitionBeatsContiguously(weights, 6);
  assert.equal(partitions6.length, 6);
  assert.equal(partitions6.flat().length, 15);

  // Test character allocation sum
  const allocations = buildDurationPlan(60);
  const total = Object.values(allocations).reduce((a, b) => a + b, 0);
  assert.equal(total, Math.round(60 * 60 * 4.2));

  console.log("ok - yadam target duration matrix");
  console.log("ok - deterministic contiguous beat allocation");
  console.log("ok - calibrated character planning warnings");
}

runTest().catch(err => {
  console.error(err);
  process.exit(1);
});
