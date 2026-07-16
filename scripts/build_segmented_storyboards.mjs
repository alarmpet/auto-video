#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { assertLongformScriptQuality } from "./lib/quality-gates.mjs";
import { buildSegmentPlan } from "./lib/segment-plan.mjs";
import { buildSentenceGroundedVisualTimeline } from "./lib/sentence-grounded-visual-timeline.mjs";
import { buildVisualBeat } from "./lib/visual-beat-extractor.mjs";
import { analyzeScriptStructure } from "./lib/script-structure-analysis.mjs";
import { analyzeSemanticOverlap } from "./lib/semantic-overlap-analysis.mjs";
import { analyzeScriptHpsl } from "./lib/hpsl-structure-analysis.mjs";
import { buildSceneContextCard, compileContextPrompt, scorePromptContextAlignment } from "./lib/scene-context-card.mjs";
import { analyzePhase3ScriptQuality } from "./lib/phase3-script-quality.mjs";
import { reinforcePhase3Empathy } from "./lib/phase3-empathy-rewriter.mjs";
import { reinforceHpslStructure } from "./lib/hpsl-rewriter.mjs";
import { analyzeBibleGrounding, extractCitationBlocks } from "./lib/bible-grounding-analysis.mjs";
import { selectChaptersForSegment } from "./lib/segment-chapter-selection.mjs";
import { lookupVerses } from "./lib/bible-reference.mjs";

const root = process.env.AUTO_VIDEO_ROOT || "C:/Users/petbl/auto-video";
const args = parseArgs(process.argv.slice(2));
const sourceSlug = args.sourceSlug || "gguljam-bible-cain-envy-60min-001";
const slug = args.slug || `${sourceSlug}-segmented`;
const sourceDir = join(root, "exports", sourceSlug);
const exportDir = join(root, "exports", slug);
mkdirSync(exportDir, { recursive: true });
const skipScriptQuality = args.skipScriptQuality === true;
if (skipScriptQuality && process.env.AUTO_VIDEO_ALLOW_TEST_BYPASS !== "1") {
  throw new Error("--skip-script-quality is only allowed when AUTO_VIDEO_ALLOW_TEST_BYPASS=1 for smoke tests");
}

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

const script = readFileSync(join(sourceDir, "script.txt"), "utf8").trim();
const sourceProduction = readJson(join(sourceDir, "production.json"), {});
const sourceChapters = readJson(join(sourceDir, "chapters.json"), []);
const targetSeconds = Number(
  args.targetSeconds
  || sourceProduction?.render?.target_seconds
  || sourceProduction?.targetSeconds
  || (sourceProduction?.project?.target_minutes ? sourceProduction.project.target_minutes * 60 : 3600),
);
const segmentPlan = buildSegmentPlan({
  targetSeconds,
  segmentMinutes: Number(args.segmentMinutes || 15),
  introSeconds: Number(args.introSeconds || 60),
  introSceneSeconds: Number(args.introSceneSeconds || 6),
  bodySceneSeconds: Number(args.bodySceneSeconds || 30),
});
// 수면 낭독형 기본 프로필: auto-video.md 20분 기준(5,000~6,000자 ≈ 4.2~5.0자/초)에 맞춰 5.2를 기본값으로 쓴다.
// 빠른 정보형 콘텐츠가 필요하면 --target-chars-per-second 6.8 처럼 명시적으로 올려서 쓴다.
const targetCharsPerSecond = Number(args.targetCharsPerSecond || 5.2);

const segmentScripts = splitScriptIntoTimeSegments(script, segmentPlan);
const segmentRecords = [];

