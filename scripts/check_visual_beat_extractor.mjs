#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  buildVisualBeat,
  extractVisualAnchors,
  classifyVisualBeat,
} from "./lib/visual-beat-extractor.mjs";

const songText = "사무엘상 18장 7절에서 여인들이 노래하여 이르되 사울이 죽인 자는 천천이요 다윗은 만만이라고 했습니다.";
const songBeat = buildVisualBeat({ narration: songText, order: 1 });

assert.equal(songBeat.kind, "scripture_event");
assert.equal(songBeat.event, "Saul hears women comparing him with David after battle");
assert.deepEqual(songBeat.characters, ["Saul", "David"]);
assert.ok(songBeat.requiredPromptTerms.includes("Saul hearing women sing"));
assert.ok(songBeat.requiredPromptTerms.includes("David praised in the distance"));
assert.ok(songBeat.requiredPromptTerms.includes("public comparison song"));
assert.ok(songBeat.forbiddenGenericOnlyTerms.includes("oil lamp"));
assert.ok(songBeat.forbiddenGenericOnlyTerms.includes("empty sleeping mat"));

const spearText = "사울은 다윗을 주목하기 시작했고, 악신이 임하자 손에 든 창으로 다윗을 치려 했습니다.";
const spearBeat = buildVisualBeat({ narration: spearText, order: 2 });

assert.equal(spearBeat.kind, "biblical_conflict");
assert.equal(spearBeat.event, "Saul's suspicion turns toward violence against David");
assert.ok(spearBeat.requiredPromptTerms.includes("spear near Saul's hand"));
assert.ok(spearBeat.requiredPromptTerms.includes("David in danger"));
assert.ok(spearBeat.requiredPromptTerms.includes("royal chamber tension"));

const lyreText = "다윗은 수금을 타며 사울의 마음을 진정시키려 했습니다.";
const lyreBeat = buildVisualBeat({ narration: lyreText, order: 3 });
assert.notEqual(lyreBeat.event, "Saul's suspicion turns toward violence against David");
assert.ok(extractVisualAnchors(lyreText).includes("lyre"));

const genericFearText = "사람은 누군가의 시선을 두려워할 때 마음이 방어적으로 변합니다.";
assert.notEqual(classifyVisualBeat(genericFearText), "scripture_event");

const psychologyText = "누군가의 칭찬이 내 자리를 빼앗는 소리처럼 들릴 때 마음은 방어 자세를 취합니다.";
const psychologyBeat = buildVisualBeat({ narration: psychologyText, order: 4 });

assert.equal(psychologyBeat.kind, "modern_psychology");
assert.ok(psychologyBeat.requiredPromptTerms.includes("one person praised while another withdraws"));
assert.ok(psychologyBeat.requiredPromptTerms.includes("empty-feeling seat"));
assert.ok(psychologyBeat.requiredPromptTerms.includes("defensive posture"));

assert.equal(classifyVisualBeat(songText), "scripture_event");
assert.equal(classifyVisualBeat(spearText), "biblical_conflict");
assert.equal(classifyVisualBeat(psychologyText), "modern_psychology");

const anchors = extractVisualAnchors("사울과 다윗과 창과 수금과 왕궁과 굴과 겉옷 자락이 한 문단에 있습니다.");
assert.ok(anchors.includes("Saul"));
assert.ok(anchors.includes("David"));
assert.ok(anchors.includes("spear"));
assert.ok(anchors.includes("lyre"));
assert.ok(anchors.includes("royal chamber"));
assert.ok(anchors.includes("cave"));
assert.ok(anchors.includes("cut edge of Saul's robe"));

console.log("check_visual_beat_extractor: pass");
