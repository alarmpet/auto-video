# Hermes Studio 협업/병합 계획서

작성일: 2026-06-26

최종 수정: 2026-06-26

## 0. Hermes Studio 전환 결론

이 계획은 처음에는 `C:\Users\petbl\auto-final`을 제작/렌더링 엔진으로 붙이는 방향이었지만, `C:\Users\petbl\hermes-studio` 분석 결과 Hermes Studio가 `꿀잠성경` 자동 제작 목표에 더 직접적으로 맞는 것으로 확인되었습니다.

수정된 결론:

```text
auto-video:
  벤치마킹 분석
  주제/제목 생성
  성경+현대 심리학 대본 작성
  장면별 영어 이미지 프롬프트 작성
  Hermes manual storyboard 파일 생성

hermes-studio:
  manual storyboard 파싱
  ScenePlan / StoryboardPlan 생성
  ComfyUI / Flux keyframe 이미지 생성
  WanGP / LTX-2 또는 fallback 영상 클립 생성
  Supertonic TTS 생성
  FFmpeg 자막/오디오/클립 조립
  final.mp4 / subs.srt / QA report 출력
```

따라서 앞으로의 1차 통합 대상은 `auto-final`이 아니라 `C:\Users\petbl\hermes-studio\hermes-local`입니다. 기존 `auto-final` 분석은 fallback 또는 비교 참고로 남깁니다.

## 0.1 Hermes Studio 구조 분석

확인한 상위 구조:

```text
C:\Users\petbl\hermes-studio
  hermes-launch.ps1
  Hermes-Studio.bat
  HERMES_BIBLE_PSYCHOLOGY_CHANNEL_PLAN.md
  hermes-local\
  outputs\
  docs\superpowers\plans\
```

핵심 실행 파일:

```text
C:\Users\petbl\hermes-studio\hermes-launch.ps1
  Ollama, ComfyUI, Supertonic, Hermes GUI 서버를 순차 기동
  GUI 주소: http://localhost:8799

C:\Users\petbl\hermes-studio\hermes-local\scripts\run-job.mjs
  대본 파일, stdin, 또는 --manual-storyboard 입력을 받아 전체 파이프라인 실행

C:\Users\petbl\hermes-studio\hermes-local\gui\server.mjs
  Hermes 브라우저 GUI 서버
```

핵심 설정:

```text
C:\Users\petbl\hermes-studio\hermes-local\config\local.json
```

현재 연결된 엔진:

```text
LLM:
  Ollama
  baseUrl: http://127.0.0.1:11434
  model: qwen3.5-9b-local:latest
  repairModel / visionModel: gemma4:12b

이미지 생성:
  ComfyUI
  baseUrl: http://127.0.0.1:8188
  portableRoot: C:/Users/petbl/ComfyUI_windows_portable
  Flux lineart enabled
  workflow: assets/flux_lineart_t2i_fluxencode.json

영상화:
  engine: wangp
  WanGP appPath: C:/pinokio/api/wan.git/app
  WanGP URL: http://127.0.0.1:42003
  i2vEnabled: true
  i2vTemplate: assets/ltx2_wangp_queue_i2v.template.json

TTS:
  Supertonic
  baseUrl: http://127.0.0.1:3093
  voice: M1
  scriptureSpeed: 0.88
  scriptureSilenceDuration: 0.75

렌더:
  aspectRatio: 16:9
  output: 1920x1080
  targetSceneSeconds: 12
  defaultVisualMode: contextual-keyframes
  burnSubtitles: true
```

## 0.2 Hermes 내부에서 확인한 핵심 모듈

```text
scripts/run-job.mjs
  CLI 진입점. --manual-storyboard를 직접 지원한다.

lib/manual-storyboard/parser.mjs
  [대본 텍스트] prompt / shot / lighting / mood / motion 형식을 파싱한다.

lib/manual-storyboard/storyboard-plan.mjs
  manual storyboard를 ScenePlan과 StoryboardPlan으로 변환한다.

lib/pipeline/runner.mjs
  Director → Visual Planning → Storyboard → Keyframe → TTS → Camera → Editor → QA 전체 조율.

lib/providers/comfyui-image.mjs
  ComfyUI txt2img/img2img, Flux/SDXL workflow 호출.

lib/visual/keyframe-generator.mjs
  장면별 keyframe 생성, 캐시, 후보 재시도, manifest, storyboard preview 생성.

lib/agents/editor.mjs
  FFmpeg로 segment 조립, 자막 PNG overlay, SRT 생성, final.mp4 생성.

lib/agents/scripture-grounder.mjs
  verse_refs를 로컬 KRV DB 본문으로 치환한다.

lib/agents/scripture-qa.mjs
  성경 본문이 DB와 일치하는지, SRT에도 보존되는지 검증한다.
```

## 0.3 새 데이터 흐름

```text
auto-video 1~3단계
  채널 분석 → 주제 선택 → 자막 원고 기반 제목/대본 완성

auto-video 4단계
  참고 이미지 기반 화면 문체 분석
  대본을 장면 단위로 나눔
  Hermes manual storyboard 형식으로 이미지 프롬프트 작성

Hermes Studio
  run-job.mjs --manual-storyboard hermes-manual-storyboard.md
  keyframe 생성
  TTS 생성
  영상 클립 생성
  FFmpeg 최종 조립
  QA report 생성
```

권장 실행:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
node scripts/run-job.mjs --manual-storyboard C:\Users\petbl\auto-video\exports\<slug>\hermes-manual-storyboard.md --engine wangp --visual-mode contextual-keyframes
```

샘플 검증용:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
node scripts/run-job.mjs --manual-storyboard C:\Users\petbl\auto-video\exports\<slug>\hermes-manual-storyboard.md --engine stickman --visual-mode contextual-preview --dry-run
```

## 0.4 Hermes Manual Storyboard 규격

Hermes parser가 요구하는 형식:

```text
[대본 텍스트]
English image prompt / camera angle / lighting / mood / motion

[다음 대본 텍스트]
English image prompt / camera angle / lighting / mood / motion
```

이 형식은 `auto-video.md` 4단계의 기존 형식과 거의 같습니다.

기존 규칙:

```text
[대본 텍스트] 이미지 설명 / 카메라 앵글 / 조명 / 분위기 / 동작
```

Hermes용 수정 규칙:

```text
[대본 텍스트] 라벨은 한국어 유지
프롬프트 본문은 영어
슬래시 구분자는 prompt / camera / lighting / mood / motion 순서
블록 밖에는 아무 텍스트도 넣지 않음
이미지 안에 readable text 생성 금지
각 블록은 독립적으로 이해 가능해야 함
```

예시:

```text
[그날, 사람은 처음으로 숨고 싶어졌습니다.]
A quiet ancient garden at twilight, two small human figures standing near a shadowed tree, black and white painterly biblical illustration, heavy oil brush texture, dramatic chiaroscuro, ancient Near Eastern atmosphere, no text / wide contemplative shot / soft fading evening light / solemn and vulnerable / slow push-in with drifting leaves
```

