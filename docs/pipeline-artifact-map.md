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
