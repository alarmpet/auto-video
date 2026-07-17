import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inspectPng } from "../../scripts/lib/yadam/images/raster-inspector.mjs";
import { decideCritic } from "../../scripts/lib/yadam/images/visual-qa.mjs";
import sharp from "sharp";

async function coloredPng(width = 1024, height = 576) {
  const channels = 4;
  const data = Buffer.alloc(width * height * channels);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    data[pixel * channels] = 128 + (pixel % 120);
    data[pixel * channels + 1] = 64 + (pixel % 120);
    data[pixel * channels + 2] = 96 + (pixel % 120);
    data[pixel * channels + 3] = 255;
  }
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

test("raster inspector accepts exact colored PNG", async () => {
  const bytes = await coloredPng();
  const result = await inspectPng({ assetId: "slot-001", bytes, expectedWidth: 1024, expectedHeight: 576, colorPixelRatioMin: 0.1, duplicateOwners: new Map() });
  assert.equal(result.status, "pass");
  assert.equal(result.width, 1024);
  assert.equal(result.height, 576);
  assert.equal(result.failures.length, 0);
});

test("another asset cannot reuse identical pixels", async () => {
  const bytes = await coloredPng();
  const first = await inspectPng({ assetId: "slot-001", bytes, expectedWidth: 1024, expectedHeight: 576, colorPixelRatioMin: 0.1, duplicateOwners: new Map() });
  const duplicateOwners = new Map([[first.sha256, "slot-000"]]);
  const result = await inspectPng({ assetId: "slot-001", bytes, expectedWidth: 1024, expectedHeight: 576, colorPixelRatioMin: 0.1, duplicateOwners });
  assert.deepEqual(result.failures, ["duplicate_pixels"]);
});

test("decideCritic checks thresholds and flags correctly", () => {
  const thresholds = { contextMin: 7, identityMin: 6, eraWardrobeMin: 7, colorStyleMin: 7 };
  const mockRequest = { identity: { characterId: "char" }, purpose: "scene" };
  const mockResult = {
    status: "ok",
    value: {
      scores: { contextMatch: 8, focalCharacterMatch: 7, eraWardrobeMatch: 8, colorStyleMatch: 8 },
      flags: {
        requiredFocalSubjectPresent: true,
        unexpectedFocalSubject: false,
        readableText: false,
        watermark: false,
        modernObject: false,
        severeAnatomyDefect: false,
        minorSafetyViolation: false,
        reservedTextRectClear: null,
        faceInTextRect: null,
        criticalObjectInTextRect: null,
        subjectPlacementMatch: null
      }
    }
  };
  const dec = decideCritic({ request: mockRequest, result: mockResult, thresholds });
  assert.equal(dec.status, "pass");
});
