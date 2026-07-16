# Codex Yadam Script and Approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete yadam planning, script, validation, and two-formal-approval service on top of Plan 01 so later TTS, image, and FFmpeg plans consume stable JSON, hashes, source spans, and revision-safe APIs.

**Architecture:** Normalize the legacy Markdown rule pack into versioned runtime data, then let a narrow Node.js service orchestrate stage-specific Codex calls and deterministic local validators. `script-scenes.json` is the machine script source of truth, `final.txt` is its deterministic UTF-8 rendering, and append-only approval revisions bind exact artifact hashes. Plan 02 stops at approved planning/script artifacts and exposes explicit TTS, visual-planning, coverage, and duration-repair APIs to Plans 03–06.

**Tech Stack:** Node.js 22.16.0 ES modules, built-in `node:assert/strict`, built-in `node:crypto`, JSON Schema consumed by Codex CLI 0.144.0-alpha.4 through Plan 01, UTF-8 NFC JSON/text artifacts, existing Markdown sources under `module/`.

## Global Constraints

- Preserve `gguljam-bible`; every new runtime module and artifact in this plan is scoped to profile `yadam`.
- Do not modify or delete any file under `module/`; normalize it into generated, versioned data under `data/yadam/reference/`.
- Accept `targetMinutes` only from 10 through 120 inclusive and only in 10-minute increments.
- Keep exactly two formal approval types. Candidate and thumbnail-copy choices are provisional selections, not formal approvals.
- Store formal approvals as append-only `approval-1-rNNN.json` and `approval-2-rNNN.json`; maintain atomic `current-approval-1.json` and `current-approval-2.json` pointers.
- If post-approval TTS duration repair changes any approved script hash, invalidate approval 2, rebuild its bundle, and require a new approval-2 revision before production continues.
- Permit one automatic semantic hard-gate repair per artifact revision and one automatic duration repair per job; exhaustion transitions to `needs_review`.
- Treat `script/script-scenes.json` as the machine source of truth and render `script/final.txt` deterministically as UTF-8 without BOM, NFC, LF-only, two LF bytes between scenes, and exactly one terminal LF.
- Define all source spans as half-open UTF-8 byte ranges `[startByte, endByteExclusive)` into canonical `final.txt`; never use JavaScript UTF-16 offsets as persisted source spans.
- Preserve all 15 beats, exactly six twists, exactly six emotional points, the three theme placements, planted/recovered foreshadowing, five finale stages, and the exact three-sentence ending.
- Use the fixed title suffix ` | 야담 옛날이야기 민담 전설 설화`.
- Use the same six-sentence 200–350-character story-intro contract for every requested duration; mark sentence 6 as CTA.
- Count intro characters as `Array.from(introText.normalize("NFC")).length`, including spaces and punctuation; sentence count comes from the six schema objects, not punctuation guessing.
- Runtime name selection reads normalized data only. It never parses Markdown, never invents a name when a pool is exhausted, and produces identical ordering for identical seed and input.
- Recent-history filtering uses the last 20 completed yadam jobs and records name IDs, motif IDs, twist categories, theme line, and title fingerprint.
- Codex runs in Plan 01's read-only, approval-never execution boundary. The orchestrator writes canonical artifacts only after local schema and hard-gate success.
- Before any artifact read, resolve the registry `path` against `jobDir`, reject absolute/traversal paths, verify containment, then verify bytes against the registered hash.
- All commands in this plan run from `C:\Users\petbl\auto-video` in PowerShell.
- The workspace is not currently a Git repository. Commit steps are mandatory once the user initializes Git; before that, run the shown `git status --short` command and record `SKIP: not a git repository` in the execution log without initializing Git implicitly.

Valid current pointers have `{schemaVersion:"1.0.0",status:"valid",revision,path,sha256,approvedArtifactSetHash}`. Invalidation never edits or deletes an immutable approval revision; it atomically replaces only the current pointer with `{schemaVersion:"1.0.0",status:"invalidated",revision,path,sha256,approvedArtifactSetHash,invalidatedAt,reason,observedDependencyHash}`. All approval readers require `status:"valid"`.

---

## Legacy Source Disposition

Every file under `module/` has one explicit destination; none is silently copied into a giant runtime prompt.

| Source file | Plan 02 use | Result |
|---|---|---|
| `module/name_bank.md` | canonical naming source | normalized name data; byte identity checked against the nested copy |
| `module/대본 sonnet/name_bank.md` | duplicate naming source | hash equality guard only; divergence is a build failure |
| `module/대본 sonnet/motif_bank.md` | 40 story engine motifs | stable motif IDs, categories, mutation axes, history fingerprints |
| `module/대본 sonnet/v11.3_main_SONNET.md` | workflow, counts, evidence, continuity | distilled into stage prompts, schemas, script rules, and local gates; obsolete fixed-duration tables are excluded |
| `module/대본 sonnet/scripts.md` | intended validator/name-picker behavior | regression-test source only; its permissive checks and noblewoman parsing bug are not copied |
| `module/대본 sonnet/부록_양식.md` | human handoff fields | typed approval-bundle views rendered from canonical JSON, never a second source of truth |
| `module/대본 sonnet/참고_비트구조_체크리스트_slim.md` | beat, foreshadow, finale, ending rules | 15 stable beats and exact evidence/ending contracts |
| `module/대본 sonnet/참고_인트로_제목_가이드_slim.md` | intro/title rules | six-sentence hook, CTA mark, fixed title suffix, title slot rules |
| `module/대본 sonnet/참고_장르별_요소풀_slim.md` | genre-specific ingredients | normalized genre element pools passed to concept generation |
| `module/대본 sonnet/참고_캐릭터_말투_문체_slim.md` | speech/address/prose rules | normalized registers and style constraints used by story bible, drafting, and QA |
| `module/시스템프롬프트_Sonnet.txt` | legacy image system behavior | Plan 04 input audit; Plan 02 only carries character/location/prop IDs and spoiler seals |
| `module/prompt_v5.2_sonnet.md` | legacy visual prompt workflow | Plan 04 compiler input audit; Plan 02 supplies source-grounded scene planning JSON |
| `module/썸네일 프롬프트 (opus) 260601.md` | thumbnail copy/background/composition behavior | Plan 02 keeps copy/layout/spoiler contracts; Plan 04 owns background generation, compositor, and pixel QA |

The Task 1 build records the lowercase SHA-256 of all 13 files. If any source changes, `--check` fails and forces a deliberate reference-data/prompt/schema review instead of silently changing production behavior.

---

## Task 1: Normalize the immutable legacy reference pack

**Files:**
- Create: `scripts/test_yadam_reference_data.mjs`
- Create: `scripts/build_yadam_reference_data.mjs`
- Create: `data/yadam/reference/name-bank.v1.json`
- Create: `data/yadam/reference/motif-bank.v1.json`
- Create: `data/yadam/reference/beat-structure.v1.json`
- Create: `data/yadam/reference/script-rules.v1.json`
- Read only: `module/name_bank.md`
- Read only: `module/대본 sonnet/name_bank.md`
- Read only: `module/대본 sonnet/motif_bank.md`
- Read only: `module/대본 sonnet/참고_비트구조_체크리스트_slim.md`
- Read only: `module/대본 sonnet/참고_인트로_제목_가이드_slim.md`
- Read only: `module/대본 sonnet/scripts.md`
- Read only: `module/대본 sonnet/v11.3_main_SONNET.md`
- Read only: `module/대본 sonnet/부록_양식.md`
- Read only: `module/대본 sonnet/참고_장르별_요소풀_slim.md`
- Read only: `module/대본 sonnet/참고_캐릭터_말투_문체_slim.md`
- Read only: `module/시스템프롬프트_Sonnet.txt`
- Read only: `module/prompt_v5.2_sonnet.md`
- Read only: `module/썸네일 프롬프트 (opus) 260601.md`

**Interfaces:**
- Produces four committed JSON reference files with `schemaVersion: "1.0.0"`, NFC strings, stable IDs, source path, and lowercase source SHA-256.
- Produces CLI modes `--write` and `--check`; `--check` exits 1 when generated bytes differ from committed bytes.
- The normalizer is development-time tooling. No runtime module may import it or read Markdown.

- [ ] **Step 1 (3 minutes): Write the reference regression test.**

Create the full test below. It checks the source identity, the noblewoman rows that the legacy picker skipped, all 40 motifs, all 15 beats, the title suffix, and every fixed ending sentence.

```js
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
```

- [ ] **Step 2 (2 minutes): Run the test and confirm the expected red state.**

Run:

```powershell
node scripts/test_yadam_reference_data.mjs
```

Expected: exit code 1 and `ENOENT` for `data/yadam/reference/name-bank.v1.json`.

- [ ] **Step 3 (5 minutes): Implement the name-bank parser and stable-ID rules.**

In `scripts/build_yadam_reference_data.mjs`, import Plan 01 `canonicalJson`, `sha256Bytes`, and `writeCanonicalJson`; otherwise use Node built-ins only. Fail before parsing if any entry in this exact source lock differs:

```js
const SOURCE_LOCK = Object.freeze({
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
```

Use `readFile` and `mkdir`, hash raw source bytes with `sha256Bytes`, serialize `--check` candidates with `canonicalJson(value) + "\n"`, and persist `--write` outputs with `writeCanonicalJson`. Normalize every value with `String.prototype.normalize("NFC")`, strip Markdown emphasis, split comma lists, and emit IDs with `` `name:${poolId}:${String(ordinal).padStart(3, "0")}` ``. Parse the noblewoman bullet row into three distinct pools instead of treating it as prose:

```js
const NOBLEWOMAN_POOL_RULES = Object.freeze({
  public_address: { label: "호칭", expectedCount: 4 },
  taekho: { label: "택호", expectedCount: 8 },
  legal_given_name: { label: "본명", expectedCount: 15 },
});

function parseNoblewomanPools(markdown) {
  const addressLine = markdown.match(/- 호칭·택호 \(우선\): ([^\r\n]+)/u)?.[1];
  const legalLine = markdown.match(/- 본명 \(필요시\): ([^\r\n]+)/u)?.[1];
  if (!addressLine || !legalLine) throw new Error("name_bank noblewoman rows missing");
  const [addressPart, taekhoPart] = addressLine.split("/").map((value) => value.trim());
  const pools = {
    public_address: splitValues(addressPart),
    taekho: splitValues(taekhoPart),
    legal_given_name: splitValues(legalLine),
  };
  for (const [poolId, rule] of Object.entries(NOBLEWOMAN_POOL_RULES)) {
    if (pools[poolId].length !== rule.expectedCount) {
      throw new Error(`${poolId} expected ${rule.expectedCount}, received ${pools[poolId].length}`);
    }
  }
  return pools;
}

function splitValues(value) {
  return value
    .replaceAll(/\*\*/gu, "")
    .split(",")
    .map((item) => item.trim().normalize("NFC"))
    .filter(Boolean);
}
```

The emitted name data must preserve separate `classId`, `gender`, `useCase`, `spokenForm`, `requiresSurname`, and `difficulty` fields. The blocked list must use stable `blocked:<ordinal>` IDs and include parenthetical variants as separate normalized strings. Build `script-rules.v1.json` from explicit normalized constants for genre element pools, speech registers, address rules, prose rules, hard gates, warning rules, and approval review fields; attach all 13 source path/hash records. Its constants are reviewed data, while the hash guards ensure their legacy inputs cannot drift unnoticed.

- [ ] **Step 4 (5 minutes): Implement motif and beat extraction with invariant failures.**

Parse only the numbered engine-motif rows under `## 파트 1`; capture `ordinal`, stable `motif:mNN`, description, and the trailing category tag. Fail unless ordinals are exactly 1–40. Emit each of the 15 beats with stable `beatId: "beat-NN"`, source label, narrative function, recommended ratio, and evidence requirements. Add these non-negotiable normalized rules directly to `beat-structure.v1.json` because they combine the checked legacy pack with the approved design:

```js
const DESIGN_RULES = Object.freeze({
  targetMinutes: { minimum: 10, maximum: 120, step: 10 },
  logicalSegmentMinutes: 10,
  intro: { sentenceCount: 6, minimumCharacters: 200, maximumCharacters: 350, ctaSentence: 6 },
  counts: { beats: 15, twists: 6, emotionalPoints: 6, themePlacements: 3, finaleStages: 5 },
  titleSuffix: " | 야담 옛날이야기 민담 전설 설화",
  fixedEnding: [
    "다음 영상을 빠르게 만나보시려면 좋아요와 구독을 눌러주세요.",
    "지금 화면에 나오는 더 재미있는 영상들도 함께 해주세요.",
    "그럼 모두 행복한 하루 보내세요. 감사합니다.",
  ],
});
```

- [ ] **Step 5 (3 minutes): Generate and byte-check the committed data.**

Run:

```powershell
node scripts/build_yadam_reference_data.mjs --write
node scripts/build_yadam_reference_data.mjs --check
node scripts/test_yadam_reference_data.mjs
```

Expected:

```text
ok - yadam reference data is current
ok - normalized yadam reference data
```

- [ ] **Step 6 (2 minutes): Verify only intended files and record the task commit.**

Run:

```powershell
git status --short
git add scripts/test_yadam_reference_data.mjs scripts/build_yadam_reference_data.mjs data/yadam/reference
git commit -m "feat(yadam): normalize legacy reference data"
```

Expected in the current non-Git workspace: `fatal: not a git repository`; record `SKIP: not a git repository`. In a Git workspace: one commit containing exactly the six Task 1 files.

---

## Task 2: Load references and select names, motifs, and recent-history exclusions deterministically

**Files:**
- Create: `scripts/test_yadam_selection_services.mjs`
- Create: `scripts/lib/yadam/reference-store.mjs`
- Create: `scripts/lib/yadam/name-service.mjs`
- Create: `scripts/lib/yadam/motif-service.mjs`
- Create: `scripts/lib/yadam/history-store.mjs`

**Interfaces:**
- `loadYadamReferences({ rootDir })` returns frozen `{ names, motifs, beats, rules }` after schema/count/source-hash checks.
- `chooseNameCandidates({ references, classId, gender, useCase, seed, count, excludedIds })` returns ranked records or throws `error.code = "name_pool_exhausted"`.
- `assembleCharacterName({ references, givenName, prominence, seed, excludedSurnameIds })` returns `{givenNameId,surnameId,fullIntroName,regularSpokenForm}` without inventing syllables.
- `chooseMotifs({ references, seed, count, recentFingerprints })` returns motif records not used in the last 20 completed stories.
- `readRecentStoryFingerprints(historyPath, limit = 20)` and `appendCompletedStoryFingerprint({ historyPath, fingerprint })` expose append-safe history storage.

- [ ] **Step 1 (5 minutes): Write deterministic-selection and exhaustion tests.**

Create a test that loads the committed references, calls each selector twice with seed `job-yadam-001`, and deep-compares the IDs. Assert `chooseNameCandidates` for noblewoman `public_address`, `taekho`, and `legal_given_name` draws only from the matching pool. Assert a protagonist who requires a surname receives only an easy-surname record, the combined introduction name is NFC and unique, regular narration uses the given/spoken form, noblewoman taekho/public-address and royal-title records receive no surname, and excluded surnames are not reused in the core cast. Exclude all 15 legal given-name IDs and assert:

```js
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
```

Create a temporary JSONL history file with 23 completed fingerprints, read it back, and assert that only entries 4–23 are returned in chronological order. Assert motif selection excludes every `motifIds` value in those 20 records. End with `console.log("ok - deterministic yadam selection services")`.

- [ ] **Step 2 (2 minutes): Confirm imports fail before implementation.**

Run:

```powershell
node scripts/test_yadam_selection_services.mjs
```

Expected: exit code 1 and `ERR_MODULE_NOT_FOUND` for `scripts/lib/yadam/reference-store.mjs`.

- [ ] **Step 3 (4 minutes): Implement strict runtime reference loading.**

`reference-store.mjs` must resolve all four data paths from its `rootDir`, parse UTF-8 JSON, deep-freeze returned values, and re-run the invariant counts/source lock from Task 1. Reject unsupported schema versions with `error.code = "reference_version_unsupported"`; reject count or source-hash drift with `error.code = "reference_integrity_failed"`. Do not import the Task 1 normalizer and do not open any Markdown path.

- [ ] **Step 4 (4 minutes): Implement stable hash ranking and explicit pool exhaustion.**

Use this total ordering in both selector modules; the stable ID tie-breaker prevents platform-dependent order:

```js
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
```

Filter blocked values, explicit `excludedIds`, and recent-history IDs before ranking. Never synthesize a replacement. `assembleCharacterName` uses only easy surnames for `prominence:"protagonist"|"major"`, permits rare surnames only for supporting/minor roles, permits compound surnames only when the normalized character brief explicitly allows one, and rejects a combined spoken form whose normalized difficulty is marked `avoid`. `chooseMotifs` must also diversify category: take the first ranked motif for each distinct category before filling remaining slots from the stable ranking.

- [ ] **Step 5 (5 minutes): Implement a last-20 atomic JSONL history store.**

Each accepted line has exactly `{jobId,completedAt,nameIds,motifIds,twistCategories,themeLine,titleFingerprint}`. Validate ISO timestamp, lowercase hex title fingerprint, string arrays, and uniqueness of `jobId`. Define the fingerprint as SHA-256 of UTF-8 bytes after removing the exact title suffix, normalizing NFC, lowercasing, and removing every Unicode punctuation, symbol, and whitespace code point with `/[\p{P}\p{S}\s]+/gu`. Read all valid lines, sort by `(completedAt, jobId)`, and return the newest 20. To append, set `lockPath = historyPath + ".lock"`, acquire it with `open(lockPath, "wx", 0o600)`, re-read under the lock, reject duplicate `jobId`, append `canonicalJson(fingerprint) + "\n"` using Plan 01 canonicalization, `sync`, close, and remove the lock in `finally`.

