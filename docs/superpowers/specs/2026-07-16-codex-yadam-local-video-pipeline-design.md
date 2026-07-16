# Codex CLI 기반 야담 로컬 자동 영상 파이프라인 설계

- 작성일: 2026-07-16
- 상태: 사용자 방향 승인 완료, 독립 검토 P0 반영 완료
- 대상 작업공간: C:\Users\petbl\auto-video
- 대상 콘텐츠: 기존 꿀잠성경 유지 + 신규 야담 프로필

## 1. 목적

이 설계의 목적은 module 폴더에 있는 야담 작법 자료의 유효한 창작 규칙을 활용하되, Sonnet·Opus·Grok·Google Flow·Claude 전용 경로와 대화 턴에 묶인 부분을 제거하고 현재 Windows 로컬 PC에서 실제로 동작하는 자동 제작 파이프라인으로 재구축하는 것이다.

사용자는 야담 주제나 참고 제목과 목표 시간을 입력하고 두 번만 승인한다. 프로그램은 Codex CLI로 기획·대본·장면 계획·썸네일 카피를 만들고, 로컬 Supertonic으로 음성을 생성하며, 로컬 ComfyUI로 장면·인트로·썸네일 배경 이미지를 생성한다. 마지막으로 FFmpeg가 이미지 모션, 음성, 자막과 세그먼트를 조립해 최종 MP4, SRT, 썸네일 PNG와 품질 보고서를 만든다.

이 작업은 기존 꿀잠성경 파이프라인을 야담으로 교체하지 않는다. 공통 실행 기반 위에 gguljam-bible과 yadam을 독립 프로필로 둔다.

## 2. 확정된 사용자 요구사항

1. 기존 꿀잠성경 파이프라인과 결과 규칙을 유지한다.
2. 야담은 별도 yadam 콘텐츠 프로필로 추가한다.
3. 대본 생성의 의미 판단과 창작은 Codex CLI를 사용한다.
4. TTS는 현재 연결된 로컬 Supertonic을 사용한다.
5. 장면·인트로·썸네일 배경은 현재 연결된 로컬 ComfyUI를 사용한다.
6. 인트로는 AI I2V가 아니라 ComfyUI 정지 이미지와 FFmpeg 모션으로 만든다.
7. 최종 영상은 기존 FFmpeg 조립 기반을 일반화해 생성한다.
8. 목표 시간은 10분부터 120분까지 10분 단위로 사용자가 직접 선택한다.
9. 최종 영상은 목표 시간과 정확히 같을 필요가 없으며 80퍼센트부터 120퍼센트까지 허용한다.
10. 사용자 승인 관문은 두 개다.
11. 승인 1에서는 제목·주제·인트로 초안·줄거리·반전 구성을 확인한다.
12. 승인 2에서는 완성 대본, 캐릭터 정본, 썸네일 카피·시안, 대표 이미지 3장을 확인한다.
13. 승인 2 이후 전체 TTS·이미지·영상은 자동으로 생성한다.
    - 예외: 전체 TTS 실측 뒤 duration repair가 승인된 대본 hash를 바꾸면 같은 승인 2의 새 revision을 다시 받아야 한다.
14. 중단 후 재개할 수 있고 완료된 고비용 산출물을 불필요하게 다시 생성하지 않는다.
15. module 원본 문서는 수정하지 않고 레거시 참고자료로 유지한다.

## 3. 비목표

초기 버전에서 다음은 범위에 포함하지 않는다.

- AI I2V 영상 모델 연결
- 대사 립싱크 영상
- 이미지 모델을 이용한 한글 썸네일 글자 생성
- CapCut을 최종 자동 렌더 엔진으로 사용하는 기능
- 클라우드 이미지·TTS 공급자
- 여러 ComfyUI 작업의 병렬 GPU 실행
- 기존 꿀잠성경의 화풍·대본 규칙 전면 개편
- module 원문을 자동 수정하거나 삭제하는 작업

CapCut 호환 manifest나 편집용 파일은 선택 산출물로 남길 수 있으나 자동 제작의 정본은 FFmpeg 결과다.

## 4. 현재 환경에서 확인한 사실

### 4.1 작업공간

- C:\Users\petbl\auto-video는 현재 Git 저장소가 아니다.
- Node.js 22.16.0, npm 10.9.2, Python 3.13.3, Git 2.49.0이 확인됐다.
- 기존 코드는 외부 패키지 의존이 적은 Node.js ES module과 일부 Python 검증기로 구성돼 있다.
- 기존 자동 제작 결과는 exports 아래 작업별 폴더에 저장된다.

### 4.2 Codex CLI

- PATH의 WindowsApps codex.exe는 외부 셸에서 Access is denied가 발생한다.
- 현재 실행 가능한 경로는 C:\Users\petbl\AppData\Local\OpenAI\Codex\bin\a7c12ebff69fb123\codex.exe다.
- 확인된 버전은 codex-cli 0.144.0-alpha.4다.
- ChatGPT 로그인 상태가 확인됐다.
- 현재 로컬 Codex 설정은 model `gpt-5.6-sol`, reasoning effort `ultra`다. yadam은 이 두 값을 profile revision에 고정하고 CLI argument로 명시해 사용자 전역 설정 변경에 따라 결과가 조용히 바뀌지 않게 한다.
- `C:/Users/petbl/.codex/AGENTS.override.md`, `C:/Users/petbl/.codex/AGENTS.md`, 작업공간 루트의 `AGENTS.override.md`, `AGENTS.md`, `.codex/config.toml`은 현재 모두 없다. 다만 이 부재도 런타임 가정으로 남기지 않고 매 호출 전 검사한다.
- 비대화형 codex exec, JSONL 출력, 최종 메시지 파일, JSON output schema, 이미지 입력, resume와 ephemeral 실행을 지원한다.
- image_generation 기능은 활성화돼 있지만 이 설계의 실제 이미지 렌더러는 ComfyUI다.
- 아주 작은 비대화형 호출도 약 1만6천 입력 토큰의 기본 컨텍스트를 사용하므로 장면마다 Codex를 호출하지 않고 단계·세그먼트 단위로 묶어야 한다.
- 작업공간이 Git 저장소가 아니므로 초기에는 명시적으로 skip-git-repo-check를 사용한다.

### 4.3 Supertonic

- 실제 HTTP 주소는 http://127.0.0.1:3093이다.
- HTTP health와 POST /api/tts가 구현돼 있다.
- HTTP를 사용할 수 없으면 로컬 Python CLI로 fallback할 수 있다.
- 로컬 홈은 C:/Users/petbl/supertonic3-local-tts-20260517-r4/supertonic3-local-tts다.
- 현재 모델은 supertonic-3, 언어는 ko, 음성은 M1이다.
- 현재 기본 속도는 1.04, 숫자 민감 속도 0.98, 성경 낭독 속도 0.96이다.
- 출력은 장면별 WAV이며 ffprobe로 실제 길이를 측정할 수 있다.
- 현재 auto-video 진입점은 sibling hermes-studio의 내부 모듈을 상대경로로 직접 import한다.
- 현재 구현에는 장면별 내구성 있는 체크포인트, idempotency, resume와 제한 재시도가 없다.

### 4.4 ComfyUI

- 실제 API 주소는 http://127.0.0.1:8188이다.
- portable root는 C:/Users/petbl/ComfyUI_windows_portable이다.
- 시작 스크립트는 run_nvidia_gpu.bat다.
- 현재 Flux workflow는 hermes-studio/hermes-local/assets/flux_lineart_t2i_fluxencode.json이다.
- 현재 모델 구성에는 flux1-dev-Q4_K_S.gguf, T5 GGUF, clip_l.safetensors, ae.safetensors와 lineart LoRA가 포함된다.
- 실제 GPU는 NVIDIA GeForce RTX 4060 Laptop 8GB이고 ComfyUI 0.24.0이 실행 중이다.
- portable root 안에는 Flux GGUF만 있지만 `extra_model_paths.yaml`을 통해 `sd_xl_base_1.0.safetensors`도 노출된다. canonical 사본은 `C:/Users/petbl/hermes-studio/hermes-local/models/checkpoints/sd_xl_base_1.0.safetensors`, 크기 6,938,078,334 bytes, SHA-256 `31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b`다.
- 현재 CLIP Vision, SDXL IP-Adapter model과 IP-Adapter custom node는 설치되어 있지 않다.
- 현재 object_info에서 SDXL core node와 Flux에 필요한 UnetLoaderGGUF, DualCLIPLoaderGGUF, VAEEncode, VAEDecode, LoadImage와 KSampler는 사용할 수 있다.
- 현재 `extra_model_paths.yaml`은 같은 루트를 checkpoints와 loras로 동시에 노출해 LoRA가 checkpoint 목록에 보이는 오염이 있다. 구현 전 두 mapping을 실제 하위 디렉터리로 분리하고 exact filename·size·hash allowlist로 검증한다.
- /prompt 제출, /history polling, /view 다운로드와 /free 메모리 해제가 구현돼 있다.
- 현재 auto-video의 직접 진입점은 샘플 keyframe 생성용이며 전체 야담 작업용 범용 이미지 서비스가 아니다.
- 현재 continuity_refs는 실질적인 reference conditioning으로 전달되지 않는다.
- IP-Adapter workflow 파일은 있으나 현재 provider 호출 경로에 연결되지 않았다.
- 기존 썸네일 프로토타입은 호출되지 않으며 소스 오류 가능성이 있다.

### 4.5 FFmpeg 조립

- 기존 assembler는 Hermes sceneplan, keyframe manifest와 장면별 WAV를 읽어 Ken Burns 영상, 자막과 세그먼트 MP4를 생성할 수 있다.
- concat_segments.mjs는 세그먼트의 코덱·해상도·FPS·픽셀 포맷을 확인하고 최종 MP4와 통합 SRT를 만들 수 있다.
- 실제 10분 최종 영상 성공 결과가 존재한다.
- 현재 일부 실행 흐름에는 사용자가 HERMES_JOB_DIR를 직접 채워야 하는 수동 단계가 남아 있다.
- 파일이 존재하거나 프로세스가 성공해도 qualityOk:false인 실제 사례가 있다.
- 누락 keyframe을 slate나 첫 이미지로 대체해 최종 QA가 실패한 사례가 있다.

## 5. 레거시 module 감사 결론

module 폴더는 실행 가능한 생성기가 아니라 작법 규칙, 프롬프트, 양식과 Markdown 속 코드 조각을 모은 규칙 팩이다. 총 13개 파일은 대본, 본편 이미지 프롬프트, 썸네일 프롬프트와 인트로 이미지·영상 프롬프트를 설명하지만 실제 PNG나 MP4를 만들지 않는다.

두 name_bank.md는 SHA-256 DECC9B0BA9170070AEA3AE8F86A565CE26689388F643C3CF086FABDC54044550으로 byte-identical하다. 새 시스템은 하나만 canonical 원본으로 사용하고 drift 검사를 둔다.

### 5.1 전체 13개 파일별 판정

