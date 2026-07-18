#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { KENBURNS_MOVES } from "./lib/kenburns-motion.mjs";

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("Usage: node scripts/check_motion_manifest.mjs <assembly-report.json>");
  process.exit(2);
}

const resolvedReportPath = resolve(reportPath);
const report = JSON.parse(readFileSync(resolvedReportPath, "utf8"));
const reportDir = dirname(resolvedReportPath);
const groups = Array.isArray(report.visualGroups) ? report.visualGroups : [];
const failures = [];
const motions = groups.map((group) => group.motion);
const unique = new Set(motions.filter(Boolean));

if (!groups.length) failures.push("visualGroups missing or empty");
if (motions.filter(Boolean).length !== groups.length) {
  failures.push(`motion_count_mismatch:${motions.filter(Boolean).length}<${groups.length}`);
}
for (const motion of motions) {
  if (motion && !KENBURNS_MOVES.includes(motion)) failures.push(`unknown_motion:${motion}`);
}
for (let index = 1; index < motions.length; index += 1) {
  if (motions[index] && motions[index] === motions[index - 1]) {
    failures.push(`consecutive_motion_repeat:${index}:${motions[index]}`);
  }
}
if (groups.length >= 10 && unique.size < 5) failures.push(`motion_variety_too_low:${unique.size}<5`);

const isYadam = report.profileId === "yadam";

for (const [index, group] of groups.entries()) {
  const oneBased = index + 1;
  const duration = Number(group.duration || group.actualFrameDuration);
  const fps = Number(group.fps);
  const zoomAmount = Number(group.zoomAmount);
  const effectiveZoom = Number(group.effectiveZoom);

  if (isYadam) {
    if (!group.visualSlotId) failures.push(`missing_visualSlotId:${oneBased}`);
    if (Number(group.timelineScale) !== 1) failures.push(`invalid_timelineScale:${oneBased}`);
    
    const mStart = Number(group.manifestStart);
    const mEnd = Number(group.manifestEnd);
    const aStart = Number(group.actualFrameStart) / fps;
    const aEnd = Number(group.actualFrameEnd) / fps;
    
    if (Math.abs(mStart - aStart) > 1/fps + 0.001 || Math.abs(mEnd - aEnd) > 1/fps + 0.001) {
      failures.push(`boundary_error_exceeds_one_frame:${oneBased}`);
    }
  }

  if (!Number.isFinite(duration) || duration <= 0) failures.push(`invalid_duration:${oneBased}`);
  if (!Number.isFinite(fps) || fps <= 0) failures.push(`invalid_fps:${oneBased}`);
  if (!isYadam) {
    if (!Number.isFinite(zoomAmount) || zoomAmount <= 0 || zoomAmount > 0.12) failures.push(`invalid_zoom_amount:${oneBased}`);
    if (!Number.isFinite(effectiveZoom) || effectiveZoom <= 0 || effectiveZoom > 0.12) failures.push(`invalid_effective_zoom:${oneBased}`);
    if (group.travelZoom !== null && group.travelZoom !== undefined) {
      const travelZoom = Number(group.travelZoom);
      if (!Number.isFinite(travelZoom) || travelZoom <= 0 || travelZoom > 0.12) {
        failures.push(`invalid_travel_zoom:${oneBased}`);
      }
    }
  }
  if (!group.clip) {
    failures.push(`missing_clip:${oneBased}`);
  } else {
    const clipPath = join(reportDir, "motion-clips", group.clip);
    if (!existsSync(clipPath)) {
      failures.push(`missing_clip_file:${oneBased}:${clipPath}`);
    } else {
      const clipDuration = safeFfprobeDuration(clipPath);
      if (clipDuration === null) {
        failures.push(`unreadable_clip_duration:${oneBased}`);
      } else if (Math.abs(clipDuration - duration) > Math.max(0.75, duration * 0.03)) {
        failures.push(`clip_duration_mismatch:${oneBased}:${clipDuration.toFixed(3)}!=${duration.toFixed(3)}`);
      }
    }
  }
}

const result = {
  ok: failures.length === 0,
  failures,
  groupCount: groups.length,
  uniqueMotions: [...unique],
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

function safeFfprobeDuration(path) {
  try {
    const value = execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      path,
    ], { encoding: "utf8" }).trim();
    const duration = Number(value);
    return Number.isFinite(duration) ? duration : null;
  } catch {
    return null;
  }
}