- [ ] **Step 6 (3 minutes): Run selection tests twice to prove repeatability.**

Run:

```powershell
node scripts/test_yadam_selection_services.mjs
node scripts/test_yadam_selection_services.mjs
```

Expected twice:

```text
ok - deterministic yadam selection services
```

- [ ] **Step 7 (2 minutes): Record the task commit.**

Run `git status --short`, then:

```powershell
git add scripts/test_yadam_selection_services.mjs scripts/lib/yadam/reference-store.mjs scripts/lib/yadam/name-service.mjs scripts/lib/yadam/motif-service.mjs scripts/lib/yadam/history-store.mjs
git commit -m "feat(yadam): add deterministic name motif history services"
```

Expected now: the documented non-Git skip. Expected after Git initialization: one green-test commit.

---

## Task 3: Add the strict Codex-stage adapter, schemas, and prompts

**Files:**
- Create: `scripts/test_yadam_codex_stage_adapter.mjs`
- Create: `scripts/lib/yadam/codex-json-stage.mjs`
- Create: `scripts/lib/yadam/schema-validator.mjs`
- Create: `schemas/yadam/concept-inputs.schema.json`
- Create: `schemas/yadam/concept-options.schema.json`
- Create: `schemas/yadam/hook-brief.schema.json`
- Create: `schemas/yadam/outline.schema.json`
- Create: `schemas/yadam/story-bible.schema.json`
- Create: `schemas/yadam/script-plan.schema.json`
- Create: `schemas/yadam/segment-draft.schema.json`
- Create: `schemas/yadam/script-scenes.schema.json`
- Create: `schemas/yadam/scene-plan.schema.json`
- Create: `schemas/yadam/qa-report.schema.json`
- Create: `schemas/yadam/coverage-report.schema.json`
- Create: `schemas/yadam/thumbnail-plan.schema.json`
- Create: `schemas/yadam/duration-repair.schema.json`
- Create: `schemas/yadam/approval.schema.json`
- Create: `prompts/yadam/concept.md`
- Create: `prompts/yadam/story-intro.md`
- Create: `prompts/yadam/outline.md`
- Create: `prompts/yadam/story-bible.md`
- Create: `prompts/yadam/segment-draft.md`
- Create: `prompts/yadam/segment-repair.md`
- Create: `prompts/yadam/final-review.md`
- Create: `prompts/yadam/scene-plan.md`
- Create: `prompts/yadam/thumbnail-plan.md`

**Interfaces:**
- `runYadamJsonStage({ jobDir, stageId, promptPath, schemaPath, input, timeoutMs, signal, runStage })` calls Plan 01's `runCodexStage` exactly once and returns its validated `payload` plus provenance.
- `validateSchema(schema, value)` returns `{valid:true}` or `{valid:false,errors:[{instancePath,keyword,message}]}` with deterministic error ordering.
- Every domain-object schema has `additionalProperties: false` and `$id` ending in `/v1`; explicitly named hash-map fields use schema-valued `additionalProperties` constrained to 64-character lowercase hex strings.

Use exact timeouts: concept 180,000 ms; story intro 120,000 ms; outline 180,000 ms; story bible 180,000 ms; one segment 300,000 ms; final review 180,000 ms; scene plan 180,000 ms; thumbnail plan 120,000 ms; duration repair 300,000 ms. A stage's one repair call uses the same timeout. Timeout is a failed attempt and is never silently retried by Plan 01.

| Stage ID | Prompt | Schema |
|---|---|---|
| `yadam.concept.options.v1` | `prompts/yadam/concept.md` | `schemas/yadam/concept-options.schema.json` |
| `yadam.story.intro.v1` | `prompts/yadam/story-intro.md` | `schemas/yadam/hook-brief.schema.json` |
| `yadam.outline.v1` | `prompts/yadam/outline.md` | `schemas/yadam/outline.schema.json` |
| `yadam.story.bible.v1` | `prompts/yadam/story-bible.md` | `schemas/yadam/story-bible.schema.json` |
| `yadam.script.segment-NN.v1` | `prompts/yadam/segment-draft.md` | `schemas/yadam/segment-draft.schema.json` |
| `yadam.script.final-review.v1` | `prompts/yadam/final-review.md` | `schemas/yadam/qa-report.schema.json` |
| `yadam.scene.plan.v1` | `prompts/yadam/scene-plan.md` | `schemas/yadam/scene-plan.schema.json` |
| `yadam.thumbnail.plan.v1` | `prompts/yadam/thumbnail-plan.md` | `schemas/yadam/thumbnail-plan.schema.json` |
| `yadam.duration.repair.v1` | `prompts/yadam/segment-repair.md` | `schemas/yadam/duration-repair.schema.json` |

For ordinary generation stages, the only validation-repair suffix is `.repair-1`; it uses the same prompt/schema pair plus sorted local violations and rejected-output hash. `yadam.duration.repair.v1` is already the job's single duration repair and never receives a second repair call.

- [ ] **Step 1 (5 minutes): Write an adapter test with a fake Plan 01 stage runner.**

Write a temporary closed adapter-test schema that permits `{schemaVersion:"1.0.0",options:[]}`. Use an input containing Korean and emoji, capture the fake runner options, and assert: the prompt is NFC, ends with exactly one LF, contains a delimited canonical input envelope, and its `inputHash` equals `sha256Bytes(Buffer.from(canonicalInput, "utf8"))`. Return `{payload:{schemaVersion:"1.0.0",options:[]},outputHash:"a".repeat(64),eventsPath:"runs/events.jsonl",provenance:{provider:"fake"}}`; assert the adapter preserves all four fields. Also return a payload with an extra key and assert `error.code === "codex_payload_schema_invalid"`.

- [ ] **Step 2 (2 minutes): Confirm the adapter test is red.**

Run `node scripts/test_yadam_codex_stage_adapter.mjs`.

Expected: exit 1 with `ERR_MODULE_NOT_FOUND` for `codex-json-stage.mjs`.

- [ ] **Step 3 (5 minutes): Implement canonical prompt composition against the fixed Plan 01 runner.**

The adapter imports `runCodexStage` from `../pipeline/codex-stage-runner.mjs` and defaults `runStage` to that function. Read prompt and schema as UTF-8, normalize prompt/input strings to NFC, set `canonicalInput = canonicalJson(input)`, and compose exactly with `` `${promptBody.trimEnd()}\n\n--- BEGIN CANONICAL INPUT JSON ---\n${canonicalInput}\n--- END CANONICAL INPUT JSON ---\n` ``.

Pass `{jobDir,stageId,prompt,schemaPath,inputHash,timeoutMs,signal}` to Plan 01. Validate `result.payload` locally before returning it. Reject a schema failure before any artifact write and attach sorted validation errors to `error.details`.

- [ ] **Step 4 (5 minutes): Implement the minimum JSON Schema evaluator used by every yadam gate.**

Support the schema vocabulary used in this plan: `$ref` to local `$defs`, `type`, `required`, boolean or schema-valued `additionalProperties`, `properties`, `items`, `minItems`, `maxItems`, `uniqueItems`, `enum`, `const`, `pattern`, `minimum`, `maximum`, `minLength`, `maxLength`, `oneOf`, and `allOf`. Sort errors by `instancePath`, then `keyword`, then `message`. Add direct tests for unknown keys, array count, enum mismatch, nested required fields, and invalid hash-map values. Do not silently ignore a schema keyword; throw `schema_keyword_unsupported` while loading the schema.

- [ ] **Step 5 (5 minutes): Write the complete stage schemas with shared identifiers.**

Use these IDs consistently across schemas and prompts:

```text
candidateId concept-c01 through concept-c04
beatId beat-01 through beat-15
twistId twist-01 through twist-06
emotionPointId emotion-01 through emotion-06
themePlacementId theme-01 through theme-03
foreshadowId foreshadow-01 upward
finaleStageId finale-01 through finale-05
segmentId segment-01 through segment-12
sceneId scene-0001 upward
copyId copy-01 through copy-04
```

Constrain `concept-inputs` to the exact owner-backed snapshot shape in Task 4: four named external reference hashes, one request hash, a chronological history projection capped at 20 entries, its canonical hash, and the normalized candidate/input fields; reject absolute paths and unbounded history content. Constrain `concept-options` to three or four options and require the exact 64-lowercase-hex `conceptInputsHash` echoed from the stage input; local validation requires four options for `inputMode:"reference"` and three for `inputMode:"genre"`. Require `recommendedCandidateId` to reference one returned option and a non-empty `recommendationReason`. Each option has title, theme line, one motif ID, named cast proposals, six twist-category proposals, and spoiler-seal IDs. Constrain `hook-brief` to exactly six sentence objects with ordinal 1–6, sentence 6 `role: "cta"`, and aggregate `characterCount` 200–350. Constrain `outline` to exactly 15 beats, six twists, six emotion points, three theme placements, at least one plant/recovery pair, five finale stages, and the three fixed ending strings. Constrain `thumbnail-plan` to exactly four copy options, `recommendedCopyId`, and layout enum `left-panel-4`, `right-panel-4`, or `bottom-band-2`. Make `approval.schema.json` a closed discriminated union. Its `approval_2_bundle` branch requires `documentType:"approval_2_bundle"`, positive integer `candidateApprovalRevision`, lowercase `approvedArtifactSetHash` and the complete sorted artifact list; the approval-1 bundle and immutable approval revision branches forbid `candidateApprovalRevision`. This candidate is bundle evidence only, never a pipeline-state field or completed formal revision.

- [ ] **Step 6 (5 minutes): Write the nine stage prompts as data contracts.**

Each prompt must: identify yadam profile and stage; require output matching the named schema; prohibit filesystem, shell, network, provider, and implementation instructions; say input IDs are immutable; require Korean output; and instruct the model to return JSON only. `concept.md` must echo the input `conceptInputsHash` byte-for-byte and may not invent or rewrite reference/history provenance. `story-intro.md` requires exactly six sentences and labels sentence 6 CTA. `outline.md` requires all exact counts and the fixed ending. `story-bible.md` prohibits changing approved event order, twist meaning, relationships, ending meaning, and spoiler seals. `segment-repair.md` permits only description, dialogue, and transition length changes. `scene-plan.md` requires source-scene grounding and represents a long still as an extension of one slot. `thumbnail-plan.md` prohibits spoiler-sealed facts from copy.

- [ ] **Step 7 (4 minutes): Run adapter, schema-negative, and schema-positive fixtures.**

Run:

```powershell
node scripts/test_yadam_codex_stage_adapter.mjs
```

Expected:

```text
ok - yadam Codex JSON stage adapter
ok - yadam schemas reject malformed payloads
ok - yadam schemas accept canonical fixtures
```

- [ ] **Step 8 (2 minutes): Record the schema/prompt task commit.**

Run `git status --short`, then add the Task 3 files and commit with:

```powershell
git commit -m "feat(yadam): add strict Codex stage contracts"
```

Expected now: the documented non-Git skip. Expected in Git: no generated runtime outputs in this commit.

---

## Plan 01 Interfaces Consumed Without Redefinition

Plan 01 must expose these exact imports:

```js
import { loadJob } from "../pipeline/job-store.mjs";
import {
  writeCanonicalJson,
  writeCanonicalJsonExclusive,
  writeUtf8Atomic,
} from "../pipeline/atomic-store.mjs";
import { canonicalJson, hashCanonical, sha256Bytes } from "../pipeline/canonical-json.mjs";
import { registerArtifact } from "../pipeline/artifact-store.mjs";
import { transitionJob } from "../pipeline/state-machine.mjs";
import { runCodexStage } from "../pipeline/codex-stage-runner.mjs";
```

The Plan 02 implementation assumes these call contracts:

```js
loadJob(jobDir): Promise<JobContext>

writeCanonicalJson(filePath, value): Promise<{
  path: string,
  sha256: string,
  sizeBytes: number,
}>

writeCanonicalJsonExclusive(filePath, value): Promise<{
  path: string,
  sha256: string,
  sizeBytes: number,
}>

writeUtf8Atomic(filePath, text): Promise<{
  path: string,
  sha256: string,
  sizeBytes: number,
}>

sha256Bytes(input): string

canonicalJson(value): string

hashCanonical(value): string

registerArtifact(jobDir, record): Promise<ArtifactRecord>

transitionJob(jobDir, event): Promise<PipelineState>

runCodexStage({
  jobDir,
  stageId,
  prompt,
  schemaPath,
  inputHash,
  timeoutMs,
  signal,
}): Promise<{
  payload: object,
  outputHash: string,
  eventsPath: string,
  provenance: object,
}>
```

Every `registerArtifact` call in this plan uses this record:

```js
{
  artifactId: string,
  logicalRole: string,
  path: string,
  sha256: string,
  schemaVersion: string,
  producerStage: string,
  gateStatus: "pass" | "warning",
  dependencyHashes: Record<string, string>,
}
```

`path` is always job-relative and slash-normalized. Public `WrittenArtifact.relativePath` is a projection of registry `path`; no `registerArtifact` call uses the public field name. Strict approval, TTS, visual, repair, and production handoffs accept only registry records whose `gateStatus` is `pass`; `warning` artifacts remain reviewable but cannot cross a production gate.

Every `runCodexStage` call in this plan uses this options object:

```js
{
  jobDir: string,
  stageId: string,
  prompt: string,
  schemaPath: string,
  inputHash: string,
  timeoutMs: number,
  signal?: AbortSignal,
}
```

The stage prompt is a complete UTF-8 string containing the prompt template plus a `canonicalJson(input)` envelope. The caller computes `inputHash` from those canonical UTF-8 bytes before invoking Plan 01. Plan 02 must not duplicate job, atomic-write, canonicalization/hash, artifact-registry, state-machine, or Codex process behavior.

## Public Script Service API

Create `scripts/lib/yadam/script-service.mjs` as the only public façade. It exports exactly:

```js
export async function generateConceptOptions({ jobDir, historyPath, now });
export async function selectConcept({ jobDir, candidateId, userInstructions, selectedAt });
export async function buildApprovalOneBundle({ jobDir });
export async function approveConcept({ jobDir, expectedArtifactSetHash, approvedAt, userInstructions });
export async function buildStoryBible({ jobDir });
export async function buildScriptPlan({ jobDir });
export async function draftNextSegment({ jobDir });
export async function finalizeScriptPackage({ jobDir });
export async function generateThumbnailPlan({ jobDir });
export async function selectThumbnailCopy({ jobDir, copyId, selectedAt });
export async function buildApprovalTwoBundle({ jobDir, previewArtifacts });
export async function approveProduction({ jobDir, expectedArtifactSetHash, approvedAt, userInstructions });
export async function getApprovedTtsInput(jobDir);
export async function getApprovedVisualPlanningInput(jobDir);
export async function requestDurationRepair({ jobDir, measuredDurationSeconds, acceptedRangeSeconds, signal });
export async function rebuildApproval2AfterDurationRepair({ jobDir, changedSceneIds, signal });
export async function updateCoverageSection({ jobDir, section, report });
export async function recordCompletedStoryFingerprint({ jobDir, historyPath, completedAt });
```

Argument rules are part of the API: `jobDir` and `historyPath` are absolute Windows paths; `now`, `selectedAt`, `approvedAt`, and `completedAt` are UTC ISO-8601 strings with millisecond precision; `candidateId`, `copyId`, and `changedSceneIds` use the stable ID formats in this plan; `userInstructions` is an NFC string of at most 2,000 Unicode code points; `expectedArtifactSetHash` is the lowercase SHA-256 shown to the reviewer; `acceptedRangeSeconds` is `{minimum:number,maximum:number}` with finite positive numbers; `section` is `"audio"`, `"subtitle"`, or `"visual"`; and `signal` is optional `AbortSignal`. Unknown object keys are rejected at the public boundary. Every returned `relativePath`, `bundlePath`, and `approvalRevisionPath` is job-relative with `/` separators; only returned `historyPath` is absolute.

Cross-plan return contracts:

