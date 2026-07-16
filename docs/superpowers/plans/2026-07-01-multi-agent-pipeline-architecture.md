# Multi-Agent Pipeline Architecture Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `auto-video` 파이프라인(채널 분석 → 대본 설계/작성 → 품질 검수 → 비주얼 프롬프트 → 렌더/QA)을 하나의 거대한 세션이 처음부터 끝까지 다 하는 대신, 역할별로 분리된 에이전트가 명확한 산출물(JSON/MD 계약)을 주고받는 오케스트레이터 구조로 재편할지 판단하고, 타당하면 실행 계획을 만든다.

**결론(먼저):** **분리하는 것이 이 프로그램에는 실제로 이득이다.** 다만 모든 영상에 적용할 필요는 없고, 20분 미만 단편은 지금처럼 단일 세션으로 충분하다. 40분 이상 장편·세그먼트 렌더 파이프라인부터 분리 효과가 커진다. 아래에 근거와 구체적 설계를 남긴다.

**Architecture:** 오케스트레이터(사용자가 대화하는 메인 세션) 1개가 역할별 서브에이전트를 fan-out으로 호출하고, 각 서브에이전트는 이미 이 저장소가 만들어 온 JSON/MD 산출물(`chapters.json`, `script-quality-suite-report.json`, `visual-timeline.json`, `assembly-report.json` 등)을 계약으로 주고받는다. 이 저장소는 이미 "결정론적 검증은 스크립트, 창작은 LLM"이라는 분리를 상당 부분 해놨기 때문에, 에이전트 분리는 자연스러운 다음 단계에 가깝다.

**Tech Stack:** Codex/Cowork/Claude Code의 Agent(subagent) 도구, 기존 Node.js 게이트 스크립트, Hermes Studio 로컬 파이프라인, DuckDB visual memory, JSON/Markdown 산출물 계약.

---

## Research Summary

- Anthropic의 멀티에이전트 리서치 시스템 사례는 "orchestrator가 조율하고 전문화된 서브에이전트가 병렬로 위임받아 작업하는" 구조가 가장 폭넓은 문제에 가장 적은 조율 비용으로 대응한다고 설명한다. Source: https://www.anthropic.com/engineering/multi-agent-research-system
- Claude Code 공식 문서와 관련 글들은 "서브에이전트는 빠르고 집중된 워커로 결과만 보고받는 용도, 에이전트 팀은 서로 결과를 공유하고 자율 조율이 필요할 때"로 구분한다. 이 저장소의 파이프라인은 단계 간 결과물이 명확히 순차 의존적이라 "팀"보다 "오케스트레이터-서브에이전트" 패턴에 가깝다. Source: https://claude.com/blog/multi-agent-coordination-patterns, https://www.mindstudio.ai/blog/claude-code-agent-teams-vs-sub-agents
- 실전 AI 영상 제작 파이프라인(ViMax 등)은 이미 업계 표준으로 Writer(대본) → Director/Storyboard → Cinematographer(카메라/조명 프롬프트) → Animator(모션/렌더) 역할 분리를 쓰고, 렌더 전에 정적 스토리보드 검수를 QA 레이어로 넣는다. 이는 지금 이 저장소가 이미 하고 있는 "렌더 전 품질 게이트" 설계와 정확히 같은 방향이다. Source: https://github.com/HKUDS/ViMax, https://medium.com/@jengas/dissecting-an-autonomous-ai-filmmaking-pipeline-0192b7a69636
- 공통적으로 강조되는 원칙: 서브에이전트에는 스키마가 있는 구조화된 출력을 강제하고, 오케스트레이터는 위임을 명확히 지시해야 하며, fan-out → reduce → synthesize 패턴이 병렬 처리에 잘 맞는다.

## Current Codebase Verification Update

2026-07-01 현재 코드베이스를 다시 확인한 결과, 이 계획의 초안과 달라진 점이 있다.

