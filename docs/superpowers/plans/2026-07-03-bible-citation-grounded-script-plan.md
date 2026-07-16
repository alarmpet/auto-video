# Bible Citation Grounded Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 꿀잠성경 대본이 "성경에서는 이렇습니다"로 뭉뚱그리지 않고, 각 챕터의 상황 설명 안에 `사무엘상 1장 6절`처럼 구체적인 장절과 개역한글판 원문 인용/대입 해설을 포함하도록 만든다.

**Architecture:** 현재 `chapters.json`에는 `bibleRef`가 있지만 `script.txt` 생성/품질검사/렌더 게이트로 전달되지 않는다. 이 계획은 `chapters.json`의 성경 참조를 대본 계약으로 승격하고, 로컬 `data/bible-krv.json` 원문 데이터와 `check_bible_citation.mjs` 검사를 렌더 전 필수 게이트로 연결한다.

**Tech Stack:** Node.js ESM scripts, local JSON Bible source `data/bible-krv.json`, existing segmented export builder, existing script quality suite.

---

## Root Cause Findings

- 최종 대본 `C:\Users\petbl\auto-video\exports\gguljam-bible-sensitive-heart-small-words-10min-001\script.txt`에는 `한나`, `브닌나`, `성경은 그 일이 해마다 반복되었다고 말합니다` 같은 일반 서술은 있지만, 사용자가 기대한 `사무엘상 1장 6절에 보면...`, `사무엘상 1장 10절은...` 같은 장절 기반 설명이 거의 없다.
- `C:\Users\petbl\auto-video\exports\gguljam-bible-sensitive-heart-small-words-10min-001\chapters.json`에는 `bibleRef`가 챕터마다 존재한다. 그러나 `scripts\build_segmented_storyboards.mjs`는 source script를 그대로 분할하고 HPSL/Phase3 보강만 수행하며, `chapters.json`의 `bibleRef`를 읽어 대본에 삽입하거나 검사하지 않는다.
- `C:\Users\petbl\auto-video\scripts\check_bible_citation.mjs`는 인용 블록이 0개여도 `{ ok: true, citationCount: 0 }`로 통과한다. 즉 "인용이 정확한지"만 검사하고 "필수 인용이 있는지"는 검사하지 않는다.
- `C:\Users\petbl\auto-video\data\bible-krv.json`은 현재 창세기 4장 일부 예시만 담고 있고, 이번 주제에 필요한 `사무엘상 1장` 데이터가 없다. 파일 안에도 "실제 렌더 전체용이 아니라 테스트용 예시 데이터"라고 적혀 있다.
- `scripts\check_script_quality_suite.mjs`의 품질 게이트에는 "성경 장절 접지성" 항목이 없다. 그래서 HPSL/반복/공감/구체성은 통과해도 성경 본문 기반성이 약한 대본이 렌더까지 진행된다.
- `auto-video.md`의 "성경 원문 인용 규칙"은 "각 챕터의 Story 단계에는 짧은 성경 원문 인용을 최소 1회 포함할 수 있다"라고 되어 있어 강제가 아니다. 실제 채널 방향과 사용자의 기대는 "챕터마다 최소 1회 포함해야 한다"에 가깝다.

## Review Incorporation Decisions

- Adopted: multi-segment chapter slicing. Passing the full `sourceChapters` array to every segment would compare segment 2's local chapter index 1 against the global chapter 1 `bibleRef`. The builder must write and validate only the chapters that are actually present in each `segmentScript`.
- Adopted: smart quote support. Korean authoring and LLM output may use `“...”` or `‘...’`; citation extraction should recognize those forms while preserving the quoted body for source comparison.
- Adopted: Unicode NFC normalization. Script text, local JSON data, and copied Korean Bible text should be normalized before matching to avoid cross-platform composed/decomposed Unicode mismatches.
- Adopted: conditional grounding for chapters without `bibleRef`. If a future intro/outro chapter intentionally has no biblical passage, the grounding gate should skip required citation checks for that chapter while still reporting it as skipped.
- Modified: punctuation normalization. The review suggested ignoring punctuation in quoted Bible text. This plan does not adopt broad punctuation-insensitive comparison by default because the checker is meant to protect verbatim 개역한글판 quotation. The plan only normalizes Unicode, whitespace, and quote wrapper variants. A `--loose-punctuation` exploratory draft mode is explicitly out of scope for this implementation; render gating remains strict.

## Desired Script Pattern

대본은 아래처럼 흘러야 한다.

```text
사무엘상 1장 6절은 브닌나가 한나를 격동하게 했다고 말합니다.
[성경인용:사무엘상 1:6] "여호와께서 그로 성태치 못하게 하시므로 그 대적 브닌나가 그를 심히 격동하여 번민케 하더라"

여기서 중요한 것은 한나가 하루만 상처받은 사람이 아니라는 점입니다.
작은 말이 크게 들리는 마음은, 그날의 한마디만 듣는 것이 아니라 오래 반복된 비교의 공기를 함께 듣습니다.
그래서 오늘 우리가 작은 말에 무너졌다면, 그것은 믿음이 약해서가 아니라 마음이 이미 오래 긴장해 있었기 때문일 수 있습니다.
```

나쁜 패턴:

```text
성경은 그 일이 해마다 반복되었다고 말합니다.
반복된 말은 마음에 길을 냅니다.
```

위 문장은 틀리지는 않지만, 장절/원문/상황 대입이 없어 "성경 이야기"보다 일반 심리 에세이처럼 들린다.

## File Structure

- Modify: `C:\Users\petbl\auto-video\data\bible-krv.json`
  - 실제로 쓰는 구절만 점진 추가한다. 이번 회귀 테스트에는 `사무엘상 1:6-7`, `1:10-11`, `1:15-18`이 필요하다.
- Modify: `C:\Users\petbl\auto-video\scripts\lib\bible-reference.mjs`
  - 참조 파서/포맷터가 `사무엘상 1:6-7`, `사무엘상 1장 6-7절`을 안정적으로 처리하게 한다.
- Modify: `C:\Users\petbl\auto-video\scripts\check_bible_citation.mjs`
  - 인용문 원문 일치뿐 아니라 최소 인용 개수, 필수 참조 목록, 일반화 문구 검사를 지원한다.
- Create: `C:\Users\petbl\auto-video\scripts\lib\bible-grounding-analysis.mjs`
  - 대본 안의 장절 멘션, `[성경인용:...]` 블록, `chapters.json`의 `bibleRef` 커버리지를 분석한다.
- Create: `C:\Users\petbl\auto-video\scripts\check_bible_grounding.mjs`
  - `script.txt`와 `chapters.json`을 함께 검사하는 CLI.
- Modify: `C:\Users\petbl\auto-video\scripts\check_script_quality_suite.mjs`
  - 성경 접지성 리포트를 `bibleGrounding`으로 포함한다.
