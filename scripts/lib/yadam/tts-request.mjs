import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { hashCanonical, sha256Bytes } from "../pipeline/canonical-json.mjs";
import { loadJob } from "../pipeline/job-store.mjs";
import { loadProfile } from "../pipeline/profile-registry.mjs";
import { validateSchema } from "../pipeline/schema-registry.mjs";

const HASH = /^[0-9a-f]{64}$/;

export function assertApprovedSceneOrder(scenes) {
  const sorted = [...scenes].sort((a, b) => a.ordinal - b.ordinal);
  sorted.forEach((scene, index) => {
    if (scene.ordinal !== index + 1) {
      throw Object.assign(new Error("scene_order_not_contiguous"), { code: "scene_order_not_contiguous" });
    }
  });
  return sorted;
}

export function assertApprovedSceneHashes(scene) {
  const sourceHash = sha256Bytes(Buffer.from(scene.sourceText.normalize("NFC"), "utf8"));
  const normalizedHash = sha256Bytes(Buffer.from(scene.ttsNormalizedText.normalize("NFC"), "utf8"));
  if (sourceHash !== scene.sourceHash) {
    throw Object.assign(new Error("source_hash_mismatch"), { code: "source_hash_mismatch", sceneId: scene.sceneId });
  }
  if (normalizedHash !== scene.ttsNormalizedHash) {
    throw Object.assign(new Error("tts_normalized_hash_mismatch"), { code: "tts_normalized_hash_mismatch", sceneId: scene.sceneId });
  }
  if (!HASH.test(scene.ttsOptionsHash)) {
    throw Object.assign(new Error("tts_options_hash_invalid"), { code: "tts_options_hash_invalid", sceneId: scene.sceneId });
  }
}

export function buildTtsIdempotencyKey(request) {
  return hashCanonical({
    provider: request.provider,
    adapterVersion: request.adapterVersion,
    sceneId: request.sceneId,
    sourceHash: request.sourceHash,
    ttsNormalizedHash: request.ttsNormalizedHash,
    ttsOptionsHash: request.ttsOptionsHash,
    model: request.model,
    voice: request.voice,
    language: request.language,
    speed: request.speed,
    totalStep: request.totalStep,
    silenceSeconds: request.silenceSeconds,
  });
}

export async function buildTtsRequests({ jobDir, approvedInput }) {
  const context = await loadJob(jobDir);
  const profile = await loadProfile(context.request.profileId, context.workspaceRoot || ".");

  // Find yadam.scene.plan artifact
  const scenePlanArtifact = context.manifest.artifacts.find(
    art => art.logicalRole === "yadam.scene.plan" && art.gateStatus === "pass"
  );
  if (!scenePlanArtifact) {
    throw Object.assign(new Error("missing_scene_plan_artifact"), { code: "missing_scene_plan_artifact" });
  }

  const scenePlanPath = join(jobDir, scenePlanArtifact.path);
  let scenePlan;
  try {
    scenePlan = JSON.parse(await readFile(scenePlanPath, "utf8"));
  } catch (err) {
    throw Object.assign(new Error(`failed to read scene plan: ${err.message}`), { code: "failed_to_read_scene_plan" });
  }

  // verify order and hashes
  const sortedApprovedScenes = assertApprovedSceneOrder(approvedInput.scenes);
  sortedApprovedScenes.forEach(assertApprovedSceneHashes);

  const scenePlanMap = new Map();
  for (const sp of scenePlan.scenePlans) {
    if (scenePlanMap.has(sp.sceneId)) {
      throw Object.assign(new Error("duplicate_scene_id_in_scene_plan"), { code: "duplicate_scene_id_in_scene_plan" });
    }
    scenePlanMap.set(sp.sceneId, sp);
  }

  const requests = [];
  for (const scene of sortedApprovedScenes) {
    const scenePlanRow = scenePlanMap.get(scene.sceneId);
    if (!scenePlanRow) {
      throw Object.assign(new Error(`missing_scene_plan_row: ${scene.sceneId}`), { code: "missing_scene_plan_row", sceneId: scene.sceneId });
    }
    if (!scenePlanRow.tts || typeof scenePlanRow.tts.readSlow !== "boolean" || typeof scenePlanRow.tts.continuousNext !== "boolean") {
      throw Object.assign(new Error("invalid_scene_plan_tts_options"), { code: "invalid_scene_plan_tts_options", sceneId: scene.sceneId });
    }

    const effectiveOptions = {
      model: profile.tts.model,
      voice: profile.tts.voice,
      language: profile.tts.language,
      speed: profile.tts.speed,
      totalStep: profile.tts.totalStep,
      silenceSeconds: scenePlanRow.tts.continuousNext
        ? profile.tts.continuousSilenceSeconds
        : profile.tts.sceneSilenceSeconds,
      readSlow: scenePlanRow.tts.readSlow,
      continuousNext: scenePlanRow.tts.continuousNext,
    };

    const computedOptionsHash = hashCanonical(effectiveOptions);
    if (computedOptionsHash !== scene.ttsOptionsHash) {
      throw Object.assign(new Error(`tts_options_hash_mismatch for ${scene.sceneId}`), {
        code: "tts_options_hash_mismatch",
        sceneId: scene.sceneId,
        expected: scene.ttsOptionsHash,
        actual: computedOptionsHash
      });
    }

    const request = {
      schemaVersion: "1.0.0",
      jobId: context.request.jobId,
      sceneId: scene.sceneId,
      segmentId: scene.segmentId,
      order: scene.ordinal,
      sourceHash: scene.sourceHash,
      ttsNormalizedHash: scene.ttsNormalizedHash,
      ttsOptionsHash: scene.ttsOptionsHash,
      idempotencyKey: "",
      text: scene.ttsNormalizedText,
      provider: "supertonic",
      adapterVersion: "1.0.0",
      model: effectiveOptions.model,
      voice: effectiveOptions.voice,
      language: effectiveOptions.language,
      speed: effectiveOptions.speed,
      totalStep: effectiveOptions.totalStep,
      silenceSeconds: effectiveOptions.silenceSeconds,
      readSlow: effectiveOptions.readSlow,
      continuousNext: effectiveOptions.continuousNext,
    };

    request.idempotencyKey = buildTtsIdempotencyKey(request);

    // Validate request
    const schemaPath = join(context.workspaceRoot || ".", "schemas/yadam/tts-scene-request.schema.json");
    await validateSchema(schemaPath, request);

    requests.push(request);
  }

  return requests;
}
