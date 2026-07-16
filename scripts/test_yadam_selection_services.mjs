// scripts/test_yadam_selection_services.mjs
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadYadamReferences } from "./lib/yadam/reference-store.mjs";
import { chooseNameCandidates, assembleCharacterName } from "./lib/yadam/name-service.mjs";
import { chooseMotifs } from "./lib/yadam/motif-service.mjs";
import { readRecentStoryFingerprints, appendCompletedStoryFingerprint, validateFingerprint } from "./lib/yadam/history-store.mjs";

const rootDir = "C:/Users/petbl/auto-video";
const references = await loadYadamReferences({ rootDir });

// Verify loaded reference structures
assert.equal(references.names.schemaVersion, "1.0.0");
assert.equal(references.motifs.schemaVersion, "1.0.0");

// 1. Repeatability (Deterministic selection)
const seed = "job-yadam-001";
const count = 3;

const names1 = chooseNameCandidates({
  references,
  classId: "noblewoman",
  gender: "female",
  useCase: "legal_given_name",
  seed,
  count,
  excludedIds: []
});
const names2 = chooseNameCandidates({
  references,
  classId: "noblewoman",
  gender: "female",
  useCase: "legal_given_name",
  seed,
  count,
  excludedIds: []
});
assert.deepEqual(names1.map(n => n.id), names2.map(n => n.id));

const motifs1 = chooseMotifs({
  references,
  seed,
  count,
  recentFingerprints: []
});
const motifs2 = chooseMotifs({
  references,
  seed,
  count,
  recentFingerprints: []
});
assert.deepEqual(motifs1.map(m => m.id), motifs2.map(m => m.id));

// 2. Draws only from matching pools for noblewoman
const noblewomanAddresses = chooseNameCandidates({
  references,
  classId: "noblewoman",
  gender: "female",
  useCase: "public_address",
  seed,
  count: 4,
  excludedIds: []
});
assert.equal(noblewomanAddresses.every(n => n.useCase === "public_address"), true);

const noblewomanTaekho = chooseNameCandidates({
  references,
  classId: "noblewoman",
  gender: "female",
  useCase: "taekho",
  seed,
  count: 8,
  excludedIds: []
});
assert.equal(noblewomanTaekho.every(n => n.useCase === "taekho"), true);

const noblewomanGiven = chooseNameCandidates({
  references,
  classId: "noblewoman",
  gender: "female",
  useCase: "legal_given_name",
  seed,
  count: 15,
  excludedIds: []
});
assert.equal(noblewomanGiven.every(n => n.useCase === "legal_given_name"), true);

// 3. Name pool exhaustion
assert.throws(
  () => chooseNameCandidates({
    references,
    classId: "noblewoman",
    gender: "female",
    useCase: "legal_given_name",
    seed: "job-yadam-001",
    count: 1,
    excludedIds: references.names.pools.noblewoman.legal_given_name.map(({ id }) => id),
  }),
  (error) => error.code === "name_pool_exhausted",
);

// 4. assembleCharacterName rules
// Protagonist / Major receives only easy-surname
const easyGiven = references.names.pools.commoner.female[0];
const charNameProtagonist = assembleCharacterName({
  references,
  givenName: easyGiven,
  prominence: "protagonist",
  seed,
  excludedSurnameIds: []
});
const chosenSurname = references.names.entries.find(e => e.id === charNameProtagonist.surnameId);
assert.equal(chosenSurname.difficulty, "easy");
assert.equal(charNameProtagonist.fullIntroName.normalize("NFC"), charNameProtagonist.fullIntroName);
assert.equal(charNameProtagonist.regularSpokenForm, easyGiven.spokenForm);

// noblewoman taekho receives no surname
const taekhoRecord = references.names.pools.noblewoman.taekho[0];
const charNameTaekho = assembleCharacterName({
  references,
  givenName: taekhoRecord,
  prominence: "protagonist",
  seed,
  excludedSurnameIds: []
});
assert.equal(charNameTaekho.surnameId, null);
assert.equal(charNameTaekho.fullIntroName, taekhoRecord.spokenForm);

// royal receives no surname
const royalRecord = references.names.pools.royal.female[0];
const charNameRoyal = assembleCharacterName({
  references,
  givenName: royalRecord,
  prominence: "protagonist",
  seed,
  excludedSurnameIds: []
});
assert.equal(charNameRoyal.surnameId, null);

// Excluded surnames are not reused
const charNameProtagonist2 = assembleCharacterName({
  references,
  givenName: easyGiven,
  prominence: "protagonist",
  seed,
  excludedSurnameIds: [charNameProtagonist.surnameId]
});
assert.notEqual(charNameProtagonist.surnameId, charNameProtagonist2.surnameId);

// 5. History store testing
const tempDir = await mkdtemp(join(tmpdir(), "yadam-history-test-"));
const historyPath = join(tempDir, "history.jsonl");

try {
  const fakeFingerprints = [];
  for (let i = 1; i <= 23; i++) {
    const padded = String(i).padStart(3, "0");
    const completedAt = new Date(1781600000000 + i * 1000).toISOString();
    fakeFingerprints.push({
      jobId: `job-yadam-${padded}`,
      completedAt,
      nameIds: [`name:commoner:female:${padded}`],
      motifIds: [`motif:m${String((i % 40) + 1).padStart(2, "0")}`],
      twistCategories: ["초자연"],
      themeLine: `Theme ${i}`,
      titleFingerprint: "a".repeat(64)
    });
  }

  // Write all 23 to history file
  const lines = fakeFingerprints.map(fp => JSON.stringify(fp)).join("\n") + "\n";
  await writeFile(historyPath, lines, "utf8");

  // Read back - should return only 4-23 (the newest 20 in chronological order)
  const recent = await readRecentStoryFingerprints(historyPath, 20);
  assert.equal(recent.length, 20);
  assert.equal(recent[0].jobId, "job-yadam-004");
  assert.equal(recent[19].jobId, "job-yadam-023");

  // Verify chronological order (oldest first among the 20)
  for (let i = 1; i < recent.length; i++) {
    assert.ok(Date.parse(recent[i].completedAt) >= Date.parse(recent[i - 1].completedAt));
  }

  // Verify motif selection excludes motifs used in those 20
  const recentMotifIds = recent.flatMap(fp => fp.motifIds);
  const selectedMotifs = chooseMotifs({
    references,
    seed,
    count: 2,
    recentFingerprints: recent
  });
  for (const m of selectedMotifs) {
    assert.equal(recentMotifIds.includes(m.id), false);
  }

} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log("ok - deterministic yadam selection services");
