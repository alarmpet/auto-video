# Sleep Video Quality Fix Implementation Plan 검토 보고서

본 보고서는 `2026-06-26-sleep-video-quality-fix.md` 품질 개선 계획서와 `hermes-studio` 및 `auto-video` 코드베이스, 워크플로우를 대조 분석하여 **실제 구현 및 렌더링 시 발생할 수 있는 5대 핵심 문제점**을 진단하고, 실질적인 코드 레벨의 개선 방안을 제안합니다.

---

## 1. 종합 요약 (Executive Summary)

* **계획의 정합성**: 비디오 속도를 억지로 늘려(FFmpeg `setpts`/`atempo` 사용) 내레이션을 느리게 만들던 오작동을 원천 금지하고, 대본과 장면 기획 단계에서 자연스러운 재생 시간(10분+)을 확보하도록 유도하는 방향성은 매우 우수합니다. 또한, ComfyUI 이미지 생성 단계에서 상단 영어 라벨 등의 노이즈를 미리 감지하고 재생성하는 아티팩트 게이트 설계 역시 고품질 렌더링을 위해 타당합니다.
* **핵심 취약점 및 개선점 (5대 Gap)**:
  1. **상단 아티팩트 감지기의 오탐 위험 (Absolute Brightness Threshold Weakness)**: 단순히 상단 중앙 영역의 밝기(mean)와 편차(stdev)로만 판정하므로, 밝은 하늘, 구름, 달, 등불 등이 포함된 정상적인 배경 일러스트까지 '텍스트 아티팩트'로 오탐(False Positive)하여 무한 루프나 불필요한 GPU 재싱크를 유발할 위험이 큽니다.
  2. **대본 길이 사전 검증(Pre-flight Gate) 부재로 인한 자원 낭비**: 음성 합성(TTS)이 완료된 후에만 길이 게이트를 체크하므로, 대본이 2,000자 미만으로 명백히 짧은 경우에도 비싼 GPU/API 자원을 써서 TTS를 다 생성한 후에야 에러로 중단됩니다.
  3. **수면 영상에 어울리지 않는 짧은 TTS 무음(Silence) 설정**: 수면 영상에는 차분하고 여유로운 호흡이 필수적임에도, `local.json` 설정에서 무음 시간(`silenceDuration: 0.24초`)을 극단적으로 짧게 잡아 내레이션이 지나치게 급하고 밭아질 위험이 있습니다.
  4. **긍정 프롬프트 내 부정어 사용으로 인한 이미지 왜곡 (Prompt Bleed)**: 긍정 프롬프트에 `no text banner, no title plaque` 등의 부정적 묘사를 직접 추가하면, 디퓨전 모델 특성상 단어 정보(banner, plaque)를 인지하여 오히려 텍스트나 간판을 더 자주 그려내는 역효과(Prompt Bleed)가 발생합니다.
  5. **최종 렌더러 연동 시 이미지 번호 매핑 정렬 문제 (Index Shift)**: 70개 이상의 장면을 수동으로 다운로드하고 관리할 때, 한 장이라도 누락되면 이미지 파일과 대본 씬이 1칸씩 어긋나는 문제가 여전히 존재합니다.

---

## 2. 세부 문제점 분석 및 개선 방안 (Detailed Issues & Improvements)

