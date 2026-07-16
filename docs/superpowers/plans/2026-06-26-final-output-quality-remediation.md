# Final Output Quality Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Hermes final output match the user's black-and-white reference style, meet the requested longform duration honestly, and avoid spending 2+ hours before discovering predictable quality failures.

**Architecture:** Add quality gates at the exact boundaries where the latest run failed: exported storyboard duration before Hermes, keyframe-to-clip monochrome preservation after camera motion, final duration contract after edit, and critic failures before expensive rerenders. Keep each gate independently testable with small synthetic fixtures.

**Tech Stack:** Node.js ESM, FFmpeg/ffprobe, `sharp`, Hermes Local pipeline, existing Python export validator.

---

## Evidence From Latest Final Output

Analyzed artifact:

`C:\Users\petbl\hermes-studio\hermes-local\outputs\job-2026-06-26T09-42-07-353Z\final.mp4`

Observed results:

- Final MP4 exists: H.264 video, AAC audio, 1920x1080, 48 kHz stereo.
- Final duration: `431.987s` (`7m 11.987s`), target was `660s`.
- Duration deficit: `228.01s`, drift ratio `0.345`.
- Script preflight report: `meaningfulChars=2188`, minimum for 10+ min is `4500`, deficit `2312`.
- Longform voice report: `voiceTotalSeconds=428.97`, minimum required `627`, deficit `198.03`.
- Runtime: `7783s` (`2h 9m 43s`).
- Bottleneck: keyframes `5442.897s` (`70%`), keyframe critic `1606.856s` (`21%`), keyframe retry `1171.257s` (`15%`).
- Pipeline QA failed because keyframe critic still failed `2/48` scenes.
- Failed critic scenes:
  - `scene_16`: missing split-lighting/two-version path anchor, anchor match `3`.
  - `scene_27`: missing two blurred human silhouettes behind foliage, anchor match `3`.
- Keyframe monochrome audit: `48/48` keyframes passed, max channel spread `0.496`.
- Finished still audit: `48/48` finished stills passed, max channel spread `0.36`.
- Clip monochrome audit: `41/48` clips failed, max channel spread `21.661`.
- Root cause for purple tint: not image generation and not still finishing; tint appears after FFmpeg camera motion clip generation.

## Review Report Items Accepted

The review report at `C:\Users\petbl\auto-video\docs\superpowers\plans\2026-06-26-final-output-quality-remediation-review-report.md` was checked against the actual codebase. The following items are technically valid and are incorporated below:

- `hue=s=0` must run after noise, glow, vignette, fade, and other color-affecting filters, immediately before `format=yuv420p`; otherwise later effects can reintroduce chroma noise.
- `validate_hermes_export.py` must treat either `render.target_seconds >= 600` or `project.target_minutes >= 10` as longform.
- Cross-job keyframe cache needs an explicit bypass/no-cache option so prompt or style experiments are not accidentally hidden by cache hits.
- Keyframe critic retry needs an early stop/fallback policy for repeated failures, because repeating expensive ComfyUI generations for the same unresolved anchor wastes 15-20% of runtime.

---

## File Structure

Modify:

- `C:\Users\petbl\hermes-studio\hermes-local\lib\visual\livingstill.mjs`
  - Add a strict grayscale post-filter for Ken Burns/living-still clips.
- `C:\Users\petbl\hermes-studio\hermes-local\lib\visual\region-motion.mjs`
  - Add the same strict grayscale post-filter for region motion clips.
- `C:\Users\petbl\hermes-studio\hermes-local\lib\visual\depth-parallax.mjs`
  - Add the same strict grayscale post-filter for depth parallax clips.
- `C:\Users\petbl\hermes-studio\hermes-local\lib\agents\camera.mjs`
  - Decide per scene whether monochrome preservation is required.
  - Audit clips after generation and fail early when strict monochrome clips are tinted.
- `C:\Users\petbl\hermes-studio\hermes-local\lib\pipeline\runner.mjs`
  - Write a camera monochrome report and stop before editor when monochrome clips fail.
  - Make final duration drift fail for longform targets instead of passing with `0.345` drift.
- `C:\Users\petbl\hermes-studio\hermes-local\lib\agents\pipeline-qa.mjs`
  - Surface monochrome and longform duration failures in final QA.
- `C:\Users\petbl\hermes-studio\hermes-local\package.json`
  - Register new checks.
- `C:\Users\petbl\auto-video\scripts\validate_hermes_export.py`
  - Add pre-Hermes longform export validation so short scripts are rejected before GPU work.

Create:

- `C:\Users\petbl\hermes-studio\hermes-local\lib\quality\video-monochrome-audit.mjs`
  - Extract representative frames from MP4 clips and run `analyzeStrictMonochrome`.
- `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-video-monochrome-audit.mjs`
  - Unit check for gray vs purple synthetic videos.
