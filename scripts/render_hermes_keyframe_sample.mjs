#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const hermesRoot = resolve(__dirname, "../../hermes-studio/hermes-local");

async function hermesImport(relativePath) {
  return import(pathToFileURL(join(hermesRoot, relativePath)).href);
}

const { values } = parseArgs({
  options: {
    "export-dir": { type: "string" },
    count: { type: "string", default: "3" },
    seconds: { type: "string", default: "90" },
  },
});

if (!values["export-dir"]) {
  console.error("Usage: node scripts/render_hermes_keyframe_sample.mjs --export-dir <path> [--count 3] [--seconds 90]");
  process.exit(2);
}

const exportDir = resolve(values["export-dir"]);
const count = Math.max(1, Number(values.count) || 3);
const targetSeconds = Math.max(1, Number(values.seconds) || 90);
const storyboardPath = join(exportDir, "hermes-manual-storyboard.md");
if (!existsSync(storyboardPath)) {
  console.error(`Missing manual storyboard: ${storyboardPath}`);
  process.exit(2);
}

const { loadConfig } = await hermesImport("lib/config.mjs");
const { parseManualStoryboardText } = await hermesImport("lib/manual-storyboard/parser.mjs");
const { buildManualStoryboardPlan } = await hermesImport("lib/manual-storyboard/storyboard-plan.mjs");
const { createComfyImage } = await hermesImport("lib/providers/comfyui-image.mjs");
const { createKeyframeGenerator } = await hermesImport("lib/visual/keyframe-generator.mjs");

const cfg = loadConfig();
const parsed = parseManualStoryboardText(readFileSync(storyboardPath, "utf8"));
const storyboardPlan = buildManualStoryboardPlan({
  title: "Gguljam Bible Keyframe Sample",
  parsed,
  targetSeconds,
});

storyboardPlan.style_preset = "calm-scripture";
storyboardPlan.visual_language = "black and white painterly biblical oil illustration";
storyboardPlan.scenes = storyboardPlan.scenes.slice(0, count).map((scene) => ({
  ...scene,
  keyframe_engine: "flux",
  keyframe_profile: "semantic-minimal",
  image_workflow: cfg.render?.fluxLineart?.workflow || "assets/flux_lineart_t2i_fluxencode.json",
  split_encoding: true,
}));
storyboardPlan.expected_scene_count = storyboardPlan.scenes.length;
storyboardPlan.expected_orders = storyboardPlan.scenes.map((scene) => scene.narration_refs?.[0]).filter(Boolean);

const comfyImage = createComfyImage({
  comfyui: {
    ...(cfg.video?.comfyui || {}),
    pythonPath: cfg.video?.depthParallax?.pythonPath,
  },
  illustration: {
    ...(cfg.illustration || {}),
    baseUrl: (cfg.illustration && cfg.illustration.baseUrl) || cfg.video?.comfyui?.baseUrl,
  },
  render: cfg.render,
});

const jobDir = join(exportDir, "validation", "keyframe-sample");
mkdirSync(jobDir, { recursive: true });

const generator = createKeyframeGenerator({ imageProvider: comfyImage });
const ready = await generator.ready();
if (!ready || ready.ok === false) {
  console.error("ComfyUI keyframe provider is not ready:");
  console.error(JSON.stringify(ready, null, 2));
  process.exit(1);
}

const visualStyle = {
  id: "gguljam-bible-monochrome",
  stylePreset: "calm-scripture",
  keyframeEngine: "flux",
  imageWorkflow: cfg.render?.fluxLineart?.workflow || "assets/flux_lineart_t2i_fluxencode.json",
  splitEncoding: true,
  triggerPrefix: "black and white painterly biblical illustration, heavy oil brush texture, cinematic chiaroscuro",
  negative: "text, watermark, modern ui, bright saturated colors, horror, gore",
  candidateCount: 1,
};

const result = await generator.generate({
  storyboardPlan,
  jobDir,
  mode: "render",
  width: 1024,
  height: 576,
  visualStyle,
});

const summary = {
  exportDir,
  storyboardPath,
  jobDir,
  manifestPath: result.manifestPath,
  previewPath: result.previewPath,
  requestedCount: count,
  summary: result.manifest.summary,
  scenes: result.manifest.scenes.map((scene) => ({
    scene_id: scene.scene_id,
    status: scene.status,
    output_path: scene.output_path,
    errorCode: scene.errorCode,
    error: scene.error,
  })),
};

const reportJson = join(exportDir, "validation", "keyframe-sample-report.json");
const reportMd = join(exportDir, "validation", "keyframe-sample-report.md");
writeFileSync(reportJson, JSON.stringify(summary, null, 2), "utf8");
writeFileSync(reportMd, renderMarkdown(summary), "utf8");

if (typeof generator.freeMemory === "function") {
  await generator.freeMemory({ stage: "auto-video-keyframe-sample" }).catch(() => null);
}

console.log(`Keyframe sample rendered: ${summary.summary.rendered}/${summary.summary.attempted}`);
console.log(reportJson);
process.exit(summary.summary.rendered === summary.summary.attempted ? 0 : 1);

function renderMarkdown(report) {
  const lines = [
    "# Hermes Keyframe Sample Report",
    "",
    `- Requested scenes: \`${report.requestedCount}\``,
    `- Rendered: \`${report.summary.rendered}/${report.summary.attempted}\``,
    `- Failed: \`${report.summary.failed}\``,
    `- Missing files: \`${report.summary.missingFiles}\``,
    `- Manifest: \`${report.manifestPath}\``,
    `- Preview: \`${report.previewPath}\``,
    "",
    "## Scenes",
    "",
  ];
  for (const scene of report.scenes) {
    lines.push(`- ${scene.scene_id}: ${scene.status} ${scene.output_path || ""}${scene.errorCode ? ` (${scene.errorCode})` : ""}`);
  }
  return `${lines.join("\n")}\n`;
}
