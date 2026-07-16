# Gguljam Longform Quality Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 꿀잠성경 장편 영상에서 반복 대본, 반복 화면, 자막/음성 싱크 불일치를 재발하지 않게 막고, 1시간 분량도 사람이 들을 수 있는 품질로 생성한다.

**Architecture:** 현재 산출물 문제는 영상 조립 한 곳의 단일 버그가 아니라 `대본 생성 -> 장면 분할 -> TTS -> 자막 -> 영상 조립` 전 구간에 QA 게이트가 부족해서 생겼다. 자동 생성은 유지하되, 대본은 장별 고유 논지로 생성하고, 장면은 45-90초 단위로 늘리며, 자막은 TTS 파일 길이와 실제 표시 텍스트를 같은 소스에서 만든다.

**Tech Stack:** Node.js ESM scripts, Hermes Local Studio, ffmpeg/ffprobe, PowerShell, optional Whisper/faster-whisper alignment later.

---

## Root Cause Findings

조사 대상:
- `C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-fast-001\script.txt`
- `C:\Users\petbl\hermes-studio\hermes-local\outputs\job-2026-06-29T15-41-55-670Z\sceneplan.json`
- `C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-fast-001\manual-assembly\assembly-report.json`
- `C:\Users\petbl\auto-video\scripts\build_cain_longform_export.mjs`
- `C:\Users\petbl\auto-video\scripts\build_cain_longform_fast_storyboard.mjs`
- `C:\Users\petbl\auto-video\scripts\assemble_cain_fast_from_hermes_job.mjs`

확인된 원인:
- 대본 생성 로직이 `openings`, `body`, `comfort`, `closing` 배열 문장을 조합해 장면을 채우는 템플릿 방식이다. 이 때문에 `잠들기 전 듣는 이야기이니...` 시작 문단이 27회, `이 장면은 아주 오래된 이야기처럼...` 시작 문단이 26회, `카인과 아벨의 이야기는...` 시작 문단이 11회 반복됐다.
- Hermes `sceneplan.json`에서도 동일 문장이 반복된다. 예: `하나님이 카인에게 던진 질문...`은 8회, `오늘 밤 혹시 마음속에 비교와 서운함이...` 계열은 7-9회 반복된다. 따라서 반복은 편집 단계가 아니라 원본 대본 단계에서 이미 발생했다.
- `build_cain_longform_fast_storyboard.mjs`는 68분 음성을 15개 키프레임으로만 매핑한다. `assembly-report.json` 기준 한 이미지가 평균 273.7초, 최대 429.77초 유지된다. 시청자 입장에서는 화면이 계속 반복되거나 멈춘 것처럼 보인다.
- 수동 조립 영상은 `1fps` 영상이다. 자막은 초 단위로만 갱신되고, 긴 TTS 문장을 `wrapKorean(...).slice(0, 2)`로 앞의 두 줄만 잘라 넣는다. 그래서 음성은 계속 나오는데 자막에는 전체 발화가 표시되지 않아 싱크가 안 맞는 것처럼 보인다.
- Hermes 리포트 `narration-boundary-report.json`은 `warn`, `Unsafe narration boundaries remain after repair.`를 냈다. 장면 분할이 문장/호흡 경계를 충분히 지키지 못했다.
- `script-preservation-report.json`은 통과했으므로 누락 문제는 아니다. 문제는 보존된 대본 자체의 반복성과, 분할/표시 단위의 부자연스러움이다.

## Review Report Verification Addendum

검토한 리뷰 문서:
- `C:\Users\petbl\auto-video\docs\superpowers\plans\2026-06-30-gguljam-longform-quality-review-report.md`

