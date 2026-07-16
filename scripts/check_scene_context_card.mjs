#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  buildSceneContextCard,
  compileContextPrompt,
  scorePromptContextAlignment,
  extractSceneDetails,
} from "./lib/scene-context-card.mjs";

// --- Basic extraction ---------------------------------------------------
const narration = "야곱은 장막 안에서 사랑받고 있었지만 마음 깊은 곳에서는 아직 선택받지 못한 사람처럼 숨고 있었습니다. 그는 에서와 비교될 때마다 인정받고 싶은 마음에 흔들렸습니다.";
const card = buildSceneContextCard({ narration, order: 1, topic: "야곱은 왜 사랑받고도 불안했을까" });

assert.equal(card.order, 1);
assert(card.biblicalCharacters.includes("Jacob"), "Jacob must be detected from 야곱");
assert(card.biblicalCharacters.includes("Esau"), "Esau must be detected from 에서");
assert.equal(card.psychologyConcept, "need for recognition and comparison anxiety");
assert(/tent/.test(card.setting), "narration mentioning 장막 must map to a tent setting");
assert(card.visualFocus, "visual focus must be present");
assert(card.visualFocus.primaryTerms.length > 0, "visual focus must prioritize context terms");
assert(card.requirements.sourceAnchors.includes("야곱"), "source anchors must include Korean keyword");
assert(card.requirements.requiredPromptTerms.some((term) => /recognition anxiety|comparison anxiety|oil lamp|family tent/i.test(term)), "required prompt terms must include context terms");
assert(card.sceneDetails.every((d) => /^[\x20-\x7E]+$/.test(d)), "scene details must be English visual phrases");

// --- Prompt compilation --------------------------------------------------
const style = "strict pure black and white only, grayscale biblical oil painting, restful negative space";
const prompt = compileContextPrompt({ card, style });

assert(prompt.includes("Jacob"), "prompt must include biblical character");
assert(prompt.includes("recognition anxiety"), "prompt must include psychology anchor");
assert(prompt.includes("strict pure black and white"), "prompt must include style");
assert(!prompt.includes("purple"), "prompt must not include color drift");

// Dedupe: no comma-token may appear twice (v1 duplicated the style tail).
const tokens = prompt.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
assert.equal(tokens.length, new Set(tokens).size, "prompt must not contain duplicate tokens");

// No Korean noise in the compiled prompt (v1 injected Korean particles).
assert(!/[\p{Script=Hangul}]/u.test(prompt), "prompt must not contain Korean tokens");

const score = scorePromptContextAlignment({ card, prompt });
assert.equal(score.ok, true);
assert(score.score >= 85, `expected score >=85, got ${score.score}`);

// --- Scene-level variation (the v1 bug: all scenes identical) ------------
const narrations = [
  "야곱은 장막 안에서 어머니 리브가의 사랑을 받았습니다. 그러나 인정받고 싶은 마음은 그대로였습니다.",
  "에서는 들판에서 사냥을 마치고 몹시 지쳐 돌아왔습니다. 팥죽 냄새가 장막에 번졌습니다.",
  "야곱은 형의 축복을 대신 받기 위해 염소 털로 팔을 감쌌습니다. 문턱 앞에서 손이 떨렸습니다.",
  "그날 밤 야곱은 광야에서 돌베개를 베고 누웠고, 별이 가득한 하늘 아래에서 사다리 꿈을 꾸었습니다.",
  "얍복 나루에서 야곱은 어둠 속의 존재와 밤새 씨름했습니다.",
];
const cards = [];
for (const [i, n] of narrations.entries()) {
  cards.push(buildSceneContextCard({ narration: n, order: i + 1, topic: "야곱", previous: cards.at(-1) || null }));
}
const settings = cards.map((c) => c.setting);
const anchors = cards.map((c) => c.visualAnchor);
assert(new Set(settings).size >= 3, `expected >=3 distinct settings, got: ${JSON.stringify(settings)}`);
assert(new Set(anchors).size === anchors.length, "visual anchors must differ scene to scene");
for (let i = 1; i < cards.length; i += 1) {
  assert(cards[i].visualAnchor !== cards[i - 1].visualAnchor, `adjacent scenes ${i} share identical visual anchor`);
}

