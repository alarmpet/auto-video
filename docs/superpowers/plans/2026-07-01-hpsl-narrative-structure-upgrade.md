# HPSL(후킹-포인트-스토리-교훈) 대본 구조 강화 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `꿀잠성경`의 "성경 × 현대심리 위로형 수면 낭독" 컨셉이 실제로 유효한지 근거를 확인하고, 각 챕터가 후킹(Hook)·포인트(Point)·스토리(Story)·교훈(Lesson) 구조를 짜임새 있게 갖추도록 `auto-video.md` 대본 작성 규칙과 자동 검증 게이트를 강화한다.

**Architecture:** 이 저장소에는 이미 대본 작성 지침(`auto-video.md`)과 대본 품질 게이트(`scripts/lib/quality-gates.mjs`, 그리고 아직 미구현 상태인 `docs/superpowers/plans/2026-07-01-script-quality-upgrade.md`의 반복/구조/의미중복 분석기)가 있다. 이 계획은 그 위에 "구조가 있는가"를 넘어 "각 챕터가 후킹·논점·이야기·교훈을 실제로 갖추고 있는가"를 검사하는 층을 추가한다. 대본 자체는 코드가 자동 생성하지 않고 대화형 워크플로우(`auto-video.md` 3단계) 안에서 사람+LLM이 작성하므로, 이 계획의 핵심 산출물은 (1) 더 명확한 챕터 작성 규칙과 예시, (2) 그 규칙을 어겼는지 렌더 전에 잡아내는 정적 분석 게이트다.

**Tech Stack:** Node.js ESM 휴리스틱 분석기, 기존 `script-structure-analysis.mjs`(script-quality-upgrade 계획에서 생성 예정) 재사용, Markdown 운영 규칙(`auto-video.md`), JSON 리포트.

---

## 검토 의견서 반영 내역 (2026-07-01 업데이트)

`docs/superpowers/plans/2026-07-01-hpsl-narrative-quality-opinion.md`의 주장을 코드베이스와 직접 대조해 검증했다. 검증 결과에 따라 아래처럼 반영/기각했다.

**반영한 내용(검증됨):**

- `scripts\build_gguljam_20min_sample_export.mjs`가 `paragraphs`/`reflections`/`deepeningReflections`/`closingMeditations`/`gentleAnchors`/`lateSegmentAnchors` 배열을 문단마다 이어 붙이는 방식이라는 주장은 코드로 확인했다(151~153행 `expandedParagraphs = paragraphs.map(...)`). 이 방식은 장면이 시간 순으로 전진하기는 하지만, 한 문단 안에서 같은 소주제를 여러 묵상 문장으로 겹쳐 쌓는 구조라 "장면 진행"보다 "주제 두껍게 하기"에 가깝다는 지적은 타당하다.
- `targetCharsPerSecond` 기본값이 `6.8`이라는 주장은 `scripts\build_segmented_storyboards.mjs` 58행에서 확인했다(`Number(args.targetCharsPerSecond || 6.8)`). `auto-video.md`의 20분 목표(공백 제외 5,000~6,000자)를 초당 글자수로 환산하면 약 4.2~5.0자/초인데, 코드 기본값 6.8은 이보다 높다 — 실제로 `gguljam-bible-cain-envy-20min-sample-newflow-008/script.txt`는 9,115자(공백 제외, 직접 계산으로 확인)로 목표 상한 6,000자를 50% 이상 초과한다. 이 불일치는 실제 데이터로 확인된 진짜 문제다.
- 세그먼트 단위 품질 게이트가 전체 기준보다 느슨하다는 주장도 확인했다. `build_gguljam_20min_sample_export.mjs` 182행은 세그먼트별로 `minParagraphs: Math.max(8, Math.round(segment.durationSeconds / 60))`를 쓰고, 전체 대본은 같은 파일 156행에서 `minParagraphs: 18`을 명시적으로 낮춰서 통과시킨다. 다만 `scripts\lib\quality-gates.mjs`의 라이브러리 기본값은 90이지, 의견서가 말한 "40"이 아니다(직접 코드 확인: `const minParagraphs = options.minParagraphs ?? 90;`). 실제 전체 문단 수도 20개로 확인했다 — 즉 기본값으로 검사하면 `paragraph_count_too_low:20<90`이 정확한 실패 메시지이고, 의견서의 "20<40"은 숫자가 틀렸다. **방향은 맞지만 인용 수치는 정정해서 반영한다.**
- HPSL 각 단계의 톤 예시(Hook은 자극적 낚시가 아니라 조용한 불편함, Point는 강의식 선언이 아니라 마음 질문, Lesson은 훈계가 아니라 조용한 위로)는 `auto-video.md`가 이미 갖고 있는 "단정보다 해석", "정죄보다 이해" 원칙과 정확히 맞아떨어진다. 반영한다.
- 챕터마다 "새 기능"(사건 진행/심리 발견/관점 전환/정서 하강/질문 회수)을 배정하자는 제안은 구체적이고 검증 가능하며, 이미 이 저장소가 Ken Burns 모션에 쓰는 "연속 반복 금지" 패턴과 구조적으로 유사하다. 반영한다.
- "반복 금지"보다 "반복 역할 설계"가 필요하다는 지적도 타당하다. 수면 콘텐츠는 리듬을 위한 반복(챕터 끝 호흡 문장 등)이 필요한데, 지금 게이트 설명은 이를 구분하지 않는다. 반영한다.
- 심리학 개념을 챕터당 1개로 제한하자는 제안은 `auto-video.md`의 기존 "매 챕터마다 새 심리 개념을 추가한다" 규칙을 더 명확하게 다듬는 것이라 반영한다.
- 성경 장면 40% / 심리 해석 35% / 위로 25% 비율은 자동 게이트로 정확히 측정하기는 어렵지만, 글쓰기 가이드라인으로는 유용해서 반영한다(코드 게이트가 아니라 `auto-video.md` 서술 규칙으로만 반영).

