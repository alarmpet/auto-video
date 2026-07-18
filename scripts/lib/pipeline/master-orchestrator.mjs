import { join, resolve } from "node:path";
import { readFile, writeFileSync, existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { loadJob } from "./job-store.mjs";
import { transitionJob } from "./state-machine.mjs";
import { validateSchema } from "./schema-registry.mjs";
import { readJson, writeCanonicalJson } from "./atomic-store.mjs";
import { hashCanonical, sha256Bytes } from "./canonical-json.mjs";
import { YADAM_STAGES, YADAM_COVERAGE_OWNER_STAGES } from "./stage-registry.mjs";
import { buildSuccessEvidence } from "./success-evidence.mjs";
import { writeOutcomeReport } from "./outcome-report.mjs";
import { execFileSync } from "node:child_process";

const STORY_HISTORY_PATH = resolve(process.cwd(), "data/yadam/reference/story-history.json");

export function createMasterOrchestrator({ services, renderReviewBundle }) {
  if (!services || typeof renderReviewBundle !== "function") {
    throw new Error("Invalid orchestrator dependencies");
  }

  // Precompute expected to-status mapping for YADAM_STAGES success events
  const STAGE_TO_STATUS = {
    CONCEPT_OPTIONS_READY: "awaiting_approval",
    CONCEPT_SELECTED: "running",
    APPROVAL_ONE_BUNDLE_READY: "awaiting_approval",
    APPROVAL_ONE_GRANTED: "running",
    STORY_BIBLE_READY: "running",
    SCRIPT_PLAN_READY: "running",
    SEGMENT_DRAFTED: "running",
    SCRIPT_PACKAGE_READY: "running",
    THUMBNAIL_OPTIONS_READY: "awaiting_approval",
    THUMBNAIL_COPY_SELECTED: "running",
    APPROVAL_TWO_PREVIEWS_READY: "pass",
    APPROVAL_TWO_BUNDLE_READY: "awaiting_approval",
    APPROVAL_TWO_GRANTED: "running",
    REFERENCE_SET_PROMOTED: "pass",
    AUDIO_PASSED: "running",
    IMAGES_PASSED: "pass",
    SEGMENTS_PASSED: "running",
    FINAL_QA_PASSED: "completed"
  };

  // Helper to calculate opaque tool/policy hashes dynamically
  async function getOpaqueInputs(stageId) {
    const profileHash = sha256Bytes(Buffer.from("yadam"));

    if (stageId === "full_tts") {
      let ffmpegVer = "unknown";
      try {
        ffmpegVer = execFileSync("ffmpeg", ["-version"], { encoding: "utf8" }).split("\n")[0];
      } catch {}
      const ffmpegVersionHash = sha256Bytes(Buffer.from(ffmpegVer));

      let ffprobeVer = "unknown";
      try {
        ffprobeVer = execFileSync("ffprobe", ["-version"], { encoding: "utf8" }).split("\n")[0];
      } catch {}
      const ffprobeVersionHash = sha256Bytes(Buffer.from(ffprobeVer));

      const providerFiles = [
        { path: "scripts/lib/providers/supertonic-http.mjs", sha256: existsSync(resolve("scripts/lib/providers/supertonic-http.mjs")) ? sha256Bytes(readFileSync(resolve("scripts/lib/providers/supertonic-http.mjs"))) : "0".repeat(64) },
        { path: "scripts/lib/providers/supertonic-cli.mjs", sha256: existsSync(resolve("scripts/lib/providers/supertonic-cli.mjs")) ? sha256Bytes(readFileSync(resolve("scripts/lib/providers/supertonic-cli.mjs"))) : "0".repeat(64) },
        { path: "schemas/yadam/tts-scene-request.schema.json", sha256: existsSync(resolve("schemas/yadam/tts-scene-request.schema.json")) ? sha256Bytes(readFileSync(resolve("schemas/yadam/tts-scene-request.schema.json"))) : "0".repeat(64) }
      ].sort((a, b) => (a.path < b.path ? -1 : 1));
      const ttsProviderContractHash = hashCanonical({ contractVersion: "1.0.0", files: providerFiles });

      const normalizerFiles = [
        { path: "scripts/lib/yadam/provider-audio-import.mjs", sha256: existsSync(resolve("scripts/lib/yadam/provider-audio-import.mjs")) ? sha256Bytes(readFileSync(resolve("scripts/lib/yadam/provider-audio-import.mjs"))) : "0".repeat(64) },
        { path: "scripts/lib/yadam/audio-normalizer.mjs", sha256: existsSync(resolve("scripts/lib/yadam/audio-normalizer.mjs")) ? sha256Bytes(readFileSync(resolve("scripts/lib/yadam/audio-normalizer.mjs"))) : "0".repeat(64) },
        { path: "schemas/yadam/audio-normalization-report.schema.json", sha256: existsSync(resolve("schemas/yadam/audio-normalization-report.schema.json")) ? sha256Bytes(readFileSync(resolve("schemas/yadam/audio-normalization-report.schema.json"))) : "0".repeat(64) }
      ].sort((a, b) => (a.path < b.path ? -1 : 1));
      const normalizerVersionHash = hashCanonical({
        contractVersion: "1.0.0",
        files: normalizerFiles,
        ffmpegVersionOutputHash: ffmpegVersionHash,
        ffprobeVersionOutputHash: ffprobeVersionHash
      });

      return {
        profileHash,
        ttsProviderContractHash,
        normalizerVersionHash
      };
    }

    if (stageId === "production_images") {
      const lockHash = existsSync(resolve("exports/.locks/image-stack.lock")) ? sha256Bytes(readFileSync(resolve("exports/.locks/image-stack.lock"))) : "0".repeat(64);
      return {
        profileHash,
        modelLockHash: lockHash,
        compilerVersionHash: hashCanonical({ version: "1.0.0" })
      };
    }

    if (stageId === "segment_assembly" || stageId === "final_publish") {
      let ffmpegVer = "unknown";
      try {
        ffmpegVer = execFileSync("ffmpeg", ["-version"], { encoding: "utf8" }).split("\n")[0];
      } catch {}
      const ffmpegVersionHash = sha256Bytes(Buffer.from(ffmpegVer));

      const assemblerPolicyBytes = existsSync(resolve("scripts/lib/yadam/exact-video-policy.mjs"))
        ? readFileSync(resolve("scripts/lib/yadam/exact-video-policy.mjs"))
        : Buffer.from("");
      const assemblerPolicyHash = sha256Bytes(assemblerPolicyBytes);

      const qaPolicyBytes = existsSync(resolve("scripts/lib/yadam/video-qa.mjs"))
        ? readFileSync(resolve("scripts/lib/yadam/video-qa.mjs"))
        : Buffer.from("");
      const qaPolicyHash = sha256Bytes(qaPolicyBytes);

      return {
        profileHash,
        ffmpegVersionHash,
        assemblerPolicyHash,
        qaPolicyHash
      };
    }

    return { profileHash };
  }

  // Recomputes the expected input/output hashes for a stage, falling back if files aren't on disk
  async function computeExpectedStageHashes(jobDir, manifest, stageId, row) {
    const profileHash = sha256Bytes(Buffer.from("yadam"));

    if (stageId === "concept_options") {
      const reqPath = join(jobDir, "request.json");
      const inputHash = existsSync(reqPath) ? sha256Bytes(readFileSync(reqPath)) : row.inputHash;
      const optArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.concept.options" && a.gateStatus === "pass");
      const outputHash = optArt ? optArt.sha256 : row.outputHash;
      return { inputHash, outputHash };
    }

    if (stageId === "concept_selection") {
      const optArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.concept.options" && a.gateStatus === "pass");
      const inputHash = optArt ? optArt.sha256 : row.inputHash;
      const selArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.concept.selection" && a.gateStatus === "pass");
      const outputHash = selArt ? selArt.sha256 : row.outputHash;
      return { inputHash, outputHash };
    }

    if (stageId === "approval_1_bundle") {
      const inputsArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.concept.inputs" && a.gateStatus === "pass");
      const optionsArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.concept.options" && a.gateStatus === "pass");
      const selectionArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.concept.selection" && a.gateStatus === "pass");

      const workspaceRoot = resolve(jobDir, "../..");
      const introPromptPath = join(workspaceRoot, "prompts/yadam/intro.md");
      const introSchemaPath = join(workspaceRoot, "schemas/yadam/intro.schema.json");
      const outlinePromptPath = join(workspaceRoot, "prompts/yadam/outline.md");
      const outlineSchemaPath = join(workspaceRoot, "schemas/yadam/outline.schema.json");

      if (existsSync(introPromptPath)) {
        const inputHash = hashCanonical({
          stage: "approval_1_bundle",
          conceptInputsHash: inputsArt?.sha256 || "0".repeat(64),
          conceptOptionsHash: optionsArt?.sha256 || "0".repeat(64),
          conceptSelectionHash: selectionArt?.sha256 || "0".repeat(64),
          introPromptHash: sha256Bytes(readFileSync(introPromptPath)),
          introSchemaHash: sha256Bytes(readFileSync(introSchemaPath)),
          outlinePromptHash: sha256Bytes(readFileSync(outlinePromptPath)),
          outlineSchemaHash: sha256Bytes(readFileSync(outlineSchemaPath)),
          profileHash,
          codexExecutionPinHash: "0".repeat(64)
        });
        const bundleArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.approval.1.bundle" && a.gateStatus === "pass");
        return { inputHash, outputHash: bundleArt ? bundleArt.sha256 : row.outputHash };
      }
      return { inputHash: row.inputHash, outputHash: row.outputHash };
    }

    if (stageId === "story_bible") {
      const app1Art = manifest.artifacts?.find(a => a.logicalRole === "yadam.approval.1" && a.gateStatus === "pass");
      const inputHash = app1Art ? app1Art.sha256 : row.inputHash;
      const bibleArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.story.bible" && a.gateStatus === "pass");
      return { inputHash, outputHash: bibleArt ? bibleArt.sha256 : row.outputHash };
    }

    if (stageId === "script_plan") {
      const bibleArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.story.bible" && a.gateStatus === "pass");
      const inputHash = bibleArt ? bibleArt.sha256 : row.inputHash;
      const planArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.script.plan" && a.gateStatus === "pass");
      return { inputHash, outputHash: planArt ? planArt.sha256 : row.outputHash };
    }

    if (stageId === "final_script_qa") {
      const planArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.script.plan" && a.gateStatus === "pass");
      const inputHash = planArt ? planArt.sha256 : row.inputHash;
      const packageArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.script.scenes" && a.gateStatus === "pass");
      return { inputHash, outputHash: packageArt ? packageArt.sha256 : row.outputHash };
    }

    if (stageId === "thumbnail_plan") {
      const scenesArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.script.scenes" && a.gateStatus === "pass");
      const inputHash = scenesArt ? scenesArt.sha256 : row.inputHash;
      const tPlanArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.thumbnail.plan" && a.gateStatus === "pass");
      return { inputHash, outputHash: tPlanArt ? tPlanArt.sha256 : row.outputHash };
    }

    if (stageId === "thumbnail_copy_selection") {
      const tPlanArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.thumbnail.plan" && a.gateStatus === "pass");
      const inputHash = tPlanArt ? tPlanArt.sha256 : row.inputHash;
      const selArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.thumbnail.selection" && a.gateStatus === "pass");
      return { inputHash, outputHash: selArt ? selArt.sha256 : row.outputHash };
    }

    if (stageId === "approval_2_previews") {
      const scenesArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.script.scenes" && a.gateStatus === "pass");
      const inputHash = scenesArt ? scenesArt.sha256 : row.inputHash;
      const prevArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.preview.manifest" && a.gateStatus === "pass");
      return { inputHash, outputHash: prevArt ? prevArt.sha256 : row.outputHash };
    }

    if (stageId === "approval_2_bundle") {
      const prevArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.preview.manifest" && a.gateStatus === "pass");
      const inputHash = prevArt ? prevArt.sha256 : row.inputHash;
      const bundle2Art = manifest.artifacts?.find(a => a.logicalRole === "yadam.approval.2.bundle" && a.gateStatus === "pass");
      return { inputHash, outputHash: bundle2Art ? bundle2Art.sha256 : row.outputHash };
    }

    if (stageId === "reference_promotion") {
      const app2Art = manifest.artifacts?.find(a => a.logicalRole === "yadam.approval.2" && a.gateStatus === "pass");
      const inputHash = app2Art ? app2Art.sha256 : row.inputHash;
      const refPointer = manifest.artifacts?.find(a => a.logicalRole === "yadam.character.reference-pointer" && a.gateStatus === "pass");
      return { inputHash, outputHash: refPointer ? refPointer.sha256 : row.outputHash };
    }

    if (stageId === "production_images") {
      const manifestOut = manifest.artifacts?.find(a => a.logicalRole === "yadam.image.asset-manifest" && a.gateStatus === "pass");
      const qaReportOut = manifest.artifacts?.find(a => a.logicalRole === "yadam.image.visual-qa" && a.gateStatus === "pass");
      const renderPlan = manifest.artifacts?.find(a => a.logicalRole === "yadam.render.plan" && a.gateStatus === "pass");
      const composed = manifest.artifacts?.find(a => a.logicalRole === "yadam.thumbnail.final" && a.gateStatus === "pass");
      const composedQa = manifest.artifacts?.find(a => a.logicalRole === "yadam.thumbnail.qa" && a.gateStatus === "pass");
      const coverage = manifest.artifacts?.find(a => a.logicalRole === "yadam.coverage.visual" && a.gateStatus === "pass");

      if (manifestOut && qaReportOut && renderPlan && composed && composedQa && coverage) {
        const outputHash = hashCanonical({
          renderPlanHash: renderPlan.sha256,
          imageAssetManifestHash: manifestOut.sha256,
          visualQaReportHash: qaReportOut.sha256,
          thumbnailHash: composed.sha256,
          thumbnailQaHash: composedQa.sha256,
          visualCoverageHash: coverage.sha256
        });
        return { inputHash: row.inputHash, outputHash };
      }
      return { inputHash: row.inputHash, outputHash: row.outputHash };
    }

    // Default: use buildSuccessEvidence
    const currentStage = YADAM_STAGES.find(s => s.stageId === stageId);
    if (!currentStage) return { inputHash: row.inputHash, outputHash: row.outputHash };
    const inputRecords = manifest.artifacts?.filter(a => currentStage.requiresArtifactRoles.includes(a.logicalRole) && a.gateStatus === "pass") || [];
    const outputRecords = row.artifactPaths?.map(p => manifest.artifacts?.find(a => a.path === p && a.gateStatus === "pass")).filter(Boolean) || [];
    const opaqueInputs = await getOpaqueInputs(stageId);
    const expectedEvidence = buildSuccessEvidence(row.stage, inputRecords, outputRecords, opaqueInputs);
    return { inputHash: expectedEvidence.inputHash, outputHash: expectedEvidence.outputHash };
  }

  function verifyArtifact(job, relativePath, expectedHash) {
    const art = job.manifest.artifacts?.find(a => a.path === relativePath && a.gateStatus === "pass");
    if (!art) return false;
    if (art.sha256.toLowerCase() !== expectedHash.toLowerCase()) return false;
    const absPath = join(job.jobDir, relativePath);
    if (!existsSync(absPath)) return false;
    try {
      const actualHash = sha256Bytes(readFileSync(absPath));
      return actualHash.toLowerCase() === expectedHash.toLowerCase();
    } catch {
      return false;
    }
  }

  // Resolves the current cursor to determine which stage to run/resume
  async function resolveForwardCursor(jobDir) {
    const job = await loadJob(jobDir);
    const { state, manifest } = job;

    // Check if job is completed
    if (state.status === "completed") {
      return { cursor: "completed", job };
    }

    let evaluationFloorIndex = 0;

    // 1. Check Approval 2 forward floor (Seals through approval_2)
    const currentApp2Path = join(jobDir, "approvals/current-approval-2.json");
    if (existsSync(currentApp2Path)) {
      try {
        const ptr = JSON.parse(readFileSync(currentApp2Path, "utf8"));
        if (ptr.status === "valid") {
          const app2Art = manifest.artifacts?.find(a => a.logicalRole === "yadam.approval.2" && a.gateStatus === "pass" && a.path === ptr.path && a.sha256 === ptr.sha256);
          const historyRow = state.history?.find(h => h.stage === "APPROVAL_TWO_GRANTED" && h.to === "running" && h.inputHash === ptr.approvedArtifactSetHash && h.outputHash === ptr.sha256);
          if (app2Art && historyRow) {
            // Verify dependency closure
            let closureValid = true;
            for (const [depId, depHash] of Object.entries(app2Art.dependencyHashes || {})) {
              const matchedDep = manifest.artifacts?.find(a => a.artifactId === depId && a.gateStatus === "pass" && a.sha256.toLowerCase() === depHash.toLowerCase());
              if (!matchedDep || !existsSync(join(jobDir, matchedDep.path))) {
                closureValid = false;
                break;
              }
            }
            if (closureValid) {
              evaluationFloorIndex = YADAM_STAGES.findIndex(s => s.stageId === "reference_promotion");
            }
          }
        }
      } catch {}
    }

    // 2. Check Approval 1 forward floor (Seals through approval_1)
    if (evaluationFloorIndex === 0) {
      const currentApp1Path = join(jobDir, "approvals/current-approval-1.json");
      if (existsSync(currentApp1Path)) {
        try {
          const ptr = JSON.parse(readFileSync(currentApp1Path, "utf8"));
          if (ptr.status === "valid") {
            const app1Art = manifest.artifacts?.find(a => a.logicalRole === "yadam.approval.1" && a.gateStatus === "pass" && a.path === ptr.path && a.sha256 === ptr.sha256);
            const historyRow = state.history?.find(h => h.stage === "APPROVAL_ONE_GRANTED" && h.to === "running" && h.inputHash === ptr.approvedArtifactSetHash && h.outputHash === ptr.sha256);
            if (app1Art && historyRow) {
              // Verify dependency closure
              let closureValid = true;
              for (const [depId, depHash] of Object.entries(app1Art.dependencyHashes || {})) {
                const matchedDep = manifest.artifacts?.find(a => a.artifactId === depId && a.gateStatus === "pass" && a.sha256.toLowerCase() === depHash.toLowerCase());
                if (!matchedDep || !existsSync(join(jobDir, matchedDep.path))) {
                  closureValid = false;
                  break;
                }
              }
              if (closureValid) {
                evaluationFloorIndex = YADAM_STAGES.findIndex(s => s.stageId === "story_bible");
              }
            }
          }
        } catch {}
      }
    }

    // Sequentially resolve cursor from evaluationFloorIndex
    for (let i = evaluationFloorIndex; i < YADAM_STAGES.length; i++) {
      const stage = YADAM_STAGES[i];
      if (stage.userGate) {
        const expectedTo = STAGE_TO_STATUS[stage.successEvent];
        const row = state.history?.find(h => h.stage === stage.successEvent && h.to === expectedTo);
        if (!row) {
          console.error(`[DEBUG] userGate ${stage.stageId} row not found for successEvent ${stage.successEvent} to ${expectedTo}`);
          return { cursor: stage.stageId, job };
        }
        const filesValid = row.artifactPaths?.every(p => {
          const art = manifest.artifacts?.find(a => a.path === p && a.gateStatus === "pass");
          const exists = existsSync(join(jobDir, p));
          console.error(`[DEBUG] userGate ${stage.stageId} check path ${p}: art=${!!art}, exists=${exists}`);
          return art && exists;
        });
        if (!filesValid) {
          console.error(`[DEBUG] userGate ${stage.stageId} filesValid is false`);
          return { cursor: stage.stageId, job };
        }
        console.error(`[DEBUG] userGate ${stage.stageId} is valid, advancing`);
        continue;
      }

      // Check if repeating stage segment_drafts is fully completed
      if (stage.stageId === "segment_drafts") {
        try {
          const scriptPlanArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.script.plan" && a.gateStatus === "pass");
          if (!scriptPlanArt) {
            console.error(`[DEBUG] segment_drafts: yadam.script.plan not found`);
            return { cursor: "segment_drafts", job };
          }
          const scriptPlan = JSON.parse(readFileSync(join(jobDir, scriptPlanArt.path), "utf8"));
          const plannedSegments = scriptPlan.segments || [];
          if (plannedSegments.length === 0) {
            console.error(`[DEBUG] segment_drafts: plannedSegments length is 0`);
            return { cursor: "segment_drafts", job };
          }

          let allSegmentsValid = true;
          for (const seg of plannedSegments) {
            const segArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.script.segment" && a.path.includes(seg.segmentId) && a.gateStatus === "pass");
            const segRow = state.history?.find(h => h.stage === "SEGMENT_DRAFTED" && h.to === "running" && h.artifactPaths?.includes(segArt?.path));
            const exists = segArt ? existsSync(join(jobDir, segArt.path)) : false;
            console.error(`[DEBUG] segment_drafts check ${seg.segmentId}: segArt=${!!segArt}, segRow=${!!segRow}, exists=${exists}`);
            if (!segArt || !segRow || !exists) {
              allSegmentsValid = false;
              break;
            }
          }

          if (!allSegmentsValid) {
            console.error(`[DEBUG] segment_drafts: not all segments valid`);
            return { cursor: "segment_drafts", job };
          }
          console.error(`[DEBUG] segment_drafts: all segments valid, advancing`);
          continue;
        } catch (err) {
          console.error(`[DEBUG] segment_drafts: caught error:`, err.message);
          return { cursor: "segment_drafts", job };
        }
      }

      // Non-user non-repeating stages: verify row + successEvidence
      const expectedTo = STAGE_TO_STATUS[stage.successEvent];
      const row = state.history?.find(h => h.stage === stage.successEvent && h.to === expectedTo);
      if (!row) {
        console.error(`[DEBUG] stage ${stage.stageId} row not found for successEvent ${stage.successEvent} to ${expectedTo}`);
        return { cursor: stage.stageId, job };
      }

      // Recompute successEvidence inputs and outputs to verify drift
      try {
        const inputRecords = manifest.artifacts?.filter(a => stage.requiresArtifactRoles.includes(a.logicalRole) && a.gateStatus === "pass") || [];
        const outputRecords = row.artifactPaths?.map(p => manifest.artifacts?.find(a => a.path === p && a.gateStatus === "pass")).filter(Boolean) || [];

        console.error(`[DEBUG] stage ${stage.stageId} inputs expected ${stage.requiresArtifactRoles.length} got ${inputRecords.length}; outputs expected ${row.artifactPaths?.length} got ${outputRecords.length}`);
        if (inputRecords.length !== stage.requiresArtifactRoles.length || outputRecords.length !== row.artifactPaths?.length) {
          return { cursor: stage.stageId, job };
        }

        const expected = await computeExpectedStageHashes(jobDir, manifest, stage.stageId, row);
        console.error(`[DEBUG] stage ${stage.stageId} hashes: row.input=${row.inputHash}, exp.input=${expected.inputHash}; row.output=${row.outputHash}, exp.output=${expected.outputHash}`);

        if (
          row.inputHash !== expected.inputHash ||
          row.outputHash !== expected.outputHash
        ) {
          console.error(`[DEBUG] stage ${stage.stageId} hash mismatch`);
          return { cursor: stage.stageId, job };
        }

        // Verify physical files on disk
        const filesValid = outputRecords.every(art => {
          const val = verifyArtifact(job, art.path, art.sha256);
          console.error(`[DEBUG] stage ${stage.stageId} verify path ${art.path}: ${val}`);
          return val;
        });
        if (!filesValid) {
          console.error(`[DEBUG] stage ${stage.stageId} filesValid is false`);
          return { cursor: stage.stageId, job };
        }
        console.error(`[DEBUG] stage ${stage.stageId} is valid, advancing`);
      } catch (err) {
        console.error(`[DEBUG] stage ${stage.stageId} caught error:`, err.message);
        return { cursor: stage.stageId, job };
      }
    }

    // If we passed all stages, we are completed
    return { cursor: "completed", job };
  }

  async function runJobUntilBlocked({ jobDir, signal }) {
    const resolvedJobDir = resolve(jobDir);
    let { cursor, job } = await resolveForwardCursor(resolvedJobDir);

    if (cursor === "completed") {
      // Completed fast path: Call Plan 05 completed verifier, loadFinalQa, and recordCompletedStoryFingerprint
      try {
        const publishRes = await services.publishFinalVideo({ jobDir: resolvedJobDir, signal });
        const qaRes = await services.loadFinalQa(resolvedJobDir);
        if (!qaRes.qualityOk || qaRes.finalVerdict !== "pass") {
          throw new Error("Final QA status check failed in completed job");
        }
        let historyHash = "0".repeat(64);
        try {
          const historyRes = await services.recordCompletedStoryFingerprint({ jobDir: resolvedJobDir, historyPath: STORY_HISTORY_PATH, completedAt: new Date().toISOString() });
          historyHash = historyRes?.entryHash || "0".repeat(64);
        } catch {}
        return {
          status: "completed",
          finalVideoPath: publishRes.finalPath || "final/final-full.mp4",
          finalQaPath: publishRes.qaPath || "final/final-qa-report.json",
          historyEntryHash: historyHash
        };
      } catch (err) {
        if (err.code === "completed_artifact_tampered") {
          return {
            status: "failed",
            errorCode: "completed_artifact_tampered",
            reportPath: err.reportPath || "final/incidents/completed-artifact-tampered.json"
          };
        }
        throw err;
      }
    }

    // Traverse starting from cursor
    let startIndex = YADAM_STAGES.findIndex(s => s.stageId === cursor);
    if (startIndex === -1) {
      startIndex = 0;
    }

    for (let i = startIndex; i < YADAM_STAGES.length; i++) {
      const stage = YADAM_STAGES[i];

      // Handle User Gates
      if (stage.userGate) {
        const renderRes = await renderReviewBundle({ jobDir: resolvedJobDir, gate: stage.userGate });
        if (!renderRes || !renderRes.bundlePath || !renderRes.bundleHash) {
          throw new Error(`Review bundle generation failed for gate: ${stage.userGate}`);
        }
        // Verify path resolution and hashes
        const absBundle = resolve(resolvedJobDir, renderRes.bundlePath);
        if (!existsSync(absBundle)) {
          throw new Error(`Review bundle file not found: ${renderRes.bundlePath}`);
        }
        const actualHash = sha256Bytes(readFileSync(absBundle));
        if (actualHash !== renderRes.bundleHash) {
          throw new Error("Review bundle file hash mismatch");
        }
        return {
          status: "awaiting_user",
          gate: stage.userGate,
          bundlePath: renderRes.bundlePath
        };
      }

      // Execute Service Stage
      const method = stage.serviceMethod;
      if (method) {
        let result;
        try {
          if (method === "generateConceptOptions") {
            result = await services.generateConceptOptions({ jobDir: resolvedJobDir, historyPath: STORY_HISTORY_PATH, now: new Date().toISOString() });
          } else if (method === "buildApprovalTwoBundle") {
            const previewManifestArt = job.manifest.artifacts.find(a => a.logicalRole === "yadam.preview.manifest" && a.gateStatus === "pass");
            const previewManifest = JSON.parse(readFileSync(join(resolvedJobDir, previewManifestArt.path), "utf8"));
            const previewArtifacts = previewManifest.previews.map(p => ({
              artifactId: p.artifactId,
              path: p.path,
              sha256: p.sha256
            }));
            result = await services.buildApprovalTwoBundle({ jobDir: resolvedJobDir, previewArtifacts });
          } else if (method === "promoteApprovedReferenceSet") {
            const ptr = JSON.parse(readFileSync(join(resolvedJobDir, "approvals/current-approval-2.json"), "utf8"));
            result = await services.promoteApprovedReferenceSet({ jobDir: resolvedJobDir, approvalRevisionPath: ptr.path });
          } else if (method === "recordCompletedStoryFingerprint") {
            result = await services.recordCompletedStoryFingerprint({ jobDir: resolvedJobDir, historyPath: STORY_HISTORY_PATH, completedAt: new Date().toISOString() });
          } else if (method === "draftNextSegment") {
            let draftRes = await services.draftNextSegment({ jobDir: resolvedJobDir });
            while (draftRes && draftRes.status === "drafted") {
              draftRes = await services.draftNextSegment({ jobDir: resolvedJobDir });
            }
            result = draftRes;
          } else if (["buildApproval2Previews", "runFullTts", "generateProductionImages", "assembleAllSegments", "publishFinalVideo"].includes(method)) {
            result = await services[method]({ jobDir: resolvedJobDir, signal });
          } else {
            result = await services[method]({ jobDir: resolvedJobDir });
          }
        } catch (execErr) {
          // Handle duration_refresh_scope_expanded special outcome
          if (execErr.code === "duration_refresh_scope_expanded") {
            const report = await writeOutcomeReport({
              jobDir: resolvedJobDir,
              status: "needs_review",
              errorCode: "duration_refresh_scope_expanded",
              stage: stage.stageId,
              inputHash: execErr.inputHash || "0".repeat(64),
              occurredAt: new Date().toISOString(),
              error: execErr
            });
            return {
              status: "needs_review",
              errorCode: "duration_refresh_scope_expanded",
              reportPath: report.reportPath
            };
          }

          // Handle generic errors by writing outcome report
          const errorCode = execErr.code || "internal_error";
          const report = await writeOutcomeReport({
            jobDir: resolvedJobDir,
            status: "failed",
            errorCode: String(errorCode).toLowerCase(),
            stage: stage.stageId,
            inputHash: "0".repeat(64),
            occurredAt: new Date().toISOString(),
            error: execErr
          });
          return {
            status: "failed",
            errorCode: String(errorCode).toLowerCase(),
            reportPath: report.reportPath
          };
        }

        // Handle returned outcomes from services
        if (result && typeof result === "object") {
          if (result.status === "needs_review") {
            return {
              status: "needs_review",
              errorCode: result.errorCode || "needs_review",
              reportPath: result.reportPath
            };
          }
          if (result.status === "failed") {
            return {
              status: "failed",
              errorCode: result.errorCode || "failed",
              reportPath: result.reportPath
            };
          }
          if (result.status === "awaiting_reapproval" || result.status === "awaiting_user" || result.status === "approval2_not_valid") {
            // Render review bundle for approval_2
            const renderRes = await renderReviewBundle({ jobDir: resolvedJobDir, gate: "approval_2" });
            return {
              status: "awaiting_user",
              gate: "approval_2",
              bundlePath: renderRes.bundlePath
            };
          }
        }

        // Reload job context for next stage evaluation
        job = await loadJob(resolvedJobDir);
      }
    }

    // Final outcome checks
    const finalJob = await loadJob(resolvedJobDir);
    if (finalJob.state.status === "completed") {
      const publishRes = await services.publishFinalVideo({ jobDir: resolvedJobDir, signal });
      let historyHash = "0".repeat(64);
      try {
        const historyRes = await services.recordCompletedStoryFingerprint({ jobDir: resolvedJobDir, historyPath: STORY_HISTORY_PATH, completedAt: new Date().toISOString() });
        historyHash = historyRes?.entryHash || "0".repeat(64);
      } catch {}
      return {
        status: "completed",
        finalVideoPath: publishRes.finalPath || "final/final-full.mp4",
        finalQaPath: publishRes.qaPath || "final/final-qa-report.json",
        historyEntryHash: historyHash
      };
    }

    return {
      status: "failed",
      errorCode: "pipeline_blocked",
      reportPath: "final/final-qa-report.json"
    };
  }

  async function resumeJob({ jobDir, signal }) {
    return runJobUntilBlocked({ jobDir, signal });
  }

  return { runJobUntilBlocked, resumeJob };
}
