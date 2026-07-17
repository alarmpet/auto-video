import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import YAML from "yaml";
import { sha256File, verifyLockedFile } from "./model-lock.mjs";

const REQUIRED_CONFIRMATION = "INSTALL_YADAM_IMAGE_STACK";

async function exists(path) {
  return access(path).then(() => true, () => false);
}

export async function inspectHostInstallation({ hostConfig, lock, spawnImpl = spawn }) {
  let customNodeCommit = null;
  let customNodeStatus = "custom_node_missing";
  if (await exists(lock.customNode.targetPath)) {
    customNodeCommit = await spawnChecked("git", ["-C", lock.customNode.targetPath, "rev-parse", "HEAD"], {}, spawnImpl).then(result => result.stdout.trim(), () => null);
    customNodeStatus = customNodeCommit === lock.customNode.commit ? "pass" : "custom_node_commit_mismatch";
  }
  const checkpoint = await verifyLockedFile(lock.checkpoint.path, lock.checkpoint).then(() => "pass", error => error.code);
  const clipVision = await verifyLockedFile(lock.models.clipVision.targetPath, lock.models.clipVision).then(() => "pass", error => error.code);
  const ipAdapter = await verifyLockedFile(lock.models.ipAdapter.targetPath, lock.models.ipAdapter).then(() => "pass", error => error.code);
  let ambiguous = false;
  if (await exists(lock.legacyMigration.extraModelPaths)) {
    const yamlText = await readFile(lock.legacyMigration.extraModelPaths, "utf8");
    const parsed = YAML.parse(yamlText);
    ambiguous = parsed?.hermes?.checkpoints === "." || parsed?.hermes?.loras === ".";
  }
  return {
    customNodeCommit,
    customNodeStatus,
    checkpoint,
    clipVision,
    ipAdapter,
    ambiguousExtraModelPaths: ambiguous,
    ready: customNodeStatus === "pass" && checkpoint === "pass" && clipVision === "pass" && ipAdapter === "pass" && !ambiguous
  };
}

async function downloadLockedModel(entry, authorizedModelRoot, fetchImpl = fetch) {
  const relativeTarget = relative(resolve(authorizedModelRoot), resolve(entry.targetPath));
  if (isAbsolute(relativeTarget) || relativeTarget === ".." || relativeTarget.startsWith(`..${sep}`)) {
    throw Object.assign(new Error("model target outside authorized root"), { code: "model_target_unsafe" });
  }
  if (await exists(entry.targetPath)) return verifyLockedFile(entry.targetPath, entry);
  await mkdir(dirname(entry.targetPath), { recursive: true });
  const part = `${entry.targetPath}.part`;
  if (resolve(part) !== resolve(`${entry.targetPath}.part`) || dirname(resolve(part)) !== dirname(resolve(entry.targetPath))) {
    throw Object.assign(new Error("unsafe model partial path"), { code: "model_part_path_unsafe" });
  }
  await rm(part, { force: true, recursive: false });
  const response = await fetchImpl(entry.url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw Object.assign(new Error(`download failed: ${response.status}`), { code: "model_download_failed" });
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > entry.sizeBytes) {
    throw Object.assign(new Error("model response exceeds locked size"), { code: "model_download_oversized" });
  }
  let received = 0;
  const { Transform } = await import("node:stream");
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      if (received > entry.sizeBytes) {
        callback(Object.assign(new Error("model response exceeds locked size"), { code: "model_download_oversized" }));
      } else {
        callback(null, chunk);
      }
    }
  });
  try {
    const fs = await import("node:fs");
    await pipeline(Readable.fromWeb(response.body), limiter, fs.createWriteStream(part, { flags: "wx" }));
    await verifyLockedFile(part, entry);
    await rename(part, entry.targetPath);
  } catch (error) {
    await rm(part, { force: true, recursive: false });
    throw error;
  }
  return verifyLockedFile(entry.targetPath, entry);
}

function spawnChecked(executable, args, options, spawnImpl = spawn) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawnImpl(executable, args, { ...options, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    const collect = (target, chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > 1024 * 1024) {
        child.kill();
        rejectPromise(Object.assign(new Error("git output exceeded 1 MiB"), { code: "git_output_limit" }));
        return target;
      }
      return target + chunk.toString("utf8");
    };
    child.stdout?.on("data", chunk => { stdout = collect(stdout, chunk); });
    child.stderr?.on("data", chunk => { stderr = collect(stderr, chunk); });
    child.once("error", rejectPromise);
    child.once("exit", code => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
      } else {
        rejectPromise(Object.assign(new Error(stderr.trim() || `exit ${code}`), { code: "git_install_failed" }));
      }
    });
  });
}

