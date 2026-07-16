# Segmented Longform Render Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 60분 이상 꿀잠성경 영상을 10~20분 세그먼트 단위로 생성, 검증, 재생성, 최종 병합할 수 있게 만들어 자막/음성 싱크와 긴 작업 실패 복구 문제를 줄인다.

**Architecture:** 기존 “전체 대본 -> 전체 storyboard -> 전체 Hermes job -> 전체 MP4” 흐름을 유지하되, 중간에 `segment manifest`를 만들어 대본과 storyboard를 시간 구간별로 나눈다. 각 세그먼트는 독립 폴더에서 TTS, 이미지, 자막, QA, `final.mp4`를 만들고, 마지막에 검증된 세그먼트 MP4만 `ffmpeg concat`으로 붙인다. 실패 시 전체를 다시 만들지 않고 해당 세그먼트만 재생성한다.

**Tech Stack:** Node.js ESM scripts, Python validation, Hermes Local Studio, ffmpeg/ffprobe, PowerShell.

---

## Accepted Review Findings

The review report at `C:\Users\petbl\auto-video\docs\superpowers\plans\2026-06-30-segmented-longform-render-pipeline-review-report.md` was checked against the current plan and scripts. These findings are technically valid and are incorporated below:

- Split the script by segment time first, then split each segment script into that segment's scene count. Do not split the full script by total scene count first, because the denser intro would give `segment-01` too much narration and cause duration drift.
- Segment boundaries must prefer paragraph boundaries and fall back to sentence boundaries. Avoid cutting inside words or mid-sentence when creating segment scripts.
- `concat_segments.mjs` must produce a merged `final-full.srt` by shifting each segment SRT with accumulated segment duration.
- Segment MP4 profiles must be checked before `ffmpeg concat -c copy`. If codec, frame rate, resolution, pixel format, audio sample rate, or audio channels differ, fail clearly before producing a broken final video.

The review's general praise/positioning language is not copied into the implementation plan because it does not change the build.

---

## Accepted Timeline Remediation Findings

The timeline remediation report at `C:\Users\petbl\auto-video\docs\superpowers\plans\2026-06-30-gguljam-longform-timeline-remediation-report.md` was checked against the current code and generated assets. These findings are technically valid and are incorporated below:

- `segment-01` planning is correct at the manifest level: `900s`, `sceneCount: 38`, with the intended density of first 60s at 6s/scene and the remaining 840s at 30s/scene.
- The generated `segment-01\hermes-manual-storyboard.md` has 38 prompt blocks, but it does not contain per-scene `duration` or `start/end` metadata. Current validation only proves block count, not timeline behavior.
- Hermes Local currently parses manual storyboard blocks without `duration` metadata and then assigns equal duration through `resolveSceneDurations()`. For `900s / 38 scenes`, that becomes about `23.68s` per scene, which does not preserve the intro/body pacing rule.
- The recent viewed/reassembled output came from `gguljam-bible-cain-envy-60min-fast-001`, not from `gguljam-bible-cain-envy-60min-segmented\segments\segment-01\manual-assembly\final.mp4`. The real segment final does not exist yet, so the segmented timeline was never rendered in that output.
- `assemble_cain_fast_from_hermes_job.mjs` currently builds visual groups from a fixed `--max-image-seconds` grid. That mitigates multi-minute still images, but it does not implement the required Segment 1 timeline.
- `concat_segments.mjs` already fails when any `segments\segment-XX\manual-assembly\final.mp4` is missing. Keep that behavior and add a verification step for it.

Rejected or modified report findings:

- Do not blindly replace visual grouping with `voiceRows` duration 1:1. TTS rows can be split more finely than visual scenes after `scene_split_for_pacing`, so using voice rows as the visual timeline can create a new mismatch. The accepted fix is to generate an explicit visual timeline and use that timeline as the source of truth.
- Do not compute intro duration inside `buildStoryboard()` with `segment.startSeconds + index * 6`. That works only accidentally for the first 10 scenes of segment 1 and does not carry exact `startSeconds/endSeconds`. Use a shared timeline helper instead.

New source-of-truth contract:

- Each segment directory must contain `visual-timeline.json`.
- `visual-timeline.json` must contain one row per intended visual scene:

```json
{
  "segmentId": "segment-01",
  "targetSeconds": 900,
  "scenes": [
    { "order": 1, "startSeconds": 0, "endSeconds": 6, "durationSeconds": 6 },
    { "order": 2, "startSeconds": 6, "endSeconds": 12, "durationSeconds": 6 }
  ]
}
```

- `hermes-manual-storyboard.md` must append `/ duration: X` to each prompt line so Hermes also receives the same pacing.
- `assemble_cain_fast_from_hermes_job.mjs` must prefer `<export-dir>\visual-timeline.json` over `--max-image-seconds`. If the timeline exists, the final visual groups must match it exactly.
- If a timeline exists and keyframes are fewer than timeline scenes, assembly must fail clearly instead of cycling or silently stretching images. A temporary debug-only option may be added later, but the production path should be strict.

---

## Design Decision

기본 세그먼트 길이는 `15분`으로 한다.

- 60분 영상: `15분 x 4개`
- 90분 영상: `15분 x 6개`
- 120분 영상: `15분 x 8개`

허용 옵션:
- `--segment-minutes 10`: 가장 안전하지만 세그먼트 수가 많다.
- `--segment-minutes 15`: 기본값. 안정성과 관리 편의 균형이 좋다.
- `--segment-minutes 20`: 작업 수는 적지만 실패 시 재생성 범위가 커진다.

장면 밀도:
- 각 영상 전체의 첫 60초만 intro density를 적용한다.
- 첫 세그먼트의 첫 60초: 5~6초당 1장면
- 그 이후 모든 구간: 30초당 1장면

예: 60분, 15분 세그먼트 기준

```text
segment-01: 첫 60초 10~12장면 + 14분 본문 28장면 = 약 38~40장면
segment-02: 15분 본문 30장면
segment-03: 15분 본문 30장면
segment-04: 15분 본문 30장면
total: 약 128~130장면
```

---

## File Structure

- Create: `C:\Users\petbl\auto-video\scripts\lib\segment-plan.mjs`
  - 목표 길이, 세그먼트 길이, intro/body 장면 밀도로 세그먼트 계획을 계산한다.
- Create: `C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs`
  - 기존 longform export를 읽어 `segments/segment-XX` 폴더와 세그먼트별 `script.txt`, `hermes-manual-storyboard.md`, `production.json`을 만든다.
- Create: `C:\Users\petbl\auto-video\scripts\concat_segments.mjs`
  - 검증된 세그먼트 `final.mp4` 파일들을 concat해서 최종 `final-full.mp4`를 만들고, 세그먼트별 `subtitles.srt`를 누적 타임스탬프로 합쳐 `final-full.srt`도 만든다.
- Create: `C:\Users\petbl\auto-video\scripts\validate_segmented_export.py`
  - 세그먼트 폴더 구조, segment manifest, 장면 수, 자막 싱크 리포트, 최종 concat 준비 상태, MP4 스트림 프로파일 일치 여부를 검사한다.