- Modify: `C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs`
  - 세그먼트별 `chapters.json` 참조를 품질 게이트에 넘기고, 실패하면 렌더 전 중단한다.
- Modify: `C:\Users\petbl\auto-video\scripts\generate_script_revision_brief.mjs`
  - 인용/장절 접지 실패 시 재작성 지시문에 "어떤 챕터에 어떤 구절을 넣어야 하는지"를 명시한다.
- Modify: `C:\Users\petbl\auto-video\auto-video.md`
  - "포함할 수 있다"를 "포함해야 한다"로 바꾸고, 장절 대입 해설 패턴을 좋은 예/나쁜 예로 추가한다.
- Create/Modify tests:
  - `C:\Users\petbl\auto-video\scripts\test_bible_reference.mjs`
  - `C:\Users\petbl\auto-video\scripts\test_bible_grounding_analysis.mjs`
  - `C:\Users\petbl\auto-video\scripts\test_bible_citation_required_gate.mjs`
  - `C:\Users\petbl\auto-video\scripts\test_sensitive_heart_bible_grounding_regression.mjs`

---

### Task 1: Repair Bible Reference Parsing and Data Coverage

**Files:**
- Modify: `C:\Users\petbl\auto-video\data\bible-krv.json`
- Modify: `C:\Users\petbl\auto-video\scripts\lib\bible-reference.mjs`
- Test: `C:\Users\petbl\auto-video\scripts\test_bible_reference.mjs`

- [ ] **Step 1: Write the failing parser/data test**

Create or replace `C:\Users\petbl\auto-video\scripts\test_bible_reference.mjs`:

```js
import assert from "node:assert/strict";
import { formatCitation, lookupVerses, parseReference } from "./lib/bible-reference.mjs";

assert.deepEqual(parseReference("사무엘상 1:6-7"), {
  book: "사무엘상",
  chapter: "1",
  startVerse: 6,
  endVerse: 7,
});

assert.deepEqual(parseReference("사무엘상 1장 10-11절"), {
  book: "사무엘상",
  chapter: "1",
  startVerse: 10,
  endVerse: 11,
});

const first = lookupVerses("사무엘상 1:6");
assert.equal(first.book, "사무엘상");
assert.equal(first.chapter, "1");
assert.equal(first.translation, "개역한글판");
assert.equal(first.verses.length, 1);
assert.match(first.verses[0].text, /브닌나|격동|번민/u);

const citation = formatCitation("사무엘상 1:10-11");
assert.match(citation, /^사무엘상 1장 10-11절, 개역한글판/u);
assert.match(citation, /\[성경인용:사무엘상 1:10-11\]/u);
assert.match(citation, /마음이 괴로와서/u);

console.log("test_bible_reference: pass");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\test_bible_reference.mjs
```

Expected: FAIL because `data\bible-krv.json` lacks `사무엘상 1` and/or parser does not handle `1장 10-11절`.

- [ ] **Step 3: Add required local KRV verses**

Update `C:\Users\petbl\auto-video\data\bible-krv.json` with this structure, preserving existing `창세기` data and adding `사무엘상`. Use the local/user-provided 개역한글판 source as the authority. The exact text below must be verified against the user's local source before committing:

```json
{
  "translation": "개역한글판",
  "source": "대한성서공회 개역한글판; 프로젝트 로컬 인용 데이터",
  "books": {
    "창세기": {
      "4": {
        "3": "세월이 지난 후에 가인은 땅의 소산으로 여호와께 제물을 드렸고"
      }
    },
    "사무엘상": {
      "1": {
        "6": "여호와께서 그로 성태치 못하게 하시므로 그 대적 브닌나가 그를 심히 격동하여 번민케 하더라",
        "7": "매년에 한나가 여호와의 집에 올라갈 때마다 남편이 그같이 하매 브닌나가 그를 격동시키므로 그가 울고 먹지 아니하니",
        "10": "한나가 마음이 괴로와서 여호와께 기도하고 통곡하며",
        "11": "서원하여 가로되 만군의 여호와여 만일 주의 여종의 고통을 돌아보시고 나를 생각하시고 주의 여종을 잊지 아니하사 아들을 주시면 내가 그의 평생에 그를 여호와께 드리고 삭도를 그 머리에 대지 아니하겠나이다",
        "15": "한나가 대답하여 가로되 나의 주여 그렇지 아니하니이다 나는 마음이 슬픈 여자라 포도주나 독주를 마신 것이 아니요 여호와 앞에 나의 심정을 통한 것뿐이오니",
        "16": "당신의 여종을 악한 여자로 여기지 마옵소서 내가 지금까지 말한 것은 나의 원통함과 격동됨이 많음을 인함이니이다",
        "17": "엘리가 대답하여 가로되 평안히 가라 이스라엘의 하나님이 너의 기도하여 구한 것을 허락하시기를 원하노라",
        "18": "가로되 당신의 여종이 당신께 은혜 입기를 원하나이다 하고 가서 먹고 얼굴에 다시는 수색이 없으니라"
      }
    },
    "데이터_주": "이 파일은 실제 대본에 인용하는 구절만 프로젝트에서 점진적으로 저장한다. 새 구절을 추가할 때는 개역한글판 원문과 대조한다."
  }
}
```

Do not delete existing `창세기 4:4-9`; the JSON above is a shape example. Preserve all existing verses and append `사무엘상`.

- [ ] **Step 4: Repair parser and formatter**

Replace `parseReference` and `formatCitation` in `C:\Users\petbl\auto-video\scripts\lib\bible-reference.mjs` with:

```js
export function parseReference(reference) {
  const normalized = String(reference || "")
    .replace(/\s+/g, " ")
    .replace(/절/g, "")
    .trim();
  const match = normalized.match(/^(.+?)\s*(\d+)(?:장|:)\s*(\d+)(?:-(\d+))?$/u);
  if (!match) throw new Error(`Invalid bible reference: ${reference}`);
  const [, book, chapter, startVerse, endVerse] = match;
  return {
    book: book.trim(),
    chapter,
    startVerse: Number(startVerse),
    endVerse: Number(endVerse || startVerse),
  };
}

export function formatCitation(reference) {
  const parsed = parseReference(reference);
  const { book, chapter, translation, verses } = lookupVerses(reference);
  const range = verses.length > 1 ? `${verses[0].verse}-${verses.at(-1).verse}` : `${verses[0].verse}`;
  const body = verses.map((v) => v.text).join(" ");
  return `${book} ${chapter}장 ${range}절, ${translation}\n[성경인용:${book} ${chapter}:${parsed.startVerse}${parsed.endVerse !== parsed.startVerse ? `-${parsed.endVerse}` : ""}] "${body}"`;
}
```