```js
type WrittenArtifact = {
  artifactId: string,
  relativePath: string,
  sha256: string,
}

generateConceptOptions(input): Promise<{
  status: "awaiting_concept_selection",
  artifact: WrittenArtifact,
  optionCount: 3 | 4,
  recommendedCandidateId: string,
}>

selectConcept(input): Promise<{
  status: "selection_recorded",
  candidateId: string,
  relativePath: string,
  sha256: string,
  approvalOneInvalidated: boolean,
}>

buildApprovalOneBundle(input): Promise<{
  status: "awaiting_approval_1",
  bundlePath: string,
  approvedArtifactSetHash: string,
}>

approveConcept(input): Promise<{
  status: "approved",
  revision: number,
  approvalRevisionPath: string,
  approvedArtifactSetHash: string,
}>

buildStoryBible(input): Promise<{
  status: "ready",
  relativePath: string,
  sha256: string,
  semanticContractHash: string,
}>

buildScriptPlan(input): Promise<{
  status: "ready",
  relativePath: string,
  sha256: string,
  segmentCount: number,
}>

draftNextSegment(input): Promise<
  | {
      status: "drafted",
      segmentId: string,
      relativePath: string,
      sha256: string,
      remainingSegments: number,
    }
  | { status: "complete", remainingSegments: 0 }
>

finalizeScriptPackage(input): Promise<{
  status: "ready",
  scriptScenes: WrittenArtifact,
  finalText: WrittenArtifact,
  qaReport: WrittenArtifact,
  coverageReport: WrittenArtifact,
  scenePlan: WrittenArtifact,
}>

generateThumbnailPlan(input): Promise<{
  status: "awaiting_thumbnail_copy_selection",
  artifact: WrittenArtifact,
  optionCount: 4,
  recommendedCopyId: string,
}>

selectThumbnailCopy(input): Promise<{
  status: "selection_recorded",
  copyId: string,
  relativePath: string,
  sha256: string,
  approvalTwoInvalidated: boolean,
}>

buildApprovalTwoBundle(input): Promise<{
  status: "awaiting_approval_2",
  bundlePath: string,
  approvedArtifactSetHash: string,
}>

approveProduction(input): Promise<{
  status: "approved",
  revision: number,
  approvalRevisionPath: string,
  approvedArtifactSetHash: string,
}>

getApprovedTtsInput(jobDir): Promise<{
  approvalRevisionPath: string,
  finalTextHash: string,
  scriptScenesHash: string,
  scenes: Array<{
    sceneId: string,
    segmentId: string,
    ordinal: number,
    sourceText: string,
    sourceHash: string,
    ttsNormalizedText: string,
    ttsNormalizedHash: string,
    ttsOptionsHash: string,
  }>,
}>

getApprovedVisualPlanningInput(jobDir): Promise<{
  approvalRevisionPath: string,
  approvedArtifactSetHash: string,
  storyBible: { relativePath: string, sha256: string, schemaVersion: string, schemaHash: string },
  scenePlan: { relativePath: string, sha256: string, schemaVersion: string, schemaHash: string },
  thumbnailPlan: { relativePath: string, sha256: string, schemaVersion: string, schemaHash: string },
  thumbnailSelection: { relativePath: string, sha256: string, copyId: string },
  spoilerSealIds: string[],
}>

requestDurationRepair({
  jobDir,
  measuredDurationSeconds,
  acceptedRangeSeconds: { minimum: number, maximum: number },
  signal?: AbortSignal,
}): Promise<
  | {
      status: "repaired",
      attempt: 1,
      changedSegmentIds: string[],
      changedSceneIds: string[],
      beforeFinalTextHash: string,
      afterFinalTextHash: string,
    }
  | {
      status: "needs_review",
      attempt: 1,
      changedSegmentIds: string[],
      changedSceneIds: string[],
      beforeFinalTextHash: string,
      afterFinalTextHash: null,
    }
  | {
      status: "approval1_invalidated",
      attempt: 1,
      changedSegmentIds: string[],
      changedSceneIds: string[],
      beforeFinalTextHash: string,
      afterFinalTextHash: null,
    }
>

rebuildApproval2AfterDurationRepair({
  jobDir,
  changedSceneIds: string[],
  signal?: AbortSignal,
}): Promise<{
  status: "awaiting_reapproval",
  revision: number,
  bundlePath: string,
  approvedArtifactSetHash: string,
}>

updateCoverageSection(input): Promise<{
  relativePath: "script/coverage-report.json",
  sha256: string,
  sectionArtifact: {
    section: "audio" | "subtitle" | "visual",
    relativePath: string,
    sha256: string,
    revision: number,
  },
  complete: boolean,
  sections: {
    script: "pass",
    audio: "pending" | "pass",
    subtitle: "pending" | "pass",
    visual: "pending" | "pass",
  },
}>

recordCompletedStoryFingerprint(input): Promise<{
  jobId: string,
  historyPath: string,
  entryHash: string,
}>
```

`previewArtifacts` passed to the initial approval-2 builder has this exact shape:

```js
{
  thumbnailPreview: { artifactId: string, relativePath: string, sha256: string },
  thumbnailGuide: { artifactId: "thumbnail-reserved-guide", relativePath: "previews/thumbnail-reserved-guide.png", sha256: string, dependencyHash: string },
  characterReferenceSet: { artifactId: string, relativePath: string, sha256: string },
  representativePreviews: [
    { role: "intro", artifactId: string, relativePath: string, sha256: string },
    { role: "body", artifactId: string, relativePath: string, sha256: string },
    { role: "climax", artifactId: string, relativePath: string, sha256: string },
  ],
  styleProfile: { artifactId: string, relativePath: string, sha256: string },
}
```

`getApprovedTtsInput` must throw an error whose `code` is `approval2_not_valid` when `current-approval-2.json`, its revision target, the approved artifact-set hash, `finalTextHash`, or `scriptScenesHash` fails verification. `requestDurationRepair` is the only public duration decision/repair entry point and may run once per job. `rebuildApproval2AfterDurationRepair` is illegal unless the preceding result was `repaired` and Plan 04's narrow refresh completed successfully; before it is called, Plans 03 and 04 must have refreshed every artifact allowed by that locked changed-scene scope. A Plan 04 `duration_refresh_scope_expanded` result is terminal `needs_review` for this automatic same-job branch, so this rebuild is not called and normal `buildApproval2Previews` is never invoked from the repair state. On the successful narrow path, the rebuild verifies those dependency hashes, reuses unchanged preview/reference/thumbnail/style artifacts, writes the next approval-2 bundle, and returns only after the state is `AWAITING_APPROVAL_2`.

## Artifact Logical Roles Produced

The four `yadam.reference.*` rows are repository runtime resources identified by locked hashes and are not passed to the job-scoped `registerArtifact`. Every remaining row is job-relative and is registered with the Plan 01 `path` field.

| Logical role | Canonical relative path | Primary consumer |
|---|---|---|
| `yadam.reference.names` | `data/yadam/reference/name-bank.v1.json` | Plan 02 |
| `yadam.reference.motifs` | `data/yadam/reference/motif-bank.v1.json` | Plan 02 |
| `yadam.reference.beats` | `data/yadam/reference/beat-structure.v1.json` | Plan 02 |
| `yadam.reference.rules` | `data/yadam/reference/script-rules.v1.json` | Plan 02 |
| `yadam.concept.inputs` | `planning/concept-inputs.json` | concept generation and invalidation |
| `yadam.concept.options` | `planning/concept-options.json` | approval 1 UI |
| `yadam.concept.selection` | `approvals/concept-selection.json` | approval 1 builder |
| `yadam.hook.brief` | `planning/hook-brief.json` | Plan 02 script stages |
| `yadam.outline` | `planning/outline.json` | script drafting |
| `yadam.approval.1.bundle` | `approvals/approval-1-bundle.json` | formal approval 1 and Plan 06 review renderer |
| `yadam.approval.1` | `approvals/approval-1-rNNN.json` | script drafting |
| `yadam.story.bible` | `planning/story-bible.json` | Plans 02 and 04 |
| `yadam.script.plan` | `planning/script-plan.json` | segment drafting |
| `yadam.script.segment` | `script/chapters/segment-XX.json` | finalizer |
| `yadam.script.scenes` | `script/script-scenes.json` | Plans 03–06 |
| `yadam.script.final_text` | `script/final.txt` | approval 2 and TTS review |
| `yadam.scene.plan` | `planning/scene-plan.json` | Plan 04 |
| `yadam.script.qa` | `script/qa-report.json` | approval 2 |
| `yadam.coverage.script` | `script/coverage/script-rNNN.json` | aggregate coverage owner |
| `yadam.coverage.audio` | `script/coverage/audio-rNNN.json` | Plan 03 success evidence |
| `yadam.coverage.subtitle` | `script/coverage/subtitle-rNNN.json` | Plan 05 segment evidence |
| `yadam.coverage.visual` | `script/coverage/visual-rNNN.json` | Plan 04 success evidence |
| `yadam.coverage.report` | `script/coverage-report.json` | Plans 03–06 |
| `yadam.thumbnail.plan` | `planning/thumbnail-plan.json` | Plan 04 |
| `yadam.thumbnail.selection` | `approvals/thumbnail-copy-selection.json` | Plan 04 and approval 2 |
| `yadam.approval.2.bundle` | `approvals/approval-2-bundle.json` | formal approval 2, duration reapproval and Plan 06 review renderer |
| `yadam.approval.2` | `approvals/approval-2-rNNN.json` | Plans 03–06 |
| `yadam.duration.repair_report` | `script/duration-repair-report.json` | approval-2 reapproval |

`yadam.concept.inputs` is the sole job-scoped owner of the external reference/history provenance used by concept generation. It always uses stable artifact ID `yadam-concept-inputs`; the four repository-only `yadam.reference.*` resources never appear directly in another job artifact's `dependencyHashes`. The mutable current bundle files are singleton registered records with stable IDs `yadam-approval-1-bundle` and `yadam-approval-2-bundle`; a changed bundle advances the current hash and retains the prior hash in `revisionHistory`. The formal approval roles are also singleton current records: `yadam.approval.1` always uses artifact ID `yadam-approval-1-current`, and `yadam.approval.2` always uses `yadam-approval-2-current`. Their registry `path` and hash advance to the newest immutable `rNNN` file while Plan 01 preserves the prior record in `revisionHistory`; the append-only files and atomic `current-approval-*.json` pointers remain separate filesystem evidence and deliberately have no second pointer role.

Duration repair consumes Plan 03 role `yadam.audio.manifest` at `assets/audio/audio-manifest.json` and verifies its registered hash before use. The manifest supplies `measuredAudioSeconds`, `acceptedRangeSeconds`, ordered scenes `{sceneId,segmentId,order,durationSeconds}`, and segments `{segmentId,plannedDurationSeconds:600,measuredAudioSeconds,startSeconds,endSeconds}`. It also cross-checks Plan 03 role `yadam.audio.timeline` at `assets/audio/audio-timeline.json`; Plan 02 does not produce either audio artifact.

## State Events Produced

```text
CONCEPT_OPTIONS_READY
CONCEPT_SELECTED
APPROVAL_ONE_BUNDLE_READY
APPROVAL_ONE_GRANTED
STORY_BIBLE_READY
SCRIPT_PLAN_READY
SEGMENT_DRAFTED
SCRIPT_PACKAGE_READY
THUMBNAIL_OPTIONS_READY
THUMBNAIL_COPY_SELECTED
APPROVAL_TWO_BUNDLE_READY
APPROVAL_TWO_GRANTED
MEASURED_DURATION_ACCEPTED
DURATION_REPAIR_REQUIRED
DURATION_REPAIR_APPLIED
APPROVAL_TWO_REBUILD_READY
COVERAGE_SECTION_UPDATED
NEEDS_REVIEW
```

### Locked success-event evidence for Plan 06

For the master-consumed events below, `H(value)` means Plan 01 `hashCanonical(value)`, every object key is exactly the key shown, every hash is lowercase SHA-256, and every `artifactPaths` array is lexicographically sorted before `transitionJob`. `codexExecutionPinHash` is `H({executableVersion,model,reasoningEffort,profileHash,instructionSourceHashes})` from the Plan 01 current preflight provenance; stage prompt/schema hashes remain separate keys. `plannerVersionHash`, `canonicalizerVersionHash`, `layoutTemplateHash`, and `fontPinHash` are opaque current pins stored in artifact dependencies. No implementation may substitute a timestamp, path hash, or historical event hash for one of these fields.

| Event | Exact `to` | Exact `inputHash` projection | Exact `outputHash` | Exact `artifactPaths` |
|---|---|---|---|---|
| `CONCEPT_OPTIONS_READY` | `awaiting_approval` | `H({stage:"concept_options",requestHash,conceptInputsHash,promptHash,schemaHash,profileHash,codexExecutionPinHash})` | `conceptOptionsHash` | `planning/concept-inputs.json`, `planning/concept-options.json` |
| `CONCEPT_SELECTED` | `running` | `H({stage:"concept_selection",conceptOptionsHash,candidateId,userInstructions,selectedAt})` | `conceptSelectionHash` | `approvals/concept-selection.json` |
| `APPROVAL_ONE_BUNDLE_READY` | `awaiting_approval` | `H({stage:"approval_1_bundle",conceptInputsHash,conceptOptionsHash,conceptSelectionHash,introPromptHash,introSchemaHash,outlinePromptHash,outlineSchemaHash,profileHash,codexExecutionPinHash})` | `H({hookBriefHash,outlineHash,approvalOneBundleHash})` | `approvals/approval-1-bundle.json`, `planning/hook-brief.json`, `planning/outline.json` |
| `APPROVAL_ONE_GRANTED` | `running` | the current revision's `approvedArtifactSetHash` | immutable approval-1 revision bytes `sha256` | current `approvals/approval-1-rNNN.json`, `approvals/current-approval-1.json` |
| `STORY_BIBLE_READY` | `running` | `H({stage:"story_bible",approvalRevisionHash,approvedArtifactSetHash,referenceDataHashes,promptHash,schemaHash,profileHash,codexExecutionPinHash})` | `storyBibleHash` | `planning/story-bible.json` |
| `SCRIPT_PLAN_READY` | `running` | `H({stage:"script_plan",requestHash,approvalRevisionHash,outlineHash,storyBibleHash,profileHash,plannerVersionHash})` | `scriptPlanHash` | `planning/script-plan.json` |
| `SEGMENT_DRAFTED` | `running` | `H({stage:"segment_draft",segmentId,scriptPlanHash,storyBibleHash,outlineHash,priorAcceptedSegmentHashes,promptHash,schemaHash,profileHash,codexExecutionPinHash})` | current `segmentDraftHash` | current `script/chapters/segment-XX.json` only |
| `SCRIPT_PACKAGE_READY` | `running` | `H({stage:"script_package",scriptPlanHash,storyBibleHash,segmentHashes,scriptRulesHash,finalReviewPromptHash,finalReviewSchemaHash,scenePlanPromptHash,scenePlanSchemaHash,profileHash,codexExecutionPinHash,canonicalizerVersionHash})` | `H({finalTextHash,scriptScenesHash,scriptQaHash,coverageReportHash,scenePlanHash})` | `planning/scene-plan.json`, `script/coverage-report.json`, `script/final.txt`, `script/qa-report.json`, `script/script-scenes.json` |
| `THUMBNAIL_OPTIONS_READY` | `awaiting_approval` | `H({stage:"thumbnail_plan",scriptScenesHash,storyBibleHash,scenePlanHash,promptHash,schemaHash,profileHash,codexExecutionPinHash,fontPinHash,layoutTemplateHash})` | `thumbnailPlanHash` | `planning/thumbnail-plan.json` |
| `THUMBNAIL_COPY_SELECTED` | `running` | `H({thumbnailPlanHash,copyId,selectedAt})` | `thumbnailSelectionHash` | `approvals/thumbnail-copy-selection.json` |
| `APPROVAL_TWO_BUNDLE_READY` | `awaiting_approval` | `H({stage:"approval_2_bundle",approvedArtifactSetHash,approvalSchemaHash})` | `approvalTwoBundleHash` | `approvals/approval-2-bundle.json` |
| `APPROVAL_TWO_GRANTED` | `running` | the current revision's `approvedArtifactSetHash` | immutable approval-2 revision bytes `sha256` | current `approvals/approval-2-rNNN.json`, `approvals/current-approval-2.json` |

Each non-user-gate façade recomputes this full input before any Codex call. For every table event, including user selection/approval APIs, collect all history rows with the same `{stage,inputHash}`: zero permits one new transition after output verification followed by a full same-stage/input re-read that must find total cardinality one exact; exactly one whose `to`, `outputHash` and sorted `artifactPaths` equal the locked row permits strict byte/registry/schema/gate re-read and reuse; every other cardinality or value throws `success_evidence_conflict` and appends nothing further. The four option/bundle rows that open a user surface use `awaiting_approval`; selection/grant and all other nonterminal successes use `running`. An exact row plus any duplicate/conflicting row is conflict. A logical-role-only match is not reuse. Tests seed exact-only, conflict-only and exact-plus-conflict histories for each user gate and at least one Codex stage, including wrong-`to` fixtures. Plan 06 uses these same formulas and exact `to` mapping in its read-only forward-cursor scan and invokes a façade only at the earliest unsealed invalid stage; a valid formal approval can aggregate-seal repaired current artifacts even though duration/coverage events are not themselves master stage evidence. An opaque pin-only change in an unsealed or approved dependency closure is still detected and either selects that producer or invalidates the approval before downstream work.

---

## File Structure

- Create `data/yadam/reference/name-bank.v1.json`
  - Generated normalized name, address, taekho, surname, and blocked-name data.
- Create `data/yadam/reference/motif-bank.v1.json`
  - Generated 40 stable motif records and mutation-axis records.
- Create `data/yadam/reference/beat-structure.v1.json`
  - Versioned 15-beat functions, ratios, theme/foreshadow/finale evidence requirements, and exact ending.
- Create `data/yadam/reference/script-rules.v1.json`
  - Versioned disposition/source lock, genre elements, speech/address/prose rules, local gates, warnings, and approval review fields.
- Create `scripts/build_yadam_reference_data.mjs`
  - Development-time normalizer; runtime never parses Markdown.
- Create `scripts/lib/yadam/reference-store.mjs`
  - Loads normalized reference files and enforces source hash/version/count invariants.
- Create `scripts/lib/yadam/name-service.mjs`
  - Deterministic class/gender/use-case candidate selection.
- Create `scripts/lib/yadam/motif-service.mjs`
  - Deterministic motif seed selection with recent-history exclusion.
