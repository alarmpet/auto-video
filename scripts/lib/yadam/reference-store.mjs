// scripts/lib/yadam/reference-store.mjs
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256Bytes } from "../pipeline/canonical-json.mjs";

const EXPECTED_HASHES = Object.freeze({
  "module/name_bank.md": "decc9b0ba9170070aea3ae8f86a565ce26689388f643c3cf086fabdc54044550",
  "module/prompt_v5.2_sonnet.md": "af2b889f671223e71c002c440387dd23ac7f4d56d89bdc465ba4ffe15226b172",
  "module/대본 sonnet/motif_bank.md": "63040be623dee5b271d1d38065171eed98a7774976e91a0c7ae087ed8ed64fb1",
  "module/대본 sonnet/name_bank.md": "decc9b0ba9170070aea3ae8f86a565ce26689388f643c3cf086fabdc54044550",
  "module/대본 sonnet/scripts.md": "601791acc8de7ea464ef51b0e81b4e6b7ebd6566d1cd3f9b5dcc4832e376e1fc",
  "module/대본 sonnet/v11.3_main_SONNET.md": "c013599c4343cd5aecede2b20783d2ab4c2ca8b049a222be561b8e5b662cfcb5",
  "module/대본 sonnet/부록_양식.md": "f484e9c5e07de7c610dac1f55a42d28d07bc5bb8b79d622081ed76b284be98fe",
  "module/대본 sonnet/참고_비트구조_체크리스트_slim.md": "0ed5659828eb554649e4a619d4fbc4b4150d75e6d743d90aaef070a3343bbbd5",
  "module/대본 sonnet/참고_인트로_제목_가이드_slim.md": "09323e2035e4d6794c844d3e97a1a024476b23289995da3538a20cb20c243b20",
  "module/대본 sonnet/참고_장르별_요소풀_slim.md": "ab8ec00709d181a50551dc1b89115607fb6d43edcb5aff59397630cdb4e8c4a9",
  "module/대본 sonnet/참고_캐릭터_말투_문체_slim.md": "d25c7f0d4f5d0561b8ff42156fce98168ee9160ece1c3a8a9b06d2437e791256",
  "module/시스템프롬프트_Sonnet.txt": "6cad802444c51daf009e9d47de7a140224d01cb4097a3b0bf87cb590a85d4ab9",
  "module/썸네일 프롬프트 (opus) 260601.md": "fe6b08667f91aa17cd7ca29a259c16e2edf927faf6db2e29cdc9f892a1fd0e25",
});

function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Object.isFrozen(obj)) return obj;
  for (const key of Object.getOwnPropertyNames(obj)) {
    deepFreeze(obj[key]);
  }
  return Object.freeze(obj);
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function loadYadamReferences({ rootDir }) {
  const namesPath = join(rootDir, "data/yadam/reference/name-bank.v1.json");
  const motifsPath = join(rootDir, "data/yadam/reference/motif-bank.v1.json");
  const beatsPath = join(rootDir, "data/yadam/reference/beat-structure.v1.json");
  const rulesPath = join(rootDir, "data/yadam/reference/script-rules.v1.json");

  let names, motifs, beats, rules;
  try {
    names = JSON.parse(await readFile(namesPath, "utf8"));
    motifs = JSON.parse(await readFile(motifsPath, "utf8"));
    beats = JSON.parse(await readFile(beatsPath, "utf8"));
    rules = JSON.parse(await readFile(rulesPath, "utf8"));
  } catch (err) {
    throw codedError("reference_integrity_failed", `Failed to read reference files: ${err.message}`);
  }

  // Check schemaVersion
  if (
    names.schemaVersion !== "1.0.0" ||
    motifs.schemaVersion !== "1.0.0" ||
    beats.schemaVersion !== "1.0.0" ||
    rules.schemaVersion !== "1.0.0"
  ) {
    throw codedError("reference_version_unsupported", "Unsupported reference schema version");
  }

  // Integrity checks: counts
  if (motifs.motifs.length !== 40) {
    throw codedError("reference_integrity_failed", "Motifs count drift");
  }
  if (beats.beats.length !== 15) {
    throw codedError("reference_integrity_failed", "Beats count drift");
  }
  if (rules.sources.length !== 13) {
    throw codedError("reference_integrity_failed", "Rules source count drift");
  }

  // Integrity checks: source hashes
  for (const src of rules.sources) {
    const expected = EXPECTED_HASHES[src.path];
    if (!expected || src.sha256 !== expected) {
      throw codedError("reference_integrity_failed", `Source hash drift for ${src.path}`);
    }
  }

  return deepFreeze({ names, motifs, beats, rules });
}