- [ ] **Step 5: Run parser/data test**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\test_bible_reference.mjs
```

Expected: `test_bible_reference: pass`.

- [ ] **Step 6: Commit**

```powershell
git add C:\Users\petbl\auto-video\data\bible-krv.json C:\Users\petbl\auto-video\scripts\lib\bible-reference.mjs C:\Users\petbl\auto-video\scripts\test_bible_reference.mjs
git commit -m "fix: support concrete KRV bible references"
```

If this folder is not a Git repository, record the changed files in the task report instead of committing.

---

### Task 2: Add Bible Grounding Analysis

**Files:**
- Create: `C:\Users\petbl\auto-video\scripts\lib\bible-grounding-analysis.mjs`
- Create: `C:\Users\petbl\auto-video\scripts\test_bible_grounding_analysis.mjs`

- [ ] **Step 1: Write the failing analysis test**

Create `C:\Users\petbl\auto-video\scripts\test_bible_grounding_analysis.mjs`:

```js
import assert from "node:assert/strict";
import { analyzeBibleGrounding } from "./lib/bible-grounding-analysis.mjs";

const chapters = [
  { index: 1, title: "반복된 말", bibleRef: "사무엘상 1:6-7" },
  { index: 2, title: "통곡의 기도", bibleRef: "사무엘상 1:10-11" },
];

const grounded = `
챕터 1. 반복된 말

사무엘상 1장 6절은 브닌나가 한나를 격동하게 했다고 말합니다.
[성경인용:사무엘상 1:6] "여호와께서 그로 성태치 못하게 하시므로 그 대적 브닌나가 그를 심히 격동하여 번민케 하더라"

그 장면은 오늘 작은 말이 왜 크게 들리는지 보여 줍니다.

챕터 2. 통곡의 기도

사무엘상 1장 10절은 한나가 마음이 괴로워 통곡했다고 말합니다.
[성경인용:사무엘상 1:10] "한나가 마음이 괴로와서 여호와께 기도하고 통곡하며"

여기서 울음은 믿음 없음이 아니라 안전한 곳에서 마음이 흘러나오는 길입니다.
`;

const report = analyzeBibleGrounding(grounded, { chapters, minCitationsPerChapter: 1 });
assert.equal(report.ok, true, JSON.stringify(report, null, 2));
assert.equal(report.citationCount, 2);
assert.equal(report.chapterReports.length, 2);
assert.deepEqual(report.failures, []);

const smartQuote = `
챕터 1. 반복된 말

사무엘상 1장 6절은 브닌나가 한나를 격동하게 했다고 말합니다.
[성경인용:사무엘상 1:6] “여호와께서 그로 성태치 못하게 하시므로 그 대적 브닌나가 그를 심히 격동하여 번민케 하더라”
`;
const smartReport = analyzeBibleGrounding(smartQuote, {
  chapters: [{ index: 1, title: "반복된 말", bibleRef: "사무엘상 1:6" }],
  minCitationsPerChapter: 1,
});
assert.equal(smartReport.ok, true, JSON.stringify(smartReport, null, 2));
assert.equal(smartReport.citationCount, 1);

const introOutro = `
챕터 1. 들어가며

오늘 밤에는 마음이 조금 천천히 내려앉아도 됩니다.

챕터 2. 반복된 말

사무엘상 1장 6절은 브닌나가 한나를 격동하게 했다고 말합니다.
[성경인용:사무엘상 1:6] "여호와께서 그로 성태치 못하게 하시므로 그 대적 브닌나가 그를 심히 격동하여 번민케 하더라"
`;
const optionalChapterReport = analyzeBibleGrounding(introOutro, {
  chapters: [
    { index: 1, title: "들어가며", bibleRef: "" },
    { index: 2, title: "반복된 말", bibleRef: "사무엘상 1:6" },
  ],
  minCitationsPerChapter: 1,
});
assert.equal(optionalChapterReport.ok, true, JSON.stringify(optionalChapterReport, null, 2));
assert.equal(optionalChapterReport.chapterReports[0].requiresGrounding, false);

const vague = `
챕터 1. 반복된 말

성경은 그 일이 해마다 반복되었다고 말합니다.
반복된 말은 마음에 길을 냅니다.

챕터 2. 통곡의 기도

성경에서는 한나가 울었다고 말합니다.
울음은 길이 될 수 있습니다.
`;

const bad = analyzeBibleGrounding(vague, { chapters, minCitationsPerChapter: 1 });
assert.equal(bad.ok, false);
assert(bad.failures.includes("chapter_1_missing_citation"));
assert(bad.failures.includes("chapter_2_missing_citation"));
assert(bad.failures.some((item) => item.startsWith("vague_bible_claims:")));

console.log("test_bible_grounding_analysis: pass");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\test_bible_grounding_analysis.mjs
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement analysis module**

Create `C:\Users\petbl\auto-video\scripts\lib\bible-grounding-analysis.mjs`:

```js
import { splitChapters } from "./script-structure-analysis.mjs";

const CITATION_RE = /\[성경인용:([^\]]+)\]\s*["“”‘’]([^"“”‘’]+)["“”‘’]/gu;
const SPECIFIC_REF_RE = /(?:창세기|출애굽기|레위기|민수기|신명기|여호수아|사사기|룻기|사무엘상|사무엘하|열왕기상|열왕기하|역대상|역대하|에스라|느헤미야|에스더|욥기|시편|잠언|전도서|아가|이사야|예레미야|예레미야애가|에스겔|다니엘|호세아|요엘|아모스|오바댜|요나|미가|나훔|하박국|스바냐|학개|스가랴|말라기|마태복음|마가복음|누가복음|요한복음|사도행전|로마서|고린도전서|고린도후서|갈라디아서|에베소서|빌립보서|골로새서|데살로니가전서|데살로니가후서|디모데전서|디모데후서|디도서|빌레몬서|히브리서|야고보서|베드로전서|베드로후서|요한일서|요한이서|요한삼서|유다서|요한계시록)\s*\d+\s*(?:장|:)\s*\d+/u;
const VAGUE_CLAIM_RE = /성경(?:은|에서는|에선)?\s+[^.?!\n]{0,30}(?:말합니다|보여\s*줍니다|기록합니다)/gu;

export function extractCitationBlocks(text) {
  const normalizedText = String(text || "").normalize("NFC");
  return [...normalizedText.matchAll(CITATION_RE)].map((match) => ({
    reference: match[1].trim(),
    quote: match[2].trim(),
    index: match.index,
  }));
}

export function analyzeBibleGrounding(text, options = {}) {
  const normalizedText = String(text || "").normalize("NFC");
  const chaptersInput = Array.isArray(options.chapters) ? options.chapters : [];
  const minCitationsPerChapter = Number(options.minCitationsPerChapter ?? 1);
  const scriptChapters = splitChapters(normalizedText, {
    inferChapters: true,
    minChapters: Math.max(1, chaptersInput.length || Number(options.minChapters || 1)),
  });
  const citations = extractCitationBlocks(normalizedText);
  const vagueClaims = [...normalizedText.matchAll(VAGUE_CLAIM_RE)]
    .map((match) => match[0])
    .filter((claim) => !SPECIFIC_REF_RE.test(claim));
  const failures = [];

  const chapterReports = scriptChapters.map((chapter, index) => {
    const body = chapter.paragraphs.join("\n\n");
    const chapterCitations = extractCitationBlocks(body);
    const hasSpecificReference = SPECIFIC_REF_RE.test(body);
    const expectedRef = chaptersInput[index]?.bibleRef || "";
    const expectedBook = expectedRef.replace(/\s*\d+.*/u, "").trim();
    const requiresGrounding = Boolean(expectedRef);
    const expectedBookMentioned = expectedBook ? body.includes(expectedBook) : true;
    const citationOk = !requiresGrounding || chapterCitations.length >= minCitationsPerChapter;
    const referenceOk = !requiresGrounding || hasSpecificReference;
    const bookOk = !requiresGrounding || expectedBookMentioned;
    const ok = citationOk && referenceOk && bookOk;
    if (requiresGrounding) {
      if (!citationOk) failures.push(`chapter_${index + 1}_missing_citation`);
      if (!referenceOk) failures.push(`chapter_${index + 1}_missing_specific_reference`);
      if (!bookOk) failures.push(`chapter_${index + 1}_missing_expected_book:${expectedBook}`);
    }
    return {
      index: index + 1,
      title: chapter.title,
      expectedRef,
      requiresGrounding,
      citationCount: chapterCitations.length,
      hasSpecificReference,
      expectedBookMentioned,
      ok,
    };
  });

  if (vagueClaims.length) failures.push(`vague_bible_claims:${vagueClaims.length}`);
  return {
    ok: failures.length === 0,
    failures,
    citationCount: citations.length,
    vagueClaims,
    chapterReports,
  };
}
```