| 파일 | 실제 역할 | 보존할 내용 | 로컬 프로그램용 변환·주의점 |
|---|---|---|---|
| `module/시스템프롬프트_Sonnet.txt` | 전체 작업 순서와 대화형 역할 지시 | 기획→집필→검수→시각화의 단계 경계, 승인 개념 | Sonnet·Claude 기억과 대화 턴 의존을 제거하고 orchestrator state·JSON Schema·Codex stage runner로 변환 |
| `module/prompt_v5.2_sonnet.md` | 본편 장면 이미지 prompt 규칙 | 원문 근거, 인물·장소·시대·복식·headcount와 spoiler 제어 | Flow·Nano Banana prompt 출력이 아니라 compiled image request와 ComfyUI job으로 변환; G25·금지어·word-count 모순 수정 |
| `module/썸네일 프롬프트 (opus) 260601.md` | 제목 카피와 배경 prompt 기획 | 카피 4안, 스포일러 봉인, 얼굴·텍스트 구도 | Opus·photorealistic 고정을 제거하고 yadam 공통 만화 화풍, 무문자 SDXL 배경과 deterministic Korean compositor로 분리 |
| `module/name_bank.md` | 신분·성별·용도별 이름·호칭 source | 원본 데이터와 금지·중복 규칙 | nested 사본과 byte-identical이므로 canonical 한 개만 normalize; Markdown bullet도 빠짐없이 stable ID data로 빌드 |
| `module/대본 sonnet/v11.3_main_SONNET.md` | 장편 대본 메인 workflow | 후보 수, 승인, 반전·감정 포인트, 15비트, 복선·피날레·엔딩 | 1·1.5·2시간 고정표와 불가능한 균등 분량을 폐기하고 10~120분·10분 logical segment·실측 TTS 계약으로 교체 |
| `module/대본 sonnet/scripts.md` | Markdown 안 validator·name picker code | 검사 범주와 실패 evidence 개념 | placeholder pass, capped list, quote·age·ending·noblewoman 버그가 있어 코드를 복사하지 않고 실제 Node validator와 회귀 테스트로 재작성 |
| `module/대본 sonnet/부록_양식.md` | story facts·progress·thumbnail brief 등 handoff 양식 | 사람이 읽는 review bundle의 정보 구조 | Markdown을 정본으로 쓰지 않고 story-bible, approval, artifact와 render JSON에서 view로 렌더링 |
| `module/대본 sonnet/참고_비트구조_체크리스트_slim.md` | 15비트와 구조 QA | 비트 기능, 복선·회수·피날레 evidence | 권장 비율을 satisfiable allocator 입력으로 바꾸고 scene ID evidence hard gate 추가 |
| `module/대본 sonnet/참고_인트로_제목_가이드_slim.md` | 제목 변형과 6문장 hook | preserve·mutate title slots, 6문장 200~350자 intro, spoiler seal | 2시간 intro 460자 충돌을 제거하고 모든 길이에 동일한 승인 가능한 intro contract 사용 |
| `module/대본 sonnet/참고_장르별_요소풀_slim.md` | 장르별 motif·사건 seed | 장르 다양성, seed pool | 문자열 즉흥 조합이 아니라 stable motif ID, deterministic seed와 최근 20작업 중복 회피로 변환 |
| `module/대본 sonnet/참고_캐릭터_말투_문체_slim.md` | 신분·성별별 말투·문체 규칙 | 호칭, 존대, 서술 톤, 인물별 speech profile | appearance·wardrobe·speech를 story-bible character/variant 정본에 함께 보존하고 대본·TTS·이미지가 같은 ID를 참조 |
| `module/대본 sonnet/name_bank.md` | root name bank의 중복 사본 | 별도 보존 내용 없음 | canonical root와 SHA-256 drift test만 하고 runtime source로 중복 로드하지 않음 |
| `module/대본 sonnet/motif_bank.md` | 야담 motif source | motif category, 주제·사건 seed | stable motif ID와 history fingerprint를 부여하고 제목·반전 category 중복 억제에 사용 |

이 표의 보존은 원문 문구를 무조건 prompt에 붙인다는 뜻이 아니다. 규칙은 테스트 가능한 데이터·schema·validator로 옮기고, 모델명·웹서비스·가상 경로·깨진 code block은 실행 계약에서 제외한다.

### 5.2 구현 전 바로잡아야 하는 P0 문제

1. 비트 분량과 균등 챕터 분량을 동시에 만족할 수 없다.
   - 1시간 챕터 1 비트 최대 2400자는 챕터 최소 3750자보다 작다.
   - 1.5시간 챕터 1 비트 최대 3360자는 챕터 최소 3750자보다 작다.
   - 1.5시간 마지막 챕터 비트 최소 6440자는 챕터 최대 6250자보다 크다.
   - 2시간 챕터 2·3 최소 합 8820자는 담당 비트 최대 합 8280자보다 크다.
   - 2시간 마지막 챕터 비트 최소 6555자는 챕터 최대 약 5878자보다 크다.
2. 호칭·장소·한자어 비율 검증 함수는 placeholder로 항상 통과한다.
3. 위반 목록을 5개로 자른 뒤 허용치를 5개로 검사해 실제 위반이 많아도 통과하는 게이트가 있다.
4. 긴 나레이션 위반을 최대 한 건만 반환하고 허용치 3으로 감싸 사실상 항상 통과한다.
5. ASCII 큰따옴표와 스마트 따옴표의 대사 판정이 함수마다 다르다.
6. 스물다섯 살을 20으로 인식하는 등 한국어 나이 파서가 불완전하다.
7. 최종 고정 엔딩 3문장 중 첫 문장만 검사한다.
8. 복선 회수, 피날레 5단계, strict 에피소드 등 문서상 필수 규칙 상당수가 실제 검사에 없다.
9. 캐릭터 외모·복장·말투가 대본→본편 이미지 request→썸네일·인트로 visual request handoff에 안정적으로 보존되지 않아 후속 시각물의 동일 인물을 유지할 수 없다.
10. 사대부 여성 후보 줄을 모두 건너뛰는 이름 추출기 결함이 있다.
11. 2시간 인트로 460자 배정과 200~350자 고정 규칙이 충돌한다.
12. 이미지 prompt 검증의 low-tied 금지어 충돌, 15~65와 15~75 단어 범위 충돌, 미완성 G25 검사가 있다.
13. 썸네일의 reference style 고정과 photorealistic 고정 문구가 충돌한다.
14. 인트로의 webtoon 고정과 썸네일의 photorealistic 고정이 충돌한다.

## 6. 레거시 규칙 처리 원칙

### 6.1 보존

- 단계별 사용자 승인
- 모티프 기반 기획
- 15비트 전체 구조
- 반전 6개와 카테고리 분산
- 감정 포인트 6개
- 주제 문장 배치와 회수
- 복선·소품·관계의 선행 정본
- 인물 신분에 맞는 말투·호칭
- 한 번에 한 장편 전체가 아닌 구간별 집필·재개
- 제목 행동은 보여주되 동기·정체·결과를 숨기는 인트로
- 썸네일 스포일러 봉인
- 이미지 장면과 대본 원문 구간의 연결
- 장르별 구성 요소 풀

### 6.2 변환

| 레거시 방식 | 새 방식 |
|---|---|
| Sonnet·Opus가 대화 턴을 기억 | 프로그램 상태 머신 |
| 한 거대 Markdown 프롬프트 | 단계별 Codex prompt pack |
| Markdown 표가 정본 | JSON Schema가 정본 |
| progress.md | pipeline-state.json |
| story_facts.md | story-bible.json에서 렌더링 |
| thumbnail_brief.md | thumbnail-plan.json에서 렌더링 |
| Claude 메모리 | history store와 안정 ID |
| inline name_picker.py | 테스트 가능한 이름 서비스 |
| scripts.md 코드 블록 | 실제 Node validator 모듈 |
| Flow prompt TXT | ComfyUI image asset job |
| Grok image·I2V prompt | ComfyUI still + FFmpeg motion |
| present_files | artifact-manifest.json |
| 고정 1·1.5·2시간 | 10~120분 10분 단위 |
| 균등 챕터 글자 수 | 담당 비트 비율 기반 권장 분량 |
| 예상 타임라인 | Supertonic 실측 WAV 기반 타임라인 |

### 6.3 폐기

- /home/claude, /mnt/project, /mnt/user-data/outputs 경로
- present_files와 Claude Project 등록 지시
- Sonnet·Opus·Grok 모델명을 실행 정책으로 사용하는 규칙
- 다음 턴, 계속 입력, 첫 작업과 같은 모델 대화 상태
- 길이를 임의로 1.5시간으로 선택하는 fallback
- 수학적으로 모순된 균등 챕터 게이트
- placeholder인데 hard gate로 표시된 검사
- 무제한 자동 재실행
- 이미지 누락을 숨기는 release fallback
- 최종 이미지의 한글 카피를 이미지 모델에 맡기는 방식
- scene_design.txt 복원

## 7. 선택한 아키텍처

선택한 방식은 프로필 기반 통합 오케스트레이터다.

    사용자 입력·승인
             |
             v
    Pipeline Orchestrator
       |-- Profile Registry
       |-- Codex CLI Runner
       |-- Script Planning and Quality
       |-- Supertonic Adapter
       |-- Image Generation Service
       |     \-- ComfyUI Adapter
       |-- Thumbnail Compositor
       |-- FFmpeg Assembler
       |-- Quality Gate Service
       \-- Artifact and Run State Store

오케스트레이터가 상태, 파일, 재시도, 승인, 무효화와 최종 성공 여부를 소유한다. 생성기는 입력 계약에 따라 결과만 반환한다. Codex가 Supertonic·ComfyUI·FFmpeg를 직접 제어하거나 production 파일을 자유롭게 수정하지 않는다.

초기 전환에서는 기존 Hermes 형식으로 변환하는 compatibility adapter와 기존 FFmpeg 조립기를 재사용한다. 단, yadam 색상을 보존하기 위해 기존 assembler에 기본값이 꺼진 `--preserve-color` 옵션을 추가하고 yadam에서만 사용한다. 기존 gguljam-bible은 이 옵션을 사용하지 않아 흑백 동작이 바뀌지 않는다. 이후 assembler가 엔진 중립 render-manifest.json을 직접 읽도록 일반화한다.

Compatibility adapter는 정본을 새로 정의하는 변환 경계다. production 정본은 `render-manifest.json`이고 Hermes 파일은 기존 조립기 입력을 위한 파생 산출물이다. 따라서 기존 positional join의 약점을 production 데이터 모델로 승계하지 않는다.

## 8. 프로필

### 8.1 gguljam-bible

기존 흑백 성경·심리 콘텐츠 규칙, 화풍, 음성 속도, 자막, 이미지 cadence와 품질 게이트를 현재 동작과 동일하게 보존한다. 공통 기반으로 이동할 때 snapshot과 실제 fixture 회귀 검사를 통과해야 한다.

야담 규칙이나 조선시대 캐릭터·복식 규칙을 이 프로필에 섞지 않는다.

### 8.2 yadam

다음을 별도 설정으로 소유한다.

- 대본 prompt pack 버전
- motif와 name source
- 15비트·반전·말투·인트로 규칙
- 목표 시간 10~120분
- duration tolerance 0.20
- logical segment 10분
- Supertonic voice, model, speed와 silence
- ComfyUI workflow, model, LoRA와 참조 conditioning
- 장면·인트로·썸네일 dimensions
- 인트로와 본문의 이미지 cadence
- 자막 preset
- 영상 FPS·코덱·motion preset
- hard gate와 warning 기준

프로필의 canonical 경로는 config/profiles/gguljam-bible.json과 config/profiles/yadam.json이다. 환경별 실행 파일·서버 주소·로컬 모델 경로는 콘텐츠 프로필과 분리된 host configuration에서 관리한다.

초기 yadam 시각 프로필은 `yadam-color-manhwa-v1`로 고정한다.

- 화풍: 컬러 조선시대 역사 만화·동화책 삽화, 또렷한 잉크 윤곽, 절제된 회화적 채색, 따뜻한 영화 조명, 2D semi-realistic illustration
- 금지: photorealistic photo, 3D render, stick figure, monochrome-only, 현대 물품, 이미지 안 한글·영문·숫자, watermark
- 장면·인트로·썸네일 배경 엔진: SDXL Base 1.0 + IP-Adapter Plus Face SDXL ViT-H
- checkpoint: `sd_xl_base_1.0.safetensors`, 위에서 고정한 canonical SHA-256만 허용
- reference encoder: `C:/Users/petbl/ComfyUI_windows_portable/ComfyUI/models/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors`, source `h94/IP-Adapter/models/image_encoder/model.safetensors`, 2,528,373,448 bytes, SHA-256 `6ca9667da1ca9e0b0f75e46bb030f7e011f44f86cbfb8d5a36590fcd7507b030`
- IP-Adapter: `C:/Users/petbl/ComfyUI_windows_portable/ComfyUI/models/ipadapter/ip-adapter-plus-face_sdxl_vit-h.safetensors`, source `h94/IP-Adapter/sdxl_models/ip-adapter-plus-face_sdxl_vit-h.safetensors`, 847,517,512 bytes, SHA-256 `677ad8860204f7d0bfba12d29e6c31ded9beefdf3e4bbd102518357d31a292c1`
- custom node target: `C:/Users/petbl/ComfyUI_windows_portable/ComfyUI/custom_nodes/comfyui-ipadapter`, source `https://github.com/comfyorg/comfyui-ipadapter`, candidate commit `b188a6cb39b512a9c6da7235b880af42c78ccd0d`; 현재 ComfyUI 0.24.0과 5장 GPU smoke 뒤 lockfile에 확정
- sampler: `dpmpp_2m`, scheduler `karras`, CFG 6.0
- reference portrait: 28 steps, scene·intro·thumbnail: 24 steps
- LoRA: yadam v1에서는 사용하지 않음. 기존 lineart·stickman LoRA는 gguljam-bible 자산으로만 유지
- reference T2I workflow: `assets/workflows/yadam_sdxl_reference_v1.json`
- conditioned workflow: `assets/workflows/yadam_sdxl_ipadapter_v1.json`
- reference method: `LoadImage -> IPAdapterUnifiedLoader -> IPAdapter`, preset exact enum `PLUS FACE (portraits)`, initial weight 0.80, start 0.00, end 0.85
- scene·intro ComfyUI raster: 1024×576, 최종 영상에서 1920×1080으로 고품질 확대
- 캐릭터 reference portrait: 768×1024
- thumbnail background raster와 최종 compositor canvas: 1280×720

