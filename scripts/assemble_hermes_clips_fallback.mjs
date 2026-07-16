#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const options = parseArgs(process.argv.slice(2));
if (!options.jobDir || !options.exportDir) {
  console.error("Usage: node scripts/assemble_hermes_clips_fallback.mjs --job-dir <job> --export-dir <segment> --diagnostic-slate [--final-name diagnostic-slate.mp4]");
  process.exit(2);
}
if (options.diagnosticSlate !== true) {
  console.error("Refusing to assemble slate fallback as a final video. This script is diagnostic-only; pass --diagnostic-slate and use a non-final filename.");
  process.exit(2);
}

const jobDir = resolve(options.jobDir);
const exportDir = resolve(options.exportDir);
const finalName = options.finalName || "diagnostic-slate.mp4";
if (/^final(?:-full)?\.mp4$/i.test(finalName)) {
  console.error("Refusing diagnostic slate output name that looks like a final deliverable. Use --final-name diagnostic-slate.mp4.");
  process.exit(2);
}
const outDir = join(exportDir, "manual-assembly");
mkdirSync(outDir, { recursive: true });

const scenePlan = JSON.parse(readFileSync(join(jobDir, "sceneplan.json"), "utf8"));
const scenes = Array.isArray(scenePlan.scenes) ? scenePlan.scenes : [];
if (!scenes.length) throw new Error(`No scenes in ${join(jobDir, "sceneplan.json")}`);

const rows = scenes.map((scene) => {
  const order = Number(scene.order);
  const clipPath = join(jobDir, "clips", `clip_${String(order).padStart(2, "0")}.mp4`);
  const voicePath = join(jobDir, "voice", `voice_${String(order).padStart(2, "0")}.wav`);
  const textPath = join(jobDir, "voice", `voice_${String(order).padStart(2, "0")}.in.txt`);
  if (!existsSync(clipPath)) throw new Error(`Missing clip: ${clipPath}`);
  if (!existsSync(voicePath)) throw new Error(`Missing voice: ${voicePath}`);
  return {
    order,
    clipPath,
    voicePath,
    textPath,
    text: existsSync(textPath) ? readFileSync(textPath, "utf8").trim() : String(scene.narration || "").trim(),
  };
});

const videoList = join(outDir, "clip-list.txt");
const audioList = join(outDir, "voice-list.txt");
writeFileSync(videoList, rows.map((row) => `file '${escapeConcatPath(row.clipPath)}'`).join("\n") + "\n", "utf8");
writeFileSync(audioList, rows.map((row) => `file '${escapeConcatPath(row.voicePath)}'`).join("\n") + "\n", "utf8");

const visualBase = join(outDir, "visual-base-from-hermes-clips.mp4");
const audioBase = join(outDir, "narration.wav");
const subtitles = join(outDir, "subtitles.srt");
const finalPath = join(outDir, finalName);

run("ffmpeg", [
  "-y",
  "-f", "concat",
  "-safe", "0",
  "-i", videoList,
  "-vf", "format=gray,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30",
  "-c:v", "libx264",
  "-preset", "veryfast",
  "-crf", "20",
  "-pix_fmt", "yuv420p",
  visualBase,
]);

run("ffmpeg", [
  "-y",
  "-f", "concat",
  "-safe", "0",
  "-i", audioList,
  "-ar", "44100",
  "-ac", "2",
  audioBase,
]);

const cueRows = [];
let cursor = 0;
for (const row of rows) {
  const duration = ffprobeDuration(row.voicePath);
  cueRows.push({ ...row, start: cursor, end: cursor + duration, duration });
  cursor += duration;
}
writeFileSync(subtitles, buildSrt(cueRows), "utf8");

const escapedSrt = subtitles.replace(/\\/g, "/").replace(/:/g, "\\:");
const subtitleStyle = "FontName=Malgun Gothic,FontSize=44,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,BackColour=&H99000000,Outline=1,Shadow=0,MarginV=70,Alignment=2";
run("ffmpeg", [
  "-y",
  "-i", visualBase,
  "-i", audioBase,
  "-vf", `subtitles='${escapedSrt}':force_style='${subtitleStyle}'`,
  "-map", "0:v:0",
  "-map", "1:a:0",
  "-c:v", "libx264",
  "-preset", "veryfast",
  "-crf", "20",
  "-c:a", "aac",
  "-b:a", "192k",
  "-shortest",
  finalPath,
]);

