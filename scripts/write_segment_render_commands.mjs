#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = parseArgs(process.argv.slice(2));
const exportDir = args.exportDir;
if (!exportDir) {
  console.error("Usage: node scripts/write_segment_render_commands.mjs --export-dir <segmented-export>");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(join(exportDir, "segment-manifest.json"), "utf8"));
if (!Array.isArray(manifest.segments) || !manifest.segments.length) {
  throw new Error("segment-manifest.json must contain a non-empty segments array");
}

const commands = [];
for (const segment of manifest.segments) {
  if (!segment.id || !segment.dir) {
    throw new Error(`Invalid segment manifest entry: ${JSON.stringify(segment)}`);
  }
  const segmentDir = segment.dir;
  const runDir = join(segmentDir, "hermes-run");
  mkdirSync(runDir, { recursive: true });
  commands.push({
    id: segment.id,
    segmentDir,
    storyboardPath: join(segmentDir, "hermes-manual-storyboard.md"),
    scriptPath: join(segmentDir, "script.txt"),
    expectedFinalPath: join(segmentDir, "manual-assembly", "final.mp4"),
    notes: [
      "Run Hermes for this segment using the segment script/storyboard.",
      "After Hermes creates a job directory, run the assembly command with that job dir.",
      "The assembly command must keep --final-name final.mp4 because concat expects manual-assembly/final.mp4.",
    ],
    assembleCommand: [
      "node",
      quotePowerShell("C:\\Users\\petbl\\auto-video\\scripts\\assemble_cain_fast_from_hermes_job.mjs"),
      "--job-dir",
      `<HERMES_JOB_DIR_FOR_${segment.id}>`,
      "--export-dir",
      quotePowerShell(segmentDir),
      "--final-name",
      "final.mp4",
    ].join(" "),
  });
}

writeFileSync(join(exportDir, "segment-render-commands.json"), JSON.stringify(commands, null, 2), "utf8");
console.log(JSON.stringify({ exportDir, commandCount: commands.length }, null, 2));

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--export-dir") parsed.exportDir = argv[++i];
  }
  return parsed;
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
