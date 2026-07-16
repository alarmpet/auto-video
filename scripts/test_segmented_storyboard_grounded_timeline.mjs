#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "grounded-storyboard-"));
const sourceSlug = "source-grounded";
const slug = "target-grounded";
const sourceDir = join(root, "exports", sourceSlug);
mkdirSync(sourceDir, { recursive: true });

const opening = [
  "이 밤에는 한 집 안에서 시작된 아주 오래된 마음의 이야기를 조용히 펼쳐 보겠습니다.",
  "엘리야는 갈멜산에서 놀라운 승리를 보았습니다.",
  "하늘에서 불이 내려왔고 사람들은 숨을 삼켰습니다.",
  "모든 것이 끝난 것처럼 보였습니다.",
  "하지만 이야기는 승리의 자리에서 끝나지 않았습니다.",
  "그 다음 장면에서 우리는 지친 마음을 만납니다.",
  "사람은 왜 크게 이긴 뒤에 무너질까요.",
  "오래 버틴 마음은 왜 안심하지 못할까요.",
  "문제가 해결되었는데도 왜 마음은 떨릴까요.",
  "오늘의 이야기는 그 질문을 부드럽게 여는 시간입니다.",
].join(" ");
const body = Array.from({ length: 18 }, (_, index) => (
  `하나님은 로뎀나무 아래에서 지친 사람에게 떡과 물을 주시며 회복의 반복을 가르치십니다 ${index + 1}.`
)).join(" ");
writeFileSync(join(sourceDir, "script.txt"), `${opening}\n\n${body}\n`, "utf8");
writeFileSync(join(sourceDir, "production.json"), JSON.stringify({
  project: { title: "엘리야 번아웃 테스트" },
}, null, 2), "utf8");

execFileSync("node", [
  "scripts/build_segmented_storyboards.mjs",
  "--source-slug", sourceSlug,
  "--slug", slug,
  "--target-seconds", "180",
  "--segment-minutes", "10",
  "--skip-script-quality",
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AUTO_VIDEO_ROOT: root,
    AUTO_VIDEO_ALLOW_TEST_BYPASS: "1",
  },
  stdio: "inherit",
});

const exportDir = join(root, "exports", slug);
const segmentDir = join(exportDir, "segments", "segment-01");
const production = JSON.parse(readFileSync(join(exportDir, "production.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(exportDir, "segment-manifest.json"), "utf8"));
const timeline = JSON.parse(readFileSync(join(segmentDir, "visual-timeline.json"), "utf8"));
const visualBeats = JSON.parse(readFileSync(join(segmentDir, "visual-beats.json"), "utf8"));
const cards = JSON.parse(readFileSync(join(segmentDir, "visual-context-cards.json"), "utf8"));
const storyboard = readFileSync(join(segmentDir, "hermes-manual-storyboard.md"), "utf8");
const report = JSON.parse(readFileSync(join(segmentDir, "visual-grounding-report.json"), "utf8"));

assert.equal(timeline.scenes.length, cards.scenes.length);
assert.ok(timeline.scenes.every((scene) => typeof scene.narration === "string" && scene.narration.length > 0));
assert.equal(visualBeats.scenes.length, timeline.scenes.length);
assert.ok(visualBeats.scenes.every((scene) => Array.isArray(scene.requiredPromptTerms)));
assert.ok(timeline.scenes.every((scene) => Array.isArray(scene.requiredPromptTerms)));
assert.equal((storyboard.match(/^\[/gm) || []).length, timeline.scenes.length);
assert.equal(timeline.scenes.filter((scene) => scene.timingBand === "opening").length, 10);
assert.ok(timeline.scenes.filter((scene) => scene.timingBand === "body").every((scene, index, arr) => (
  scene.durationSeconds >= 20 || index === arr.length - 1
)));
assert.ok(timeline.scenes.filter((scene) => scene.timingBand === "body").every((scene) => scene.durationSeconds <= 40.5));
assert.ok(report.scenes.every((scene) => scene.narration && scene.keywords.length > 0));
assert.equal(production.totalSceneCount, timeline.scenes.length);
assert.equal(manifest.segments[0].sceneCount, timeline.scenes.length);
assert.ok(storyboard.includes("broom tree") || storyboard.includes("bread") || storyboard.includes("water"));

console.log("test_segmented_storyboard_grounded_timeline: pass");
