# CapCut Draft QA Integration Plan — 검토 보고서

대상 문서: `docs/superpowers/plans/2026-07-01-capcut-draft-qa-integration.md`
검토 방식: 계획 문서 전문 대조 + 실제 코드베이스(`scripts/lib/quality-gates.mjs`, `scripts/check_longform_script_quality.mjs`, `scripts/build_segmented_storyboards.mjs`, `scripts/lib/segment-plan.mjs`, `scripts/assemble_cain_fast_from_hermes_job.mjs`, `scripts/validate_segmented_export.py`) 직접 확인.

전반적으로 계획 자체의 방향(반복 대본 검출, 음성 속도 상한, CapCut 보조 산출물, FFmpeg 최종 렌더 유지)은 타당하다. 다만 실제 코드와 대조했을 때 실행 단계에서 그대로 적용하면 동작하지 않거나 의도한 효과를 내지 못하는 지점이 여러 곳 있다. 우선순위 순으로 정리했다.

## 1. 가장 중요한 문제: `script-quality-report.json`을 아무도 만들지 않는다

Task 5 Step 2는 `validate_segmented_export.py`에 다음을 추가하라고 한다.

```python
script_quality = segment_dir / "script-quality-report.json"
if not script_quality.exists():
    warnings.append(...)
else:
    quality = load_json(script_quality)
    if not quality.get("ok", False):
        failures.append(...)
```

하지만 Task 1~4 어디에도 세그먼트 디렉터리 안에 `script-quality-report.json`을 **쓰는** 코드가 없다. `check_longform_script_quality.mjs`는 `console.log(JSON.stringify(report, ...))`만 하고 파일로 저장하지 않는다(`scripts/check_longform_script_quality.mjs:13`). 즉 이 게이트는 영구히 "not generated yet" 경고만 내고 절대 실패하지 않는다 — 반복 대본 검사가 세그먼트 검증 파이프라인에 실질적으로 연결되지 않는다는 뜻이다.

제안: Task 1 또는 Task 5에 단계를 추가해 `check_longform_script_quality.mjs`가 `--out <path>` 인자를 받아 결과를 파일로 쓰게 하고, `build_segmented_storyboards.mjs`가 세그먼트별 `script.txt`를 쓴 직후 이 검사를 호출해 `segmentDir/script-quality-report.json`을 생성하도록 명시해야 한다. 이 연결이 빠지면 Task 1(반복 검출)과 Task 5(검증 통합)가 이름만 연결되어 있고 실제로는 끊긴 파이프라인이 된다.

## 2. `check_capcut_draft_export.mjs`가 File Structure에서 약속한 검증을 하지 않는다

File Structure 섹션은 이렇게 적혀 있다: "CapCut draft export 결과의 파일 존재, **duration 합계**, **subtitle cue 개수**를 검증한다." 그러나 Task 4 Step 3의 실제 스크립트는 `finalPath`/`srtPath`/`timelinePath`의 **존재 여부**만 확인하고, duration 합계나 subtitle cue 개수는 전혀 계산하거나 비교하지 않는다. Self-Review의 "Spec coverage" 항목도 이 불일치를 언급하지 않는다.

제안: `check_capcut_draft_export.mjs`에 각 세그먼트의 `manifest.timelinePath`(visual-timeline.json)에서 scene 합계를 읽어 `segment.durationSeconds`와 비교하고, `srtPath`를 파싱해 cue 개수/마지막 종료 시간을 검증하는 로직을 추가하거나, 문서의 File Structure 설명을 실제 구현 범위(존재 확인만)에 맞게 수정해야 한다.

## 3. Task 4의 연구 내용과 실제 구현이 크게 어긋난다

Research Summary는 pyCapCut/capcut-cli를 상세히 조사했지만, `capcut-draft-adapter.mjs`의 `detectCapCutTools()` 결과(`tools.capcutCli`, `tools.pyCapCut`)는 `export_capcut_draft.mjs`에서 콘솔에 출력만 되고 실제 draft 생성 로직 어디에도 쓰이지 않는다. `buildCapCutManifest`는 pyCapCut이나 capcut-cli를 전혀 호출하지 않고, 항상 동일한 "manifest + README" 형식만 만든다. 즉 제목은 "CapCut Draft QA Integration"이지만 실제로는 CapCut이 열 수 있는 `draft_content.json`을 생성하지 않고, 사람이 세그먼트 MP4/SRT를 CapCut에 수동으로 import하라는 안내 문서만 만든다.

