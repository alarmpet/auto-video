# Ken Burns Motion Variety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정적 이미지 기반 장편 영상에 확대, 축소, 좌/우/상/하, 대각선 이동을 안정적으로 적용해 화면이 몇십 초 동안 멈춰 보이지 않게 만든다.

**Architecture:** 현재 `auto-video`의 최종 조립 경로는 이미지 목록을 1초 단위로 concat한 뒤 `fps=6`만 적용하므로 Ken Burns 모션이 빠진다. 이를 장면별 motion clip 렌더 방식으로 바꾸고, 각 장면마다 deterministic random motion을 배정한 뒤 FFmpeg `zoompan` 필터로 부드러운 카메라 움직임을 만든다. 기존 오디오 길이 계산(`totalImageSeconds`, `targetMediaSeconds`)은 그대로 보존하고, 정지 이미지 concat 호출만 motion clip concat으로 교체한다.

**Tech Stack:** Node.js ESM, FFmpeg `zoompan`, FFprobe, existing `assemble_cain_fast_from_hermes_job.mjs`, JSON motion manifest, optional FFmpeg `freezedetect` QA.

---

## Review Disposition

검토 문서: `C:\Users\petbl\auto-video\docs\superpowers\plans\2026-07-01-kenburns-motion-variety-review-report.md`

반영:

- Task 2 Step 3의 삭제 범위가 모호하다는 지적은 타당하다. `totalImageSeconds`와 `targetMediaSeconds`는 오디오 속도 게이트에서 계속 필요하므로 삭제하면 안 된다.
- `travelZoom = max(zoomAmount, 0.12)`가 짧은 6초 장면에서도 12% 이동을 강제한다는 지적은 타당하다. 수면용 영상에는 과하므로 장면 길이 기반 이동 여백으로 바꾼다.
- `assembly-report.json`의 `zoomAmount`가 실제 pan/diagonal 이동 여백과 다르게 기록될 수 있다는 지적은 타당하다. 실제 적용값을 `effectiveZoom`, `travelZoom`, `zoomAmount`로 분리 기록한다.
- 모션 다양성을 렌더 후 검증에만 맡기면 재렌더 비용이 커진다는 지적은 타당하다. 렌더 전 motion plan 생성 단계에서 최소 다양성을 보장한다.
- 전체 세그먼트 렌더 전에 1~2개 클립 벤치마크가 필요하다는 지적은 타당하다. preflight benchmark 태스크를 추가한다.

미반영:

- 모션 방향 수식 자체가 틀렸다는 문제는 발견되지 않았다. 리뷰에서도 방향 수식은 한국어 설명과 일치한다고 확인했다.

## Current Finding

현재 생성된 영상에서 줌/팬이 거의 보이지 않는 주된 원인은 `C:\Users\petbl\auto-video\scripts\assemble_cain_fast_from_hermes_job.mjs`의 조립 방식이다.

현재 흐름:

```js
for (let second = 0; second < totalImageSeconds; second += 1) {
  const group = groups.find((item) => second >= item.start && second < item.end) || groups[groups.length - 1];
  imageLines.push(`file '${group.keyframePath.replace(/'/g, "'\\''")}'`);
  imageLines.push("duration 1");
}

