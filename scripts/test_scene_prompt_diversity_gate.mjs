#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempDir = join(tmpdir(), `auto-video-diversity-${Date.now()}`);
const segmentDir = join(tempDir, "segments", "segment-01");
mkdirSync(segmentDir, { recursive: true });
writeFileSync(join(segmentDir, "hermes-manual-storyboard.md"), [
  "[첫 장면]",
  "Jacob in a tent, strict pure black and white only / wide shot / moonlight / calm / slow push / duration:6",
  "",
  "[둘째 장면]",
  "Jacob in a tent, strict pure black and white only / wide shot / moonlight / calm / slow push / duration:6",
  "",
].join("\n"), "utf8");

let failed = false;
try {
  execFileSync("node", ["scripts/check_scene_prompt_diversity.mjs", "--export-dir", tempDir], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
} catch (error) {
  failed = true;
  const output = `${error.stdout || ""}${error.stderr || ""}`;
  assert(output.includes("missing_visual_context_cards"), output);
}

assert.equal(failed, true, "diversity gate must fail when visual-context-cards.json is missing");
console.log("test_scene_prompt_diversity_gate: pass");
