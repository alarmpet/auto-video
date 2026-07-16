# Final Output Quality Remediation Plan 검토 보고서

본 보고서는 `2026-06-26-final-output-quality-remediation.md` 계획서와 `hermes-studio` 및 `auto-video` 코드베이스, 워크플로우를 분석하여 **실제 비디오 포스트 프로덕션 단계에서 발생할 수 있는 4대 기술적 문제점**을 진단하고, 이에 대한 최적화 방안을 제안합니다.

---

## 1. 종합 요약 (Executive Summary)

* **계획의 정합성**: 비디오가 흑백(Monochrome) 지시에도 불구하고 렌더링 후 마젠타/보라색 톤(Purple Tint)으로 오염되는 원인을 FFmpeg 카메라 모션 단계(YUV420p 크로마 샘플링 및 노이즈 필터 동작)로 정확히 짚어냈습니다. 또한, 660초 기준에 도달하지 못한 432초 분량의 대본을 사전에 검증하여 차단(Pre-Hermes Gate)하고, 캐시 공유를 통해 반복 렌더링 시간을 줄이는 방안 역시 매우 타당하고 긴밀한 최적화입니다.
* **핵심 취약점 및 개선점 (4대 Gap)**:
  1. **YUV 노이즈 필터와 `hue=s=0` 필터 순서 문제**: `livingstill.mjs` 등에서 노이즈 필터(`noise=alls=...`)는 YUV 공간에서 작동하므로 크로마(색차) 노이즈를 만들어 냅니다. 만약 `hue=s=0`을 노이즈 필터보다 먼저 적용하면 최종 비디오에 다시 보라색/녹색 입자(Chrominance Noise)가 낄 위험이 있습니다.
  2. **대본 길이 validation의 target_minutes 누락**: 계획서의 Python 검증 스크립트는 `production.json`의 `render.target_seconds`만 검사합니다. 하지만 실제 사용자가 `project.target_minutes: 10` 형태로 분 단위만 설정했을 경우 이 사전 검증 게이트를 무사 통과해 버려 GPU 자원을 낭비할 수 있습니다.
  3. **글로벌 키프레임 캐시 우회(Bypass) 제어 장치 부재**: 캐시 효율을 높여 2시간의 렌더링 대기 시간을 줄이는 방향은 좋으나, 사용자가 프롬프트를 튜닝하거나 다른 구도를 시도하고자 할 때 캐시를 무효화(Bypass/No-Cache)할 옵션이 제공되지 않아 동일 이미지가 재사용될 우려가 있습니다.
  4. **Keyframe Critic 실패 시 자가수정의 한계**: 계획서에서 48개 중 2개 씬의 지시문(Anchor) 불일치로 실패가 발생했습니다. Critic 수정 루프가 계속 같은 이미지를 생성할 경우, 무의미한 ComfyUI 재생성(15%~20% 시간 점유)이 반복되므로 한계 횟수에 도달하면 프롬프트를 단순화하거나 Fallback을 조기 활성화하는 안전핀이 필요합니다.

---

## 2. 세부 문제점 분석 및 개선 방안 (Detailed Issues & Improvements)

