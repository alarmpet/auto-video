import { writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function createSyntheticWavBytes(durationSeconds = 1.0, sampleRate = 48000, channels = 1) {
  const numSamples = Math.floor(durationSeconds * sampleRate);
  const dataSize = numSamples * channels * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);

  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34); // 16-bit

  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Generate sine wave
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const val = Math.floor(Math.sin(2 * Math.PI * 440 * t) * 32767 * 0.5);
    for (let c = 0; c < channels; c++) {
      buffer.writeInt16LE(val, 44 + (i * channels + c) * 2);
    }
  }

  return buffer;
}

export async function writeSyntheticWav(filePath, durationSeconds = 1.0, sampleRate = 48000, channels = 1) {
  const bytes = createSyntheticWavBytes(durationSeconds, sampleRate, channels);
  await writeFile(filePath, bytes);
  return filePath;
}

export async function generateStereoWavFfmpeg(ffmpegExecutable, outputPath) {
  await execFileAsync(ffmpegExecutable, [
    "-y",
    "-f", "lavfi",
    "-i", "sine=frequency=440:duration=1.25",
    "-ar", "44100",
    "-ac", "2",
    "-c:a", "pcm_s16le",
    outputPath
  ]);
  return outputPath;
}
