#!/usr/bin/env node
// Keyframe visual-similarity gate (post-render).
//
// Computes a 64-bit dHash for every keyframe PNG via ffmpeg (9x8 grayscale
// downscale, horizontal gradient) and fails when adjacent keyframes are
// near-duplicates or too many global duplicates exist.
//
// Usage:
//   node scripts/check_keyframe_similarity.mjs --keyframes-dir <dir-with-pngs>
//     [--min-adjacent-distance 8] [--max-duplicate-pairs 0]
//     [--duplicate-distance 5] [--out <report.json>]
//
// dHash Hamming distance guide: 0-5 near duplicate, 6-10 similar, >10 distinct.

import { execFileSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = parseArgs(process.argv.slice(2));
if (!args.keyframesDir) {
  console.error("Usage: node scripts/check_keyframe_similarity.mjs --keyframes-dir <dir>");
  process.exit(2);
}
const MIN_ADJACENT = Number(args.minAdjacentDistance ?? 8);
const DUP_DISTANCE = Number(args.duplicateDistance ?? 5);
const MAX_DUP_PAIRS = Number(args.maxDuplicatePairs ?? 0);

const files = readdirSync(args.keyframesDir)
  .filter((name) => /\.(png|jpg|jpeg)$/i.test(name))
  .sort();
if (files.length < 2) {
  console.error(`Need at least 2 keyframes in ${args.keyframesDir}, found ${files.length}`);
  process.exit(2);
}

const hashes = files.map((name) => ({ name, hash: dHash(join(args.keyframesDir, name)) }));

const failures = [];
const adjacent = [];
for (let i = 1; i < hashes.length; i += 1) {
  const distance = hamming(hashes[i - 1].hash, hashes[i].hash);
  adjacent.push({ a: hashes[i - 1].name, b: hashes[i].name, distance });
  if (distance < MIN_ADJACENT) {
    failures.push({ type: "adjacent_keyframes_too_similar", a: hashes[i - 1].name, b: hashes[i].name, distance, limit: MIN_ADJACENT });
  }
}

const duplicatePairs = [];
for (let i = 0; i < hashes.length; i += 1) {
  for (let j = i + 1; j < hashes.length; j += 1) {
    const distance = hamming(hashes[i].hash, hashes[j].hash);
    if (distance <= DUP_DISTANCE) duplicatePairs.push({ a: hashes[i].name, b: hashes[j].name, distance });
  }
}
if (duplicatePairs.length > MAX_DUP_PAIRS) {
  failures.push({ type: "too_many_duplicate_keyframes", count: duplicatePairs.length, limit: MAX_DUP_PAIRS, samples: duplicatePairs.slice(0, 10) });
}

const report = {
  keyframesDir: args.keyframesDir,
  keyframeCount: files.length,
  thresholds: { MIN_ADJACENT, DUP_DISTANCE, MAX_DUP_PAIRS },
  adjacentDistances: adjacent,
  duplicatePairCount: duplicatePairs.length,
  failures,
  ok: failures.length === 0,
};
if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify({ ...report, adjacentDistances: report.adjacentDistances.slice(0, 60) }, null, 2));
process.exit(report.ok ? 0 : 1);

function dHash(imagePath) {
  // 9x8 grayscale raw bytes -> 8x8 horizontal gradient bits.
  const raw = execFileSync("ffmpeg", [
    "-v", "error",
    "-i", imagePath,
    "-vf", "scale=9:8:flags=area,format=gray",
    "-frames:v", "1",
    "-f", "rawvideo",
    "-",
  ], { maxBuffer: 1024 * 1024 });
  if (raw.length < 72) throw new Error(`Unexpected raw size ${raw.length} for ${imagePath}`);
  const bits = [];
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      bits.push(raw[y * 9 + x] > raw[y * 9 + x + 1] ? 1 : 0);
    }
  }
  return bits;
}

function hamming(a, b) {
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) distance += 1;
  return distance;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--keyframes-dir") parsed.keyframesDir = argv[++i];
    else if (argv[i] === "--min-adjacent-distance") parsed.minAdjacentDistance = argv[++i];
    else if (argv[i] === "--duplicate-distance") parsed.duplicateDistance = argv[++i];
    else if (argv[i] === "--max-duplicate-pairs") parsed.maxDuplicatePairs = argv[++i];
    else if (argv[i] === "--out") parsed.out = argv[++i];
  }
  return parsed;
}