- Create `scripts/lib/yadam/history-store.mjs`
  - Last-20 completed-job fingerprint persistence.
- Create `scripts/lib/yadam/codex-json-stage.mjs` and `schema-validator.mjs`
  - Canonical Plan 01 stage adapter and deterministic local JSON Schema validation.
- Create `scripts/lib/yadam/concept-service.mjs`
  - Mode-specific concept option generation and provisional selection.
- Create `scripts/lib/yadam/approval-service.mjs`
  - Provisional selections, append-only approval revisions, pointers, artifact-set hashes, and invalidation checks.
- Create `scripts/lib/yadam/story-bible-service.mjs`
  - Approval-1 semantic preservation and canonical fact graph.
- Create `scripts/lib/yadam/script-planner.mjs`
  - Duration-to-segment and beat-to-segment planning without uniform chapter gates.
- Create `scripts/lib/yadam/segment-drafter.mjs`
  - Hash-bound one-segment drafting, repair, and resume.
- Create `scripts/lib/yadam/tts-policy.mjs`
  - Canonical per-scene TTS options hashes; final text uses Plan 01's atomic UTF-8 store.
- Create `scripts/lib/yadam/canonical-script.mjs`
  - Scene normalization, final text rendering, byte spans, and source hashes.
- Create `scripts/lib/yadam/script-validators.mjs`
  - Deterministic hard gates and warning metrics.
- Create `scripts/lib/yadam/coverage-service.mjs`
  - Script/source/beat evidence plus downstream audio, subtitle, and visual coverage sections.
- Create `scripts/lib/yadam/scene-planning-service.mjs` and `thumbnail-service.mjs`
  - Source-grounded visual/TTS scene planning and four provisional thumbnail-copy options.
- Create `scripts/lib/yadam/duration-repair.mjs`
  - One-shot duration decision, constrained repair, and approval-2 rebuild inputs.
- Create `scripts/lib/yadam/script-service.mjs`
  - Public façade listed above.
- Create `prompts/yadam/concept.md`, `story-intro.md`, `outline.md`, `story-bible.md`, `segment-draft.md`, `segment-repair.md`, `final-review.md`, `scene-plan.md`, `thumbnail-plan.md`
  - Stage-specific Codex instructions with no provider execution instructions.
- Create JSON Schemas under `schemas/yadam/`
  - `concept-inputs`, `concept-options`, `hook-brief`, `outline`, `story-bible`, `script-plan`, `segment-draft`, `script-scenes`, `scene-plan`, `qa-report`, `coverage-report`, `thumbnail-plan`, `duration-repair`, and `approval` schemas.
- Create tests under `scripts/test_yadam_*.mjs`
  - The exact 15-file allowlist in Task 14, including separate validator/coverage suites and one fake-Codex end-to-end workflow.
- Create `scripts/run-yadam-script-tests.mjs` and modify `package.json`
  - Deterministic Plan 02 test allowlist and one `npm run test:yadam` gate that includes the Node test tree and script suites.

---

## Task 4: Generate mode-specific concept options and persist a provisional concept selection

**Files:**
- Create: `scripts/test_yadam_concept_service.mjs`
- Create: `scripts/lib/yadam/concept-service.mjs`
- Modify: `scripts/lib/yadam/script-service.mjs` (create the façade with Task 4 exports)
- Use: `prompts/yadam/concept.md`
- Use: `schemas/yadam/concept-inputs.schema.json`
- Use: `schemas/yadam/concept-options.schema.json`

**Interfaces:**
- Implements `generateConceptOptions({ jobDir, historyPath, now })`.
- Implements `selectConcept({ jobDir, candidateId, userInstructions, selectedAt })`.
- Consumes Plan 01 `loadJob`, `writeCanonicalJson`, `registerArtifact`, and `transitionJob` through their fixed import paths.
- Writes `planning/concept-inputs.json`, `planning/concept-options.json`, and `approvals/concept-selection.json`.

- [ ] **Step 1 (5 minutes): Write a fake-Codex concept-generation test.**

Build a temporary genre-mode job fixture from an otherwise complete valid Plan 01 request using overrides `{profileId:"yadam",inputMode:"genre",source:{kind:"genre",value:"권선징악"},targetMinutes:60,seed:1001}` and history containing more than 20 completed stories. Inject a fake `runYadamJsonStage` that returns exactly three schema-valid concepts and echoes the supplied `conceptInputsHash`. Add a reference-mode fixture with overrides `{inputMode:"reference",source:{kind:"reference_title",value:"가난한 선비가 얻은 뜻밖의 복"}}` and exactly four title transformations. Assert a mismatched mode/kind and legacy top-level `genre`/`referenceTitle` fail through Plan 01 before Codex. Assert each concept uses one normalized motif ID, cast names come from the requested class/gender/use-case pools, recent name/motif IDs do not appear, titles end with the fixed suffix, and twist proposals contain exactly six entries. Assert `planning/concept-inputs.json` contains all four verified reference-file hashes plus exactly the latest 20 normalized history projections in chronological order, and that `historySnapshot.hash === hashCanonical(historySnapshot.entries)`. Its registry record must be the single current `{artifactId:"yadam-concept-inputs",logicalRole:"yadam.concept.inputs",path:"planning/concept-inputs.json",gateStatus:"pass"}` record. Assert the `yadam.concept.options` registry record has exactly one dependency hash, named `conceptInputs`, equal to the registered aggregate hash; no raw reference or history hash may appear directly in that dependency map. End with `ok - yadam concept generation`.

- [ ] **Step 2 (3 minutes): Add provisional-selection and reselection tests.**

Select `concept-c02`, compute `conceptOptionsHash` from the written fixture bytes, and assert `concept-selection.json` deep-equals `{schemaVersion:"1.0.0",selectionType:"provisional",candidateId:"concept-c02",selectedAt:"2026-07-16T10:00:00.000Z",userInstructions:"주인공의 신분 상승보다 가족 회복을 강조",conceptOptionsHash}`. Select `concept-c01` next and assert the same file is atomically replaced, no `approval-1-rNNN.json` exists, and `CONCEPT_SELECTED` is emitted again. Assert an unknown candidate throws `candidate_not_found` without a write or state event.

- [ ] **Step 3 (2 minutes): Confirm the tests fail before the service exists.**

Run `node scripts/test_yadam_concept_service.mjs`.

Expected: exit 1 with `ERR_MODULE_NOT_FOUND` for `concept-service.mjs`.

- [ ] **Step 4 (5 minutes): Implement deterministic concept input construction.**

Load the job and require `profileId === "yadam"`; validate target duration with the normalized rule. Resolve and re-hash the passed `pipeline.request` artifact. Load and integrity-check all four repository reference files, then load at most the latest 20 completed fingerprints. Preserve the history contract's exact normalized fields `{jobId,completedAt,nameIds,motifIds,twistCategories,themeLine,titleFingerprint}` in chronological order, and compute `historySnapshot.hash = hashCanonical(historySnapshot.entries)`. Set `optionCount` to four for reference mode or three for genre mode, reserve that many non-overlapping normalized cast candidate sets, and reserve the same number of category-diverse motifs. Materialize this exact closed `conceptInputs` object:

```js
{
  schemaVersion: "1.0.0",
  requestHash,
  job: { jobId, targetMinutes, seed, generatedAt: now },
  requestContext: {
    inputMode: request.inputMode,
    source: { kind: request.source.kind, value: request.source.value },
    optionalInstructions: request.optionalInstructions ?? "",
  },
  referenceHashes: {
    names: string,
    motifs: string,
    beats: string,
    rules: string,
  },
  titleSuffix,
  motifCandidates,
  nameCandidates,
  blockedSpokenNames,
  historySnapshot: {
    limit: 20,
    entries: recentFingerprintSummary,
    hash: hashCanonical(recentFingerprintSummary),
  },
  requirements: {
    optionCount: request.inputMode === "reference" ? 4 : 3,
    twistsPerOption: 6,
    emotionalPointsPerOption: 6,
    spoilerSealRequired: true,
  },
}
```

Validate and canonically write that object to `planning/concept-inputs.json`, re-read it, and register it with stable artifact ID `yadam-concept-inputs`, role `yadam.concept.inputs`, `gateStatus:"pass"`, and owner-backed `dependencyHashes:{pipelineRequest:requestHash}`. Let the returned file SHA-256 be `conceptInputsHash`. Call `runYadamJsonStage` with `stageId: "yadam.concept.options.v1"`, a 180,000 ms timeout, the concept prompt/schema, and input `{conceptInputsHash,conceptInputs}`. Local post-validation must require the payload to echo that exact hash and enforce the mode-specific option count, fixed suffix, unique candidate IDs, allowed motif/name IDs, six twist categories, six emotion-point proposals, and title fingerprints not found in the bounded history snapshot. Reference mode also records immutable preserve/mutate title slots; genre mode records its genre and motif seed. On schema or hard-gate failure, call `yadam.concept.options.v1.repair-1` once with the same immutable input plus sorted violations and the rejected-output hash; a second failure emits `NEEDS_REVIEW` and writes no concept-options artifact.

- [ ] **Step 5 (4 minutes): Persist the concept artifact and provisional selection.**

Write the schema-valid hash-bound payload with `writeCanonicalJson`; register role `yadam.concept.options` with exactly `dependencyHashes:{conceptInputs:conceptInputsHash}` and no direct external hashes, then emit `CONCEPT_OPTIONS_READY`. `selectConcept` reloads and verifies the registered concept-input and concept-options hashes before writing selection. Normalize `userInstructions` to NFC, require at most 2,000 Unicode code points, register role `yadam.concept.selection`, and emit `CONCEPT_SELECTED`. If a prior formal approval 1 exists, selection change also emits the Plan 01 invalidation event named by its state contract before returning to approval-1 composition.

- [ ] **Step 6 (3 minutes): Run the concept test and inspect the registered hashes.**

Run:

```powershell
node scripts/test_yadam_concept_service.mjs
```

Expected:

```text
ok - yadam concept generation
ok - yadam provisional concept reselection
ok - yadam concept artifact dependencies
```

- [ ] **Step 7 (2 minutes): Record the task commit.**

Run `git status --short`, add the three Task 4 files, and commit:

```powershell
git commit -m "feat(yadam): generate and select concept options"
```

Expected now: the documented non-Git skip. In Git, commit only after the Task 4 test passes.

---

## Task 5: Compose approval 1 and write append-only formal approval revisions

**Files:**
- Create: `scripts/test_yadam_approval_one.mjs`
- Create: `scripts/lib/yadam/approval-service.mjs`
- Modify: `scripts/lib/yadam/script-service.mjs`
- Use: `prompts/yadam/story-intro.md`
- Use: `prompts/yadam/outline.md`
- Use: `schemas/yadam/hook-brief.schema.json`
- Use: `schemas/yadam/outline.schema.json`
- Use: `schemas/yadam/approval.schema.json`

**Interfaces:**
- Implements `buildApprovalOneBundle({ jobDir })`.
- Implements `approveConcept({ jobDir, expectedArtifactSetHash, approvedAt, userInstructions })`.
- Produces `planning/hook-brief.json`, `planning/outline.json`, `approvals/approval-1-bundle.json`, `approvals/approval-1-rNNN.json`, and `approvals/current-approval-1.json`.
- `approvedArtifactSetHash` is Plan 01 `hashCanonical` over the sorted `{artifactId,sha256}` array; Plan 01 owns the RFC 8785 implementation.

- [ ] **Step 1 (5 minutes): Write approval-1 bundle hard-gate tests.**

Use a selected concept fixture and fake intro/outline Codex payloads. Assert the builder rejects 5 or 7 intro sentences, fewer than 200 or more than 350 NFC code points, CTA on a sentence other than ordinal 6, 14 or 16 beats, any count other than six twists and six emotional points, any count other than three theme placements or five finale stages, a foreshadow plant without recovery, a changed title suffix, or one changed fixed-ending sentence. Assert rejection emits no `APPROVAL_ONE_BUNDLE_READY` event.

- [ ] **Step 2 (4 minutes): Write revision and artifact-set projection hash tests.**

Inject Plan 01 `hashCanonical`, capture its exact input, and assert the helper passes only artifact-ID-sorted `{artifactId,sha256}` objects. First formal approval must write `approval-1-r001.json` and pointer revision 1. Rebuild the mutable bundle, call approval with the previously displayed hash, and assert `approval_bundle_stale` with no r002 file. A later approval using the new displayed hash must write `approval-1-r002.json`, set `supersedes: "approval-1-r001.json"`, leave r001 bytes unchanged, and atomically move the pointer. After each approval, the manifest must contain exactly one current role `yadam.approval.1` record with stable artifact ID `yadam-approval-1-current`; after r002 its current `path`/hash name r002 and its Plan 01 `revisionHistory` retains the prior r001 path/hash/status. Reordering artifact records must produce the same set hash because records are sorted before the Plan 01 call.

- [ ] **Step 3 (2 minutes): Confirm approval tests are red.**

Run `node scripts/test_yadam_approval_one.mjs`.

Expected: `ERR_MODULE_NOT_FOUND` for `approval-service.mjs`.

- [ ] **Step 4 (3 minutes): Implement the artifact-set projection using Plan 01 canonical hashing.**

Add this helper to `approval-service.mjs`; it validates IDs/hashes before delegating all canonicalization to Plan 01:

```js
import { hashCanonical } from "../pipeline/canonical-json.mjs";

function approvalError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function hashArtifactSet(artifacts) {
  const sorted = artifacts
    .map(({ artifactId, sha256 }) => ({ artifactId, sha256 }))
    .toSorted((left, right) => left.artifactId.localeCompare(right.artifactId));
  if (new Set(sorted.map(({ artifactId }) => artifactId)).size !== sorted.length) {
    throw approvalError("approval_artifact_duplicate", "artifactId values must be unique");
  }
  if (sorted.some(({ sha256 }) => !/^[a-f0-9]{64}$/u.test(sha256))) {
    throw approvalError("approval_artifact_hash_invalid", "artifact sha256 must be lowercase hex");
  }
  return hashCanonical(sorted);
}
```

- [ ] **Step 5 (5 minutes): Compose the approved intro and canonical 15-beat outline.**

`buildApprovalOneBundle` verifies the current provisional selection and concept-options hashes plus the options record's sole current `yadam.concept.inputs` dependency; the options payload's `conceptInputsHash` must match that owner record. Run `yadam.story.intro.v1` from the selected concept plus the selection's normalized user instructions and allow at most `yadam.story.intro.v1.repair-1`; then pass the selected concept, instructions, and accepted intro hash to `yadam.outline.v1`, with at most `yadam.outline.v1.repair-1`. Local gates must bind every twist, emotion point, theme placement, plant/recovery, finale stage, character/relationship proposal, and spoiler seal to existing IDs and one or more `beatId` values. Materialize an artifact list containing roles `yadam.concept.options`, `yadam.concept.selection`, `yadam.hook.brief`, and `yadam.outline`, with schema version/hash and dependency hashes; compute and store `approvedArtifactSetHash = hashArtifactSet(artifactList)` inside the bundle. The bundle includes the selected candidate snapshot resolved from the hash-bound options artifact. Then atomically write and re-read `approval-1-bundle.json`, register/re-read stable artifact ID `yadam-approval-1-bundle` with role `yadam.approval.1.bundle`, `gateStatus:"pass"`, and dependency hashes for those four exact records, and only then emit `APPROVAL_ONE_BUNDLE_READY`.

- [ ] **Step 6 (5 minutes): Implement append-only formal approval writing.**

`approveConcept` requires the 64-character lowercase `expectedArtifactSetHash` supplied by the user-review surface and keeps the two hash domains separate. Reload the current passed `yadam.approval.1.bundle` record, require `sha256(bundle JSON bytes) === bundleRecord.sha256`, then schema-parse it and reload every bundled artifact plus its current dependency closure. Require `parsedBundle.approvedArtifactSetHash === expectedArtifactSetHash === recomputeArtifactSetHash(current artifact projection)`; never compare the bundle-file SHA to the artifact-set SHA. Refuse any mismatch, including a stale/missing `yadam.concept.inputs` owner, with `approval_bundle_stale` before reserving a revision. Never infer consent from whichever mutable bundle is current. Add a fixture where those two legitimate hashes differ and approval still succeeds, then independently tamper each domain. Normalize the user instruction to NFC and persist the exact record:

```js
{
  schemaVersion: "1.0.0",
  approvalType: "approval_1",
  revision,
  supersedes,
  approvedAt,
  userInstructions,
  artifacts: sortedArtifacts,
  approvedArtifactSetHash: hashArtifactSet(sortedArtifacts),
  status: "approved",
}
```

Determine the next revision under the approval lock and write it once with Plan 01 `writeCanonicalJsonExclusive`; an existing target must surface `immutable_target_exists`, never trigger replacement. Re-read and hash the immutable revision. Only then use mutable `writeCanonicalJson` for the pointer `{schemaVersion:"1.0.0",status:"valid",revision,path,sha256,approvedArtifactSetHash}`. Register the immutable revision as `{artifactId:"yadam-approval-1-current",logicalRole:"yadam.approval.1",path:"approvals/approval-1-rNNN.json",sha256,schemaVersion:"1.0.0",producerStage:"approval-1",gateStatus:"pass",dependencyHashes}` where `dependencyHashes` contains every sorted approved artifact ID/hash. Reusing the stable artifact ID replaces only the current registry record and lets Plan 01 retain the prior rNNN path/hash/status in `revisionHistory`; it never mutates that prior file. After re-reading the pointer and registry, call Plan 01 exactly as `transitionJob(jobDir,{stage:"APPROVAL_ONE_GRANTED",to:"running",inputHash:approvedArtifactSetHash,outputHash:revisionSha256,artifactPaths:[approvalRevisionPath,"approvals/current-approval-1.json"].sort()})`. Tests require that exact row and prove no grant row is appended before both files and the current registry record verify.

