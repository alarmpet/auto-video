import { parseCli } from "./lib/pipeline/cli-args.mjs";
import { loadProfile, loadHostConfig, validateTargetMinutes } from "./lib/pipeline/profile-registry.mjs";
import { createJob, loadJob } from "./lib/pipeline/job-store.mjs";
import { transitionJob } from "./lib/pipeline/state-machine.mjs";
import { sha256Bytes } from "./lib/pipeline/canonical-json.mjs";
import { discoverCodex, preflightCodex } from "./lib/providers/codex-cli.mjs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Service Imports for Orchestrator
import { generateConceptOptions, selectConcept } from "./lib/yadam/concept-service.mjs";
import { buildApprovalOneBundle, approveConcept, buildApprovalTwoBundle, approveProduction } from "./lib/yadam/approval-service.mjs";
import { buildStoryBible } from "./lib/yadam/story-bible-service.mjs";
import { buildScriptPlan } from "./lib/yadam/script-planner.mjs";
import { draftNextSegment } from "./lib/yadam/segment-drafter.mjs";
import { finalizeScriptPackage, recordCompletedStoryFingerprint } from "./lib/yadam/script-service.mjs";
import { generateThumbnailPlan, selectThumbnailCopy } from "./lib/yadam/thumbnail-service.mjs";
import { buildApproval2Previews, promoteApprovedReferenceSet, generateProductionImages } from "./lib/yadam/image-service.mjs";
import { runFullTts } from "./lib/yadam/tts-service.mjs";
import { assembleAllSegments, publishFinalVideo, loadFinalQa } from "./lib/yadam/video-service.mjs";

import { createMasterOrchestrator } from "./lib/pipeline/master-orchestrator.mjs";
import { renderReviewBundle } from "./lib/pipeline/review-bundle.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workspaceRoot = dirname(__dirname);

const definitions = {
  new: {
    profile: { type: "string", required: true },
    mode: { type: "string", required: true, enum: ["reference", "genre"] },
    source: { type: "string", required: true },
    minutes: { type: "integer", required: true },
    seed: { type: "integer", required: true },
    instructions: { type: "string", required: false }
  },
  status: {
    job: { type: "string", required: true }
  },
  preflight: {
    provider: { type: "string", required: true, enum: ["codex"] },
    "no-generate": { type: "boolean", required: false }
  },
  "select-concept": {
    job: { type: "string", required: true },
    option: { type: "string", required: true },
    note: { type: "string", required: false }
  },
  "approve-concept": {
    job: { type: "string", required: true },
    "artifact-set-hash": { type: "string", required: true },
    note: { type: "string", required: false }
  },
  "select-thumbnail-copy": {
    job: { type: "string", required: true },
    copy: { type: "string", required: true }
  },
  "approve-production": {
    job: { type: "string", required: true },
    "artifact-set-hash": { type: "string", required: true },
    note: { type: "string", required: false }
  },
  run: {
    job: { type: "string", required: true }
  },
  resume: {
    job: { type: "string", required: true }
  },
  cancel: {
    job: { type: "string", required: true }
  }
};

