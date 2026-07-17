import { promises as fsPromises } from "node:fs";
import { join } from "node:path";
import { writeCanonicalJson } from "../pipeline/atomic-store.mjs";
import { registerArtifact } from "../pipeline/artifact-store.mjs";
import { validateSchema } from "../pipeline/schema-registry.mjs";

export function buildAudioTimeline(rows) {
  const sorted = [...rows].sort((a, b) => a.order - b.order);

  // Validate inputs
  let cursor = 0;
  const scenes = sorted.map((row, index) => {
    if (row.order !== index + 1) {
      throw Object.assign(new Error("invalid_audio_timeline_input: order regression or gap"), { code: "invalid_audio_timeline_input" });
    }
    if (!(row.media.durationSeconds > 0)) {
      throw Object.assign(new Error("invalid_audio_timeline_input: nonpositive duration"), { code: "invalid_audio_timeline_input" });
    }
    const startSeconds = cursor;
    const endSeconds = startSeconds + row.media.durationSeconds;
    cursor = endSeconds;
    return {
      ...row,
      durationSeconds: row.media.durationSeconds,
      startSeconds,
      endSeconds
    };
  });

  return {
    scenes,
    measuredAudioSeconds: cursor,
    audioTempoFactor: 1
  };
}

// Partition a duration into slots based on min/target/max config
function partitionRange(start, end, timingBand) {
  const total = end - start;
  if (total <= 0) return [];

  const config = timingBand === "intro"
    ? { min: 5, target: 6, max: 7 }
    : { min: 20, target: 30, max: 40 };

  let count = Math.max(1, Math.round(total / config.target));
  while (total / count < config.min && count > 1) {
    count--;
  }
  while (total / count > config.max) {
    count++;
  }

  const slotDuration = total / count;
  const slots = [];
  for (let i = 0; i < count; i++) {
    const sStart = start + i * slotDuration;
    const sEnd = sStart + slotDuration;
    slots.push({
      startSeconds: sStart,
      endSeconds: sEnd,
      durationSeconds: slotDuration,
      timingBand,
      extendedHold: false,
      holdReason: null,
      purpose: timingBand === "intro" ? "intro" : "scene"
    });
  }
  return slots;
}

export function buildVisualSlots(scenes, segmentId, segmentStart, segmentEnd) {
  // If segment spans across 60, split it
  const introEnd = 60;
  let rawSlots = [];

  if (segmentStart < introEnd) {
    const splitPoint = Math.min(segmentEnd, introEnd);
    rawSlots.push(...partitionRange(segmentStart, splitPoint, "intro"));
    if (segmentEnd > introEnd) {
      rawSlots.push(...partitionRange(splitPoint, segmentEnd, "body"));
    }
  } else {
    rawSlots.push(...partitionRange(segmentStart, segmentEnd, "body"));
  }

  // Handle CTA merge
  // Find any CTA scene in this segment
  const ctaScene = scenes.find(s => s.segmentId === segmentId && s.narrativeRole === "cta");
  if (ctaScene) {
    const ctaStart = ctaScene.startSeconds;
    const ctaEnd = ctaScene.endSeconds;

    // Filter out slots that overlap with the CTA scene, but keep the prior slot and extend it
    const filteredSlots = [];
    let priorSlot = null;

    for (const slot of rawSlots) {
      if (slot.startSeconds < ctaStart && slot.endSeconds <= ctaStart) {
        filteredSlots.push(slot);
        priorSlot = slot;
      } else if (slot.startSeconds >= ctaStart && slot.endSeconds <= ctaEnd) {
        // Overlaps with CTA: merge into prior slot if exists
        if (priorSlot) {
          priorSlot.endSeconds = Math.max(priorSlot.endSeconds, slot.endSeconds);
          priorSlot.durationSeconds = priorSlot.endSeconds - priorSlot.startSeconds;
          priorSlot.extendedHold = true;
          priorSlot.holdReason = "cta";
        }
      } else {
        filteredSlots.push(slot);
      }
    }
    rawSlots = filteredSlots;
  }

  // Handle Short Tail merge
  // If the last slot is body and less than 20 seconds, merge with prior slot in segment
  if (rawSlots.length > 1) {
    const lastIdx = rawSlots.length - 1;
    const lastSlot = rawSlots[lastIdx];
    if (lastSlot.timingBand === "body" && lastSlot.durationSeconds < 20) {
      const priorSlot = rawSlots[lastIdx - 1];
      priorSlot.endSeconds = lastSlot.endSeconds;
      priorSlot.durationSeconds = priorSlot.endSeconds - priorSlot.startSeconds;
      priorSlot.extendedHold = true;
      priorSlot.holdReason = "short_tail";
      rawSlots.pop();
    }
  }

  return rawSlots;
}