- [ ] **Step 7 (4 minutes): Run approval-1 tests including immutability.**

Run:

```powershell
node scripts/test_yadam_approval_one.mjs
```

Expected:

```text
ok - approval 1 hard gates
ok - Plan 01 canonical artifact-set hash
ok - append-only approval 1 revisions
```

- [ ] **Step 8 (2 minutes): Record the task commit.**

Run `git status --short`; add the Task 5 files and commit with `git commit -m "feat(yadam): add formal approval one revisions"`. Apply the documented non-Git skip when applicable.

---

## Task 6: Build a canonical story bible without changing approval-1 meaning

**Files:**
- Create: `scripts/test_yadam_story_bible.mjs`
- Create: `scripts/lib/yadam/story-bible-service.mjs`
- Modify: `scripts/lib/yadam/script-service.mjs`
- Use: `prompts/yadam/story-bible.md`
- Use: `schemas/yadam/story-bible.schema.json`

**Interfaces:**
- Implements `buildStoryBible({ jobDir })`.
- Produces role `yadam.story.bible` at `planning/story-bible.json`.
- Produces an immutable `semanticContractHash` used by segment drafting and duration repair.

- [ ] **Step 1 (5 minutes): Write a complete story-bible acceptance fixture.**

The accepted fixture must include stable arrays for characters, relationships, locations, props, wardrobe variants, speech styles, address rules, event order, twists, emotional points, theme placements, foreshadow plants/recoveries, finale stages, spoiler seals, and fixed ending. Each character has `characterId`, normalized chosen name ID, spoken name, class/gender, appearance, base wardrobe, variant IDs, speech register, public address, private address, and forbidden aliases. Pre-image story-bible characters contain no invented `referenceAssetIds`; Plan 04 later creates and registers reference assets from these immutable semantic/variant IDs. Each relationship references two existing character IDs. Each prop/location/variant has a stable ID and first/last beat IDs.

- [ ] **Step 2 (4 minutes): Write semantic-mutation rejection tests.**

Mutate one fixture field at a time: swap two approved event IDs, change a twist category, change a relationship endpoint, remove a spoiler seal, alter the theme line, change the ending, or use a name not in normalized references. Assert one automatic correction call is allowed with machine-readable violation evidence. If the second payload still changes approval-1 meaning, atomically invalidate approval 1, write no story bible, return to the approval-1 gate, and throw `approval1_invalidated`. A second schema-only or referential-integrity failure emits `NEEDS_REVIEW` and throws `story_bible_gate_failed` without pretending approval-1 content changed.

- [ ] **Step 3 (2 minutes): Confirm the test is red.**

Run `node scripts/test_yadam_story_bible.mjs`; expect `ERR_MODULE_NOT_FOUND` for `story-bible-service.mjs`.

- [ ] **Step 4 (5 minutes): Implement approval-1 verification and semantic contract projection.**

Before calling Codex, verify `current-approval-1.json`, its referenced immutable revision, approved artifact-set hash, and the selection/hook/outline hashes. Include the formal approval record's normalized user instructions in the story-bible input, but reject any interpretation that changes the approved projection. Project the immutable semantic contract in this exact shape before Plan 01 canonical hashing:

```js
{
  selectedCandidateId,
  title,
  themeLine,
  characterIds,
  relationshipEdges,
  orderedEventIds,
  twists: twists.map(({ twistId, category, beatId }) => ({ twistId, category, beatId })),
  endingMeaning,
  fixedEnding,
  spoilerSealIds,
}
```

Sort set-like ID arrays, preserve `orderedEventIds` and fixed-ending order, and call Plan 01 `hashCanonical` on the projection.

- [ ] **Step 5 (5 minutes): Implement one bounded semantic correction.**

Run stage `yadam.story.bible.v1`. When local schema or semantic validation fails, run `yadam.story.bible.v1.repair-1` once using the same approved input plus sorted violations and rejected-output hash; do not include rejected prose outside the canonical JSON payload. If the repaired result passes, record both run provenances in artifact dependencies. If it still changes the protected semantic projection, invalidate approval 1; if it fails only schema/referential gates, emit `NEEDS_REVIEW`. Never accept an altered semantic contract hash.

- [ ] **Step 6 (3 minutes): Write and register the canonical story bible.**

Add `approvalOneRevision`, `approvalOneArtifactSetHash`, `semanticContractHash`, `referenceDataHashes`, and `producerProvenance` to the validated payload. Write `planning/story-bible.json`, register role `yadam.story.bible`, and emit `STORY_BIBLE_READY`.

- [ ] **Step 7 (3 minutes): Run story-bible tests.**

Run `node scripts/test_yadam_story_bible.mjs`.

Expected:

```text
ok - canonical yadam story bible
ok - story bible preserves approval one semantics
ok - story bible correction budget is one
```

- [ ] **Step 8 (2 minutes): Record the task commit.**

Run `git status --short`; add the Task 6 files and commit `feat(yadam): build canonical story bible`, or record the non-Git skip.

---

## Task 7: Allocate 15 beats into duration-scaled logical segments

**Files:**
- Create: `scripts/test_yadam_script_planner.mjs`
- Create: `scripts/lib/yadam/script-planner.mjs`
- Modify: `scripts/lib/yadam/script-service.mjs`
- Use: `schemas/yadam/script-plan.schema.json`

**Interfaces:**
- Implements `buildScriptPlan({ jobDir })`.
- Exports `validateTargetMinutes`, `partitionBeatsContiguously`, and `buildDurationPlan` for direct tests.
- Produces role `yadam.script.plan` at `planning/script-plan.json`.

- [ ] **Step 1 (5 minutes): Write target-duration table tests.**

For every accepted duration `[10,20,30,40,50,60,70,80,90,100,110,120]`, assert `segmentCount === targetMinutes / 10`, segment IDs are `segment-01` upward, each `plannedDurationSeconds === 600`, every segment receives at least one beat, beats remain ordered 1–15 and appear exactly once, intro is assigned to segment 1, and ending/finale-05 are assigned to the last segment. Reject 0, 9, 15, 121, strings, `NaN`, and infinity with `target_minutes_invalid`.

- [ ] **Step 2 (4 minutes): Write calibrated character-target and warning tests.**

With `calibratedCharactersPerSecond = 4.2`, assert a 60-minute plan has a total recommended target of `15120` characters. Assert each beat receives a positive target proportional to its normalized reference weight and total rounding error is zero after largest-remainder allocation. Assert segment range 480–720 seconds is stored as a planning warning threshold, never as an independent hard release gate.

- [ ] **Step 3 (2 minutes): Confirm planner tests are red.**

Run `node scripts/test_yadam_script_planner.mjs`; expect `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 4 (5 minutes): Implement deterministic contiguous partitioning.**

Use dynamic programming over the 15 positive beat weights and `segmentCount`. A candidate partition's cost is the sum of squared differences between each segment's weight and `totalWeight / segmentCount`. Require at least one beat per segment. On equal cost, choose the lexicographically earlier cut-index vector. This produces deterministic contiguous groups without reviving incompatible uniform chapter character gates.

- [ ] **Step 5 (5 minutes): Implement largest-remainder character allocation.**

Compute `totalCharacters = Math.round(targetMinutes * 60 * calibratedCharactersPerSecond)`. Normalize beat weights, floor each raw target, then distribute remaining characters by descending fractional remainder with `beatId` ascending as tie-breaker. Aggregate beat targets into segments. Store recommended minimum/maximum as warning bands derived from profile ratios; no segment character count is a hard gate.

- [ ] **Step 6 (4 minutes): Bind every narrative obligation to one segment.**

Copy the approved outline's six twist IDs, six emotion IDs, three theme placements, plant/recovery IDs, and five finale stage IDs into the segment containing their beat. Reject an obligation whose beat is absent. Include `semanticContractHash`, story-bible hash, approval-1 revision/hash, `calibratedCharactersPerSecond`, `planningDurationWarningSeconds:{minimum:480,maximum:720}`, and overall accepted post-TTS range `{minimum:targetMinutes*48,maximum:targetMinutes*72}`.

- [ ] **Step 7 (3 minutes): Persist, register, and test all 12 duration cases.**

Run:

```powershell
node scripts/test_yadam_script_planner.mjs
```

Expected:

```text
ok - yadam target duration matrix
ok - deterministic contiguous beat allocation
ok - calibrated character planning warnings
```

- [ ] **Step 8 (2 minutes): Record the task commit.**

Run `git status --short`; add the Task 7 files and commit `feat(yadam): plan duration scaled script segments`, or record the non-Git skip.

---

## Task 8: Draft and resume one hash-bound logical segment at a time

**Files:**
- Create: `scripts/test_yadam_segment_drafting.mjs`
- Create: `scripts/lib/yadam/segment-drafter.mjs`
- Modify: `scripts/lib/yadam/script-service.mjs`
- Modify: `schemas/yadam/segment-draft.schema.json`
- Use: `prompts/yadam/segment-draft.md`
- Use: `schemas/yadam/segment-draft.schema.json`

**Interfaces:**
- Implements `draftNextSegment({ jobDir })`.
- Returns `{status:"drafted",segmentId,relativePath,sha256,remainingSegments}` or `{status:"complete",remainingSegments:0}`.
- Produces one role `yadam.script.segment` at `script/chapters/segment-XX.json` per logical segment, where `XX` is the zero-padded two-digit ordinal.

- [ ] **Step 1 (5 minutes): Write first-, middle-, and last-segment fixtures.**

The first fixture must reproduce the approved six intro sentences byte-for-byte after NFC normalization, retain sentence ordinals and `cta: true` only for sentence 6, and cover its assigned beat IDs. The middle fixture must include incoming continuity state, required events and evidence IDs, plus an outgoing continuity snapshot. Every scene includes `delivery:{readSlow:boolean,continuousNext:boolean}`; `continuousNext` is false at segment boundaries and fixed-ending scenes. The last fixture must end with three separate `sceneRole: "fixed_ending"` scenes whose text equals the three fixed ending strings in order.

- [ ] **Step 2 (4 minutes): Write interruption/resume and dependency tests.**

Draft segment 1, recreate the service, and call again; assert it drafts segment 2 without rerunning segment 1. Tamper with the story-bible hash and assert the existing segment is stale and cannot be silently reused. Assert a segment file is never visible as `pass` until schema and local obligations succeed. Assert a completed plan returns `status:"complete"` without calling Codex.

- [ ] **Step 3 (4 minutes): Write bounded repair tests.**

Return an invalid segment missing a required twist evidence ID, then a corrected payload; assert exactly two Codex calls and one registered artifact. Return two invalid payloads; assert `NEEDS_REVIEW`, no segment artifact, and `segment_gate_failed`. Assert the second call receives sorted violation records with `code`, `segmentId`, `requiredId`, and rejected-output hash.

- [ ] **Step 4 (2 minutes): Confirm drafting tests are red.**

Run `node scripts/test_yadam_segment_drafting.mjs`; expect `ERR_MODULE_NOT_FOUND` for `segment-drafter.mjs`.

- [ ] **Step 5 (5 minutes): Implement pending-segment resolution and canonical stage input.**

Reload the registered script plan, story bible, outline, and approval-1 pointer every call. Verify hashes before deciding the first non-passing segment. The stage input contains only:

```js
{
  schemaVersion: "1.0.0",
  segment: plannedSegment,
  approvedIntro: isFirst ? hookBrief.sentences : null,
  fixedEnding: isLast ? beatReference.fixedEnding : null,
  storyFacts: storyBible,
  canonicalOutline: outline,
  priorContinuity: previousSegment?.outgoingContinuity ?? storyBible.initialContinuity,
  priorTail: previousSegment?.scenes.slice(-2).map(({ sceneId, text }) => ({ sceneId, text })) ?? [],
  obligations: plannedSegment.obligations,
  styleRules: profile.scriptStyle,
}
```

Use `stageId: "yadam.script.segment-NN.v1"` and a 300,000 ms timeout. A repair call uses suffix `.repair-1`, the same immutable input, rejected-output hash, and sorted violations.

- [ ] **Step 6 (5 minutes): Implement local segment gates and global scene-ID assignment.**

Require every planned beat/event/twist/emotion/theme/foreshadow/finale ID to have at least one evidence item referencing a scene ordinal in the returned segment. Require incoming continuity to match the previous outgoing continuity for active character, location, carried props, wardrobe variant, known facts, time-of-day, and unresolved foreshadow IDs. Validate the two delivery booleans, require `continuousNext:false` on every segment-final and fixed-ending scene, and reject more than four consecutive `continuousNext:true` scenes. Assign global IDs only after passing validation: count scenes in earlier passing segments and assign `scene-${String(globalOrdinal).padStart(4,"0")}`. Rewrite evidence ordinals to those IDs locally; Codex never chooses global IDs.

- [ ] **Step 7 (4 minutes): Enforce exact intro/ending and persist resumable output.**

For segment 1, concatenate `sceneRole:"story_intro"` texts by sentence ordinal and compare each normalized sentence to `hook-brief.json`; do not accept paraphrases. For the final segment, compare the last three scenes to `fixedEnding` exactly. Add dependency hashes, stage provenance, repair count, and `gateStatus`. Write canonical JSON, register the segment role with artifact ID `yadam-script-segment-NN`, and emit `SEGMENT_DRAFTED`.

- [ ] **Step 8 (3 minutes): Run drafting and resume tests.**

Run:

```powershell
node scripts/test_yadam_segment_drafting.mjs
```

Expected:

```text
ok - exact intro and ending segment gates
ok - hash-bound segment resume
ok - one bounded segment repair
```

- [ ] **Step 9 (2 minutes): Record the task commit.**

Run `git status --short`; add the Task 8 files and commit `feat(yadam): draft resumable script segments`, or record the non-Git skip.

---

## Task 9: Materialize canonical script scenes, final text, and UTF-8 byte spans

**Files:**
- Create: `scripts/test_yadam_canonical_script.mjs`
- Create: `scripts/lib/yadam/canonical-script.mjs`
- Create: `scripts/lib/yadam/tts-policy.mjs`
- Modify: `scripts/lib/yadam/script-service.mjs`
- Use: `schemas/yadam/script-scenes.schema.json`

**Interfaces:**
- Implements the materialization portion of `finalizeScriptPackage({ jobDir })`.
- Exports `canonicalizeSceneText`, `normalizeTtsText`, `renderCanonicalFinalText`, and `buildCanonicalScriptScenes`.
- Produces role `yadam.script.scenes` at `script/script-scenes.json` and role `yadam.script.final_text` at `script/final.txt`.

- [ ] **Step 1 (5 minutes): Write Unicode and separator byte-span tests.**

Use scene texts `"첫 장면🙂"`, `"둘째\r\n장면"`, and `"마지막 장면"`. Assert canonical text is exactly `"첫 장면🙂\n\n둘째\n장면\n\n마지막 장면\n"`, contains no BOM or CR byte, and ends with exactly one LF. For each source span, slice the UTF-8 `Buffer` using `[startByte,endByteExclusive)` and assert it decodes to that scene's `sourceText`. Assert the emoji advances byte offsets by four, proving offsets are not UTF-16 indexes.

- [ ] **Step 2 (4 minutes): Write canonical hash and stable-order tests.**

Assert `sourceHash` is SHA-256 of the exact NFC `sourceText` UTF-8 bytes; `ttsNormalizedText` collapses all Unicode whitespace runs to one ASCII space and trims; `ttsNormalizedHash` hashes that text. Assert `ttsOptionsHash` is Plan 01 `hashCanonical` of `{model,voice,language,speed,totalStep,silenceSeconds,readSlow,continuousNext}`, where the two flags come from the validated segment delivery field and `silenceSeconds` is 0.04 when continuous and 0.38 otherwise. Run the builder twice and assert identical final bytes, scene JSON bytes, spans, and hashes.

- [ ] **Step 3 (3 minutes): Write Plan 01 atomic-store integration failure tests.**

Inject a Plan 01-compatible `writeUtf8Atomic` fake that throws before commit and assert the finalizer does not register final text or script scenes and emits no ready event. With the real Plan 01 function's fault hook from its own tests, assert the previous `final.txt` bytes remain and returned `{sha256,sizeBytes}` match independently encoded UTF-8 bytes after a successful retry. Plan 02 does not implement temp, sync, rename, or cleanup behavior.

- [ ] **Step 4 (2 minutes): Confirm canonical-script tests are red.**

Run `node scripts/test_yadam_canonical_script.mjs`; expect `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 5 (5 minutes): Implement exact scene and TTS normalization.**

Use these transformations in this order:

```js
export function canonicalizeSceneText(value) {
  const text = value.normalize("NFC").replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
  if (!text) throw codedError("scene_text_empty", "scene text must not be empty");
  if (text.includes("\u0000")) throw codedError("scene_text_nul", "scene text contains NUL");
  return text;
}

export function normalizeTtsText(sourceText) {
  return sourceText.normalize("NFC").replace(/\s+/gu, " ").trim();
}
```

