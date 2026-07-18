import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile, rename } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { readJson, writeCanonicalJson } from "./atomic-store.mjs";
import { hashCanonical } from "./canonical-json.mjs";
import { loadProfile, loadHostConfig } from "./profile-registry.mjs";
import { validateSchema } from "./schema-registry.mjs";
import { discoverCodex, preflightCodex } from "../providers/codex-cli.mjs";

export async function runCodexStage({ jobDir, stageId, prompt, schemaPath, inputHash, timeoutMs, signal, attemptCount = 1 }) {
  const workspaceRoot = dirname(dirname(resolve(jobDir)));
  const request = await readJson(join(jobDir, "request.json"));
  const profile = await loadProfile(request.profileId, workspaceRoot);
  const hostConfig = await loadHostConfig(workspaceRoot);

  // Assert model/isolation matches profile locked values
  if (profile.codex.model !== "gpt-5.6-sol") {
    throw new Error(`Profile model mismatch: expected gpt-5.6-sol but got ${profile.codex.model}`);
  }
  if (profile.codex.reasoningEffort !== "ultra") {
    throw new Error(`Profile reasoning effort mismatch: expected ultra but got ${profile.codex.reasoningEffort}`);
  }

  const attemptId = `attempt-${attemptCount}`;
  const stageWorkDir = resolve(join(jobDir, "logs", "codex", stageId, attemptId, "workspace"));
  
  await mkdir(stageWorkDir, { recursive: true });
  const files = await readdir(stageWorkDir).catch(() => []);
  if (files.length > 0) {
    throw new Error(`stage workdir is not empty: ${stageWorkDir} (files: ${files.join(", ")})`);
  }

  const discoverResult = await discoverCodex(hostConfig);
  const executable = discoverResult.executable;

  const preflight = await preflightCodex(executable, {
    profile,
    stageWorkDir,
    workspaceRoot,
    timeoutMs: hostConfig.codex?.versionTimeoutMs || 15000
  });

  const candidatePath = resolve(join(stageWorkDir, "candidate.json"));
  const eventsPath = resolve(join(stageWorkDir, "events.jsonl"));
  const stderrPath = resolve(join(stageWorkDir, "stderr.log"));

  const args = [
    "exec", "-s", "read-only", "--json",
    "--model", "gpt-5.6-sol", "-c", "model_reasoning_effort=\"ultra\"",
    "-C", stageWorkDir, "-c", "project_root_markers=[]",
    "--ignore-user-config", "--ignore-rules", "--strict-config",
    "--output-schema", resolve(schemaPath),
    "--output-last-message", candidatePath,
    "--ephemeral", "--skip-git-repo-check", "-"
  ];

  const isMjs = executable.endsWith(".mjs");
  const spawnExec = isMjs ? process.execPath : executable;
  const spawnArgs = isMjs ? [executable, ...args] : args;

  const child = spawn(spawnExec, spawnArgs, {
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      FAKE_CODEX_MODE: process.env.FAKE_CODEX_MODE,
      FAKE_CODEX_JOB_ID: request.jobId,
      FAKE_CODEX_STAGE_ID: stageId,
      FAKE_CODEX_INPUT_HASH: inputHash
    }
  });

  child.stdin.write(prompt);
  child.stdin.end();

  let stdoutBuffer = "";
  let stderrBuffer = "";
  let eventsContent = "";

  const stdoutPromise = new Promise((resolveProto) => {
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      eventsContent += text;
      stdoutBuffer += text;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.status === "failed" || parsed.status === "error" || parsed.error) {
            child.kill();
          }
        } catch (e) {
          // ignore parsing error during line streaming
        }
      }
    });
    child.stdout.on("end", () => resolveProto());
  });

  const stderrPromise = new Promise((resolveErr) => {
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderrBuffer += text;
    });
    child.stderr.on("end", () => resolveErr());
  });

  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    if (timeoutMs) {
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        const err = new Error("Codex execution timed out");
        err.code = "codex_timeout";
        reject(err);
      }, timeoutMs);
    }
  });

  const abortPromise = new Promise((_, reject) => {
    if (signal) {
      if (signal.aborted) {
        child.kill("SIGTERM");
        const err = new Error("Codex execution aborted");
        err.code = "codex_aborted";
        reject(err);
      }
      signal.addEventListener("abort", () => {
        child.kill("SIGTERM");
        const err = new Error("Codex execution aborted");
        err.code = "codex_aborted";
        reject(err);
      });
    }
  });

  const processPromise = new Promise((resolveProc, rejectProc) => {
    child.on("close", (code) => {
      if (code === 0) {
        resolveProc();
      } else {
        const err = new Error(`Codex process exited with code ${code}`);
        err.code = "codex_process_failed";
        rejectProc(err);
      }
    });
    child.on("error", (err) => {
      rejectProc(err);
    });
  });

  try {
    await Promise.race([
      Promise.all([stdoutPromise, stderrPromise, processPromise]),
      timeoutPromise,
      abortPromise
    ]);
  } catch (err) {
    if (timer) clearTimeout(timer);
    
    // Quarantine candidate output
    try {
      const quarantinePath = join(jobDir, "quarantine", `${stageId}-${attemptId}-candidate.json`);
      await rename(candidatePath, quarantinePath);
    } catch (e) {
      // ignore if candidate.json doesn't exist
    }

    // Write events and stderr log anyway for debugging
    await writeFile(eventsPath, eventsContent, "utf8");
    await writeFile(stderrPath, stderrBuffer, "utf8");

    throw err;
  }

  if (timer) clearTimeout(timer);

  await writeFile(eventsPath, eventsContent, "utf8");
  await writeFile(stderrPath, stderrBuffer, "utf8");

  // Validate event logs for errors
  const finalLines = eventsContent.split(/\r?\n/);
  for (const line of finalLines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.status === "failed" || parsed.status === "error" || parsed.error) {
        const err = new Error(`Codex event error: ${parsed.error?.message || JSON.stringify(parsed)}`);
        err.code = "codex_event_error";
        throw err;
      }
    } catch (e) {
      if (e.code === "codex_event_error") throw e;
    }
  }

  let payload;
  try {
    payload = await readJson(candidatePath);
  } catch (err) {
    const error = new Error(`Malformed JSON in candidate: ${err.message}`);
    error.code = "codex_malformed_json";
    throw error;
  }

  // Validate output against schema
  try {
    await validateSchema(schemaPath, payload);
  } catch (err) {
    err.code = "codex_schema_validation_failed";
    throw err;
  }

  // Verify payload matches job, stage, inputHash
  const expectedBaseStageId = stageId.split(".repair-")[0];
  if (payload.jobId !== request.jobId || (payload.stageId !== stageId && payload.stageId !== expectedBaseStageId) || payload.inputHash !== inputHash) {
    console.error(`MISMATCH DETAIL: payload.jobId=${payload.jobId} request.jobId=${request.jobId}; payload.stageId=${payload.stageId} stageId=${stageId} (or ${expectedBaseStageId}); payload.inputHash=${payload.inputHash} inputHash=${inputHash}`);
    const err = new Error("Codex payload mismatch on jobId, stageId, or inputHash");
    err.code = "codex_payload_mismatch";
    throw err;
  }

  const outputHash = hashCanonical(payload);

  const provenance = {
    executableVersion: preflight.version,
    model: profile.codex.model,
    reasoningEffort: profile.codex.reasoningEffort,
    cliIsolationFlags: ["--ignore-user-config", "--ignore-rules", "--strict-config"],
    projectRootMarkers: profile.codex.projectRootMarkers,
    checkedInstructionPaths: preflight.checkedInstructionPaths,
    instructionSourceHashes: preflight.instructionSourceHashes,
    stageWorkDir,
    profileHash: profile.profileHash
  };

  return {
    payload,
    outputHash,
    eventsPath,
    provenance
  };
}

export async function runCodexStageWithPolicy({ jobDir, stageId, prompt, schemaPath, inputHash, timeoutMs, signal }) {
  const request = await readJson(join(jobDir, "request.json"));
  const statePath = join(jobDir, "pipeline-state.json");
  const state = await readJson(statePath);

  const previousAttempts = state.history.filter(h => h.stage === stageId && h.inputHash === inputHash);
  const attemptCount = previousAttempts.length + 1;

  if (attemptCount > 2) {
    const err = new Error("retry budget exhausted");
    err.code = "duration_repair_budget_exhausted";
    throw err;
  }

  let finalPrompt = prompt;
  if (attemptCount === 2) {
    const lastFailed = previousAttempts[previousAttempts.length - 1];
    const errMsg = lastFailed?.error?.message || "schema validation failed";
    finalPrompt = `${prompt}\n\n[SYSTEM NOTICE: Your previous output failed validation with error: ${errMsg}. Please correct the output and satisfy the schema.]`;
  }

  return runCodexStage({
    jobDir,
    stageId,
    prompt: finalPrompt,
    schemaPath,
    inputHash,
    timeoutMs,
    signal,
    attemptCount
  });
}
