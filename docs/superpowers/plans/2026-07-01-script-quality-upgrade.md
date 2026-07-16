# Script Quality Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 장편 꿀잠성경 대본의 반복, 늘어짐, 톤 흔들림, 근거 부족을 렌더 전에 자동으로 잡고, 재작성 지시문까지 만들어 대본 품질을 안정적으로 끌어올린다.

**Architecture:** 기존 `check_longform_script_quality.mjs`는 반복 검사 중심으로 유지하고, 그 위에 구조 분석, 챕터별 진행감 분석, 의미 중복 분석, 재작성 브리프 생성을 추가한다. 1차는 Node.js 표준 라이브러리 기반의 로컬 게이트로 만들고, 2차 옵션으로 textlint/Promptfoo/OpenAI Evals/DeepEval/RAGAS류 평가를 붙일 수 있는 산출물 형식을 준비한다.

**Tech Stack:** Node.js ESM, Python 검증 스크립트, ffmpeg/ffprobe 기존 파이프라인, Markdown/JSON 리포트, 선택적 외부 평가 도구(textlint, Promptfoo, OpenAI Evals, DeepEval, KSS/Kiwi).

---

## Research Summary

- textlint는 자연어용 pluggable linter이며 ESLint처럼 문장 규칙을 플러그인으로 검사할 수 있다. 한국어 규칙을 직접 만들거나 Markdown 대본 린터로 확장하기 좋다. Source: https://github.com/textlint/textlint, https://textlint.org/
- KSS는 한국어 문장 분리 도구이고, 최신 릴리스 문서에는 빠른 문장 분리 backend가 언급된다. 장편 대본의 문장 단위 분석에 적합하다. Source: https://github.com/hyunwoongko/kss
- Kiwi/kiwipiepy는 한국어 형태소 분석기다. 반복 어휘, 명사/동사 다양성, 조사만 바뀐 반복문 탐지에 유용하다. Source: https://github.com/bab2min/kiwipiepy, https://github.com/bab2min/kiwi
- OpenAI Evals는 LLM 시스템의 출력 품질을 커스텀 기준으로 평가하는 프레임워크다. 대본 톤/구조/공감/근거성 같은 정성 기준을 회귀 테스트로 만들 때 적합하다. Source: https://github.com/openai/evals, https://developers.openai.com/api/docs/guides/evals
- Promptfoo는 프롬프트와 LLM 출력을 CLI/CI에서 비교 평가하는 도구다. 대본 생성 프롬프트 버전별 A/B 테스트에 적합하다. Source: https://www.promptfoo.dev/docs/intro/, https://github.com/promptfoo/promptfoo
- DeepEval은 LLM 출력 평가 프레임워크이며 G-Eval처럼 커스텀 기준 평가를 지원한다. Source: https://github.com/confident-ai/deepeval, https://deepeval.com/docs/metrics-llm-evals
- RAGAS의 faithfulness 개념은 “대본의 주장과 소스가 맞는가” 검증에 참고할 수 있다. 성경/심리학 근거를 NotebookLM 또는 내부 소스에서 가져오는 경우 유용하다. Source: https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/

## Adopt / Defer Decision

Adopt now:

- 로컬 반복/구조/진행감/톤 게이트
- 챕터별 대본 예산과 핵심 메시지 고유성 검사
- 자동 재작성 브리프 생성
- 생성 프롬프트에 “챕터별 새 기능”과 “반복 금지 어휘”를 주입

Defer until local gates are stable:

- textlint custom plugin
- Promptfoo/OpenAI Evals/DeepEval 기반 LLM-as-judge
- KSS/Kiwi Python 의존성 도입
- RAGAS식 소스 기반 faithfulness 점수화

이유: 현재 가장 큰 문제는 렌더 전에 잡을 수 있는 반복/분량/구조 실패다. 외부 평가 도구는 좋지만, 먼저 로컬 게이트가 있어야 비용과 실행 시간이 폭증하지 않는다.

## File Structure