async function main() {
  const argv = process.argv.slice(2);
  let parsed;
  try {
    parsed = parseCli(argv, definitions);
  } catch (err) {
    console.log(JSON.stringify({
      ok: false,
      command: argv[0] || "unknown",
      error: {
        code: err.code || "invalid_cli_argument",
        message: err.message,
        details: err.details || null
      }
    }));
    process.exit(1);
  }

  const { command, args } = parsed;

  const services = {
    generateConceptOptions,
    buildApprovalOneBundle,
    buildStoryBible,
    buildScriptPlan,
    draftNextSegment,
    finalizeScriptPackage,
    generateThumbnailPlan,
    buildApproval2Previews,
    promoteApprovedReferenceSet,
    generateProductionImages,
    runFullTts,
    assembleAllSegments,
    publishFinalVideo,
    loadFinalQa,
    recordCompletedStoryFingerprint
  };

  const orchestrator = createMasterOrchestrator({ services, renderReviewBundle });

  try {
    if (command === "new") {
      const profile = await loadProfile(args.profile, workspaceRoot);
      const hostConfig = await loadHostConfig(workspaceRoot);
      const minutes = validateTargetMinutes(args.minutes);

      const sourceVal = args.source.normalize("NFC").trim();
      if (!sourceVal) {
        throw new Error("source value cannot be empty");
      }

      const request = {
        schemaVersion: "1.0.0",
        profileId: args.profile,
        inputMode: args.mode,
        source: {
          kind: args.mode === "reference" ? "reference_title" : "genre",
          value: sourceVal
        },
        targetMinutes: minutes,
        durationTolerance: profile.targetMinutes.durationTolerance,
        approvalMode: "two-stage",
        seed: args.seed,
        createdAt: new Date().toISOString()
      };

      if (args.instructions !== undefined) {
        const instVal = args.instructions.normalize("NFC").trim();
        if (instVal.length > 1000) {
          throw new Error("optionalInstructions exceeds length limit");
        }
        request.optionalInstructions = instVal;
      }

      const context = await createJob({ workspaceRoot, request, profile, hostConfig });
      console.log(JSON.stringify({
        ok: true,
        command: "new",
        result: {
          jobId: context.request.jobId,
          jobDir: context.jobDir,
          status: context.state.status
        }
      }));
    } else if (command === "status") {
      const context = await loadJob(args.job);
      console.log(JSON.stringify({
        ok: true,
        command: "status",
        result: {
          jobId: context.state.jobId,
          status: context.state.status,
          state: context.state
        }
      }));
    } else if (command === "preflight") {
      if (args.provider === "codex") {
        const hostConfig = await loadHostConfig(workspaceRoot);
        const discoverResult = await discoverCodex(hostConfig);
        
        let preflightResult;
        if (args["no-generate"]) {
          const profile = await loadProfile("yadam", workspaceRoot);
          preflightResult = await preflightCodex(discoverResult.executable, {
            profile,
            workspaceRoot
          });
        }

        console.log(JSON.stringify({
          ok: true,
          command: "preflight",
          result: {
            version: discoverResult.version,
            loggedIn: preflightResult ? preflightResult.loggedIn : true,
            generationInvoked: false
          }
        }));
      }
    } else if (command === "select-concept") {
      const result = await selectConcept({
        jobDir: args.job,
        candidateId: args.option,
        userInstructions: args.note || "",
        selectedAt: new Date().toISOString()
      });
      console.log(JSON.stringify({
        ok: true,
        command: "select-concept",
        result
      }));
    } else if (command === "approve-concept") {
      const result = await approveConcept({
        jobDir: args.job,
        expectedArtifactSetHash: args["artifact-set-hash"],
        approvedAt: new Date().toISOString(),
        userInstructions: args.note || ""
      });
      console.log(JSON.stringify({
        ok: true,
        command: "approve-concept",
        result
      }));
    } else if (command === "select-thumbnail-copy") {
      const result = await selectThumbnailCopy({
        jobDir: args.job,
        copyId: args.copy,
        selectedAt: new Date().toISOString()
      });
      console.log(JSON.stringify({
        ok: true,
        command: "select-thumbnail-copy",
        result
      }));
    } else if (command === "approve-production") {
      const result = await approveProduction({
        jobDir: args.job,
        expectedArtifactSetHash: args["artifact-set-hash"],
        approvedAt: new Date().toISOString(),
        userInstructions: args.note || ""
      });
      console.log(JSON.stringify({
        ok: true,
        command: "approve-production",
        result
      }));
    } else if (command === "run") {
      const job = await loadJob(args.job);
      if (job.state.status === "pending") {
        const reqArt = job.manifest.artifacts.find(a => a.artifactId === "pipeline-request");
        const inputHash = reqArt ? reqArt.sha256 : "0000000000000000000000000000000000000000000000000000000000000000";
        await transitionJob(args.job, {
          stage: "pipeline-start",
          to: "running",
          inputHash
        });
      } else if (job.state.status === "needs_review") {
        await transitionJob(args.job, {
          stage: "resume-run",
          to: "running",
          inputHash: sha256Bytes(Buffer.from(new Date().toISOString(), "utf8"))
        });
      }
      const result = await orchestrator.runJobUntilBlocked({ jobDir: args.job });
      console.log(JSON.stringify({
        ok: true,
        command: "run",
        result
      }));
    } else if (command === "resume") {
      const result = await orchestrator.resumeJob({ jobDir: args.job });
      console.log(JSON.stringify({
        ok: true,
        command: "resume",
        result
      }));
    } else if (command === "cancel") {
      // For now, write transition state
      const { manifest } = await loadJob(args.job);
      const reqArt = manifest.artifacts.find(a => a.artifactId === "pipeline-request");
      const inputHash = reqArt ? reqArt.sha256 : "0000000000000000000000000000000000000000000000000000000000000000";
      
      const state = await transitionJob(args.job, {
        stage: "pipeline-cancel",
        to: "cancel_requested",
        inputHash
      });

      console.log(JSON.stringify({
        ok: true,
        command: "cancel",
        result: {
          jobId: state.jobId,
          status: state.status
        }
      }));
    }
  } catch (err) {
    console.log(JSON.stringify({
      ok: false,
      command: command || "unknown",
      error: {
        code: err.code || "command_execution_failed",
        message: err.message
      }
    }));
    process.exit(1);
  }
}

main();
