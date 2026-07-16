import { hashCanonical } from "./canonical-json.mjs";

export function buildSuccessEvidence(stage, inputRecords, outputRecords, opaqueInputs = {}) {
  if (typeof stage !== "string" || stage.trim() === "") {
    throw new Error("stage must be a non-empty string");
  }

  const inputArtifacts = inputRecords.map(rec => {
    if (!rec.artifactId || !rec.logicalRole || !rec.path || !rec.sha256) {
      throw new Error("Invalid input record structure");
    }
    if (!/^[a-f0-9]{64}$/.test(rec.sha256)) {
      throw new Error("Invalid sha256 in input record");
    }
    return {
      artifactId: rec.artifactId,
      logicalRole: rec.logicalRole,
      path: rec.path.replaceAll("\\", "/"),
      sha256: rec.sha256.toLowerCase()
    };
  });

  const outputArtifacts = outputRecords.map(rec => {
    if (!rec.artifactId || !rec.logicalRole || !rec.path || !rec.sha256) {
      throw new Error("Invalid output record structure");
    }
    if (!/^[a-f0-9]{64}$/.test(rec.sha256)) {
      throw new Error("Invalid sha256 in output record");
    }
    return {
      artifactId: rec.artifactId,
      logicalRole: rec.logicalRole,
      path: rec.path.replaceAll("\\", "/"),
      sha256: rec.sha256.toLowerCase()
    };
  });

  const inputKeys = new Set();
  for (const item of inputArtifacts) {
    const key = `${item.logicalRole}::${item.artifactId}`;
    if (inputKeys.has(key)) {
      throw new Error(`Duplicate input logicalRole and artifactId pair: ${key}`);
    }
    inputKeys.add(key);
  }

  const outputKeys = new Set();
  for (const item of outputArtifacts) {
    const key = `${item.path}::${item.artifactId}`;
    if (outputKeys.has(key)) {
      throw new Error(`Duplicate output path and artifactId pair: ${key}`);
    }
    outputKeys.add(key);
  }

  inputArtifacts.sort((a, b) => {
    if (a.logicalRole < b.logicalRole) return -1;
    if (a.logicalRole > b.logicalRole) return 1;
    if (a.artifactId < b.artifactId) return -1;
    if (a.artifactId > b.artifactId) return 1;
    return 0;
  });

  outputArtifacts.sort((a, b) => {
    if (a.path < b.path) return -1;
    if (a.path > b.path) return 1;
    if (a.artifactId < b.artifactId) return -1;
    if (a.artifactId > b.artifactId) return 1;
    return 0;
  });

  if (typeof opaqueInputs !== "object" || opaqueInputs === null || Array.isArray(opaqueInputs)) {
    throw new Error("opaqueInputs must be a plain object");
  }
  const sortedOpaqueInputs = {};
  const opaqueKeys = Object.keys(opaqueInputs).sort();
  for (const key of opaqueKeys) {
    if (!/^[a-z][A-Za-z0-9]*Hash$/.test(key)) {
      throw new Error(`Invalid opaque input key format: ${key}`);
    }
    const val = opaqueInputs[key];
    if (typeof val !== "string" || !/^[a-f0-9]{64}$/.test(val)) {
      throw new Error(`Invalid opaque input hash value for key ${key}: ${val}`);
    }
    sortedOpaqueInputs[key] = val.toLowerCase();
  }

  const inputHash = hashCanonical({
    schemaVersion: "1.0.0",
    eventStage: stage,
    inputArtifacts,
    opaqueInputs: sortedOpaqueInputs,
  });

  const outputHash = hashCanonical({
    schemaVersion: "1.0.0",
    eventStage: stage,
    inputHash,
    outputArtifacts,
  });

  const artifactPaths = outputArtifacts.map(({ path }) => path);

  return {
    inputHash,
    outputHash,
    artifactPaths
  };
}
