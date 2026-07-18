#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  loadSourceSrtEvents,
  normalizeSubtitleEvents,
  subtitleCuesForRow,
  wrapKorean,
} from "./lib/subtitle-cues.mjs";
import { buildKenBurnsFilter, createMotionPlan, zoomAmountForDuration } from "./lib/kenburns-motion.mjs";
import { writeUtf8Atomic, writeCanonicalJsonExclusive } from "./lib/pipeline/atomic-store.mjs";
import { validateSchema } from "./lib/pipeline/schema-registry.mjs";
import {
  isYadamTimeline,
  assertYadamAssemblerOptions,
  assertExactTimelineEnd,
  assertTimelineContinuity,
  buildFrameWindows,
  assertVisualKeyframePairs
} from "./lib/yadam/exact-video-policy.mjs";


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
    else if (arg === "--preserve-color") parsed.preserveColor = true;
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
  return { path, scenes, profileId: data.profileId };
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

function renderMotionClip({ group, index, motion, outDir, fps, preserveColor }) {
  const zoomAmount = zoomAmountForDuration(group.duration);
  const clipPath = join(outDir, "motion-clips", `clip_${String(index + 1).padStart(3, "0")}.mp4`);
  const partClipPath = clipPath + ".part.mp4";
  mkdirSync(join(outDir, "motion-clips"), { recursive: true });
  const built = buildKenBurnsFilter({
    width: 1920,
    height: 1080,
    fps,
    durationSeconds: group.duration,
    move: motion,
    zoomAmount,
    forceMonochrome: !preserveColor,
    upscale: 2,
    frameCount: group.frameCount
  });
  const ffmpegArgs = [
    "-y",
    "-loop", "1",
    "-i", group.keyframePath,
    "-vf", built.filter,
    "-r", String(built.fps),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p"
  ];
  if (group.frameCount !== undefined) {
    ffmpegArgs.push("-frames:v", String(group.frameCount));
  } else {
    ffmpegArgs.push("-t", String(group.duration));
  }
  ffmpegArgs.push(partClipPath);
  run("ffmpeg", ffmpegArgs);

  if (existsSync(clipPath)) {
    rmSync(clipPath, { force: true });
  }
  renameSync(partClipPath, clipPath);

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

function renderMotionBase({ groups, outDir, outputName, seed, limit = 0, preserveColor }) {
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
    preserveColor,
  }));
  writeFileSync(
    motionClipList,
    motionGroups.map((group) => `file '${group.clipPath.replace(/'/g, "'\\''")}'`).join("\n") + "\n",
    "utf8",
  );

  const partOutputName = outputName + ".part.mp4";
  const partOutputPath = join(outDir, partOutputName);
  const finalOutputPath = join(outDir, outputName);

  run("ffmpeg", [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", motionClipList,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    partOutputPath,
  ]);

  if (existsSync(finalOutputPath)) {
    rmSync(finalOutputPath, { force: true });
  }
  renameSync(partOutputPath, finalOutputPath);

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
const isYadam = isYadamTimeline(visualTimeline);

for (const scene of scenes) {
  // Padded order is padStart(2, "0") for continuous order in segment
  const orderStr = String(scene.order).padStart(2, "0");
  const voicePath = join(jobDir, "voice", `voice_${orderStr}.wav`);
  const fallbackVoicePath = join(jobDir, "voice", `voice_${scene.order}.wav`);
  const path = existsSync(voicePath) ? voicePath : fallbackVoicePath;
  if (!existsSync(path)) throw new Error(`Missing voice file for scene ${scene.order}: ${path}`);
  const duration = ffprobeDuration(path);
  const keyframe = findKeyframe(scene);
  const keyframePath = resolve(jobDir, keyframe.output_path || "keyframes/scene_01.png");
  voiceRows.push({ scene, path, duration, start: cursor, end: cursor + duration, keyframePath });
  cursor += duration;
}

let groups;
let timelineScale = 1;
let audioTempoFactor = 1;
let subtitleScale = 1;
let targetMediaSeconds = cursor;
let finalAudioSeconds = cursor;
let subtitleRows = [];

