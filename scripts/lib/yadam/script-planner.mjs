// scripts/lib/yadam/script-planner.mjs
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { loadJob } from "../pipeline/job-store.mjs";
import { writeCanonicalJson } from "../pipeline/atomic-store.mjs";
import { registerArtifact } from "../pipeline/artifact-store.mjs";
import { transitionJob } from "../pipeline/state-machine.mjs";
import { hashCanonical } from "../pipeline/canonical-json.mjs";

function plannerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function validateTargetMinutes(minutes) {
  if (typeof minutes !== "number" || minutes < 10 || minutes > 120 || minutes % 10 !== 0) {
    throw plannerError("target_minutes_invalid", "targetMinutes must be 10..120 in 10-minute steps");
  }
  return minutes;
}

export function partitionBeatsContiguously(weights, segmentCount) {
  const N = weights.length;
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const targetWeight = totalWeight / segmentCount;

  const memo = {};
  function solve(index, remainingSegments) {
    const key = `${index},${remainingSegments}`;
    if (key in memo) return memo[key];

    if (remainingSegments === 1) {
      let sum = 0;
      for (let i = index; i < N; i++) sum += weights[i];
      const cost = Math.pow(sum - targetWeight, 2);
      return { cost, cuts: [] };
    }

    let bestCost = Infinity;
    let bestCuts = [];

    for (let i = index + 1; i <= N - remainingSegments + 1; i++) {
      let sum = 0;
      for (let j = index; j < i; j++) sum += weights[j];
      const currentCost = Math.pow(sum - targetWeight, 2);

      const sub = solve(i, remainingSegments - 1);
      const totalCost = currentCost + sub.cost;

      if (totalCost < bestCost) {
        bestCost = totalCost;
        bestCuts = [i, ...sub.cuts];
      } else if (Math.abs(totalCost - bestCost) < 1e-9) {
        const candidateCuts = [i, ...sub.cuts];
        if (compareCuts(candidateCuts, bestCuts) < 0) {
          bestCuts = candidateCuts;
        }
      }
    }

    memo[key] = { cost: bestCost, cuts: bestCuts };
    return memo[key];
  }

  function compareCuts(a, b) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return a.length - b.length;
  }

  const res = solve(0, segmentCount);
  const segments = [];
  let start = 0;
  const cuts = [...res.cuts, N];
  for (let k = 0; k < segmentCount; k++) {
    const end = cuts[k];
    const indices = [];
    for (let i = start; i < end; i++) {
      indices.push(i);
    }
    segments.push(indices);
    start = end;
  }
  return segments;
}

export function buildDurationPlan(targetMinutes, calibratedCharactersPerSecond = 4.2) {
  const totalCharacters = Math.round(targetMinutes * 60 * calibratedCharactersPerSecond);
  const items = [
    { id: "intro", weight: 0.01 },
    { id: "beat-01", weight: 0.03 },
    { id: "beat-02", weight: 0.04 },
    { id: "beat-03", weight: 0.11 },
    { id: "beat-04", weight: 0.04 },
    { id: "beat-05", weight: 0.08 },
    { id: "beat-06", weight: 0.03 },
    { id: "beat-07", weight: 0.06 },
    { id: "beat-08", weight: 0.18 },
    { id: "beat-09", weight: 0.04 },
    { id: "beat-10", weight: 0.12 },
    { id: "beat-11", weight: 0.03 },
    { id: "beat-12", weight: 0.04 },
    { id: "beat-13", weight: 0.02 },
    { id: "beat-14", weight: 0.13 },
    { id: "beat-15", weight: 0.02 },
    { id: "ending", weight: 0.02 }
  ];

  const sumWeights = items.reduce((a, b) => a + b.weight, 0);

  let allocatedSum = 0;
  const allocations = items.map(item => {
    const raw = (item.weight / sumWeights) * totalCharacters;
    const floored = Math.floor(raw);
    allocatedSum += floored;
    return {
      id: item.id,
      raw,
      floored,
      remainder: raw - floored
    };
  });

  const remaining = totalCharacters - allocatedSum;
  const sortedAllocations = [...allocations].sort((a, b) => {
    if (Math.abs(a.remainder - b.remainder) > 1e-9) {
      return b.remainder - a.remainder;
    }
    return a.id.localeCompare(b.id);
  });

  for (let i = 0; i < remaining; i++) {
    const itemToIncrement = sortedAllocations[i];
    const orig = allocations.find(a => a.id === itemToIncrement.id);
    orig.floored += 1;
  }

  return allocations.reduce((acc, item) => {
    acc[item.id] = item.floored;
    return acc;
  }, {});
}

