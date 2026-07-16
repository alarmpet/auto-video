import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "sensitive-heart-grounding-"));
const scriptPath = join(dir, "script.txt");
const chaptersPath = join(dir, "chapters.json");

writeFileSync(chaptersPath, JSON.stringify([
  { index: 1, title: "같은 말도 더 아플 때", bibleRef: "사무엘상 1:6-7" },
], null, 2), "utf8");

writeFileSync(scriptPath, `
챕터 1. 같은 말도 더 아플 때

성경은 그 일이 해마다 반복되었다고 말합니다.
반복된 말은 마음에 길을 냅니다.
`, "utf8");

let failed = false;
try {
  execFileSync("node", [
    "scripts/check_bible_grounding.mjs",
    "--script",
    scriptPath,
    "--chapters",
    chaptersPath,
    "--min-citations-per-chapter",
    "1",
  ], { cwd: "C:/Users/petbl/auto-video", encoding: "utf8" });
} catch (error) {
  failed = true;
  const output = `${error.stdout || ""}${error.stderr || ""}`;
  assert.match(output, /chapter_1_missing_citation/u);
  assert.match(output, /vague_bible_claims/u);
}
assert.equal(failed, true, "current vague sensitive-heart style must fail bible grounding gate");

console.log("test_sensitive_heart_bible_grounding_regression: pass");
