import { readFile, writeFile, rename, lstat, rm, mkdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { loadJob } from "../pipeline/job-store.mjs";
import { writeCanonicalJson, writeBinaryAtomic } from "../pipeline/atomic-store.mjs";
import { registerArtifact } from "../pipeline/artifact-store.mjs";
import { hashCanonical, sha256Bytes } from "../pipeline/canonical-json.mjs";
import { validateSchema } from "../pipeline/schema-registry.mjs";
import { ensureContainedVideoDirectory } from "./video-layout.mjs";

const COMPATIBILITY_SCHEMA = resolve("schemas/yadam/hermes-compatibility.schema.json");

export async function buildHermesCompatibility({ jobDir, renderManifest }) {
  const job = await loadJob(jobDir);
  const manifestVal = renderManifest.value;

  const results = [];

  for (const segment of manifestVal.segments) {
    const segId = segment.segmentId;
    const segmentStart = segment.startSeconds;
    const segmentEnd = segment.endSeconds;

    // Get scenes for this segment
    const segmentScenes = manifestVal.scenes
      .filter(s => s.segmentId === segId)
      .sort((a, b) => a.startSeconds - b.startSeconds);

    // Assign local order (1-based)
    const localScenes = [];
    for (let i = 0; i < segmentScenes.length; i++) {
      const scene = segmentScenes[i];
      localScenes.push({
        order: i + 1,
        sceneId: scene.sceneId,
        sourceText: scene.text || "", // script scene text
        durationSeconds: scene.durationSeconds,
        startSeconds: scene.startSeconds,
        endSeconds: scene.endSeconds,
        normalizedWavPath: scene.normalizedWavPath,
        normalizedWavHash: scene.normalizedWavHash
      });
    }

    // Get visual slots for this segment
    const segmentSlots = manifestVal.visualSlots
      .filter(s => s.segmentId === segId)
      .sort((a, b) => a.startSeconds - b.startSeconds);

    const localSlots = [];
    for (let i = 0; i < segmentSlots.length; i++) {
      const slot = segmentSlots[i];
      localSlots.push({
        ...slot,
        visualOrder: i + 1
      });
    }

    // 1. Build compatibility sceneplan.json
    const compatScenes = [];
    for (const ls of localScenes) {
      // Find first intersecting visual slot
      const firstIntersectingVisual = localSlots.find(slot => 
        Math.max(slot.startSeconds, ls.startSeconds) < Math.min(slot.endSeconds, ls.endSeconds)
      );
      
      compatScenes.push({
        order: ls.order,
        scene_id: ls.sceneId,
        narration: ls.sourceText,
        video_prompt: firstIntersectingVisual ? (firstIntersectingVisual.compatibilityPrompt || firstIntersectingVisual.prompt || "") : "",
        duration_seconds: ls.durationSeconds
      });
    }

    // Validate scenePlan against hermes-compatibility schema
    await validateSchema(COMPATIBILITY_SCHEMA, compatScenes);

    // 2. Build keyframes manifest.json and copy PNGs
    const keyframesDir = await ensureContainedVideoDirectory(jobDir, `compat/hermes/${segId}/keyframes`);
    const compatKeyframes = [];

    for (const slot of localSlots) {
      const visualOrder = slot.visualOrder;
      const paddedOrder = String(visualOrder).padStart(3, "0");
      const relativeOutputPath = `keyframes/visual_${paddedOrder}.png`;
      const absoluteOutputPath = join(keyframesDir, `visual_${paddedOrder}.png`);

      // narration_refs: segment-local 1-based orders of intersecting scenes
      const narration_refs = localScenes
        .filter(ls => Math.max(slot.startSeconds, ls.startSeconds) < Math.min(slot.endSeconds, ls.endSeconds))
        .map(ls => ls.order);

      // Copy PNG
      const sourcePngPath = join(jobDir, slot.imagePath);
      if (!existsSync(sourcePngPath)) {
        throw new Error(`Source PNG not found: ${slot.imagePath}`);
      }
      const pngBytes = await readFile(sourcePngPath);
      const computedPngHash = sha256Bytes(pngBytes);
      if (computedPngHash.toLowerCase() !== slot.imageSha256.toLowerCase()) {
        throw new Error(`Source PNG hash mismatch for slot ${slot.visualSlotId}`);
      }

      // Check if file already exists and matches hash
      let reusePng = false;
      if (existsSync(absoluteOutputPath)) {
        const existingBytes = await readFile(absoluteOutputPath);
        if (sha256Bytes(existingBytes).toLowerCase() === slot.imageSha256.toLowerCase()) {
          reusePng = true;
        } else {
          await rm(absoluteOutputPath, { force: true });
        }
      }

      if (!reusePng) {
        await writeBinaryAtomic(absoluteOutputPath, pngBytes);
      }

      compatKeyframes.push({
        visualOrder,
        visualSlotId: slot.visualSlotId,
        output_path: relativeOutputPath,
        narration_refs,
        prompt: slot.compatibilityPrompt || slot.prompt || "",
        image_sha256: slot.imageSha256
      });
    }

    const keyframesManifest = { keyframes: compatKeyframes };
    await validateSchema(COMPATIBILITY_SCHEMA, keyframesManifest);

    // 3. Build visual-timeline.json
    const compatTimelineScenes = [];
    for (let i = 0; i < localSlots.length; i++) {
      const slot = localSlots[i];
      compatTimelineScenes.push({
        order: i + 1,
        visualOrder: slot.visualOrder,
        visualSlotId: slot.visualSlotId,
        sourceSceneIds: slot.sourceSceneIds,
        primarySceneId: slot.primarySceneId,
        startSeconds: slot.startSeconds - segmentStart,
        endSeconds: slot.endSeconds - segmentStart,
        durationSeconds: slot.durationSeconds,
        timingBand: slot.timingBand,
        extendedHold: slot.extendedHold,
        holdReason: slot.holdReason
      });
    }

    const visualTimeline = {
      schemaVersion: "1.0.0",
      profileId: "yadam",
      segmentId: segId,
      plannedDurationSeconds: segment.plannedDurationSeconds,
      measuredAudioSeconds: segment.measuredAudioSeconds,
      renderDurationSeconds: segment.measuredAudioSeconds,
      durationSeconds: segment.measuredAudioSeconds,
      scenes: compatTimelineScenes
    };

    // Require durationSeconds === renderDurationSeconds
    if (visualTimeline.durationSeconds !== visualTimeline.renderDurationSeconds) {
      throw new Error("durationSeconds must equal renderDurationSeconds");
    }

    await validateSchema(COMPATIBILITY_SCHEMA, visualTimeline);

    // Write visual-timeline.json (at segments/{segmentId}/visual-timeline.json)
    const timelineDir = await ensureContainedVideoDirectory(jobDir, `segments/${segId}`);
    const timelinePath = join(timelineDir, "visual-timeline.json");
    await writeCanonicalJson(timelinePath, visualTimeline);

    // 4. Copy normalized voice assets
    const voiceDir = await ensureContainedVideoDirectory(jobDir, `compat/hermes/${segId}/voice`);
    for (const ls of localScenes) {
      const paddedOrder = String(ls.order).padStart(2, "0");
      const canonicalVoiceName = `voice_${paddedOrder}.wav`;
      const absoluteVoicePath = join(voiceDir, canonicalVoiceName);
      const partVoicePath = join(voiceDir, `voice_${paddedOrder}.part.wav`);

      const sourceWavPath = join(jobDir, ls.normalizedWavPath);
      if (!existsSync(sourceWavPath)) {
        throw new Error(`Source voice wav not found: ${ls.normalizedWavPath}`);
      }

      // Check if matches existing final voice file
      let reuseWav = false;
      if (existsSync(absoluteVoicePath)) {
        const existingBytes = await readFile(absoluteVoicePath);
        if (sha256Bytes(existingBytes).toLowerCase() === ls.normalizedWavHash.toLowerCase()) {
          reuseWav = true;
        } else {
          await rm(absoluteVoicePath, { force: true });
        }
      }

      if (!reuseWav) {
        const wavBytes = await readFile(sourceWavPath);
        await writeBinaryAtomic(partVoicePath, wavBytes);
        const partHash = sha256Bytes(await readFile(partVoicePath));
        if (partHash.toLowerCase() !== ls.normalizedWavHash.toLowerCase()) {
          await rm(partVoicePath, { force: true });
          throw new Error(`Voice copy hash mismatch for ${canonicalVoiceName}`);
        }
        await rename(partVoicePath, absoluteVoicePath);
      }
    }

    // 5. Verify subtitles.srt exists
    const srtPath = join(jobDir, `compat/hermes/${segId}/subtitles.srt`);
    if (!existsSync(srtPath)) {
      throw new Error(`Subtitles sidecar missing for segment ${segId}`);
    }

    // Write compatibility manifests
    const scenePlanPath = join(jobDir, `compat/hermes/${segId}/sceneplan.json`);
    const keyframesManifestPath = join(keyframesDir, "manifest.json");

    await writeCanonicalJson(scenePlanPath, compatScenes);
    await writeCanonicalJson(keyframesManifestPath, keyframesManifest);

    // Collect dependency hashes
    const depHashes = {
      "yadam.render.manifest": renderManifest.sha256
    };
    for (const slot of localSlots) {
      depHashes[`image:${slot.visualSlotId}`] = slot.imageSha256;
    }
    for (const ls of localScenes) {
      depHashes[`voice:${ls.sceneId}`] = ls.normalizedWavHash;
    }

    // Register compatibility artifacts
    await registerArtifact(jobDir, {
      artifactId: `yadam-compat-hermes-sceneplan-${segId}`,
      logicalRole: `yadam.compat.hermes.sceneplan.${segId}`,
      path: `compat/hermes/${segId}/sceneplan.json`,
      sha256: sha256Bytes(await readFile(scenePlanPath)),
      schemaVersion: "1.0.0",
      producerStage: "hermes-compatibility-projection",
      gateStatus: "pass",
      dependencyHashes: depHashes
    });

    await registerArtifact(jobDir, {
      artifactId: `yadam-compat-hermes-keyframes-${segId}`,
      logicalRole: `yadam.compat.hermes.keyframes.${segId}`,
      path: `compat/hermes/${segId}/keyframes/manifest.json`,
      sha256: sha256Bytes(await readFile(keyframesManifestPath)),
      schemaVersion: "1.0.0",
      producerStage: "hermes-compatibility-projection",
      gateStatus: "pass",
      dependencyHashes: depHashes
    });

    await registerArtifact(jobDir, {
      artifactId: `yadam-compat-hermes-timeline-${segId}`,
      logicalRole: `yadam.compat.hermes.timeline.${segId}`,
      path: `segments/${segId}/visual-timeline.json`,
      sha256: sha256Bytes(await readFile(timelinePath)),
      schemaVersion: "1.0.0",
      producerStage: "hermes-compatibility-projection",
      gateStatus: "pass",
      dependencyHashes: depHashes
    });

    results.push({
      segmentId: segId,
      scenePlanPath: `compat/hermes/${segId}/sceneplan.json`,
      keyframesManifestPath: `compat/hermes/${segId}/keyframes/manifest.json`,
      visualTimelinePath: `segments/${segId}/visual-timeline.json`
    });
  }

  return results;
}
