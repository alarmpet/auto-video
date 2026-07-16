# Ken Burns Motion Variety Plan — 검토 보고서

대상 문서: `docs/superpowers/plans/2026-07-01-kenburns-motion-variety.md`
검토 방식: 계획 문서 전문 대조 + 현재 코드베이스(`scripts/assemble_cain_fast_from_hermes_job.mjs`, `scripts/validate_segmented_export.py`) 실제 라인 단위 확인. `kenburns-motion.mjs`, `check_motion_manifest.mjs`는 아직 생성 전이라 계획 스니펫만 검토했다.

문제 진단(“지금 렌더는 이미지 반복만 하고 zoompan이 전혀 없다”)은 정확하고, `zoompan` 기반 접근과 `KENBURNS_MOVES` 확장(대각선 4방향 포함) 방향도 타당하다. 다만 실제 파일과 대조했을 때 편집 지시가 모호해서 그대로 따라가면 코드가 깨지는 지점, 그리고 모션 정책 문구와 실제 수식이 어긋나는 지점이 있다.

## 1. (필수) Task 2 Step 3의 "삭제 대상"이 파일에서 서로 떨어진 두 곳이다

`assemble_cain_fast_from_hermes_job.mjs` 현재 라인을 보면:

- 181~191행: `imageList`/`imageLines` 생성 + `totalImageSeconds`/`targetMediaSeconds` 계산.
- 193~211행: `audioTempoFactor` 계산(오디오 속도 상한 게이트, CapCut 플랜에서 이미 추가됨) — `targetMediaSeconds`를 직접 참조한다(`audioTempoFactor = cursor / targetMediaSeconds;`, 197행).
- 213~233행: 자막(SRT) 생성.
- 235~245행: `imageList`를 입력으로 쓰는 `ffmpeg -f concat -vf fps=6` 호출(실제 `visual-base.mp4` 생성).

계획은 "Remove the current `imageList` creation and `ffmpeg -f concat -i imageList -vf fps=6` block"이라고 한 문장으로 뭉뚱그렸지만, 실제로는 **파일에서 서로 떨어진 두 블록**(181~191행과 235~245행)이고 그 사이(193~233행)에 오디오 속도/자막 로직이 끼어 있다. 그대로 따라 하면 다음 두 가지 실수가 나기 쉽다.

1. `totalImageSeconds`/`targetMediaSeconds`(183~184행)는 "imageList 생성 블록"의 일부처럼 보이지만 실제로는 197행 `audioTempoFactor` 계산에 필수다. 이 두 줄까지 지우면 CapCut 플랜에서 막 추가된 오디오 속도 게이트(`audioTempoFactor > 1.18` 체크)가 `ReferenceError`로 즉시 깨진다.
2. 235~245행의 옛 `ffmpeg -vf fps=6` 호출을 지우지 않고 181~191행만 새 코드로 바꾸면, `imageList`/`imageLines` 변수가 사라진 상태에서 235행이 여전히 `imageList`를 참조해 `ReferenceError`가 나거나, 반대로 두 블록을 다 남겨두면 motion-clip으로 만든 `visual-base.mp4`를 옛 fps=6 콘캣이 다시 덮어써서 Ken Burns 효과가 최종 파일에는 반영되지 않는다(가장 위험한 실패 모드 — 스크립트는 에러 없이 성공하지만 결과물은 여전히 정지 이미지).

제안: Task 2 Step 3을 "181~182행과 185~191행만 삭제하고 183~184행(`totalImageSeconds`, `targetMediaSeconds`)은 그대로 둔다. 그리고 235~245행의 옛 `ffmpeg -vf fps=6` 호출은 완전히 삭제하고, 새 motion-clip concat 호출로 교체한다"처럼 정확한 라인 기준으로 다시 써야 한다.

## 2. (필수) Motion Policy에 적은 줌 폭 규칙이 pan/diagonal 모션에는 적용되지 않는다

Motion Policy 문서: "장면 시간이 6초 이하이면 줌 폭은 2~4%로 작게 둔다 / 30초 이상이면 5~8%로 둔다."

하지만 `kenburns-motion.mjs` 스니펫의 `motionExpressions`를 보면:

```js
const travelZoom = (1 + Math.max(zoomAmount, 0.12)).toFixed(5);
```

`panL/panR/panU/panD/diagUL/diagUR/diagDL/diagDR` 전부 `travelZoom`을 쓰는데, 이 값은 `zoomAmount`(6초 이하면 0.035, 30초 이상이면 0.07)와 무관하게 **항상 최소 12%로 강제**된다. 즉 문서에 적어 둔 "6초 이하 장면은 2~4%만" 규칙은 zoomin/zoomout에만 실제로 적용되고, pan/diagonal 모션에는 조용히 무시된 채 12% 이상이 적용된다.

더 실질적인 문제는 톤 규칙과의 충돌이다: "전체 톤은 수면용이므로 흔들림, 빠른 줌, 급격한 패닝은 금지한다"고 해놓고, 6초짜리 인트로 장면에 팬 모션이 배정되면 12% 크롭 범위를 단 6초 만에 이동시킨다 — 같은 12% 이동을 30초에 걸쳐 하는 것보다 5배 빠른 체감 속도이므로, 오히려 "급격한 패닝"에 해당할 수 있다. 팬/대각선 모션의 이동 속도(줌 폭/지속시간)가 장면 길이에 반비례해서 빨라지는 구조라, 짧은 장면일수록 정책이 금지한 상황이 나올 위험이 크다.