run("ffmpeg", [
  "-y",
  "-f", "concat",
  "-safe", "0",
  "-i", imageList,
  "-vf", "fps=6,format=yuv420p",
  "-c:v", "libx264",
  "-preset", "veryfast",
  "-crf", "20",
  join(outDir, "visual-base.mp4"),
]);
```

이 방식은 장면 이미지를 시간만큼 반복할 뿐, `zoompan`, crop 이동, scale 변화가 없다. 실제 `assembly-report.json`의 `visualGroups`도 아래처럼 `image`와 `duration`만 기록한다.

```json
{
  "image": "scene_11.png",
  "duration": 30
}
```

따라서 사용자가 느낀 “줌/팬 효과가 아예 없는 것 같다”는 판단은 타당하다.

## Research Summary

- FFmpeg의 `zoompan` 필터는 입력 프레임에 대해 zoom, x, y, duration, output size, fps를 지정해 슬라이드쇼형 확대/이동 효과를 만들 수 있다. Source: https://ffmpeg.org/ffmpeg-filters.html#zoompan
- FFmpeg slideshow/Ken Burns 예제들은 정지 이미지에 `zoompan=z=...:x=...:y=...:d=...` 형태의 필터를 걸어 동영상을 만든다. Source: https://trac.ffmpeg.org/wiki/Slideshow
- MoviePy는 Python 기반 비디오 편집 라이브러리이며 이미지/클립을 programmatic하게 조합할 수 있다. 다만 현재 프로젝트는 이미 FFmpeg를 직접 쓰고 있으므로 새 의존성보다 FFmpeg 필터 직접 적용이 우선이다. Source: https://github.com/Zulko/moviepy
- Hermes Studio 기존 구현 `C:\Users\petbl\hermes-studio\hermes-local\lib\visual\livingstill.mjs`에는 이미 `KENBURNS_MOVES = ["zoomin", "zoomout", "panL", "panR", "panU", "panD", "diagDR", "diagUR"]`와 `zoompan` 기반 구현이 있다. 이를 참고하되, 사용자가 요청한 왼쪽 대각선/오른쪽 대각선을 모두 포괄하기 위해 `diagUL`, `diagUR`, `diagDL`, `diagDR`까지 확장한다.

## Motion Policy

장면마다 아래 모션 중 하나를 배정한다.

- `zoomin`: 천천히 확대
- `zoomout`: 천천히 축소
- `panL`: 오른쪽에서 왼쪽으로 이동
- `panR`: 왼쪽에서 오른쪽으로 이동
- `panU`: 아래에서 위로 이동
- `panD`: 위에서 아래로 이동
- `diagUL`: 오른쪽 아래에서 왼쪽 위로 이동
- `diagUR`: 왼쪽 아래에서 오른쪽 위로 이동
- `diagDL`: 오른쪽 위에서 왼쪽 아래로 이동
- `diagDR`: 왼쪽 위에서 오른쪽 아래로 이동

분배 규칙:

- 같은 모션이 연속 2회 나오지 않는다.
- 15분 세그먼트 기준 최소 5개 이상의 서로 다른 모션이 사용되어야 한다.
- 장면 시간이 6초 이하이면 줌/이동 여백은 2~4%로 작게 둔다.
- 장면 시간이 30초 이상이면 줌/이동 여백은 5~8%로 둔다.
- pan/diagonal 이동도 고정 12%를 쓰지 않고 장면 길이 기반 `effectiveZoom`을 사용한다.
- 전체 톤은 수면용이므로 흔들림, 빠른 줌, 급격한 패닝은 금지한다.
- 최종 `assembly-report.json`에는 각 장면의 `motion`, `zoomAmount`, `effectiveZoom`, `travelZoom`, `fps`, `duration`, `clip`을 기록한다.

## File Structure

- Create: `C:\Users\petbl\auto-video\scripts\lib\kenburns-motion.mjs`
  - 모션 목록, seed 기반 motion plan 생성, FFmpeg `zoompan` filter 생성 담당.
- Modify: `C:\Users\petbl\auto-video\scripts\assemble_cain_fast_from_hermes_job.mjs`
  - 기존 image-list concat 방식 대신 장면별 motion clip 렌더 후 concat.
- Create: `C:\Users\petbl\auto-video\scripts\check_motion_manifest.mjs`
  - `assembly-report.json`의 motion coverage와 실제 clip duration을 검증.
- Modify: `C:\Users\petbl\auto-video\scripts\validate_segmented_export.py`
  - 렌더 후 `visualGroups[*].motion` 존재와 다양성 검사 추가.
- Modify: `C:\Users\petbl\auto-video\auto-video.md`
  - 장편 영상은 장면별 Ken Burns motion manifest를 필수로 남긴다는 운영 규칙 추가.

---

### Task 1: Add Ken Burns Motion Library

**Files:**
- Create: `C:\Users\petbl\auto-video\scripts\lib\kenburns-motion.mjs`

- [ ] **Step 1: Create motion library**

Create `C:\Users\petbl\auto-video\scripts\lib\kenburns-motion.mjs`:

```js
export const KENBURNS_MOVES = [
  "zoomin",
  "zoomout",
  "panL",
  "panR",
  "panU",
  "panD",
  "diagUL",
  "diagUR",
  "diagDL",
  "diagDR",
];