두 workflow는 구현 단계에서 새로 repo 안에 만들고 LoRA node를 넣지 않는다. 기존 `sdxl_ipadapter_t2i.json`은 구조 참고만 하며 그대로 사용하지 않는다. 필수 custom node·CLIP Vision·IP-Adapter model은 현재 없으므로 설치·hash 고정·workflow 5장 smoke가 Phase 4의 P0 선행조건이다. 이를 통과하기 전에는 yadam production-ready를 표시하지 않는다. FaceID와 InsightFace는 v1에서 사용하지 않는다.

이미지 cadence는 다음으로 고정한다.

- 첫 60초: 평균 6초, 각 slot 5~7초
- 이후 본문: 목표 30초, 각 slot 20~40초
- 마지막 남은 구간은 최소 slot보다 짧아도 직전 slot의 의도적 hold로 병합 가능
- 10분 기본 예상 slot: 28개
- 120분 hard maximum: 260개
- 계산값이 260을 넘으면 이미지를 순환 재사용하지 않고 인접한 낮은 변화 구간을 계획 단계에서 합친다.

`no release fallback`, strict visual QA와 새 경로 계약은 초기에는 yadam에만 적용한다. gguljam-bible의 기존 fallback·QA 동작은 별도 회귀 개선 작업 전까지 그대로 유지한다.

## 9. 사용자 입력과 승인

### 9.1 시작 입력

- profileId: yadam
- inputMode: reference 또는 genre
- source: reference면 `{kind:"reference_title",value}`, genre면 `{kind:"genre",value}`
- targetMinutes: 10, 20, 30 ... 120
- optionalInstructions
- 선택적 스타일·인물 참고 이미지

프로그램은 10 미만, 120 초과 또는 10의 배수가 아닌 시간을 모델 호출 전에 거부한다.

### 9.2 승인 1

후보 선택과 공식 승인을 분리한다. 후보 선택은 승인 횟수에 포함하지 않는 provisional selection이다.

먼저 Codex가 다음을 생성한다.

- reference mode: 제목 변형 4안
- genre mode: 주제 3안
- 추천안과 이유

사용자가 후보를 임시 선택하면 `concept-selection.json`을 기록한다. 선택된 후보에 대해서만 다음 승인 bundle을 생성한다.

- 6문장 200~350자 story intro 초안
- 주요 인물·관계 초안
- 반전 6개
- 감정 포인트 6개
- 전체 줄거리와 canonical 15-beat outline
- spoiler seal

사용자는 전체 bundle을 확인한 뒤 `approval-1-rNNN.json`으로 공식 승인하거나 수정 요청을 보낸다. 후보를 다시 고르면 bundle을 재생성하고 아직 승인 횟수는 증가하지 않는다. 승인 전에는 장편 집필, TTS와 전체 이미지 렌더를 하지 않는다.

상태 전이는 `GENERATING_CONCEPT_OPTIONS -> AWAITING_CONCEPT_SELECTION -> GENERATING_APPROVAL_1_BUNDLE -> AWAITING_APPROVAL_1 -> APPROVAL_1_COMPLETED`다. 승인 후 후보·인트로·반전·줄거리 중 하나가 바뀌면 승인 1을 무효화하고 같은 관문으로 돌아간다.

### 9.3 승인 2

승인 2도 카피 선택과 공식 승인을 분리한다. 먼저 다음 option bundle을 만든다.

- 최종 제목
- final.txt
- 세그먼트별 목표·예상 분량 표
- story-bible 요약
- 대본 QA 결과
- 썸네일 카피 4안
- 인트로, 본문, 클라이맥스 대표 이미지 각 1장
- canonical character reference set

사용자가 카피 한 개를 provisional selection으로 고르면 `thumbnail-copy-selection.json`을 기록하고, 선택 카피와 layout으로 텍스트가 합성된 썸네일 시안을 만든다. 그 뒤 완성 대본·캐릭터 reference·스타일·대표 이미지·썸네일 시안을 한 bundle로 공식 승인한다.

상태 전이는 `GENERATING_APPROVAL_2_OPTIONS -> AWAITING_THUMBNAIL_COPY_SELECTION -> COMPOSING_APPROVAL_2_BUNDLE -> AWAITING_APPROVAL_2 -> APPROVAL_2_COMPLETED`다. 다른 카피를 선택하면 같은 배경을 재사용할 수 있는 경우 compositor만 다시 실행한다. layout이 바뀌어 보호영역과 충돌하면 배경을 다시 생성한 뒤 같은 승인 2 화면으로 돌아온다.

승인 2에는 다음 hash가 모두 들어가야 한다.

- finalTextHash
- scriptScenesHash, scriptScenesSchemaVersion과 scriptScenesSchemaHash
- scenePlanHash, scenePlanSchemaVersion과 scenePlanSchemaHash
- storyBibleHash
- scriptQaHash
- immutable current passed scriptCoverageHash, scriptCoveragePath와 scriptCoverageRevision
- selectedThumbnailCopyHash
- thumbnailPreviewHash
- thumbnailGuideHash
- characterReferenceSetHash
- representativePreviewSetHash
- styleProfileHash

승인 후 production 단계가 자동 실행된다. 다만 전체 TTS 실측이 80~120% 밖이라 대본을 한 번 보정하면 기존 승인 2를 자동 무효화하고 같은 승인 2의 새 revision을 다시 요청한다. 사용자가 보지 않은 대본 변경으로 이미지·영상을 계속 생성하지 않는다.

### 9.4 초기 조작 화면

현재 auto-video가 script 중심 프로젝트이므로 초기 control surface는 Node CLI와 재사용 가능한 orchestrator library로 고정한다. 새 GUI 프레임워크를 초기 범위에 추가하지 않는다.

필수 사용자 명령은 다음 역할을 제공한다.

- new: 작업 생성과 시작 입력 저장
- status: 현재 단계, 진행률, 실패와 다음 행동 표시
- select-concept: 후보 provisional selection 저장
- approve-concept: 승인 1 선택·수정 저장
- select-thumbnail-copy: 썸네일 카피 provisional selection 저장
- approve-production: 현재 approval-2 bundle의 공식 승인 revision 저장
- resume: 완료 artifact를 검증하고 중단 지점부터 재개
- cancel: 새 작업 제출 중지와 안전 종료

승인 화면에 해당하는 Markdown·JSON·이미지 review bundle을 작업 폴더에 생성한다. 향후 기존 외부 UI가 연결될 때는 CLI를 호출하는 대신 동일 orchestrator library와 JSON 계약을 사용한다.

## 10. 작업 디렉터리

아래 트리는 최종 job의 주요 정본과 동적 디렉터리를 보여 주는 eventual-layout 개요이며 모든 content-addressed 파일을 열거하는 경로 API가 아니다. Plan 01은 공통 parent만 만들고 `script/coverage`, `assets/character-references`, image/video quarantine 같은 stage-owned child는 각 생산 계획이 containment 검사 뒤 생성한다. 실제 소비자는 이 그림에서 경로를 추측하지 않고 artifact registry의 exact role/path와 Plans 01~06의 producer 계약을 사용한다.

    exports/<job-id>/
      request.json
      pipeline-state.json
      artifact-manifest.json
      render-plan-input.json
      render-plan.json
      render-manifest.json
      segment-manifest.json
      approvals/
        concept-selection.json
        approval-1-bundle.json
        approval-1-r001.json
        approval-1-r002.json
        current-approval-1.json
        thumbnail-copy-selection.json
        approval-2-bundle.json
        approval-2-r001.json
        approval-2-r002.json
        current-approval-2.json
      reviews/
        <gate>-rNNN.md
        <gate>-rNNN.json
        outcomes/
      planning/
        concept-inputs.json
        concept-options.json
        hook-brief.json
        story-bible.json
        outline.json
        script-plan.json
        scene-plan.json
        thumbnail-plan.json
      script/
        chapters/
          segment-XX.json
        coverage/
          script-rNNN.json
          audio-rNNN.json
          subtitle-rNNN.json
          visual-rNNN.json
        script-scenes.json
        final.txt
        qa-report.json
        coverage-report.json
        duration-repair-report.json
      assets/
        character-references/
        compiled-image-requests/
        images/
          checkpoints/
          qa/
        audio/
          raw/
          normalized/
          requests/
          checkpoints/
          reviews/
        asset-manifest.json
        visual-qa-report.json
      previews/
        style-profile.json
        thumbnail-preview.png
        thumbnail-reserved-guide.png
        preview-manifest.json
      thumbnail/
        background.png
        final.png
        qa.json
      segments/
        segment-XX/
          visual-timeline.json
          manual-assembly/
            final.mp4
            subtitles.srt
            narration.wav
            assembly-report.json
            segment-qa-report.json
            motion-clips/
      final/
        final-full.mp4
        concat-list.txt
        concat-report.json
        upload-subtitles/
          final-full.upload.srt
        thumbnail.png
        final-qa-report.json
      compat/
        hermes/
          segment-XX/
            sceneplan.json
            voice/
            keyframes/
              manifest.json
      logs/
      quarantine/
        locks/

모든 정본 JSON과 manifest는 UTF-8 NFC로 저장한다. 파일은 같은 폴더의 임시 파일에 기록하고 검증 후 atomic rename한다.

Compatibility 기간에는 위 `manual-assembly`와 최종 합본 경로가 기존 공식 handoff 계약이다. 새 `segments/<segmentId>/final.mp4` 경로를 동시에 도입하지 않는다. 자막이 영상에 burn-in되므로 재생 폴더인 `final/` 루트에는 sidecar SRT를 두지 않고 업로드용 SRT를 `final/upload-subtitles/`에 격리한다. `artifact-manifest.json`의 logical role이 실제 경로를 가리키므로 호출자는 파일명을 추측하지 않는다.

## 11. 공통 ID와 데이터 모델

### 11.1 ID

- jobId: 전체 작업
- segmentId: 10분 논리 집필·제작 단위
- characterId: 동일 인물
- characterVariantId: 신분·시점·의상 변화
- sceneId: 의미상 대본·음성 장면
- visualSlotId: 실제 이미지 유지 구간
- subtitleCueId: 장면 안 자막 구간
- assetId: 이미지·WAV·썸네일 등 파일 자산

sceneId는 대본과 TTS의 안정 join key이며 한 sceneId는 하나의 WAV를 기본으로 한다. visual slot은 segment 전체 실측 timeline의 이미지 구간이다. 인트로에서는 한 audio scene을 여러 visual slots가 나눌 수 있고, 본문에서는 한 visual slot이 연속된 여러 audio scenes를 덮을 수 있다. 각 slot은 `sourceSceneIds` 배열, grounding 대표인 `primarySceneId`, 해당 source hashes를 가진다. sourceSceneIds는 audio order상 연속이고 slot 시간과 실제로 겹쳐야 한다. audio scene 수와 visual slot 수는 같을 필요가 없으며 서로의 배열 index를 정본 join key로 사용하지 않는다.

### 11.2 request.json

필수 필드:

- schemaVersion
- jobId
- profileId
- inputMode
- source input
- targetMinutes
- durationTolerance: 0.20
- approvalMode: two-stage
- seed
- createdAt

### 11.3 story-bible.json

필수 영역:

- title, genre, theme
- characters와 variants
- relationships
- speech profiles와 address terms
- timeline
- locations
- props와 ownership
- foreshadowing
- twists
- spoiler seals
- evidence/proof props
- visual asset references

기존 story_facts.md는 이 JSON에서 사람이 읽을 수 있게 렌더링한다.

### 11.4 script-plan.json

- targetMinutes와 accepted duration range
- 15 beat definitions
- logical segments
- beat-to-segment assignment
- segment character target guidance
- intro policy
- ending policy
- unresolved thread plan

character target은 권장치다. hard duration 판정은 TTS 이후 실제 오디오 전체 길이에 적용한다.

### 11.5 script-scenes.json과 canonical text

기계 정본은 `script/script-scenes.json`이다. 각 scene은 `sceneId`, `segmentId`, 1부터 연속하는 `ordinal`, `sourceText`, `ttsRequired`, `subtitleRequired`를 가진다. `final.txt`는 이 배열에서 다음 규칙으로 결정론적으로 렌더링한 사람용 view다.

1. 모든 문자열 Unicode NFC
2. CRLF와 CR을 LF로 변환
3. 각 줄 끝 space와 tab 제거
4. BOM 금지
5. scene 사이 정확히 LF 두 개
6. 파일 끝 정확히 LF 한 개
7. 따옴표·문장부호와 그 밖의 공백은 바꾸지 않음
8. strict UTF-8 encoding

해시는 서로 혼용하지 않는다.

- finalTextHash: canonical final.txt 전체 UTF-8 bytes SHA-256
- sceneSourceHash: canonical sourceText UTF-8 bytes SHA-256
- segmentSourceHash: 세그먼트 scene들을 같은 규칙으로 렌더링한 bytes SHA-256
- ttsNormalizedHash: TTS 발음용 정규화 텍스트의 별도 SHA-256

