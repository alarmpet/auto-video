import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAudioTimeline,
  compileVisualSlots
} from "../../scripts/lib/yadam/audio-timeline.mjs";

test("scene and segment timeline accumulation", () => {
  const rows = [
    { order: 1, media: { durationSeconds: 5.25 }, sceneId: "scene-0001", segmentId: "segment-01" },
    { order: 2, media: { durationSeconds: 7.50 }, sceneId: "scene-0002", segmentId: "segment-01" },
    { order: 3, media: { durationSeconds: 22.25 }, sceneId: "scene-0003", segmentId: "segment-02" }
  ];

  const timeline = buildAudioTimeline(rows);
  assert.equal(timeline.measuredAudioSeconds, 35.0);
  assert.equal(timeline.scenes[0].startSeconds, 0);
  assert.equal(timeline.scenes[0].endSeconds, 5.25);
  assert.equal(timeline.scenes[1].startSeconds, 5.25);
  assert.equal(timeline.scenes[1].endSeconds, 12.75);
  assert.equal(timeline.scenes[2].startSeconds, 12.75);
  assert.equal(timeline.scenes[2].endSeconds, 35.0);
});

test("partitioning: intro and body slots in first segment and second segment", () => {
  // First segment of 600 seconds, second of 600 seconds
  const rows = [
    { order: 1, media: { durationSeconds: 600.0 }, sceneId: "scene-0001", segmentId: "segment-01" },
    { order: 2, media: { durationSeconds: 600.0 }, sceneId: "scene-0002", segmentId: "segment-02" }
  ];

  const timeline = buildAudioTimeline(rows);
  const compiled = compileVisualSlots(timeline.scenes);

  const slots = compiled.visualSlots;
  const seg1Slots = slots.filter(s => s.segmentId === "segment-01");
  const seg2Slots = slots.filter(s => s.segmentId === "segment-02");

  // Segment 1 should have 10 intro slots (each 6s) and 18 body slots (each 30s)
  const introSlots = seg1Slots.filter(s => s.timingBand === "intro");
  const bodySlots = seg1Slots.filter(s => s.timingBand === "body");

  assert.equal(introSlots.length, 10);
  assert.equal(bodySlots.length, 18);
  assert.equal(introSlots[0].durationSeconds, 6.0);
  assert.equal(bodySlots[0].durationSeconds, 30.0);
  assert.equal(seg1Slots[seg1Slots.length - 1].endSeconds, 600.0);

  // Segment 2 starting at 600 should only have body slots
  const seg2Intro = seg2Slots.filter(s => s.timingBand === "intro");
  const seg2Body = seg2Slots.filter(s => s.timingBand === "body");
  assert.equal(seg2Intro.length, 0);
  assert.equal(seg2Body.length, 20); // 600 / 30 = 20
  assert.equal(seg2Slots[seg2Slots.length - 1].endSeconds, 1200.0);
});

test("M!=N mapping and primary scene selection", () => {
  const scenes = [
    { order: 1, durationSeconds: 40.0, startSeconds: 0, endSeconds: 40, sceneId: "scene-0001", segmentId: "segment-01" },
    { order: 2, durationSeconds: 50.0, startSeconds: 40, endSeconds: 90, sceneId: "scene-0002", segmentId: "segment-01" }
  ];

  const compiled = compileVisualSlots(scenes);
  const slots = compiled.visualSlots;

  // Let's inspect a slot that spans across scene 1 and scene 2.
  // Intro slots cover 0-60 in 10 slots of 6s each.
  // Slot 7 is [36, 42). It overlaps scene 1 by 4s (36-40) and scene 2 by 2s (40-42).
  // Overlap is largest for scene 1. So primarySceneId should be scene-0001.
  const slot7 = slots[6];
  assert.equal(slot7.startSeconds, 36.0);
  assert.equal(slot7.endSeconds, 42.0);
  assert.deepEqual(slot7.sourceSceneIds, ["scene-0001", "scene-0002"]);
  assert.equal(slot7.primarySceneId, "scene-0001");
});

test("CTA hold and short-tail hold merges", () => {
  const scenes = [
    // Intro with CTA
    { order: 1, durationSeconds: 20.0, startSeconds: 0, endSeconds: 20, sceneId: "scene-0001", segmentId: "segment-01" },
    { order: 2, durationSeconds: 10.0, startSeconds: 20, endSeconds: 30, sceneId: "scene-0002", segmentId: "segment-01", narrativeRole: "cta" },
    // Rest of segment 1 is 570s body, total 600s
    { order: 3, durationSeconds: 570.0, startSeconds: 30, endSeconds: 600, sceneId: "scene-0003", segmentId: "segment-01" }
  ];

  const compiled = compileVisualSlots(scenes);
  const slots = compiled.visualSlots;

  // Find the CTA extended slot. The CTA scene spans 20-30.
  // The prior slots should end at 20. The prior slot before 20-30 should be extended to cover up to 30.
  // So the slot ending at 20 extends to 30, having duration = prior_duration + 10 = 16 or similar.
  const ctaSlot = slots.find(s => s.holdReason === "cta");
  assert.ok(ctaSlot);
  assert.equal(ctaSlot.extendedHold, true);
  assert.equal(ctaSlot.endSeconds, 30.0);
  assert.notEqual(ctaSlot.primarySceneId, "scene-0002"); // Should NOT be the CTA scene!

  // Short tail test:
  // Let's create a body duration that results in a short tail (e.g. 60s body + 10s tail).
  // If we partition body of 70s using target 30: round(70/30) = 2. slots: 35s each. No short tail.
  // What if we partition body of 45s: round(45/30) = 2. slots: 22.5s each. No short tail.
  // What if we have a segment whose total body duration is 15s?
  // Let's verify short-tail merge on a segment with 60s intro + 15s body (total 75s).
  // Partitioning 15s body range results in 1 slot of 15s. Since 15 < 20, it is merged into the last intro slot as short_tail.
  const shortTailScenes = [
    { order: 1, durationSeconds: 60.0, startSeconds: 0, endSeconds: 60, sceneId: "scene-0001", segmentId: "segment-01" },
    { order: 2, durationSeconds: 15.0, startSeconds: 60, endSeconds: 75, sceneId: "scene-0002", segmentId: "segment-01" }
  ];

  const stCompiled = compileVisualSlots(shortTailScenes);
  const stSlots = stCompiled.visualSlots;

  // The last intro slot (normally [54, 60)) should be extended to 75.
  const stLast = stSlots[stSlots.length - 1];
  assert.equal(stLast.endSeconds, 75.0);
  assert.equal(stLast.extendedHold, true);
  assert.equal(stLast.holdReason, "short_tail");
});
