# Bible Citation Grounded Script Plan Review Report

이 보고서는 `C:\Users\petbl\auto-video\docs\superpowers\plans\2026-07-03-bible-citation-grounded-script-plan.md` 계획 문서와 auto-video 코드베이스 및 워크플로우를 분석하여 발견한 문제점과 이에 대한 해결책 및 개선안을 정리한 문서입니다.

---

## 1. 종합 평가 및 아키텍처 타당성

본 계획안은 "성경 이야기" 대본임에도 구체적인 장절과 본문 인용 없이 심리 에세이 형식으로 흐르는 문제점을 해결하기 위해 설계되었습니다.
로컬 `bible-krv.json` 데이터를 구축하고, 원문 검증과 장절 매칭 여부를 검사하는 품질 게이트를 빌드 체인에 추가하는 아키텍처는 프로젝트의 요구사항(저작권 준수, 콘텐츠 신뢰도 강화, TTS 적합성)에 완벽히 부합합니다.

다만, 실제 장편 영상 제작 워크플로우(특히 멀티 세그먼트 분할 처리)와 LLM의 실질적인 한국어 출력 형태를 고려할 때, **이대로 구현할 경우 빌드가 실패하거나 검증을 통과하지 못하는 몇 가지 크리티컬한 버그와 제약 사항**이 식별되었습니다.

---

## 2. 발견된 문제점 및 개선 방향 (주요 5가지)

### ① [크리티컬] 멀티 세그먼트 빌드 시 인덱스 불일치 버그 (Task 5 연계)
* **문제점:** 60분짜리 전체 대본을 15분짜리 세그먼트 4개로 쪼갤 때, 각 세그먼트용 `segmentScript`는 전체 대본의 일부만 포함하게 됩니다 (예: Segment 2는 4~6챕터 포함).
  그러나 계획안의 Task 5 코드에 따르면, 모든 세그먼트의 품질 체크 시 `sourceChapters` 전체(1~12챕터)를 동일하게 넘겨줍니다. 
  `analyzeBibleGrounding` 내부에서는 `splitChapters`로 추출된 세그먼트 내 챕터 배열(길이 3)의 인덱스(0, 1, 2)를 전체 챕터 메타데이터 `chaptersInput[index]`와 비교합니다.
  결과적으로 **Segment 2의 4챕터(인덱스 0)를 검사할 때, 1챕터의 `bibleRef` 메타데이터를 가져와 비교하게 되어 유효성 검사가 오동작하고 빌드가 무조건 실패**하게 됩니다.
* **해결책:** `build_segmented_storyboards.mjs`에서 각 세그먼트의 스크립트 텍스트를 파싱하여 **해당 세그먼트가 실제로 다루는 챕터만 필터링한 `segmentChapters`를 도출하여 게이트에 전달**해야 합니다.

### ② [크리티컬] 한국어 스마트 따옴표(`“`, `”`) 매칭 실패 우려 (Task 2/3 연계)
* **문제점:** 계획안의 인용 추출 정규식 `const CITATION_RE = /\[성경인용:([^\]]+)\]\s*"([^"]+)"/gu`는 영문 표준 직쌍따옴표(`"`)만 매칭합니다.
  하지만 LLM이 한국어로 스크립트를 작성하거나 한글 에디터로 수정하는 과정에서 **한국어 대화형 쌍따옴표(`“`, `”`)로 자동 치환되는 경우가 빈번**합니다. 만약 스마트 따옴표가 사용되면 정규식 매칭이 아예 누락되어 인용 카운트 부족(`citation_count_too_low`)으로 빌드가 반려됩니다.
* **해결책:** 정규식이 직쌍따옴표와 스마트 쌍따옴표를 모두 매칭할 수 있도록 보완합니다: `/\[성경인용:([^\]]+)\]\s*["“]([^"”]+)["”]/gu`

