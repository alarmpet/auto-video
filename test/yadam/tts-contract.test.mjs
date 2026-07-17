import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { loadProfile, loadHostConfig } from "../../scripts/lib/pipeline/profile-registry.mjs";
import { validateSchema } from "../../scripts/lib/pipeline/schema-registry.mjs";

const root = resolve(".");

test("yadam locks asynchronous Supertonic production policy", async () => {
  const profile = await loadProfile("yadam", root);
  assert.equal(profile.tts.productionEndpoint, "/api/tts-job");
  assert.equal(profile.tts.diagnosticEndpoint, "/api/tts");
  assert.equal(profile.tts.pollIntervalMs, 1000);
  assert.equal(profile.tts.sceneTimeoutMs, 900000);
  assert.equal(profile.tts.transientAttempts, 3);
  assert.deepEqual(profile.tts.normalizedAudio, {
    codec: "pcm_s16le",
    sampleFormat: "s16",
    sampleRate: 48000,
    channels: 1,
    channelLayout: "mono",
  });
  const host = await loadHostConfig(root);
  assert.equal(host.supertonic.baseUrl, "http://127.0.0.1:3093");
  assert.equal(host.supertonic.allowedOutputRoots.length, 1);
});

test("TTS request schema is closed", async () => {
  const request = {
    schemaVersion: "1.0.0",
    jobId: "job-20260716-230000-1234abcd",
    sceneId: "scene-0001",
    segmentId: "segment-01",
    order: 1,
    sourceHash: "a".repeat(64),
    ttsNormalizedHash: "b".repeat(64),
    ttsOptionsHash: "c".repeat(64),
    idempotencyKey: "d".repeat(64),
    text: "옛날 어느 고을에 한 선비가 살았습니다.",
    provider: "supertonic",
    adapterVersion: "1.0.0",
    model: "supertonic-3",
    voice: "M1",
    language: "ko",
    speed: 1.04,
    totalStep: 8,
    silenceSeconds: 0.38,
    readSlow: false,
    continuousNext: false,
  };
  const schema = resolve("schemas/yadam/tts-scene-request.schema.json");
  assert.deepEqual(await validateSchema(schema, request), request);
  await assert.rejects(
    async () => validateSchema(schema, { ...request, imagePath: "assets/images/a.png" }),
    error => error.name === "SchemaValidationError" && error.code === "schema_validation_failed"
  );
});

test("audio normalization report schema is closed", async () => {
  const report = {
    schemaVersion: "1.0.0",
    profileId: "yadam",
    jobId: "job-20260716-230000-1234abcd",
    rows: [
      {
        sceneId: "scene-0001",
        segmentId: "segment-01",
        order: 1,
        sourceHash: "a".repeat(64),
        ttsNormalizedHash: "b".repeat(64),
        ttsOptionsHash: "c".repeat(64),
        transport: "http",
        providerJobId: "prov-job-001",
        rawPath: "assets/audio/raw/scene-0001.wav",
        rawSha256: "d".repeat(64),
        normalizedPath: "assets/audio/normalized/scene-0001.wav",
        normalizedSha256: "e".repeat(64),
        media: {
          codec: "pcm_s16le",
          sampleFormat: "s16",
          sampleRate: 48000,
          channels: 1,
          channelLayout: "mono",
          durationSeconds: 12.5,
        },
        attempts: 1,
        elapsedMs: 2500,
        providerProvenance: { url: "http://example.com/audio.wav" },
      }
    ],
    dependencyHashes: {
      "yadam.tts.request.scene-0001": "f".repeat(64),
    }
  };
  const schema = resolve("schemas/yadam/audio-normalization-report.schema.json");
  assert.deepEqual(await validateSchema(schema, report), report);

  // Reject absolute normalizedPath (e.g. starts with / or C:)
  const invalidPath = {
    ...report,
    rows: [{ ...report.rows[0], normalizedPath: "/absolute/path.wav" }]
  };
  await assert.rejects(
    async () => validateSchema(schema, invalidPath),
    error => error.name === "SchemaValidationError" && error.code === "schema_validation_failed"
  );

  // Reject missing request dependency (empty dependencyHashes)
  const missingDependency = {
    ...report,
    dependencyHashes: {}
  };
  await assert.rejects(
    async () => validateSchema(schema, missingDependency),
    error => error.name === "SchemaValidationError" && error.code === "schema_validation_failed"
  );

  // Reject unknown media field
  const unknownMediaField = {
    ...report,
    rows: [{
      ...report.rows[0],
      media: {
        ...report.rows[0].media,
        bitRate: 128000
      }
    }]
  };
  await assert.rejects(
    async () => validateSchema(schema, unknownMediaField),
    error => error.name === "SchemaValidationError" && error.code === "schema_validation_failed"
  );
});

