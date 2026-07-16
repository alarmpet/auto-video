# Visual Context Mismatch Root Cause Implementation Plan Review Report

이 보고서는 `C:\Users\petbl\auto-video\docs\superpowers\plans\2026-07-06-visual-context-mismatch-root-cause-plan.md` 계획 문서와 auto-video 코드베이스 및 워크플로우를 분석하여 발견한 문제점과 이에 대한 해결책 및 개선안을 정리한 문서입니다.

---

## 1. 종합 평가 및 아키텍처 타당성

본 계획안은 Narration 문맥에 동화되지 못하고 항상 고정된 등불, 텐트, 밤길 등 단순 반복적인 이미지를 생성하던 기존 이미지 생성 파이프라인의 핵심적 한계를 정확히 짚어냈습니다. 

나레이션 기반의 구체적인 명사(창, 수금, 여인, 노래 등)와 성경 인물(사울, 다윗) 정보를 시각적 비트(Visual Beat) 레이어로 추출하여 Context Card에 주입하고, 이를 기반으로 프롬프트 생성 및 QA 게이트를 강화하는 구조는 파이프라인 전반의 고증 및 다양성 품질을 획기적으로 상승시킬 수 있는 타당한 아키텍처입니다.

다만, 구현 세부 계획(Task 1~5)에서 **잘못 설계된 정규식 우선순위로 인해 빌드가 완전히 오작동하거나, 비-성경적 심리 구절이 성경 씬으로 오인되거나, FFMPEG 타일링 레이아웃이 깨질 수 있는 몇 가지 치명적인 결함**이 발견되었습니다.

---

## 2. 발견된 문제점 및 개선 방향 (주요 5가지)

### ① [크리티컬] `SAUL_DAVID_RULES` 내 광대역 매칭(`사울.*다윗`)의 섀도잉(Shadowing) 버그
* **문제점:** Task 1의 규칙 중 첫 번째 규칙("여인들의 노래/비교")에 `/사울.*다윗/u` 패턴이 포함되어 있습니다. JavaScript의 `Array.find()`는 배열의 첫 번째 일치 항목만 반환합니다. 
  따라서 사울과 다윗이 동시에 언급된 거의 모든 문장(예: *"사울은 다윗을 주목했습니다"*, *"사울은 다윗을 창으로 치려 했습니다"*)은 두 번째(창 위협)나 세 번째(의심) 규칙을 타지 못하고, 무조건 첫 번째 규칙인 **"여인들이 노래하며 사울과 다윗을 비교하는 씬"으로 매칭**되어 버립니다. 결과적으로 모든 장면이 "여인들의 노래하는 모습"으로 고착화되는 심각한 오작동이 발생합니다.
* **해결책:** 첫 번째 규칙에서 `사울.*다윗`과 같이 너무 넓은 의미의 매칭 패턴을 제거하고, 순수하게 노래나 천천/만만 등의 구절에만 반응하도록 좁혀야 합니다. 대신, 특정한 세부 규칙에 걸리지 않는 사울-다윗 동시 언급 구절은 **최하단에 Fallback 규칙**을 두어 잡도록 우선순위를 재배치해야 합니다.

### ② [크리티컬] 현대 심리 구절의 성경 인물 오검출 (False Positive)
* **문제점:** 세 번째 규칙인 "주목/의심/두려워" 규칙의 정규식은 `/주목|눈여겨|의심|두려워/u`입니다. 이 단어들은 현대 심리 상태를 설명하는 나레이션(예: *"누구나 마음속에 두려움을 품고 살아갑니다."*)에도 자주 등장합니다.
  하지만 이 규칙이 사울-다윗 캐릭터(`["Saul", "David"]`)와 강결합되어 있어, **인물과 상관없는 일반적인 심리 묘사 장면에서도 강제로 사울과 다윗의 캐릭터 및 대결 배경이 프롬프트에 주입**되게 됩니다.
