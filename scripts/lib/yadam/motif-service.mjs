// scripts/lib/yadam/motif-service.mjs
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

export function chooseMotifs({ references, seed, count, recentFingerprints }) {
  const excludedIds = new Set((recentFingerprints || []).flatMap(fp => fp.motifIds || []));
  const filtered = (references.motifs?.motifs || []).filter(m => !excludedIds.has(m.id));

  if (filtered.length === 0) {
    throw codedError("motif_pool_exhausted", "Motif pool exhausted");
  }

  const ranked = rankBySeed(filtered, seed);

  const selected = [];
  const selectedCategories = new Set();

  // First pass: take the first ranked motif for each distinct category
  for (const motif of ranked) {
    if (selected.length >= count) break;
    if (!selectedCategories.has(motif.category)) {
      selected.push(motif);
      selectedCategories.add(motif.category);
    }
  }

  // Second pass: fill remaining slots from the stable ranking of unselected motifs
  for (const motif of ranked) {
    if (selected.length >= count) break;
    if (!selected.some(s => s.id === motif.id)) {
      selected.push(motif);
    }
  }

  return selected;
}