- `auto-video`에는 이제 `scripts/check_script_quality_suite.mjs`, `scripts/generate_script_revision_brief.mjs`, `scripts/check_hpsl_structure.mjs`, `scripts/lib/script-structure-analysis.mjs`, `scripts/lib/semantic-overlap-analysis.mjs`, `scripts/lib/hpsl-structure-analysis.mjs`가 존재한다. 따라서 품질 검수 에이전트는 단순 반복 검사(`check_longform_script_quality.mjs`)가 아니라 통합 품질 스위트와 HPSL 리포트를 1차 계약으로 사용해야 한다.
- `scripts/build_segmented_storyboards.mjs`는 `script-quality-suite-report.json`을 생성하지만 현재 내부 suite에는 HPSL 결과가 포함되지 않는다. 별도 CLI인 `check_script_quality_suite.mjs`에는 HPSL이 포함되어 있으므로 두 경로의 품질 기준이 어긋난다. 장편 렌더 전에는 HPSL 포함 suite가 반드시 같은 기준으로 실행되어야 한다.
- `auto-video.md`에는 아직 `에이전트별 참조 범위`와 `단일 세션 vs 멀티 에이전트 선택 기준`이 없다. 또한 `docs/agent-handoff-contract.md`, `docs/agent-invocation-templates.md`도 아직 없다.
- `research.md`, `timeline.md`, DB 파일은 `auto-video` 루트가 아니라 `C:\Users\petbl\hermes-studio` 쪽에서 발견된다. `research.md`는 존재하지만 `timeline.md`는 현재 검색되지 않았다.
- Hermes Studio에는 `C:\Users\petbl\hermes-studio\hermes-local\data\visual-memory.duckdb`가 있고, `lib/visual-memory/duckdb-store.mjs`가 `jobs`, `visual_scenes`, `visual_avoid_patterns` 테이블을 관리한다.
- DuckDB visual memory는 현재 장시간 실행 중인 Node 프로세스가 파일을 잡고 있어 직접 쿼리 시 `Cannot open file ... 다른 프로세스가 파일을 사용 중` 오류가 발생했다. 멀티에이전트 구조에서 각 에이전트가 직접 DB를 열면 같은 잠금 충돌이 반복될 수 있다.
- Hermes의 `lib/pipeline/artifact-discovery.mjs`는 `research.md`, `timeline.md`, `.db/.sqlite/.duckdb`를 발견하고, `timeline.md`가 없으면 warning을 남긴다. 이 결과는 렌더/운영 에이전트의 사전 조건으로 활용해야 한다.

## 왜 지금 분리하는 게 이 프로그램에 유리한가

1. **`auto-video.md`가 이미 너무 많은 관심사를 한 문서에 섞고 있다.** 채널 브랜딩/톤, NotebookLM 백업 질문, 챕터별 HPSL 작문 규칙, 성경 저작권 규칙, Ken Burns 모션 수식, CapCut export 명령어까지 633줄 안에 다 있다. 이미지 프롬프트를 쓸 때 성경 저작권 규칙을 계속 컨텍스트에 들고 있을 필요가 없고, 렌더 명령을 실행할 때 채널 톤 가이드를 들고 있을 필요가 없다.
2. **저장소가 이미 단계 간 산출물을 JSON/MD로 명확히 분리해 두었다.** `segment-manifest.json`, `production.json`, `script-quality-suite-report.json`, `script-revision-brief.md`, `visual-timeline.json`, `assembly-report.json`, `capcut-draft-manifest.json` — 이건 사람이 읽으라고 만든 게 아니라 사실상 이미 "에이전트 간 계약(contract)" 형태다. 에이전트를 분리해도 새로 설계할 게 거의 없다.
3. **세그먼트 렌더링이 이미 병렬화 가능한 구조다.** 60분 영상은 이미 15분 세그먼트 4개로 쪼개져 있고, 각 세그먼트는 독립적으로 `script.txt`/`visual-timeline.json`/`final.mp4`를 갖는다. 세그먼트별로 대본 작성/검수/스토리보드/렌더를 병렬 서브에이전트에 맡기면 전체 제작 시간이 크게 줄어든다.
4. **창작 스킬과 기술 운영 스킬이 실제로 다르다.** 대본 작성(HPSL, 톤, 위로)과 ffmpeg/Hermes 렌더 디버깅(zoompan, 세그먼트 병합, 스트림 프로파일 검증)은 요구되는 사고방식이 다르다. 지금처럼 한 세션이 둘 다 하면, 렌더 디버깅 도중 대본 톤 감각이 흐려지거나 그 반대가 되기 쉽다.
5. **이미 이 저장소의 모든 계획 문서가 "superpowers:subagent-driven-development"를 권장 스킬로 명시하고 있다.** 즉 이 프로그램의 운영 방식 자체가 이미 서브에이전트 지향이다. 콘텐츠 제작 워크플로우만 아직 그 패턴을 못 따라가고 있는 상태다.

## 언제 분리하지 않는 게 나은가

- 20분 미만 단편이나 파일럿 대본은 오케스트레이션 오버헤드가 이득보다 크다. 지금처럼 단일 세션으로 진행한다.
- 급하게 톤/스타일을 잡아가는 초기 탐색 단계(1~2단계, 주제 확정 전)는 사람과의 빠른 왕복 대화가 중요해서 굳이 서브에이전트로 넘기지 않는다.

---

## 제안하는 에이전트 역할