## 0.5 꿀잠성경용 Hermes 화면 문체

사용자가 제공한 참고 이미지와 채널 방향을 기준으로 Hermes 프롬프트는 다음 스타일을 기본으로 합니다.

```text
black and white painterly biblical illustration,
heavy oil brush texture,
cinematic chiaroscuro,
ancient Near Eastern atmosphere,
quiet sleep documentary mood,
solemn but comforting,
no readable text,
no watermark,
no modern objects
```

피해야 할 표현:

```text
stickman presenter
infographic board
red arrows
speech bubbles
large text labels
bright saturated colors
modern UI symbols
fast action
horror or gore
```

장면 설계 원칙:

```text
인물 1~2명 중심
명확한 상징 하나
느린 카메라 움직임
고요한 긴장감
공포보다 위로
대본의 심리 변화가 표정/자세/빛으로 드러나게 구성
```

## 0.6 실행 계획 변경

기존 `auto-final`용 작업 중 다음은 1차 우선순위에서 내립니다.

```text
auto-final input/0_tts.wav, 0_tts.srt 규격 맞추기
auto-final planned timeline hook 추가
auto-final motion_planner 수정
auto-final 챕터별 TTS 병합 스크립트
auto-final 프로젝트별 input/work/output 격리
```

Hermes 통합에서 우선할 작업:

```text
1. Hermes 상태 확인
2. auto-video 산출물을 Hermes manual storyboard로 내보내는 규칙 확정
3. 3분 샘플 manual storyboard 생성
4. Hermes dry-run/contextual-preview 검증
5. ComfyUI keyframe 5~10장 샘플 검증
6. WanGP i2v 3~5장면 샘플 검증
7. 20분 파일럿 생성
8. 60분 이상은 chapter별 Hermes job 분할 후 최종 합치기 검토
```

검증 명령:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
npm.cmd run check:stack:deep
npm.cmd run check:manual-storyboard-parser
npm.cmd run check:manual-storyboard-plan
npm.cmd run check:runner-manual-storyboard
```

## 0.7 Hermes 전환 후 남는 위험

`auto-final`에서 걱정했던 단일 WAV/SRT 병합 문제는 Hermes가 scene 단위로 TTS와 SRT를 처리하므로 1차 위험에서 내려갑니다.

대신 Hermes에서 중요한 위험:

```text
장면 수가 많아질수록 ComfyUI keyframe 생성 시간이 크게 늘어남
WanGP i2v는 1~2시간 롱폼 전체를 한 번에 만들기엔 시간이 매우 길 수 있음
Ollama / ComfyUI / WanGP가 GPU/VRAM을 공유하므로 serialGpu 운영이 중요함
manual storyboard가 너무 길면 parser/QA/스토리보드 preview 관리가 무거워질 수 있음
Flux lineart 기본 스타일이 너무 단순하거나 explainer처럼 보일 수 있음
```

대응:

```text
3분 샘플: 20~35 scenes
20분 파일럿: 120~180 scenes 이하
60분: 320~480 scenes 이하
90분 이상: chapter별 Hermes job으로 나누고 최종 concat 검토
```

## 0.8 현재 문서의 나머지 부분에 대한 해석

아래의 기존 `auto-final` 분석과 계획은 삭제하지 않습니다. 다만 현재 기준에서는 다음처럼 해석합니다.

```text
auto-final 관련 내용:
  fallback 렌더 엔진 검토 기록
  Hermes가 실패할 경우 참고할 보조 계획

Hermes 관련 0장:
  앞으로의 1차 통합 계획
```

## 0.9 auto-final 리뷰 보고서 재검토 결과

검토 대상:

```text
C:\Users\petbl\auto-video\auto-final-collaboration-review-report.md
```

재검토 결론:

```text
리뷰 보고서의 5대 지적은 auto-final을 1차 렌더 엔진으로 쓸 경우 대부분 타당하다.
하지만 현재 1차 통합 대상은 Hermes Studio이므로, auto-final 코드 수정 계획으로 그대로 올리지 않는다.
대신 같은 위험이 Hermes 통합에서 어떻게 해소되거나 남는지 기준으로 재분류한다.
```

### 0.9.1 타당하며 Hermes 계획에도 반영할 항목

#### 1. 장면 타임라인과 렌더 타임라인의 불일치 위험

검증 결과, `auto-final`의 지적은 타당합니다.

```text
C:\Users\petbl\auto-final\src\auto_video\execution_planner.py
  build_deterministic_execution_plan()이 allocate_even_visual_slots()를 호출한다.

C:\Users\petbl\auto-final\src\auto_video\timeline_allocator.py
  allocate_even_visual_slots()가 오디오 길이 / 시각 자료 수로 균등 분할한다.

C:\Users\petbl\auto-final\src\auto_video\motion_planner.py
  assign_motions()가 이미지 슬롯의 기존 motion을 보존하지 않고 새로 부여한다.
```

Hermes에서는 이 위험이 상당 부분 줄어듭니다.

```text
C:\Users\petbl\hermes-studio\hermes-local\scripts\run-job.mjs
  --manual-storyboard 입력을 직접 지원한다.

C:\Users\petbl\hermes-studio\hermes-local\lib\manual-storyboard\storyboard-plan.mjs
  manual storyboard를 ScenePlan / StoryboardPlan으로 변환하고
  각 장면의 narration, prompt, camera, mood, motion을 보존한다.

C:\Users\petbl\hermes-studio\hermes-local\lib\pipeline\runner.mjs
  suppliedPlan이 있으면 director를 건너뛰고 제공된 plan으로 진행한다.
```

계획 반영:

```text
auto-video의 최종 산출물은 auto-final용 0_scene_prompts.json보다
Hermes manual storyboard를 우선 생성한다.

manual storyboard에는 각 블록마다 다음 정보를 반드시 넣는다.
- 대본 텍스트
- 영어 이미지 프롬프트
- camera angle
- lighting
- mood
- motion

3분 샘플 검증 때 sceneplan.json과 storyboard plan을 열어
대본-프롬프트-motion이 장면 순서대로 보존됐는지 확인한다.
```

#### 2. 이미지 누락으로 인한 index shift 위험

리뷰 보고서의 지적은 타당합니다. `auto-final`은 숫자 파일명 정렬에 의존하므로 중간 이미지가 빠지면 뒤 장면이 밀릴 수 있습니다.

Hermes에서는 ComfyUI keyframe을 장면별로 생성하고 manifest를 남기므로 위험이 줄지만, 수동 이미지나 외부 생성 이미지를 섞는 순간 같은 문제가 다시 생길 수 있습니다.

계획 반영:

```text
auto-video export 단계에 asset validation을 추가한다.

검증 대상:
- hermes-manual-storyboard.md의 블록 수
- 생성된 ScenePlan scenes 수
- keyframe manifest scenes 수
- 각 scene_id/order에 대응하는 keyframe_path 존재 여부

