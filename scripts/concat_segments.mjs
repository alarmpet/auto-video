#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = parseArgs(process.argv.slice(2));
const exportDir = args.exportDir;
if (!exportDir) {
  console.error("Usage: node scripts/concat_segments.mjs --export-dir <segmented-export>");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(join(exportDir, "segment-manifest.json"), "utf8"));
if (!Array.isArray(manifest.segments) || !manifest.segments.length) {
  throw new Error("segment-manifest.json must contain a non-empty segments array");
}

const finalDir = join(exportDir, "final");
mkdirSync(finalDir, { recursive: true });
const finalName = args.finalName || "final-full.mp4";
const rows = [];
const missing = [];
const finalPaths = [];

for (const segment of manifest.segments) {
  const finalPath = join(segment.dir, "manual-assembly", "final.mp4");
  if (!existsSync(finalPath)) {
    missing.push({ id: segment.id, finalPath });
  } else {
    finalPaths.push({
      id: segment.id,
      path: finalPath,
      srtPath: join(segment.dir, "manual-assembly", "subtitles.srt"),
    });
    rows.push(`file '${escapeConcatPath(finalPath)}'`);
  }
}

if (missing.length) {
  console.error(JSON.stringify({ missing }, null, 2));
  process.exit(1);
}

assertMatchingProfiles(finalPaths);

const concatList = join(finalDir, "concat-list.txt");
writeFileSync(concatList, `${rows.join("\n")}\n`, "utf8");
const finalPath = join(finalDir, finalName);
execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", concatList, "-c", "copy", finalPath], { stdio: "inherit" });

const duration = ffprobeDuration(finalPath);
const mergedSrt = mergeSegmentSrts(finalPaths);
// IMPORTANT: keep upload SRTs out of the playback folder. Subtitles are already
// burned into the video; some players/editors auto-load or offer nearby SRT files
// even when their basename differs, rendering a second subtitle layer.
// This SRT exists only for platform upload (e.g. YouTube CC).
const uploadSubtitleDir = join(finalDir, "upload-subtitles");
mkdirSync(uploadSubtitleDir, { recursive: true });
const finalSrtPath = join(uploadSubtitleDir, "final-full.upload.srt");
writeFileSync(finalSrtPath, mergedSrt.text, "utf8");
removePlaybackFolderSidecarSrts(finalDir);

writeFileSync(join(finalDir, "final-qa-report.json"), JSON.stringify({
  finalPath,
  finalSrtPath,
  durationSeconds: duration,
  segmentCount: manifest.segments.length,
  sourceSegments: manifest.segments.map((segment) => segment.id),
  subtitleMerge: mergedSrt.report,
}, null, 2), "utf8");

if (mergedSrt.report.timingWarnings.length) {
  console.error(JSON.stringify({ timingWarnings: mergedSrt.report.timingWarnings }, null, 2));
  console.error("Subtitle merge produced timing overlaps. Failing (was previously a warning).");
  process.exit(1);
}

console.log(JSON.stringify({ finalPath, finalSrtPath, durationSeconds: duration }, null, 2));

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--export-dir") parsed.exportDir = argv[++i];
    else if (argv[i] === "--final-name") parsed.finalName = argv[++i];
  }
  return parsed;
}

function escapeConcatPath(value) {
  return String(value).replace(/'/g, "'\\''");
}

function removePlaybackFolderSidecarSrts(finalDir) {
  for (const name of readdirSync(finalDir)) {
    if (!/\.srt$/i.test(name)) continue;
    const sidecar = join(finalDir, name);
    rmSync(sidecar);
    console.log(`Removed playback-folder sidecar SRT: ${sidecar}`);
  }
}

function ffprobeDuration(path) {
  return Number(execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
    { encoding: "utf8" },
  ).trim());
}

function ffprobeJson(path) {
  return JSON.parse(execFileSync(
    "ffprobe",
    ["-v", "error", "-show_streams", "-of", "json", path],
    { encoding: "utf8" },
  ));
}

