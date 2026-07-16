import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";

export function normalizeNfcDeep(value) {
  if (typeof value === "string") return value.normalize("NFC");
  if (Array.isArray(value)) return value.map(normalizeNfcDeep);
  if (value && typeof value === "object") {
    const normalized = {};
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.normalize("NFC");
      if (Object.hasOwn(normalized, normalizedKey)) {
        throw new Error(`duplicate object key after NFC normalization: ${normalizedKey}`);
      }
      normalized[normalizedKey] = normalizeNfcDeep(child);
    }
    return normalized;
  }
  return value;
}

export function canonicalJson(value) {
  return canonicalize(normalizeNfcDeep(value));
}

export function sha256Bytes(input) {
  return createHash("sha256").update(input).digest("hex");
}

export function hashCanonical(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
}
