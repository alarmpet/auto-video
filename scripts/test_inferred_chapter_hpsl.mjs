#!/usr/bin/env node
import assert from "node:assert/strict";
import { analyzeScriptStructure } from "./lib/script-structure-analysis.mjs";
import { analyzeScriptHpsl } from "./lib/hpsl-structure-analysis.mjs";

const paragraphs = [
  "왜 야곱은 사랑받고도 불안했을까요? 이 질문은 오늘 밤 우리 마음에도 조용히 남습니다.",
  "이 장면은 인정 욕구가 어떻게 마음을 흔드는지를 보여 줍니다. 사랑을 받아도 확인하고 싶은 마음이 남을 수 있다는 것입니다.",
  "야곱은 장막 앞에서 등불을 바라보았고, 돌베개 곁에서 광야의 별을 보았습니다. 그는 걸었고, 멈추었고, 손을 붙잡았습니다.",
  "오늘 밤 당신도 불안하다면 괜찮습니다. 그 마음을 너무 빨리 밀어내지 말고 조용히 바라봅니다.",
  "왜 마음은 축복을 받고도 다시 흔들릴까요? 이 질문은 오래된 비교의 습관을 보여 줍니다.",
  "비교는 내가 사라질 것 같다는 두려움에서 시작되는 경우가 많습니다. 그래서 사람은 더 강하게 붙잡으려 합니다.",
  "야곱은 광야를 걸었고, 차가운 돌 위에 누웠고, 밤하늘을 바라보았습니다. 그의 몸은 멈추었지만 마음은 계속 움직였습니다.",
  "혹시 당신도 오늘 밤 누군가와 자신을 비교하고 있다면 괜찮습니다. 잠시 숨을 고르고 마음을 쉬게 해도 됩니다.",
];
const script = paragraphs.join("\n\n");

const structure = analyzeScriptStructure(script, { minChapters: 2, inferChapters: true });
assert.equal(structure.ok, true, JSON.stringify(structure, null, 2));
assert.equal(structure.chapterCount, 2, JSON.stringify(structure, null, 2));
assert(structure.chapters.every((chapter) => chapter.inferred === true), "chapters should be inferred");

const hpsl = analyzeScriptHpsl(script, { minChapterPassRate: 1, minChapters: 2, inferChapters: true });
assert.equal(hpsl.ok, true, JSON.stringify(hpsl, null, 2));
assert.equal(hpsl.chapterCount, 2, JSON.stringify(hpsl, null, 2));

console.log("test_inferred_chapter_hpsl: pass");