const CENTER_X = "iw/2-(iw/zoom/2)";
const CENTER_Y = "ih/2-(ih/zoom/2)";

export function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function zoomAmountForDuration(durationSeconds) {
  const duration = Number(durationSeconds) || 0;
  if (duration <= 6.5) return 0.035;
  if (duration <= 12) return 0.045;
  return 0.07;
}

export function createMotionPlan({ groups, seed = "", minUnique = 5 } = {}) {
  const plan = [];
  const used = new Set();
  let previous = null;
  for (let index = 0; index < groups.length; index += 1) {
    const remainingSlots = groups.length - index;
    const missing = KENBURNS_MOVES.filter((move) => !used.has(move));
    let candidates = KENBURNS_MOVES.filter((move) => move !== previous);
    if (used.size < minUnique && missing.length >= remainingSlots) {
      candidates = missing.filter((move) => move !== previous);
    }
    const base = hashString(`${seed}:${index}`);
    const motion = candidates[base % candidates.length] || KENBURNS_MOVES[index % KENBURNS_MOVES.length];
    used.add(motion);
    previous = motion;
    plan.push({ index, motion });
  }
  return plan;
}

export function motionExpressions({ move, zoomAmount, frames }) {
  const safeFrames = Math.max(1, Math.round(Number(frames) || 1));
  const progress = `on/${safeFrames}`;
  const effectiveZoom = Number(zoomAmount);
  const zEnd = (1 + effectiveZoom).toFixed(5);
  const travelZoom = zEnd;

  switch (move) {
    case "zoomin":
      return {
        z: `min(1.0+${effectiveZoom.toFixed(5)}*${progress},${zEnd})`,
        x: CENTER_X,
        y: CENTER_Y,
        effectiveZoom,
        travelZoom: null,
      };
    case "zoomout":
      return {
        z: `max(${zEnd}-${effectiveZoom.toFixed(5)}*${progress},1.0)`,
        x: CENTER_X,
        y: CENTER_Y,
        effectiveZoom,
        travelZoom: null,
      };
    case "panL":
      return { z: travelZoom, x: `(iw-iw/zoom)*(1-${progress})`, y: CENTER_Y, effectiveZoom, travelZoom: effectiveZoom };
    case "panR":
      return { z: travelZoom, x: `(iw-iw/zoom)*${progress}`, y: CENTER_Y, effectiveZoom, travelZoom: effectiveZoom };
    case "panU":
      return { z: travelZoom, x: CENTER_X, y: `(ih-ih/zoom)*(1-${progress})`, effectiveZoom, travelZoom: effectiveZoom };
    case "panD":
      return { z: travelZoom, x: CENTER_X, y: `(ih-ih/zoom)*${progress}`, effectiveZoom, travelZoom: effectiveZoom };
    case "diagUL":
      return { z: travelZoom, x: `(iw-iw/zoom)*(1-${progress})`, y: `(ih-ih/zoom)*(1-${progress})`, effectiveZoom, travelZoom: effectiveZoom };
    case "diagUR":
      return { z: travelZoom, x: `(iw-iw/zoom)*${progress}`, y: `(ih-ih/zoom)*(1-${progress})`, effectiveZoom, travelZoom: effectiveZoom };
    case "diagDL":
      return { z: travelZoom, x: `(iw-iw/zoom)*(1-${progress})`, y: `(ih-ih/zoom)*${progress}`, effectiveZoom, travelZoom: effectiveZoom };
    case "diagDR":
      return { z: travelZoom, x: `(iw-iw/zoom)*${progress}`, y: `(ih-ih/zoom)*${progress}`, effectiveZoom, travelZoom: effectiveZoom };
    default:
      return {
        z: `min(1.0+${effectiveZoom.toFixed(5)}*${progress},${zEnd})`,
        x: CENTER_X,
        y: CENTER_Y,
        effectiveZoom,
        travelZoom: null,
      };
  }
}