### ① 상단 아티팩트 감지기의 오탐 위험 (Absolute Brightness Threshold Weakness)
* **현상**: 
  * [top-artifact-detector.mjs](file:///C:/Users/petbl/hermes-studio/hermes-local/lib/quality/top-artifact-detector.mjs#L494-L525)는 상단 중앙 영역(34%~66% width)의 그레이스케일 통계(`mean * 0.65 + stdev * 0.35`)를 계산해 임계값 `0.08`을 넘으면 아티팩트로 판단합니다.
  * `0.08`은 8% 밝기에 해당하는 매우 낮은 임계치로, 밤하늘이 아닌 밝은 하늘, 노을빛, 둥근 달, 혹은 등불이 상단에 배치되면 쉽게 오탐지되어 재성이 반복됩니다.
* **개선 제안**: **상대적 대비 대조 방식 (Relative Contrast Check)**을 도입합니다.
  * 상단 중앙(Center) 영역만 검사하지 않고, 좌측(Left) 및 우측(Right) 영역의 평균 밝기를 함께 비교합니다.
  * 인공적인 텍스트 라벨이나 흰색 띠는 주변부보다 **국소적으로 매우 밝은 특징**을 띱니다. 따라서 전체 하늘이 밝은 경우(Center $\approx$ Left $\approx$ Right)는 통과시키고, 중앙부만 유독 밝은 경우(Center > Left + Delta)에만 탐지하도록 알고리즘을 보완합니다.

#### **개선 코드 스펙 (top-artifact-detector.mjs)**
```javascript
export async function detectTopCenterArtifact(imagePath, options = {}) {
  const image = sharp(imagePath);
  const meta = await image.metadata();
  const width = Number(meta.width) || 0;
  const height = Number(meta.height) || 0;
  if (width <= 0 || height <= 0) return { flagged: false, score: 0, reason: "invalid_image" };

  const regionH = Math.floor(height * (options.heightRatio ?? 0.16));
  const regionW = Math.floor(width * (options.widthRatio ?? 0.32));
  const topY = Math.floor(height * (options.topRatio ?? 0.02));

  // 3개 영역(좌, 중, 우) 추출
  const leftRegion = { left: Math.floor(width * 0.02), top: topY, width: regionW, height: regionH };
  const centerRegion = { left: Math.floor(width * 0.34), top: topY, width: regionW, height: regionH };
  const rightRegion = { left: Math.floor(width * 0.66), top: topY, width: regionW, height: regionH };

  const [leftStats, centerStats, rightStats] = await Promise.all([
    image.clone().extract(leftRegion).grayscale().stats(),
    image.clone().extract(centerRegion).grayscale().stats(),
    image.clone().extract(rightRegion).grayscale().stats()
  ]);

  const meanL = leftStats.channels[0].mean / 255;
  const meanC = centerStats.channels[0].mean / 255;
  const meanR = rightStats.channels[0].mean / 255;

  const stdevC = centerStats.channels[0].stdev / 255;

  // 단순히 밝은 것(meanC)이 아니라, 좌우에 비해 유독 중앙이 밝은지(상대 대비) 체크
  const surroundingMax = Math.max(meanL, meanR);
  const relativeContrast = meanC - surroundingMax;
  const score = Number((relativeContrast * 0.7 + stdevC * 0.3).toFixed(4));
  const threshold = Number(options.threshold ?? 0.06); // 상대 대비 임계값은 조금 더 낮춤

  const flagged = score >= threshold && meanC > 0.15; // 절대 밝기가 너무 어두우면 필터링 제외

  return {
    flagged,
    score,
    threshold,
    meanCenter: Number(meanC.toFixed(4)),
    meanLeft: Number(meanL.toFixed(4)),
    meanRight: Number(meanR.toFixed(4)),
    reason: flagged ? "top_center_localized_bright_label" : "ok",
  };
}
```

---

### ② 대본 길이 사전 검증(Pre-flight Gate) 도입
* **현상**:
  * 계획서의 [runner.mjs](file:///C:/Users/petbl/hermes-studio/hermes-local/lib/pipeline/runner.mjs#L270-L302) 구조는 `voice.generateAll()`을 완전히 마친 다음에 `evaluateLongformDuration`을 수행합니다.
  * 10분 영상을 만들려는데 대본이 단 2,000자(약 4~5분 분량)라면 이미 TTS 생성 전에 탈락할 것이 명백하지만, 리소스를 낭비하며 모든 오디오 파일을 생성한 후에 중단됩니다.
* **개선 제안**: `runner.mjs` 오케스트레이션 진입 초기에 대본 문자 수를 확인하는 **Pre-flight 문항 수 체크 게이트**를 활성화합니다.
  * 한국어 낭독 속도(공백 제외 분당 약 320~380자)를 기준으로, 대본 총 자수가 설정한 최소 글자 수(`minimumScriptCharsFor10Min` 등)에 미달하면 씬 구조 생성 및 TTS API 요청 자체를 사전에 차단하고 Operator에게 경고합니다.

---

### ③ 수면 낭독에 적합한 오디오 설정 (Silence/Pacing Policy)
* **현상**:
  * [local.json](file:///C:/Users/petbl/hermes-studio/hermes-local/config/local.json) 설정에 `silenceDuration: 0.24`, `continuousSilenceDuration: 0.04`가 적용되어 문장 간 쉼표 호흡이 매우 밭아집니다.
  * 수면 낭독 영상은 오히려 **문장 사이의 적절하고 여유로운 공백(0.8s ~ 1.5s)**이 청취자의 수면 유도에 훨씬 도움을 줍니다. 또한 이 자연스러운 공백은 강제 스트레칭 없이도 비디오 전체의 러닝타임을 효과적으로 확보해 줍니다.
* **개선 제안**:
  * `silenceDuration`을 `0.8`~`1.2` 수준으로 복구하고, scripture(성경 구절) 낭독 시에는 인위적으로 쉼을 늘리는 설정을 유지합니다.
  * 대본 자수를 강제로 6,000자까지 과도하게 늘리지 않더라도, 편안한 긴 호흡의 여백을 통해 10분 이상의 분량을 자연스럽게 달성할 수 있습니다.

---

### ④ 긍정 프롬프트 내 부정어 사용 금지 (Prompt Bleed 위험 해결)
* **현상**:
  * [keyframe-generator.mjs](file:///C:/Users/petbl/hermes-studio/hermes-local/lib/visual/keyframe-generator.mjs)와 `keyframe-prompt-guards.mjs`에서 `no text banner, no title plaque, no letters`와 같은 부정 구절을 **긍정 프롬프트(Prompt)** 끝에 추가하도록 설계되었습니다.
  * 디퓨전 모델(Flux, SDXL 등)은 긍정 프롬프트 속 "no" 나 "not" 같은 부정 지시어의 논리적 의미를 완벽하게 이해하지 못하며, 오히려 프롬프트 내의 `banner`, `plaque`, `letters`라는 키워드에 반응해 아티팩트를 합성해 낼 확률이 급격히 높아집니다.
* **개선 제안**:
  * `no text banner...`와 같은 묘사는 **긍정 프롬프트가 아닌 네거티브 프롬프트(negative_prompt)** 필드로 강제 이동시킵니다.
  * 긍정 프롬프트에는 `clear unmarked sky, seamless background texture, simple minimal painting`과 같이 **그려내야 할 긍정적 대상(텍스트 없는 깨끗한 여백)만 묘사**해야 안정적인 텍스트리스(Textless) 키프레임이 생성됩니다.

---

### ⑤ 이미지 파일 정렬(Index Shift) 누락 방지 브레이크 연동
* **현상**:
  * `hermes-studio` 역시 수십~백여 장의 스토리보드 이미지를 번호순으로 렌더링하고, 이를 비디오 편집기([editor.mjs](file:///C:/Users/petbl/hermes-studio/hermes-local/lib/agents/editor.mjs))에서 번호순으로 합치게 됩니다.
  * 만약 사용자가 수작업으로 이미지를 관리하거나 ComfyUI 출력물을 동기화하다가 중간 파일 하나가 누락되면 뒷부분 이미지의 순서가 1칸씩 밀려 싱크가 전면 붕괴되는 구조적 위험은 `auto-final`과 동일하게 존재합니다.
* **개선 제안**:
  * `editor.assemble` 직전에, 씬 리스트(`scenes`)의 각 이미지 아웃풋 파일명이 물리적으로 폴더에 존재하는지 `fs.existsSync`로 사전 전수조사하고, 누락된 경우 즉시 빌드를 중단하는 **Image Missing Gate**를 구현하여 최종 비디오가 엇갈려 출력되는 불상사를 방지해야 합니다.

---

## 3. 결론 및 향후 적용 로드맵

저장된 개선 계획안은 실제 품질 개선 목적에 잘 부합하나, 상기 지적된 **1) 절대 밝기 임계치의 오탐 한계**, **2) 긍정 프롬프트 내 부정어 누출(Prompt Bleed)**, **3) 사전 대본 길이 게이트 누락**을 보완해야 리소스 낭비와 비디오 싱크 엇갈림이 없는 상용 수준의 무결점 파이프라인이 완성됩니다.

본 검토 보고서는 다음 UTF-8 전용 경로에 안전하게 저장되었습니다:
* `C:\Users\petbl\auto-video\docs\superpowers\plans\2026-06-26-sleep-video-quality-review-report.md`