for (const [index, segment] of segmentPlan.segments.entries()) {
  const segmentDir = join(exportDir, "segments", segment.id);
  mkdirSync(segmentDir, { recursive: true });
  let segmentScript = segmentScripts[index] || "";
  const phase3Rewrite = reinforcePhase3Empathy(segmentScript, {
    minSecondPersonTouchpoints: 3,
  });
  segmentScript = phase3Rewrite.text;
  writeFileSync(join(segmentDir, "phase3-empathy-rewrite-report.json"), JSON.stringify({
    segmentId: segment.id,
    insertedParagraphCount: phase3Rewrite.insertedParagraphs.length,
    insertedParagraphs: phase3Rewrite.insertedParagraphs,
    before: phase3Rewrite.before.secondPersonEmpathy,
    after: phase3Rewrite.after.secondPersonEmpathy,
  }, null, 2), "utf8");
  const minSegmentChapters = Math.max(1, Math.round(segment.durationSeconds / 300));
  const hpslRewrite = reinforceHpslStructure(segmentScript, {
    minChapters: minSegmentChapters,
    minChapterPassRate: 0.8,
  });
  segmentScript = hpslRewrite.text;
  writeFileSync(join(segmentDir, "hpsl-rewrite-report.json"), JSON.stringify({
    segmentId: segment.id,
    minChapters: minSegmentChapters,
    insertedParagraphCount: hpslRewrite.insertedParagraphs.length,
    insertedParagraphs: hpslRewrite.insertedParagraphs,
    before: {
      ok: hpslRewrite.before.ok,
      failures: hpslRewrite.before.failures,
      chapters: hpslRewrite.before.chapters,
    },
    after: {
      ok: hpslRewrite.after.ok,
      failures: hpslRewrite.after.failures,
      chapters: hpslRewrite.after.chapters,
    },
  }, null, 2), "utf8");
  const targetChars = Math.round(segment.durationSeconds * targetCharsPerSecond);
  const actualChars = segmentScript.replace(/\s/g, "").length;
  const scriptBudget = {
    segmentId: segment.id,
    targetSeconds: segment.durationSeconds,
    targetCharsPerSecond,
    targetChars,
    actualChars,
    ratio: Number((actualChars / Math.max(1, targetChars)).toFixed(3)),
  };
  writeFileSync(join(segmentDir, "script-budget-report.json"), JSON.stringify(scriptBudget, null, 2), "utf8");
  if (scriptBudget.ratio > 1.12) {
    throw new Error(`${segment.id}: script char budget ratio ${scriptBudget.ratio} exceeds 1.12; shorten source script or rebalance before rendering`);
  }
  const segmentChapters = selectChaptersForSegment(segmentScript, sourceChapters);
  const segmentChaptersPath = join(segmentDir, "chapters.json");
  writeFileSync(segmentChaptersPath, JSON.stringify(segmentChapters, null, 2), "utf8");
  const qualitySuite = skipScriptQuality
    ? {
      ok: true,
      skipped: true,
      failures: [],
      reason: "skip-script-quality flag is intended for storyboard/context-card smoke tests only",
    }
    : buildScriptQualitySuite(segmentScript, segment, { chapters: segmentChapters });
  writeFileSync(join(segmentDir, "script-quality-report.json"), JSON.stringify(qualitySuite.repetition || qualitySuite, null, 2), "utf8");
  writeFileSync(
    join(segmentDir, "script-quality-suite-report.json"),
    `${JSON.stringify(qualitySuite, null, 2)}\n`,
    "utf8",
  );
  if (!qualitySuite.ok) {
    throw new Error(`${segment.id}: script quality suite failed: ${qualitySuite.failures.slice(0, 5).join("; ")}`);
  }
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
  const visualBeats = groundedScenes.map((scene) => buildVisualBeat({
    narration: scene.narration,
    order: scene.order,
  }));
  const visualTimeline = groundedScenes.map((scene, sceneIndex) => ({
    order: scene.order,
    startSeconds: scene.startSeconds,
    endSeconds: scene.endSeconds,
    durationSeconds: scene.durationSeconds,
    timingBand: scene.timingBand,
    narration: scene.narration,
    keywords: scene.keywords,
    visualBeatKind: visualBeats[sceneIndex]?.kind,
    requiredPromptTerms: visualBeats[sceneIndex]?.requiredPromptTerms || [],
  }));
  segment.sceneCount = groundedScenes.length;
  const contextCards = [];
  const usedAnchors = new Set();
  for (const [sceneIndex, text] of segmentSceneTexts.entries()) {
    let card = null;
    // Retry with a shifted seed if the exact visual anchor was already used
    // anywhere in the segment (not just the previous scene).
    for (let attempt = 0; attempt < 6; attempt += 1) {
      card = buildSceneContextCard({
        narration: text,
        order: sceneIndex + 1 + attempt * 101,
        topic: sourceProduction?.project?.title || sourceSlug,
        previous: contextCards.at(-1) || null,
        visualBeat: visualBeats[sceneIndex],
      });
      if (!usedAnchors.has(card.visualAnchor)) break;
    }
    card.order = sceneIndex + 1;
    usedAnchors.add(card.visualAnchor);
    contextCards.push(card);
  }
  writeFileSync(join(segmentDir, "visual-context-cards.json"), JSON.stringify({
    version: 1,
    source: "scene-context-card",
    segmentId: segment.id,
    scenes: contextCards,
  }, null, 2), "utf8");
  writeFileSync(join(segmentDir, "visual-beats.json"), JSON.stringify({
    version: 1,
    source: "visual-beat-extractor",
    segmentId: segment.id,
    scenes: visualBeats,
  }, null, 2), "utf8");
  const storyboard = buildStoryboard(segmentSceneTexts, segment.index, visualTimeline, contextCards);

  writeFileSync(join(segmentDir, "script.txt"), `${segmentScript.trim()}\n`, "utf8");
  writeFileSync(join(segmentDir, "hermes-manual-storyboard.md"), `${storyboard.trim()}\n`, "utf8");
  writeFileSync(join(segmentDir, "visual-timeline.json"), JSON.stringify({
    segmentId: segment.id,
    targetSeconds: segment.durationSeconds,
    scenes: visualTimeline,
  }, null, 2), "utf8");
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
    visualStyle: "strict pure black and white grayscale biblical oil painting",
  }, null, 2), "utf8");
  writeFileSync(join(segmentDir, "visual-scene-report.json"), JSON.stringify({
    segmentId: segment.id,
    sceneCount: segmentSceneTexts.length,
    targetSceneCount: segment.sceneCount,
    targetSeconds: segment.durationSeconds,
    scriptChars: segmentScript.length,
    averageScriptCharsPerVisual: Math.round(segmentScript.length / Math.max(1, segmentSceneTexts.length)),
  }, null, 2), "utf8");
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
  segmentRecords.push({
    ...segment,
    dir: segmentDir,
    scriptPath: join(segmentDir, "script.txt"),
    storyboardPath: join(segmentDir, "hermes-manual-storyboard.md"),
    finalPath: join(segmentDir, "manual-assembly", "final.mp4"),
  });
}

