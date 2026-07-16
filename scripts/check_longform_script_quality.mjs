#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { assertLongformScriptQuality } from "./lib/quality-gates.mjs";

const options = parseArgs(process.argv.slice(2));
if (options.error) {
  console.error(options.error);
  process.exit(2);
}
if (!options.scriptPath) {
  console.error("Usage: node scripts/check_longform_script_quality.mjs <script.txt> [--out report.json] [--min-paragraphs n] [--segment-seconds n]");
  process.exit(2);
}

const minParagraphs = options.minParagraphs ?? minParagraphsForSeconds(options.segmentSeconds);
const text = readFileSync(options.scriptPath, "utf8");
const report = assertLongformScriptQuality(text, { minParagraphs });
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
    else if (arg === "--out") {
      parsed.out = readOptionValue(args, ++index, arg);
      if (!parsed.out) return { error: `${arg} requires a value` };
    } else if (arg === "--min-paragraphs") {
      const raw = readOptionValue(args, ++index, arg);
      if (!raw) return { error: `${arg} requires a numeric value` };
      parsed.minParagraphs = Number(raw);
      if (!Number.isFinite(parsed.minParagraphs)) return { error: `${arg} must be numeric` };
    } else if (arg === "--segment-seconds") {
      const raw = readOptionValue(args, ++index, arg);
      if (!raw) return { error: `${arg} requires a numeric value` };
      parsed.segmentSeconds = Number(raw);
      if (!Number.isFinite(parsed.segmentSeconds)) return { error: `${arg} must be numeric` };
    }
  }
  return parsed;
}

function readOptionValue(args, index, optionName) {
  const value = args[index];
  if (!value || value.startsWith("--")) return "";
  return value;
}

export function minParagraphsForSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 90;
  return Math.max(18, Math.round(seconds / 30));
}
