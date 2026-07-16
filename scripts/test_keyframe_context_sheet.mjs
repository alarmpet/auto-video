#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const root = join(process.cwd(), "tmp-keyframe-context-sheet");
const segmentDir = join(root, "segment");
const keyframesDir = join(root, "keyframes");
mkdirSync(segmentDir, { recursive: true });
mkdirSync(keyframesDir, { recursive: true });

writeFileSync(join(segmentDir, "visual-timeline.json"), JSON.stringify({
  scenes: [
    {
      order: 1,
      narration: "사울은 여인들의 노래를 들었습니다.",
      requiredPromptTerms: ["Saul hearing women sing"],
    },
  ],
}), "utf8");
writeFileSync(join(segmentDir, "hermes-manual-storyboard.md"), [
  "[사울은 여인들의 노래를 들었습니다.]",
  "Saul hearing women sing, David praised in the distance / duration:30",
].join("\n"), "utf8");

execFileSync("ffmpeg", [
  "-y",
  "-f", "lavfi",
  "-i", "color=c=white:s=320x180",
  "-frames:v", "1",
  join(keyframesDir, "scene_001.png"),
], { stdio: "ignore" });

const result = spawnSync("node", [
  "scripts/check_keyframe_context_sheet.mjs",
  "--segment-dir", segmentDir,
  "--keyframes-dir", keyframesDir,
  "--out-dir", join(root, "qa"),
], { cwd: process.cwd(), encoding: "utf8" });

assert.equal(result.status, 0, result.stdout + result.stderr);
const report = JSON.parse(readFileSync(join(root, "qa", "keyframe-context-report.json"), "utf8"));
assert.equal(report.ok, true);
assert.equal(report.scenes.length, 1);
assert.equal(report.scenes[0].requiredPromptTerms[0], "Saul hearing women sing");
assert.match(report.scenes[0].keyframePath, /scene_001\.png$/);

console.log("test_keyframe_context_sheet: pass");
