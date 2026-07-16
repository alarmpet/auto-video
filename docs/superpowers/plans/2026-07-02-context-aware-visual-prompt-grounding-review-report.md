# Context-Aware Visual Prompt Grounding Plan 검토 보고서

본 보고서는 `2026-07-02-context-aware-visual-prompt-grounding.md` 계획서와 `auto-video` 코드베이스 및 렌더링 워크플로우를 분석하여, **단순 정규식 매칭이 유발할 수 있는 새로운 형태의 이미지 반복 생성 결함**을 발견하고 이에 대한 실질적인 품질 고도화 대안을 제안합니다.

---

## 1. 종합 요약 (Executive Summary)

* **계획의 정합성**: 장면 순서대로 모티프를 무조건 회전 배정하던 방식에서 벗어나, 대본의 맥락(성경 인물, 심리 개념, 감정 비트, 시각 앵커)을 담은 `visual-context-cards.json` 레이어를 경유하여 프롬프트를 조립하고 QA 정합성 검증기([check_storyboard_context_alignment.mjs](file:///C:/Users/petbl/auto-video/scripts/check_storyboard_context_alignment.mjs))를 추가한 구조는 프롬프트 신뢰성을 극대화하는 탁월한 설계입니다.
* **핵심 취약점 및 개선점 (3대 아키텍처 Gap)**:
  1. **하드코딩 템플릿에 의한 대량 이미지 유사 반복 생성 리스크 (Prompt Monotony)**: 
     * 계획서의 `PSYCHOLOGY_RULES`는 단 4개의 정규식 매칭 그룹에 매핑되어 고정된 `visualAnchor` 문자열을 반환합니다.
     * 이 방식은 128개 장면 중 "야곱" 키워드가 들어간 60~80개 장면에서 **동일한 프롬프트**("Jacob alone beside a small oil lamp inside an ancient family tent, hands folded anxiously")를 만들어냅니다. 결국 이전의 모티프 회전 문제보다 더 심각한 **비주얼 단조로움 및 이미지 무더기 중복**을 야기합니다.
  2. **정적 시간표와 동적 오디오의 불일치**:
     * 스토리보드에 작성된 정적 꼬리표(`duration:6` 또는 `duration:30`)가 실제 TTS 발화 속도와 맞지 않으면 영상 싱크가 깨질 수 있습니다. 조립기는 항상 실제 TTS 오디오 길이를 실시간 반영해야 합니다.
  3. **자가 검증(Self-Fulfilling) 정합성 체크의 한계**:
     * `compileContextPrompt` 함수가 카드 내용을 결합하여 프롬프트를 만들고, `scorePromptContextAlignment`가 동일 카드로 정합성을 체크하므로 항상 100점이 나와 실질적인 검사기 역할을 하지 못할 우려가 있습니다.

---

## 2. 세부 문제점 분석 및 개선 방안 (Detailed Analysis & Improvements)

### ① 다이내믹 조합형 시각 앵커 추출기 (Dynamic Setting-Aware Compiler)
* **해결 방안**:
  * 단일 하드코딩 앵커 문자열을 사용하는 대신, 대본에서 **성경 인물**, **공간적 배경(Setting)**, **감정/자세(Action)** 정보를 각각 독립적으로 추출한 뒤 동적으로 조립하여 씬마다 고유한 프롬프트가 보장되도록 수정합니다.

#### **개선형 다이내믹 앵커 조합 모델 예시 ([scene-context-card.mjs](file:///C:/Users/petbl/auto-video/scripts/lib/scene-context-card.mjs))**
```javascript
// 1. 공간 배경 사전 정의 및 추출 정규식
const SETTING_RULES = [
  { re: /천막|장막|방 안|집 안|집안/i, value: "inside an ancient family tent" },
  { re: /들판|들\s|밭\s|풀밭|양떼|우물/i, value: "in a quiet biblical field under pale dawn" },
  { re: /광야|사막|모래|돌밭/i, value: "in a barren silent desert under a night sky" },
  { re: /길\s|도로|걷|가다|여행/i, value: "walking slowly along a quiet dusty path" },
  { re: /산\s|제단|예배|돌단/i, value: "near a stone altar under dark clouds" }
];
const DEFAULT_SETTING = "in a quiet ancient Near Eastern landscape";

// 2. 심리 기반 자세/자세 정규식
const POSTURE_RULES = [
  { re: /불안|두려|떨|비교|인정/i, value: "hands folded anxiously, posture showing slight hesitation" },
  { re: /슬퍼|눈물|절망|외롭/i, value: "looking downward, a solemn and restrained posture" },
  { re: /바라|기도|원하|소망|축복/i, value: "looking upward toward a soft light, posture of longing" },
  { re: /기쁨|감사|평안|사랑/i, value: "standing with open hands, peaceful and composed posture" }
];
const DEFAULT_POSTURE = "posture of quiet self-reflection";

export function buildSceneContextCardDynamic({ narration = "", order = 1, topic = "" }) {
  const text = String(narration || "");
  
  // 캐릭터 검출
  const characters = unique(CHARACTER_PATTERNS.filter(item => item.re.test(text)).map(item => item.value));
  const characterSubject = characters.length ? characters.join(" and ") : "a lone biblical figure";
  
  // 배경 및 자세 검출
  const setting = SETTING_RULES.find(item => item.re.test(text))?.value || DEFAULT_SETTING;
  const posture = POSTURE_RULES.find(item => item.re.test(text))?.value || DEFAULT_POSTURE;
  
  // 최종 동적 비주얼 앵커 합성
  const visualAnchor = `${characterSubject} ${setting}, ${posture}`;
  
  const rule = PSYCHOLOGY_RULES.find(item => item.re.test(text)) || DEFAULT_RULE;
  
  return {
    order: Number(order) || 1,
    narration: text,
    topic,
    biblicalCharacters: characters,
    biblicalEvent: inferBiblicalEvent(text, topic),
    psychologyConcept: rule.concept,
    emotion: rule.emotion,
    visualAnchor, // 동적 합성 결과 주입
    symbolicObjects: rule.objects,
    avoid: ["generic desert only", "random prophet portrait", "readable text", "modern clothing"]
  };
}
```
* **기대 효과**: 동일한 야곱 테마의 씬이라도 문장 안에 "천막"이 있으면 텐트 내부가, "광야"가 있으면 사막 밤하늘이, "길"이 있으면 모랫길 배경이 조립되며, 감정에 따라 고개를 들거나 숙이는 등 **장면마다 완벽하게 분할된 비주얼 다양성**을 확보할 수 있습니다.

---

### ② 형태소 분석을 대체하는 간이 한국어 조사 클렌징
* **원인**:
  * 한국어 조사("은/는/이/가/을/를/와/과/의/에/에서/로")가 꼬리에 붙어 키워드로 추출될 경우, 매칭 정확도가 떨어지고 지저분한 문자열이 앵커로 변환됩니다.
* **개선 방안**:
  * 외부 형태소 분석기 없이 가볍게 정규식으로 단어 끝의 한국어 조사를 일부 클렌징하여 고순도 키워드를 정제해 `keywords` 필드에 주입합니다.

```javascript
function extractKoreanKeywordsClean(text) {
  return unique(String(text || "")
    .replace(/[^\p{Script=Hangul}\s]/gu, " ")
    .split(/\s+/)
    .map(word => word.replace(/(은|는|이|가|을|를|와|과|의|에|에서|으로|로|하고)$/, ""))
    .filter(word => word.length >= 2)
    .slice(0, 12));
}
```

---

### ③ 정합성 검증 점수(Alignment QA)의 질적 보완
* **원인**:
  * 카드를 이용해 렌더링용 프롬프트를 만들었기에, 단순히 프롬프트 내 단어 존재 여부만 체크하는 정합성 스코어링은 무조건 100점을 냅니다.
* **개선 방안**:
  * [check_storyboard_context_alignment.mjs](file:///C:/Users/petbl/auto-video/scripts/check_storyboard_context_alignment.mjs) 검증 파일 내에서, **"원래 대본의 한국어 단어 일부를 영어 번역 사전 등을 이용해 프롬프트와 직접 교차 비교"**하거나 **"Avoid 조건(no modern, no color)이 프롬프트 내에 철저히 기재되어 있는지 확인"**하는 추가 마이너스 룰(Negative constraints)을 결합하여 자가 검사 함정을 탈출합니다.

---

## 3. 결론 및 향후 로드맵

제시된 이미지 프롬프트 맥락 반영 계획은 꿀잠성경 비디오 품질을 수동 편집 수준으로 고도화하기 위한 최종 열쇠입니다. 본 보고서에서 제안한 **1) 캐릭터/공간/자세의 다이내믹 조합 모델** 및 **2) 조사 클렌징 필터**를 이식하여 **비주얼 중복 생성을 예방**하고, 최종 병합 전 QA 단계에서 실제 작동 가능한 견고한 파이프라인을 완성할 수 있습니다.

본 검토 보고서는 다음 UTF-8 전용 경로에 안전하게 저장되었습니다:
* `C:\Users\petbl\auto-video\docs\superpowers\plans\2026-07-02-context-aware-visual-prompt-grounding-review-report.md`