- Modify: `C:\Users\petbl\auto-video\scripts\build_cain_longform_fast_storyboard.mjs`
  - 단일 storyboard 생성은 유지하되, 새 segmented builder와 같은 장면 수 계산 규칙을 공유하도록 `segment-plan.mjs`를 사용한다.
- Modify: `C:\Users\petbl\auto-video\scripts\assemble_cain_fast_from_hermes_job.mjs`
  - 세그먼트별 output에서 final 이름을 안정적으로 받을 수 있게 이미 있는 `--job-dir`, `--export-dir`, `--final-name` 옵션을 문서화하고 검증한다.
- Modify: `C:\Users\petbl\auto-video\auto-video.md`
  - 장편 최종영상은 기본적으로 15분 세그먼트 단위로 생성한다는 운영 규칙을 추가한다.

Output structure:

```text
C:\Users\petbl\auto-video\exports\<slug>\
  script.txt
  production.json
  segment-manifest.json
  segments\
    segment-01\
      script.txt
      hermes-manual-storyboard.md
      production.json
      visual-scene-report.json
      hermes-job.txt
      manual-assembly\
        final.mp4
        subtitles.srt
        subtitle-sync-report.json
        assembly-report.json
      validation\
        asset-validation-report.json
    segment-02\
      ...
  final\
    concat-list.txt
    final-full.mp4
    final-qa-report.json
```

---

### Task 1: Segment Planning Library

**Files:**
- Create: `C:\Users\petbl\auto-video\scripts\lib\segment-plan.mjs`

- [ ] **Step 1: Create segment planning functions**

Create `C:\Users\petbl\auto-video\scripts\lib\segment-plan.mjs`:

```js
export function deriveSceneCountForWindow({
  startSeconds,
  durationSeconds,
  introSeconds = 60,
  introSceneSeconds = 6,
  bodySceneSeconds = 30,
}) {
  const start = Math.max(0, Number(startSeconds) || 0);
  const duration = Math.max(0, Number(durationSeconds) || 0);
  const end = start + duration;
  const introEnd = Math.max(0, Number(introSeconds) || 0);
  const introOverlap = Math.max(0, Math.min(end, introEnd) - Math.min(start, introEnd));
  const bodyDuration = Math.max(0, duration - introOverlap);
  const introScenes = introOverlap > 0 ? Math.ceil(introOverlap / introSceneSeconds) : 0;
  const bodyScenes = bodyDuration > 0 ? Math.ceil(bodyDuration / bodySceneSeconds) : 0;
  return Math.max(1, introScenes + bodyScenes);
}

export function buildSegmentPlan({
  targetSeconds,
  segmentMinutes = 15,
  introSeconds = 60,
  introSceneSeconds = 6,
  bodySceneSeconds = 30,
}) {
  const total = Math.max(1, Math.round(Number(targetSeconds) || 3600));
  const segmentSeconds = Math.max(60, Math.round(Number(segmentMinutes) * 60 || 900));
  const segments = [];
  let cursor = 0;
  while (cursor < total) {
    const duration = Math.min(segmentSeconds, total - cursor);
    const sceneCount = deriveSceneCountForWindow({
      startSeconds: cursor,
      durationSeconds: duration,
      introSeconds,
      introSceneSeconds,
      bodySceneSeconds,
    });
    segments.push({
      index: segments.length + 1,
      id: `segment-${String(segments.length + 1).padStart(2, "0")}`,
      startSeconds: cursor,
      durationSeconds: duration,
      endSeconds: cursor + duration,
      sceneCount,
    });
    cursor += duration;
  }
  return {
    targetSeconds: total,
    segmentMinutes,
    segmentSeconds,
    introSeconds,
    introSceneSeconds,
    bodySceneSeconds,
    totalSceneCount: segments.reduce((sum, segment) => sum + segment.sceneCount, 0),
    segments,
  };
}
```

- [ ] **Step 2: Verify planning examples**

Run:

```powershell
@'
import { buildSegmentPlan } from './scripts/lib/segment-plan.mjs';
for (const seconds of [600, 3600, 5400]) {
  const plan = buildSegmentPlan({ targetSeconds: seconds, segmentMinutes: 15 });
  console.log(JSON.stringify({
    seconds,
    segmentCount: plan.segments.length,
    totalSceneCount: plan.totalSceneCount,
    first: plan.segments[0],
    last: plan.segments.at(-1),
  }, null, 2));
}
'@ | node --input-type=module -
```

Expected:
- 600초: 1 segment, 약 28 scenes
- 3600초: 4 segments, 약 128 scenes
- 5400초: 6 segments, 약 188 scenes

---

### Task 2: Segmented Storyboard Builder

**Files:**
- Create: `C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs`
- Modify: `C:\Users\petbl\auto-video\scripts\build_cain_longform_fast_storyboard.mjs`

- [ ] **Step 1: Create reusable text splitter**

In `build_segmented_storyboards.mjs`, create these helpers. The important order is:

1. Split the whole script into `segmentPlan.segments.length` segment scripts by target duration ratio.
2. Split each segment script into that segment's `sceneCount`.

This prevents the high-density intro from taking too much narration text.

```js
function splitIntoUnits(text) {
  const paragraphs = text.split(/\n\s*\n/g).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length >= 2) return paragraphs;
  return text
    .split(/(?<=[.!?。！？])\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function splitUnitsByWeightedTargets(units, targets) {
  const total = units.reduce((sum, unit) => sum + unit.length, 0);
  const targetTotal = targets.reduce((sum, target) => sum + target, 0);
  const buckets = Array.from({ length: targets.length }, () => []);
  let bucketIndex = 0;
  let bucketChars = 0;

  for (const unit of units) {
    const currentTarget = Math.max(1, Math.ceil((total * targets[bucketIndex]) / targetTotal));
    if (bucketIndex < targets.length - 1 && bucketChars >= currentTarget) {
      bucketIndex += 1;
      bucketChars = 0;
    }
    buckets[bucketIndex].push(unit);
    bucketChars += unit.length;
  }

  return buckets.map((bucket) => bucket.join("\n\n").trim()).filter(Boolean);
}

function splitScriptIntoTimeSegments(script, segmentPlan) {
  const units = splitIntoUnits(script);
  const targets = segmentPlan.segments.map((segment) => segment.durationSeconds);
  return splitUnitsByWeightedTargets(units, targets);
}

function splitSegmentScriptIntoScenes(segmentScript, sceneCount) {
  const units = splitIntoUnits(segmentScript);
  return splitUnitsByWeightedTargets(units, Array.from({ length: sceneCount }, () => 1));
}
```

- [ ] **Step 2: Create storyboard prompt banks**

Use the same visual style as the current longform builder:

```js
const style = [
  "strict pure black and white only",
  "grayscale biblical oil painting",
  "heavy brush texture",
  "cinematic chiaroscuro",
  "ancient Near Eastern atmosphere",
  "quiet sleep documentary mood",
  "no color tint",
  "no purple",
  "no blue",
  "no readable text",
].join(", ");

const motifBank = [
  "ancient field with two distant stone altars under a dark sky",
  "rough hands holding dark soil beside quiet furrows",
  "lonely shepherd silhouette under pale dawn near a low hill",
  "two simple lamps burning at different brightness in a small tent",
  "stone threshold divided by shadow and light",
  "empty field with disturbed soil and no visible violence",
  "hand releasing a small stone into still moonlit water",
  "two separate camps resting under the same stars",
  "single traveler walking away from a cultivated field",
  "small clay bowl beside a fuller basket on rough ground",
  "quiet path splitting between dark hills and pale horizon",
  "open hands resting on soil beside a narrow road",
];
```

- [ ] **Step 3: Implement `build_segmented_storyboards.mjs`**

Create the file with this CLI contract:

```js
#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSegmentPlan } from "./lib/segment-plan.mjs";

const root = "C:/Users/petbl/auto-video";
const args = parseArgs(process.argv.slice(2));
const sourceSlug = args.sourceSlug || "gguljam-bible-cain-envy-60min-001";
const slug = args.slug || `${sourceSlug}-segmented`;
const sourceDir = join(root, "exports", sourceSlug);
const exportDir = join(root, "exports", slug);
mkdirSync(exportDir, { recursive: true });

const script = readFileSync(join(sourceDir, "script.txt"), "utf8").trim();
const sourceProduction = readJson(join(sourceDir, "production.json"), {});
const targetSeconds = Number(
  args.targetSeconds
  || sourceProduction?.render?.target_seconds
  || sourceProduction?.targetSeconds
  || (sourceProduction?.project?.target_minutes ? sourceProduction.project.target_minutes * 60 : 3600)
);
const segmentPlan = buildSegmentPlan({
  targetSeconds,
  segmentMinutes: Number(args.segmentMinutes || 15),
  introSeconds: Number(args.introSeconds || 60),
  introSceneSeconds: Number(args.introSceneSeconds || 6),
  bodySceneSeconds: Number(args.bodySceneSeconds || 30),
});

const segmentScripts = splitScriptIntoTimeSegments(script, segmentPlan);
const segmentRecords = [];

for (const [index, segment] of segmentPlan.segments.entries()) {
  const segmentDir = join(exportDir, "segments", segment.id);
  mkdirSync(segmentDir, { recursive: true });
  const segmentScript = segmentScripts[index] || "";
  const segmentSceneTexts = splitSegmentScriptIntoScenes(segmentScript, segment.sceneCount);
  const storyboard = buildStoryboard(segmentSceneTexts, segment.index);
  writeFileSync(join(segmentDir, "script.txt"), segmentScript + "\n", "utf8");
  writeFileSync(join(segmentDir, "hermes-manual-storyboard.md"), storyboard + "\n", "utf8");
  writeFileSync(join(segmentDir, "production.json"), JSON.stringify({
    parentSlug: slug,
    sourceSlug,
    segment,
    project: {
      channel: "gguljam-bible",
      slug: `${slug}-${segment.id}`,
      title: `Gguljam Bible segmented ${segment.id}`,
      target_minutes: Math.round((segment.durationSeconds / 60) * 100) / 100,
    },
    render: {
      engine: "hermes-studio",
      manual_storyboard: "hermes-manual-storyboard.md",
      target_seconds: segment.durationSeconds,
      visual_mode: "contextual-keyframes",
      orientation: "landscape",
    },
  }, null, 2), "utf8");
  writeFileSync(join(segmentDir, "visual-scene-report.json"), JSON.stringify({
    segmentId: segment.id,
    sceneCount: segmentSceneTexts.length,
    targetSeconds: segment.durationSeconds,
    averageScriptCharsPerVisual: Math.round(segmentScript.length / Math.max(1, segmentSceneTexts.length)),
  }, null, 2), "utf8");
  segmentRecords.push({
    ...segment,
    dir: segmentDir,
    scriptPath: join(segmentDir, "script.txt"),
    storyboardPath: join(segmentDir, "hermes-manual-storyboard.md"),
    finalPath: join(segmentDir, "manual-assembly", "final.mp4"),
  });
}

writeFileSync(join(exportDir, "script.txt"), script + "\n", "utf8");
writeFileSync(join(exportDir, "segment-manifest.json"), JSON.stringify({
  sourceSlug,
  slug,
  targetSeconds,
  segmentPlan,
  segments: segmentRecords,
}, null, 2), "utf8");
console.log(JSON.stringify({ exportDir, segmentCount: segmentRecords.length, totalSceneCount: segmentPlan.totalSceneCount }, null, 2));
```

- [ ] **Step 4: Add required helper functions to the same file**

Append:

```js
function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--source-slug") parsed.sourceSlug = argv[++i];
    else if (arg === "--slug") parsed.slug = argv[++i];
    else if (arg === "--target-seconds") parsed.targetSeconds = argv[++i];
    else if (arg === "--segment-minutes") parsed.segmentMinutes = argv[++i];
    else if (arg === "--intro-seconds") parsed.introSeconds = argv[++i];
    else if (arg === "--intro-scene-seconds") parsed.introSceneSeconds = argv[++i];
    else if (arg === "--body-scene-seconds") parsed.bodySceneSeconds = argv[++i];
  }
  return parsed;
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function chooseMotif(index, segmentIndex) {
  return motifBank[(index + segmentIndex * 3) % motifBank.length];
}

function buildStoryboard(sceneTexts, segmentIndex) {
  const cameraBank = ["wide establishing shot", "low close-up", "medium rear shot", "high wide angle", "symbolic still-life close shot", "slow centered composition"];
  const lightingBank = ["soft moonlit grayscale haze", "hard side light in monochrome", "pale dawn light", "small flickering firelight in grayscale", "thin overhead light", "soft pre-dawn glow"];
  const moodBank = ["quiet and contemplative", "hurt but restrained", "solemn and human", "restful and reflective", "searching and compassionate", "peaceful and consoling"];
  const motionBank = ["very slow push-in", "slow lateral pan", "locked-off with subtle breathing light", "slow pull-back", "slow tilt from hands to face", "gentle forward glide"];
  const lines = [];
  sceneTexts.forEach((text, index) => {
    const prompt = `${chooseMotif(index, segmentIndex)}, ${style}`;
    lines.push(`[${text}]`);
    lines.push(`${prompt} / ${cameraBank[index % cameraBank.length]} / ${lightingBank[index % lightingBank.length]} / ${moodBank[index % moodBank.length]} / ${motionBank[index % motionBank.length]}`);
    lines.push("");
  });
  return lines.join("\n");
}
```

