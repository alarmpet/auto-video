import { lstat, mkdir, realpath } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { assertPathWithin, assertRealPathWithin } from "../pipeline/path-policy.mjs";

function layoutError(message) {
  const error = new Error(message);
  error.code = "video_layout_unsafe";
  return error;
}

async function getNearestExistingAncestor(jobDir, path) {
  let curr = resolve(path);
  const root = resolve(jobDir);
  while (true) {
    try {
      const stat = await lstat(curr);
      return { path: curr, stat };
    } catch (err) {
      if (err.code !== "ENOENT") {
        throw layoutError(`Failed to lstat ancestor component: ${err.message}`);
      }
    }
    const parent = dirname(curr);
    if (parent === curr) {
      break;
    }
    curr = parent;
  }
  return { path: root, stat: null };
}

async function verifyPathSafety(jobDir, targetPath) {
  const root = resolve(jobDir);
  const target = resolve(targetPath);

  // 1. Resolve lexically below the verified root
  try {
    assertPathWithin(root, target);
  } catch (err) {
    throw layoutError(`Path escape detected lexically: ${err.message}`);
  }

  // Check every path component from root to target
  const relativeParts = target.slice(root.length).split(/[\\/]/).filter(Boolean);
  let currentPath = root;

  for (const part of relativeParts) {
    currentPath = join(currentPath, part);
    
    // Check if component exists
    let stat = null;
    try {
      stat = await lstat(currentPath);
    } catch (err) {
      if (err.code !== "ENOENT") {
        throw layoutError(`Component check failed: ${err.message}`);
      }
    }

    if (stat) {
      if (!stat.isDirectory()) {
        throw layoutError(`Component is not a directory: ${currentPath}`);
      }
      // If it exists, check that it doesn't escape realpath
      try {
        await assertRealPathWithin(root, currentPath);
      } catch (err) {
        throw layoutError(`Component realpath escape: ${err.message}`);
      }
    } else {
      // Find nearest existing ancestor
      const ancestor = await getNearestExistingAncestor(root, currentPath);
      if (ancestor.stat) {
        if (!ancestor.stat.isDirectory()) {
          throw layoutError(`Nearest existing ancestor is not a directory: ${ancestor.path}`);
        }
        try {
          await assertRealPathWithin(root, ancestor.path);
        } catch (err) {
          throw layoutError(`Nearest existing ancestor realpath escape: ${err.message}`);
        }
      }
    }
  }
}

async function verifyCompletedSafety(jobDir, targetPath) {
  const root = resolve(jobDir);
  const target = resolve(targetPath);

  let stat;
  try {
    stat = await lstat(target);
  } catch (err) {
    throw layoutError(`Post-creation check failed: path does not exist ${target}`);
  }

  if (!stat.isDirectory()) {
    throw layoutError(`Post-creation check failed: not a directory ${target}`);
  }

  try {
    await assertRealPathWithin(root, target);
  } catch (err) {
    throw layoutError(`Post-creation check failed: realpath escape ${target}`);
  }
}

export async function ensureVideoJobLayout(jobDir) {
  const resolvedRoot = resolve(jobDir);
  const staticDirs = [
    "final/incidents",
    "logs/video",
    "quarantine/video",
    "quarantine/video/publications"
  ].sort(); // Bytewise-sorted

  const targets = staticDirs.map(d => join(resolvedRoot, d));

  // Pass 1: Preflight check over all targets
  for (const t of targets) {
    await verifyPathSafety(resolvedRoot, t);
  }

  // Pass 2: mkdir recursive
  for (const t of targets) {
    await mkdir(t, { recursive: true });
  }

  // Pass 3: Walk and real-resolve completed chains
  for (const t of targets) {
    await verifyCompletedSafety(resolvedRoot, t);
  }

  return targets;
}

export async function ensureContainedVideoDirectory(jobDir, relativePath) {
  if (!relativePath) {
    throw layoutError("Relative path cannot be empty");
  }
  if (isAbsolute(relativePath)) {
    throw layoutError("Relative path cannot be absolute");
  }
  if (relativePath.includes("\\")) {
    throw layoutError("Relative path cannot contain backslashes");
  }
  if (relativePath.includes(":")) {
    throw layoutError("Relative path cannot contain a drive letter or colon");
  }
  if (relativePath.split("/").includes("..")) {
    throw layoutError("Relative path cannot contain double dots (..)");
  }

  const resolvedRoot = resolve(jobDir);
  const target = join(resolvedRoot, relativePath);

  // Pass 1: Preflight
  await verifyPathSafety(resolvedRoot, target);

  // Pass 2: mkdir
  await mkdir(target, { recursive: true });

  // Pass 3: Verify completed safety
  await verifyCompletedSafety(resolvedRoot, target);

  return target;
}

function isAbsolute(path) {
  return /^[a-zA-Z]:/.test(path) || path.startsWith("/") || path.startsWith("\\");
}
