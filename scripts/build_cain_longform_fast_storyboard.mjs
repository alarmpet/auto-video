#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deriveSceneCountForWindow } from "./lib/segment-plan.mjs";

const root = "C:/Users/petbl/auto-video";
const args = parseArgs(process.argv.slice(2));
const sourceSlug = args.sourceSlug || "gguljam-bible-cain-envy-60min-001";
const slug = args.slug || "gguljam-bible-cain-envy-60min-fast-001";
const sourceDir = join(root, "exports", sourceSlug);
const exportDir = join(root, "exports", slug);
mkdirSync(exportDir, { recursive: true });

const script = readFileSync(join(sourceDir, "script.txt"), "utf8").trim();
const sourceProduction = readJson(join(sourceDir, "production.json"), {});
const targetSeconds = Number(
  args.targetSeconds
  || sourceProduction?.render?.target_seconds
  || sourceProduction?.targetSeconds
  || (sourceProduction?.project?.target_minutes ? sourceProduction.project.target_minutes * 60 : 3600),
);
const requestedTargetVisualSeconds = Number(args.targetVisualSeconds || 30);
const bodySceneSeconds = Number(args.bodySceneSeconds || requestedTargetVisualSeconds);
const introSeconds = Number(args.introSeconds || 60);
const introSceneSeconds = Number(args.introSceneSeconds || 6);
const visualSceneCount = Number(args.scenes || deriveVisualSceneCount({
  targetSeconds,
  introSeconds,
  introSceneSeconds,
  bodySceneSeconds,
}));

const title = "Gguljam Bible - Cain envy longform";
const style = [
  "strict pure black and white only",
  "grayscale biblical oil painting",
  "heavy brush texture",
  "cinematic chiaroscuro",
  "ancient Near Eastern atmosphere",
  "quiet sleep documentary mood",
  "no color tint",
  "no purple",
  "no blue",
  "no readable text",
].join(", ");

const motifBank = [
  "ancient field with two distant stone altars under a dark sky",
  "rough hands holding dark soil beside quiet furrows",
  "lonely shepherd silhouette under pale dawn near a low hill",
  "two simple lamps burning at different brightness in a small tent",
  "stone threshold divided by shadow and light",
  "empty field with disturbed soil and no visible violence",
  "hand releasing a small stone into still moonlit water",
  "two separate camps resting under the same stars",
  "single traveler walking away from a cultivated field",
  "small clay bowl beside a fuller basket on rough ground",
  "quiet path splitting between dark hills and pale horizon",
  "open hands resting on soil beside a narrow road",
];

const cameraBank = [
  "wide establishing shot",
  "low close-up",
  "medium rear shot",
  "high wide angle",
  "symbolic still-life close shot",
  "slow centered composition",
];

const lightingBank = [
  "soft moonlit grayscale haze",
  "hard side light in monochrome",
  "pale dawn light",
  "small flickering firelight in grayscale",
  "thin overhead light",
  "soft pre-dawn glow",
];

const moodBank = [
  "quiet and contemplative",
  "hurt but restrained",
  "solemn and human",
  "restful and reflective",
  "searching and compassionate",
  "peaceful and consoling",
];

const motionBank = [
  "very slow push-in",
  "slow lateral pan",
  "locked-off with subtle breathing light",
  "slow pull-back",
  "slow tilt from hands to face",
  "gentle forward glide",
];

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--source-slug") parsed.sourceSlug = argv[++i];
    else if (arg === "--slug") parsed.slug = argv[++i];
    else if (arg === "--scenes") parsed.scenes = argv[++i];
    else if (arg === "--target-seconds") parsed.targetSeconds = argv[++i];
    else if (arg === "--target-visual-seconds") parsed.targetVisualSeconds = argv[++i];
    else if (arg === "--body-scene-seconds") parsed.bodySceneSeconds = argv[++i];
    else if (arg === "--intro-seconds") parsed.introSeconds = argv[++i];
    else if (arg === "--intro-scene-seconds") parsed.introSceneSeconds = argv[++i];
  }
  return parsed;
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function deriveVisualSceneCount({
  targetSeconds: seconds,
  introSeconds,
  introSceneSeconds,
  bodySceneSeconds,
}) {
  const target = Number.isFinite(seconds) && seconds > 0 ? seconds : 3600;
  const raw = deriveSceneCountForWindow({
    startSeconds: 0,
    durationSeconds: target,
    introSeconds,
    introSceneSeconds,
    bodySceneSeconds,
  });
  if (target >= 600) return Math.max(8, raw);
  return Math.max(3, raw);
}