Do not strip punctuation, dialogue quotes, honorifics, or the CTA. In `tts-policy.mjs`, export `buildTtsOptions({profile,delivery})` and `hashTtsOptions(options)`; v1 always uses the audited `profile.tts.speed` value 1.04 while retaining `readSlow` as a reviewable, hash-bound semantic flag. Use the exact silence rule above, reject unknown keys, and delegate object hashing to Plan 01 `hashCanonical` once per scene. A distinct slow speed requires a later audition and profile schema/version change; do not inherit the unaudited scripture value 0.96.

- [ ] **Step 6 (5 minutes): Implement byte-span rendering without substring index conversion.**

For each scene in global ordinal order, encode its canonical text to a `Buffer`, set `startByte` to accumulated byte length, set `endByteExclusive = startByte + sceneBuffer.length`, append the scene buffer, append two LF bytes between scenes, and append one LF byte after the last scene. Structural separator bytes belong to no scene span. Decode the final buffer once as `finalText` and verify re-encoding produces identical bytes.

- [ ] **Step 7 (5 minutes): Build the machine source of truth.**

`script-scenes.json` stores schema/profile/job IDs, approval-1 revision/hash, story-bible and script-plan hashes, semantic contract hash, canonicalization policy, title, derived `finalTextHash`, `sceneTextProjectionHash`, and ordered scenes. Every scene stores `sceneId`, `segmentId`, global `ordinal`, roles, beat/evidence IDs, `sourceText`, `sourceSpan`, `sourceHash`, `ttsNormalizedText`, `ttsNormalizedHash`, `ttsOptionsHash`, and `ttsRequired/subtitleRequired` booleans. Verify scene IDs and ordinals are contiguous and unique.

- [ ] **Step 8 (4 minutes): Write both artifacts and verify them before registration.**

Write the exact rendered string to `final.txt` using Plan 01 `writeUtf8Atomic`; require its returned hash/size to equal independent `Buffer.from(finalText,"utf8")` calculations. Write `script-scenes.json` with `writeCanonicalJson`. Re-read both, recompute every span/hash and schema validation, then register both artifacts. The script-scenes artifact depends on every segment hash and records the derived final-text hash without depending on the final-text registry record. The final-text artifact depends on `sceneTextProjectionHash` and every segment hash, not the script-scenes artifact hash, so the dependency graph has no cycle. Emit no ready event until both re-reads pass.

- [ ] **Step 9 (3 minutes): Run canonicalization tests.**

Run `node scripts/test_yadam_canonical_script.mjs`.

Expected:

```text
ok - canonical yadam final text bytes
ok - UTF-8 half-open source spans
ok - canonical scene and TTS hashes
ok - atomic final text replacement
```

- [ ] **Step 10 (2 minutes): Record the task commit.**

Run `git status --short`; add the Task 9 files and commit `feat(yadam): materialize canonical script scenes`, or record the non-Git skip.

---

## Task 10: Validate semantic evidence and maintain cross-media coverage

**Files:**
- Create: `scripts/test_yadam_script_validators.mjs`
- Create: `scripts/test_yadam_coverage_service.mjs`
- Create: `scripts/lib/yadam/script-validators.mjs`
- Create: `scripts/lib/yadam/coverage-service.mjs`
- Modify: `scripts/lib/yadam/script-service.mjs`
- Use: `prompts/yadam/final-review.md`
- Use: `schemas/yadam/qa-report.schema.json`
- Use: `schemas/yadam/coverage-report.schema.json`

**Interfaces:**
- Completes `finalizeScriptPackage({ jobDir })` by producing QA and the initial coverage report.
- Implements `updateCoverageSection({ jobDir, section, report })` for downstream `audio`, `subtitle`, and `visual` sections.
- Produces `script/qa-report.json` and `script/coverage-report.json`.

- [ ] **Step 1 (5 minutes): Write a hard-gate test matrix.**

Build one passing script fixture, then individually remove or alter: fixed title suffix; one intro sentence; intro CTA mark; 200/350 intro boundary; one of 15 beats; one of six twists; one of six emotions; one of three themes; a plant/recovery pair; one of five finale stages; one fixed ending sentence; one referenced scene ID; one story-bible character; age consistency; relationship direction; event/time chronology; prop ownership transition; paired dialogue quotes; forbidden Hanja; model/process meta text; spoiler timing; expected TTS scene set; one required source span. Span coverage means every non-separator final-text byte appears in exactly one scene span and reinserting the prescribed two-LF separators plus terminal LF reproduces the whole file. Assert deterministic error codes and evidence IDs, and assert no generic pass result is possible. The pristine-job fixture deliberately omits `script/coverage`; the first finalization must create it safely, while a file or junction planted at that path and any re-resolved parent outside the job root must fail before a coverage byte or registry row is written.

- [ ] **Step 2 (4 minutes): Test final-review evidence verification.**

Fake Codex final review returns observations with `{ruleId,status,evidenceSceneIds,explanation}`. Assert local validation rejects a nonexistent scene, a beat evidence scene that lacks that beat ID, a spoiler-sealed fact exposed before its allowed beat, and `pass` without evidence for an evidence-required rule. Codex may add warnings but cannot override local hard failures.

- [ ] **Step 3 (5 minutes): Write coverage update authorization tests.**

Initial report must have `script.status:"pass"` and `audio/subtitle/visual.status:"pending"`. Reject public updates to `script`, unknown sections, stale `scriptScenesHash`, missing expected scene IDs, duplicate/orphan IDs, or artifact references absent from Plan 01's registry. Accept each downstream section once its section schema and dependency hashes pass; allow a replacement only when the previous section's dependency hash differs. `complete` is true only when all four sections pass.

- [ ] **Step 4 (2 minutes): Confirm both test files are red.**

Run:

```powershell
node scripts/test_yadam_script_validators.mjs
node scripts/test_yadam_coverage_service.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` for the respective service modules.

- [ ] **Step 5 (5 minutes): Implement deterministic local hard gates.**

Return sorted `{severity:"error"|"warning",code,message,evidenceIds}` records. Hard errors cover every matrix case from Step 1, unknown/blocked/duplicate names, duplicate stable IDs, invalid source spans, final-text mismatch, and semantic-contract hash mismatch. Implement age, relationship, chronology, prop, quote, Hanja, meta-text, spoiler, and expected-audio-set checks as real traversals over story-bible/script evidence rather than constant pass flags. Warning metrics report planned character variance, segment duration risk, dialogue share, sentences over 25 code points, repeated endings/words, long narration blocks, rhetorical-question frequency, repeated time expressions, and derogatory address terms; thresholds come from `script-rules.v1.json` and each warning carries numeric observed/threshold values. Warnings cannot hide errors. Registry `gateStatus` is `pass` when warnings are empty and `warning` otherwise; the QA report may additionally render the human label `PASS_WITH_WARNINGS`.

- [ ] **Step 6 (5 minutes): Merge local and Codex review without trusting invented evidence.**

Run stage `yadam.script.final-review.v1` only after local structural gates pass. Resolve every returned evidence ID against `script-scenes.json` and verify its declared beat/event/character relationships. Write QA with separate `localChecks`, `semanticReview`, `warnings`, `hardErrors`, `gateStatus`, `scriptScenesHash`, `finalTextHash`, story-bible hash, schema hashes, and provenance. If the Codex payload is invalid, call `yadam.script.final-review.v1.repair-1` once; a second failure emits `NEEDS_REVIEW`.

- [ ] **Step 7 (5 minutes): Implement coverage sections with exact expected ID sets.**

The script section records evidence coverage for all 15 beats, intro, ending, six twists, six emotions, three themes, all foreshadow pairs, and five finale stages. Audio must cover every `ttsRequired` scene exactly once; subtitle every `subtitleRequired` scene exactly once after normalization; visual must cover every audio-scene time range and every planned visual slot exactly once. Each section document contains `schemaVersion`, section, revision, status, `scriptScenesHash`, `expectedIds`, `coveredIds`, `missingIds`, `duplicateIds`, `orphanIds`, artifact refs, and dependency hash. Recompute set differences locally. Section files are append-only `script/coverage/<section>-rNNN.json`; stable artifact IDs `yadam-coverage-<section>-current` move the singleton current roles `yadam.coverage.script|audio|subtitle|visual` while retaining prior revisions. The mutable `script/coverage-report.json` is only the derived aggregate over the four exact current section records and never substitutes for a subsystem-owned section in success evidence. Under the same per-job lock used for section publication, resolve `script/coverage` from the already verified job root, reject a pre-existing non-directory/reparse escape, create the contained parent with `mkdir({recursive:true})` when absent, and re-resolve/recheck containment immediately before every exclusive section write. Never rely on Plan 01's pristine layout to have created this Plan 02-owned directory.

- [ ] **Step 8 (4 minutes): Persist QA/coverage and finish the script-package state.**

Write/register `yadam.script.qa`, initial append-only r001 records for all four coverage roles (`script` pass; `audio`, `subtitle`, and `visual` explicit pending with exact expected IDs), and derived `yadam.coverage.report`. Before the first r001 write, perform the locked contained-parent creation and post-creation re-resolution from Step 7; failure leaves all four roles and the aggregate absent. Keep finalization inside the script-package stage until Task 11's scene plan also verifies; `SCRIPT_PACKAGE_READY` is emitted there. `updateCoverageSection` takes a per-job lock, reloads all current section roles and registry, verifies the submitted section, repeats the contained-parent check, and reuses an exact current pass revision or exclusively writes the next `script/coverage/<section>-rNNN.json` before moving that section's stable record. It then deterministically rebuilds the aggregate from the four current section records, atomically writes/registers its new revision, emits one exact `COVERAGE_SECTION_UPDATED`, re-reads section plus aggregate, and returns:

```js
{
  relativePath: "script/coverage-report.json",
  sha256,
  sectionArtifact: { section, relativePath: `script/coverage/${section}-rNNN.json`, sha256: sectionSha256, revision },
  complete,
  sections: {
    script: "pass",
    audio: "pending" | "pass",
    subtitle: "pending" | "pass",
    visual: "pending" | "pass",
  },
}
```

The aggregate record dependencies contain exactly the four current section artifact IDs/hashes. Missing sections appear as explicit pending placeholders only during initial/repair construction; no pass section is inferred from aggregate text. If aggregate bytes/record are missing or stale while the submitted section revision is already exact, `updateCoverageSection` performs zero provider work and rebuilds only the aggregate. Same section/input with conflicting current revision evidence is `coverage_section_conflict`. Tests independently tamper each section and the aggregate and prove the owning downstream façade can repair only its own section plus the derived aggregate.

- [ ] **Step 9 (3 minutes): Run validator and coverage suites.**

Run:

```powershell
node scripts/test_yadam_script_validators.mjs
node scripts/test_yadam_coverage_service.mjs
```

Expected:

```text
ok - yadam script hard gate matrix
ok - verified semantic review evidence
ok - cross-media coverage updates
```

- [ ] **Step 10 (2 minutes): Record the task commit.**

Run `git status --short`; add the Task 10 files and commit `feat(yadam): validate script and coverage evidence`, or record the non-Git skip.

---

## Task 11: Create the source-grounded scene plan and four thumbnail-copy options

**Files:**
- Create: `scripts/test_yadam_scene_thumbnail_planning.mjs`
- Create: `scripts/lib/yadam/scene-planning-service.mjs`
- Create: `scripts/lib/yadam/thumbnail-service.mjs`
- Modify: `scripts/lib/yadam/canonical-script.mjs`
- Modify: `scripts/lib/yadam/script-service.mjs`
- Use: `prompts/yadam/scene-plan.md`
- Use: `prompts/yadam/thumbnail-plan.md`
- Use: `schemas/yadam/scene-plan.schema.json`
- Use: `schemas/yadam/thumbnail-plan.schema.json`

**Interfaces:**
- Adds internal `buildScenePlan({ jobDir })`, invoked by `finalizeScriptPackage` before it returns.
- Implements `generateThumbnailPlan({ jobDir })`.
- Implements `selectThumbnailCopy({ jobDir, copyId, selectedAt })`.
- Produces `planning/scene-plan.json`, `planning/thumbnail-plan.json`, and provisional `approvals/thumbnail-copy-selection.json`.

- [ ] **Step 1 (5 minutes): Verify TTS delivery fields across segment, script, and scene-plan fixtures.**

Load the Task 8 segment fixtures and Task 9 script artifact. Assert every drafted scene carries `delivery:{readSlow:boolean,continuousNext:boolean}`, the segment constraints still pass, and canonical `script-scenes.json` retains only the derived `ttsOptionsHash`, not the two flags. The flags' reviewable approved source is `scene-plan.json`.

- [ ] **Step 2 (5 minutes): Write exact TTS-options hash tests.**

For each scene, derive the options object in this exact shape and pass it to Plan 01 `hashCanonical`:

```js
{
  model: profile.tts.model,
  voice: profile.tts.voice,
  language: profile.tts.language,
  speed: profile.tts.speed,
  totalStep: profile.tts.totalStep,
  silenceSeconds: scene.delivery.continuousNext ? 0.04 : 0.38,
  readSlow: scene.delivery.readSlow,
  continuousNext: scene.delivery.continuousNext,
}
```

Assert the v1 profile speed is exactly 1.04 and both `readSlow` values still serialize `speed:1.04`; changing `readSlow` changes `ttsOptionsHash` because the flag itself is hash-bound, not because an unaudited speed is substituted. Assert changing either flag changes the hash, scene-plan flags recompute the exact hash stored in script-scenes, and `getApprovedTtsInput` does not expose either flag.

- [ ] **Step 3 (5 minutes): Write visual-slot planning gates.**

For a 10-minute fixture, assert the default planned slot count is 28: ten approximately six-second intro slots plus eighteen approximately thirty-second body slots. For 120 minutes, assert the deterministic default is 248 and never exceeds 260. Intro planned durations are 5–7 seconds; body durations are 20–40 seconds. Every slot has `visualSlotId`, `order`, `sourceSceneIds`, one `primarySceneId` contained in that array, purpose, planned duration, character/location/prop/wardrobe IDs, evidence IDs, and spoiler-seal constraints.

- [ ] **Step 4 (4 minutes): Write CTA and long-hold regression tests.**

Assert the sixth intro CTA scene is included in the last hook slot's `sourceSceneIds`; no slot is created only for the CTA; that existing slot has `extendedHold:true` and `holdReason:"story_intro_cta"`. For any intentional long still, assert the same slot's planned end is extended and there is one image requirement, rather than a second slot with the same source.

- [ ] **Step 5 (5 minutes): Write thumbnail option and selection tests.**

Require exactly four options `copy-01`–`copy-04`. Each has exact Korean `lines`, `exactText`, one layout enum, and a normalized geometry template with `textRect`, alignment, max line count, font family/weight, font-size range, outline, shadow, and 0.04 edge margin. Assert all coordinates lie within 0–1, text does not reveal any spoiler-sealed fact, and a selected copy exists in the plan. Reselecting copy rewrites only the provisional selection; it never increments approval 2.

- [ ] **Step 6 (2 minutes): Confirm the combined planning test is red.**

Run `node scripts/test_yadam_scene_thumbnail_planning.mjs`; expect `ERR_MODULE_NOT_FOUND` for `scene-planning-service.mjs`.

- [ ] **Step 7 (5 minutes): Bind the existing TTS policy to the reviewable scene plan.**

Import Task 9's `buildTtsOptions({profile,delivery})` and `hashTtsOptions(options)`. `scene-planning-service.mjs` copies `readSlow` and `continuousNext` from the registered segment artifacts into `scenePlan.scenes[].tts`, recomputes the options hash using the current profile, and rejects any mismatch with script-scenes as `tts_options_hash_mismatch`.

- [ ] **Step 8 (5 minutes): Generate and locally ground the scene plan.**

Run stage `yadam.scene.plan.v1` with canonical script-scene IDs/source hashes/spans, story-bible facts, outline evidence, spoiler seals, and deterministic target slot bands. Codex chooses narrative grouping and visual purposes, but local code assigns ordered `visualSlotId` values, geometry-independent planned ranges, and dependency hashes. Reject unknown source/character/location/prop/variant IDs, a primary scene outside its source array, a missing TTS entry, invalid slot bands, duplicate slot orders, new CTA-only slots, or source scenes absent from all slots. Run `yadam.scene.plan.v1.repair-1` once with sorted violations; a second failure emits `NEEDS_REVIEW`.

- [ ] **Step 9 (5 minutes): Generate four spoiler-safe copy options with local layout templates.**

Run stage `yadam.thumbnail.plan.v1` from title, theme, approved non-sealed hook facts, character IDs, and spoiler seals. Codex returns the four copy texts and enum choices; local code injects the exact geometry template for the enum, never model-provided coordinates. Run `yadam.thumbnail.plan.v1.repair-1` once for count, layout, exact-text, or spoiler violations; a second failure emits `NEEDS_REVIEW`. Pin compositor font metadata to `C:/Windows/Fonts/malgunbd.ttf` hash `e8cbc0b2afcc14fb45dfb6086d5102c0b23a96e7b6e708f3122acde1b86c9082` and fallback `C:/Windows/Fonts/malgun.ttf` hash `7a183cf1c6c56b9609fcc16eda8b5229fbc11758a21e669ec00343239b02192f`.

- [ ] **Step 10 (4 minutes): Persist scene/thumbnail plans and provisional selection.**

