import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

function pidState(pid) {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    return error.code === "ESRCH" ? "dead" : "indeterminate";
  }
}

function validateLockPath({ workspaceRoot, lockPath, resource }) {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(resource)) {
    throw Object.assign(new Error("resource name is unsafe"), { code: "resource_lock_name_invalid" });
  }
  const expected = resolve(workspaceRoot, "exports", ".locks", `${resource}.lock`);
  if (resolve(lockPath) !== expected) {
    throw Object.assign(new Error(`resource lock path must equal ${expected}`), { code: "resource_lock_path_invalid" });
  }
}

async function createLease({ lockPath, resource, ownerJobId, ownerStage }) {
  const lease = { schemaVersion: "1.0.0", leaseId: randomUUID(), resource, ownerJobId, ownerStage, pid: process.pid, acquiredAtMs: Date.now(), lockPath };
  const handle = await open(lockPath, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(lease)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return Object.freeze(lease);
}

export async function acquireResourceLock({ workspaceRoot = process.cwd(), lockPath, resource, ownerJobId, ownerStage, signal, staleAfterMs = 3600000 }) {
  if (signal?.aborted) throw Object.assign(new Error("resource wait cancelled"), { code: "cancelled" });
  validateLockPath({ workspaceRoot, lockPath, resource });
  await mkdir(dirname(lockPath), { recursive: true });
  try {
    return await createLease({ lockPath, resource, ownerJobId, ownerStage });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let observed;
    try {
      observed = JSON.parse(await readFile(lockPath, "utf8"));
    } catch {
      // If lock file is corrupted/empty, treat it as reclaimable
      observed = { leaseId: "unknown", acquiredAtMs: 0, pid: 0 };
    }
    const reclaimPath = `${lockPath}.reclaim`;
    let reclaimHandle;
    try {
      reclaimHandle = await open(reclaimPath, "wx");
      await reclaimHandle.writeFile(`${JSON.stringify({ schemaVersion: "1.0.0", pid: process.pid, leaseId: randomUUID(), observedLeaseId: observed.leaseId })}\n`, "utf8");
      await reclaimHandle.sync();
    } catch (reclaimError) {
      if (reclaimError.code === "EEXIST") {
        throw Object.assign(new Error("resource reclaim already in progress"), { code: "resource_locked", current: observed });
      }
      throw reclaimError;
    } finally {
      await reclaimHandle?.close();
    }
    try {
      let current;
      try {
        current = JSON.parse(await readFile(lockPath, "utf8"));
      } catch {
        current = { leaseId: "unknown", acquiredAtMs: 0, pid: 0 };
      }
      const reclaimable = current.leaseId === observed.leaseId && (Date.now() - (current.acquiredAtMs || 0) > staleAfterMs || pidState(current.pid) === "dead");
      if (!reclaimable) {
        throw Object.assign(new Error(`resource owned by ${current.ownerJobId}:${current.ownerStage}`), { code: "resource_locked", current });
      }
      const evidencePath = join(dirname(lockPath), `${resource}.stale-${current.leaseId || "unknown"}-${randomUUID()}.json`);
      await rename(lockPath, evidencePath);
    } finally {
      await rm(reclaimPath, { force: true });
    }
    if (signal?.aborted) throw Object.assign(new Error("resource wait cancelled"), { code: "cancelled" });
    try {
      return await createLease({ lockPath, resource, ownerJobId, ownerStage });
    } catch (raceError) {
      if (raceError.code === "EEXIST") {
        throw Object.assign(new Error("resource acquired by another contender"), { code: "resource_locked" });
      }
      throw raceError;
    }
  }
}

export async function releaseResourceLock(lease) {
  const current = JSON.parse(await readFile(lease.lockPath, "utf8"));
  if (current.leaseId !== lease.leaseId || current.pid !== process.pid) {
    throw Object.assign(new Error("resource lease ownership mismatch"), { code: "resource_lease_mismatch" });
  }
  await rm(lease.lockPath);
}

export async function withResourceLock(options, fn) {
  const lease = await acquireResourceLock(options);
  try {
    return await fn(lease);
  } finally {
    await releaseResourceLock(lease);
  }
}