const actualTotalSceneCount = segmentRecords.reduce((sum, record) => sum + Number(record.sceneCount || 0), 0);

writeFileSync(join(exportDir, "script.txt"), `${script}\n`, "utf8");
writeFileSync(join(exportDir, "chapters.json"), JSON.stringify(sourceChapters, null, 2), "utf8");
writeFileSync(join(exportDir, "production.json"), JSON.stringify({
  sourceSlug,
  slug,
  targetSeconds,
  segmentMinutes: segmentPlan.segmentMinutes,
  segmentCount: segmentPlan.segments.length,
  totalSceneCount: actualTotalSceneCount,
  render: {
    engine: "hermes-studio",
    target_seconds: targetSeconds,
    visual_mode: "segmented-contextual-keyframes",
    orientation: "landscape",
  },
}, null, 2), "utf8");
writeFileSync(join(exportDir, "segment-manifest.json"), JSON.stringify({
  sourceSlug,
  slug,
  targetSeconds,
  totalSceneCount: actualTotalSceneCount,
  segmentPlan,
  segments: segmentRecords,
}, null, 2), "utf8");

console.log(JSON.stringify({
  exportDir,
  segmentCount: segmentRecords.length,
  totalSceneCount: actualTotalSceneCount,
}, null, 2));

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
    else if (arg === "--target-chars-per-second") parsed.targetCharsPerSecond = argv[++i];
    else if (arg === "--skip-script-quality") parsed.skipScriptQuality = true;
  }
  return parsed;
}

