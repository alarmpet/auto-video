# Gguljam Longform Quality Remediation Plan 검토 보고서

본 보고서는 `2026-06-30-gguljam-longform-quality-remediation.md` 계획서와 `auto-video` 및 `hermes-studio` 코드베이스, 워크플로우를 분석하여 **장편 꿀잠성경 제작 시 발생할 수 있는 4대 기술적 문제점**을 진단하고, 이를 최적화하기 위한 실질적인 개선 방안을 제안합니다.

---

## 1. 종합 요약 (Executive Summary)

* **계획의 정합성**: 대본 생성 시 기존의 무작위 조합 템플릿으로 인해 60분 영상 안에서 오프닝 및 위로 문단이 27회 이상 중복되던 근본 원인을 정확히 짚어냈습니다. 장별 고유 원고 블록을 명시하고, 이미지 유지 시간을 4.5분에서 45~90초로 단축하여 총 60장면 이상으로 세분화하며, 자막 재분절 정책을 추가한 것은 장편 비디오 품질 혁신을 위해 필수적인 조치입니다.
* **핵심 취약점 및 개선점 (4대 Gap)**:
  1. **자막 균등 시간 분배로 인한 싱크 드리프트 (Sync Drift in Uniform Distribution)**: 45~90초 길이의 장면에서 자막을 단순히 등간격(`duration / chunks.length`)으로 쪼개 배치하면, 내레이터의 낭독 호흡 및 문장 내 쉼표로 인해 비디오 중간부터 자막과 음성 싱크가 크게 벌어지는(최대 5~10초 이상) 현상이 발생합니다.
  2. **한국어 문맥을 무시한 자막 분절 (Awkward Subtitle Breaks)**: 띄어쓰기(공백) 기준으로 단순 글자 수만 채워 쪼개는 방식(`splitSubtitleText`)은 한국어의 어절 및 구절 의미 단위를 파괴하여 가독성이 심각하게 떨어지는 자막을 생성합니다.
  3. **대본 중복 검증기(Repetition Gate)의 어미 변화 필터링 한계**: 단순 42자 접두사 매칭은 "이 이야기는..."과 "이 이야기들은..."처럼 조사 하나만 바뀌거나 어미가 바뀌는 유사 중복 문장을 잡아내지 못해 게이트를 우회할 가능성이 있습니다.
  4. **인접 장면 모티브 중복 방지 루프의 부재**: 인접 프롬프트 간 동일 모티브 배정을 배제한다고 명시했으나, 무작위 선택 루프에서 직전 씬의 모티브를 조회하여 재선택하는 예외 제어(Lookback constraint)가 구현 명세에 누락되어 있습니다.

---

## 2. 세부 문제점 분석 및 개선 방안 (Detailed Issues & Improvements)