Risk Notes에 "human-review surface"라는 언급은 있지만, 이게 v1의 의도된 축소 범위인지 아니면 누락된 작업인지 문서에서 명확히 선언하지 않는다. 사용자가 "CapCut draft export"라는 이름만 보면 실제 draft 파일이 생성될 것으로 오해하기 쉽다. 문서에 "v1은 실제 draft_content.json을 생성하지 않고 manifest-only로 시작한다"는 문장을 명시적으로 추가하는 것을 권한다.

부수적으로, `detectCapCutTools()`는 Windows에서 `execFileSync("npx", ...)`를 `shell` 옵션 없이 호출한다. Windows에서 `npx`/`npm`은 `.cmd` 배치파일이라 `shell: true` 없이는 `spawn npx ENOENT`로 실패하는 경우가 흔하다(try/catch로 감싸져 있어 크래시는 안 나지만 항상 `false`로 떨어질 가능성이 높다). 실질적으로 이 감지 로직은 죽은 코드에 가깝다.

## 4. Task 3의 코드 스니펫이 실제 파일의 변수명과 맞지 않는다

`build_segmented_storyboards.mjs`의 실제 구조를 확인한 결과:

- 세그먼트 순회는 `for (const [index, segment] of segmentPlan.segments.entries())`이고, 스크립트 변수명은 `segmentScript`, 디렉터리는 `segmentDir`이다.
- Task 3 Step 3의 스니펫은 `scriptText`, `budget`, `segmentId` 같은 이름을 쓰는데 실제 파일에는 이런 변수가 없다. 그대로 붙여넣으면 `ReferenceError`가 난다.
- 더 중요한 문제: Task 3 Step 2에서 정의한 `splitLongParagraph(paragraph, maxChars)` 함수가 Step 2~4 어디에서도 **호출되지 않는다**. 실제 분배 로직(`splitScriptIntoTimeSegments` → `splitUnitsByWeightedTargets`)은 여전히 기존 방식 그대로 문단 길이 비례로만 나누고, 새로 만든 문장 단위 재분할 함수를 사용하지 않는다. 즉 "긴 문단을 문장 단위로 쪼갠다"는 목적이 코드에 실제로 연결되지 않는다.
- 또한 `targetCharsPerSegment`는 사후 검증(Step 4의 `ratio > 1.12` 실패 조건)에만 쓰이고, 분배 알고리즘 자체를 이 예산에 맞추도록 유도하지 않는다. 원본 스크립트 총 길이가 목표 총 시간과 이미 어긋나 있으면(예: 과거 60분 렌더처럼 대본이 너무 길었던 경우) 세그먼트를 아무리 재분배해도 일부 세그먼트는 항상 예산을 초과한다 — 이 경우 "실패시키고 사람이 대본을 줄이게 한다"는 것이 의도인지 문서에 명확히 적어야 재구현자가 헷갈리지 않는다.

## 5. `manual-assembly/final.mp4` 이름에 대한 암묵적 계약

`build_segmented_storyboards.mjs`는 세그먼트 매니페스트에 `finalPath: join(segmentDir, "manual-assembly", "final.mp4")`를 미리 하드코딩해 둔다(라인 117). 그런데 실제 렌더 스크립트 `assemble_cain_fast_from_hermes_job.mjs`의 `finalName` 기본값은 `"final-cain-envy-68min.mp4"`이고, `--final-name` 인자를 명시적으로 주지 않으면 다른 파일명이 생성된다. Task 6 Step 3 예시는 `--final-name final.mp4`를 명시하고 있어 우연히 맞아떨어지지만, 이 "항상 final.mp4로 렌더해야 한다"는 규칙이 `auto-video.md`에 추가되는 문서 규칙(Task 5 Step 3)에는 들어있지 않다. 나중에 누군가 `--final-name`을 빠뜨리면 `capcut-draft-adapter.mjs`의 `buildCapCutManifest`가 `Missing segment final` 에러로 조용히 막힌다. `auto-video.md` 규칙 블록에 "세그먼트 최종 파일명은 반드시 `manual-assembly/final.mp4`로 고정한다" 같은 문장을 추가하거나, `capcut-draft-adapter.mjs`가 하드코딩 대신 `segment-manifest.json`의 `finalPath` 필드를 읽도록 바꾸는 편이 더 견고하다.