* **해결책:** 이 규칙이 활성화되려면 반드시 문맥 내에 "사울" 또는 "다윗"이 함께 존재할 때만 걸리도록 전방 탐색(Lookahead) 정규식을 적용해야 합니다. (예: `/(?=.*(?:사울|다윗))(?:주목|눈여겨|의심|두려워)/u`)

### ③ [품질 저하] 수금(Lyre) 단독 매칭에 의한 창 위협(Spear Threat) 오폭
* **문제점:** 두 번째 규칙("창 위협") 정규식에 `수금`이 포함되어 있습니다. 하지만 성경 이야기 속에서 다윗이 수금을 연주하는 것은 평화롭고 치유적인 장면(예: *"다윗이 수금을 타서 사울을 상쾌하게 함"*)도 포함됩니다. 
  창(Spear) 위협이 없는 평화로운 수금 연주 장면임에도 단지 `수금` 단어가 들어갔다는 이유로 규칙에 매칭되어 프롬프트에 `"spear near Saul's hand"`, `"David in danger"`와 같은 폭력적 키워드가 필수로 들어가 이미지가 어그러집니다.
* **해결책:** 창 위협 규칙에서는 `수금` 단독 매칭을 제외하고, `창`, `치려`, `악신` 등 물리적 위협 단어가 실질적으로 명시되었을 때만 매칭되도록 제한해야 합니다. 일반적인 `수금`은 `ANCHOR_LEXICON`을 통해 자연스러운 시각적 오브젝트로만 추가되도록 처리합니다.

### ④ [구조 취약] FFMPEG 접점 시트(Contact Sheet) 타일링 크기 하드코딩 (`tile=3x9`)
* **문제점:** Task 5 구현부에서 FFMPEG 필터에 `tile=3x9`를 하드코딩하고 있습니다. 이는 정확히 27장의 장면이 생성될 때만 유효합니다.
  실제 세그먼트 빌드 시 스크립트 길이나 템포 설정에 따라 장면 수(Scene Count)는 15장, 20장, 35장 등으로 동적으로 변하게 됩니다. 장면 수가 27보다 적을 경우 완성되지 않은 타일 때문에 이미지가 공백으로 채워지거나 누락될 수 있고, 많을 경우 다중 페이지 처리 등으로 접점 시트 출력이 정상적으로 되지 않거나 덮어씌워질 수 있습니다.
* **해결책:** 장면 개수(`timeline.length`)를 기반으로 타일의 가로 열(cols)을 고정(예: 4개 또는 5개)하고, 세로 행(rows)을 `Math.ceil(timeline.length / cols)`로 동적 계산하여 FFMPEG에 입력하도록 개선해야 합니다.

### ⑤ [코드 중복] `check_visual_grounding_timeline.mjs`에서의 중복 로딩
* **문제점:** Task 4에서 `check_visual_grounding_timeline.mjs`가 `visual-beats.json`을 명시적으로 로드하여 대조하고 있습니다.
  하지만 Task 3에서 이미 `build_segmented_storyboards.mjs`가 `visual-timeline.json`을 작성할 때 각 Scene 객체 내부에 `requiredPromptTerms` 필드를 고스란히 이관해 줍니다. 따라서 `visual-timeline.json`만 읽어도 필요한 필수 키워드 대조가 충분히 가능하므로 `visual-beats.json`을 중복 로드할 필요가 없습니다.
* **해결책:** `timeline` 배열에 이미 포함된 `scene.requiredPromptTerms`를 직접 활용하도록 코드를 리팩토링하여 디스크 I/O와 중복 파싱 작업을 제거합니다.

---

## 3. 코드베이스 반영 구체안 (Refined Implementations)

### A. 개선된 `visual-beat-extractor.mjs` (`SAUL_DAVID_RULES` 정교화)

사울-다윗 규칙들의 매칭 범위를 좁히고, 우선순위를 세밀하게 조정하며, 광대역 Fallback 매칭은 최하단으로 내린 형태입니다.