반영할 항목:
- **원본 TTS/SRT 우선 사용 방향은 타당하나 조건부로 반영한다.** 현재 문제 job인 `C:\Users\petbl\hermes-studio\hermes-local\outputs\job-2026-06-29T15-41-55-670Z` 안에는 `.srt` 파일이 없고 `tts-normalization-report.json`, `tts-sync-gate.json`, `voice_*.wav`만 있다. 따라서 계획은 “TTS가 만든 원본 SRT가 있으면 우선 사용, 없으면 wav duration + 문장부호/길이 가중 분절 fallback”으로 수정한다.
- **균등 시간 분배만으로 자막 싱크를 맞추는 방식의 한계 지적은 타당하다.** 실제 발화 속도, 쉼, 문장 길이가 일정하지 않기 때문에 `duration / chunks.length`만 쓰면 중간부 싱크가 밀릴 수 있다. fallback에서도 최소한 글자 수 가중치와 문장부호 경계를 함께 써야 한다.
- **한국어 의미 단위 자막 분절 제안은 타당하다.** `C:\Users\petbl\auto-final\src\auto_video\subtitles.py`에 자막 파싱, 가독성 정규화, 조사/깨진 경계 보정, 읽기 속도 분석 로직이 존재한다. 다만 이 파일도 일부 인코딩이 깨져 있으므로 직접 의존하지 않고, 검증 가능한 JS 유틸로 핵심 규칙만 이식한다.
- **반복 검사에 유사도 기반 게이트를 추가하라는 제안은 타당하다.** 42자 prefix만으로는 조사 하나만 바뀐 문장, 어순만 바뀐 유사 문단을 놓칠 수 있다. Jaccard similarity와 normalized edit distance 중 가벼운 방식부터 추가한다.
- **인접 장면 모티프 lookback 제약은 타당하다.** 기존 계획의 “Reject adjacent prompts with the same motif”는 요구사항만 있고 구현 형태가 약했다. 직전 1개가 아니라 최근 3개 모티프를 피하는 명시적 loop로 수정한다.

반영하지 않을 항목:
- **`0_tts.srt`를 반드시 파싱하라는 제안은 현재 증거로는 일반화할 수 없다.** 문제 job에는 `0_tts.srt`가 없었다. Hermes editor가 정상 완료된 다른 job에는 `subs.srt`가 생기지만, 중단/수동 조립 경로에서는 존재하지 않을 수 있다. 따라서 “필수”가 아니라 “있으면 우선”으로만 반영한다.

## File Structure

- Modify: `C:\Users\petbl\auto-video\scripts\build_cain_longform_export.mjs`
  - 템플릿 조합식 장편 대본 생성을 중단하고, 장별 고유 원고 블록 기반으로 생성한다.
- Create: `C:\Users\petbl\auto-video\scripts\lib\quality-gates.mjs`
  - 반복 문장, 반복 시작어, 유사 문단, 장면 길이, 자막 누락을 검사하는 공통 QA 함수.
- Create: `C:\Users\petbl\auto-video\scripts\lib\subtitle-cues.mjs`
  - 원본 SRT 우선 로딩, 없을 때 wav duration 기반 fallback cue 생성, 한국어 의미 단위 분절을 담당한다.
- Create: `C:\Users\petbl\auto-video\scripts\check_longform_script_quality.mjs`
  - 대본 생성 직후 반복률을 검사하고 기준 미달이면 실패한다.
- Modify: `C:\Users\petbl\auto-video\scripts\build_cain_longform_fast_storyboard.mjs`
  - 15개 챕터 이미지 방식 대신 45-90초 단위의 55-75개 장면 프롬프트를 생성한다.
- Modify: `C:\Users\petbl\auto-video\scripts\assemble_cain_fast_from_hermes_job.mjs`
  - 자막을 TTS 조각 앞 2줄로 자르지 않고 5-8초 표시 단위로 재분절한다.
- Modify: `C:\Users\petbl\auto-video\scripts\validate_hermes_export.py`
  - longform export 검증에 반복률/장면 수/자막 기준을 포함한다.
- Modify: `C:\Users\petbl\auto-video\auto-video.md`
  - 꿀잠성경 장편 직접 제작 흐름에 “반복률 게이트, 60장면 이상, TTS 기준 자막 재분절”을 필수 규칙으로 추가한다.

---

### Task 1: Add Repetition Quality Gate

**Files:**
- Create: `C:\Users\petbl\auto-video\scripts\lib\quality-gates.mjs`
- Create: `C:\Users\petbl\auto-video\scripts\check_longform_script_quality.mjs`

- [ ] **Step 1: Create shared quality gate helpers**

Create `C:\Users\petbl\auto-video\scripts\lib\quality-gates.mjs`:

