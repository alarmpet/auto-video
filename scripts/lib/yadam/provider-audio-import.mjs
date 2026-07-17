import { existsSync, createReadStream, createWriteStream, promises as fsPromises } from "node:fs";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import { assertPathWithin, assertAnyAllowedRealPath, assertRealPathWithin } from "../pipeline/path-policy.mjs";
import { loadHostConfig } from "../pipeline/profile-registry.mjs";

const execFileAsync = promisify(execFile);

const MAX_AUDIO_SIZE = 512 * 1024 * 1024; // 512 MiB

// Helper to calculate SHA-256 of a file stream
function hashFile(filePath) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
    stream.on("error", rejectHash);
  });
}

export async function importProviderAudio({ transport, providerResult, jobDir, allowedRoots, baseUrl, request, signal }) {
  const hostConfig = await loadHostConfig(jobDir);
  const ffprobeExecutable = hostConfig.ffmpeg.ffprobeExecutable;

  const rawPartRelative = `assets/audio/raw/${request.sceneId}.part.wav`;
  const rawPartPath = resolve(jobDir, rawPartRelative);

  let providerProvenance = null;

  if (transport === "http") {
    let sourcePath = providerResult.path;
    let sourceUrl = providerResult.audio_url || providerResult.audioUrl;
    let copied = false;

    if (sourcePath) {
      try {
        const allowedPath = await assertAnyAllowedRealPath(allowedRoots, sourcePath);
        // Copy file securely with size limit
        const stats = await fsPromises.stat(allowedPath);
        if (!stats.isFile()) throw new Error("Source path is not a file");
        if (stats.size === 0 || stats.size > MAX_AUDIO_SIZE) throw new Error("File size out of bounds");

        await fsPromises.mkdir(join(jobDir, "assets/audio/raw"), { recursive: true });
        await fsPromises.copyFile(allowedPath, rawPartPath);
        providerProvenance = { path: sourcePath };
        copied = true;
      } catch (err) {
        // If copy fails or forbidden, fallback to URL download if available
        if (!sourceUrl) throw err;
      }
    }

    if (!copied && sourceUrl) {
      // Resolve against base URL
      const resolvedUrl = new URL(sourceUrl, baseUrl).toString();
      const parsed = new URL(resolvedUrl);
      if (parsed.protocol !== "http:") {
        throw new Error("HTTP provider URL must be http protocol");
      }
      if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
        throw new Error("HTTP provider URL must be loopback");
      }
      if (!parsed.pathname.startsWith("/audio/")) {
        throw new Error("HTTP provider URL path must start with /audio/");
      }

      const res = await fetch(resolvedUrl, { method: "GET", signal, redirect: "error" });
      if (!res.ok) throw new Error(`Failed to download audio from provider URL: ${res.status}`);

      const contentLengthStr = res.headers.get("content-length");
      if (contentLengthStr) {
        const cl = parseInt(contentLengthStr, 10);
        if (cl === 0 || cl > MAX_AUDIO_SIZE) throw new Error("Content-Length out of bounds");
      }

      await fsPromises.mkdir(join(jobDir, "assets/audio/raw"), { recursive: true });
      const fileStream = createWriteStream(rawPartPath);
      const reader = res.body.getReader();
      let totalBytes = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.length;
          if (totalBytes > MAX_AUDIO_SIZE) throw new Error("Downloaded bytes limit exceeded");
          fileStream.write(value);
        }
      } finally {
        fileStream.end();
        await new Promise(r => fileStream.once("close", r));
      }

      if (totalBytes === 0) throw new Error("Downloaded empty file");
      providerProvenance = { url: resolvedUrl };
      copied = true;
    }

    if (!copied) {
      throw new Error("Neither path nor URL was valid for HTTP audio import");
    }
  } else if (transport === "cli") {
    // CLI result must resolve to exactly the rawPartRelative
    const targetPath = providerResult.path;
    if (targetPath !== rawPartRelative) {
      throw new Error(`CLI output path mismatch. Expected: ${rawPartRelative}, Got: ${targetPath}`);
    }

    // Verify it is within jobDir and not a symlink junction escape
    assertPathWithin(jobDir, rawPartPath);
    const realRawPartPath = await assertRealPathWithin(jobDir, rawPartPath);

    // Require regular file of correct size
    const stats = await fsPromises.stat(realRawPartPath);
    if (!stats.isFile()) throw new Error("CLI output is not a file");
    if (stats.size === 0 || stats.size > MAX_AUDIO_SIZE) throw new Error("CLI output file size out of bounds");

    providerProvenance = { path: realRawPartPath };
  } else {
    throw new Error(`Unsupported transport: ${transport}`);
  }

  // Validate raw WAV
  const handle = await fsPromises.open(rawPartPath, "r");
  try {
    const headerBuf = Buffer.alloc(12);
    await handle.read(headerBuf, 0, 12, 0);
    const riff = headerBuf.toString("ascii", 0, 4);
    const wave = headerBuf.toString("ascii", 8, 12);
    if (riff !== "RIFF" || wave !== "WAVE") {
      throw new Error("Invalid WAV file signature (expected RIFF and WAVE)");
    }
  } finally {
    await handle.close();
  }

  // Run ffprobe validation
  let probeOutput;
  try {
    const { stdout } = await execFileAsync(ffprobeExecutable, [
      "-v", "error",
      "-show_entries", "stream=index,codec_type,codec_name,sample_fmt,sample_rate,channels,channel_layout:format=duration",
      "-of", "json", rawPartPath
    ]);
    probeOutput = JSON.parse(stdout);
  } catch (err) {
    throw new Error(`ffprobe validation failed: ${err.message}`);
  }

  const streams = probeOutput.streams || [];
  const audioStreams = streams.filter(s => s.codec_type === "audio");
  if (audioStreams.length !== 1 || streams.length !== 1) {
    throw new Error(`WAV file must contain exactly one audio stream and no other streams. Found ${audioStreams.length} audio and ${streams.length} total.`);
  }

  const duration = parseFloat(probeOutput.format?.duration);
  if (isNaN(duration) || duration <= 0) {
    throw new Error(`Invalid WAV duration: ${probeOutput.format?.duration}`);
  }

  // Hash raw .part.wav
  const rawSha256 = await hashFile(rawPartPath);

  // Rename to raw scene WAV
  const rawPath = resolve(jobDir, `assets/audio/raw/${request.sceneId}.wav`);
  await fsPromises.rename(rawPartPath, rawPath);

  return {
    rawPath: `assets/audio/raw/${request.sceneId}.wav`,
    rawSha256,
    media: {
      codec: audioStreams[0].codec_name,
      sampleFormat: audioStreams[0].sample_fmt,
      sampleRate: parseInt(audioStreams[0].sample_rate, 10),
      channels: parseInt(audioStreams[0].channels, 10),
      channelLayout: audioStreams[0].channel_layout || "",
      durationSeconds: duration
    },
    providerProvenance
  };
}