| 에이전트 | 담당 단계 | 입력 | 출력 | 필요한 `auto-video.md` 범위 |
|---|---|---|---|---|
| **기획 에이전트** | 1~2단계 | 채널 스크린샷, 벤치마킹 자막 원고 | `style-brief.json`(채널 문체/감정곡선/제목패턴), 주제 확정 | 채널 기본 방향, 1~2단계, 성경·심리학 톤 우선순위 |
| **대본 설계 에이전트** | 3단계 앞부분 | `style-brief.json`, 주제 | `chapters.json`(챕터별 title/HPSL beats/기능 태그/심리개념/성경 인용 참조) | 장편 챕터 확장 규칙, HPSL 구조, 챕터 기능 다양성, 콘텐츠 비율 |
| **대본 작성 에이전트** | 3단계 본문 (세그먼트/챕터 묶음 단위로 병렬 가능) | `chapters.json`의 담당 챕터 묶음 | `script.txt`(세그먼트별) | 대본 작성 규칙, 좋은/나쁜 반복, 성경 원문 인용 규칙, 좋은 예/나쁜 예 |
| **품질 검수 에이전트** | 3단계 완료 후 | `script.txt` | `script-quality-suite-report.json`, 실패 시 `script-revision-brief.md` | 대본 품질 규칙 전체(이미 스크립트로 구현되어 있어 대부분 툴 호출) |
| **비주얼 프롬프트 에이전트** | 4단계 | 확정된 `script.txt`, 장면 이미지 예시 | `hermes-manual-storyboard.md`, `visual-timeline.json` | 4단계 전체, 장편 영상 화면 모션 규칙 |
| **렌더/운영 에이전트** | 렌더~최종 검증 | storyboard, production.json | `final.mp4`, `assembly-report.json`, `capcut-draft-manifest.json` | 세그먼트 렌더링 규칙, 품질 게이트, CapCut QA, 모션 규칙 |

품질 검수 에이전트는 사실상 결정론적 스크립트(`check_script_quality_suite.mjs` 등) 호출이 대부분이라 "에이전트"라기보다 오케스트레이터가 직접 실행해도 되지만, 실패 시 재작성 브리프를 대본 작성 에이전트에게 되돌리는 재시도 루프(fan-out → 검수 → 실패 시 재작성)의 조율 지점으로 역할을 명시해 둔다.

## File Structure

- Modify: `C:\Users\petbl\auto-video\auto-video.md`
  - 문서 맨 앞에 "에이전트별 참조 범위" 표를 추가한다(문서를 쪼개지 않고, 각 에이전트가 어느 섹션만 읽으면 되는지 안내).
- Create or update: `C:\Users\petbl\auto-video\docs\agent-handoff-contract.md`
  - 에이전트 간 입출력 계약(파일명, 스키마, 필수 필드)을 한곳에 정리. Hermes `research.md`, `timeline.md`, `visual-memory.duckdb`는 직접 수정 대상이 아니라 읽기 전용 외부 컨텍스트로 명시한다.
- Create or update: `C:\Users\petbl\auto-video\docs\agent-invocation-templates.md`
  - 각 에이전트를 호출할 때 쓸 프롬프트 템플릿(담당 범위, 참조할 `auto-video.md` 섹션, 입력/출력 파일 경로).
- Create or update: `C:\Users\petbl\auto-video\docs\pipeline-artifact-map.md`
  - `auto-video` 산출물과 Hermes Studio 산출물(`research.md`, `artifact-discovery-report.json`, `llm-summary.json`, `performance-budget-report.json`, visual-memory DB)을 단계별로 매핑한다.
- Modify: `C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs`
  - 세그먼트별 `script-quality-suite-report.json`에 HPSL 결과를 포함해 standalone `check_script_quality_suite.mjs`와 기준을 맞춘다.
- Create or update: `C:\Users\petbl\auto-video\scripts\check_multi_agent_prerequisites.mjs`
  - 멀티에이전트 경로 시작 전 필요한 문서/DB/타임라인/품질 스크립트 존재 여부를 JSON으로 보고한다. DB는 직접 열지 않고 파일 존재와 잠금 리스크만 보고한다.

---

### Task 1: Add Agent Reference Map to `auto-video.md`

**Files:**
- Modify: `C:\Users\petbl\auto-video\auto-video.md`

- [ ] **Step 1: Insert an agent reference table right after the title**

`auto-video.md` 1번째 섹션(`## 채널 기본 방향`) 바로 앞에 아래 표를 추가한다.

