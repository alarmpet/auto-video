import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "script-quality-bible-"));
const scriptPath = join(dir, "script.txt");
const wrongQuotePath = join(dir, "wrong-quote.txt");
const chaptersPath = join(dir, "chapters.json");

writeFileSync(chaptersPath, JSON.stringify([
  { index: 1, title: "반복된 말", bibleRef: "사무엘상 1:6-7" },
], null, 2), "utf8");

writeFileSync(scriptPath, `
챕터 1. 반복된 말

왜 같은 말도 어떤 밤에는 크게 들릴까요.
한나에게도 그랬습니다. 성경은 그 일이 해마다 반복되었다고 말합니다.
그 장면은 오늘 우리의 마음을 비춥니다.
그래서 오늘 밤에는 마음을 조금 쉬게 해도 됩니다.
`, "utf8");

let failed = false;
try {
  execFileSync("node", [
    "scripts/check_script_quality_suite.mjs",
    scriptPath,
    "--chapters",
    chaptersPath,
    "--min-chapters",
    "1",
    "--min-paragraphs",
    "1",
  ], { cwd: "C:/Users/petbl/auto-video", encoding: "utf8" });
} catch (error) {
  failed = true;
  const output = `${error.stdout || ""}${error.stderr || ""}`;
  assert.match(output, /bible_grounding:chapter_1_missing_citation/u);
}
assert.equal(failed, true, "quality suite must fail when bible grounding fails");

writeFileSync(wrongQuotePath, `
챕터 1. 반복된 말

왜 같은 말도 어떤 밤에는 크게 들릴까요.
사무엘상 1장 6절은 브닌나가 한나를 격동하게 했다고 말합니다.
[성경인용:사무엘상 1:6] "일부러 틀린 인용문입니다"
그 장면은 오늘 우리의 마음을 비춥니다.
그래서 오늘 밤에는 마음을 조금 쉬게 해도 됩니다.
`, "utf8");

failed = false;
try {
  execFileSync("node", [
    "scripts/check_script_quality_suite.mjs",
    wrongQuotePath,
    "--chapters",
    chaptersPath,
    "--min-chapters",
    "1",
    "--min-paragraphs",
    "1",
  ], { cwd: "C:/Users/petbl/auto-video", encoding: "utf8" });
} catch (error) {
  failed = true;
  const output = `${error.stdout || ""}${error.stderr || ""}`;
  assert.match(output, /bible_citation:사무엘상 1:6: quoted text does not match/u);
}
assert.equal(failed, true, "quality suite must fail when citation text is not verbatim KRV");

console.log("test_script_quality_bible_grounding: pass");
