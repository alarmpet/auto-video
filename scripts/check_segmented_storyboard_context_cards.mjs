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
writeFileSync(join(sourceDir, "production.json"), JSON.stringify({
  project: { title: "야곱은 왜 사랑받고도 불안했을까" },
  render: { target_seconds: 180 },
}, null, 2), "utf8");

const result = spawnSync(process.execPath, [
  join(root, "scripts", "build_segmented_storyboards.mjs"),
  "--source-slug", sourceSlug,
  "--slug", targetSlug,
  "--target-seconds", "180",
  "--segment-minutes", "15",
  "--skip-script-quality",
], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, AUTO_VIDEO_ALLOW_TEST_BYPASS: "1" },
});

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
