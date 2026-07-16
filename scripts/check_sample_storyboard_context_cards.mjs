#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = "C:/Users/petbl/auto-video";
const slug = "jacob-context-card-smoke";
const run = spawnSync(process.execPath, [
  join(root, "scripts", "build_jacob_20min_sample_export.mjs"),
  "--slug", slug,
  "--target-seconds", "1200",
], { cwd: root, encoding: "utf8" });
assert.equal(run.status, 0, run.stderr || run.stdout);

const segmentDir = join(root, "exports", slug, "segments", "segment-01");
assert(existsSync(join(segmentDir, "visual-context-cards.json")), "sample must write visual-context-cards.json");
const storyboard = readFileSync(join(segmentDir, "hermes-manual-storyboard.md"), "utf8");
assert(storyboard.includes("Jacob"), "Jacob sample storyboard must include Jacob");
assert(storyboard.includes("recognition anxiety") || storyboard.includes("comparison anxiety"), "Jacob sample storyboard must include psychology concept");
assert(storyboard.includes("duration:"), "sample storyboard must preserve duration tags");

console.log("check_sample_storyboard_context_cards: pass");