source span은 canonical `final.txt`의 UTF-8 byte 반개구간 `[startByte, endByteExclusive)`로 고정한다. 진단용 startLine과 endLine도 기록한다. byte offset은 UTF-8 code-point 경계여야 하고 해당 byte slice를 strict decode한 값이 scene sourceText 및 sourceHash와 정확히 일치해야 한다. JavaScript UTF-16 index, 글자 수와 Unicode code-point offset을 섞지 않는다.

`coverage-report.json`은 scene ordinal 연속성, span 오름차순, overlap 0, separator를 제외한 orphan byte 0, orphan scene 0을 hard gate로 검사한다. scene을 분할하면 새 ID를 발급하고 삭제된 ID는 재사용하지 않는다.

### 11.6 scene-plan.json

- sceneId와 segmentId
- UTF-8 byte source span과 source hash
- narration
- active characters와 variants
- location, props와 action
- intensity와 narrative role
- prompt-neutral visual description
- spoiler policy
- TTS flags
- visual slot proposal

### 11.7 render-plan.json

TTS와 48 kHz WAV 정규화가 끝난 뒤 생성되는 아직 미해결인 제작 계획이다.

- profile, output dimensions와 FPS
- script path와 hash
- scene별 normalized WAV path, hash, measured duration와 누적 timeline
- plannedDurationSeconds, measuredAudioSeconds와 renderDurationSeconds
- visual slot별 sourceSceneIds·primarySceneId, 계획 start·end·duration, purpose와 compiled request ID
- subtitle cue 계획
- segment boundaries

이 파일에는 아직 생성되지 않은 image path나 image hash를 넣지 않는다.

### 11.8 render-manifest.json

모든 normalized WAV, production image, subtitle cue와 thumbnail artifact가 검증된 뒤 FFmpeg 실행 직전에 atomic publish하는 production 타임라인 정본이다.

- project profile, target, dimensions와 FPS
- script path와 hash
- scene별 source text, WAV path, WAV hash와 measured duration
- visual slot별 start, end, duration, image path와 hash
- subtitle cue별 start, end와 text
- segment boundaries
- intro scene와 visual slot IDs
- thumbnail artifacts
- provider, model, workflow, seed와 attempt metadata

타임라인은 0초부터 연속이며 gap과 overlap이 없어야 한다. final video length와 audio length 차이는 인코딩 오차 범위 안이어야 한다.

render manifest는 path만 가리키지 않고 모든 소비 asset의 SHA-256과 dependency hash를 고정한다. FFmpeg가 시작된 뒤 image·audio·subtitle hash가 하나라도 바뀌면 현재 assembly를 폐기하고 manifest부터 다시 확정한다.

### 11.9 pipeline-state.json

단계 상태는 다음 중 하나다.

- pending
- running
- awaiting_approval
- cancel_requested
- retrying
- completed
- needs_review
- failed
- cancelled

상태의 append-only history는 각 전이에 입력 hash, 필요 시 출력 hash·artifact paths·error를 기록한다. 일반 Codex/provider attempt와 started/completed 시각은 해당 stage event/checkpoint가 소유하며, pipeline-state의 닫힌 `attempt` 필드는 job 전체 1회인 `DURATION_REPAIR_REQUIRED`의 값 `1`에만 사용한다. top-level `durationRepairAttemptsUsed`는 job 생성 시 `0`이고, 그 전이와 같은 원자 쓰기에서만 `1`로 예약되어 취소·재시작으로 예산이 되살아나지 않는다.

### 11.10 승인과 전체 artifact manifest

`concept-selection.json`과 `thumbnail-copy-selection.json`은 provisional selection이며 formal approval이 아니다. append-only `approval-1-rNNN.json`과 `approval-2-rNNN.json`은 선택값, 사용자 수정 지시, 승인 대상 artifact 목록·hash와 승인 시각을 기록한다. `current-approval-1.json`과 `current-approval-2.json`은 현재 유효 revision을 가리키는 atomic pointer다. 승인 후 대상 입력이 변경되면 해당 승인은 자동 무효화된다.

approval의 `approvedArtifactSetHash`는 `{artifactId, sha256}` 배열을 artifactId로 정렬하고 RFC 8785 JSON Canonicalization Scheme으로 직렬화한 NFC UTF-8 bytes의 SHA-256 lowercase hex다. 승인 파일은 덮어쓰지 않으며 새 revision이 `supersedes`로 이전 기록을 가리킨다.

approval-1 artifact set에는 selected concept, intro, character·relationship draft, twists, emotional points, canonical outline와 spoiler seals가 모두 있어야 한다. approval-2 set에는 final text, script-scenes, scene plan, 각 schema version, story bible, script QA, immutable current passed script-coverage revision, selected thumbnail copy, composed thumbnail preview, registered reserved-text guide, canonical reference set, 세 representative previews와 style profile이 모두 있어야 한다. 이후 TTS·자막·이미지 owner가 정상적으로 갱신하는 mutable aggregate `script/coverage-report.json`은 승인 set/dependency에서 제외하고 review metadata로만 표시한다. 누락 대상이 하나라도 있거나 aggregate가 승인 대상으로 잘못 들어가면 승인 파일을 만들지 않는다.

artifact-manifest.json은 정본·호환·preview·production 산출물을 구분하고 각 경로, SHA-256, schema version, producer stage와 gate status를 기록한다. render-manifest.json은 artifact manifest가 가리키는 production 타임라인 정본이다.

## 12. Codex CLI 통합

### 12.1 실행 책임

Codex는 창작 판단과 구조화 결과를 만든다. 오케스트레이터는 다음을 소유한다.

- executable discovery
- auth와 version preflight
- stdin 입력
- timeout과 cancellation
- JSONL event parsing
- output schema
- local schema 재검증
- state와 로그
- 원자적 artifact 저장

### 12.2 실행 기본값

- approval: never
- sandbox: read-only
- model: gpt-5.6-sol
- model reasoning effort: ultra
- user `config.toml`과 user/project execpolicy `.rules` 무시; 기존 auth 저장소는 사용
- 매 attempt마다 새로 만든 전용 빈 stage working directory를 `-C`로 사용하고 `project_root_markers=[]`로 부모 탐색을 차단
- global/stage `AGENTS.override.md`, `AGENTS.md`와 stage `.codex/config.toml`은 `absent-or-profile-pinned` 정책으로 검사
- strict config parsing
- JSONL events 활성화
- output schema 사용
- output-last-message 별도 파일
- 작업공간이 non-Git인 동안 skip-git-repo-check 사용
- production artifact를 직접 쓰지 않는 stateless stage는 ephemeral 우선
- 장편 세그먼트 연속성에 이점이 검증될 때만 resume 사용

stage runner의 기본 argument array는 다음 의미로 고정한다. prompt는 마지막 `-`의 stdin으로 보내고 사용자 입력을 shell 문자열에 결합하지 않는다.

    exec -a never -s read-only
      --model gpt-5.6-sol -c model_reasoning_effort="ultra"
      -C <dedicated-empty-stage-workdir> -c project_root_markers=[]
      --ignore-user-config --ignore-rules --strict-config --json
      --output-schema <stage-schema-absolute-path>
      --output-last-message <job-temp-absolute-path>
      --ephemeral --skip-git-repo-check -

실제 executable은 확인된 desktop bundled 절대경로를 host config에 저장하되 버전·model·reasoning 변경 때 preflight와 parser smoke를 다시 수행하고 profile revision을 올린다. `--ignore-user-config`는 인증 저장소를 지우지 않으면서 user `config.toml`의 model/MCP/behavior 설정을 배제하고, `--ignore-rules`는 user/project execpolicy `.rules`만 건너뛴다. 이 두 flag는 `AGENTS.md`를 무시하지 않으므로 runner는 resolved `CODEX_HOME`과 전용 stage working directory에서 실제로 효력이 있는 `AGENTS.override.md` 또는 `AGENTS.md`를 검사한다. 발견된 instruction/config source가 profile의 path·SHA-256 pin과 정확히 일치하지 않으면 `codex_instruction_source_changed`로 fail-closed하고 Codex를 실행하지 않는다. 빈 pin map인 현재 revision은 해당 파일이 전혀 없어야 통과한다. 전용 directory는 attempt마다 새로 만들고 `.codex/config.toml`도 없어야 하며, `-c project_root_markers=[]`로 상위 workspace의 project config와 instruction 탐색을 막는다. provenance에는 검사한 candidate path, 존재 여부, 허용된 source hash map, workdir와 profile hash를 기록한다. stdout JSONL은 event log, output-last-message는 candidate payload일 뿐이며 local schema·hash gate를 통과한 뒤에만 canonical artifact로 promote한다.

실행 파일 탐색 순서:

1. 명시적 환경 또는 프로그램 설정
2. 현재 Codex desktop bundled 실제 경로
3. Get-Command에서 실행 가능한 경로
4. 공식 별도 CLI 설치 경로

WindowsApps access-denied shim은 성공 후보로 취급하지 않는다.

### 12.3 prompt pack

하나의 거대 prompt를 매 호출마다 넣지 않는다.

    prompts/yadam/
      concept.md
      story-intro.md
      story-bible.md
      outline.md
      segment-draft.md
      segment-repair.md
      final-review.md
      visual-plan.md
      thumbnail-plan.md

각 stage는 필요한 reference subset만 받는다. 장면마다 Codex를 호출하지 않는다.

### 12.4 Codex 결과 수락 조건

1. exit code 0
2. JSONL error 또는 failed event 없음
3. 최종 결과 파일 존재
4. JSON parsing 성공
5. local JSON Schema 성공
6. jobId, stage와 input hash 일치
7. stage hard gate 통과

## 13. 대본 생성

### 13.1 기획

reference mode에서는 제목 구조의 preserve slots와 mutate slots를 분석하고 후보 4개를 만든다. genre mode에서는 motif seed와 장르 풀을 조합해 후보 3개를 만든다.

motif에는 안정 ID를 추가한다. recent history는 최근 20개 작업을 기본 window로 사용하며 이름, motif ID, twist category, theme line과 title fingerprint를 기록한다.

### 13.2 이야기 정본

approval-1 bundle에서 반전 6개, 감정 포인트 6개와 canonical 15-beat outline을 이미 확정한다. 승인 뒤에는 이 outline을 다시 생성하지 않고 story-bible이 인물·관계·시간·소품·복선 사실을 구조화해 보강한다. story-bible 작성 중 outline의 사건 순서·반전·결말 의미가 달라지면 자동 채택하지 않고 approval-1을 무효화한다. 캐릭터 외모·복장·말투·호칭은 final script 이전에 canonical JSON으로 저장한다.

### 13.3 시간과 세그먼트

목표 시간 M분은 M/10개의 논리 세그먼트를 만든다. 전체 15비트를 각 비트의 중요도와 목표 비율에 따라 세그먼트에 배치한다.

균등 챕터 글자 수를 사용하지 않는다.

초기 글자 목표는 profile의 calibratedCharactersPerSecond와 과거 Supertonic 결과를 이용해 추정한다. 이 값은 계획과 경고에 사용하며 최종 hard duration을 대신하지 않는다.

각 logical segment의 `plannedDurationSeconds`는 600이다. `measuredAudioSeconds`는 정규화 WAV 실측 합, yadam `renderDurationSeconds`는 measuredAudioSeconds, `finalDurationSeconds`는 MP4 실측값이다. 600초는 경계를 강제로 자르는 값이 아니며 실측 timeline은 segment별 render duration을 누적해 다시 확정한다. segment 480~720초는 repair 우선순위를 정하는 planning warning이고 독립적인 release hard gate는 아니다. 전체 80~120% 범위는 항상 hard gate다.

### 13.4 세그먼트 집필

Codex는 논리 세그먼트 한 개씩 집필한다. 입력 context는 다음으로 제한한다.

- story-bible subset
- 전체 outline
- 이번 beat assignment
- 권장 분량
- 직전 세그먼트 요약과 tail
- active characters, locations와 props
- unresolved threads
- 이번 구간에서 회수할 항목
- 야담 말투·문체 규칙

첫 세그먼트에는 6문장, 200~350자 story intro가 포함된다. CTA는 구조적으로 표시한다.

### 13.5 대본 게이트

Hard:

- JSON Schema
- 필수 후보·반전·감정 포인트 수
- stable ID reference
- 이름 금지 목록·중복
- 나이·관계·시간순·소품 소유권
- 따옴표 짝
- 금지 한자·메타 오염
- title slots와 suffix
- intro 6문장, 200~350자와 spoiler
- theme placement
- foreshadowing recovery
- finale stages
- 전체 고정 엔딩 3문장
- segment 연결 무결성
- canonical final text와 UTF-8 byte source span coverage 100%
- beat 1~15 assignment, intro·ending assignment와 finale 5단계 evidence coverage
- expected audio scene ID 집합과 TTS 대상 scene ID 집합 일치

