import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import {
  splitTextIntoCues,
  buildSubtitleCues,
  serializeSrt,
  parseSrt,
  publishSubtitles,
  loadPassedSubtitleHandoff,
  normalizeSubtitleCoverageText
} from "../../scripts/lib/yadam/subtitle-service.mjs";
import { writeCanonicalJson, writeUtf8Atomic } from "../../scripts/lib/pipeline/atomic-store.mjs";
import { hashCanonical, sha256Bytes } from "../../scripts/lib/pipeline/canonical-json.mjs";

test("Korean split and timing bounds", () => {
  // Test sentence-splitting and grapheme limits
  const longText = "안녕하세요. 저는 오늘 학교에 갑니다. 여기에는 아주 긴 문장이 들어있어서 스물여섯자를 초과하면 글자 단위로 쪼개야 합니다.";
  const cues = splitTextIntoCues(longText);
  assert(cues.length > 1);
  for (const c of cues) {
    const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });
    const len = Array.from(segmenter.segment(c)).length;
    assert(len <= 26, `Grapheme count ${len} exceeds 26 for cue: ${c}`);
  }

  // Bounded timing allocation (D=10, min=ceil(10/8)=2, max=floor(10/0.2)=50)
  const scriptScenes = [
    {
      sceneId: "scene-0001",
      sourceText: "안녕하세요. 반갑습니다.",
      sourceHash: "a".repeat(64)
    }
  ];
  const audioScenes = [
    {
      sceneId: "scene-0001",
      segmentId: "segment-01",
      startSeconds: 0,
      endSeconds: 10.0,
      durationSeconds: 10.0
    }
  ];

  const { allCues } = buildSubtitleCues({ scriptScenes, audioScenes });
  assert(allCues.length >= 2 && allCues.length <= 50);
  for (const c of allCues) {
    assert(c.durationSeconds >= 0.2 && c.durationSeconds <= 8.0);
    assert(c.startSeconds >= 0);
    assert(c.endSeconds <= 10.0);
  }
  // Keep the final cue end equal to measured scene end
  assert.equal(allCues[allCues.length - 1].endSeconds, 10.0);
});