async function installCustomNode(entry, spawnImpl = spawn) {
  if (await exists(entry.targetPath)) {
    const result = await spawnChecked("git", ["-C", entry.targetPath, "rev-parse", "HEAD"], {}, spawnImpl);
    const actualCommit = result.stdout.trim();
    if (actualCommit !== entry.commit) {
      throw Object.assign(new Error(`custom node commit mismatch: ${actualCommit}`), { code: "custom_node_commit_mismatch" });
    }
    return { path: entry.targetPath, commit: actualCommit, reused: true };
  }
  const temp = `${entry.targetPath}.tmp`;
  await rm(temp, { recursive: true, force: true });
  await mkdir(dirname(entry.targetPath), { recursive: true });
  try {
    await spawnChecked("git", ["clone", "--no-checkout", entry.gitUrl, temp], {}, spawnImpl);
    await spawnChecked("git", ["-C", temp, "checkout", "--detach", entry.commit], {}, spawnImpl);
    const result = await spawnChecked("git", ["-C", temp, "rev-parse", "HEAD"], {}, spawnImpl);
    if (result.stdout.trim() !== entry.commit) {
      throw Object.assign(new Error("checked out custom node commit does not match lock"), { code: "custom_node_commit_mismatch" });
    }
    await rename(temp, entry.targetPath);
    return { path: entry.targetPath, commit: entry.commit, reused: false };
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
}

async function migrateLegacyPaths(lock) {
  const migration = lock.legacyMigration;
  const actualInputHash = await sha256File(migration.extraModelPaths);
  const yamlText = await readFile(migration.extraModelPaths, "utf8");
  const config = YAML.parse(yamlText);
  const isExpectedPollution = config?.hermes?.base_path === "C:/Users/petbl/hermes_models" && config?.hermes?.checkpoints === "." && config?.hermes?.loras === ".";
  if (!isExpectedPollution && config?.hermes === undefined) return { legacyLorasCopied: 0, changed: false };
  if (!isExpectedPollution || actualInputHash !== migration.acceptedInputSha256) {
    throw Object.assign(new Error("extra_model_paths.yaml does not match the audited migration input"), { code: "extra_model_paths_unexpected" });
  }
  const comfyRoot = dirname(migration.extraModelPaths);
  const nativeLoraDir = join(comfyRoot, "models", "loras");
  await mkdir(nativeLoraDir, { recursive: true });
  let copied = 0;
  for (const entry of migration.legacyLoras) {
    const source = join(migration.legacyRoot, entry.filename);
    const target = join(nativeLoraDir, entry.filename);
    await verifyLockedFile(source, entry);
    if (!(await exists(target))) {
      await copyFile(source, target);
      copied += 1;
    }
    await verifyLockedFile(target, entry);
  }
  const backup = `${migration.extraModelPaths}.yadam-${actualInputHash}.bak`;
  if (!(await exists(backup))) await copyFile(migration.extraModelPaths, backup);
  delete config.hermes;
  const temp = `${migration.extraModelPaths}.tmp`;
  await writeFile(temp, YAML.stringify(config), "utf8");
  await rename(temp, migration.extraModelPaths);
  return { legacyLorasCopied: copied, changed: true, backup };
}

export async function applyHostInstallation({ hostConfig, lock, confirmation, fetchImpl = fetch, spawnImpl = spawn, installModels = true, installCustomNode: shouldInstallNode = true }) {
  if (confirmation !== REQUIRED_CONFIRMATION) {
    throw Object.assign(new Error("external image stack changes require confirmation"), { code: "external_change_confirmation_required" });
  }
  const migration = await migrateLegacyPaths(lock);
  if (installModels) {
    const authorizedModelRoot = join(hostConfig.comfyui.portableRoot, "ComfyUI", "models");
    await downloadLockedModel(lock.models.clipVision, authorizedModelRoot, fetchImpl);
    await downloadLockedModel(lock.models.ipAdapter, authorizedModelRoot, fetchImpl);
  }
  if (shouldInstallNode) await installCustomNode(lock.customNode, spawnImpl);
  const report = await inspectHostInstallation({ hostConfig, lock, spawnImpl });
  return { ...report, ...migration, restartRequired: true };
}