### ③ [구조 제약] 성경 구절이 필요 없는 챕터(도입/결론 등) 지원 불가
* **문제점:** 계획안의 `analyzeBibleGrounding`은 모든 챕터에 대해 일률적으로 `minCitationsPerChapter` (기본값 1)과 `hasSpecificReference` 검사를 수행합니다.
  하지만 향후 인트로나 아웃트로 등 성경 구절 인용이 아예 불필요하고 현대 심리적 해석이나 낭독 위주로 흘러가는 챕터가 추가된다면, 해당 챕터들의 유효성 검사를 통과할 방법이 없습니다.
* **해결책:** `chapters.json`에 `bibleRef`가 명시되지 않았거나 비어 있는 챕터는 성경 접지성(Bible Grounding) 검증 대상에서 조건부로 제외(Skip)시키는 유연성을 부여해야 합니다.

### ④ [품질 개선] 개역한글판 특유의 띄어쓰기 및 미세 문장부호 불일치 완화 (Task 3 연계)
* **문제점:** 개역한글판 성경 텍스트는 고어 표현이 많고, 마침표(.)나 쉼표(,)가 없거나 띄어쓰기가 현대 표준어와 달라 LLM 혹은 작가가 대본에 직접 타이핑/복사할 때 미세한 공백이나 문장부호(쉼표 위치 등) 불일치로 검증이 깨질 수 있습니다.
* **해결책:** `check_bible_citation.mjs`의 `normalize` 함수가 연속 공백을 하나로 줄여주는 것 외에도, 비교 시 구두점(`.,\/#!$%\^&\*;:{}=\-_`~()""‘’“”?` 등)을 추가로 제거하도록 개선하여 불필요한 오류 빌드 반려를 최소화합니다.

### ⑤ [환경 호환성] OS 간 유니코드 정규화(NFC/NFD) Mismatch 방지
* **문제점:** macOS 환경(NFD 자소 분리)과 Windows/Linux 환경(NFC 조합형) 간에 스크립트 한글 텍스트를 파일로 읽고 비교할 때 문자열 비교가 실패할 수 있습니다.
* **해결책:** 텍스트를 파싱하거나 데이터베이스에서 조회할 때 문자열을 `.normalize("NFC")`로 정규화하는 전처리 과정을 포함합니다.

---

## 3. 코드베이스 반영 구체안 (Refined Implementations)

### A. 세그먼트별 챕터 슬라이싱 적용 (`build_segmented_storyboards.mjs` 개선)

각 세그먼트 루프 내부에서 전체 챕터 중 **해당 세그먼트 스크립트 안에 포함된 챕터 헤더**를 찾아 `segmentChapters`를 만듭니다.

```js
// build_segmented_storyboards.mjs 의 루프 안에서 사용될 챕터 필터링 헬퍼
function isChapterHeading(paragraph) {
  return /^(#{1,3}\s+|Chapter\s*\d+|챕터\s*\d+|\d+\s*[.)]\s*챕터)/iu.test(String(paragraph || "").trim());
}

function getSegmentChapters(segmentScript, sourceChapters) {
  const paragraphs = segmentScript.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const segmentChapters = [];
  
  for (const p of paragraphs) {
    if (isChapterHeading(p)) {
      // "챕터 4. 마음이 울 때"에서 숫자 4를 추출
      const match = p.match(/^(?:#{1,3}\s+)?(?:Chapter|챕터)\s*(\d+)/i) || p.match(/^(?:#{1,3}\s+)?(\d+)\s*[.)]\s*챕터/i);
      if (match) {
        const chapterNum = Number(match[1]);
        const ch = sourceChapters.find(c => c.index === chapterNum);
        if (ch) {
          segmentChapters.push(ch);
        }
      }
    }
  }
  
  // 만약 챕터 번호 추출이 실패한 빌드의 경우(자동 챕터 등)를 위한 Fallback
  if (segmentChapters.length === 0 && sourceChapters.length > 0) {
    return sourceChapters; // 이 경우에만 전체 챕터를 반환하여 검사 진행
  }
  return segmentChapters;
}
```

그리고 이 `segmentChapters`를 빌드 루프 내부와 검증 파일 저장에 적용합니다:
```js
  // build_segmented_storyboards.mjs 수정
  const segmentChapters = getSegmentChapters(segmentScript, sourceChapters);
  
  // segment 폴더에 저장할 때 전체가 아닌 해당 세그먼트의 챕터만 저장하여 데이터 정합성 보장
  const segmentChaptersPath = join(segmentDir, "chapters.json");
  writeFileSync(segmentChaptersPath, JSON.stringify(segmentChapters, null, 2), "utf8");

  // 품질 검사 호출 시 해당 세그먼트의 챕터 정보 전달
  const qualitySuite = skipScriptQuality
    ? { ok: true, skipped: true, failures: [] }
    : buildScriptQualitySuite(segmentScript, segment, { chapters: segmentChapters });
```

---

### B. 스마트 따옴표 지원 및 조건부 유효성 검사 (`bible-grounding-analysis.mjs` 개선)

`C:\Users\petbl\auto-video\scripts\lib\bible-grounding-analysis.mjs`에 적용될 코드 구조입니다. 스마트 쌍따옴표를 매칭하고, `bibleRef` 메타데이터가 존재할 때만 필수 인용구 검증을 수행합니다.

```js
import { splitChapters } from "./script-structure-analysis.mjs";

// 스마트 쌍따옴표 “ ” 와 일반 쌍따옴표 " " 모두 지원하도록 개선
const CITATION_RE = /\[성경인용:([^\]]+)\]\s*["“]([^"”]+)["”]/gu;
const SPECIFIC_REF_RE = /(?:창세기|출애굽기|레위기|민수기|신명기|여호수아|사사기|룻기|사무엘상|사무엘하|열왕기상|열왕기하|역대상|역대하|에스라|느헤미야|에스더|욥기|시편|잠언|전도서|아가|이사야|예레미야|예레미야애가|에스겔|다니엘|호세아|요엘|아모스|오바댜|요나|미가|나훔|하박국|스바냐|학개|스가랴|말라기|마태복음|마가복음|누가복음|요한복음|사도행전|로마서|고린도전서|고린도후서|갈라디아서|에베소서|빌립보서|골로새서|데살로니가전서|데살로니가후서|디모데전서|디모데후서|디도서|빌레몬서|히브리서|야고보서|베드로전서|베드로후서|요한일서|요한이서|요한삼서|유다서|요한계시록)\s*\d+\s*(?:장|:)\s*\d+/u;

// 개별 문장(마침표 기준) 내에서 성경은/성경에서는과 말합니다/기록합니다가 포함된 비근거적 표현 추출
const VAGUE_CLAIM_RE = /성경(?:은|에서는|에선)?\s+[^.?!\n]+?(?:말합니다|보여\s*줍니다|기록합니다)/gu;

export function extractCitationBlocks(text) {
  // NFC 정규화 전처리 적용
  const normalizedText = String(text || "").normalize("NFC");
  return [...normalizedText.matchAll(CITATION_RE)].map((match) => ({
    reference: match[1].trim(),
    quote: match[2].trim(),
    index: match.index,
  }));
}

export function analyzeBibleGrounding(text, options = {}) {
  const chaptersInput = Array.isArray(options.chapters) ? options.chapters : [];
  const minCitationsPerChapter = Number(options.minCitationsPerChapter ?? 1);
  const normalizedText = String(text || "").normalize("NFC");
  
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
    
    // chaptersInput은 필터링된 해당 세그먼트의 챕터 메타데이터 배열
    const expectedRef = chaptersInput[index]?.bibleRef || "";
    
    // 만약 bibleRef가 비어 있다면(예: 성경 구절이 필요 없는 인트로/아웃트로 챕터 등) 유효성 검사 skip
    const requiresGrounding = !!expectedRef;
    
    const expectedBook = expectedRef.replace(/\s*\d+.*/u, "").trim();
    const expectedBookMentioned = expectedBook ? body.includes(expectedBook) : true;
    
    // 조건부 충족 조건 설정
    const citationOk = !requiresGrounding || (chapterCitations.length >= minCitationsPerChapter);
    const referenceOk = !requiresGrounding || hasSpecificReference;
    const bookOk = !requiresGrounding || expectedBookMentioned;
    const ok = citationOk && referenceOk && bookOk;
    
    if (requiresGrounding) {
      if (chapterCitations.length < minCitationsPerChapter) {
        failures.push(`chapter_${index + 1}_missing_citation`);
      }
      if (!hasSpecificReference) {
        failures.push(`chapter_${index + 1}_missing_specific_reference`);
      }
      if (!expectedBookMentioned) {
        failures.push(`chapter_${index + 1}_missing_expected_book:${expectedBook}`);
      }
    }
    
    return {
      index: index + 1,
      title: chapter.title,
      expectedRef,
      citationCount: chapterCitations.length,
      hasSpecificReference,
      expectedBookMentioned,
      ok,
    };
  });

  if (vagueClaims.length) {
    failures.push(`vague_bible_claims:${vagueClaims.length}`);
  }
  
  return {
    ok: failures.length === 0,
    failures,
    citationCount: citations.length,
    vagueClaims,
    chapterReports,
  };
}
```

---

### C. 문장부호 정규화 비교 (`check_bible_citation.mjs` 개선)

`C:\Users\petbl\auto-video\scripts\check_bible_citation.mjs` 내부의 텍스트 비교 로직을 보완하여, 따옴표나 쉼표, 마침표 차이로 인한 검증 반려를 차단합니다.

```js
// check_bible_citation.mjs 내부 비교문 수정 제안
for (const block of citationBlocks) {
  try {
    const { verses } = lookupVerses(block.reference);
    const expected = verses.map((v) => v.text).join(" ");
    
    // 공백 병합 및 모든 문장부호/따옴표 제거 후 소문자화하여 순수 자소 단위만 비교
    const normalize = (value) => value
      .normalize("NFC")
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()""‘’“”?]/gu, "") // 문장부호 및 스마트/일반 따옴표 제거
      .replace(/\s+/g, " ")
      .trim();

    if (normalize(block.quote) !== normalize(expected)) {
      failures.push(`${block.reference}: quoted text does not match 개역한글판 source verbatim`);
    }
  } catch (error) {
    failures.push(`${block.reference}: ${error.message}`);
  }
}
```

---

## 4. 검증 및 롤백 계획 피드백

1. **테스트 데이터의 부재 점검:**
   `scripts/test_bible_reference.mjs`에서 `사무엘상 1:6` 등을 참조할 때, 실제 `data/bible-krv.json` 파일에 해당 키가 존재하지 않으면 테스트 자체가 실패합니다.
   * **보완 제안:** Task 1에서 로컬 KRV 데이터를 추가하기 전에 테스트 코드를 먼저 실행하면 무조건 `Missing chapter` 에러가 발생하므로, "Step 2: Run test to verify it fails"에서 예외 종류(`Missing chapter`)가 올바르게 핸들링되는지 확인하는 메시지를 추가하는 것이 좋습니다.

2. **재작성 브리프 보완 가이드 적합성:**
   인용 실패 및 모호성 감지 시 `generate_script_revision_brief.mjs`를 통해 AI 모델에게 전달되는 재작성 가이드(Task 6)는 훌륭합니다. 이 가이드는 재생성 프로세스의 성공률을 획기적으로 올릴 것입니다.

---

## 5. 결론 및 제안 요약

* 본 구현 계획은 현재 꿀잠성경 대본의 아쉬웠던 고증 문제를 도구와 빌드 게이트 차원에서 단단하게 막아줄 훌륭한 설계안입니다.
* 다만 **멀티 세그먼트 환경에서 각 세그먼트별로 챕터를 필터링하지 않고 전체 챕터 메타데이터를 비교하는 부분**은 빌드를 원천 차단하는 크리티컬한 버그이므로, 본 보고서에서 제안한 `getSegmentChapters()` 형태의 챕터 슬라이싱 필터링 로직을 Task 5 구현 전 반드시 반영해야 합니다.
* 스마트 쌍따옴표(`“`, `”`) 처리와 띄어쓰기 및 구두점을 관대하게 비교하는 정규화 로직을 추가하면 오검출(False Positive)을 막아 불필요한 빌드 지연을 막을 수 있습니다.
