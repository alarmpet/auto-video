import { join, dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readJson } from "./atomic-store.mjs";
import { hashCanonical } from "./canonical-json.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_PROJECT_ROOT = resolve(__dirname, "..", "..", "..");

function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    deepFreeze(obj[key]);
  }
  return obj;
}

export async function loadProfile(profileId, workspaceRoot) {
  if (typeof profileId !== "string" || !/^[a-z0-9-]+$/.test(profileId)) {
    throw new Error(`invalid profileId format: ${profileId}`);
  }
  let filePath = join(workspaceRoot, "config", "profiles", `${profileId}.json`);
  if (!existsSync(filePath)) {
    const fallbackPath = join(REAL_PROJECT_ROOT, "config", "profiles", `${profileId}.json`);
    if (existsSync(fallbackPath)) {
      filePath = fallbackPath;
    }
  }
  let data;
  try {
    data = await readJson(filePath);
  } catch (err) {
    throw new Error(`failed to load profile '${profileId}': ${err.message}`, { cause: err });
  }
  const profileHash = hashCanonical(data);
  const profile = { ...data, profileHash };
  return deepFreeze(profile);
}

export async function loadHostConfig(workspaceRoot) {
  let localPath = join(workspaceRoot, "config", "host.local.json");
  let examplePath = join(workspaceRoot, "config", "host.local.example.json");

  if (!existsSync(localPath) && !existsSync(examplePath)) {
    const fallbackLocal = join(REAL_PROJECT_ROOT, "config", "host.local.json");
    const fallbackExample = join(REAL_PROJECT_ROOT, "config", "host.local.example.json");
    if (existsSync(fallbackLocal)) {
      localPath = fallbackLocal;
    } else if (existsSync(fallbackExample)) {
      examplePath = fallbackExample;
      localPath = fallbackLocal;
    }
  }

  let data;
  try {
    data = await readJson(localPath);
  } catch (err) {
    try {
      data = await readJson(examplePath);
    } catch (err2) {
      throw new Error(`failed to load host config: ${err2.message}`);
    }
  }
  const hostConfigHash = hashCanonical(data);
  const hostConfig = { ...data, hostConfigHash };
  return deepFreeze(hostConfig);
}

export function validateTargetMinutes(value) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 10 || num > 120 || num % 10 !== 0) {
    const err = new Error("targetMinutes must be 10..120 in steps of 10");
    err.code = "invalid_target_minutes";
    throw err;
  }
  return num;
}