function buildScriptQualitySuite(segmentScript, segment, options = {}) {
  const scriptQuality = assertLongformScriptQuality(segmentScript, {
    minParagraphs: Math.max(18, Math.round(segment.durationSeconds / 30)),
  });
  const structureQuality = analyzeScriptStructure(segmentScript, {
    minChapters: Math.max(1, Math.round(segment.durationSeconds / 300)),
    inferChapters: true,
  });
  const semanticOverlap = analyzeSemanticOverlap(segmentScript, {
    threshold: 0.82,
  });
  const hpsl = analyzeScriptHpsl(segmentScript, {
    minChapterPassRate: 0.8,
    minChapters: Math.max(1, Math.round(segment.durationSeconds / 300)),
    inferChapters: true,
  });
  const phase3 = analyzePhase3ScriptQuality(segmentScript);
  const bibleGrounding = Array.isArray(options.chapters) && options.chapters.length
    ? analyzeBibleGrounding(segmentScript, {
      chapters: options.chapters,
      minCitationsPerChapter: 1,
    })
    : { ok: true, failures: [], citationCount: 0, skipped: true };
  const bibleCitation = analyzeBibleCitationText(segmentScript);
  return {
    ok: scriptQuality.ok && structureQuality.ok && semanticOverlap.ok && hpsl.ok && phase3.ok && bibleGrounding.ok && bibleCitation.ok,
    failures: [
      ...scriptQuality.failures.map((failure) => `repetition:${failure}`),
      ...structureQuality.failures.map((failure) => `structure:${failure}`),
      ...(semanticOverlap.ok ? [] : semanticOverlap.overlaps.map((overlap) => `semantic_overlap:p${overlap.leftParagraph}-p${overlap.rightParagraph}:${overlap.score}`)),
      ...(hpsl.ok ? [] : hpsl.failures.map((failure) => `hpsl:${failure}`)),
      ...phase3.failures.map((failure) => `phase3:${failure}`),
      ...bibleGrounding.failures.map((failure) => `bible_grounding:${failure}`),
      ...bibleCitation.failures.map((failure) => `bible_citation:${failure}`),
    ],
    repetition: scriptQuality,
    structure: structureQuality,
    semanticOverlap,
    hpsl,
    phase3,
    bibleGrounding,
    bibleCitation,
  };
}

function analyzeBibleCitationText(text) {
  const citationBlocks = extractCitationBlocks(text);
  const failures = [];
  for (const block of citationBlocks) {
    try {
      const { verses } = lookupVerses(block.reference);
      const expected = verses.map((v) => v.text).join(" ");
      if (normalizeQuote(block.quote) !== normalizeQuote(expected)) {
        failures.push(`${block.reference}: quoted text does not match 개역한글판 source verbatim`);
      }
    } catch (error) {
      failures.push(`${block.reference}: ${error.message}`);
    }
  }
  return {
    ok: failures.length === 0,
    failures,
    citationCount: citationBlocks.length,
  };
}

function normalizeQuote(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/[“”‘’]/gu, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function splitIntoUnits(text) {
  const paragraphs = text.split(/\n\s*\n/g).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length >= 2) return paragraphs;
  return splitTextBySentence(text);
}