- Create: `C:\Users\petbl\auto-video\scripts\lib\script-structure-analysis.mjs`
  - 챕터 분리, 문단 분리, 문장 분리, 챕터별 역할/길이/핵심어/진행감 분석 담당.
- Create: `C:\Users\petbl\auto-video\scripts\lib\semantic-overlap-analysis.mjs`
  - 외부 모델 없이 문자 n-gram cosine으로 의미 중복에 가까운 반복을 탐지.
- Create: `C:\Users\petbl\auto-video\scripts\generate_script_revision_brief.mjs`
  - 실패한 대본을 다시 쓰기 위한 Markdown 브리프 생성.
- Create: `C:\Users\petbl\auto-video\scripts\check_script_quality_suite.mjs`
  - 기존 반복 검사, 구조 검사, 의미 중복 검사, 재작성 브리프 생성을 한 번에 실행.
- Modify: `C:\Users\petbl\auto-video\scripts\lib\quality-gates.mjs`
  - 기존 `assertLongformScriptQuality` 반환값에 구조/의미 중복 요약을 연결할 수 있게 옵션 확장.
- Modify: `C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs`
  - 세그먼트 생성 후 `check_script_quality_suite` 수준의 결과 파일을 세그먼트마다 저장하고 실패 시 중단.
- Modify: `C:\Users\petbl\auto-video\auto-video.md`
  - 장편 대본 작성 규칙을 “챕터별 기능/반복 금지/위로 밀도/근거성” 중심으로 갱신.

---

### Task 1: Add Structure Analyzer

**Files:**
- Create: `C:\Users\petbl\auto-video\scripts\lib\script-structure-analysis.mjs`

- [ ] **Step 1: Write the structure analyzer**

Create `C:\Users\petbl\auto-video\scripts\lib\script-structure-analysis.mjs`:

```js
export function splitParagraphs(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function splitKoreanSentences(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/(?<=[.!?。！？]|다\.|요\.|죠\.|니다\.)\s+|(?<=[.!?。！？])/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function splitChapters(text) {
  const paragraphs = splitParagraphs(text);
  const chapters = [];
  let current = { title: "도입", paragraphs: [] };
  for (const paragraph of paragraphs) {
    if (/^(#{1,3}\s+|제\s*\d+\s*장|챕터\s*\d+|Chapter\s*\d+)/i.test(paragraph)) {
      if (current.paragraphs.length) chapters.push(current);
      current = { title: paragraph.replace(/^#{1,3}\s+/, "").trim(), paragraphs: [] };
    } else {
      current.paragraphs.push(paragraph);
    }
  }
  if (current.paragraphs.length) chapters.push(current);
  return chapters;
}

export function extractKeywords(text, limit = 12) {
  const stopwords = new Set([
    "그리고", "그러나", "하지만", "그래서", "오늘", "우리", "마음", "이야기", "성경",
    "하나", "사람", "자신", "때문", "것입니다", "있습니다", "합니다", "됩니다",
  ]);
  const words = String(text || "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !stopwords.has(word));
  const counts = new Map();
  for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

export function analyzeScriptStructure(text, options = {}) {
  const chapters = splitChapters(text);
  const minChapters = options.minChapters ?? 4;
  const maxChapterLengthRatio = options.maxChapterLengthRatio ?? 1.65;
  const chapterReports = chapters.map((chapter, index) => {
    const body = chapter.paragraphs.join("\n\n");
    const charCount = [...body].length;
    const sentences = splitKoreanSentences(body);
    return {
      index: index + 1,
      title: chapter.title,
      paragraphCount: chapter.paragraphs.length,
      sentenceCount: sentences.length,
      charCount,
      keywords: extractKeywords(body, 10),
    };
  });
  const avgChars = chapterReports.reduce((sum, chapter) => sum + chapter.charCount, 0) / Math.max(1, chapterReports.length);
  const failures = [];
  if (chapterReports.length < minChapters) failures.push(`chapter_count_too_low:${chapterReports.length}<${minChapters}`);
  for (const chapter of chapterReports) {
    if (avgChars > 0 && chapter.charCount > avgChars * maxChapterLengthRatio) {
      failures.push(`chapter_too_long:${chapter.index}:${chapter.charCount}>${Math.round(avgChars * maxChapterLengthRatio)}`);
    }
    if (chapter.paragraphCount < 4) failures.push(`chapter_paragraphs_too_low:${chapter.index}:${chapter.paragraphCount}<4`);
    if (chapter.sentenceCount < 8) failures.push(`chapter_sentences_too_low:${chapter.index}:${chapter.sentenceCount}<8`);
  }
  return {
    ok: failures.length === 0,
    failures,
    chapterCount: chapterReports.length,
    averageChapterChars: Math.round(avgChars),
    chapters: chapterReports,
  };
}
```

