#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scorePromptContextAlignment } from "./lib/scene-context-card.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.segmentDir) {
  console.error("Usage: node scripts/check_storyboard_context_alignment.mjs --segment-dir <segment-dir>");
  process.exit(2);
}

const cardsPath = join(args.segmentDir, "visual-context-cards.json");
const storyboardPath = join(args.segmentDir, "hermes-manual-storyboard.md");
if (!existsSync(cardsPath)) throw new Error(`Missing ${cardsPath}`);
if (!existsSync(storyboardPath)) throw new Error(`Missing ${storyboardPath}`);

const cards = JSON.parse(readFileSync(cardsPath, "utf8")).scenes || [];
const prompts = parsePrompts(readFileSync(storyboardPath, "utf8"));
const scenes = cards.map((card, index) => {
  const prompt = prompts[index]?.prompt || "";
  const score = scorePromptContextAlignment({ card, prompt });
  return {
    order: card.order,
    sourceAnchors: card.requirements?.sourceAnchors || [],
    requiredPromptTerms: card.requirements?.requiredPromptTerms || [],
    prompt,
    ...score,
  };
});

const failures = scenes.filter((scene) => !scene.ok).map((scene) => ({
  order: scene.order,
  failures: scene.failures,
}));
const report = {
  ok: failures.length === 0,
  segmentDir: args.segmentDir,
  sceneCount: scenes.length,
  promptCount: prompts.length,
  minScore: scenes.length ? Math.min(...scenes.map((scene) => scene.score)) : 0,
  failures,
  scenes,
};

writeFileSync(join(args.segmentDir, "storyboard-context-alignment-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: report.ok, sceneCount: report.sceneCount, minScore: report.minScore, failures }, null, 2));
process.exit(report.ok ? 0 : 1);

function parsePrompts(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const prompts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (/^\[.*\]$/.test(line)) {
      const promptLine = String(lines[index + 1] || "").trim();
      prompts.push({ label: line, prompt: promptLine.split(/\s+\/\s+/)[0] || promptLine });
    }
  }
  return prompts;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--segment-dir") parsed.segmentDir = argv[++index];
  }
  return parsed;
}
