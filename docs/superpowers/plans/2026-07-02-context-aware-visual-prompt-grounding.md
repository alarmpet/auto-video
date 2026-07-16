# Context-Aware Visual Prompt Grounding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every generated image prompt visibly grounded in the exact narration context, core keyword, emotional beat, biblical character/event, and modern psychology concept of its paired script text.

**Architecture:** Replace index-rotated motif prompts with a scene-context-card layer. Each narration scene becomes a structured context card, but the card must be composed dynamically from the sentence's character, place, action, emotion, and psychology cues instead of returning one hardcoded visual anchor. Storyboard prompts are compiled from that card, then a separate alignment checker compares the prompt against source-derived requirements so the QA gate does not merely validate its own generated text.

**Tech Stack:** Node.js ESM scripts, deterministic Korean text rules, Hermes manual storyboard format, `visual-timeline.json`, existing auto-video builders, optional future CLIPScore/BLIP/SentenceTransformer image-level QA.

---

## Review Validation

The review report at `C:\Users\petbl\auto-video\docs\superpowers\plans\2026-07-02-context-aware-visual-prompt-grounding-review-report.md` is partially valid.

Accepted findings:

- The original plan's direction was correct: `script scene -> context card -> prompt -> alignment report -> render`.
- The first draft still risked visual repetition because `PSYCHOLOGY_RULES` returned fixed anchors such as "Jacob beside an oil lamp" for many scenes.
- The alignment checker was too self-referential if it only checked whether terms from the generated context card appeared in the generated prompt.
- Korean keyword extraction needs a lightweight particle cleaner so keywords do not become noisy fragments.

Deferred finding:

- The review's warning about static `duration:6` and `duration:30` versus actual TTS timing is technically real, but it belongs to the timeline/audio-sync plans already handled by `visual-timeline.json`, `/ duration:X`, and assembly scaling. This plan will preserve timeline duration tags but will not redesign audio timing.

Rejected/adjusted finding:

- Do not add CLIPScore, BLIP, or SentenceTransformers as required dependencies in this pass. They are useful later, but the first fix should be deterministic, fast, and runnable without a new GPU/Python model stack.

## Current Verified Code Reality

- `C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs` still uses `motifBank` and `chooseMotif(index, segmentIndex)`.
- `C:\Users\petbl\auto-video\scripts\build_jacob_20min_sample_export.mjs` still rotates a fixed `motifs` array inside `buildStoryboard()`.
- `C:\Users\petbl\auto-video\scripts\build_gguljam_20min_sample_export.mjs` has the same sample-builder pattern.
- Hermes has useful reference components such as `context-match`, `storyboard-agent`, and `visual-memory`, but the auto-video storyboard builders currently generate prompt text before a strong source-grounded context layer exists.

## Target Contract

Each scene must produce a context card like this before a prompt is written:

```json
{
  "order": 1,
  "narration": "야곱은 사랑받고 있었지만, 마음 깊은 곳에서는 아직 선택받지 못한 사람처럼 숨고 있었습니다.",
  "requirements": {
    "sourceAnchors": ["야곱", "사랑", "선택", "불안"],
    "requiredPromptTerms": ["Jacob", "recognition anxiety", "family tent"],
    "negativePromptTerms": ["color tint", "readable text", "modern clothing"]
  },
  "contextCard": {
    "biblicalCharacters": ["Jacob"],
    "biblicalEvent": "Jacob inside Isaac's family conflict",
    "psychologyConcept": "need for recognition and comparison anxiety",
    "emotion": "loved but insecure",
    "setting": "inside an ancient family tent",
    "posture": "hands folded anxiously, posture showing hesitation",
    "action": "quietly sitting apart from the family center",
    "visualAnchor": "Jacob inside an ancient family tent, hands folded anxiously, quietly sitting apart from the family center",
    "symbolicObjects": ["oil lamp", "family tent", "empty sleeping mat"],
    "avoid": ["generic desert only", "random prophet portrait", "readable text", "modern clothing", "color tint"]
  },
  "prompt": "Jacob inside an ancient family tent, hands folded anxiously, quietly sitting apart from the family center, oil lamp and empty sleeping mat nearby, need for recognition and comparison anxiety expressed through posture, loved but insecure mood, strict pure black and white grayscale biblical oil painting..."
}
```

The important change is that `visualAnchor` is not a fixed string selected by one psychology rule. It is composed from character + setting + posture + action + object + emotion.

## File Structure

- Create: `C:\Users\petbl\auto-video\scripts\lib\scene-context-card.mjs`
  - Extracts scene context from Korean narration.
  - Builds dynamic visual anchors by combining character, setting, posture, action, emotion, psychology, and symbolic objects.
  - Exposes scoring helpers that compare prompt text against both generated cards and source-derived requirements.

