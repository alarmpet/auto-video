import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { measureColorPixelRatio } from "./color-ratio.mjs";
import { writeCanonicalJsonExclusive } from "../pipeline/atomic-store.mjs";
import { registerArtifact } from "../pipeline/artifact-store.mjs";
import { validateSchema } from "../pipeline/schema-registry.mjs";
import { sha256Bytes } from "../pipeline/canonical-json.mjs";
import { ensureContainedVideoDirectory } from "./video-layout.mjs";

const SEGMENT_QA_REPORT_SCHEMA = resolve("schemas/yadam/segment-qa-report.schema.json");
const FINAL_QA_REPORT_SCHEMA = resolve("schemas/yadam/final-qa-report.schema.json");

export async function runSegmentStrictQa({ jobDir, segmentId, renderManifest }) {
  const segmentDir = join(jobDir, "segments", segmentId);
  const assemblyReportPath = join(segmentDir, "manual-assembly/assembly-report.json");
  const videoPath = join(segmentDir, "manual-assembly/final.mp4");
  const srtPath = join(segmentDir, "manual-assembly/subtitles.srt");

  if (!existsSync(assemblyReportPath) || !existsSync(videoPath) || !existsSync(srtPath)) {
    throw new Error("Missing required assembly files for QA");
  }

  const assemblyReport = JSON.parse(readFileSync(assemblyReportPath, "utf8"));
  const manifestVal = renderManifest.value;

  const checks = {};
  const failures = [];
  const warnings = [];

  // Helper to register check
  function addCheck(name, status, actual, limit) {
    checks[name] = { status, actual, limit };
    if (status === "fail") {
      failures.push(`${name}: actual=${JSON.stringify(actual)} limit=${JSON.stringify(limit)}`);
    }
  }

  // 1. Decode check
  let decodeStatus = "pass";
  try {
    execFileSync("ffmpeg", ["-v", "error", "-i", videoPath, "-f", "null", "-"], { stdio: "ignore" });
  } catch (err) {
    decodeStatus = "fail";
  }
  addCheck("decode_check", decodeStatus, decodeStatus === "pass" ? "clean" : "decode_errors", "clean");

  // 2. Video profile
  const rawProbe = execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", videoPath], { encoding: "utf8" }).trim();
  const probeData = JSON.parse(rawProbe);
  const videoStream = probeData.streams.find(s => s.codec_type === "video") || {};
  const audioStream = probeData.streams.find(s => s.codec_type === "audio") || {};

  let videoFps = 0;
  if (videoStream.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split("/").map(Number);
    if (den) videoFps = Math.round(num / den);
  }
  const sampleRate = audioStream.sample_rate ? Number(audioStream.sample_rate) : 0;
  const actualProfile = {
    videoCodec: videoStream.codec_name,
    pixFmt: videoStream.pix_fmt,
    width: videoStream.width,
    height: videoStream.height,
    fps: videoFps,
    audioCodec: audioStream.codec_name,
    sampleRate
  };
  const expectedProfile = {
    videoCodec: "h264",
    pixFmt: "yuv420p",
    width: 1920,
    height: 1080,
    fps: 24,
    audioCodec: "aac",
    sampleRate: 48000
  };

  const profileMatch = JSON.stringify(actualProfile) === JSON.stringify(expectedProfile);
  addCheck("video_profile", profileMatch ? "pass" : "fail", actualProfile, expectedProfile);

  // 3. Audio tempo
  const tempo = Number(assemblyReport.audioTempoFactor || 1);
  const tempoOk = Math.abs(tempo - 1) <= 0.001;
  addCheck("audio_tempo", tempoOk ? "pass" : "fail", tempo, "1.0±0.001");

  // 4. Duration mismatch
  const videoDuration = Number(probeData.format?.duration || 0);
  const measuredAudio = renderManifest.value.measuredAudioSeconds;
  // Wait, for segment duration mismatch, we compare segment final duration against segment measured audio duration.
  const segmentMeta = renderManifest.value.segments.find(s => s.segmentId === segmentId);
  const segmentStart = segmentMeta.startSeconds;
  const segmentMeasuredAudio = segmentMeta.measuredAudioSeconds;
  const durationDiff = Math.abs(videoDuration - segmentMeasuredAudio);
  addCheck("duration_mismatch", durationDiff <= 0.25 ? "pass" : "fail", durationDiff, "<=0.25");

  // 5. Subtitle integrity
  let srtContent = readFileSync(srtPath, "utf8");
  const srtCues = parseSrt(srtContent);
  let subtitleIntegrity = "pass";
  if (srtCues.length === 0) {
    subtitleIntegrity = "fail";
  } else {
    for (let i = 0; i < srtCues.length; i++) {
      const cue = srtCues[i];
      const dur = cue.end - cue.start;
      if (dur < 0.199 || dur > 8.001) {
        subtitleIntegrity = "fail";
        break;
      }
      if (i > 0 && cue.start < srtCues[i - 1].end - 0.001) {
        subtitleIntegrity = "fail";
        break;
      }
    }
  }
  addCheck("subtitle_integrity", subtitleIntegrity, srtCues.length, ">0 valid cues");

  // Subtitle end deltas
  if (srtCues.length > 0) {
    const finalCue = srtCues[srtCues.length - 1];
    const subEnd = finalCue.end;
    const subAudioDelta = Math.abs(subEnd - segmentMeasuredAudio);
    const subVideoDelta = Math.abs(subEnd - videoDuration);
    addCheck("subtitle_audio_end_delta", subAudioDelta <= 0.5 ? "pass" : "fail", subAudioDelta, "<=0.5");
    addCheck("subtitle_video_end_delta", subVideoDelta <= 0.75 ? "pass" : "fail", subVideoDelta, "<=0.75");
  }

  // 6. Black intervals
  let blackStatus = "pass";
  try {
    let blackStderr = "";
    try {
      execFileSync("ffmpeg", ["-v", "error", "-i", videoPath, "-vf", "blackdetect=d=0.5:pix_th=0.10", "-f", "null", "-"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (ffmpegErr) {
      blackStderr = (typeof ffmpegErr.stderr === "string" ? ffmpegErr.stderr : "") +
                   (typeof ffmpegErr.stdout === "string" ? ffmpegErr.stdout : "");
    }
    const regex = /black_start:(\d+(?:\.\d+)?) black_end:(\d+(?:\.\d+)?) black_duration:(\d+(?:\.\d+)?)/g;
    let match;
    while ((match = regex.exec(blackStderr)) !== null) {
      const start = Number(match[1]);
      const end = Number(match[2]);
      const clippedStart = Math.max(0.25, start);
      const clippedEnd = Math.min(videoDuration - 0.25, end);
      const clippedDuration = clippedEnd - clippedStart;
      if (clippedDuration >= 0.5) {
        blackStatus = "fail";
        break;
      }
    }
  } catch (err) {
    blackStatus = "fail";
  }
  addCheck("black_intervals", blackStatus, blackStatus === "pass" ? "zero_middle_black" : "has_middle_black", "zero_middle_black");

  // 7. Visual Groups checks (motion clip duration, color style, color ratios)
  const segmentSlots = renderManifest.value.visualSlots.filter(s => s.segmentId === segmentId);
  const visualGroups = assemblyReport.visualGroups || [];

  // ColorStyleMatch check
  let colorStyleOk = true;
  const imageAssetManifestPath = join(jobDir, "assets/asset-manifest.json");
  const assetManifest = JSON.parse(readFileSync(imageAssetManifestPath, "utf8"));
  const assetBySlot = new Map(assetManifest.assets.map(a => [a.visualSlotId, a]));

  for (const slot of segmentSlots) {
    const asset = assetBySlot.get(slot.visualSlotId);
    if (asset && asset.qaPath) {
      const qaPath = join(jobDir, asset.qaPath);
      if (existsSync(qaPath)) {
        const qaData = JSON.parse(readFileSync(qaPath, "utf8"));
        const score = qaData.critic?.scores?.colorStyleMatch;
        if (score === undefined || score < 7) {
          colorStyleOk = false;
        }
      }
    }
  }
  addCheck("color_style", colorStyleOk ? "pass" : "fail", colorStyleOk ? "match>=7" : "match<7", "match>=7");

  // Motion clip duration mismatch
  let motionDurationOk = true;
  for (const group of visualGroups) {
    const clipPath = join(segmentDir, "manual-assembly/motion-clips", group.clip);
    if (!existsSync(clipPath)) {
      motionDurationOk = false;
      break;
    }
    const clipDur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", clipPath], { encoding: "utf8" }).trim());
    const planned = group.duration;
    const diff = Math.abs(clipDur - planned);
    const limit = Math.max(0.75, planned * 0.03);
    if (diff > limit + 0.001) {
      motionDurationOk = false;
      break;
    }
  }
  addCheck("motion_clip_duration", motionDurationOk ? "pass" : "fail", motionDurationOk ? "within_limit" : "exceeds_limit", "within_limit");

  // Color ratio checks
  let colorRatioOk = true;
  for (const group of visualGroups) {
    // 1. Source image color ratio >= 0.10
    const slot = segmentSlots.find(s => s.visualSlotId === group.visualSlotId);
    if (!slot) continue;
    const sourcePngPath = join(jobDir, slot.imagePath);
    const sourceRes = await measureColorPixelRatio(sourcePngPath);
    if (sourceRes.ratio < 0.10) {
      colorRatioOk = false;
      break;
    }

    const minRatio = Math.max(0.05, sourceRes.ratio * 0.50);

    // 2. Motion clip midpoint color ratio >= minRatio
    const clipPath = join(segmentDir, "manual-assembly/motion-clips", group.clip);
    const clipDur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", clipPath], { encoding: "utf8" }).trim());
    const clipMid = clipDur / 2;
    const clipRes = await measureColorPixelRatio(clipPath, { ss: clipMid });
    if (clipRes.ratio < minRatio) {
      colorRatioOk = false;
      break;
    }

    // 3. Final video sample midpoint color ratio >= minRatio
    const finalMid = (group.manifestStart + group.manifestEnd) / 2;
    const finalRes = await measureColorPixelRatio(videoPath, { ss: finalMid - segmentStart });
    if (finalRes.ratio < minRatio) {
      colorRatioOk = false;
      break;
    }
  }
  addCheck("color_ratio", colorRatioOk ? "pass" : "fail", colorRatioOk ? "pass_thresholds" : "fail_thresholds", "pass_thresholds");

  const qualityOk = failures.length === 0;
  const finalVerdict = (qualityOk && warnings.length === 0) ? "pass" : "fail";

  const qaReport = {
    schemaVersion: "1.0.0",
    reportType: "segment_qa",
    segmentId,
    qualityOk,
    finalVerdict,
    checks,
    failures,
    warnings,
    artifactHashes: {
      video: sha256Bytes(readFileSync(videoPath)),
      subtitles: sha256Bytes(readFileSync(srtPath)),
      assemblyReport: sha256Bytes(readFileSync(assemblyReportPath))
    },
    measuredDurationSeconds: videoDuration
  };

  await validateSchema(SEGMENT_QA_REPORT_SCHEMA, qaReport);

  const qaReportPath = join(segmentDir, "manual-assembly/segment-qa-report.json");
  
  // Exclusively write
  if (existsSync(qaReportPath)) {
    const oldBytes = readFileSync(qaReportPath);
    const oldHash = sha256Bytes(oldBytes);
    const quarantineDir = await ensureContainedVideoDirectory(jobDir, `quarantine/video/publications/segment-qa-report-${oldHash}`);
    renameSync(qaReportPath, join(quarantineDir, "segment-qa-report.json"));
  }

  const writeRes = await writeCanonicalJsonExclusive(qaReportPath, qaReport);

  if (!qualityOk) {
    throw Object.assign(new Error(`segment strict QA failed for ${segmentId}`), {
      code: "segment_qa_failed",
      reportPath: `segments/${segmentId}/manual-assembly/segment-qa-report.json`
    });
  }

  // Register pass artifact
  await registerArtifact(jobDir, {
    artifactId: `yadam-qa-segment-${segmentId}`,
    logicalRole: `yadam.qa.segment.${segmentId}`,
    path: `segments/${segmentId}/manual-assembly/segment-qa-report.json`,
    sha256: writeRes.sha256,
    schemaVersion: "1.0.0",
    producerStage: "segment-strict-qa",
    gateStatus: "pass",
    dependencyHashes: {
      "yadam.video.segment": qaReport.artifactHashes.video
    }
  });

  return {
    path: `segments/${segmentId}/manual-assembly/segment-qa-report.json`,
    sha256: writeRes.sha256,
    value: qaReport
  };
}

export function parseSrt(content) {
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
