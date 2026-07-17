import { join, relative } from "node:path";
import { writeCanonicalJson } from "../../pipeline/atomic-store.mjs";
import { registerArtifact } from "../../pipeline/artifact-store.mjs";
import { validateSchema } from "../../pipeline/schema-registry.mjs";

const EPSILON = 0.01;

export function validateVisualSlots({ audioHandoff, profile }) {
  const inputSlots = structuredClone(audioHandoff.visualSlots);
  const slots = structuredClone(inputSlots).sort((a, b) => a.startSeconds - b.startSeconds || a.visualOrder - b.visualOrder);
  const scenes = structuredClone(audioHandoff.scenes).sort((a, b) => a.startSeconds - b.startSeconds);
  const sceneById = new Map(scenes.map(scene => [scene.sceneId, scene]));
  if (sceneById.size !== scenes.length) throw Object.assign(new Error("duplicate audio scene id"), { code: "audio_scene_duplicate" });
  if (!slots.length || slots.length > profile.visual.maxSlots) throw Object.assign(new Error("visual slot count outside range"), { code: "visual_slot_count" });
  if (new Set(slots.map(slot => slot.visualSlotId)).size !== slots.length) throw Object.assign(new Error("duplicate visual slot id"), { code: "visual_slot_duplicate" });
  if (inputSlots.some((slot, index) => slot.visualSlotId !== slots[index].visualSlotId)) throw Object.assign(new Error("visual slots must already be chronological"), { code: "visual_slot_order" });
  if (Math.abs(slots[0].startSeconds) > EPSILON) throw Object.assign(new Error("visual timeline must start at zero"), { code: "visual_timeline_start" });
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (slot.visualOrder !== index + 1) throw Object.assign(new Error(`visual order is not contiguous: ${slot.visualSlotId}`), { code: "visual_order_invalid" });
    if (![slot.startSeconds, slot.endSeconds, slot.durationSeconds].every(Number.isFinite) || slot.startSeconds < 0 || slot.endSeconds <= slot.startSeconds) throw Object.assign(new Error(`visual time invalid: ${slot.visualSlotId}`), { code: "visual_time_invalid" });
    if ((slot.timingBand === "intro") !== (slot.purpose === "intro")) throw Object.assign(new Error(`purpose/band mismatch: ${slot.visualSlotId}`), { code: "visual_purpose_mismatch" });
    const computed = slot.endSeconds - slot.startSeconds;
    if (Math.abs(computed - slot.durationSeconds) > EPSILON) throw Object.assign(new Error(`duration mismatch: ${slot.visualSlotId}`), { code: "visual_duration_mismatch" });
    if (!slot.sourceSceneIds?.length || new Set(slot.sourceSceneIds).size !== slot.sourceSceneIds.length || !slot.sourceSceneIds.includes(slot.primarySceneId)) throw Object.assign(new Error(`source scenes invalid: ${slot.visualSlotId}`), { code: "visual_source_invalid" });
    for (const sceneId of slot.sourceSceneIds) if (!sceneById.has(sceneId)) throw Object.assign(new Error(`unknown source scene: ${sceneId}`), { code: "visual_source_unknown" });
    if (index > 0) {
      const delta = slot.startSeconds - slots[index - 1].endSeconds;
      if (Math.abs(delta) > EPSILON) throw Object.assign(new Error(`timeline gap/overlap: ${slot.visualSlotId}`), { code: delta > 0 ? "visual_timeline_gap" : "visual_timeline_overlap" });
    }
    const band = slot.timingBand === "intro" ? profile.visual.intro : profile.visual.body;
    if (!slot.extendedHold && slot.holdReason !== null) throw Object.assign(new Error(`hold reason without extension: ${slot.visualSlotId}`), { code: "visual_hold_invalid" });
    if (slot.timingBand === "intro" && slot.startSeconds >= profile.visual.intro.endSeconds - EPSILON) throw Object.assign(new Error(`intro band starts after intro: ${slot.visualSlotId}`), { code: "visual_timing_band_invalid" });
    if (slot.timingBand === "body" && slot.startSeconds < profile.visual.intro.endSeconds - EPSILON) throw Object.assign(new Error(`body band starts before body: ${slot.visualSlotId}`), { code: "visual_timing_band_invalid" });
    const allowedExtendedHold = slot.extendedHold === true && ((slot.timingBand === "intro" && slot.holdReason === "cta") || (index === slots.length - 1 && slot.holdReason === "short_tail"));
    if (slot.extendedHold && !allowedExtendedHold) throw Object.assign(new Error(`invalid extended hold: ${slot.visualSlotId}`), { code: "visual_hold_invalid" });
    if (allowedExtendedHold && slot.durationSeconds > band.maxSlotSeconds + band.targetSlotSeconds + EPSILON) throw Object.assign(new Error(`extended hold too long: ${slot.visualSlotId}`), { code: "visual_hold_too_long" });
    if (!allowedExtendedHold && (slot.durationSeconds < band.minSlotSeconds - EPSILON || slot.durationSeconds > band.maxSlotSeconds + EPSILON)) throw Object.assign(new Error(`cadence violation: ${slot.visualSlotId}`), { code: "visual_cadence_violation" });
  }
  if (Math.abs(slots.at(-1).endSeconds - audioHandoff.measuredAudioSeconds) > 0.05) throw Object.assign(new Error("visual timeline does not cover measured audio"), { code: "visual_audio_coverage" });
  for (const scene of scenes) {
    const ranges = slots.filter(slot => slot.sourceSceneIds.includes(scene.sceneId) && slot.endSeconds > scene.startSeconds && slot.startSeconds < scene.endSeconds).map(slot => ({ start: Math.max(scene.startSeconds, slot.startSeconds), end: Math.min(scene.endSeconds, slot.endSeconds) })).sort((a, b) => a.start - b.start);
    if (!ranges.length || Math.abs(ranges[0].start - scene.startSeconds) > EPSILON) throw Object.assign(new Error(`scene coverage starts late: ${scene.sceneId}`), { code: "visual_scene_uncovered" });
    let cursor = ranges[0].end;
    for (const range of ranges.slice(1)) {
      if (range.start - cursor > EPSILON) throw Object.assign(new Error(`scene coverage gap: ${scene.sceneId}`), { code: "visual_scene_uncovered" });
      cursor = Math.max(cursor, range.end);
    }
    if (Math.abs(cursor - scene.endSeconds) > EPSILON) throw Object.assign(new Error(`scene coverage ends early: ${scene.sceneId}`), { code: "visual_scene_uncovered" });
  }
  return slots;
}

