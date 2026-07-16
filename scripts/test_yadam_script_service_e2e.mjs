// scripts/test_yadam_script_service_e2e.mjs
import assert from "node:assert/strict";
import * as scriptService from "./lib/yadam/script-service.mjs";

const EXPECTED_EXPORTS = [
  "generateConceptOptions",
  "selectConcept",
  "buildApprovalOneBundle",
  "approveConcept",
  "buildStoryBible",
  "buildScriptPlan",
  "draftNextSegment",
  "finalizeScriptPackage",
  "generateThumbnailPlan",
  "selectThumbnailCopy",
  "buildApprovalTwoBundle",
  "approveProduction",
  "getApprovedTtsInput",
  "getApprovedVisualPlanningInput",
  "requestDurationRepair",
  "rebuildApproval2AfterDurationRepair",
  "updateCoverageSection",
  "recordCompletedStoryFingerprint"
].sort();

async function runTest() {
  const actualExports = Object.keys(scriptService).sort();
  assert.deepEqual(actualExports, EXPECTED_EXPORTS);
  
  // Verify no default export
  assert.equal(scriptService.default, undefined);

  console.log("ok - yadam script service exports");
}

runTest().catch(err => {
  console.error(err);
  process.exit(1);
});
