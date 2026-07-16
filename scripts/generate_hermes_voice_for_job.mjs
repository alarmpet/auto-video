import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createVoice } from "../../hermes-studio/hermes-local/lib/agents/voice.mjs";
import { loadConfig } from "../../hermes-studio/hermes-local/lib/config.mjs";
import { createSupertonic } from "../../hermes-studio/hermes-local/lib/providers/supertonic.mjs";
import { buildTtsNormalizationReport } from "../../hermes-studio/hermes-local/lib/tts/report.mjs";
import { evaluateTtsSyncGate } from "../../hermes-studio/hermes-local/lib/tts/sync-gate.mjs";

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--job-dir") parsed.jobDir = argv[++i];
    else if (arg === "--voice") parsed.voice = argv[++i];
    else if (arg === "--speed") parsed.speed = Number(argv[++i]);
    else if (arg === "--silence-duration") parsed.silenceDuration = Number(argv[++i]);
    else if (arg === "--continuous-silence-duration") parsed.continuousSilenceDuration = Number(argv[++i]);
    else if (arg === "--scripture-speed") parsed.scriptureSpeed = Number(argv[++i]);
  }
  return parsed;
}

const args = parseArgs(process.argv.slice(2));
if (!args.jobDir) {
  console.error("Usage: node scripts/generate_hermes_voice_for_job.mjs --job-dir <hermes-job-dir> [--voice F1]");
  process.exit(2);
}

const jobDir = resolve(args.jobDir);
const scenePlan = JSON.parse(readFileSync(join(jobDir, "sceneplan.json"), "utf8"));
const scenes = scenePlan.scenes || [];
if (!scenes.length) {
  throw new Error(`No scenes found in ${join(jobDir, "sceneplan.json")}`);
}

const cfg = loadConfig();
cfg.tts = cfg.tts || {};
if (Number.isFinite(args.speed)) {
  cfg.tts.speed = args.speed;
  cfg.tts.numberSensitiveSpeed = args.speed;
}
if (Number.isFinite(args.scriptureSpeed)) cfg.tts.scriptureSpeed = args.scriptureSpeed;
else if (Number.isFinite(args.speed)) cfg.tts.scriptureSpeed = args.speed;
if (Number.isFinite(args.silenceDuration)) cfg.tts.silenceDuration = args.silenceDuration;
if (Number.isFinite(args.continuousSilenceDuration)) {
  cfg.tts.continuousSilenceDuration = args.continuousSilenceDuration;
}
const voiceDir = join(jobDir, "voice");
mkdirSync(voiceDir, { recursive: true });

const supertonic = createSupertonic(cfg.tts || {});
const voiceAgent = createVoice(supertonic, cfg.tts || {});
const assets = await voiceAgent.generateAll({
  scenes,
  voiceDir,
  voice: args.voice || cfg.tts?.voice,
});

const normalization = buildTtsNormalizationReport(assets);
const syncGate = evaluateTtsSyncGate(normalization, cfg?.tts?.syncPolicy || {});
writeFileSync(join(jobDir, "voice-assets.json"), JSON.stringify(assets, null, 2), "utf8");
writeFileSync(join(jobDir, "tts-normalization-report.json"), JSON.stringify(normalization, null, 2), "utf8");
writeFileSync(join(jobDir, "tts-sync-gate.json"), JSON.stringify(syncGate, null, 2), "utf8");

const failed = assets.filter((asset) => asset.status !== "ok");
console.log(JSON.stringify({
  jobDir,
  scenes: scenes.length,
  ok: assets.length - failed.length,
  failed: failed.map((asset) => ({ order: asset.order, error: asset.error })),
  ttsOptions: {
    speed: cfg.tts.speed,
    numberSensitiveSpeed: cfg.tts.numberSensitiveSpeed,
    scriptureSpeed: cfg.tts.scriptureSpeed,
    silenceDuration: cfg.tts.silenceDuration,
    continuousSilenceDuration: cfg.tts.continuousSilenceDuration,
  },
  ttsSyncGate: syncGate,
}, null, 2));

if (failed.length) process.exit(1);
