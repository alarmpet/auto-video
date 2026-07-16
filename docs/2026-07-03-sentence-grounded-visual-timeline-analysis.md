# Sentence-Grounded Visual Timeline 플랜 분석 보고서

> 작성일: 2026-07-03  
> 분석 대상: `docs/superpowers/plans/2026-07-03-sentence-grounded-visual-timeline-plan.md`  
> 코드베이스: `C:/Users/petbl/auto-video`  
> 분석 범위: 플랜 설계, 기존 코드 구조, 워크플로우 전체 흐름

---

## 요약

이 플랜은 기존의 **고정 scene count + 균등 텍스트 분할 방식**을 제거하고, 문장 경계를 존중하는 sentence-grounded 방식으로 visual timeline을 구성하려는 올바른 방향의 개선이다. 전반적으로 설계 의도가 명확하고, TDD 방식의 단계별 검증도 포함되어 있어 구현 품질 측면에서도 좋은 플랜이다.

그러나 코드베이스를 실제로 읽어본 결과, **몇 가지 치명적인 불일치 및 숨겨진 위험 요소**가 존재한다. 아래에 우선순위 순으로 정리한다.

---

## 🔴 치명적 문제 (구현 전에 반드시 해결)

### 1. validate_segmented_export.py에 하드코딩된 "6초 x 10 + 30초 x 28" 검증 로직과 신규 플랜 충돌

**위치:** `scripts/validate_segmented_export.py` L278~283

```python
if segment_id == "segment-01":
    durations = [float(scene.get("durationSeconds", 0)) for scene in timeline_scenes]
    if durations[:10] != [6.0] * 10:
        failures.append("segment-01: first 10 visual durations must be 6s each")
    if any(abs(value - 30.0) > 0.01 for value in durations[10:]):
        failures.append("segment-01: body visual durations after first 10 scenes must be 30s each")
```

**문제:** 이 검증 로직은 현재 `buildVisualTimelineForWindow()`가 생성하는 **균등 고정 duration** 구조를 전제로 한다. 반면 플랜이 도입하는 `buildSentenceGroundedVisualTimeline()`은 body scene의 duration이 20~40초 범위 내에서 문장 경계에 따라 유동적으로 결정된다. 따라서 플랜 구현 후 이 검증은 **모든 body scene에서 실패**한다.

**플랜에서의 대응:** 플랜 Task 3 Step 5에서 `validate_segmented_export.py`를 수정하라고 하지만, 이 기존 하드코딩 규칙을 삭제/수정한다는 명시가 없다. 플랜의 수정 내용은 `visual-grounding-timeline-report.json` 파일 존재 여부만 추가하는 것이다. **기존 30초 고정 검증 로직은 그대로 남아 있어 충돌이 발생한다.**

**권장 수정:**

```python
# 기존 하드코딩 블록 삭제 후 아래로 교체
if segment_id == "segment-01":
    opening_scenes = [s for s in timeline_scenes if s.get("timingBand") == "opening"]
    body_scenes = [s for s in timeline_scenes if s.get("timingBand") == "body"]
    if len(opening_scenes) != 10:
        failures.append(f"segment-01: expected 10 opening scenes, got {len(opening_scenes)}")
    for s in opening_scenes:
        if float(s.get("durationSeconds", 0)) > 6.5:
            failures.append(f"segment-01: opening scene {s.get('order')} duration exceeds 6.5s")
    for i, s in enumerate(body_scenes[:-1]):  # 마지막 장면은 예외
        d = float(s.get("durationSeconds", 0))
        if d < 20 or d > 40.5:
            failures.append(f"segment-01: body scene {s.get('order')} duration {d}s out of 20-40s range")
```

---

### 2. build_segmented_storyboards.mjs 루트 경로 하드코딩

**위치:** `scripts/build_segmented_storyboards.mjs` L14

```js
const root = "C:/Users/petbl/auto-video";
```

**문제:** 플랜의 Task 2 통합 테스트는 `process.env.AUTO_VIDEO_ROOT`를 이용해 임시 디렉토리를 사용한다.

```js
env: { ...process.env, AUTO_VIDEO_ROOT: root },
```

그러나 현재 `build_segmented_storyboards.mjs`는 `process.env.AUTO_VIDEO_ROOT`를 읽지 않고 경로가 **하드코딩**되어 있다. 따라서 테스트를 실행해도 파일이 임시 디렉토리가 아닌 **실제 `exports/` 디렉토리에 쓰이게 된다.** 이는 테스트 격리를 완전히 파괴한다.