export function buildKenBurnsFilter({
  width = 1920,
  height = 1080,
  fps = 24,
  durationSeconds = 8,
  move = "zoomin",
  zoomAmount = zoomAmountForDuration(durationSeconds),
  forceMonochrome = true,
  upscale = 2,
} = {}) {
  const frames = Math.max(1, Math.round(Number(durationSeconds) * Number(fps)));
  const expr = motionExpressions({ move, zoomAmount, frames });
  const parts = [
    `scale=${width * upscale}:${height * upscale}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${width * upscale}:${height * upscale}`,
    `zoompan=z='${expr.z}':x='${expr.x}':y='${expr.y}':d=1:s=${width}x${height}:fps=${fps}`,
  ];
  if (forceMonochrome) parts.push("hue=s=0");
  parts.push("format=yuv420p");
  return {
    filter: parts.join(","),
    frames,
    move,
    zoomAmount,
    effectiveZoom: expr.effectiveZoom,
    travelZoom: expr.travelZoom,
    fps,
    upscale,
  };
}
```

- [ ] **Step 2: Run syntax check**

Run:

```powershell
node --check C:\Users\petbl\auto-video\scripts\lib\kenburns-motion.mjs
```

Expected: exit code `0`.

---

### Task 2: Replace Still Image Concat With Motion Clip Rendering

**Files:**
- Modify: `C:\Users\petbl\auto-video\scripts\assemble_cain_fast_from_hermes_job.mjs`

- [ ] **Step 1: Import motion helpers**

Add near the other imports:

```js
import { buildKenBurnsFilter, createMotionPlan, zoomAmountForDuration } from "./lib/kenburns-motion.mjs";
```

- [ ] **Step 2: Add render function**

Add this helper after `buildFixedGridGroups`:

```js
function renderMotionClip({ group, index, motion, outDir }) {
  const zoomAmount = zoomAmountForDuration(group.duration);
  const fps = 24;
  const clipPath = join(outDir, "motion-clips", `clip_${String(index + 1).padStart(3, "0")}.mp4`);
  mkdirSync(join(outDir, "motion-clips"), { recursive: true });
  const built = buildKenBurnsFilter({
    width: 1920,
    height: 1080,
    fps,
    durationSeconds: group.duration,
    move: motion,
    zoomAmount,
    forceMonochrome: true,
    upscale: 2,
  });
  run("ffmpeg", [
    "-y",
    "-loop", "1",
    "-i", group.keyframePath,
    "-vf", built.filter,
    "-t", String(group.duration),
    "-r", String(fps),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    clipPath,
  ]);
  return {
    ...group,
    motion,
    zoomAmount,
    effectiveZoom: built.effectiveZoom,
    travelZoom: built.travelZoom,
    fps,
    clipPath,
  };
}
```

- [ ] **Step 3: Replace only the static image-list visual-base generation**

Do not remove `totalImageSeconds` or `targetMediaSeconds`; they are required by the audio speed gate.

Keep this block:

```js
const totalImageSeconds = Math.ceil(groups.at(-1)?.end || cursor);
const targetMediaSeconds = visualTimeline ? totalImageSeconds + 1 : cursor;
```

Remove only:

```js
const imageList = join(outDir, "image-list.txt");
const imageLines = [];
for (let second = 0; second < totalImageSeconds; second += 1) {
  const group = groups.find((item) => second >= item.start && second < item.end) || groups[groups.length - 1];
  imageLines.push(`file '${group.keyframePath.replace(/'/g, "'\\''")}'`);
  imageLines.push("duration 1");
}
imageLines.push(`file '${groups[groups.length - 1].keyframePath.replace(/'/g, "'\\''")}'`);
writeFileSync(imageList, imageLines.join("\n") + "\n", "utf8");
```

Also remove only the later static visual-base command:

```js
run("ffmpeg", [
  "-y",
  "-f", "concat",
  "-safe", "0",
  "-i", imageList,
  "-vf", "fps=6,format=yuv420p",
  "-c:v", "libx264",
  "-preset", "veryfast",
  "-crf", "20",
  join(outDir, "visual-base.mp4"),
]);
```

Replace those removed blocks with:

```js
const motionClipList = join(outDir, "motion-clip-list.txt");
const motionPlan = createMotionPlan({
  groups,
  seed: `${exportDir}:${jobDir}`,
  minUnique: Math.min(5, groups.length),
});
const motionGroups = groups.map((group, index) => renderMotionClip({
  group,
  index,
  motion: motionPlan[index].motion,
  outDir,
}));
writeFileSync(
  motionClipList,
  motionGroups.map((group) => `file '${group.clipPath.replace(/'/g, "'\\''")}'`).join("\n") + "\n",
  "utf8",
);

