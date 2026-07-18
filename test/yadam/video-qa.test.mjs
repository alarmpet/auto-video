import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { measureColorPixelRatio } from "../../scripts/lib/yadam/color-ratio.mjs";
import { runSegmentStrictQa } from "../../scripts/lib/yadam/video-qa.mjs";
import {
  generateSyntheticPng,
  generateSyntheticWav,
  generateSyntheticMp4,
  generateSyntheticSrt
} from "./fixtures/video/make-media.mjs";
import { writeCanonicalJson } from "../../scripts/lib/pipeline/atomic-store.mjs";
import { sha256Bytes } from "../../scripts/lib/pipeline/canonical-json.mjs";

test("color pixel ratio calculation on images and videos", async () => {
  const tempDir = resolve(`test/yadam/tmp/color-ratio-test-${Date.now()}`);
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });

  try {
    const redPng = join(tempDir, "red.png");
    generateSyntheticPng(redPng, 100, 100, "red");
    const redRes = await measureColorPixelRatio(redPng);
    // Red color should have max(r,g,b) - min(r,g,b) >= 12 (specifically ~255 - 0 = 255)
    assert(redRes.ratio > 0.99);

    const grayPng = join(tempDir, "gray.png");
    generateSyntheticPng(grayPng, 100, 100, "gray");
    const grayRes = await measureColorPixelRatio(grayPng);
    // Gray color has r=g=b, so diff is 0 < 12. Ratio should be 0.
    assert.equal(grayRes.ratio, 0);

  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runSegmentStrictQa segment QA checks pass/fail", async () => {
  const tempJobDir = resolve(`test/yadam/tmp/strict-qa-job-${Date.now()}`);
  await rm(tempJobDir, { recursive: true, force: true });
  await mkdir(tempJobDir, { recursive: true });

  try {
    const segmentId = "segment-01";
    const segmentDir = join(tempJobDir, "segments", segmentId);
    const assemblyDir = join(segmentDir, "manual-assembly");
    await mkdir(assemblyDir, { recursive: true });
    await mkdir(join(tempJobDir, "assets"), { recursive: true });

    // 1. Generate media files
    const finalMp4 = join(assemblyDir, "final.mp4");
    generateSyntheticMp4(finalMp4, 10, { color: "red", fps: 24, sampleRate: 48000 });

    const sourcePng = join(tempJobDir, "assets/slot-01.png");
    generateSyntheticPng(sourcePng, 100, 100, "red");

    const clipMp4 = join(assemblyDir, "motion-clips/clip_001.mp4");
    generateSyntheticMp4(clipMp4, 10, { color: "red", fps: 24, sampleRate: 48000 });

    const subtitlesSrt = join(assemblyDir, "subtitles.srt");
    generateSyntheticSrt(subtitlesSrt, [{ start: 0.1, end: 5.0, text: "hello 1" }, { start: 5.1, end: 10.0, text: "hello 2" }]);

    // 2. Mock asset manifest and visual QA
    const assetManifest = {
      assets: [
        {
          visualSlotId: "slot-01",
          qaPath: "assets/qa-slot-01.json",
          qaHash: "a".repeat(64)
        }
      ]
    };
    await writeCanonicalJson(join(tempJobDir, "assets/asset-manifest.json"), assetManifest);

    const visualQa = {
      critic: {
        scores: {
          colorStyleMatch: 8
        }
      }
    };
    await writeCanonicalJson(join(tempJobDir, "assets/qa-slot-01.json"), visualQa);

    // 3. Mock assembly-report.json
    const assemblyReport = {
      profileId: "yadam",
      audioTempoFactor: 1.0,
      timelineScale: 1.0,
      visualGroups: [
        {
          visualSlotId: "slot-01",
          manifestStart: 0,
          manifestEnd: 10,
          manifestDuration: 10,
          actualFrameStart: 0,
          actualFrameEnd: 240,
          actualFrameDuration: 10,
          frameCount: 240,
          clip: "clip_001.mp4"
        }
      ]
    };
    await writeCanonicalJson(join(assemblyDir, "assembly-report.json"), assemblyReport);

    // 4. Mock renderManifest
    const renderManifest = {
      value: {
        measuredAudioSeconds: 10,
        segments: [
          {
            segmentId,
            plannedDurationSeconds: 10,
            measuredAudioSeconds: 10,
            startSeconds: 0,
            endSeconds: 10
          }
        ],
        visualSlots: [
          {
            visualSlotId: "slot-01",
            segmentId,
            imagePath: "assets/slot-01.png"
          }
        ]
      }
    };

    // Mock state files for schema validation / pipeline functions
    await writeCanonicalJson(join(tempJobDir, "pipeline-state.json"), { jobId: "job-123", status: "running" });
    await writeCanonicalJson(join(tempJobDir, "request.json"), { jobId: "job-123", createdAt: new Date().toISOString() });
    await writeCanonicalJson(join(tempJobDir, "artifact-manifest.json"), { schemaVersion: "1.0.0", jobId: "job-123", artifacts: [] });

    // Run strict QA
    const qaReport = await runSegmentStrictQa({
      jobDir: tempJobDir,
      segmentId,
      renderManifest
    });

    assert.equal(qaReport.value.qualityOk, true);
    assert.equal(qaReport.value.finalVerdict, "pass");

    // Test Fail case: Change colorStyleMatch to 5
    visualQa.critic.scores.colorStyleMatch = 5;
    await writeCanonicalJson(join(tempJobDir, "assets/qa-slot-01.json"), visualQa);

    await assert.rejects(
      runSegmentStrictQa({
        jobDir: tempJobDir,
        segmentId,
        renderManifest
      }),
      err => err.code === "segment_qa_failed"
    );

  } finally {
    await rm(tempJobDir, { recursive: true, force: true });
  }
});