**기각한 내용(검증 결과 근거 부족 또는 사실 아님):**

- "HPSL 계획 문서(`2026-07-01-hpsl-narrative-structure-upgrade.md`)가 mojibake로 깨져 저장되었다"는 주장은 **사실이 아니다.** 파일을 바이트 단위로 직접 확인한 결과 `Unicode text, UTF-8 text`이고 Python `decode('utf-8')`이 오류 없이 통과하며, 첫 줄이 `# HPSL(후킹-포인트-스토리-교훈) 대본 구조 강화 계획`로 정상 디코딩된다. 이 주장은 의견서 작성 시 사용한 도구(터미널 코드페이지 등)의 표시 문제였을 가능성이 높다. 따라서 "UTF-8 재작성" 항목은 이번 업데이트에 반영하지 않는다.
- "대본만 먼저 듣기(오디오 프리뷰) 산출물"이나 "LLM-as-judge 2차 게이트" 같은 제안은 방향은 합리적이지만 이 계획(HPSL 챕터 구조)의 범위를 벗어난 별도 주제다. 이번 문서에서는 코드 게이트로 강제하지 않고, Risk Notes에 향후 후보로만 짧게 남긴다.

---

## Concept Validation: "성경 × 현대심리 위로형 수면 낭독"이 맞는 컨셉인가

웹 검색으로 확인한 근거는 다음과 같다.

1. **수면용 성경 낭독은 이미 검증된 장르다.** `Bedtime Bible Stories`, `Abide & Sleep Bible Stories`, `Bedtime Bible Stories for Adults`(팟캐스트) 같은 채널이 "성경 이야기를 차분한 낭독으로 들려주며 재우는" 포맷으로 이미 자리잡고 있다. 다만 이들 대부분은 "하나님의 위로/신앙 안심"에 초점이 맞춰져 있고, 현대 심리학 개념을 명시적으로 섞는 채널은 검색에서 뚜렷이 확인되지 않았다.
2. **한국에서 심리학×인문학 해설 콘텐츠는 이미 대형 시장이다.** 북튜버 "너진똑"처럼 인문학·철학·신학을 섞어 145만 구독자를 모은 채널이 있고, 심리학을 앞세운 자기이해/위로형 콘텐츠는 한국 유튜브에서 꾸준히 큰 카테고리다.
3. **"성경 인물을 심리학적으로 읽어주는 수면 낭독"이라는 조합 자체는 블루오션에 가깝다.** 검색 결과 어디에서도 이 정확한 조합을 대표하는 대형 채널은 나오지 않았다 — 이는 각각 검증된 두 장르(수면 성경 낭독 + 심리 해설)를 결합한 차별화 포지셔닝이라는 뜻이다. 컨셉 자체는 타당하지만, 검증된 성공 공식을 그대로 베낄 수 없으므로 실행(특히 "이야기가 실제로 흥미로운가")의 완성도가 성패를 가른다.

**결론: 컨셉은 맞다.** 다만 실제 대본 샘플을 확인한 결과, 컨셉이 좋아도 실행 단계에서 "이야기"가 흥미롭게 살아나지 못하는 위험이 이미 보인다(아래 Current Finding 참고). 이 계획은 컨셉을 바꾸는 것이 아니라, 컨셉을 뒷받침할 실제 대본의 이야기 구조를 강화하는 데 집중한다.

Sources:
- https://www.youtube.com/playlist?list=PLqbk79uz2DqV6QhjUs5KLk_4WtOkFciaf
- https://www.youtube.com/channel/UCM3R3Dd9w-VWVC1QM_mv3_w
- https://podcasts.apple.com/us/podcast/bedtime-bible-stories-for-adults/id1675683934
- https://v.daum.net/v/20250121030404507

## 성경 원문 인용(개역한글판) 통합 방향

각 챕터의 Story 단계에 성경 원문을 짧게 그대로 인용하면, 채널이 스스로 내세우는 "성경 공부가 되는 채널" 포지셔닝의 신빙성이 올라가고 검색 노출에도 도움이 된다. 다만 번역본에 따라 저작권 상태가 완전히 다르므로 반드시 아래 사실관계를 지켜야 한다.

- **개역한글판(1961년 발행)은 저작재산권 보호기간(50년)이 2011년 말로 만료되어 2012년부터 대한성서공회의 허락 없이 자유롭게 사용할 수 있다.** 다만 인격권인 동일성유지권(원문을 임의로 바꾸지 않을 의무)과 성명표시권(번역본 출처를 표시할 의무)은 계속 지켜야 한다.
- **개역개정판(1998년 발행)은 아직 저작권이 살아 있다.** 저작권 보호기간은 공표 후 70년이며 대한성서공회가 권리자다. 허락 없이 쓰면 안 된다. 두 번역본은 이름이 비슷해 혼동하기 쉬우므로, 이 계획에서는 **개역한글판만** 원문 인용에 사용한다.
- GitHub 등에 개역한글 텍스트를 다루는 저장소(예: `ehrudxo/kbible1950`)가 있지만, 저장소에 올라와 있다는 사실 자체가 저작권 정리를 보장하지 않는다. 대한성서공회 공식 채널이나 신뢰할 수 있는 텍스트 덤프에서 직접 받아 출처를 명확히 표기하는 것을 원칙으로 한다.

Sources:
- https://www.bskorea.or.kr/bbs/board.php?bo_table=copyright_faq&wr_id=5
- https://www.bskorea.or.kr/bbs/content.php?co_id=subpage2_3_4_1
- http://www.igoodnews.net/news/articleView.html?idxno=33308

## Current Finding: 실제 저장소 대본 샘플 세 종류 비교

`exports` 폴더의 실제 대본 세 종류를 직접 비교했다.

