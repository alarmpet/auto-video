#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { analyzeScriptHpsl } from "./lib/hpsl-structure-analysis.mjs";

const options = parseArgs(process.argv.slice(2));
if (!options.scriptPath) {
  console.error("Usage: node scripts/check_hpsl_structure.mjs <script.txt> [--out report.json] [--min-pass-rate 0.8]");
  process.exit(2);
}

const text = readFileSync(options.scriptPath, "utf8");
const report = analyzeScriptHpsl(text, { minChapterPassRate: options.minPassRate ?? 0.8 });

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
    else if (arg === "--out") parsed.out = args[++index];
    else if (arg === "--min-pass-rate") parsed.minPassRate = Number(args[++index]);
  }
  return parsed;
}