검증 출력:
exports/<slug>/asset-validation-report.json
exports/<slug>/asset-validation-report.md
```

Hermes 샘플 검증 기준:

```text
3분 샘플: 모든 scene order에 keyframe 또는 clip이 있어야 통과
20분 파일럿: 누락 scene이 1개라도 있으면 최종 렌더 전에 중단
60분 이상: chapter job별 manifest를 검증한 뒤 concat 단계로 이동
```

#### 3. 장시간 TTS 안정성과 SRT offset 문제

`auto-final` 기준 리뷰 지적은 타당합니다. 단일 `0_tts.wav`와 `0_tts.srt`를 기대하는 구조에서는 챕터별 TTS 병합과 SRT offset 스크립트가 필요합니다.

Hermes에서는 위험의 성격이 다릅니다.

```text
C:\Users\petbl\hermes-studio\hermes-local\lib\agents\voice.mjs
  scene 단위로 voice_XX.wav를 생성한다.

C:\Users\petbl\hermes-studio\hermes-local\lib\agents\editor.mjs
  voice duration을 기준으로 segment를 만들고 subs.srt를 누적 cursor로 생성한다.
```

따라서 1개 Hermes job 안에서는 SRT offset 병합 스크립트를 따로 만들 필요가 없습니다. 다만 60분 이상을 chapter별 Hermes job으로 나누면 최종 concat 단계에서 다시 필요합니다.

계획 반영:

```text
1차 구현:
  Hermes 단일 job으로 3분 샘플과 20분 파일럿을 만든다.

60분 이상:
  chapter별 Hermes job으로 나눈다.
  각 job의 final.mp4, subs.srt, timing-summary.json, qa-report.json을 보존한다.
  최종 concat 단계에서는 chapter별 영상 길이를 기준으로 subs.srt와 youtube chapter timestamp를 offset 처리한다.
```

추가 계획 파일 후보:

```text
C:\Users\petbl\auto-video\scripts\merge_hermes_chapters.py
```

필수 기능:

```text
chapter_01/final.mp4 ... 를 ffmpeg concat으로 병합
chapter_01/subs.srt ... 의 timestamp에 누적 offset 적용
최종 subs.srt 생성
최종 youtube_description.txt 생성
각 chapter의 qa-report.json이 fail이면 concat 중단
```

#### 4. 유튜브 챕터 메타데이터 생성

리뷰 보고서의 지적은 타당합니다. Hermes도 현재 `final.mp4`, `subs.srt`, `qa-report.json` 등은 생성하지만, 업로드 설명란에 바로 붙일 `youtube_description.txt`는 명시적으로 보장되지 않습니다.

계획 반영:

```text
auto-video가 대본 작성 단계에서 chapters.json을 만든다.
Hermes job 완료 후 timing-summary.json 또는 editor segments 기준으로 실제 timestamp를 보정한다.
최종 산출물에 youtube_description.txt를 포함한다.
```

권장 형식:

```text
00:00 프롤로그: 왜 우리는 금지된 것에 끌릴까요
05:12 에덴의 평온과 인간의 첫 불안
13:40 뱀의 질문이 마음에 만든 작은 균열
...
```

꿀잠성경 규칙:

```text
설교 제목처럼 쓰지 않는다.
공포/심판/자극 표현을 피한다.
일반 시청자도 편하게 누를 수 있는 심리적 문장으로 쓴다.
```

#### 5. 프로젝트 경로 오염 위험

`auto-final`의 단일 `input`, `work`, `output` 구조 지적은 타당합니다.

Hermes는 jobDir 기반으로 산출물을 나누는 구조이므로 1차 위험은 낮습니다. 그래도 `outputs` 아래 job 이름이 겹치거나 chapter별 결과물을 덮어쓰면 같은 문제가 생길 수 있습니다.

계획 반영:

```text
Hermes jobDir 이름은 반드시 slug + chapter + timestamp를 포함한다.

예:
C:\Users\petbl\hermes-studio\hermes-local\outputs\gguljam-bible-adam-eve\chapter_01_20260626_2300\
C:\Users\petbl\hermes-studio\hermes-local\outputs\gguljam-bible-adam-eve\chapter_02_20260626_2315\
```

auto-video export 구조:

```text
C:\Users\petbl\auto-video\exports\<slug>\
  hermes-manual-storyboard.md
  script.txt
  chapters.json
  production.json
  validation\
  hermes-runs\
```

### 0.9.2 조건부로만 반영할 항목

#### GPU 인코딩과 worker 확장

`auto-final`에서는 `h264_nvenc`, `clip_workers` 설정이 존재합니다. 하지만 Hermes는 ComfyUI, Ollama, WanGP, Supertonic이 GPU/VRAM을 공유하므로 worker를 무작정 늘리면 안정성이 떨어질 수 있습니다.

계획 반영:

```text
Hermes 1차 운영은 serialGpu 원칙을 유지한다.
ComfyUI keyframe, WanGP i2v, Ollama 호출을 동시에 강하게 돌리지 않는다.
속도 최적화는 20분 파일럿 성공 후 별도 벤치마크로 분리한다.
```

#### 리뷰 보고서의 코드 스케치

방향은 참고하되 그대로 복사하지 않습니다.

이유:

```text
현재 1차 대상이 auto-final이 아니라 Hermes다.
auto-final 코드 스케치는 jpg 고정, subtitle 필수, scene_id 숫자 추정 등 숨은 가정이 있다.
Hermes는 manual storyboard와 manifest 중심으로 검증하는 편이 더 자연스럽다.
```

### 0.9.3 현재 계획서에 반영하지 않을 항목

```text
auto-final 내부 renderer 전면 수정
auto-final motion_planner 즉시 수정
auto-final CLI에 --project-id 즉시 추가
auto-final용 gguljam-bible.yaml 우선 작성
auto-final용 TTS 병합 스크립트 우선 작성
GPU 인코딩을 기본값으로 전환
```

이유:

```text
Hermes Studio가 이미 ComfyUI, WanGP, Supertonic, FFmpeg, manual storyboard, QA를 묶고 있다.
따라서 현재 목표인 “대본과 이미지 프롬프트를 주면 최종 영상까지 생성”에는 Hermes 쪽 샘플 검증이 더 빠르고 직접적이다.
auto-final 계획은 Hermes가 실패하거나 특정 후반작업만 분리해야 할 때 fallback으로 유지한다.
```

### 0.9.4 수정된 우선순위

```text
1. auto-video가 hermes-manual-storyboard.md를 안정적으로 생성한다.
2. manual storyboard parser/plan/runner 검증을 매번 통과시킨다.
3. 3분 샘플을 contextual-preview 또는 dry-run으로 검증한다.
4. ComfyUI keyframe manifest에서 scene 누락이 없는지 검증한다.
5. WanGP i2v 3~5장면 샘플을 검증한다.
6. 20분 파일럿을 단일 Hermes job으로 만든다.
7. chapters.json과 youtube_description.txt 생성 규칙을 추가한다.
8. 60분 이상은 chapter별 Hermes job + 최종 concat/offset 도구로 확장한다.
9. Hermes 실패 시에만 auto-final fallback 계획의 planned timeline / TTS merge / input isolation을 꺼내 적용한다.
```

### 0.9.5 5.5 샘플 진행 기록

5.5 작업은 위 우선순위의 3~5번 사이에 해당하는 `Hermes manual storyboard 샘플 패키지 생성 및 dry-run 검증`으로 진행합니다.

생성한 샘플:

```text
C:\Users\petbl\auto-video\exports\gguljam-bible-adam-eve-001\
  hermes-manual-storyboard.md
  script.txt
  chapters.json
  production.json
  youtube_description.txt
  validation\asset-validation-report.json
  validation\asset-validation-report.md
  validation\hermes-dry-run-report.md
