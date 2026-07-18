import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { loadJob } from "../pipeline/job-store.mjs";
import { writeCanonicalJsonExclusive, readJson, writeCanonicalJson, writeUtf8Atomic } from "../pipeline/atomic-store.mjs";
import { registerArtifact } from "../pipeline/artifact-store.mjs";
import { sha256Bytes } from "../pipeline/canonical-json.mjs";
import { validateSchema } from "../pipeline/schema-registry.mjs";
import { parseSrt } from "./video-qa.mjs";
import { ensureContainedVideoDirectory } from "./video-layout.mjs";

const FINAL_QA_REPORT_SCHEMA = resolve("schemas/yadam/final-qa-report.schema.json");

export async function compileFinalConcat({ jobDir, renderManifest }) {
  const job = await loadJob(jobDir);
  const manifestVal = renderManifest.value;

  // 1. Verify segment QA results
  const inputArtifacts = [];
  const segments = manifestVal.segments;
  
  for (const seg of segments) {
    const role = `yadam.qa.segment.${seg.segmentId}`;
    const art = job.manifest.artifacts?.find(a => a.logicalRole === role && a.gateStatus === "pass");
    if (!art) {
      throw new Error(`Missing passed segment QA artifact for segment ${seg.segmentId}`);
    }
    
    // Verify file and hashes
    const qaReportPath = join(jobDir, art.path);
    if (!existsSync(qaReportPath)) {
      throw new Error(`Segment QA report file missing: ${art.path}`);
    }
    const reportBytes = readFileSync(qaReportPath);
    if (sha256Bytes(reportBytes).toLowerCase() !== art.sha256.toLowerCase()) {
      throw new Error(`Segment QA report hash mismatch: ${art.path}`);
    }

    const reportData = JSON.parse(reportBytes.toString("utf8"));
    if (!reportData.qualityOk || reportData.finalVerdict !== "pass") {
      throw new Error(`Segment ${seg.segmentId} did not pass strict QA`);
    }

    inputArtifacts.push(art);
  }

  // 2. Generate final/concat-list.txt
  const finalDir = await ensureContainedVideoDirectory(jobDir, "final");
  const concatListLines = segments.map(seg => `file '../segments/${seg.segmentId}/manual-assembly/final.mp4'`);
  const concatListContent = concatListLines.join("\n") + "\n";
  
  const concatListPath = join(finalDir, "concat-list.txt");
  await writeUtf8Atomic(concatListPath, concatListContent);
  const concatListHash = sha256Bytes(readFileSync(concatListPath));

  // 3. Concatenate final video using FFmpeg
  const partFinalMp4Path = join(finalDir, "final-full.part.mp4");
  const finalMp4Path = join(finalDir, "final-full.mp4");

  execFileSync("ffmpeg", [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", concatListPath,
    "-c", "copy",
    partFinalMp4Path
  ], { stdio: "ignore" });

  if (existsSync(finalMp4Path)) {
    rmSync(finalMp4Path, { force: true });
  }
  renameSync(partFinalMp4Path, finalMp4Path);
  const finalVideoHash = sha256Bytes(readFileSync(finalMp4Path));

  // 4. Merge subtitles
  let mergedCues = [];
  let cumulativeSeconds = 0;

  for (const seg of segments) {
    const srtPath = join(jobDir, `segments/${seg.segmentId}/manual-assembly/subtitles.srt`);
    if (!existsSync(srtPath)) {
      throw new Error(`Subtitles sidecar missing for segment ${seg.segmentId}`);
    }
    const srtContent = readFileSync(srtPath, "utf8");
    const cues = parseSrt(srtContent);
    for (const cue of cues) {
      mergedCues.push({
        start: cue.start + cumulativeSeconds,
        end: cue.end + cumulativeSeconds,
        text: cue.text
      });
    }
    cumulativeSeconds += seg.measuredAudioSeconds;
  }

  // Serialize merged subtitles
  const srtLines = [];
  mergedCues.forEach((cue, index) => {
    srtLines.push(String(index + 1));
    srtLines.push(`${formatTime(cue.start)} --> ${formatTime(cue.end)}`);
    srtLines.push(cue.text);
    srtLines.push("");
  });
  const mergedSrtContent = srtLines.join("\n");
  
  const subtitleDir = await ensureContainedVideoDirectory(jobDir, "final/upload-subtitles");
  const uploadSrtPath = join(subtitleDir, "final-full.upload.srt");
  await writeUtf8Atomic(uploadSrtPath, mergedSrtContent);
  const uploadSrtHash = sha256Bytes(readFileSync(uploadSrtPath));

  // 5. Final stream probe (Release QA)
  const rawProbe = execFileSync("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", finalMp4Path], { encoding: "utf8" }).trim();
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

  const checks = {};
  const failures = [];
  const warnings = [];

  function addCheck(name, status, actual, limit) {
    checks[name] = { status, actual, limit };
    if (status === "fail") {
      failures.push(`${name}: actual=${JSON.stringify(actual)} limit=${JSON.stringify(limit)}`);
    }
  }

  const profileMatch = JSON.stringify(actualProfile) === JSON.stringify(expectedProfile);
  addCheck("video_profile", profileMatch ? "pass" : "fail", actualProfile, expectedProfile);

  // Compare final MP4 duration to sum of measured audio durations
  const finalMp4Duration = Number(probeData.format?.duration || 0);
  const durationDiff = Math.abs(finalMp4Duration - cumulativeSeconds);
  addCheck("duration_mismatch", durationDiff <= 0.05 ? "pass" : "fail", durationDiff, "<=0.05");

  // Verify subtitle sync: delta between final cue end and final video duration <= 0.75
  if (mergedCues.length > 0) {
    const lastCueEnd = mergedCues[mergedCues.length - 1].end;
    const subVideoDelta = Math.abs(lastCueEnd - finalMp4Duration);
    addCheck("subtitle_video_end_delta", subVideoDelta <= 0.75 ? "pass" : "fail", subVideoDelta, "<=0.75");
  }

  const qualityOk = failures.length === 0;
  const finalVerdict = (qualityOk && warnings.length === 0) ? "pass" : "fail";

  // Success Evidence Hashing
  const profileHash = sha256Bytes(Buffer.from("yadam"));
  
  let ffmpegVer = "unknown";
  try {
    ffmpegVer = execFileSync("ffmpeg", ["-version"], { encoding: "utf8" }).split("\n")[0];
  } catch {}
  const ffmpegVersionHash = sha256Bytes(Buffer.from(ffmpegVer));

  const assemblerPolicyBytes = existsSync(resolve("scripts/lib/yadam/exact-video-policy.mjs")) 
    ? readFileSync(resolve("scripts/lib/yadam/exact-video-policy.mjs")) 
    : Buffer.from("");
  const assemblerPolicyHash = sha256Bytes(assemblerPolicyBytes);

  const qaPolicyBytes = existsSync(resolve("scripts/lib/yadam/video-qa.mjs")) 
    ? readFileSync(resolve("scripts/lib/yadam/video-qa.mjs")) 
    : Buffer.from("");
  const qaPolicyHash = sha256Bytes(qaPolicyBytes);

  const successEvidenceInput = {
    stage: "FINAL_QA_PASSED",
    inputArtifacts: inputArtifacts.map(art => ({
      artifactId: art.artifactId,
      logicalRole: art.logicalRole,
      path: art.path,
      sha256: art.sha256
    })),
    opaqueInputs: {
      profileHash,
      ffmpegVersionHash,
      assemblerPolicyHash,
      qaPolicyHash
    },
    inputHash: renderManifest.sha256
  };

  const finalQaReport = {
    schemaVersion: "1.0.0",
    reportType: "final_qa",
    jobId: job.state.jobId || job.request.jobId,
    qualityOk,
    finalVerdict,
    checks,
    failures,
    warnings,
    artifactHashes: {
      video: finalVideoHash,
      subtitles: uploadSrtHash,
      concatList: concatListHash
    },
    measuredDurationSeconds: finalMp4Duration,
    successEvidenceInput
  };

  await validateSchema(FINAL_QA_REPORT_SCHEMA, finalQaReport);

  const finalQaPath = join(finalDir, "final-qa-report.json");

  // Overwrite/quarantine logic
  if (existsSync(finalQaPath)) {
    const oldBytes = readFileSync(finalQaPath);
    const oldHash = sha256Bytes(oldBytes);
    const quarantineDir = await ensureContainedVideoDirectory(jobDir, `quarantine/video/publications/final-qa-report-${oldHash}`);
    renameSync(finalQaPath, join(quarantineDir, "final-qa-report.json"));
  }

  const qaWriteRes = await writeCanonicalJsonExclusive(finalQaPath, finalQaReport);

  if (!qualityOk) {
    throw Object.assign(new Error("Final video strict release QA failed"), {
      code: "final_qa_failed",
      reportPath: "final/final-qa-report.json"
    });
  }

  // Register final QA pass artifact
  await registerArtifact(jobDir, {
    artifactId: "yadam-qa-final",
    logicalRole: "yadam.qa.final",
    path: "final/final-qa-report.json",
    sha256: qaWriteRes.sha256,
    schemaVersion: "1.0.0",
    producerStage: "final-concat-and-qa",
    gateStatus: "pass",
    dependencyHashes: {
      "yadam.video.final": finalVideoHash
    }
  });

  // Promote status in pipeline-state.json
  const statePath = join(jobDir, "pipeline-state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  state.status = "completed";
  state.completedAt = new Date().toISOString();
  await writeCanonicalJson(statePath, state);

  return {
    concatList: { path: "final/concat-list.txt", sha256: concatListHash },
    finalVideo: { path: "final/final-full.mp4", sha256: finalVideoHash },
    uploadSubtitle: { path: "final/upload-subtitles/final-full.upload.srt", sha256: uploadSrtHash },
    finalQaReport: { path: "final/final-qa-report.json", sha256: qaWriteRes.sha256 }
  };
}

function formatTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const x = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(x).padStart(3, "0")}`;
}
