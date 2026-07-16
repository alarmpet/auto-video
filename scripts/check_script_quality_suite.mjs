#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { assertLongformScriptQuality } from "./lib/quality-gates.mjs";
import { analyzeScriptStructure } from "./lib/script-structure-analysis.mjs";
import { analyzeSemanticOverlap } from "./lib/semantic-overlap-analysis.mjs";
import { analyzeScriptHpsl } from "./lib/hpsl-structure-analysis.mjs";
import { analyzePhase3ScriptQuality } from "./lib/phase3-script-quality.mjs";
import { analyzeBibleGrounding, extractCitationBlocks } from "./lib/bible-grounding-analysis.mjs";
import { lookupVerses } from "./lib/bible-reference.mjs";

const options = parseArgs(process.argv.slice(2));
if (options.error || !options.scriptPath) {
  console.error(options.error || "Usage: node scripts/check_script_quality_suite.mjs <script.txt> --out report.json");
  process.exit(2);
}

const text = readFileSync(options.scriptPath, "utf8");
const repetition = assertLongformScriptQuality(text, {
  minParagraphs: options.minParagraphs ?? 18,
});
const structure = analyzeScriptStructure(text, {
  minChapters: options.minChapters ?? 4,
  inferChapters: options.inferChapters !== false,
});
const semanticOverlap = analyzeSemanticOverlap(text, {
  threshold: options.semanticThreshold ?? 0.82,
});
const hpsl = analyzeScriptHpsl(text, {
  minChapterPassRate: options.minHpslPassRate ?? 0.8,
  minChapters: options.minChapters ?? 4,
  inferChapters: options.inferChapters !== false,
});
const phase3 = analyzePhase3ScriptQuality(text, {
  minConcreteRatio: options.phase3MinConcreteRatio ?? 0.08,
  minConcreteHits: options.phase3MinConcreteHits ?? 2,
  maxRepeatedPointRatio: options.phase3MaxRepeatedPointRatio ?? 0.28,
  minTensionStages: options.phase3MinTensionStages ?? 4,
  minSecondPersonTouchpoints: options.phase3MinSecondPersonTouchpoints ?? 3,
});
const chapters = options.chaptersPath
  ? JSON.parse(readFileSync(options.chaptersPath, "utf8"))
  : [];
const bibleGrounding = chapters.length
  ? analyzeBibleGrounding(text, {
    chapters,
    minCitationsPerChapter: options.minBibleCitationsPerChapter ?? 1,
  })
  : { ok: true, failures: [], citationCount: 0, chapterReports: [], skipped: true };
const bibleCitation = analyzeBibleCitationText(text);

const failures = [
  ...repetition.failures.map((value) => `repetition:${value}`),
  ...structure.failures.map((value) => `structure:${value}`),
  ...(semanticOverlap.ok ? [] : semanticOverlap.overlaps.map((value) => `semantic_overlap:p${value.leftParagraph}-p${value.rightParagraph}:${value.score}`)),
  ...(hpsl.ok ? [] : hpsl.failures.map((value) => `hpsl:${value}`)),
  ...phase3.failures.map((value) => `phase3:${value}`),
  ...bibleGrounding.failures.map((value) => `bible_grounding:${value}`),
  ...bibleCitation.failures.map((value) => `bible_citation:${value}`),
];

const report = {
  ok: failures.length === 0,
  failures,
  repetition,
  structure,
  semanticOverlap,
  hpsl,
  phase3,
  bibleGrounding,
  bibleCitation,
};

if (options.out) {
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, JSON.stringify(report, null, 2), "utf8");
}
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!parsed.scriptPath && !arg.startsWith("--")) parsed.scriptPath = arg;
    else if (arg === "--out") parsed.out = readValue(args, ++index, arg);
    else if (arg === "--min-paragraphs") parsed.minParagraphs = Number(readValue(args, ++index, arg));
    else if (arg === "--min-chapters") parsed.minChapters = Number(readValue(args, ++index, arg));
    else if (arg === "--semantic-threshold") parsed.semanticThreshold = Number(readValue(args, ++index, arg));
    else if (arg === "--min-hpsl-pass-rate") parsed.minHpslPassRate = Number(readValue(args, ++index, arg));
    else if (arg === "--no-infer-chapters") parsed.inferChapters = false;
    else if (arg === "--phase3-min-concrete-ratio") parsed.phase3MinConcreteRatio = Number(readValue(args, ++index, arg));
    else if (arg === "--phase3-min-concrete-hits") parsed.phase3MinConcreteHits = Number(readValue(args, ++index, arg));
    else if (arg === "--phase3-max-repeated-point-ratio") parsed.phase3MaxRepeatedPointRatio = Number(readValue(args, ++index, arg));
    else if (arg === "--phase3-min-tension-stages") parsed.phase3MinTensionStages = Number(readValue(args, ++index, arg));
    else if (arg === "--phase3-min-second-person-touchpoints") parsed.phase3MinSecondPersonTouchpoints = Number(readValue(args, ++index, arg));
    else if (arg === "--chapters") parsed.chaptersPath = readValue(args, ++index, arg);
    else if (arg === "--min-bible-citations-per-chapter") parsed.minBibleCitationsPerChapter = Number(readValue(args, ++index, arg));
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (key !== "scriptPath" && key !== "out" && key !== "chaptersPath" && value !== undefined && !Number.isFinite(value)) {
      return { error: `${key} must be numeric` };
    }
  }
  return parsed;
}

function readValue(args, index, optionName) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${optionName} requires a value`);
  return value;
}

function analyzeBibleCitationText(text) {
  const citationBlocks = extractCitationBlocks(text);
  const failures = [];
  for (const block of citationBlocks) {
    try {
      const { verses } = lookupVerses(block.reference);
      const expected = verses.map((v) => v.text).join(" ");
      if (normalizeQuote(block.quote) !== normalizeQuote(expected)) {
        failures.push(`${block.reference}: quoted text does not match 개역한글판 source verbatim`);
      }
    } catch (error) {
      failures.push(`${block.reference}: ${error.message}`);
    }
  }
  return {
    ok: failures.length === 0,
    failures,
    citationCount: citationBlocks.length,
  };
}

function normalizeQuote(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/[“”‘’]/gu, "\"")
    .replace(/\s+/g, " ")
    .trim();
}