test("subtitle coverage verification and SRT writing/rebuilding", async () => {
  const tempJobDir = resolve(`test/yadam/tmp/subtitle-job-${Date.now()}`);
  await rm(tempJobDir, { recursive: true, force: true });
  await mkdir(tempJobDir, { recursive: true });

  const scriptScenes = {
    schemaVersion: "1.0.0",
    jobId: "job-123",
    scenes: [
      {
        sceneId: "scene-0001",
        segmentId: "segment-01",
        ordinal: 1,
        sourceText: "안녕하세요. 첫번째 씬입니다.",
        sourceHash: "a".repeat(64),
        ttsNormalizedText: "안녕하세요. 첫번째 씬입니다.",
        ttsNormalizedHash: "a".repeat(64),
        ttsOptionsHash: "a".repeat(64)
      },
      {
        sceneId: "scene-0002",
        segmentId: "segment-01",
        ordinal: 2,
        sourceText: "반갑습니다. 두번째 씬입니다.",
        sourceHash: "b".repeat(64),
        ttsNormalizedText: "반갑습니다. 두번째 씬입니다.",
        ttsNormalizedHash: "b".repeat(64),
        ttsOptionsHash: "b".repeat(64)
      }
    ]
  };

  const audioTimeline = {
    scenes: [
      {
        sceneId: "scene-0001",
        segmentId: "segment-01",
        startSeconds: 0,
        endSeconds: 6.0,
        durationSeconds: 6.0
      },
      {
        sceneId: "scene-0002",
        segmentId: "segment-01",
        startSeconds: 6.0,
        endSeconds: 12.0,
        durationSeconds: 6.0
      }
    ],
    segments: [
      {
        segmentId: "segment-01",
        plannedDurationSeconds: 12.0,
        measuredAudioSeconds: 12.0,
        startSeconds: 0,
        endSeconds: 12.0
      }
    ]
  };

  const audioManifest = {
    measuredAudioSeconds: 12.0,
    acceptedRangeSeconds: { minimum: 10, maximum: 14 }
  };

  const rpInput = {
    visualSlots: [
      {
        visualSlotId: "slot-01",
        visualOrder: 1,
        segmentId: "segment-01",
        sourceSceneIds: ["scene-0001"],
        primarySceneId: "scene-0001",
        startSeconds: 0,
        endSeconds: 6.0,
        durationSeconds: 6.0,
        timingBand: "body",
        extendedHold: false,
        holdReason: null,
        purpose: "scene",
        compiledRequestId: "req-01",
        compiledRequestHash: "a".repeat(64)
      },
      {
        visualSlotId: "slot-02",
        visualOrder: 2,
        segmentId: "segment-01",
        sourceSceneIds: ["scene-0002"],
        primarySceneId: "scene-0002",
        startSeconds: 6.0,
        endSeconds: 12.0,
        durationSeconds: 6.0,
        timingBand: "body",
        extendedHold: false,
        holdReason: null,
        purpose: "scene",
        compiledRequestId: "req-02",
        compiledRequestHash: "b".repeat(64)
      }
    ]
  };

  try {
    // 1. Create pipeline folder structure & files
    await mkdir(join(tempJobDir, "script"), { recursive: true });
    await mkdir(join(tempJobDir, "assets/audio"), { recursive: true });
    
    const reqWrite = await writeCanonicalJson(join(tempJobDir, "request.json"), { jobId: "job-123", createdAt: new Date().toISOString() });
    const scWrite = await writeCanonicalJson(join(tempJobDir, "script/script-scenes.json"), scriptScenes);
    const tlWrite = await writeCanonicalJson(join(tempJobDir, "assets/audio/audio-timeline.json"), audioTimeline);
    const amWrite = await writeCanonicalJson(join(tempJobDir, "assets/audio/audio-manifest.json"), audioManifest);
    const rpWrite = await writeCanonicalJson(join(tempJobDir, "render-plan-input.json"), rpInput);

    const state = {
      schemaVersion: "1.0.0",
      jobId: "job-123",
      status: "running",
      history: []
    };
    await writeCanonicalJson(join(tempJobDir, "pipeline-state.json"), state);

    const manifest = {
      schemaVersion: "1.0.0",
      jobId: "job-123",
      artifacts: [
        { artifactId: "pipeline-request", logicalRole: "pipeline.request", path: "request.json", sha256: reqWrite.sha256, schemaVersion: "1.0.0", producerStage: "job-create", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} },
        { artifactId: "yadam-script-scenes", logicalRole: "yadam.script.scenes", path: "script/script-scenes.json", sha256: scWrite.sha256, schemaVersion: "1.0.0", producerStage: "script-package", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} },
        { artifactId: "yadam-audio-timeline", logicalRole: "yadam.audio.timeline", path: "assets/audio/audio-timeline.json", sha256: tlWrite.sha256, schemaVersion: "1.0.0", producerStage: "audio-timeline", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} },
        { artifactId: "yadam-audio-manifest", logicalRole: "yadam.audio.manifest", path: "assets/audio/audio-manifest.json", sha256: amWrite.sha256, schemaVersion: "1.0.0", producerStage: "audio-manifest", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} },
        { artifactId: "yadam-render-plan-input", logicalRole: "yadam.render_plan_input", path: "render-plan-input.json", sha256: rpWrite.sha256, schemaVersion: "1.0.0", producerStage: "render-plan-input", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} }
      ]
    };
    await writeCanonicalJson(join(tempJobDir, "artifact-manifest.json"), manifest);

    const audioHandoff = {
      audioTimelineHash: tlWrite.sha256,
      scenes: audioTimeline.scenes,
      segments: audioTimeline.segments
    };

    // 2. Publish subtitles
    const subtitleHandoff = await publishSubtitles({ jobDir: tempJobDir, audioHandoff });
    
    assert.equal(subtitleHandoff.subtitleCoverageRevision, 1);
    assert(existsSync(join(tempJobDir, subtitleHandoff.subtitleCoveragePath)));
    assert(existsSync(join(tempJobDir, "compat/hermes/segment-01/subtitles.srt")));

    // Verify loader
    const loaded = await loadPassedSubtitleHandoff(tempJobDir);
    assert.equal(loaded.subtitleSetHash, subtitleHandoff.subtitleSetHash);

    // Roundtrip parse
    const srtContent = readFileSync(join(tempJobDir, "compat/hermes/segment-01/subtitles.srt"), "utf8");
    const parsed = parseSrt(srtContent);
    assert.equal(parsed.length, subtitleHandoff.cues.length);
    assert(Math.abs(parsed[0].start - subtitleHandoff.cues[0].startSeconds) < 0.001);

  } finally {
    await rm(tempJobDir, { recursive: true, force: true });
  }
});