run("ffmpeg", [
  "-y",
  "-f", "concat",
  "-safe", "0",
  "-i", motionClipList,
  "-c", "copy",
  join(outDir, "visual-base.mp4"),
]);
```

- [ ] **Step 4: Record actual motion groups in assembly report**

Change the `visualGroups` entry in `assembly-report.json` from:

```js
visualGroups: groups.map((group) => ({ image: basename(group.keyframePath), duration: Number(group.duration.toFixed(3)) })),
```

to:

```js
visualGroups: motionGroups.map((group) => ({
  image: basename(group.keyframePath),
  duration: Number(group.duration.toFixed(3)),
  motion: group.motion,
  zoomAmount: Number(group.zoomAmount.toFixed(5)),
  effectiveZoom: Number(group.effectiveZoom.toFixed(5)),
  travelZoom: group.travelZoom === null ? null : Number(group.travelZoom.toFixed(5)),
  fps: group.fps,
  clip: basename(group.clipPath),
})),
```

- [ ] **Step 5: Run syntax check**

Run:

```powershell
node --check C:\Users\petbl\auto-video\scripts\assemble_cain_fast_from_hermes_job.mjs
```

Expected: exit code `0`.

---

### Task 3: Add Motion Manifest Checker

**Files:**
- Create: `C:\Users\petbl\auto-video\scripts\check_motion_manifest.mjs`

- [ ] **Step 1: Create checker**

Create `C:\Users\petbl\auto-video\scripts\check_motion_manifest.mjs`:

```js
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { KENBURNS_MOVES } from "./lib/kenburns-motion.mjs";

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("Usage: node scripts/check_motion_manifest.mjs <assembly-report.json>");
  process.exit(2);
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));
const groups = Array.isArray(report.visualGroups) ? report.visualGroups : [];
const failures = [];
const motions = groups.map((group) => group.motion).filter(Boolean);
const unique = new Set(motions);

if (!groups.length) failures.push("visualGroups missing or empty");
if (motions.length !== groups.length) failures.push(`motion_count_mismatch:${motions.length}<${groups.length}`);
for (const motion of motions) {
  if (!KENBURNS_MOVES.includes(motion)) failures.push(`unknown_motion:${motion}`);
}
for (let index = 1; index < motions.length; index += 1) {
  if (motions[index] === motions[index - 1]) failures.push(`consecutive_motion_repeat:${index}:${motions[index]}`);
}
if (groups.length >= 10 && unique.size < 5) failures.push(`motion_variety_too_low:${unique.size}<5`);
for (const [index, group] of groups.entries()) {
  if (!Number.isFinite(Number(group.effectiveZoom))) failures.push(`missing_effective_zoom:${index + 1}`);
  if (!Number.isFinite(Number(group.fps))) failures.push(`missing_fps:${index + 1}`);
  if (!group.clip) failures.push(`missing_clip:${index + 1}`);
}