```

검증 결과:

```text
auto-video export validation:
  pass
  scenes: 16
  chapters: 4
  missing fields: none

Hermes parser:
  scenes: 16

Hermes ScenePlan / StoryboardPlan:
  sceneCount: 16
  duration: 90.08 seconds

Hermes run-job dry-run:
  exit code: 0
  runner verdict: pass
  director skipped by supplied manual plan
  script preservation: pass
  narration boundary: pass
  storyboard quality gate: ok

ComfyUI keyframe sample:
  command: node scripts\render_hermes_keyframe_sample.mjs --export-dir C:\Users\petbl\auto-video\exports\gguljam-bible-adam-eve-001 --count 3 --seconds 90
  rendered: 3/3
  failed: 0
  missingFiles: 0
  report: C:\Users\petbl\auto-video\exports\gguljam-bible-adam-eve-001\validation\keyframe-sample-report.md
```

주의할 점:

```text
contextual-preview --dry-run은 실제 keyframe 파일을 만들지 않고 manifest만 만든다.
따라서 visual-qa-report.json에는 Image file missing으로 fail이 찍힐 수 있다.
이 fail은 dry-run의 한계로 기록하되, 실제 시각 승인으로 간주하지 않는다.
다음 단계에서는 contextual-keyframes로 실제 ComfyUI keyframe을 생성해 visual QA를 다시 확인한다.
5.5에서는 앞 3개 장면을 별도 브릿지 스크립트로 실제 렌더해 ComfyUI 연결과 스타일 방향을 확인했다.
```

리뷰어 에이전트가 지적한 추가 위험 중 현재 계획에 반영할 항목:

```text
manual storyboard에는 블록 외 텍스트를 넣지 않는다.
장문 수동 storyboard에서 splitLongScenes가 order를 바꿀 수 있는지 별도 확인한다.
title segment가 추가되면 youtube chapter offset 계산에 반영한다.
chapter별 Hermes job을 concat할 때 subs.srt offset과 youtube_description timestamp를 함께 보정한다.
```

## 1. 결론

`C:\Users\petbl\auto-final`은 이미 TTS, FFmpeg 렌더링, 자막 변환, 이미지/영상 타임라인 생성, 캐시, 리포트, 브라우저 콘솔까지 갖춘 후반작업 파이프라인입니다.

따라서 `auto-video`를 새로 렌더러까지 만들기보다, `auto-video`는 `꿀잠성경` 전용 기획/대본/장면 설계 엔진으로 두고, `auto-final`은 제작/렌더링 엔진으로 연결하는 방향이 가장 좋습니다.

권장 구조:

```text
auto-video
  벤치마킹 분석
  주제/제목 생성
  성경+심리 대본 작성
  장면 이미지 프롬프트 생성
  제작 패키지 생성
        ↓
auto-final
  Supertonic TTS 생성
  0_tts.wav / 0_tts.srt / 0_tts_script.txt 관리
  이미지/영상 타임라인 생성
  FFmpeg 렌더링
  자막 ASS 변환
  최종 mp4 출력
```

## 2. 확인한 auto-final 구조

### 2.1 주요 폴더

```text
C:\Users\petbl\auto-final
  assets\       폰트, 효과음 등 렌더 자산
  config\       기본 YAML 설정
  docs\         기존 개발/개선 계획서
  final\        완성본 예시 프로젝트
  input\        렌더 입력 파일
  output\       최종 출력물과 리포트
  scripts\      보조 스크립트
  src\          파이프라인 본체
  tests\        테스트
  work\         중간 산출물, 캐시, 클립, ASS 자막
```

### 2.2 핵심 실행 파일

```text
run.ps1
  PYTHONPATH=src 설정 후 python -m auto_video.cli 실행

config/default.yaml
  렌더 설정, TTS 설정, 자막 설정, 장면 타이밍, 비디오 인코더 설정 관리

src/auto_video/cli.py
  전체 실행 진입점
```

### 2.3 핵심 모듈

```text
src/auto_video/auto_render.py
  input 폴더의 이미지/영상 + 오디오 + 자막을 읽어 최종 영상 렌더링

src/auto_video/supertonic_client.py
  Supertonic TTS 작업 요청, 결과물을 input/0_tts.* 파일로 가져오기

src/auto_video/subtitles.py
  SRT를 읽기 좋은 ASS 자막으로 변환

src/auto_video/srt_scene_segmenter.py
  SRT 또는 대본을 장면 단위로 분할

src/auto_video/timeline_allocator.py
  오디오 길이에 맞춰 이미지/영상 장면을 균등 배치

src/auto_video/motion_planner.py
  이미지 장면에 줌인, 팬, 대각 이동 등 모션 부여

src/auto_video/visual_remover_service.py
  기존 영상의 자막/워터마크 제거 보조 기능

src/auto_video/browser_console_server.py
  브라우저 콘솔에서 TTS, 장면 프롬프트, 렌더 실행 가능
```

## 3. 이미 사용 가능한 장점

### 3.1 FFmpeg/FFprobe 설치 확인

현재 시스템에서 `ffmpeg`와 `ffprobe`가 PATH로 바로 실행됩니다.

확인된 버전:

```text
ffmpeg version 8.1.1-full_build-www.gyan.dev
ffprobe version 8.1.1-full_build-www.gyan.dev
```

특히 `libass`, `libfreetype`, `libfribidi`, `libharfbuzz`, `libx264`, `h264_nvenc` 관련 빌드 옵션이 포함되어 있어 자막 렌더링과 GPU 인코딩 확장에 유리합니다.

### 3.2 Supertonic TTS 서버 확인

`C:\Users\petbl\supertonic3-local-tts-20260517-r4` 경로가 존재하며, `http://127.0.0.1:3093/api/voices` 응답도 정상입니다.

확인된 음성:

```text
M1, M2, M3, M4, M5, F1, F2, F3, F4, F5
```

즉 `꿀잠성경`용 남성/여성 내레이션 테스트를 바로 할 수 있습니다.

### 3.3 입력 파일 규칙이 명확함

`auto-final`은 다음 파일을 우선적으로 인식합니다.

```text
input/0_tts.wav
input/0_tts.srt
input/0_tts_script.txt
input/1.jpg
input/2.jpg
input/3.mp4
...
```

이미지와 영상은 숫자 파일명 순서대로 정렬됩니다. 이 규칙은 `auto-video`가 장면 패키지를 만들 때 그대로 맞추면 됩니다.

