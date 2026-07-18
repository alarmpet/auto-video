import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("scale dry-run and live acceptance guard tests", async () => {
  // 1. Test Scale Dry-Run
  const scaleRes = await execFileAsync("node", ["scripts/run-yadam-scale-dry-run.mjs", "--minutes", "20,60"]);
  const lines = scaleRes.stdout.trim().split(/\r?\n/);
  
  assert.equal(lines.length >= 2, true);
  
  const report20 = JSON.parse(lines[0]);
  assert.equal(report20.minutes, 20);
  assert.equal(report20.expectedSegments, 2);
  assert.equal(report20.providerCalls, 0);
  assert.equal(report20.slotCapOk, true);

  const report60 = JSON.parse(lines[1]);
  assert.equal(report60.minutes, 60);
  assert.equal(report60.expectedSegments, 6);
  assert.equal(report60.providerCalls, 0);
  assert.equal(report60.slotCapOk, true);

  // 2. Test Live Acceptance Guard Negative Case
  try {
    await execFileAsync("node", ["scripts/run-yadam-live-acceptance.mjs", "--minutes", "10"]);
    assert.fail("Should have exited with code 2");
  } catch (err) {
    assert.equal(err.code, 2);
    const parsed = JSON.parse(err.stdout.trim());
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error, "live_confirmation_required");
  }
});