```markdown
## 에이전트별 참조 범위

이 문서를 하나의 세션이 처음부터 끝까지 다 읽을 필요는 없다. 역할별로 아래 범위만 읽고 작업해도 된다(자세한 계약은 `docs/agent-handoff-contract.md` 참고).

| 에이전트 | 참조 섹션 |
|---|---|
| 기획 에이전트 | 채널 기본 방향, 1~2단계, 성경·심리학 콘텐츠 톤 우선순위 |
| 대본 설계 에이전트 | 장편 낭독형 대본 확장 규칙, 꿀잠성경 장편 대본 품질 규칙(챕터 내부 HPSL 구조, 챕터 기능 다양성, 콘텐츠 비율) |
| 대본 작성 에이전트 | 대본 작성, 좋은 반복 vs 나쁜 반복, 좋은 예/나쁜 예, 성경 원문 인용 규칙 |
| 품질 검수 에이전트 | 꿀잠성경 장편 최종영상 품질 게이트, 꿀잠성경 장편 대본 품질 규칙 전체 |
| 비주얼 프롬프트 에이전트 | 4단계, 장편 영상 화면 모션 규칙 |
| 렌더/운영 에이전트 | 꿀잠성경 장편 세그먼트 렌더링 규칙, CapCut QA 및 장편 품질 게이트, 장면 수와 실제 이미지 타임라인 검증 규칙 |
```

- [ ] **Step 2: Verify**

```powershell
Select-String -Path C:\Users\petbl\auto-video\auto-video.md -Pattern "에이전트별 참조 범위"
```

Expected: 한 번만 나온다.

---

### Task 2: Define the Agent Handoff Contract

**Files:**
- Create or update: `C:\Users\petbl\auto-video\docs\agent-handoff-contract.md`

- [ ] **Step 1: Document each artifact's owner and consumer**

Create or update `C:\Users\petbl\auto-video\docs\agent-handoff-contract.md`:

```markdown
# Agent Handoff Contract

에이전트 사이를 오가는 모든 산출물은 아래 표에 따른다. 오케스트레이터는 각 에이전트를 호출하기 전에 "입력 파일이 존재하는지"부터 확인한다.

| 산출물 | 만드는 에이전트 | 쓰는 에이전트 | 필수 필드 |
|---|---|---|---|
| `style-brief.json` | 기획 에이전트 | 대본 설계 에이전트 | `titlePatterns`, `toneCurve`, `chosenTopic` |
| `chapters.json` | 대본 설계 에이전트 | 대본 작성 에이전트, 렌더/운영 에이전트 | `chapters[].title`, `chapters[].hpslBeats`, `chapters[].function`, `chapters[].psychConcept`, `chapters[].bibleRef` |
| `script.txt`(세그먼트별) | 대본 작성 에이전트 | 품질 검수 에이전트, 비주얼 프롬프트 에이전트 | 세그먼트 디렉터리 안에 위치, `chapters.json`의 챕터 순서를 그대로 따름 |
| `script-quality-suite-report.json` | 품질 검수 에이전트 또는 `build_segmented_storyboards.mjs` | 오케스트레이터(재시도 판단) | `ok`, `failures`, `repetition`, `structure`, `semanticOverlap`, `hpsl.weakestChapters` |
| `script-revision-brief.md` | 품질 검수 에이전트(실패 시) | 대본 작성 에이전트(재작성) | `## Failures To Fix`, `## HPSL Weak Chapters` |
| `hermes-manual-storyboard.md`, `visual-timeline.json` | 비주얼 프롬프트 에이전트 | 렌더/운영 에이전트 | duration 태그, 장면 수가 `chapters.json` sceneCount와 일치 |
| `final.mp4`, `assembly-report.json` | 렌더/운영 에이전트 | 오케스트레이터(최종 검수) | `audioTempoFactor`, `visualGroups[*].motion` |
| `research.md` | Hermes Studio | 렌더/운영 에이전트 | 읽기 전용 참조. 현재 경로는 `C:\Users\petbl\hermes-studio\research.md` |
| `timeline.md` | Hermes Studio 또는 사용자 | 렌더/운영 에이전트 | 선택 입력. 현재 없으면 warning만 남김 |
| `artifact-discovery-report.json` | Hermes runner | 오케스트레이터, 렌더/운영 에이전트 | `research.found`, `timeline.found`, `databases.found`, `warnings` |
| `visual-memory.duckdb` | Hermes visual-memory scripts | Hermes runner | 서브에이전트 직접 접근 금지. 오케스트레이터 또는 Hermes runner만 접근 |

재시도 루프: 품질 검수 에이전트가 실패를 반환하면, 오케스트레이터는 `script-revision-brief.md`를 대본 작성 에이전트에게 다시 넘기고 해당 세그먼트만 재작성한다. 다른 세그먼트 결과물은 그대로 둔다.

