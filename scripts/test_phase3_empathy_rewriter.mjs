#!/usr/bin/env node
import assert from "node:assert/strict";
import { analyzePhase3ScriptQuality } from "./lib/phase3-script-quality.mjs";
import { reinforcePhase3Empathy } from "./lib/phase3-empathy-rewriter.mjs";

const segmentScript = [
  "장막 앞에는 작은 등불 하나가 흔들렸습니다. 야곱은 돌베개 곁에서 광야의 별을 바라보았습니다.",
  "그는 사랑을 받았지만 마음 깊은 곳에서는 여전히 비교와 불안을 느꼈습니다.",
  "축복을 붙잡고 싶었던 마음은 결국 속임수라는 어두운 길로 그를 데려갔습니다.",
  "그러나 광야의 밤은 그 마음을 완전히 버리지 않고 조용히 다시 불러 세웠습니다.",
].join("\n\n");

const before = analyzePhase3ScriptQuality(segmentScript, {
  minTensionStages: 3,
  minSecondPersonTouchpoints: 3,
});
assert.equal(before.secondPersonEmpathy.ok, false, "fixture should start below empathy threshold");

const rewritten = reinforcePhase3Empathy(segmentScript, {
  minSecondPersonTouchpoints: 3,
});
assert.notEqual(rewritten.text, segmentScript, "rewriter should insert empathy passages");
assert(rewritten.insertedParagraphs.length >= 1, "rewriter should report inserted paragraphs");
assert(rewritten.text.includes("오늘 밤 당신"), "rewriter should use sleep-listener address");
assert(rewritten.text.includes("괜찮습니다"), "rewriter should include gentle reassurance");

const after = analyzePhase3ScriptQuality(rewritten.text, {
  minTensionStages: 3,
  minSecondPersonTouchpoints: 3,
});
assert.equal(after.secondPersonEmpathy.ok, true, JSON.stringify(after.secondPersonEmpathy, null, 2));

console.log("test_phase3_empathy_rewriter: pass");
