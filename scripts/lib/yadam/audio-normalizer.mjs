import { promises as fsPromises, createReadStream } from "node:fs";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import { loadHostConfig } from "../pipeline/profile-registry.mjs";
import { writeCanonicalJson } from "../pipeline/atomic-store.mjs";
import { validateSchema } from "../pipeline/schema-registry.mjs";

const execFileAsync = promisify(execFile);

function hashFile(filePath) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
    stream.on("error", rejectHash);
  });
}

export async function normalizeAudioScene({ rawPath, request, jobDir, signal }) {
  const hostConfig = await loadHostConfig(jobDir);
  const ffmpegExecutable = hostConfig.ffmpeg.executable;
  const ffprobeExecutable = hostConfig.ffmpeg.ffprobeExecutable;

  const normalizedPartRelative = `assets/audio/normalized/${request.sceneId}.part.wav`;
  const normalizedPartPath = resolve(jobDir, normalizedPartRelative);
  const absRawPath = resolve(jobDir, rawPath);

  await fsPromises.mkdir(resolve(jobDir, "assets/audio/normalized"), { recursive: true });

  if (signal?.aborted) {
    throw new DOMException("The user aborted a request.", "AbortError");
  }

  // Spawn ffmpeg
  try {
    await execFileAsync(ffmpegExecutable, [
      "-y", "-v", "error", "-i", absRawPath,
      "-map", "0:a:0", "-vn", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "1",
      normalizedPartPath
    ], { signal });
  } catch (err) {
    // Quarantine/remove .part.wav on failure
    try {
      await fsPromises.unlink(normalizedPartPath);
    } catch {}
    throw err;
  }

  // Probe normalized file
  let probeOutput;
  try {
    const { stdout } = await execFileAsync(ffprobeExecutable, [
      "-v", "error",
      "-show_entries", "stream=index,codec_type,codec_name,sample_fmt,sample_rate,channels,channel_layout:format=duration",
      "-of", "json", normalizedPartPath
    ]);
    probeOutput = JSON.parse(stdout);
  } catch (err) {
    try { await fsPromises.unlink(normalizedPartPath); } catch {}
    throw new Error(`ffprobe validation of normalized WAV failed: ${err.message}`);
  }

  const streams = probeOutput.streams || [];
  const audioStreams = streams.filter(s => s.codec_type === "audio");
  if (audioStreams.length !== 1) {
    try { await fsPromises.unlink(normalizedPartPath); } catch {}
    throw new Error("Normalized WAV must contain exactly one audio stream");
  }

  const duration = parseFloat(probeOutput.format?.duration);
  if (isNaN(duration) || duration <= 0) {
    try { await fsPromises.unlink(normalizedPartPath); } catch {}
    throw new Error(`Invalid normalized WAV duration: ${probeOutput.format?.duration}`);
  }

  const streamInfo = audioStreams[0];
  if (
    streamInfo.codec_name !== "pcm_s16le" ||
    streamInfo.sample_fmt !== "s16" ||
    parseInt(streamInfo.sample_rate, 10) !== 48000 ||
    parseInt(streamInfo.channels, 10) !== 1
  ) {
    try { await fsPromises.unlink(normalizedPartPath); } catch {}
    throw new Error(`Normalized WAV does not match 48kHz mono PCM. Got: codec=${streamInfo.codec_name}, fmt=${streamInfo.sample_fmt}, rate=${streamInfo.sample_rate}, channels=${streamInfo.channels}`);
  }

  const layout = streamInfo.channel_layout;
  if (layout && layout !== "mono") {
    try { await fsPromises.unlink(normalizedPartPath); } catch {}
    throw new Error(`Normalized WAV channel layout is not mono: ${layout}`);
  }

  // Hash normalized .part.wav
  const normalizedSha256 = await hashFile(normalizedPartPath);

  // Rename to normalized scene WAV
  const normalizedPath = resolve(jobDir, `assets/audio/normalized/${request.sceneId}.wav`);
  await fsPromises.rename(normalizedPartPath, normalizedPath);

  return {
    normalizedPath: `assets/audio/normalized/${request.sceneId}.wav`,
    normalizedSha256,
    media: {
      codec: "pcm_s16le",
      sampleFormat: "s16",
      sampleRate: 48000,
      channels: 1,
      channelLayout: "mono",
      durationSeconds: duration
    }
  };
}

export async function writeNormalizationReport({ jobDir, rows, requestHashes }) {
  // Sort rows by scene order
  const sortedRows = [...rows].sort((a, b) => a.order - b.order);

  // Verify no duplicate orders or missing/duplicate sceneIds
  const seenOrders = new Set();
  const seenScenes = new Set();
  for (const row of sortedRows) {
    if (seenOrders.has(row.order)) {
      throw Object.assign(new Error(`Duplicate scene order in rows: ${row.order}`), { code: "duplicate_scene_order" });
    }
    seenOrders.add(row.order);

    if (seenScenes.has(row.sceneId)) {
      throw Object.assign(new Error(`Duplicate sceneId in rows: ${row.sceneId}`), { code: "duplicate_scene_id" });
    }
    seenScenes.add(row.sceneId);
  }

  // Build dependency map
  // Each scene row must have a request dependency: "yadam.tts.request.{sceneId}": requestHash
  const dependencyHashes = {};
  for (const row of sortedRows) {
    const requestHash = requestHashes[row.sceneId];
    if (!requestHash) {
      throw Object.assign(new Error(`Missing request hash dependency for ${row.sceneId}`), { code: "missing_request_dependency" });
    }
    dependencyHashes[`yadam.tts.request.${row.sceneId}`] = requestHash;
  }

  const context = await loadHostConfig(jobDir); // wait, loadHostConfig doesn't give jobId. loadJob gives jobId!
  // Let's import loadJob dynamically or normally. Since we already loaded job in requests, we can pass jobId or read pipeline-state.json
  // Let's read pipeline-state.json to get jobId:
  const statePath = join(jobDir, "pipeline-state.json");
  const state = JSON.parse(await fsPromises.readFile(statePath, "utf8"));

  const report = {
    schemaVersion: "1.0.0",
    profileId: "yadam",
    jobId: state.jobId,
    rows: sortedRows,
    dependencyHashes
  };

  const schemaPath = join(jobDir, "schemas/yadam/audio-normalization-report.schema.json");
  await validateSchema(schemaPath, report);

  const reportPath = join(jobDir, "assets/audio/normalization-report.json");
  const out = await writeCanonicalJson(reportPath, report);

  return {
    path: "assets/audio/normalization-report.json",
    sha256: out.sha256
  };
}
