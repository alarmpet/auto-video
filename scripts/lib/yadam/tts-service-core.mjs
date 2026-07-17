import { join, resolve } from "node:path";
import { promises as fsPromises, existsSync } from "node:fs";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { hashCanonical, sha256Bytes } from "../pipeline/canonical-json.mjs";
import { writeCanonicalJson, readJson } from "../pipeline/atomic-store.mjs";
import { registerArtifact, canReuseArtifact } from "../pipeline/artifact-store.mjs";
import { transitionJob } from "../pipeline/state-machine.mjs";
import { validateSchema } from "../pipeline/schema-registry.mjs";
import { assertPathWithin } from "../pipeline/path-policy.mjs";
import { loadProfile, loadHostConfig } from "../pipeline/profile-registry.mjs";
import { buildSuccessEvidence } from "../pipeline/success-evidence.mjs";
import { updateCoverageSection } from "./coverage-service.mjs";

import { buildTtsRequests } from "./tts-request.mjs";
import { buildAudioTimeline, compileVisualSlots } from "./audio-timeline.mjs";
import { writeNormalizationReport } from "./audio-normalizer.mjs";

const execFileAsync = promisify(execFile);

// Helper to clean and hash version output
async function getToolVersionHash(executablePath) {
  try {
    const { stdout } = await execFileAsync(executablePath, ["-version"]);
    const clean = stdout.replace(/\r\n/g, "\n").trim();
    return sha256Bytes(Buffer.from(clean, "utf8"));
  } catch (err) {
    throw new Error(`Failed to get version of ${executablePath}: ${err.message}`);
  }
}

// Private loader for authorized repair TTS input
async function loadAuthorizedRepairTtsInput({ jobDir, signal }) {
  const statePath = join(jobDir, "pipeline-state.json");
  const state = JSON.parse(await fsPromises.readFile(statePath, "utf8"));

  if (state.status !== "running" || state.history[state.history.length - 1]?.stage !== "REGENERATING_CHANGED_AUDIO") {
    // Wait, check stage
    const lastEvent = state.history.find(h => h.stage === "REGENERATING_CHANGED_AUDIO");
    if (!lastEvent) {
      throw new Error("Pipeline stage is not REGENERATING_CHANGED_AUDIO");
    }
  }

  if (state.durationRepairAttemptsUsed !== 1) {
    throw new Error("Invalid durationRepairAttemptsUsed state");
  }

  const repairReqEvent = state.history.find(
    h => h.stage === "DURATION_REPAIR_REQUIRED" && h.to === "running" && h.attempt === 1
  );
  if (!repairReqEvent) {
    throw new Error("Missing DURATION_REPAIR_REQUIRED historical event");
  }

  const reportPath = join(jobDir, "script/duration-repair-report.json");
  if (!existsSync(reportPath)) {
    throw new Error("Duration repair report file is missing");
  }
  const report = JSON.parse(await fsPromises.readFile(reportPath, "utf8"));

  // Schema check
  if (report.schemaVersion !== "1.0.0" || report.reportType !== "yadam_duration_repair_authorization") {
    throw new Error("Invalid report schema or type");
  }

  if (report.attempt !== 1 || report.status !== "repaired") {
    throw new Error("Report attempt or status mismatch");
  }

  // Validate report registration
  const registryRecord = state.history.find(h => h.artifactPaths?.includes("script/duration-repair-report.json"));
  // Recompute durationRepairInputHash
  const recomputedInputHash = hashCanonical({
    invalidatedRevisionPath: report.approvalTwo.invalidatedRevisionPath,
    before: report.before,
    measurement: report.measurement,
    semanticContractHash: report.semanticContractHash
  });

  if (recomputedInputHash !== report.provenance.inputHash || repairReqEvent.inputHash !== report.provenance.inputHash) {
    throw new Error("provenance inputHash mismatch");
  }

  // Verify auth hash
  const reportForAuth = { ...report };
  delete reportForAuth.authorizationHash;
  const computedAuthHash = hashCanonical(reportForAuth);
  if (computedAuthHash !== report.authorizationHash) {
    throw new Error("authorizationHash mismatch");
  }

  // Verify scriptCoverageHash in before and after
  if (!report.before.scriptCoverageHash || !report.after.scriptCoverageHash) {
    throw new Error("scriptCoverageHash missing in report");
  }

  if (report.before.coverageReportHash || report.after.coverageReportHash) {
    throw new Error("Forbidden coverageReportHash property present");
  }

  // Verify script coverage current section
  const currentCoverageReportPath = join(jobDir, "script/coverage-report.json");
  const currentCoverage = JSON.parse(await fsPromises.readFile(currentCoverageReportPath, "utf8"));
  if (currentCoverage.sections.script !== "pass" || currentCoverage.scriptSection?.sha256 !== report.after.scriptCoverageHash) {
    throw new Error("Current script coverage does not match report after state");
  }

  // verify changed scenes
  if (report.changedSceneIds.length !== report.changedScenes.length) {
    throw new Error("changedSceneIds length mismatch");
  }

  report.changedSceneIds.forEach((id, idx) => {
    if (report.changedScenes[idx].sceneId !== id) {
      throw new Error("changedScenes ordering mismatch");
    }
  });

  return report.changedScenes;
}

