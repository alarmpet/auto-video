import test from "node:test";
import assert from "node:assert/strict";
import {
  isYadamTimeline,
  assertYadamAssemblerOptions,
  assertExactTimelineEnd,
  assertTimelineContinuity,
  buildFrameWindows,
  assertVisualKeyframePairs
} from "../../scripts/lib/yadam/exact-video-policy.mjs";

test("yadam assembler option validation", () => {
  const validOptions = {
    finalName: "final.mp4",
    preserveAudioTempo: true,
    motionFps: 24,
    preserveColor: true
  };
  
  assert.doesNotThrow(() => assertYadamAssemblerOptions(validOptions));

  // Failure cases
  assert.throws(() => assertYadamAssemblerOptions({ ...validOptions, finalName: "preview.mp4" }), /final name/);
  assert.throws(() => assertYadamAssemblerOptions({ ...validOptions, preserveAudioTempo: false }), /preserve audio tempo/);
  assert.throws(() => assertYadamAssemblerOptions({ ...validOptions, motionFps: 18 }), /motion FPS/);
  assert.throws(() => assertYadamAssemblerOptions({ ...validOptions, preserveColor: false }), /preserve color/);
  assert.throws(() => assertYadamAssemblerOptions({ ...validOptions, allowFastAudio: true }), /forbids fast audio/);
  assert.throws(() => assertYadamAssemblerOptions({ ...validOptions, maxAudioTempo: 1.1 }), /forbids fast audio/);
});

test("exact timeline boundary checks", () => {
  const slots = [
    { visualSlotId: "slot-01", startSeconds: 0, endSeconds: 5.03, durationSeconds: 5.03 },
    { visualSlotId: "slot-02", startSeconds: 5.03, endSeconds: 10.11, durationSeconds: 5.08 },
    { visualSlotId: "slot-03", startSeconds: 10.11, endSeconds: 18.42, durationSeconds: 8.31 }
  ];

  assert.doesNotThrow(() => assertTimelineContinuity(slots));

  // Boundary checks (gap > 0.01)
  const badSlots1 = [
    { visualSlotId: "slot-01", startSeconds: 0, endSeconds: 5.03, durationSeconds: 5.03 },
    { visualSlotId: "slot-02", startSeconds: 5.05, endSeconds: 10.11, durationSeconds: 5.06 }
  ];
  assert.throws(() => assertTimelineContinuity(badSlots1), /gap or overlap/);

  // First start > 0.01
  const badSlots2 = [
    { visualSlotId: "slot-01", startSeconds: 0.02, endSeconds: 5.03, durationSeconds: 5.01 }
  ];
  assert.throws(() => assertTimelineContinuity(badSlots2), /exceeds 0.01/);

  // Duration mismatch
  const badSlots3 = [
    { visualSlotId: "slot-01", startSeconds: 0, endSeconds: 5.03, durationSeconds: 4.90 }
  ];
  assert.throws(() => assertTimelineContinuity(badSlots3), /Duration mismatch/);
});

test("frame window calculations", () => {
  const slots = [
    { visualSlotId: "slot-01", startSeconds: 0, endSeconds: 5.03, durationSeconds: 5.03 },
    { visualSlotId: "slot-02", startSeconds: 5.03, endSeconds: 10.11, durationSeconds: 5.08 }
  ];
  const windows = buildFrameWindows(slots, 24);
  assert.equal(windows[0].startFrame, 0);
  assert.equal(windows[0].endFrame, 121); // round(5.03*24) = 120.72 -> 121
  assert.equal(windows[0].frameCount, 121);

  // Verify boundary difference <= 1 frame
  // 121 / 24 = 5.0416... -> diff = 5.0416 - 5.03 = 0.0116s (less than 1/24 = 0.0416s)
  assert(Math.abs(slots[0].endSeconds - (121 / 24)) <= (1 / 24));
});

test("exact timeline end matching", () => {
  assert.doesNotThrow(() => assertExactTimelineEnd(18.42, 18.42));
  assert.doesNotThrow(() => assertExactTimelineEnd(18.42, 18.46)); // diff 0.04 <= 0.05
  assert.throws(() => assertExactTimelineEnd(18.42, 18.48), /differs/); // diff 0.06 > 0.05
});