- [ ] **Step 5: Verify segmented builder**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs --source-slug gguljam-bible-cain-envy-60min-001 --slug gguljam-bible-cain-envy-60min-segmented --segment-minutes 15
```

Expected:
- `segmentCount` is `4`
- `totalSceneCount` is about `128`
- `C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-segmented\segments\segment-01\hermes-manual-storyboard.md` exists
- `segment-01` has about `38~40` scenes
- `segment-02` to `segment-04` have about `30` scenes each

---

### Task 3: Segment Export Validation

**Files:**
- Create: `C:\Users\petbl\auto-video\scripts\validate_segmented_export.py`

- [ ] **Step 1: Create validator**

Create `C:\Users\petbl\auto-video\scripts\validate_segmented_export.py`:

```python
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def count_storyboard_blocks(path: Path) -> int:
    text = path.read_text(encoding="utf-8").strip()
    return text.count("\n[") + (1 if text.startswith("[") else 0)


def ffprobe_profile(path: Path) -> dict:
    raw = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_streams",
            "-of",
            "json",
            str(path),
        ],
        text=True,
        encoding="utf-8",
    )
    data = json.loads(raw)
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
    audio = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), {})
    return {
        "videoCodec": video.get("codec_name"),
        "width": video.get("width"),
        "height": video.get("height"),
        "pixFmt": video.get("pix_fmt"),
        "rFrameRate": video.get("r_frame_rate"),
        "audioCodec": audio.get("codec_name"),
        "sampleRate": audio.get("sample_rate"),
        "channels": audio.get("channels"),
        "channelLayout": audio.get("channel_layout"),
    }


def validate_matching_profiles(final_paths: list[Path]) -> list[str]:
    if len(final_paths) < 2:
        return []
    profiles = [(path, ffprobe_profile(path)) for path in final_paths]
    baseline_path, baseline = profiles[0]
    failures: list[str] = []
    for path, profile in profiles[1:]:
        if profile != baseline:
            failures.append(
                f"stream profile mismatch: {path} differs from {baseline_path}; "
                f"baseline={baseline}; actual={profile}"
            )
    return failures


def validate(export_dir: Path) -> dict:
    manifest_path = export_dir / "segment-manifest.json"
    failures: list[str] = []
    warnings: list[str] = []
    if not manifest_path.exists():
        return {"status": "fail", "failures": [f"missing {manifest_path}"], "warnings": []}
    manifest = load_json(manifest_path)
    segment_reports = []
    ready_final_paths: list[Path] = []
    for segment in manifest.get("segments", []):
        segment_dir = Path(segment["dir"])
        storyboard = segment_dir / "hermes-manual-storyboard.md"
        production = segment_dir / "production.json"
        script = segment_dir / "script.txt"
        if not storyboard.exists():
            failures.append(f"{segment['id']}: missing storyboard")
            continue
        if not production.exists():
            failures.append(f"{segment['id']}: missing production.json")
        if not script.exists():
            failures.append(f"{segment['id']}: missing script.txt")
        blocks = count_storyboard_blocks(storyboard)
        expected = int(segment["sceneCount"])
        if blocks != expected:
            failures.append(f"{segment['id']}: storyboard blocks {blocks} != manifest sceneCount {expected}")
        sync_report = segment_dir / "manual-assembly" / "subtitle-sync-report.json"
        final_mp4 = segment_dir / "manual-assembly" / "final.mp4"
        sync_status = "missing"
        if sync_report.exists():
            sync = load_json(sync_report)
            if sync.get("audioSubtitleEndDeltaSeconds", 999) > 0.5:
                failures.append(f"{segment['id']}: subtitle/audio end delta > 0.5s")
            if sync.get("maxCueSeconds", 999) > 8:
                failures.append(f"{segment['id']}: maxCueSeconds > 8")
            sync_status = "present"
        else:
            warnings.append(f"{segment['id']}: subtitle-sync-report.json not generated yet")
        if not final_mp4.exists():
            warnings.append(f"{segment['id']}: final.mp4 not generated yet")
        else:
            ready_final_paths.append(final_mp4)
        segment_reports.append({
            "id": segment["id"],
            "storyboardBlocks": blocks,
            "expectedSceneCount": expected,
            "syncStatus": sync_status,
            "finalExists": final_mp4.exists(),
        })
    failures.extend(validate_matching_profiles(ready_final_paths))
    status = "fail" if failures else "warn" if warnings else "pass"
    return {
        "status": status,
        "exportDir": str(export_dir),
        "failures": failures,
        "warnings": warnings,
        "segments": segment_reports,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--export-dir", required=True)
    args = parser.parse_args()
    export_dir = Path(args.export_dir).resolve()
    report = validate(export_dir)
    validation_dir = export_dir / "validation"
    validation_dir.mkdir(parents=True, exist_ok=True)
    (validation_dir / "segmented-validation-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Segmented export validation: {report['status']}")
    return 0 if report["status"] in {"pass", "warn"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Validate fresh segmented export**

Run:

```powershell
python C:\Users\petbl\auto-video\scripts\validate_segmented_export.py --export-dir C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-segmented
```

Expected:
- status is `warn` before segment MP4s exist
- no failures
- warnings mention missing `final.mp4` and `subtitle-sync-report.json`

---

### Task 4: Segment Render Command Contract

**Files:**
- Modify: `C:\Users\petbl\auto-video\scripts\assemble_cain_fast_from_hermes_job.mjs`
- Create: `C:\Users\petbl\auto-video\scripts\write_segment_render_commands.mjs`

- [ ] **Step 1: Create command writer**

Create `C:\Users\petbl\auto-video\scripts\write_segment_render_commands.mjs`:

```js
#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = parseArgs(process.argv.slice(2));
const exportDir = args.exportDir;
if (!exportDir) {
  console.error("Usage: node scripts/write_segment_render_commands.mjs --export-dir <segmented-export>");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(join(exportDir, "segment-manifest.json"), "utf8"));
const commands = [];
for (const segment of manifest.segments) {
  const segmentDir = segment.dir;
  const runDir = join(segmentDir, "hermes-run");
  mkdirSync(runDir, { recursive: true });
  commands.push({
    id: segment.id,
    segmentDir,
    notes: [
      "Run Hermes for this segment using the segment script/storyboard.",
      "After Hermes creates a job directory, run the assembly command with that job dir.",
    ],
    assembleCommand: `node C:\\Users\\petbl\\auto-video\\scripts\\assemble_cain_fast_from_hermes_job.mjs --job-dir <HERMES_JOB_DIR_FOR_${segment.id}> --export-dir ${segmentDir} --final-name final.mp4`,
  });
}
writeFileSync(join(exportDir, "segment-render-commands.json"), JSON.stringify(commands, null, 2), "utf8");
console.log(JSON.stringify({ exportDir, commandCount: commands.length }, null, 2));

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--export-dir") parsed.exportDir = argv[++i];
  }
  return parsed;
}
```

- [ ] **Step 2: Generate render command file**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\write_segment_render_commands.mjs --export-dir C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-segmented
```

Expected:
- `segment-render-commands.json` exists
- command count is `4` for a 60-minute/15-minute segmented export

---

### Task 5: Final Segment Concat

**Files:**
- Create: `C:\Users\petbl\auto-video\scripts\concat_segments.mjs`

- [ ] **Step 1: Create concat script**

Create `C:\Users\petbl\auto-video\scripts\concat_segments.mjs`:

```js
#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = parseArgs(process.argv.slice(2));
const exportDir = args.exportDir;
if (!exportDir) {
  console.error("Usage: node scripts/concat_segments.mjs --export-dir <segmented-export>");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(join(exportDir, "segment-manifest.json"), "utf8"));
const finalDir = join(exportDir, "final");
mkdirSync(finalDir, { recursive: true });
const finalName = args.finalName || "final-full.mp4";
const rows = [];
const missing = [];
const finalPaths = [];
for (const segment of manifest.segments) {
  const finalPath = join(segment.dir, "manual-assembly", "final.mp4");
  if (!existsSync(finalPath)) {
    missing.push({ id: segment.id, finalPath });
  } else {
    finalPaths.push({ id: segment.id, path: finalPath, srtPath: join(segment.dir, "manual-assembly", "subtitles.srt") });
    rows.push(`file '${finalPath.replace(/'/g, "'\\''")}'`);
  }
}
if (missing.length) {
  console.error(JSON.stringify({ missing }, null, 2));
  process.exit(1);
}
assertMatchingProfiles(finalPaths);
const concatList = join(finalDir, "concat-list.txt");
writeFileSync(concatList, rows.join("\n") + "\n", "utf8");
const finalPath = join(finalDir, finalName);
execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", concatList, "-c", "copy", finalPath], { stdio: "inherit" });
const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", finalPath], { encoding: "utf8" }).trim());
const mergedSrt = mergeSegmentSrts(finalPaths);
writeFileSync(join(finalDir, "final-full.srt"), mergedSrt, "utf8");
writeFileSync(join(finalDir, "final-qa-report.json"), JSON.stringify({
  finalPath,
  finalSrtPath: join(finalDir, "final-full.srt"),
  durationSeconds: duration,
  segmentCount: manifest.segments.length,
  sourceSegments: manifest.segments.map((segment) => segment.id),
}, null, 2), "utf8");
console.log(JSON.stringify({ finalPath, durationSeconds: duration }, null, 2));

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--export-dir") parsed.exportDir = argv[++i];
    else if (argv[i] === "--final-name") parsed.finalName = argv[++i];
  }
  return parsed;
}

