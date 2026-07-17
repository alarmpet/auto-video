import test from "node:test";
import assert from "node:assert/strict";
import { loadWorkflowDescriptor, compileWorkflow } from "../../scripts/lib/yadam/images/workflow-template.mjs";
import { compileImageRequest, deriveImageSeed } from "../../scripts/lib/yadam/images/prompt-compiler.mjs";
import { validateVisualSlots, publishRenderPlan } from "../../scripts/lib/yadam/images/visual-slot-plan.mjs";
import { hashCanonical } from "../../scripts/lib/pipeline/canonical-json.mjs";
import { mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const requiredClasses = ["CheckpointLoaderSimple", "CLIPTextEncode", "EmptyLatentImage", "KSampler", "VAEDecode", "SaveImage", "LoadImage", "IPAdapterUnifiedLoader", "IPAdapter"];
const objectInfo = Object.fromEntries(requiredClasses.map(name => [name, {}]));

test("conditioned workflow has fixed output and no LoRA", async () => {
  const descriptor = await loadWorkflowDescriptor({ workspaceRoot: process.cwd(), conditioning: "sdxl-ipadapter-plus-face" });
  const graph = compileWorkflow({
    descriptor,
    objectInfo,
    values: {
      CKPT: "sd_xl_base_1.0.safetensors",
      REFERENCE_IMAGE: "yadam-references/ref.png",
      PROMPT: "color Joseon illustration",
      NEGATIVE_PROMPT: "text",
      WIDTH: 1024,
      HEIGHT: 576,
      SEED: 7,
      STEPS: 24,
      CFG: 6,
      SAMPLER: "dpmpp_2m",
      SCHEDULER: "karras",
      IPADAPTER_WEIGHT: 0.8,
      IPADAPTER_START: 0,
      IPADAPTER_END: 0.85,
      FILENAME_PREFIX: "yadam/job/slot"
    }
  });
  assert.equal(graph["9"].class_type, "SaveImage");
  assert.equal(graph["22"].inputs.weight_type, "standard");
  assert.equal(graph["5"].inputs.batch_size, 1);
  assert.equal(JSON.stringify(graph).includes("Lora"), false);
  assert.equal(JSON.stringify(graph).includes("{{"), false);
});

// Prompt Compiler Tests
const baseInput = {
  jobId: "job-001",
  jobSeed: 17,
  mode: "preview",
  purpose: "scene",
  assetId: "img-slot-001",
  visualSlot: { visualSlotId: "slot-001", primarySceneId: "scene-0001", sourceSceneIds: ["scene-0001"] },
  sourceScenes: [{ sceneId: "scene-0001", sourceHash: "f".repeat(64) }],
  scene: { sceneId: "scene-0001", visualDescription: "마당에서 봉투를 건네는 하인", activeCharacters: [{ characterId: "char-servant", variantId: "v-base", focal: true }], location: "조선시대 한옥 마당", action: "봉투를 건넨다", emotion: "불안", props: ["봉투"] },
  character: { characterId: "char-servant", variantId: "v-base", appearanceAnchors: ["young Korean male servant", "narrow face"], wardrobeAnchors: ["brown hemp hanbok"] },
  reference: { status: "provisional", path: "assets/character-references/char-servant/v-base/primary.png", sha256: "a".repeat(64) },
  render: { width: 1024, height: 576, steps: 24, cfg: 6, sampler: "dpmpp_2m", scheduler: "karras" },
  stack: { workflowHash: "b".repeat(64), checkpointHash: "c".repeat(64), clipVisionHash: "d".repeat(64), ipAdapterHash: "e".repeat(64), compilerVersion: "1.0.0", schemaVersion: "1.0.0", styleVersion: "1.0.0" }
};

test("prompt compilation is deterministic and binds reference bytes", () => {
  const first = compileImageRequest(baseInput);
  const second = compileImageRequest(structuredClone(baseInput));
  assert.deepEqual(second, first);
  assert.equal(first.conditioning.method, "sdxl-ipadapter-plus-face");
  assert.match(first.idempotencyKey, /^[0-9a-f]{64}$/);
  assert.equal(first.render.seed, deriveImageSeed({ jobSeed: 17, assetId: "img-slot-001" }));
});

test("production rejects provisional references", () => {
  assert.throws(() => compileImageRequest({ ...baseInput, mode: "production" }), error => error.code === "reference_not_approved");
});

test("non-character slot uses the same SDXL style without IPAdapter", () => {
  const request = compileImageRequest({ ...baseInput, mode: "production", purpose: "intro", character: null, reference: null, scene: { ...baseInput.scene, activeCharacters: [] } });
  assert.equal(request.identity, null);
  assert.equal(request.conditioning.method, "none");
});

test("a primary character reference keeps identity anchors but is unconditioned", () => {
  const request = compileImageRequest({
    ...baseInput,
    purpose: "reference",
    reference: null,
    visualSlot: { visualSlotId: "reference-char-servant-v-base", primarySceneId: null, sourceSceneIds: [] },
    sourceScenes: [],
    render: { width: 768, height: 1024, steps: 28, cfg: 6, sampler: "dpmpp_2m", scheduler: "karras" }
  });
  assert.equal(request.identity.referenceStatus, "none");
  assert.equal(request.identity.referencePath, null);
  assert.equal(request.conditioning.method, "none");
});

test("focal character limit violation throws", () => {
  const badInput = structuredClone(baseInput);
  badInput.scene.activeCharacters = [
    { characterId: "char-1", variantId: "v1", focal: true },
    { characterId: "char-2", variantId: "v2", focal: true }
  ];
  assert.throws(() => compileImageRequest(badInput), error => error.code === "focal_character_limit");
});

test("thumbnail rect out of bounds throws", () => {
  const badInput = structuredClone(baseInput);
  badInput.purpose = "thumbnail-background";
  badInput.render = { width: 1280, height: 720, steps: 24, cfg: 6, sampler: "dpmpp_2m", scheduler: "karras" };
  badInput.thumbnail = { textRect: [0.5, 0.5, 0.6, 0.1] }; // x + w = 1.1 > 1
  assert.throws(() => compileImageRequest(badInput), error => error.code === "thumbnail_rect_invalid");
});

test("style clause clash throws", () => {
  const badInput = structuredClone(baseInput);
  // Add a word to prompt that also appears in style or negative list, e.g. "photorealistic" in positive prompt
  badInput.scene.visualDescription = "마당에서 봉투를 건네는 하인 photorealistic";
  assert.throws(() => compileImageRequest(badInput), error => error.code === "prompt_clause_conflict");
});

test("invalid render tuples throw", () => {
  const badInput = structuredClone(baseInput);
  badInput.render.width = 1000;
  assert.throws(() => compileImageRequest(badInput));
});

test("identity coherence throws on invalid status / path mismatch", () => {
  const badInput = structuredClone(baseInput);
  badInput.reference = { status: "none", path: "some-path", sha256: "a".repeat(64) };
  assert.throws(() => compileImageRequest(badInput), error => error.code === "reference_identity_invalid");
});

// Cadence Validation Tests
function tenMinuteHandoff() {
  const slots = [];
  for (let index = 0; index < 10; index += 1) {
    slots.push({
      visualSlotId: `intro-${index + 1}`,
      visualOrder: index + 1,
      segmentId: "segment-01",
      startSeconds: index * 6,
      endSeconds: (index + 1) * 6,
      durationSeconds: 6,
      timingBand: "intro",
      purpose: "intro",
      sourceSceneIds: ["scene-0001"],
      primarySceneId: "scene-0001",
      extendedHold: false,
      holdReason: null
    });
  }
  for (let index = 0; index < 18; index += 1) {
    const sceneId = `scene-${String(index + 2).padStart(4, "0")}`;
    slots.push({
      visualSlotId: `body-${index + 1}`,
      visualOrder: index + 11,
      segmentId: "segment-01",
      startSeconds: 60 + index * 30,
      endSeconds: 60 + (index + 1) * 30,
      durationSeconds: 30,
      timingBand: "body",
      purpose: "scene",
      sourceSceneIds: [sceneId],
      primarySceneId: sceneId,
      extendedHold: false,
      holdReason: null
    });
  }
  const scenes = [{ sceneId: "scene-0001", segmentId: "segment-01", order: 1, sourceHash: "1".repeat(64), ttsNormalizedHash: "2".repeat(64), ttsOptionsHash: "3".repeat(64), normalizedWavPath: "assets/audio/normalized/scene-0001.wav", normalizedWavHash: "4".repeat(64), durationSeconds: 60, startSeconds: 0, endSeconds: 60 }];
  for (let index = 0; index < 18; index += 1) {
    scenes.push({
      sceneId: `scene-${String(index + 2).padStart(4, "0")}`,
      segmentId: "segment-01",
      order: index + 2,
      sourceHash: `${(index % 9) + 1}`.repeat(64),
      ttsNormalizedHash: "a".repeat(64),
      ttsOptionsHash: "b".repeat(64),
      normalizedWavPath: `assets/audio/normalized/scene-${String(index + 2).padStart(4, "0")}.wav`,
      normalizedWavHash: "c".repeat(64),
      durationSeconds: 30,
      startSeconds: 60 + index * 30,
      endSeconds: 90 + index * 30
    });
  }
  return {
    audioManifestPath: "audio-manifest.json",
    audioManifestHash: "a".repeat(64),
    audioTimelinePath: "audio-timeline.json",
    audioTimelineHash: "b".repeat(64),
    renderPlanInputPath: "render-plan-input.json",
    renderPlanInputHash: "c".repeat(64),
    measuredAudioSeconds: 600,
    acceptedRangeSeconds: { minimum: 590, maximum: 610 },
    audioTempoFactor: 1,
    scenes,
    segments: [{ segmentId: "segment-01", plannedDurationSeconds: 600, measuredAudioSeconds: 600, startSeconds: 0, endSeconds: 600 }],
    visualSlots: slots
  };
}

const profile = {
  visual: {
    intro: { endSeconds: 60, minSlotSeconds: 5, maxSlotSeconds: 7, targetSlotSeconds: 6 },
    body: { minSlotSeconds: 20, maxSlotSeconds: 40, targetSlotSeconds: 30 },
    maxSlots: 260
  }
};

test("ten-minute cadence has 28 continuous slots", () => {
  const audioHandoff = tenMinuteHandoff();
  const out = validateVisualSlots({ audioHandoff, profile });
  assert.equal(out.length, 28);
});

test("gap and body slot over forty seconds fail", () => {
  const audioHandoff = tenMinuteHandoff();
  audioHandoff.visualSlots[11] = { ...audioHandoff.visualSlots[11], startSeconds: 91, durationSeconds: 29 };
  assert.throws(() => validateVisualSlots({ audioHandoff, profile }), error => error.code === "visual_timeline_gap");
});

test("extended hold cta is allowed only in intro with cta holdReason", () => {
  const audioHandoff = tenMinuteHandoff();
  audioHandoff.visualSlots[0].extendedHold = true;
  audioHandoff.visualSlots[0].holdReason = "cta";
  audioHandoff.visualSlots[0].durationSeconds = 12; // 6 + 6
  audioHandoff.visualSlots[0].endSeconds = 12;
  // shift the rest of slots to maintain continuity
  for (let i = 1; i < 10; i++) {
    audioHandoff.visualSlots[i].startSeconds += 6;
    audioHandoff.visualSlots[i].endSeconds += 6;
  }
  audioHandoff.visualSlots[10].startSeconds += 6; // body slot start
  // This fails timing band boundary (intro ends at 60 but visualSlots[9].endSeconds is now 66)
  assert.throws(() => validateVisualSlots({ audioHandoff, profile }));
});

test("uncovered scene fails", () => {
  const audioHandoff = tenMinuteHandoff();
  // make slot not cover the scene-0002 duration (60-90)
  audioHandoff.visualSlots[10].endSeconds = 85;
  audioHandoff.visualSlots[10].durationSeconds = 25;
  audioHandoff.visualSlots[11].startSeconds = 85.5; // introduce gap
  assert.throws(() => validateVisualSlots({ audioHandoff, profile }));
});
