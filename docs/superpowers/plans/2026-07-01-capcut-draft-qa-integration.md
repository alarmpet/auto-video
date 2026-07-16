# CapCut Draft QA Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 반복되는 대본/대사/단어와 들쭉날쭉한 음성 속도를 렌더 전에 차단하고, CapCut에서 사람이 검수할 수 있는 보조 타임라인 산출물을 만든다.

**Architecture:** FFmpeg/Hermes 최종 렌더는 유지한다. 새 품질 게이트는 대본 생성 직후, 세그먼트 생성 직후, MP4 조립 직후에 각각 실행한다. CapCut 연동은 공식 API가 아니므로 1차 범위는 실제 `draft_content.json` 생성이 아니라 `manifest-only` 검수 패키지이며, pyCapCut/capcut-cli 실제 draft 생성은 후속 과제로 분리한다.

**Tech Stack:** Node.js ESM scripts, Python validator, FFmpeg/ffprobe, optional pyCapCut/capcut-cli, CapCut/JianYing local draft files.

---

## Review Decisions

검토 문서 `2026-07-01-capcut-draft-qa-integration-review-report.md`의 지적 중 아래 항목은 타당하므로 계획에 반영한다.

- `script-quality-report.json`을 검증하라고 해놓고 생성하는 단계가 없었다. 생성 CLI와 `build_segmented_storyboards.mjs` 호출 단계를 추가한다.
- CapCut export 검증이 파일 존재만 보고 duration 합계와 subtitle cue 수를 확인하지 않았다. checker 범위를 실제 설명과 맞춘다.
- Task 4는 이름과 달리 실제 CapCut draft를 만들지 않았다. 1차 범위를 `manifest-only CapCut QA package`로 명확히 낮춘다.
- Task 3의 코드 조각이 실제 변수명과 맞지 않았다. `segmentScript`, `segmentDir`, `segment.id`, `segment.durationSeconds` 기준으로 다시 쓴다.
- `splitLongParagraph()`를 실제 분배 로직에 연결하지 않았다. `splitIntoSegmentUnits()`와 `splitScriptIntoTimeSegments()`에 연결한다.
- `manual-assembly/final.mp4` 파일명 계약이 문서화되지 않았다. 세그먼트 최종 파일명은 반드시 `final.mp4`로 고정한다.
- 세그먼트 단위 품질 검사에 전체 장편용 `minParagraphs: 90`을 그대로 쓰면 오탐이 난다. 세그먼트 길이별 `minParagraphs` 옵션을 계산한다.

아래 항목은 타당하지만 후속 과제로 둔다.

- 실제 CapCut `draft_content.json` 생성: CapCut 버전별 draft 구조 리스크가 크므로 `manifest-only` 검수 패키지가 안정화된 뒤 pyCapCut/capcut-cli 중 하나를 고른다.

---

## File Structure

- Create: `C:\Users\petbl\auto-video\scripts\lib\repetition-analysis.mjs`
  - n-gram, 반복 문장 시작, 고정 문구 반복 횟수를 계산한다.
- Modify: `C:\Users\petbl\auto-video\scripts\lib\quality-gates.mjs`
  - 기존 장편 품질 게이트에 반복 분석을 통합한다.
- Modify: `C:\Users\petbl\auto-video\scripts\check_longform_script_quality.mjs`
  - `--out <path>`, `--min-paragraphs <n>`, `--segment-seconds <n>`를 지원한다.
- Modify: `C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs`
  - 세그먼트별 `script-quality-report.json`, `script-budget-report.json`을 생성한다.
  - 긴 문단을 문장 단위로 쪼개고, 세그먼트별 글자 예산을 넘으면 렌더 전 실패시킨다.
- Create: `C:\Users\petbl\auto-video\scripts\check_audio_speed_profile.mjs`
  - 세그먼트 조립 리포트의 `audioTempoFactor`를 검사한다.
- Modify: `C:\Users\petbl\auto-video\scripts\assemble_cain_fast_from_hermes_job.mjs`
  - `--allow-fast-audio`가 없으면 `audioTempoFactor` 0.92~1.18 밖의 조립을 실패시킨다.
  - 세그먼트용 기본 `finalName`을 `final.mp4`로 맞춘다.