function ffprobeJson(path) {
  return JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", path], { encoding: "utf8" }));
}

function streamProfile(path) {
  const data = ffprobeJson(path);
  const video = data.streams.find((stream) => stream.codec_type === "video") || {};
  const audio = data.streams.find((stream) => stream.codec_type === "audio") || {};
  return {
    videoCodec: video.codec_name,
    width: video.width,
    height: video.height,
    pixFmt: video.pix_fmt,
    rFrameRate: video.r_frame_rate,
    audioCodec: audio.codec_name,
    sampleRate: audio.sample_rate,
    channels: audio.channels,
    channelLayout: audio.channel_layout,
  };
}

function assertMatchingProfiles(finalPaths) {
  const profiles = finalPaths.map((item) => ({ ...item, profile: streamProfile(item.path) }));
  const baseline = profiles[0];
  const mismatches = profiles.filter((item) => JSON.stringify(item.profile) !== JSON.stringify(baseline.profile));
  if (mismatches.length) {
    console.error(JSON.stringify({ baseline, mismatches }, null, 2));
    throw new Error("Segment MP4 stream profiles do not match; re-render or normalize segments before concat -c copy.");
  }
}

function mergeSegmentSrts(finalPaths) {
  let offset = 0;
  let cueIndex = 1;
  const output = [];
  for (const item of finalPaths) {
    if (existsSync(item.srtPath)) {
      const shifted = shiftSrt(readFileSync(item.srtPath, "utf8"), offset, cueIndex);
      output.push(shifted.text);
      cueIndex = shifted.nextCueIndex;
    }
    offset += Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", item.path], { encoding: "utf8" }).trim());
  }
  return output.filter(Boolean).join("\n\n") + "\n";
}

function shiftSrt(srtText, offsetSeconds, firstCueIndex) {
  let cueIndex = firstCueIndex;
  const blocks = srtText.trim().split(/\n\s*\n/g).filter(Boolean);
  const shiftedBlocks = blocks.map((block) => {
    const lines = block.split(/\r?\n/);
    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex < 0) return null;
    const shiftedTime = lines[timeIndex].replace(
      /(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/,
      (_, start, end) => `${shiftTime(start, offsetSeconds)} --> ${shiftTime(end, offsetSeconds)}`,
    );
    const textLines = lines.slice(timeIndex + 1);
    return [String(cueIndex++), shiftedTime, ...textLines].join("\n");
  }).filter(Boolean);
  return { text: shiftedBlocks.join("\n\n"), nextCueIndex: cueIndex };
}

function shiftTime(timeStr, offsetSeconds) {
  const [h, m, sMs] = timeStr.split(":");
  const [s, ms] = sMs.split(",");
  const totalMs = Math.round((Number(h) * 3600 + Number(m) * 60 + Number(s) + offsetSeconds) * 1000 + Number(ms));
  const nextH = String(Math.floor(totalMs / 3600000)).padStart(2, "0");
  const nextM = String(Math.floor((totalMs % 3600000) / 60000)).padStart(2, "0");
  const nextS = String(Math.floor((totalMs % 60000) / 1000)).padStart(2, "0");
  const nextMs = String(totalMs % 1000).padStart(3, "0");
  return `${nextH}:${nextM}:${nextS},${nextMs}`;
}
```

- [ ] **Step 2: Verify missing segment behavior**

Run before segment videos exist:

```powershell
node C:\Users\petbl\auto-video\scripts\concat_segments.mjs --export-dir C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-segmented
```

Expected:
- exit code `1`
- output lists missing segment final paths

---

### Task 6: Documentation Update

**Files:**
- Modify: `C:\Users\petbl\auto-video\auto-video.md`

- [ ] **Step 1: Add segmented render rules**

Append this section:

```markdown
## 꿀잠성경 장편 세그먼트 렌더링 규칙

60분 이상 최종영상은 기본적으로 한 번에 만들지 않고 세그먼트 단위로 생성한다.

- 기본 세그먼트 길이: 15분
- 안정성 우선 작업: 10분
- 빠른 작업: 20분
- 60분 영상 기본값: 15분 x 4개
- 각 세그먼트는 독립적으로 `script.txt`, `hermes-manual-storyboard.md`, `production.json`, `final.mp4`, `subtitle-sync-report.json`을 가진다.
- 실패하면 전체 영상을 재생성하지 않고 해당 세그먼트만 다시 생성한다.
- 최종 병합은 검증된 세그먼트 `final.mp4`만 `ffmpeg concat`으로 붙인다.
- 병합 전에 세그먼트 MP4의 해상도, 프레임레이트, 픽셀 포맷, 오디오 샘플레이트, 채널 수가 같은지 확인한다.
- 세그먼트별 `subtitles.srt`는 누적 타임스탬프로 합쳐 최종 `final-full.srt`를 만든다.

장면 밀도:

- 전체 영상의 첫 60초: 5~6초당 1장면
- 이후 본문: 30초당 1장면
- 이 밀도는 전체 영상 기준으로 계산하고, 세그먼트 경계 때문에 다시 intro density를 반복하지 않는다.
```

- [ ] **Step 2: Verify docs**

Run:

```powershell
Select-String -Path C:\Users\petbl\auto-video\auto-video.md -Pattern "장편 세그먼트 렌더링|15분 x 4개|ffmpeg concat|final-full.srt"
```

Expected: all four patterns are found.

---

### Task 7: End-to-End Dry Run

**Files:**
- No new files.

- [ ] **Step 1: Run syntax checks**

Run:

```powershell
node --check C:\Users\petbl\auto-video\scripts\lib\segment-plan.mjs
node --check C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs
node --check C:\Users\petbl\auto-video\scripts\write_segment_render_commands.mjs
node --check C:\Users\petbl\auto-video\scripts\concat_segments.mjs
python -m py_compile C:\Users\petbl\auto-video\scripts\validate_segmented_export.py
```

Expected: no syntax errors.

- [ ] **Step 2: Build segmented export**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs --source-slug gguljam-bible-cain-envy-60min-001 --slug gguljam-bible-cain-envy-60min-segmented --segment-minutes 15
```

Expected:
- 4 segments
- about 128 total scenes

- [ ] **Step 3: Validate segmented export**

Run:

```powershell
python C:\Users\petbl\auto-video\scripts\validate_segmented_export.py --export-dir C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-segmented
```

Expected:
- status `warn`
- no failures
- warnings only for not-yet-rendered final MP4/sync reports

- [ ] **Step 4: Generate segment render command file**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\write_segment_render_commands.mjs --export-dir C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-segmented
```

Expected:
- `segment-render-commands.json` exists
- 4 commands

- [ ] **Step 5: Verify concat fails safely before segment MP4s exist**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\concat_segments.mjs --export-dir C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-segmented
```

Expected:
- exit code `1`
- missing final MP4 paths are listed

---

### Task 8: Explicit Visual Timeline Contract

**Files:**
- Modify: `C:\Users\petbl\auto-video\scripts\lib\segment-plan.mjs`
- Modify: `C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs`

- [ ] **Step 1: Add timeline helper**

Add this export to `C:\Users\petbl\auto-video\scripts\lib\segment-plan.mjs`:

```js
export function buildVisualTimelineForWindow({
  startSeconds,
  durationSeconds,
  introSeconds = 60,
  introSceneSeconds = 6,
  bodySceneSeconds = 30,
}) {
  const segmentStart = Math.max(0, Number(startSeconds) || 0);
  const segmentDuration = Math.max(0, Number(durationSeconds) || 0);
  const segmentEnd = segmentStart + segmentDuration;
  const introEnd = Math.max(0, Number(introSeconds) || 0);
  const scenes = [];
  let cursor = segmentStart;

  while (cursor < segmentEnd - 0.001) {
    const sceneSeconds = cursor < introEnd ? introSceneSeconds : bodySceneSeconds;
    const end = Math.min(segmentEnd, cursor + sceneSeconds);
    scenes.push({
      order: scenes.length + 1,
      startSeconds: Number((cursor - segmentStart).toFixed(3)),
      endSeconds: Number((end - segmentStart).toFixed(3)),
      durationSeconds: Number((end - cursor).toFixed(3)),
    });
    cursor = end;
  }

  return scenes;
}
```

- [ ] **Step 2: Verify timeline math**

Run:

```powershell
@'
import { buildVisualTimelineForWindow } from './scripts/lib/segment-plan.mjs';
const s1 = buildVisualTimelineForWindow({ startSeconds: 0, durationSeconds: 900 });
const s2 = buildVisualTimelineForWindow({ startSeconds: 900, durationSeconds: 900 });
console.log(JSON.stringify({
  segment1Count: s1.length,
  segment1First10: s1.slice(0, 10).map((s) => s.durationSeconds),
  segment1RestUnique: [...new Set(s1.slice(10).map((s) => s.durationSeconds))],
  segment1End: s1.at(-1).endSeconds,
  segment2Count: s2.length,
  segment2Unique: [...new Set(s2.map((s) => s.durationSeconds))],
}, null, 2));
'@ | node --input-type=module -
```

Expected:
- `segment1Count` is `38`
- `segment1First10` is ten `6` values
- `segment1RestUnique` is `[30]`
- `segment1End` is `900`
- `segment2Count` is `30`
- `segment2Unique` is `[30]`

- [ ] **Step 3: Write `visual-timeline.json` per segment**

In `C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs`, import the helper:

```js
import { buildSegmentPlan, buildVisualTimelineForWindow } from "./lib/segment-plan.mjs";
```

Inside the segment loop, before calling `buildStoryboard()`, create the timeline:

```js
const visualTimeline = buildVisualTimelineForWindow({
  startSeconds: segment.startSeconds,
  durationSeconds: segment.durationSeconds,
  introSeconds: segmentPlan.introSeconds,
  introSceneSeconds: segmentPlan.introSceneSeconds,
  bodySceneSeconds: segmentPlan.bodySceneSeconds,
});
if (visualTimeline.length !== segment.sceneCount) {
  throw new Error(`${segment.id}: visual timeline scenes ${visualTimeline.length} != segment.sceneCount ${segment.sceneCount}`);
}
const storyboard = buildStoryboard(segmentSceneTexts, segment.index, visualTimeline);
writeFileSync(join(segmentDir, "visual-timeline.json"), JSON.stringify({
  segmentId: segment.id,
  targetSeconds: segment.durationSeconds,
  scenes: visualTimeline,
}, null, 2), "utf8");
```

- [ ] **Step 4: Append duration metadata to storyboard prompts**

Change `buildStoryboard()` in `C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs` to accept the visual timeline:

```js
function buildStoryboard(sceneTexts, segmentIndex, visualTimeline) {
  const cameraBank = ["wide establishing shot", "low close-up", "medium rear shot", "high wide angle", "symbolic still-life close shot", "slow centered composition"];
  const lightingBank = ["soft moonlit grayscale haze", "hard side light in monochrome", "pale dawn light", "small flickering firelight in grayscale", "thin overhead light", "soft pre-dawn glow"];
  const moodBank = ["quiet and contemplative", "hurt but restrained", "solemn and human", "restful and reflective", "searching and compassionate", "peaceful and consoling"];
  const motionBank = ["very slow push-in", "slow lateral pan", "locked-off with subtle breathing light", "slow pull-back", "slow tilt from hands to face", "gentle forward glide"];
  const lines = [];
  sceneTexts.forEach((text, index) => {
    const prompt = `${chooseMotif(index, segmentIndex)}, ${style}`;
    const duration = visualTimeline[index]?.durationSeconds;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`Missing visual timeline duration for storyboard scene ${index + 1}`);
    }
    lines.push(`[${cleanStoryboardText(text)}]`);
    lines.push(`${prompt} / ${cameraBank[index % cameraBank.length]} / ${lightingBank[index % lightingBank.length]} / ${moodBank[index % moodBank.length]} / ${motionBank[index % motionBank.length]} / duration:${duration}`);
    lines.push("");
  });
  return lines.join("\n");
}
```