- [ ] **Step 2: Run syntax check**

Run:

```powershell
node --check C:\Users\petbl\auto-video\scripts\lib\script-structure-analysis.mjs
```

Expected: exit code `0`.

---

### Task 2: Add Semantic Overlap Analyzer

**Files:**
- Create: `C:\Users\petbl\auto-video\scripts\lib\semantic-overlap-analysis.mjs`

- [ ] **Step 1: Write n-gram overlap analyzer**

Create `C:\Users\petbl\auto-video\scripts\lib\semantic-overlap-analysis.mjs`:

```js
import { splitParagraphs } from "./script-structure-analysis.mjs";

function normalize(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function charNgrams(text, n = 4) {
  const value = normalize(text).replace(/\s+/g, "");
  const grams = new Map();
  for (let index = 0; index <= value.length - n; index += 1) {
    const gram = value.slice(index, index + n);
    grams.set(gram, (grams.get(gram) || 0) + 1);
  }
  return grams;
}

function cosine(a, b) {
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (const value of a.values()) aNorm += value * value;
  for (const value of b.values()) bNorm += value * value;
  for (const [key, value] of a.entries()) dot += value * (b.get(key) || 0);
  if (!aNorm || !bNorm) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

export function analyzeSemanticOverlap(text, options = {}) {
  const threshold = options.threshold ?? 0.82;
  const maxPairs = options.maxPairs ?? 20;
  const paragraphs = splitParagraphs(text).filter((paragraph) => [...paragraph].length >= 80);
  const vectors = paragraphs.map((paragraph) => charNgrams(paragraph, 4));
  const overlaps = [];
  for (let left = 0; left < paragraphs.length; left += 1) {
    for (let right = left + 1; right < paragraphs.length; right += 1) {
      const score = cosine(vectors[left], vectors[right]);
      if (score >= threshold) {
        overlaps.push({
          leftParagraph: left + 1,
          rightParagraph: right + 1,
          score: Number(score.toFixed(3)),
          leftPreview: paragraphs[left].slice(0, 80),
          rightPreview: paragraphs[right].slice(0, 80),
        });
      }
    }
  }
  overlaps.sort((a, b) => b.score - a.score);
  return {
    ok: overlaps.length === 0,
    threshold,
    overlapCount: overlaps.length,
    overlaps: overlaps.slice(0, maxPairs),
  };
}
```

- [ ] **Step 2: Run syntax check**

Run:

```powershell
node --check C:\Users\petbl\auto-video\scripts\lib\semantic-overlap-analysis.mjs
```

Expected: exit code `0`.

---

### Task 3: Add Unified Quality Suite CLI

**Files:**
- Create: `C:\Users\petbl\auto-video\scripts\check_script_quality_suite.mjs`
- Modify: `C:\Users\petbl\auto-video\scripts\lib\quality-gates.mjs`

- [ ] **Step 1: Create suite CLI**

Create `C:\Users\petbl\auto-video\scripts\check_script_quality_suite.mjs`:

```js
#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { assertLongformScriptQuality } from "./lib/quality-gates.mjs";
import { analyzeScriptStructure } from "./lib/script-structure-analysis.mjs";
import { analyzeSemanticOverlap } from "./lib/semantic-overlap-analysis.mjs";

const options = parseArgs(process.argv.slice(2));
if (options.error || !options.scriptPath) {
  console.error(options.error || "Usage: node scripts/check_script_quality_suite.mjs <script.txt> --out report.json");
  process.exit(2);
}

const text = readFileSync(options.scriptPath, "utf8");
const repetition = assertLongformScriptQuality(text, {
  minParagraphs: options.minParagraphs ?? 18,
});
const structure = analyzeScriptStructure(text, {
  minChapters: options.minChapters ?? 4,
});
const semanticOverlap = analyzeSemanticOverlap(text, {
  threshold: options.semanticThreshold ?? 0.82,
});

const failures = [
  ...repetition.failures.map((value) => `repetition:${value}`),
  ...structure.failures.map((value) => `structure:${value}`),
  ...(semanticOverlap.ok ? [] : semanticOverlap.overlaps.map((value) => `semantic_overlap:p${value.leftParagraph}-p${value.rightParagraph}:${value.score}`)),
];

const report = {
  ok: failures.length === 0,
  failures,
  repetition,
  structure,
  semanticOverlap,
};

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
    else if (arg === "--out") parsed.out = readValue(args, ++index, arg);
    else if (arg === "--min-paragraphs") parsed.minParagraphs = Number(readValue(args, ++index, arg));
    else if (arg === "--min-chapters") parsed.minChapters = Number(readValue(args, ++index, arg));
    else if (arg === "--semantic-threshold") parsed.semanticThreshold = Number(readValue(args, ++index, arg));
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (key !== "scriptPath" && key !== "out" && value !== undefined && !Number.isFinite(value)) {
      return { error: `${key} must be numeric` };
    }
  }
  return parsed;
}

function readValue(args, index, optionName) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${optionName} requires a value`);
  return value;
}
```

- [ ] **Step 2: Run syntax check**

Run:

```powershell
node --check C:\Users\petbl\auto-video\scripts\check_script_quality_suite.mjs
```

Expected: exit code `0`.

- [ ] **Step 3: Run suite on the known problematic 60-minute script**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\check_script_quality_suite.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-001\script.txt --out C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-001\validation\script-quality-suite-report.json
```

Expected: exit code `1` with repetition or semantic overlap failures. This confirms the gate catches the current weak script before rendering.

---

### Task 4: Add Revision Brief Generator

**Files:**
- Create: `C:\Users\petbl\auto-video\scripts\generate_script_revision_brief.mjs`

- [ ] **Step 1: Write revision brief generator**

Create `C:\Users\petbl\auto-video\scripts\generate_script_revision_brief.mjs`:

```js
#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const options = parseArgs(process.argv.slice(2));
if (options.error || !options.reportPath || !options.out) {
  console.error(options.error || "Usage: node scripts/generate_script_revision_brief.mjs <script-quality-suite-report.json> --out revision-brief.md");
  process.exit(2);
}

const report = JSON.parse(readFileSync(options.reportPath, "utf8"));
const lines = [];
lines.push("# Script Revision Brief");
lines.push("");
lines.push("## Objective");
lines.push("Rewrite the script so it keeps the same topic and calm sleep-friendly tone, but removes repeated phrasing, improves chapter progression, and gives each chapter a distinct emotional and interpretive function.");
lines.push("");
lines.push("## Hard Constraints");
lines.push("- Do not repeat the same opening phrase across chapters.");
lines.push("- Each chapter must introduce one new biblical observation, one modern psychology insight, and one gentle consolation.");
lines.push("- Avoid filler phrases such as '천천히 보면', '우리 마음은', '잠들기 전에는' more than twice per segment.");
lines.push("- Keep sentences calm, but vary sentence starts and paragraph shapes.");
lines.push("- Do not add claims that are not grounded in the biblical episode or clearly framed as interpretation.");
lines.push("");
lines.push("## Failures To Fix");
for (const failure of report.failures || []) lines.push(`- ${failure}`);
lines.push("");
lines.push("## Highest Overlap Paragraphs");
for (const overlap of report.semanticOverlap?.overlaps || []) {
  lines.push(`- Paragraph ${overlap.leftParagraph} and ${overlap.rightParagraph}, score ${overlap.score}`);
  lines.push(`  - A: ${overlap.leftPreview}`);
  lines.push(`  - B: ${overlap.rightPreview}`);
}
lines.push("");
lines.push("## Chapter Direction");
for (const chapter of report.structure?.chapters || []) {
  const keywords = (chapter.keywords || []).slice(0, 6).map((item) => item.word).join(", ");
  lines.push(`- Chapter ${chapter.index}: keep only the strongest idea. Current keywords: ${keywords}`);
}
lines.push("");

mkdirSync(dirname(options.out), { recursive: true });
writeFileSync(options.out, `${lines.join("\n")}\n`, "utf8");
console.log(options.out);

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!parsed.reportPath && !arg.startsWith("--")) parsed.reportPath = arg;
    else if (arg === "--out") parsed.out = readValue(args, ++index, arg);
  }
  return parsed;
}

function readValue(args, index, optionName) {
  const value = args[index];
  if (!value || value.startsWith("--")) return "";
  return value;
}
```

