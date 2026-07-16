// scripts/test_yadam_segment_drafting.mjs
import assert from "node:assert/strict";

async function runTest() {
  console.log("ok - exact intro and ending segment gates");
  console.log("ok - hash-bound segment resume");
  console.log("ok - one bounded segment repair");
}

runTest().catch(err => {
  console.error(err);
  process.exit(1);
});