**권장 수정:**

```js
const root = process.env.AUTO_VIDEO_ROOT || "C:/Users/petbl/auto-video";
```

또한 플랜의 Task 2 Step 2 Expected failure 메시지가 `AssertionError: timeline.scenes.filter(...opening...).length is not 10`으로 되어 있으나, 실제로는 `ENOENT: no such file` 류의 오류가 먼저 발생할 가능성이 높다. 테스트가 잘못된 폴더를 가리키기 때문이다.

---

### 3. --skip-script-quality 플래그의 환경변수 누락

**위치:** `scripts/build_segmented_storyboards.mjs` L22~24

```js
if (skipScriptQuality && process.env.AUTO_VIDEO_ALLOW_TEST_BYPASS !== "1") {
  throw new Error("--skip-script-quality is only allowed when AUTO_VIDEO_ALLOW_TEST_BYPASS=1 for smoke tests");
}
```

**문제:** 플랜 Task 2의 통합 테스트(Step 1)는 `--skip-script-quality`를 사용하지만, `AUTO_VIDEO_ALLOW_TEST_BYPASS=1` 환경변수 설정이 누락되어 있다. 테스트 코드의 `execFileSync` 호출에 `env: { ...process.env, AUTO_VIDEO_ROOT: root }`만 있고 `AUTO_VIDEO_ALLOW_TEST_BYPASS: "1"`이 없다.

**권장 수정:**

```js
env: { ...process.env, AUTO_VIDEO_ROOT: root, AUTO_VIDEO_ALLOW_TEST_BYPASS: "1" },
```

---

## 🟠 중요 문제 (구현 중 버그 유발 가능)

### 4. splitKoreanSentences() 정규식의 한국어 처리 불완전성

**위치:** 플랜 Task 1 Step 3

```js
return compact
  .split(/(?<=[.!?。！？]|[.?!]\s)|(?<=[다요죠까니다])[.?!]?\s+/u)
```

**문제:** 한국어 문장 종결 어미 패턴 `[다요죠까니다]`가 너무 단순하다. 실제 종결 어미는 `입니다`, `합니다`, `됩니다`, `입니까`, `하세요`, `겠습니다` 등 훨씬 다양하다. 실제 `script.txt`를 보면 `"모든 것이 끝난 것처럼 보였습니다. 하지만..."` 처럼 마침표 뒤에 공백과 다음 문장이 이어지는 패턴이 주를 이룬다.

**권장 수정 — 더 단순하고 예측 가능한 구두점 기반 분리:**

```js
export function splitKoreanSentences(text) {
  const compact = String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (!compact) return [];
  return compact
    .split(/(?<=[.!?。！？])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
```

한국어 종결 어미 의존 없이 구두점 기반 분리만 사용하며, 실제 script.txt 패턴과 일치한다.

---

### 5. charsPerSecond 기본값 불일치: 5.2 vs 6.8

**위치:**
- `build_segmented_storyboards.mjs` L71: `const targetCharsPerSecond = Number(args.targetCharsPerSecond || 5.2);`
- 플랜 Task 1 테스트: `charsPerSecond: 6.8`
- 플랜 Task 2 Step 4 코드: `charsPerSecond: targetCharsPerSecond` (실제로는 5.2 전달)

**문제:** 테스트는 `6.8`을 사용하고 실제 빌드는 `5.2`를 사용한다. 두 값 사이에는 약 30% 차이가 있어, 테스트에서 통과한 scene 분할 결과가 실제 빌드에서는 완전히 달라진다. 특히 body scene의 duration이 20~40초 범위 내에 들어오는지 여부가 달라질 수 있다.

또한 `auto-video.md` L585에는 `기본값은 초당 6.8자`라고 되어 있으나 실제 코드는 5.2를 쓰고 있어 **문서와 코드도 불일치**한다.

**권장 조정:** 테스트의 6.8을 5.2로 맞추거나, 반대로 문서를 수정해야 한다. 테스트와 프로덕션 코드가 다른 상수를 쓰면 회귀 감지가 불가능하다.

---

### 6. segment.sceneCount 업데이트 후 totalSceneCount가 stale 상태로 남음

**위치:** `build_segmented_storyboards.mjs` L231~246

