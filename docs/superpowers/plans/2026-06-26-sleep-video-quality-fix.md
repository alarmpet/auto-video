# Sleep Video Quality Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce 10+ minute "꿀잠성경" videos without slowing the final rendered video, without top-center text/blur artifacts, and with a comfortable narration pace.

**Architecture:** Fix duration at the script/TTS planning layer instead of stretching the final MP4. Add visual artifact gates before final delivery so generated English labels are caught and regenerated, not hidden with `delogo`.

**Tech Stack:** Node.js ESM, Hermes Studio manual storyboard pipeline, Supertonic TTS, ComfyUI keyframes, FFmpeg/ffprobe, sharp-based image checks.

---

## Review Integration Notes

The review report `2026-06-26-sleep-video-quality-review-report.md` was checked against the Hermes codebase and partially accepted.

Accepted:

- Top artifact detection should use relative contrast against neighboring top regions, not only absolute brightness. A bright sky or branch area must not be mistaken for a label.
- A pre-flight script-length gate is needed before TTS and GPU work. The current post-TTS duration gate is useful but too late to save time when the source script is clearly short.
- Text-ban words such as `banner`, `label`, `letters`, and `plaque` should not be appended to the positive prompt as `no ...` phrases. These concepts belong in `negative_prompt`; the positive prompt should describe the desired empty visual space.
- Final assembly needs an image/clip missing gate before `editor.assemble()` so scene-to-asset index shifts or missing files fail loudly.

Partially accepted:

- The review suggested much longer TTS silence such as `0.8s-1.5s`. Because the user reported the result as too slow and 답답한, this plan does not add large silence globally. Instead it uses modest per-sentence silence and achieves calm pacing through script structure, paragraph breaks, and scene count.

Rejected:

- Using large silence padding as the main way to reach 10 minutes. Runtime must come from real script length and natural narration, not padding or post-stretch.

## Problem Summary

The last render had two major quality problems:

- The narration felt too slow because the final `7:20` Hermes render was stretched to `10:18` with FFmpeg `setpts=1.4*PTS` and `atempo=0.7142857`.
- The top-center blur was caused by applying FFmpeg `delogo` over AI-generated English labels such as `inward a`, `modern i`, and `honest a`.

The correct fix is to make the source content naturally long enough and to fail/regenerate bad keyframes before editing.

## File Structure

- Modify: `C:\Users\petbl\hermes-studio\hermes-local\lib\manual-storyboard\storyboard-plan.mjs`
  - Preserve manual scene timing while allowing target duration to be treated as a planning hint, not a reason to stretch final video.
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\lib\pipeline\runner.mjs`
  - Add a script-length pre-flight gate before TTS and a voice-duration gate after TTS.
- Create: `C:\Users\petbl\hermes-studio\hermes-local\lib\quality\longform-duration.mjs`
  - Compute whether the source script and actual voice duration can satisfy the requested runtime without post-stretch.
- Create: `C:\Users\petbl\hermes-studio\hermes-local\lib\quality\top-artifact-detector.mjs`
  - Detect suspicious top-center text/label artifacts in sampled frames or keyframes.
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\lib\visual\keyframe-generator.mjs`
  - Add stricter textless prompt reinforcement and optional candidate retry when top artifacts are detected.
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\config\local.json`
  - Add a `render.longform` policy and adjust TTS speed policy for "sleep but not dragging".
- Create: `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-longform-duration-gate.mjs`
  - Unit check for longform duration acceptance/rejection.
- Create: `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-top-artifact-detector.mjs`
  - Unit check for detecting top-center label-like bands.
- Create: `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-no-post-stretch-policy.mjs`
  - Check production reports and generated commands never use final MP4 speed stretching as a duration fix.
- Create: `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-editor-asset-gate.mjs`
  - Check that missing clips/images are caught before final assembly.
- Create: `C:\Users\petbl\hermes-studio\hermes-local\lib\quality\asset-gate.mjs`
  - Validate that every planned scene has a matching, non-empty clip file before editing.
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\package.json`
  - Add check scripts.
- Modify: `C:\Users\petbl\auto-video\auto-video.md`
  - Update the workflow rule: 10+ minutes must be achieved by source script length or planned chapter count, never by slowing the completed MP4.

## Policy Decisions

- Final-video slow stretching is disallowed for deliverables.
- Target runtime is achieved by generating more narration, not by making speech unnaturally slow.
- Recommended Korean sleep narration speed: `1.00` to `1.06` for normal explanation, `0.94` to `0.98` only for scripture quotation or emotionally heavy pauses.
- Recommended silence policy: `0.32` to `0.55` seconds for ordinary narration, `0.50` to `0.75` seconds for scripture quotations. Longer pauses should be intentional scene/chapter breaks, not global padding.
- A 10-minute video should target roughly `4,500-6,000 Korean characters` depending on voice and pauses. The previous `2,843` characters was too short.
- Any readable generated text inside visuals is a hard failure for upload candidates.

---

### Task 1: Add Longform Duration Gate