- [ ] **Step 4: Run analysis test**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\test_bible_grounding_analysis.mjs
```

Expected: `test_bible_grounding_analysis: pass`.

- [ ] **Step 5: Commit**

```powershell
git add C:\Users\petbl\auto-video\scripts\lib\bible-grounding-analysis.mjs C:\Users\petbl\auto-video\scripts\test_bible_grounding_analysis.mjs
git commit -m "feat: analyze bible grounding in scripts"
```

---

### Task 3: Strengthen Citation Checker

**Files:**
- Modify: `C:\Users\petbl\auto-video\scripts\check_bible_citation.mjs`
- Test: `C:\Users\petbl\auto-video\scripts\test_bible_citation_required_gate.mjs`

- [ ] **Step 1: Write failing CLI gate test**

Create `C:\Users\petbl\auto-video\scripts\test_bible_citation_required_gate.mjs`:

```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "bible-citation-gate-"));
const noCitation = join(dir, "no-citation.txt");
writeFileSync(noCitation, "성경은 그 일이 해마다 반복되었다고 말합니다.\n", "utf8");

let failed = false;
try {
  execFileSync("node", [
    "scripts/check_bible_citation.mjs",
    noCitation,
    "--min-citations",
    "1",
    "--require-reference",
    "사무엘상 1:6",
  ], { cwd: "C:/Users/petbl/auto-video", encoding: "utf8" });
} catch (error) {
  failed = true;
  const output = `${error.stdout || ""}${error.stderr || ""}`;
  assert.match(output, /citation_count_too_low/u);
  assert.match(output, /missing_required_reference:사무엘상 1:6/u);
}
assert.equal(failed, true, "script without required citation must fail");

const good = join(dir, "good.txt");
writeFileSync(
  good,
  '[성경인용:사무엘상 1:6] "여호와께서 그로 성태치 못하게 하시므로 그 대적 브닌나가 그를 심히 격동하여 번민케 하더라"\n',
  "utf8",
);

const ok = execFileSync("node", [
  "scripts/check_bible_citation.mjs",
  good,
  "--min-citations",
  "1",
  "--require-reference",
  "사무엘상 1:6",
], { cwd: "C:/Users/petbl/auto-video", encoding: "utf8" });
assert.match(ok, /"ok": true/u);
assert.match(ok, /"citationCount": 1/u);

console.log("test_bible_citation_required_gate: pass");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\test_bible_citation_required_gate.mjs
```

Expected: FAIL because current checker has no `--min-citations` or `--require-reference`.

- [ ] **Step 3: Replace citation checker CLI**

Replace `C:\Users\petbl\auto-video\scripts\check_bible_citation.mjs` with:

```js
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { lookupVerses, parseReference } from "./lib/bible-reference.mjs";
import { extractCitationBlocks } from "./lib/bible-grounding-analysis.mjs";

const options = parseArgs(process.argv.slice(2));
if (!options.scriptPath) {
  console.error("Usage: node scripts/check_bible_citation.mjs <script.txt> [--min-citations n] [--require-reference \"사무엘상 1:6\"]");
  process.exit(2);
}

const text = readFileSync(options.scriptPath, "utf8");
const citationBlocks = extractCitationBlocks(text);
const failures = [];

if (citationBlocks.length < options.minCitations) {
  failures.push(`citation_count_too_low:${citationBlocks.length}<${options.minCitations}`);
}

const normalizedPresent = new Set(citationBlocks.map((block) => normalizeReference(block.reference)));
for (const required of options.requiredReferences) {
  if (!normalizedPresent.has(normalizeReference(required))) {
    failures.push(`missing_required_reference:${required}`);
  }
}

for (const block of citationBlocks) {
  try {
    const { verses } = lookupVerses(block.reference);
    const expected = verses.map((v) => v.text).join(" ");
    // Keep the render gate strict: punctuation differences fail by design.
    const normalize = (value) => String(value || "")
      .normalize("NFC")
      .replace(/[“”‘’]/gu, '"')
      .replace(/\s+/g, " ")
      .trim();
    if (normalize(block.quote) !== normalize(expected)) {
      failures.push(`${block.reference}: quoted text does not match 개역한글판 source verbatim`);
    }
  } catch (error) {
    failures.push(`${block.reference}: ${error.message}`);
  }
}

const result = { ok: failures.length === 0, failures, citationCount: citationBlocks.length };
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

function normalizeReference(reference) {
  const parsed = parseReference(reference);
  return `${parsed.book} ${parsed.chapter}:${parsed.startVerse}${parsed.endVerse !== parsed.startVerse ? `-${parsed.endVerse}` : ""}`;
}

function parseArgs(args) {
  const parsed = { scriptPath: "", minCitations: 0, requiredReferences: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!parsed.scriptPath && !arg.startsWith("--")) parsed.scriptPath = arg;
    else if (arg === "--min-citations") parsed.minCitations = Number(args[++index]);
    else if (arg === "--require-reference") parsed.requiredReferences.push(args[++index]);
  }
  if (!Number.isFinite(parsed.minCitations) || parsed.minCitations < 0) {
    throw new Error("--min-citations must be a non-negative number");
  }
  return parsed;
}
```

- [ ] **Step 4: Run CLI gate test**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\test_bible_citation_required_gate.mjs
```