Warning:

- 대사 비중
- 25자 초과 문장 비율
- 어미·단어 반복
- 긴 narration block
- 수사 질문 빈도
- 시간 표현 반복
- 비하 호칭

결과는 PASS, PASS_WITH_WARNINGS 또는 FAIL이다.

Hard 실패는 오류 path와 evidence만 넣어 한 번 repair한다. 두 번째 실패는 needs_review다. 전체 대본을 무조건 다시 생성하지 않는다.

이름 서비스는 Markdown 원본을 실행 중 직접 파싱하지 않고 stable ID가 있는 normalized data로 빌드한다. 지원한다고 선언한 모든 `socialClass × gender × useCase` pool은 non-empty이거나 명시적으로 unsupported여야 한다. 특히 사대부 여성의 public address, taekho와 legal given name을 별도 pool로 유지하며 `-`로 시작하는 원본 행을 버리지 않는다. 같은 seed·입력은 배열 순서까지 동일하고 pool 소진 시 모델 즉흥 작명으로 fallback하지 않는다.

## 14. Supertonic

### 14.1 입력

각 TTS scene은 다음을 갖는다.

- sceneId와 order
- source text와 source hash
- normalized TTS text와 normalized hash
- voice
- model과 language
- speed와 silence
- readSlow
- continuousNext

초기 yadam profile은 현재 로컬에서 검증된 `supertonic-3`, `M1`, `ko`, `totalStep 8`, 기본 speed 1.04, scene silence 0.38초, 연속 scene silence 0.04초를 사용한다. `readSlow`는 승인·옵션 hash에 남는 전달 메타데이터지만 yadam v1에서 별도 느린 속도 필드를 만들거나 speed 1.04를 바꾸지 않는다. 이 생성 speed와 최종 영상의 playback tempo 1.0은 서로 다른 값이다. yadam은 scripture 전용 speed 0.96을 상속하지 않는다.

### 14.2 생성

auto-video 내부 adapter가 HTTP 우선, CLI fallback 정책을 소유한다. sibling Hermes 내부 import는 compatibility 기간에만 허용한다.

production HTTP transport는 항상 `POST /api/tts-job`을 사용한다. 202 응답의 job ID를 scene checkpoint에 먼저 저장하고 `GET /api/tts-job/<jobId>`를 bounded polling해 `done` result를 회수한다. 동기 `POST /api/tts`는 한 문장 smoke와 명시적인 non-cancellable diagnostic에만 허용한다. 서버가 내려가 있고 local CLI preflight가 통과한 경우에만 CLI fallback을 사용한다.

서버 재시작 뒤 이미 수락·checkpoint된 provider job ID의 GET이 404이면 검증된 job-root raw 또는 normalized WAV가 있는지 먼저 검사한다. 유효 파일이 있으면 그 파일만 회수·재사용한다. 둘 다 없으면 accepted submission을 잃은 ambiguous 상태이므로 orphan evidence와 needs-review report를 남기고 자동 POST·CLI fallback을 모두 중지한다. 수락된 job ID가 있는 404를 안전한 재제출 신호로 간주하지 않는다. 서버 자체에 idempotency가 없으므로 local scene lock, request manifest와 provider job ID가 중복 제출 방지의 정본이다.

초기 yadam voice는 현재 검증된 M1을 기본으로 한다. 이후 프로필 설정으로 M1~M5, F1~F5 중 audition 완료 음성을 변경할 수 있다.

Supertonic HTTP는 provider-owned output root에 파일을 만들고 path 또는 audio URL을 반환한다. adapter는 반환 path를 production에서 직접 참조하지 않는다. configured allowed root를 확인하거나 loopback URL로 내려받아 job root의 raw tmp 파일에 복사하고 다음을 확인한다.

- 파일 존재
- RIFF/WAV stream
- measured duration > 0
- source hash
- raw output SHA-256

그 뒤 모든 raw WAV를 조립기 입력 전에 다음 canonical PCM으로 정규화한다.

- codec `pcm_s16le`
- sample rate `48000`
- channels `1`
- channel layout `mono`

동등한 FFmpeg 인자는 `-map 0:a:0 -vn -c:a pcm_s16le -ar 48000 -ac 1`이다. normalized tmp를 ffprobe로 다시 검사하고 raw hash, normalized hash, source hash, codec, sample format, sample rate, channels와 duration을 기록한 뒤 atomic rename한다. compatibility `voice/voice_XX.wav`는 이 normalized 파일의 검증된 복사본이다.

### 14.3 타임라인

실제 WAV 길이가 scene duration의 정본이다. WAV를 계획된 visual duration에 맞추기 위해 과도한 tempo를 적용하지 않는다. 새 yadam assembler는 음성을 1.0 배속으로 유지하고 visual slot을 실제 음성에 맞춘다.

전체 허용 범위:

- minimum = targetMinutes × 60 × 0.8
- maximum = targetMinutes × 60 × 1.2

범위를 벗어나면 편차가 큰 논리 세그먼트를 골라 Codex가 확장·축약한다. 변경된 세그먼트의 TTS와 downstream만 무효화한다.

자동 duration repair는 job 전체에서 최대 한 번이다. 사건·반전·인물 관계·결말은 바꾸지 않고 묘사·대사·전환 길이만 조절한다. story-bible 또는 outline 의미가 바뀌면 duration repair로 처리하지 않고 승인 1까지 무효화한다.

승인 2 뒤 첫 전체 TTS가 범위 밖이면 다음 순서로 처리한다.

1. 최소 segment set을 한 번 수정한다.
2. 변경 segment의 TTS만 다시 생성하고 전체 실측 길이를 다시 계산한다.
3. 여전히 범위 밖이면 `needs_review`로 멈춘다.
4. 범위 안이면 기존 approval-2를 무효화하고 `REBUILDING_APPROVAL_2_BUNDLE`에서 final·script-scenes·scene plan·QA hash를 갱신한다. 변경 scene을 참조하는 대표 preview만 다시 만들고 dependency hash가 같은 reference·thumbnail·preview는 재사용한다. reference·style·thumbnail 같은 비대표 closure까지 변경 영향이 닿는 비정상 경우는 `duration_refresh_scope_expanded` needs-review로 멈추며 같은 job에서 normal preview 전체 재생성을 호출하지 않는다.
5. 좁은 refresh가 성공한 경우에만 완성된 새 bundle로 `AWAITING_APPROVAL_2`에 들어간다.
6. 사용자가 새 artifact set을 같은 승인 2의 새 revision으로 승인하면 검증된 WAV를 재사용하고 production으로 진행한다.

따라서 승인된 `final.txt`는 사용자 확인 없이 자동 변경된 상태로 영상에 들어가지 않는다.

### 14.4 TTS 결과 기록

- transport: HTTP 또는 CLI
- model, voice, language와 effective options
- source와 normalized hashes
- raw와 normalized WAV hash, normalized duration, codec, sample format, sample rate, channels와 channel layout
- package와 model revision
- attempts와 elapsed time
- status와 error

native Supertonic SRT는 문자 비례 추정으로 표시한다. 정밀 음성 alignment로 오인하지 않는다.

## 15. 이미지 생성

### 15.1 공통 서비스

Image Generation Service는 purpose가 scene, intro 또는 thumbnail인 provider-neutral 요청을 받는다. 실제 첫 provider는 ComfyUI다.

Codex 출력은 ComfyUI prompt가 아니다. deterministic Prompt Compiler가 story-bible과 scene-plan에서 `compiled-image-request.json`을 만든 뒤 provider 요청으로 변환한다.

compiled request 필수 영역:

- identity: focal character가 있을 때 characterId, variantId, reference status·path·hash와 appearance anchors; 비인물 establishing·prop slot은 null
- story: subject, action, emotion, location, era, wardrobe와 props
- composition: shot size, camera angle, focal position, exact focal headcount와 gaze
- style: `yadam-color-manhwa-v1`의 고정 positive clauses
- negative: modern objects, readable text, watermark, photo·3D, anatomy defect, spoiler와 safety exclusions
- conditioning: `sdxl-ipadapter-plus-face` 또는 `none`, reference image, IP-Adapter weight·start·end
- render: dimensions, seed, steps, CFG, sampler와 scheduler
- provenance: compiler, schema, profile와 prompt-pack versions, input hashes

Compiler는 positive와 negative의 충돌, focal character인데 reference가 없는 ID, variant wardrobe 불일치, 허용 범위 밖 headcount·dimension·weight, unresolved placeholder를 hard fail한다. canonical reference 후보와 approval-2 preview는 `provisional` reference를 쓸 수 있지만 해당 candidate-set hash에 묶인다. production compiler는 현재 approval-2 revision에서 `approved`로 promote된 reference만 허용한다. 비인물 establishing·prop slot은 같은 SDXL checkpoint와 style clauses를 쓰되 reference T2I workflow와 conditioning `none`을 사용한다. 요청은 assetId, purpose, compiled prompt, negative prompt, dimensions, seed, profile, reference assets, controls, idempotency key와 metadata를 갖는다.

Idempotency key는 RFC 8785 canonical JSON으로 직렬화한 다음 값의 SHA-256이다: provider·adapter version, workflow hash, checkpoint·CLIP Vision·IP-Adapter·LoRA hash, compiled positive·negative, dimensions, sampler·scheduler·steps·CFG, seed, reference content hashes, reference weights와 timing, style·compiler·schema versions. 파일 path나 생성 시각은 key에 넣지 않는다.

결과는 provider job ID, resolved workflow·model·seed, output path·hash·dimensions, attempts, timing, warning과 structured error를 갖는다.

### 15.2 preflight

production 제출 전 다음을 확인한다.

- loopback base URL
- /system_stats
- /object_info의 `CheckpointLoaderSimple`, `CLIPTextEncode`, `EmptyLatentImage`, `KSampler`, `VAEDecode`, `LoadImage`, `SaveImage`, `IPAdapterUnifiedLoader`, `IPAdapter`
- checkpoint, CLIP Vision과 IP-Adapter exact filename·size·SHA-256 allowlist
- workflow file와 placeholder
- workflow JSON node reference, fixed SaveImage output node와 unresolved placeholder 0
- provider-owned output root와 job tmp root writeability
- GPU queue

node나 model이 없으면 timeout까지 기다리지 않고 preflight에서 실패한다.

ComfyUI가 내려가 있고 host configuration의 `autoStart`가 true면 allowlist된 `C:/Users/petbl/ComfyUI_windows_portable/run_nvidia_gpu.bat`만 시작한다. `spawn(..., shell:true)`를 쓰지 않고 고정 `C:/Windows/System32/cmd.exe`를 `[/d, /s, /c, <quoted fixed bat>]` 인자로 `shell:false`, portable root cwd, hidden window로 실행한다. 사용자 문자열은 command line에 들어가지 않는다. 최대 180초 동안 ping한 뒤 node·model preflight를 다시 실행하며 실패하면 job을 멈춘다.

#### Workflow JSON contract

`yadam_sdxl_reference_v1.json` node flow는 `CheckpointLoaderSimple(4) -> CLIPTextEncode positive(6)/negative(7) + EmptyLatentImage(5) -> KSampler(3) -> VAEDecode(8) -> SaveImage(9)`다. 허용 placeholder는 `{{CKPT}}`, `{{PROMPT}}`, `{{NEGATIVE_PROMPT}}`, `{{WIDTH}}`, `{{HEIGHT}}`, `{{SEED}}`, `{{STEPS}}`, `{{CFG}}`, `{{SAMPLER}}`, `{{SCHEDULER}}`, `{{FILENAME_PREFIX}}`뿐이다.

`yadam_sdxl_ipadapter_v1.json` node flow는 `CheckpointLoaderSimple(4)`, `LoadImage(20)`, `IPAdapterUnifiedLoader(21)`, `IPAdapter(22)`, positive(6)·negative(7), `EmptyLatentImage(5)`, `KSampler(3)`, `VAEDecode(8)`, `SaveImage(9)`다. 위 placeholder에 `{{REFERENCE_IMAGE}}`, `{{IPADAPTER_WEIGHT}}`, `{{IPADAPTER_START}}`, `{{IPADAPTER_END}}`를 추가하고 `IPAdapter(22).weight_type`은 exact literal `standard`로 고정한다.

두 workflow 모두 `EmptyLatentImage.batch_size=1`, `KSampler.denoise=1.0`을 JSON literal로 고정하고 conditioned workflow는 `IPAdapter.weight_type="standard"`를 literal로 고정한다. workflow descriptor는 expected output node ID 9와 output type image를 고정한다. 치환 뒤 `{{...}}` 0개, 모든 class_type의 object_info 존재, 모든 node reference 유효, LoRA node 0개, dimensions·steps·CFG·IP-Adapter 값이 profile 범위 안이어야 `/prompt`를 호출한다.

