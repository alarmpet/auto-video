#!/usr/bin/env node
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArgs(process.argv.slice(2));
const root = resolve(options.root || process.env.AUTO_VIDEO_ROOT || defaultRoot);
const hermesRoot = resolve(options.hermesRoot || process.env.HERMES_STUDIO_ROOT || join(root, "..", "hermes-studio"));
const hermesLocal = join(hermesRoot, "hermes-local");

const required = [
  join(root, "auto-video.md"),
  join(root, "scripts", "check_script_quality_suite.mjs"),
  join(root, "scripts", "generate_script_revision_brief.mjs"),
  join(root, "scripts", "check_hpsl_structure.mjs"),
  join(root, "scripts", "lib", "hpsl-structure-analysis.mjs"),
  join(root, "scripts", "lib", "script-structure-analysis.mjs"),
  join(root, "scripts", "lib", "semantic-overlap-analysis.mjs"),
  join(root, "scripts", "validate_segmented_export.py"),
  join(root, "scripts", "concat_segments.mjs"),
  join(root, "docs", "agent-handoff-contract.md"),
  join(root, "docs", "agent-invocation-templates.md"),
  join(root, "docs", "pipeline-artifact-map.md"),
];

const optional = [
  join(hermesRoot, "research.md"),
  join(hermesRoot, "timeline.md"),
  join(hermesLocal, "data", "visual-memory.duckdb"),
  join(hermesLocal, "package.json"),
];

const report = {
  ok: true,
  failures: [],
  warnings: [],
  required: required.map(fileReport),
  optional: optional.map(fileReport),
  roots: {
    autoVideo: root,
    hermesStudio: hermesRoot,
    hermesLocal,
  },
};

for (const item of report.required) {
  if (!item.exists) {
    report.ok = false;
    report.failures.push(`missing_required:${item.path}`);
  }
}

for (const item of report.optional) {
  if (!item.exists) report.warnings.push(`missing_optional:${item.path}`);
}

const visualMemory = report.optional.find((item) => item.path.endsWith("visual-memory.duckdb"));
if (visualMemory?.exists) {
  report.warnings.push("visual_memory_db_present: do not let subagents open it directly; use orchestrator/Hermes reports to avoid DuckDB lock conflicts");
}

if (options.out) {
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);

function fileReport(path) {
  let bytes = null;
  let mtime = null;
  const exists = existsSync(path);
  if (exists) {
    const stat = statSync(path);
    bytes = stat.size;
    mtime = stat.mtime.toISOString();
  }
  return { path, exists, bytes, mtime };
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") parsed.out = readValue(args, ++index, arg);
    else if (arg === "--root") parsed.root = readValue(args, ++index, arg);
    else if (arg === "--hermes-root") parsed.hermesRoot = readValue(args, ++index, arg);
  }
  return parsed;
}

function readValue(args, index, optionName) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${optionName} requires a value`);
  return value;
}