Expected: `test_bible_citation_required_gate: pass`.

- [ ] **Step 5: Run syntax check**

Run:

```powershell
node --check C:\Users\petbl\auto-video\scripts\check_bible_citation.mjs
```

Expected: exit code 0.

- [ ] **Step 6: Commit**

```powershell
git add C:\Users\petbl\auto-video\scripts\check_bible_citation.mjs C:\Users\petbl\auto-video\scripts\test_bible_citation_required_gate.mjs
git commit -m "fix: require bible citations before render"
```

---

### Task 4: Add Script + Chapters Bible Grounding CLI

**Files:**
- Create: `C:\Users\petbl\auto-video\scripts\check_bible_grounding.mjs`
- Test: `C:\Users\petbl\auto-video\scripts\test_sensitive_heart_bible_grounding_regression.mjs`

- [ ] **Step 1: Write regression test against the current failure**

Create `C:\Users\petbl\auto-video\scripts\test_sensitive_heart_bible_grounding_regression.mjs`:

```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "sensitive-heart-grounding-"));
const scriptPath = join(dir, "script.txt");
const chaptersPath = join(dir, "chapters.json");

writeFileSync(chaptersPath, JSON.stringify([
  { index: 1, title: "같은 말도 더 아플 때", bibleRef: "사무엘상 1:6-7" },
  { index: 2, title: "마음이 먼저 울 때", bibleRef: "사무엘상 1:10-11" }
], null, 2), "utf8");

writeFileSync(scriptPath, `
챕터 1. 같은 말도 더 아플 때

한나에게도 그랬습니다. 성경은 그 일이 해마다 반복되었다고 말합니다.
반복된 말은 마음에 길을 냅니다.

챕터 2. 마음이 먼저 울 때

한나는 하나님 앞에서 통곡했습니다. 성경에서는 그 마음을 받아 주십니다.
`, "utf8");

let failed = false;
try {
  execFileSync("node", [
    "scripts/check_bible_grounding.mjs",
    "--script",
    scriptPath,
    "--chapters",
    chaptersPath,
    "--min-citations-per-chapter",
    "1",
  ], { cwd: "C:/Users/petbl/auto-video", encoding: "utf8" });
} catch (error) {
  failed = true;
  const output = `${error.stdout || ""}${error.stderr || ""}`;
  assert.match(output, /chapter_1_missing_citation/u);
  assert.match(output, /chapter_2_missing_citation/u);
  assert.match(output, /vague_bible_claims/u);
}
assert.equal(failed, true, "vague script must fail bible grounding");

writeFileSync(scriptPath, `
챕터 1. 같은 말도 더 아플 때

사무엘상 1장 6절은 브닌나가 한나를 심히 격동하여 번민케 했다고 말합니다.
[성경인용:사무엘상 1:6] "여호와께서 그로 성태치 못하게 하시므로 그 대적 브닌나가 그를 심히 격동하여 번민케 하더라"
그래서 작은 말이 크게 들리는 밤은 그날의 한마디만이 아니라 오래 반복된 비교의 공기와 이어질 수 있습니다.

챕터 2. 마음이 먼저 울 때

사무엘상 1장 10절은 한나가 마음이 괴로워 여호와께 기도하고 통곡했다고 말합니다.
[성경인용:사무엘상 1:10] "한나가 마음이 괴로와서 여호와께 기도하고 통곡하며"
이 장면은 울음이 믿음 없음이 아니라 안전한 곳에서 마음이 흘러나오는 길일 수 있음을 보여 줍니다.
`, "utf8");

const ok = execFileSync("node", [
  "scripts/check_bible_grounding.mjs",
  "--script",
  scriptPath,
  "--chapters",
  chaptersPath,
  "--min-citations-per-chapter",
  "1",
], { cwd: "C:/Users/petbl/auto-video", encoding: "utf8" });
assert.match(ok, /"ok": true/u);

console.log("test_sensitive_heart_bible_grounding_regression: pass");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\test_sensitive_heart_bible_grounding_regression.mjs
```

Expected: FAIL because `check_bible_grounding.mjs` does not exist.

- [ ] **Step 3: Implement CLI**

Create `C:\Users\petbl\auto-video\scripts\check_bible_grounding.mjs`:

```js
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { analyzeBibleGrounding } from "./lib/bible-grounding-analysis.mjs";

const options = parseArgs(process.argv.slice(2));
if (!options.scriptPath || !options.chaptersPath) {
  console.error("Usage: node scripts/check_bible_grounding.mjs --script <script.txt> --chapters <chapters.json> [--min-citations-per-chapter n] [--out report.json]");
  process.exit(2);
}

const script = readFileSync(options.scriptPath, "utf8");
const chapters = JSON.parse(readFileSync(options.chaptersPath, "utf8"));
const report = analyzeBibleGrounding(script, {
  chapters,
  minCitationsPerChapter: options.minCitationsPerChapter,
});

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);

function parseArgs(args) {
  const parsed = { scriptPath: "", chaptersPath: "", minCitationsPerChapter: 1 };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--script") parsed.scriptPath = args[++index];
    else if (arg === "--chapters") parsed.chaptersPath = args[++index];
    else if (arg === "--min-citations-per-chapter") parsed.minCitationsPerChapter = Number(args[++index]);
  }
  if (!Number.isFinite(parsed.minCitationsPerChapter) || parsed.minCitationsPerChapter < 0) {
    throw new Error("--min-citations-per-chapter must be a non-negative number");
  }
  return parsed;
}
```

- [ ] **Step 4: Run regression test**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\test_sensitive_heart_bible_grounding_regression.mjs
```

Expected: `test_sensitive_heart_bible_grounding_regression: pass`.

- [ ] **Step 5: Commit**

```powershell
git add C:\Users\petbl\auto-video\scripts\check_bible_grounding.mjs C:\Users\petbl\auto-video\scripts\test_sensitive_heart_bible_grounding_regression.mjs
git commit -m "feat: gate scripts on bible grounding"
```

---

### Task 5: Integrate Bible Grounding into Quality Suite and Segmented Builder

**Files:**
- Modify: `C:\Users\petbl\auto-video\scripts\check_script_quality_suite.mjs`
- Modify: `C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs`
- Create: `C:\Users\petbl\auto-video\scripts\lib\segment-chapter-selection.mjs`
- Test: `C:\Users\petbl\auto-video\scripts\test_script_quality_bible_grounding.mjs`
- Test: `C:\Users\petbl\auto-video\scripts\test_segment_chapter_selection.mjs`

- [ ] **Step 1: Write failing integration test**

Create `C:\Users\petbl\auto-video\scripts\test_script_quality_bible_grounding.mjs`:

```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "script-quality-bible-"));
const scriptPath = join(dir, "script.txt");
const chaptersPath = join(dir, "chapters.json");