#### Reference input transport

job-root reference path를 workflow JSON에 직접 넣지 않는다. adapter는 reference를 decode·hash한 뒤 `POST /upload/image`로 ComfyUI input storage에 올린다. filename은 사용자 문자열이 아닌 `yadam_<jobId>_<referenceSha256>.png`, subfolder는 allowlisted `yadam-references`로 고정한다. 응답의 name·subfolder를 normalize해 path traversal이 없음을 확인한 값만 `{{REFERENCE_IMAGE}}`에 치환한다.

resume 시 저장된 upload record가 있으면 `/view?type=input`으로 해당 content를 다시 받아 hash를 비교한다. 없거나 hash가 다르면 같은 content-addressed name으로 재업로드하고, 같으면 중복 upload를 생략한다. upload record는 local reference hash, Comfy name·subfolder, verified remote hash, uploadedAt와 workflow input hash를 가진다. ComfyUI input file은 provenance일 뿐 production 정본은 job-root reference다.

### 15.3 캐릭터 일관성

서사 중요도와 화면 등장 빈도로 최대 5명의 주요 캐릭터를 고르고 각 character variant마다 canonical reference assets를 만든다. minor 인물은 archetype anchor를 가지지만 얼굴 동일성을 production claim으로 표시하지 않는다.

- 중립 표정의 정면 또는 3/4 상반신 primary reference 한 장
- primary를 직접 참조한 반측면·전신 reference
- 기본 복장과 필요한 variant 복장
- 사용자가 제공한 reference가 있으면 decode·safety·권리 확인 뒤 primary로 우선 사용

seed는 jobId, characterId와 variantId에서 결정론적으로 파생한다. primary reference의 hash, checkpoint hash, workflow·prompt version, seed와 approval revision을 manifest에 고정한다. 이전 장면의 결과를 다음 장면 reference로 연쇄 사용하지 않고 모든 scene이 approved primary를 직접 참조한다.

approval-2 전에는 이 set의 상태가 `provisional`이다. 대표 preview는 같은 provisional set hash를 사용한다. 사용자가 approval-2 bundle을 승인하면 픽셀을 다시 만들지 않고 approval record가 정확한 reference set hash를 `approved`로 promote한다. 수정 요청으로 reference candidate가 바뀌면 기존 preview dependency hash가 달라져 필요한 preview를 다시 만든다. 이 상태 분리로 reference를 승인하려면 이미 approved reference가 필요하다는 순환을 만들지 않는다.

scene request는 characterId와 characterVariantId를 SDXL IP-Adapter actual conditioning reference로 전달한다. v1은 한 visual slot에서 얼굴을 강하게 고정하는 focal character를 최대 한 명으로 제한한다. 두 명의 얼굴이 중요한 대화는 화자별 reaction/cross shot으로 분리하고 보조 인물은 후면·원거리·실루엣으로 처리한다. 두 명 이상 얼굴을 동시에 고정하는 regional masked conditioning은 v2 비목표다.

reference 기능이 구성되지 않았으면 continuity가 있다고 표시하지 않고 production preflight를 실패시킨다.

### 15.4 승인 2용 preview

전체 렌더 전에 canonical character references와 인트로·본문·클라이맥스 대표 이미지 각 1장을 생성한다. 썸네일 background와 deterministic copy composition도 한 장 생성한다.

preview도 production과 동일한 provider contract, reference conditioning과 QA를 사용한다. 승인 2 뒤 compiled request, workflow, model, reference, style와 seed hash가 모두 같은 preview 이미지는 해당 production visual slot에서 재사용할 수 있다. 승인 대상 hash가 달라지면 preview를 production으로 승격하지 않는다.

### 15.5 실행과 재개

- GPU concurrency 1
- 장면별 durable checkpoint
- prompt ID 저장
- timeout 시 기존 history 재조회
- transient error만 제한 재시도
- 결과마다 seed, workflow hash와 model metadata 저장
- stage 종료 후 memory free

release에서 missing image, slate, first-image fallback과 circular reuse를 금지한다.

### 15.6 Visual QA executor

모든 asset은 먼저 PNG decode, exact dimensions, nonzero bytes, alpha·luminance 분포, near-solid·black frame, duplicate hash와 expected slot parity를 deterministic 검사한다. 결과 선택은 history의 첫 이미지가 아니라 workflow에 고정한 SaveImage node ID만 사용한다.

그 뒤 현재 설치된 local Ollama vision model `gemma4:12b`를 yadam 전용 JSON Schema critic으로 사용한다. reference contact sheet와 scene output을 함께 보내 다음을 0~10 또는 boolean으로 판정한다.

- contextMatch >= 7
- focalCharacterMatch >= 6
- eraWardrobeMatch >= 7
- colorStyleMatch >= 7
- required focal subject 누락·추가 없음
- readableText false
- watermark false
- modernObject false
- severeAnatomyDefect false
- minorSafetyViolation false
- thumbnail purpose일 때 reservedTextRectClear true, faceInTextRect false, criticalObjectInTextRect false

위반 asset은 실패 축만 prompt에 추가해 한 번 재생성한다. 두 번째 실패, critic parse 실패 또는 vision model unavailable은 자동 통과가 아니라 `needs_review`다. ComfyUI와 Ollama 12B를 동시에 GPU에 올리지 않도록 Comfy batch 종료 후 `/free`, vision QA batch, Ollama unload 순서로 resource lock을 사용한다. 승인 2의 사람 검토는 자동 QA를 대체하지 않고 canonical reference와 대표 preview에 대한 추가 gate다.

## 16. 인트로

story intro text와 media intro를 분리한다.

- story intro: 대본 첫 6문장
- media intro: 첫 번째 세그먼트의 고밀도 visual slots

기본 media intro 정책:

- 첫 약 60초
- 평균 6초, slot별 5~7초
- ComfyUI still
- FFmpeg zoom과 pan; compatibility acceptance는 cut, generalized assembler 이후 dissolve
- Supertonic narration
- no I2V
- no lip-sync
- no generated subtitle text in image

6번째 CTA는 새 이미지를 만들지 않고 마지막 hook visual의 end를 연장한다. 모든 intro visual slot은 sourceSceneIds와 primarySceneId를 갖는다.

60초 이후 본문은 30초 목표, 20~40초 범위로 slot을 배치한다. 10분은 기본 28개, 120분은 최대 260개다. 동일 이미지를 의도적으로 더 오래 보여 주는 경우 새 visual slot을 만들지 않고 기존 slot의 end를 연장하며 `extendedHold:true`와 `holdReason`을 기록한다. 따라서 모든 visual slot은 여전히 자신에게 속한 성공 image asset 하나를 가진다.

## 17. 썸네일

Codex는 카피 4안과 각 안의 layout enum을 만든다. 카피 선택은 승인 2 전에 이루어지는 provisional selection이며, 선택된 안으로 시안을 합성한 뒤 전체 approval-2 bundle을 공식 승인한다.

ComfyUI는 텍스트 없는 1280×720 배경만 생성한다. compiled thumbnail request에는 선택 layout의 normalized `reservedTextRect`와 반대편 subject placement를 명시해 생성 단계부터 글자 공간을 비운다.

deterministic compositor가 다음을 적용한다.

- 선택된 한국어 문자열 정확 일치
- 지정 line breaks
- pinned Korean font와 fallback
- font size
- line spacing
- fill, outline와 shadow
- pixel-safe text rectangle
- character face와 critical object protection area

thumbnail-plan의 geometry는 픽셀이 아니라 0~1 normalized coordinate의 `[x, y, width, height]`로 저장하고 1280×720 canvas에 변환한다. layout enum은 v1에서 `left-panel-4`, `right-panel-4`, `bottom-band-2`만 허용한다. 각 layout은 `textRect`, 최대 line count, line별 exact string, alignment, font family·weight, min/max font size, outline·shadow와 최소 4% edge margin을 가진다. `protectedRects`에는 얼굴·손·핵심 증거물이 들어가며 textRect와 1 pixel이라도 겹치면 fail한다.

초기 pinned font는 `C:/Windows/Fonts/malgunbd.ttf`이고 현재 SHA-256은 `e8cbc0b2afcc14fb45dfb6086d5102c0b23a96e7b6e708f3122acde1b86c9082`다. regular fallback은 `malgun.ttf`, SHA-256 `7a183cf1c6c56b9609fcc16eda8b5229fbc11758a21e669ec00343239b02192f`다. Windows update로 hash가 바뀌면 silent fallback하지 않고 한글 glyph smoke와 새 host lock 승인을 요구한다.

compositor는 고정 한국어 font file의 SHA-256을 기록하고 binary search로 가장 큰 fitting font size를 찾는다. 최소 font size에서도 overflow, clipping, missing glyph 또는 line count 불일치가 나면 글자를 임의 축약하지 않고 카피 재선택 상태로 돌아간다.

planned geometry만 믿지 않는다. 배경 생성 뒤 yadam vision critic은 실제 결과에 대해 `reservedTextRectClear`, `faceInTextRect`, `criticalObjectInTextRect`와 `subjectPlacementMatch`를 반환한다. `reservedTextRectClear=true`, 나머지 overlap false가 아니면 background prompt를 한 번 보정하고 다시 검사한다. approval-2 사람 검토에도 reserved rect guide overlay와 최종 text 합성본을 함께 제공한다.

최종 gate:

- 1280×720
- PNG
- copy string과 line count 일치
- glyph 누락 없음
- 배경 대비
- 보호영역과 text overlap 없음
- 예상하지 않은 generated text 없음
- spoiler·safety 통과
- output SHA-256

배경에 문제가 없고 카피만 바뀌면 배경을 재생성하지 않는다.

## 18. FFmpeg 영상

### 18.1 yadam 기본 출력

- 1920×1080
- yadam profile FPS 24
- H.264
- yuv420p
- AAC
- audio sample rate 48 kHz
- burn-in subtitle와 `final/upload-subtitles/final-full.upload.srt`
- profile 설정에 따라 burn-in subtitle

gguljam-bible의 기존 FPS와 motion 설정은 회귀를 막기 위해 기존 프로필 값을 유지한다.

### 18.2 제작 순서

1. raw WAV 생성과 48 kHz mono PCM 정규화·실측
2. audio scene timeline과 visual slot allocation
3. `render-plan.json` atomic publish
4. ComfyUI 전체 still 생성과 visual QA
5. subtitle cue 생성과 coverage QA
6. 모든 path·hash가 해결된 `render-manifest.json` atomic publish
7. Hermes compatibility artifacts 생성
8. still별 motion clip 생성
9. normalized scene audio concat
10. segment MP4 조립
11. segment strict QA
12. stream profile parity 검사
13. concat copy
14. merged upload SRT 생성
15. final strict QA

visual video가 audio보다 짧으면 마지막 valid frame을 제한적으로 pad한다. audio를 visual plan에 맞추기 위한 과도한 atempo는 사용하지 않는다.

### 18.3 Hermes compatibility exact mapping

adapter는 segment마다 `compat/hermes/<segmentId>/`를 만들고 기존 assembler가 요구하는 파일을 생성한다. audio scene 수 N과 visual slot 수 M은 달라도 된다.

- `sceneplan.json.scenes`: audio scene 단위, `order`는 segment 안에서 1부터 N까지 연속
- `voice/voice_<order>.wav`: audio scene 단위 normalized PCM, order는 `padStart(2, "0")`인 최소 2자리 1-based 십진수다. 100 이상은 잘리지 않고 `voice_100.wav`가 된다.
- `keyframes/manifest.json.scenes`: visual slot 단위, `visualOrder`는 1부터 M까지 연속
- `segments/<segmentId>/visual-timeline.json.scenes`: 같은 visual slot 단위

audio scene start와 end는 normalized WAV duration을 순서대로 누적한다. visual slots는 각 scene별이 아니라 segment 전체 `[0, measuredAudioSeconds)`를 gap·overlap 없이 완전히 분할한다. slot은 시간상 겹치는 모든 audio scene을 `sourceSceneIds`로 참조하고 그중 이미지 grounding의 대표 장면 하나를 `primarySceneId`로 지정한다. 이로써 한 audio scene을 여러 intro slots가 나누는 경우와 한 body slot이 여러 짧은 audio scenes를 덮는 경우를 모두 표현한다.

기존 assembler는 keyframe manifest와 visual timeline을 배열 index로 결합하므로 compatibility adapter는 두 배열을 `visualOrder`로 정렬하고 count parity와 각 index의 visualSlotId 일치를 hard gate로 검사한다. `output_path`는 compatibility job 기준 상대경로이고 실제 PNG hash가 production asset hash와 같아야 한다.

compatibility `sceneplan.json` audio scene 예시는 다음 필드를 가진다.

    {
      "order": 1,
      "scene_id": "scene-0001",
      "narration": "canonical source text",
      "video_prompt": "first visual slot compatibility prompt",
      "duration_seconds": 18.42
    }

