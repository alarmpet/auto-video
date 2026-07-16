// scripts/test_yadam_reference_data.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const names = await readJson("data/yadam/reference/name-bank.v1.json");
const motifs = await readJson("data/yadam/reference/motif-bank.v1.json");
const beats = await readJson("data/yadam/reference/beat-structure.v1.json");
const rules = await readJson("data/yadam/reference/script-rules.v1.json");

assert.equal(names.schemaVersion, "1.0.0");
assert.equal(names.sources[0].sha256, "decc9b0ba9170070aea3ae8f86a565ce26689388f643c3cf086fabdc54044550");
assert.equal(names.sources[1].sha256, "decc9b0ba9170070aea3ae8f86a565ce26689388f643c3cf086fabdc54044550");
assert.equal(names.pools.noblewoman.public_address.length, 4);
assert.equal(names.pools.noblewoman.taekho.length, 8);
assert.equal(names.pools.noblewoman.legal_given_name.length, 15);
assert.equal(new Set(names.entries.map(({ id }) => id)).size, names.entries.length);

assert.equal(motifs.schemaVersion, "1.0.0");
assert.equal(motifs.sources[0].sha256, "63040be623dee5b271d1d38065171eed98a7774976e91a0c7ae087ed8ed64fb1");
assert.equal(motifs.motifs.length, 40);
assert.deepEqual(motifs.motifs.map(({ ordinal }) => ordinal), Array.from({ length: 40 }, (_, index) => index + 1));

assert.equal(beats.schemaVersion, "1.0.0");
assert.equal(beats.sources.beatChecklistSha256, "0ed5659828eb554649e4a619d4fbc4b4150d75e6d743d90aaef070a3343bbbd5");
assert.equal(beats.sources.introGuideSha256, "09323e2035e4d6794c844d3e97a1a024476b23289995da3538a20cb20c243b20");
assert.deepEqual(beats.beats.map(({ beat }) => beat), Array.from({ length: 15 }, (_, index) => index + 1));
assert.equal(beats.titleSuffix, " | 야담 옛날이야기 민담 전설 설화");
assert.deepEqual(beats.fixedEnding, [
  "다음 영상을 빠르게 만나보시려면 좋아요와 구독을 눌러주세요.",
  "지금 화면에 나오는 더 재미있는 영상들도 함께 해주세요.",
  "그럼 모두 행복한 하루 보내세요. 감사합니다.",
]);
assert.equal(rules.sources.length, 13);
assert.equal(rules.genreElementPools.length > 0, true);
assert.equal(rules.speechRegisters.length > 0, true);
assert.equal(rules.sourceDispositionVersion, "2026-07-16");
console.log("ok - normalized yadam reference data");
