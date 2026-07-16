import { join, dirname, resolve } from "node:path";
import { readJson, writeCanonicalJson } from "./atomic-store.mjs";
import { validateSchema } from "./schema-registry.mjs";
import { acquireLock, releaseLock } from "./state-machine.mjs";

export async function invalidateFromChanges(jobDir, changedArtifactIds) {
  const leaseId = await acquireLock(jobDir);
  try {
    const manifestPath = join(jobDir, "artifact-manifest.json");
    const manifest = await readJson(manifestPath);

    const reverseEdges = new Map();
    for (const consumer of manifest.artifacts) {
      const kinds = consumer.dependencyKinds || {};
      const owners = consumer.dependencyOwners || {};
      const hashes = consumer.dependencyHashes || {};
      for (const [depId, kind] of Object.entries(kinds)) {
        if (kind === "artifact") {
          const depHash = hashes[depId];
          const ownerIds = owners[depId] || [];
          if (ownerIds.length === 0) {
            const err = new Error(`owner missing for artifact dependency ${depId}`);
            err.code = "artifact_dependency_owner_missing";
            throw err;
          }
          for (const ownerId of ownerIds) {
            const ownerArt = manifest.artifacts.find(a => a.artifactId === ownerId);
            if (!ownerArt) {
              const err = new Error(`owner ${ownerId} does not exist`);
              err.code = "artifact_dependency_owner_missing";
              throw err;
            }
            const ownsHash = (ownerArt.sha256 === depHash) || 
                             (ownerArt.history && ownerArt.history.some(h => h.sha256 === depHash));
            if (!ownsHash) {
              const err = new Error(`owner ${ownerId} does not own hash ${depHash}`);
              err.code = "artifact_dependency_owner_missing";
              throw err;
            }

            if (!reverseEdges.has(ownerId)) {
              reverseEdges.set(ownerId, new Set());
            }
            reverseEdges.get(ownerId).add(consumer.artifactId);
          }
        }
      }
    }

    const queue = [...changedArtifactIds];
    const invalidatedSet = new Set();
    const invalidatedBy = new Map();

    for (const id of changedArtifactIds) {
      invalidatedBy.set(id, new Set([id]));
    }

    while (queue.length > 0) {
      const currentId = queue.shift();
      const currentRoots = invalidatedBy.get(currentId) || new Set();

      const consumers = reverseEdges.get(currentId);
      if (consumers) {
        for (const consumerId of consumers) {
          if (changedArtifactIds.includes(consumerId)) continue;

          let isNew = false;
          if (!invalidatedBy.has(consumerId)) {
            invalidatedBy.set(consumerId, new Set());
            isNew = true;
          }
          const consumerRoots = invalidatedBy.get(consumerId);
          let rootsChanged = false;
          for (const r of currentRoots) {
            if (!consumerRoots.has(r)) {
              consumerRoots.add(r);
              rootsChanged = true;
            }
          }

          if (isNew || rootsChanged) {
            invalidatedSet.add(consumerId);
            queue.push(consumerId);
          }
        }
      }
    }

    for (const artId of invalidatedSet) {
      const art = manifest.artifacts.find(a => a.artifactId === artId);
      if (art) {
        art.gateStatus = "invalidated";
        art.invalidatedBy = [...invalidatedBy.get(artId)].sort();
      }
    }

    const workspaceRoot = dirname(dirname(resolve(jobDir)));
    const schemaPath = join(workspaceRoot, "schemas", "pipeline", "artifact-manifest.schema.json");
    await validateSchema(schemaPath, manifest);

    await writeCanonicalJson(manifestPath, manifest);

    return manifest;
  } finally {
    await releaseLock(jobDir, leaseId);
  }
}
