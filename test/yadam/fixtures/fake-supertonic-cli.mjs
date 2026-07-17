import { readFile, writeFile } from "node:fs/promises";

function createSyntheticWavBytes(durationSeconds = 1.0, sampleRate = 48000, channels = 1) {
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

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes("--help")) {
    console.log("Supertonic CLI Help");
    process.exit(0);
  }

  let inputPath = null;
  let outputPath = null;
  let jsonFlag = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input") inputPath = args[i + 1];
    if (args[i] === "--output") outputPath = args[i + 1];
    if (args[i] === "--json") jsonFlag = true;
  }

  if (!inputPath || !outputPath) {
    console.error("Missing input or output path");
    process.exit(1);
  }

  let text;
  try {
    text = await readFile(inputPath, "utf8");
  } catch (err) {
    console.error(`Failed to read input path: ${err.message}`);
    process.exit(1);
  }

  if (!text.trim()) {
    console.error("Empty input text");
    process.exit(2);
  }

  const mode = process.env.FAKE_TTS_MODE || "success";

  if (mode === "hang") {
    // Keep event loop alive
    setInterval(() => {}, 10000);
    // Hang indefinitely
    await new Promise(() => {});
  } else if (mode === "exit5") {
    console.error("Error: something went wrong in generation");
    process.exit(5);
  } else {
    const bytes = createSyntheticWavBytes(1.0, 48000, 1);
    await writeFile(outputPath, bytes);
    if (jsonFlag) {
      console.log(JSON.stringify({ ok: true, path: outputPath }));
    }
    process.exit(0);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