플랜 Task 2 Step 4는 `segment.sceneCount = groundedScenes.length;`로 세그먼트의 sceneCount를 업데이트하지만, export 루트의 `production.json`에는 `totalSceneCount: segmentPlan.totalSceneCount`가 그대로 기록된다. 이 값은 `buildSegmentPlan()` 시점에 계산된 **원래 추정치**이며, grounded 결과로 업데이트되지 않는다.

**권장 수정:**

```js
// 모든 세그먼트 처리 후:
const actualTotalSceneCount = segmentRecords.reduce((sum, s) => sum + s.sceneCount, 0);
// production.json 및 segment-manifest.json 작성 시 이 값 사용
```

---

### 7. check_visual_grounding_timeline.mjs의 keyword 체크 로직 약점

**위치:** 플랜 Task 3 Step 3

```js
if ((scene.keywords || []).length && keywordHits.length === 0 && !score.ok) {
  sceneFailures.push(`missing_chunk_keyword:${scene.keywords.join("|")}`);
}
```

**문제:** `!score.ok`인 경우에만 한국어 keyword miss를 실패로 올린다. 즉, **영어 프롬프트 alignment가 OK면 한국어 키워드가 하나도 없어도 통과**한다. 이는 gate의 핵심 목적(프롬프트가 실제 narration chunk를 반영하는지)을 약화시킨다.

**권장 수정:**

```js
const keywordHitRatio = scene.keywords?.length
  ? keywordHits.length / scene.keywords.length
  : 1;
if (keywordHitRatio < 0.25 && scene.keywords?.length >= 2) {
  sceneFailures.push(`low_chunk_keyword_coverage:${keywordHitRatio.toFixed(2)}`);
}
```

---

## 🟡 개선 권장사항 (기능 완성도 향상)

### 8. scene-context-card.mjs에 엘리야 관련 캐릭터 규칙 없음

**위치:** `scripts/lib/scene-context-card.mjs` L12~24

현재 `CHARACTER_RULES`에는 야곱, 에서, 카인, 아벨, 아담, 하와만 있다. 플랜 Task 6의 검증 대상인 엘리야(`엘리야|elijah`)가 없다.

결과적으로 엘리야 스크립트로 context card를 만들면 `biblicalCharacters`가 빈 배열이 되고, `subject = "a lone biblical figure"`, `visualAnchor`가 generic해진다. `requiredPromptTerms`에 인물명이 빠지므로 grounding gate에서 영어 인물명 체크가 실질적으로 작동하지 않게 된다.

**권장 추가:**

```js
{ re: /엘리야|elijah/i, value: "Elijah" },
{ re: /요셉|joseph/i, value: "Joseph" },
{ re: /다윗|david/i, value: "David" },
{ re: /모세|moses/i, value: "Moses" },
{ re: /이세벨|jezebel/i, value: "Jezebel" },
```

`PSYCHOLOGY_RULES`에도 번아웃/탈진 관련 패턴 추가가 필요하다:

```js
{
  re: /번아웃|탈진|지치|소진|exhaustion|burnout/i,
  concept: "exhaustion and the collapse after sustained effort",
  emotion: "deeply tired but still faithful",
  objects: ["broom tree", "charcoal bread", "desert ground"],
  required: ["exhaustion", "collapse after effort"],
},
```

---

### 9. inferBiblicalEvent()에 엘리야 패턴 없음

**위치:** `scripts/lib/scene-context-card.mjs` L375~385

엘리야 스크립트에서 생성되는 모든 context card의 `biblicalEvent`가 `"quiet biblical inner-life moment"` 기본값으로 떨어진다. 프롬프트 품질 저하를 유발한다.

**권장 추가:**

```js
if (/갈멜|갈멜산|carmel/i.test(text)) return "Elijah calling fire from heaven on Mount Carmel";
if (/로뎀나무|broom tree/i.test(text)) return "Elijah resting under the broom tree in the wilderness";
if (/세미한 소리|still small voice/i.test(text)) return "God speaking to Elijah in a still small voice at Horeb";
if (/엘리야|elijah/i.test(text)) return "Elijah in the wilderness after the great victory";
```

---

### 10. DETAIL_LEXICON에 엘리야 관련 구체 이미지 없음

**위치:** `scripts/lib/scene-context-card.mjs` L81~114

현재 `DETAIL_LEXICON`은 야곱, 카인/아벨, 아담/하와 이야기 중심이다. 엘리야 이야기에 등장하는 주요 구체 명사가 없다.

| 한국어 | 영어 번역 (추가 필요) |
|--------|----------------------|
| 로뎀나무 | solitary broom tree in a barren wilderness |
| 숯불 / 숯 | glowing charcoal embers on desert ground |
| 호렙 / 시내산 | vast mountain face under open sky |
| 이세벨 | threatening shadow cast across a distant path |

