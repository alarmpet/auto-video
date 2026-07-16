// scripts/run-yadam-script-tests.mjs
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const expected = [
  "test_yadam_approval_one.mjs",
  "test_yadam_approval_two.mjs",
  "test_yadam_canonical_script.mjs",
  "test_yadam_codex_stage_adapter.mjs",
  "test_yadam_concept_service.mjs",
  "test_yadam_coverage_service.mjs",
  "test_yadam_duration_repair.mjs",
  "test_yadam_reference_data.mjs",
  "test_yadam_scene_thumbnail_planning.mjs",
  "test_yadam_script_planner.mjs",
  "test_yadam_script_service_e2e.mjs",
  "test_yadam_script_validators.mjs",
  "test_yadam_segment_drafting.mjs",
  "test_yadam_selection_services.mjs",
  "test_yadam_story_bible.mjs",
];
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const discovered = (await readdir(scriptsDir))
  .filter((name) => /^test_yadam_[a-z0-9_]+\.mjs$/u.test(name))
  .sort();
if (JSON.stringify(discovered) !== JSON.stringify(expected)) {
  throw new Error(`yadam script test set mismatch\nexpected=${JSON.stringify(expected)}\nactual=${JSON.stringify(discovered)}`);
}
for (const name of expected) {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(scriptsDir, name)], {
      cwd: join(scriptsDir, ".."),
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  if (exitCode !== 0) process.exit(exitCode);
}
console.log(`ok - ${expected.length} yadam script test files`);