DB 규칙: `visual-memory.duckdb`는 실행 중인 Node 프로세스가 잠글 수 있으므로, 서브에이전트 프롬프트에 DB 직접 열기 지시를 넣지 않는다. 필요한 경우 Hermes의 `visual-memory:audit`, `visual-memory:review`, `visual-memory:curate`, `visual-memory:import` 스크립트가 만든 JSON/CSV 보고서만 전달한다.
```

- [ ] **Step 2: Verify**

```powershell
Test-Path C:\Users\petbl\auto-video\docs\agent-handoff-contract.md
```

Expected: `True`.

---

### Task 3: Write Agent Invocation Templates

**Files:**
- Create or update: `C:\Users\petbl\auto-video\docs\agent-invocation-templates.md`

- [ ] **Step 1: Write one template block per agent**

Create or update `C:\Users\petbl\auto-video\docs\agent-invocation-templates.md`:

```markdown
# Agent Invocation Templates

이 저장소에서 Cowork/Claude Code의 Agent(subagent) 도구로 각 역할을 호출할 때 쓰는 프롬프트 뼈대. `{{}}`는 오케스트레이터가 채워 넣는 값이다.

## 대본 설계 에이전트

```
description: "{{topic}} 챕터 맵 설계"
prompt: |
  auto-video.md의 "장편 낭독형 대본 확장 규칙"과 "꿀잠성경 장편 대본 품질 규칙"(챕터 내부 HPSL 구조,
  챕터 기능 다양성, 콘텐츠 비율)만 읽고 진행해.
  style-brief.json({{styleBriefPath}})을 참고해서 {{targetMinutes}}분 목표로 챕터 맵을 설계해.
  각 챕터는 title, hpslBeats(hook/point/story/lesson 한 줄씩), function(사건 진행/심리 발견/관점 전환/
  정서 하강/질문 회수 중 하나, 연속 중복 금지), psychConcept(정확히 1개), bibleRef(있으면 "책 장:절" 형식)
  필드를 갖는 chapters.json으로 저장해. 코드 실행이나 렌더는 하지 마.
```

## 대본 작성 에이전트 (세그먼트별 병렬 호출)

```
description: "segment-{{n}} 대본 작성"
prompt: |
  auto-video.md의 "대본 작성", "좋은 반복 vs 나쁜 반복", "좋은 예/나쁜 예", "성경 원문 인용 규칙"만 읽어.
  chapters.json({{chaptersPath}})에서 이 세그먼트에 배정된 챕터({{chapterIndexes}})만 실제 대본으로 써.
  다른 세그먼트의 문장을 베끼거나 같은 도입 문장 템플릿을 반복하지 마.
  결과를 segments/segment-{{n}}/script.txt로 저장해.
```

## 품질 검수 (오케스트레이터가 직접 실행, 별도 에이전트 불필요)

```
node scripts/check_script_quality_suite.mjs {{scriptPath}} --out {{reportPath}}
# 실패하면:
node scripts/generate_script_revision_brief.mjs {{reportPath}} --out {{briefPath}}
# {{briefPath}}를 대본 작성 에이전트에 다시 넘겨 해당 세그먼트만 재작성
```

품질 검수 출력에는 반드시 `repetition`, `structure`, `semanticOverlap`, `hpsl`이 모두 있어야 한다. `build_segmented_storyboards.mjs`가 만든 `script-quality-suite-report.json`에도 같은 필드가 있어야 한다.

## 비주얼 프롬프트 에이전트

```
description: "segment-{{n}} 스토리보드"
prompt: |
  auto-video.md의 4단계와 "장편 영상 화면 모션 규칙"만 읽어.
  검증 통과한 segments/segment-{{n}}/script.txt를 입력으로 hermes-manual-storyboard.md와
  visual-timeline.json을 만들어. 장면 수는 segment-plan에서 정한 sceneCount와 정확히 맞춰.
```

## 렌더/운영 에이전트

```
description: "segment-{{n}} 렌더 및 검증"
prompt: |
  auto-video.md의 "꿀잠성경 장편 세그먼트 렌더링 규칙", "CapCut QA 및 장편 품질 게이트",
  "장편 영상 화면 모션 규칙"만 읽어.
  Hermes 참고 문서로 C:\Users\petbl\hermes-studio\research.md를 읽되, 없거나 깨져 있으면 보고만 해.
  timeline.md는 현재 없을 수 있으므로 hard failure로 보지 말고 artifact-discovery warning으로 처리해.
  visual-memory.duckdb는 직접 열지 마. 필요한 visual memory 정보는 Hermes runner 또는 visual-memory audit 산출물만 사용해.
  Hermes 렌더 → assemble_cain_fast_from_hermes_job.mjs → check_audio_speed_profile.mjs →
  check_motion_manifest.mjs → validate_segmented_export.py 순서로 실행하고, 실패하면 원인을 보고해.
  대본이나 챕터 구조를 임의로 바꾸지 마 — 실패 원인이 대본이면 품질 검수 에이전트로 되돌려야 한다고 보고해.
```
```

- [ ] **Step 2: Verify**

```powershell
Test-Path C:\Users\petbl\auto-video\docs\agent-invocation-templates.md
```

Expected: `True`.

---

### Task 4: Add a Decision Rule for When to Use the Multi-Agent Path

**Files:**
- Modify: `C:\Users\petbl\auto-video\auto-video.md`

- [ ] **Step 1: Add a short decision rule near the segment rendering rules**

`## 꿀잠성경 장편 세그먼트 렌더링 규칙` 섹션 시작 부분에 아래 문단을 추가한다.