const result = {
  ok: failures.length === 0,
  failures,
  groupCount: groups.length,
  uniqueMotions: [...unique],
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
```

- [ ] **Step 2: Run syntax check**

Run:

```powershell
node --check C:\Users\petbl\auto-video\scripts\check_motion_manifest.mjs
```

Expected: exit code `0`.

- [ ] **Step 3: Confirm the current old render fails**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\check_motion_manifest.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-segmented\segments\segment-01\manual-assembly\assembly-report.json
```

Expected: exit code `1`, because the current old report has no `motion` field. This confirms the checker catches the existing problem.

---

### Task 4: Integrate Motion Checks Into Segmented Validation

**Files:**
- Modify: `C:\Users\petbl\auto-video\scripts\validate_segmented_export.py`

- [ ] **Step 1: Add motion validation helper**

Add near the top:

```python
VALID_MOTIONS = {
    "zoomin", "zoomout", "panL", "panR", "panU", "panD",
    "diagUL", "diagUR", "diagDL", "diagDR",
}


def validate_visual_motion_groups(segment_id: str, assembly: dict) -> list[str]:
    failures: list[str] = []
    groups = assembly.get("visualGroups") or []
    if not groups:
        return [f"{segment_id}: visualGroups missing or empty"]
    motions = [group.get("motion") for group in groups]
    if any(not motion for motion in motions):
        failures.append(f"{segment_id}: visualGroups contain missing motion metadata")
    for motion in motions:
        if motion and motion not in VALID_MOTIONS:
            failures.append(f"{segment_id}: unknown visual motion {motion}")
    for index in range(1, len(motions)):
        if motions[index] and motions[index] == motions[index - 1]:
            failures.append(f"{segment_id}: repeated visual motion at groups {index} and {index + 1}")
    if len(groups) >= 10 and len(set(motions)) < 5:
        failures.append(f"{segment_id}: visual motion variety too low")
    for index, group in enumerate(groups, start=1):
        if group.get("motion") and group.get("effectiveZoom") is None:
            failures.append(f"{segment_id}: visual group {index} missing effectiveZoom")
        if group.get("motion") and not group.get("clip"):
            failures.append(f"{segment_id}: visual group {index} missing clip")
    return failures
```

- [ ] **Step 2: Call helper after loading `assembly-report.json`**

Inside the block where `assembly_report.exists()` is true, after audio tempo checks, add:

```python
                failures.extend(validate_visual_motion_groups(segment_id, assembly))
```

- [ ] **Step 3: Run Python syntax check**

Run:

```powershell
python -m py_compile C:\Users\petbl\auto-video\scripts\validate_segmented_export.py
```

Expected: exit code `0`.

---

### Task 5: Add Preflight Benchmark

**Files:**
- Uses: `C:\Users\petbl\auto-video\scripts\assemble_cain_fast_from_hermes_job.mjs`

- [ ] **Step 1: Add a benchmark flag**

Extend `parseArgs` in `assemble_cain_fast_from_hermes_job.mjs`:

```js
else if (arg === "--motion-benchmark-clips") parsed.motionBenchmarkClips = Number(args[++i]);
```

After `groups` is created, add:

```js
const benchmarkClipCount = Number(options.motionBenchmarkClips || 0);
const groupsForRender = benchmarkClipCount > 0 ? groups.slice(0, benchmarkClipCount) : groups;
```

Then use `groupsForRender` only for preflight motion rendering. Keep normal production rendering on full `groups`.

- [ ] **Step 2: Run a two-clip benchmark**

Run:

```powershell
Measure-Command { node C:\Users\petbl\auto-video\scripts\assemble_cain_fast_from_hermes_job.mjs --job-dir C:\Users\petbl\hermes-studio\hermes-local\outputs\job-2026-06-30T14-53-08-039Z --export-dir C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-segmented\segments\segment-01 --allow-fast-audio --motion-benchmark-clips 2 }
```

Expected:

- Two motion clips are generated.
- Runtime and output size are visible before rendering a full 15-minute segment.
- If the benchmark is too slow, reduce `fps` from 24 to 18 before full render.

---

### Task 6: Generate a Short Motion Proof Clip

**Files:**
- Uses: `C:\Users\petbl\auto-video\scripts\assemble_cain_fast_from_hermes_job.mjs`

- [ ] **Step 1: Render one segment with motion enabled**

Run this after the benchmark is acceptable:

```powershell
node C:\Users\petbl\auto-video\scripts\assemble_cain_fast_from_hermes_job.mjs --job-dir C:\Users\petbl\hermes-studio\hermes-local\outputs\job-2026-06-30T14-53-08-039Z --export-dir C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-segmented\segments\segment-01 --allow-fast-audio
```

Expected:

- `manual-assembly\visual-base.mp4` is regenerated.
- `manual-assembly\motion-clips\clip_001.mp4` and later clips exist.
- `manual-assembly\assembly-report.json` includes `visualGroups[*].motion`.

- [ ] **Step 2: Run motion checker**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\check_motion_manifest.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-segmented\segments\segment-01\manual-assembly\assembly-report.json
```

Expected: exit code `0`, with at least 5 unique motions.

- [ ] **Step 3: Run freezedetect spot check**

Run:

```powershell
ffmpeg -hide_banner -i C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-segmented\segments\segment-01\manual-assembly\visual-base.mp4 -vf freezedetect=n=-60dB:d=5 -an -f null -
```

Expected: no long `freeze_duration` covering entire 30-second scenes. Short near-static periods may still appear because motion is intentionally subtle.

---

### Task 7: Update Operating Document

**Files:**
- Modify: `C:\Users\petbl\auto-video\auto-video.md`

- [ ] **Step 1: Append motion rule**

Append:

```markdown
## 장편 영상 화면 모션 규칙

정적 이미지를 그대로 길게 붙이지 않는다. 모든 본편 장면은 Ken Burns 계열의 느린 카메라 움직임을 가진다.

- 허용 모션: zoomin, zoomout, panL, panR, panU, panD, diagUL, diagUR, diagDL, diagDR.
- 같은 모션을 연속 사용하지 않는다.
- 10개 이상 장면이 있는 세그먼트는 최소 5종류 이상의 모션을 사용한다.
- 6초 이하 장면은 2~4% 수준의 미세 확대/이동만 사용한다.
- 30초 장면은 5~8% 수준의 느린 확대/이동을 사용한다.
- pan/diagonal 이동도 고정 12% 확대를 쓰지 않고 장면 길이 기반 `effectiveZoom`을 따른다.
- `assembly-report.json`의 `visualGroups`에는 각 장면의 `motion`, `zoomAmount`, `effectiveZoom`, `travelZoom`, `fps`, `clip`을 기록한다.
- 최종 합본 전 `check_motion_manifest.mjs`와 `validate_segmented_export.py`를 통과해야 한다.
```

- [ ] **Step 2: Verify section exists**

Run:

```powershell
Select-String -Path C:\Users\petbl\auto-video\auto-video.md -Pattern "장편 영상 화면 모션 규칙"
```

Expected: heading appears once.

---

## Verification

Run these commands after implementation:

```powershell
node --check C:\Users\petbl\auto-video\scripts\lib\kenburns-motion.mjs
node --check C:\Users\petbl\auto-video\scripts\assemble_cain_fast_from_hermes_job.mjs
node --check C:\Users\petbl\auto-video\scripts\check_motion_manifest.mjs
python -m py_compile C:\Users\petbl\auto-video\scripts\validate_segmented_export.py
node C:\Users\petbl\auto-video\scripts\check_motion_manifest.mjs C:\Users\petbl\auto-video\exports\gguljam-bible-cain-envy-60min-segmented\segments\segment-01\manual-assembly\assembly-report.json
```

Expected:

- Syntax checks pass.
- Old assembly reports without `motion` metadata fail.
- New renders include motion clips and pass `check_motion_manifest.mjs`.
- `validate_segmented_export.py` fails old static-style reports and passes new motion-enabled reports.

## Self-Review

Spec coverage:

- User requested zoom, zoom-out, left, right, up, down, left diagonal, right diagonal, random variety: covered by `KENBURNS_MOVES`.
- User requested web/GitHub research: FFmpeg, FFmpeg slideshow wiki, MoviePy GitHub, and existing Hermes implementation are recorded.
- User requested review report validation: accepted items are recorded in `Review Disposition`; the direction-formula item was checked and not changed.
- User requested plan update: this plan defines exact files, code, tests, benchmark, and operating document updates.

Placeholder scan:

- No `TBD`, `TODO`, or unspecified file paths remain.

Type consistency:

- Motion names are consistent across `kenburns-motion.mjs`, `check_motion_manifest.mjs`, and `validate_segmented_export.py`.
