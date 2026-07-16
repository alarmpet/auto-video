# Segmented Longform Render Pipeline Plan 검토 보고서

본 보고서는 `2026-06-30-segmented-longform-render-pipeline.md` 계획서와 `auto-video` 코드베이스 및 렌더링 워크플로우를 대조하여, **분할 렌더링 파이프라인 설계에서 발생할 수 있는 4대 아키텍처 결함**을 발견하고 이에 대한 실질적인 고도화 방안을 제안합니다.

---

## 1. 종합 요약 (Executive Summary)

* **계획의 정합성**: 60분 이상의 장편 영상을 10~20분 단위로 세그먼트화하여 분할 생성하고 개별 검증 및 병합하는 방식은 렌더링 실패 리스크를 극적으로 줄이고 싱크 오류의 전파를 막을 수 있는 최선의 접근입니다. 특히 전체 영상의 첫 60초에만 높은 장면 밀도를 부여하고 이후 본문에는 고정 밀도(30초/장면)를 부여하는 디자인 결정은 자원 분배 관점에서 효율적입니다.
* **핵심 취약점 및 개선점 (4대 아키텍처 결함)**:
  1. **텍스트 균등 배분과 장면 수 불일치로 인한 재생 시간 드리프트 (Mathematical Drift)**: 전체 씬 개수를 기준으로 대본을 나눈 뒤 세그먼트 씬 개수만큼 슬라이싱하면, 인트로 밀도 때문에 더 많은 씬을 배정받은 `segment-01`에 과도하게 많은 텍스트가 유입되어 15분 세그먼트가 약 18분 이상으로 늘어나고, 나머지 세그먼트들은 14분 이하로 줄어드는 병목 현상이 발생합니다.
  2. **세그먼트 경계 문맥 절단 및 음성 단절 (Boundary Audio Popping)**: 문단이나 문장의 중간에서 텍스트 분절이 발생할 경우, 세그먼트 병합 지점에서 내레이터의 단어가 잘리거나 불자연스러운 오디오 클릭음(Pops)이 발생할 수 있습니다.
  3. **자막 파일(SRT) 누적 병합 처리 누락 (SRT Merge Logic Gap)**: `ffmpeg concat -c copy`는 비디오/오디오 스트림만 합치므로, YouTube 등에 업로드할 전체 장편 통합 자막(`final-full.srt`)의 누적 타임스탬프 시프트 및 병합 처리가 고려되어 있지 않습니다.
  4. **무손실 Concat 병합 시 코덱/프로파일 불일치 예외 처리 (FFmpeg Concat Protocol)**: 개별 세그먼트 생성 시 해상도, 오디오 채널 레이아웃, 프레임 레이트, 픽셀 포맷 중 하나라도 다를 경우 `-c copy` 무손실 병합이 실패하거나 오디오 싱크가 깨질 위험이 있습니다.

---

## 2. 세부 문제점 분석 및 개선 방안 (Detailed Analysis & Improvements)

### ① 대본 분할 방식의 근본적 수학적 논리 오류 수정
* **원인**:
  * 계획서의 Task 2 Step 1~3에서는 전체 대본을 `totalSceneCount`로 가중 분할한 다음, 각 세그먼트의 `sceneCount`만큼 텍스트를 나누어 가져가도록 되어 있습니다.
  * `segment-01`은 60초 인트로 밀도 때문에 38개의 씬을 가지고, `segment-02`는 30개의 씬을 가집니다.
  * 이 방식대로라면 `segment-01`은 대본의 $38 / 128 \approx 29.6\%$를 가져가게 되어, 재생 시간이 **17.7분**으로 크게 늘어나고 다음 세그먼트들의 시간이 왜곡됩니다.
* **개선 방안**:
  * **"대본 선분할 $\rightarrow$ 장면 후분할"** 구조로 변경합니다.
  * 먼저 전체 대본을 목표 세그먼트 시간 비율(예: 동일 시간 분할이면 캐릭터 글자 수 균등)에 맞춰 분할하여 세그먼트별 대본을 확정합니다.
  * 그 다음, 각 세그먼트 내에서 지정된 씬 수(예: `segment-01`은 38개, `segment-02`는 30개 등)만큼 내부 대본을 다시 씬 단위로 쪼개야 시간이 왜곡되지 않습니다.

---

### ② 문단/문장 단위 경계 분할 규칙 강제 (Boundary Paragraph Alignment)
* **원인**:
  * 글자 수만 채워 자르면 단어나 문장의 중간에서 세그먼트가 잘려 단절된 느낌을 줍니다.