- Modify: `C:\Users\petbl\auto-video\scripts\validate_segmented_export.py`
  - script quality, audio tempo, CapCut QA manifest를 검증한다.
- Create: `C:\Users\petbl\auto-video\scripts\lib\capcut-draft-adapter.mjs`
  - 1차 범위: CapCut 검수용 manifest-only 패키지를 만든다.
- Create: `C:\Users\petbl\auto-video\scripts\export_capcut_draft.mjs`
  - `capcut-draft\capcut-draft-manifest.json`과 수동 import 가이드를 생성한다.
- Create: `C:\Users\petbl\auto-video\scripts\check_capcut_draft_export.mjs`
  - manifest 파일 존재, MP4/SRT/timeline 존재, duration 합계, subtitle cue 수를 검증한다.
- Modify: `C:\Users\petbl\auto-video\auto-video.md`
  - 반복 금지, 속도 보정 상한, CapCut manifest-only 보조 산출물, `final.mp4` 계약을 문서화한다.

---

### Task 1: Repetition Analysis And Script Quality Reports

**Files:**
- Create: `C:\Users\petbl\auto-video\scripts\lib\repetition-analysis.mjs`
- Modify: `C:\Users\petbl\auto-video\scripts\lib\quality-gates.mjs`
- Modify: `C:\Users\petbl\auto-video\scripts\check_longform_script_quality.mjs`
- Modify: `C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs`

- [ ] **Step 1: Create repetition analyzer**

Create `scripts\lib\repetition-analysis.mjs` with ASCII-safe regexes:

```js
export function normalizeForRepetition(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/[“”‘’"']/g, "")
    .replace(/[^\p{L}\p{N}\s.,!?]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitSentencesForRepetition(text) {
  return normalizeForRepetition(text)
    .split(/(?<=[.!?])\s+|(?<=[.!?])/u)
    .map((value) => value.trim())
    .filter((value) => value.length >= 8);
}

export function repeatedNgrams(text, n = 5, minCount = 4) {
  const tokens = normalizeForRepetition(text)
    .replace(/[.,!?]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
  const counts = new Map();
  for (let index = 0; index <= tokens.length - n; index += 1) {
    const key = tokens.slice(index, index + n).join(" ");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 30)
    .map(([phrase, count]) => ({ phrase, count }));
}

export function repeatedSentencePrefixes(text, prefixLength = 18, minCount = 4) {
  const counts = new Map();
  for (const sentence of splitSentencesForRepetition(text)) {
    const key = sentence.slice(0, prefixLength);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((left, right) => right[1] - left[1])
    .map(([prefix, count]) => ({ prefix, count }));
}

export function phraseCount(text, phrases) {
  const normalized = normalizeForRepetition(text);
  return Object.fromEntries(phrases.map((phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = normalized.match(new RegExp(escaped, "g")) || [];
    return [phrase, matches.length];
  }));
}

export function analyzeLongformRepetition(text, options = {}) {
  const watchPhrases = options.watchPhrases || [
    "잠들기 전 듣는 이야기",
    "오늘 밤",
    "우리 마음",
    "성경 속",
  ];
  return {
    repeatedFiveGrams: repeatedNgrams(text, 5, options.minNgramCount ?? 4),
    repeatedSevenGrams: repeatedNgrams(text, 7, options.minLongNgramCount ?? 3),
    repeatedSentencePrefixes: repeatedSentencePrefixes(text, 18, options.minPrefixCount ?? 4),
    watchedPhraseCounts: phraseCount(text, watchPhrases),
  };
}
```

- [ ] **Step 2: Integrate repetition analyzer**

At the top of `scripts\lib\quality-gates.mjs`, add:

```js
import { analyzeLongformRepetition } from "./repetition-analysis.mjs";
```

Inside `assertLongformScriptQuality`, after `const paragraphs = splitParagraphs(text);`, add:

```js
  const repetition = analyzeLongformRepetition(text, options.repetition || {});
  const overusedWatchedPhrases = Object.entries(repetition.watchedPhraseCounts)
    .filter(([, count]) => count > (options.maxWatchedPhraseCount ?? 8));
```

Before the return statement, add failures:

