#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  buildSentenceGroundedVisualTimeline,
  extractChunkKeywords,
  splitKoreanSentences,
} from "./lib/sentence-grounded-visual-timeline.mjs";

const openingScript = [
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
const bodySentence = "하나님은 무너진 사람에게 먼저 이유를 묻지 않으시고 떡과 물을 주셨습니다.";
const bodyScript = Array.from({ length: 60 }, (_, index) => `${bodySentence} ${index + 1}.`).join(" ");
const script = `${openingScript}\n\n${bodyScript}`;

const scenes = buildSentenceGroundedVisualTimeline({
  script,
  targetSeconds: 180,
  globalStartSeconds: 0,
  openingSeconds: 60,
  openingSceneSeconds: 6,
  bodyMinSeconds: 20,
  bodyTargetSeconds: 30,
  bodyMaxSeconds: 40,
  charsPerSecond: 5.2,
});

assert.deepEqual(splitKoreanSentences("첫 문장입니다. 두 번째 질문일까요? 마지막입니다.").map((s) => s.at(-1)), [".", "?", "."]);
assert.equal(scenes.filter((scene) => scene.timingBand === "opening").length, 10);
assert.ok(scenes.slice(0, 10).every((scene) => scene.durationSeconds <= 6.1));
assert.ok(scenes.slice(0, 10).every((scene) => scene.narration.length > 0));

const bodyScenes = scenes.filter((scene) => scene.timingBand === "body");
assert.ok(bodyScenes.length > 0);
assert.ok(bodyScenes.every((scene, index) => scene.durationSeconds >= 20 || index === bodyScenes.length - 1));
assert.ok(bodyScenes.every((scene) => scene.durationSeconds <= 40.5));
assert.ok(bodyScenes.every((scene) => /떡|물|무너진|하나님/.test(scene.narration)));

const secondSegmentScenes = buildSentenceGroundedVisualTimeline({
  script: bodyScript,
  targetSeconds: 180,
  globalStartSeconds: 900,
  openingSeconds: 60,
  openingSceneSeconds: 6,
  bodyMinSeconds: 20,
  bodyTargetSeconds: 30,
  bodyMaxSeconds: 40,
  charsPerSecond: 5.2,
});
assert.ok(secondSegmentScenes.every((scene) => scene.timingBand === "body"));
assert.ok(secondSegmentScenes.every((scene) => scene.globalStartSeconds >= 900));

const keywords = extractChunkKeywords("엘리야는 로뎀나무 아래에서 지친 마음으로 잠들었습니다.");
assert.ok(keywords.includes("엘리야"));
assert.ok(keywords.includes("로뎀나무"));
assert.ok(keywords.includes("지친"));

console.log("test_sentence_grounded_visual_timeline: pass");