- [ ] **Step 5: Verify regenerated Segment 1 timeline**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs --source-slug gguljam-bible-cain-envy-60min-001 --slug gguljam-bible-cain-envy-60min-segmented --segment-minutes 15
@'
const fs = require('fs');
const base = 'C:/Users/petbl/auto-video/exports/gguljam-bible-cain-envy-60min-segmented/segments/segment-01';
const timeline = JSON.parse(fs.readFileSync(base + '/visual-timeline.json', 'utf8'));
const md = fs.readFileSync(base + '/hermes-manual-storyboard.md', 'utf8');
console.log(JSON.stringify({
  timelineCount: timeline.scenes.length,
  first10: timeline.scenes.slice(0, 10).map((s) => s.durationSeconds),
  restUnique: [...new Set(timeline.scenes.slice(10).map((s) => s.durationSeconds))],
  durationTags: (md.match(/duration:/g) || []).length
}, null, 2));
'@ | node -
```

Expected:
- `timelineCount` is `38`
- `first10` is ten `6` values
- `restUnique` is `[30]`
- `durationTags` is `38`

---

### Task 9: Hermes Manual Storyboard Duration Support

**Files:**
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\lib\manual-storyboard\parser.mjs`
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\lib\manual-storyboard\storyboard-plan.mjs`
- Test: `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-manual-storyboard-parser.mjs`
- Test: `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-manual-storyboard-plan.mjs`

- [ ] **Step 1: Extend parser test**

Add a case to `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-manual-storyboard-parser.mjs`:

```js
const withDuration = parseManualStoryboardText(`
[짧은 첫 장면]
ancient field, grayscale / wide shot / moonlight / quiet / slow push-in / duration:6

[긴 본문 장면]
quiet road, grayscale / medium shot / dawn / reflective / slow pan / duration:30
`);
assert.equal(withDuration.scenes[0].duration, 6);
assert.equal(withDuration.scenes[1].duration, 30);
```

- [ ] **Step 2: Parse `duration:X` metadata**

In `C:\Users\petbl\hermes-studio\hermes-local\lib\manual-storyboard\parser.mjs`, update `splitPromptFields()`:

```js
function splitPromptFields(promptLine) {
  const durationMatch = String(promptLine || "").match(/\/\s*duration\s*:\s*(\d+(?:\.\d+)?)/i);
  const duration = durationMatch ? Number(durationMatch[1]) : null;
  const cleanPromptLine = durationMatch ? String(promptLine).replace(durationMatch[0], "") : String(promptLine || "");
  const parts = cleanPromptLine.split("/").map(clean);
  const result = { duration: Number.isFinite(duration) && duration > 0 ? duration : null };
  if (parts.length >= 5) {
    const metadata = parts.slice(-4);
    return {
      ...result,
      prompt: parts.slice(0, -4).join("/").trim(),
      shot: metadata[0] || "",
      lighting: metadata[1] || "",
      mood: metadata[2] || "",
      motion: metadata[3] || "",
    };
  }
  return {
    ...result,
    prompt: parts[0] || "",
    shot: parts[1] || "",
    lighting: parts[2] || "",
    mood: parts[3] || "",
    motion: "",
  };
}
```

In the `scenes.push()` object, include:

```js
duration,
```

- [ ] **Step 3: Extend plan test**

Add a case to `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-manual-storyboard-plan.mjs`:

```js
const durationParsed = parseManualStoryboardText(`
[짧은 첫 장면]
ancient field, grayscale / wide shot / moonlight / quiet / slow push-in / duration:6

[긴 본문 장면]
quiet road, grayscale / medium shot / dawn / reflective / slow pan / duration:30
`);
const durationPlan = buildManualStoryboardPlan({
  parsed: durationParsed,
  targetSeconds: 36,
});
assert.deepEqual(durationPlan.scenes.map((scene) => scene.duration_seconds), [6, 30]);
```

- [ ] **Step 4: Respect explicit durations in storyboard and scene plans**

In `C:\Users\petbl\hermes-studio\hermes-local\lib\manual-storyboard\storyboard-plan.mjs`, change both callers:

```js
const duration = resolveSceneDurations(inputScenes, targetSeconds, 4);
```

and:

```js
const duration = resolveSceneDurations(inputScenes, targetSeconds, 2);
```

Replace `resolveSceneDurations()` with:

```js
function resolveSceneDurations(scenesOrCount, targetSeconds, minimum) {
  const scenes = Array.isArray(scenesOrCount) ? scenesOrCount : [];
  const count = Array.isArray(scenesOrCount) ? scenesOrCount.length : Number(scenesOrCount) || 0;
  const durations = Array.from({ length: count }, () => null);
  let allocatedTotal = 0;
  let unallocatedCount = 0;

  for (let i = 0; i < count; i += 1) {
    const explicit = Number(scenes[i]?.duration);
    if (Number.isFinite(explicit) && explicit > 0) {
      durations[i] = Number(Math.max(minimum, explicit).toFixed(2));
      allocatedTotal += durations[i];
    } else {
      unallocatedCount += 1;
    }
  }

  const total = Number(targetSeconds);
  if (unallocatedCount > 0) {
    const remaining = Number.isFinite(total) && total > allocatedTotal
      ? total - allocatedTotal
      : 0;
    const fallbackEach = remaining > 0
      ? Math.max(minimum, remaining / unallocatedCount)
      : (Number.isFinite(total) && total > 0 ? Math.max(minimum, total / count) : Math.max(minimum, 5));
    for (let i = 0; i < count; i += 1) {
      if (durations[i] === null) durations[i] = Number(fallbackEach.toFixed(2));
    }
  }

  return durations;
}
```

- [ ] **Step 5: Run Hermes manual storyboard tests**

Run:

```powershell
node C:\Users\petbl\hermes-studio\hermes-local\scripts\check-manual-storyboard-parser.mjs
node C:\Users\petbl\hermes-studio\hermes-local\scripts\check-manual-storyboard-plan.mjs
```

Expected:
- both commands exit `0`
- duration assertions pass

---

### Task 10: Timeline-Aware Assembly

**Files:**
- Modify: `C:\Users\petbl\auto-video\scripts\assemble_cain_fast_from_hermes_job.mjs`

- [ ] **Step 1: Add timeline loader**

Add helper:

```js
function loadVisualTimeline(exportDir) {
  const path = join(exportDir, "visual-timeline.json");
  if (!existsSync(path)) return null;
  const data = JSON.parse(readFileSync(path, "utf8"));
  const scenes = Array.isArray(data.scenes) ? data.scenes : [];
  if (!scenes.length) throw new Error(`visual-timeline.json has no scenes: ${path}`);
  return { path, scenes };
}
```

- [ ] **Step 2: Build visual groups from timeline when present**

After `voiceRows` are created and before writing `image-list.txt`, replace fixed grid grouping with:

```js
const visualTimeline = loadVisualTimeline(exportDir);
const groups = visualTimeline
  ? buildTimelineGroups({ visualTimeline, keyframes, jobDir })
  : buildFixedGridGroups({ cursor, keyframes, jobDir, maxImageSeconds });
