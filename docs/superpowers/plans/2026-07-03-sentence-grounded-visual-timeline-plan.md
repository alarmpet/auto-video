# Sentence-Grounded Visual Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build visual storyboards where the first 60 seconds use about 10 context-matched images, and the remaining video uses 20-40 second narration chunks whose image prompts reflect each chunk's core sentence context and keywords.

**Architecture:** Replace fixed scene-count/even text splitting with a sentence-grounded visual timeline builder. The builder estimates narration duration from script text, preserves sentence boundaries, creates 5-6 second opening scenes for the first minute, creates 20-40 second body scenes after that, then generates context cards and prompts from each actual visual chunk. Add validation gates that fail when storyboard blocks, context cards, and visual timeline scenes diverge or when prompts do not cover the active chunk.

**Tech Stack:** Node.js ES modules, existing `scripts/lib/scene-context-card.mjs`, existing segmented export pipeline, existing Hermes manual storyboard format.

---

## File Structure

- Create `scripts/lib/sentence-grounded-visual-timeline.mjs`
  - Owns sentence splitting, duration estimation, opening/body chunk creation, and keyword extraction for reporting.
- Create `scripts/test_sentence_grounded_visual_timeline.mjs`
  - Tests first-minute 10-scene behavior, body 20-40 second behavior, sentence boundary preservation, and Korean text handling.
- Modify `scripts/build_segmented_storyboards.mjs`
  - Replace `buildVisualTimelineForWindow + splitSegmentScriptIntoScenes(segmentScript, segment.sceneCount)` with the new chunk builder.
  - Write `visual-grounding-report.json`.
  - Set segment `sceneCount` from actual grounded visual scenes.
  - Read `process.env.AUTO_VIDEO_ROOT` before falling back to `C:/Users/petbl/auto-video` so integration tests never write into the real export directory.
  - Recalculate `totalSceneCount` from actual grounded segment records before writing `production.json` and `segment-manifest.json`.
- Modify `scripts/lib/segment-plan.mjs`
  - Keep segment duration splitting, but stop treating `sceneCount` as authoritative fixed count.
  - Add `estimatedSceneCount` only as an estimate if needed by reports.
- Modify `scripts/lib/scene-context-card.mjs`
  - Add Elijah/Joseph/David/Moses/Jezebel character recognition as metadata, not as the default visual focus.
  - Add a context-first visual focus decision so prompts lead with concrete nouns, places, actions, and psychological state from the active sentence chunk before naming a person.
  - Add Elijah burnout, wilderness, broom-tree, Horeb, Carmel, and still-small-voice details/events so the grounding gate can demand concrete prompt terms beyond the character name.
- Create `scripts/check_visual_grounding_timeline.mjs`
  - Verifies storyboard block count, context card count, timeline count, duration limits, opening cadence, and required prompt coverage.
- Modify `scripts/validate_segmented_export.py`
  - Replace the old hardcoded `6s x 10 + 30s fixed body` timeline validation with `timingBand`-based opening/body validation.
  - Include `visual-grounding-timeline-report.json` in the render gate expectations.
- Modify `auto-video.md`
  - Document the new visual timing rule and render gate.

---

## Design Rules

1. First global 60 seconds:
   - Use roughly 10 images.
   - Target each scene at 6 seconds.
   - Allow the last opening scene to be shorter if the segment ends before 60 seconds.
   - Each opening scene should usually contain one sentence or one tight sentence pair.

2. After global 60 seconds:
   - Each visual scene must target 20-40 seconds.
   - Preferred target is 30 seconds.
   - Do not split inside sentence boundaries unless a single sentence is longer than the maximum body duration estimate.
   - Prompt and context card must be generated from the exact narration chunk assigned to that visual scene.
   - The prompt should not default to a portrait or full-body biblical figure when the active chunk is about a place, object, emotion, threat, silence, bread, water, cave, road, tree, mountain, or inner collapse.
   - Character names may appear as secondary context, but the leading prompt phrase and required terms should favor the chunk's concrete visual anchor and psychological keyword.

3. Render safety:
   - `visual-timeline.json`, `visual-context-cards.json`, and `hermes-manual-storyboard.md` must have identical scene counts.
   - `segment-manifest.json` must record the actual grounded scene count, not a precomputed fixed count.
   - The render must fail before Hermes when the first minute/body timing contract is violated.
   - `validate_segmented_export.py` must no longer require every body visual scene to be exactly 30 seconds.
   - The grounding gate must fail generic character-only prompts when the scene chunk contains concrete non-character anchors.

---

## Review Incorporation Decisions

Accepted from `docs/2026-07-03-sentence-grounded-visual-timeline-analysis.md`:

- Replace the existing `validate_segmented_export.py` hardcoded duration rule. The current code explicitly requires body visual durations after the first 10 scenes to be exactly `30.0`, which conflicts with the new 20-40 second sentence-grounded body chunks.
- Add `AUTO_VIDEO_ROOT` support to `scripts/build_segmented_storyboards.mjs`. The current script hardcodes `C:/Users/petbl/auto-video`, so the planned integration tests would otherwise write into the real workspace.
- Add `AUTO_VIDEO_ALLOW_TEST_BYPASS: "1"` to integration tests that use `--skip-script-quality`.
- Use the production default `5.2` chars/sec in tests and implementation unless a test explicitly covers another value. The current production builder defaults to `5.2`, while the earlier plan used `6.8`.
- Recalculate `totalSceneCount` after grounded scenes are built.
- Make Korean keyword coverage fail independently of the existing English prompt alignment score.
- Add Elijah-related character/event/detail rules because the immediate verification target is an Elijah burnout/loneliness export.
- Add context-first visual focus rules so Elijah/Joseph/David/Moses are not forced into every image when the active sentence is really about exhaustion, wilderness, bread, silence, fear, waiting, prison, road, cave, or another concrete anchor.
- Add a `globalStartSeconds > 0` test so second and subsequent segments are explicitly verified as body-only visual scenes.
- Fix the duplicate `body` key in the Elijah verification inspection command.

Partially accepted:

- Report naming remains `visual-grounding-report.json` and `visual-grounding-timeline-report.json` to avoid churn, but Task 6 must document the distinction clearly in `docs/agent-handoff-contract.md`.

Not adopted as a separate task:

- A new pre-Hermes `audioTempoFactor` gate is not added here because `audioTempoFactor` is only known after assembly and `validate_segmented_export.py` already checks it. This plan instead adds per-scene estimated narration density to the grounding report so abnormal visual chunk density can be inspected before render.

---

## Task 1: Sentence-Grounded Timeline Builder

**Files:**
- Create: `scripts/lib/sentence-grounded-visual-timeline.mjs`
- Test: `scripts/test_sentence_grounded_visual_timeline.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/test_sentence_grounded_visual_timeline.mjs`:

```js
import assert from "node:assert/strict";
import {
  buildSentenceGroundedVisualTimeline,
  splitKoreanSentences,
  extractChunkKeywords,
} from "./lib/sentence-grounded-visual-timeline.mjs";

const openingScript = [
  "??諛ㅼ뿉???ш쾶 ?닿릿 ?ㅼ뿉 臾대꼫吏????щ엺??留덉쓬??議곗슜???ㅼ뿬?ㅻ낫寃좎뒿?덈떎.",
  "?섎━?쇰뒗 媛덈찞?곗뿉????쇱슫 ?밸━瑜?蹂댁븯?듬땲??",
  "?섎뒛?먯꽌 遺덉씠 ?대젮?붽퀬 諛깆꽦?ㅼ? ?롫뱶?몄뒿?덈떎.",
  "紐⑤뱺 寃껋씠 ?앸궃 寃껋쿂??蹂댁??듬땲??",
  "?섏?留??댁빞湲곕뒗 ?밸━???먮━?먯꽌 ?앸굹吏 ?딆뒿?덈떎.",
  "洹??ㅼ쓬 ?λ㈃?먯꽌 ?곕━??吏移?留덉쓬??留뚮궔?덈떎.",
  "?щ엺? ???ш쾶 ?닿릿 ?ㅼ뿉??臾대꼫吏덇퉴??",
  "?ㅻ옒 踰꾪떞 留덉쓬? ???몄븞?댁?吏 紐삵븷源뚯슂.",
  "臾몄젣媛 ?닿껐?섏뿀?붾뜲????留덉쓬? ?⑤┫源뚯슂.",
  "?섎━?쇱쓽 ?댁빞湲곕뒗 洹?吏덈Ц??遺?꾨읇寃??ш린吏 ?딆뒿?덈떎.",
].join(" ");

const bodySentence = "?섎굹?섏? 臾대꼫吏??щ엺?먭쾶 癒쇱? ?댁쑀瑜?臾살? ?딆쑝?쒓퀬 ?↔낵 臾쇱쓣 二쇱떗?덈떎.";
const bodyScript = Array.from({ length: 36 }, (_, index) => `${bodySentence} ${index + 1}`).join(" ");
const script = `${openingScript}\n\n${bodyScript}`;

const scenes = buildSentenceGroundedVisualTimeline({
  script,
  targetSeconds: 180,
  globalStartSeconds: 0,
  openingSeconds: 60,
  openingSceneSeconds: 6,
  bodyMinSeconds: 20,
  bodyTargetSeconds: 30,
  bodyMaxSeconds: 40,
  charsPerSecond: 5.2,
});

assert.equal(splitKoreanSentences("泥?臾몄옣?낅땲?? ??踰덉㎏ 吏덈Ц?쇨퉴??").length, 2);
assert.equal(scenes.filter((scene) => scene.globalStartSeconds < 60).length, 10);
assert.ok(scenes.slice(0, 10).every((scene) => scene.durationSeconds <= 6.1));
assert.ok(scenes.slice(0, 10).every((scene) => scene.narration.length > 0));

const bodyScenes = scenes.filter((scene) => scene.globalStartSeconds >= 60);
assert.ok(bodyScenes.length > 0);
assert.ok(bodyScenes.every((scene, index) => (
  scene.durationSeconds >= 20
  || index === bodyScenes.length - 1
)));
assert.ok(bodyScenes.every((scene) => scene.durationSeconds <= 40.5));
assert.ok(bodyScenes.every((scene) => /??臾?臾대꼫吏??섎굹??.test(scene.narration)));

const secondSegmentScenes = buildSentenceGroundedVisualTimeline({
  script: bodyScript,
  targetSeconds: 180,
  globalStartSeconds: 900,
  openingSeconds: 60,
  openingSceneSeconds: 6,
  bodyMinSeconds: 20,
  bodyTargetSeconds: 30,
  bodyMaxSeconds: 40,
  charsPerSecond: 5.2,
});
assert.ok(secondSegmentScenes.every((scene) => scene.timingBand === "body"));
assert.ok(secondSegmentScenes.every((scene) => scene.globalStartSeconds >= 900));

const keywords = extractChunkKeywords("?섎━?쇰뒗 濡쒕??섎Т ?꾨옒?먯꽌 吏移?留덉쓬?쇰줈 ?좊뱾?덉뒿?덈떎.");
assert.ok(keywords.includes("?섎━??));
assert.ok(keywords.includes("濡쒕??섎Т"));
assert.ok(keywords.includes("吏移?));

console.log("test_sentence_grounded_visual_timeline: pass");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node scripts\test_sentence_grounded_visual_timeline.mjs
```

Expected:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module ... sentence-grounded-visual-timeline.mjs
```

- [ ] **Step 3: Write minimal implementation**

Create `scripts/lib/sentence-grounded-visual-timeline.mjs`:

```js
const DEFAULT_STOPWORDS = new Set([
  "洹몃━怨?, "洹몃윭??, "?섏?留?, "?ㅻ뒛", "諛?, "?곕━", "?뱀떊", "留덉쓬", "?щ엺", "?댁빞湲?,
  "寃껋엯?덈떎", "?덉뒿?덈떎", "?⑸땲??, "?⑸땲??, "?뚮Ц?낅땲??, "??, "?덈뒗", "?녿뒗",
]);

