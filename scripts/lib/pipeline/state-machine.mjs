import { randomBytes } from "node:crypto";
import { open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { writeCanonicalJson, readJson } from "./atomic-store.mjs";
import { validateSchema } from "./schema-registry.mjs";

const ALLOWED_TRANSITIONS = {
  pending: ["running", "failed", "cancelled", "cancel_requested"],
  running: ["running", "awaiting_approval", "retrying", "completed", "needs_review", "failed", "cancelled", "cancel_requested"],
  awaiting_approval: ["running", "completed", "failed", "cancelled"],
  retrying: ["running", "failed", "cancelled"],
  needs_review: ["running", "completed", "failed", "cancelled"],
  cancel_requested: ["cancelled", "failed"],
  completed: [],
  failed: [],
  cancelled: []
};

export async function acquireLock(jobDir) {
  const lockPath = join(jobDir, "pipeline.lock");
  const leaseId = randomBytes(8).toString("hex");
  const acquiredAt = new Date().toISOString();
  const pid = process.pid;
  const lockContent = {
    schemaVersion: "1.0.0",
    pid,
    leaseId,
    acquiredAt
  };
  const lockData = Buffer.from(JSON.stringify(lockContent) + "\n", "utf8");

  let handle;
  try {
    handle = await open(lockPath, "wx");
    await handle.writeFile(lockData);
    await handle.sync();
    await handle.close();
    return leaseId;
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
    let oldLock;
    try {
      const text = await readFile(lockPath, "utf8");
      oldLock = JSON.parse(text);
    } catch (readErr) {
      const err = new Error("job locked");
      err.code = "job_locked";
      throw err;
    }

    const age = (Date.now() - new Date(oldLock.acquiredAt).getTime()) / 1000;
    let pidAlive = false;
    try {
      process.kill(oldLock.pid, 0);
      pidAlive = true;
    } catch (killErr) {
      if (killErr.code === "EPERM") {
        pidAlive = true;
      }
    }

    if (age > 300 && !pidAlive) {
      const reclaimPath = join(jobDir, "quarantine/locks", `pipeline-${oldLock.leaseId}.json`);
      try {
        await rename(lockPath, reclaimPath);
      } catch (renameErr) {
        // ignore
      }
      try {
        handle = await open(lockPath, "wx");
        await handle.writeFile(lockData);
        await handle.sync();
        await handle.close();
        return leaseId;
      } catch (retryErr) {
        const err = new Error("job locked");
        err.code = "job_locked";
        throw err;
      }
    } else {
      const err = new Error("job locked");
      err.code = "job_locked";
      throw err;
    }
  }
}

export async function releaseLock(jobDir, leaseId) {
  const lockPath = join(jobDir, "pipeline.lock");
  try {
    const text = await readFile(lockPath, "utf8");
    const currentLock = JSON.parse(text);
    if (currentLock.leaseId === leaseId) {
      await rm(lockPath, { force: true });
    }
  } catch (err) {
    // ignore
  }
}

export async function transitionJob(jobDir, event) {
  const leaseId = await acquireLock(jobDir);
  try {
    const statePath = join(jobDir, "pipeline-state.json");
    const state = await readJson(statePath);

    if ((event.outputHash !== undefined && event.artifactPaths === undefined) ||
        (event.outputHash === undefined && event.artifactPaths !== undefined)) {
      throw new Error("outputHash and artifactPaths must be supplied together");
    }

    if (event.attempt !== undefined) {
      if (event.stage !== "DURATION_REPAIR_REQUIRED" || event.attempt !== 1) {
        const err = new Error("invalid attempt or stage");
        err.code = "invalid_attempt";
        throw err;
      }
    }

    const oldStatus = state.status;
    const newStatus = event.to;
    const allowed = ALLOWED_TRANSITIONS[oldStatus];
    if (!allowed || !allowed.includes(newStatus)) {
      const err = new Error(`Illegal state transition from ${oldStatus} to ${newStatus}`);
      err.code = "illegal_state_transition";
      throw err;
    }

    if (event.stage === "DURATION_REPAIR_REQUIRED") {
      if (state.durationRepairAttemptsUsed !== 0) {
        const err = new Error("duration repair budget exhausted");
        err.code = "duration_repair_budget_exhausted";
        throw err;
      }
      state.durationRepairAttemptsUsed = 1;
    }

    const matchingRows = state.history.filter(r => r.stage === event.stage && r.inputHash === event.inputHash && !r.error);
    if (matchingRows.length > 1) {
      const err = new Error("Success evidence conflict");
      err.code = "success_evidence_conflict";
      throw err;
    }
    if (matchingRows.length === 1) {
      const row = matchingRows[0];
      const normPaths = event.artifactPaths ? [...event.artifactPaths].sort().map(p => p.replaceAll("\\", "/")) : undefined;
      const rowPaths = row.artifactPaths ? [...row.artifactPaths].sort().map(p => p.replaceAll("\\", "/")) : undefined;

      const toMatch = row.to === event.to;
      const outHashMatch = row.outputHash === event.outputHash;
      const pathsMatch = JSON.stringify(rowPaths) === JSON.stringify(normPaths);

      if (toMatch && outHashMatch && pathsMatch) {
        return state;
      } else {
        const err = new Error("Success evidence conflict");
        err.code = "success_evidence_conflict";
        throw err;
      }
    }

    const newRow = {
      from: oldStatus,
      to: newStatus,
      stage: event.stage,
      inputHash: event.inputHash,
      at: new Date().toISOString()
    };
    if (event.outputHash !== undefined) newRow.outputHash = event.outputHash;
    if (event.artifactPaths !== undefined) {
      newRow.artifactPaths = [...event.artifactPaths].sort().map(p => p.replaceAll("\\", "/"));
    }
    if (event.error !== undefined) newRow.error = event.error;
    if (event.note !== undefined) newRow.note = event.note;
    if (event.attempt !== undefined) newRow.attempt = event.attempt;

    state.status = newStatus;
    state.history.push(newRow);

    const workspaceRoot = resolve(process.cwd());
    const schemaPath = join(workspaceRoot, "schemas", "pipeline", "pipeline-state.schema.json");

    await validateSchema(schemaPath, state);
    await writeCanonicalJson(statePath, state);

    return state;
  } finally {
    await releaseLock(jobDir, leaseId);
  }
}
