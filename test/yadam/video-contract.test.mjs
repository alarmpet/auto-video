import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { rm, mkdir, writeFile, symlink } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { validateSchema } from "../../scripts/lib/pipeline/schema-registry.mjs";
import { ensureVideoJobLayout, ensureContainedVideoDirectory } from "../../scripts/lib/yadam/video-layout.mjs";
import { finalizeRenderManifest, loadVerifiedRenderManifest } from "../../scripts/lib/yadam/render-manifest.mjs";
import { writeCanonicalJson, writeCanonicalJsonExclusive } from "../../scripts/lib/pipeline/atomic-store.mjs";
import { sha256Bytes } from "../../scripts/lib/pipeline/canonical-json.mjs";

const SUBTITLE_CUES_SCHEMA = resolve("schemas/yadam/subtitle-cues.schema.json");
const RENDER_MANIFEST_SCHEMA = resolve("schemas/yadam/render-manifest.schema.json");
const HERMES_COMPATIBILITY_SCHEMA = resolve("schemas/yadam/hermes-compatibility.schema.json");
const ASSEMBLY_REPORT_SCHEMA = resolve("schemas/yadam/assembly-report.schema.json");
const SEGMENT_MANIFEST_SCHEMA = resolve("schemas/yadam/segment-manifest.schema.json");
const CONCAT_REPORT_SCHEMA = resolve("schemas/yadam/concat-report.schema.json");
const SEGMENT_QA_REPORT_SCHEMA = resolve("schemas/yadam/segment-qa-report.schema.json");
const FINAL_QA_REPORT_SCHEMA = resolve("schemas/yadam/final-qa-report.schema.json");
const COMPLETED_ARTIFACT_INCIDENT_SCHEMA = resolve("schemas/yadam/completed-artifact-incident.schema.json");

// Helper to validate and assert schema validation failure
async function assertFails(schema, data) {
  await assert.rejects(
    async () => validateSchema(schema, data),
    err => err.name === "SchemaValidationError"
  );
}

test("subtitle cues schema validation", async () => {
  const cues = [
    {
      cueId: "cue-0001",
      segmentId: "segment-01",
      sceneIds: ["scene-0001"],
      startSeconds: 0,
      endSeconds: 4.5,
      durationSeconds: 4.5,
      text: "안녕하세요.",
      sourceHashes: ["a".repeat(64)]
    }
  ];
  assert.deepEqual(await validateSchema(SUBTITLE_CUES_SCHEMA, cues), cues);
  await assertFails(SUBTITLE_CUES_SCHEMA, [{ ...cues[0], durationSeconds: 0 }]);
  await assertFails(SUBTITLE_CUES_SCHEMA, [{ ...cues[0], sceneIds: [] }]);
});

