#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  loadSourceSrtEvents,
  normalizeSubtitleEvents,
  subtitleCuesForRow,
  wrapKorean,
} from "./lib/subtitle-cues.mjs";
import { buildKenBurnsFilter, createMotionPlan, zoomAmountForDuration } from "./lib/kenburns-motion.mjs";

const options = parseArgs(process.argv.slice(2));
const jobDir = options.jobDir || "C:/Users/petbl/hermes-studio/hermes-local/outputs/job-2026-06-29T15-41-55-670Z";
const exportDir = options.exportDir || "C:/Users/petbl/auto-video/exports/gguljam-bible-cain-envy-60min-fast-001";
const finalName = options.finalName || "final.mp4";
const maxImageSeconds = Number(options.maxImageSeconds || 30);
const motionFps = Number(options.motionFps || 18);
const outDir = join(exportDir, "manual-assembly");
mkdirSync(outDir, { recursive: true });

const scenePlan = JSON.parse(readFileSync(join(jobDir, "sceneplan.json"), "utf8"));
const keyframeManifest = JSON.parse(readFileSync(join(jobDir, "keyframes", "manifest.json"), "utf8"));
const scenes = scenePlan.scenes || [];
const keyframes = keyframeManifest.scenes || [];
const visualTimeline = loadVisualTimeline(exportDir);
if (visualTimeline && keyframes.length < visualTimeline.scenes.length) {
  throw new Error(
    `Keyframe count ${keyframes.length} is less than visual timeline scenes ${visualTimeline.scenes.length}. `
    + `Refusing to stretch or cycle images for ${visualTimeline.path}.`,
  );
}

function run(cmd, args, options = {}) {
  console.log([cmd, ...args].join(" "));
  execFileSync(cmd, args, { stdio: "inherit", ...options });
}