const report = {
  source: "hermes-clips-fallback-assembly",
  jobDir,
  exportDir,
  finalPath,
  sceneCount: rows.length,
  audioDurationSeconds: round2(ffprobeDuration(audioBase)),
  videoDurationSeconds: round2(ffprobeDuration(visualBase)),
  finalDurationSeconds: round2(ffprobeDuration(finalPath)),
  subtitles,
};
writeFileSync(join(outDir, "assembly-report.json"), JSON.stringify(report, null, 2), "utf8");
writeFileSync(join(outDir, "subtitle-sync-report.json"), JSON.stringify({
  source: "hermes-clips-fallback-assembly",
  finalDurationSeconds: report.finalDurationSeconds,
  subtitleEndSeconds: round2(cueRows.at(-1)?.end || 0),
  audioSubtitleEndDeltaSeconds: round2(Math.abs(report.audioDurationSeconds - (cueRows.at(-1)?.end || 0))),
  maxCueSeconds: round2(Math.max(...cueRows.map((row) => row.duration))),
}, null, 2), "utf8");

console.log(JSON.stringify(report, null, 2));

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--job-dir") parsed.jobDir = argv[++i];
    else if (argv[i] === "--export-dir") parsed.exportDir = argv[++i];
    else if (argv[i] === "--final-name") parsed.finalName = argv[++i];
    else if (argv[i] === "--diagnostic-slate") parsed.diagnosticSlate = true;
  }
  return parsed;
}

function run(cmd, args) {
  console.log([cmd, ...args].join(" "));
  execFileSync(cmd, args, { stdio: "inherit" });
}

function capture(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

function ffprobeDuration(path) {
  return Number(capture("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path]));
}

function escapeConcatPath(path) {
  return String(path).replace(/\\/g, "/").replace(/'/g, "'\\''");
}

function buildSrt(rows) {
  let index = 1;
  const chunks = [];
  for (const row of rows) {
    const cueTexts = splitCueText(row.text);
    const cueDuration = row.duration / cueTexts.length;
    cueTexts.forEach((text, cueIndex) => {
      const start = row.start + cueDuration * cueIndex;
      const end = cueIndex === cueTexts.length - 1 ? row.end : row.start + cueDuration * (cueIndex + 1);
      chunks.push(`${index}\n${srtTime(start)} --> ${srtTime(end)}\n${wrapKorean(text, 30)}\n`);
      index += 1;
    });
  }
  return chunks.join("\n");
}

function splitCueText(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [" "];
  const sentences = clean
    .split(/(?<=다\.)\s+|(?<=요\.)\s+|(?<=[.!?])\s+/u)
    .map((value) => value.trim())
    .filter(Boolean);
  if (sentences.length <= 1) return chunkByLength(clean, 42);
  const cues = [];
  let buffer = "";
  for (const sentence of sentences) {
    if ((buffer + " " + sentence).trim().length > 46 && buffer) {
      cues.push(buffer);
      buffer = sentence;
    } else {
      buffer = (buffer + " " + sentence).trim();
    }
  }
  if (buffer) cues.push(buffer);
  return cues.length ? cues : [clean];
}

function chunkByLength(text, maxLength) {
  const chunks = [];
  let rest = text;
  while (rest.length > maxLength) {
    chunks.push(rest.slice(0, maxLength).trim());
    rest = rest.slice(maxLength).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function wrapKorean(text, maxLineLength) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if ([...next].length > maxLineLength && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= 2) return lines.join("\n");
  return `${lines[0]}\n${lines.slice(1).join(" ").slice(0, maxLineLength)}`;
}

function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const x = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(x).padStart(3, "0")}`;
}

function round2(value) {
  return Number((Number(value) || 0).toFixed(2));
}
