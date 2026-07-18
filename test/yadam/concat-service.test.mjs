import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { compileFinalConcat } from "../../scripts/lib/yadam/concat-service.mjs";
import {
  generateSyntheticMp4,
  generateSyntheticSrt
} from "./fixtures/video/make-media.mjs";
import { writeCanonicalJson } from "../../scripts/lib/pipeline/atomic-store.mjs";
import { sha256Bytes } from "../../scripts/lib/pipeline/canonical-json.mjs";

test("compileFinalConcat concatenates videos and verifies final release QA", async () => {
  const tempJobDir = resolve(`test/yadam/tmp/concat-service-job-${Date.now()}`);
  await rm(tempJobDir, { recursive: true, force: true });
  await mkdir(tempJobDir, { recursive: true });

  try {
    const segmentId1 = "segment-01";
    const segmentId2 = "segment-02";

    // 1. Generate synthetic segment mp4 & srt
    const s1Dir = join(tempJobDir, "segments", segmentId1, "manual-assembly");
    await mkdir(s1Dir, { recursive: true });
    const finalMp4_1 = join(s1Dir, "final.mp4");
    generateSyntheticMp4(finalMp4_1, 5, { color: "red", fps: 24 });
    const subtitlesSrt_1 = join(s1Dir, "subtitles.srt");
    generateSyntheticSrt(subtitlesSrt_1, [{ start: 0, end: 5, text: "hello segment 1" }]);

    const s2Dir = join(tempJobDir, "segments", segmentId2, "manual-assembly");
    await mkdir(s2Dir, { recursive: true });
    const finalMp4_2 = join(s2Dir, "final.mp4");
    generateSyntheticMp4(finalMp4_2, 5, { color: "blue", fps: 24 });
    const subtitlesSrt_2 = join(s2Dir, "subtitles.srt");
    generateSyntheticSrt(subtitlesSrt_2, [{ start: 0, end: 5, text: "hello segment 2" }]);

    // 2. Mock state and artifact manifest
    const state = {
      jobId: "job-123",
      status: "running",
      history: []
    };
    await writeCanonicalJson(join(tempJobDir, "pipeline-state.json"), { schemaVersion: "1.0.0", jobId: "job-123", status: "running", durationRepairAttemptsUsed: 0, history: [] });
    await writeCanonicalJson(join(tempJobDir, "request.json"), { jobId: "job-123", createdAt: new Date().toISOString(), topic: "test", optionalInstructions: "" });

    // Mock segment QA reports and register passed artifacts
    const qaReport1 = {
      schemaVersion: "1.0.0",
      reportType: "segment_qa",
      segmentId: segmentId1,
      qualityOk: true,
      finalVerdict: "pass",
      checks: {},
      failures: [],
      warnings: []
    };
    const qaReport2 = { ...qaReport1, segmentId: segmentId2 };

    const qa1Path = `segments/${segmentId1}/manual-assembly/segment-qa-report.json`;
    const qa2Path = `segments/${segmentId2}/manual-assembly/segment-qa-report.json`;
    await writeCanonicalJson(join(tempJobDir, qa1Path), qaReport1);
    await writeCanonicalJson(join(tempJobDir, qa2Path), qaReport2);

    const artifactManifest = {
      schemaVersion: "1.0.0",
      jobId: "job-123",
      artifacts: [
        {
          artifactId: "yadam-qa-segment-segment-01",
          logicalRole: `yadam.qa.segment.${segmentId1}`,
          path: qa1Path,
          sha256: sha256Bytes(readFileSync(join(tempJobDir, qa1Path))),
          schemaVersion: "1.0.0",
          producerStage: "segment-qa",
          gateStatus: "pass",
          dependencyHashes: {},
          dependencyKinds: {},
          dependencyOwners: {}
        },
        {
          artifactId: "yadam-qa-segment-segment-02",
          logicalRole: `yadam.qa.segment.${segmentId2}`,
          path: qa2Path,
          sha256: sha256Bytes(readFileSync(join(tempJobDir, qa2Path))),
          schemaVersion: "1.0.0",
          producerStage: "segment-qa",
          gateStatus: "pass",
          dependencyHashes: {},
          dependencyKinds: {},
          dependencyOwners: {}
        }
      ]
    };
    await writeCanonicalJson(join(tempJobDir, "artifact-manifest.json"), artifactManifest);

    // 3. Mock renderManifest
    const renderManifest = {
      sha256: "a".repeat(64),
      value: {
        measuredAudioSeconds: 10,
        segments: [
          {
            segmentId: segmentId1,
            measuredAudioSeconds: 5
          },
          {
            segmentId: segmentId2,
            measuredAudioSeconds: 5
          }
        ]
      }
    };

    // 4. Run Concat Compilation
    const result = await compileFinalConcat({
      jobDir: tempJobDir,
      renderManifest
    });

    assert.equal(existsSync(join(tempJobDir, result.finalVideo.path)), true);
    assert.equal(existsSync(join(tempJobDir, result.uploadSubtitle.path)), true);

    // Verify subtitles start and end are sequentially offset
    const mergedSrtContent = readFileSync(join(tempJobDir, result.uploadSubtitle.path), "utf8");
    assert(mergedSrtContent.includes("00:00:00,000 --> 00:00:05,000"));
    assert(mergedSrtContent.includes("hello segment 1"));
    // Segment 2 cue start should be offset by 5.0s -> 5.0 to 10.0
    assert(mergedSrtContent.includes("00:00:05,000 --> 00:00:10,000"));
    assert(mergedSrtContent.includes("hello segment 2"));

    // Verify pipeline state promoted to completed
    const updatedState = JSON.parse(readFileSync(join(tempJobDir, "pipeline-state.json"), "utf8"));
    assert.equal(updatedState.status, "completed");

  } finally {
    await rm(tempJobDir, { recursive: true, force: true });
  }
});
