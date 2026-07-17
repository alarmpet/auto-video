import { createReadStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { hashCanonical } from "../../pipeline/canonical-json.mjs";

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export async function loadImageStackLock(workspaceRoot) {
  const path = resolve(workspaceRoot, "config/model-locks/yadam-sdxl-ipadapter-v1.json");
  const lock = JSON.parse(await readFile(path, "utf8"));
  if (lock.schemaVersion !== "1.0.0" || lock.stackId !== "yadam-sdxl-ipadapter-v1") {
    throw Object.assign(new Error("invalid image stack lock"), { code: "invalid_image_stack_lock" });
  }
  return deepFreeze({ ...lock, modelLockHash: hashCanonical(lock) });
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifyLockedFile(filePath, entry) {
  const info = await stat(filePath).catch(() => null);
  if (!info) throw Object.assign(new Error(`missing locked file: ${filePath}`), { code: "locked_file_missing" });
  if (info.size !== entry.sizeBytes) throw Object.assign(new Error(`size mismatch: ${filePath}`), { code: "locked_file_size_mismatch" });
  const actual = await sha256File(filePath);
  if (actual !== entry.sha256) throw Object.assign(new Error(`hash mismatch: ${filePath}`), { code: "locked_file_hash_mismatch", actual });
  return { path: resolve(filePath), sizeBytes: info.size, sha256: actual };
}
