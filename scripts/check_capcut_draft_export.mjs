#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const exportDir = process.argv[2];
if (!exportDir) {
  console.error("Usage: node scripts/check_capcut_draft_export.mjs <segmented-export-dir>");
  process.exit(2);
}

const manifestPath = join(exportDir, "capcut-draft", "capcut-draft-manifest.json");
if (!existsSync(manifestPath)) throw new Error(`Missing CapCut QA manifest: ${manifestPath}`);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const failures = [];
let totalDuration = 0;
let cueCount = 0;
const seenIds = new Set();

if (manifest.format !== "auto-video-capcut-qa-manifest-only-v1") {
  failures.push(`unexpected manifest format: ${manifest.format}`);
}
if (!Array.isArray(manifest.segments) || manifest.segments.length === 0) {
  failures.push("manifest.segments must be a non-empty array");
}

for (const segment of manifest.segments || []) {
  if (!segment.id || seenIds.has(segment.id)) failures.push(`invalid or duplicate segment id: ${segment.id}`);
  seenIds.add(segment.id);
  if (!Number.isFinite(Number(segment.durationSeconds)) || Number(segment.durationSeconds) <= 0) {
    failures.push(`${segment.id}: invalid durationSeconds ${segment.durationSeconds}`);
  }

  for (const field of ["finalPath", "srtPath", "timelinePath"]) {
    if (!segment[field] || !existsSync(segment[field])) {
      failures.push(`${segment.id}: missing ${field}: ${segment[field]}`);
    }
  }

  if (segment.finalPath && existsSync(segment.finalPath)) {
    const duration = safeFfprobeDuration(segment.finalPath);
    if (duration === null) failures.push(`${segment.id}: ffprobe duration failed`);
    else totalDuration += duration;
  }

  if (segment.srtPath && existsSync(segment.srtPath)) {
    const segmentCueCount = countSrtCues(segment.srtPath);
    if (segmentCueCount <= 0) failures.push(`${segment.id}: no subtitle cues found`);
    cueCount += segmentCueCount;
  }

  if (segment.timelinePath && existsSync(segment.timelinePath)) {
    const timeline = JSON.parse(readFileSync(segment.timelinePath, "utf8"));
    const scenes = Array.isArray(timeline.scenes) ? timeline.scenes : [];
    if (!scenes.length) {
      failures.push(`${segment.id}: timeline scenes must be non-empty`);
    } else {
      const end = Number(scenes.at(-1)?.endSeconds || 0);
      if (Math.abs(end - Number(segment.durationSeconds || 0)) > 0.01) {
        failures.push(`${segment.id}: timeline end ${end} != segment duration ${segment.durationSeconds}`);
      }
    }
  }
}

if (cueCount <= 0) failures.push("no subtitle cues found in any segment");

const result = {
  ok: failures.length === 0,
  failures,
  segmentCount: manifest.segments?.length || 0,
  totalDuration,
  cueCount,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

function safeFfprobeDuration(path) {
  try {
    const value = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
      { encoding: "utf8" },
    ).trim();
    const duration = Number(value);
    return Number.isFinite(duration) ? duration : null;
  } catch {
    return null;
  }
}

function countSrtCues(path) {
  const text = readFileSync(path, "utf8");
  return (text.match(/-->/g) || []).length;
}