```markdown
### 단일 세션 vs 멀티 에이전트 선택 기준

- 20분 미만이거나 파일럿 성격의 대본은 단일 세션으로 1~4단계를 그대로 진행한다.
- 40분 이상 장편이고 세그먼트 렌더링 규칙을 적용하는 경우, `docs/agent-invocation-templates.md`의
  역할 분리를 따른다. 세그먼트별 대본 작성/스토리보드/렌더는 세그먼트 단위로 병렬 위임할 수 있다.
- 어느 경로를 쓰든 산출물 계약(`docs/agent-handoff-contract.md`)은 동일하게 지킨다.
```

- [ ] **Step 2: Verify**

```powershell
Select-String -Path C:\Users\petbl\auto-video\auto-video.md -Pattern "단일 세션 vs 멀티 에이전트 선택 기준"
```

Expected: 한 번만 나온다.

---

### Task 5: Add HPSL to the Segmented Storyboard Quality Suite

**Files:**
- Modify: `C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs`

- [ ] **Step 1: Import the HPSL analyzer**

At the top of `C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs`, add:

```js
import { analyzeScriptHpsl } from "./lib/hpsl-structure-analysis.mjs";
```

- [ ] **Step 2: Add HPSL analysis beside structure and semantic overlap**

In the segment loop, immediately after:

```js
const semanticOverlap = analyzeSemanticOverlap(segmentScript, {
  threshold: 0.82,
});
```

add:

```js
const hpsl = analyzeScriptHpsl(segmentScript, {
  minChapterPassRate: 0.8,
});
```

- [ ] **Step 3: Include HPSL failures and report body**

Replace the existing `qualitySuite` object with:

```js
const qualitySuite = {
  ok: scriptQuality.ok && structureQuality.ok && semanticOverlap.ok && hpsl.ok,
  failures: [
    ...scriptQuality.failures.map((failure) => `repetition:${failure}`),
    ...structureQuality.failures.map((failure) => `structure:${failure}`),
    ...(semanticOverlap.ok ? [] : semanticOverlap.overlaps.map((overlap) => `semantic_overlap:p${overlap.leftParagraph}-p${overlap.rightParagraph}:${overlap.score}`)),
    ...(hpsl.ok ? [] : hpsl.failures.map((failure) => `hpsl:${failure}`)),
  ],
  repetition: scriptQuality,
  structure: structureQuality,
  semanticOverlap,
  hpsl,
};
```

- [ ] **Step 4: Run syntax check**

```powershell
node --check C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs
```

Expected: exit code `0`.

- [ ] **Step 5: Verify the generated suite includes HPSL**

Run on a disposable slug:

```powershell
node C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs --source-slug gguljam-bible-cain-envy-60min-001 --slug multi-agent-hpsl-check --segment-minutes 15
```

Expected: if the script fails, the failure message may include `hpsl:` or other quality failures. If it passes, confirm:

```powershell
Select-String -Path C:\Users\petbl\auto-video\exports\multi-agent-hpsl-check\segments\segment-01\script-quality-suite-report.json -Pattern '"hpsl"'
```

Expected: at least one match.

---

### Task 6: Add Pipeline Artifact Map Including Hermes Research, Timeline, and Visual Memory

**Files:**
- Create or update: `C:\Users\petbl\auto-video\docs\pipeline-artifact-map.md`

- [ ] **Step 1: Create the artifact map**

Create or update `C:\Users\petbl\auto-video\docs\pipeline-artifact-map.md`:

