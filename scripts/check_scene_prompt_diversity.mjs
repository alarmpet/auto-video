#!/usr/bin/env node
// Scene prompt diversity gate.
//
// v1 storyboards passed alignment checks while all 28 prompts were near
// copies of one template — the direct cause of "all images look the same".
// This gate measures cross-scene similarity and fails on template collapse.
//
// Checks per segment:
//  1. Adjacent prompt Jaccard similarity (style tail stripped) — avg and max
//  2. Distinct settings across the segment (from visual-context-cards.json)
//  3. Max run of consecutive scenes sharing the same setting
//  4. Duplicate visual anchors
//
// Usage:
//   node scripts/check_scene_prompt_diversity.mjs --export-dir <segmented-export>
//     [--max-adjacent-jaccard 0.75] [--max-avg-jaccard 0.6]
//     [--min-distinct-settings 3] [--max-setting-run 5] [--out <report.json>]

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = parseArgs(process.argv.slice(2));
if (!args.exportDir) {
  console.error("Usage: node scripts/check_scene_prompt_diversity.mjs --export-dir <export-dir>");
  process.exit(2);
}
const MAX_ADJACENT = Number(args.maxAdjacentJaccard ?? 0.75);
const MAX_AVG = Number(args.maxAvgJaccard ?? 0.6);
const MIN_SETTINGS = Number(args.minDistinctSettings ?? 3);
const MAX_RUN = Number(args.maxSettingRun ?? 5);

const segmentDirs = findSegmentDirs(args.exportDir);
if (!segmentDirs.length) {
  console.error(`No segments with hermes-manual-storyboard.md found under ${args.exportDir}`);
  process.exit(2);
}

const failures = [];
const segments = [];

for (const segmentDir of segmentDirs) {
  const storyboard = readFileSync(join(segmentDir, "hermes-manual-storyboard.md"), "utf8");
  const prompts = parseStoryboardPrompts(storyboard);
  if (prompts.length < 2) continue;

  const styleTail = commonSuffixTokens(prompts);
  const tokenSets = prompts.map((prompt) => tokenize(prompt, styleTail));

  let adjacentSum = 0;
  let adjacentMax = 0;
  const adjacentScores = [];
  for (let i = 1; i < tokenSets.length; i += 1) {
    const score = jaccard(tokenSets[i - 1], tokenSets[i]);
    adjacentScores.push(Number(score.toFixed(3)));
    adjacentSum += score;
    adjacentMax = Math.max(adjacentMax, score);
  }
  const adjacentAvg = adjacentSum / (tokenSets.length - 1);

  const cardResult = readCards(segmentDir);
  const cards = cardResult.cards;
  const settings = cards.map((card) => card.setting).filter(Boolean);
  const distinctSettings = new Set(settings).size;
  const settingRun = maxRun(settings);
  const anchors = cards.map((card) => card.visualAnchor).filter(Boolean);
  const duplicateAnchors = anchors.length - new Set(anchors).size;

  const segmentReport = {
    segmentDir,
    promptCount: prompts.length,
    contextCardCount: cards.length,
    styleTailTokens: styleTail.size,
    adjacentJaccardAvg: Number(adjacentAvg.toFixed(3)),
    adjacentJaccardMax: Number(adjacentMax.toFixed(3)),
    adjacentScores,
    distinctSettings,
    maxSettingRun: settingRun,
    duplicateVisualAnchors: duplicateAnchors,
  };
  segments.push(segmentReport);

  if (!cardResult.exists) failures.push({ segmentDir, type: "missing_visual_context_cards", value: 0, limit: prompts.length });
  else if (cards.length !== prompts.length) failures.push({ segmentDir, type: "context_card_count_mismatch", value: cards.length, limit: prompts.length });
  if (adjacentAvg > MAX_AVG) failures.push({ segmentDir, type: "avg_prompt_similarity_too_high", value: segmentReport.adjacentJaccardAvg, limit: MAX_AVG });
  if (adjacentMax > MAX_ADJACENT) failures.push({ segmentDir, type: "adjacent_prompt_similarity_too_high", value: segmentReport.adjacentJaccardMax, limit: MAX_ADJACENT });
  if (settings.length && distinctSettings < MIN_SETTINGS) failures.push({ segmentDir, type: "too_few_distinct_settings", value: distinctSettings, limit: MIN_SETTINGS });
  if (settingRun > MAX_RUN) failures.push({ segmentDir, type: "setting_run_too_long", value: settingRun, limit: MAX_RUN });
  if (duplicateAnchors > 0) failures.push({ segmentDir, type: "duplicate_visual_anchors", value: duplicateAnchors, limit: 0 });
}

const report = {
  exportDir: args.exportDir,
  thresholds: { MAX_ADJACENT, MAX_AVG, MIN_SETTINGS, MAX_RUN },
  segments,
  failures,
  ok: failures.length === 0,
};
if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

function findSegmentDirs(exportDir) {
  const direct = join(exportDir, "hermes-manual-storyboard.md");
  if (existsSync(direct)) return [exportDir];
  const segmentsRoot = join(exportDir, "segments");
  if (!existsSync(segmentsRoot)) return [];
  return readdirSync(segmentsRoot)
    .map((entry) => join(segmentsRoot, entry))
    .filter((dir) => existsSync(join(dir, "hermes-manual-storyboard.md")));
}

function parseStoryboardPrompts(storyboard) {
  // Prompt lines follow each [narration] line and contain "/ duration:".
  return storyboard
    .split(/\r?\n/)
    .filter((line) => line.includes("/ duration:") && !line.trim().startsWith("["));
}

function tokenize(prompt, excludeTokens = new Set()) {
  const withoutDirectives = prompt.split(" / ")[0]; // similarity on content, not camera/motion tags
  return new Set(
    withoutDirectives
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((token) => token.length >= 3 && !excludeTokens.has(token)),
  );
}

// Tokens present in EVERY prompt are the shared style block; excluding them
// makes the metric measure scene-specific variation only.
function commonSuffixTokens(prompts) {
  let common = null;
  for (const prompt of prompts) {
    const tokens = tokenize(prompt);
    if (common === null) common = new Set(tokens);
    else for (const token of [...common]) if (!tokens.has(token)) common.delete(token);
  }
  return common || new Set();
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function maxRun(values) {
  let best = 0;
  let run = 0;
  let previous = null;
  for (const value of values) {
    run = value === previous ? run + 1 : 1;
    previous = value;
    best = Math.max(best, run);
  }
  return best;
}

function readCards(segmentDir) {
  const path = join(segmentDir, "visual-context-cards.json");
  if (!existsSync(path)) return { exists: false, cards: [] };
  try {
    return { exists: true, cards: JSON.parse(readFileSync(path, "utf8")).scenes || [] };
  } catch {
    return { exists: true, cards: [] };
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--export-dir") parsed.exportDir = argv[++i];
    else if (argv[i] === "--max-adjacent-jaccard") parsed.maxAdjacentJaccard = argv[++i];
    else if (argv[i] === "--max-avg-jaccard") parsed.maxAvgJaccard = argv[++i];
    else if (argv[i] === "--min-distinct-settings") parsed.minDistinctSettings = argv[++i];
    else if (argv[i] === "--max-setting-run") parsed.maxSettingRun = argv[++i];
    else if (argv[i] === "--out") parsed.out = argv[++i];
  }
  return parsed;
}