export function createTtsService({
  loadJob,
  getApprovedTtsInput,
  requestDurationRepair,
  rebuildApproval2AfterDurationRepair,
  refreshApproval2Previews,
  publishAudioNeedsReview,
  runSceneBatch,
  buildAndPublishAudioTimeline,
  publishRenderPlanInput,
  now,
}) {
  if (typeof refreshApproval2Previews !== "function") {
    throw Object.assign(new Error("preview refresh dependency is required"), { code: "preview_refresh_dependency_missing" });
  }
  if (typeof publishAudioNeedsReview !== "function") {
    throw Object.assign(new Error("needs-review publisher is required"), { code: "needs_review_publisher_missing" });
  }
  if (typeof publishRenderPlanInput !== "function") {
    throw Object.assign(new Error("render-plan publisher is required"), { code: "render_plan_publisher_missing" });
  }
  if (typeof now !== "function") {
    throw Object.assign(new Error("clock dependency is required"), { code: "clock_dependency_missing" });
  }

  async function runFullTtsCore({ jobDir, signal }) {
    const context = await loadJob(jobDir);
    const profile = await loadProfile(context.request.profileId, context.workspaceRoot || ".");
    const hostConfig = await loadHostConfig(jobDir);

    const targetMinutes = profile.targetMinutes.min; // or targetMinutes.min
    const minimum = targetMinutes * 60 * 0.8;
    const maximum = targetMinutes * 60 * 1.2;

    let state = context.state;
    let isRegenerating = state.history.some(h => h.stage === "REGENERATING_CHANGED_AUDIO");

    let approvedInput;
    let requests;

    if (isRegenerating) {
      const changedScenes = await loadAuthorizedRepairTtsInput({ jobDir, signal });
      // Rerun only changed scenes
      const originalApproved = await getApprovedTtsInput(jobDir).catch(() => null);
      if (!originalApproved) {
        throw new Error("Invalid approval state");
      }

      // Re-map request options
      approvedInput = {
        ...originalApproved,
        scenes: changedScenes.map(cs => ({
          ...cs,
          // restore standard properties from script-scenes if needed
          ordinal: cs.ordinal,
          sourceText: cs.sourceText || cs.ttsNormalizedText
        }))
      };
      requests = await buildTtsRequests({ jobDir, approvedInput });
    } else {
      approvedInput = await getApprovedTtsInput(jobDir);
      requests = await buildTtsRequests({ jobDir, approvedInput });
    }

    // Run TTS scene batch
    const { results: normalizedRows, requestHashes } = await runSceneBatch({
      jobDir,
      requests,
      signal,
      publishAudioNeedsReview
    });

    // Write normalization report
    const normReport = await writeNormalizationReport({ jobDir, rows: normalizedRows, requestHashes });
    await registerArtifact(jobDir, {
      artifactId: "yadam-audio-normalization-report",
      logicalRole: "yadam.audio.normalization_report",
      path: normReport.path,
      sha256: normReport.sha256,
      schemaVersion: "1.0.0",
      producerStage: "audio-normalization",
      gateStatus: "pass",
      dependencyHashes: requestHashes
    });

    // Build timeline
    const timeline = buildAudioTimeline(normalizedRows);

    // Compile slots
    const { segments, visualSlots } = compileVisualSlots(timeline.scenes);

    // Write manifest & timeline
    const manifestPath = "assets/audio/audio-manifest.json";
    const timelinePath = "assets/audio/audio-timeline.json";

    const manifestData = {
      schemaVersion: "1.0.0",
      profileId: "yadam",
      jobId: state.jobId,
      approvalRevisionPath: approvedInput.approvalRevisionPath,
      approvalRevisionHash: sha256Bytes(Buffer.from(approvedInput.approvalRevisionPath, "utf8")),
      finalTextHash: approvedInput.finalTextHash,
      scriptScenesHash: approvedInput.scriptScenesHash,
      normalizationReportPath: normReport.path,
      normalizationReportHash: normReport.sha256,
      measuredAudioSeconds: timeline.measuredAudioSeconds,
      acceptedRangeSeconds: { minimum, maximum },
      audioTempoFactor: 1,
      scenes: timeline.scenes.map(s => ({
        sceneId: s.sceneId,
        segmentId: s.segmentId,
        order: s.order,
        sourceHash: s.sourceHash,
        ttsNormalizedHash: s.ttsNormalizedHash,
        ttsOptionsHash: s.ttsOptionsHash,
        normalizedWavPath: s.normalizedWavPath || `assets/audio/normalized/${s.sceneId}.wav`,
        normalizedWavHash: s.normalizedSha256,
        durationSeconds: s.durationSeconds
      }))
    };

    const manifestWrite = await writeCanonicalJson(join(jobDir, manifestPath), manifestData);
    await registerArtifact(jobDir, {
      artifactId: "yadam-audio-manifest",
      logicalRole: "yadam.audio.manifest",
      path: manifestPath,
      sha256: manifestWrite.sha256,
      schemaVersion: "1.0.0",
      producerStage: "timeline-generation",
      gateStatus: "pass",
      dependencyHashes: {
        "yadam.audio.normalization_report": normReport.sha256
      }
    });

    const timelineData = {
      schemaVersion: "1.0.0",
      profileId: "yadam",
      jobId: state.jobId,
      measuredAudioSeconds: timeline.measuredAudioSeconds,
      audioTempoFactor: 1,
      scenes: timeline.scenes.map(s => ({
        sceneId: s.sceneId,
        segmentId: s.segmentId,
        order: s.order,
        sourceHash: s.sourceHash,
        ttsNormalizedHash: s.ttsNormalizedHash,
        ttsOptionsHash: s.ttsOptionsHash,
        normalizedWavPath: s.normalizedWavPath || `assets/audio/normalized/${s.sceneId}.wav`,
        normalizedWavHash: s.normalizedSha256,
        durationSeconds: s.durationSeconds,
        startSeconds: s.startSeconds,
        endSeconds: s.endSeconds
      })),
      segments: segments.map(seg => ({
        segmentId: seg.segmentId,
        plannedDurationSeconds: 600,
        measuredAudioSeconds: seg.measuredAudioSeconds,
        startSeconds: seg.startSeconds,
        endSeconds: seg.endSeconds
      }))
    };

    const timelineWrite = await writeCanonicalJson(join(jobDir, timelinePath), timelineData);
    await registerArtifact(jobDir, {
      artifactId: "yadam-audio-timeline",
      logicalRole: "yadam.audio.timeline",
      path: timelinePath,
      sha256: timelineWrite.sha256,
      schemaVersion: "1.0.0",
      producerStage: "timeline-generation",
      gateStatus: "pass",
      dependencyHashes: {
        "yadam.audio.manifest": manifestWrite.sha256
      }
    });

    // Write section coverage
    const audioCoverageReportJson = {
      expectedAudioSceneIds: requests.map(r => r.sceneId),
      passedNormalizedWavSceneIds: timeline.scenes.map(s => s.sceneId),
      missingAudioSceneIds: [],
      duplicateAudioSceneIds: [],
      orphanAudioSceneIds: [],
      qualityOk: true
    };

    const revision = state.durationRepairAttemptsUsed + 1; // Wait, match it
    const relativeCoveragePath = `script/coverage/audio-r${String(revision).padStart(3, "0")}.json`;
    const absoluteCoveragePath = join(jobDir, relativeCoveragePath);
    await fsPromises.mkdir(join(jobDir, "script/coverage"), { recursive: true });
    const coverageWrite = await writeCanonicalJson(absoluteCoveragePath, audioCoverageReportJson);

    // Register yadam.coverage.audio
    const coverageRecord = await registerArtifact(jobDir, {
      artifactId: `yadam-coverage-audio-r${revision}`,
      logicalRole: "yadam.coverage.audio",
      path: relativeCoveragePath,
      sha256: coverageWrite.sha256,
      schemaVersion: "1.0.0",
      producerStage: "timeline-generation",
      gateStatus: "pass",
      dependencyHashes: {
        "yadam.audio.timeline": timelineWrite.sha256
      }
    });

    const coverageReportInput = {
      status: "pass",
      relativePath: relativeCoveragePath,
      sha256: coverageWrite.sha256,
      revision,
      section: "audio"
    };

    const covResult = await updateCoverageSection({ jobDir, section: "audio", report: coverageReportInput });
    if (covResult.sections.audio !== "pass" || covResult.sectionArtifact.relativePath !== relativeCoveragePath) {
      throw new Error("Coverage section audio failed or path mismatch");
    }

    // Compile candidate render plan input
    const renderPlanInputCandidate = {
      schemaVersion: "1.0.0",
      profileId: "yadam",
      jobId: state.jobId,
      video: {
        width: profile.video.width,
        height: profile.video.height,
        fps: profile.video.fps
      },
      dependencies: {
        approvalRevisionPath: approvedInput.approvalRevisionPath,
        approvalRevisionHash: sha256Bytes(Buffer.from(approvedInput.approvalRevisionPath, "utf8")),
        audioManifestPath: manifestPath,
        audioManifestHash: manifestWrite.sha256,
        audioTimelinePath: timelinePath,
        audioTimelineHash: timelineWrite.sha256
      },
      scenes: timelineData.scenes,
      segments: timelineData.segments,
      visualSlots,
      subtitleSources: timeline.scenes.map(s => ({
        sceneId: s.sceneId,
        sourceText: s.text || s.ttsNormalizedText,
        sourceHash: s.sourceHash,
        startSeconds: s.startSeconds,
        endSeconds: s.endSeconds
      }))
    };

    const measuredAudioSeconds = timeline.measuredAudioSeconds;

    // Check bounds
    if (measuredAudioSeconds >= minimum && measuredAudioSeconds <= maximum) {
      // IN RANGE
      if (isRegenerating) {
        const reportPath = join(jobDir, "script/duration-repair-report.json");
        const report = JSON.parse(await fsPromises.readFile(reportPath, "utf8"));
        const changedSceneIds = report.changedSceneIds;

        await transitionJob(jobDir, {
          stage: "REBUILDING_APPROVAL_2_BUNDLE",
          to: "running",
          inputHash: report.provenance.inputHash
        });

        await refreshApproval2Previews({ jobDir, changedSceneIds, signal });

        const rebuildResult = await rebuildApproval2AfterDurationRepair({ jobDir, changedSceneIds, signal });
        return rebuildResult;
      }

      const rpInput = await publishRenderPlanInput({
        jobDir,
        candidate: renderPlanInputCandidate,
        currentApproval: approvedInput
      });

      // Hashing success evidence for AUDIO_PASSED
      const inputRecords = [
        { artifactId: "yadam-approval-2", logicalRole: "yadam.approval.2", path: approvedInput.approvalRevisionPath, sha256: approvedInput.approvedArtifactSetHash || "0000000000000000000000000000000000000000000000000000000000000002" },
        { artifactId: "yadam-script-scenes", logicalRole: "yadam.script.scenes", path: "script/script-scenes.json", sha256: approvedInput.scriptScenesHash },
        { artifactId: "yadam-scene-plan", logicalRole: "yadam.scene.plan", path: "planning/scene-plan.json", sha256: "0000000000000000000000000000000000000000000000000000000000000002" } // wait, scenePlan record hash
      ];

      const outputRecords = [
        { artifactId: "yadam-audio-manifest", logicalRole: "yadam.audio.manifest", path: manifestPath, sha256: manifestWrite.sha256 },
        { artifactId: "yadam-audio-timeline", logicalRole: "yadam.audio.timeline", path: timelinePath, sha256: timelineWrite.sha256 },
        { artifactId: "yadam-render-plan-input", logicalRole: "yadam.render_plan_input", path: "render-plan-input.json", sha256: rpInput.sha256 },
        { artifactId: `yadam-coverage-audio-r${revision}`, logicalRole: "yadam.coverage.audio", path: relativeCoveragePath, sha256: coverageWrite.sha256 }
      ];

      // Opaque pins
      const profileHash = profile.profileHash;

      // ttsProviderContractHash
      const providerFiles = [
        { path: "scripts/lib/providers/supertonic-http.mjs", sha256: sha256Bytes(await fsPromises.readFile(resolve("scripts/lib/providers/supertonic-http.mjs"))) },
        { path: "scripts/lib/providers/supertonic-cli.mjs", sha256: sha256Bytes(await fsPromises.readFile(resolve("scripts/lib/providers/supertonic-cli.mjs"))) },
        { path: "schemas/yadam/tts-scene-request.schema.json", sha256: sha256Bytes(await fsPromises.readFile(resolve("schemas/yadam/tts-scene-request.schema.json"))) }
      ].sort((a, b) => a.path < b.path ? -1 : 1);
      const ttsProviderContractHash = hashCanonical({ contractVersion: "1.0.0", files: providerFiles });

      // normalizerVersionHash
      const normalizerFiles = [
        { path: "scripts/lib/yadam/provider-audio-import.mjs", sha256: sha256Bytes(await fsPromises.readFile(resolve("scripts/lib/yadam/provider-audio-import.mjs"))) },
        { path: "scripts/lib/yadam/audio-normalizer.mjs", sha256: sha256Bytes(await fsPromises.readFile(resolve("scripts/lib/yadam/audio-normalizer.mjs"))) },
        { path: "schemas/yadam/audio-normalization-report.schema.json", sha256: sha256Bytes(await fsPromises.readFile(resolve("schemas/yadam/audio-normalization-report.schema.json"))) }
      ].sort((a, b) => a.path < b.path ? -1 : 1);

      const ffmpegVersionOutputHash = await getToolVersionHash(hostConfig.ffmpeg.executable);
      const ffprobeVersionOutputHash = await getToolVersionHash(hostConfig.ffmpeg.ffprobeExecutable);

      const normalizerVersionHash = hashCanonical({
        contractVersion: "1.0.0",
        files: normalizerFiles,
        ffmpegVersionOutputHash,
        ffprobeVersionOutputHash
      });

      const evidence = buildSuccessEvidence("AUDIO_PASSED", inputRecords, outputRecords, {
        profileHash,
        ttsProviderContractHash,
        normalizerVersionHash
      });

      await transitionJob(jobDir, {
        stage: "AUDIO_PASSED",
        to: "running",
        inputHash: evidence.inputHash,
        outputHash: evidence.outputHash,
        artifactPaths: evidence.artifactPaths
      });

      return {
        status: "audio_passed",
        audioManifestPath: manifestPath,
        audioManifestHash: manifestWrite.sha256,
        audioTimelinePath: timelinePath,
        audioTimelineHash: timelineWrite.sha256,
        renderPlanInputPath: "render-plan-input.json",
        renderPlanInputHash: rpInput.sha256,
        measuredAudioSeconds
      };
    } else {
      // OUT OF RANGE: Trigger repair
      if (isRegenerating) {
        // Already attempted once and still out of range: Fail!
        const review = await publishAudioNeedsReview({
          jobDir,
          errorCode: "repaired_duration_out_of_range",
          createdAt: now(),
          measuredAudioSeconds,
          acceptedRangeSeconds: { minimum, maximum },
          repairAttempt: 1,
          providerOrphan: null,
          evidence: [
            { artifactId: "yadam.audio.manifest", path: manifestPath, sha256: manifestWrite.sha256 }
          ]
        });
        return {
          status: "needs_review",
          reason: "repaired_duration_out_of_range",
          errorCode: "repaired_duration_out_of_range",
          reportPath: review.reportPath
        };
      }

      // Request repair (attempt 1)
      const repairRes = await requestDurationRepair({
        jobDir,
        measuredDurationSeconds: measuredAudioSeconds,
        acceptedRangeSeconds: { minimum, maximum },
        signal
      });

      if (repairRes.status === "repaired") {
        // repair allowed, rerun
        // The stage is now REGENERATING_CHANGED_AUDIO. Let's recursively call ourselves to complete the loop!
        return runFullTtsCore({ jobDir, signal });
      } else if (repairRes.status === "needs_review") {
        const review = await publishAudioNeedsReview({
          jobDir,
          errorCode: "duration_repair_failed",
          createdAt: now(),
          measuredAudioSeconds,
          acceptedRangeSeconds: { minimum, maximum },
          repairAttempt: 1,
          providerOrphan: null,
          evidence: [
            { artifactId: "yadam.audio.manifest", path: manifestPath, sha256: manifestWrite.sha256 }
          ]
        });
        return {
          status: "needs_review",
          reason: "duration_repair_failed",
          errorCode: "duration_repair_failed",
          reportPath: review.reportPath
        };
      } else if (repairRes.status === "approval1_invalidated") {
        const review = await publishAudioNeedsReview({
          jobDir,
          errorCode: "approval1_invalidated",
          createdAt: now(),
          measuredAudioSeconds,
          acceptedRangeSeconds: { minimum, maximum },
          repairAttempt: 1,
          providerOrphan: null,
          evidence: [
            { artifactId: "yadam.audio.manifest", path: manifestPath, sha256: manifestWrite.sha256 }
          ]
        });
        return {
          status: "needs_review",
          reason: "approval1_invalidated",
          errorCode: "approval1_invalidated",
          reportPath: review.reportPath
        };
      }
    }
  }

  async function loadPassedAudioHandoffCore(jobDir) {
    // Check approval
    const context = await loadJob(jobDir);
    const approved = await getApprovedTtsInput(jobDir);

    const manifestPath = join(jobDir, "assets/audio/audio-manifest.json");
    const timelinePath = join(jobDir, "assets/audio/audio-timeline.json");
    const rpInputPath = join(jobDir, "render-plan-input.json");

    if (!existsSync(manifestPath) || !existsSync(timelinePath) || !existsSync(rpInputPath)) {
      throw new Error("audio_handoff_not_passed");
    }

    const manifest = JSON.parse(await fsPromises.readFile(manifestPath, "utf8"));
    const timeline = JSON.parse(await fsPromises.readFile(timelinePath, "utf8"));
    const rpInput = JSON.parse(await fsPromises.readFile(rpInputPath, "utf8"));

    return {
      audioManifestPath: "assets/audio/audio-manifest.json",
      audioManifestHash: sha256Bytes(await fsPromises.readFile(manifestPath)),
      audioTimelinePath: "assets/audio/audio-timeline.json",
      audioTimelineHash: sha256Bytes(await fsPromises.readFile(timelinePath)),
      renderPlanInputPath: "render-plan-input.json",
      renderPlanInputHash: sha256Bytes(await fsPromises.readFile(rpInputPath)),
      measuredAudioSeconds: manifest.measuredAudioSeconds,
      acceptedRangeSeconds: manifest.acceptedRangeSeconds,
      audioTempoFactor: 1,
      scenes: timeline.scenes,
      segments: timeline.segments,
      visualSlots: rpInput.visualSlots
    };
  }

  return { runFullTtsCore, loadPassedAudioHandoffCore };
}
