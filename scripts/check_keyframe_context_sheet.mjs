#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
if (!args.segmentDir || !args.keyframesDir || !args.outDir) {
  console.error("Usage: node scripts/check_keyframe_context_sheet.mjs --segment-dir <dir> --keyframes-dir <dir> --out-dir <dir>");
  process.exit(2);
}

mkdirSync(args.outDir, { recursive: true });
const timeline = JSON.parse(readFileSync(join(args.segmentDir, "visual-timeline.json"), "utf8")).scenes || [];
const prompts = parseStoryboard(readFileSync(join(args.segmentDir, "hermes-manual-storyboard.md"), "utf8"));
const keyframeMap = collectKeyframes(args.keyframesDir);
const failures = [];

const scenes = timeline.map((scene, index) => {
  const order = scene.order || index + 1;
  const keyframePath = keyframeMap.get(order) || "";
  if (!keyframePath || !existsSync(keyframePath)) failures.push(`missing_keyframe:scene_${order}`);
  return {
    order,
    narration: scene.narration || prompts[index]?.narration || "",
    requiredPromptTerms: scene.requiredPromptTerms || [],
    prompt: prompts[index]?.prompt || "",
    keyframePath,
  };
});

if (timeline.length !== prompts.length) failures.push(`timeline_prompt_count_mismatch:${timeline.length}/${prompts.length}`);
if (keyframeMap.size < timeline.length) failures.push(`keyframe_count_too_low:${keyframeMap.size}/${timeline.length}`);

const sheetPath = join(args.outDir, "keyframe-context-sheet.jpg");
if (!failures.length && timeline.length > 0) {
  const orderedKeyframes = scenes.map((scene) => scene.keyframePath);
  const concatPath = join(args.outDir, "keyframe-list.txt");
  writeFileSync(
    concatPath,
    orderedKeyframes.map((path) => `file '${toFfmpegPath(path).replace(/'/g, "'\\''")}'`).join("\n"),
    "utf8",
  );
  const cols = Math.min(5, Math.max(1, timeline.length));
  const rows = Math.ceil(timeline.length / cols);
  execFileSync("ffmpeg", [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", concatPath,
    "-frames:v", String(timeline.length),
    "-vf", `scale=320:180,tile=${cols}x${rows}`,
    sheetPath,
  ], { stdio: "ignore" });
}

function toFfmpegPath(path) {
  return String(path || "").replace(/\\/g, "/");
}

const report = {
  ok: failures.length === 0,
  segmentDir: args.segmentDir,
  keyframesDir: args.keyframesDir,
  sheetPath: existsSync(sheetPath) ? sheetPath : null,
  failures,
  scenes,
};
writeFileSync(join(args.outDir, "keyframe-context-report.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify({ ok: report.ok, failures, sheetPath: report.sheetPath }, null, 2));
process.exit(report.ok ? 0 : 1);

function collectKeyframes(keyframesDir) {
  const map = new Map();
  for (const name of readdirSync(keyframesDir)) {
    const match = /^scene_(\d+)\.(png|jpg|jpeg)$/i.exec(name);
    if (!match) continue;
    const order = Number(match[1]);
    if (!Number.isFinite(order) || order <= 0) continue;
    if (!map.has(order)) map.set(order, join(keyframesDir, name));
  }
  return map;
}

function parseStoryboard(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const label = lines[index].trim();
    if (!/^\[.*\]$/.test(label)) continue;
    const narration = label.slice(1, -1);
    const promptLine = String(lines[index + 1] || "").trim();
    blocks.push({ narration, prompt: promptLine.split(/\s+\/\s+/)[0] || promptLine });
  }
  return blocks;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--segment-dir") parsed.segmentDir = argv[++i];
    else if (argv[i] === "--keyframes-dir") parsed.keyframesDir = argv[++i];
    else if (argv[i] === "--out-dir") parsed.outDir = argv[++i];
  }
  return parsed;
}