function capture(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

function ffprobeDuration(path) {
  const value = capture("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path]);
  return Number(value);
}

function atempoFilter(factor) {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error(`Invalid atempo factor: ${factor}`);
  }
  const filters = [];
  let remaining = factor;
  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }
  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }
  filters.push(`atempo=${remaining.toFixed(6)}`);
  return filters.join(",");
}

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--job-dir") parsed.jobDir = args[++i];
    else if (arg === "--export-dir") parsed.exportDir = args[++i];
    else if (arg === "--final-name") parsed.finalName = args[++i];
    else if (arg === "--max-image-seconds") parsed.maxImageSeconds = args[++i];
    else if (arg === "--motion-benchmark-clips") parsed.motionBenchmarkClips = Number(args[++i]);
    else if (arg === "--motion-fps") parsed.motionFps = Number(args[++i]);
    else if (arg === "--max-audio-tempo") parsed.maxAudioTempo = Number(args[++i]);
    else if (arg === "--allow-fast-audio") parsed.allowFastAudio = true;
    else if (arg === "--preserve-audio-tempo") parsed.preserveAudioTempo = true;
  }
  return parsed;
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(no readable text|empty unmarked area|pure grayscale|strict black and white|neutral gray values only|no violet|no lavender|no magenta|no colored tint|no colored lighting)\b/g, "")
    .replace(/[,/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findKeyframe(scene) {
  const sceneKey = normalize(scene.video_prompt || scene.prompt);
  let best = null;
  for (const item of keyframes) {
    for (const value of [item.video_prompt, item.original_prompt, item.prompt]) {
      const key = normalize(value);
      if (!key) continue;
      if (sceneKey.includes(key) || key.includes(sceneKey)) {
        best = item;
        break;
      }
    }
    if (best) break;
  }
  return best || keyframes[0];
}

function loadVisualTimeline(exportDir) {
  const path = join(exportDir, "visual-timeline.json");
  if (!existsSync(path)) return null;
  const data = JSON.parse(readFileSync(path, "utf8"));
  const scenes = Array.isArray(data.scenes) ? data.scenes : [];
  if (!scenes.length) throw new Error(`visual-timeline.json has no scenes: ${path}`);
  return { path, scenes };
}

function buildTimelineGroups({ visualTimeline, keyframes, jobDir }) {
  if (keyframes.length < visualTimeline.scenes.length) {
    throw new Error(
      `Keyframe count ${keyframes.length} is less than visual timeline scenes ${visualTimeline.scenes.length}. `
      + `Refusing to stretch or cycle images for ${visualTimeline.path}.`,
    );
  }
  return visualTimeline.scenes.map((scene, index) => {
    const duration = Number(scene.durationSeconds);
    const start = Number(scene.startSeconds);
    const end = Number(scene.endSeconds);
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error(`Invalid visual timeline scene at index ${index}: ${JSON.stringify(scene)}`);
    }
    const keyframe = keyframes[index];
    const keyframePath = resolve(jobDir, keyframe.output_path || `keyframes/scene_${String(index + 1).padStart(2, "0")}.png`);
    return {
      keyframePath,
      duration,
      start,
      end,
      timelineOrder: Number(scene.order),
    };
  });
}

function buildFixedGridGroups({ cursor, keyframes, jobDir, maxImageSeconds }) {
  const groups = [];
  for (let start = 0; start < cursor; start += maxImageSeconds) {
    const end = Math.min(cursor, start + maxImageSeconds);
    const keyframe = keyframes[Math.floor(start / maxImageSeconds) % Math.max(1, keyframes.length)];
    const keyframePath = resolve(jobDir, keyframe?.output_path || "keyframes/scene_01.png");
    groups.push({ keyframePath, duration: end - start, start, end });
  }
  return groups;
}

function renderMotionClip({ group, index, motion, outDir, fps }) {
  const zoomAmount = zoomAmountForDuration(group.duration);
  const clipPath = join(outDir, "motion-clips", `clip_${String(index + 1).padStart(3, "0")}.mp4`);
  mkdirSync(join(outDir, "motion-clips"), { recursive: true });
  const built = buildKenBurnsFilter({
    width: 1920,
    height: 1080,
    fps,
    durationSeconds: group.duration,
    move: motion,
    zoomAmount,
    forceMonochrome: true,
    upscale: 2,
  });
  run("ffmpeg", [
    "-y",
    "-loop", "1",
    "-i", group.keyframePath,
    "-vf", built.filter,
    "-t", String(group.duration),
    "-r", String(built.fps),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    clipPath,
  ]);
  return {
    ...group,
    motion,
    zoomAmount,
    effectiveZoom: built.effectiveZoom,
    travelZoom: built.travelZoom,
    fps: built.fps,
    clipPath,
  };
}

function renderMotionBase({ groups, outDir, outputName, seed, limit = 0 }) {
  const renderGroups = limit > 0 ? groups.slice(0, limit) : groups;
  const motionClipList = join(outDir, limit > 0 ? "motion-clip-list-benchmark.txt" : "motion-clip-list.txt");
  const motionPlan = createMotionPlan({
    groups: renderGroups,
    seed,
    minUnique: Math.min(5, renderGroups.length),
  });
  const motionGroups = renderGroups.map((group, index) => renderMotionClip({
    group,
    index,
    motion: motionPlan[index].motion,
    outDir,
    fps: motionFps,
  }));
  writeFileSync(
    motionClipList,
    motionGroups.map((group) => `file '${group.clipPath.replace(/'/g, "'\\''")}'`).join("\n") + "\n",
    "utf8",
  );

  run("ffmpeg", [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", motionClipList,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    join(outDir, outputName),
  ]);
  return motionGroups;
}

function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const x = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(x).padStart(3, "0")}`;
}

const voiceRows = [];
let cursor = 0;
for (const scene of scenes) {
  const voicePath = join(jobDir, "voice", `voice_${String(scene.order).padStart(2, "0")}.wav`);
  const fallbackVoicePath = join(jobDir, "voice", `voice_${scene.order}.wav`);
  const path = existsSync(voicePath) ? voicePath : fallbackVoicePath;
  if (!existsSync(path)) throw new Error(`Missing voice file for scene ${scene.order}: ${path}`);
  const duration = ffprobeDuration(path);
  const keyframe = findKeyframe(scene);
  const keyframePath = resolve(jobDir, keyframe.output_path || "keyframes/scene_01.png");
  voiceRows.push({ scene, path, duration, start: cursor, end: cursor + duration, keyframePath });
  cursor += duration;
}

let groups = visualTimeline
  ? buildTimelineGroups({ visualTimeline, keyframes, jobDir })
  : buildFixedGridGroups({ cursor, keyframes, jobDir, maxImageSeconds });

const benchmarkClipCount = Number(options.motionBenchmarkClips || 0);
if (benchmarkClipCount > 0) {
  const benchmarkGroups = renderMotionBase({
    groups,
    outDir,
    outputName: "visual-base-benchmark.mp4",
    seed: `${exportDir}:${jobDir}:benchmark`,
    limit: benchmarkClipCount,
  });
  writeFileSync(join(outDir, "motion-benchmark-report.json"), JSON.stringify({
    outputPath: join(outDir, "visual-base-benchmark.mp4"),
    requestedClips: benchmarkClipCount,
    renderedClips: benchmarkGroups.length,
    fps: motionFps,
    visualGroups: benchmarkGroups.map((group) => ({
      image: basename(group.keyframePath),
      duration: Number(group.duration.toFixed(3)),
      motion: group.motion,
      zoomAmount: Number(group.zoomAmount.toFixed(5)),
      effectiveZoom: Number(group.effectiveZoom.toFixed(5)),
      travelZoom: group.travelZoom === null ? null : Number(group.travelZoom.toFixed(5)),
      fps: group.fps,
      clip: basename(group.clipPath),
    })),
  }, null, 2), "utf8");
  console.log(JSON.stringify({
    benchmarkPath: join(outDir, "visual-base-benchmark.mp4"),
    renderedClips: benchmarkGroups.length,
    fps: motionFps,
  }, null, 2));
  process.exit(0);
}

const audioList = join(outDir, "audio-list.txt");
writeFileSync(audioList, voiceRows.map((row) => `file '${row.path.replace(/'/g, "'\\''")}'`).join("\n") + "\n", "utf8");
const rawNarrationPath = visualTimeline ? join(outDir, "narration-raw.wav") : join(outDir, "narration.wav");
run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", audioList, "-c", "copy", rawNarrationPath]);

