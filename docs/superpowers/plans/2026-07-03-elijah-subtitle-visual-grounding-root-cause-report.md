# Elijah Export Subtitle And Visual Grounding Root Cause Report

Export:
`C:\Users\petbl\auto-video\exports\gguljam-bible-elijah-burnout-loneliness-20min-001`

Final video:
`C:\Users\petbl\auto-video\exports\gguljam-bible-elijah-burnout-loneliness-20min-001\final\final-full.mp4`

## Findings

### 1. Double subtitle complaint

The final MP4 has only video and audio streams. It has no embedded subtitle stream.

The segment SRT files and merged upload SRT also have no overlapping cues:

- `segment-01/manual-assembly/subtitles.srt`: 186 cues, 0 overlaps
- `segment-02/manual-assembly/subtitles.srt`: 186 cues, 0 overlaps
- `final/upload-subtitles/final-full.upload.srt`: 372 cues, 0 overlaps

The final playback folder no longer contains any SRT file. The upload-only SRT is separated under `final/upload-subtitles/`.

Diagnostic frame extracted directly from the MP4 at 390 seconds shows only one burned subtitle layer:

`C:\Users\petbl\auto-video\exports\gguljam-bible-elijah-burnout-loneliness-20min-001\diagnostics\final_t390.jpg`

Conclusion:

The final MP4 itself does not contain two burned subtitle layers. If two subtitles are visible during playback/import, the cause is an external subtitle layer displayed on top of the already burned-in subtitle. This was reproduced by the previous `final/final-full.upload.srt` sidecar living in the playback folder; it has now been moved to `final/upload-subtitles/final-full.upload.srt`.

### 2. Visual prompt and narration mismatch

The mismatch is real and comes from the production data flow.

Segment 1:

- Hermes storyboard scenes before split: 28
- Hermes voice rows after pacing split: 59
- Keyframes / visual groups used by custom assembly: 28
- Subtitle cues: 186
- Final segment duration: about 785 seconds

Segment 2:

- Hermes storyboard scenes before split: 20
- Hermes voice rows after pacing split: 59
- Keyframes / visual groups used by custom assembly: 20
- Subtitle cues: 186
- Final segment duration: about 795 seconds

The custom assembly uses the fixed visual timeline and existing keyframes. It does not regenerate image prompts from the final subtitle/narration chunks. As a result, many subtitle cues share a broad representative image that was generated from a different or wider storyboard beat.

Examples:

- Segment 1, 390s:
  - Subtitle: `모든 문제를 정리하는 기도보다 불을 끄고 눕는 일이 먼저일 수 있습니다.`
  - Image prompt: `empty wilderness path, single footprints in sand, distant cloak figure`

- Segment 1, 690s:
  - Subtitle: `그러면 사람은 자기 자신을 더 의심합니다.`
  - Image prompt: `simple bread and water jar, desert stone, cloak nearby, quiet still life`

- Segment 2, 180s:
  - Subtitle: `그때 우리는 빨리 잠들지 못하는 자신을 탓하기보다,`
  - Image prompt: `wide mountain view from cave, tiny lamps far below in scattered valleys`

Conclusion:

The generated images are not being grounded against each active subtitle sentence or its keyword context. They are grounded against earlier coarse storyboard beats. Hermes then splits narration into more voice rows, but image count remains fixed. The final assembly stretches those fixed images across the longer narration.

## Root Cause

There are two separate root causes:

1. Subtitle duplication was caused outside the MP4 by displaying upload SRT on top of burned subtitles.
2. Image mismatch is caused by timeline granularity mismatch: final narration/subtitle chunks are finer than visual prompts/keyframes, and prompts are not regenerated from the final active narration chunks.

## Required Fix Direction

1. Produce either a burned-subtitle delivery or a sidecar-subtitle delivery, not both in the same user-facing folder.
2. Keep upload SRTs outside the normal playback folder under `final/upload-subtitles/`.
3. Generate visual prompts after the final script and voice-row split are known.
4. Build visual groups from actual active narration chunks, not only from coarse chapter storyboard beats.
5. Add a guard that compares each visual group prompt against the subtitles active in that time range.
6. Fail the render when voice row count and visual prompt count diverge beyond an allowed ratio.

## Verification Run

Ran:

`node scripts\check_subtitle_render_quality.mjs --export-dir exports\gguljam-bible-elijah-burnout-loneliness-20min-001 --out exports\gguljam-bible-elijah-burnout-loneliness-20min-001\diagnostics\subtitle-render-quality-report.json`

Result:

- 5 MP4 files checked
- 3 SRT files checked
- 0 same-name sidecar failures
- 0 overlapping cue failures
- 0 inverted cue failures
- 0 near-zero cue failures