- `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-camera-monochrome-preservation.mjs`
  - Regression check that gray input still produces gray clips through livingstill and region-motion.
- `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-longform-duration-contract-fails.mjs`
  - Regression check that a 660s target with a 432s final duration fails.
- `C:\Users\petbl\auto-video\scripts\check_validate_hermes_export_longform.py`
  - Regression check that 10-minute exports below minimum narration length return failure.
- `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-keyframe-critic-fallback-policy.mjs`
  - Regression check that repeated critic failures stop retrying and can downgrade to fallback/report-only behavior according to policy.

---

### Task 1: Add Video Monochrome Audit

**Files:**

- Create: `C:\Users\petbl\hermes-studio\hermes-local\lib\quality\video-monochrome-audit.mjs`
- Create: `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-video-monochrome-audit.mjs`

- [ ] **Step 1: Write the failing video audit check**

Create `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-video-monochrome-audit.mjs`:

```js
#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { auditVideoMonochrome } from "../lib/quality/video-monochrome-audit.mjs";

const dir = mkdtempSync(join(tmpdir(), "hermes-video-mono-"));
const grayPng = join(dir, "gray.png");
const purplePng = join(dir, "purple.png");
const grayMp4 = join(dir, "gray.mp4");
const purpleMp4 = join(dir, "purple.mp4");

await sharp({ create: { width: 128, height: 72, channels: 3, background: { r: 72, g: 72, b: 72 } } }).png().toFile(grayPng);
await sharp({ create: { width: 128, height: 72, channels: 3, background: { r: 41, g: 24, b: 45 } } }).png().toFile(purplePng);

for (const [png, mp4] of [[grayPng, grayMp4], [purplePng, purpleMp4]]) {
  const result = spawnSync("ffmpeg", ["-y", "-loop", "1", "-i", png, "-t", "2", "-r", "30", "-pix_fmt", "yuv420p", mp4], { stdio: "ignore" });
  assert.equal(result.status, 0);
}

const gray = await auditVideoMonochrome({ videoPath: grayMp4, maxAverageChannelSpread: 3 });
const purple = await auditVideoMonochrome({ videoPath: purpleMp4, maxAverageChannelSpread: 3 });

assert.equal(gray.ok, true);
assert.equal(purple.ok, false);
assert.equal(purple.reason, "color_tint_detected");
console.log("check-video-monochrome-audit: pass");
```

- [ ] **Step 2: Run the check to verify it fails**

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
node scripts\check-video-monochrome-audit.mjs
```

Expected: fails with `Cannot find module ... video-monochrome-audit.mjs`.

- [ ] **Step 3: Implement the audit module**

Create `C:\Users\petbl\hermes-studio\hermes-local\lib\quality\video-monochrome-audit.mjs`:

```js
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { analyzeStrictMonochrome } from "./strict-monochrome-detector.mjs";

export async function auditVideoMonochrome({
  videoPath,
  sampleAtSeconds = 1,
  maxAverageChannelSpread = 3,
  ffmpegPath = "ffmpeg",
} = {}) {
  if (!videoPath) throw new Error("auditVideoMonochrome requires videoPath");
  const dir = mkdtempSync(join(tmpdir(), "hermes-video-mono-audit-"));
  const framePath = join(dir, "frame.png");
  const result = spawnSync(ffmpegPath, [
    "-y",
    "-ss", String(sampleAtSeconds),
    "-i", videoPath,
    "-frames:v", "1",
    framePath,
  ], { stdio: "ignore" });
  if (result.status !== 0) {
    return { ok: false, reason: "frame_extract_failed", videoPath, sampleAtSeconds };
  }
  const analysis = await analyzeStrictMonochrome(framePath, { maxAverageChannelSpread });
  return { ...analysis, videoPath, sampleAtSeconds };
}

export async function auditClipAssetsMonochrome({
  clipAssets = [],
  maxAverageChannelSpread = 3,
  ffmpegPath = "ffmpeg",
} = {}) {
  const reports = [];
  for (const asset of clipAssets) {
    if (!asset || asset.status !== "ok" || !asset.clip_path) continue;
    const report = await auditVideoMonochrome({
      videoPath: asset.clip_path,
      sampleAtSeconds: Math.min(2, Math.max(0.5, Number(asset.clip_duration || 2) / 2)),
      maxAverageChannelSpread,
      ffmpegPath,
    });
    reports.push({ order: asset.order, source: asset.source, ...report });
  }
  const failures = reports.filter((report) => report.ok === false);
  return {
    ok: failures.length === 0,
    total: reports.length,
    failureCount: failures.length,
    failures,
    reports,
  };
}
```

- [ ] **Step 4: Run the check to verify it passes**

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
node scripts\check-video-monochrome-audit.mjs
```

Expected: `check-video-monochrome-audit: pass`.

---