제안: `travelZoom`을 고정 12%로 두지 말고 `zoomAmount`(장면 길이 기반 값)에 비례하도록 하거나, 최소한 6초 이하 장면에는 pan/diagonal 모션을 배정하지 않는 규칙을 추가한다.

## 3. (권장) `assembly-report.json`에 기록되는 `zoomAmount`가 실제 사용된 줌과 다르다

Task 2 Step 4는 `zoomAmount: Number(group.zoomAmount.toFixed(5))`를 기록하는데, 이 값은 `zoomAmountForDuration(group.duration)`(예: 0.035)이지 실제로 pan/diagonal에 쓰인 `travelZoom`(예: 0.12)이 아니다. 즉 QA 담당자가 `assembly-report.json`만 보고 "이 6초 팬 장면은 3.5% 줌만 썼다"고 판단하면 실제 화면과 다르다. `check_motion_manifest.mjs`나 `validate_segmented_export.py`도 이 필드를 그대로 신뢰하므로, 검증 자체가 잘못된 데이터를 근거로 통과 판정을 내릴 수 있다.

제안: `renderMotionClip`이 반환하는 객체에 실제 적용된 줌 값(`motionExpressions` 내부에서 계산된 `travelZoom` 또는 `zoomAmount` 중 실제 사용된 쪽)을 그대로 노출해서 리포트와 실제 필터가 항상 일치하게 한다.

## 4. (권장) 모션 다양성(≥5종) 요구가 렌더 시점에는 보장되지 않고 사후 검증에만 의존한다

`chooseMotion`은 `hashString(seed:index)`를 후보 9~10개로 나눈 나머지로 고르는 결정론적 방식이라, 연속 반복은 막지만 "15분 세그먼트당 최소 5종류"를 렌더 시점에 강제하지 않는다. 특정 seed/인덱스 조합에서 해시 분포가 우연히 소수의 모션에 몰리면(예: 확률은 낮지만 배제할 수 없음) 전체 motion-clip 렌더가 다 끝난 뒤에야 `check_motion_manifest.mjs`/`validate_segmented_export.py`가 실패를 알려준다. 30개 클립을 4배 업스케일로 다시 렌더링해야 하는데, 계획에는 "검증 실패 시 seed를 바꿔 재시도"하는 절차가 없다. 사소하지만 재작업 비용이 크므로, `chooseMotion`이 이미 사용된 모션 집합을 인자로 받아 다양성 하한을 만족하도록 유도하는 로직(예: 남은 장면 수 대비 미사용 모션이 있으면 우선 배정)을 추가하는 편이 안전하다.

## 5. (권장) 성능/자원 비용에 대한 사전 검증 단계가 없다

기존 방식은 `fps=6`으로 이미지 목록을 그대로 콘캣하는 매우 가벼운 연산이었다. 새 방식은 장면마다 `scale=width*4:height*4`(예: 1920x1080 → 7680x4320) 업스케일 후 `zoompan`을 30fps로 걸고 개별 클립을 `libx264`로 인코딩한다. 15분 세그먼트 안에 30초 장면이 30개 안팎 있다고 가정하면, 세그먼트 하나에서만 30개의 개별 4K급 인코딩이 발생한다 — 60분짜리 영상 전체로 보면 상당한 렌더 시간과 `motion-clips` 폴더 디스크 사용량 증가가 예상된다. 계획에는 이 비용에 대한 언급이나 "먼저 짧은 클립 1개로 렌더 시간을 측정해본다"는 벤치마크 단계가 없다. Task 5 Step 1에서 실제 세그먼트 전체를 재렌더하기 전에, 장면 1~2개만 골라 렌더 시간/파일 크기를 먼저 재보는 사전 점검 단계를 추가하는 것을 권한다.

## 6. (확인 완료, 문제 없음) 모션 방향 수식은 한국어 라벨과 정확히 일치한다

`panL/panR/panU/panD/diagUL/diagUR/diagDL/diagDR` 각각의 `x`/`y` 진행 수식을 `progress=0`과 `progress=1` 경계값으로 직접 계산해본 결과, Motion Policy에 적힌 한국어 설명(예: `diagUL`: "오른쪽 아래에서 왼쪽 위로 이동")과 실제 크롭 좌표 이동 방향이 모두 일치한다. 이 부분은 재작업 없이 그대로 써도 된다.

## 요약 우선순위

1. (필수) Task 2 Step 3을 라인 단위로 다시 써서 `totalImageSeconds`/`targetMediaSeconds`는 보존하고, 옛 `fps=6` ffmpeg 호출(235~245행)은 확실히 삭제·교체하도록 명시한다.
2. (필수) pan/diagonal 모션의 `travelZoom` 최소값(0.12)을 장면 길이 기반 `zoomAmount`와 연동시켜 Motion Policy의 줌 폭 규칙 및 "급격한 패닝 금지" 톤 규칙과 실제로 맞춘다.
3. (권장) `assembly-report.json`에 기록하는 `zoomAmount`를 실제 적용된 값(travelZoom 포함)으로 바꿔 QA 데이터 신뢰성을 확보한다.
4. (권장) 모션 다양성 하한을 렌더 시점에도 유도하는 로직을 `chooseMotion`에 추가하거나, 검증 실패 시 seed를 바꿔 재시도하는 절차를 계획에 명시한다.
5. (권장) 전체 세그먼트 재렌더 전에 장면 1~2개로 렌더 시간/디스크 사용량을 먼저 측정하는 벤치마크 단계를 추가한다.
