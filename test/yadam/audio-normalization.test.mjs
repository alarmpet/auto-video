import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import http from "node:http";
import { loadHostConfig } from "../../scripts/lib/pipeline/profile-registry.mjs";
import { writeCanonicalJson } from "../../scripts/lib/pipeline/atomic-store.mjs";
import { createSyntheticWavBytes, generateStereoWavFfmpeg } from "./fixtures/wav-fixture.mjs";
import { importProviderAudio } from "../../scripts/lib/yadam/provider-audio-import.mjs";
import { normalizeAudioScene, writeNormalizationReport } from "../../scripts/lib/yadam/audio-normalizer.mjs";

test("44.1 kHz stereo conversion to 48 kHz mono PCM", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "yadam-norm-test-"));
  const exportsDir = join(rootDir, "exports");
  await mkdir(exportsDir, { recursive: true });

  const hostConfig = {
    schemaVersion: "1.0.0",
    workspaceRoot: rootDir,
    exportsRoot: exportsDir,
    ffmpeg: {
      executable: (await loadHostConfig(resolve("."))).ffmpeg.executable,
      ffprobeExecutable: (await loadHostConfig(resolve("."))).ffmpeg.ffprobeExecutable
    }
  };

  try {
    await mkdir(join(rootDir, "config"), { recursive: true });
    await writeCanonicalJson(join(rootDir, "config", "host.local.json"), hostConfig);
    await writeCanonicalJson(join(rootDir, "pipeline-state.json"), { jobId: "job-123", status: "running" });

    // Generate stereo 44.1kHz WAV
    const inputDir = join(rootDir, "input-data");
    await mkdir(inputDir, { recursive: true });
    const stereoWavPath = join(inputDir, "provider-stereo.wav");
    await generateStereoWavFfmpeg(hostConfig.ffmpeg.executable, stereoWavPath);

    // Mock request
    const request = {
      sceneId: "scene-0001",
      segmentId: "segment-01",
      order: 1,
      sourceHash: "a".repeat(64),
      ttsNormalizedHash: "b".repeat(64),
      ttsOptionsHash: "c".repeat(64),
      text: "선비"
    };

    // Import audio
    const imported = await importProviderAudio({
      transport: "http",
      providerResult: { path: stereoWavPath },
      jobDir: rootDir,
      allowedRoots: [inputDir.replaceAll("\\", "/")],
      baseUrl: "http://127.0.0.1:3093",
      request
    });

    assert.equal(imported.rawPath, "assets/audio/raw/scene-0001.wav");

    // Normalize
    const normalized = await normalizeAudioScene({
      rawPath: imported.rawPath,
      request,
      jobDir: rootDir
    });

    assert.equal(normalized.normalizedPath, "assets/audio/normalized/scene-0001.wav");
    assert.deepEqual(normalized.media, {
      codec: "pcm_s16le",
      sampleFormat: "s16",
      sampleRate: 48000,
      channels: 1,
      channelLayout: "mono",
      durationSeconds: normalized.media.durationSeconds
    });

    assert.ok(normalized.media.durationSeconds > 1.20 && normalized.media.durationSeconds < 1.30);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("import security rejects invalid paths and protocols", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "yadam-security-test-"));
  const exportsDir = join(rootDir, "exports");
  await mkdir(exportsDir, { recursive: true });

  const hostConfig = {
    schemaVersion: "1.0.0",
    workspaceRoot: rootDir,
    exportsRoot: exportsDir,
    ffmpeg: {
      executable: (await loadHostConfig(resolve("."))).ffmpeg.executable,
      ffprobeExecutable: (await loadHostConfig(resolve("."))).ffmpeg.ffprobeExecutable
    }
  };

  try {
    await mkdir(join(rootDir, "config"), { recursive: true });
    await writeCanonicalJson(join(rootDir, "config", "host.local.json"), hostConfig);

    const request = { sceneId: "scene-0001", text: "테스트" };

    // 1. Outside root path rejection
    const allowedRoots = [join(rootDir, "allowed").replaceAll("\\", "/")];
    await mkdir(join(rootDir, "allowed"), { recursive: true });
    const forbiddenPath = join(rootDir, "forbidden.wav");
    await writeFile(forbiddenPath, createSyntheticWavBytes());

    await assert.rejects(
      importProviderAudio({
        transport: "http",
        providerResult: { path: forbiddenPath },
        jobDir: rootDir,
        allowedRoots,
        baseUrl: "http://127.0.0.1:3093",
        request
      }),
      /outside allowed root/
    );

    // 2. Non-loopback URL rejection
    await assert.rejects(
      importProviderAudio({
        transport: "http",
        providerResult: { audio_url: "http://example.com/audio/test.wav" },
        jobDir: rootDir,
        allowedRoots,
        baseUrl: "http://127.0.0.1:3093",
        request
      }),
      /Forbidden origin|HTTP provider URL must be loopback/
    );

    // 3. Invalid protocol URL rejection
    await assert.rejects(
      importProviderAudio({
        transport: "http",
        providerResult: { audio_url: "https://127.0.0.1/audio/test.wav" },
        jobDir: rootDir,
        allowedRoots,
        baseUrl: "http://127.0.0.1:3093",
        request
      }),
      /Forbidden protocol|HTTP provider URL must be http protocol/
    );

    // 4. Missing /audio/ prefix URL rejection
    await assert.rejects(
      importProviderAudio({
        transport: "http",
        providerResult: { audio_url: "http://127.0.0.1/static/test.wav" },
        jobDir: rootDir,
        allowedRoots,
        baseUrl: "http://127.0.0.1:3093",
        request
      }),
      /URL path must start with/
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