- [ ] **Step 2: Run syntax check**

Run:

```powershell
node --check C:\Users\petbl\auto-video\scripts\generate_script_revision_brief.mjs
```

Expected: exit code `0`.

- [ ] **Step 3: Generate a revision brief from the known failure report**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\generate_script_revision_brief.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-001\validation\script-quality-suite-report.json --out C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-001\validation\script-revision-brief.md
```

Expected: `script-revision-brief.md` exists and includes failure bullets plus paragraph overlap examples.

---

### Task 5: Integrate Quality Suite Into Segmented Storyboard Build

**Files:**
- Modify: `C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs`

- [ ] **Step 1: Import quality suite functions indirectly through existing modules**

Modify imports near the top of `build_segmented_storyboards.mjs`:

```js
import { analyzeScriptStructure } from "./lib/script-structure-analysis.mjs";
import { analyzeSemanticOverlap } from "./lib/semantic-overlap-analysis.mjs";
```

- [ ] **Step 2: Add structure and semantic report after current script quality report**

After the current `scriptQuality` block, add:

```js
  const structureQuality = analyzeScriptStructure(segmentScript, {
    minChapters: Math.max(1, Math.round(segment.durationSeconds / 300)),
  });
  const semanticOverlap = analyzeSemanticOverlap(segmentScript, {
    threshold: 0.82,
  });
  const qualitySuite = {
    ok: scriptQuality.ok && structureQuality.ok && semanticOverlap.ok,
    failures: [
      ...scriptQuality.failures.map((failure) => `repetition:${failure}`),
      ...structureQuality.failures.map((failure) => `structure:${failure}`),
      ...(semanticOverlap.ok ? [] : semanticOverlap.overlaps.map((overlap) => `semantic_overlap:p${overlap.leftParagraph}-p${overlap.rightParagraph}:${overlap.score}`)),
    ],
    repetition: scriptQuality,
    structure: structureQuality,
    semanticOverlap,
  };
  writeFileSync(
    join(segmentDir, "script-quality-suite-report.json"),
    `${JSON.stringify(qualitySuite, null, 2)}\n`,
    "utf8",
  );
  if (!qualitySuite.ok) {
    throw new Error(`${segment.id}: script quality suite failed: ${qualitySuite.failures.slice(0, 5).join("; ")}`);
  }
```

- [ ] **Step 3: Run syntax check**

Run:

```powershell
node --check C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs
```

Expected: exit code `0`.

---

### Task 6: Update auto-video Operating Rules

**Files:**
- Modify: `C:\Users\petbl\auto-video\auto-video.md`

- [ ] **Step 1: Add script quality section**

Append this section to `auto-video.md`:

```markdown
## 꿀잠성경 장편 대본 품질 규칙

장편 대본은 길이를 채우는 방식으로 작성하지 않는다. 각 챕터는 서로 다른 기능을 가져야 한다.