function splitTextBySentence(text) {
  return String(text || "")
    .split(/(?<=[.!?。！？])\s+|(?<=[.!?。！？])/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

function splitScriptIntoTimeSegments(sourceScript, plan) {
  const maxUnitChars = Math.round(plan.segmentSeconds * targetCharsPerSecond * 0.35);
  const units = splitIntoSegmentUnits(sourceScript, maxUnitChars);
  const targets = plan.segments.map((segment) => segment.durationSeconds);
  return splitUnitsByWeightedTargets(units, targets);
}

function splitIntoSegmentUnits(text, maxUnitChars) {
  return splitIntoUnits(text).flatMap((unit) => splitLongUnitBySentence(unit, maxUnitChars));
}

function splitLongUnitBySentence(unit, maxChars) {
  const cleanUnit = String(unit || "").trim();
  if (!cleanUnit) return [];
  if (cleanUnit.length <= maxChars) return [cleanUnit];
  const sentences = splitTextBySentence(cleanUnit);
  if (sentences.length < 2) {
    return splitTextIntoCharacterChunks(cleanUnit, Math.ceil(cleanUnit.length / Math.max(1, maxChars)));
  }

  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    const next = `${current} ${sentence}`.trim();
    if (next.length > maxChars && current) {
      chunks.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitSegmentScriptIntoScenes(segmentScript, sceneCount) {
  let units = ensureMinimumUnits(splitIntoUnits(segmentScript), sceneCount);
  if (units.length < sceneCount) {
    units = splitTextIntoCharacterChunks(segmentScript, sceneCount);
  }
  return splitUnitsEvenly(units, sceneCount);
}

function ensureMinimumUnits(units, targetCount) {
  const output = [...units].filter(Boolean);
  while (output.length < targetCount) {
    const longestIndex = output.reduce((best, unit, index) => (
      unit.length > output[best].length ? index : best
    ), 0);
    const parts = splitUnitInHalf(output[longestIndex]);
    if (parts.length < 2) break;
    output.splice(longestIndex, 1, ...parts);
  }
  return output;
}

function splitUnitInHalf(unit) {
  const sentences = splitTextBySentence(unit);
  if (sentences.length >= 2) {
    const mid = Math.ceil(sentences.length / 2);
    return [
      sentences.slice(0, mid).join(" ").trim(),
      sentences.slice(mid).join(" ").trim(),
    ].filter(Boolean);
  }

  const words = unit.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const mid = Math.ceil(words.length / 2);
    return [
      words.slice(0, mid).join(" ").trim(),
      words.slice(mid).join(" ").trim(),
    ].filter(Boolean);
  }

  const mid = Math.ceil(unit.length / 2);
  return [unit.slice(0, mid).trim(), unit.slice(mid).trim()].filter(Boolean);
}

function splitTextIntoCharacterChunks(text, count) {
  const compact = cleanStoryboardText(text);
  const chunks = [];
  for (let i = 0; i < count; i += 1) {
    const start = Math.floor((i * compact.length) / count);
    const end = Math.floor(((i + 1) * compact.length) / count);
    const chunk = compact.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function splitUnitsEvenly(units, count) {
  const cleanUnits = units.map((unit) => unit.trim()).filter(Boolean);
  const buckets = [];
  for (let i = 0; i < count; i += 1) {
    const start = Math.floor((i * cleanUnits.length) / count);
    const end = Math.floor(((i + 1) * cleanUnits.length) / count);
    const slice = cleanUnits.slice(start, Math.max(start + 1, end));
    buckets.push(slice.join("\n\n").trim());
  }
  return buckets.map((bucket) => bucket || cleanUnits.at(-1) || "");
}

function splitUnitsByWeightedTargets(units, targets) {
  const cleanUnits = units.map((unit) => unit.trim()).filter(Boolean);
  if (!cleanUnits.length) return [];
  const total = cleanUnits.reduce((sum, unit) => sum + unit.length, 0);
  const targetTotal = targets.reduce((sum, target) => sum + Math.max(0, Number(target) || 0), 0) || targets.length;
  const buckets = Array.from({ length: targets.length }, () => []);
  let bucketIndex = 0;
  let bucketChars = 0;

  for (const unit of cleanUnits) {
    const currentTarget = Math.max(1, Math.ceil((total * targets[bucketIndex]) / targetTotal));
    if (bucketIndex < targets.length - 1 && bucketChars >= currentTarget) {
      bucketIndex += 1;
      bucketChars = 0;
    }
    buckets[bucketIndex].push(unit);
    bucketChars += unit.length;
  }

  return buckets.map((bucket) => bucket.join("\n\n").trim());
}

function chooseMotif(index, segmentIndex) {
  return motifBank[(index + segmentIndex * 3) % motifBank.length];
}

// Hoisted function (not const) because buildStoryboard is called from the
// top-level loop before this point in the file is evaluated.
function storyboardBanks() {
  return {
    camera: [
      "wide establishing shot", "low close-up", "medium rear shot", "high wide angle",
      "symbolic still-life close shot", "slow centered composition", "over-the-shoulder view",
      "distant silhouette framing", "ground-level foreground framing", "top-down intimate framing",
    ],
    lighting: [
      "soft moonlit grayscale haze", "hard side light in monochrome", "pale dawn light",
      "small flickering firelight in grayscale", "thin overhead light", "soft pre-dawn glow",
      "single lamp glow against deep black", "rim light along a silhouette", "diffuse starlight",
    ],
    mood: [
      "quiet and contemplative", "hurt but restrained", "solemn and human",
      "restful and reflective", "searching and compassionate", "peaceful and consoling",
      "tender but uneasy", "lonely and consoling", "psychological but calm",
    ],
    motion: [
      "very slow push-in", "slow lateral pan", "locked-off with subtle breathing light",
      "slow pull-back", "slow tilt from hands to face", "gentle forward glide",
      "slow upward drift", "slow downward drift", "gentle diagonal drift",
    ],
  };
}

// Seeded pick that never repeats the previous scene's choice.
// Replaces the old `index % bank.length` cycling, which made every 6th scene
// identical and was the only source of visual variation.
function pickFromBank(bank, seed, previousValue) {
  const pool = previousValue ? bank.filter((value) => value !== previousValue) : bank;
  const usable = pool.length ? pool : bank;
  return usable[Math.abs(seed) % usable.length];
}

function hashNarration(text) {
  let hash = 5381;
  const s = String(text || "");
  for (let i = 0; i < s.length; i += 1) hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

function buildStoryboard(sceneTexts, segmentIndex, visualTimeline, contextCards = []) {
  const banks = storyboardBanks();
  const lines = [];
  let previousPick = { camera: null, lighting: null, mood: null, motion: null };
  sceneTexts.forEach((text, index) => {
    const narration = cleanStoryboardText(text);
    const card = contextCards[index] || buildSceneContextCard({ narration, order: index + 1 });
    const prompt = compileContextPrompt({ card, style });
    const alignment = scorePromptContextAlignment({ card, prompt });
    if (!alignment.ok) {
      throw new Error(`Storyboard context alignment failed for scene ${index + 1}: ${alignment.failures.join(", ")}`);
    }
    const duration = visualTimeline[index]?.durationSeconds;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`Missing visual timeline duration for storyboard scene ${index + 1}`);
    }
    const seed = hashNarration(narration) + segmentIndex * 7 + index;
    const camera = pickFromBank(banks.camera, seed, previousPick.camera);
    const lighting = pickFromBank(banks.lighting, seed >> 2, previousPick.lighting);
    const mood = pickFromBank(banks.mood, seed >> 4, previousPick.mood);
    const motion = pickFromBank(banks.motion, seed >> 6, previousPick.motion);
    previousPick = { camera, lighting, mood, motion };
    lines.push(`[${narration}]`);
    lines.push(`${prompt} / ${camera} / ${lighting} / ${mood} / ${motion} / duration:${duration}`);
    lines.push("");
  });
  return lines.join("\n");
}

function cleanStoryboardText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
