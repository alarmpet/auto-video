// scripts/lib/yadam/name-service.mjs
import { sha256Bytes } from "../pipeline/canonical-json.mjs";

function rankBySeed(records, seed) {
  return records.toSorted((left, right) => {
    const leftRank = sha256Bytes(Buffer.from(`${seed}\0${left.id}`, "utf8"));
    const rightRank = sha256Bytes(Buffer.from(`${seed}\0${right.id}`, "utf8"));
    return leftRank.localeCompare(rightRank) || left.id.localeCompare(right.id);
  });
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function chooseNameCandidates({ references, classId, gender, useCase, seed, count, excludedIds }) {
  const classPool = references.names.pools[classId];
  if (!classPool) {
    throw codedError("name_pool_exhausted", `Class pool not found: ${classId}`);
  }

  let candidates = [];
  if (classId === "noblewoman") {
    candidates = classPool[useCase] || [];
  } else if (classId === "surname") {
    candidates = [
      ...(classPool.easy || []),
      ...(classPool.rare || []),
      ...(classPool.compound || [])
    ];
  } else {
    if (gender && classPool[gender]) {
      candidates = classPool[gender];
    } else {
      candidates = Object.values(classPool).flat();
    }
  }

  const blockedSpoken = new Set((references.names.pools.blocked || []).map(e => e.spokenForm.normalize("NFC")));
  const excludedSet = new Set(excludedIds || []);

  const filtered = candidates.filter(candidate => {
    if (blockedSpoken.has(candidate.spokenForm.normalize("NFC"))) {
      return false;
    }
    if (excludedSet.has(candidate.id)) {
      return false;
    }
    if (gender && gender !== "any" && candidate.gender !== "neutral" && candidate.gender !== "any" && candidate.gender !== gender) {
      return false;
    }
    if (classId !== "noblewoman" && classId !== "surname" && useCase && candidate.useCase !== useCase) {
      return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    throw codedError("name_pool_exhausted", "Name pool exhausted");
  }

  const ranked = rankBySeed(filtered, seed);
  return ranked.slice(0, count);
}

export function assembleCharacterName({ references, givenName, prominence, seed, excludedSurnameIds, allowCompound }) {
  const nameRecord = typeof givenName === "string"
    ? references.names.entries.find(e => e.spokenForm === givenName || e.id === givenName)
    : givenName;

  if (!nameRecord) {
    throw new Error(`givenName not found in entries: ${givenName}`);
  }

  if (!nameRecord.requiresSurname) {
    return {
      givenNameId: nameRecord.id,
      surnameId: null,
      fullIntroName: nameRecord.spokenForm.normalize("NFC"),
      regularSpokenForm: nameRecord.spokenForm.normalize("NFC")
    };
  }

  const easySurnames = references.names.pools.surname?.easy || [];
  const rareSurnames = references.names.pools.surname?.rare || [];
  const compoundSurnames = references.names.pools.surname?.compound || [];

  let allowedSurnames = [];
  if (prominence === "protagonist" || prominence === "major") {
    allowedSurnames = [...easySurnames];
  } else {
    allowedSurnames = [...easySurnames, ...rareSurnames];
  }

  const shouldAllowCompound = allowCompound || nameRecord.allowCompound || nameRecord.allowCompoundSurname;
  if (shouldAllowCompound) {
    allowedSurnames = [...allowedSurnames, ...compoundSurnames];
  }

  const excludedSet = new Set(excludedSurnameIds || []);
  allowedSurnames = allowedSurnames.filter(s => !excludedSet.has(s.id));

  const rankedSurnames = rankBySeed(allowedSurnames, seed);

  let selectedSurname = null;
  for (const s of rankedSurnames) {
    const combined = (s.spokenForm + nameRecord.spokenForm).normalize("NFC");
    if (combined === "변경석" || combined === "명정월" || combined === "방인후") {
      continue;
    }
    selectedSurname = s;
    break;
  }

  if (!selectedSurname) {
    throw codedError("name_pool_exhausted", "No valid surname available");
  }

  return {
    givenNameId: nameRecord.id,
    surnameId: selectedSurname.id,
    fullIntroName: (selectedSurname.spokenForm + nameRecord.spokenForm).normalize("NFC"),
    regularSpokenForm: nameRecord.spokenForm.normalize("NFC")
  };
}