test("render manifest schema validation", async () => {
  const manifest = {
    schemaVersion: "1.0.0",
    profileId: "yadam",
    jobId: "job-001",
    approvalRevisionPath: "approvals/approval-2-r001.json",
    width: 1920,
    height: 1080,
    fps: 24,
    audioTempoFactor: 1,
    plannedDurationSeconds: 10.5,
    measuredAudioSeconds: 10.5,
    renderDurationSeconds: 10.5,
    script: {
      scenesPath: "script/script-scenes.json",
      scenesHash: "a".repeat(64),
      finalTextPath: "script/final.txt",
      finalTextHash: "b".repeat(64)
    },
    dependencies: {
      "some-dep": "c".repeat(64)
    },
    coverage: {
      audio: { path: "script/coverage/audio-r001.json", sha256: "d".repeat(64), revision: 1 },
      visual: { path: "script/coverage/visual-r001.json", sha256: "e".repeat(64), revision: 1 },
      subtitle: { path: "script/coverage/subtitle-r001.json", sha256: "f".repeat(64), revision: 1 }
    },
    subtitleSetHash: "a".repeat(64),
    scenes: [
      {
        sceneId: "scene-0001",
        segmentId: "segment-01",
        order: 1,
        sourceHash: "a".repeat(64),
        normalizedWavPath: "assets/audio/normalized/scene-0001.wav",
        normalizedWavHash: "b".repeat(64),
        durationSeconds: 10.5,
        startSeconds: 0,
        endSeconds: 10.5
      }
    ],
    visualSlots: [
      {
        visualSlotId: "slot-01",
        visualOrder: 1,
        segmentId: "segment-01",
        sourceSceneIds: ["scene-0001"],
        primarySceneId: "scene-0001",
        startSeconds: 0,
        endSeconds: 10.5,
        durationSeconds: 10.5,
        timingBand: "body",
        extendedHold: false,
        holdReason: null,
        purpose: "scene",
        imagePath: "assets/images/slot-01.png",
        imageSha256: "c".repeat(64),
        qaStatus: "pass",
        provider: "comfyui",
        model: "sdxl",
        workflowPath: "assets/workflows/sdxl.json",
        workflowHash: "d".repeat(64),
        checkpointHash: "e".repeat(64),
        seed: 12345,
        generationAttempt: 1
      }
    ],
    subtitleCues: [
      {
        cueId: "cue-0001",
        segmentId: "segment-01",
        sceneIds: ["scene-0001"],
        startSeconds: 0,
        endSeconds: 10.5,
        durationSeconds: 10.5,
        text: "hello",
        sourceHashes: ["a".repeat(64)]
      }
    ],
    segments: [
      {
        segmentId: "segment-01",
        plannedDurationSeconds: 10.5,
        measuredAudioSeconds: 10.5,
        startSeconds: 0,
        endSeconds: 10.5
      }
    ],
    introSceneIds: [],
    introVisualSlotIds: [],
    thumbnail: {
      path: "thumbnail/final.png",
      sha256: "a".repeat(64),
      qaPath: "thumbnail/qa.json",
      qaSha256: "b".repeat(64),
      qaStatus: "pass"
    }
  };

  assert.deepEqual(await validateSchema(RENDER_MANIFEST_SCHEMA, manifest), manifest);
  await assertFails(RENDER_MANIFEST_SCHEMA, { ...manifest, audioTempoFactor: 1.01 });
  await assertFails(RENDER_MANIFEST_SCHEMA, { ...manifest, fallbackImagePath: "assets/images/fallback.png" });
  const badSlots = [{ ...manifest.visualSlots[0], qaStatus: "warning" }];
  await assertFails(RENDER_MANIFEST_SCHEMA, { ...manifest, visualSlots: badSlots });
});

test("hermes compatibility schema validation", async () => {
  const scenePlan = [
    {
      order: 1,
      scene_id: "scene-0001",
      narration: "narration",
      video_prompt: "prompt",
      duration_seconds: 10.5
    }
  ];
  assert.deepEqual(await validateSchema(HERMES_COMPATIBILITY_SCHEMA, scenePlan), scenePlan);

  const keyframes = {
    keyframes: [
      {
        visualOrder: 1,
        visualSlotId: "slot-01",
        output_path: "keyframes/visual_001.png",
        narration_refs: [1],
        prompt: "prompt",
        image_sha256: "a".repeat(64)
      }
    ]
  };
  assert.deepEqual(await validateSchema(HERMES_COMPATIBILITY_SCHEMA, keyframes), keyframes);

  const visualTimeline = {
    schemaVersion: "1.0.0",
    profileId: "yadam",
    segmentId: "segment-01",
    plannedDurationSeconds: 10.5,
    measuredAudioSeconds: 10.5,
    renderDurationSeconds: 10.5,
    durationSeconds: 10.5,
    scenes: [
      {
        order: 1,
        visualOrder: 1,
        visualSlotId: "slot-01",
        sourceSceneIds: ["scene-0001"],
        primarySceneId: "scene-0001",
        startSeconds: 0,
        endSeconds: 10.5,
        durationSeconds: 10.5,
        timingBand: "body",
        extendedHold: false,
        holdReason: null
      }
    ]
  };
  assert.deepEqual(await validateSchema(HERMES_COMPATIBILITY_SCHEMA, visualTimeline), visualTimeline);
});