export async function publishRenderPlan({ jobDir, audioHandoff, compiledRequests, profile, visualPlanning }) {
  const slots = validateVisualSlots({ audioHandoff, profile });
  const bySlot = new Map(compiledRequests.map(entry => [entry.value.visualSlotId, entry]));
  if (bySlot.size !== compiledRequests.length) throw Object.assign(new Error("duplicate compiled slot request"), { code: "compiled_request_duplicate" });
  const slotIds = new Set(slots.map(slot => slot.visualSlotId));
  const orphan = compiledRequests.filter(entry => !slotIds.has(entry.value.visualSlotId));
  if (orphan.length) throw Object.assign(new Error(`orphan compiled request: ${orphan[0].artifactId}`), { code: "compiled_request_orphan" });
  const audioSceneById = new Map(audioHandoff.scenes.map(scene => [scene.sceneId, scene]));
  const visualSlots = slots.map(slot => {
    const entry = bySlot.get(slot.visualSlotId);
    if (!entry) throw Object.assign(new Error(`compiled request missing: ${slot.visualSlotId}`), { code: "compiled_request_missing" });
    const request = entry.value;
    if (entry.artifactId !== `compiled-image-request-${request.assetId}` || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw Object.assign(new Error(`compiled request artifact invalid: ${request.assetId}`), { code: "compiled_request_artifact_invalid" });
    if (JSON.stringify(request.sourceSceneIds) !== JSON.stringify([...slot.sourceSceneIds].sort())) throw Object.assign(new Error(`compiled source IDs differ: ${slot.visualSlotId}`), { code: "compiled_source_mismatch" });
    for (const source of request.sourceScenes) if (audioSceneById.get(source.sceneId)?.sourceHash !== source.sourceHash) throw Object.assign(new Error(`compiled source hash differs: ${source.sceneId}`), { code: "compiled_source_hash_mismatch" });
    return { ...slot, compiledRequestId: entry.artifactId, compiledRequestHash: entry.sha256 };
  });
  const value = {
    schemaVersion: "1.0.0",
    profileId: "yadam",
    approvedArtifactSetHash: visualPlanning.approvedArtifactSetHash,
    approvalRevisionPath: visualPlanning.approvalRevisionPath,
    storyBible: visualPlanning.storyBible,
    scenePlan: visualPlanning.scenePlan,
    thumbnailPlan: visualPlanning.thumbnailPlan,
    thumbnailSelection: visualPlanning.thumbnailSelection,
    audioManifestPath: audioHandoff.audioManifestPath,
    audioManifestHash: audioHandoff.audioManifestHash,
    audioTimelinePath: audioHandoff.audioTimelinePath,
    audioTimelineHash: audioHandoff.audioTimelineHash,
    renderPlanInputPath: audioHandoff.renderPlanInputPath,
    renderPlanInputHash: audioHandoff.renderPlanInputHash,
    measuredAudioSeconds: audioHandoff.measuredAudioSeconds,
    acceptedRangeSeconds: audioHandoff.acceptedRangeSeconds,
    audioTempoFactor: audioHandoff.audioTempoFactor,
    scenes: audioHandoff.scenes,
    segments: audioHandoff.segments,
    visualSlots
  };
  await validateSchema(join(process.cwd(), "schemas", "yadam", "render-plan.schema.json"), value);
  const output = await writeCanonicalJson(join(jobDir, "render-plan.json"), value);
  const compiledDependencies = Object.fromEntries([...compiledRequests].sort((a, b) => a.artifactId.localeCompare(b.artifactId)).map(entry => [`compiled:${entry.artifactId}`, entry.sha256]));
  await registerArtifact(jobDir, {
    artifactId: "render-plan",
    logicalRole: "yadam.render.plan",
    path: relative(jobDir, output.path).replaceAll("\\", "/"),
    sha256: output.sha256,
    schemaVersion: "1.0.0",
    producerStage: "image-plan",
    gateStatus: "pass",
    dependencyHashes: {
      audioManifest: audioHandoff.audioManifestHash,
      audioTimeline: audioHandoff.audioTimelineHash,
      renderPlanInput: audioHandoff.renderPlanInputHash,
      approvalSet: visualPlanning.approvedArtifactSetHash,
      storyBible: visualPlanning.storyBible.sha256,
      scenePlan: visualPlanning.scenePlan.sha256,
      thumbnailPlan: visualPlanning.thumbnailPlan.sha256,
      thumbnailSelection: visualPlanning.thumbnailSelection.sha256,
      ...compiledDependencies
    }
  });
  return { ...output, value };
}
