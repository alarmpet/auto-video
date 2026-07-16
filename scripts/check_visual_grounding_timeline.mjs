#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scorePromptContextAlignment } from "./lib/scene-context-card.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.segmentDir) {
  console.error("Usage: node scripts/check_visual_grounding_timeline.mjs --segment-dir <segment-dir>");
  process.exit(2);
}

const timelinePath = join(args.segmentDir, "visual-timeline.json");
const cardsPath = join(args.segmentDir, "visual-context-cards.json");
const groundingPath = join(args.segmentDir, "visual-grounding-report.json");
const storyboardPath = join(args.segmentDir, "hermes-manual-storyboard.md");
for (const path of [timelinePath, cardsPath, groundingPath, storyboardPath]) {
  if (!existsSync(path)) throw new Error(`Missing ${path}`);
}

const timeline = JSON.parse(readFileSync(timelinePath, "utf8")).scenes || [];
const cards = JSON.parse(readFileSync(cardsPath, "utf8")).scenes || [];
const grounding = JSON.parse(readFileSync(groundingPath, "utf8")).scenes || [];
const prompts = parseStoryboard(readFileSync(storyboardPath, "utf8"));
const failures = [];

if (timeline.length !== cards.length) failures.push(`timeline/card count mismatch:${timeline.length}/${cards.length}`);
if (timeline.length !== grounding.length) failures.push(`timeline/grounding count mismatch:${timeline.length}/${grounding.length}`);
if (timeline.length !== prompts.length) failures.push(`timeline/storyboard count mismatch:${timeline.length}/${prompts.length}`);

const scenes = timeline.map((scene, index) => {
  const card = cards[index] || {};
  const prompt = prompts[index]?.prompt || "";
  const promptLower = prompt.toLowerCase();
  const score = scorePromptContextAlignment({ card, prompt });
  const sceneFailures = [...score.failures];
  const sourceRequired = Array.isArray(scene.requiredPromptTerms) && scene.requiredPromptTerms.length
    ? scene.requiredPromptTerms
    : (card.requirements?.requiredPromptTerms || []);
  for (const term of sourceRequired) {
    if (term && !normalizedIncludes(prompt, term)) {
      sceneFailures.push(`missing_source_required_prompt_term:${term}`);
    }
  }
  const genericTerms = ["oil lamp", "family tent", "empty sleeping mat", "generic lone man", "generic dark road"];
  const genericCount = genericTerms.filter((term) => normalizedIncludes(prompt, term)).length;
  const sourceHitCount = sourceRequired.filter((term) => normalizedIncludes(prompt, term)).length;
  if (sourceRequired.length >= 2 && genericCount >= 2 && sourceHitCount === 0) {
    sceneFailures.push("generic_prompt_without_source_anchor");
  }

  if (scene.timingBand === "opening" && Number(scene.durationSeconds) > 6.5) {
    sceneFailures.push(`opening_duration_too_long:${scene.durationSeconds}`);
  }
  if (scene.timingBand === "body" && index < timeline.length - 1) {
    if (Number(scene.durationSeconds) < 20) sceneFailures.push(`body_duration_too_short:${scene.durationSeconds}`);
    if (Number(scene.durationSeconds) > 40.5) sceneFailures.push(`body_duration_too_long:${scene.durationSeconds}`);
  }

  const keywordHits = (scene.keywords || []).filter((keyword) => promptLower.includes(String(keyword).toLowerCase()));
  const requiredHits = sourceRequired.filter((term) => normalizedIncludes(prompt, term));
  const coverageDenominator = Math.max(1, (scene.keywords || []).length + sourceRequired.length);
  const coverageRatio = (keywordHits.length + requiredHits.length) / coverageDenominator;
  const sourceRequiredFullyCovered = sourceRequired.length > 0 && requiredHits.length === sourceRequired.length;
  if (!sourceRequiredFullyCovered && (scene.keywords || []).length >= 2 && sourceRequired.length && coverageRatio < 0.25) {
    sceneFailures.push(`low_chunk_keyword_coverage:${coverageRatio.toFixed(2)}:${[...(scene.keywords || []), ...sourceRequired].join("|")}`);
  }

  if (sceneFailures.length) failures.push(`scene_${index + 1}:${sceneFailures.join(",")}`);
  return {
    order: scene.order || index + 1,
    timingBand: scene.timingBand,
    durationSeconds: scene.durationSeconds,
    keywords: scene.keywords || [],
    prompt,
    score: score.score,
    keywordHits,
    requiredHits,
    coverageRatio: Number(coverageRatio.toFixed(3)),
    ok: sceneFailures.length === 0,
    failures: sceneFailures,
  };
});

const report = {
  ok: failures.length === 0,
  segmentDir: args.segmentDir,
  sceneCount: timeline.length,
  failures,
  scenes,
};
writeFileSync(join(args.segmentDir, "visual-grounding-timeline-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: report.ok, sceneCount: report.sceneCount, failures }, null, 2));
process.exit(report.ok ? 0 : 1);

function parseStoryboard(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const label = lines[index].trim();
    if (!/^\[.*\]$/.test(label)) continue;
    const promptLine = String(lines[index + 1] || "").trim();
    blocks.push({ label, prompt: promptLine.split(/\s+\/\s+/)[0] || promptLine });
  }
  return blocks;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--segment-dir") parsed.segmentDir = argv[++index];
  }
  return parsed;
}

function normalizedIncludes(haystack, needle) {
  return normalizeForMatch(haystack).includes(normalizeForMatch(needle));
}

function normalizeForMatch(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
