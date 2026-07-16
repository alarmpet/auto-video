import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "revision-brief-bible-"));
const reportPath = join(dir, "script-quality-suite-report.json");
const outPath = join(dir, "script-revision-brief.md");

writeFileSync(reportPath, JSON.stringify({
  ok: false,
  failures: [
    "bible_grounding:chapter_1_missing_citation",
    "bible_grounding:vague_bible_claims:2",
  ],
  bibleGrounding: {
    chapterReports: [
      { index: 1, title: "같은 말도 더 아플 때", expectedRef: "사무엘상 1:6-7", citationCount: 0, ok: false },
    ],
  },
}, null, 2), "utf8");

execFileSync("node", [
  "scripts/generate_script_revision_brief.mjs",
  reportPath,
  "--out",
  outPath,
], { cwd: "C:/Users/petbl/auto-video", encoding: "utf8" });

const brief = readFileSync(outPath, "utf8");
assert.match(brief, /사무엘상 1:6-7/u);
assert.match(brief, /성경인용/u);
assert.match(brief, /성경은.*말합니다.*처럼 뭉뚱그리지/u);

console.log("test_revision_brief_bible_grounding: pass");
