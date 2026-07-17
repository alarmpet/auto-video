import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireResourceLock, releaseResourceLock } from "../../scripts/lib/pipeline/resource-lock.mjs";

test("one workspace GPU lease serializes different jobs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gpu-lock-"));
  const lockPath = join(dir, "exports", ".locks", "gpu.lock");
  const first = await acquireResourceLock({ workspaceRoot: dir, lockPath, resource: "gpu", ownerJobId: "job-a", ownerStage: "comfy", staleAfterMs: 3600000 });
  await assert.rejects(
    acquireResourceLock({ workspaceRoot: dir, lockPath, resource: "gpu", ownerJobId: "job-b", ownerStage: "ollama", staleAfterMs: 3600000 }),
    error => error.code === "resource_locked"
  );
  await releaseResourceLock(first);
  const second = await acquireResourceLock({ workspaceRoot: dir, lockPath, resource: "gpu", ownerJobId: "job-b", ownerStage: "ollama", staleAfterMs: 3600000 });
  await releaseResourceLock(second);
});

test("resource lock rejects invalid lock path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gpu-lock-"));
  await assert.rejects(
    acquireResourceLock({ workspaceRoot: dir, lockPath: join(dir, "wrong.lock"), resource: "gpu", ownerJobId: "job-a", ownerStage: "comfy" }),
    error => error.code === "resource_lock_path_invalid"
  );
});

test("resource lock rejects invalid resource name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gpu-lock-"));
  await assert.rejects(
    acquireResourceLock({ workspaceRoot: dir, lockPath: join(dir, "exports", ".locks", "GPU.lock"), resource: "GPU", ownerJobId: "job-a", ownerStage: "comfy" }),
    error => error.code === "resource_lock_name_invalid"
  );
});
