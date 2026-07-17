import test from "node:test";
import assert from "node:assert/strict";
import { rectsOverlap, normalizedRectToPixels, validateCopy } from "../../scripts/lib/yadam/images/thumbnail-compositor.mjs";

test("one-pixel protected overlap is rejected", () => {
  const text = { x: 64, y: 72, width: 500, height: 560 };
  const protectedRect = { x: 563, y: 200, width: 100, height: 100 };
  assert.equal(rectsOverlap(text, protectedRect), true);
});

test("touching edges without shared pixels is allowed", () => {
  const text = { x: 64, y: 72, width: 500, height: 560 };
  const protectedRect = { x: 564, y: 200, width: 100, height: 100 };
  assert.equal(rectsOverlap(text, protectedRect), false);
});

test("normalizedRectToPixels calculates exact coords", () => {
  const canvas = { width: 1280, height: 720 };
  const rect = [0.1, 0.2, 0.3, 0.4];
  const pixelRect = normalizedRectToPixels(rect, canvas);
  assert.equal(pixelRect.x, 128);
  assert.equal(pixelRect.y, 144);
  assert.equal(pixelRect.width, 384);
  assert.equal(pixelRect.height, 288);
});

test("validateCopy throws on exact text mismatch", () => {
  const option = { copyId: "copy-1", exactText: "Line 1\nLine 2", lines: ["Line 1", "Line 2"], geometry: { maxLineCount: 3 } };
  const selection = { copyId: "copy-1", exactText: "Line 1\nDifferent" };
  assert.throws(() => validateCopy(option, selection), error => error.code === "thumbnail_copy_mismatch");
});