### Task 2: Preserve Grayscale Through FFmpeg Motion Clips

**Files:**

- Modify: `C:\Users\petbl\hermes-studio\hermes-local\lib\visual\livingstill.mjs`
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\lib\visual\region-motion.mjs`
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\lib\visual\depth-parallax.mjs`
- Create: `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-camera-monochrome-preservation.mjs`

- [ ] **Step 1: Write the failing preservation check**

Create `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-camera-monochrome-preservation.mjs`:

```js
#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { renderLivingStill } from "../lib/visual/livingstill.mjs";
import { renderRegionMotion } from "../lib/visual/region-motion.mjs";
import { auditVideoMonochrome } from "../lib/quality/video-monochrome-audit.mjs";

const dir = mkdtempSync(join(tmpdir(), "hermes-camera-mono-"));
const input = join(dir, "gray.png");
await sharp({ create: { width: 512, height: 288, channels: 3, background: { r: 72, g: 72, b: 72 } } }).png().toFile(input);

const living = join(dir, "living.mp4");
const region = join(dir, "region.mp4");

await renderLivingStill({ imagePath: input, outPath: living, width: 512, height: 288, seconds: 2, forceMonochrome: true });
await renderRegionMotion({ imagePath: input, outPath: region, width: 512, height: 288, seconds: 2, motion: "glow", forceMonochrome: true });

const livingAudit = await auditVideoMonochrome({ videoPath: living, maxAverageChannelSpread: 3 });
const regionAudit = await auditVideoMonochrome({ videoPath: region, maxAverageChannelSpread: 3 });

assert.equal(livingAudit.ok, true, JSON.stringify(livingAudit));
assert.equal(regionAudit.ok, true, JSON.stringify(regionAudit));
console.log("check-camera-monochrome-preservation: pass");
```