### 3.4 긴 영상 제작에 필요한 기본 장치가 있음

`auto-final`에는 다음 기능이 이미 있습니다.

```text
오디오 길이 탐지
이미지/영상 장면 자동 배분
이미지 팬/줌 모션
클립별 렌더 캐시
최종 렌더 캐시
SRT → ASS 자막 변환
자막 품질 리포트
시각 자료 텍스트 위험 리포트
작업 잠금 파일
브라우저 콘솔
```

1~2시간 영상에서는 중간 실패와 재렌더 비용이 크기 때문에, 캐시와 리포트가 이미 있는 점이 특히 좋습니다.

## 4. auto-video와 auto-final의 역할 분리

### 4.1 auto-video가 맡을 일

`auto-video`는 창작과 설계를 담당합니다.

```text
채널 벤치마킹 분석
꿀잠성경 주제 10개 추천
성경 본문/심리 주제 검토
비기독교인도 듣기 좋은 표현으로 대본 작성
1시간, 90분, 2시간용 장문 대본 구성
장면별 이미지 프롬프트 작성
장면별 영상 모션 프롬프트 작성
auto-final 입력 패키지 생성
```

### 4.2 auto-final이 맡을 일

`auto-final`은 제작과 후반작업을 담당합니다.

```text
대본 → Supertonic TTS
TTS 결과물 → 0_tts.wav / 0_tts.srt / 0_tts_script.txt
이미지/영상 파일 숫자 순서 정렬
오디오 길이에 맞춘 장면 타임라인 생성
이미지 팬/줌 모션 적용
ASS 자막 생성
FFmpeg 최종 렌더
output/final.mp4 생성
output/report.json 생성
```

## 5. 꿀잠성경용 병합 방향

### 5.1 새 렌더러를 만들지 않는다

`auto-final`의 `UnifiedAutoRenderer`를 그대로 활용합니다.

우리에게 필요한 것은 새 렌더 엔진이 아니라 다음 세 가지입니다.

```text
1. auto-video 산출물을 auto-final 입력 규칙에 맞게 내보내는 패키지 규격
2. 꿀잠성경 전용 YAML 프로필
3. 장문 대본/장면/이미지 수를 관리하는 운영 규칙
```

### 5.2 꿀잠성경 전용 프로필을 만든다

기본 `config/default.yaml`은 짧은 영상 또는 일반 정보성 영상에 가깝습니다. `꿀잠성경`은 수면 청취형 장문 영상이므로 별도 프로필이 필요합니다.

권장 파일:

```text
C:\Users\petbl\auto-final\config\gguljam-bible.yaml
```

권장 설정 방향:

```yaml
project:
  language: ko
  output_name: final.mp4

runtime:
  mode: safe
  max_video_minutes: 120

render_settings:
  canvas:
    mode: landscape
    landscape_width: 1920
    landscape_height: 1080
    fps: 30

  title:
    enabled: false

  subtitles:
    font_family: Gmarket Sans
    font_size: 42
    outline: 7
    shadow: 2
    max_chars_per_line: 17
    max_lines: 2
    y: 930

  motion:
    image_scale: 1.10
    seed: 17

  scene_timing:
    policy: hook_locked_even_tail
    locked_intro_scenes: 2
    locked_intro_duration: 10.0
    min_scene_duration: 6.0
    target_scene_duration: 9.0
    max_scene_duration: 14.0

  supertonic:
    voice: M1
    lang: ko
    speed: 0.95
    total_step: 8
    silence_duration: 0.45
    timeout_sec: 7200

  subtitle_removal:
    enabled: false

  encoder:
    video_codec: libx264
    preset: veryfast
    crf: 23
    clip_workers: 1
    final_cache: true
    clip_cache: true
```

주의: Supertonic의 `speed`, `silence_duration` 값은 실제 음성 샘플을 들어보고 조정해야 합니다. 수면형 채널은 빠른 정보 전달보다 안정적인 호흡이 중요합니다.

### 5.3 장면 길이는 auto-video와 auto-final을 다르게 본다

`auto-video.md`에는 이미지 프롬프트를 3~5초 단위로 만들도록 되어 있습니다. 하지만 1~2시간 수면형 영상에서는 모든 3~5초 컷을 실제 이미지로 만들면 이미지 수가 과도하게 늘어납니다.

권장 운영:

```text
대본/프롬프트 설계 기준:
  3~5초 단위까지 쪼갤 수 있게 작성

실제 렌더 기준:
  8~14초 단위 대표 이미지 사용

1시간 영상:
  약 300~450장

90분 영상:
  약 450~650장

2시간 영상:
  약 600~850장
```

초기에는 60분 영상도 200~300장 수준으로 줄여 테스트하고, 시각 반복이 어색하면 장면 수를 늘리는 방식이 좋습니다.

## 6. 제작 패키지 규격

`auto-video`가 최종적으로 다음 형태의 프로젝트 폴더를 만들도록 설계합니다.

```text
auto-video\exports\gguljam-bible-adam-eve-001\
  script.txt
  chapters.json
  scenes.json
  image-prompts.md
  video-prompts.md
  production.json
```

그리고 `auto-final`로 넘길 때는 다음처럼 복사/변환합니다.

```text
auto-final\input\
  0_tts_script.txt
  0_tts.wav
  0_tts.srt
  1.jpg
  2.jpg
  3.jpg
  ...
  0_scene_prompts.json
```

### 6.1 production.json 권장 스키마

```json
{
  "project": {
    "channel": "꿀잠성경",
    "title": "잠들기 전 듣는 성경 속 인간 심리, 아담과 하와가 선악과를 따먹은 진짜 이유",
    "target_minutes": 90,
    "audience": "기독교인이 아닌 일반인도 편하게 듣는 수면형 성경 심리 콘텐츠"
  },
  "script": {
    "path": "script.txt",
    "char_count": 24000,
    "tone": "quiet, reflective, comforting, non-preachy"
  },
  "render": {
    "auto_final_config": "config/gguljam-bible.yaml",
    "orientation": "landscape",
    "subtitle_mode": "soft_readable",
    "scene_duration_target_sec": 9
  },
  "tts": {
    "provider": "supertonic",
    "voice": "M1",
    "speed": 0.95,
    "silence_duration": 0.45
  },
  "assets": {
    "image_style": "black and white painterly biblical illustration, cinematic chiaroscuro, calm sleep documentary mood",
    "image_count_target": 450
  }
}
```

## 7. 구체적 병합 단계

### 7.1 1단계: 현 상태 안전 확인

목표: `auto-final`이 현재 환경에서 최소 실행 가능한지 확인합니다.

작업:

```text
ffmpeg / ffprobe 확인
Supertonic 서버 확인
auto-final 테스트 중 핵심 테스트만 실행
기본 dry-run 실행
브라우저 콘솔 실행 여부 확인
```

권장 명령:

```powershell
cd C:\Users\petbl\auto-final
$env:PYTHONPATH="src"
python -m pytest tests/test_auto_render.py tests/test_supertonic_client.py tests/test_execution_planner.py -q
python -m auto_video.cli --config config/default.yaml --dry-run
```