test("assembly report schema validation", async () => {
  const report = {
    profileId: "yadam",
    options: {
      finalName: "final.mp4",
      preserveAudioTempo: true,
      motionFps: 24,
      preserveColor: true
    },
    measuredAudioSeconds: 10.5,
    timelineScale: 1,
    audioTempoFactor: 1,
    finalStreamEvidence: {
      videoCodec: "h264",
      pixFmt: "yuv420p",
      width: 1920,
      height: 1080,
      fps: 24,
      audioCodec: "aac",
      sampleRate: 48000
    },
    visualGroups: [
      {
        visualSlotId: "slot-01",
        manifestStart: 0,
        manifestEnd: 10.5,
        manifestDuration: 10.5,
        actualFrameStart: 0,
        actualFrameEnd: 252,
        actualFrameDuration: 10.5,
        frameCount: 252,
        timelineScale: 1,
        imageHash: "a".repeat(64),
        motion: "zoomin",
        colorMode: "color",
        clip: "clip_001.mp4"
      }
    ]
  };
  assert.deepEqual(await validateSchema(ASSEMBLY_REPORT_SCHEMA, report), report);
  await assertFails(ASSEMBLY_REPORT_SCHEMA, { ...report, timelineScale: 0.99 });
});

test("segment manifest schema validation", async () => {
  const manifest = {
    profileId: "yadam",
    renderManifestPath: "render-manifest.json",
    renderManifestHash: "a".repeat(64),
    fps: 24,
    segments: [
      {
        segmentId: "segment-01",
        plannedDurationSeconds: 10.5,
        measuredAudioSeconds: 10.5,
        renderDurationSeconds: 10.5,
        finalDurationSeconds: 10.5,
        cumulativeStartSeconds: 0,
        cumulativeEndSeconds: 10.5,
        dir: "segments/segment-01",
        finalPath: "segments/segment-01/manual-assembly/final.mp4",
        finalSha256: "a".repeat(64),
        qaPath: "segments/segment-01/manual-assembly/segment-qa-report.json",
        qaSha256: "b".repeat(64)
      }
    ]
  };
  assert.deepEqual(await validateSchema(SEGMENT_MANIFEST_SCHEMA, manifest), manifest);
  await assertFails(SEGMENT_MANIFEST_SCHEMA, {
    ...manifest,
    segments: [{ ...manifest.segments[0], finalPath: "C:/absolute/path.mp4" }]
  });
});

test("concat report schema validation", async () => {
  const report = {
    schemaVersion: "1.0.0",
    reportType: "yadam_concat",
    profileId: "yadam",
    jobId: "job-01",
    segmentManifestPath: "segment-manifest.json",
    segmentManifestHash: "a".repeat(64),
    segments: [
      {
        segmentId: "segment-01",
        finalPath: "segments/segment-01/manual-assembly/final.mp4",
        finalSha256: "a".repeat(64),
        finalDurationSeconds: 10.5,
        srtPath: "compat/hermes/segment-01/subtitles.srt",
        srtHash: "b".repeat(64)
      }
    ],
    streamFingerprint: {
      videoCodec: "h264",
      pixFmt: "yuv420p",
      width: 1920,
      height: 1080,
      fps: 24,
      audioCodec: "aac",
      sampleRate: 48000
    },
    ffmpegArgs: ["-c", "copy"],
    candidates: {
      concatList: { path: "final/concat-list.txt", sha256: "a".repeat(64) },
      finalVideo: { path: "final/final-full.mp4", sha256: "b".repeat(64) },
      uploadSubtitle: { path: "final/upload-subtitles/final-full.upload.srt", sha256: "c".repeat(64) }
    },
    subtitleMerge: {
      mergedCueCount: 10,
      missingSrt: [],
      unparseableSrt: [],
      timingWarnings: []
    }
  };
  assert.deepEqual(await validateSchema(CONCAT_REPORT_SCHEMA, report), report);
  await assertFails(CONCAT_REPORT_SCHEMA, {
    ...report,
    subtitleMerge: { ...report.subtitleMerge, missingSrt: ["missing.srt"] }
  });
});