test("audio needs-review evidence schema is closed", async () => {
  const needsReview = {
    schemaVersion: "1.0.0",
    reportType: "yadam_audio_needs_review",
    jobId: "job-20260716-230000-1234abcd",
    status: "needs_review",
    errorCode: "duration_repair_failed",
    createdAt: "2026-07-16T23:00:00Z",
    inputHash: "a".repeat(64),
    measuredAudioSeconds: 800.0,
    acceptedRangeSeconds: { minimum: 480.0, maximum: 720.0 },
    repairAttempt: 1,
    providerOrphan: null,
    evidence: [
      {
        artifactId: "yadam.audio.manifest",
        path: "assets/audio/audio-manifest.json",
        sha256: "b".repeat(64),
      }
    ],
    dependencyHashes: {
      "yadam.audio.manifest": "b".repeat(64),
    }
  };
  const schema = resolve("schemas/yadam/audio-needs-review.schema.json");
  assert.deepEqual(await validateSchema(schema, needsReview), needsReview);

  await assert.rejects(
    async () => validateSchema(schema, { ...needsReview, retryAutomatically: true }),
    error => error.name === "SchemaValidationError" && error.code === "schema_validation_failed"
  );
});

import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJob } from "../../scripts/lib/pipeline/job-store.mjs";
import { writeCanonicalJson } from "../../scripts/lib/pipeline/atomic-store.mjs";
import { registerArtifact } from "../../scripts/lib/pipeline/artifact-store.mjs";
import { buildTtsRequests, buildTtsIdempotencyKey, assertApprovedSceneOrder } from "../../scripts/lib/yadam/tts-request.mjs";
import { hashCanonical, sha256Bytes } from "../../scripts/lib/pipeline/canonical-json.mjs";