```js
export function splitParagraphs(text) {
  return String(text || "")
    .split(/\n\s*\n/g)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function normalizeKoreanText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[“”"]/g, "")
    .trim();
}

export function countRepeatedParagraphStarts(text, prefixLength = 42) {
  const counts = new Map();
  for (const paragraph of splitParagraphs(text)) {
    const key = normalizeKoreanText(paragraph).slice(0, prefixLength);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1]);
}

export function countRepeatedSentences(text, minLength = 24) {
  const counts = new Map();
  const sentences = normalizeKoreanText(text)
    .split(/(?<=[.!?。！？]|[.])\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length >= minLength);
  for (const sentence of sentences) {
    counts.set(sentence, (counts.get(sentence) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1]);
}

export function tokenSet(value) {
  return new Set(
    normalizeKoreanText(value)
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2)
  );
}

export function jaccardSimilarity(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size && !right.size) return 1;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function findNearDuplicateParagraphs(text, threshold = 0.82) {
  const paragraphs = splitParagraphs(text);
  const matches = [];
  for (let i = 0; i < paragraphs.length; i += 1) {
    for (let j = i + 1; j < paragraphs.length; j += 1) {
      const score = jaccardSimilarity(paragraphs[i], paragraphs[j]);
      if (score >= threshold) {
        matches.push({ left: i + 1, right: j + 1, score: Number(score.toFixed(3)) });
      }
    }
  }
  return matches.slice(0, 50);
}

export function assertLongformScriptQuality(text, options = {}) {
  const maxRepeatedStart = options.maxRepeatedStart ?? 3;
  const maxRepeatedSentence = options.maxRepeatedSentence ?? 2;
  const minParagraphs = options.minParagraphs ?? 90;
  const repeatedStarts = countRepeatedParagraphStarts(text);
  const repeatedSentences = countRepeatedSentences(text);
  const nearDuplicateParagraphs = findNearDuplicateParagraphs(text, options.nearDuplicateThreshold ?? 0.82);
  const paragraphs = splitParagraphs(text);
  const failures = [];

  if (paragraphs.length < minParagraphs) {
    failures.push(`paragraph_count_too_low:${paragraphs.length}<${minParagraphs}`);
  }
  if (repeatedStarts.some(([, count]) => count > maxRepeatedStart)) {
    failures.push(`repeated_paragraph_start:${JSON.stringify(repeatedStarts.slice(0, 5))}`);
  }
  if (repeatedSentences.some(([, count]) => count > maxRepeatedSentence)) {
    failures.push(`repeated_sentence:${JSON.stringify(repeatedSentences.slice(0, 5))}`);
  }
  if (nearDuplicateParagraphs.length > (options.maxNearDuplicateParagraphs ?? 8)) {
    failures.push(`near_duplicate_paragraphs:${JSON.stringify(nearDuplicateParagraphs.slice(0, 8))}`);
  }

  return {
    ok: failures.length === 0,
    failures,
    paragraphs: paragraphs.length,
    repeatedStarts: repeatedStarts.slice(0, 20),
    repeatedSentences: repeatedSentences.slice(0, 20),
    nearDuplicateParagraphs,
  };
}
```

- [ ] **Step 2: Add CLI checker**

Create `C:\Users\petbl\auto-video\scripts\check_longform_script_quality.mjs`:

```js
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { assertLongformScriptQuality } from "./lib/quality-gates.mjs";

const scriptPath = process.argv[2];
if (!scriptPath) {
  console.error("Usage: node scripts/check_longform_script_quality.mjs <script.txt>");
  process.exit(2);
}

const text = readFileSync(scriptPath, "utf8");
const report = assertLongformScriptQuality(text);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
```