if (isYadam) {
  assertYadamAssemblerOptions(options);
  assertTimelineContinuity(visualTimeline.scenes);
  assertVisualKeyframePairs(visualTimeline.scenes, keyframes);

  const windows = buildFrameWindows(visualTimeline.scenes, motionFps);
  groups = visualTimeline.scenes.map((scene, index) => {
    const win = windows[index];
    const keyframe = keyframes[index];
    const keyframePath = resolve(jobDir, keyframe.output_path || `keyframes/visual_${String(win.visualOrder).padStart(3, "0")}.png`);
    if (!existsSync(keyframePath)) {
      throw new Error(`Keyframe file does not exist: ${keyframePath}`);
    }
    return {
      visualSlotId: scene.visualSlotId,
      keyframePath,
      duration: win.actualDuration,
      start: win.actualStart,
      end: win.actualEnd,
      frameCount: win.frameCount,
      manifestStart: scene.startSeconds,
      manifestEnd: scene.endSeconds,
      manifestDuration: scene.durationSeconds,
      imageHash: keyframe.image_sha256,
      timelineOrder: Number(scene.order)
    };
  });

  const lastVisualEnd = groups[groups.length - 1].end;
  assertExactTimelineEnd(lastVisualEnd, cursor);

  // narration-raw.wav copy concat
  const audioList = join(outDir, "audio-list.txt");
  writeFileSync(audioList, voiceRows.map((row) => `file '${row.path.replace(/'/g, "'\\''")}'`).join("\n") + "\n", "utf8");
  const rawNarrationPath = join(outDir, "narration-raw.wav");
  run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", audioList, "-c", "copy", rawNarrationPath]);

  // narration.wav atomic copy
  const narrationPath = join(outDir, "narration.wav");
  const partNarrationPath = join(outDir, "narration.part.wav");
  run("ffmpeg", ["-y", "-i", rawNarrationPath, "-c", "copy", partNarrationPath]);
  if (existsSync(narrationPath)) rmSync(narrationPath, { force: true });
  renameSync(partNarrationPath, narrationPath);
  finalAudioSeconds = ffprobeDuration(narrationPath);

  // Subtitles
  const srtSourcePath = join(jobDir, "subtitles.srt");
  if (!existsSync(srtSourcePath)) {
    throw Object.assign(new Error("subtitles.srt is empty or missing"), { code: "yadam_subtitles_empty" });
  }
  const srtContent = readFileSync(srtSourcePath, "utf8");
  const parsedCues = parseSrt(srtContent);
  if (parsedCues.length === 0) {
    throw Object.assign(new Error("subtitles.srt has no cues"), { code: "yadam_subtitles_empty" });
  }

  // Write exact subtitles
  await writeUtf8Atomic(join(outDir, "subtitles.srt"), srtContent);
  subtitleRows = parsedCues.map(c => ({
    start: c.start,
    end: c.end,
    text: c.text
  }));

  // Render motion base
  const motionGroups = renderMotionBase({
    groups,
    outDir,
    outputName: "visual-base.mp4",
    seed: `${exportDir}:${jobDir}`,
    preserveColor: options.preserveColor
  });

  // Final Pad and Render to final.part.mp4
  const visualBaseSeconds = ffprobeDuration(join(outDir, "visual-base.mp4"));
  const padSeconds = Math.max(0, finalAudioSeconds - visualBaseSeconds);
  const subtitleFilter = "subtitles=subtitles.srt:force_style='FontName=Malgun Gothic,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=34'";
  const finalVf = padSeconds > 0.01
    ? `tpad=stop_mode=clone:stop_duration=${(padSeconds + 0.2).toFixed(3)},${subtitleFilter}`
    : subtitleFilter;

  const partFinalMp4Path = join(outDir, "final.part.mp4");
  const finalMp4Path = join(outDir, finalName);

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
    partFinalMp4Path
  ], { cwd: outDir });

  // Probe and verify profile
  const rawProbe = execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", partFinalMp4Path], { encoding: "utf8" }).trim();
  const probeData = JSON.parse(rawProbe);
  const videoStream = probeData.streams.find(s => s.codec_type === "video") || {};
  const audioStream = probeData.streams.find(s => s.codec_type === "audio") || {};

  let videoFps = 0;
  if (videoStream.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split("/").map(Number);
    if (den) videoFps = Math.round(num / den);
  }

  const sampleRate = audioStream.sample_rate ? Number(audioStream.sample_rate) : 0;

  if (videoStream.codec_name !== "h264" ||
      videoStream.pix_fmt !== "yuv420p" ||
      videoStream.width !== 1920 ||
      videoStream.height !== 1080 ||
      videoFps !== 24 ||
      audioStream.codec_name !== "aac" ||
      sampleRate !== 48000) {
    throw new Error(`FFmpeg final output profile mismatch: videoCodec=${videoStream.codec_name}, pixFmt=${videoStream.pix_fmt}, size=${videoStream.width}x${videoStream.height}, fps=${videoFps}, audioCodec=${audioStream.codec_name}, sampleRate=${sampleRate}`);
  }

  if (existsSync(finalMp4Path)) {
    rmSync(finalMp4Path, { force: true });
  }
  renameSync(partFinalMp4Path, finalMp4Path);

  // Write assembly-report.json exclusively with yadam schema
  const assemblyReport = {
    profileId: "yadam",
    options: {
      finalName,
      preserveAudioTempo: true,
      motionFps: 24,
      preserveColor: true
    },
    measuredAudioSeconds: cursor,
    timelineScale: 1,
    audioTempoFactor: 1,
    finalStreamEvidence: {
      videoCodec: videoStream.codec_name,
      pixFmt: videoStream.pix_fmt,
      width: videoStream.width,
      height: videoStream.height,
      fps: videoFps,
      audioCodec: audioStream.codec_name,
      sampleRate
    },
    visualGroups: motionGroups.map((group) => ({
      visualSlotId: group.visualSlotId,
      manifestStart: group.manifestStart,
      manifestEnd: group.manifestEnd,
      manifestDuration: group.manifestDuration,
      actualFrameStart: group.start * motionFps,
      actualFrameEnd: group.end * motionFps,
      actualFrameDuration: group.duration,
      frameCount: group.frameCount,
      timelineScale: 1,
      imageHash: group.imageHash,
      motion: group.motion,
      colorMode: options.preserveColor ? "color" : "monochrome",
      clip: group.clip
    }))
  };

  const ASSEMBLY_REPORT_SCHEMA_PATH = join(process.cwd(), "schemas/yadam/assembly-report.schema.json");
  await validateSchema(ASSEMBLY_REPORT_SCHEMA_PATH, assemblyReport);
  await writeCanonicalJsonExclusive(join(outDir, "assembly-report.json"), assemblyReport);
  
  console.log(JSON.stringify({ finalPath: finalMp4Path, finalDurationSeconds: finalAudioSeconds, groups: groups.length, subtitles: subtitleRows.length }, null, 2));

} else {
  // Legacy logic
  groups = visualTimeline
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

  const maxAudioTempoValue = Number(options.maxAudioTempo || 0);
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
  subtitleRows = rawSubtitleRows.map((row) => ({
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
}