- `exports/gguljam-bible-adam-eve-001/script.txt`는 실제로 괜찮다. "오늘 밤 우리가 함께 들을 이야기는 에덴의 한가운데에서 시작됩니다"로 열고, 뱀의 질문 → 하와의 시선 변화 → 아담의 침묵 → 수치심 → "네가 어디 있느냐"라는 질문 → 현대인의 마음으로 연결하는 자연스러운 흐름을 갖고 있다. 후킹과 스토리, 교훈이 이미 어느 정도 살아있다.
- `exports/gguljam-bible-cain-envy-60min-001/script.txt`(그리고 `-segmented` 버전)는 `"우리는 [장면]이라는 장면을 [파트]의 자리에서 바라보며 [교훈 문장]라는 질문을 낮게 붙듭니다..."` 같은 템플릿 문장을 장면 이름과 교훈 문장만 바꿔 기계적으로 반복한 것이다. `"오늘 밤"`이 20회 반복되는 등(직접 카운트로 확인) 다른 품질 게이트 계획들에서 "일부러 나쁜 샘플"로 검증에 쓰인 테스트 픽스처로 보인다.
- `exports/gguljam-bible-cain-envy-20min-sample-newflow-008/script.txt`(생성기: `scripts\build_gguljam_20min_sample_export.mjs`)는 위 둘의 중간 사례다. 문장 자체는 나쁘지 않고 카인-아벨 이야기를 시간 순으로 따라가지만, 생성 방식이 `paragraphs`/`reflections`/`deepeningReflections`/`closingMeditations`/`gentleAnchors` 배열을 문단마다 이어 붙이는 구조라, 한 문단 안에서 같은 소주제를 여러 문장으로 겹쳐 쌓는 느낌이 강하다. 전체 20문단인데 공백 제외 9,115자로, `auto-video.md`가 20분 기준으로 제시한 5,000~6,000자를 크게 초과한다.

세 샘플을 종합하면: 좋은 지침(`auto-video.md`)은 있지만, 실제 생성 결과의 품질 편차가 크고(진짜 좋은 글 / 배열 조합형 중간 품질 / 완전 템플릿) 이를 자동으로 구분할 장치가 없다. 이 계획은 그 공백을 메운다.

## HPSL 챕터 구조 정의

사용자가 말한 "후킹-포인트-스토리-교훈"을, 검색으로 확인한 표준 3단 내레이션 구조(Hook-Body-Closing)와 Pixar Story Spine(욕구→붕괴→변화)을 결합하고, `꿀잠성경`의 톤 규칙(단정 대신 해석, 정죄 대신 이해)에 맞게 각 단계를 조정했다.

| 단계 | 정의 | 톤 가이드 | 길이 기준(4~6분 챕터 기준) |
|---|---|---|---|
| Hook | 챕터를 여는 질문 또는 감각적 장면. 챕터마다 새로 열어야 한다. | 자극적인 낚시가 아니라 "조용한 불편함"이어야 한다. 예: "카인은 왜 동생을 미워했을까요?"보다 "사랑하는 사람이 잘됐는데, 마음이 이상하게 작아진 밤이 있었나요?" | 1~2문장 |
| Point | 이 챕터가 다루는 심리적 질문/주제를 한 문장으로 제시. | 강의식 주제 선언이 아니라 마음 질문이어야 한다. 예: "이 장에서는 사회 비교 이론을 설명합니다"가 아니라 "비교는 왜 사실보다 해석을 더 크게 만들까요?" | 1문장 |
| Story | 성경 장면을 구체적 인물 행동·감각·대사로 그린다. | 제물, 들판, 굳어진 얼굴, 질문, 침묵, 대답, 떠남 같은 구체 장면이 시간 순서로 움직여야 한다. 묵상 문장만 쌓지 않는다. | 3~5문장 |
| Lesson | 현대인의 거울 + 조용한 위로. | 정답이나 훈계가 아니라 조용한 위로로 끝나야 한다. 예: "그러니 질투하지 마세요"가 아니라 "질투가 올라왔다는 사실보다, 그 마음을 어디로 데려갈지가 더 중요합니다." | 2~3문장 |

### 챕터 기능(Function) 다양성 규칙

챕터 제목만 바뀌고 기능이 같으면 장편이 지루해진다. 각 챕터에는 아래 기능 중 하나 이상을 배정한다.

- 사건 진행: 성경 장면이 시간상 앞으로 이동한다.
- 심리 발견: 새 심리 개념이 등장한다(챕터당 정확히 1개만 — 여러 개를 한 챕터에 넣으면 강의처럼 들린다).
- 관점 전환: 인물, 상대, 하나님, 오늘의 나 중 시점이 바뀐다.
- 정서 하강: 불안에서 위로로 내려간다.
- 질문 회수: 앞 챕터의 질문에 작은 답이 나온다.

같은 기능을 연속 챕터에서 반복하지 않는다(이 저장소가 Ken Burns 모션에 이미 쓰는 "연속 반복 금지" 원칙과 동일한 방식).

### 콘텐츠 비율 가이드(자동 게이트가 아니라 서술 규칙)

- 성경 장면: 약 40%
- 인물의 마음과 심리 해석: 약 35%
- 현대인의 공감과 위로: 약 25%

장면이 부족하면 지루하고, 심리 해석이 부족하면 채널 차별성이 약해지고, 위로가 부족하면 수면 콘텐츠의 정서가 무너진다. 이 비율은 휴리스틱으로 정밀 측정하지 않고, 대본 작성 시 사람이 참고하는 가이드로만 둔다.

### 좋은 반복 vs 나쁜 반복

수면 콘텐츠에는 반복이 필요하다. 문제는 반복 자체가 아니라 "같은 문장의 기계적 반복"이다.

