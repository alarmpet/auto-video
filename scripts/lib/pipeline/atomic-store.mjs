import { randomBytes } from "node:crypto";
import { link, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { canonicalJson, sha256Bytes } from "./canonical-json.mjs";

async function writeBytesAtomic(filePath, bytes) {
  const targetPath = resolve(filePath);
  const parent = dirname(targetPath);
  const tempPath = join(
    parent,
    `.${basename(targetPath)}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`
  );
  await mkdir(parent, { recursive: true });
  let handle;
  try {
    handle = await open(tempPath, "wx");
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(tempPath, targetPath);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
  return {
    path: targetPath,
    sha256: sha256Bytes(bytes),
    sizeBytes: bytes.byteLength
  };
}

async function writeBytesExclusive(filePath, bytes) {
  const targetPath = resolve(filePath);
  const parent = dirname(targetPath);
  const tempPath = join(
    parent,
    `.${basename(targetPath)}.exclusive-${process.pid}-${randomBytes(8).toString("hex")}`
  );
  await mkdir(parent, { recursive: true });
  let handle;
  try {
    handle = await open(tempPath, "wx");
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(tempPath, targetPath);
    await rm(tempPath, { force: true });
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(tempPath, { force: true }).catch(() => {});
    if (error.code === "EEXIST") {
      error.code = "immutable_target_exists";
    }
    throw error;
  }
  return {
    path: targetPath,
    sha256: sha256Bytes(bytes),
    sizeBytes: bytes.byteLength
  };
}

export async function writeUtf8Atomic(filePath, text) {
  if (typeof text !== "string") throw new TypeError("text must be a string");
  return writeBytesAtomic(filePath, Buffer.from(text.normalize("NFC"), "utf8"));
}

export async function writeBinaryAtomic(filePath, bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw new TypeError("bytes must be a Buffer or Uint8Array");
  }
  return writeBytesAtomic(filePath, Buffer.from(bytes));
}

export async function writeCanonicalJson(filePath, value) {
  return writeUtf8Atomic(filePath, `${canonicalJson(value)}\n`);
}

export async function writeCanonicalJsonExclusive(filePath, value) {
  return writeBytesExclusive(
    filePath,
    Buffer.from(`${canonicalJson(value)}\n`, "utf8")
  );
}

export async function readJson(filePath) {
  const text = await readFile(resolve(filePath), "utf8");
  if (text.startsWith("\uFEFF")) {
    const error = new Error("JSON must not contain a UTF-8 BOM");
    error.code = "json_bom_not_allowed";
    throw error;
  }
  return JSON.parse(text);
}