### ① YUV 노이즈 필터와 `hue=s=0` 필터 순서 최적화
* **현상**:
  * [livingstill.mjs](file:///C:/Users/petbl/hermes-studio/hermes-local/lib/visual/livingstill.mjs#L87-L93) 필터 체인 구성 시, `post` 배열에 노이즈(`noise=alls=GR`)와 비네트(`vignette`)를 푸시한 다음 최종 `format=yuv420p`를 추가합니다.
  * YUV 공간에서 `alls` 옵션으로 노이즈를 주면 루미넌스(Y)뿐 아니라 크로마(U, V) 채널에도 노이즈가 주입되어, 흑백 영상임에도 자잘한 컬러(보라색/녹색) 노이즈가 생깁니다.
* **개선 제안**:
  * `hue=s=0` 필터를 `format=yuv420p` **바로 직전(모든 노이즈 및 Vignette 적용 후)**에 위치시킵니다. 이렇게 하면 앞의 노이즈 필터가 생성한 컬러 노이즈까지 한 번에 그레이스케일로 밀어버려 완벽한 루미넌스 노이즈(흑백 필름 느낌)만 남길 수 있습니다.

#### **필터 추가 위치 검증 (livingstill.mjs 예시)**
```javascript
  const post = [];
  if (GR > 0) post.push("noise=alls=" + GR + ":all_seed=" + ((Number(seed) % 9000) + 1));
  if (vignette) post.push("vignette=" + PI + "/5");
  post.push("fade=t=in:st=0:d=" + fadeIn);
  post.push("fade=t=out:st=" + fadeOutStart + ":d=" + fadeOut);
  
  // 모든 효과(노이즈 포함)를 입힌 후에 컬러를 완전히 제거하여 크로마 노이즈를 살균
  if (forceMonochrome) post.push("hue=s=0"); 
  post.push("format=yuv420p");
```

---

### ② 사전 대본 검증 스크립트의 분(Minutes) 단위 체크 보강
* **현상**:
  * [validate_hermes_export.py](file:///C:/Users/petbl/auto-video/scripts/validate_hermes_export.py) 수정본은 `target_seconds >= 600` 조건문만 확인합니다.
  * 하지만 실제 꿀잠성경 워크플로우 대다수는 `target_minutes: 10` 형태로 기획되어 전달될 수도 있습니다.
* **개선 제안**:
  * `target_seconds` 외에도 `target_minutes >= 10` 조건 역시 함께 검사하도록 다중 조건식(OR)을 설계합니다.

#### **개선 코드 스펙 (validate_hermes_export.py)**
```python
# validate_hermes_export.py 개선 제안
target_seconds = production.get("render", {}).get("target_seconds")
target_minutes = production.get("project", {}).get("target_minutes")

# 초(Seconds) 혹은 분(Minutes) 기준으로 10분(600초) 이상 장편 비디오인지 판정
is_longform = (
    (isinstance(target_seconds, (int, float)) and target_seconds >= 600) or
    (isinstance(target_minutes, (int, float)) and target_minutes >= 10)
)
chars = meaningful_chars(scenes)

if is_longform and chars < 4500:
    warnings.append(
        f"longform narration length {chars} chars is below minimum 4500 (target: {target_seconds or target_minutes * 60}s)"
    )
```

---

### ③ 글로벌 캐시 우회(Bypass/No-Cache) 장치 마련
* **현상**:
  * [keyframe-cache.mjs](file:///C:/Users/petbl/hermes-studio/hermes-local/lib/visual/keyframe-cache.mjs)에 `globalCacheDir`을 지정해 동일한 프롬프트/설정의 이미지를 재사용하는 것은 2시간 병목 해결에 효과적입니다.
  * 그러나 사용자가 프롬프트를 튜닝하거나 구도를 바꾸기 위해 **동일 프롬프트로 강제 재생성(Regenerate)**을 지시하고 싶을 때, 캐시 적중(Hit)으로 인해 계속 옛날 이미지가 복사되어 수정을 방해하게 됩니다.
* **개선 제안**:
  * `visualStyle`이나 CLI 인자에 `cacheEnabled: false` 또는 `--no-cache` 옵션을 파싱하여 캐시 검색을 명시적으로 우회할 수 있는 장치를 마련해야 합니다.

---

### ④ Keyframe Critic 연속 실패 시의 조기 포기(Fallback) 조율
* **현상**:
  * 지난 렌더에서 `scene_16`과 `scene_27`은 Keyframe Critic의 앵커 매치 실패로 Rerender가 발생했으나 결국 최종 실패(Pipeline QA fail)했습니다.
  * ComfyUI 생성과 Critic 검사는 전체 런타임의 36% 이상을 차지하므로, 2회 이상 연속으로 동일 씬이 검사에 실패할 경우 무의미하게 재생성 루프를 도는 대신 **차분한 분위기의 기본 씬(Fallback)으로 대체하거나 경고(Warning)로 낮추고 통과**시키는 유연한 정책이 필요합니다.

---

## 3. 결론 및 향후 적용 로드맵

저장된 계획안은 보라색 컬러 왜곡 해결과 사전 검증 도입 면에서 탁월합니다. 다만 **1) 노이즈 필터 뒤로 `hue=s=0`을 미루어 완벽한 흑백 노이즈를 유지하고**, **2) 분(Minutes) 단위 대본 길이 검증을 누락 없이 적용하며**, **3) 캐시 강제 우회 옵션**을 확보한다면 보다 안정적이고 개발자 친화적인 제작 프로세스를 갖출 수 있습니다.

본 검토 보고서는 다음 UTF-8 전용 경로에 안전하게 저장되었습니다:
* `C:\Users\petbl\auto-video\docs\superpowers\plans\2026-06-26-final-output-quality-remediation-review-report.md`