- 좋은 반복(허용): 각 챕터 끝의 조용한 호흡 문장, 장면 전환 때 낮은 속도의 연결 문장, 마지막 구간의 수면 유도 리듬.
- 나쁜 반복(금지): 같은 질문을 챕터마다 그대로 재사용, "오늘 밤"/"우리 마음"/"조용히" 같은 단어의 과다 반복(세그먼트당 2회 초과), 장면 이름만 바꾸고 문장 구조를 그대로 복제.

## File Structure

- Modify: `C:\Users\petbl\auto-video\auto-video.md`
  - 챕터 흐름 규칙을 HPSL 4단계로 재정의하고, 좋은 예(`adam-eve`)와 나쁜 예(`cain-envy` 템플릿)를 나란히 보여준다. 챕터 기능 다양성, 콘텐츠 비율, 좋은/나쁜 반복 구분, 심리 개념 1개/챕터 규칙, 성경 원문 인용 규칙을 추가한다.
- Create: `C:\Users\petbl\auto-video\scripts\lib\bible-reference.mjs`
  - 개역한글판 본문 데이터를 책/장/절 단위로 조회하고, 대본에 삽입된 인용문이 원문과 정확히 일치하는지 검사.
- Create: `C:\Users\petbl\auto-video\data\bible-krv.json`
  - 개역한글판 전문을 책/장/절 단위 JSON으로 저장한 로컬 데이터(출처 표기 포함).
- Create: `C:\Users\petbl\auto-video\scripts\check_bible_citation.mjs`
  - 대본 안의 성경 인용 블록이 `bible-krv.json` 원문과 일치하는지, 개역개정판 표현이 섞이지 않았는지 검사.
- Create: `C:\Users\petbl\auto-video\scripts\lib\hpsl-structure-analysis.mjs`
  - 챕터별로 Hook/Point/Story/Lesson 각 단계와 챕터 기능이 실제로 존재하는지 휴리스틱으로 검사.
- Create: `C:\Users\petbl\auto-video\scripts\check_hpsl_structure.mjs`
  - 스크립트 파일 하나를 받아 챕터별 HPSL 판정 결과를 JSON으로 출력.
- Modify: `C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs`
  - 수면 낭독 프로필의 `targetCharsPerSecond` 기본값을 6.8에서 낮추거나 프로필을 분리한다.
- Modify: `C:\Users\petbl\auto-video\scripts\build_gguljam_20min_sample_export.mjs`
  - 세그먼트 `minParagraphs`를 전체 목표 대비 비례 배분으로 정렬한다.
- Modify: `C:\Users\petbl\auto-video\scripts\check_script_quality_suite.mjs`
  - (script-quality-upgrade 계획 구현 이후) HPSL 분석을 스위트에 포함한다.
- Modify: `C:\Users\petbl\auto-video\scripts\generate_script_revision_brief.mjs`
  - HPSL 실패 챕터를 재작성 브리프에 구체적으로 지시한다.

**의존성 안내:** 이 계획은 `docs/superpowers/plans/2026-07-01-script-quality-upgrade.md`(아직 미구현)가 만드는 `scripts/lib/script-structure-analysis.mjs`의 `splitChapters`/`splitKoreanSentences`를 재사용한다. 두 계획 중 어느 쪽이 먼저 실행되어도 되지만, `check_script_quality_suite.mjs` 통합(Task 5)은 그 계획이 먼저 구현된 뒤 진행한다.

---

### Task 1: Add HPSL Structure Analyzer

**Files:**
- Create: `C:\Users\petbl\auto-video\scripts\lib\hpsl-structure-analysis.mjs`

- [ ] **Step 1: Create HPSL analyzer**

Create `C:\Users\petbl\auto-video\scripts\lib\hpsl-structure-analysis.mjs`:

```js
import { splitChapters, splitKoreanSentences } from "./script-structure-analysis.mjs";

const HOOK_PATTERNS = [/[?？]\s*$/u, /까요[.!?？]?\s*$/u, /습니다\s*[.]?\s*$/u];
const POINT_MARKERS = ["질문", "라는 것을", "무엇일까", "어떻게", "왜"];
const STORY_ACTION_HINTS = [
  "손", "얼굴", "발걸음", "숨", "눈", "목소리", "걸었", "앉았", "바라보", "만졌",
  "뛰었", "열었", "닫았", "울었", "웃었", "속삭", "물었",
];
const LESSON_MARKERS = ["까요", "봅니다", "위로", "괜찮습니다", "함께", "조용히"];

function firstSentence(sentences) {
  return sentences[0] || "";
}

function lastSentences(sentences, count = 2) {
  return sentences.slice(-count);
}

function containsAny(text, markers) {
  return markers.some((marker) => text.includes(marker));
}

function hasHook(sentences) {
  const first = firstSentence(sentences);
  if (!first) return false;
  return HOOK_PATTERNS.some((pattern) => pattern.test(first)) || first.length <= 60;
}

function hasPoint(sentences) {
  const window = sentences.slice(0, 3).join(" ");
  return containsAny(window, POINT_MARKERS);
}

function hasStoryBeat(sentences) {
  const body = sentences.slice(1, -2).join(" ");
  const hintCount = STORY_ACTION_HINTS.filter((hint) => body.includes(hint)).length;
  return hintCount >= 2;
}

function hasLesson(sentences) {
  const window = lastSentences(sentences, 3).join(" ");
  return containsAny(window, LESSON_MARKERS);
}

export function analyzeChapterHpsl(chapterText) {
  const sentences = splitKoreanSentences(chapterText);
  const hook = hasHook(sentences);
  const point = hasPoint(sentences);
  const story = hasStoryBeat(sentences);
  const lesson = hasLesson(sentences);
  const missing = [];
  if (!hook) missing.push("hook");
  if (!point) missing.push("point");
  if (!story) missing.push("story");
  if (!lesson) missing.push("lesson");
  return {
    ok: missing.length === 0,
    missing,
    sentenceCount: sentences.length,
    hook,
    point,
    story,
    lesson,
  };
}

export function analyzeScriptHpsl(text, options = {}) {
  const minChapterPassRate = options.minChapterPassRate ?? 0.8;
  const chapters = splitChapters(text);
  const chapterReports = chapters.map((chapter, index) => {
    const body = chapter.paragraphs.join("\n\n");
    const hpsl = analyzeChapterHpsl(body);
    return { index: index + 1, title: chapter.title, ...hpsl };
  });
  const passCount = chapterReports.filter((chapter) => chapter.ok).length;
  const passRate = chapterReports.length ? passCount / chapterReports.length : 0;
  const failures = [];
  if (!chapterReports.length) failures.push("no_chapters_found");
  if (chapterReports.length && passRate < minChapterPassRate) {
    failures.push(`hpsl_pass_rate_too_low:${passRate.toFixed(2)}<${minChapterPassRate}`);
  }
  const weakestChapters = chapterReports
    .filter((chapter) => !chapter.ok)
    .slice(0, 10);
  return {
    ok: failures.length === 0,
    failures,
    chapterCount: chapterReports.length,
    passRate: Number(passRate.toFixed(3)),
    weakestChapters,
    chapters: chapterReports,
  };
}
```

