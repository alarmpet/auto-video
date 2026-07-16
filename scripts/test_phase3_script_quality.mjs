#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyzePhase3ScriptQuality } from "./lib/phase3-script-quality.mjs";

const weakScript = [
  "불안은 마음의 문제입니다. 감정은 복잡하고 관계는 어렵습니다. 우리는 심리를 생각합니다.",
  "불안은 마음의 문제입니다. 감정은 복잡하고 관계는 어렵습니다. 우리는 심리를 생각합니다.",
  "불안은 마음의 문제입니다. 감정은 복잡하고 관계는 어렵습니다. 우리는 심리를 생각합니다.",
].join("\n\n");

const strongScript = [
  "장막 앞에는 작은 등불 하나가 흔들리고 있었습니다. 야곱은 돌베개 곁에 앉아 먼 광야의 별을 바라보았습니다. 그 밤의 긴장은 말보다 먼저 몸에 내려앉았습니다.",
  "여기서 마음의 질문이 생깁니다. 사랑을 받는데도 왜 사람은 자꾸 확인하고 싶어질까요? 여러분도 오늘 밤 작은 시선 하나에 마음이 흔들린 적이 있다면, 그 장면은 아주 낯설지만은 않을 것입니다.",
  "처음에는 작은 비교였습니다. 그러나 그 비교가 오래 머물자 야곱은 축복을 기다리는 사람이 아니라, 축복을 붙잡아야만 사라지지 않을 것 같은 사람이 되어 갔습니다.",
  "그러나 광야의 밤은 다른 장면을 열어 줍니다. 돌베개 앞에 누운 사람에게 하늘은 닫히지 않았습니다. 혹시 당신도 불안이 있다면, 그 불안은 당신의 이름 전체가 아닙니다.",
  "오늘 밤 당신의 마음이 오래된 인정 욕구로 지쳐 있다면, 너무 빨리 스스로를 몰아세우지 않아도 괜찮습니다.",
].join("\n\n");

const weak = analyzePhase3ScriptQuality(weakScript);
assert.equal(weak.ok, false, "weak abstract/repetitive script must fail");
assert(hasFailure(weak, "concreteness"), JSON.stringify(weak.concreteness));
assert(hasFailure(weak, "argument_repetition"), JSON.stringify(weak.failures));
assert(hasFailure(weak, "tension_curve"), JSON.stringify(weak.failures));
assert(hasFailure(weak, "second_person_empathy"), JSON.stringify(weak.failures));

const strong = analyzePhase3ScriptQuality(strongScript, {
  minConcreteRatio: 0.12,
  maxRepeatedPointRatio: 0.34,
  minTensionStages: 4,
  minSecondPersonTouchpoints: 3,
});
assert.equal(strong.ok, true, JSON.stringify(strong, null, 2));

const tempDir = join(tmpdir(), `auto-video-phase3-${Date.now()}`);
mkdirSync(tempDir, { recursive: true });
const tempScript = join(tempDir, "script.txt");
const tempReport = join(tempDir, "report.json");
writeFileSync(tempScript, strongScript, "utf8");
execFileSync("node", [
  "scripts/check_script_quality_suite.mjs",
  tempScript,
  "--min-paragraphs",
  "1",
  "--min-chapters",
  "1",
  "--min-hpsl-pass-rate",
  "0",
  "--phase3-min-concrete-ratio",
  "0.12",
  "--phase3-min-second-person-touchpoints",
  "3",
  "--out",
  tempReport,
], { cwd: process.cwd(), stdio: "pipe" });
const suite = JSON.parse(execFileSync("node", ["-e", `console.log(require('fs').readFileSync(${JSON.stringify(tempReport)}, 'utf8'))`], { encoding: "utf8" }));
assert.equal(suite.phase3.ok, true, JSON.stringify(suite, null, 2));

console.log("test_phase3_script_quality: pass");

function hasFailure(report, prefix) {
  return report.failures.some((failure) => failure.split(":")[0] === prefix);
}