### ① 자막 균등 시간 분배 대신 SRT 자막 타임스탬프 파싱 연동
* **현상**:
  * 계획서의 [assemble_cain_fast_from_hermes_job.mjs](file:///C:/Users/petbl/auto-video/scripts/assemble_cain_fast_from_hermes_job.mjs) 수정안은 자막의 재생 시간을 단순히 N등분하여 분배합니다.
  * 하지만 Supertonic TTS는 장문 낭독 시 챕터 간 혹은 문장 간 쉼(Silence)의 속도가 불규칙하므로, 이 등분 분배식은 실제 음성과 글자가 따로 노는 심각한 싱크 이탈을 만듭니다.
* **개선 제안**:
  * 이미 Hermes Local 실행을 통해 Supertonic TTS가 생성한 고정밀 `.srt` 자막 파일이 존재합니다.
  * 수동 조립기(`assemble_...`)가 임의로 자막을 쪼개는 대신, **원본 `0_tts.srt` 자막 파일의 타임라인 블록 정보를 직접 파싱하여 1fps/6fps 슬라이드에 투영**하도록 수정합니다. 원본 SRT의 `start`와 `end` 시간을 프레임 인덱스로 환산하면 완벽한 싱크가 보장됩니다.

---

### ② 한국어 의미 단위를 고려한 자막 분절 (Semantic Split)
* **현상**:
  * 계획서의 `splitSubtitleText` 함수는 단순히 공백 기준 단어를 붙이다가 `maxChars`를 넘기면 칼로 자르듯 쪼갭니다.
  * 예: "나만 뒤처진 것 같은 작은 느낌들이 조용해진 방 안에서" $\rightarrow$ "나만 뒤처진 것 같은 작은 느낌들이 조용해진" / "방 안에서" 처럼 어구의 맥락이 깨질 수 있습니다.
* **개선 제안**:
  * 쉼표(`,`), 문장 종결 단어, 조사를 기준으로 쪼개는 정규식 분절 헬퍼를 결합하거나, `auto-final`에 탑재된 [subtitles.py](file:///C:/Users/petbl/auto-final/src/auto_video/subtitles.py)의 문장 분절 알고리즘을 이식하여 가독성을 개선합니다.

#### **개선형 한국어 자막 분절 헬퍼 예시**
```javascript
function splitSubtitleTextSmart(text, maxChars = 34) {
  // 쉼표나 어미(다., 요.,죠.) 기준으로 1차 구절 분할
  const clauses = text.split(/(?<=[,，.!?。！？])\s+/);
  const cues = [];
  
  for (const clause of clauses) {
    if (clause.length <= maxChars) {
      cues.push(clause);
    } else {
      // 구절이 너무 길 때만 단어 단위로 쪼갬
      const words = clause.split(" ");
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
  }
  return cues;
}
```

---

### ③ 대본 중복 검증기(Repetition Gate)의 유사 어미 대응
* **현상**:
  * 42자 접두사 맵핑은 조사 변경("은/는/이/가")이나 단어 한두 개 삽입에 의한 유사 문장 반복을 검출하지 못합니다.
* **개선 제안**:
  * 단순 매칭 외에 자카드 유사도(Jaccard Similarity)나 자수 기준 레벤슈타인 거리(Levenshtein Distance)를 아주 가볍게 측정하여, 유사도 80% 이상의 문단이 3회 이상 등장하면 경고를 보내는 안전장치를 검사기에 추가하여 꼼수를 차단합니다.

---

### ④ 인접 장면 모티브 중복 방지 루프의 구체화
* **현상**:
  * Task 3 Step 3에서 모티브가 연속 배정되지 않도록 규칙을 세웠지만, 구현 스크립트 상에서 단순 랜덤 선택 시 충돌 가능성이 있습니다.
* **개선 제안**:
  * 스토리보드 빌더 스크립트 작성 시 아래와 같은 **Lookback constraint 루프**를 적용하도록 로직을 코드로 명시합니다.

```javascript
// 모티브 중복 회피 예시 코드
let lastMotif = "";
const scenes = chapterDrafts.flatMap((chapter, cIdx) => {
  return chapter.scenes.map((scene, sIdx) => {
    // 직전 모티브와 겹치지 않는 후보 필터링
    const candidates = motifBank.filter(m => m !== lastMotif);
    const chosenMotif = candidates[Math.floor(Math.random() * candidates.length)];
    lastMotif = chosenMotif; // 업데이트
    
    return {
      ...scene,
      prompt: `${chosenMotif}, ${scene.style_details}`
    };
  });
});
```

---

## 3. 결론 및 향후 적용 로드맵

제시된 개선 계획은 템플릿 남용으로 인한 1시간 분량 대본의 퀄리티 저하 문제를 근본적으로 치료할 수 있는 훌륭한 해법입니다. 다만 **1) 임의의 N등분 시간 분배 대신 Supertonic이 생성한 원본 SRT 파일의 실제 타임스탬프를 파싱하여 싱크를 연동하는 로직**을 반드시 확보해야 하며, **2) 의미 흐름을 깨지 않는 한국어 분절 헬퍼**가 이식되어야 듣기 편안한 꿀잠 비디오가 완성됩니다.

본 검토 보고서는 다음 UTF-8 전용 경로에 안전하게 저장되었습니다:
* `C:\Users\petbl\auto-video\docs\superpowers\plans\2026-06-30-gguljam-longform-quality-review-report.md`