function splitIntoUnits(text) {
  const paragraphs = text.split(/\n\s*\n/g).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length >= visualSceneCount) return paragraphs;
  return text
    .split(/(?<=[.!?])\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function splitIntoChunks(text, count) {
  const units = splitIntoUnits(text);
  const chunks = [];
  for (let i = 0; i < count; i += 1) {
    const start = Math.floor((i * units.length) / count);
    const end = Math.floor(((i + 1) * units.length) / count);
    const slice = units.slice(start, Math.max(start + 1, end));
    chunks.push(slice.join("\n\n").trim());
  }
  while (chunks.length < count && chunks.length > 0) {
    const longestIndex = chunks.reduce((best, chunk, index) => (
      chunk.length > chunks[best].length ? index : best
    ), 0);
    const parts = splitChunkInHalf(chunks[longestIndex]);
    chunks.splice(longestIndex, 1, ...parts);
  }
  if (chunks.length > count) {
    const tail = chunks.splice(count - 1).join("\n\n");
    chunks.push(tail);
  }
  return chunks.slice(0, count).map((chunk) => chunk.trim()).filter(Boolean);
}

function splitChunkInHalf(chunk) {
  const sentences = chunk.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length < 2) {
    const mid = Math.ceil(chunk.length / 2);
    return [chunk.slice(0, mid).trim(), chunk.slice(mid).trim()].filter(Boolean);
  }
  const mid = Math.ceil(sentences.length / 2);
  return [sentences.slice(0, mid).join(" "), sentences.slice(mid).join(" ")].filter(Boolean);
}

function chooseMotif(recentMotifs, lookback = 3) {
  const blocked = new Set(recentMotifs.slice(-lookback));
  const candidates = motifBank.filter((motif) => !blocked.has(motif));
  const pool = candidates.length ? candidates : motifBank;
  return pool[recentMotifs.length % pool.length];
}

const chunks = splitIntoChunks(script, visualSceneCount);
const recentMotifs = [];
const storyboard = [];

chunks.forEach((chunk, index) => {
  const motif = chooseMotif(recentMotifs, 3);
  recentMotifs.push(motif);
  const camera = cameraBank[index % cameraBank.length];
  const lighting = lightingBank[index % lightingBank.length];
  const mood = moodBank[index % moodBank.length];
  const motion = motionBank[index % motionBank.length];
  const prompt = `${motif}, ${style}`;
  storyboard.push(`[${chunk}]`);
  storyboard.push(`${prompt} / ${camera} / ${lighting} / ${mood} / ${motion}`);
  storyboard.push("");
});

writeFileSync(join(exportDir, "script.txt"), script + "\n", "utf8");
writeFileSync(join(exportDir, "hermes-manual-storyboard.md"), storyboard.join("\n"), "utf8");
writeFileSync(join(exportDir, "production.json"), JSON.stringify({
  title,
  channel: "gguljam-bible",
  sourceSlug,
  slug,
  targetSeconds,
  sceneCount: chunks.length,
  meaningfulChars: script.replace(/\s+/g, "").length,
  project: {
    channel: "gguljam-bible",
    slug,
    title,
    target_minutes: Math.round((targetSeconds / 60) * 100) / 100,
  },
  render: {
    engine: "hermes-studio",
    manual_storyboard: "hermes-manual-storyboard.md",
    target_seconds: targetSeconds,
    visual_mode: "contextual-keyframes",
    orientation: "landscape",
  },
  visualStyle: "strict pure black and white grayscale biblical oil painting",
}, null, 2), "utf8");
writeFileSync(join(exportDir, "visual-scene-report.json"), JSON.stringify({
  visualSceneCount: chunks.length,
  averageScriptCharsPerVisual: Math.round(script.length / Math.max(1, chunks.length)),
  targetSeconds,
  requestedTargetVisualSeconds,
  introSeconds,
  introSceneSeconds,
  bodySceneSeconds,
  actualTargetVisualSeconds: Math.round(targetSeconds / Math.max(1, chunks.length)),
  recentMotifLookback: 3,
}, null, 2), "utf8");

console.log(JSON.stringify({ exportDir, scenes: chunks.length, chars: script.length }, null, 2));