writeFileSync(chaptersPath, JSON.stringify([
  { index: 1, title: "반복된 말", bibleRef: "사무엘상 1:6-7" }
], null, 2), "utf8");

writeFileSync(scriptPath, `
챕터 1. 반복된 말

왜 같은 말도 어떤 밤에는 크게 들릴까요.
한나에게도 그랬습니다. 성경은 그 일이 해마다 반복되었다고 말합니다.
그 장면은 오늘 우리의 마음을 비춥니다.
그래서 오늘 밤에는 마음을 조금 쉬게 해도 됩니다.
`, "utf8");

let failed = false;
try {
  execFileSync("node", [
    "scripts/check_script_quality_suite.mjs",
    scriptPath,
    "--chapters",
    chaptersPath,
    "--min-chapters",
    "1",
    "--min-paragraphs",
    "1",
  ], { cwd: "C:/Users/petbl/auto-video", encoding: "utf8" });
} catch (error) {
  failed = true;
  const output = `${error.stdout || ""}${error.stderr || ""}`;
  assert.match(output, /bible_grounding:chapter_1_missing_citation/u);
}
assert.equal(failed, true, "quality suite must fail when bible grounding fails");

console.log("test_script_quality_bible_grounding: pass");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\test_script_quality_bible_grounding.mjs
```

Expected: FAIL because `check_script_quality_suite.mjs` does not accept `--chapters`.

- [ ] **Step 3: Add `--chapters` option to quality suite**

In `C:\Users\petbl\auto-video\scripts\check_script_quality_suite.mjs`, import and run grounding:

```js
import { analyzeBibleGrounding } from "./lib/bible-grounding-analysis.mjs";
```

After `phase3`:

```js
const chapters = options.chaptersPath
  ? JSON.parse(readFileSync(options.chaptersPath, "utf8"))
  : [];
const bibleGrounding = chapters.length
  ? analyzeBibleGrounding(text, {
    chapters,
    minCitationsPerChapter: options.minBibleCitationsPerChapter ?? 1,
  })
  : { ok: true, failures: [], citationCount: 0, chapterReports: [], skipped: true };
```

Add failures:

```js
...bibleGrounding.failures.map((value) => `bible_grounding:${value}`),
```

Add to report:

```js
bibleGrounding,
```

In `parseArgs`, add:

```js
else if (arg === "--chapters") parsed.chaptersPath = readValue(args, ++index, arg);
else if (arg === "--min-bible-citations-per-chapter") parsed.minBibleCitationsPerChapter = Number(readValue(args, ++index, arg));
```

In numeric validation, do not treat `chaptersPath` as numeric.

- [ ] **Step 4: Add segment-specific chapter selection helper**

Create `C:\Users\petbl\auto-video\scripts\lib\segment-chapter-selection.mjs`:

```js
import { splitChapters } from "./script-structure-analysis.mjs";

export function selectChaptersForSegment(segmentScript, sourceChapters = []) {
  if (!Array.isArray(sourceChapters) || !sourceChapters.length) return [];
  const parsed = splitChapters(segmentScript, { inferChapters: false });
  const selected = [];

  for (const chapter of parsed) {
    const title = String(chapter.title || "");
    const match =
      title.match(/(?:Chapter|챕터)\s*(\d+)/iu) ||
      title.match(/^(\d+)\s*[.)]\s*챕터/iu);
    if (!match) continue;
    const chapterIndex = Number(match[1]);
    const source = sourceChapters.find((item) => Number(item.index) === chapterIndex);
    if (source) selected.push(source);
  }

  if (!selected.length && parsed.length === sourceChapters.length) return sourceChapters;
  return selected;
}
```

Create `C:\Users\petbl\auto-video\scripts\test_segment_chapter_selection.mjs`:

```js
import assert from "node:assert/strict";
import { selectChaptersForSegment } from "./lib/segment-chapter-selection.mjs";

const sourceChapters = [
  { index: 1, title: "도입", bibleRef: "" },
  { index: 2, title: "작은 말", bibleRef: "사무엘상 1:6" },
  { index: 3, title: "회복", bibleRef: "누가복음 10:41" },
];

const segmentScript = `
챕터 2. 작은 말

사무엘상 1장 6절은 한나의 마음을 보여 줍니다.

챕터 3. 회복

누가복음 10장 41절은 염려와 근심을 말합니다.
`;

const selected = selectChaptersForSegment(segmentScript, sourceChapters);
assert.deepEqual(selected.map((chapter) => chapter.index), [2, 3]);
assert.equal(selected[0].bibleRef, "사무엘상 1:6");
assert.equal(selected[1].bibleRef, "누가복음 10:41");

console.log("test_segment_chapter_selection: pass");
```

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\test_segment_chapter_selection.mjs
```

Expected: `test_segment_chapter_selection: pass`.

- [ ] **Step 5: Pass segment-specific chapters path from segmented builder**

In `C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs`, read source chapters once:

```js
const sourceChapters = readJson(join(sourceDir, "chapters.json"), []);
```

Import the helper:

```js
import { selectChaptersForSegment } from "./lib/segment-chapter-selection.mjs";
```

When building each segment export, write a segment-local chapters file before quality:

```js
const segmentChapters = selectChaptersForSegment(segmentScript, sourceChapters);
const segmentChaptersPath = join(segmentDir, "chapters.json");
writeFileSync(segmentChaptersPath, JSON.stringify(segmentChapters, null, 2), "utf8");
```

Modify `buildScriptQualitySuite(segmentScript, segment)` signature to `buildScriptQualitySuite(segmentScript, segment, options = {})` and call it with:

```js
const suite = buildScriptQualitySuite(segmentScript, segment, { chapters: segmentChapters });
```

Inside `buildScriptQualitySuite`, add:

```js
const bibleGrounding = Array.isArray(options.chapters) && options.chapters.length
  ? analyzeBibleGrounding(segmentScript, {
    chapters: options.chapters,
    minCitationsPerChapter: 1,
  })
  : { ok: true, failures: [], citationCount: 0, skipped: true };
```

Then include `bibleGrounding.ok` in `ok`, include failures as `bible_grounding:${failure}`, and write it into the suite report.

Do not pass all source chapters into every segment. Multi-segment exports must only validate the chapters that appear in that segment script. Otherwise segment 1 will fail for missing chapter 4 citations, and segment 4 will fail for missing chapter 1 citations even when both are correct locally.

- [ ] **Step 6: Run integration test**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\test_script_quality_bible_grounding.mjs
```

Expected: `test_script_quality_bible_grounding: pass`.

- [ ] **Step 7: Run focused existing tests**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\test_segment_chapter_selection.mjs
node C:\Users\petbl\auto-video\scripts\test_korean_hpsl_structure.mjs
node C:\Users\petbl\auto-video\scripts\test_inferred_chapter_hpsl.mjs
node C:\Users\petbl\auto-video\scripts\test_phase3_script_quality.mjs
```