**Files:**
- Create: `C:\Users\petbl\hermes-studio\hermes-local\lib\quality\longform-duration.mjs`
- Create: `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-longform-duration-gate.mjs`
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\package.json`

- [ ] **Step 1: Create failing check**

Create `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-longform-duration-gate.mjs`:

```js
#!/usr/bin/env node
import assert from "node:assert/strict";
import { evaluateLongformDuration, evaluateScriptPreflight } from "../lib/quality/longform-duration.mjs";

const tooShortScript = evaluateScriptPreflight({
  script: "짧은 원고입니다.",
  targetSeconds: 600,
  policy: { minimumScriptCharsFor10Min: 4500 },
});
assert.equal(tooShortScript.ok, false);
assert.equal(tooShortScript.reason, "script_chars_below_minimum");

const longEnoughScript = evaluateScriptPreflight({
  script: "가".repeat(4700),
  targetSeconds: 600,
  policy: { minimumScriptCharsFor10Min: 4500 },
});
assert.equal(longEnoughScript.ok, true);

const short = evaluateLongformDuration({
  targetSeconds: 600,
  voiceAssets: [{ voice_duration: 120 }, { voice_duration: 180 }, { voice_duration: 140 }],
  policy: { minTargetRatio: 0.95 },
});
assert.equal(short.ok, false);
assert.equal(short.reason, "voice_duration_below_target");
assert.equal(short.voiceTotalSeconds, 440);

const enough = evaluateLongformDuration({
  targetSeconds: 600,
  voiceAssets: [{ voice_duration: 210 }, { voice_duration: 200 }, { voice_duration: 180 }],
  policy: { minTargetRatio: 0.95 },
});
assert.equal(enough.ok, true);
assert.equal(enough.voiceTotalSeconds, 590);

const auto = evaluateLongformDuration({
  targetSeconds: "auto",
  voiceAssets: [{ voice_duration: 440 }],
  policy: { minTargetRatio: 0.95 },
});
assert.equal(auto.ok, true);
assert.equal(auto.reason, "no_numeric_target");

console.log("check-longform-duration-gate: pass");
```

- [ ] **Step 2: Run check and verify it fails**

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
node scripts\check-longform-duration-gate.mjs
```

Expected: fails with module not found for `../lib/quality/longform-duration.mjs`.

- [ ] **Step 3: Implement duration evaluator**

Create `C:\Users\petbl\hermes-studio\hermes-local\lib\quality\longform-duration.mjs`:

```js
export function evaluateLongformDuration({ targetSeconds = null, voiceAssets = [], policy = {} } = {}) {
  const numericTarget = Number(targetSeconds);
  const voiceTotalSeconds = round2((Array.isArray(voiceAssets) ? voiceAssets : [])
    .reduce((sum, asset) => sum + positiveNumber(asset?.voice_duration), 0));
  const minTargetRatio = positiveNumber(policy.minTargetRatio) || 0.95;

  if (!Number.isFinite(numericTarget) || numericTarget <= 0) {
    return {
      ok: true,
      reason: "no_numeric_target",
      targetSeconds: null,
      voiceTotalSeconds,
      minRequiredSeconds: 0,
      minTargetRatio,
    };
  }

  const minRequiredSeconds = round2(numericTarget * minTargetRatio);
  const ok = voiceTotalSeconds >= minRequiredSeconds;
  return {
    ok,
    reason: ok ? "voice_duration_satisfies_target" : "voice_duration_below_target",
    targetSeconds: numericTarget,
    voiceTotalSeconds,
    minRequiredSeconds,
    minTargetRatio,
    deficitSeconds: ok ? 0 : round2(minRequiredSeconds - voiceTotalSeconds),
  };
}

export function evaluateScriptPreflight({ script = "", targetSeconds = null, policy = {} } = {}) {
  const numericTarget = Number(targetSeconds);
  const meaningfulChars = String(script || "").replace(/\s+/g, "").length;
  if (!Number.isFinite(numericTarget) || numericTarget < 600) {
    return {
      ok: true,
      reason: "target_below_longform_threshold",
      targetSeconds: Number.isFinite(numericTarget) ? numericTarget : null,
      meaningfulChars,
      minimumChars: 0,
    };
  }

  const minimumChars = positiveNumber(policy.minimumScriptCharsFor10Min) || 4500;
  const ok = meaningfulChars >= minimumChars;
  return {
    ok,
    reason: ok ? "script_chars_satisfy_minimum" : "script_chars_below_minimum",
    targetSeconds: numericTarget,
    meaningfulChars,
    minimumChars,
    deficitChars: ok ? 0 : minimumChars - meaningfulChars,
  };
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function round2(value) {
  return Number((Number(value) || 0).toFixed(2));
}
```

- [ ] **Step 4: Add package script**

Modify `C:\Users\petbl\hermes-studio\hermes-local\package.json` inside `scripts`:

```json
"check:longform-duration-gate": "node scripts/check-longform-duration-gate.mjs"
```

