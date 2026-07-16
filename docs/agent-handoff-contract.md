# Agent Handoff Contract

에이전트 사이를 오가는 모든 산출물은 아래 표에 따른다. 오케스트레이터는 각 에이전트를 호출하기 전에 입력 파일이 존재하는지 먼저 확인한다.

| 산출물 | 만드는 에이전트 | 쓰는 에이전트 | 필수 필드 |
|---|---|---|---|
| `style-brief.json` | 기획 에이전트 | 대본 설계 에이전트 | `titlePatterns`, `toneCurve`, `chosenTopic` |
| `chapters.json` | 대본 설계 에이전트 | 대본 작성 에이전트, 렌더/운영 에이전트 | `chapters[].title`, `chapters[].hpslBeats`, `chapters[].function`, `chapters[].psychConcept`, `chapters[].bibleRef` |
| `script.txt`(세그먼트별) | 대본 작성 에이전트 | 품질 검수 에이전트, 비주얼 프롬프트 에이전트 | 세그먼트 디렉터리 안에 위치, `chapters.json`의 챕터 순서를 그대로 따름 |
| `script-quality-suite-report.json` | 품질 검수 에이전트 또는 `build_segmented_storyboards.mjs` | 오케스트레이터 | `ok`, `failures`, `repetition`, `structure`, `semanticOverlap`, `hpsl.weakestChapters`, `bibleGrounding`, `bibleCitation` |
| `script-revision-brief.md` | 품질 검수 에이전트(실패 시) | 대본 작성 에이전트 | `## Failures To Fix`, `## HPSL Weak Chapters` |
| `hermes-manual-storyboard.md` | 비주얼 프롬프트 에이전트 | 렌더/운영 에이전트 | `[대본 텍스트]` 라벨, 영어 프롬프트, `/ duration:X` |
| `visual-timeline.json` | 비주얼 프롬프트 에이전트 | 렌더/운영 에이전트 | `segmentId`, `targetSeconds`, `scenes[].durationSeconds` |
| `final.mp4` | 렌더/운영 에이전트 | 오케스트레이터 | 세그먼트별 `manual-assembly/final.mp4` 경로 고정 |
| `assembly-report.json` | 렌더/운영 에이전트 | 오케스트레이터 | `audioTempoFactor`, `rawVoiceSeconds`, `totalVoiceSeconds`, `visualGroups[*].motion` |
| `research.md` | Hermes Studio | 렌더/운영 에이전트 | 읽기 전용 참조. 현재 경로는 `C:\Users\petbl\hermes-studio\research.md` |
| `timeline.md` | Hermes Studio 또는 사용자 | 렌더/운영 에이전트 | 선택 입력. 현재 없으면 warning만 남김 |
| `artifact-discovery-report.json` | Hermes runner | 오케스트레이터, 렌더/운영 에이전트 | `research.found`, `timeline.found`, `databases.found`, `warnings` |
| `visual-memory.duckdb` | Hermes visual-memory scripts | Hermes runner | 서브에이전트 직접 접근 금지. 오케스트레이터 또는 Hermes runner만 접근 |

## 재시도 루프

품질 검수 에이전트가 실패를 반환하면, 오케스트레이터는 `script-revision-brief.md`를 대본 작성 에이전트에게 다시 넘기고 해당 세그먼트만 재작성한다. 다른 세그먼트 결과물은 그대로 둔다.

## DB 규칙

`visual-memory.duckdb`는 실행 중인 Node 프로세스가 잠글 수 있으므로, 서브에이전트 프롬프트에 DB 직접 열기 지시를 넣지 않는다. 필요한 경우 Hermes의 `visual-memory:audit`, `visual-memory:review`, `visual-memory:curate`, `visual-memory:import` 스크립트가 만든 JSON/CSV 보고서만 전달한다.

## Visual Context Handoff Addendum

| 산출물 | 만드는 에이전트 | 받는 에이전트 | 필수 필드 |
|---|---|---|---|
| `visual-context-cards.json` | 비주얼 프롬프트 에이전트 | 프롬프트 QA, 렌더/운영 에이전트 | 문장별 성경 인물/사건, 심리 개념, 감정, 장소, 행동, 자세, visual anchor |
| `storyboard-context-alignment-report.json` | 프롬프트 QA | 테스트/렌더 에이전트 | `ok:true`, `minScore`, 실패 장면 목록, 누락된 required prompt terms |

## Visual Grounding Reports

| Artifact | Created by | Consumed by | Required fields |
|---|---|---|---|
| `visual-grounding-report.json` | Visual prompt agent | Prompt QA, render agent | Per-scene narration chunk, keywords, `timingBand`, `durationSeconds`, `estimatedCharsPerSecond` |
| `visual-grounding-timeline-report.json` | Prompt QA | Render agent | `ok:true`, scene count parity, opening/body duration contract, prompt grounding failures |

`visual-grounding-report.json` describes what each visual scene is supposed to represent. `visual-grounding-timeline-report.json` records whether the generated prompts and timing passed the grounding gate.
