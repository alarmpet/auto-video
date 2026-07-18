#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const exportDir = process.argv[2];
if (!exportDir) {
  console.error("Usage: node scripts/check_audio_speed_profile.mjs <segmented-export-dir>");
  process.exit(2);
}

const manifestPath = join(exportDir, "segment-manifest.json");
if (!existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const failures = [];
const warnings = [];
const segments = [];
let checkedCount = 0;

const isYadam = manifest.profileId === "yadam";

for (const segment of manifest.segments || []) {
  const segId = isYadam ? segment.segmentId : segment.id;
  const segmentDir = isYadam ? join(exportDir, segment.dir) : segment.dir;
  const reportPath = join(segmentDir, "manual-assembly", "assembly-report.json");
  if (!existsSync(reportPath)) {
    warnings.push(`${segId}: missing assembly-report.json`);
    continue;
  }

  checkedCount += 1;
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const factor = Number(report.audioTempoFactor || 1);
  const raw = Number(report.rawVoiceSeconds || report.totalVoiceSeconds || 0);
  const final = Number(report.totalVoiceSeconds || 0);
  const target = isYadam ? Number(segment.finalDurationSeconds || 0) : Number(segment.durationSeconds || 0);

  segments.push({
    id: segId,
    rawVoiceSeconds: raw,
    finalVoiceSeconds: final,
    targetSeconds: target,
    audioTempoFactor: factor,
  });

  if (isYadam) {
    if (Math.abs(factor - 1) > 0.001) {
      failures.push(`${segId}: audioTempoFactor ${factor.toFixed(4)} deviates from 1.0 by more than 0.001`);
    }
  } else {
    if (factor > 1.18) failures.push(`${segId}: audioTempoFactor ${factor.toFixed(3)} is too fast`);
    if (factor < 0.92) failures.push(`${segId}: audioTempoFactor ${factor.toFixed(3)} is too slow`);
  }
}

if (checkedCount === 0) failures.push("no rendered segment assembly-report.json files found");

const result = {
  ok: failures.length === 0,
  failures,
  warnings,
  checkedCount,
  segments,
};
mkdirSync(join(exportDir, "validation"), { recursive: true });
writeFileSync(join(exportDir, "validation", "audio-speed-profile.json"), JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