visual timeline slot은 `order`, `visualSlotId`, `sourceSceneIds`, `primarySceneId`, `startSeconds`, `endSeconds`, `durationSeconds`, `timingBand`를 가진다. compatibility `keyframes/manifest.json.narration_refs`에는 slot 시간과 겹치는 모든 audio scene order를 기록한다. root에는 `plannedDurationSeconds`, `measuredAudioSeconds`, `renderDurationSeconds`를 모두 기록하고 기존 `durationSeconds` alias는 renderDurationSeconds다.

segment manifest는 segment별 planned, measured, render와 final duration, 누적 start·end, directory path를 기록한다. 기존 `concat_segments.mjs`가 읽는 `segments[].dir`은 `segments/<segmentId>`를 가리킨다.

### 18.4 compatibility assembler invocation

yadam release는 다음 옵션을 강제한다.

- `--final-name final.mp4`
- `--preserve-audio-tempo`
- `--motion-fps 24`
- 새 `--preserve-color`

`--allow-fast-audio`와 `--max-audio-tempo`는 release에서 금지한다. visual timeline은 처음부터 measured audio에 맞추므로 정상 `audioTempoFactor`는 1.0이다. `--preserve-audio-tempo`는 rounding이나 adapter 오류가 음성 속도 변경으로 이어지는 것을 막는 방어 옵션이다. yadam assembler는 `forceMonochrome:false`, gguljam-bible 기본은 기존 `true`다.

assembler 연결은 코드 수준에서 `forceMonochrome: !options.preserveColor`로 고정한다. yadam source PNG와 각 motion clip 중간 frame에 대해 opaque pixel 중 `max(R,G,B)-min(R,G,B) >= 12`인 비율을 계산한다. source는 0.10 이상, clip은 `max(0.05, sourceRatio × 0.50)` 이상이어야 한다. 이 gate와 vision `colorStyleMatch >= 7` 중 하나라도 실패하거나 최종 segment 표본이 monochrome이면 strict fail이다.

기존 assembler의 `Math.ceil(lastVisualEnd)`와 전체 slot rescale은 yadam 정본 timeline을 바꾸므로 함께 수정한다. visual timeline이 있으면 exact 마지막 endSeconds를 사용하고 `abs(lastVisualEnd - measuredAudioSeconds) > 0.05초`면 scale하지 않고 실패한다. 0.05초 이내 frame rounding은 마지막 frame pad/cut으로만 맞추며 각 slot start·end는 바꾸지 않는다. assembly report는 visualSlotId, manifest start·end·duration, 실제 clip start·end·duration과 timelineScale을 기록한다. yadam timelineScale은 1.0이어야 하고 strict QA는 manifest와 실제 경계를 한 output frame 이내로 비교한다.

기존 compatibility assembler는 cut 연결만 보장한다. intro dissolve와 xfade는 generalized assembler가 render manifest를 직접 읽는 Phase 5에서 추가하며, 그 전 10분 acceptance는 cut + Ken Burns를 기준으로 한다.

## 19. 오류·재시도·재개

### 19.1 재시도

| 단계 | 정책 |
|---|---|
| Codex transient process 오류 | 최초 1 + 동일 입력 retry 2, 총 attempt 3 |
| Codex Schema 오류 | input hash당 field repair 1회 |
| 대본 hard gate | artifact revision당 해당 세그먼트 repair 1회 |
| duration repair | job 전체 1회 |
| Supertonic connect·5xx·timeout | 최초 1 + 해당 장면 retry 2, 총 attempt 3 |
| WAV invalid·unsupported option | 즉시 fail |
| ComfyUI transient error | history 확인 후 최초 1 + retry 2, 총 attempt 3 |
| image visual QA | asset revision당 실패 축으로 1회 |
| safety block | 안전 치환 1회 후 fail |
| thumbnail composition | copy·background hash 조합당 1회 |
| FFmpeg fail | assembly stage만 재실행 |

소진 후 needs_review로 전환한다.

### 19.2 선택적 무효화

모든 artifact는 자신의 hash, producer stage와 schema version, gate status 및 dependencyHashes를 기록한다. 재사용하려면 파일 hash와 모든 dependency hash가 일치하고 gateStatus가 pass여야 한다. 변경 시 reverse dependency graph를 전이적으로 순회한다.

- 후보 선택 변경: approval-1 bundle부터 downstream 전체
- approval-1 기획 또는 story-bible 의미 사실 변경: 해당 사실을 참조하는 script, final, QA, scene plan, approval-2와 모든 production 소비자
- 대본 scene·segment 또는 길이 변경: final.txt, script QA, 해당 scene plan, WAV, subtitle cue·SRT, visual prompt·image, preview, render plan·manifest, segment video, final concat·QA와 approval-2
- 캐릭터 외형·variant 변경: canonical reference, 관련 visual slots·preview·thumbnail background·video, render manifest·QA와 approval-2
- 이미지 style, workflow, model 또는 IP-Adapter 변경: 모든 관련 image·preview·thumbnail·video·QA와 approval-2
- voice·model·speed 변경: 해당 WAV, subtitle timing, render plan·manifest, segment/final video와 QA
- subtitle style만 변경: subtitle render와 video assembly; WAV·image는 재사용
- thumbnail copy 변경: registered thumbnail guide, preview manifest, composed thumbnail, thumbnail QA와 approval-2 bundle/approval; layout 보호영역이 같으면 background raster 자체는 재사용
- thumbnail background 변경: registered thumbnail guide, preview manifest, composed thumbnail, QA와 approval-2 bundle/approval
- scene timing 변경: visual slot·subtitle timing, render plan·manifest와 segment/final video

### 19.3 cancellation과 resume

cancel은 모든 provider가 즉시 원격 작업을 중단한다는 뜻이 아니다. 먼저 `cancel_requested`를 기록하고 새 Codex·TTS·ComfyUI·FFmpeg 제출을 멈추며 완료되지 않은 artifact를 production으로 promote하지 않는다.

- 오케스트레이터가 시작한 Codex CLI, Supertonic CLI와 FFmpeg process는 graceful termination 후 5초가 지나면 소유 process tree를 종료하고 tmp를 quarantine한다.
- Supertonic HTTP에는 cancel endpoint가 없으므로 polling을 멈추고 job ID를 `orphanedProviderJobs`에 기록한다. resume은 `/api/tts-job/<id>`를 먼저 조회해 같은 input hash의 결과만 회수한다.
- ComfyUI는 저장한 prompt ID가 이 job lock 소유임을 확인한 뒤 queued prompt는 `POST /queue {delete:[id]}`, running prompt는 targeted `POST /interrupt {prompt_id:id}`를 사용한다. 다른 작업에 영향을 주는 global interrupt는 금지한다.
- `/free`는 memory release일 뿐 cancel로 사용하지 않는다.

resume은 mutation-free `resolveForwardCursor`가 current file bytes, schema, registry gate/dependency map, 현재 profile/model/workflow/compiler/font/provider pin과 producer-defined success evidence를 read-only로 재계산하여 earliest unsealed invalid producer를 찾는다. 현재 formal approval과 authorized duration repair가 검증한 구간은 cryptographic sealed floor로 유지하고, 그 floor 이전 façade를 다시 호출하지 않는다. Historical event나 logical-role hash 하나만으로 skip하지도, 모든 façade를 무조건 재호출하지도 않으며, earliest invalid stage의 owning façade부터 이후 단계만 전진한다. 부분·불일치 파일의 quarantine·최소 단위 재실행은 그 owner façade가 호출된 뒤에만 수행한다.

단, `completed`는 terminal이다. 완료된 job은 완료 당시 pin과 terminal event/output hash로만 read-only 재검증하며 현재 도구 pin이 바뀌었다고 같은 job을 다시 생성하지 않는다. 완료 output이 없거나 변조됐으면 canonical release를 quarantine·교체하거나 `completed`를 `running`으로 되돌리지 않고 append-only incident evidence를 남긴다. 복구는 원래 hash와 byte-identical인 신뢰 백업 복원 또는 새 job 생성뿐이다.

정상·duration repair 상태 전이는 다음으로 고정한다.

    NEW
      -> GENERATING_CONCEPT_OPTIONS
      -> AWAITING_CONCEPT_SELECTION
      -> GENERATING_APPROVAL_1_BUNDLE
      -> AWAITING_APPROVAL_1
      -> APPROVAL_1_COMPLETED
      -> GENERATING_STORY_BIBLE
      -> DRAFTING_SEGMENTS
      -> FINAL_SCRIPT_QA
      -> GENERATING_APPROVAL_2_OPTIONS
      -> AWAITING_THUMBNAIL_COPY_SELECTION
      -> COMPOSING_APPROVAL_2_BUNDLE
      -> AWAITING_APPROVAL_2
      -> APPROVAL_2_COMPLETED
      -> GENERATING_FULL_TTS
      -> CHECKING_MEASURED_DURATION
          -> PASS: PRODUCTION_READY
          -> FAIL and repairAttempt=0: DURATION_REPAIRING
             -> REGENERATING_CHANGED_AUDIO
             -> CHECKING_REPAIRED_DURATION
                -> PASS: REBUILDING_APPROVAL_2_BUNDLE
                   -> AWAITING_APPROVAL_2
                   -> APPROVAL_2_COMPLETED
                   -> PRODUCTION_READY
                -> FAIL: NEEDS_REVIEW
      -> GENERATING_PRODUCTION_IMAGES
      -> ASSEMBLING_SEGMENTS
      -> FINAL_QA
      -> COMPLETED

`needs_review`, `failed`와 `cancelled`에서는 자동으로 다음 provider job을 제출하지 않는다.

## 20. 안전과 보안

- Codex default read-only sandbox와 approval never
- 일반 child process는 shell false. 유일한 예외는 검증된 ComfyUI batch를 실행하기 위한 고정 `cmd.exe` allowlist wrapper이며 Node의 shell option 자체는 false
- 사용자 문자열은 stdin과 structured input으로 전달
- executable allowlist와 resolved absolute path
- 오케스트레이터의 직접 filesystem write는 job root와 명시된 repo test fixture로 제한
- Supertonic·ComfyUI loopback default
- Supertonic·ComfyUI의 configured provider-owned output root 쓰기는 허용하되 server returned path는 allowed root 검증
- API key와 credential을 prompt·log에 포함하지 않음
- stdout JSONL과 stderr log 분리
- log에서 환경변수와 민감 경로 redaction
- temp file validation과 atomic rename
- 동일 job lock으로 동시 실행 방지
- ComfyUI concurrency 1
- UTF-8 NFC와 Windows 한글·공백 path tests

Provider 결과는 외부 path를 production manifest에 직접 기록하지 않는다. 가능한 경우 Supertonic audio URL 또는 ComfyUI `/view`로 loopback download하고, job root의 `.tmp`에 기록해 magic·decode·ffprobe·dimensions·hash를 검사한 후 atomic rename한다. 외부 provider path는 provenance로만 기록하고 기본적으로 삭제하지 않는다. allowed root 밖 path는 읽지 않는다.

## 21. 품질 게이트

yadam의 `strict-release`는 warning을 성공 코드로 취급하지 않는다. 아래 required check 하나라도 fail 또는 unresolved warning이면 `qualityOk:false`, `finalVerdict:"fail"`, nonzero exit다. 계획 단계의 사람이 승인한 정보성 편차만 `acknowledgedNotice`로 분리한다.

### 21.1 대본

- schema와 stable references
- 15 beat structure
- twists와 emotional points
- character, age, relationship, chronology와 props
- intro format와 spoiler
- foreshadowing recovery
- finale와 ending
- warnings report
- final.txt source byte 누락 0, 중복 0
- beat 1~15, intro·ending, 복선 plant/recovery와 finale 5단계 scene evidence 누락 0

### 21.2 TTS

- all required scenes generated
- expected audio scene IDs와 passed WAV scene IDs 집합 동등
- 모든 WAV pcm_s16le, 48 kHz, mono, duration > 0
- normalization report
- source hash match
- overall duration 80~120 percent
- yadam `abs(audioTempoFactor - 1.0) <= 0.001`

### 21.3 이미지

- expected visual slots = mapped successful assets
- scene·intro 1024×576, thumbnail background 1280×720
- deterministic decode·black·near-solid·duplicate hard gate
- vision context >= 7, focal identity >= 6 when applicable, era·wardrobe >= 7
- vision color style >= 7, source color-pixel ratio >= 0.10
- readable text, watermark, modern object, severe anatomy defect와 minor safety violation 0
- character reference use
- keyframe manifest count = visual timeline slot count; positional compatibility pair마다 visualSlotId 일치
- first start 절댓값 <= 0.01초, 인접 gap·overlap <= 0.01초
- `abs(duration - (end-start)) <= 0.01초`
- `abs(lastSlot.end - measuredAudioSeconds) <= 0.05초`
- no release fallback