- Create: `C:\Users\petbl\auto-video\scripts\check_scene_context_card.mjs`
  - Unit smoke test for Korean extraction, dynamic anchors, prompt compilation, and anti-generic scoring.

- Create: `C:\Users\petbl\auto-video\scripts\check_storyboard_context_alignment.mjs`
  - Validates `hermes-manual-storyboard.md` against `visual-context-cards.json`.
  - Writes `storyboard-context-alignment-report.json`.
  - Fails if prompt misses source-required anchors or violates negative constraints.

- Modify: `C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs`
  - Stops using `chooseMotif()` for the final image prompt.
  - Writes `visual-context-cards.json` per segment.
  - Uses context-card prompt compilation while preserving `/ duration:X` from `visual-timeline.json`.

- Modify: `C:\Users\petbl\auto-video\scripts\build_jacob_20min_sample_export.mjs`
  - Uses the same context-card pipeline as the segmented builder.

- Modify: `C:\Users\petbl\auto-video\scripts\build_gguljam_20min_sample_export.mjs`
  - Uses the same context-card pipeline as the segmented builder.

- Modify: `C:\Users\petbl\auto-video\auto-video.md`
  - Documents that visual prompts must be context-card grounded and pass alignment QA.

- Modify: `C:\Users\petbl\auto-video\docs\agent-handoff-contract.md`
  - Adds `visual-context-cards.json` and `storyboard-context-alignment-report.json`.

---

### Task 1: Add Dynamic Scene Context Card Helper

**Files:**
- Create: `C:\Users\petbl\auto-video\scripts\lib\scene-context-card.mjs`
- Test: `C:\Users\petbl\auto-video\scripts\check_scene_context_card.mjs`

- [ ] **Step 1: Create failing test**

Create `C:\Users\petbl\auto-video\scripts\check_scene_context_card.mjs`:

```js
#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  buildSceneContextCard,
  compileContextPrompt,
  scorePromptContextAlignment,
} from "./lib/scene-context-card.mjs";

const narration = "야곱은 사랑받고 있었지만 마음 깊은 곳에서는 아직 선택받지 못한 사람처럼 숨고 있었습니다. 그는 에서와 비교될 때마다 인정받고 싶은 마음에 흔들렸습니다.";
const card = buildSceneContextCard({ narration, order: 1, topic: "야곱은 왜 사랑받고도 불안했을까" });

assert.equal(card.order, 1);
assert(card.biblicalCharacters.includes("Jacob"), "Jacob must be detected from 야곱");
assert(card.biblicalCharacters.includes("Esau"), "Esau must be detected from 에서");
assert.equal(card.psychologyConcept, "need for recognition and comparison anxiety");
assert.equal(card.emotion, "loved but insecure");
assert.equal(card.setting, "inside an ancient family tent");
assert(card.posture.includes("anxiously"), "posture must reflect anxiety");
assert(card.visualAnchor.includes("Jacob"), "visual anchor must include character");
assert(card.visualAnchor.includes("family tent"), "visual anchor must include setting");
assert(card.visualAnchor.includes("hands folded anxiously"), "visual anchor must include posture");
assert(card.symbolicObjects.includes("oil lamp"), "expected oil lamp symbolic object");
assert(card.requirements.sourceAnchors.includes("야곱"), "source anchors must include Korean keyword");
assert(card.requirements.requiredPromptTerms.includes("Jacob"), "required prompt terms must include Jacob");

const prompt = compileContextPrompt({
  card,
  style: "strict pure black and white only, grayscale biblical oil painting, restful negative space",
});

assert(prompt.includes("Jacob"), "prompt must include biblical character");
assert(prompt.includes("recognition anxiety"), "prompt must include psychology anchor");
assert(prompt.includes("family tent"), "prompt must include setting anchor");
assert(prompt.includes("oil lamp"), "prompt must include visible object anchor");
assert(prompt.includes("strict pure black and white"), "prompt must include style");
assert(!prompt.includes("purple"), "prompt must not include color drift");

const score = scorePromptContextAlignment({ card, prompt });
assert.equal(score.ok, true);
assert(score.score >= 85, `expected score >=85, got ${score.score}`);

const generic = scorePromptContextAlignment({
  card,
  prompt: "ancient desert, black and white, calm biblical mood, wide shot",
});
assert.equal(generic.ok, false);
assert(generic.failures.includes("missing_required_prompt_term:Jacob"));
assert(generic.failures.includes("missing_required_prompt_term:recognition anxiety"));
assert(generic.failures.includes("generic_visual_anchor"));

const negative = scorePromptContextAlignment({
  card,
  prompt: `${prompt}, purple glow, readable text on screen`,
});
assert.equal(negative.ok, false);
assert(negative.failures.includes("negative_term_present:purple"));
assert(negative.failures.includes("negative_term_present:readable text"));

console.log("check_scene_context_card: pass");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\check_scene_context_card.mjs
```