### 7.2 2단계: 꿀잠성경 YAML 프로필 추가

목표: 기존 기본 설정을 건드리지 않고 `꿀잠성경` 전용 설정을 분리합니다.

작업:

```text
config/gguljam-bible.yaml 생성
max_video_minutes 120으로 확장
subtitle_removal 비활성화
landscape 기본값 적용
수면형 TTS 속도/쉼 조정
장면 길이 8~14초 중심으로 조정
```

### 7.3 3단계: auto-video → auto-final 패키지 어댑터 작성

목표: `auto-video`가 만든 대본과 장면 계획을 `auto-final/input`으로 보냅니다.

권장 새 파일:

```text
C:\Users\petbl\auto-video\scripts\export_to_auto_final.ps1
또는
C:\Users\petbl\auto-video\scripts\export_to_auto_final.py
```

주요 기능:

```text
script.txt를 auto-final/input/0_tts_script.txt로 복사
생성 이미지들을 1.jpg, 2.jpg, 3.jpg 순서로 복사
image-prompts.md와 scenes.json을 0_scene_prompts.json으로 변환
기존 input 파일 백업 또는 프로젝트별 input 폴더 사용
gguljam-bible.yaml 경로를 실행 명령에 연결
```

주의: 현재 `auto-final`은 기본적으로 `input` 단일 폴더를 봅니다. 여러 프로젝트를 병렬로 다루려면 `input_projects/<slug>`를 만들고 실행 직전에 `input`으로 동기화하는 방식이 안전합니다.

### 7.4 4단계: TTS 생성 연결

목표: 대본에서 바로 `0_tts.wav`, `0_tts.srt`를 생성합니다.

이미 있는 기능:

```text
src/auto_video/supertonic_client.py
src/auto_video/browser_console_server.py
```

권장 방향:

```text
처음에는 auto-final 브라우저 콘솔에서 TTS 실행
안정화 후 auto-video 어댑터에서 Supertonic API 직접 호출
장문 대본은 챕터 단위 TTS 생성 후 병합 여부 검토
```

장문 영상 주의:

```text
90~120분 대본을 한 번에 TTS로 넣으면 실패/타임아웃 위험이 큼
20~30분 단위 챕터별 TTS 생성 후 합치는 전략을 검토
Supertonic timeout_sec는 최소 7200초로 늘림
생성된 SRT와 WAV 길이 drift를 report.json에서 확인
```

### 7.5 5단계: 3분 샘플 렌더

목표: 전체 병합 전에 작은 샘플로 실제 감각을 확인합니다.

샘플 조건:

```text
대본 1,000~1,500자
이미지 15~25장
TTS 3~5분
자막 켜기
landscape 1920x1080
```

확인 항목:

```text
목소리 속도
쉼 길이
자막 크기
이미지 움직임 과함 여부
수면형 분위기 유지
이미지와 대본의 의미 매칭
```

### 7.6 6단계: 20분 파일럿

목표: 기존에 짧다고 느꼈던 20분 분량을 파일럿으로 완성합니다.

이 단계에서는 1~2시간 영상을 바로 만들지 않습니다. 먼저 20분에서 다음을 확인합니다.

```text
장면 반복 피로도
TTS 안정성
자막 싱크
렌더 속도
캐시 재사용
파일 용량
작업 실패 시 복구성
```

### 7.7 7단계: 60분 → 90분 → 120분 확장

목표: 긴 영상의 실패 지점을 단계적으로 찾습니다.

권장 순서:

```text
60분: 챕터 10~13개, 이미지 250~450장
90분: 챕터 14~18개, 이미지 450~650장
120분: 챕터 18~22개, 이미지 600~850장
```

각 단계에서 `output/report.json`, 렌더 시간, 디스크 사용량, 자막 싱크를 확인합니다.

## 8. 꿀잠성경에 맞는 제작 운영안

### 8.1 콘텐츠 톤

`꿀잠성경`은 설교 채널보다 수면형 심리 해석 채널에 가깝게 운영합니다.

권장 톤:

```text
성경을 믿으라고 설득하지 않음
성경 이야기를 인간 마음의 오래된 거울처럼 소개
현대 심리학은 단정이 아니라 이해의 언어로 사용
죄책감을 자극하기보다 숨고 싶은 마음을 이해해줌
마지막은 회개 압박보다 조용한 위로와 성찰로 마무리
```

### 8.2 화면 스타일

사용자가 제공한 참고 이미지 기준으로는 다음 스타일이 적합합니다.

```text
흑백 또는 저채도 회화풍
성경 시대 배경
강한 명암 대비
느린 카메라 움직임
인물의 표정과 고요한 공간 중심
텍스트 없는 이미지
수면을 방해하지 않는 차분한 화면
```

### 8.3 자막 운영

수면형 영상에서는 자막을 너무 크게, 너무 자극적으로 쓰지 않는 것이 좋습니다.

권장:

```text
영상 본편: 자막 있음 버전과 자막 약한 버전 둘 다 테스트
수면용 롱폼: 자막 크기 작게, 강조색 최소화
쇼츠/미리보기: 자막 크게, 클릭 유도용 강조 가능
```

## 9. 위험 요소와 대응

### 9.1 현재 max_video_minutes 기본값

`config/default.yaml`에는 `runtime.max_video_minutes: 30`이 있습니다.

대응:

```text
기본값은 유지
꿀잠성경 프로필에서 120으로 확장
```

### 9.2 장문 TTS 실패 가능성

1~2시간 대본을 한 번에 TTS 생성하면 서버 타임아웃, SRT 싱크 오류, 중간 실패 가능성이 있습니다.

대응:

```text
20~30분 단위 챕터 TTS 생성
챕터별 wav/srt 병합 도구 추가
최종 report에서 sync_drift_seconds 확인
```

### 9.3 이미지 수 과다

3~5초 단위로 2시간 영상을 만들면 1,400~2,400장의 이미지가 필요할 수 있습니다.

대응:

```text
실제 렌더는 8~14초 대표 이미지 기준
중요 장면만 3~5초 컷으로 세분화
반복 가능한 배경 이미지와 인물 클로즈업을 섞음
```

### 9.4 기존 input/output 오염

`auto-final`은 기본적으로 단일 `input`, `output`, `work` 폴더를 사용합니다.

대응:

```text
프로젝트별 export 폴더 유지
실행 전 input 백업
output/final.mp4는 프로젝트명으로 복사 보관
work 캐시 삭제/유지 정책 명시
```

### 9.5 subtitle_removal 기능은 대부분 불필요

`꿀잠성경`은 생성 이미지 중심이므로 기존 영상 자막 제거 기능은 기본적으로 필요 없습니다.

대응:

```text
gguljam-bible.yaml에서 subtitle_removal.enabled: false
기존 영상 소스를 재활용할 때만 별도 사용
```

### 9.6 이미지 프롬프트와 실제 이미지 파일 연결

`auto-video`는 프롬프트를 만들고, `auto-final`은 실제 이미지 파일을 렌더합니다. 중간에 이미지 생성/다운로드/정렬 단계가 비면 자동화가 끊깁니다.