### 21.4 썸네일

- exact copy
- normalized safe area, 4% edge margin와 protectedRect overlap 0
- line count, glyph, clipping·overflow와 font hash 일치
- contrast
- spoiler와 safety
- output dimension와 format

### 21.5 영상

- ffprobe success
- 모든 segment WAV·video stream profile exact parity
- segment `abs(finalDurationSeconds - measuredAudioSeconds) <= 0.25초`
- motion clip duration error <= `max(0.75초, planned × 0.03)`
- FFmpeg decode error 0
- 첫·마지막 0.25초를 제외하고 0.5초 이상 blackdetect interval 0
- 각 motion clip midpoint color-pixel ratio >= `max(0.05, source × 0.50)`; yadam monochrome output 0
- SRT 누락·parse 실패·inverted cue·overlap 0
- cue duration 0.2~8.0초
- audio와 subtitle end 차이 <= 0.5초
- video와 subtitle end 차이 <= 0.75초
- all segments present
- stream profiles identical
- intro only in first segment
- `abs(finalDuration - sum(segmentFinalDuration)) <= max(0.5초, 2 × segmentCount / fps)`
- final duration target 80~120 percent
- merged upload SRT cue count > 0, missingSrt·unparseableSrt·timingWarnings 모두 0
- qualityOk true
- final verdict pass

### 21.6 Cross-artifact coverage

Release 전 `coverage-report.json`은 다음 집합 동등성과 연결을 검사한다.

- expectedAudioSceneIds = passedNormalizedWavSceneIds
- expectedVisualSlotIds = passedProductionImageSlotIds
- subtitleRequiredSceneIds = sceneIdsReferencedByAtLeastOneCue
- renderManifestAssetHashes = artifactManifest의 동일 logical asset hashes

각 WAV는 sceneId, sceneSourceHash, ttsNormalizedHash, voice·options hash와 duration을 가진다. missing·duplicate·orphan WAV는 0이어야 한다. subtitle cue는 존재하는 sceneId를 참조하고, scene별 cue text를 subtitle normalization 뒤 이어 붙인 값이 원문과 같아야 한다. 각 visual slot은 sourceSceneIds, primarySceneId와 source hashes를 가지고 expected slot마다 성공 asset이 정확히 하나여야 한다. 모든 audio scene 시간은 최소 한 visual slot 시간과 겹쳐야 한다. extended hold는 같은 slot의 end 연장으로만 표현하며 slate·first-image·circular fallback은 0이어야 한다.

## 22. 테스트 전략

### 22.1 단위

- request validation
- 10분 step과 range
- duration tolerance
- beat allocation satisfiability
- Korean quote와 age parsing
- name picker와 deterministic seed
- state transitions
- invalidation graph
- provisional selection과 formal approval revision
- approval artifact-set RFC 8785 hash
- post-TTS duration repair 1회와 approval-2 재승인
- manifest continuity
- canonical UTF-8 byte span과 source coverage
- 사대부 여성 public_address 4개, taekho 8개, legal_given_name 15개 fixture
- 모든 지원 class × gender × useCase pool non-empty 또는 unsupported
- `-`로 시작하는 name source 행 보존, NFC 중복과 exhausted no-fallback

### 22.2 Codex

- fake executable
- JSONL event parser
- nonzero exit
- timeout와 cancellation
- malformed final JSON
- schema mismatch와 repair
- Windows Korean and space paths
- executable discovery

실제 Codex smoke는 opt-in이며 최소 JSON 한 건으로 제한한다.

### 22.3 Supertonic

- fake HTTP success
- HTTP down to CLI fallback
- timeout와 5xx
- malformed path
- outside allowed root
- duplicate scene order
- Korean normalization
- long sentence
- zero duration WAV
- raw 44.1 kHz 입력을 canonical 48 kHz pcm_s16le mono로 변환
- normalized WAV codec·sample format·channel parity
- retry, checkpoint와 resume

실제 voice smoke는 한 문장으로 제한한다.

### 22.4 ComfyUI

- mock system stats, object info, prompt, history와 view
- missing node와 model
- 잘못된 extra model path로 LoRA가 checkpoint 목록에 노출된 fixture
- exact checkpoint·CLIP Vision·IP-Adapter hash mismatch
- workflow substitution
- fixed SaveImage node selection과 unresolved placeholder
- execution error
- timeout와 history resume
- seed와 hash recording
- reference conditioning contract
- primary reference에서 파생 image 생성과 previous-scene chaining 금지
- focal face가 2명인 slot 계획 거부 또는 shot split
- thumbnail safe zone
- thumbnail protectedRect, 4% margin, overflow와 missing glyph
- intro dimensions
- slot coverage
- local vision unavailable·parse failure가 auto-pass하지 않음
- allowlisted cmd.exe ComfyUI start와 non-allowlisted batch 거부

Phase 4 실제 GPU smoke는 설치 직후 한 번 실행하는 5장 suite다: 768×1024 canonical reference 1장, 같은 reference의 반측면 파생 1장, 1024×576 character-conditioned scene 1장, 1024×576 non-character intro/establishing 1장, 1280×720 thumbnail background 1장. 각 결과의 reference transport, workflow·model hash, seed, output node, dimensions와 visual QA를 확인한다. 일반 unit test에서는 GPU 요청을 하지 않는다.

### 22.5 FFmpeg

- synthetic PNG와 WAV로 30초 MP4
- SRT cue timing
- intro in segment 1 only
- missing asset fail
- stream mismatch fail
- concat offsets
- compatibility audio order와 visual order가 서로 독립적일 때 positional manifest mapping
- `--preserve-audio-tempo --motion-fps 24 --preserve-color` yadam invocation
- 48 kHz mono WAV concat-copy fixture
- blackdetect, subtitle와 final duration numeric threshold boundary
- final duration and QA

### 22.6 회귀와 E2E

- gguljam-bible snapshot
- yadam profile isolation
- two approval state transitions
- interruption and resume
- 10분 live candidate
- 120분 dry-run and mock segmentation

초기 production acceptance는 10분 실제 야담 한 편이다. 120분 전체 실제 렌더는 10·20·60분 단계 검증 후 운영 승인으로 실행한다.

## 23. 단계적 전환

### Phase 1: 기반

- schemas
- profile registry
- artifact store
- pipeline state
- preflight
- Codex runner

### Phase 2: 대본

- normalized motif·name data
- yadam prompt pack
- story bible
- 15 beat planner
- segment drafting and validators
- approvals

### Phase 3: TTS

- in-repo Supertonic adapter
- scene audio manifest
- measured duration
- repair feedback
- resume

### Phase 4: 이미지·썸네일·인트로

- provider-neutral image service
- ComfyUI adapter
- extra_model_paths checkpoint·LoRA mapping 분리
- pinned IP-Adapter custom node, CLIP Vision와 SDXL Plus Face model 설치·hash lock
- yadam SDXL reference와 IP-Adapter workflow
- preflight
- character references
- production stills
- thumbnail compositor

### Phase 5: 영상

- render manifest
- Hermes compatibility adapter
- generalized segment assembler
- concat and subtitle
- strict release QA

### Phase 6: E2E와 운영

- master orchestrator
- 10분 live acceptance
- regression
- operational docs
- monitoring and cleanup

## 24. 구현 계획 분할

이 설계는 여러 독립 subsystem을 포함하므로 하나의 거대한 구현 작업으로 실행하지 않는다. 하나의 master roadmap 아래 다음 계획을 순서대로 작성한다.

1. 기반·프로필·Codex CLI
2. 야담 대본 생성
3. Supertonic TTS
4. ComfyUI·썸네일·인트로
5. FFmpeg·최종 영상
6. E2E·마이그레이션·운영

각 계획은 앞 계획이 제공하는 exact interface를 Consumes로 선언하고 다음 계획이 사용할 interface를 Produces로 선언한다.

## 25. 최종 수용 기준

1. 사용자가 yadam, 주제·참고 제목과 10~120분 목표를 입력할 수 있다.
2. 승인 1에 정확한 후보 수와 기획 정보가 표시된다.
3. 승인 2에 완성 대본·QA·캐릭터·썸네일·대표 이미지가 표시된다.
4. 승인 2 뒤 수동 HERMES_JOB_DIR 입력이나 파일 복사 없이 production이 실행된다.
5. Codex, Supertonic, ComfyUI와 FFmpeg 단계가 각각 manifest와 logs를 남긴다.
6. `final/final-full.mp4`, `final/upload-subtitles/final-full.upload.srt`, `final/thumbnail.png`와 `final/final-qa-report.json`이 생성된다.
7. 10분 목표 실제 결과는 8~12분이다.
8. 120분 요청은 12개 논리 세그먼트로 계획·재개할 수 있다.
9. 모든 required scene audio와 visual slots가 충족된다.
10. no release fallback, qualityOk true와 final verdict pass다.
11. 중단 후 valid artifact를 재사용해 최소 단위부터 재개한다.
12. gguljam-bible 회귀가 통과한다.
13. yadam의 scene·intro·thumbnail은 같은 SDXL/IP-Adapter style stack을 사용하고 얼굴 고정 대상마다 actual approved reference hash가 기록된다.
14. 승인 뒤 duration repair로 finalTextHash가 바뀌면 approval-2 새 revision 없이는 production을 진행하지 않는다.
15. audio scene 수와 visual slot 수가 달라도 source·audio·subtitle·visual coverage가 각각 100%다.

## 26. 위험과 완화

| 위험 | 완화 |
|---|---|
| Codex 기본 context 비용 | stage batching, compact reference subset, cache |
| 장편 context drift | story-bible, segment summary, unresolved thread ledger |
| TTS 길이 오차 | calibrated estimate + actual WAV feedback |
| Supertonic timeout과 orphan job | scene unit, bounded retry, checkpoint |
| ComfyUI 장시간 GPU 점유 | concurrency 1, slot checkpoint, resume |
| 현재 IP-Adapter node·model 미설치 | pinned install, exact hash, preflight와 5-image GPU smoke를 Phase 4 P0로 수행 |
| 8GB GPU에서 ComfyUI·vision LLM 충돌 | 단일 GPU resource lock, Comfy `/free`, Ollama batch와 unload |
| character drift | SDXL Plus Face canonical references, 장면 연쇄 참조 금지와 actual conditioning |
| keyframe coverage 누락 | expected slots equality hard gate |
| thumbnail Korean text 오류 | deterministic compositor |
| FFmpeg stream mismatch | pre-concat profile gate |
| 기존 성경 회귀 | separate profile와 snapshot |
| non-Git workspace | 문서 작성은 가능하나 commit은 저장소 초기화 후 수행 |

## 27. 구현 착수 전 조건

- 이 written spec 방향에 대한 사용자 승인 완료
- 상세 구현 계획 6개 작성
- 계획 단계에서 exact file map과 public interfaces 확정
- Git 저장소 사용 여부는 사용자가 별도로 결정
- 실전 생성 비용이 드는 smoke와 acceptance는 opt-in으로 표시
- IP-Adapter 설치와 model download는 계획에 포함하되 실제 외부 변경은 해당 구현 단계에서 provenance·license·hash를 제시하고 수행

이 조건이 충족되기 전에는 production 구현을 시작하지 않는다.

## 28. 설계 자체 검토 결과

- 독립 script·visual·integration 검토에서 발견한 approval linkage, render-plan 시점, source span, compatibility 경로, duration, audio normalization, reference conditioning와 strict QA P0를 반영했다.
- target time, approval count, intro 방식과 duration tolerance는 사용자 승인값과 일치한다.
- provisional selection과 formal approval을 분리해 공식 관문은 여전히 두 종류뿐이다.
- script scene, visual slot과 subtitle cue의 ID 관계를 분리하고 canonical UTF-8 byte coverage를 정의했다.
- render-plan.json과 최종 render-manifest.json의 생성 시점을 분리했다.
- 기존 manual-assembly와 upload subtitle 경로를 compatibility 기간 동안 보존했다.
- yadam은 normalized 48 kHz PCM, 1.0 audio tempo와 실측 timeline을 사용한다.
- 현재 실제 SDXL checkpoint를 선택하고 누락된 IP-Adapter 구성은 숨은 fallback이 아니라 명시적 Phase 4 P0 prerequisite로 만들었다.
- thumbnail geometry, compiled image request, idempotency key와 local vision QA executor를 고정했다.
- 초기 control surface를 현재 코드베이스에 맞는 Node CLI와 library로 고정하고 새 GUI를 범위에서 제외했다.
- 실제 WAV 길이를 타임라인 정본으로 사용하므로 기존 assembler의 과도한 tempo 보정을 새 yadam 경로에 승계하지 않는다.
- gguljam-bible과 yadam 설정, 품질 게이트와 회귀 경계를 분리했다.
- 범위가 큰 점을 인정하고 여섯 개 구현 계획으로 분할했다.
