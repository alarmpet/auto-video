#!/usr/bin/env node
// Subtitle render-quality gate.
//
// Fails when:
//  1. A sidecar SRT sits in the final playback folder (players/CapCut can
//     load it on top of burned-in subtitles -> double subtitle layers).
//  2. Any SRT contains overlapping cues.
//  3. Any SRT contains zero/near-zero duration cues (< 0.2s).
//  4. Any SRT cue has end <= start.
//
// Usage: node scripts/check_subtitle_render_quality.mjs --export-dir <export>
//        [--min-cue-seconds 0.2] [--out <report.json>]

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";

const args = parseArgs(process.argv.slice(2));
if (!args.exportDir) {
  console.error("Usage: node scripts/check_subtitle_render_quality.mjs --export-dir <export-dir>");
  process.exit(2);
}
const minCueSeconds = Number(args.minCueSeconds ?? 0.2);

const mp4Files = [];
const srtFiles = [];
walk(args.exportDir, (path) => {
  if (/\.mp4$/i.test(path)) mp4Files.push(path);
  else if (/\.srt$/i.test(path)) srtFiles.push(path);
});

const failures = [];
const warnings = [];

// 1. Sidecar SRTs in the final playback folder.
const finalRoot = join(args.exportDir, "final");
for (const srt of srtFiles) {
  if (dirname(srt) === finalRoot) {
    failures.push({
      type: "final_playback_folder_sidecar_srt",
      srt,
      fix: "Move upload SRTs into final/upload-subtitles/ or another non-playback folder.",
    });
  }
}

// Backstop: same-basename sidecar SRT next to any MP4.
for (const mp4 of mp4Files) {
  const sidecar = mp4.replace(/\.mp4$/i, ".srt");
  if (existsSync(sidecar)) {
    failures.push({
      type: "same_name_sidecar_srt",
      mp4,
      srt: sidecar,
      fix: "Rename the SRT (e.g. *.upload.srt) or stop burning subtitles into the MP4.",
    });
  }
}

// 2-4. Cue integrity for every SRT in the export.
const srtReports = [];
for (const srtPath of srtFiles) {
  const cues = parseSrt(readFileSync(srtPath, "utf8"));
  const zeroCues = [];
  const overlaps = [];
  const inverted = [];
  for (let i = 0; i < cues.length; i += 1) {
    const cue = cues[i];
    if (cue.end < cue.start - 0.001) inverted.push(describe(cue, i));
    else if (cue.end - cue.start < minCueSeconds) zeroCues.push(describe(cue, i));
    if (i > 0 && cue.start < cues[i - 1].end - 0.001) {
      overlaps.push({ previous: describe(cues[i - 1], i - 1), next: describe(cue, i) });
    }
  }
  srtReports.push({ srtPath, cueCount: cues.length, zeroCues: zeroCues.length, overlaps: overlaps.length, inverted: inverted.length });
  if (inverted.length) failures.push({ type: "inverted_cues", srtPath, samples: inverted.slice(0, 5) });
  if (overlaps.length) failures.push({ type: "overlapping_cues", srtPath, count: overlaps.length, samples: overlaps.slice(0, 5) });
  if (zeroCues.length) failures.push({ type: "zero_duration_cues", srtPath, count: zeroCues.length, samples: zeroCues.slice(0, 5) });
}

const report = {
  exportDir: args.exportDir,
  checkedMp4Count: mp4Files.length,
  checkedSrtCount: srtFiles.length,
  minCueSeconds,
  srtReports,
  warnings,
  failures,
  ok: failures.length === 0,
};

if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

function walk(dir, visit) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      if (entry === "node_modules" || entry === "motion-clips") continue;
      walk(path, visit);
    } else {
      visit(path);
    }
  }
}

function parseSrt(content) {
  return String(content || "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n\s*\n/g)
    .map((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      const timeIndex = lines.findIndex((line) => line.includes("-->"));
      if (timeIndex < 0) return null;
      const match = lines[timeIndex].match(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/);
      if (!match) return null;
      return {
        start: parseTime(match[1]),
        end: parseTime(match[2]),
        text: lines.slice(timeIndex + 1).join(" "),
      };
    })
    .filter(Boolean);
}

function parseTime(value) {
  const [h, m, sMs] = value.split(":");
  const [s, ms] = sMs.split(",");
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

function describe(cue, index) {
  return { index: index + 1, start: round(cue.start), end: round(cue.end), text: cue.text.slice(0, 40) };
}

function round(value) {
  return Number(value.toFixed(3));
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--export-dir") parsed.exportDir = argv[++i];
    else if (argv[i] === "--min-cue-seconds") parsed.minCueSeconds = argv[++i];
    else if (argv[i] === "--out") parsed.out = argv[++i];
  }
  return parsed;
}