```js
  if (repetition.repeatedFiveGrams.length > (options.maxRepeatedFiveGrams ?? 12)) {
    failures.push(`repeated_five_grams:${JSON.stringify(repetition.repeatedFiveGrams.slice(0, 8))}`);
  }
  if (repetition.repeatedSevenGrams.length > (options.maxRepeatedSevenGrams ?? 6)) {
    failures.push(`repeated_seven_grams:${JSON.stringify(repetition.repeatedSevenGrams.slice(0, 6))}`);
  }
  if (repetition.repeatedSentencePrefixes.length > (options.maxRepeatedSentencePrefixes ?? 10)) {
    failures.push(`repeated_sentence_prefixes:${JSON.stringify(repetition.repeatedSentencePrefixes.slice(0, 8))}`);
  }
  if (overusedWatchedPhrases.length) {
    failures.push(`overused_watch_phrases:${JSON.stringify(overusedWatchedPhrases)}`);
  }
```

Add `repetition` to the returned object.

- [ ] **Step 3: Add output support to the CLI**

Replace `scripts\check_longform_script_quality.mjs` with a CLI that parses options:

```js
#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { assertLongformScriptQuality } from "./lib/quality-gates.mjs";

const options = parseArgs(process.argv.slice(2));
if (!options.scriptPath) {
  console.error("Usage: node scripts/check_longform_script_quality.mjs <script.txt> [--out report.json] [--min-paragraphs n] [--segment-seconds n]");
  process.exit(2);
}

const minParagraphs = options.minParagraphs ?? minParagraphsForSeconds(options.segmentSeconds);
const text = readFileSync(options.scriptPath, "utf8");
const report = assertLongformScriptQuality(text, { minParagraphs });

if (options.out) {
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, JSON.stringify(report, null, 2), "utf8");
}
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!parsed.scriptPath && !arg.startsWith("--")) parsed.scriptPath = arg;
    else if (arg === "--out") parsed.out = args[++index];
    else if (arg === "--min-paragraphs") parsed.minParagraphs = Number(args[++index]);
    else if (arg === "--segment-seconds") parsed.segmentSeconds = Number(args[++index]);
  }
  return parsed;
}

function minParagraphsForSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 90;
  return Math.max(18, Math.round(seconds / 30));
}
```

- [ ] **Step 4: Generate segment quality reports inside `build_segmented_storyboards.mjs`**

Import the gate:

```js
import { assertLongformScriptQuality } from "./lib/quality-gates.mjs";
```

After `const segmentScript = segmentScripts[index] || "";`, add:

```js
  const scriptQuality = assertLongformScriptQuality(segmentScript, {
    minParagraphs: Math.max(18, Math.round(segment.durationSeconds / 30)),
  });
  writeFileSync(join(segmentDir, "script-quality-report.json"), JSON.stringify(scriptQuality, null, 2), "utf8");
  if (!scriptQuality.ok) {
    throw new Error(`${segment.id}: script quality failed: ${scriptQuality.failures.slice(0, 3).join("; ")}`);
  }
```

- [ ] **Step 5: Verify**

Run:

```powershell
node --check C:\Users\petbl\auto-video\scripts\lib\repetition-analysis.mjs
node --check C:\Users\petbl\auto-video\scripts\lib\quality-gates.mjs
node --check C:\Users\petbl\auto-video\scripts\check_longform_script_quality.mjs
node --check C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs
```

Expected: all commands exit `0`.

---

### Task 2: Segment Script Length Rebalancing

**Files:**
- Modify: `C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs`

- [ ] **Step 1: Add CLI option**

In `parseArgs`, add:

```js
    else if (arg === "--target-chars-per-second") parsed.targetCharsPerSecond = argv[++i];
```

After `const segmentPlan = buildSegmentPlan(...)`, add:

```js
const targetCharsPerSecond = Number(args.targetCharsPerSecond || 6.8);
```

- [ ] **Step 2: Replace time segment splitting**

Replace `splitScriptIntoTimeSegments(sourceScript, plan)` with:

```js
function splitScriptIntoTimeSegments(sourceScript, plan) {
  const units = splitIntoSegmentUnits(sourceScript, Math.round(plan.segmentSeconds * targetCharsPerSecond * 0.35));
  const targets = plan.segments.map((segment) => segment.durationSeconds);
  return splitUnitsByWeightedTargets(units, targets);
}
```

