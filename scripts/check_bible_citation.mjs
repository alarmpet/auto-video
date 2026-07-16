#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { lookupVerses, parseReference } from "./lib/bible-reference.mjs";
import { extractCitationBlocks } from "./lib/bible-grounding-analysis.mjs";

const options = parseArgs(process.argv.slice(2));
if (options.error || !options.scriptPath) {
  console.error(options.error || "Usage: node scripts/check_bible_citation.mjs <script.txt> [--min-citations n] [--require-reference \"사무엘상 1:6\"]");
  process.exit(2);
}

const text = readFileSync(options.scriptPath, "utf8");
const citationBlocks = extractCitationBlocks(text);
const failures = [];

if (citationBlocks.length < options.minCitations) {
  failures.push(`citation_count_too_low:${citationBlocks.length}<${options.minCitations}`);
}

const normalizedPresent = new Set(citationBlocks.map((block) => normalizeReference(block.reference)));
for (const required of options.requiredReferences) {
  if (!normalizedPresent.has(normalizeReference(required))) {
    failures.push(`missing_required_reference:${required}`);
  }
}

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

const result = { ok: failures.length === 0, failures, citationCount: citationBlocks.length };
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

function normalizeQuote(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/[“”‘’]/gu, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeReference(reference) {
  const parsed = parseReference(reference);
  return `${parsed.book} ${parsed.chapter}:${parsed.startVerse}${parsed.endVerse !== parsed.startVerse ? `-${parsed.endVerse}` : ""}`;
}

function parseArgs(args) {
  const parsed = { scriptPath: "", minCitations: 0, requiredReferences: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!parsed.scriptPath && !arg.startsWith("--")) parsed.scriptPath = arg;
    else if (arg === "--min-citations") parsed.minCitations = Number(readValue(args, ++index, arg));
    else if (arg === "--require-reference") parsed.requiredReferences.push(readValue(args, ++index, arg));
  }
  if (!Number.isFinite(parsed.minCitations) || parsed.minCitations < 0) {
    return { error: "--min-citations must be a non-negative number" };
  }
  return parsed;
}

function readValue(args, index, optionName) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${optionName} requires a value`);
  return value;
}