## 6. `assertLongformScriptQuality`의 `minParagraphs` 기본값과 세그먼트 단위 호출 충돌 가능성

`quality-gates.mjs`의 `assertLongformScriptQuality`는 `minParagraphs` 기본값이 90이다(전체 60분 장편 대본 기준으로 설정된 값으로 추정). 그런데 Task 5에서 이 검사를 세그먼트 단위(`script-quality-report.json`, 위 1번 문제와 연결)에 적용하려 한다면, 15분짜리 세그먼트 대본은 문단 수가 90에 크게 못 미쳐 항상 `paragraph_count_too_low`로 실패한다. 세그먼트 단위 호출 시 `minParagraphs`를 세그먼트 길이에 비례해 낮추는 옵션을 넘겨야 한다는 점이 계획에 빠져 있다.

## 7. 자잘한 확인 사항 (문제라기보다 확인 필요)

- `assemble_cain_fast_from_hermes_job.mjs`에서 `audioTempoFactor` 계산과 Task 2의 속도 상한 검사는 `visualTimeline`이 존재할 때만 동작하는 분기 안에 들어간다(`if (visualTimeline) { audioTempoFactor = ...`). 세그먼트 파이프라인은 항상 `visual-timeline.json`을 생성하므로 (`build_segmented_storyboards.mjs` 라인 80-84) 실질적으로 문제는 없지만, 예전 비세그먼트 렌더(`assemble_cain_fast_from_hermes_job.mjs` 기본 인자들이 가리키는 `gguljam-bible-cain-envy-60min-fast-001`)에는 이 게이트가 전혀 적용되지 않는다는 점은 명시해두는 게 좋다.
- `check_audio_speed_profile.mjs`는 세그먼트 전체가 `assembly-report.json` 없이 warning만 쌓여도 `ok: true`를 반환할 수 있다(즉 "검사할 게 하나도 없어서 통과"). 최소 1개 이상 세그먼트가 검사됐는지 확인하는 조건을 추가하면 더 안전하다.
- `validate_segmented_export.py`는 이미 존재하는 파일이므로 File Structure의 "Modify" 표기는 맞지만, Task 5 Step 1의 삽입 위치 설명("`sync_report`를 읽은 후")은 실제 코드 흐름과 일치한다(라인 200-215 부근) — 이 부분은 별문제 없음, 확인 완료.

## 요약 우선순위

1. (필수) 세그먼트별 `script-quality-report.json` 생성 단계를 계획에 추가해 Task 1과 Task 5를 실제로 연결한다.
2. (필수) `check_capcut_draft_export.mjs`가 duration 합계·subtitle cue 개수를 검증하도록 구현을 보강하거나 문서의 약속 범위를 낮춘다.
3. (권장) Task 4의 "CapCut draft" 표현을 "manifest-only 보조 산출물"로 명확히 하고, pyCapCut/capcut-cli 연동은 로드맵으로 분리한다.
4. (권장) Task 3 스니펫의 변수명을 실제 파일(`segmentScript`, `segmentDir`, `segment.id`)에 맞게 다시 쓰고, `splitLongParagraph`를 실제 분배 로직에 연결한다.
5. (권장) `final.mp4` 파일명 계약을 `auto-video.md` 규칙에 명문화하거나 매니페스트 기반으로 바꾼다.
6. (권장) 세그먼트 단위 스크립트 품질 검사 시 `minParagraphs` 등 옵션을 세그먼트 길이에 맞게 조정한다.