주의: 이 휴리스틱은 정규식/키워드 기반이라 완벽하지 않다. 목적은 "완전 판정"이 아니라, `cain-envy` 샘플처럼 노골적으로 후킹·스토리가 죽은 템플릿 대본을 렌더 전에 걸러내는 안전망이다.

- [ ] **Step 2: Run syntax check**

Run:

```powershell
node --check C:\Users\petbl\auto-video\scripts\lib\hpsl-structure-analysis.mjs
```

Expected: exit code `0` (단, `script-structure-analysis.mjs`가 아직 없으면 import 오류가 나므로, script-quality-upgrade 계획의 Task 1을 먼저 실행한다).

---

### Task 2: Add Standalone HPSL Checker CLI

**Files:**
- Create: `C:\Users\petbl\auto-video\scripts\check_hpsl_structure.mjs`

- [ ] **Step 1: Create CLI**

Create `C:\Users\petbl\auto-video\scripts\check_hpsl_structure.mjs`:

```js
#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { analyzeScriptHpsl } from "./lib/hpsl-structure-analysis.mjs";

const options = parseArgs(process.argv.slice(2));
if (!options.scriptPath) {
  console.error("Usage: node scripts/check_hpsl_structure.mjs <script.txt> [--out report.json] [--min-pass-rate 0.8]");
  process.exit(2);
}

const text = readFileSync(options.scriptPath, "utf8");
const report = analyzeScriptHpsl(text, { minChapterPassRate: options.minPassRate ?? 0.8 });

if (options.out) {
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, JSON.stringify(report, null, 2), "utf8");
}
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!parsed.scriptPath && !arg.startsWith("--")) parsed.scriptPath = arg;
    else if (arg === "--out") parsed.out = args[++index];
    else if (arg === "--min-pass-rate") parsed.minPassRate = Number(args[++index]);
  }
  return parsed;
}
```

- [ ] **Step 2: Run syntax check**

```powershell
node --check C:\Users\petbl\auto-video\scripts\check_hpsl_structure.mjs
```

- [ ] **Step 3: Confirm the checker distinguishes across all three known samples**

```powershell
node C:\Users\petbl\auto-video\scripts\check_hpsl_structure.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-adam-eve-001\script.txt
node C:\Users\petbl\auto-video\scripts\check_hpsl_structure.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-20min-sample-newflow-008\script.txt
node C:\Users\petbl\auto-video\scripts\check_hpsl_structure.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-001\script.txt
```

Expected: `cain-envy-60min-001`은 후킹/스토리 판정에서 뚜렷하게 낮은 통과율을 보여야 한다. `cain-envy-20min-sample-newflow-008`은 챕터 헤더가 없어 전체가 챕터 1개로 취급되므로 판정이 거칠 수 있다 — 이 경우 Task 4에서 챕터 헤더 요구 규칙을 함께 점검한다. 결과가 예상과 다르면 Task 1의 휴리스틱 임계값을 조정한다.

---

### Task 3: Align Segment vs Whole-Script Quality Budgets

**Files:**
- Modify: `C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs`
- Modify: `C:\Users\petbl\auto-video\scripts\build_gguljam_20min_sample_export.mjs`

검토 의견서에서 확인된 실제 문제: `build_segmented_storyboards.mjs`의 `targetCharsPerSecond` 기본값 6.8은 `auto-video.md`의 20분 기준 5,000~6,000자(약 4.2~5.0자/초)보다 높고, `build_gguljam_20min_sample_export.mjs`의 세그먼트별 `minParagraphs: Math.max(8, Math.round(segment.durationSeconds / 60))`는 전체 기준(라이브러리 기본값 90)보다 훨씬 느슨해서, 세그먼트 단위로는 통과하지만 전체로 보면 문단 밀도가 부족한 대본이 렌더까지 갈 수 있다.

- [ ] **Step 1: Lower the sleep-narration default character budget**

`build_segmented_storyboards.mjs`의 `targetCharsPerSecond` 기본값을 `6.8`에서 `5.2`로 낮추고, 빠른 정보형 콘텐츠가 필요할 때는 `--target-chars-per-second 6.8` 같은 명시적 override를 쓰도록 주석을 남긴다.

- [ ] **Step 2: Align segment minParagraphs to a proportional share of the whole-script target**

`build_gguljam_20min_sample_export.mjs`의 세그먼트 품질 검사에서 `minParagraphs`를 아래처럼 전체 목표 문단 수에서 세그먼트 길이 비율만큼 배분하도록 바꾼다.

```js
const wholeScriptMinParagraphs = 90; // quality-gates.mjs 기본값과 동일하게 맞춘다
const segmentMinParagraphs = Math.max(
  8,
  Math.round((segment.durationSeconds / targetSeconds) * wholeScriptMinParagraphs),
);
```

