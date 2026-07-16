#!/usr/bin/env node
import assert from "node:assert/strict";
import { analyzeScriptHpsl } from "./lib/hpsl-structure-analysis.mjs";
import { reinforceHpslStructure } from "./lib/hpsl-rewriter.mjs";

const weakScript = [
  "야곱은 장막 앞에서 등불을 바라보았습니다. 그는 광야의 별을 보았습니다.",
  "그는 걸었고, 멈추었고, 손을 붙잡았습니다. 마음은 오래 흔들렸습니다.",
  "야곱은 돌베개 곁에 앉았습니다. 밤하늘은 조용했습니다.",
  "그는 다시 걸었습니다. 장막의 그림자는 길게 남았습니다.",
  "야곱은 광야를 지나갔습니다. 바람은 차갑게 불었습니다.",
  "그는 차가운 돌 위에 누웠습니다. 몸은 멈추었지만 마음은 움직였습니다.",
  "그는 멀리 있는 불빛을 바라보았습니다. 손끝에는 긴장이 남아 있었습니다.",
  "야곱은 다시 길 위에 섰습니다. 밤은 깊었습니다.",
].join("\n\n");

const before = analyzeScriptHpsl(weakScript, { minChapterPassRate: 1, minChapters: 2, inferChapters: true });
assert.equal(before.ok, false, "fixture should start below HPSL threshold");

const rewritten = reinforceHpslStructure(weakScript, {
  minChapters: 2,
  minChapterPassRate: 1,
});
assert.notEqual(rewritten.text, weakScript, "rewriter should insert HPSL passages");
assert(rewritten.insertedParagraphs.length >= 2, "rewriter should report inserted passages");
assert(rewritten.text.includes("이 질문은"), "rewriter should insert point language");
assert(rewritten.text.includes("괜찮습니다"), "rewriter should insert lesson language");

const after = analyzeScriptHpsl(rewritten.text, { minChapterPassRate: 1, minChapters: 2, inferChapters: true });
assert.equal(after.ok, true, JSON.stringify(after, null, 2));

console.log("test_hpsl_rewriter: pass");