- [ ] **Step 2: Run the check**

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
node scripts\check-camera-monochrome-preservation.mjs
```

Expected before implementation: fails because `forceMonochrome` is ignored or because `video-monochrome-audit.mjs` is not available.

- [ ] **Step 3: Add monochrome post-filter helper in each motion filter**

In `livingstill.mjs`, add `forceMonochrome = false` to `buildLivingStillFilter` arguments and insert `hue=s=0` immediately before final `format=yuv420p`:

```js
export function buildLivingStillFilter({
  width = 1920, height = 1080, seconds = 8, fps = 30,
  motionProfile = "calm",
  zoom, shimmer, glow, grain, glowSigma = 6, vignette = true,
  fadeIn = 0.5, fadeOut = 0.5, seed = 0, move = null,
  forceMonochrome = false,
} = {}) {
```

Then replace the final post-filter section. Keep `hue=s=0` after all effects that can affect color or chroma, including noise, glow, vignette, fade, xfade inputs, and overlays. It must be immediately before `format=yuv420p`.

```js
if (forceMonochrome) post.push("hue=s=0");
post.push("format=yuv420p");
```

In `region-motion.mjs`, add `forceMonochrome = false` to `buildRegionMotionFilter` arguments and insert the same `hue=s=0` after the region displace/flicker, glow, optional overlay, vignette, and fade filters, immediately before `format=yuv420p`:

```js
if (forceMonochrome) post.push("hue=s=0");
post.push("format=yuv420p");
```

In `depth-parallax.mjs`, add `forceMonochrome = false` to `buildDepthParallaxFilter` arguments and insert the same final filter after depth displace, glow, optional overlay, vignette, and fade filters, immediately before `format=yuv420p`:

```js
if (forceMonochrome) post.push("hue=s=0");
post.push("format=yuv420p");
```

- [ ] **Step 4: Pass forceMonochrome from build args**

In `buildLivingStillArgs`, `buildRegionMotionArgs`, and `buildDepthParallaxArgs`, keep the existing `...opt` passthrough. Confirm `forceMonochrome` reaches each `build...Filter` call through `...opt`.

- [ ] **Step 5: Run preservation check**

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
node scripts\check-camera-monochrome-preservation.mjs
```

Expected: `check-camera-monochrome-preservation: pass`.

---

### Task 3: Enforce Monochrome at Camera Boundary

**Files:**

- Modify: `C:\Users\petbl\hermes-studio\hermes-local\lib\agents\camera.mjs`
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\lib\pipeline\runner.mjs`
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\lib\agents\pipeline-qa.mjs`

- [ ] **Step 1: Add scene-level monochrome detection in camera**

Add this helper near the bottom of `camera.mjs`:

```js
function shouldForceMonochrome(scene, videoCfg = {}) {
  if (videoCfg.strictMonochrome === true) return true;
  const text = [
    videoCfg.stylePreset,
    videoCfg.visualLanguage,
    scene?.keyframe_prompt,
    scene?.video_prompt,
    scene?.storyboard?.keyframe_prompt,
    scene?.storyboard?.video_prompt,
    getVideoPrompt(scene),
  ].filter(Boolean).join(" ");
  return /\b(monochrome|black\s+and\s+white|grayscale|greyscale|pure grayscale|strict black and white)\b/i.test(text);
}
```

- [ ] **Step 2: Pass forceMonochrome into all keyframe clip renderers**

In the `for (const sc of scenes)` loop, compute this before selecting depth/region/living-still rendering:

```js
const forceMonochrome = shouldForceMonochrome(sc, videoCfg);
```

Update `renderSceneClip` so `forceMonochrome` is an explicit parameter. Do not reference `sc` from inside this helper because `renderSceneClip` currently receives only its argument object.

```js
const renderSceneClip = async ({ kf, sec, outPath, i, order, forceMonochrome = false }) => {
```

Pass `forceMonochrome` into the helper call:

```js
const source = await renderSceneClip({ kf, sec, outPath, i, order, forceMonochrome });
```

Inside `renderSceneClip`, pass `forceMonochrome` into:

```js
await regionMotionClip({ png: segPng, seconds: segSeconds, outPath: segOut, index: segIdx, motion: fx.v, overlay: null, forceMonochrome });
await kenBurns({ png: segPng, seconds: segSeconds, outPath: segOut, index: segIdx, move: fx.v, forceMonochrome });
```

Update `kenBurns`, `regionMotionClip`, and `depthParallaxClip` helper signatures:

```js
async function kenBurns({ png, seconds, outPath, index = 0, move = null, forceMonochrome = false }) {
```

```js
async function regionMotionClip({ png, seconds, outPath, index = 0, motion, overlay, forceMonochrome = false }) {
```

```js
async function depthParallaxClip({ png, seconds, outPath, index = 0, overlay, jobDir, mode, forceMonochrome = false }) {
```

Pass `forceMonochrome` into `buildLivingStillFilter`, `buildRegionMotionArgs`, and `buildDepthParallaxArgs`.

Also pass `forceMonochrome` into the non-split `regionMotionClip`, `depthParallaxClip`, and direct `kenBurns` paths in the main loop:

```js
await depthParallaxClip({ png: kf, seconds: sec, outPath, index: i, overlay: eff.overlay, jobDir, mode: dmode, forceMonochrome });
await regionMotionClip({ png: kf, seconds: sec, outPath, index: i, motion: eff.motion, overlay: eff.overlay, forceMonochrome });
```

- [ ] **Step 3: Add camera monochrome audit after clip generation**

In `runner.mjs`, import:

```js
import { auditClipAssetsMonochrome } from "../quality/video-monochrome-audit.mjs";
```

After `camera_completed`, add:

```js
const cameraMonochrome = await auditClipAssetsMonochrome({
  clipAssets,
  maxAverageChannelSpread: cfg?.render?.monochrome?.maxAverageChannelSpread || 3,
});
writeFileSync(jobDir + "/camera-monochrome-report.json", JSON.stringify(cameraMonochrome, null, 2), "utf8");
log("camera_monochrome_completed", {
  ok: cameraMonochrome.ok,
  total: cameraMonochrome.total,
  failureCount: cameraMonochrome.failureCount,
});
if (!cameraMonochrome.ok && cfg?.render?.monochrome?.enforceCamera !== false) {
  const timing = writeTimingSummary({ verdict: "fail", qualityOk: false, aborted: true, reason: "camera_monochrome_failed" });
  const performanceBudget = buildPerformanceBudgetReport(timing, cfg);
  writeFileSync(jobDir + "/performance-budget-report.json", JSON.stringify(performanceBudget, null, 2), "utf8");
  return { ok: false, verdict: "fail", qualityOk: false, stage: "camera_monochrome", plan, visual, finalPath: null, srtPath: null, cameraMonochrome, performanceBudget, timing, jobDir };
}
```

- [ ] **Step 4: Surface report in Pipeline QA**

In `pipeline-qa.mjs`, add `cameraMonochromeReport` to the builder input and include:

```js
camera_monochrome_ok: cameraMonochromeReport ? cameraMonochromeReport.ok === true : null,
camera_monochrome_failure_count: cameraMonochromeReport ? Number(cameraMonochromeReport.failureCount || 0) : null,
```

Add failure text:

```js
if (cameraMonochromeReport && cameraMonochromeReport.ok === false) {
  failures.push(`camera monochrome failed ${cameraMonochromeReport.failureCount}/${cameraMonochromeReport.total} clip(s)`);
}
```

- [ ] **Step 5: Verify with a short real keyframe render**

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
npm run check:camera-monochrome-preservation
```

Expected: pass.

---

### Task 4: Make Longform Duration Failure Unignorable

**Files:**

- Modify: `C:\Users\petbl\hermes-studio\hermes-local\lib\util\duration-contract.mjs`
- Create: `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-longform-duration-contract-fails.mjs`
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\package.json`

- [ ] **Step 1: Write failing duration contract check**

Create `scripts\check-longform-duration-contract-fails.mjs`:

```js
#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildDurationContractReport } from "../lib/util/duration-contract.mjs";

const report = buildDurationContractReport({
  plan: {
    duration_seconds: 660,
    scenes: [{ duration_seconds: 660 }],
  },
  voiceAssets: [{ voice_duration: 428.97 }],
  clipAssets: [{ clip_duration: 428.97 }],
  segments: [
    { order: 0, duration: 2.8 },
    { order: 1, duration: 429.19 },
  ],
  qaReport: { checks: { duration: 431.99 } },
  targetSeconds: 660,
  policy: {
    enforceLongformFinalDuration: true,
    longformThresholdSeconds: 600,
    maxLongformDriftRatio: 0.05,
  },
});

assert.equal(report.verdict, "fail");
assert.match(report.failures.join("\\n"), /longform final duration/i);
console.log("check-longform-duration-contract-fails: pass");
```

- [ ] **Step 2: Run the check**

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
node scripts\check-longform-duration-contract-fails.mjs
```

Expected before implementation: fails because current report verdict is `pass`.

- [ ] **Step 3: Update duration contract policy**

In `duration-contract.mjs`, add a `policy = {}` argument to `buildDurationContractReport`:

```js
export function buildDurationContractReport({
  plan,
  voiceAssets = [],
  clipAssets = [],
  segments = [],
  qaReport = null,
  targetSeconds = null,
  warnDriftRatio = 0.25,
  failDriftRatio = 0.6,
  policy = {},
} = {}) {
```

After `driftFromTargetRatio` is calculated and before the return statement, add:

```js
const longformThresholdSeconds = Number(policy?.longformThresholdSeconds || 600);
const maxLongformDriftRatio = Number(policy?.maxLongformDriftRatio || 0.05);
if (policy?.enforceLongformFinalDuration === true && Number(targetSeconds) >= longformThresholdSeconds) {
  if (Math.abs(report.driftFromTargetRatio) > maxLongformDriftRatio) {
    report.failures.push(`longform final duration drift ${(report.driftFromTargetRatio * 100).toFixed(1)}% exceeds ${(maxLongformDriftRatio * 100).toFixed(1)}%`);
  }
}
report.verdict = report.failures.length ? "fail" : "pass";
```

- [ ] **Step 4: Wire config policy**

In `runner.mjs`, wherever `buildDurationContractReport` is called, pass:

```js
policy: cfg?.render?.durationContract || {}
```

to the duration contract evaluator.

In `config/local.json`, add:

```json
"durationContract": {
  "enforceLongformFinalDuration": true,
  "longformThresholdSeconds": 600,
  "maxLongformDriftRatio": 0.05
}
```

- [ ] **Step 5: Run duration checks**

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
node scripts\check-longform-duration-contract-fails.mjs
npm run check:duration-contract
```

Expected: both pass.

---

### Task 5: Reject Too-Short Auto-Video Exports Before Hermes

**Files:**

- Modify: `C:\Users\petbl\auto-video\scripts\validate_hermes_export.py`
- Create: `C:\Users\petbl\auto-video\scripts\check_validate_hermes_export_longform.py`

- [ ] **Step 1: Write failing export validation check**

Create `scripts\check_validate_hermes_export_longform.py`:

```python
from pathlib import Path
from tempfile import TemporaryDirectory

from validate_hermes_export import validate_export


def write_export(root: Path, production_json: str, narration: str) -> None:
    root.mkdir(parents=True, exist_ok=True)
    (root / "hermes-manual-storyboard.md").write_text(
        f"[{narration}]\n"
        "A quiet ancient garden, black and white painterly biblical oil illustration / wide shot / soft light / calm / slow push-in\n",
        encoding="utf-8",
    )
    (root / "production.json").write_text(production_json, encoding="utf-8")


with TemporaryDirectory() as tmp:
    export_dir = Path(tmp)
    write_export(export_dir, '{"render":{"target_seconds":660},"project":{"target_minutes":10}}', "짧은 원고입니다.")
    report = validate_export(export_dir)
    assert report["status"] == "fail"
    assert any("longform narration length" in warning for warning in report["warnings"])

with TemporaryDirectory() as tmp:
    export_dir = Path(tmp)
    write_export(export_dir, '{"render":{},"project":{"target_minutes":10}}', "짧은 원고입니다.")
    report = validate_export(export_dir)
    assert report["status"] == "fail"
    assert any("longform narration length" in warning for warning in report["warnings"])

print("check_validate_hermes_export_longform: pass")
```

- [ ] **Step 2: Run check to verify it fails**

Run:

```powershell
cd C:\Users\petbl\auto-video
python scripts\check_validate_hermes_export_longform.py
```

Expected before implementation: assertion failure because `status` is not `fail`.

- [ ] **Step 3: Add longform validation**

In `validate_hermes_export.py`, add:

```python
def meaningful_chars(scenes: list[SceneBlock]) -> int:
    return sum(len(re.sub(r"\s+", "", scene.narration)) for scene in scenes)
```

In `validate_export`, after loading production:

```python
target_seconds = production.get("render", {}).get("target_seconds")
target_minutes = production.get("project", {}).get("target_minutes")
is_longform = (
    (isinstance(target_seconds, (int, float)) and target_seconds >= 600)
    or (isinstance(target_minutes, (int, float)) and target_minutes >= 10)
)
chars = meaningful_chars(scenes)
target_label = target_seconds if target_seconds else (target_minutes * 60 if target_minutes else None)
if is_longform and chars < 4500:
    warnings.append(
        f"longform narration length {chars} chars is below minimum 4500 for target_seconds {target_label}"
    )
```

Change status logic:

```python
hard_fail = any("longform narration length" in warning for warning in warnings)
status = "fail" if missing_fields or hard_fail else "warn" if warnings else "pass"
```

- [ ] **Step 4: Run validation checks**

Run:

```powershell
cd C:\Users\petbl\auto-video
python scripts\check_validate_hermes_export_longform.py
python scripts\validate_hermes_export.py --export-dir C:\Users\petbl\auto-video\exports\gguljam-bible-adam-eve-10min-001
```

Expected:

- First command prints `check_validate_hermes_export_longform: pass`.
- Second command returns non-zero and reports fail for the current short 10-minute export.

---

### Task 6: Reduce Wasted 2-Hour Rerenders

**Files:**

- Modify: `C:\Users\petbl\hermes-studio\hermes-local\lib\visual\keyframe-cache.mjs`
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\lib\visual\keyframe-generator.mjs`
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\scripts\run-job.mjs`
- Create: `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-cross-job-keyframe-cache.mjs`
- Create: `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-keyframe-cache-bypass.mjs`

- [ ] **Step 1: Write cross-job cache check**

Create `scripts\check-cross-job-keyframe-cache.mjs`:

```js
#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createKeyframeGenerator } from "../lib/visual/keyframe-generator.mjs";

const root = mkdtempSync(join(tmpdir(), "hermes-cross-cache-"));
let calls = 0;
const provider = {
  async generateImage({ outPath }) {
    calls += 1;
    await sharp({ create: { width: 128, height: 72, channels: 3, background: { r: 72, g: 72, b: 72 } } }).png().toFile(outPath);
  },
};

const storyboardPlan = {
  style_preset: "calm-scripture",
  visual_language: "black and white",
  scenes: [{
    scene_id: "scene_01",
    narration_refs: [1],
    duration_seconds: 8,
    keyframe_prompt: "black and white garden",
    video_prompt: "black and white garden",
    negative_prompt: "text, watermark",
  }],
};

const generator = createKeyframeGenerator({ imageProvider: provider });
await generator.generate({ storyboardPlan, jobDir: join(root, "job-a"), mode: "render", width: 128, height: 72, visualStyle: { id: "test", globalCacheDir: join(root, "global-cache"), cacheEnabled: true } });
await generator.generate({ storyboardPlan, jobDir: join(root, "job-b"), mode: "render", width: 128, height: 72, visualStyle: { id: "test", globalCacheDir: join(root, "global-cache"), cacheEnabled: true } });

assert.equal(calls, 1);
assert.equal(existsSync(join(root, "job-b", "keyframes", "scene_01.png")), true);
console.log("check-cross-job-keyframe-cache: pass");
```

- [ ] **Step 2: Implement global cache**

In `keyframe-cache.mjs`, add a global cache directory option:

```js
import { join } from "node:path";

export function globalCachePath({ visualStyle, cacheKey }) {
  const dir = visualStyle?.globalCacheDir;
  if (!dir || !cacheKey) return null;
  return join(dir, `${cacheKey}.png`);
}
```

In `keyframe-generator.mjs`, before provider generation, check `globalCachePath` only when caching is enabled:

```js
const cacheEnabled = visualStyle?.cacheEnabled !== false;
```

Use this rule for every cache lookup and write:

```js
if (cacheEnabled) {
  reused = tryReuseKeyframeCache({ cache, cacheKey, outPath });
}
```

After successful `ok` generation and after monochrome/top-artifact checks, copy the generated file into the global cache path only when `cacheEnabled` is true.

- [ ] **Step 3: Add explicit cache bypass check**

Create `scripts\check-keyframe-cache-bypass.mjs`:

```js
#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createKeyframeGenerator } from "../lib/visual/keyframe-generator.mjs";

const root = mkdtempSync(join(tmpdir(), "hermes-cache-bypass-"));
let calls = 0;
const provider = {
  async generateImage({ outPath }) {
    calls += 1;
    const value = calls === 1 ? 72 : 96;
    await sharp({ create: { width: 128, height: 72, channels: 3, background: { r: value, g: value, b: value } } }).png().toFile(outPath);
  },
};

const storyboardPlan = {
  style_preset: "calm-scripture",
  visual_language: "black and white",
  scenes: [{
    scene_id: "scene_01",
    narration_refs: [1],
    duration_seconds: 8,
    keyframe_prompt: "black and white garden",
    video_prompt: "black and white garden",
    negative_prompt: "text, watermark",
  }],
};

const generator = createKeyframeGenerator({ imageProvider: provider });
await generator.generate({ storyboardPlan, jobDir: join(root, "job-a"), mode: "render", width: 128, height: 72, visualStyle: { id: "test", globalCacheDir: join(root, "global-cache"), cacheEnabled: true } });
await generator.generate({ storyboardPlan, jobDir: join(root, "job-b"), mode: "render", width: 128, height: 72, visualStyle: { id: "test", globalCacheDir: join(root, "global-cache"), cacheEnabled: false } });

assert.equal(calls, 2);
assert.equal(existsSync(join(root, "job-b", "keyframes", "scene_01.png")), true);
console.log("check-keyframe-cache-bypass: pass");
```

- [ ] **Step 4: Add CLI no-cache option**

In `scripts\run-job.mjs`, add a boolean CLI option:

```js
"no-cache": { type: "boolean", default: false },
```

When building the effective keyframe visual style, pass:

```js
cacheEnabled: parsed.values["no-cache"] !== true,
```

If the current visual style object is not directly built in `run-job.mjs`, pass a runner option named `keyframeCacheEnabled` and let `runner.mjs` add `cacheEnabled` to `renderVisualStyle`.

- [ ] **Step 5: Run cache checks**

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
node scripts\check-cross-job-keyframe-cache.mjs
node scripts\check-keyframe-cache-bypass.mjs
```

Expected:

- `check-cross-job-keyframe-cache: pass`
- `check-keyframe-cache-bypass: pass`

---

### Task 7: Add Keyframe Critic Fallback Policy

**Files:**

- Modify: `C:\Users\petbl\hermes-studio\hermes-local\lib\pipeline\runner.mjs`
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\lib\agents\pipeline-qa.mjs`
- Create: `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-keyframe-critic-fallback-policy.mjs`

- [ ] **Step 1: Write the failing policy check**

Create `scripts\check-keyframe-critic-fallback-policy.mjs`:

```js
#!/usr/bin/env node
import assert from "node:assert/strict";
import { evaluateKeyframeCriticPolicy } from "../lib/pipeline/runner.mjs";

const critic = {
  reports: [
    { scene_id: "scene_16", verdict: "fail", violations: ["missing_subject"], anchor_match: 3 },
    { scene_id: "scene_27", verdict: "fail", violations: ["missing_subject"], anchor_match: 3 },
  ],
  failures: [
    { scene_id: "scene_16", violations: ["missing_subject"], anchor_match: 3 },
    { scene_id: "scene_27", violations: ["missing_subject"], anchor_match: 3 },
  ],
};

const strict = evaluateKeyframeCriticPolicy({
  critic,
  mode: "retry",
  policy: { maxFinalFailureRatio: 0.02, fallbackAfterRetry: false },
});
assert.equal(strict.ok, false);
assert.equal(strict.reason, "keyframe_critic_failed");

const fallback = evaluateKeyframeCriticPolicy({
  critic,
  mode: "retry",
  policy: { maxFinalFailureRatio: 0.05, fallbackAfterRetry: true },
});
assert.equal(fallback.ok, true);
assert.equal(fallback.warning, "keyframe_critic_fallback_allowed");

console.log("check-keyframe-critic-fallback-policy: pass");
```

- [ ] **Step 2: Run check to verify it fails**

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
node scripts\check-keyframe-critic-fallback-policy.mjs
```

Expected before implementation: fails because `evaluateKeyframeCriticPolicy` is not exported.

- [ ] **Step 3: Export a pure policy evaluator**

In `runner.mjs`, add and export:

```js
export function evaluateKeyframeCriticPolicy({
  critic,
  mode = "report",
  policy = {},
} = {}) {
  const reports = Array.isArray(critic?.reports) ? critic.reports : [];
  const failures = Array.isArray(critic?.failures) ? critic.failures : [];
  const total = reports.length || failures.length || 0;
  const failureRatio = total ? failures.length / total : 0;
  const maxFinalFailureRatio = Number(policy.maxFinalFailureRatio ?? 0);
  const fallbackAfterRetry = policy.fallbackAfterRetry === true;

  if (!failures.length) return { ok: true, reason: "ok", failureRatio, failures: [] };
  if (fallbackAfterRetry && failureRatio <= maxFinalFailureRatio) {
    return {
      ok: true,
      warning: "keyframe_critic_fallback_allowed",
      reason: "failure_ratio_within_fallback_policy",
      failureRatio: Number(failureRatio.toFixed(3)),
      failures,
    };
  }
  return {
    ok: false,
    reason: "keyframe_critic_failed",
    mode,
    failureRatio: Number(failureRatio.toFixed(3)),
    failures,
  };
}
```

- [ ] **Step 4: Pass config into enforceKeyframeCriticPolicy**

At the call site in `runner.mjs`, add `cfg`:

```js
enforceKeyframeCriticPolicy({
  critic,
  keyframes,
  mode: kfCriticMode,
  enforceFinal: kfCriticCfg.enforceFinal !== false,
  allowFallbackVideo,
  log,
  storyboardSource: storyboardResult.source,
  cfg,
});
```

Update the function signature:

```js
function enforceKeyframeCriticPolicy({ critic, keyframes, mode = "report", enforceFinal = true, allowFallbackVideo = false, log, storyboardSource = null, cfg = null } = {}) {
```

- [ ] **Step 5: Use the evaluator inside enforceKeyframeCriticPolicy**

In `enforceKeyframeCriticPolicy`, replace the direct `if (failures.length) throw` logic with:

```js
const result = evaluateKeyframeCriticPolicy({
  critic,
  mode,
  policy: {
    maxFinalFailureRatio: cfg?.render?.keyframeCritic?.maxFinalFailureRatio ?? 0,
    fallbackAfterRetry: cfg?.render?.keyframeCritic?.fallbackAfterRetry === true,
  },
});
if (result.ok) {
  if (result.warning && typeof log === "function") log("keyframe_critic_fallback_allowed", result);
  return;
}
```

Keep the existing throw behavior when `result.ok` is false.

- [ ] **Step 6: Add config defaults**

In `config/local.json`, extend `render.keyframeCritic`:

```json
"maxFinalFailureRatio": 0.02,
"fallbackAfterRetry": false
```

For experimental rerenders, this can be temporarily changed to:

```json
"maxFinalFailureRatio": 0.05,
"fallbackAfterRetry": true
```

- [ ] **Step 7: Run the policy check**

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
node scripts\check-keyframe-critic-fallback-policy.mjs
```

Expected: `check-keyframe-critic-fallback-policy: pass`.

### Task 8: Register Checks and Run Verification

**Files:**

- Modify: `C:\Users\petbl\hermes-studio\hermes-local\package.json`

- [ ] **Step 1: Register npm scripts**

Add:

```json
"check:video-monochrome-audit": "node scripts/check-video-monochrome-audit.mjs",
"check:camera-monochrome-preservation": "node scripts/check-camera-monochrome-preservation.mjs",
"check:longform-duration-contract-fails": "node scripts/check-longform-duration-contract-fails.mjs",
"check:cross-job-keyframe-cache": "node scripts/check-cross-job-keyframe-cache.mjs",
"check:keyframe-cache-bypass": "node scripts/check-keyframe-cache-bypass.mjs",
"check:keyframe-critic-fallback-policy": "node scripts/check-keyframe-critic-fallback-policy.mjs"
```

- [ ] **Step 2: Run targeted checks**

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
npm run check:video-monochrome-audit
npm run check:camera-monochrome-preservation
npm run check:longform-duration-contract-fails
npm run check:cross-job-keyframe-cache
npm run check:keyframe-cache-bypass
npm run check:keyframe-critic-fallback-policy
npm run check:keyframe-monochrome-retry
npm run check:top-artifact-detector
npm run check:keyframe-top-artifact-retry
npm run syntax
```

Expected:

- Every command exits `0`.
- `npm run syntax` reports all files passing.

- [ ] **Step 3: Run auto-video validation check**

Run:

```powershell
cd C:\Users\petbl\auto-video
python scripts\check_validate_hermes_export_longform.py
```

Expected: `check_validate_hermes_export_longform: pass`.

---

## Acceptance Criteria

The next 10-minute run is acceptable only if all are true:

- `script-preflight-report.json` passes before keyframes start.
- `longform-duration-report.json` passes before camera starts.
- `camera-monochrome-report.json` passes with `failureCount=0`.
- `duration-contract-report.json` fails if final duration is more than 5% below target.
- `pipeline-qa-report.json` does not report keyframe critic failures.
- A sampled final frame at 1:30, midpoint, and last minute has average channel spread `<= 3`.
- Total runtime avoids full keyframe regeneration when the same storyboard and prompts are reused.

## Self-Review

- Spec coverage: covers color drift, duration miss, critic miss, and runtime bottleneck observed in the final output.
- Placeholder scan: no implementation step depends on unspecified behavior.
- Type consistency: all new JS functions use ESM named exports and match existing project conventions.