export function splitKoreanSentences(text) {
  const compact = String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (!compact) return [];
  return compact
    .split(/(?<=[.!??귨펯竊?)\s+/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function estimateNarrationSeconds(text, charsPerSecond = 5.2) {
  const chars = String(text || "").replace(/\s/g, "").length;
  return Math.max(0.5, chars / Math.max(1, Number(charsPerSecond) || 5.2));
}

export function extractChunkKeywords(text, limit = 8) {
  const words = String(text || "")
    .replace(/[^\p{Script=Hangul}A-Za-z0-9\s]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2)
    .filter((word) => !DEFAULT_STOPWORDS.has(word));
  const scored = new Map();
  for (const word of words) scored.set(word, (scored.get(word) || 0) + 1);
  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit)
    .map(([word]) => word);
}

export function buildSentenceGroundedVisualTimeline({
  script,
  targetSeconds,
  globalStartSeconds = 0,
  openingSeconds = 60,
  openingSceneSeconds = 6,
  bodyMinSeconds = 20,
  bodyTargetSeconds = 30,
  bodyMaxSeconds = 40,
  charsPerSecond = 5.2,
} = {}) {
  const sentences = splitKoreanSentences(script);
  if (!sentences.length) return [];
  const total = Math.max(1, Number(targetSeconds) || 1);
  const weighted = sentences.map((sentence) => ({
    text: sentence,
    estimatedSeconds: estimateNarrationSeconds(sentence, charsPerSecond),
  }));
  const estimatedTotal = weighted.reduce((sum, item) => sum + item.estimatedSeconds, 0) || 1;
  const scale = total / estimatedTotal;
  const scenes = [];
  let sentenceIndex = 0;
  let localCursor = 0;

  while (localCursor < total - 0.001 && sentenceIndex < weighted.length) {
    const globalCursor = globalStartSeconds + localCursor;
    const inOpening = globalCursor < openingSeconds - 0.001;
    const limit = inOpening
      ? Math.min(openingSceneSeconds, openingSeconds - globalCursor, total - localCursor)
      : Math.min(bodyTargetSeconds, total - localCursor);
    const minLimit = inOpening ? 0.5 : Math.min(bodyMinSeconds, limit);
    const maxLimit = inOpening ? Math.max(0.5, limit) : Math.min(bodyMaxSeconds, total - localCursor);
    const chunk = [];
    let estimated = 0;

    while (sentenceIndex < weighted.length) {
      const next = weighted[sentenceIndex];
      const nextSeconds = next.estimatedSeconds * scale;
      const wouldExceed = chunk.length > 0 && estimated + nextSeconds > maxLimit;
      const hasEnough = estimated >= minLimit;
      if (wouldExceed && hasEnough) break;
      chunk.push(next.text);
      estimated += nextSeconds;
      sentenceIndex += 1;
      if (inOpening && estimated >= limit * 0.75) break;
      if (!inOpening && estimated >= bodyTargetSeconds && chunk.length > 0) break;
    }

    const remaining = total - localCursor;
    const duration = Number(Math.min(remaining, inOpening ? limit : Math.max(minLimit, Math.min(maxLimit, estimated))).toFixed(3));
    const narration = chunk.join(" ").trim();
    scenes.push({
      order: scenes.length + 1,
      startSeconds: Number(localCursor.toFixed(3)),
      endSeconds: Number((localCursor + duration).toFixed(3)),
      globalStartSeconds: Number(globalCursor.toFixed(3)),
      globalEndSeconds: Number((globalCursor + duration).toFixed(3)),
      durationSeconds: duration,
      narration,
      keywords: extractChunkKeywords(narration),
      timingBand: inOpening ? "opening" : "body",
    });
    localCursor += duration;
  }

  if (scenes.length && scenes.at(-1).endSeconds < total) {
    scenes.at(-1).endSeconds = Number(total.toFixed(3));
    scenes.at(-1).globalEndSeconds = Number((globalStartSeconds + total).toFixed(3));
    scenes.at(-1).durationSeconds = Number((scenes.at(-1).endSeconds - scenes.at(-1).startSeconds).toFixed(3));
  }
  return scenes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
node scripts\test_sentence_grounded_visual_timeline.mjs
```

Expected:

```text
test_sentence_grounded_visual_timeline: pass
```

- [ ] **Step 5: Commit**

```powershell
git add scripts/lib/sentence-grounded-visual-timeline.mjs scripts/test_sentence_grounded_visual_timeline.mjs
git commit -m "feat: add sentence-grounded visual timeline builder"
```

If this workspace is not a Git repository, record the changed files in the final implementation report instead of committing.

---

## Task 2: Use Grounded Scenes In Segmented Storyboard Build

**Files:**
- Modify: `scripts/build_segmented_storyboards.mjs`
- Modify: `scripts/lib/segment-plan.mjs`
- Test: `scripts/test_segmented_storyboard_grounded_timeline.mjs`

- [ ] **Step 1: Write the failing integration test**

Create `scripts/test_segmented_storyboard_grounded_timeline.mjs`:

```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = mkdtempSync(join(tmpdir(), "grounded-storyboard-"));
const sourceSlug = "source-grounded";
const slug = "target-grounded";
const sourceDir = join(root, "exports", sourceSlug);
mkdirSync(sourceDir, { recursive: true });

const opening = [
  "??諛ㅼ뿉???ш쾶 ?닿릿 ?ㅼ뿉 臾대꼫吏?留덉쓬??遊낅땲??",
  "?섎━?쇰뒗 ?밸━ ?ㅼ뿉 吏爾ㅼ뒿?덈떎.",
  "遺덉? ?대젮?붿?留?留덉쓬? ?ъ? 紐삵뻽?듬땲??",
  "?щ엺?ㅼ? 寃곌낵留?蹂댁븯?듬땲??",
  "紐몄? 湲댁옣????쾶 ?뚯븘李⑤졇?듬땲??",
  "?묒? ?꾪삊???ш쾶 ?ㅻ졇?듬땲??",
  "洹몃뒗 ?꾨쭩?덉뒿?덈떎.",
  "?꾨쭩? ?앹〈 ?좏샇??듬땲??",
  "?쇱옄媛 ?섍퀬 ?띠뿀?듬땲??",
  "?섎굹?섏? 洹?留덉쓬???뺤즲?섏? ?딆쑝?⑥뒿?덈떎.",
].join(" ");
const body = Array.from({ length: 80 }, (_, index) => (
  `?섎굹?섏? 濡쒕??섎Т ?꾨옒?먯꽌 吏移??щ엺?먭쾶 ?↔낵 臾쇱쓣 二쇱떆硫??뚮났??諛섎났??媛瑜댁튂?⑥뒿?덈떎 ${index + 1}.`
)).join(" ");
writeFileSync(join(sourceDir, "script.txt"), `${opening}\n\n${body}\n`, "utf8");
writeFileSync(join(sourceDir, "production.json"), JSON.stringify({
  project: { title: "?섎━??踰덉븘???뚯뒪?? },
}, null, 2), "utf8");

execFileSync("node", [
  "scripts/build_segmented_storyboards.mjs",
  "--source-slug", sourceSlug,
  "--slug", slug,
  "--target-seconds", "180",
  "--segment-minutes", "10",
  "--skip-script-quality",
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AUTO_VIDEO_ROOT: root,
    AUTO_VIDEO_ALLOW_TEST_BYPASS: "1",
  },
  stdio: "inherit",
});

const segmentDir = join(root, "exports", slug, "segments", "segment-01");
const timeline = JSON.parse(readFileSync(join(segmentDir, "visual-timeline.json"), "utf8"));
const cards = JSON.parse(readFileSync(join(segmentDir, "visual-context-cards.json"), "utf8"));
const storyboard = readFileSync(join(segmentDir, "hermes-manual-storyboard.md"), "utf8");
const report = JSON.parse(readFileSync(join(segmentDir, "visual-grounding-report.json"), "utf8"));

assert.equal(timeline.scenes.length, cards.scenes.length);
assert.equal((storyboard.match(/^\[/gm) || []).length, timeline.scenes.length);
assert.equal(timeline.scenes.filter((scene) => scene.timingBand === "opening").length, 10);
assert.ok(timeline.scenes.filter((scene) => scene.timingBand === "body").every((scene, index, arr) => (
  scene.durationSeconds >= 20 || index === arr.length - 1
)));
assert.ok(timeline.scenes.filter((scene) => scene.timingBand === "body").every((scene) => scene.durationSeconds <= 40.5));
assert.ok(report.scenes.every((scene) => scene.narration && scene.keywords.length > 0));
assert.ok(storyboard.includes("濡쒕?") || storyboard.includes("broom tree"));

console.log("test_segmented_storyboard_grounded_timeline: pass");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node scripts\test_segmented_storyboard_grounded_timeline.mjs
```

Expected:

```text
ENOENT: no such file or directory, open ... visual-grounding-report.json
```

or an assertion failure because the old fixed timeline does not mark 10 opening scenes.

- [ ] **Step 3: Make the storyboard builder test-root aware**

In `scripts/build_segmented_storyboards.mjs`, replace:

```js
const root = "C:/Users/petbl/auto-video";
```

with:

```js
const root = process.env.AUTO_VIDEO_ROOT || "C:/Users/petbl/auto-video";
```

- [ ] **Step 4: Modify segment plan to stop freezing scene count**

In `scripts/lib/segment-plan.mjs`, keep `sceneCount` for compatibility but rename its meaning in returned objects:

```js
const estimatedSceneCount = deriveSceneCountForWindow({
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
  estimatedSceneCount,
  sceneCount: estimatedSceneCount,
});
```

- [ ] **Step 5: Replace fixed scene splitting in storyboard builder**

In `scripts/build_segmented_storyboards.mjs`, add import:

```js
import { buildSentenceGroundedVisualTimeline } from "./lib/sentence-grounded-visual-timeline.mjs";
```

Replace:

```js
const segmentSceneTexts = splitSegmentScriptIntoScenes(segmentScript, segment.sceneCount);
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
```

with:

```js
const groundedScenes = buildSentenceGroundedVisualTimeline({
  script: segmentScript,
  targetSeconds: segment.durationSeconds,
  globalStartSeconds: segment.startSeconds,
  openingSeconds: segmentPlan.introSeconds,
  openingSceneSeconds: segmentPlan.introSceneSeconds,
  bodyMinSeconds: 20,
  bodyTargetSeconds: segmentPlan.bodySceneSeconds,
  bodyMaxSeconds: 40,
  charsPerSecond: targetCharsPerSecond,
});
if (!groundedScenes.length) {
  throw new Error(`${segment.id}: sentence-grounded visual timeline produced no scenes`);
}
const segmentSceneTexts = groundedScenes.map((scene) => scene.narration);
const visualTimeline = groundedScenes.map((scene) => ({
  order: scene.order,
  startSeconds: scene.startSeconds,
  endSeconds: scene.endSeconds,
  durationSeconds: scene.durationSeconds,
  timingBand: scene.timingBand,
  keywords: scene.keywords,
}));
segment.sceneCount = groundedScenes.length;
```

- [ ] **Step 6: Write visual grounding report**

After writing `visual-timeline.json`, add:

```js
writeFileSync(join(segmentDir, "visual-grounding-report.json"), JSON.stringify({
  version: 1,
  segmentId: segment.id,
  globalStartSeconds: segment.startSeconds,
  targetSeconds: segment.durationSeconds,
  sceneCount: groundedScenes.length,
  openingSceneCount: groundedScenes.filter((scene) => scene.timingBand === "opening").length,
  bodySceneCount: groundedScenes.filter((scene) => scene.timingBand === "body").length,
  scenes: groundedScenes.map((scene) => ({
    order: scene.order,
    startSeconds: scene.startSeconds,
    endSeconds: scene.endSeconds,
    durationSeconds: scene.durationSeconds,
    timingBand: scene.timingBand,
    keywords: scene.keywords,
    narration: scene.narration,
    estimatedCharsPerSecond: Number((scene.narration.replace(/\s/g, "").length / Math.max(0.5, scene.durationSeconds)).toFixed(3)),
  })),
}, null, 2), "utf8");
```

- [ ] **Step 7: Recalculate actual total scene count**

Before writing `production.json` and `segment-manifest.json`, add:

```js
const actualTotalSceneCount = segmentRecords.reduce((sum, record) => sum + Number(record.sceneCount || 0), 0);
```

Then replace every export-level use of `segmentPlan.totalSceneCount` with `actualTotalSceneCount` in `production.json`, `segment-manifest.json` if present, and the final `console.log()` payload:

```js
totalSceneCount: actualTotalSceneCount,
```

- [ ] **Step 8: Run integration test to verify it passes**

Run:

```powershell
node scripts\test_segmented_storyboard_grounded_timeline.mjs
```

Expected:

```text
test_segmented_storyboard_grounded_timeline: pass
```

- [ ] **Step 9: Commit**

```powershell
git add scripts/build_segmented_storyboards.mjs scripts/lib/segment-plan.mjs scripts/test_segmented_storyboard_grounded_timeline.mjs
git commit -m "feat: build storyboards from sentence-grounded visual scenes"
```

---

## Task 3: Grounding Gate Before Render

**Files:**
- Create: `scripts/check_visual_grounding_timeline.mjs`
- Test: `scripts/test_visual_grounding_timeline_gate.mjs`
- Modify: `scripts/validate_segmented_export.py`

- [ ] **Step 1: Write failing gate test**

Create `scripts/test_visual_grounding_timeline_gate.mjs`:

```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = mkdtempSync(join(tmpdir(), "visual-grounding-gate-"));
const segmentDir = join(root, "segments", "segment-01");
mkdirSync(segmentDir, { recursive: true });

writeFileSync(join(segmentDir, "visual-timeline.json"), JSON.stringify({
  scenes: [
    { order: 1, startSeconds: 0, endSeconds: 6, durationSeconds: 6, timingBand: "opening", keywords: ["?덉쭊", "?밸━ ?댄썑"] },
    { order: 2, startSeconds: 6, endSeconds: 46, durationSeconds: 40, timingBand: "body", keywords: ["濡쒕??섎Т"] },
  ],
}, null, 2), "utf8");
writeFileSync(join(segmentDir, "visual-context-cards.json"), JSON.stringify({
  scenes: [
    { order: 1, requirements: { requiredPromptTerms: ["exhaustion", "collapse after victory"], sourceAnchors: ["?덉쭊", "?밸━ ?댄썑"] } },
    { order: 2, requirements: { requiredPromptTerms: ["broom tree"], sourceAnchors: ["濡쒕??섎Т"] } },
  ],
}, null, 2), "utf8");
writeFileSync(join(segmentDir, "visual-grounding-report.json"), JSON.stringify({
  scenes: [
    { order: 1, timingBand: "opening", durationSeconds: 6, narration: "?밸━ ?댄썑 ?덉쭊??留덉쓬??議곗슜??臾대꼫議뚯뒿?덈떎.", keywords: ["?덉쭊", "?밸━ ?댄썑"] },
    { order: 2, timingBand: "body", durationSeconds: 40, narration: "濡쒕??섎Т ?꾨옒?먯꽌 ?ъ뿀?듬땲??", keywords: ["濡쒕??섎Т"] },
  ],
}, null, 2), "utf8");
writeFileSync(join(segmentDir, "hermes-manual-storyboard.md"), [
  "[?섎━?쇰뒗 吏爾ㅼ뒿?덈떎.]",
  "exhaustion after victory, collapse after sustained effort, a small figure only in the distance, strict pure black and white / wide shot / moonlight / calm / slow pan / duration:6",
  "",
  "[濡쒕??섎Т ?꾨옒?먯꽌 ?ъ뿀?듬땲??]",
  "broom tree in wilderness, exhausted Elijah resting, strict pure black and white / wide shot / dawn / tender / slow pan / duration:40",
  "",
].join("\n"), "utf8");

execFileSync("node", ["scripts/check_visual_grounding_timeline.mjs", "--segment-dir", segmentDir], { stdio: "inherit" });

writeFileSync(join(segmentDir, "hermes-manual-storyboard.md"), [
  "[?섎━?쇰뒗 吏爾ㅼ뒿?덈떎.]",
  "Elijah standing alone as a generic biblical character portrait, strict pure black and white / wide shot / moonlight / calm / slow pan / duration:6",
  "",
  "[濡쒕??섎Т ?꾨옒?먯꽌 ?ъ뿀?듬땲??]",
  "generic desert landscape, strict pure black and white / wide shot / dawn / tender / slow pan / duration:40",
  "",
].join("\n"), "utf8");

let failed = false;
try {
  execFileSync("node", ["scripts/check_visual_grounding_timeline.mjs", "--segment-dir", segmentDir], { stdio: "pipe" });
} catch {
  failed = true;
}
assert.equal(failed, true, "generic prompts must fail grounding gate");

console.log("test_visual_grounding_timeline_gate: pass");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node scripts\test_visual_grounding_timeline_gate.mjs
```

Expected:

```text
Error: Cannot find module ... check_visual_grounding_timeline.mjs
```

- [ ] **Step 3: Implement gate script**

Create `scripts/check_visual_grounding_timeline.mjs`:

```js
#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scorePromptContextAlignment } from "./lib/scene-context-card.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.segmentDir) {
  console.error("Usage: node scripts/check_visual_grounding_timeline.mjs --segment-dir <segment-dir>");
  process.exit(2);
}

const timelinePath = join(args.segmentDir, "visual-timeline.json");
const cardsPath = join(args.segmentDir, "visual-context-cards.json");
const groundingPath = join(args.segmentDir, "visual-grounding-report.json");
const storyboardPath = join(args.segmentDir, "hermes-manual-storyboard.md");
for (const path of [timelinePath, cardsPath, groundingPath, storyboardPath]) {
  if (!existsSync(path)) throw new Error(`Missing ${path}`);
}

const timeline = JSON.parse(readFileSync(timelinePath, "utf8")).scenes || [];
const cards = JSON.parse(readFileSync(cardsPath, "utf8")).scenes || [];
const grounding = JSON.parse(readFileSync(groundingPath, "utf8")).scenes || [];
const prompts = parseStoryboard(readFileSync(storyboardPath, "utf8"));
const failures = [];

if (timeline.length !== cards.length) failures.push(`timeline/card count mismatch:${timeline.length}/${cards.length}`);
if (timeline.length !== grounding.length) failures.push(`timeline/grounding count mismatch:${timeline.length}/${grounding.length}`);
if (timeline.length !== prompts.length) failures.push(`timeline/storyboard count mismatch:${timeline.length}/${prompts.length}`);

const scenes = timeline.map((scene, index) => {
  const card = cards[index] || {};
  const prompt = prompts[index]?.prompt || "";
  const score = scorePromptContextAlignment({ card, prompt });
  const sceneFailures = [...score.failures];
  if (scene.timingBand === "opening" && scene.durationSeconds > 6.5) {
    sceneFailures.push(`opening_duration_too_long:${scene.durationSeconds}`);
  }
  if (scene.timingBand === "body" && index < timeline.length - 1) {
    if (scene.durationSeconds < 20) sceneFailures.push(`body_duration_too_short:${scene.durationSeconds}`);
    if (scene.durationSeconds > 40.5) sceneFailures.push(`body_duration_too_long:${scene.durationSeconds}`);
  }
  const keywordHits = (scene.keywords || []).filter((keyword) => (
    prompt.toLowerCase().includes(String(keyword).toLowerCase())
  ));
  const keywordHitRatio = (scene.keywords || []).length
    ? keywordHits.length / scene.keywords.length
    : 1;
  if ((scene.keywords || []).length >= 2 && keywordHitRatio < 0.25) {
    sceneFailures.push(`low_chunk_keyword_coverage:${keywordHitRatio.toFixed(2)}:${scene.keywords.join("|")}`);
  }
  if (sceneFailures.length) failures.push(`scene_${index + 1}:${sceneFailures.join(",")}`);
  return {
    order: scene.order || index + 1,
    timingBand: scene.timingBand,
    durationSeconds: scene.durationSeconds,
    keywords: scene.keywords || [],
    prompt,
    score: score.score,
    ok: sceneFailures.length === 0,
    failures: sceneFailures,
  };
});

const report = {
  ok: failures.length === 0,
  segmentDir: args.segmentDir,
  sceneCount: timeline.length,
  failures,
  scenes,
};
writeFileSync(join(args.segmentDir, "visual-grounding-timeline-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: report.ok, sceneCount: report.sceneCount, failures }, null, 2));
process.exit(report.ok ? 0 : 1);

function parseStoryboard(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const label = lines[index].trim();
    if (!/^\[.*\]$/.test(label)) continue;
    const promptLine = String(lines[index + 1] || "").trim();
    blocks.push({ label, prompt: promptLine.split(/\s+\/\s+/)[0] || promptLine });
  }
  return blocks;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--segment-dir") parsed.segmentDir = argv[++index];
  }
  return parsed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
node scripts\test_visual_grounding_timeline_gate.mjs
```

Expected:

```text
test_visual_grounding_timeline_gate: pass
```

- [ ] **Step 5: Replace old fixed-duration validation and integrate gate into validation**

In `scripts/validate_segmented_export.py`, replace the existing `segment_id == "segment-01"` block that requires `durations[:10] == [6.0] * 10` and every body duration to be exactly `30.0` with timing-band validation:

```python
if segment_id == "segment-01":
    opening_scenes = [scene for scene in timeline_scenes if scene.get("timingBand") == "opening"]
    body_scenes = [scene for scene in timeline_scenes if scene.get("timingBand") == "body"]
    if len(opening_scenes) != 10:
        failures.append(f"segment-01: expected 10 opening visual scenes, got {len(opening_scenes)}")
    for scene in opening_scenes:
        duration = float(scene.get("durationSeconds", 0) or 0)
        if duration > 6.5:
            failures.append(
                f"segment-01: opening scene {scene.get('order')} duration {duration:.3f}s exceeds 6.5s"
            )
    for index, scene in enumerate(body_scenes):
        duration = float(scene.get("durationSeconds", 0) or 0)
        is_last_body_scene = index == len(body_scenes) - 1
        if not is_last_body_scene and duration < 20:
            failures.append(
                f"segment-01: body scene {scene.get('order')} duration {duration:.3f}s is below 20s"
            )
        if duration > 40.5:
            failures.append(
                f"segment-01: body scene {scene.get('order')} duration {duration:.3f}s exceeds 40.5s"
            )
```

Then, after checking `storyboard-context-alignment-report.json`, add a file presence check:

```python
grounding_report = segment_dir / "visual-grounding-timeline-report.json"
if not grounding_report.exists():
    warnings.append(f"{segment_id}: visual-grounding-timeline-report.json not generated yet")
else:
    try:
        grounding = json.loads(grounding_report.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        failures.append(f"{segment_id}: visual-grounding-timeline-report.json is not valid JSON")
    else:
        if not grounding.get("ok"):
            failures.append(f"{segment_id}: visual grounding timeline failed")
```

- [ ] **Step 6: Commit**

```powershell
git add scripts/check_visual_grounding_timeline.mjs scripts/test_visual_grounding_timeline_gate.mjs scripts/validate_segmented_export.py
git commit -m "feat: gate visual timeline grounding before render"
```

---

## Task 4: Run Grounding Gates From Storyboard Build

**Files:**
- Modify: `scripts/build_segmented_storyboards.mjs`
- Test: `scripts/test_segmented_storyboard_grounded_timeline.mjs`

- [ ] **Step 1: Extend failing integration assertion**

Add this assertion to `scripts/test_segmented_storyboard_grounded_timeline.mjs`:

```js
const groundingTimelineReport = JSON.parse(readFileSync(join(segmentDir, "visual-grounding-timeline-report.json"), "utf8"));
assert.equal(groundingTimelineReport.ok, true);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node scripts\test_segmented_storyboard_grounded_timeline.mjs
```

Expected:

```text
ENOENT: no such file or directory, open ... visual-grounding-timeline-report.json
```

- [ ] **Step 3: Run gates after writing storyboard**

In `scripts/build_segmented_storyboards.mjs`, import:

```js
import { execFileSync } from "node:child_process";
```

After writing `hermes-manual-storyboard.md`, `visual-context-cards.json`, `visual-timeline.json`, and `visual-grounding-report.json`, add:

```js
execFileSync("node", [
  join("scripts", "check_storyboard_context_alignment.mjs"),
  "--segment-dir",
  segmentDir,
], { stdio: "inherit" });
execFileSync("node", [
  join("scripts", "check_visual_grounding_timeline.mjs"),
  "--segment-dir",
  segmentDir,
], { stdio: "inherit" });
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
node scripts\test_segmented_storyboard_grounded_timeline.mjs
```

Expected:

```text
test_segmented_storyboard_grounded_timeline: pass
```

- [ ] **Step 5: Commit**

```powershell
git add scripts/build_segmented_storyboards.mjs scripts/test_segmented_storyboard_grounded_timeline.mjs
git commit -m "feat: run visual grounding gates during storyboard build"
```

---

## Task 5: Add Context-First Biblical Visual Focus Rules

**Files:**
- Modify: `scripts/lib/scene-context-card.mjs`
- Test: `scripts/check_scene_context_card.mjs`

- [ ] **Step 1: Extend the existing scene context card check**

In `scripts/check_scene_context_card.mjs`, add assertions that an Elijah burnout narration produces concrete sentence-context requirements without making the person the only visual focus:

```js
const elijahCard = buildSceneContextCard({
  narration: "?섎━?쇰뒗 媛덈찞?곗쓽 ?밸━ ?ㅼ뿉 濡쒕??섎Т ?꾨옒?먯꽌 吏爾??곕윭議뚭퀬, ?몃젟?먯꽌 ?몃????뚮━瑜??ㅼ뿀?듬땲??",
  order: 99,
  topic: "?섎━?쇰뒗 ???밸━???ㅼ뿉 臾대꼫議뚯쓣源?| 踰덉븘?껉낵 ?몃줈????щ━",
});
assert.ok(elijahCard.biblicalCharacters.includes("Elijah"));
assert.ok(elijahCard.visualAnchor.includes("broom tree") || elijahCard.visualAnchor.includes("Horeb") || elijahCard.visualAnchor.includes("Carmel"));
assert.ok(elijahCard.visualFocus);
assert.equal(elijahCard.visualFocus.mode, "context_anchor");
assert.ok(elijahCard.visualFocus.primaryTerms.some((term) => /broom tree|Horeb|Carmel|exhaustion|still small voice/i.test(term)));
assert.ok(elijahCard.requirements.requiredPromptTerms.some((term) => /broom tree|Horeb|Carmel|exhaustion|still small voice/i.test(term)));
assert.ok(
  !elijahCard.requirements.requiredPromptTerms.includes("Elijah")
  || elijahCard.requirements.requiredPromptTerms.indexOf("Elijah") > 0
);
const elijahPrompt = compileContextPrompt(elijahCard);
assert.ok(/broom tree|Horeb|Carmel|exhaustion|still small voice/i.test(elijahPrompt));
assert.ok(!/^Elijah\b/i.test(elijahPrompt), "prompt must not begin as a character portrait when concrete context anchors exist");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node scripts\check_scene_context_card.mjs
```

Expected:

```text
AssertionError: elijahCard.visualFocus
```

- [ ] **Step 3: Add visual focus helper**

In `scripts/lib/scene-context-card.mjs`, add this helper near the existing rule helpers:

```js
function buildVisualFocus({ text, biblicalCharacters = [], details = [], psychology = null, event = "" }) {
  const primaryTerms = [];
  for (const detail of details) {
    if (primaryTerms.length >= 4) break;
    if (detail && !primaryTerms.includes(detail)) primaryTerms.push(detail);
  }
  for (const object of psychology?.objects || []) {
    if (primaryTerms.length >= 5) break;
    if (object && !primaryTerms.includes(object)) primaryTerms.push(object);
  }
  for (const required of psychology?.required || []) {
    if (primaryTerms.length >= 6) break;
    if (required && !primaryTerms.includes(required)) primaryTerms.push(required);
  }
  if (/?몃????뚮━|?묒? ?뚮━|still small voice/i.test(text) && !primaryTerms.includes("still small voice")) {
    primaryTerms.unshift("still small voice");
  }
  if (/濡쒕??섎Т|broom tree/i.test(text) && !primaryTerms.includes("solitary broom tree in a barren wilderness")) {
    primaryTerms.unshift("solitary broom tree in a barren wilderness");
  }
  if (/?몃젟|horeb/i.test(text) && !primaryTerms.includes("Horeb mountain cave")) {
    primaryTerms.unshift("Horeb mountain cave");
  }
  if (/媛덈찞|carmel/i.test(text) && !primaryTerms.includes("Mount Carmel ridge")) {
    primaryTerms.unshift("Mount Carmel ridge");
  }
  const hasConcreteAnchor = primaryTerms.length > 0;
  return {
    mode: hasConcreteAnchor ? "context_anchor" : "character_context",
    primaryTerms: hasConcreteAnchor ? primaryTerms.slice(0, 6) : biblicalCharacters.slice(0, 2),
    secondaryCharacters: biblicalCharacters,
    event,
  };
}
```

When constructing the card object, call it after details, psychology, characters, and event have been inferred:

```js
const visualFocus = buildVisualFocus({
  text,
  biblicalCharacters,
  details: concreteDetails,
  psychology,
  event: biblicalEvent,
});
```

Add `visualFocus` to the returned card.

- [ ] **Step 4: Add character and psychology rules**

In `scripts/lib/scene-context-card.mjs`, extend `CHARACTER_RULES`:

```js
  { re: /?섎━??elijah/i, value: "Elijah" },
  { re: /?붿뀎|joseph/i, value: "Joseph" },
  { re: /?ㅼ쐵|david/i, value: "David" },
  { re: /紐⑥꽭|moses/i, value: "Moses" },
  { re: /?댁꽭踰?jezebel/i, value: "Jezebel" },
```

Extend `PSYCHOLOGY_RULES`:

```js
  {
    re: /踰덉븘???덉쭊|吏移??뚯쭊|臾대꼫|?몃줈?|burnout|exhaustion|loneliness/i,
    concept: "burnout, loneliness, and collapse after sustained effort",
    emotion: "deeply tired, isolated, and quietly longing for comfort",
    objects: ["broom tree", "charcoal bread", "desert ground"],
    required: ["burnout", "exhaustion", "loneliness"],
  },
```

- [ ] **Step 5: Add Elijah concrete detail lexicon entries**

In `DETAIL_LEXICON`, add:

```js
  [/濡쒕??섎Т|broom tree/i, "solitary broom tree in a barren wilderness"],
  [/??텋|??charcoal/i, "glowing charcoal embers on desert ground"],
  [/?몃젟|?쒕궡??horeb|sinai/i, "vast mountain face under open sky"],
  [/媛덈찞|媛덈찞??carmel/i, "Mount Carmel ridge beneath a dramatic sky"],
  [/?몃????뚮━|?묒? ?뚮━|still small voice/i, "quiet mountain cave opening in still air"],
  [/?댁꽭踰?jezebel/i, "threatening shadow cast across a distant path"],
```


- [ ] **Step 6: Add Elijah event inference**

In `inferBiblicalEvent(text)`, add these cases before the default return:

```js
  if (/媛덈찞|媛덈찞??carmel/i.test(text)) return "Elijah after the victory on Mount Carmel";
  if (/濡쒕??섎Т|broom tree/i.test(text)) return "Elijah resting under the broom tree in the wilderness";
  if (/?몃젟|?몃????뚮━|still small voice|horeb/i.test(text)) return "God speaking to Elijah in a still small voice at Horeb";
  if (/?댁꽭踰?jezebel/i.test(text)) return "Elijah fleeing after Jezebel's threat";
  if (/?섎━??elijah/i.test(text)) return "Elijah in the wilderness after the great victory";
```

- [ ] **Step 7: Make prompt compilation lead with visual focus**

In `compileContextPrompt(card)`, build the leading phrase from `card.visualFocus.primaryTerms` before adding character metadata. If the current implementation starts with a subject like `"Elijah"` or `"a lone biblical figure"`, replace that lead with:

```js
const focusTerms = card.visualFocus?.primaryTerms || [];
const characterContext = (card.visualFocus?.secondaryCharacters || card.biblicalCharacters || []).join(", ");
const leadSubject = focusTerms.length
  ? focusTerms.join(", ")
  : (characterContext || "quiet biblical inner-life moment");
```

Then use `leadSubject` as the first prompt segment. Keep `characterContext` afterward in the prompt only as context:

```js
if (characterContext && focusTerms.length) {
  parts.push(`biblical context: ${characterContext}`);
}
```

- [ ] **Step 8: Make required terms context-first**

When building `requirements.requiredPromptTerms`, include `visualFocus.primaryTerms` first, then add at most one character term only if there is no concrete anchor:

```js
const requiredPromptTerms = [
  ...(visualFocus.primaryTerms || []),
  ...psychology.required,
];
if (requiredPromptTerms.length === 0 && biblicalCharacters[0]) {
  requiredPromptTerms.push(biblicalCharacters[0]);
}
```

This means an Elijah scene about `濡쒕??섎Т`, `?몃젟`, `?몃????뚮━`, `?덉쭊`, or `??텋` is validated against those concrete terms instead of being validated primarily against the word `Elijah`.

- [ ] **Step 9: Run test to verify it passes**

Run:

```powershell
node scripts\check_scene_context_card.mjs
```

Expected:

```text
check_scene_context_card: pass
```

- [ ] **Step 10: Commit**

```powershell
git add scripts/lib/scene-context-card.mjs scripts/check_scene_context_card.mjs
git commit -m "feat: ground biblical visuals in sentence context"
```

---

## Task 6: Update Documentation And Operational Commands

**Files:**
- Modify: `auto-video.md`
- Modify: `docs/agent-handoff-contract.md`

- [ ] **Step 1: Update visual timing rule in `auto-video.md`**

Add this rule near the visual context-card section:

```markdown
## Sentence-grounded visual timing

- The first global 60 seconds must use about 10 visual scenes, normally 6 seconds each.
- After the first 60 seconds, visual scenes must be built from sentence-bound narration chunks of 20-40 seconds, target 30 seconds.
- Prompts must be generated from the exact narration chunk assigned to the visual scene.
- Prompts must lead with the chunk's concrete context anchors and psychological keywords, not with a repeated character portrait.
- Biblical character names are secondary context unless the current sentence is specifically about that person's visible action or expression.
- Do not generate prompts from chapter summaries when final script chunks already exist.
- Render is blocked unless `storyboard-context-alignment-report.json` and `visual-grounding-timeline-report.json` are both `ok:true`.
- `build_segmented_storyboards.mjs` uses `5.2` chars/sec by default for sleep narration pacing. Use `--target-chars-per-second 6.8` only for intentionally faster information-heavy videos.
```

- [ ] **Step 2: Update handoff contract**

In `docs/agent-handoff-contract.md`, add:

```markdown
| `visual-grounding-report.json` | 鍮꾩＜???꾨＼?꾪듃 ?먯씠?꾪듃 | QA/?뚮뜑 ?먯씠?꾪듃 | ?ㅼ젣 visual scene蹂?narration, keywords, timingBand, durationSeconds |
| `visual-grounding-timeline-report.json` | ?꾨＼?꾪듃 QA | ?뚮뜑 ?먯씠?꾪듃 | `ok:true`, scene count parity, opening/body duration contract, prompt grounding failures |
```

Add a plain-language distinction below the table:

```markdown
`visual-grounding-report.json` is the build artifact: it records what each visual scene is supposed to represent.
`visual-grounding-timeline-report.json` is the gate artifact: it records whether those visual scenes, prompts, and durations passed validation.
```

- [ ] **Step 3: Verify doc references**

Run:

```powershell
rg -n "Sentence-grounded visual timing|visual-grounding-report|visual-grounding-timeline-report" auto-video.md docs\agent-handoff-contract.md
```

Expected:

```text
auto-video.md:...
docs\agent-handoff-contract.md:...
```

- [ ] **Step 4: Commit**

```powershell
git add auto-video.md docs/agent-handoff-contract.md
git commit -m "docs: document sentence-grounded visual timing contract"
```

---

## Task 7: Verify Against The Elijah Export Pattern

**Files:**
- No production file changes expected.
- Uses existing export:
  - `exports/gguljam-bible-elijah-burnout-loneliness-20min-001`

- [ ] **Step 1: Rebuild storyboards for an Elijah test slug**

Run:

```powershell
node scripts\build_segmented_storyboards.mjs `
  --source-slug gguljam-bible-elijah-burnout-loneliness-20min-001 `
  --slug gguljam-bible-elijah-grounded-visual-test `
  --target-seconds 1200 `
  --segment-minutes 15
```

Expected:

```text
{
  "exportDir": "...gguljam-bible-elijah-grounded-visual-test",
  "segmentCount": 2,
  ...
}
```

- [ ] **Step 2: Inspect first segment timing**

Run:

```powershell
node -e "const fs=require('fs'); const p='exports/gguljam-bible-elijah-grounded-visual-test/segments/segment-01/visual-grounding-report.json'; const r=JSON.parse(fs.readFileSync(p,'utf8')); console.log({sceneCount:r.sceneCount, opening:r.openingSceneCount, bodySceneCount:r.bodySceneCount, first:r.scenes.slice(0,3), firstBodyScene:r.scenes.find(s=>s.timingBand==='body')});"
```

Expected:

```text
opening: 10
body.durationSeconds between 20 and 40
```

- [ ] **Step 3: Run visual gates**

Run:

```powershell
node scripts\check_scene_prompt_diversity.mjs --export-dir exports\gguljam-bible-elijah-grounded-visual-test
python scripts\validate_segmented_export.py --export-dir exports\gguljam-bible-elijah-grounded-visual-test
```

Expected:

```text
ok / no failures
```

- [ ] **Step 4: Confirm mismatch class is gone**

Run:

```powershell
node -e "const fs=require('fs'); const p='exports/gguljam-bible-elijah-grounded-visual-test/segments/segment-01/visual-grounding-report.json'; const r=JSON.parse(fs.readFileSync(p,'utf8')); for (const s of r.scenes.slice(0,12)) console.log(s.order, s.durationSeconds, s.keywords.join(','), s.narration.slice(0,70));"
```

Expected:

- First 10 scenes are short and closely follow opening sentences.
- Scenes after the opening are 20-40 second chunks.
- Keywords shown for each scene visibly come from that scene's narration.

---

## Final Verification

Run:

```powershell
node scripts\test_sentence_grounded_visual_timeline.mjs
node scripts\test_segmented_storyboard_grounded_timeline.mjs
node scripts\test_visual_grounding_timeline_gate.mjs
node scripts\check_scene_context_card.mjs
node scripts\test_scene_prompt_diversity_gate.mjs
node --check scripts\build_segmented_storyboards.mjs
node --check scripts\check_visual_grounding_timeline.mjs
python scripts\validate_segmented_export.py --export-dir exports\gguljam-bible-elijah-grounded-visual-test
```

Expected:

- All Node tests print `pass`.
- `node --check` prints no errors.
- segmented validation reports no failures.

---

## Self-Review

Spec coverage:

- First 1 minute around 10 images: Task 1 and Task 2 enforce 10 opening scenes at about 6 seconds each.
- Each image reflects sentence context/key keywords: Task 1 extracts keywords from the exact chunk; Task 2 builds cards/prompts from the exact chunk; Task 3 gates prompt coverage.
- Remaining duration uses 20-40 second chunks: Task 1 builder and Task 3 gate enforce body duration.
- Existing image mismatch root cause addressed: Task 2 removes fixed scene-count/even chunking.
- Render blocked on mismatch: Task 3 and Task 4 add pre-render gates.
- Analysis critical items covered: Task 2 adds `AUTO_VIDEO_ROOT`, test bypass env, actual total scene count, and 5.2 chars/sec; Task 3 replaces the old fixed 30-second validator rule.
- Context-first visual grounding covered: Task 5 keeps biblical character recognition as metadata while making concrete anchors, psychology, places, objects, and actions lead the prompt and gate requirements.
- Report naming risk covered: Task 6 documents build report versus gate report responsibilities.

Marker scan:

- No unfinished implementation markers or unspecified implementation steps.
- All new functions named in tasks have definitions.
- All commands include expected outcomes.

Type consistency:

- `buildSentenceGroundedVisualTimeline()` returns scene objects with `narration`, `durationSeconds`, `timingBand`, and `keywords`.
- `visual-grounding-report.json` and `visual-grounding-timeline-report.json` use the same field names.
- `build_segmented_storyboards.mjs` writes `visual-timeline.json` with `timingBand` and `keywords`, while storyboard generation still consumes `durationSeconds`.
- `segment.sceneCount`, `production.totalSceneCount`, and final console output all use actual grounded scene counts after Task 2.