function streamProfile(path) {
  const data = ffprobeJson(path);
  const video = data.streams.find((stream) => stream.codec_type === "video") || {};
  const audio = data.streams.find((stream) => stream.codec_type === "audio") || {};
  return {
    videoCodec: video.codec_name,
    codecTagString: video.codec_tag_string,
    width: video.width,
    height: video.height,
    pixFmt: video.pix_fmt,
    rFrameRate: video.r_frame_rate,
    timeBase: video.time_base,
    bitsPerRawSample: video.bits_per_raw_sample,
    audioCodec: audio.codec_name,
    sampleFmt: audio.sample_fmt,
    sampleRate: audio.sample_rate,
    channels: audio.channels,
    channelLayout: audio.channel_layout,
  };
}

function assertMatchingProfiles(paths) {
  if (!paths.length) throw new Error("No segment final.mp4 files found");
  const profiles = paths.map((item) => ({ ...item, profile: streamProfile(item.path) }));
  const baseline = profiles[0];
  const mismatches = profiles.filter((item) => JSON.stringify(item.profile) !== JSON.stringify(baseline.profile));
  if (mismatches.length) {
    console.error(JSON.stringify({ baseline, mismatches }, null, 2));
    throw new Error("Segment MP4 stream profiles do not match; re-render or normalize segments before concat -c copy.");
  }
}

function mergeSegmentSrts(paths) {
  let offset = 0;
  let cueIndex = 1;
  let previousEnd = 0;
  const output = [];
  const report = {
    mergedCueCount: 0,
    missingSrt: [],
    unparseableSrt: [],
    timingWarnings: [],
  };

  for (const item of paths) {
    const videoDuration = ffprobeDuration(item.path);
    if (!existsSync(item.srtPath)) {
      report.missingSrt.push({ id: item.id, srtPath: item.srtPath });
      offset += videoDuration;
      continue;
    }

    // Clamp cues to the segment's actual video duration before shifting.
    // Audio/subtitles can outlast the video by a few hundred ms (frame
    // rounding); without clamping, the tail cue overlaps the next segment's
    // first cue after the offset shift — the source of stacked subtitles.
    const shifted = shiftSrt(readFileSync(item.srtPath, "utf8"), offset, cueIndex, videoDuration);
    if (!shifted.blocks.length) {
      report.unparseableSrt.push({ id: item.id, srtPath: item.srtPath });
    } else {
      if (shifted.firstStart < previousEnd - 0.05) {
        report.timingWarnings.push({
          id: item.id,
          message: "subtitle overlap after offset shift",
          previousEnd,
          firstStart: shifted.firstStart,
        });
      }
      previousEnd = shifted.lastEnd;
      output.push(shifted.blocks.join("\n\n"));
      cueIndex = shifted.nextCueIndex;
      report.mergedCueCount += shifted.blocks.length;
    }

    offset += videoDuration;
  }

  return { text: `${output.filter(Boolean).join("\n\n")}\n`, report };
}

function shiftSrt(srtText, offsetSeconds, firstCueIndex, clampSeconds = Infinity) {
  let cueIndex = firstCueIndex;
  const sourceBlocks = srtText.trim().split(/\n\s*\n/g).filter(Boolean);
  const blocks = [];
  let firstStart = null;
  let lastEnd = 0;

  for (const block of sourceBlocks) {
    const lines = block.split(/\r?\n/);
    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex < 0) continue;
    const match = lines[timeIndex].match(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/);
    if (!match) continue;
    const rawStart = parseTime(match[1]);
    const rawEnd = parseTime(match[2]);
    if (rawStart >= clampSeconds) continue; // cue starts after video ends
    const startSeconds = rawStart + offsetSeconds;
    const endSeconds = Math.min(rawEnd, clampSeconds) + offsetSeconds;
    if (endSeconds - startSeconds < 0.05) continue;
    if (firstStart === null) firstStart = startSeconds;
    lastEnd = endSeconds;
    const shiftedTime = `${formatTime(startSeconds)} --> ${formatTime(endSeconds)}`;
    const textLines = lines.slice(timeIndex + 1);
    blocks.push([String(cueIndex++), shiftedTime, ...textLines].join("\n"));
  }

  return {
    blocks,
    nextCueIndex: cueIndex,
    firstStart: firstStart ?? 0,
    lastEnd,
  };
}

function parseTime(value) {
  const [h, m, sMs] = value.split(":");
  const [s, ms] = sMs.split(",");
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

function formatTime(seconds) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}