```js
// scripts/lib/visual-beat-extractor.mjs

const SAUL_DAVID_RULES = [
  // 1. 구체적 위협 상황: 창으로 치려 하거나 악신이 내린 상황 (평화로운 수금 단독 매칭 배제)
  {
    re: /창으로\s+다윗|다윗을\s+치려|손에\s+든\s+창|사무엘상\s*19\s*(?:장|:)\s*(?:9|10)/u,
    kind: "biblical_conflict",
    event: "Saul's suspicion turns toward violence against David",
    characters: ["Saul", "David"],
    required: [
      "spear near Saul's hand",
      "David in danger",
      "royal chamber tension",
      "defensive jealousy becoming threat",
    ],
  },
  // 2. 굴속에서 옷자락을 벤 평화/자비 상황
  {
    re: /굴|겉옷\s*자락|옷자락.*베었|사무엘상\s*24/u,
    kind: "scripture_event",
    event: "David spares Saul in the cave",
    characters: ["Saul", "David"],
    required: [
      "David sparing Saul in a cave",
      "cut edge of Saul's robe",
      "mercy instead of revenge",
    ],
  },
  // 3. 인물이 포함된 심리적 대치 상태: 사울/다윗이 문장에 있으면서 의심/두려워/주목하는 경우
  {
    re: /(?=.*(?:사울|다윗))(?:주목|눈여겨|의심|두려워)|사무엘상\s*18\s*(?:장|:)\s*(?:8|9)/u,
    kind: "biblical_conflict",
    event: "Saul begins watching David with suspicion",
    characters: ["Saul", "David"],
    required: [
      "Saul watching David with suspicion",
      "David standing in the distance",
      "comparison turning into fear",
    ],
  },
  // 4. 여인들의 노래/비교: 여인, 노래, 천천, 만만 등 비교와 직접 연관된 키워드 (사울.*다윗 광대역 정규식 제거)
  {
    re: /여인들이\s+노래|노래하여\s+이르되|사울이\s+죽인\s+자는\s+천천|다윗은\s+만만|사무엘상\s*18\s*(?:장|:)\s*7/u,
    kind: "scripture_event",
    event: "Saul hears women comparing him with David after battle",
    characters: ["Saul", "David"],
    required: [
      "Saul hearing women sing",
      "David praised in the distance",
      "public comparison song",
      "ancient Israelite crowd",
    ],
  },
  // 5. 일반적인 사울-다윗 대치 (어떤 특정 키워드도 안 맞았으나 인물은 둘 다 나왔을 때의 Fallback 규칙)
  {
    re: /사울[\s\S]*다윗|다윗[\s\S]*사울/u,
    kind: "biblical_conflict",
    event: "Saul and David in the story of comparison and fear",
    characters: ["Saul", "David"],
    required: [
      "Saul and David in tension",
      "royal chamber setting",
      "ancient Israelite clothing",
    ],
  },
];
```

---

### B. 동적 FFMPEG 타일 레이아웃 설계 (`check_keyframe_context_sheet.mjs` 개선)

장면 개수에 맞추어 타일 배치(가로 세로 비율)를 다르게 하여 레이아웃 깨짐을 방지하는 코드입니다.

```js
// scripts/check_keyframe_context_sheet.mjs 수정안 일부

const sheetPath = join(args.outDir, "keyframe-context-sheet.jpg");
if (!failures.length && timeline.length > 0) {
  // 접점 시트의 열 개수를 5개로 고정하고, 행 개수는 장면에 맞춰 올림 처리
  const cols = 5;
  const rows = Math.ceil(timeline.length / cols);
  const tileFilter = `scale=320:180,tile=${cols}x${rows}`;

  execFileSync("ffmpeg", [
    "-y",
    "-framerate", "1",
    "-start_number", "1",
    "-i", join(args.keyframesDir, "scene_%02d.png"),
    "-frames:v", String(timeline.length),
    "-vf", tileFilter,
    sheetPath,
  ], { stdio: "ignore" });
}
```

---

