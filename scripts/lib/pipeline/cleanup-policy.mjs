import { resolve, join, basename, relative } from "node:path";
import { stat, readdir, rm, mkdir } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hashCanonical, sha256Bytes } from "./canonical-json.mjs";
import { writeCanonicalJsonExclusive } from "./atomic-store.mjs";

function ensurePathContained(base, target) {
  const rel = relative(base, target);
  if (rel.startsWith("..") || rel === "..") {
    throw Object.assign(new Error("Path escape detected"), { code: "path_escape" });
  }
}

async function recursiveScan(dir, baseJobDir, fileList = []) {
  if (!existsSync(dir)) return fileList;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    ensurePathContained(baseJobDir, fullPath);
    if (entry.isDirectory()) {
      if (entry.name === "quarantine") {
        // Entire quarantine directory can be included
        const s = await stat(fullPath);
        fileList.push({ path: relative(baseJobDir, fullPath).replaceAll("\\", "/"), bytes: s.size, reason: "quarantine_entry" });
      } else {
        await recursiveScan(fullPath, baseJobDir, fileList);
      }
    } else {
      const s = await stat(fullPath);
      const relPath = relative(baseJobDir, fullPath).replaceAll("\\", "/");
      const name = entry.name;
      if (name.startsWith(".") || name.includes(".tmp-") || name.includes(".exclusive-") || name.endsWith(".part") || relPath.startsWith("quarantine/")) {
        fileList.push({ path: relPath, bytes: s.size, reason: "temp_or_quarantine" });
      }
    }
  }
  return fileList;
}

export async function planCleanup({ jobDir, olderThanDays = 0 }) {
  const resolvedJobDir = resolve(jobDir);
  if (!existsSync(resolvedJobDir)) {
    throw new Error("Job directory does not exist");
  }

  // Load manifest artifacts to protect them
  const manifestPath = join(resolvedJobDir, "artifact-manifest.json");
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { artifacts: [] };
  const protectedPaths = new Set([
    "request.json",
    "pipeline-state.json",
    "artifact-manifest.json",
    "approvals/current-approval-1.json",
    "approvals/current-approval-2.json"
  ]);

  for (const art of manifest.artifacts || []) {
    if (art.gateStatus === "pass") {
      protectedPaths.add(art.path.replaceAll("\\", "/"));
    }
  }

  const rawItems = await recursiveScan(resolvedJobDir, resolvedJobDir);
  const items = rawItems.filter(item => {
    // Make sure we never include protected files
    const p = item.path;
    if (protectedPaths.has(p)) return false;
    if (p.startsWith("approvals/approval-")) return false; // Protect approval revision files
    if (p.startsWith("final/")) return false; // Protect final output files
    return true;
  });

  const planPayload = {
    schemaVersion: "1.0.0",
    jobDir: resolvedJobDir,
    items: items.sort((a, b) => a.path.localeCompare(b.path))
  };

  const planHash = hashCanonical(planPayload);

  // Write plan to reviews directory
  const reviewsDir = join(resolvedJobDir, "reviews");
  await mkdir(reviewsDir, { recursive: true });
  const planFilename = `reviews/cleanup-plan-${planHash.substring(0, 16)}.json`;
  const absolutePlanPath = join(resolvedJobDir, planFilename);

  await writeCanonicalJsonExclusive(absolutePlanPath, planPayload);

  return {
    planPath: planFilename,
    planHash,
    jobDir: resolvedJobDir,
    items
  };
}

export async function executeCleanup(plan, { confirmationHash }) {
  if (!plan || !plan.planHash || !plan.jobDir) {
    throw new Error("Invalid cleanup plan");
  }
  if (confirmationHash !== plan.planHash) {
    throw Object.assign(new Error("Cleanup confirmation hash mismatch"), { code: "confirmation_hash_mismatch" });
  }

  const resolvedJobDir = resolve(plan.jobDir);
  const manifestPath = join(resolvedJobDir, "artifact-manifest.json");
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { artifacts: [] };
  const protectedPaths = new Set([
    "request.json",
    "pipeline-state.json",
    "artifact-manifest.json",
    "approvals/current-approval-1.json",
    "approvals/current-approval-2.json"
  ]);

  for (const art of manifest.artifacts || []) {
    if (art.gateStatus === "pass") {
      protectedPaths.add(art.path.replaceAll("\\", "/"));
    }
  }

  let deletedCount = 0;
  let deletedBytes = 0;

  for (const item of plan.items) {
    const fullPath = join(resolvedJobDir, item.path);
    ensurePathContained(resolvedJobDir, fullPath);

    // Revalidate protected rules immediately before deleting
    if (protectedPaths.has(item.path)) continue;
    if (item.path.startsWith("approvals/approval-")) continue;
    if (item.path.startsWith("final/")) continue;

    if (existsSync(fullPath)) {
      await rm(fullPath, { recursive: true, force: true });
      deletedCount++;
      deletedBytes += item.bytes;
    }
  }

  return {
    deletedCount,
    deletedBytes
  };
}