export async function buildScriptPlan({ jobDir }) {
  const context = await loadJob(jobDir);
  const { request } = context;
  const targetMinutes = validateTargetMinutes(request.targetMinutes);

  const bibleRecord = context.manifest.artifacts.find(a => a.logicalRole === "yadam.story.bible");
  if (!bibleRecord) throw plannerError("story_bible_missing", "Story bible is missing");

  const outlineRecord = context.manifest.artifacts.find(a => a.logicalRole === "yadam.outline");
  if (!outlineRecord) throw plannerError("outline_missing", "Outline is missing");

  const outlineBytes = await readFile(join(jobDir, outlineRecord.path));
  const outline = JSON.parse(outlineBytes.toString("utf8"));

  const segmentCount = targetMinutes / 10;
  const beatWeights = [0.03, 0.04, 0.11, 0.04, 0.08, 0.03, 0.06, 0.18, 0.04, 0.12, 0.03, 0.04, 0.02, 0.13, 0.02];
  const beatPartitions = partitionBeatsContiguously(beatWeights, segmentCount);

  const charAllocations = buildDurationPlan(targetMinutes);

  const segments = [];
  for (let sIdx = 0; sIdx < segmentCount; sIdx++) {
    const segmentId = `segment-${String(sIdx + 1).padStart(2, "0")}`;
    const beatIndices = beatPartitions[sIdx];
    const beatsInSeg = beatIndices.map(idx => `beat-${String(idx + 1).padStart(2, "0")}`);
    
    // Calculate segment characters target
    let targetCharacters = 0;
    if (sIdx === 0) {
      targetCharacters += charAllocations.intro;
    }
    beatsInSeg.forEach(bId => {
      targetCharacters += charAllocations[bId];
    });
    if (sIdx === segmentCount - 1) {
      targetCharacters += charAllocations.ending;
    }

    // Map obligations
    const obligations = {
      twists: outline.twists.filter(t => beatsInSeg.includes(t.beatId) || (sIdx === 0 && t.beatId === "intro") || (sIdx === segmentCount - 1 && t.beatId === "ending")),
      emotionPoints: outline.emotionPoints.filter(e => beatsInSeg.includes(e.beatId) || (sIdx === 0 && e.beatId === "intro") || (sIdx === segmentCount - 1 && e.beatId === "ending")),
      themePlacements: outline.themePlacements.filter(tp => beatsInSeg.includes(tp.beatId) || (sIdx === 0 && tp.beatId === "intro") || (sIdx === segmentCount - 1 && tp.beatId === "ending")),
      foreshadowing: outline.foreshadowing.filter(f => beatsInSeg.includes(f.plantBeatId) || beatsInSeg.includes(f.recoveryBeatId)),
      finaleStages: outline.finaleStages.filter(fs => beatsInSeg.includes("beat-14")) // beat-14 is the finale beat
    };

    segments.push({
      segmentId,
      chapterIndex: sIdx + 1,
      beats: beatsInSeg,
      targetCharacters,
      obligations
    });
  }

  const approval1Record = context.manifest.artifacts.find(a => a.logicalRole === "yadam.approval.1");
  const bibleBytes = await readFile(join(jobDir, bibleRecord.path));
  const bible = JSON.parse(bibleBytes.toString("utf8"));

  const scriptPlan = {
    schemaVersion: "1.0.0",
    jobId: request.jobId,
    semanticContractHash: bible.semanticContractHash,
    storyBibleHash: bibleRecord.sha256,
    approvalOneRevision: bible.approvalOneRevision,
    approvalOneArtifactSetHash: bible.approvalOneArtifactSetHash,
    calibratedCharactersPerSecond: 4.2,
    planningDurationWarningSeconds: { minimum: 480, maximum: 720 },
    acceptedPostTtsRangeSeconds: { minimum: targetMinutes * 48, maximum: targetMinutes * 72 },
    segments
  };

  const scriptPlanPath = join(jobDir, "planning/script-plan.json");
  const planWrite = await writeCanonicalJson(scriptPlanPath, scriptPlan);
  const scriptPlanHash = planWrite.sha256;

  await registerArtifact(jobDir, {
    artifactId: "yadam-script-plan",
    logicalRole: "yadam.script.plan",
    path: "planning/script-plan.json",
    sha256: scriptPlanHash,
    schemaVersion: "1.0.0",
    producerStage: "script-planning",
    gateStatus: "pass",
    dependencyHashes: {
      "storyBible": bibleRecord.sha256,
      "outline": outlineRecord.sha256
    }
  });

  await transitionJob(jobDir, {
    stage: "SCRIPT_PLAN_READY",
    to: "running",
    inputHash: hashCanonical({
      stage: "script_plan",
      requestHash: sha256Bytes(await readFile(join(jobDir, "request.json"))),
      approvalRevisionHash: approval1Record?.sha256 || "0000000000000000000000000000000000000000000000000000000000000000",
      outlineHash: outlineRecord.sha256,
      storyBibleHash: bibleRecord.sha256,
      profileHash: context.state.profileHash || "0000000000000000000000000000000000000000000000000000000000000000",
      plannerVersionHash: "0000000000000000000000000000000000000000000000000000000000000000"
    }),
    outputHash: scriptPlanHash,
    artifactPaths: ["planning/script-plan.json"]
  });

  return {
    status: "ready",
    relativePath: "planning/script-plan.json",
    sha256: scriptPlanHash,
    segmentCount
  };
}