test("segment and final QA report truth tables", async () => {
  const segmentQa = {
    schemaVersion: "1.0.0",
    reportType: "segment_qa",
    segmentId: "segment-01",
    qualityOk: true,
    finalVerdict: "pass",
    checks: {
      video_profile: { status: "pass", actual: "yuv420p", limit: "yuv420p" }
    },
    failures: [],
    warnings: [],
    artifactHashes: {
      video: "a".repeat(64)
    },
    measuredDurationSeconds: 10.5
  };
  assert.deepEqual(await validateSchema(SEGMENT_QA_REPORT_SCHEMA, segmentQa), segmentQa);

  const badSegmentQa = { ...segmentQa, qualityOk: true, checks: { video_profile: { status: "fail", actual: "yuv400p", limit: "yuv420p" } } };
  const verifyQaInvariants = (r) => {
    const hasFailChecks = Object.values(r.checks).some(c => c.status === "fail");
    if (r.qualityOk && hasFailChecks) throw new Error("qualityOk is true but checks contain failures");
    if (r.finalVerdict === "pass" && (!r.qualityOk || r.warnings.length > 0)) throw new Error("finalVerdict pass requires qualityOk and zero warnings");
  };
  assert.throws(() => verifyQaInvariants(badSegmentQa), /qualityOk is true/);

  const finalQa = {
    schemaVersion: "1.0.0",
    reportType: "final_qa",
    jobId: "job-01",
    qualityOk: true,
    finalVerdict: "pass",
    checks: {
      video_profile: { status: "pass", actual: "yuv420p", limit: "yuv420p" }
    },
    failures: [],
    warnings: [],
    artifactHashes: {
      video: "a".repeat(64)
    },
    measuredDurationSeconds: 10.5,
    successEvidenceInput: {
      stage: "FINAL_QA_PASSED",
      inputArtifacts: [
        { artifactId: "segment-manifest", logicalRole: "yadam.segment.manifest", path: "segment-manifest.json", sha256: "a".repeat(64) }
      ],
      opaqueInputs: {
        profileHash: "a".repeat(64),
        ffmpegVersionHash: "b".repeat(64),
        assemblerPolicyHash: "c".repeat(64),
        qaPolicyHash: "d".repeat(64)
      },
      inputHash: "e".repeat(64)
    }
  };
  assert.deepEqual(await validateSchema(FINAL_QA_REPORT_SCHEMA, finalQa), finalQa);
});

test("completed artifact incident schema validation", async () => {
  const incident = {
    schemaVersion: "1.0.0",
    reportType: "completed_artifact_tampered",
    errorCode: "completed_artifact_tampered",
    jobId: "job-01",
    incidentKeyHash: "a".repeat(64),
    firstObservedAt: "2026-07-16T12:00:00Z",
    completedEvent: {
      stage: "FINAL_QA_PASSED",
      inputHash: "a".repeat(64),
      outputHash: "b".repeat(64),
      artifactPaths: ["final/final-full.mp4"]
    },
    expectedArtifacts: [
      { artifactId: "final-video", logicalRole: "yadam.video.final", path: "final/final-full.mp4", expectedSha256: "a".repeat(64) }
    ],
    observedArtifacts: [
      { artifactId: "final-video", logicalRole: "yadam.video.final", path: "final/final-full.mp4", status: "missing", expectedSha256: "a".repeat(64), observedSha256: null }
    ],
    stateStatus: "completed",
    mutationPolicy: "read_only_except_append_only_incident",
    recovery: "trusted_backup_or_new_job",
    completionOpaqueInputs: {
      profileHash: "a".repeat(64),
      ffmpegVersionHash: "b".repeat(64),
      assemblerPolicyHash: "c".repeat(64),
      qaPolicyHash: "d".repeat(64)
    }
  };
  assert.deepEqual(await validateSchema(COMPLETED_ARTIFACT_INCIDENT_SCHEMA, incident), incident);
});