- [ ] **Step 3: Run against the known bad output and verify it fails**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\check_longform_script_quality.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-fast-001\script.txt
```

Expected: exit code `1`, with repeated starts including `잠들기 전 듣는 이야기이니...` and `이 장면은 아주 오래된 이야기처럼...`.
Also expected: `nearDuplicateParagraphs` is non-empty, proving the checker catches paraphrased repetition, not only exact prefix repetition.

---

### Task 2: Replace Template-Assembled Script With Chapter-Unique Source

**Files:**
- Modify: `C:\Users\petbl\auto-video\scripts\build_cain_longform_export.mjs`

- [ ] **Step 1: Remove combinatorial filler arrays from the script path**

Delete the current `narrationFor()` approach that repeatedly picks from `openings`, `bridge`, `body`, `comfort`, and `closing`.

- [ ] **Step 2: Define chapter source blocks**

Replace with explicit chapter blocks shaped like this:

```js
const chapterDrafts = [
  {
    title: "프롤로그: 비교는 왜 잠들기 전에 더 커질까",
    targetChars: 1800,
    scenes: [
      {
        label: "밤의 들판",
        narration: [
          "잠들기 전 마음은 낮보다 솔직해집니다.",
          "낮에는 웃으며 넘겼던 말, 별일 아니라고 접어 둔 표정, 나만 뒤처진 것 같은 작은 느낌들이 조용해진 방 안에서 다시 고개를 듭니다.",
          "카인과 아벨의 이야기는 바로 그런 밤의 마음으로 들어가는 문입니다.",
          "이 이야기를 누군가를 정죄하기 위한 이야기로 듣지 않겠습니다.",
          "오늘은 카인을 멀리 있는 악인으로만 보지 않고, 인정받고 싶었던 한 사람의 마음으로 천천히 바라보겠습니다."
        ].join(" ")
      }
    ]
  }
];
```

- [ ] **Step 3: Require unique chapter vocabulary**

For each chapter, define `chapter.keywords` and ensure the generator includes at least three chapter-specific terms. Example:

```js
{
  title: "카인의 노동: 노력했는데 왜 마음이 가난해졌을까",
  keywords: ["노동", "기다림", "인정", "피로"],
  ...
}
```

- [ ] **Step 4: Run the quality gate before writing export files**

Add this before `writeFileSync(...script.txt...)`:

```js
import { assertLongformScriptQuality } from "./lib/quality-gates.mjs";

const quality = assertLongformScriptQuality(script, {
  maxRepeatedStart: 3,
  maxRepeatedSentence: 2,
  minParagraphs: 90,
});

if (!quality.ok) {
  console.error(JSON.stringify(quality, null, 2));
  throw new Error("Longform script quality gate failed");
}
```

- [ ] **Step 5: Regenerate export and verify**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\build_cain_longform_export.mjs
node C:\Users\petbl\auto-video\scripts\check_longform_script_quality.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-001\script.txt
```

Expected: checker exits `0`, repeated paragraph starts all `<= 3`, repeated sentences all `<= 2`.

---

### Task 3: Increase Visual Scene Count For Longform

**Files:**
- Modify: `C:\Users\petbl\auto-video\scripts\build_cain_longform_fast_storyboard.mjs`

- [ ] **Step 1: Replace 15-scene fast storyboard target**

Change:

```js
const chapters = [ ...15 items... ];
```

to a scene plan that produces 55-75 visual prompts. Minimum acceptable rule:

```js
const targetVisualSeconds = 75;
const minScenes = Math.ceil(3600 / targetVisualSeconds);
```

- [ ] **Step 2: Split script into 60 chunks by paragraph boundary**

Use:

```js
const visualSceneCount = 60;
const chunks = splitIntoChunks(script, visualSceneCount);
```

Each chunk should be around 45-90 seconds after TTS. Avoid a 4-7 minute still frame.

- [ ] **Step 3: Generate prompt variety by chapter**

Prompts must not only vary camera text; the actual subject must change. Use a rotating motif set:

```js
const motifBank = [
  "ancient field with two distant altars",
  "rough hands holding dark soil",
  "lonely shepherd under pale dawn",
  "two lamps burning at different brightness",
  "stone threshold with shadow and light",
  "empty field after footsteps",
  "hands releasing a small stone into water",
  "two separate camps under the same stars"
];
```

Reject adjacent prompts with the same motif.

Implement this as a recent-history lookback, not a comment-only rule:

```js
function chooseMotif(motifBank, recentMotifs, lookback = 3) {
  const blocked = new Set(recentMotifs.slice(-lookback));
  const candidates = motifBank.filter((motif) => !blocked.has(motif));
  const pool = candidates.length ? candidates : motifBank;
  return pool[Math.floor(Math.random() * pool.length)];
}

const recentMotifs = [];
for (const scene of scenes) {
  const motif = chooseMotif(motifBank, recentMotifs, 3);
  recentMotifs.push(motif);
  scene.prompt = `${motif}, ${scene.styleDetails}`;
}
```

- [ ] **Step 4: Add visual scene count report**

Write `visual-scene-report.json`:

```js
writeFileSync(join(exportDir, "visual-scene-report.json"), JSON.stringify({
  visualSceneCount,
  averageScriptCharsPerVisual: Math.round(script.length / visualSceneCount),
  targetVisualSeconds,
}, null, 2), "utf8");
```

- [ ] **Step 5: Verify generated storyboard**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\build_cain_longform_fast_storyboard.mjs
python C:\Users\petbl\auto-video\scripts\validate_hermes_export.py --export-dir C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-fast-001
```

Expected: `hermes-manual-storyboard.md` contains at least 55 `[narration]` blocks.

---

### Task 4: Fix Subtitle Segmentation To Match TTS Timing

**Files:**
- Modify: `C:\Users\petbl\auto-video\scripts\assemble_cain_fast_from_hermes_job.mjs`
- Create: `C:\Users\petbl\auto-video\scripts\lib\subtitle-cues.mjs`

- [ ] **Step 1: Replace two-line truncation**

Remove:

```js
return lines.slice(0, 2).join("\n");
```

The current behavior hides most of the spoken sentence.

- [ ] **Step 2: Add source-of-truth subtitle loading**

Create `C:\Users\petbl\auto-video\scripts\lib\subtitle-cues.mjs` with this policy:

```js
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function findExistingSrt(jobDir) {
  for (const relativePath of ["0_tts.srt", "subs.srt", "subtitles.srt"]) {
    const candidate = join(jobDir, relativePath);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function parseSrt(content) {
  return String(content || "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/g)
    .map((block) => block.split("\n").map((line) => line.trim()).filter(Boolean))
    .map((lines) => {
      const timeLine = lines.find((line) => line.includes("-->"));
      if (!timeLine) return null;
      const [startRaw, endRaw] = timeLine.split("-->").map((value) => value.trim().split(/\s+/)[0]);
      return {
        start: srtTimeToSeconds(startRaw),
        end: srtTimeToSeconds(endRaw),
        text: lines.slice(lines.indexOf(timeLine) + 1).join(" ").trim(),
      };
    })
    .filter((event) => event && event.text);
}

export function loadSourceSrtEvents(jobDir) {
  const srtPath = findExistingSrt(jobDir);
  if (!srtPath) return null;
  return { srtPath, events: parseSrt(readFileSync(srtPath, "utf8")) };
}

export function normalizeSubtitleEvents(events, options = {}) {
  const maxCueSeconds = options.maxCueSeconds ?? 8;
  const minCueSeconds = options.minCueSeconds ?? 1.2;
  const normalized = [];
  for (const event of events) {
    const duration = Math.max(0, Number(event.end) - Number(event.start));
    if (duration <= maxCueSeconds) {
      normalized.push(event);
      continue;
    }
    const chunks = splitSubtitleTextSmart(event.text, options.maxChars ?? 34);
    const totalWeight = chunks.reduce((sum, chunk) => sum + Math.max(1, chunk.length), 0) || 1;
    let cursor = Number(event.start);
    for (let index = 0; index < chunks.length; index += 1) {
      const text = chunks[index];
      const isLast = index === chunks.length - 1;
      const weightedDuration = duration * (Math.max(1, text.length) / totalWeight);
      const end = isLast ? Number(event.end) : Math.max(cursor + minCueSeconds, cursor + weightedDuration);
      normalized.push({ start: cursor, end: Math.min(end, Number(event.end)), text });
      cursor = Math.min(end, Number(event.end));
    }
  }
  return normalized;
}

function srtTimeToSeconds(value) {
  const [h, m, s] = value.replace(",", ".").split(":");
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}
```

If `loadSourceSrtEvents(jobDir)` returns events, use them as the primary subtitle timeline. If it returns `null`, use the fallback cue generator below.

- [ ] **Step 3: Split each TTS narration into semantic subtitle cues**

Add:

```js
function splitSubtitleTextSmart(text, maxChars = 34) {
  const clauses = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[,.;:?!])\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const cues = [];
  for (const clause of clauses) {
    if (clause.length <= maxChars) {
      cues.push(clause);
      continue;
    }
    const words = clause.split(/\s+/);
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > maxChars && line) {
        cues.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) cues.push(line);
  }
  return cues;
}

function subtitleCuesForRow(row) {
  const chunks = splitSubtitleTextSmart(row.scene.narration);
  const totalWeight = chunks.reduce((sum, chunk) => sum + Math.max(1, chunk.length), 0) || 1;
  let cursor = row.start;
  return chunks.map((text, index) => {
    const start = cursor;
    const end = index === chunks.length - 1
      ? row.end
      : start + row.duration * (Math.max(1, text.length) / totalWeight);
    cursor = end;
    return { start, end, text };
  });
}
```

- [ ] **Step 4: Write all subtitle cues**

Replace the SRT loop with:

```js
const sourceSrt = loadSourceSrtEvents(jobDir);
const subtitleRows = sourceSrt
  ? normalizeSubtitleEvents(sourceSrt.events)
  : voiceRows.flatMap(subtitleCuesForRow);
subtitleRows.forEach((row, index) => {
  srt.push(String(index + 1));
  srt.push(`${srtTime(row.start)} --> ${srtTime(row.end)}`);
  srt.push(wrapKorean(row.text, 24));
  srt.push("");
});
```

- [ ] **Step 5: Raise video framerate for subtitle responsiveness**

Change visual base generation from:

```js
"-vf", "fps=1,format=yuv420p",
```

to:

```js
"-vf", "fps=6,format=yuv420p",
```

This is still lightweight but lets subtitles update more naturally.

- [ ] **Step 6: Verify subtitle coverage**

After assembly, write `subtitle-sync-report.json`:

```js
writeFileSync(join(outDir, "subtitle-sync-report.json"), JSON.stringify({
  voiceRows: voiceRows.length,
  subtitleRows: subtitleRows.length,
  sourceSrtPath: sourceSrt?.srtPath || null,
  finalAudioSeconds: cursor,
  subtitleEndSeconds: subtitleRows.at(-1)?.end ?? 0,
  maxCueSeconds: Math.max(...subtitleRows.map((row) => row.end - row.start)),
}, null, 2), "utf8");
```

Expected:
- `subtitleEndSeconds` within `0.5` seconds of `finalAudioSeconds`
- `maxCueSeconds <= 8`
- subtitle cue count greater than voice row count
- when `sourceSrtPath` is not null, the report must record that the original SRT was used instead of fallback timing.

---

### Task 5: Add Export-Level Validation Gates

**Files:**
- Modify: `C:\Users\petbl\auto-video\scripts\validate_hermes_export.py`

- [ ] **Step 1: Count storyboard narration blocks**

Add validation that longform exports must have at least 55 storyboard blocks:

```python
storyboard_blocks = storyboard_text.count("\n[") + (1 if storyboard_text.startswith("[") else 0)
if storyboard_blocks < 55:
    failures.append(f"storyboard_blocks_too_low:{storyboard_blocks}<55")
```

- [ ] **Step 2: Reject excessive repeated paragraph starts**

Call the Node checker from Python or reimplement a simple prefix count:

```python
paragraphs = [p.strip() for p in re.split(r"\n\s*\n", script_text) if p.strip()]
prefix_counts = Counter(re.sub(r"\s+", " ", p)[:42] for p in paragraphs)
bad_prefixes = [(k, v) for k, v in prefix_counts.items() if v > 3]
if bad_prefixes:
    failures.append(f"repeated_paragraph_starts:{bad_prefixes[:5]}")
```

- [ ] **Step 3: Verify**

Run:

```powershell
python C:\Users\petbl\auto-video\scripts\validate_hermes_export.py --export-dir C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-fast-001
```

Expected: current bad export fails until Tasks 2 and 3 are complete.

---

### Task 6: Update Operating Procedure In auto-video.md

**Files:**
- Modify: `C:\Users\petbl\auto-video\auto-video.md`

- [ ] **Step 1: Add mandatory longform QA rules**

Under `꿀잠성경 장편 직접 제작 예외 흐름`, add:

```markdown
### 장편 품질 게이트
- 1시간 분량을 반복 문장으로 늘리지 않는다. 같은 문단 시작은 최대 3회, 같은 핵심 문장은 최대 2회까지만 허용한다.
- 장편 영상은 최소 55개 이상의 본편 장면 프롬프트를 만든다. 15개 이하 챕터 이미지만으로 1시간 영상을 만들지 않는다.
- 자막은 TTS 파일 단위가 아니라 5-8초 표시 단위로 재분절한다.
- 최종 영상 생성 전 `check_longform_script_quality.mjs`, `validate_hermes_export.py`, `subtitle-sync-report.json` 검사를 통과해야 한다.
```

- [ ] **Step 2: Verify docs mention the commands**

Add command block:

```powershell
node C:\Users\petbl\auto-video\scripts\check_longform_script_quality.mjs <export>\script.txt
python C:\Users\petbl\auto-video\scripts\validate_hermes_export.py --export-dir <export>
node C:\Users\petbl\auto-video\scripts\assemble_cain_fast_from_hermes_job.mjs
```

---

### Task 7: Regenerate A Short Acceptance Sample Before Another 1-Hour Run

**Files:**
- No new files required.
- Output: `C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-quality-sample-*`

- [ ] **Step 1: Generate a 6-8 minute sample with the corrected pipeline**

Run the same pipeline with `targetSeconds=420` and 8-10 visual scenes.

- [ ] **Step 2: Verify repetition**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\check_longform_script_quality.mjs <sample-export>\script.txt
```

Expected: pass.

- [ ] **Step 3: Verify subtitle sync report**

Open:

```powershell
Get-Content -Raw <sample-export>\manual-assembly\subtitle-sync-report.json
```

Expected:
- `maxCueSeconds <= 8`
- `subtitleEndSeconds` and `finalAudioSeconds` differ by less than `0.5`

- [ ] **Step 4: Visually inspect three screenshots**

Generate screenshots:

```powershell
ffmpeg -y -ss 00:01:00 -i <sample-final.mp4> -frames:v 1 <sample-export>\preview-0100.png
ffmpeg -y -ss 00:03:30 -i <sample-final.mp4> -frames:v 1 <sample-export>\preview-0330.png
ffmpeg -y -ss 00:06:00 -i <sample-final.mp4> -frames:v 1 <sample-export>\preview-0600.png
```

Expected:
- Korean subtitle text is readable.
- Subtitle line changes match the currently spoken phrase.
- No single image stays for several minutes in the sample.

---

### Task 8: Regenerate The 1-Hour Cain Video

**Files:**
- Output: `C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-v2`

- [ ] **Step 1: Generate corrected export**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\build_cain_longform_export.mjs
node C:\Users\petbl\auto-video\scripts\build_cain_longform_fast_storyboard.mjs
```

- [ ] **Step 2: Run gates**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\check_longform_script_quality.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-v2\script.txt
python C:\Users\petbl\auto-video\scripts\validate_hermes_export.py --export-dir C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-v2
```

- [ ] **Step 3: Run Hermes/TTS**

Run the established Hermes command with the corrected `script.txt` and `hermes-manual-storyboard.md`.

- [ ] **Step 4: Assemble**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\assemble_cain_fast_from_hermes_job.mjs
```

- [ ] **Step 5: Final verification**

Run:

```powershell
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 <final.mp4>
Get-Content -Raw <final-export>\manual-assembly\subtitle-sync-report.json
```

Expected:
- duration between 55 and 70 minutes
- subtitle sync report passes
- visual scene count at least 55
- no repeated paragraph start over 3

---

## Execution Recommendation

Do not regenerate another 1-hour video immediately. First complete Tasks 1-7 and approve a 6-8 minute sample. The previous final video was long enough, but it was not structurally publishable because length was achieved through repeated text and long static images.

Plan complete and saved to `C:\Users\petbl\auto-video\docs\superpowers\plans\2026-06-30-gguljam-longform-quality-remediation.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - fresh implementation agent per task, review between tasks.
2. **Inline Execution** - execute tasks in this session with checkpoints.
