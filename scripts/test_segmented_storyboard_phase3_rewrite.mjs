#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = "C:/Users/petbl/auto-video";
const stamp = Date.now();
const sourceSlug = `__phase3-rewrite-source-${stamp}`;
const outSlug = `__phase3-rewrite-out-${stamp}`;
const sourceDir = join(root, "exports", sourceSlug);
mkdirSync(sourceDir, { recursive: true });

const paragraphs = Array.from({ length: 14 }, (_, index) => (
  `장막 앞에는 작은 등불이 흔들렸습니다. 야곱은 돌베개 곁에서 광야의 별을 바라보았습니다. ` +
  `그의 마음에는 비교와 불안, 사랑받고 싶은 마음이 조용히 남아 있었습니다. ` +
  `축복을 기다리는 시간은 길었고, ${index + 1}번째 밤의 침묵은 더욱 깊어졌습니다.`
));
writeFileSync(join(sourceDir, "script.txt"), `${paragraphs.join("\n\n")}\n`, "utf8");
writeFileSync(join(sourceDir, "production.json"), JSON.stringify({
  project: { title: "phase3 rewrite fixture", target_minutes: 3 },
  render: { target_seconds: 180 },
}, null, 2), "utf8");

execFileSync("node", [
  "scripts/build_segmented_storyboards.mjs",
  "--source-slug",
  sourceSlug,
  "--slug",
  outSlug,
  "--target-seconds",
  "180",
  "--segment-minutes",
  "3",
  "--target-chars-per-second",
  "12",
  "--skip-script-quality",
], {
  cwd: root,
  env: { ...process.env, AUTO_VIDEO_ALLOW_TEST_BYPASS: "1" },
  stdio: "pipe",
});

const segmentScript = readFileSync(join(root, "exports", outSlug, "segments", "segment-01", "script.txt"), "utf8");
assert(segmentScript.includes("오늘 밤 당신"), "segmented builder should persist phase3 empathy reinforcement");
assert(segmentScript.includes("괜찮습니다"), "reinforcement should include gentle reassurance");

console.log("test_segmented_storyboard_phase3_rewrite: pass");