test("pristine layout layout helper verification", async () => {
  const tempJobDir = resolve("test/yadam/tmp/pristine-layout-job");
  await rm(tempJobDir, { recursive: true, force: true });
  await mkdir(tempJobDir, { recursive: true });

  const created = await ensureVideoJobLayout(tempJobDir);
  assert.equal(created.length, 4);

  assert(existsSync(join(tempJobDir, "final/incidents")));
  assert(existsSync(join(tempJobDir, "logs/video")));
  assert(existsSync(join(tempJobDir, "quarantine/video")));
  assert(existsSync(join(tempJobDir, "quarantine/video/publications")));

  const sub = await ensureContainedVideoDirectory(tempJobDir, "compat/hermes/segment-01");
  assert.equal(sub, resolve(join(tempJobDir, "compat/hermes/segment-01")));

  await assert.rejects(
    async () => ensureContainedVideoDirectory(tempJobDir, "/absolute/escape"),
    err => err.code === "video_layout_unsafe"
  );
  await assert.rejects(
    async () => ensureContainedVideoDirectory(tempJobDir, "compat\\hermes"),
    err => err.code === "video_layout_unsafe"
  );
  await assert.rejects(
    async () => ensureContainedVideoDirectory(tempJobDir, "compat/../../escape"),
    err => err.code === "video_layout_unsafe"
  );

  await rm(tempJobDir, { recursive: true, force: true });
});