- [ ] **Step 3: Run syntax checks**

```powershell
node --check C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs
node --check C:\Users\petbl\auto-video\scripts\build_gguljam_20min_sample_export.mjs
```

---

### Task 4: Update `auto-video.md` Chapter Rule to HPSL

**Files:**
- Modify: `C:\Users\petbl\auto-video\auto-video.md`

- [ ] **Step 1: Replace/extend the chapter flow rule**

`auto-video.md`의 "각 챕터는 '장면 묘사 → 갈등 또는 질문 → 해석 → 오늘의 의미' 흐름을 갖게 한다" 문장 바로 뒤에 아래 블록을 추가한다.

```markdown
### 챕터 내부 HPSL 구조

각 챕터는 아래 4단계를 이 순서로 갖는다. 이미 있는 "장면 묘사 → 갈등 또는 질문 → 해석 → 오늘의 의미" 규칙을 대체하지 않고, 각 단계를 더 구체적으로 요구한다.

1. **Hook(후킹)**: 챕터를 여는 질문이나 감각적인 한 장면. 자극적인 낚시가 아니라 조용한 불편함이어야 한다.
2. **Point(포인트)**: 이 챕터가 다룰 심리적 질문을 한 문장으로 제시한다. 강의식 주제 선언이 아니라 마음 질문으로 쓴다.
3. **Story(스토리)**: 성경 장면을 추상적으로 설명하지 않고 구체적 행동·감각·표정으로 그린다. 묵상 문장만 쌓지 않는다.
4. **Lesson(교훈)**: 오늘의 거울 + 위로. 정답을 주지 않고 성찰 질문이나 조용한 위로 문장으로 닫는다.

같은 도입 문장 템플릿(예: "우리는 OO이라는 장면을 OO의 자리에서 바라보며")을 장면 이름만 바꿔 챕터마다 반복하지 않는다.

### 챕터 기능 다양성

각 챕터에는 사건 진행/심리 발견/관점 전환/정서 하강/질문 회수 중 하나 이상의 기능을 배정하고, 같은 기능을 연속 챕터에서 반복하지 않는다. 심리학 개념은 챕터당 정확히 1개만 다룬다.

### 콘텐츠 비율

성경 장면 약 40%, 심리 해석 약 35%, 위로 약 25%를 기준으로 삼는다. 장면이 부족하면 지루해지고, 해석이 부족하면 채널 차별성이 약해지고, 위로가 부족하면 수면 정서가 무너진다.

### 좋은 반복 vs 나쁜 반복

챕터 끝의 조용한 호흡 문장, 장면 전환 연결 문장, 마지막 구간의 수면 유도 리듬 같은 "역할이 있는 반복"은 허용한다. 같은 질문을 챕터마다 그대로 쓰거나, "오늘 밤"/"우리 마음"/"조용히" 같은 단어를 세그먼트당 2회 넘게 쓰거나, 장면 이름만 바꾼 동일 문장 구조를 반복하는 것은 금지한다.
```

- [ ] **Step 2: Add a good-vs-bad example pair**

같은 섹션 아래에 아래 블록을 추가한다.

```markdown
### 좋은 예 / 나쁜 예

좋은 예(`gguljam-bible-adam-eve-001`, 실제 대본):

> 오늘 밤 우리가 함께 들을 이야기는 에덴의 한가운데에서 시작됩니다. 이곳은 아무것도 부족하지 않은 곳처럼 보였지만, 인간의 마음은 이미 질문을 품을 수 있었습니다.

나쁜 예(템플릿 반복, 절대 이렇게 쓰지 않는다):

> 우리는 [장면 이름]이라는 장면을 [파트 이름]의 자리에서 바라보며 [교훈 문장]라는 질문을 낮게 붙듭니다.

나쁜 예는 장면 이름과 교훈 문장만 바꿔 슬롯을 채운 문장이다. 이런 문장이 검수에서 발견되면 챕터를 다시 쓴다.
```

- [ ] **Step 3: Verify the sections exist**

```powershell
Select-String -Path C:\Users\petbl\auto-video\auto-video.md -Pattern "챕터 내부 HPSL 구조"
Select-String -Path C:\Users\petbl\auto-video\auto-video.md -Pattern "챕터 기능 다양성"
Select-String -Path C:\Users\petbl\auto-video\auto-video.md -Pattern "좋은 예 / 나쁜 예"
```

Expected: 세 헤딩 모두 한 번씩만 나온다.

---

### Task 5: Integrate HPSL Check Into the Quality Suite (script-quality-upgrade 계획 구현 이후)

**Files:**
- Modify: `C:\Users\petbl\auto-video\scripts\check_script_quality_suite.mjs`
- Modify: `C:\Users\petbl\auto-video\scripts\generate_script_revision_brief.mjs`

- [ ] **Step 1: Add HPSL analysis to the suite**

`check_script_quality_suite.mjs`의 import에 추가:

```js
import { analyzeScriptHpsl } from "./lib/hpsl-structure-analysis.mjs";
```

`semanticOverlap` 계산 직후에 추가:

```js
const hpsl = analyzeScriptHpsl(text, { minChapterPassRate: options.minHpslPassRate ?? 0.8 });
```

`failures` 배열에 추가:

```js
  ...(hpsl.ok ? [] : hpsl.failures.map((value) => `hpsl:${value}`)),
```

`report` 객체에 `hpsl` 필드를 추가한다.

- [ ] **Step 2: Feed HPSL weak chapters into the revision brief**

`generate_script_revision_brief.mjs`의 "Chapter Direction" 섹션 뒤에 추가:

```js
lines.push("## HPSL Weak Chapters");
for (const chapter of report.hpsl?.weakestChapters || []) {
  lines.push(`- Chapter ${chapter.index} (${chapter.title}): missing ${chapter.missing.join(", ")}`);
}
lines.push("");
```