export function compileVisualSlots(scenes) {
  // Group scenes by segmentId
  const segmentScenes = {};
  for (const scene of scenes) {
    if (!segmentScenes[scene.segmentId]) {
      segmentScenes[scene.segmentId] = [];
    }
    segmentScenes[scene.segmentId].push(scene);
  }

  // Compute segment boundaries
  const sortedSegmentIds = Object.keys(segmentScenes).sort();
  const segments = [];
  let segCursor = 0;

  for (const segId of sortedSegmentIds) {
    const segScenes = segmentScenes[segId];
    const segDur = segScenes.reduce((sum, s) => sum + s.durationSeconds, 0);
    const startSeconds = segCursor;
    const endSeconds = startSeconds + segDur;
    segCursor = endSeconds;

    segments.push({
      segmentId: segId,
      plannedDurationSeconds: 600,
      measuredAudioSeconds: segDur,
      startSeconds,
      endSeconds
    });
  }

  // Generate visual slots
  let globalSlots = [];
  for (const seg of segments) {
    const slots = buildVisualSlots(scenes, seg.segmentId, seg.startSeconds, seg.endSeconds);
    // Assign segmentId to slots
    for (const slot of slots) {
      slot.segmentId = seg.segmentId;
    }
    globalSlots.push(...slots);
  }

  // Map sourceSceneIds and primarySceneId
  globalSlots = globalSlots.map((slot, index) => {
    const visualOrder = index + 1;
    const visualSlotId = `visual-slot-${String(visualOrder).padStart(4, "0")}`;

    // Overlapping scenes
    const overlapping = scenes.filter(scene => {
      return scene.startSeconds < slot.endSeconds && scene.endSeconds > slot.startSeconds;
    });

    const sourceSceneIds = overlapping.map(s => s.sceneId);

    // Primary scene selection
    // Overlap duration descending, then ordinal (order) ascending
    const candidates = overlapping.map(scene => {
      const overlapDur = Math.max(0, Math.min(scene.endSeconds, slot.endSeconds) - Math.max(scene.startSeconds, slot.startSeconds));
      return {
        sceneId: scene.sceneId,
        overlapDur,
        order: scene.order,
        narrativeRole: scene.narrativeRole
      };
    });

    // Exclude CTA from primary if possible
    const nonCta = candidates.filter(c => c.narrativeRole !== "cta");
    const activeCandidates = nonCta.length > 0 ? nonCta : candidates;

    activeCandidates.sort((a, b) => {
      if (Math.abs(a.overlapDur - b.overlapDur) > 0.001) {
        return b.overlapDur - a.overlapDur; // Descending overlap
      }
      return a.order - b.order; // Ascending order
    });

    const primarySceneId = activeCandidates[0]?.sceneId || null;

    return {
      visualSlotId,
      visualOrder,
      segmentId: slot.segmentId,
      sourceSceneIds,
      primarySceneId,
      startSeconds: slot.startSeconds,
      endSeconds: slot.endSeconds,
      durationSeconds: slot.durationSeconds,
      timingBand: slot.timingBand,
      extendedHold: slot.extendedHold,
      holdReason: slot.holdReason,
      purpose: slot.purpose
    };
  });

  return { segments, visualSlots: globalSlots };
}

export async function publishRenderPlanInput({ jobDir, candidate, currentApproval }) {
  const schemaPath = join(jobDir, "schemas/yadam/render-plan-input.schema.json");
  await validateSchema(schemaPath, candidate);

  const outputPath = join(jobDir, "render-plan-input.json");
  const out = await writeCanonicalJson(outputPath, candidate);

  // Register
  await registerArtifact(jobDir, {
    artifactId: "yadam-render-plan-input",
    logicalRole: "yadam.render_plan_input",
    path: "render-plan-input.json",
    sha256: out.sha256,
    schemaVersion: "1.0.0",
    producerStage: "timeline-generation",
    gateStatus: "pass",
    dependencyHashes: {
      "yadam.approval.2": currentApproval.approvedArtifactSetHash || "0000000000000000000000000000000000000000000000000000000000000002"
    }
  });

  return {
    path: "render-plan-input.json",
    sha256: out.sha256
  };
}
