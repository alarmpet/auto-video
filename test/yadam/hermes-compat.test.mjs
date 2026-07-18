import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { buildHermesCompatibility } from "../../scripts/lib/yadam/hermes-compat.mjs";
import { writeCanonicalJson } from "../../scripts/lib/pipeline/atomic-store.mjs";
import { sha256Bytes } from "../../scripts/lib/pipeline/canonical-json.mjs";

test("N audio and M visuals Hermes compatibility projection", async () => {
  const tempJobDir = resolve(`test/yadam/tmp/compat-job-${Date.now()}`);
  await rm(tempJobDir, { recursive: true, force: true });
  await mkdir(tempJobDir, { recursive: true });

  try {
    await mkdir(join(tempJobDir, "compat/hermes/segment-01"), { recursive: true });
    await mkdir(join(tempJobDir, "assets/images"), { recursive: true });
    await mkdir(join(tempJobDir, "assets/audio/normalized"), { recursive: true });

    // Mock PNGs
    const img1 = Buffer.from("image1");
    const img2 = Buffer.from("image2");
    const img3 = Buffer.from("image3");
    await writeFile(join(tempJobDir, "assets/images/slot-01.png"), img1);
    await writeFile(join(tempJobDir, "assets/images/slot-02.png"), img2);
    await writeFile(join(tempJobDir, "assets/images/slot-03.png"), img3);

    // Mock voice wav files
    const wavBytes = Buffer.from("voice");
    const wavHash = sha256Bytes(wavBytes);
    for (let i = 1; i <= 6; i++) {
      await writeFile(join(tempJobDir, `assets/audio/normalized/scene-${String(i).padStart(4, "0")}.wav`), wavBytes);
    }

    // Mock subtitles.srt
    await writeFile(join(tempJobDir, "compat/hermes/segment-01/subtitles.srt"), "srt content");

    const renderManifest = {
      path: "render-manifest.json",
      sha256: "a".repeat(64),
      value: {
        schemaVersion: "1.0.0",
        profileId: "yadam",
        jobId: "job-123",
        approvalRevisionPath: "approvals/approval-2-r001.json",
        width: 1920,
        height: 1080,
        fps: 24,
        audioTempoFactor: 1,
        plannedDurationSeconds: 18.0,
        measuredAudioSeconds: 18.0,
        renderDurationSeconds: 18.0,
        subtitleSetHash: "sub-hash",
        scenes: [
          { sceneId: "scene-0001", segmentId: "segment-01", order: 1, sourceHash: "h1", normalizedWavPath: "assets/audio/normalized/scene-0001.wav", normalizedWavHash: wavHash, durationSeconds: 3.0, startSeconds: 0.0, endSeconds: 3.0 },
          { sceneId: "scene-0002", segmentId: "segment-01", order: 2, sourceHash: "h2", normalizedWavPath: "assets/audio/normalized/scene-0002.wav", normalizedWavHash: wavHash, durationSeconds: 3.0, startSeconds: 3.0, endSeconds: 6.0 },
          { sceneId: "scene-0003", segmentId: "segment-01", order: 3, sourceHash: "h3", normalizedWavPath: "assets/audio/normalized/scene-0003.wav", normalizedWavHash: wavHash, durationSeconds: 3.0, startSeconds: 6.0, endSeconds: 9.0 },
          { sceneId: "scene-0004", segmentId: "segment-01", order: 4, sourceHash: "h4", normalizedWavPath: "assets/audio/normalized/scene-0004.wav", normalizedWavHash: wavHash, durationSeconds: 3.0, startSeconds: 9.0, endSeconds: 12.0 },
          { sceneId: "scene-0005", segmentId: "segment-01", order: 5, sourceHash: "h5", normalizedWavPath: "assets/audio/normalized/scene-0005.wav", normalizedWavHash: wavHash, durationSeconds: 3.0, startSeconds: 12.0, endSeconds: 15.0 },
          { sceneId: "scene-0006", segmentId: "segment-01", order: 6, sourceHash: "h6", normalizedWavPath: "assets/audio/normalized/scene-0006.wav", normalizedWavHash: wavHash, durationSeconds: 3.0, startSeconds: 15.0, endSeconds: 18.0 }
        ],
        visualSlots: [
          { visualSlotId: "slot-01", visualOrder: 1, segmentId: "segment-01", sourceSceneIds: ["scene-0001", "scene-0002", "scene-0003"], primarySceneId: "scene-0001", startSeconds: 0.0, endSeconds: 9.0, durationSeconds: 9.0, timingBand: "body", extendedHold: false, holdReason: null, purpose: "scene", imagePath: "assets/images/slot-01.png", imageSha256: sha256Bytes(img1), qaStatus: "pass", provider: "comfyui", model: "sdxl", workflowPath: "", workflowHash: "0".repeat(64), checkpointHash: "0".repeat(64), seed: 1, generationAttempt: 1 },
          { visualSlotId: "slot-02", visualOrder: 2, segmentId: "segment-01", sourceSceneIds: ["scene-0004"], primarySceneId: "scene-0004", startSeconds: 9.0, endSeconds: 12.0, durationSeconds: 3.0, timingBand: "body", extendedHold: false, holdReason: null, purpose: "scene", imagePath: "assets/images/slot-02.png", imageSha256: sha256Bytes(img2), qaStatus: "pass", provider: "comfyui", model: "sdxl", workflowPath: "", workflowHash: "0".repeat(64), checkpointHash: "0".repeat(64), seed: 1, generationAttempt: 1 },
          { visualSlotId: "slot-03", visualOrder: 3, segmentId: "segment-01", sourceSceneIds: ["scene-0005", "scene-0006"], primarySceneId: "scene-0005", startSeconds: 12.0, endSeconds: 18.0, durationSeconds: 6.0, timingBand: "body", extendedHold: false, holdReason: null, purpose: "scene", imagePath: "assets/images/slot-03.png", imageSha256: sha256Bytes(img3), qaStatus: "pass", provider: "comfyui", model: "sdxl", workflowPath: "", workflowHash: "0".repeat(64), checkpointHash: "0".repeat(64), seed: 1, generationAttempt: 1 }
        ],
        segments: [
          { segmentId: "segment-01", plannedDurationSeconds: 18.0, measuredAudioSeconds: 18.0, startSeconds: 0.0, endSeconds: 18.0 }
        ],
        thumbnail: {
          path: "thumbnail/final.png",
          sha256: "a".repeat(64),
          qaPath: "thumbnail/qa.json",
          qaSha256: "b".repeat(64),
          qaStatus: "pass"
        }
      }
    };

    // Write empty state files so loadJob doesn't fail
    await writeCanonicalJson(join(tempJobDir, "pipeline-state.json"), { schemaVersion: "1.0.0", jobId: "job-123", status: "running", durationRepairAttemptsUsed: 0, history: [] });
    await writeCanonicalJson(join(tempJobDir, "request.json"), { jobId: "job-123", createdAt: new Date().toISOString(), topic: "test", optionalInstructions: "" });
    await writeCanonicalJson(join(tempJobDir, "artifact-manifest.json"), { schemaVersion: "1.0.0", jobId: "job-123", artifacts: [] });

    const results = await buildHermesCompatibility({ jobDir: tempJobDir, renderManifest });
    assert.equal(results.length, 1);

    // Assert keyframe count and narration_refs
    const keyframes = JSON.parse(readFileSync(join(tempJobDir, "compat/hermes/segment-01/keyframes/manifest.json"), "utf8"));
    assert.equal(keyframes.keyframes.length, 3);
    
    // slot-01 (0.0 to 9.0) intersects with scenes 1 (0-3), 2 (3-6), 3 (6-9)
    assert.deepEqual(keyframes.keyframes[0].narration_refs, [1, 2, 3]);
    
    // slot-03 (12.0 to 18.0) intersects with scenes 5 (12-15), 6 (15-18)
    assert.deepEqual(keyframes.keyframes[2].narration_refs, [5, 6]);

  } finally {
    await rm(tempJobDir, { recursive: true, force: true });
  }
});