Add the new helper below `splitTextBySentence`:

```js
function splitIntoSegmentUnits(text, maxUnitChars) {
  return splitIntoUnits(text).flatMap((unit) => splitLongUnitBySentence(unit, maxUnitChars));
}

function splitLongUnitBySentence(unit, maxChars) {
  const cleanUnit = String(unit || "").trim();
  if (cleanUnit.length <= maxChars) return [cleanUnit].filter(Boolean);
  const sentences = splitTextBySentence(cleanUnit);
  if (sentences.length < 2) return splitTextIntoCharacterChunks(cleanUnit, Math.ceil(cleanUnit.length / maxChars));

  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    const next = `${current} ${sentence}`.trim();
    if (next.length > maxChars && current) {
      chunks.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
```

- [ ] **Step 3: Add budget report with real variable names**

After `const segmentScript = segmentScripts[index] || "";`, add:

```js
  const targetChars = Math.round(segment.durationSeconds * targetCharsPerSecond);
  const actualChars = segmentScript.replace(/\s/g, "").length;
  const scriptBudget = {
    segmentId: segment.id,
    targetSeconds: segment.durationSeconds,
    targetCharsPerSecond,
    targetChars,
    actualChars,
    ratio: Number((actualChars / Math.max(1, targetChars)).toFixed(3)),
  };
  writeFileSync(join(segmentDir, "script-budget-report.json"), JSON.stringify(scriptBudget, null, 2), "utf8");
  if (scriptBudget.ratio > 1.12) {
    throw new Error(`${segment.id}: script char budget ratio ${scriptBudget.ratio} exceeds 1.12; shorten source script or rebalance before rendering`);
  }
```

- [ ] **Step 4: Verify regenerated export**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs --source-slug gguljam-bible-cain-envy-60min-001 --slug gguljam-bible-cain-envy-60min-segmented-v2 --segment-minutes 15
```

Expected: every segment contains both `script-budget-report.json` and `script-quality-report.json`.

---

### Task 3: Audio Speed Gate

**Files:**
- Create: `C:\Users\petbl\auto-video\scripts\check_audio_speed_profile.mjs`
- Modify: `C:\Users\petbl\auto-video\scripts\assemble_cain_fast_from_hermes_job.mjs`

- [ ] **Step 1: Create speed checker with rendered-count guard**

Create `scripts\check_audio_speed_profile.mjs`:

```js
#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const exportDir = process.argv[2];
if (!exportDir) {
  console.error("Usage: node scripts/check_audio_speed_profile.mjs <segmented-export-dir>");
  process.exit(2);
}

