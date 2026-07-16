import { readFile } from "node:fs/promises";
import { join, resolve, relative, dirname } from "node:path";
import { readJson, writeCanonicalJson } from "./atomic-store.mjs";
import { sha256Bytes } from "./canonical-json.mjs";
import { assertRealPathWithin } from "./path-policy.mjs";
import { validateSchema } from "./schema-registry.mjs";
import { acquireLock, releaseLock } from "./state-machine.mjs";

export async function registerArtifact(jobDir, record) {
  const leaseId = await acquireLock(jobDir);
  try {
    const manifestPath = join(jobDir, "artifact-manifest.json");
    const manifest = await readJson(manifestPath);

    const resolvedPath = resolve(join(jobDir, record.path));
    await assertRealPathWithin(jobDir, resolvedPath);

    const fileBytes = await readFile(resolvedPath);
    const computedHash = sha256Bytes(fileBytes);
    if (computedHash.toLowerCase() !== record.sha256.toLowerCase()) {
      const err = new Error(`artifact hash mismatch for ${record.artifactId}`);
      err.code = "artifact_hash_mismatch";
      throw err;
    }

    const dependencyKinds = {};
    const dependencyOwners = {};
    const depHashes = record.dependencyHashes || {};
    for (const [depId, depHash] of Object.entries(depHashes)) {
      const matchingOwners = [];
      for (const art of manifest.artifacts) {
        let match = false;
        if (art.sha256.toLowerCase() === depHash.toLowerCase()) {
          match = true;
        } else if (art.history) {
          for (const h of art.history) {
            if (h.sha256.toLowerCase() === depHash.toLowerCase()) {
              match = true;
              break;
            }
          }
        }
        if (match) {
          matchingOwners.push(art.artifactId);
        }
      }

      if (matchingOwners.length > 0) {
        dependencyKinds[depId] = "artifact";
        dependencyOwners[depId] = [...matchingOwners].sort();
      } else {
        dependencyKinds[depId] = "opaque";
      }
    }

    const relPath = relative(jobDir, resolvedPath).replaceAll("\\", "/");
    const existingIndex = manifest.artifacts.findIndex(a => a.artifactId === record.artifactId);
    
    let history = [];
    if (existingIndex !== -1) {
      const existing = manifest.artifacts[existingIndex];
      const historyItem = {
        path: existing.path,
        sha256: existing.sha256,
        schemaVersion: existing.schemaVersion,
        producerStage: existing.producerStage,
        gateStatus: existing.gateStatus,
        dependencyHashes: existing.dependencyHashes,
        dependencyKinds: existing.dependencyKinds,
        dependencyOwners: existing.dependencyOwners,
        replacedAt: new Date().toISOString()
      };
      if (existing.invalidatedBy) {
        historyItem.invalidatedBy = existing.invalidatedBy;
      }
      history = existing.history || [];
      history.push(historyItem);
      manifest.artifacts.splice(existingIndex, 1);
    }

    const newArtifact = {
      artifactId: record.artifactId,
      logicalRole: record.logicalRole,
      path: relPath,
      sha256: record.sha256.toLowerCase(),
      schemaVersion: record.schemaVersion || "1.0.0",
      producerStage: record.producerStage,
      gateStatus: record.gateStatus || "pending",
      dependencyHashes: depHashes,
      dependencyKinds,
      dependencyOwners,
      history
    };

    manifest.artifacts.push(newArtifact);

    const workspaceRoot = dirname(dirname(resolve(jobDir)));
    const schemaPath = join(workspaceRoot, "schemas", "pipeline", "artifact-manifest.schema.json");
    await validateSchema(schemaPath, manifest);

    await writeCanonicalJson(manifestPath, manifest);

    return newArtifact;
  } finally {
    await releaseLock(jobDir, leaseId);
  }
}

export async function canReuseArtifact(jobDir, artifactId, dependencyHashes) {
  const manifestPath = join(jobDir, "artifact-manifest.json");
  let manifest;
  try {
    manifest = await readJson(manifestPath);
  } catch (err) {
    return false;
  }

  const art = manifest.artifacts.find(a => a.artifactId === artifactId);
  if (!art) return false;

  if (art.gateStatus !== "pass") return false;

  const resolvedPath = resolve(join(jobDir, art.path));
  try {
    await assertRealPathWithin(jobDir, resolvedPath);
    const content = await readFile(resolvedPath);
    const currentHash = sha256Bytes(content);
    if (currentHash.toLowerCase() !== art.sha256.toLowerCase()) return false;
  } catch (err) {
    return false;
  }

  const storedDeps = art.dependencyHashes || {};
  const storedKeys = Object.keys(storedDeps).sort();
  const callerKeys = Object.keys(dependencyHashes).sort();
  if (JSON.stringify(storedKeys) !== JSON.stringify(callerKeys)) return false;

  for (const k of storedKeys) {
    if (storedDeps[k].toLowerCase() !== dependencyHashes[k].toLowerCase()) return false;
  }

  const kinds = art.dependencyKinds || {};
  const owners = art.dependencyOwners || {};
  for (const [depId, kind] of Object.entries(kinds)) {
    const expectedHash = storedDeps[depId];
    if (kind === "artifact") {
      const ownerIds = owners[depId] || [];
      if (ownerIds.length === 0) return false;
      let ownerMatched = false;
      for (const ownerId of ownerIds) {
        const ownerArt = manifest.artifacts.find(a => a.artifactId === ownerId);
        if (ownerArt && ownerArt.sha256.toLowerCase() === expectedHash.toLowerCase()) {
          ownerMatched = true;
          break;
        }
      }
      if (!ownerMatched) return false;
    }
  }

  return true;
}