### C. `check_visual_grounding_timeline.mjs` 리팩토링 (불필요 디스크 IO 제거)

이미 `timeline`에 탑재되어 있는 `requiredPromptTerms` 정보를 사용하여 검증 속도와 단순함을 극대하게 한 구현 제안입니다.

```js
// scripts/check_visual_grounding_timeline.mjs 수정안 일부

const scenes = timeline.map((scene, index) => {
  const card = cards[index] || {};
  const prompt = prompts[index]?.prompt || "";
  const promptLower = prompt.toLowerCase();
  const score = scorePromptContextAlignment({ card, prompt });
  const sceneFailures = [...score.failures];

  // timeline 에 주입된 requiredPromptTerms 를 직접 조회하여 beats.json 로딩 생략
  const sourceRequired = scene.requiredPromptTerms || [];
  
  for (const term of sourceRequired) {
    if (term && !promptLower.includes(String(term).toLowerCase())) {
      sceneFailures.push(`missing_source_required_prompt_term:${term}`);
    }
  }

  const genericTerms = ["oil lamp", "family tent", "empty sleeping mat", "generic lone man", "generic dark road"];
  const genericCount = genericTerms.filter((term) => promptLower.includes(term)).length;
  const sourceHitCount = sourceRequired.filter((term) => promptLower.includes(String(term).toLowerCase())).length;
  
  // 필수 요건이 2개 이상 들어있으면서 제네릭 표현만 난무할 경우 탐지 강화
  if (sourceRequired.length >= 2 && genericCount >= 2 && sourceHitCount === 0) {
    sceneFailures.push("generic_prompt_without_source_anchor");
  }

  // (기존 러닝 타임 게이트 및 스코어 계산 로직 지속)
  ...
```

---

## 4. 검증 및 롤백 계획 피드백

1. **프롬프트 중복 토큰 제거(`dedupeCommaTokens`) 영향도:**
   `dedupeCommaTokens`가 대소문자 구분 없이 단순 Comma 단위 토큰을 지워버리는 특성이 있으므로, `leadSubject`와 `requiredPromptTerms`에 겹쳐서 기입된 항목들은 뒤쪽의 `"required visible anchors: ..."`에서 앞 단어가 제거되어 일부 잘리는 현상이 발생할 수 있습니다. 
   다만 이미지 생성 모델의 해석 흐름상 앞부분에서 이미 충분히 명사들을 묘사했고 중복이 정규화된 것이므로 생성 이미지 품질에 나쁜 영향은 끼치지 않습니다. 오히려 모델 프롬프트 토큰을 절약하는 효과를 줍니다.

2. **단위 테스트 자동화 계획의 완결성:**
   `scripts/check_visual_beat_extractor.mjs` 및 `scripts/test_keyframe_context_sheet.mjs` 등의 모의 데이터 테스트들은 이 정밀하고 정교한 파이프라인 수정을 수행하기 전/후 리그레션을 감지할 수 있어 매우 신뢰도 높은 구조를 이룹니다.

---

## 5. 결론 및 제안 요약

* 본 구현 계획은 단순히 이미지만 생성하고 끝내는 빌드 체인을 넘어, **나레이션의 구체적 고증을 보장하는 강력한 퀼리티 케어 레이어**를 확립하는 중요한 이정표가 될 것입니다.
* 발견된 정규식 섀도잉 문제(사울-다윗의 모든 갈등이 여인 노래로 수렴되는 현상) 및 비-성경 문단에서의 인물 오검출 등은 실전 렌더링 시 심각한 시각적 부조화를 가져올 포인트였으므로, **본 보고서에서 제안한 정교화된 정규식 규칙 및 Fallback 구조를 구현 직전에 반영**하는 것을 강력히 제안합니다.
* FFMPEG 타일링 가변 계산 방식을 적용해 주면, 빌드 단위(10분, 15분, 20분 등)에 제약 없이 가변적이고 안전하게 QA 접점 시트를 자동화할 수 있을 것입니다.