- [ ] **Step 5: Run check**

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
npm run check:longform-duration-gate
```

Expected: `check-longform-duration-gate: pass`.

---

### Task 2: Enforce Script Pre-Flight And Voice Duration Gates In Runner

**Files:**
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\lib\pipeline\runner.mjs`
- Create: `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-runner-longform-duration-gate.mjs`
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\package.json`

- [ ] **Step 1: Create runner check**

Create `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-runner-longform-duration-gate.mjs`:

```js
#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunner } from "../lib/pipeline/runner.mjs";

const jobDir = mkdtempSync(join(tmpdir(), "hermes-longform-gate-"));
const plan = {
  title: "Longform Gate",
  style_preset: "calm-scripture",
  duration_seconds: 600,
  aspect_ratio: "16:9",
  scenes: [
    { order: 1, keyword: "short", narration: "짧은 원고입니다.", video_prompt: "plain garden", negative_prompt: "text", duration_seconds: 300, motion: "slow" },
    { order: 2, keyword: "short2", narration: "아직 짧습니다.", video_prompt: "plain tree", negative_prompt: "text", duration_seconds: 300, motion: "slow" },
  ],
};

const runner = createRunner({
  director: { async buildScenePlan() { throw new Error("director should be skipped"); } },
  voice: {
    async generateAll({ scenes }) {
      return scenes.map((scene) => ({
        order: scene.order,
        voice_path: `voice_${scene.order}.wav`,
        voice_duration: 110,
        status: "ok",
      }));
    },
  },
  camera: { async generateAll() { throw new Error("camera should not run when longform gate fails"); } },
  editor: { async assemble() { throw new Error("editor should not run when longform gate fails"); } },
  qa: { async run() { throw new Error("qa should not run when longform gate fails"); } },
  medic: { async diagnose() { return { directives: [], source: "rules" }; } },
  cfg: {
    render: {
      defaultDurationSeconds: 600,
      stylePreset: "calm-scripture",
      longform: { enforceVoiceDurationTarget: true, minTargetRatio: 0.95 },
    },
    video: { clipSeconds: 10 },
    tts: { syncPolicy: { enforceFinal: true } },
  },
});

const result = await runner.run({ script: "짧은 원고입니다.\n아직 짧습니다.", plan, jobDir, targetSeconds: 600, visualMode: "legacy" });
assert.equal(result.ok, false);
assert.equal(result.stage, "script_preflight");
assert.equal(result.scriptPreflight.reason, "script_chars_below_minimum");
assert(existsSync(join(jobDir, "script-preflight-report.json")), "script-preflight-report.json should be written");

const report = JSON.parse(readFileSync(join(jobDir, "script-preflight-report.json"), "utf8"));
assert.equal(report.targetSeconds, 600);
assert(report.meaningfulChars < report.minimumChars);

console.log("check-runner-longform-duration-gate: pass");
```

- [ ] **Step 2: Run check and verify it fails**

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
node scripts\check-runner-longform-duration-gate.mjs
```

Expected: fail because runner does not yet enforce `render.longform.enforceScriptPreflight`.

- [ ] **Step 3: Add runner gate**

Modify `C:\Users\petbl\hermes-studio\hermes-local\lib\pipeline\runner.mjs`.

Add import near existing imports:

```js
import { evaluateLongformDuration, evaluateScriptPreflight } from "../quality/longform-duration.mjs";
```

Before `voice_started`, add:

```js
      const longformPolicy = cfg?.render?.longform || {};
      const scriptPreflight = evaluateScriptPreflight({
        script,
        targetSeconds: target,
        policy: longformPolicy,
      });
      writeFileSync(jobDir + "/script-preflight-report.json", JSON.stringify(scriptPreflight, null, 2), "utf8");
      log("script_preflight_completed", scriptPreflight);
      if (longformPolicy.enforceScriptPreflight === true && !scriptPreflight.ok) {
        const timing = writeTimingSummary({
          verdict: "fail",
          qualityOk: false,
          aborted: true,
          reason: "script_chars_below_longform_minimum",
        });
        return {
          ok: false,
          verdict: "fail",
          qualityOk: false,
          stage: "script_preflight",
          plan,
          visual,
          finalPath: null,
          srtPath: null,
          scriptPreflight,
          timing,
          jobDir,
        };
      }
```

After `tts_sync_gate_completed` before camera generation, add:

```js
      const longformDuration = evaluateLongformDuration({
        targetSeconds: target,
        voiceAssets,
        policy: longformPolicy,
      });
      writeFileSync(jobDir + "/longform-duration-report.json", JSON.stringify(longformDuration, null, 2), "utf8");
      log("longform_duration_completed", longformDuration);
      if (longformPolicy.enforceVoiceDurationTarget === true && !longformDuration.ok) {
        const timing = writeTimingSummary({
          verdict: "fail",
          qualityOk: false,
          aborted: true,
          reason: "longform_voice_duration_below_target",
        });
        return {
          ok: false,
          verdict: "fail",
          qualityOk: false,
          stage: "longform_duration",
          plan,
          visual,
          finalPath: null,
          srtPath: null,
          longformDuration,
          timing,
          jobDir,
        };
      }
```

- [ ] **Step 4: Add package script**

Modify `package.json`:

```json
"check:runner-longform-duration-gate": "node scripts/check-runner-longform-duration-gate.mjs"
```

- [ ] **Step 5: Run checks**

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
npm run check:longform-duration-gate
npm run check:runner-longform-duration-gate
npm run check:duration-contract
```

Expected: all pass.

---

### Task 3: Add Comfortable Sleep TTS Policy

**Files:**
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\config\local.json`
- Create: `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-sleep-tts-policy.mjs`
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\package.json`

- [ ] **Step 1: Create policy check**

Create `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-sleep-tts-policy.mjs`:

```js
#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cfg = JSON.parse(readFileSync("config/local.json", "utf8"));

assert(cfg.tts.speed >= 1.0 && cfg.tts.speed <= 1.08, "normal sleep narration speed should be natural, not dragged");
assert(cfg.tts.scriptureSpeed >= 0.94 && cfg.tts.scriptureSpeed <= 1.0, "scripture quotation speed should be calm but not too slow");
assert(cfg.tts.silenceDuration >= 0.32 && cfg.tts.silenceDuration <= 0.55, "default silence should be calm without padding runtime");
assert(cfg.tts.scriptureSilenceDuration >= 0.5 && cfg.tts.scriptureSilenceDuration <= 0.75, "scripture silence should be contemplative but not a runtime hack");
assert.equal(cfg.render.longform.enforceScriptPreflight, true);
assert.equal(cfg.render.longform.enforceVoiceDurationTarget, true);
assert(cfg.render.longform.minTargetRatio >= 0.95);
assert.equal(cfg.render.longform.allowFinalStretch, false);

console.log("check-sleep-tts-policy: pass");
```

- [ ] **Step 2: Run check and verify it fails**

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
node scripts\check-sleep-tts-policy.mjs
```

Expected: fail because `scriptureSpeed` is `0.88`, ordinary silence is outside the desired range, and `render.longform` is missing.

- [ ] **Step 3: Update config**

Modify `C:\Users\petbl\hermes-studio\hermes-local\config\local.json`:

```json
"tts": {
  "speed": 1.04,
  "numberSensitiveSpeed": 0.98,
  "scriptureSpeed": 0.96,
  "silenceDuration": 0.38,
  "continuousSilenceDuration": 0.04,
  "scriptureSilenceDuration": 0.6
}
```

Inside `render`, add:

```json
"longform": {
  "enforceScriptPreflight": true,
  "enforceVoiceDurationTarget": true,
  "minTargetRatio": 0.95,
  "allowFinalStretch": false,
  "minimumScriptCharsFor10Min": 4500,
  "recommendedScriptCharsFor10Min": 5200
}
```

- [ ] **Step 4: Add package script**

Modify `package.json`:

```json
"check:sleep-tts-policy": "node scripts/check-sleep-tts-policy.mjs"
```

- [ ] **Step 5: Run check**

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
npm run check:sleep-tts-policy
```

Expected: `check-sleep-tts-policy: pass`.

---

### Task 4: Detect Top-Center Visual Label Artifacts

**Files:**
- Create: `C:\Users\petbl\hermes-studio\hermes-local\lib\quality\top-artifact-detector.mjs`
- Create: `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-top-artifact-detector.mjs`
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\package.json`

- [ ] **Step 1: Create detector check**

Create `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-top-artifact-detector.mjs`:

```js
#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { detectTopCenterArtifact } from "../lib/quality/top-artifact-detector.mjs";

const dir = mkdtempSync(join(tmpdir(), "hermes-top-artifact-"));
const cleanPath = join(dir, "clean.png");
const badPath = join(dir, "bad.png");

await sharp({
  create: {
    width: 1024,
    height: 576,
    channels: 3,
    background: { r: 12, g: 0, b: 18 },
  },
}).png().toFile(cleanPath);

await sharp(cleanPath)
  .composite([
    {
      input: await sharp({
        create: {
          width: 260,
          height: 70,
          channels: 3,
          background: { r: 235, g: 225, b: 255 },
        },
      }).png().toBuffer(),
      left: 382,
      top: 28,
    },
  ])
  .png()
  .toFile(badPath);

const clean = await detectTopCenterArtifact(cleanPath);
assert.equal(clean.flagged, false);

const brightSkyPath = join(dir, "bright-sky.png");
await sharp({
  create: {
    width: 1024,
    height: 576,
    channels: 3,
    background: { r: 185, g: 185, b: 190 },
  },
}).png().toFile(brightSkyPath);
const brightSky = await detectTopCenterArtifact(brightSkyPath);
assert.equal(brightSky.flagged, false, "uniform bright top area should not be treated as a localized label");

const bad = await detectTopCenterArtifact(badPath);
assert.equal(bad.flagged, true);
assert(bad.score > 0.06, `expected visible top artifact score, got ${bad.score}`);

console.log("check-top-artifact-detector: pass");
```

- [ ] **Step 2: Run check and verify it fails**

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
node scripts\check-top-artifact-detector.mjs
```

Expected: fail because detector module does not exist.

- [ ] **Step 3: Implement detector**

Create `C:\Users\petbl\hermes-studio\hermes-local\lib\quality\top-artifact-detector.mjs`:

```js
import sharp from "sharp";

