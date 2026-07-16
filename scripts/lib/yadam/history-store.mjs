// scripts/lib/yadam/history-store.mjs
import { open, readFile, unlink, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalJson, sha256Bytes } from "../pipeline/canonical-json.mjs";

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function validateFingerprint(fp) {
  if (!fp || typeof fp !== "object") return false;
  const { jobId, completedAt, nameIds, motifIds, twistCategories, themeLine, titleFingerprint } = fp;
  if (typeof jobId !== "string" || !jobId) return false;
  if (typeof completedAt !== "string" || isNaN(Date.parse(completedAt))) return false;
  if (!Array.isArray(nameIds) || !nameIds.every(id => typeof id === "string")) return false;
  if (!Array.isArray(motifIds) || !motifIds.every(id => typeof id === "string")) return false;
  if (!Array.isArray(twistCategories) || !twistCategories.every(c => typeof c === "string")) return false;
  if (typeof themeLine !== "string") return false;
  if (typeof titleFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(titleFingerprint)) return false;

  const keys = Object.keys(fp);
  const expectedKeys = new Set(["jobId", "completedAt", "nameIds", "motifIds", "twistCategories", "themeLine", "titleFingerprint"]);
  if (keys.length !== 7 || !keys.every(k => expectedKeys.has(k))) return false;

  return true;
}

export function computeTitleFingerprint(title, titleSuffix) {
  let cleanTitle = title.normalize("NFC");
  if (titleSuffix) {
    const normalizedSuffix = titleSuffix.normalize("NFC");
    if (cleanTitle.endsWith(normalizedSuffix)) {
      cleanTitle = cleanTitle.slice(0, -normalizedSuffix.length);
    }
  }
  cleanTitle = cleanTitle.toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
  return sha256Bytes(Buffer.from(cleanTitle, "utf8"));
}

export async function readRecentStoryFingerprints(historyPath, limit = 20) {
  try {
    const content = await readFile(historyPath, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    const validFingerprints = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (validateFingerprint(parsed)) {
          validFingerprints.push(parsed);
        }
      } catch {
        // Skip malformed lines
      }
    }

    validFingerprints.sort((a, b) => {
      const timeA = Date.parse(a.completedAt);
      const timeB = Date.parse(b.completedAt);
      if (timeA !== timeB) return timeA - timeB;
      return a.jobId.localeCompare(b.jobId);
    });

    return validFingerprints.slice(-limit);
  } catch (err) {
    if (err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

export async function appendCompletedStoryFingerprint({ historyPath, fingerprint }) {
  if (!validateFingerprint(fingerprint)) {
    throw codedError("invalid_fingerprint", "Invalid fingerprint structure");
  }

  const lockPath = historyPath + ".lock";
  let lockHandle;
  try {
    await mkdir(dirname(lockPath), { recursive: true });
    lockHandle = await open(lockPath, "wx", 0o600);
  } catch (err) {
    if (err.code === "EEXIST") {
      throw codedError("history_locked", "History store lock is currently held by another process");
    }
    throw err;
  }

  try {
    let existingLines = [];
    try {
      const content = await readFile(historyPath, "utf8");
      existingLines = content.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }

    const jobIds = new Set();
    for (const fp of existingLines) {
      if (validateFingerprint(fp)) {
        jobIds.add(fp.jobId);
      }
    }

    if (jobIds.has(fingerprint.jobId)) {
      throw codedError("duplicate_job_id", `Job ID ${fingerprint.jobId} already exists in history`);
    }

    let appendHandle;
    try {
      appendHandle = await open(historyPath, "a");
      await appendHandle.writeFile(`${canonicalJson(fingerprint)}\n`, "utf8");
      await appendHandle.sync();
    } finally {
      if (appendHandle) {
        await appendHandle.close();
      }
    }
  } finally {
    if (lockHandle) {
      await lockHandle.close();
      await unlink(lockPath).catch(() => {});
    }
  }
}