// Scene details must reflect narration content.
assert(extractSceneDetails("팥죽 한 그릇과 등불").some((d) => /stew|lamp/.test(d)), "detail lexicon must map concrete nouns");

// --- Alignment guard still works -----------------------------------------
const generic = scorePromptContextAlignment({
  card,
  prompt: "ancient desert, black and white, calm biblical mood, wide shot",
});
assert.equal(generic.ok, false);

const negative = scorePromptContextAlignment({
  card,
  prompt: `${prompt}, purple glow, readable text on screen`,
});
assert.equal(negative.ok, false);
assert(negative.failures.includes("negative_term_present:purple"));
assert(negative.failures.includes("negative_term_present:readable text"));

// Context-first visual focus: character names are metadata, while concrete
// sentence anchors should lead prompt generation when they exist.
const elijahCard = buildSceneContextCard({
  narration: "엘리야는 갈멜산의 승리 뒤에 로뎀나무 아래에서 지쳐 쓰러졌고, 호렙에서 세미한 소리를 들었습니다.",
  order: 99,
  topic: "엘리야는 왜 승리한 뒤에 무너졌을까 | 번아웃과 외로움의 심리",
});
assert.ok(elijahCard.biblicalCharacters.includes("Elijah"));
assert.ok(elijahCard.visualAnchor.includes("broom tree") || elijahCard.visualAnchor.includes("Horeb") || elijahCard.visualAnchor.includes("Carmel"));
assert.ok(elijahCard.visualFocus);
assert.equal(elijahCard.visualFocus.mode, "context_anchor");
assert.ok(elijahCard.visualFocus.primaryTerms.some((term) => /broom tree|Horeb|Carmel|exhaustion|still small voice/i.test(term)));
assert.ok(elijahCard.requirements.requiredPromptTerms.some((term) => /broom tree|Horeb|Carmel|exhaustion|still small voice/i.test(term)));
assert.ok(
  !elijahCard.requirements.requiredPromptTerms.includes("Elijah")
  || elijahCard.requirements.requiredPromptTerms.indexOf("Elijah") > 0,
);
const elijahPrompt = compileContextPrompt({ card: elijahCard, style });
assert.ok(/broom tree|Horeb|Carmel|exhaustion|still small voice/i.test(elijahPrompt));
assert.ok(!/^Elijah\b/i.test(elijahPrompt), "prompt must not begin as a character portrait when concrete context anchors exist");

// Visual beats from the source sentence must outrank generic psychology symbols.
const saulNarration = "사울은 여인들의 노래를 들었습니다. 사울이 죽인 자는 천천이요 다윗은 만만이라는 말이 마음을 흔들었습니다.";
const saulBeat = {
  kind: "scripture_event",
  event: "Saul hears women comparing him with David after battle",
  characters: ["Saul", "David"],
  anchors: ["Saul", "David", "public comparison song"],
  requiredPromptTerms: [
    "Saul hearing women sing",
    "David praised in the distance",
    "public comparison song",
  ],
  forbiddenGenericOnlyTerms: ["oil lamp", "family tent", "empty sleeping mat"],
};
const saulCard = buildSceneContextCard({
  narration: saulNarration,
  order: 88,
  topic: "열등감과 자기방어의 심리",
  visualBeat: saulBeat,
});
const saulPrompt = compileContextPrompt({
  card: saulCard,
  style: "strict pure black and white only, grayscale biblical oil painting",
});

assert.ok(saulCard.biblicalCharacters.includes("Saul"));
assert.ok(saulCard.biblicalCharacters.includes("David"));
assert.ok(saulCard.visualAnchor.includes("Saul hearing women sing"));
assert.ok(saulCard.visualAnchor.includes("public comparison song"));
assert.ok(saulPrompt.includes("David praised in the distance"));
assert.ok(!saulPrompt.startsWith("oil lamp"));

console.log("check_scene_context_card: pass");