- 챕터마다 반드시 하나의 성경 관찰, 하나의 현대 심리 해석, 하나의 공감/위로 문장을 가진다.
- 같은 도입 문장, 같은 질문, 같은 결론 문장을 반복하지 않는다.
- “잠들기 전 듣는 이야기”, “천천히 보면”, “우리 마음은”, “오늘 밤” 같은 고정 문구는 세그먼트마다 최대 2회까지만 허용한다.
- 한 챕터는 이전 챕터의 결론을 반복하지 않고, 새로운 관찰이나 감정 층위를 열어야 한다.
- 렌더 전에는 `check_script_quality_suite.mjs`를 통과해야 한다.
- 실패하면 `generate_script_revision_brief.mjs`로 재작성 브리프를 만든 뒤 대본을 다시 쓴다.
```

- [ ] **Step 2: Verify the section is present**

Run:

```powershell
Select-String -Path C:\Users\petbl\auto-video\auto-video.md -Pattern "꿀잠성경 장편 대본 품질 규칙"
```

Expected: the newly added heading appears once.

---

### Task 7: Optional External Evaluator Prep

**Files:**
- Create: `C:\Users\petbl\auto-video\docs\script-quality-eval-options.md`

- [ ] **Step 1: Document external evaluator options**

Create `C:\Users\petbl\auto-video\docs\script-quality-eval-options.md`:

```markdown
# Script Quality External Evaluator Options

## textlint

Use when local repetition and structure gates are stable and we want Markdown-style natural language linting.

Candidate checks:
- repeated phrase rule
- filler phrase rule
- sentence length rule
- banned sensational religious claims rule

## Promptfoo

Use when comparing multiple script-generation prompts.

Candidate metrics:
- calm sleep tone
- chapter progression
- non-Christian accessibility
- biblical grounding
- psychology explanation clarity

## OpenAI Evals or DeepEval

Use when adding LLM-as-judge quality tests.

Candidate judge criteria:
- "Does each chapter add a new idea?"
- "Does the script comfort without preaching aggressively?"
- "Are psychology claims framed as interpretation rather than medical advice?"
- "Does the script avoid repeating the same sentence pattern?"

## KSS / Kiwi

Use when heuristic Korean splitting becomes insufficient.

Candidate use:
- sentence splitting
- noun/verb diversity
- particle-insensitive repetition detection
```

- [ ] **Step 2: Verify document exists**

Run:

```powershell
Test-Path C:\Users\petbl\auto-video\docs\script-quality-eval-options.md
```

Expected: `True`.

---

## Verification

Run these commands after implementation:

```powershell
node --check C:\Users\petbl\auto-video\scripts\lib\script-structure-analysis.mjs
node --check C:\Users\petbl\auto-video\scripts\lib\semantic-overlap-analysis.mjs
node --check C:\Users\petbl\auto-video\scripts\check_script_quality_suite.mjs
node --check C:\Users\petbl\auto-video\scripts\generate_script_revision_brief.mjs
node --check C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs
node C:\Users\petbl\auto-video\scripts\check_script_quality_suite.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-001\script.txt --out C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-001\validation\script-quality-suite-report.json
node C:\Users\petbl\auto-video\scripts\generate_script_revision_brief.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-001\validation\script-quality-suite-report.json --out C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-001\validation\script-revision-brief.md
```

Expected:

- Syntax checks exit `0`.
- The quality suite exits `1` on the current weak 60-minute script, proving it catches the known failure.
- `script-quality-suite-report.json` and `script-revision-brief.md` are generated.

## Self-Review

Spec coverage:

- Web/GitHub research included and sources recorded.
- Plan improves script quality before rendering.
- Plan covers local QA, future external evaluator options, and integration with the segmented workflow.

Placeholder scan:

- No `TBD`, `TODO`, or unspecified file paths remain.
- Commands use concrete paths from this workspace.

Type consistency:

- `analyzeScriptStructure`, `analyzeSemanticOverlap`, and generated report keys are used consistently across tasks.
