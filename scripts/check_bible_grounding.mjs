#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { analyzeBibleGrounding } from "./lib/bible-grounding-analysis.mjs";

const options = parseArgs(process.argv.slice(2));
if (options.error || !options.scriptPath || !options.chaptersPath) {
  console.error(options.error || "Usage: node scripts/check_bible_grounding.mjs --script script.txt --chapters chapters.json [--min-citations-per-chapter 1]");
  process.exit(2);
}

const script = readFileSync(options.scriptPath, "utf8");
const chapters = JSON.parse(readFileSync(options.chaptersPath, "utf8"));
const report = analyzeBibleGrounding(script, {
  chapters,
  minCitationsPerChapter: options.minCitationsPerChapter,
});

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);

function parseArgs(args) {
  const parsed = { minCitationsPerChapter: 1 };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--script") parsed.scriptPath = readValue(args, ++index, arg);
    else if (arg === "--chapters") parsed.chaptersPath = readValue(args, ++index, arg);
    else if (arg === "--min-citations-per-chapter") parsed.minCitationsPerChapter = Number(readValue(args, ++index, arg));
  }
  if (!Number.isFinite(parsed.minCitationsPerChapter) || parsed.minCitationsPerChapter < 0) {
    return { error: "--min-citations-per-chapter must be a non-negative number" };
  }
  return parsed;
}

function readValue(args, index, optionName) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${optionName} requires a value`);
  return value;
}