대응:

```text
scenes.json에 scene_id, prompt, expected_filename을 포함
이미지 생성 후 파일명 검증
누락 이미지 목록 리포트 생성
```

## 10. 최종 권장 구현 순서

1. `auto-final` 핵심 테스트와 dry-run으로 현재 상태를 고정한다.
2. `config/gguljam-bible.yaml`을 추가한다.
3. `auto-video`에 `exports/<project-slug>` 제작 패키지 규격을 추가한다.
4. `script.txt`와 이미지 파일을 `auto-final/input`으로 보내는 어댑터를 만든다.
5. Supertonic TTS는 처음에는 `auto-final` 브라우저 콘솔 또는 기존 API로 생성한다.
6. 3분 샘플을 렌더한다.
7. 20분 파일럿을 렌더한다.
8. 챕터별 TTS 병합이 필요한지 판단한다.
9. 60분, 90분, 120분 순서로 확장한다.
10. 안정화 후 `auto-video.md`의 3단계/4단계 산출물에 `auto-final 패키지 내보내기`를 정식 단계로 추가한다.

## 11. 바로 다음 작업 제안

가장 먼저 할 일은 작은 샘플 연결입니다.

```text
샘플 주제:
잠들기 전 듣는 성경 속 인간 심리,
아담과 하와가 선악과를 따먹은 진짜 이유

샘플 길이:
3~5분

필요 산출물:
script.txt
image-prompts.md
1~20장 이미지
0_tts.wav
0_tts.srt
output/final.mp4
```

이 샘플이 성공하면, 지금까지 만든 `auto-video.md`의 대본 생성 규칙과 `auto-final`의 렌더링 파이프라인이 실제로 한 몸처럼 움직이는지 검증할 수 있습니다.

## 12. 현재 검증 기록

2026-06-26 기준으로 다음을 확인했습니다.

```text
ffmpeg 실행 가능
ffprobe 실행 가능
Supertonic TTS 서버 응답 정상
Supertonic 음성 목록 확인: M1, M2, M3, M4, M5, F1, F2, F3, F4, F5
```

핵심 테스트:

```powershell
cd C:\Users\petbl\auto-final
$env:PYTHONPATH="src"
python -m pytest tests/test_auto_render.py tests/test_supertonic_client.py tests/test_execution_planner.py -q
```

결과:

```text
42 passed
```

## 13. 리뷰 보고서 검토 반영

검토 대상:

```text
C:\Users\petbl\auto-video\auto-final-collaboration-review-report.md
```

검토 기준:

```text
1. auto-final 실제 코드와 일치하는가
2. 꿀잠성경 1~2시간 롱폼 제작에 직접 필요한가
3. 기존 계획서의 방향과 충돌하지 않는가
4. 구현 예시를 그대로 옮겨도 안전한가
```

### 13.1 타당하므로 계획에 반영할 항목

#### 1. 장면 타임라인과 실제 렌더 타임라인의 불일치

리뷰 보고서의 지적은 타당합니다.

현재 `auto-final`은 `input/0_scene_prompts.json`을 생성할 수 있지만, 최종 렌더링에서는 이 파일의 `start`, `end`, `duration`, `motion`을 직접 사용하지 않습니다. 실제 렌더는 `auto_render.py`의 `plan_visual_slots()`가 이미지/영상 수와 오디오 길이를 기준으로 균등 분할하고, `motion_planner.py`가 모션을 다시 부여합니다.

따라서 병합 계획에 다음 작업을 추가합니다.

```text
우선순위 A:
0_scene_prompts.json 또는 scenes.json을 실제 렌더 타임라인 입력으로 사용하는 planned timeline 모드를 추가한다.

필수 조건:
- scene_id와 expected_filename을 매칭한다.
- start/end/duration을 검증한다.
- 마지막 장면 end가 오디오 길이와 0.5초 이상 차이 나면 경고한다.
- 파일이 누락되면 렌더를 중단한다.
- 기존 deterministic 균등 분할은 fallback으로 유지한다.
```

권장 구현 위치:

```text
C:\Users\petbl\auto-final\src\auto_video\execution_planner.py
C:\Users\petbl\auto-final\src\auto_video\auto_render.py
C:\Users\petbl\auto-final\src\auto_video\plan_validator.py
```

#### 2. 사용자가 지정한 모션 보존

리뷰 보고서의 지적은 타당합니다.

현재 `motion_planner.py`의 `assign_motions()`는 이미지 슬롯에 이미 `motion` 값이 있더라도 무작위 모션으로 덮어씁니다. `auto-video`가 장면별로 `slow zoom in`, `pan left`, `static hold` 같은 의도를 정해도 현재 구조에서는 보존되지 않습니다.

계획에 다음 작업을 추가합니다.

```text
우선순위 A:
slot에 유효한 motion 값이 있으면 그대로 보존한다.
motion 값이 없거나 허용 목록 밖이면 기존 seeded random motion을 사용한다.
```

단, 리뷰 보고서의 코드 조각은 그대로 복사하지 않고, 현재 `ALLOWED_MOTIONS`와 `canonical_motion()` 계약에 맞춰 테스트부터 추가합니다.

필수 테스트:

```text
기존 motion이 zoom_in이면 그대로 유지
legacy alias diag_down은 diag_dr로 정규화
잘못된 motion은 random fallback
video 슬롯은 none 유지
```

#### 3. 프로젝트별 input/work/output 격리

리뷰 보고서의 지적은 타당합니다.

현재 `cli.py`는 기본적으로 다음 경로를 고정 사용합니다.

```text
config.root / input
config.root / work
config.root / output
```

여러 에피소드를 만들면 이전 이미지, TTS, 캐시, `final.mp4`, `report.json`이 섞일 수 있습니다.

계획에 다음 작업을 추가합니다.

```text
우선순위 A:
처음에는 auto-video export 어댑터에서 프로젝트별 폴더를 만들고, 실행 직전 깨끗한 input으로 동기화한다.

우선순위 B:
auto-final CLI에 --project-id 또는 --project-dir를 추가해 input/work/output을 프로젝트별로 분리한다.
```

권장 임시 운영:

```text
auto-video\exports\<slug>\source\
auto-video\exports\<slug>\auto-final-input\
auto-final\input\              실행 직전 동기화되는 작업 폴더
auto-final\output\projects\<slug>\
auto-final\work\projects\<slug>\
```

장기 구현 시 주의:

```text
plan_validator.py는 현재 render.output이 root/output 내부에 있어야 한다.
프로젝트별 output/projects/<slug>를 쓰려면 이 검증 규칙과 report 저장 위치도 함께 수정해야 한다.
```

#### 4. 장문 TTS 챕터 병합과 SRT offset 처리

리뷰 보고서의 지적은 타당합니다.

기존 계획서에도 20~30분 단위 챕터 TTS 생성을 언급했지만, 실제 병합 단계가 구체적이지 않았습니다. `auto-final`은 현재 최종 렌더 입력으로 단일 `0_tts.wav`, 단일 `0_tts.srt`를 기대합니다.