---

### 11. 플랜에 globalStartSeconds > 0 케이스(두 번째 세그먼트) 테스트 없음

플랜의 모든 테스트는 `globalStartSeconds: 0`으로 실행된다. 실제 두 번째 세그먼트는 `globalStartSeconds: 900` 등의 값을 받으며, 이 경우 모든 scene이 body로 처리된다. 이 동작이 의도된 것임을 테스트로 명시적으로 검증해야 한다.

**권장 테스트 추가:**

```js
const secondSegmentScenes = buildSentenceGroundedVisualTimeline({
  script: bodyScript,
  targetSeconds: 900,
  globalStartSeconds: 900,
  openingSeconds: 60,
  ...
});
assert.ok(secondSegmentScenes.every(s => s.timingBand === "body"),
  "두 번째 세그먼트는 전체가 body band여야 한다");
```

---

### 12. 플랜 Task 6의 node -e 명령에 중복 키 문법 오류

**위치:** 플랜 Task 6 Step 2

```powershell
node -e "...console.log({sceneCount:r.sceneCount, opening:r.openingSceneCount, body:r.bodySceneCount, first:r.scenes.slice(0,3), body:r.scenes.find(s=>s.timingBand==='body')});"
# ^^ "body" 키가 중복됨 — 두 번째 body 값이 첫 번째를 덮어씀
```

**권장 수정:**

```js
{ opening: r.openingSceneCount, bodySceneCount: r.bodySceneCount, firstBodyScene: r.scenes.find(s => s.timingBand === "body") }
```

---

### 13. report 파일명 혼동 가능성

플랜은 두 가지 report를 생성한다:
- `visual-grounding-report.json` — build 단계 산출물 (scene narration, keywords 등)
- `visual-grounding-timeline-report.json` — gate 단계 검증 결과 (ok/fail)

두 파일명이 매우 유사해 에이전트와 사람이 혼동하기 쉽다. `agent-handoff-contract.md`에 역할 구분을 명확히 명시할 것을 권장한다. 또는 리네이밍:
- `visual-grounding-report.json` → `visual-timeline-build-report.json`
- `visual-grounding-timeline-report.json` → `visual-grounding-gate-report.json`

---

## 🟢 플랜의 강점 (유지해야 할 요소)

### ✅ TDD 방식의 단계별 검증 구조

"실패하는 테스트 먼저 → 구현 → 통과 확인" 순서를 철저히 따르는 구조가 훌륭하다. 기존 `test_scene_prompt_diversity_gate.mjs` 패턴을 그대로 확장하는 일관성도 좋다.

### ✅ body scene 마지막 scene의 duration 예외 처리

```js
scene.durationSeconds >= 20 || index === arr.length - 1
```

마지막 scene이 20초 미만이어도 허용하는 예외 처리가 테스트에 포함되어 있다. script 길이와 segment 경계가 깔끔하게 맞지 않을 수 있기 때문에 현실적인 처리다.

### ✅ visual anchor 중복 방지 재시도 로직 보존

기존 `buildSceneContextCard()` 호출 시 `usedAnchors` Set으로 최대 6번 재시도하는 로직이 플랜 교체 후에도 자연스럽게 유지된다. `segmentSceneTexts`를 `groundedScenes.map()`으로 교체하는 방식이어서 기존 중복 방지 로직이 그대로 작동한다.

### ✅ storyboard 파싱 로직의 정확성

`check_visual_grounding_timeline.mjs`의 parseStoryboard()가 `/ duration:X` 이후를 잘라내고 순수 프롬프트만 추출하는 방식이 실제 storyboard 포맷과 정확히 일치한다.

---

## 📋 구현 체크리스트 (우선순위 순)