test("buildTtsRequests builds correct scene requests and verifies option mappings", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "yadam-request-test-"));
  const exportsDir = join(rootDir, "exports");
  await mkdir(exportsDir, { recursive: true });

  const hostConfig = {
    schemaVersion: "1.0.0",
    workspaceRoot: rootDir,
    exportsRoot: exportsDir,
    supertonic: {
      baseUrl: "http://127.0.0.1:3093",
      allowedOutputRoots: [join(rootDir, "supertonic-data").replaceAll("\\", "/")]
    }
  };

  const profile = await loadProfile("yadam", resolve("."));
  const requestPayload = {
    schemaVersion: "1.0.0",
    profileId: "yadam",
    inputMode: "genre",
    source: { kind: "genre", value: "test" },
    targetMinutes: 10,
    durationTolerance: 0.20,
    approvalMode: "two-stage",
    seed: 1,
    createdAt: new Date().toISOString()
  };

  try {
    const context = await createJob({ workspaceRoot: rootDir, request: requestPayload, profile, hostConfig });
    const jobDir = context.jobDir;

    // Create scene plan
    const scenePlanData = {
      schemaVersion: "1.0.0",
      jobId: context.state.jobId,
      stageId: "scene-planning",
      inputHash: "00000000000000000000000000000000000000000000000000000000000000aa",
      scenePlans: [
        { sceneId: "scene-0001", slots: [], tts: { continuousNext: false, readSlow: false } },
        { sceneId: "scene-0002", slots: [], tts: { continuousNext: true, readSlow: true } },
        { sceneId: "scene-0003", slots: [], tts: { continuousNext: false, readSlow: false } }
      ]
    };

    const scenePlanWrite = await writeCanonicalJson(join(jobDir, "planning/scene-plan.json"), scenePlanData);
    await registerArtifact(jobDir, {
      artifactId: "yadam-scene-plan",
      logicalRole: "yadam.scene.plan",
      path: "planning/scene-plan.json",
      sha256: scenePlanWrite.sha256,
      schemaVersion: "1.0.0",
      producerStage: "scene-planning",
      gateStatus: "pass",
      dependencyHashes: {}
    });

    const opt1 = {
      model: "supertonic-3", voice: "M1", language: "ko", speed: 1.04, totalStep: 8,
      silenceSeconds: 0.38, readSlow: false, continuousNext: false
    };
    const opt2 = {
      model: "supertonic-3", voice: "M1", language: "ko", speed: 1.04, totalStep: 8,
      silenceSeconds: 0.04, readSlow: true, continuousNext: true
    };

    const text1 = "옛날 어느 고을에 한 선비가 살았습니다.";
    const text2 = "그는 매일 글만 읽었습니다.";
    const text3 = "하루는 아내가 말했습니다.";

    const text1NFC = text1.normalize("NFC");
    const text2NFC = text2.normalize("NFC");
    const text3NFC = text3.normalize("NFC");

    const approvedInput = {
      approvalRevisionPath: "approvals/approval-r001.json",
      finalTextHash: "00000000000000000000000000000000000000000000000000000000000000bb",
      scriptScenesHash: "00000000000000000000000000000000000000000000000000000000000000cc",
      scenes: [
        {
          sceneId: "scene-0001", segmentId: "segment-01", ordinal: 1,
          sourceText: text1, sourceHash: sha256Bytes(Buffer.from(text1NFC, "utf8")),
          ttsNormalizedText: text1, ttsNormalizedHash: sha256Bytes(Buffer.from(text1NFC, "utf8")),
          ttsOptionsHash: hashCanonical(opt1)
        },
        {
          sceneId: "scene-0002", segmentId: "segment-01", ordinal: 2,
          sourceText: text2, sourceHash: sha256Bytes(Buffer.from(text2NFC, "utf8")),
          ttsNormalizedText: text2, ttsNormalizedHash: sha256Bytes(Buffer.from(text2NFC, "utf8")),
          ttsOptionsHash: hashCanonical(opt2)
        },
        {
          sceneId: "scene-0003", segmentId: "segment-01", ordinal: 3,
          sourceText: text3, sourceHash: sha256Bytes(Buffer.from(text3NFC, "utf8")),
          ttsNormalizedText: text3, ttsNormalizedHash: sha256Bytes(Buffer.from(text3NFC, "utf8")),
          ttsOptionsHash: hashCanonical(opt1)
        }
      ]
    };

    const requests = await buildTtsRequests({ jobDir, approvedInput });

    assert.deepEqual(requests.map((row) => row.order), [1, 2, 3]);
    assert.deepEqual(requests.map((row) => row.silenceSeconds), [0.38, 0.04, 0.38]);
    assert.deepEqual(requests.map((row) => row.speed), [1.04, 1.04, 1.04]);
    assert.deepEqual(requests.map((row) => row.readSlow), [false, true, false]);
    assert.equal(requests[0].idempotencyKey.length, 64);
    assert.equal(requests[0].text, text1);
    assert.notEqual(requests[0].idempotencyKey, requests[1].idempotencyKey);
    assert.throws(() => assertApprovedSceneOrder([{ ordinal: 1 }, { ordinal: 3 }]), /scene_order_not_contiguous/);

  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