계획에 다음 작업을 추가합니다.

```text
우선순위 A:
챕터별 TTS 결과물을 최종 0_tts.wav / 0_tts.srt로 병합하는 스크립트를 만든다.
```

권장 파일:

```text
C:\Users\petbl\auto-video\scripts\merge_tts_chapters.py
```

필수 기능:

```text
chapter_01.wav, chapter_02.wav ... 를 ffmpeg concat으로 병합
각 chapter_XX.srt의 timestamp에 누적 offset 적용
최종 0_tts.wav와 0_tts.srt 생성
병합 후 ffprobe로 wav 길이 확인
최종 SRT 마지막 timestamp와 wav 길이 차이를 report로 출력
차이가 0.5초 이상이면 경고
```

리뷰 보고서의 예시 코드는 방향은 맞지만 그대로 채택하지 않습니다.

보완할 점:

```text
SRT 번호를 최종 파일에서 1부터 다시 번호 매기기
밀리초 반올림으로 1000ms가 되는 경우 초 단위 올림 처리
경로에 작은따옴표가 들어가는 경우 ffmpeg concat list escaping 처리
누락된 chapter wav/srt가 있으면 조용히 skip하지 말고 실패 처리
```

#### 5. 이미지 파일 누락으로 인한 index shift 위험

리뷰 보고서의 지적은 타당합니다.

현재 `auto-final`은 이미지 파일을 숫자 우선순위로 정렬합니다. 하지만 `scenes.json`이 기대하는 `45.jpg`가 빠졌는데 `46.jpg`부터 이어지는 상황을 자동으로 막지는 못합니다. 이 경우 장면과 이미지가 한 칸씩 밀릴 수 있습니다.

계획에 다음 작업을 추가합니다.

```text
우선순위 A:
auto-video export 단계에서 scene manifest 기반 이미지 검증을 수행한다.

검증 규칙:
- scenes.json의 scene_id 수와 이미지 파일 수가 일치해야 한다.
- 각 scene에는 expected_filename이 있어야 한다.
- expected_filename 파일이 실제로 존재해야 한다.
- 중간 번호 누락이 있으면 auto-final/input 복사를 중단한다.
- 누락/중복/확장자 불일치 리포트를 생성한다.
```

권장 출력:

```text
exports/<slug>/asset-validation-report.json
exports/<slug>/asset-validation-report.md
```

#### 6. 유튜브 챕터 메타데이터 생성

리뷰 보고서의 지적은 타당합니다.

1~2시간 롱폼 영상은 업로드 설명란에 타임라인 챕터가 있어야 시청자가 듣고 싶은 구간으로 이동하기 쉽습니다. 현재 `auto-final`은 `output/report.json`은 만들지만, 업로드용 `youtube_description.txt`를 자동 생성하지 않습니다.

계획에 다음 작업을 추가합니다.

```text
우선순위 B:
chapters.json 또는 scenes.json을 바탕으로 output/youtube_description.txt를 생성한다.
```

권장 형식:

```text
00:00 프롤로그: 왜 우리는 금지된 것에 끌릴까요
05:12 에덴동산의 평온과 인간의 첫 불안
13:40 뱀의 질문이 마음에 만든 작은 균열
...
```

필수 규칙:

```text
첫 챕터는 반드시 00:00으로 시작
챕터 제목은 설교체보다 조용한 수면형 문장 사용
너무 자극적인 심판/공포 표현 금지
유튜브 설명란에 바로 붙일 수 있게 plain text로 출력
```

### 13.2 부분 타당하지만 조건부로만 반영할 항목

#### GPU 인코딩과 clip_workers 4~8 확장

`auto-final` 설정은 `h264_nvenc`, `clip_workers`를 지원합니다. 다만 모든 환경에서 GPU 인코딩이 안정적이라고 단정하면 안 됩니다.

계획 반영:

```text
기본 프로필은 libx264 + clip_workers 1로 둔다.
성능 테스트 후 h264_nvenc + clip_workers 2, 4, 8을 비교한다.
GPU 프로필은 별도 파일로 분리한다.
```

권장 추가 프로필:

```text
C:\Users\petbl\auto-final\config\gguljam-bible-gpu.yaml
```

#### planned timeline 코드 예시

리뷰 보고서의 구현 방향은 맞지만, 코드 조각은 그대로 반영하지 않습니다.

그 이유:

```text
scan["images"][0]["path"]는 root-relative일 수 있어 Path.exists()가 잘못 실패할 수 있다.
jpg만 가정하지만 현재 IMAGE_EXTENSIONS는 jpg, jpeg, png, webp, bmp를 허용한다.
scene_id 숫자와 파일명이 항상 1:1이라는 보장이 없다.
subtitle이 없을 때 scan["subtitles"][0] 접근이 실패할 수 있다.
```

따라서 구현은 `root` 기준 resolve, 확장자 허용 목록, expected_filename 필드, subtitle optional 처리를 포함해 새로 설계합니다.

### 13.3 현재 계획서에서 우선순위 변경

리뷰 보고서를 반영해 실행 순서를 다음처럼 조정합니다.

```text
1. auto-final 핵심 테스트와 dry-run으로 현재 상태 확인
2. gguljam-bible.yaml 생성
3. auto-video export 패키지 규격에 expected_filename, chapter_id, scene_id, motion 추가
4. asset validation으로 이미지 누락/index shift 방지
5. 0_scene_prompts.json/scenes.json 기반 planned timeline 렌더 모드 추가
6. motion_planner가 기존 motion을 보존하도록 수정
7. 3분 샘플 렌더
8. 챕터별 TTS 병합 스크립트 작성
9. 20분 파일럿 렌더
10. youtube_description.txt 생성 기능 추가
11. 프로젝트별 input/work/output 격리 강화
12. 60분, 90분, 120분 순서로 확장
```

이 순서로 바꾼 이유:

```text
이미지 누락 검증과 planned timeline 반영이 먼저 해결되어야
3분 샘플에서도 대본-이미지-모션 매칭을 제대로 검증할 수 있다.

TTS 챕터 병합은 20분 이상으로 넘어갈 때 중요해지므로
3분 샘플 이후, 20분 파일럿 전에 구현하는 것이 적절하다.
```

### 13.4 계획서에 반영하지 않는 항목

다음은 현재 단계에서는 반영하지 않습니다.

```text
auto-final 내부 렌더러 전면 재작성
기존 deterministic planner 제거
처음부터 완전한 멀티 프로젝트 CLI 구조로 대수술
처음부터 GPU 인코딩 기본값 적용
리뷰 보고서의 코드 조각을 그대로 복사
```

이유:

```text
현재 auto-final은 테스트가 잘 갖춰진 기존 파이프라인이 있으므로,
한 번에 구조를 크게 바꾸면 3분 샘플 검증까지 시간이 길어진다.

우선은 adapter + validation + planned timeline hook을 붙이고,
실제 샘플 렌더 후 병목이 확인된 부분만 깊게 수정하는 편이 안전하다.
```