Expected:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module ... scene-context-card.mjs
```

- [ ] **Step 3: Implement dynamic helper**

Create `C:\Users\petbl\auto-video\scripts\lib\scene-context-card.mjs`:

```js
const CHARACTER_RULES = [
  { re: /야곱/g, value: "Jacob" },
  { re: /에서/g, value: "Esau" },
  { re: /리브가/g, value: "Rebekah" },
  { re: /이삭/g, value: "Isaac" },
  { re: /카인/g, value: "Cain" },
  { re: /아벨/g, value: "Abel" },
  { re: /아담/g, value: "Adam" },
  { re: /하와|이브/g, value: "Eve" },
];

const PSYCHOLOGY_RULES = [
  {
    re: /인정|사랑받|선택|비교|에서|야곱/,
    concept: "need for recognition and comparison anxiety",
    emotion: "loved but insecure",
    objects: ["oil lamp", "family tent", "empty sleeping mat"],
    required: ["recognition anxiety", "comparison anxiety"],
  },
  {
    re: /질투|미워|비교|동생|카인|아벨/,
    concept: "envy and wounded comparison",
    emotion: "quiet jealousy and inner shame",
    objects: ["stone field", "distant altar", "shadowed hands"],
    required: ["envy", "comparison"],
  },
  {
    re: /선악과|먹지 말라|금지|아담|하와|욕망/,
    concept: "forbidden desire and psychological reactance",
    emotion: "curiosity mixed with fear",
    objects: ["forbidden fruit", "tree branch", "garden shadow"],
    required: ["forbidden desire", "psychological reactance"],
  },
  {
    re: /불안|두려|버림|외로|인정/,
    concept: "anxiety and fear of abandonment",
    emotion: "anxious but quietly searching",
    objects: ["distant tent light", "night road", "folded cloak"],
    required: ["anxiety", "fear of abandonment"],
  },
];

const SETTING_RULES = [
  { re: /장막|천막|집|가족|어머니|아버지|이삭|리브가/, value: "inside an ancient family tent" },
  { re: /들판|밭|제물|제단|아벨|카인/, value: "in a quiet biblical field under pale dawn" },
  { re: /광야|사막|모래|밤|벧엘|돌베개/, value: "in a barren silent wilderness under a night sky" },
  { re: /길|떠나|도망|여행|걸어/, value: "walking slowly along a quiet dusty path" },
  { re: /동산|나무|열매|선악과|에덴/, value: "inside a shadowed garden near a single fruit tree" },
];

const POSTURE_RULES = [
  { re: /불안|두려|숨|비교|인정/, value: "hands folded anxiously, posture showing hesitation" },
  { re: /슬픔|외로|버림|상처|미워/, value: "looking downward, solemn and restrained posture" },
  { re: /기도|바라|원하|축복|기다/, value: "looking toward a soft distant light, posture of longing" },
  { re: /평안|위로|감사|쉼/, value: "standing with open hands, peaceful and composed posture" },
];

const ACTION_RULES = [
  { re: /비교|인정|선택/, value: "quietly sitting apart from the family center" },
  { re: /속임|옷|축복/, value: "standing before an elderly father with visible hesitation" },
  { re: /떠나|도망|광야/, value: "walking away while carrying a small bundle" },
  { re: /제물|제단|질투/, value: "standing apart from a distant altar" },
  { re: /선악과|금지|먹지/, value: "pausing before touching a fruit branch" },
];

const DEFAULT_RULE = {
  concept: "inner conflict and quiet self-reflection",
  emotion: "solemn and contemplative",
  objects: ["night sky", "stone path", "simple robe"],
  required: ["inner conflict", "self-reflection"],
};

const DEFAULT_SETTING = "in a quiet ancient Near Eastern night scene";
const DEFAULT_POSTURE = "posture of quiet self-reflection";
const DEFAULT_ACTION = "standing still in a moment of inner conflict";
const NEGATIVE_TERMS = ["purple", "blue", "color tint", "readable text", "subtitle", "watermark", "modern clothing"];