Expected: all pass.

- [ ] **Step 8: Commit**

```powershell
git add C:\Users\petbl\auto-video\scripts\check_script_quality_suite.mjs C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs C:\Users\petbl\auto-video\scripts\lib\segment-chapter-selection.mjs C:\Users\petbl\auto-video\scripts\test_script_quality_bible_grounding.mjs C:\Users\petbl\auto-video\scripts\test_segment_chapter_selection.mjs
git commit -m "feat: block storyboard builds without bible grounding"
```

---

### Task 6: Improve Revision Brief for Missing Bible Grounding

**Files:**
- Modify: `C:\Users\petbl\auto-video\scripts\generate_script_revision_brief.mjs`
- Test: `C:\Users\petbl\auto-video\scripts\test_revision_brief_bible_grounding.mjs`

- [ ] **Step 1: Write failing revision brief test**

Create `C:\Users\petbl\auto-video\scripts\test_revision_brief_bible_grounding.mjs`:

```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "revision-brief-bible-"));
const reportPath = join(dir, "script-quality-suite-report.json");
const outPath = join(dir, "script-revision-brief.md");

writeFileSync(reportPath, JSON.stringify({
  ok: false,
  failures: [
    "bible_grounding:chapter_1_missing_citation",
    "bible_grounding:vague_bible_claims:2"
  ],
  bibleGrounding: {
    chapterReports: [
      { index: 1, title: "같은 말도 더 아플 때", expectedRef: "사무엘상 1:6-7", citationCount: 0 }
    ]
  }
}, null, 2), "utf8");

execFileSync("node", [
  "scripts/generate_script_revision_brief.mjs",
  reportPath,
  "--out",
  outPath,
], { cwd: "C:/Users/petbl/auto-video", encoding: "utf8" });

const brief = readFileSync(outPath, "utf8");
assert.match(brief, /사무엘상 1:6-7/u);
assert.match(brief, /성경인용/u);
assert.match(brief, /성경은.*말합니다.*처럼 뭉뚱그리지/u);

console.log("test_revision_brief_bible_grounding: pass");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\test_revision_brief_bible_grounding.mjs
```

Expected: FAIL because revision brief does not mention bible grounding.

- [ ] **Step 3: Add grounding instructions to revision brief**

In `C:\Users\petbl\auto-video\scripts\generate_script_revision_brief.mjs`, after existing failure sections, add:

```js
if (report.bibleGrounding?.ok === false || report.failures?.some((item) => item.startsWith("bible_grounding:"))) {
  lines.push("");
  lines.push("## Bible Grounding Required");
  lines.push("- Do not write vague sentences like `성경은 ... 말합니다` without a concrete book/chapter/verse.");
  lines.push("- Each chapter must include at least one `[성경인용:책 장:절] \"원문\"` block from 개역한글판.");
  lines.push("- Immediately after each citation, explain how that verse maps to the listener's modern psychological situation.");
  for (const chapter of report.bibleGrounding?.chapterReports || []) {
    if (!chapter.ok) {
      lines.push(`- Chapter ${chapter.index} (${chapter.title}): add a concrete citation and interpretation from ${chapter.expectedRef}.`);
    }
  }
}
```

- [ ] **Step 4: Run revision brief test**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\test_revision_brief_bible_grounding.mjs
```

Expected: `test_revision_brief_bible_grounding: pass`.

- [ ] **Step 5: Commit**

```powershell
git add C:\Users\petbl\auto-video\scripts\generate_script_revision_brief.mjs C:\Users\petbl\auto-video\scripts\test_revision_brief_bible_grounding.mjs
git commit -m "feat: guide rewrites toward concrete bible citations"
```

---

### Task 7: Update Authoring Rules

**Files:**
- Modify: `C:\Users\petbl\auto-video\auto-video.md`
- Modify: `C:\Users\petbl\auto-video\docs\agent-invocation-templates.md`
- Test: `C:\Users\petbl\auto-video\scripts\test_bible_authoring_docs.mjs`

- [ ] **Step 1: Write failing docs test**

Create `C:\Users\petbl\auto-video\scripts\test_bible_authoring_docs.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const autoVideo = readFileSync("C:/Users/petbl/auto-video/auto-video.md", "utf8");
const templates = readFileSync("C:/Users/petbl/auto-video/docs/agent-invocation-templates.md", "utf8");

assert.match(autoVideo, /각 챕터의 Story 단계에는 짧은 성경 원문 인용을 최소 1회 포함해야 한다/u);
assert.match(autoVideo, /사무엘상 1장 6절/u);
assert.match(autoVideo, /성경은 .* 말합니다.*처럼 뭉뚱그리지 않는다/u);
assert.match(templates, /chapters\.json.*bibleRef/u);
assert.match(templates, /각 담당 챕터마다 \[성경인용:/u);

console.log("test_bible_authoring_docs: pass");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\test_bible_authoring_docs.mjs
```

Expected: FAIL until docs are updated.

- [ ] **Step 3: Update `auto-video.md` Bible citation rule**

In `C:\Users\petbl\auto-video\auto-video.md`, replace the first bullet under `### 성경 원문 인용 규칙` with:

```markdown
각 챕터의 Story 단계에는 짧은 성경 원문 인용을 최소 1회 포함해야 한다. "성경은 이렇게 말합니다"처럼 뭉뚱그리지 말고, `사무엘상 1장 6절은...`처럼 책/장/절을 먼저 밝혀 상황을 설명한 뒤, `[성경인용:책 장:절] "원문"` 블록을 넣고, 바로 다음 문단에서 오늘의 심리 주제와 연결한다.
```

Add good example:

```markdown
좋은 예:

> 사무엘상 1장 6절은 브닌나가 한나를 심히 격동하여 번민케 했다고 말합니다.  
> [성경인용:사무엘상 1:6] "여호와께서 그로 성태치 못하게 하시므로 그 대적 브닌나가 그를 심히 격동하여 번민케 하더라"  
> 여기서 상처는 한 번의 말이 아니라 반복된 관계의 공기 안에서 커집니다. 그래서 오늘 작은 말에 크게 흔들린 마음도, 그 한마디만 듣고 있는 것이 아닐 수 있습니다.

나쁜 예:

> 성경은 그 일이 해마다 반복되었다고 말합니다. 반복된 말은 마음에 길을 냅니다.
```

- [ ] **Step 4: Update agent invocation template**

In `C:\Users\petbl\auto-video\docs\agent-invocation-templates.md`, in the script writer template, add:

```text
chapters.json의 bibleRef를 반드시 사용해. 각 담당 챕터마다 최소 1회 `[성경인용:책 장:절] "개역한글판 원문"` 블록을 넣고, 바로 다음 문단에서 그 장면을 현대 심리 주제에 대입해 설명해. "성경은 말합니다"처럼 책/장/절 없는 일반화 문장으로 대체하지 마.
```