```markdown
# Pipeline Artifact Map

This document maps the artifacts shared between `auto-video` and `hermes-studio`.

## auto-video artifacts

| Artifact | Producer | Consumer | Notes |
|---|---|---|---|
| `exports/<slug>/script.txt` | Script writer | Script QA, storyboard builder | Final source text for the video. |
| `exports/<slug>/chapters.json` | Script planner | Script writer, QA | Required for multi-agent longform generation. |
| `exports/<slug>/segments/segment-XX/script.txt` | Script writer or segment splitter | Script QA, visual prompt agent | Segment-local script. |
| `script-quality-report.json` | `assertLongformScriptQuality` | Orchestrator | Repetition and paragraph gate. |
| `script-quality-suite-report.json` | `check_script_quality_suite.mjs` or segmented builder | Orchestrator, rewrite loop | Must include repetition, structure, semantic overlap, and HPSL. |
| `script-revision-brief.md` | `generate_script_revision_brief.mjs` | Script writer | Used only when quality suite fails. |
| `visual-timeline.json` | Storyboard builder | Renderer, validator | Source of truth for image change timing. |
| `hermes-manual-storyboard.md` | Visual prompt agent | Hermes runner | Every prompt line must include `/ duration:X`. |
| `manual-assembly/assembly-report.json` | Renderer | QA, concat | Contains `audioTempoFactor` and motion groups. |
| `capcut-draft/capcut-draft-manifest.json` | CapCut exporter | CapCut QA | Manifest-only integration until draft editing is stable. |

## Hermes Studio artifacts

| Artifact | Path | Role in multi-agent workflow |
|---|---|---|
| `research.md` | `C:\Users\petbl\hermes-studio\research.md` | Read-only architecture and workflow reference for renderer/ops agents. |
| `timeline.md` | Not currently found | Optional workflow chronology. Missing file should produce a warning, not a hard failure. |
| `artifact-discovery-report.json` | Each Hermes job dir | Records whether `research.md`, timeline files, and DB files were discovered. |
| `llm-summary.json` | Each Hermes job dir | Attributes LLM calls, retries, fallback, and parse recovery. |
| `performance-budget-report.json` | Each Hermes job dir | Shows bottlenecks and deterministic performance recommendations. |
| `data/visual-memory.duckdb` | `C:\Users\petbl\hermes-studio\hermes-local\data\visual-memory.duckdb` | Visual memory DB. Access should be orchestrator-owned or via Hermes scripts only. |
| `reports/visual-memory/visual-memory-candidates.json` | Hermes report dir | Reviewable visual memory candidates. |

## DB access rule

Subagents must not independently open `visual-memory.duckdb`. The DB can be locked by a running Hermes Node process. The orchestrator should either:

1. Use Hermes scripts such as `npm run visual-memory:audit` and pass JSON reports to subagents, or
2. Defer visual-memory lookup to Hermes runner, which already injects memory hints into storyboard prompts.

If DB access fails because the file is locked, the pipeline should continue with a warning and no direct memory hints.
```

- [ ] **Step 2: Verify**

```powershell
Test-Path C:\Users\petbl\auto-video\docs\pipeline-artifact-map.md
Select-String -Path C:\Users\petbl\auto-video\docs\pipeline-artifact-map.md -Pattern "visual-memory.duckdb"
```

Expected: `True`, then at least one match.

---

### Task 7: Add Multi-Agent Prerequisite Checker

**Files:**
- Create or update: `C:\Users\petbl\auto-video\scripts\check_multi_agent_prerequisites.mjs`

- [ ] **Step 1: Create checker script**

Create or update `C:\Users\petbl\auto-video\scripts\check_multi_agent_prerequisites.mjs`:

```js
#!/usr/bin/env node
import { existsSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const root = "C:/Users/petbl/auto-video";
const hermesRoot = "C:/Users/petbl/hermes-studio";
const hermesLocal = join(hermesRoot, "hermes-local");
const outPath = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : null;

const required = [
  join(root, "auto-video.md"),
  join(root, "scripts", "check_script_quality_suite.mjs"),
  join(root, "scripts", "generate_script_revision_brief.mjs"),
  join(root, "scripts", "check_hpsl_structure.mjs"),
  join(root, "scripts", "lib", "hpsl-structure-analysis.mjs"),
  join(root, "scripts", "lib", "script-structure-analysis.mjs"),
  join(root, "scripts", "lib", "semantic-overlap-analysis.mjs"),
  join(root, "scripts", "validate_segmented_export.py"),
  join(root, "scripts", "concat_segments.mjs"),
  join(root, "docs", "agent-handoff-contract.md"),
  join(root, "docs", "agent-invocation-templates.md"),
  join(root, "docs", "pipeline-artifact-map.md"),
];

const optional = [
  join(hermesRoot, "research.md"),
  join(hermesRoot, "timeline.md"),
  join(hermesLocal, "data", "visual-memory.duckdb"),
  join(hermesLocal, "package.json"),
];

const report = {
  ok: true,
  failures: [],
  warnings: [],
  required: required.map(fileReport),
  optional: optional.map(fileReport),
};

for (const item of report.required) {
  if (!item.exists) {
    report.ok = false;
    report.failures.push(`missing_required:${item.path}`);
  }
}
for (const item of report.optional) {
  if (!item.exists) report.warnings.push(`missing_optional:${item.path}`);
}

const visualMemory = report.optional.find((item) => item.path.endsWith("visual-memory.duckdb"));
if (visualMemory?.exists) {
  report.warnings.push("visual_memory_db_present: do not let subagents open it directly; use orchestrator/Hermes reports to avoid DuckDB lock conflicts");
}

if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);

function fileReport(path) {
  let bytes = null;
  let mtime = null;
  if (existsSync(path)) {
    const stat = statSync(path);
    bytes = stat.size;
    mtime = stat.mtime.toISOString();
  }
  return { path, exists: existsSync(path), bytes, mtime };
}
```

