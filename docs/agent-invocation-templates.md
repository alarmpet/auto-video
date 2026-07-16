# Agent Invocation Templates

이 저장소에서 Agent(subagent) 도구로 각 역할을 호출할 때 쓰는 프롬프트 뼈대다. `{{}}`는 오케스트레이터가 실제 값으로 채운다.

## 대본 설계 에이전트

```text
description: "{{topic}} 챕터 맵 설계"
prompt: |
  auto-video.md의 "장편 낭독형 대본 확장 규칙"과 "꿀잠성경 장편 대본 품질 규칙"만 읽고 진행해.
  style-brief.json({{styleBriefPath}})을 참고해서 {{targetMinutes}}분 목표로 챕터 맵을 설계해.
  각 챕터는 title, hpslBeats(hook/point/story/lesson 한 줄씩), function(사건 진행/심리 발견/관점 전환/정서 하강/질문 회수 중 하나, 연속 중복 금지), psychConcept(정확히 1개), bibleRef(있으면 "책 장:절" 형식) 필드를 갖는 chapters.json으로 저장해.
  코드 실행이나 렌더는 하지 마.
```

## 대본 작성 에이전트

```text
description: "segment-{{n}} 대본 작성"
prompt: |
  auto-video.md의 "대본 작성", "좋은 반복 vs 나쁜 반복", "좋은 예/나쁜 예", "성경 원문 인용 규칙"만 읽어.
  chapters.json({{chaptersPath}})에서 이 세그먼트에 배정된 챕터({{chapterIndexes}})만 실제 대본으로 써.
  chapters.json의 bibleRef를 반드시 사용해. 각 담당 챕터마다 [성경인용:책 장:절] "개역한글판 원문" 블록을 최소 1회 넣고, 바로 다음 문단에서 그 장면을 현대 심리 주제에 대입해 설명해. "성경은 말합니다"처럼 책/장/절 없는 일반화 문장으로 대체하지 마.
  다른 세그먼트의 문장을 베끼거나 같은 도입 문장 템플릿을 반복하지 마.
  결과를 segments/segment-{{n}}/script.txt로 저장해.
```

## 품질 검수

품질 검수는 오케스트레이터가 직접 실행해도 된다.

```powershell
node C:\Users\petbl\auto-video\scripts\check_script_quality_suite.mjs {{scriptPath}} --chapters {{chaptersPath}} --out {{reportPath}}
node C:\Users\petbl\auto-video\scripts\generate_script_revision_brief.mjs {{reportPath}} --out {{briefPath}}
```

품질 검수 출력에는 반드시 `repetition`, `structure`, `semanticOverlap`, `hpsl`, `bibleGrounding`, `bibleCitation`이 모두 있어야 한다. `build_segmented_storyboards.mjs`가 만든 `script-quality-suite-report.json`에도 같은 필드가 있어야 한다.

## 비주얼 프롬프트 에이전트

```text
description: "segment-{{n}} 스토리보드"
prompt: |
  auto-video.md의 4단계와 "장편 영상 화면 모션 규칙"만 읽어.
  검증 통과한 segments/segment-{{n}}/script.txt를 입력으로 hermes-manual-storyboard.md와 visual-timeline.json을 만들어.
  장면 수는 segment-plan에서 정한 sceneCount와 정확히 맞춰.
```

## 렌더/운영 에이전트

```text
description: "segment-{{n}} 렌더 및 검증"
prompt: |
  auto-video.md의 "꿀잠성경 장편 세그먼트 렌더링 규칙", "CapCut QA 및 장편 품질 게이트", "장편 영상 화면 모션 규칙"만 읽어.
  Hermes 참고 문서로 C:\Users\petbl\hermes-studio\research.md를 읽되, 없거나 깨져 있으면 보고만 해.
  timeline.md는 현재 없을 수 있으므로 hard failure로 보지 말고 artifact-discovery warning으로 처리해.
  visual-memory.duckdb는 직접 열지 마. 필요한 visual memory 정보는 Hermes runner 또는 visual-memory audit 산출물만 사용해.
  Hermes 렌더 -> assemble_cain_fast_from_hermes_job.mjs -> check_audio_speed_profile.mjs -> check_motion_manifest.mjs -> validate_segmented_export.py 순서로 실행하고, 실패하면 원인을 보고해.
  대본이나 챕터 구조를 임의로 바꾸지 마. 실패 원인이 대본이면 품질 검수 에이전트로 되돌려야 한다고 보고해.
```