export async function detectTopCenterArtifact(imagePath, options = {}) {
  const image = sharp(imagePath);
  const meta = await image.metadata();
  const width = Number(meta.width) || 0;
  const height = Number(meta.height) || 0;
  if (width <= 0 || height <= 0) return { flagged: false, score: 0, reason: "invalid_image" };

  const regionH = Math.floor(height * (options.heightRatio ?? 0.16));
  const regionW = Math.floor(width * (options.widthRatio ?? 0.32));
  const top = Math.floor(height * (options.topRatio ?? 0.02));

  const regions = {
    left: { left: Math.floor(width * 0.02), top, width: regionW, height: regionH },
    center: { left: Math.floor(width * 0.34), top, width: regionW, height: regionH },
    right: { left: Math.floor(width * 0.66), top, width: Math.max(1, Math.min(regionW, width - Math.floor(width * 0.66))), height: regionH },
  };

  const [leftStats, centerStats, rightStats] = await Promise.all([
    image.clone().extract(regions.left).grayscale().stats(),
    image.clone().extract(regions.center).grayscale().stats(),
    image.clone().extract(regions.right).grayscale().stats(),
  ]);

  const meanLeft = leftStats.channels[0].mean / 255;
  const meanCenter = centerStats.channels[0].mean / 255;
  const meanRight = rightStats.channels[0].mean / 255;
  const stdevCenter = centerStats.channels[0].stdev / 255;
  const surroundingMax = Math.max(meanLeft, meanRight);
  const relativeContrast = Math.max(0, meanCenter - surroundingMax);
  const score = Number((relativeContrast * 0.7 + stdevCenter * 0.3).toFixed(4));
  const threshold = Number(options.threshold ?? 0.06);
  const minCenterMean = Number(options.minCenterMean ?? 0.15);
  const flagged = score >= threshold && meanCenter >= minCenterMean;

  return {
    flagged,
    score,
    threshold,
    regions,
    meanLeft: Number(meanLeft.toFixed(4)),
    meanCenter: Number(meanCenter.toFixed(4)),
    meanRight: Number(meanRight.toFixed(4)),
    stdevCenter: Number(stdevCenter.toFixed(4)),
    relativeContrast: Number(relativeContrast.toFixed(4)),
    reason: flagged ? "top_center_localized_bright_label" : "ok",
  };
}
```

- [ ] **Step 4: Add package script**

Modify `package.json`:

```json
"check:top-artifact-detector": "node scripts/check-top-artifact-detector.mjs"
```

- [ ] **Step 5: Run check**

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
npm run check:top-artifact-detector
```

Expected: `check-top-artifact-detector: pass`.

---

### Task 5: Regenerate Bad Keyframes Instead Of Delogo

**Files:**
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\lib\visual\keyframe-generator.mjs`
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\lib\visual\keyframe-prompt-guards.mjs`
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-keyframe-prompt-guards.mjs`
- Create: `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-keyframe-top-artifact-retry.mjs`
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\package.json`

- [ ] **Step 1: Strengthen prompt guard check**

Append to `scripts\check-keyframe-prompt-guards.mjs`:

```js
const floatingLabel = guardKeyframePrompt({
  prompt: "dark garden with a floating UI label at the top center, readable title text, no readable text",
  negative: "readable text, generated text, watermark, UI",
});

assert(!/floating UI label|readable title text|top center/i.test(floatingLabel.prompt));
assert(!/\bno\s+(text|label|banner|letters|plaque)\b/i.test(floatingLabel.prompt));
assert.match(floatingLabel.prompt, /empty sky|plain dark negative space|unlettered/);
assert.match(floatingLabel.negative, /label|banner|letters|plaque|typography/);
```

- [ ] **Step 2: Update prompt guard**

In `lib\visual\keyframe-prompt-guards.mjs`, extend `replaceReadableTextDemands`:

```js
  out = out
    .replace(/\bfloating\s+(?:UI\s+)?label(?:\s+at\s+the\s+top\s+center)?\b/gi, "plain dark negative space with no marks")
    .replace(/\breadable\s+title\s+text\b/gi, "unlettered symbolic title area")
    .replace(/\btop\s+center\s+label\b/gi, "empty sky area");
```

Also strengthen the returned `negative`, not the positive prompt:

```js
  const negativeOut = dedupeClauses([
    negative,
    "readable text",
    "generated text",
    "text banner",
    "title plaque",
    "floating label",
    "UI panel",
    "letters",
    "typography",
    "watermark",
    "logo",
  ].filter(Boolean).join(", "));
  out = dedupeClauses(out);
  return { prompt: out, negative: negativeOut };
```

- [ ] **Step 3: Create retry check**

Create `scripts\check-keyframe-top-artifact-retry.mjs`:

```js
#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createKeyframeGenerator } from "../lib/visual/keyframe-generator.mjs";

const jobDir = mkdtempSync(join(tmpdir(), "hermes-kf-artifact-retry-"));
let calls = 0;
const provider = {
  async generateImage({ outPath }) {
    calls += 1;
    const base = sharp({
      create: { width: 1024, height: 576, channels: 3, background: { r: 12, g: 0, b: 18 } },
    });
    if (calls === 1) {
      const label = await sharp({
        create: { width: 300, height: 80, channels: 3, background: { r: 235, g: 225, b: 255 } },
      }).png().toBuffer();
      await base.composite([{ input: label, left: 362, top: 24 }]).png().toFile(outPath);
      return;
    }
    await base.png().toFile(outPath);
  },
};

const generator = createKeyframeGenerator({ imageProvider: provider });
const storyboardPlan = {
  style_preset: "calm-scripture",
  scenes: [{
    scene_id: "scene_01",
    narration_refs: [1],
    duration_seconds: 8,
    semantic_intent: "test",
    metaphor: "test",
    composition: "wide",
    micro_motion: [],
    keyframe_prompt: "dark garden, empty unmarked top margin",
    video_prompt: "dark garden",
    negative_prompt: "readable text, generated text, watermark, UI",
  }],
};

const result = await generator.generate({
  storyboardPlan,
  jobDir,
  mode: "render",
  width: 1024,
  height: 576,
  visualStyle: { topArtifactRetry: true, topArtifactRetryCount: 1 },
});

assert.equal(calls, 2);
assert.equal(result.manifest.scenes[0].topArtifactRetry, true);
assert.equal(result.manifest.scenes[0].status, "ok");

console.log("check-keyframe-top-artifact-retry: pass");
```

- [ ] **Step 4: Add retry in generator**

In `lib\visual\keyframe-generator.mjs`, add import:

```js
import { detectTopCenterArtifact } from "../quality/top-artifact-detector.mjs";
```

After `generateOne(...)` succeeds for a single candidate, add:

```js
                if (visualStyle?.topArtifactRetry === true) {
                  const detected = await detectTopCenterArtifact(outPath, visualStyle.topArtifactDetector || {});
                  item.topArtifact = detected;
                  const retryCount = Math.max(0, Number(visualStyle.topArtifactRetryCount || 1));
                  if (detected.flagged && retryCount > 0) {
                    const guardedRetry = guardKeyframePrompt({
                      prompt: `${keyframePrompt}, empty unmarked top margin, seamless dark sky, clean negative space`,
                      negative: scene.negative_prompt,
                      forbidden: scene.forbidden_visuals || [],
                    });
                    await generateOne({
                      imageProvider,
                      scene: { ...scene, negative_prompt: guardedRetry.negative },
                      visualStyle,
                      loras,
                      width,
                      height,
                      seed: s + 101,
                      outPath,
                      prompt: guardedRetry.prompt,
                    });
                    item.topArtifactRetry = true;
                    item.topArtifactAfterRetry = await detectTopCenterArtifact(outPath, visualStyle.topArtifactDetector || {});
                    if (item.topArtifactAfterRetry.flagged) {
                      item.readabilityWarning = "top_center_artifact_detected";
                    }
                  }
                }
```

- [ ] **Step 5: Add package script and run**

Modify `package.json`:

```json
"check:keyframe-top-artifact-retry": "node scripts/check-keyframe-top-artifact-retry.mjs"
```

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
npm run check:keyframe-prompt-guards
npm run check:keyframe-top-artifact-retry
```

Expected: both pass.

---

### Task 6: Add Editor Asset Missing Gate

**Files:**
- Create: `C:\Users\petbl\hermes-studio\hermes-local\lib\quality\asset-gate.mjs`
- Create: `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-editor-asset-gate.mjs`
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\lib\pipeline\runner.mjs`
- Modify: `C:\Users\petbl\hermes-studio\hermes-local\package.json`

- [ ] **Step 1: Create asset gate check**

Create `C:\Users\petbl\hermes-studio\hermes-local\scripts\check-editor-asset-gate.mjs`:

```js
#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateClipAssetGate } from "../lib/quality/asset-gate.mjs";

const dir = mkdtempSync(join(tmpdir(), "hermes-asset-gate-"));
const okClip = join(dir, "clip_01.mp4");
writeFileSync(okClip, "fake");

const scenes = [{ order: 1 }, { order: 2 }];
const clipAssets = [
  { order: 1, clip_path: okClip, status: "ok" },
  { order: 2, clip_path: join(dir, "missing.mp4"), status: "ok" },
];

const report = evaluateClipAssetGate({ scenes, clipAssets });
assert.equal(report.ok, false);
assert.deepEqual(report.missingOrders, [2]);
assert.match(report.failures[0], /scene 2/);

const pass = evaluateClipAssetGate({ scenes: [{ order: 1 }], clipAssets: [{ order: 1, clip_path: okClip, status: "ok" }] });
assert.equal(pass.ok, true);

console.log("check-editor-asset-gate: pass");
```