Register role `yadam.scene.plan`. Emit `SCRIPT_PACKAGE_READY` only after script scenes, final text, QA, coverage script section, and scene plan all verify together, using the locked evidence table. `generateThumbnailPlan` separately registers `yadam.thumbnail.plan`, re-reads its schema/hash/dependencies, and appends the exact `THUMBNAIL_OPTIONS_READY` row before returning. `selectThumbnailCopy` writes `{schemaVersion:"1.0.0",selectionType:"provisional",copyId,selectedAt,thumbnailPlanHash,layout,exactText}`, registers/re-reads `yadam.thumbnail.selection`, and calls exactly `transitionJob(jobDir,{stage:"THUMBNAIL_COPY_SELECTED",to:"running",inputHash:hashCanonical({thumbnailPlanHash,copyId,selectedAt}),outputHash:thumbnailSelectionHash,artifactPaths:["approvals/thumbnail-copy-selection.json"]})`. A prior approval 2 is invalidated when the selection hash changes. Tests reject stale plan/copy/timestamp/output/path evidence and prove no duplicate row on exact idempotent reuse.

- [ ] **Step 11 (3 minutes): Run the scene/thumbnail planning suite.**

Run:

```powershell
node scripts/test_yadam_scene_thumbnail_planning.mjs
```

Expected:

```text
ok - scene TTS policy hashes
ok - source-grounded visual slot plan
ok - CTA and extended hold reuse one slot
ok - four provisional thumbnail copies
```

- [ ] **Step 12 (2 minutes): Record the task commit.**

Run `git status --short`; add the Task 11 files and commit `feat(yadam): plan scenes and thumbnail copy`, or record the non-Git skip.

---

## Task 12: Compose approval 2, approve immutable revisions, and expose approved handoffs

**Files:**
- Create: `scripts/test_yadam_approval_two.mjs`
- Modify: `scripts/lib/yadam/approval-service.mjs`
- Modify: `scripts/lib/yadam/script-service.mjs`
- Use: `schemas/yadam/approval.schema.json`

**Interfaces:**
- Implements `buildApprovalTwoBundle({ jobDir, previewArtifacts })`.
- Implements `approveProduction({ jobDir, expectedArtifactSetHash, approvedAt, userInstructions })`.
- Implements `getApprovedTtsInput(jobDir)` and `getApprovedVisualPlanningInput(jobDir)`.
- Produces `approvals/approval-2-bundle.json`, append-only `approvals/approval-2-rNNN.json`, and atomic `approvals/current-approval-2.json`.

- [ ] **Step 1 (5 minutes): Write approval-2 completeness tests.**

Build one complete fixture and remove each required item in turn. The bundle's approved artifact set must include registered/hash-verified final text, script scenes plus schema version/hash, scene plan plus schema version/hash, story bible plus schema version/hash, script QA, the immutable current passed `yadam.coverage.script` revision, thumbnail plan, provisional selected copy, composed thumbnail preview, registered reserved-rectangle guide, provisional canonical character-reference set, representative intro/body/climax previews, and style profile. It must explicitly exclude mutable `yadam.coverage.report`, whose audio/subtitle/visual bindings are expected to advance after approval; the bundle may display a derived coverage summary only as non-approved review metadata labeled with its then-current hash. Every approved registry record must have `gateStatus:"pass"`; `warning`, `pending`, `fail`, or `invalidated` cannot enter the formal production handoff. Each missing, stale, non-pass, or unregistered required item must fail with a specific `approval_two_artifact_missing`, `approval_two_artifact_not_passed`, or `approval_two_artifact_stale` detail and write no bundle. After approval, updating only audio/subtitle/visual sections plus the aggregate must leave the approval valid, while replacing `yadam.coverage.script` or its dependency closure must invalidate it.

- [ ] **Step 2 (5 minutes): Write preview-shape and dependency tests.**

Use the exact `previewArtifacts` shape from the public contract. Assert exactly five top-level keys (`thumbnailPreview`, `thumbnailGuide`, `characterReferenceSet`, `representativePreviews`, `styleProfile`) and exactly seven flattened artifacts are present, including the three distinct representative roles `intro|body|climax`; every relative path remains under the job directory; every hash is lowercase SHA-256; registry records match. Require `thumbnailGuide` to equal the current passed stable `yadam.thumbnail.guide` record and its background/selection/geometry/compositor dependency projection. Representative preview dependencies bind scene-plan, source-scene, character-reference-set, style-profile, workflow, model, and seed hashes; thumbnail preview dependencies bind selected-copy/layout/background/font/compositor hashes.

- [ ] **Step 3 (4 minutes): Write append-only approval-2 revision tests.**

Approve the first bundle as r001 by passing its displayed artifact-set hash, then rebuild changed preview/copy inputs and prove the old displayed hash is rejected without a revision write. Approve the rebuilt hash as r002. Assert r001 bytes never change, r002 supersedes r001, pointer movement is atomic, and `approvedArtifactSetHash` changes. Assert the manifest contains exactly one current role `yadam.approval.2` record with stable artifact ID `yadam-approval-2-current`; after r002 its current `path`/hash name r002 and its Plan 01 `revisionHistory` retains r001 path/hash/status. For each revision assert the matching `APPROVAL_TWO_GRANTED` row has `inputHash` equal to that revision's `approvedArtifactSetHash`, `outputHash` equal to its immutable revision bytes SHA-256, and exactly the sorted revision/pointer paths; stale r001 evidence cannot authorize current r002. Formal revision increments only in `approveProduction`; bundle rebuild and provisional copy reselection do not count as approval.

- [ ] **Step 4 (5 minutes): Write approved TTS/visual handoff tamper tests.**

For TTS, assert the exact public return shape, ordered scenes, normalized text/hash/options hash, and `approvalRevisionPath`. For visual planning, assert the approved story-bible, scene-plan, thumbnail-plan, copy selection, artifact-set hash, and spoiler seals. Tamper separately with pointer hash, approval revision bytes, artifact-set hash, final text, script scenes, scene plan, current script-coverage revision, or schema hash; both getters must throw an error whose `code` is `approval2_not_valid`. In a separate fixture, advance only `yadam.coverage.audio|subtitle|visual` and the derived aggregate while leaving `yadam.coverage.script` exact; both getters and the current formal approval must remain valid.

- [ ] **Step 5 (2 minutes): Confirm approval-2 tests are red.**

Run `node scripts/test_yadam_approval_two.mjs`; expect failures for the unimplemented Task 12 exports.

- [ ] **Step 6 (5 minutes): Build the exact artifact set and human review bundle.**

Sort only the approved artifact entries by `artifactId`, retain `{artifactId,logicalRole,path,sha256,schemaVersion,schemaHash,dependencyHashes}`, pass the `{artifactId,sha256}` projection to the approval helper backed by Plan 01 `hashCanonical`, and store its result inside the bundle as `approvedArtifactSetHash`. The approved array contains the current passed `yadam.coverage.script` and `yadam.thumbnail.guide` records and never `yadam.coverage.report`; reject any omission/inclusion error before hashing. Under the approval lock derive and store `candidateApprovalRevision = lastFormalApprovalRevision + 1`; identical current inputs reuse the same candidate/bundle, while any already existing target `rNNN` makes the bundle stale rather than silently renumbering it. Record explicit `finalTextHash`, `scriptScenesHash/scriptScenesSchemaVersion/scriptScenesSchemaHash`, `scenePlanHash/scenePlanSchemaVersion/scenePlanSchemaHash`, `storyBibleHash`, `scriptQaHash`, `scriptCoverageHash/scriptCoveragePath/scriptCoverageRevision`, `selectedThumbnailCopyHash`, `thumbnailPreviewHash`, `thumbnailGuideHash`, `characterReferenceSetHash`, `representativePreviewSetHash`, and `styleProfileHash`; compute the representative set hash with `hashCanonical` over role-sorted `{role,artifactId,sha256}` entries. The human review payload includes final title, full final text path/hash, target/segment table, story-bible summary, QA status/warnings, the immutable script-coverage evidence, selected exact thumbnail text/layout, thumbnail preview, character-reference contact sheet, three labeled representative previews, style profile, and registered reserved-text-rectangle guide overlay. A then-current aggregate coverage summary may appear only in a separate `reviewMetadata` object and contributes to neither the approved array, its dependency map nor `approvedArtifactSetHash`. Atomically write and re-read `approval-2-bundle.json`, register/re-read stable artifact ID `yadam-approval-2-bundle` with role `yadam.approval.2.bundle`, `gateStatus:"pass"`, and dependency hashes for the complete sorted approved artifact set only, and only then emit `APPROVAL_TWO_BUNDLE_READY`.

- [ ] **Step 7 (5 minutes): Implement formal approval and provisional reference promotion.**

Require the 64-character lowercase `expectedArtifactSetHash` displayed by the review surface and keep file identity separate from approval-set identity. Reload the current passed `yadam.approval.2.bundle` record and require `sha256(bundle JSON bytes) === bundleRecord.sha256`; after schema parsing and rehashing every current approved dependency, require `parsedBundle.approvedArtifactSetHash === expectedArtifactSetHash === recomputeArtifactSetHash(current approved artifact projection)`. Require exactly one current passed `yadam.coverage.script` entry and zero `yadam.coverage.report` entries in that projection. Never compare the bundle-file SHA to the artifact-set SHA. Add a valid fixture where they differ, plus independent file-hash and set-hash tamper cases, and reject any disagreement with `approval_bundle_stale` before selecting a revision under the approval lock. Require `parsedBundle.candidateApprovalRevision === lastFormalApprovalRevision + 1` and that its `approvals/approval-2-rNNN.json` target is absent. Write exactly that revision through Plan 01 `writeCanonicalJsonExclusive`; a race/existing target makes the displayed bundle stale and requires an explicit rebuild, never silent renumbering. Include approval type, revision, supersedes, approved time, normalized user instructions, sorted approved artifacts, artifact-set hash, every explicit hash/path/revision field from Step 6, and `referencePromotion:{from:"provisional",setHash,to:"approved"}`. Re-read it, then atomically update the pointer with mutable `writeCanonicalJson` and `status:"valid"`. Register the immutable revision as `{artifactId:"yadam-approval-2-current",logicalRole:"yadam.approval.2",path:"approvals/approval-2-rNNN.json",sha256,schemaVersion:"1.0.0",producerStage:"approval-2",gateStatus:"pass",dependencyHashes}` where `dependencyHashes` contains every sorted approved artifact ID/hash and no mutable aggregate hash. Reusing the stable artifact ID moves the singleton current record to rNNN and preserves the previous rNNN record in Plan 01 `revisionHistory` without changing its bytes. After pointer and registry re-read, call exactly `transitionJob(jobDir,{stage:"APPROVAL_TWO_GRANTED",to:"running",inputHash:approvedArtifactSetHash,outputHash:revisionSha256,artifactPaths:[approvalRevisionPath,"approvals/current-approval-2.json"].sort()})`, then return the formal revision contract. Plan 04 reference promotion accepts only this exact current evidence; an event name alone or stale revision evidence is insufficient. `immutable_target_exists` is a hard concurrency conflict, never permission to overwrite.

- [ ] **Step 8 (5 minutes): Implement verified handoff readers.**

Use one shared `loadVerifiedApprovalTwo(jobDir)` that checks pointer, revision bytes, artifact-set hash, every required approved artifact including current `yadam.coverage.script`, schema hash/version, and the approved dependency closure. It rejects `yadam.coverage.report` in the approved set and does not treat a later aggregate/audio/subtitle/visual-section revision as approval drift; those mutable records are verified by their owning subsystem loaders. `getApprovedTtsInput` projects only the root-fixed return fields and sorts by ordinal. `getApprovedVisualPlanningInput` returns:

```js
{
  approvalRevisionPath,
  approvedArtifactSetHash,
  storyBible: { relativePath, sha256, schemaVersion, schemaHash },
  scenePlan: { relativePath, sha256, schemaVersion, schemaHash },
  thumbnailPlan: { relativePath, sha256, schemaVersion, schemaHash },
  thumbnailSelection: { relativePath, sha256, copyId },
  spoilerSealIds,
}
```

The TTS getter does not expose `readSlow` or `continuousNext`; before projecting its result it still recomputes every options hash from the approved scene-plan flags and v1 profile. Plan 03 independently reads the same approved scene-plan entry and performs the same check before provider execution.

- [ ] **Step 9 (4 minutes): Run approval-2 and handoff tests.**

Run:

```powershell
node scripts/test_yadam_approval_two.mjs
```

Expected:

```text
ok - complete approval two bundle
ok - append-only approval two revisions
ok - verified approved TTS handoff
ok - verified approved visual-planning handoff
```

- [ ] **Step 10 (2 minutes): Record the task commit.**

Run `git status --short`; add the Task 12 files and commit `feat(yadam): add formal approval two handoffs`, or record the non-Git skip.

---

## Task 13: Perform one constrained duration repair and require approval-2 reapproval

**Files:**
- Create: `scripts/test_yadam_duration_repair.mjs`
- Create: `scripts/lib/yadam/duration-repair.mjs`
- Modify: `scripts/lib/yadam/approval-service.mjs`
- Modify: `scripts/lib/yadam/script-service.mjs`
- Use: `prompts/yadam/segment-repair.md`
- Use: `schemas/yadam/duration-repair.schema.json`

**Interfaces:**
- Implements root-fixed `requestDurationRepair({ jobDir, measuredDurationSeconds, acceptedRangeSeconds, signal })`.
- Implements root-fixed `rebuildApproval2AfterDurationRepair({ jobDir, changedSceneIds, signal })`.
- Produces the authorization artifact `script/duration-repair-report.json` with role `yadam.duration.repair_report`.
- Invalidates approval 2 whenever repaired final/script/scene-plan/QA hashes change; semantic drift invalidates approval 1 instead.

- [ ] **Step 1 (5 minutes): Write range, budget, and state-precondition tests.**

Reject non-finite or non-positive measured duration, an accepted range whose minimum is not positive or maximum is below minimum, and a call while measured duration is already inside the inclusive range; use codes `measured_duration_invalid`, `accepted_range_invalid`, and `duration_repair_not_required`. Require a verified approval 2 and registered Plan 03 roles `yadam.audio.manifest` at `assets/audio/audio-manifest.json` plus `yadam.audio.timeline` before the first attempt. Cross-check manifest `measuredAudioSeconds` and accepted range against the public arguments and its ordered scene/segment IDs against script scenes/script plan. Resolve and verify all inputs, then compute exactly:

```js
durationRepairInputHash = hashCanonical({
  stage: "duration_repair",
  attempt: 1,
  approvalRevisionHash,
  approvedArtifactSetHash,
  audioManifestHash,
  audioTimelineHash,
  measuredDurationSeconds,
  acceptedRangeSeconds: { minimum, maximum },
  finalTextHash,
  scriptScenesHash,
  scenePlanHash,
  qaReportHash,
  scriptCoverageHash,
  semanticContractHash,
  storyBibleHash,
  outlineHash,
  profileHash,
  durationRepairPromptHash,
  durationRepairSchemaHash,
  codexExecutionPinHash,
  canonicalizerVersionHash,
});
```

Every name is a required lowercase SHA-256 except the closed numeric/range/stage/attempt fields; reject extra keys. `scriptCoverageHash` is the current approved immutable script-section revision, never the mutable aggregate. A second request for the same job returns the fixed `needs_review` union with `attempt:1` and does not call Codex.

- [ ] **Step 2 (5 minutes): Write permitted-edit and semantic-drift tests.**

Use a short-duration case and accept added description, dialogue, or transition text that retains every character ID, relationship edge, ordered event ID, twist ID/category/beat, location/prop ownership transition, theme meaning, foreshadow pair, spoiler seal, ending meaning, and fixed ending. Mutate each protected dimension separately and assert the result is `status:"approval1_invalidated"`, `afterFinalTextHash:null`, approval 1 and 2 pointers are invalidated, and no repaired script artifact becomes current.

- [ ] **Step 3 (4 minutes): Write exact changed-set and one-repair tests.**

For a valid repair, assert `changedSegmentIds` and `changedSceneIds` are sorted in canonical script order, contain only text-changed scenes, and are non-empty. Assert unchanged scene text/source/TTS hashes and IDs remain byte-identical. The commit fixture must also prove the old `yadam.coverage.script` revision never remains current after `scriptScenesHash` changes: a new passed script revision is recomputed from the repaired scenes, every affected downstream section receives a new pending revision bound to the same repaired hash, and the aggregate names exactly those four current revisions. Assert the result exactly matches:

```js
{
  status: "repaired",
  attempt: 1,
  changedSegmentIds,
  changedSceneIds,
  beforeFinalTextHash,
  afterFinalTextHash,
}
```

No additional public return fields are permitted.

- [ ] **Step 4 (5 minutes): Write the duration-repair report authorization test.**

Assert `script/duration-repair-report.json` has this exact top-level structure and no extra properties:

```js
{
  schemaVersion: "1.0.0",
  reportType: "yadam_duration_repair_authorization",
  jobId,
  attempt: 1,
  status: "repaired",
  createdAt,
  approvalTwo: {
    invalidatedRevisionPath,
    approvedArtifactSetHash,
  },
  measurement: {
    measuredDurationSeconds,
    acceptedRangeSeconds: { minimum, maximum },
    sourceArtifactId,
    sourceArtifactHash,
  },
  semanticContractHash,
  changedSegmentIds,
  changedSceneIds,
  before: {
    finalTextHash,
    scriptScenesHash,
    scenePlanHash,
    qaReportHash,
    scriptCoverageHash,
  },
  after: {
    finalTextHash,
    scriptScenesHash,
    scenePlanHash,
    qaReportHash,
    scriptCoverageHash,
  },
  changedScenes: changedSceneIds.map((sceneId) => ({
    sceneId,
    segmentId,
    ordinal,
    sourceHash,
    ttsNormalizedText,
    ttsNormalizedHash,
    ttsOptionsHash,
  })),
  changedSceneSetHash,
  dependencyHashes,
  provenance: { stageId, inputHash, outputHash, eventsPath },
  authorizationHash,
}
```