- [ ] **Step 3: Run syntax checks**

```powershell
node --check C:\Users\petbl\auto-video\scripts\check_script_quality_suite.mjs
node --check C:\Users\petbl\auto-video\scripts\generate_script_revision_brief.mjs
```

- [ ] **Step 4: Confirm the suite flags the templated sample and passes the good sample**

```powershell
node C:\Users\petbl\auto-video\scripts\check_script_quality_suite.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-001\script.txt
```

Expected: exit code `1`, failures include at least one `hpsl:` entry.

---

### Task 6: Add Bible Original Text Citation (개역한글판)

**Files:**
- Create: `C:\Users\petbl\auto-video\data\bible-krv.json`
- Create: `C:\Users\petbl\auto-video\scripts\lib\bible-reference.mjs`
- Create: `C:\Users\petbl\auto-video\scripts\check_bible_citation.mjs`
- Modify: `C:\Users\petbl\auto-video\auto-video.md`

**저작권 전제 조건:** 이 태스크는 반드시 개역한글판(1961년 발행, 저작권 만료 2011년 말)만 사용한다. 개역개정판(1998년 발행, 저작권 존속)은 절대 원문 데이터로 쓰지 않는다.

- [ ] **Step 1: Prepare the source data**

`C:\Users\petbl\auto-video\data\bible-krv.json`을 아래 구조로 준비한다. 원문은 대한성서공회 공식 채널이나 신뢰할 수 있는 개역한글 텍스트 덤프에서 받아 그대로(글자 하나도 바꾸지 않고) 옮긴다.

```json
{
  "translation": "개역한글판",
  "source": "대한성서공회 (저작권 만료 2011년 말, 2012년부터 자유 이용 가능; 동일성유지권·성명표시권 준수)",
  "books": {
    "창세기": {
      "4": {
        "3": "세월이 지난 후에 가인은 땅의 소산으로 여호와께 제물을 드렸고",
        "4": "아벨은 자기도 양의 첫 새끼와 그 기름으로 드렸더니 여호와께서 아벨과 그 제물은 열납하셨으나",
        "5": "가인과 그 제물은 열납하지 아니하신지라 가인이 심히 분하여 안색이 변하니"
      }
    }
  }
}
```

- [ ] **Step 2: Create the reference lookup module**

Create `C:\Users\petbl\auto-video\scripts\lib\bible-reference.mjs`:

```js
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dataPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "bible-krv.json");

let cached = null;
function loadBible() {
  if (!cached) cached = JSON.parse(readFileSync(dataPath, "utf8"));
  return cached;
}

export function parseReference(reference) {
  const match = String(reference || "").match(/^(.+?)\s*(\d+)[:장]\s*(\d+)(?:-(\d+))?$/u);
  if (!match) throw new Error(`Invalid bible reference: ${reference}`);
  const [, book, chapter, startVerse, endVerse] = match;
  return {
    book: book.trim(),
    chapter,
    startVerse: Number(startVerse),
    endVerse: Number(endVerse || startVerse),
  };
}

export function lookupVerses(reference) {
  const bible = loadBible();
  const { book, chapter, startVerse, endVerse } = parseReference(reference);
  const chapterVerses = bible.books?.[book]?.[chapter];
  if (!chapterVerses) throw new Error(`Missing chapter in bible-krv.json: ${book} ${chapter}`);
  const verses = [];
  for (let verse = startVerse; verse <= endVerse; verse += 1) {
    const text = chapterVerses[String(verse)];
    if (!text) throw new Error(`Missing verse in bible-krv.json: ${book} ${chapter}:${verse}`);
    verses.push({ verse, text });
  }
  return { book, chapter, translation: bible.translation, verses };
}

export function formatCitation(reference) {
  const { book, chapter, translation, verses } = lookupVerses(reference);
  const body = verses.map((v) => `${v.verse}. ${v.text}`).join(" ");
  return `${book} ${chapter}장 ${verses[0].verse}${verses.length > 1 ? `-${verses.at(-1).verse}` : ""}절, ${translation}\n"${body}"`;
}
```

- [ ] **Step 3: Create the citation-integrity checker**

Create `C:\Users\petbl\auto-video\scripts\check_bible_citation.mjs`:

```js
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { lookupVerses } from "./lib/bible-reference.mjs";

const scriptPath = process.argv[2];
if (!scriptPath) {
  console.error("Usage: node scripts/check_bible_citation.mjs <script.txt>");
  process.exit(2);
}

const text = readFileSync(scriptPath, "utf8");
const citationBlocks = [...text.matchAll(/\[성경인용:([^\]]+)\]\s*"([^"]+)"/g)];
const failures = [];

for (const [, reference, quoted] of citationBlocks) {
  try {
    const { verses } = lookupVerses(reference.trim());
    const expected = verses.map((v) => v.text).join(" ");
    const normalize = (value) => value.replace(/\s+/g, " ").trim();
    if (normalize(quoted) !== normalize(expected)) {
      failures.push(`${reference}: quoted text does not match 개역한글판 source verbatim`);
    }
  } catch (error) {
    failures.push(`${reference}: ${error.message}`);
  }
}

const result = { ok: failures.length === 0, failures, citationCount: citationBlocks.length };
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
```

이 검사는 대본 안에 `[성경인용:창세기 4:3-5] "..."` 형태로 표시된 인용 블록만 검사한다. 대본 작성 규칙(Step 4)에서 이 표기법을 사용하도록 명시한다.

- [ ] **Step 4: Add the citation rule to `auto-video.md`**

`auto-video.md`의 "챕터 내부 HPSL 구조" 섹션 뒤에 아래 블록을 추가한다.

