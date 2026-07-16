#!/usr/bin/env node
import { join } from "node:path";
import { buildCapCutQaManifest, detectCapCutTools } from "./lib/capcut-draft-adapter.mjs";

const exportDir = process.argv[2];
if (!exportDir) {
  console.error("Usage: node scripts/export_capcut_draft.mjs <segmented-export-dir>");
  process.exit(2);
}

const outputDir = join(exportDir, "capcut-draft");
const tools = detectCapCutTools();
const { manifestPath, manifest } = buildCapCutQaManifest({ exportDir, outputDir });

console.log(JSON.stringify({
  outputDir,
  manifestPath,
  tools,
  manifestFormat: manifest.format,
  segmentCount: manifest.segments.length,
}, null, 2));