Compute `changedSceneSetHash = hashCanonical(changedSceneIds)`. Require `provenance.inputHash === durationRepairInputHash` from Step 1, and bind the exact `DURATION_REPAIR_REQUIRED` reservation row through that value. The report's own `dependencyHashes` is a sealed historical snapshot map containing the invalidated approval, measurement audio manifest/timeline, pre-repair final/script/scene/QA/immutable script-section, post-repair final/script/scene/QA/immutable script-section, story-bible, outline, profile, prompt, schema, Codex-execution and canonicalizer hashes. Before the exclusive report write, rehash every then-current source and just-published after artifact and prove this map plus both explicit script-coverage hashes agree; then compute `authorizationHash = hashCanonical(reportWithoutAuthorizationHash)`. This embedded map is not the Plan 01 registry record's live dependency map.

Register `yadam.duration.repair_report` as append-only authorization evidence with registry `dependencyHashes` exactly `{profileHash,durationRepairPromptHash,durationRepairSchemaHash,codexExecutionPinHash,canonicalizerVersionHash}`. Those five current policy pins are opaque; changing one fail-closes resume. Do not register the invalidated approval, original audio, before/after script artifacts, downstream coverage sections or aggregate as live artifact dependencies: their historical hashes are already sealed inside the verified report, and the authorized mutation must replace them without invalidating its own authorization. On a later resume after original audio was replaced, require the sealed hash still appears in the corresponding artifact record's retained revision evidence and the exact reservation/report chain; never pretend the overwritten fixed path still has the old bytes. Deliberately exclude `yadam.coverage.audio|subtitle|visual` and mutable `yadam.coverage.report` from both shape and live dependencies. The loader separately verifies that the current aggregate binds the authorized script section but never compares or stores an aggregate hash in this immutable report. This sealed linkage and exact reservation input hash are the authorization checked by Plan 03's private `loadAuthorizedRepairTtsInput`.

- [ ] **Step 5 (4 minutes): Write reapproval rebuild precondition tests.**

Reject rebuild when no repaired report exists, state is not `REBUILDING_APPROVAL_2_BUNDLE` after Plan 03's refreshed audio registration, attempt is not 1, passed `changedSceneIds` differ in membership or order, report/registry hash linkage fails, or refreshed audio/visual dependencies still reference a before hash. Use `duration_repair_not_authorized`. When all dependency closures are current, assert the fixed result `{status:"awaiting_reapproval",revision,bundlePath,approvedArtifactSetHash}` and state `AWAITING_APPROVAL_2`.

- [ ] **Step 6 (2 minutes): Confirm duration-repair tests are red.**

Run `node scripts/test_yadam_duration_repair.mjs`; expect `ERR_MODULE_NOT_FOUND` for `duration-repair.mjs`.

- [ ] **Step 7 (5 minutes): Implement attempt reservation and repair targeting.**

Acquire a per-job duration-repair lock, verify current approval 2 and every Step 1 input, recompute the exact `durationRepairInputHash`, then before Codex invocation call `transitionJob(jobDir,{stage:"DURATION_REPAIR_REQUIRED",to:"running",inputHash:durationRepairInputHash,attempt:1})`; Plan 01 must atomically persist `state.durationRepairAttemptsUsed:1`, so cancellation, timeout, or process restart cannot regain the budget. Rehash registered `assets/audio/audio-manifest.json`, verify its dependency closure and the registered `yadam.audio.timeline`, then rank segment deviation using its measured segment durations and narration density. Compute `adjustmentRatio = ((minimum + maximum) / 2) / measuredDurationSeconds` and select the smallest ordered segment set whose combined planned character adjustment reaches that job-level ratio. Pass only selected segments, approved semantic contract, immutable IDs, required fixed text, and allowed edit classes to stage `yadam.duration.repair.v1` with 300,000 ms timeout and caller signal. Persist the identical reservation input hash as the Codex-stage parent input and later `report.provenance.inputHash`; no repair report may name another history row.

- [ ] **Step 8 (5 minutes): Validate repair semantics before replacing current artifacts.**

Schema-check the response, reconstruct changed segment files in memory, rebuild canonical script scenes/final text, scene plan TTS/visual grounding, QA, and script coverage, then compare semantic-contract projections. If semantics differ, persist an audit result without making repaired artifacts current, invalidate approvals 1 and 2, transition to the approval-1 gate, and return `approval1_invalidated`. If schema/local gates fail, emit `NEEDS_REVIEW` and return the fixed `needs_review` union. There is no second automatic Codex repair.

- [ ] **Step 9 (5 minutes): Commit repaired artifacts and the authorization report.**

When all gates pass, atomically write changed segment revisions, canonical script scenes/final text, scene plan and QA. While the duration-repair lock is still held, first recompute all script semantic expected/covered sets against the repaired `scriptScenesHash`, exclusively write/register the next passed `yadam.coverage.script` revision, and re-read it. Then exclusively write/register new `audio`, `subtitle`, and `visual` revisions bound to that same repaired `scriptScenesHash`: use `pending` whenever their prior dependency closure contains any changed script/scene-plan/QA hash, and preserve/pass only by writing a new revision whose fully reverified dependency closure is disjoint and exact. No pre-repair section record may remain current merely because its status was pass. Finally rebuild/re-read the aggregate from exactly the new current script plus three downstream revisions and require all four documents' `scriptScenesHash` to equal the repaired hash before invalidating approval 2. Reuse Step 7's contained `script/coverage` parent checks for every revision write. Invalidate the current approval-2 pointer without modifying its immutable revision. Write the exact one-per-job report from Step 4 last with Plan 01 `writeCanonicalJsonExclusive`; seal historical before/after source hashes in its internal map, then register it with only the five opaque live policy dependencies fixed in Step 4. `immutable_target_exists` proves the repair budget was already consumed. Re-read file, authorization hash, registry map and gate before transitioning to `REGENERATING_CHANGED_AUDIO`; later audio/aggregate updates must leave this record passed. Return the root-fixed repaired result.

- [ ] **Step 10 (5 minutes): Rebuild approval 2 only after changed dependencies are refreshed.**

`rebuildApproval2AfterDurationRepair` verifies Plan 03's changed-audio authorization/coverage and Plan 04's successful refreshed scene-plan-dependent preview records for the exact changed set. Reuse character reference, style, thumbnail background/composition, and unaffected representative previews only when their dependency hashes are proven disjoint from every changed artifact. Any non-representative closure hit makes Plan 04 throw its typed no-report `duration_refresh_scope_expanded` error; reject the rebuild without invoking either preview facade or writing a bundle, while Plan 06 owns durable outcome reporting. On the valid narrow path, under the approval lock derive `candidateApprovalRevision = lastFormalApprovalRevision + 1`, store it only in the closed rebuilt bundle, invoke the approval-2 bundle builder with the verified current set, register the refreshed `yadam.approval.2.bundle`, transition through `APPROVAL_TWO_REBUILD_READY` to `AWAITING_APPROVAL_2`, and return exactly `{status:"awaiting_reapproval",revision:candidateApprovalRevision,bundlePath:"approvals/approval-2-bundle.json",approvedArtifactSetHash}`. Repeated same-input rebuilds reuse the same bundle/hash/candidate number. No undeclared pipeline-state field is written. Formal revision still occurs only through `approveProduction`, which requires the bundle candidate is still the next unused `rNNN`; it never silently renumbers an already displayed bundle.

- [ ] **Step 11 (4 minutes): Run the duration-repair suite.**

Run:

```powershell
node scripts/test_yadam_duration_repair.mjs
```

Expected:

```text
ok - one duration repair attempt per job
ok - duration repair preserves approval one semantics
ok - hash-linked changed-scene audio authorization
ok - approval two reapproval is mandatory
```

- [ ] **Step 12 (2 minutes): Record the task commit.**

Run `git status --short`; add the Task 13 files and commit `feat(yadam): add one-shot duration repair reapproval`, or record the non-Git skip.

---

## Task 14: Finish the public façade and run a fake-Codex end-to-end approval workflow

**Files:**
- Create: `scripts/test_yadam_script_service_e2e.mjs`
- Create: `scripts/run-yadam-script-tests.mjs`
- Modify: `scripts/lib/yadam/script-service.mjs`
- Modify: `scripts/lib/yadam/history-store.mjs`
- Modify: `package.json` (created by Plan 01)

**Interfaces:**
- Exports exactly the public API listed in this plan; no lower-level Plan 02 module is imported by Plans 03–06.
- Implements `recordCompletedStoryFingerprint({ jobDir, historyPath, completedAt })`.
- Injects test doubles through an internal `createScriptService(dependencies)` factory while production named exports use Plan 01 defaults.

- [ ] **Step 1 (5 minutes): Write an export-surface contract test.**

Import `script-service.mjs`, sort `Object.keys(module)`, and deep-compare to the 18 named exports in the Public Script Service API. Assert there is no default export and no alternate spelling for either duration function or `getApprovedTtsInput`.

- [ ] **Step 2 (5 minutes): Write a 10-minute genre-mode end-to-end fixture.**

Using a temporary Plan 01-compatible job and deterministic fake Codex stage dispatcher, execute: snapshot concept inputs and generate three concepts; provisionally select one; build approval 1; pass its returned artifact-set hash into formal approval; build story bible; build one-segment plan; draft the segment; finalize script/QA/coverage/scene plan; generate/select four thumbnail copies; register fake-but-hash-valid Plan 04 preview/reference/style artifacts; build approval 2; pass its returned artifact-set hash into formal approval; read approved TTS and visual handoffs. Assert every event is in state-machine order, every registered artifact dependency resolves to a current or retained owner, raw repository/history hashes are absent from dependency maps, and approval roles each have exactly one stable current artifact ID with prior revisions only in `revisionHistory`.

- [ ] **Step 3 (5 minutes): Write a reference-mode and 120-minute planning fixture.**

Assert reference mode generates four candidates with preserve/mutate title slots. Build a 120-minute plan and use compact fake segment payloads to assert twelve resumable segment artifacts, all 15 beat assignments, source spans, scene IDs, plan slot cap, and approval hash completeness without external Codex, TTS, image, or FFmpeg execution.

- [ ] **Step 4 (4 minutes): Write invalidation-chain tests.**

After approval 1, change concept selection and assert story bible through approval 2 become invalid. After approval 2, change one script scene and assert final text, QA, scene plan, TTS/subtitle/visual coverage, previews that reference it, and approval 2 become invalid. Change only thumbnail copy with the same layout and assert the registered guide, preview manifest, composed thumbnail, thumbnail QA, approval-2 bundle and formal approval invalidate while script, audio, scene plan, reference set, and background raster remain reusable.

- [ ] **Step 5 (4 minutes): Write completed-history fingerprint tests.**

`recordCompletedStoryFingerprint` requires final production state plus passing script/audio/subtitle/visual coverage and final QA. It projects normalized chosen name IDs, motif IDs, twist categories, theme line, and title fingerprint from registered canonical artifacts, appends once, and returns `{jobId,historyPath,entryHash}`. Repeating the same job is idempotent and does not add a duplicate line.

- [ ] **Step 6 (2 minutes): Confirm the end-to-end test initially fails on missing façade wiring.**

Run `node scripts/test_yadam_script_service_e2e.mjs`.

Expected: exit 1 naming the first missing or incorrectly wired export.

- [ ] **Step 7 (5 minutes): Implement the dependency-injected service factory.**

`createScriptService` receives Plan 01 job/artifact/state/Codex functions, clock, reference root, and history store. It delegates each public method to the focused service and never changes artifact files directly. Production named exports use one singleton factory with Plan 01 imports and real clock. Every public call reloads job state and verifies profile `yadam`; do not cache mutable pointers or manifests across calls.

- [ ] **Step 8 (5 minutes): Wire the full lifecycle and typed errors.**

Map local coded errors to stable public codes without discarding `details` or `cause`. Pass `AbortSignal` only to the two root-fixed duration methods and through their Codex calls. Ensure provisional selections never invoke formal approval writers, formal approval files are append-only, and approved handoff readers share the same verifier.

- [ ] **Step 9 (5 minutes): Add the deterministic script-test runner and unified npm gate.**

Create `scripts/run-yadam-script-tests.mjs` with this exact allowlist and `shell:false` fail-fast spawning:

```js
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const expected = [
  "test_yadam_approval_one.mjs",
  "test_yadam_approval_two.mjs",
  "test_yadam_canonical_script.mjs",
  "test_yadam_codex_stage_adapter.mjs",
  "test_yadam_concept_service.mjs",
  "test_yadam_coverage_service.mjs",
  "test_yadam_duration_repair.mjs",
  "test_yadam_reference_data.mjs",
  "test_yadam_scene_thumbnail_planning.mjs",
  "test_yadam_script_planner.mjs",
  "test_yadam_script_service_e2e.mjs",
  "test_yadam_script_validators.mjs",
  "test_yadam_segment_drafting.mjs",
  "test_yadam_selection_services.mjs",
  "test_yadam_story_bible.mjs",
];
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const discovered = (await readdir(scriptsDir))
  .filter((name) => /^test_yadam_[a-z0-9_]+\.mjs$/u.test(name))
  .sort();
if (JSON.stringify(discovered) !== JSON.stringify(expected)) {
  throw new Error(`yadam script test set mismatch\nexpected=${JSON.stringify(expected)}\nactual=${JSON.stringify(discovered)}`);
}
for (const name of expected) {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(scriptsDir, name)], {
      cwd: join(scriptsDir, ".."),
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  if (exitCode !== 0) process.exit(exitCode);
}
console.log(`ok - ${expected.length} yadam script test files`);
```

Merge, without removing other Plan 01 scripts, these exact `package.json` entries:

```json
{
  "scripts": {
    "test:yadam:node": "node --test test/yadam",
    "test:yadam:script": "node scripts/run-yadam-script-tests.mjs",
    "test:yadam": "npm run test:yadam:node && npm run test:yadam:script"
  }
}
```

- [ ] **Step 10 (4 minutes): Run the full unified yadam test matrix.**

Run:

```powershell
npm run test:yadam
```

Expected: exit 0, Plan 01/03/04/06 `node:test` files pass first, all 15 Plan 02 files pass second, and the last line is `ok - 15 yadam script test files`. No test invokes the real Codex CLI or writes outside its temporary job/reference/history directories.

- [ ] **Step 11 (3 minutes): Run deterministic rebuild and text-integrity checks.**

Run:

```powershell
node scripts/build_yadam_reference_data.mjs --check
rg -n "\r|\uFEFF" data/yadam/reference scripts/lib/yadam prompts/yadam schemas/yadam
```

Expected: `ok - yadam reference data is current`; the `rg` command exits 1 with no matches. Separately run the canonical-script test to confirm Korean/emoji byte spans.

- [ ] **Step 12 (3 minutes): Inspect changed scope and record the final implementation commit.**

Run:

```powershell
git status --short
git diff --check
git add package.json data/yadam/reference prompts/yadam schemas/yadam scripts/build_yadam_reference_data.mjs scripts/run-yadam-script-tests.mjs scripts/lib/yadam scripts/test_yadam_*.mjs
git commit -m "feat(yadam): complete script and approval pipeline"
```

Expected now: the documented non-Git skip. In Git: `git diff --check` has no output and the commit contains no file under `module/`.

---

## Final Verification Matrix

Run every command from `C:\Users\petbl\auto-video` after Tasks 1–14:

```powershell
node scripts/build_yadam_reference_data.mjs --check
npm run test:yadam
git diff --check
git status --short
```

Required outcomes:

- Reference data exactly matches the immutable legacy source hashes and includes the noblewoman bullet-row pools.
- Reference mode presents four candidates; genre mode presents three; both use provisional selection before formal approval 1.
- Approval 1 binds the exact six-sentence intro, all planning counts, canonical 15-beat outline, fixed ending, and spoiler seals.
- Segment drafting is resumable, hash-bound, ordered, and limited to one automatic repair per revision.
- `script-scenes.json` is the machine source of truth; `final.txt` is NFC UTF-8 without BOM, LF-only, two LFs between scenes, one terminal LF, and spans decode from half-open UTF-8 byte ranges.
- Local QA verifies all beat/theme/twist/emotion/foreshadow/finale/ending evidence; model review cannot bless nonexistent evidence.
- Scene planning provides per-scene TTS flags whose canonical options hash matches the approved TTS handoff and uses holds by extending one visual slot.
- Approval 2 binds every required script/schema/story/QA/copy/thumbnail/reference/preview/style hash and exposes no handoff when its pointer or dependency closure is stale.
- Duration repair runs at most once, changes only permitted text length, writes the hash-linked changed-scene authorization report, invalidates approval 2, and cannot resume production without a new approval-2 revision.
- Cross-media coverage is incomplete until script, audio, subtitle, and visual sections all pass.
- Existing `gguljam-bible` behavior and every file under `module/` remain unchanged.

## Implementation Handoff

Use `superpowers:subagent-driven-development` in this session to execute one task at a time with review after each commit. If implementation moves to a separate session or worktree, use `superpowers:executing-plans` and preserve the task order because Tasks 4–14 depend on the contracts and artifacts established by earlier tasks.