export function buildSceneContextCard({ narration = "", order = 1, topic = "" } = {}) {
  const text = String(narration || "");
  const topicText = String(topic || "");
  const combined = `${text} ${topicText}`;
  const characters = unique(CHARACTER_RULES.filter((item) => item.re.test(combined)).map((item) => item.value));
  const psychology = PSYCHOLOGY_RULES.find((item) => item.re.test(combined)) || DEFAULT_RULE;
  const setting = SETTING_RULES.find((item) => item.re.test(combined))?.value || DEFAULT_SETTING;
  const posture = POSTURE_RULES.find((item) => item.re.test(combined))?.value || DEFAULT_POSTURE;
  const action = ACTION_RULES.find((item) => item.re.test(combined))?.value || DEFAULT_ACTION;
  const subject = characters.length ? characters.join(" and ") : "a lone biblical figure";
  const visualAnchor = `${subject} ${setting}, ${posture}, ${action}`;
  const keywords = extractKoreanKeywordsClean(text);
  const sourceAnchors = keywords.filter((word) => /야곱|에서|카인|아벨|아담|하와|사랑|인정|비교|질투|불안|축복|선악과|광야|장막|가족/.test(word));
  const requiredPromptTerms = unique([
    ...characters,
    ...psychology.required,
    setting.includes("family tent") ? "family tent" : "",
    setting.includes("field") ? "biblical field" : "",
    setting.includes("wilderness") ? "wilderness" : "",
    setting.includes("garden") ? "fruit tree" : "",
    ...psychology.objects.slice(0, 2),
  ]);

  return {
    order: Number(order) || 1,
    narration: text,
    topic: topicText,
    biblicalCharacters: characters,
    biblicalEvent: inferBiblicalEvent(combined),
    psychologyConcept: psychology.concept,
    emotion: psychology.emotion,
    setting,
    posture,
    action,
    visualAnchor,
    symbolicObjects: psychology.objects,
    avoid: ["generic desert only", "random prophet portrait", "readable text", "modern clothing", "color tint"],
    keywords,
    requirements: {
      sourceAnchors,
      requiredPromptTerms,
      negativePromptTerms: NEGATIVE_TERMS,
    },
  };
}

export function compileContextPrompt({ card, style = "" } = {}) {
  return [
    card.visualAnchor,
    card.biblicalEvent,
    `${card.psychologyConcept} expressed through posture and composition`,
    `${card.emotion} mood`,
    ...(card.symbolicObjects || []),
    style,
    "wide 16:9 composition",
    "restful negative space",
    "subtle human emotion",
    "sleep documentary mood",
    "no violence",
    "no gore",
    "no readable text",
    "no subtitle",
    "no watermark",
    "no modern clothing",
  ].filter(Boolean).join(", ");
}

export function scorePromptContextAlignment({ card, prompt = "" } = {}) {
  const p = String(prompt || "").toLowerCase();
  const failures = [];
  for (const term of card.requirements?.requiredPromptTerms || []) {
    if (term && !p.includes(String(term).toLowerCase())) failures.push(`missing_required_prompt_term:${term}`);
  }
  for (const term of card.requirements?.negativePromptTerms || []) {
    if (term && hasForbiddenTerm(p, term)) failures.push(`negative_term_present:${term}`);
  }
  const genericOnly = /ancient desert|biblical figure|calm mood/.test(p)
    && !(card.symbolicObjects || []).some((obj) => p.includes(String(obj).toLowerCase()))
    && !(card.biblicalCharacters || []).some((name) => p.includes(String(name).toLowerCase()));
  if (genericOnly) failures.push("generic_visual_anchor");
  const score = Math.max(0, 100 - failures.length * 15);
  return { ok: failures.length === 0 && score >= 85, score, failures };
}

export function extractKoreanKeywordsClean(text) {
  return unique(String(text || "")
    .replace(/[^\p{Script=Hangul}\s]/gu, " ")
    .split(/\s+/)
    .map((word) => word.replace(/(은|는|이|가|을|를|과|와|에게|에서|으로|로|하고|처럼|마다|까지|부터|에도|만큼|보다|마저|조차)$/u, ""))
    .filter((word) => word.length >= 2)
    .slice(0, 16));
}

