#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const options = parseArgs(process.argv.slice(2));
if (options.error || !options.reportPath || !options.out) {
  console.error(options.error || "Usage: node scripts/generate_script_revision_brief.mjs <script-quality-suite-report.json> --out revision-brief.md");
  process.exit(2);
}

const report = JSON.parse(readFileSync(options.reportPath, "utf8"));
const lines = [];
lines.push("# Script Revision Brief");
lines.push("");
lines.push("## Objective");
lines.push("Rewrite the script so it keeps the same topic and calm sleep-friendly tone, but removes repeated phrasing, improves chapter progression, and gives each chapter a distinct emotional and interpretive function.");
lines.push("");
lines.push("## Hard Constraints");
lines.push("- Do not repeat the same opening phrase across chapters.");
lines.push("- Each chapter must introduce one new biblical observation, one modern psychology insight, and one gentle consolation.");
lines.push("- Avoid filler phrases such as '천천히 보면', '우리 마음은', '잠들기 전에는' more than twice per segment.");
lines.push("- Keep sentences calm, but vary sentence starts and paragraph shapes.");
lines.push("- Do not add claims that are not grounded in the biblical episode or clearly framed as interpretation.");
lines.push("- Each chapter must open with a fresh Hook, state one Point, dramatize one concrete Story beat, and close with a Lesson (HPSL).");
lines.push("");
lines.push("## Failures To Fix");
for (const failure of report.failures || []) lines.push(`- ${failure}`);
lines.push("");
lines.push("## Highest Overlap Paragraphs");
for (const overlap of report.semanticOverlap?.overlaps || []) {
  lines.push(`- Paragraph ${overlap.leftParagraph} and ${overlap.rightParagraph}, score ${overlap.score}`);
  lines.push(`  - A: ${overlap.leftPreview}`);
  lines.push(`  - B: ${overlap.rightPreview}`);
}
lines.push("");
lines.push("## Chapter Direction");
for (const chapter of report.structure?.chapters || []) {
  const keywords = (chapter.keywords || []).slice(0, 6).map((item) => item.word).join(", ");
  lines.push(`- Chapter ${chapter.index}: keep only the strongest idea. Current keywords: ${keywords}`);
}
lines.push("");
lines.push("## HPSL Weak Chapters");
for (const chapter of report.hpsl?.weakestChapters || []) {
  lines.push(`- Chapter ${chapter.index} (${chapter.title}): missing ${chapter.missing.join(", ")}`);
}
lines.push("");

if (report.bibleGrounding?.ok === false || report.failures?.some((item) => item.startsWith("bible_grounding:"))) {
  lines.push("## Bible Grounding Required");
  lines.push("- Do not write vague sentences like `성경은 ... 말합니다` without a concrete book/chapter/verse.");
  lines.push("- Each chapter must include at least one `[성경인용:책 장:절] \"원문\"` block from 개역한글판.");
  lines.push("- Immediately after each citation, explain how that verse maps to the listener's modern psychological situation.");
  lines.push("- `성경은 ... 말합니다`처럼 뭉뚱그리지 말고, 책/장/절을 먼저 밝힌 뒤 원문과 대입 해설을 이어 써.");
  for (const chapter of report.bibleGrounding?.chapterReports || []) {
    if (!chapter.ok) {
      lines.push(`- Chapter ${chapter.index} (${chapter.title}): add a concrete citation and interpretation from ${chapter.expectedRef}.`);
    }
  }
  lines.push("");
}

mkdirSync(dirname(options.out), { recursive: true });
writeFileSync(options.out, `${lines.join("\n")}\n`, "utf8");
console.log(options.out);

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!parsed.reportPath && !arg.startsWith("--")) parsed.reportPath = arg;
    else if (arg === "--out") parsed.out = readValue(args, ++index, arg);
  }
  return parsed;
}

function readValue(args, index, optionName) {
  const value = args[index];
  if (!value || value.startsWith("--")) return "";
  return value;
}
