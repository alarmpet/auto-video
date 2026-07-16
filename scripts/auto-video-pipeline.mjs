import { parseCli } from "./lib/pipeline/cli-args.mjs";
import { loadProfile, loadHostConfig, validateTargetMinutes } from "./lib/pipeline/profile-registry.mjs";
import { createJob, loadJob } from "./lib/pipeline/job-store.mjs";
import { transitionJob } from "./lib/pipeline/state-machine.mjs";
import { discoverCodex, preflightCodex } from "./lib/providers/codex-cli.mjs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
  cancel: {
    job: { type: "string", required: true }
  },
  resume: {
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
    } else if (command === "cancel") {
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
    } else if (command === "resume") {
      const context = await loadJob(args.job);
      let nextStage = "planning";
      if (context.state.history.some(h => h.stage === "planning")) {
        nextStage = "script-generation";
      }

      console.log(JSON.stringify({
        ok: true,
        command: "resume",
        result: {
          jobId: context.state.jobId,
          nextStage
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