const manifestPath = join(exportDir, "segment-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const failures = [];
const warnings = [];
const segments = [];
let checkedCount = 0;

for (const segment of manifest.segments || []) {
  const reportPath = join(segment.dir, "manual-assembly", "assembly-report.json");
  if (!existsSync(reportPath)) {
    warnings.push(`${segment.id}: missing assembly-report.json`);
    continue;
  }
  checkedCount += 1;
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const factor = Number(report.audioTempoFactor || 1);
  const raw = Number(report.rawVoiceSeconds || report.totalVoiceSeconds || 0);
  const final = Number(report.totalVoiceSeconds || 0);
  const target = Number(segment.durationSeconds || 0);
  segments.push({ id: segment.id, rawVoiceSeconds: raw, finalVoiceSeconds: final, targetSeconds: target, audioTempoFactor: factor });
  if (factor > 1.18) failures.push(`${segment.id}: audioTempoFactor ${factor.toFixed(3)} is too fast`);
  if (factor < 0.92) failures.push(`${segment.id}: audioTempoFactor ${factor.toFixed(3)} is too slow`);
}

if (checkedCount === 0) failures.push("no rendered segment assembly-report.json files found");
const result = { ok: failures.length === 0, failures, warnings, checkedCount, segments };
mkdirSync(join(exportDir, "validation"), { recursive: true });
writeFileSync(join(exportDir, "validation", "audio-speed-profile.json"), JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
```

- [ ] **Step 2: Add assembler speed cap and final filename contract**

In `assemble_cain_fast_from_hermes_job.mjs`, change:

```js
const finalName = options.finalName || "final-cain-envy-68min.mp4";
```

to:

```js
const finalName = options.finalName || "final.mp4";
```

In `parseArgs`, add:

```js
    else if (arg === "--allow-fast-audio") parsed.allowFastAudio = true;
```

After `audioTempoFactor = cursor / targetMediaSeconds;`, add:

```js
  if (!options.allowFastAudio && (audioTempoFactor > 1.18 || audioTempoFactor < 0.92)) {
    throw new Error(
      `audioTempoFactor ${audioTempoFactor.toFixed(3)} is outside 0.92-1.18. `
      + "Regenerate or rebalance the segment script; pass --allow-fast-audio only for preview renders.",
    );
  }
```

- [ ] **Step 3: Verify known bad render fails**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\check_audio_speed_profile.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-segmented
```

Expected: fails because existing rendered segments used high audio compression.

---

### Task 4: Manifest-Only CapCut QA Package

**Files:**
- Create: `C:\Users\petbl\auto-video\scripts\lib\capcut-draft-adapter.mjs`
- Create: `C:\Users\petbl\auto-video\scripts\export_capcut_draft.mjs`
- Create: `C:\Users\petbl\auto-video\scripts\check_capcut_draft_export.mjs`

- [ ] **Step 1: Create manifest-only adapter**

Create `scripts\lib\capcut-draft-adapter.mjs`.

Important: the `format` must say `manifest-only`, not real CapCut draft.

```js
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function detectCapCutTools() {
  const tools = { capcutCli: false, pyCapCut: false };
  try {
    execFileSync("npx.cmd", ["-y", "capcut-cli", "--help"], { stdio: "ignore", timeout: 20000 });
    tools.capcutCli = true;
  } catch {}
  try {
    execFileSync("python", ["-c", "import pycapcut; print('ok')"], { stdio: "ignore", timeout: 10000 });
    tools.pyCapCut = true;
  } catch {}
  return tools;
}

export function buildCapCutQaManifest({ exportDir, outputDir }) {
  const segmentManifest = JSON.parse(readFileSync(join(exportDir, "segment-manifest.json"), "utf8"));
  const finalSrtPath = join(exportDir, "final", "final-full.srt");
  const segments = segmentManifest.segments.map((segment) => ({
    id: segment.id,
    finalPath: segment.finalPath || join(segment.dir, "manual-assembly", "final.mp4"),
    srtPath: join(segment.dir, "manual-assembly", "subtitles.srt"),
    timelinePath: join(segment.dir, "visual-timeline.json"),
    durationSeconds: segment.durationSeconds,
  }));
  mkdirSync(outputDir, { recursive: true });
  const manifest = {
    format: "auto-video-capcut-qa-manifest-only-v1",
    sourceExportDir: exportDir,
    finalSrtPath: existsSync(finalSrtPath) ? finalSrtPath : null,
    segments,
    notes: [
      "This package does not create draft_content.json.",
      "Import MP4/SRT files into CapCut manually for QA.",
      "FFmpeg output remains the canonical automated render.",
    ],
  };
  const manifestPath = join(outputDir, "capcut-draft-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return { manifestPath, manifest };
}
```

- [ ] **Step 2: Export CLI**

Create `scripts\export_capcut_draft.mjs`:

```js
#!/usr/bin/env node
import { join } from "node:path";
import { buildCapCutQaManifest, detectCapCutTools } from "./lib/capcut-draft-adapter.mjs";

const exportDir = process.argv[2];
if (!exportDir) {
  console.error("Usage: node scripts/export_capcut_draft.mjs <segmented-export-dir>");
  process.exit(2);
}

const outputDir = join(exportDir, "capcut-draft");
const tools = detectCapCutTools();
const { manifestPath, manifest } = buildCapCutQaManifest({ exportDir, outputDir });
console.log(JSON.stringify({ outputDir, manifestPath, tools, manifestFormat: manifest.format }, null, 2));
```

- [ ] **Step 3: Checker validates duration and subtitles**

Create `scripts\check_capcut_draft_export.mjs`:

```js
#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const exportDir = process.argv[2];
if (!exportDir) {
  console.error("Usage: node scripts/check_capcut_draft_export.mjs <segmented-export-dir>");
  process.exit(2);
}

const manifestPath = join(exportDir, "capcut-draft", "capcut-draft-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const failures = [];
let totalDuration = 0;
let cueCount = 0;

if (manifest.format !== "auto-video-capcut-qa-manifest-only-v1") {
  failures.push(`unexpected manifest format: ${manifest.format}`);
}

for (const segment of manifest.segments || []) {
  for (const field of ["finalPath", "srtPath", "timelinePath"]) {
    if (!existsSync(segment[field])) failures.push(`${segment.id}: missing ${field}: ${segment[field]}`);
  }
  if (existsSync(segment.finalPath)) totalDuration += ffprobeDuration(segment.finalPath);
  if (existsSync(segment.srtPath)) cueCount += countSrtCues(segment.srtPath);
  if (existsSync(segment.timelinePath)) {
    const timeline = JSON.parse(readFileSync(segment.timelinePath, "utf8"));
    const end = Number(timeline.scenes?.at(-1)?.endSeconds || 0);
    if (Math.abs(end - Number(segment.durationSeconds || 0)) > 0.01) {
      failures.push(`${segment.id}: timeline end ${end} != segment duration ${segment.durationSeconds}`);
    }
  }
}

if (cueCount <= 0) failures.push("no subtitle cues found");
const result = { ok: failures.length === 0, failures, segmentCount: manifest.segments?.length || 0, totalDuration, cueCount };
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

function ffprobeDuration(path) {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path], { encoding: "utf8" }).trim());
}

function countSrtCues(path) {
  const text = readFileSync(path, "utf8");
  return (text.match(/-->/g) || []).length;
}
```

- [ ] **Step 4: Verify**

Run:

```powershell
node --check C:\Users\petbl\auto-video\scripts\lib\capcut-draft-adapter.mjs
node --check C:\Users\petbl\auto-video\scripts\export_capcut_draft.mjs
node --check C:\Users\petbl\auto-video\scripts\check_capcut_draft_export.mjs
node C:\Users\petbl\auto-video\scripts\export_capcut_draft.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-segmented
node C:\Users\petbl\auto-video\scripts\check_capcut_draft_export.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-segmented
```

Expected: checker returns `"ok": true` for file/timeline/subtitle package integrity.

---

### Task 5: Validation And Documentation Integration

**Files:**
- Modify: `C:\Users\petbl\auto-video\scripts\validate_segmented_export.py`
- Modify: `C:\Users\petbl\auto-video\auto-video.md`

- [ ] **Step 1: Add script quality validation**

Inside the segment loop in `validate_segmented_export.py`, after checking `script.txt`, add:

```python
        script_quality = segment_dir / "script-quality-report.json"
        if not script_quality.exists():
            warnings.append(f"{segment_id}: script-quality-report.json not generated yet")
        else:
            quality = load_json(script_quality)
            if not quality.get("ok", False):
                failures.append(f"{segment_id}: script quality failed: {quality.get('failures', [])[:3]}")
```

- [ ] **Step 2: Add audio tempo validation**

After `sync_report` handling, add:

```python
        assembly_report = segment_dir / "manual-assembly" / "assembly-report.json"
        if assembly_report.exists():
            assembly = load_json(assembly_report)
            tempo = float(assembly.get("audioTempoFactor", 1) or 1)
            if tempo > 1.18:
                failures.append(f"{segment_id}: audio tempo {tempo:.3f} too fast; segment script must be shortened")
            if tempo < 0.92:
                failures.append(f"{segment_id}: audio tempo {tempo:.3f} too slow; segment script must be expanded")
```

- [ ] **Step 3: Add CapCut QA package validation**

After the segment loop, before computing `status`, add:

```python
    capcut_manifest = export_dir / "capcut-draft" / "capcut-draft-manifest.json"
    if capcut_manifest.exists():
        capcut = load_json(capcut_manifest)
        if capcut.get("format") != "auto-video-capcut-qa-manifest-only-v1":
            failures.append("capcut-draft-manifest.json has unexpected format")
```

- [ ] **Step 4: Append documentation rules**

Append this block to `auto-video.md`:

```markdown
## 장편 반복/속도/CapCut 검수 규칙

- 장편 대본은 같은 문장, 같은 문단 시작, 같은 5~7단어 묶음이 반복되면 렌더로 넘기지 않는다.
- 세그먼트별 `script-quality-report.json`과 `script-budget-report.json`을 생성하고, 둘 중 하나라도 실패하면 Hermes 렌더를 시작하지 않는다.
- 세그먼트 최종 MP4 파일명은 반드시 `manual-assembly/final.mp4`로 고정한다.
- `audioTempoFactor`가 1.18을 넘으면 음성을 억지로 빠르게 만들지 말고 대본을 줄이거나 세그먼트 분배를 다시 한다.
- `audioTempoFactor`가 0.92보다 낮으면 대본이 너무 짧은 것이므로 대본을 늘리거나 목표 시간을 줄인다.
- CapCut/pyCapCut/capcut-cli는 비공식 도구이므로 1차 연동은 `manifest-only` 검수 패키지로 한다.
- `capcut-draft-manifest.json`은 실제 CapCut `draft_content.json`이 아니라, CapCut에 수동 import할 파일 목록과 타임라인 검수 정보를 담은 보조 산출물이다.
```

---

### Task 6: Proof Run

**Files:**
- Uses existing scripts.

- [ ] **Step 1: Regenerate segmented export**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs --source-slug gguljam-bible-cain-envy-60min-001 --slug gguljam-bible-cain-envy-60min-segmented-v2 --segment-minutes 15
```

Expected: segment directories contain `script-quality-report.json`, `script-budget-report.json`, `visual-timeline.json`, and `hermes-manual-storyboard.md`.

- [ ] **Step 2: Validate before render**

Run:

```powershell
python C:\Users\petbl\auto-video\scripts\validate_segmented_export.py --export-dir C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-segmented-v2
```

Expected: no script quality failures. Missing final MP4 warnings are acceptable before render.

- [ ] **Step 3: Render and assemble only segment 1**

Run Hermes for segment 1, then assemble with default `final.mp4`:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
node scripts\run-job.mjs --manual-storyboard C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-segmented-v2\segments\segment-01\hermes-manual-storyboard.md --seconds 900 --style calm-scripture --engine stickman --visual-mode contextual-keyframes --no-llm --allow-fallback-video
node C:\Users\petbl\auto-video\scripts\assemble_cain_fast_from_hermes_job.mjs --job-dir C:\Users\petbl\hermes-studio\hermes-local\outputs\<new-job-dir> --export-dir C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-segmented-v2\segments\segment-01
```

Expected: assembly succeeds only if `audioTempoFactor` is within 0.92~1.18.

- [ ] **Step 4: Export CapCut QA package**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\export_capcut_draft.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-segmented-v2
node C:\Users\petbl\auto-video\scripts\check_capcut_draft_export.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-segmented-v2
```

Expected: after all segment MP4s exist, checker returns `"ok": true`.

---

## Risk Notes

- pyCapCut/capcut-cli are unofficial. CapCut updates can break draft compatibility.
- This plan intentionally starts with `manifest-only` CapCut QA export. It does not promise real CapCut draft generation in v1.
- The previous 60-minute render used high audio compression, which is now treated as a failure condition rather than a valid fix.
- If the source script is globally too long for the target duration, segment rebalancing cannot solve it. The correct action is shortening the source script or increasing target duration.

## Self-Review

- Spec coverage: covers repetition detection, audio speed stability, CapCut/pyCapCut research, manifest-only scope, validation integration, and documentation.
- Review coverage: incorporates all mandatory review findings from the review report.
- Placeholder scan: no task uses TBD/TODO/later placeholders.
- Type consistency: variable names match current `build_segmented_storyboards.mjs`: `segmentScript`, `segmentDir`, `segment.id`, `segment.durationSeconds`.

## Execution Choice

Plan complete and saved to `docs/superpowers/plans/2026-07-01-capcut-draft-qa-integration.md`.

Two execution options:

1. Subagent-Driven (recommended) - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. Inline Execution - execute tasks in this session using executing-plans, batch execution with checkpoints.