| # | 항목 | 파일 | 우선순위 |
|---|------|------|----------|
| 1 | `validate_segmented_export.py`의 하드코딩 30초 검증 로직을 timingBand 기반으로 교체 | `scripts/validate_segmented_export.py` | 🔴 Critical |
| 2 | `build_segmented_storyboards.mjs`에서 `AUTO_VIDEO_ROOT` 환경변수 지원 추가 | `scripts/build_segmented_storyboards.mjs` | 🔴 Critical |
| 3 | 통합 테스트에 `AUTO_VIDEO_ALLOW_TEST_BYPASS: "1"` 환경변수 추가 | 테스트 파일 | 🔴 Critical |
| 4 | `splitKoreanSentences()` 정규식을 구두점 기반으로 단순화 | `sentence-grounded-visual-timeline.mjs` | 🟠 Important |
| 5 | `charsPerSecond` 기본값을 테스트/프로덕션 간 통일 (5.2로) | 테스트 파일 + `auto-video.md` | 🟠 Important |
| 6 | `totalSceneCount`를 grounded 결과 기반으로 재계산해 기록 | `build_segmented_storyboards.mjs` | 🟠 Important |
| 7 | 한국어 keyword coverage를 `score.ok`에 독립적으로 체크 | `check_visual_grounding_timeline.mjs` | 🟠 Important |
| 8 | `scene-context-card.mjs`에 엘리야/요셉/다윗 CHARACTER_RULES 추가 | `scripts/lib/scene-context-card.mjs` | 🟡 Recommended |
| 9 | `inferBiblicalEvent()`에 엘리야 관련 패턴 추가 | `scripts/lib/scene-context-card.mjs` | 🟡 Recommended |
| 10 | `DETAIL_LEXICON`에 엘리야 이야기 구체 이미지 추가 | `scripts/lib/scene-context-card.mjs` | 🟡 Recommended |
| 11 | 두 번째 세그먼트 `globalStartSeconds > 0` 케이스 테스트 추가 | 테스트 파일 | 🟡 Recommended |
| 12 | Task 6의 `node -e` 중복 키 오류 수정 | 플랜 문서 | 🟡 Recommended |
| 13 | report 파일명 혼동 방지를 위한 명명 규칙 명확화 | 플랜 문서 + 계약 문서 | 🟡 Recommended |

---

## 전체 워크플로우 관점에서의 의견

현재 파이프라인 흐름:

```
script.txt
  → build_segmented_storyboards.mjs
      (1) 스크립트 품질 게이트
      (2) 세그먼트 분할
      (3) phase3 empathy rewrite
      (4) HPSL rewrite
      (5) [기존] 고정 sceneCount로 텍스트 균등 분할
      (6) [기존] buildVisualTimelineForWindow() — 균등 타임라인
      (7) buildSceneContextCard() × N
      (8) buildStoryboard() → hermes-manual-storyboard.md
  → validate_segmented_export.py
  → Hermes 렌더
  → concat_segments.mjs
```

플랜은 (5)~(6)을 `buildSentenceGroundedVisualTimeline()`으로 교체한다. 이 교체 자체는 올바르다.

**그러나 전체 워크플로우에서 검증이 빠진 부분이 있다:**

1. **Hermes 렌더러가 가변 durationSeconds를 어떻게 소비하는지 검증하지 않는다.** Body scene이 30초 고정에서 20~40초 가변으로 바뀌면, 실제 TTS 음성 길이와 scene duration 사이의 간극이 `audioTempoFactor` 허용 범위(0.92~1.18) 내에 들어오는지에 대한 검증이 없다. 가변 duration이 음성 속도 보정에 영향을 줄 수 있다.

2. **스크립트 예산 체크(`script-budget-report.json`)와 sentence-grounded 분할의 상호작용이 검증되지 않는다.** 현재 예산 체크는 전체 세그먼트 스크립트 길이 기준으로 1.12 ratio를 검사하지만, sentence-grounded 분할 후 개별 scene narration 길이와 assigned duration 사이의 비율이 극단적으로 달라질 수 있다.

3. **`docs/agent-handoff-contract.md` 파일의 존재는 확인됐으나**, 플랜 Task 5에서 추가할 표 형식이 기존 문서 포맷과 맞는지 실행 전에 확인하는 것을 권장한다.

---

## 최종 의견

이 플랜은 기존 시스템의 근본적인 약점(고정 scene count + 균등 텍스트 분할로 인한 이미지-narration 불일치)을 정확히 진단하고 올바른 방향으로 해결하려 한다. 구현 전에 위의 🔴 Critical 항목 3개만 반드시 수정하면 플랜 실행 시 테스트가 정상 작동할 것이다. 🟠 Important 항목들은 구현 중 발견될 가능성이 높으므로 구현 전 인지하고 시작하는 것을 권장한다.

**특히 `validate_segmented_export.py`의 하드코딩 검증 수정을 가장 먼저 처리해야 한다.** 그렇지 않으면 플랜 구현이 완료된 후에도 기존 검증 스크립트가 계속 실패해 렌더 진행이 불가능해진다.