```

Add helpers:

```js
function buildTimelineGroups({ visualTimeline, keyframes, jobDir }) {
  if (keyframes.length < visualTimeline.scenes.length) {
    throw new Error(
      `Keyframe count ${keyframes.length} is less than visual timeline scenes ${visualTimeline.scenes.length}. ` +
      `Refusing to stretch or cycle images for ${visualTimeline.path}.`
    );
  }
  return visualTimeline.scenes.map((scene, index) => {
    const keyframe = keyframes[index];
    const keyframePath = resolve(jobDir, keyframe.output_path || `keyframes/scene_${String(index + 1).padStart(2, "0")}.png`);
    return {
      keyframePath,
      duration: Number(scene.durationSeconds),
      start: Number(scene.startSeconds),
      end: Number(scene.endSeconds),
      timelineOrder: Number(scene.order),
    };
  });
}

function buildFixedGridGroups({ cursor, keyframes, jobDir, maxImageSeconds }) {
  const groups = [];
  for (let start = 0; start < cursor; start += maxImageSeconds) {
    const end = Math.min(cursor, start + maxImageSeconds);
    const keyframe = keyframes[Math.floor(start / maxImageSeconds) % Math.max(1, keyframes.length)];
    const keyframePath = resolve(jobDir, keyframe?.output_path || "keyframes/scene_01.png");
    groups.push({ keyframePath, duration: end - start, start, end });
  }
  return groups;
}
```

- [ ] **Step 3: Report timeline source**

Add these fields to `assembly-report.json`:

```js
visualTimelinePath: visualTimeline?.path || null,
visualTimelineSceneCount: visualTimeline?.scenes?.length || null,
```

- [ ] **Step 4: Verify strict failure on insufficient keyframes**

Run against the old 15-keyframe whole job with a segment timeline:

```powershell
Copy-Item C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-segmented\segments\segment-01\visual-timeline.json C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-fast-001\visual-timeline.json -Force
node C:\Users\petbl\auto-video\scripts\assemble_cain_fast_from_hermes_job.mjs --job-dir C:\Users\petbl\hermes-studio\hermes-local\outputs\job-2026-06-29T15-41-55-670Z --export-dir C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-fast-001 --final-name should-fail.mp4
Remove-Item C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-fast-001\visual-timeline.json -Force
```

Expected:
- assembly exits non-zero
- error says keyframe count `15` is less than visual timeline scenes `38`

---

### Task 11: Timeline Validation Gate

**Files:**
- Modify: `C:\Users\petbl\auto-video\scripts\validate_segmented_export.py`

- [ ] **Step 1: Validate timeline file and duration tags**

Add this helper:

```python
def load_visual_timeline(segment_dir: Path) -> dict | None:
    path = segment_dir / "visual-timeline.json"
    if not path.exists():
        return None
    return load_json(path)
```

Inside each segment validation block, after counting storyboard blocks, add:

```python
timeline = load_visual_timeline(segment_dir)
if timeline is None:
    failures.append(f"{segment_id}: missing visual-timeline.json")
else:
    timeline_scenes = timeline.get("scenes", [])
    if len(timeline_scenes) != expected:
        failures.append(f"{segment_id}: visual timeline scenes {len(timeline_scenes)} != manifest sceneCount {expected}")
    timeline_end = float(timeline_scenes[-1].get("endSeconds", 0)) if timeline_scenes else 0
    target_duration = float(segment.get("durationSeconds", 0) or 0)
    if abs(timeline_end - target_duration) > 0.01:
        failures.append(f"{segment_id}: visual timeline end {timeline_end:.3f}s != target {target_duration:.3f}s")
    duration_tag_count = storyboard.read_text(encoding="utf-8").count("duration:")
    if duration_tag_count != expected:
        failures.append(f"{segment_id}: storyboard duration tags {duration_tag_count} != sceneCount {expected}")
```

- [ ] **Step 2: Validate Segment 1 pacing rule**

Still inside each segment validation block, add:

```python
if segment_id == "segment-01" and timeline is not None:
    durations = [float(scene.get("durationSeconds", 0)) for scene in timeline.get("scenes", [])]
    if durations[:10] != [6.0] * 10:
        failures.append("segment-01: first 10 visual durations must be 6s each")
    if any(abs(value - 30.0) > 0.01 for value in durations[10:]):
        failures.append("segment-01: body visual durations after first 10 scenes must be 30s each")
```

- [ ] **Step 3: Run validation**

Run:

```powershell
python C:\Users\petbl\auto-video\scripts\validate_segmented_export.py --export-dir C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-segmented
```

Expected:
- status is `warn` before rendered segment MP4s exist
- no failures for visual timeline, duration tags, or Segment 1 pacing

---

### Task 12: Documentation Timeline Clarification

**Files:**
- Modify: `C:\Users\petbl\auto-video\auto-video.md`

- [ ] **Step 1: Add hard rule**

Append this to the longform segmented workflow section:

```markdown
### 장면 수와 실제 이미지 타임라인은 반드시 분리해서 검증한다

- `sceneCount`는 계획상 장면 개수일 뿐이다.
- 최종 영상에서 이미지가 언제 바뀌는지는 `visual-timeline.json`이 기준이다.
- Segment 1은 반드시 첫 10장면이 각 6초이고, 이후 28장면이 각 30초여야 한다.
- `hermes-manual-storyboard.md`의 모든 프롬프트 줄에는 `/ duration:X`가 있어야 한다.
- `visual-timeline.json`이 없거나, duration 태그 수가 장면 수와 다르면 렌더를 진행하지 않는다.
- 키프레임 수가 visual timeline 장면 수보다 적으면 조립을 실패 처리한다. 이미지를 순환하거나 몇 분씩 늘려 붙이지 않는다.
```

- [ ] **Step 2: Verify docs**

Run:

```powershell
Select-String -Path C:\Users\petbl\auto-video\auto-video.md -Pattern "visual-timeline.json|duration:X|첫 10장면|키프레임 수"
```

Expected:
- all four patterns are found

---

## Self-Review Notes

- Spec coverage: Covers segment planning, segmented storyboard export, explicit visual timeline generation, Hermes duration parsing, timeline-aware assembly, validation, render command handoff, final concat, docs, and dry run.
- Placeholder scan: No `TBD` or unspecified implementation steps remain.
- Type consistency: Uses `targetSeconds`, `segmentMinutes`, `segmentPlan`, `segments`, and `sceneCount` consistently across JS and Python.
- Scope: This plan does not run Hermes itself. It prepares the segmented pipeline and command contract so Hermes can run per segment safely.

Plan complete and saved to `C:\Users\petbl\auto-video\docs\superpowers\plans\2026-06-30-segmented-longform-render-pipeline.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks.
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.