let totalImageSeconds = Math.ceil(groups.at(-1)?.end || cursor);
if (visualTimeline && options.preserveAudioTempo && cursor > 0 && totalImageSeconds > 0) {
  const scale = cursor / totalImageSeconds;
  groups = groups.map((group) => ({
    ...group,
    start: group.start * scale,
    end: group.end * scale,
    duration: group.duration * scale,
    audioTempoPreserved: true,
    timelineScale: scale,
  }));
  totalImageSeconds = cursor;
}
let targetMediaSeconds = visualTimeline ? totalImageSeconds : cursor;
const maxAudioTempo = Number(options.maxAudioTempo || 0);
if (visualTimeline && maxAudioTempo > 0 && cursor > 0 && targetMediaSeconds > 0) {
  const minimumMediaSeconds = cursor / maxAudioTempo;
  if (targetMediaSeconds < minimumMediaSeconds) {
    const scale = minimumMediaSeconds / targetMediaSeconds;
    groups = groups.map((group) => ({
      ...group,
      start: group.start * scale,
      end: group.end * scale,
      duration: group.duration * scale,
      timelineScale: scale,
      maxAudioTempoApplied: maxAudioTempo,
    }));
    totalImageSeconds = minimumMediaSeconds;
    targetMediaSeconds = minimumMediaSeconds;
  }
}

let audioTempoFactor = 1;
let finalAudioSeconds = cursor;
const narrationPath = join(outDir, "narration.wav");
if (visualTimeline) {
  audioTempoFactor = cursor / targetMediaSeconds;
  if (!options.allowFastAudio && (audioTempoFactor > 1.18 || audioTempoFactor < 0.92)) {
    throw new Error(
      `audioTempoFactor ${audioTempoFactor.toFixed(3)} is outside 0.92-1.18. `
      + "Regenerate or rebalance the segment script; pass --allow-fast-audio only for preview renders.",
    );
  }
  run("ffmpeg", [
    "-y",
    "-i", rawNarrationPath,
    "-filter:a", atempoFilter(audioTempoFactor),
    narrationPath,
  ]);
  finalAudioSeconds = ffprobeDuration(narrationPath);
}

const srt = [];
const sourceSrt = loadSourceSrtEvents(jobDir);
const rawSubtitleRows = sourceSrt
  ? normalizeSubtitleEvents(sourceSrt.events, { maxCueSeconds: 8, maxChars: 26 })
  : voiceRows.flatMap((row) => subtitleCuesForRow(row, { maxChars: 26, minCueSeconds: 1.2 }));