- [ ] **Step 2: Run check and verify it fails**

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
node scripts\check-editor-asset-gate.mjs
```

Expected: fail because `lib\quality\asset-gate.mjs` does not exist.

- [ ] **Step 3: Implement asset gate**

Create `C:\Users\petbl\hermes-studio\hermes-local\lib\quality\asset-gate.mjs`:

```js
import { existsSync, statSync } from "node:fs";

export function evaluateClipAssetGate({ scenes = [], clipAssets = [] } = {}) {
  const byOrder = new Map((Array.isArray(clipAssets) ? clipAssets : []).map((asset) => [Number(asset.order), asset]));
  const failures = [];
  const missingOrders = [];

  for (const scene of Array.isArray(scenes) ? scenes : []) {
    const order = Number(scene.order);
    const asset = byOrder.get(order);
    const path = asset?.clip_path;
    const exists = typeof path === "string" && path.length > 0 && existsSync(path) && fileSize(path) > 0;
    if (!asset || asset.status !== "ok" || !exists) {
      missingOrders.push(order);
      failures.push(`scene ${order} has no usable clip asset`);
    }
  }

  return {
    ok: failures.length === 0,
    totalScenes: Array.isArray(scenes) ? scenes.length : 0,
    totalClipAssets: Array.isArray(clipAssets) ? clipAssets.length : 0,
    missingOrders,
    failures,
  };
}

function fileSize(path) {
  try { return statSync(path).size; } catch { return 0; }
}
```

- [ ] **Step 4: Add runner gate before editor**

In `lib\pipeline\runner.mjs`, add import:

```js
import { evaluateClipAssetGate } from "../quality/asset-gate.mjs";
```

Immediately before `editor.assemble(...)`, add:

```js
        const assetGate = evaluateClipAssetGate({ scenes: plan.scenes, clipAssets });
        writeFileSync(jobDir + "/editor-asset-gate.json", JSON.stringify(assetGate, null, 2), "utf8");
        log("editor_asset_gate_completed", assetGate);
        if (!assetGate.ok) {
          const timing = writeTimingSummary({
            verdict: "fail",
            qualityOk: false,
            aborted: true,
            reason: "editor_clip_asset_missing",
          });
          return {
            ok: false,
            verdict: "fail",
            qualityOk: false,
            stage: "editor_asset_gate",
            plan,
            visual,
            finalPath: null,
            srtPath: null,
            assetGate,
            timing,
            jobDir,
          };
        }
```

- [ ] **Step 5: Add package script and run**

Modify `package.json`:

```json
"check:editor-asset-gate": "node scripts/check-editor-asset-gate.mjs"
```

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
npm run check:editor-asset-gate
```

Expected: `check-editor-asset-gate: pass`.

---

### Task 7: Add No Post-Stretch Policy To Auto-Video Workflow

**Files:**
- Modify: `C:\Users\petbl\auto-video\auto-video.md`
- Create: `C:\Users\petbl\auto-video\scripts\check_auto_video_policy.py`

- [ ] **Step 1: Add policy checker**

Create `C:\Users\petbl\auto-video\scripts\check_auto_video_policy.py`:

```python
from pathlib import Path

doc = Path("auto-video.md").read_text(encoding="utf-8")

required = [
    "완성된 MP4를 느리게 늘려서 10분을 맞추지 않는다",
    "10분 이상은 대본 분량과 장면 수로 먼저 맞춘다",
    "상단 영어 라벨이나 워터마크가 보이면 후처리로 흐리지 말고 이미지를 재생성한다",
    "10분 영상의 1차 목표 원고는 4,500~6,000자",
]

missing = [line for line in required if line not in doc]
if missing:
    raise SystemExit("missing policy lines: " + "; ".join(missing))

print("check_auto_video_policy: pass")
```

- [ ] **Step 2: Run and verify fail**

Run:

```powershell
cd C:\Users\petbl\auto-video
python scripts\check_auto_video_policy.py
```

Expected: fail with missing policy lines.

- [ ] **Step 3: Update workflow doc**

Add this section to `C:\Users\petbl\auto-video\auto-video.md`:

```markdown
## 장편 수면 영상 품질 규칙

- 완성된 MP4를 느리게 늘려서 10분을 맞추지 않는다.
- 10분 이상은 대본 분량과 장면 수로 먼저 맞춘다.
- 10분 영상의 1차 목표 원고는 4,500~6,000자다.
- TTS는 수면용으로 차분하게 유지하되, 전체 속도를 0.8배 이하로 낮추지 않는다.
- 상단 영어 라벨이나 워터마크가 보이면 후처리로 흐리지 말고 이미지를 재생성한다.
- 최종 납품 전 `ffprobe` 길이 확인과 1분/5분/9분 대표 프레임 육안 확인을 반드시 한다.
```

- [ ] **Step 4: Run policy check**

Run:

```powershell
cd C:\Users\petbl\auto-video
python scripts\check_auto_video_policy.py
```

Expected: `check_auto_video_policy: pass`.

---

### Task 8: Produce A Corrected 10+ Minute Test Episode