function inferBiblicalEvent(text) {
  if (/야곱|에서|리브가|이삭/.test(text)) return "Jacob inside Isaac's family conflict";
  if (/카인|아벨/.test(text)) return "Cain and Abel before the first murder";
  if (/아담|하와|선악과|에덴/.test(text)) return "Adam and Eve near the forbidden fruit";
  return "quiet biblical inner-life moment";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function hasForbiddenTerm(prompt, term) {
  const escaped = String(term).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[,;])\\s*(?!no\\s+)${escaped}\\b`, "i").test(prompt);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\check_scene_context_card.mjs
```

Expected:

```text
check_scene_context_card: pass
```

---

### Task 2: Use Context Cards in Segmented Storyboard Builder

**Files:**
- Modify: `C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs`
- Test: `C:\Users\petbl\auto-video\scripts\check_segmented_storyboard_context_cards.mjs`

- [ ] **Step 1: Create builder smoke test**

Create `C:\Users\petbl\auto-video\scripts\check_segmented_storyboard_context_cards.mjs`:

```js
#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = "C:/Users/petbl/auto-video";
const sourceSlug = "context-card-source";
const targetSlug = "context-card-target";
const sourceDir = join(root, "exports", sourceSlug);
mkdirSync(sourceDir, { recursive: true });
writeFileSync(join(sourceDir, "script.txt"), [
  "야곱은 사랑받고 있었지만 에서와 비교될 때마다 인정받고 싶은 마음이 흔들렸습니다.",
  "그는 가족의 장막 안에서 자신이 정말 선택받은 사람인지 조용히 묻고 있었습니다.",
  "그 불안은 축복을 붙잡고 싶은 마음으로 천천히 자라났습니다.",
  "그러나 광야의 밤은 그에게 버려지지 않았다는 조용한 위로를 남겼습니다.",
].join("\n\n"), "utf8");

const result = spawnSync(process.execPath, [
  join(root, "scripts", "build_segmented_storyboards.mjs"),
  "--source-slug", sourceSlug,
  "--slug", targetSlug,
  "--target-seconds", "180",
  "--segment-minutes", "15",
], { cwd: root, encoding: "utf8" });

assert.equal(result.status, 0, result.stderr || result.stdout);

const segmentDir = join(root, "exports", targetSlug, "segments", "segment-01");
const cardsPath = join(segmentDir, "visual-context-cards.json");
assert(existsSync(cardsPath), "visual-context-cards.json must exist");

const cards = JSON.parse(readFileSync(cardsPath, "utf8"));
assert(cards.scenes.length > 0, "cards must include scenes");
assert(cards.scenes[0].psychologyConcept.includes("recognition"), "first scene must preserve recognition concept");
assert(cards.scenes[0].visualAnchor.includes("Jacob"), "first scene visual anchor must include Jacob");

const storyboard = readFileSync(join(segmentDir, "hermes-manual-storyboard.md"), "utf8");
assert(storyboard.includes("Jacob"), "storyboard prompt must include Jacob");
assert(storyboard.includes("recognition anxiety"), "storyboard prompt must include psychology concept");
assert(storyboard.includes("family tent"), "storyboard prompt must include setting anchor");
assert(storyboard.includes("duration:"), "storyboard must preserve duration tags");

console.log("check_segmented_storyboard_context_cards: pass");
```

- [ ] **Step 2: Run test to verify it fails before modification**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\check_segmented_storyboard_context_cards.mjs
```

Expected:

```text
AssertionError: visual-context-cards.json must exist
```

- [ ] **Step 3: Import helpers**

At the top of `C:\Users\petbl\auto-video\scripts\build_segmented_storyboards.mjs`, add:

```js
import { buildSceneContextCard, compileContextPrompt, scorePromptContextAlignment } from "./lib/scene-context-card.mjs";
```

- [ ] **Step 4: Write context cards before storyboard generation**

Inside the segment loop, replace:

```js
const storyboard = buildStoryboard(segmentSceneTexts, segment.index, visualTimeline);
```

with:

```js
const contextCards = segmentSceneTexts.map((text, sceneIndex) => buildSceneContextCard({
  narration: text,
  order: sceneIndex + 1,
  topic: sourceProduction?.project?.title || sourceSlug,
}));
writeFileSync(join(segmentDir, "visual-context-cards.json"), JSON.stringify({
  version: 1,
  source: "scene-context-card",
  segmentId: segment.id,
  scenes: contextCards,
}, null, 2), "utf8");
const storyboard = buildStoryboard(segmentSceneTexts, segment.index, visualTimeline, contextCards);
```

- [ ] **Step 5: Replace prompt assembly**

Change the function signature:

```js
function buildStoryboard(sceneTexts, segmentIndex, visualTimeline, contextCards = []) {
```

Inside the `sceneTexts.forEach()` block, replace:

```js
const prompt = `${chooseMotif(index, segmentIndex)}, ${style}`;
```

with:

```js
const card = contextCards[index] || buildSceneContextCard({ narration, order: index + 1 });
const prompt = compileContextPrompt({ card, style });
const alignment = scorePromptContextAlignment({ card, prompt });
if (!alignment.ok) {
  throw new Error(`Storyboard context alignment failed for scene ${index + 1}: ${alignment.failures.join(", ")}`);
}
```

Keep this existing duration logic unchanged:

```js
const duration = visualTimeline[index]?.durationSeconds;
if (!Number.isFinite(duration) || duration <= 0) {
  throw new Error(`Missing visual timeline duration for storyboard scene ${index + 1}`);
}
```

- [ ] **Step 6: Run builder smoke test**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\check_segmented_storyboard_context_cards.mjs
```

Expected:

```text
check_segmented_storyboard_context_cards: pass
```

---

### Task 3: Add Anti-Self-Fulfilling Alignment Gate

**Files:**
- Create: `C:\Users\petbl\auto-video\scripts\check_storyboard_context_alignment.mjs`

- [ ] **Step 1: Create checker**

Create `C:\Users\petbl\auto-video\scripts\check_storyboard_context_alignment.mjs`:

```js
#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scorePromptContextAlignment } from "./lib/scene-context-card.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.segmentDir) {
  console.error("Usage: node scripts/check_storyboard_context_alignment.mjs --segment-dir <segment-dir>");
  process.exit(2);
}

const cardsPath = join(args.segmentDir, "visual-context-cards.json");
const storyboardPath = join(args.segmentDir, "hermes-manual-storyboard.md");
if (!existsSync(cardsPath)) throw new Error(`Missing ${cardsPath}`);
if (!existsSync(storyboardPath)) throw new Error(`Missing ${storyboardPath}`);

const cards = JSON.parse(readFileSync(cardsPath, "utf8")).scenes || [];
const prompts = parsePrompts(readFileSync(storyboardPath, "utf8"));
const scenes = cards.map((card, index) => {
  const prompt = prompts[index]?.prompt || "";
  const score = scorePromptContextAlignment({ card, prompt });
  return {
    order: card.order,
    sourceAnchors: card.requirements?.sourceAnchors || [],
    requiredPromptTerms: card.requirements?.requiredPromptTerms || [],
    prompt,
    ...score,
  };
});

const failures = scenes.filter((scene) => !scene.ok).map((scene) => ({
  order: scene.order,
  failures: scene.failures,
}));
const report = {
  ok: failures.length === 0,
  segmentDir: args.segmentDir,
  sceneCount: scenes.length,
  promptCount: prompts.length,
  minScore: scenes.length ? Math.min(...scenes.map((scene) => scene.score)) : 0,
  failures,
  scenes,
};

writeFileSync(join(args.segmentDir, "storyboard-context-alignment-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: report.ok, sceneCount: report.sceneCount, minScore: report.minScore, failures }, null, 2));
process.exit(report.ok ? 0 : 1);

function parsePrompts(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const prompts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (/^\[.*\]$/.test(line)) {
      const promptLine = String(lines[index + 1] || "").trim();
      prompts.push({ label: line, prompt: promptLine.split(/\s+\/\s+/)[0] || promptLine });
    }
  }
  return prompts;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--segment-dir") parsed.segmentDir = argv[++index];
  }
  return parsed;
}
```

- [ ] **Step 2: Run checker against the smoke segment**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\check_storyboard_context_alignment.mjs --segment-dir C:\Users\petbl\auto-video\exports\context-card-target\segments\segment-01
```

Expected:

```json
{
  "ok": true,
  "failures": []
}
```

- [ ] **Step 3: Confirm report exists**

Run:

```powershell
Test-Path C:\Users\petbl\auto-video\exports\context-card-target\segments\segment-01\storyboard-context-alignment-report.json
```

Expected:

```text
True
```

---

### Task 4: Apply Context Cards to 20-Minute Sample Builders

**Files:**
- Modify: `C:\Users\petbl\auto-video\scripts\build_jacob_20min_sample_export.mjs`
- Modify: `C:\Users\petbl\auto-video\scripts\build_gguljam_20min_sample_export.mjs`
- Test: `C:\Users\petbl\auto-video\scripts\check_sample_storyboard_context_cards.mjs`

- [ ] **Step 1: Create sample test**

Create `C:\Users\petbl\auto-video\scripts\check_sample_storyboard_context_cards.mjs`:

```js
#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = "C:/Users/petbl/auto-video";
const slug = "jacob-context-card-smoke";
const run = spawnSync(process.execPath, [
  join(root, "scripts", "build_jacob_20min_sample_export.mjs"),
  "--slug", slug,
  "--target-seconds", "180",
], { cwd: root, encoding: "utf8" });
assert.equal(run.status, 0, run.stderr || run.stdout);

const segmentDir = join(root, "exports", slug, "segments", "segment-01");
assert(existsSync(join(segmentDir, "visual-context-cards.json")), "sample must write visual-context-cards.json");
const storyboard = readFileSync(join(segmentDir, "hermes-manual-storyboard.md"), "utf8");
assert(storyboard.includes("Jacob"), "Jacob sample storyboard must include Jacob");
assert(storyboard.includes("recognition anxiety") || storyboard.includes("comparison anxiety"), "Jacob sample storyboard must include psychology concept");
assert(storyboard.includes("duration:"), "sample storyboard must preserve duration tags");

console.log("check_sample_storyboard_context_cards: pass");
```

- [ ] **Step 2: Run test to verify it fails before modifications**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\check_sample_storyboard_context_cards.mjs
```

Expected:

```text
AssertionError: sample must write visual-context-cards.json
```

- [ ] **Step 3: Modify Jacob builder**

In `C:\Users\petbl\auto-video\scripts\build_jacob_20min_sample_export.mjs`, import:

```js
import { buildSceneContextCard, compileContextPrompt, scorePromptContextAlignment } from "./lib/scene-context-card.mjs";
```

In the segment loop, before `const storyboard = buildStoryboard(...)`, add:

```js
const contextCards = sceneTexts.map((text, sceneIndex) => buildSceneContextCard({
  narration: text,
  order: sceneIndex + 1,
  topic: title,
}));
writeFileSync(join(segmentDir, "visual-context-cards.json"), JSON.stringify({
  version: 1,
  source: "scene-context-card",
  segmentId: segment.id,
  scenes: contextCards,
}, null, 2), "utf8");
const storyboard = buildStoryboard(sceneTexts, timeline, index, contextCards);
```

Change:

```js
function buildStoryboard(sceneTexts, timeline, segmentIndex) {
```

to:

```js
function buildStoryboard(sceneTexts, timeline, segmentIndex, contextCards = []) {
```

Inside the `for` loop, replace the current `motif`-based prompt block with:

```js
const card = contextCards[index] || buildSceneContextCard({ narration: text, order: index + 1, topic: title });
const prompt = compileContextPrompt({
  card,
  style: [
    style,
    "strict pure black and white only",
    "wide 16:9 composition",
    "restful negative space",
    "subtle human emotion",
    "no violence",
    "no gore",
  ].join(", "),
});
const alignment = scorePromptContextAlignment({ card, prompt });
if (!alignment.ok) {
  throw new Error(`Storyboard context alignment failed for scene ${index + 1}: ${alignment.failures.join(", ")}`);
}
```

- [ ] **Step 4: Modify Cain/general sample builder**

In `C:\Users\petbl\auto-video\scripts\build_gguljam_20min_sample_export.mjs`, add the import:

```js
import { buildSceneContextCard, compileContextPrompt, scorePromptContextAlignment } from "./lib/scene-context-card.mjs";
```

In its segment loop, before its current `const storyboard = buildStoryboard(...)` line, add:

```js
const contextCards = sceneTexts.map((text, sceneIndex) => buildSceneContextCard({
  narration: text,
  order: sceneIndex + 1,
  topic: title,
}));
writeFileSync(join(segmentDir, "visual-context-cards.json"), JSON.stringify({
  version: 1,
  source: "scene-context-card",
  segmentId: segment.id,
  scenes: contextCards,
}, null, 2), "utf8");
const storyboard = buildStoryboard(sceneTexts, timeline, index, contextCards);
```

Remove the old no-context call:

```js
const storyboard = buildStoryboard(sceneTexts, timeline, index);
```

Change the builder function signature:

```js
function buildStoryboard(sceneTexts, timeline, segmentIndex, contextCards = []) {
```

Inside its loop, replace the fixed motif prompt with:

```js
const card = contextCards[index] || buildSceneContextCard({ narration: text, order: index + 1, topic: title });
const prompt = compileContextPrompt({
  card,
  style: [
    style,
    "strict pure black and white only",
    "wide 16:9 composition",
    "restful negative space",
    "subtle human emotion",
    "no violence",
    "no gore",
  ].join(", "),
});
const alignment = scorePromptContextAlignment({ card, prompt });
if (!alignment.ok) {
  throw new Error(`Storyboard context alignment failed for scene ${index + 1}: ${alignment.failures.join(", ")}`);
}
```

- [ ] **Step 5: Run sample test**

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\check_sample_storyboard_context_cards.mjs
```

Expected:

```text
check_sample_storyboard_context_cards: pass
```

---

### Task 5: Document Optional Image-Level Semantic QA

**Files:**
- Create: `C:\Users\petbl\auto-video\docs\visual-semantic-qa-options.md`

- [ ] **Step 1: Create QA options document**

Create `C:\Users\petbl\auto-video\docs\visual-semantic-qa-options.md`:

```markdown
# Visual Semantic QA Options

## Immediate Required Gate

Use `storyboard-context-alignment-report.json` before rendering.

- Pros: fast, deterministic, no GPU vision model required.
- Cons: verifies prompt text, not the generated image.

## Optional Image-Text Gate

Use CLIPScore after keyframes are generated.

- Input: generated `keyframes/scene_XX.png` and compiled prompt/context card.
- Pass: image-text score above a local baseline threshold.
- Caveat: CLIPScore is useful for broad image-text compatibility but can miss subtle biblical or psychological details.
- Reference: https://arxiv.org/abs/2104.08718

## Optional Caption-Backcheck

Use BLIP or BLIP-2 to caption generated keyframes, then compare the generated caption with the original context card.

- Input: generated image.
- Output: caption text.
- Compare caption with `contextCard.visualAnchor`, `psychologyConcept`, and `biblicalCharacters`.
- Reference: https://arxiv.org/abs/2201.12086

## Optional Text-Text Similarity Gate

Use Sentence Transformers or local embeddings for:

`narration -> context card -> prompt`

- Compare narration and prompt as text.
- Use this before ComfyUI to reject generic prompts.
- Reference: https://sbert.net/docs/sentence_transformer/usage/semantic_textual_similarity.html
```

- [ ] **Step 2: Do not install new dependencies in this task**

Run no install command for CLIP, BLIP, or SentenceTransformers. This is documentation only.

---

### Task 6: Documentation Update

**Files:**
- Modify: `C:\Users\petbl\auto-video\auto-video.md`
- Modify: `C:\Users\petbl\auto-video\docs\agent-handoff-contract.md`

- [ ] **Step 1: Update `auto-video.md`**

Add this rule under the longform storyboard/rendering section:

```markdown
### 이미지 프롬프트 맥락 반영 규칙

- 모든 장면은 먼저 `visual-context-cards.json`에 문장별 context card를 만든다.
- context card는 고정 모티프 하나를 고르는 방식이 아니라, 성경 인물, 장소, 행동, 자세, 감정, 심리 개념, 상징 오브젝트를 조합해서 만든다.
- `hermes-manual-storyboard.md`의 프롬프트는 해당 context card의 성경 인물/사건, 심리 개념, 감정, 시각 앵커를 포함해야 한다.
- 장면 번호만으로 motif를 돌려 쓰는 방식은 금지한다.
- 렌더 전 `storyboard-context-alignment-report.json`이 `ok:true`여야 한다.
- 실패한 장면은 ComfyUI 렌더 전에 대본 분할 또는 프롬프트를 수정한다.
```

- [ ] **Step 2: Update handoff contract**

In `C:\Users\petbl\auto-video\docs\agent-handoff-contract.md`, add rows:

```markdown
| `visual-context-cards.json` | 비주얼 프롬프트 에이전트 | 프롬프트 QA, 렌더/운영 에이전트 | 문장별 성경 인물/사건, 심리 개념, 감정, 장소, 행동, 자세, visual anchor |
| `storyboard-context-alignment-report.json` | 프롬프트 QA | 테스트/렌더 에이전트 | `ok:true`, `minScore`, 실패 장면 목록, 누락된 required prompt terms |
```

- [ ] **Step 3: Verify docs mention the new gate**

Run:

```powershell
Select-String -Path C:\Users\petbl\auto-video\auto-video.md -Pattern "visual-context-cards|storyboard-context-alignment"
Select-String -Path C:\Users\petbl\auto-video\docs\agent-handoff-contract.md -Pattern "visual-context-cards|storyboard-context-alignment"
```

Expected: both commands return matching lines.

---

## Verification Checklist

Run:

```powershell
node C:\Users\petbl\auto-video\scripts\check_scene_context_card.mjs
node C:\Users\petbl\auto-video\scripts\check_segmented_storyboard_context_cards.mjs
node C:\Users\petbl\auto-video\scripts\check_storyboard_context_alignment.mjs --segment-dir C:\Users\petbl\auto-video\exports\context-card-target\segments\segment-01
node C:\Users\petbl\auto-video\scripts\check_sample_storyboard_context_cards.mjs
```

Expected:

```text
check_scene_context_card: pass
check_segmented_storyboard_context_cards: pass
{
  "ok": true,
  "failures": []
}
check_sample_storyboard_context_cards: pass
```

Then regenerate one short segment and inspect:

```powershell
node C:\Users\petbl\auto-video\scripts\build_jacob_20min_sample_export.mjs --slug jacob-context-card-preview --target-seconds 180
node C:\Users\petbl\auto-video\scripts\check_storyboard_context_alignment.mjs --segment-dir C:\Users\petbl\auto-video\exports\jacob-context-card-preview\segments\segment-01
```

Expected:

- `visual-context-cards.json` exists.
- `storyboard-context-alignment-report.json` has `ok:true`.
- `hermes-manual-storyboard.md` prompt lines mention specific anchors such as `Jacob`, `Esau`, `recognition anxiety`, `family tent`, `oil lamp`, `blessing`, `wilderness`, or other context-specific terms.
- No prompt contains `purple`, `blue`, `color tint`, `readable text`, `subtitle`, or `modern clothing`.

## Rollback Plan

If generated prompts become too literal or visually repetitive:

1. Keep `visual-context-cards.json`.
2. Adjust `SETTING_RULES`, `POSTURE_RULES`, `ACTION_RULES`, and `compileContextPrompt()` only.
3. Do not return to index-only motif rotation.
4. Keep `check_storyboard_context_alignment.mjs` as a hard gate.

## Execution Notes

- Implement deterministic context cards first.
- Do not add CLIP/BLIP/SentenceTransformer dependencies in the first pass.
- Keep timeline duration handling in `visual-timeline.json` and `/ duration:X`; do not mix audio-sync redesign into this prompt-grounding change.
- The win condition is not "more beautiful prompt text"; it is fewer generic images and better one-to-one mapping between narration meaning and generated keyframe content.