- [ ] **Step 2: Run syntax check**

```powershell
node --check C:\Users\petbl\auto-video\scripts\check_multi_agent_prerequisites.mjs
```

Expected: exit code `0`.

- [ ] **Step 3: Run checker**

```powershell
node C:\Users\petbl\auto-video\scripts\check_multi_agent_prerequisites.mjs --out C:\Users\petbl\auto-video\docs\multi-agent-prerequisites-report.json
```

Expected: before Tasks 1~3 and 6 are implemented, this may fail because the new docs are missing. After those tasks, `ok` should be `true`, with warnings allowed for missing `timeline.md` and visual-memory DB lock risk.

---

## Verification

```powershell
Select-String -Path C:\Users\petbl\auto-video\auto-video.md -Pattern "에이전트별 참조 범위"
Select-String -Path C:\Users\petbl\auto-video\auto-video.md -Pattern "단일 세션 vs 멀티 에이전트 선택 기준"
Test-Path C:\Users\petbl\auto-video\docs\agent-handoff-contract.md
Test-Path C:\Users\petbl\auto-video\docs\agent-invocation-templates.md
Test-Path C:\Users\petbl\auto-video\docs\pipeline-artifact-map.md
node --check C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs
node --check C:\Users\petbl\auto-video\scripts\check_multi_agent_prerequisites.mjs
node C:\Users\petbl\auto-video\scripts\check_multi_agent_prerequisites.mjs --out C:\Users\petbl\auto-video\docs\multi-agent-prerequisites-report.json
Select-String -Path C:\Users\petbl\auto-video\docs\pipeline-artifact-map.md -Pattern "visual-memory.duckdb"
```

## Risk Notes

- 서브에이전트로 분리하면 오케스트레이터가 매번 "입력 파일이 준비됐는지" 확인하는 책임을 져야 한다. 확인 없이 다음 에이전트를 호출하면 실패가 늦게 발견된다 — Task 2의 계약 표를 오케스트레이터 체크리스트로도 활용한다.
- 세그먼트별 병렬 대본 작성은 챕터 맵(`chapters.json`)이 미리 확정되어 있어야 톤과 진행이 어긋나지 않는다. 챕터 맵이 부실하면 병렬화가 오히려 일관성을 해친다 — 대본 설계 에이전트의 산출물 품질이 이 구조 전체의 병목이다.
- 20분 미만 영상까지 이 구조를 강제하면 오히려 느려진다. Task 4의 선택 기준을 반드시 지킨다.
- `timeline.md`는 현재 발견되지 않았다. Hermes의 artifact discovery도 이 경우 warning을 남기도록 되어 있으므로, 멀티에이전트 prerequisite checker에서도 hard failure가 아니라 warning으로 둔다.
- `visual-memory.duckdb`는 실행 중인 Hermes Node 프로세스가 잠글 수 있다. 실제 확인 중에도 Node 프로세스가 DB를 잡고 있어 직접 쿼리가 실패했다. DB 조회는 각 서브에이전트가 직접 하지 말고, 오케스트레이터가 Hermes 보고서나 `visual-memory:audit` 산출물을 전달하는 방식으로 제한한다.
- `build_segmented_storyboards.mjs` 내부 suite와 standalone `check_script_quality_suite.mjs`의 기준이 다르면 어떤 경로에서는 통과하고 다른 경로에서는 실패하는 품질 분기가 생긴다. Task 5로 HPSL을 내부 suite에 포함해 기준을 맞춘다.

## Self-Review

- Spec coverage: 분리가 유리한 이유(근거 포함)와 불리한 경우를 모두 다뤘고, 구체적 에이전트 역할·입출력 계약·호출 템플릿·선택 기준까지 실행 가능한 산출물로 정리했다. 추가로 현재 코드베이스, Hermes `research.md`, missing `timeline.md`, DuckDB visual memory 잠금 리스크, HPSL 품질 스위트 불일치를 반영했다.
- Placeholder scan: TBD/TODO 없음. `{{}}` 플레이스홀더는 오케스트레이터가 실제 호출 시 채우는 템플릿 변수로, 의도된 것이다.
- Type consistency: 이 계획이 참조하는 파일명(`script-quality-suite-report.json`, `script-revision-brief.md`, `visual-timeline.json`, `assembly-report.json`, `artifact-discovery-report.json`, `llm-summary.json`, `performance-budget-report.json` 등)은 현재 코드에서 생성하거나 Hermes에서 생성하는 실제 파일명과 맞췄다.