```markdown
### 성경 원문 인용 규칙

각 챕터의 Story 단계에는 짧은 성경 원문 인용을 최소 1회 포함할 수 있다.

- 인용 번역본은 **개역한글판만** 사용한다. 개역개정판은 아직 대한성서공회 저작권이 살아 있으므로 쓰지 않는다.
- 인용 표기는 `[성경인용:책 장:절] "원문"` 형식을 쓴다. 예: `[성경인용:창세기 4:3-5] "세월이 지난 후에 가인은..."`
- 원문은 절대 다듬거나 현대어로 바꾸지 않는다(동일성유지권). 대본 해설 문장과 원문 인용은 분리해서 쓴다.
- 영상 설명란이나 크레딧에 "성경 인용: 개역한글판, 대한성서공회"를 표시한다(성명표시권).
- 렌더 전 `check_bible_citation.mjs`로 인용문이 원문과 정확히 일치하는지 확인한다.
```

- [ ] **Step 5: Run syntax checks**

```powershell
node --check C:\Users\petbl\auto-video\scripts\lib\bible-reference.mjs
node --check C:\Users\petbl\auto-video\scripts\check_bible_citation.mjs
```

- [ ] **Step 6: Verify with a small sample citation**

`data/bible-krv.json`에 Step 1 예시 데이터를 넣은 상태에서, 테스트용 대본에 아래 줄을 추가하고 검사한다.

```text
[성경인용:창세기 4:3-5] "세월이 지난 후에 가인은 땅의 소산으로 여호와께 제물을 드렸고 아벨은 자기도 양의 첫 새끼와 그 기름으로 드렸더니 여호와께서 아벨과 그 제물은 열납하셨으나 가인과 그 제물은 열납하지 아니하신지라 가인이 심히 분하여 안색이 변하니"
```

```powershell
node C:\Users\petbl\auto-video\scripts\check_bible_citation.mjs <test-script-path>
```

Expected: `"ok": true`, `"citationCount": 1`. 인용문 한 글자라도 원문과 다르면 실패해야 한다(동일성유지권 검증 목적).

---

## Verification

```powershell
node --check C:\Users\petbl\auto-video\scripts\lib\hpsl-structure-analysis.mjs
node --check C:\Users\petbl\auto-video\scripts\check_hpsl_structure.mjs
node C:\Users\petbl\auto-video\scripts\check_hpsl_structure.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-adam-eve-001\script.txt
node C:\Users\petbl\auto-video\scripts\check_hpsl_structure.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-001\script.txt
node --check C:\Users\petbl\auto-video\scripts\lib\bible-reference.mjs
node --check C:\Users\petbl\auto-video\scripts\check_bible_citation.mjs
Select-String -Path C:\Users\petbl\auto-video\auto-video.md -Pattern "챕터 내부 HPSL 구조"
Select-String -Path C:\Users\petbl\auto-video\auto-video.md -Pattern "성경 원문 인용 규칙"
```

## Risk Notes

- 성경 원문 인용은 반드시 개역한글판만 쓴다. 개역개정판이나 다른 저작권 있는 번역본 텍스트가 `data/bible-krv.json`에 섞여 들어가지 않도록, 데이터를 추가할 때마다 번역본 출처를 재확인한다.
- `data/bible-krv.json`은 전체 성경을 한 번에 다 넣을 필요가 없다. 실제로 인용하는 챕터/구절만 그때그때 추가하는 점진적 방식으로 관리한다.

- 휴리스틱 판정은 문장 패턴/키워드 기반이라 오탐과 미탐이 둘 다 있을 수 있다. 처음에는 `warn` 수준으로 도입하고, 실제 대본 몇 개를 더 돌려본 뒤 실패 기준으로 승격하는 것을 권한다.
- `splitChapters`는 `#`, `제N장`, `챕터N` 같은 마커에 의존한다. `cain-envy-20min-sample-newflow-008`처럼 챕터 헤더가 없는 대본은 전체가 챕터 1개로 취급되어 HPSL 판정이 부정확해질 수 있다 — 대본 작성 시 챕터 헤더를 반드시 남기는 규칙과 함께 적용해야 한다.
- 이 계획은 "이야기가 실제로 재미있는가"까지는 보장하지 못한다. 정량 게이트는 최소 안전망이고, 최종 판단은 여전히 사람이 대본을 읽고 확인해야 한다.
- (보류) "대본만 먼저 듣기" 오디오 프리뷰 산출물과 LLM-as-judge 2차 게이트는 검토 의견서에서 제안됐고 방향은 합리적이지만, 이 계획의 범위(HPSL 챕터 구조) 밖이라 별도 계획으로 다룬다.

## Self-Review

- Spec coverage: 컨셉 검증(웹 검색 근거 포함), HPSL 구조 정의, 실제 저장소 샘플 세 종류 대조, 대본 예산/세그먼트 정렬 문제 수정, 운영 문서 갱신, 자동 검증 게이트, 재작성 브리프 연동, 성경 원문 인용(개역한글판) 통합과 저작권 검증을 모두 다룬다.
- Placeholder scan: TBD/TODO 없음. 모든 경로는 실제 저장소 경로다.
- Dependency check: `hpsl-structure-analysis.mjs`가 아직 존재하지 않는 `script-structure-analysis.mjs`를 참조하므로, 이 계획은 `2026-07-01-script-quality-upgrade.md`와 함께 또는 그 이후에 실행해야 한다는 점을 File Structure와 Task 1에 명시했다.
- Opinion review: `2026-07-01-hpsl-narrative-quality-opinion.md`의 주장을 코드/파일로 직접 검증해 타당한 항목만 반영했고, UTF-8 손상 주장처럼 검증 결과 사실이 아닌 항목은 반영하지 않았다(위 "검토 의견서 반영 내역" 참고).
- Copyright check: 성경 원문 인용은 웹 검색으로 확인한 저작권 사실(개역한글판은 저작권 만료, 개역개정판은 저작권 존속)에 근거해 개역한글판만 쓰도록 Task 6과 `auto-video.md` 규칙에 명시했다.