- [ ] **Step 5: Run docs test**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\test_bible_authoring_docs.mjs
```

Expected: `test_bible_authoring_docs: pass`.

- [ ] **Step 6: Commit**

```powershell
git add C:\Users\petbl\auto-video\auto-video.md C:\Users\petbl\auto-video\docs\agent-invocation-templates.md C:\Users\petbl\auto-video\scripts\test_bible_authoring_docs.mjs
git commit -m "docs: require concrete bible citations in scripts"
```

---

### Task 8: Regenerate the Sensitive Heart Script Before Re-render

**Files:**
- Modify generated export files under `C:\Users\petbl\auto-video\exports\gguljam-bible-sensitive-heart-small-words-10min-source`
- Modify generated export files under `C:\Users\petbl\auto-video\exports\gguljam-bible-sensitive-heart-small-words-10min-001`

- [ ] **Step 1: Confirm current export fails new gate**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\check_bible_grounding.mjs --script C:\Users\petbl\auto-video\exports\gguljam-bible-sensitive-heart-small-words-10min-001\segments\segment-01\script.txt --chapters C:\Users\petbl\auto-video\exports\gguljam-bible-sensitive-heart-small-words-10min-001\chapters.json --min-citations-per-chapter 1
```

Expected: FAIL with `chapter_*_missing_citation` and `vague_bible_claims`.

- [ ] **Step 2: Rewrite source script with concrete verse anchors**

Rewrite `C:\Users\petbl\auto-video\exports\gguljam-bible-sensitive-heart-small-words-10min-source\script.txt` so each chapter includes at least one of:

- Chapter 1: `사무엘상 1:6`
- Chapter 2: `사무엘상 1:7`
- Chapter 3: `사무엘상 1:15-16`
- Chapter 4: `사무엘상 1:10-11`
- Chapter 5: `사무엘상 1:17-18`

Preserve the sleep-friendly tone, but make each citation flow as:

1. 상황 설명 with book/chapter/verse.
2. `[성경인용:...] "원문"` exact block.
3. Modern psychology mapping.
4. Gentle consolation.

- [ ] **Step 3: Rebuild segmented storyboard**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs --source-slug gguljam-bible-sensitive-heart-small-words-10min-source --slug gguljam-bible-sensitive-heart-small-words-10min-001 --target-seconds 600 --segment-minutes 10 --target-chars-per-second 8.0
```

Expected: build succeeds only if Bible grounding passes.

- [ ] **Step 4: Verify new segment script**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\check_bible_grounding.mjs --script C:\Users\petbl\auto-video\exports\gguljam-bible-sensitive-heart-small-words-10min-001\segments\segment-01\script.txt --chapters C:\Users\petbl\auto-video\exports\gguljam-bible-sensitive-heart-small-words-10min-001\chapters.json --min-citations-per-chapter 1
node C:\Users\petbl\auto-video\scripts\check_bible_citation.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-sensitive-heart-small-words-10min-001\segments\segment-01\script.txt --min-citations 5 --require-reference "사무엘상 1:6" --require-reference "사무엘상 1:10-11" --require-reference "사무엘상 1:17-18"
```

Expected: both pass.

- [ ] **Step 5: Only then re-render**

Do not render until these pass:

```powershell
node C:\Users\petbl\auto-video\scripts\check_script_quality_suite.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-sensitive-heart-small-words-10min-001\segments\segment-01\script.txt --chapters C:\Users\petbl\auto-video\exports\gguljam-bible-sensitive-heart-small-words-10min-001\chapters.json --out C:\Users\petbl\auto-video\exports\gguljam-bible-sensitive-heart-small-words-10min-001\segments\segment-01\script-quality-suite-report.json
node C:\Users\petbl\auto-video\scripts\check_storyboard_context_alignment.mjs --segment-dir C:\Users\petbl\auto-video\exports\gguljam-bible-sensitive-heart-small-words-10min-001\segments\segment-01
node C:\Users\petbl\auto-video\scripts\check_visual_grounding_timeline.mjs --segment-dir C:\Users\petbl\auto-video\exports\gguljam-bible-sensitive-heart-small-words-10min-001\segments\segment-01
```

Expected: all pass.

---

## Final Verification

Run the full focused suite:

```powershell
node C:\Users\petbl\auto-video\scripts\test_bible_reference.mjs
node C:\Users\petbl\auto-video\scripts\test_bible_grounding_analysis.mjs
node C:\Users\petbl\auto-video\scripts\test_bible_citation_required_gate.mjs
node C:\Users\petbl\auto-video\scripts\test_sensitive_heart_bible_grounding_regression.mjs
node C:\Users\petbl\auto-video\scripts\test_script_quality_bible_grounding.mjs
node C:\Users\petbl\auto-video\scripts\test_revision_brief_bible_grounding.mjs
node C:\Users\petbl\auto-video\scripts\test_bible_authoring_docs.mjs
node C:\Users\petbl\auto-video\scripts\test_korean_hpsl_structure.mjs
node C:\Users\petbl\auto-video\scripts\test_inferred_chapter_hpsl.mjs
node C:\Users\petbl\auto-video\scripts\test_phase3_script_quality.mjs
```

Expected: every command prints `pass` or exits 0.

Then run the actual export gate:

```powershell
node C:\Users\petbl\auto-video\scripts\check_bible_grounding.mjs --script C:\Users\petbl\auto-video\exports\gguljam-bible-sensitive-heart-small-words-10min-001\segments\segment-01\script.txt --chapters C:\Users\petbl\auto-video\exports\gguljam-bible-sensitive-heart-small-words-10min-001\chapters.json --min-citations-per-chapter 1
node C:\Users\petbl\auto-video\scripts\check_bible_citation.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-sensitive-heart-small-words-10min-001\segments\segment-01\script.txt --min-citations 5
python C:\Users\petbl\auto-video\scripts\validate_segmented_export.py --export-dir C:\Users\petbl\auto-video\exports\gguljam-bible-sensitive-heart-small-words-10min-001
```

Expected:

- Bible grounding: `"ok": true`
- Citation checker: `"ok": true`, `"citationCount"` at least 5
- Segmented validation: no failures. Duration warnings are acceptable only if audio speed QA explains the difference.

---

## Self-Review

- Spec coverage: This plan addresses the user's exact complaint: missing book/chapter/verse, missing direct quotation, missing modern application of the quoted verse, and weak "성경에서는 이렇습니다" generalization.
- Root cause coverage: The plan fixes all four root causes: incomplete local Bible data, permissive citation checker, missing quality-suite integration, and authoring rules that do not force citation grounding.
- Rendering safety: The plan blocks re-render until `check_bible_grounding` and `check_bible_citation` both pass.
- Copyright/source safety: Only 개역한글판 data is used, and new verse data must be verified against the user's local source before being committed.
- Placeholder scan: No implementation step depends on an undefined function without defining it in an earlier task.