* **개선 방안**:
  * 세그먼트 대본을 나눌 때 **반드시 문단 구분 기호(`\n\n`) 또는 최소한 문장 종결 기호(`.!?`) 경계에서만 분절**이 일어나도록 분할 함수를 보강합니다.

#### **개선형 세그먼트 대본 분할 알고리즘**
```javascript
export function splitScriptIntoTimeSegments(script, segmentCount) {
  const paragraphs = script.split(/\n\s*\n/g).map(p => p.trim()).filter(Boolean);
  const totalChars = paragraphs.reduce((sum, p) => sum + p.length, 0);
  const targetSegmentChars = totalChars / segmentCount;
  
  const segments = Array.from({ length: segmentCount }, () => []);
  let currentSegmentIdx = 0;
  let currentChars = 0;
  
  for (const paragraph of paragraphs) {
    // 마지막 세그먼트가 아니며, 목표 글자 수를 넘어서면 다음 세그먼트로 이동
    if (currentSegmentIdx < segmentCount - 1 && currentChars >= targetSegmentChars) {
      currentSegmentIdx++;
      currentChars = 0;
    }
    segments[currentSegmentIdx].push(paragraph);
    currentChars += paragraph.length;
  }
  
  return segments.map(seg => seg.join("\n\n"));
}
```

---

### ③ 통합 SRT 자막 파일 자동 병합 스크립트 구축
* **원인**:
  * 세그먼트별로 `subtitles.srt`를 개별적으로 만들어 어셈블하기 때문에, 합친 비디오에 맞는 60분짜리 전체 자막이 생성되지 않습니다. 단순히 텍스트를 붙이면 타임스탬프가 00:00:00으로 리셋됩니다.
* **개선 방안**:
  * [concat_segments.mjs](file:///C:/Users/petbl/auto-video/scripts/concat_segments.mjs) 실행 시, 각 세그먼트의 실제 오디오/비디오 길이를 누적(Accumulate Offset)하여 자막의 시작/종료 시간을 밀어주고 병합하는 SRT 병합 알고리즘을 이식합니다.

#### **SRT 누적 병합 헬퍼 예시**
```javascript
import { readFileSync, writeFileSync } from "node:fs";

function shiftSrtTimestamps(srtText, offsetSeconds) {
  return srtText.replace(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/g, (match, start, end) => {
    return `${shiftTime(start, offsetSeconds)} --> ${shiftTime(end, offsetSeconds)}`;
  });
}

function shiftTime(timeStr, offsetSec) {
  const [h, m, sMs] = timeStr.split(":");
  const [s, ms] = sMs.split(",");
  const totalMs = (parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s)) * 1000 + parseInt(ms) + (offsetSec * 1000);
  
  const newH = String(Math.floor(totalMs / 3600000)).padStart(2, "0");
  const newM = String(Math.floor((totalMs % 3600000) / 60000)).padStart(2, "0");
  const newS = String(Math.floor((totalMs % 60000) / 1000)).padStart(2, "0");
  const newMs = String(Math.floor(totalMs % 1000)).padStart(3, "0");
  return `${newH}:${newM}:${newS},${newMs}`;
}
```

---

### ④ 세그먼트 렌더러 설정의 완전 동기화 (Codec & Profile Verification)
* **원인**:
  * FFmpeg `-c copy` 병합은 입력 영상들의 코덱, 비트레이트, 프레임 레이트 등이 일치해야만 싱크 밀림과 화질 저하가 없습니다.
* **개선 방안**:
  * 모든 세그먼트의 `production.json` 렌더링 설정(비디오 해상도, 프레임 레이트, 오디오 레이아웃 등)이 완벽히 동일하게 제어되도록 강제하는 검증 로직을 `validate_segmented_export.py`에 추가합니다.

---

## 3. 결론 및 권장 구현 방향

본 분할 파이프라인 계획은 장편 콘텐츠 제작을 위해 가장 실질적이고 혁신적인 대안입니다. 다만 본 보고서에서 제안한 **1) 대본 선분할 후 내부 씬 할당을 통한 시간 왜곡(Drift) 제거**, **2) 문단 경계 단위 분절**, **3) 타임스탬프 누적식 통합 SRT 빌더 내장** 조치가 수반되어야 실무에서 작동 가능한 견고한 자동화 워크플로우를 완성할 수 있습니다.

본 검토 보고서는 다음 UTF-8 전용 경로에 안전하게 저장되었습니다:
* `C:\Users\petbl\auto-video\docs\superpowers\plans\2026-06-30-segmented-longform-render-pipeline-review-report.md`
