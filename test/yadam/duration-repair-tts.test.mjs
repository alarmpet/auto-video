import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createTtsService } from "../../scripts/lib/yadam/tts-service-core.mjs";
import { writeCanonicalJson } from "../../scripts/lib/pipeline/atomic-store.mjs";
import { loadProfile, loadHostConfig } from "../../scripts/lib/pipeline/profile-registry.mjs";
import { loadJob, createJob } from "../../scripts/lib/pipeline/job-store.mjs";
import { registerArtifact } from "../../scripts/lib/pipeline/artifact-store.mjs";
import { hashCanonical, sha256Bytes } from "../../scripts/lib/pipeline/canonical-json.mjs";

test("duration repair orchestrator successful pass (no repair needed)", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "yadam-repair-pass-"));
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
    await mkdir(join(rootDir, "config"), { recursive: true });
    await writeCanonicalJson(join(rootDir, "config", "host.local.json"), hostConfig);

    const context = await createJob({ workspaceRoot: rootDir, request: requestPayload, profile, hostConfig });
    const jobDir = context.jobDir;

    // Create scene plan
    const scenePlanData = {
      schemaVersion: "1.0.0",
      jobId: context.state.jobId,
      stageId: "scene-planning",
      inputHash: "a".repeat(64),
      scenePlans: [
        { sceneId: "scene-0001", slots: [], tts: { continuousNext: false, readSlow: false } }
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

    // Create script scenes
    const scriptScenesData = {
      schemaVersion: "1.0.0",
      jobId: context.state.jobId,
      scenes: []
    };
    await writeCanonicalJson(join(jobDir, "script/script-scenes.json"), scriptScenesData);

    const opt = {
      model: "supertonic-3", voice: "M1", language: "ko", speed: 1.04, totalStep: 8,
      silenceSeconds: 0.38, readSlow: false, continuousNext: false
    };
    const text = "테스트";
    const textNFC = text.normalize("NFC");
    const h = sha256Bytes(Buffer.from(textNFC, "utf8"));

    // Mock getApprovedTtsInput
    const mockGetApprovedTtsInput = async () => ({
      approvalRevisionPath: "approvals/approval-r001.json",
      finalTextHash: "b".repeat(64),
      scriptScenesHash: "c".repeat(64),
      scenes: [
        {
          sceneId: "scene-0001", segmentId: "segment-01", ordinal: 1,
          sourceText: text, sourceHash: h,
          ttsNormalizedText: text, ttsNormalizedHash: h,
          ttsOptionsHash: hashCanonical(opt)
        }
      ]
    });

    const mockRunSceneBatch = async () => ({
      results: [
        {
          sceneId: "scene-0001", segmentId: "segment-01", order: 1,
          sourceHash: h, ttsNormalizedHash: h, ttsOptionsHash: hashCanonical(opt),
          transport: "cli", providerJobId: null,
          rawPath: "assets/audio/raw/scene-0001.wav", rawSha256: "f".repeat(64),
          normalizedPath: "assets/audio/normalized/scene-0001.wav", normalizedSha256: "a".repeat(64),
          media: {
            codec: "pcm_s16le", sampleFormat: "s16", sampleRate: 48000, channels: 1, channelLayout: "mono",
            durationSeconds: 599.5 // 10 minutes target is 600s, 599.5 is in range
          },
          attempts: 1, elapsedMs: 0, providerProvenance: null
        }
      ],
      requestHashes: { "scene-0001": h }
    });

    const svc = createTtsService({
      loadJob,
      getApprovedTtsInput: mockGetApprovedTtsInput,
      requestDurationRepair: async () => assert.fail("Should not request repair"),
      rebuildApproval2AfterDurationRepair: async () => assert.fail("Should not rebuild bundle"),
      refreshApproval2Previews: async () => {},
      publishAudioNeedsReview: async () => {},
      runSceneBatch: mockRunSceneBatch,
      buildAndPublishAudioTimeline: () => {},
      publishRenderPlanInput: async () => ({ path: "render-plan-input.json", sha256: "a".repeat(64) }),
      now: () => new Date().toISOString()
    });

    let res;
    try {
      res = await svc.runFullTtsCore({ jobDir });
    } catch (err) {
      if (err.name === "SchemaValidationError") {
        console.error("DEBUG SCHEMA ERRORS:", JSON.stringify(err.details, null, 2));
      }
      throw err;
    }
    assert.equal(res.status, "audio_passed");
    assert.equal(res.measuredAudioSeconds, 599.5);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("duration repair orchestrator repair success path", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "yadam-repair-success-"));
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
    await mkdir(join(rootDir, "config"), { recursive: true });
    await writeCanonicalJson(join(rootDir, "config", "host.local.json"), hostConfig);

    const context = await createJob({ workspaceRoot: rootDir, request: requestPayload, profile, hostConfig });
    const jobDir = context.jobDir;

    // Create scene plan
    const scenePlanData = {
      schemaVersion: "1.0.0",
      jobId: context.state.jobId,
      stageId: "scene-planning",
      inputHash: "a".repeat(64),
      scenePlans: [
        { sceneId: "scene-0001", slots: [], tts: { continuousNext: false, readSlow: false } }
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

    // Create script scenes
    const scriptScenesData = {
      schemaVersion: "1.0.0",
      jobId: context.state.jobId,
      scenes: []
    };
    await writeCanonicalJson(join(jobDir, "script/script-scenes.json"), scriptScenesData);

    const opt = {
      model: "supertonic-3", voice: "M1", language: "ko", speed: 1.04, totalStep: 8,
      silenceSeconds: 0.38, readSlow: false, continuousNext: false
    };
    const text = "테스트";
    const textNFC = text.normalize("NFC");
    const h = sha256Bytes(Buffer.from(textNFC, "utf8"));

    const mockGetApprovedTtsInput = async () => ({
      approvalRevisionPath: "approvals/approval-r001.json",
      finalTextHash: "b".repeat(64),
      scriptScenesHash: "c".repeat(64),
      scenes: [
        {
          sceneId: "scene-0001", segmentId: "segment-01", ordinal: 1,
          sourceText: text, sourceHash: h,
          ttsNormalizedText: text, ttsNormalizedHash: h,
          ttsOptionsHash: hashCanonical(opt)
        }
      ]
    });

    let runCount = 0;
    const mockRunSceneBatch = async () => {
      runCount++;
      return {
        results: [
          {
            sceneId: "scene-0001", segmentId: "segment-01", order: 1,
            sourceHash: h, ttsNormalizedHash: h, ttsOptionsHash: hashCanonical(opt),
            transport: "cli", providerJobId: null,
            rawPath: "assets/audio/raw/scene-0001.wav", rawSha256: "f".repeat(64),
            normalizedPath: "assets/audio/normalized/scene-0001.wav", normalizedSha256: "a".repeat(64),
            media: {
              codec: "pcm_s16le", sampleFormat: "s16", sampleRate: 48000, channels: 1, channelLayout: "mono",
              durationSeconds: runCount === 1 ? 760.0 : 680.0
            },
            attempts: 1, elapsedMs: 0, providerProvenance: null
          }
        ],
        requestHashes: { "scene-0001": h }
      };
    };

    let repairRequested = false;
    let rebuildCalled = false;

    const svc = createTtsService({
      loadJob,
      getApprovedTtsInput: mockGetApprovedTtsInput,
      requestDurationRepair: async () => {
        repairRequested = true;

        // Mock authorized repair report files
        await mkdir(join(jobDir, "script"), { recursive: true });
        const report = {
          schemaVersion: "1.0.0",
          reportType: "yadam_duration_repair_authorization",
          jobId: context.state.jobId,
          attempt: 1,
          status: "repaired",
          createdAt: new Date().toISOString(),
          approvalTwo: {
            invalidatedRevisionPath: "approvals/approval-r001.json",
            approvedArtifactSetHash: "a".repeat(64)
          },
          measurement: {
            measuredDurationSeconds: 760.0,
            acceptedRangeSeconds: { minimum: 480.0, maximum: 720.0 },
            sourceArtifactId: "manifest",
            sourceArtifactHash: "a".repeat(64)
          },
          semanticContractHash: "a".repeat(64),
          changedSegmentIds: ["segment-01"],
          changedSceneIds: ["scene-0001"],
          before: {
            finalTextHash: "b".repeat(64),
            scriptScenesHash: "c".repeat(64),
            scenePlanHash: "d".repeat(64),
            qaReportHash: "e".repeat(64),
            scriptCoverageHash: "a".repeat(64)
          },
          after: {
            finalTextHash: "b".repeat(64),
            scriptScenesHash: "c".repeat(64),
            scenePlanHash: "d".repeat(64),
            qaReportHash: "e".repeat(64),
            scriptCoverageHash: "b".repeat(64)
          },
          changedScenes: [
            {
              sceneId: "scene-0001", segmentId: "segment-01", ordinal: 1,
              sourceText: text, sourceHash: h,
              ttsNormalizedText: text, ttsNormalizedHash: h,
              ttsOptionsHash: hashCanonical(opt)
            }
          ],
          changedSceneSetHash: hashCanonical(["scene-0001"])
        };

        const inputHash = hashCanonical({
          invalidatedRevisionPath: "approvals/approval-r001.json",
          before: report.before,
          measurement: report.measurement,
          semanticContractHash: "a".repeat(64)
        });

        report.provenance = { inputHash };

        // Compute authorizationHash
        const reportForAuth = { ...report };
        delete reportForAuth.authorizationHash;
        report.authorizationHash = hashCanonical(reportForAuth);

        await writeCanonicalJson(join(jobDir, "script/duration-repair-report.json"), report);

        // Mock current script coverage
        await writeCanonicalJson(join(jobDir, "script/coverage-report.json"), {
          schemaVersion: "1.0.0",
          jobId: context.state.jobId,
          sections: { script: "pass", audio: "pending", subtitle: "pending", visual: "pending" },
          scriptSection: { relativePath: "script/coverage/script-r001.json", sha256: "b".repeat(64), revision: 1 }
        });

        // Set state properties
        context.state.durationRepairAttemptsUsed = 1;
        context.state.status = "running";
        context.state.history = [
          {
            from: "pending",
            to: "running",
            stage: "DURATION_REPAIR_REQUIRED",
            attempt: 1,
            inputHash,
            at: new Date().toISOString()
          },
          {
            from: "running",
            to: "running",
            stage: "REGENERATING_CHANGED_AUDIO",
            inputHash: "a".repeat(64),
            at: new Date().toISOString()
          }
        ];
        await writeCanonicalJson(join(jobDir, "pipeline-state.json"), context.state);

        return {
          status: "repaired",
          attempt: 1,
          changedSegmentIds: ["segment-01"],
          changedSceneIds: ["scene-0001"]
        };
      },
      rebuildApproval2AfterDurationRepair: async () => {
        rebuildCalled = true;
        return {
          status: "awaiting_reapproval",
          revision: 2,
          bundlePath: "approvals/approval-r002.json",
          approvedArtifactSetHash: "a".repeat(64)
        };
      },
      refreshApproval2Previews: async () => {},
      publishAudioNeedsReview: async () => {},
      runSceneBatch: mockRunSceneBatch,
      buildAndPublishAudioTimeline: () => {},
      publishRenderPlanInput: async () => ({ path: "render-plan-input.json", sha256: "a".repeat(64) }),
      now: () => new Date().toISOString()
    });

    const res = await svc.runFullTtsCore({ jobDir });
    assert.equal(repairRequested, true);
    assert.equal(rebuildCalled, true);
    assert.equal(res.status, "awaiting_reapproval");
    assert.equal(res.revision, 2);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
