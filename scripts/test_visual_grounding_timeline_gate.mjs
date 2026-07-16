#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "visual-grounding-gate-"));
const segmentDir = join(root, "segments", "segment-01");
mkdirSync(segmentDir, { recursive: true });

writeFileSync(join(segmentDir, "visual-timeline.json"), JSON.stringify({
  scenes: [
    { order: 1, startSeconds: 0, endSeconds: 6, durationSeconds: 6, timingBand: "opening", keywords: ["탈진", "승리"] },
    { order: 2, startSeconds: 6, endSeconds: 46, durationSeconds: 40, timingBand: "body", keywords: ["로뎀나무", "회복"] },
  ],
}, null, 2), "utf8");
writeFileSync(join(segmentDir, "visual-context-cards.json"), JSON.stringify({
  scenes: [
    { order: 1, requirements: { requiredPromptTerms: ["exhaustion", "collapse after sustained effort"], sourceAnchors: ["탈진"] } },
    { order: 2, requirements: { requiredPromptTerms: ["broom tree"], sourceAnchors: ["로뎀나무"] } },
  ],
}, null, 2), "utf8");
writeFileSync(join(segmentDir, "visual-grounding-report.json"), JSON.stringify({
  scenes: [
    { order: 1, timingBand: "opening", durationSeconds: 6, narration: "승리 이후 탈진한 마음이 조용히 무너졌습니다.", keywords: ["탈진", "승리"] },
    { order: 2, timingBand: "body", durationSeconds: 40, narration: "로뎀나무 아래에서 회복이 시작되었습니다.", keywords: ["로뎀나무", "회복"] },
  ],
}, null, 2), "utf8");
writeFileSync(join(segmentDir, "hermes-manual-storyboard.md"), [
  "[승리 이후 탈진한 마음이 조용히 무너졌습니다.]",
  "exhaustion after victory, collapse after sustained effort, strict pure black and white / wide shot / moonlight / calm / slow pan / duration:6",
  "",
  "[로뎀나무 아래에서 회복이 시작되었습니다.]",
  "broom tree in wilderness, quiet recovery, strict pure black and white / wide shot / dawn / tender / slow pan / duration:40",
  "",
].join("\n"), "utf8");

execFileSync("node", ["scripts/check_visual_grounding_timeline.mjs", "--segment-dir", segmentDir], { stdio: "inherit" });

writeFileSync(join(segmentDir, "hermes-manual-storyboard.md"), [
  "[승리 이후 탈진한 마음이 조용히 무너졌습니다.]",
  "Elijah standing alone as a generic biblical character portrait, strict pure black and white / wide shot / moonlight / calm / slow pan / duration:6",
  "",
  "[로뎀나무 아래에서 회복이 시작되었습니다.]",
  "generic desert landscape, strict pure black and white / wide shot / dawn / tender / slow pan / duration:40",
  "",
].join("\n"), "utf8");

let failed = false;
try {
  execFileSync("node", ["scripts/check_visual_grounding_timeline.mjs", "--segment-dir", segmentDir], { stdio: "pipe" });
} catch {
  failed = true;
}
assert.equal(failed, true, "generic or character-only prompts must fail grounding gate");

const saulDir = join(root, "segments", "saul-mismatch");
mkdirSync(saulDir, { recursive: true });
writeFileSync(join(saulDir, "visual-timeline.json"), JSON.stringify({
  scenes: [
    {
      order: 1,
      timingBand: "body",
      durationSeconds: 30,
      narration: "사울은 여인들의 노래를 들었습니다. 다윗은 만만이라는 말이 마음을 흔들었습니다.",
      keywords: ["사울", "여인", "노래", "다윗", "만만"],
      requiredPromptTerms: ["Saul hearing women sing", "David praised in the distance", "public comparison song"],
    },
  ],
}), "utf8");
writeFileSync(join(saulDir, "visual-context-cards.json"), JSON.stringify({
  scenes: [
    {
      order: 1,
      requirements: {
        requiredPromptTerms: ["oil lamp", "comparison anxiety"],
        negativePromptTerms: ["readable text"],
      },
    },
  ],
}), "utf8");
writeFileSync(join(saulDir, "visual-grounding-report.json"), JSON.stringify({
  scenes: [
    {
      order: 1,
      narration: "사울은 여인들의 노래를 들었습니다. 다윗은 만만이라는 말이 마음을 흔들었습니다.",
      keywords: ["사울", "여인", "노래", "다윗", "만만"],
    },
  ],
}), "utf8");
writeFileSync(join(saulDir, "hermes-manual-storyboard.md"), [
  "[사울은 여인들의 노래를 들었습니다.]",
  "oil lamp, empty sleeping mat, recognition anxiety, black and white / duration:30",
].join("\n"), "utf8");

try {
  execFileSync("node", ["scripts/check_visual_grounding_timeline.mjs", "--segment-dir", saulDir], { stdio: "pipe" });
  throw new Error("expected source-derived Saul-David mismatch to fail");
} catch (error) {
  const output = String(error.stdout || "") + String(error.stderr || "") + String(error.message || "");
  assert.match(output, /missing_source_required_prompt_term:Saul hearing women sing/);
  assert.match(output, /generic_prompt_without_source_anchor/);
}

console.log("test_visual_grounding_timeline_gate: pass");