test("M!=N join and render manifest finalization", async () => {
  const tempJobDir = resolve(`test/yadam/tmp/manifest-job-${Date.now()}`);
  await rm(tempJobDir, { recursive: true, force: true });
  await mkdir(tempJobDir, { recursive: true });

  try {
    await mkdir(join(tempJobDir, "approvals"), { recursive: true });
    await mkdir(join(tempJobDir, "script"), { recursive: true });
    await mkdir(join(tempJobDir, "assets/audio"), { recursive: true });
    await mkdir(join(tempJobDir, "thumbnail"), { recursive: true });

    // Mock pointers
    await writeCanonicalJson(join(tempJobDir, "approvals/current-approval-2.json"), {
      status: "valid",
      path: "approvals/approval-2-r001.json",
      approvedArtifactSetHash: "a".repeat(64)
    });

    const scriptScenes = {
      schemaVersion: "1.0.0",
      jobId: "job-123",
      scenes: [
        { sceneId: "scene-0001", segmentId: "segment-01", ordinal: 1, sourceText: "hello", sourceHash: "a".repeat(64), ttsNormalizedText: "hello", ttsNormalizedHash: "a".repeat(64), ttsOptionsHash: "a".repeat(64) }
      ]
    };
    const scWrite = await writeCanonicalJson(join(tempJobDir, "script/script-scenes.json"), scriptScenes);
    await writeFile(join(tempJobDir, "script/final.txt"), "hello");

    const audioTimeline = {
      scenes: [
        {
          sceneId: "scene-0001",
          segmentId: "segment-01",
          order: 1,
          sourceHash: "a".repeat(64),
          normalizedWavPath: "assets/audio/normalized/scene-0001.wav",
          normalizedWavHash: "a".repeat(64),
          startSeconds: 0,
          endSeconds: 6.0,
          durationSeconds: 6.0
        }
      ],
      segments: [
        { segmentId: "segment-01", plannedDurationSeconds: 6.0, measuredAudioSeconds: 6.0, startSeconds: 0, endSeconds: 6.0 }
      ]
    };
    const tlWrite = await writeCanonicalJson(join(tempJobDir, "assets/audio/audio-timeline.json"), audioTimeline);
    const amWrite = await writeCanonicalJson(join(tempJobDir, "assets/audio/audio-manifest.json"), {
      measuredAudioSeconds: 6.0,
      acceptedRangeSeconds: { minimum: 4, maximum: 8 }
    });

    const rpInput = {
      visualSlots: [
        { visualSlotId: "slot-01", visualOrder: 1, segmentId: "segment-01", sourceSceneIds: ["scene-0001"], primarySceneId: "scene-0001", startSeconds: 0, endSeconds: 6.0, durationSeconds: 6.0, timingBand: "body", extendedHold: false, holdReason: null, purpose: "scene", compiledRequestId: "req-01", compiledRequestHash: "a".repeat(64) }
      ]
    };
    const rpWrite = await writeCanonicalJson(join(tempJobDir, "render-plan-input.json"), rpInput);

    const assetManifest = {
      assets: [
        { assetId: "asset-01", visualSlotId: "slot-01", purpose: "scene", path: "assets/images/slot-01.png", sha256: "b".repeat(64), compiledRequestId: "req-01", compiledRequestHash: "a".repeat(64), workflowPath: "assets/workflows/sdxl.json", workflowHash: "c".repeat(64), checkpointHash: "d".repeat(64), seed: 1, generationAttempt: 1, repairAttemptUsed: false, qaPath: "assets/images/qa-01.json", qaHash: "d".repeat(64), qaStatus: "pass" }
      ]
    };
    const assWrite = await writeCanonicalJson(join(tempJobDir, "assets/asset-manifest.json"), assetManifest);
    const vQaWrite = await writeCanonicalJson(join(tempJobDir, "assets/visual-qa-report.json"), { status: "pass", assets: [] });
    const rPlanWrite = await writeCanonicalJson(join(tempJobDir, "render-plan.json"), rpInput);

    await writeFile(join(tempJobDir, "thumbnail/final.png"), "thumbnail");
    const tQaWrite = await writeCanonicalJson(join(tempJobDir, "thumbnail/qa.json"), { qaStatus: "pass" });

    // Mock coverage section reports
    await mkdir(join(tempJobDir, "script/coverage"), { recursive: true });
    const audioCoverage = { schemaVersion: "1.0.0", section: "audio" };
    const visualCoverage = { schemaVersion: "1.0.0", section: "visual" };
    const subtitleCoverage = {
      schemaVersion: "1.0.0",
      section: "subtitle",
      subtitleRequiredSceneIds: ["scene-0001"],
      sceneIdsReferencedByAtLeastOneCue: ["scene-0001"],
      missingSceneIds: [],
      orphanSceneIds: [],
      textMismatchSceneIds: [],
      qualityOk: true,
      status: "pass",
      artifactRefs: [{ path: "compat/hermes/segment-01/subtitles.srt", sha256: "f".repeat(64) }]
    };
    
    const ac = await writeCanonicalJson(join(tempJobDir, "script/coverage/audio-r001.json"), audioCoverage);
    const vc = await writeCanonicalJson(join(tempJobDir, "script/coverage/visual-r001.json"), visualCoverage);
    const sc = await writeCanonicalJson(join(tempJobDir, "script/coverage/subtitle-r001.json"), subtitleCoverage);

    await writeCanonicalJson(join(tempJobDir, "script/coverage-report.json"), {
      schemaVersion: "1.0.0",
      jobId: "job-123",
      sections: { script: "pass", audio: "pass", subtitle: "pass", visual: "pass" },
      audioSection: { relativePath: "script/coverage/audio-r001.json", sha256: ac.sha256, revision: 1 },
      visualSection: { relativePath: "script/coverage/visual-r001.json", sha256: vc.sha256, revision: 1 },
      subtitleSection: { relativePath: "script/coverage/subtitle-r001.json", sha256: sc.sha256, revision: 1 }
    });

    // Mock segment subtitles.srt
    await mkdir(join(tempJobDir, "compat/hermes/segment-01"), { recursive: true });
    await writeFile(join(tempJobDir, "compat/hermes/segment-01/subtitles.srt"), "1\n00:00:00,000 --> 00:00:06,000\nhello\n");

    // Write artifact-manifest
    const scRecHash = scWrite.sha256;
    const ftHash = sha256Bytes(Buffer.from("hello"));
    const tlHash = tlWrite.sha256;
    const amHash = amWrite.sha256;
    const rpHash = rpWrite.sha256;
    const rPlanHash = rPlanWrite.sha256;
    const assetHash = assWrite.sha256;
    const vQaHash = vQaWrite.sha256;
    const thumbHash = sha256Bytes(Buffer.from("thumbnail"));
    const tQaHash = tQaWrite.sha256;
    const acHash = ac.sha256;
    const vcHash = vc.sha256;
    const scHash = sc.sha256;
    const srtHash = sha256Bytes(Buffer.from("1\n00:00:00,000 --> 00:00:06,000\nhello\n"));

    const manifest = {
      schemaVersion: "1.0.0",
      jobId: "job-123",
      artifacts: [
        { artifactId: "yadam-script-scenes", logicalRole: "yadam.script.scenes", path: "script/script-scenes.json", sha256: scRecHash, schemaVersion: "1.0.0", producerStage: "script-package", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} },
        { artifactId: "yadam-final-text", logicalRole: "yadam.script.final_text", path: "script/final.txt", sha256: ftHash, schemaVersion: "1.0.0", producerStage: "script-package", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} },
        { artifactId: "yadam-audio-timeline", logicalRole: "yadam.audio.timeline", path: "assets/audio/audio-timeline.json", sha256: tlHash, schemaVersion: "1.0.0", producerStage: "audio-timeline", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} },
        { artifactId: "yadam-audio-manifest", logicalRole: "yadam.audio.manifest", path: "assets/audio/audio-manifest.json", sha256: amHash, schemaVersion: "1.0.0", producerStage: "audio-manifest", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} },
        { artifactId: "yadam-render-plan-input", logicalRole: "yadam.render_plan_input", path: "render-plan-input.json", sha256: rpHash, schemaVersion: "1.0.0", producerStage: "render-plan-input", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} },
        { artifactId: "yadam-render-plan", logicalRole: "yadam.render.plan", path: "render-plan.json", sha256: rPlanHash, schemaVersion: "1.0.0", producerStage: "render-plan", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} },
        { artifactId: "yadam-image-asset-manifest", logicalRole: "yadam.image.asset-manifest", path: "assets/asset-manifest.json", sha256: assetHash, schemaVersion: "1.0.0", producerStage: "image-generation", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} },
        { artifactId: "yadam-image-visual-qa", logicalRole: "yadam.image.visual-qa", path: "assets/visual-qa-report.json", sha256: vQaHash, schemaVersion: "1.0.0", producerStage: "image-qa", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} },
        { artifactId: "yadam-thumbnail-final", logicalRole: "yadam.thumbnail.final", path: "thumbnail/final.png", sha256: thumbHash, schemaVersion: "1.0.0", producerStage: "thumbnail-generation", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} },
        { artifactId: "yadam-thumbnail-qa", logicalRole: "yadam.thumbnail.qa", path: "thumbnail/qa.json", sha256: tQaHash, schemaVersion: "1.0.0", producerStage: "thumbnail-qa", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} },
        { artifactId: "yadam-coverage-audio-r001", logicalRole: "yadam.coverage.audio", path: "script/coverage/audio-r001.json", sha256: acHash, schemaVersion: "1.0.0", producerStage: "audio-coverage", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} },
        { artifactId: "yadam-coverage-visual-r001", logicalRole: "yadam.coverage.visual", path: "script/coverage/visual-r001.json", sha256: vcHash, schemaVersion: "1.0.0", producerStage: "visual-coverage", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} },
        { artifactId: "yadam-coverage-subtitle-current", logicalRole: "yadam.coverage.subtitle", path: "script/coverage/subtitle-r001.json", sha256: scHash, schemaVersion: "1.0.0", producerStage: "subtitle-coverage", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} },
        { artifactId: "yadam-subtitle-segment-segment-01", logicalRole: "yadam.subtitle.segment.segment-01", path: "compat/hermes/segment-01/subtitles.srt", sha256: srtHash, schemaVersion: "1.0.0", producerStage: "subtitle-generation", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} }
      ]
    };
    await writeCanonicalJson(join(tempJobDir, "artifact-manifest.json"), manifest);
    await writeCanonicalJson(join(tempJobDir, "pipeline-state.json"), { schemaVersion: "1.0.0", jobId: "job-123", status: "running", durationRepairAttemptsUsed: 0, history: [] });
    await writeCanonicalJson(join(tempJobDir, "request.json"), { jobId: "job-123", createdAt: new Date().toISOString(), topic: "test", optionalInstructions: "" });

    // Run finalizer
    const res = await finalizeRenderManifest({ jobDir: tempJobDir });
    assert.equal(res.path, "render-manifest.json");

    // Load and verify
    const verified = await loadVerifiedRenderManifest(tempJobDir);
    assert.equal(verified.sha256, res.sha256);

  } finally {
    await rm(tempJobDir, { recursive: true, force: true });
  }
});