const subtitleScale = visualTimeline && cursor > 0 ? finalAudioSeconds / cursor : 1;
const subtitleRows = rawSubtitleRows.map((row) => ({
  ...row,
  start: row.start * subtitleScale,
  end: row.end * subtitleScale,
}));
if (subtitleRows.length) {
  subtitleRows[subtitleRows.length - 1].end = finalAudioSeconds;
}
subtitleRows.forEach((row, index) => {
  srt.push(String(index + 1));
  srt.push(`${srtTime(row.start)} --> ${srtTime(row.end)}`);
  srt.push(wrapKorean(row.text, 24, 2));
  srt.push("");
});
writeFileSync(join(outDir, "subtitles.srt"), srt.join("\n"), "utf8");

const motionGroups = renderMotionBase({
  groups,
  outDir,
  outputName: "visual-base.mp4",
  seed: `${exportDir}:${jobDir}`,
});

// Match final video length to the narration exactly. Motion clips are frame-
// rounded (each clip loses <1/fps s), so visual-base can end up a few hundred
// ms shorter than the audio. Previously `-shortest` cut the video/subtitles at
// the visual length, leaving audio+SRT overhanging the MP4 — which produced
// overlapping cues when segments were concatenated. Now: pad the last frame
// (tpad clone) up to the audio duration and cut precisely with -t.
const visualBaseSeconds = ffprobeDuration(join(outDir, "visual-base.mp4"));
const padSeconds = Math.max(0, finalAudioSeconds - visualBaseSeconds);
const subtitleFilter = "subtitles=subtitles.srt:force_style='FontName=Malgun Gothic,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=34'";
const finalVf = padSeconds > 0.01
  ? `tpad=stop_mode=clone:stop_duration=${(padSeconds + 0.2).toFixed(3)},${subtitleFilter}`
  : subtitleFilter;
run("ffmpeg", [
  "-y",
  "-i", join(outDir, "visual-base.mp4"),
  "-i", narrationPath,
  "-vf", finalVf,
  "-c:v", "libx264",
  "-preset", "veryfast",
  "-crf", "20",
  "-c:a", "aac",
  "-b:a", "160k",
  "-t", finalAudioSeconds.toFixed(3),
  join(outDir, finalName),
], { cwd: outDir });

const finalPath = join(outDir, finalName);
const finalDuration = ffprobeDuration(finalPath);
const subtitleEndSeconds = subtitleRows.at(-1)?.end || 0;
const maxCueSeconds = Math.max(...subtitleRows.map((row) => row.end - row.start));
writeFileSync(join(outDir, "subtitle-sync-report.json"), JSON.stringify({
  voiceRows: voiceRows.length,
  subtitleRows: subtitleRows.length,
  sourceSrtPath: sourceSrt?.srtPath || null,
  rawVoiceSeconds: cursor,
  finalAudioSeconds,
  subtitleEndSeconds,
  finalDurationSeconds: finalDuration,
  maxCueSeconds,
  audioTempoFactor,
  subtitleScale,
  audioSubtitleEndDeltaSeconds: Math.abs(finalAudioSeconds - subtitleEndSeconds),
}, null, 2), "utf8");
writeFileSync(join(outDir, "assembly-report.json"), JSON.stringify({
  sourceJob: jobDir,
  finalPath,
  rawVoiceSeconds: cursor,
  totalVoiceSeconds: finalAudioSeconds,
  finalDurationSeconds: finalDuration,
  subtitleCount: subtitleRows.length,
  sourceSrtPath: sourceSrt?.srtPath || null,
  audioTempoFactor,
  subtitleScale,
  maxImageSeconds,
  visualTimelinePath: visualTimeline?.path || null,
  visualTimelineSceneCount: visualTimeline?.scenes?.length || null,
  keyframeCount: keyframes.length,
  voiceRows: voiceRows.length,
  visualGroups: motionGroups.map((group) => ({
    image: basename(group.keyframePath),
    duration: Number(group.duration.toFixed(3)),
    motion: group.motion,
    zoomAmount: Number(group.zoomAmount.toFixed(5)),
    effectiveZoom: Number(group.effectiveZoom.toFixed(5)),
    travelZoom: group.travelZoom === null ? null : Number(group.travelZoom.toFixed(5)),
    fps: group.fps,
    clip: basename(group.clipPath),
  })),
}, null, 2), "utf8");
console.log(JSON.stringify({ finalPath, finalDurationSeconds: finalDuration, groups: groups.length, subtitles: subtitleRows.length }, null, 2));