**Files:**
- Create: `C:\Users\petbl\auto-video\exports\gguljam-bible-adam-eve-10min-v2\hermes-manual-storyboard.md`
- Create: `C:\Users\petbl\auto-video\exports\gguljam-bible-adam-eve-10min-v2\script.txt`
- Create: `C:\Users\petbl\auto-video\exports\gguljam-bible-adam-eve-10min-v2\production-report.md`

- [ ] **Step 1: Expand script before rendering**

Create a new v2 storyboard with enough narration:

- Target script length: `4,800-5,500 Korean characters`
- Target scene count: `60-72`
- Each scene narration: `70-95 Korean characters`
- Avoid positive prompt phrases that can imply text UI: `label`, `title`, `word`, `letters`, `sign`, `banner`, `plaque`
- Every image prompt uses positive textless language such as: `empty unmarked top margin, seamless dark sky, clean negative space, unlettered symbolic objects`
- Every `negative_prompt` includes: `readable text, generated text, text banner, title plaque, floating label, UI panel, letters, typography, watermark, logo`

- [ ] **Step 2: Validate export**

Run:

```powershell
cd C:\Users\petbl\auto-video
python scripts\validate_hermes_export.py --export-dir C:\Users\petbl\auto-video\exports\gguljam-bible-adam-eve-10min-v2
```

Expected: `Hermes export validation: pass`.

- [ ] **Step 3: Dry run**

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
node scripts\run-job.mjs --manual-storyboard C:\Users\petbl\auto-video\exports\gguljam-bible-adam-eve-10min-v2\hermes-manual-storyboard.md --seconds 600 --style calm-scripture --engine stickman --visual-mode contextual-preview --dry-run --no-llm
```

Expected: `verdict: pass`.

- [ ] **Step 4: Full render without post-stretch**

Run:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
node scripts\run-job.mjs --manual-storyboard C:\Users\petbl\auto-video\exports\gguljam-bible-adam-eve-10min-v2\hermes-manual-storyboard.md --seconds 600 --style calm-scripture --engine stickman --visual-mode contextual-keyframes --no-llm --allow-fallback-video
```

Expected:

- `verdict: pass`
- `longform_duration_completed.ok` is `true`
- `duration_contract_completed.verdict` is `pass` or `warn` only if final is within voice expectation
- No FFmpeg `setpts` or `atempo` post-stretch is used

- [ ] **Step 5: Verify final**

Run:

```powershell
ffprobe -v error -show_entries format=duration -show_entries stream=codec_type,width,height,channels,sample_rate -of default=noprint_wrappers=1 <FINAL_MP4_PATH>
```

Expected:

- `duration >= 600`
- `width=1920`
- `height=1080`
- `codec_type=audio`
- `sample_rate=48000`

- [ ] **Step 6: Sample frames**

Run:

```powershell
ffmpeg -y -ss 00:01:00 -i <FINAL_MP4_PATH> -frames:v 1 C:\Users\petbl\auto-video\exports\gguljam-bible-adam-eve-10min-v2\preview-0100.png
ffmpeg -y -ss 00:05:00 -i <FINAL_MP4_PATH> -frames:v 1 C:\Users\petbl\auto-video\exports\gguljam-bible-adam-eve-10min-v2\preview-0500.png
ffmpeg -y -ss 00:09:00 -i <FINAL_MP4_PATH> -frames:v 1 C:\Users\petbl\auto-video\exports\gguljam-bible-adam-eve-10min-v2\preview-0900.png
```

Expected:

- No top-center English label.
- No delogo blur patch.
- Korean subtitles readable.
- Narration feels calm but not dragged.

---

## Verification Bundle

Run all relevant checks:

```powershell
cd C:\Users\petbl\hermes-studio\hermes-local
npm run check:longform-duration-gate
npm run check:runner-longform-duration-gate
npm run check:sleep-tts-policy
npm run check:top-artifact-detector
npm run check:keyframe-prompt-guards
npm run check:keyframe-top-artifact-retry
npm run check:editor-asset-gate
npm run check:manual-storyboard-parser
npm run check:manual-storyboard-plan
npm run check:runner-manual-storyboard
npm run check:duration-contract
```

Then:

```powershell
cd C:\Users\petbl\auto-video
python scripts\check_auto_video_policy.py
```

## Acceptance Criteria

- 10+ minute output is achieved without `setpts` or `atempo` final stretch.
- Final voice pace is natural enough for listening while falling asleep.
- Final output has no top-center label, no delogo blur patch, no generated text, and no watermark.
- If actual TTS duration is below target, the pipeline fails before expensive camera/editing and instructs the operator to expand the script.
- If source script length is clearly below the 10-minute minimum, the pipeline fails before TTS and GPU work.
- If a scene has no usable clip asset, the pipeline fails before final editing instead of creating a shifted or broken video.
- Production report records actual render time, final duration, voice duration, and whether any keyframes were retried for top artifacts.

## Self-Review

- Spec coverage: covers slow narration, top-center blur, source duration mismatch, visual label prevention, pre-flight script length, editor asset presence, and documentation policy.
- Placeholder scan: no placeholder markers remain; every task has concrete files and commands.
- Type consistency: `evaluateLongformDuration`, `detectTopCenterArtifact`, and script names are consistent across tasks.
