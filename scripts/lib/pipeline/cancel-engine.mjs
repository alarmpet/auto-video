import { resolve, join, basename } from "node:path";
import { readdir, rename, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { loadJob } from "./job-store.mjs";
import { transitionJob } from "./state-machine.mjs";

async function recursiveFindTempFiles(dir, fileList = []) {
  if (!existsSync(dir)) return fileList;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await recursiveFindTempFiles(fullPath, fileList);
    } else {
      if (entry.name.startsWith(".") || entry.name.includes(".tmp-") || entry.name.includes(".exclusive-") || entry.name.endsWith(".part")) {
        fileList.push(fullPath);
      }
    }
  }
  return fileList;
}

export async function runCancelEngine({ jobDir }) {
  const resolvedJobDir = resolve(jobDir);
  const job = await loadJob(resolvedJobDir);
  const { state } = job;

  if (state.status === "completed" || state.status === "failed" || state.status === "cancelled") {
    return { status: state.status, message: "Job is already in a terminal state" };
  }

  // 1. Transition state to cancelled
  const reqArt = job.manifest.artifacts?.find(a => a.artifactId === "pipeline-request");
  const inputHash = reqArt ? reqArt.sha256 : "0".repeat(64);

  const updatedState = await transitionJob(resolvedJobDir, {
    stage: "pipeline-cancel",
    to: "cancelled",
    inputHash
  });

  // 2. Quarantine temporary/partial files
  const tempFiles = await recursiveFindTempFiles(resolvedJobDir);
  const quarantineDir = join(resolvedJobDir, "quarantine/cancelled-temp");
  if (tempFiles.length > 0) {
    await mkdir(quarantineDir, { recursive: true });
    for (const file of tempFiles) {
      try {
        const name = basename(file);
        const dest = join(quarantineDir, `${Date.now()}-${name}`);
        await rename(file, dest);
      } catch {
        // Fallback to rm if rename fails
        await rm(file, { force: true });
      }
    }
  }

  return {
    status: "cancelled",
    quarantinedCount: tempFiles.length
  };
}
