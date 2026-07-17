import { fileURLToPath } from "node:url";
import { hashCanonical } from "../../pipeline/canonical-json.mjs";
import { validateSchema } from "../../pipeline/schema-registry.mjs";

const REQUEST_SCHEMA_PATH = fileURLToPath(new URL("../../../../schemas/yadam/compiled-image-request.schema.json", import.meta.url));

const STYLE = "color Joseon-era Korean historical manhwa illustration, clean expressive ink outlines, restrained painterly color, warm cinematic lighting, 2D semi-realistic storybook art";
const NEGATIVE = "photorealistic photo, 3D render, stick figure, monochrome, grayscale, modern objects, modern clothing, readable text, Korean letters, English letters, numbers, watermark, logo, malformed hands, extra fingers, extra faces";

export function deriveImageSeed({ jobSeed, assetId }) {
  if (!Number.isSafeInteger(jobSeed) || jobSeed < 0 || typeof assetId !== "string" || !assetId) {
    throw Object.assign(new Error("invalid image seed input"), { code: "image_seed_input_invalid" });
  }
  const hex = hashCanonical({ jobSeed, assetId }).slice(0, 12);
  return Number.parseInt(hex, 16);
}

function compositionFor(input) {
  const thumbnailRect = input.purpose === "thumbnail-background" ? input.thumbnail?.textRect : null;
  const focal = input.character ? (thumbnailRect ? (thumbnailRect[0] + thumbnailRect[2] / 2 <= 0.5 ? "right" : "left") : "center") : "background";
  return {
    shotSize: input.scene?.shotSize ?? (input.character ? "medium" : "establishing"),
    cameraAngle: input.scene?.cameraAngle ?? "eye-level",
    focalPosition: input.scene?.focalPosition ?? focal,
    focalHeadcount: input.character ? 1 : 0,
    gaze: input.scene?.gaze ?? "away",
    reservedTextRect: thumbnailRect ?? null
  };
}

export function compileImageRequest(input) {
  // Focal character validation
  const activeFocal = (input.scene?.activeCharacters ?? []).filter(c => c.focal);
  if (activeFocal.length > 1) {
    throw Object.assign(new Error("Focal character limit exceeded"), { code: "focal_character_limit" });
  }

  // Thumbnail textRect coordinate checking
  if (input.purpose === "thumbnail-background" && input.thumbnail?.textRect) {
    const [x, y, w, h] = input.thumbnail.textRect;
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001) {
      throw Object.assign(new Error("Thumbnail rect out of bounds"), { code: "thumbnail_rect_invalid" });
    }
  }

  // Reference availability and mode validation
  if (input.character && input.purpose !== "reference" && !input.reference) {
    throw Object.assign(new Error("focal character requires reference"), { code: "reference_missing" });
  }
  if (input.mode === "production" && input.character && input.purpose !== "reference" && input.reference?.status !== "approved") {
    throw Object.assign(new Error("production requires approved reference"), { code: "reference_not_approved" });
  }

  // Identity coherence validation
  const refStatus = input.reference?.status ?? "none";
  if (refStatus === "none") {
    if (input.reference?.path !== undefined && input.reference?.path !== null) {
      throw Object.assign(new Error("Identity coherence check failed"), { code: "reference_identity_invalid" });
    }
    if (input.reference?.sha256 !== undefined && input.reference?.sha256 !== null) {
      throw Object.assign(new Error("Identity coherence check failed"), { code: "reference_identity_invalid" });
    }
    if (input.character && input.purpose !== "reference") {
      throw Object.assign(new Error("status none only allowed for reference purpose"), { code: "reference_identity_invalid" });
    }
  } else {
    if (!input.reference?.path || !input.reference?.sha256) {
      throw Object.assign(new Error("provisional/approved reference requires path and sha256"), { code: "reference_identity_invalid" });
    }
  }

  // Render tuples validation
  if (input.render.cfg !== 6 || input.render.sampler !== "dpmpp_2m" || input.render.scheduler !== "karras") {
    throw Object.assign(new Error("Invalid render parameters"), { code: "render_parameters_invalid" });
  }
  if (input.purpose === "reference") {
    if (input.render.width !== 768 || input.render.height !== 1024 || input.render.steps !== 28) {
      throw Object.assign(new Error("Invalid render parameters for reference"), { code: "render_parameters_invalid" });
    }
  } else if (input.purpose === "thumbnail-background") {
    if (input.render.width !== 1280 || input.render.height !== 720 || input.render.steps !== 24) {
      throw Object.assign(new Error("Invalid render parameters for thumbnail"), { code: "render_parameters_invalid" });
    }
  } else {
    // scene or intro
    if (input.render.width !== 1024 || input.render.height !== 576 || input.render.steps !== 24) {
      throw Object.assign(new Error("Invalid render parameters for scene/intro"), { code: "render_parameters_invalid" });
    }
  }

  // Reference purpose specific checks
  if (input.purpose === "reference") {
    if (input.visualSlot.primarySceneId !== null || input.visualSlot.sourceSceneIds.length > 0) {
      throw Object.assign(new Error("Reference purpose cannot have source scenes"), { code: "reference_source_invalid" });
    }
    if (input.sourceScenes.length > 0) {
      throw Object.assign(new Error("Reference purpose cannot have source scenes"), { code: "reference_source_invalid" });
    }
  } else {
    // Non-reference validation
    const sourceSceneIds = [...input.visualSlot.sourceSceneIds].sort();
    if (new Set(sourceSceneIds).size !== sourceSceneIds.length) {
      throw Object.assign(new Error("duplicate source scene"), { code: "source_scene_duplicate" });
    }
    if ((input.visualSlot.primarySceneId ?? null) !== null && !sourceSceneIds.includes(input.visualSlot.primarySceneId)) {
      throw Object.assign(new Error("primary scene is outside source projection"), { code: "primary_scene_invalid" });
    }
    const sourceById = new Map(input.sourceScenes.map(scene => [scene.sceneId, scene]));
    if (sourceById.size !== input.sourceScenes.length) {
      throw Object.assign(new Error("duplicate source-scene projection row"), { code: "source_scene_duplicate" });
    }
    const sourceScenes = sourceSceneIds.map(sceneId => {
      const scene = sourceById.get(sceneId);
      if (!scene || !/^[0-9a-f]{64}$/.test(scene.sourceHash)) {
        throw Object.assign(new Error(`source scene/hash missing: ${sceneId}`), { code: "source_scene_hash_missing" });
      }
      return { sceneId, sourceHash: scene.sourceHash };
    });
    if (sourceById.size !== sourceScenes.length) {
      throw Object.assign(new Error("orphan source scene projection"), { code: "source_scene_orphan" });
    }
  }

  // Setup identity DTO
  const identity = input.character ? {
    characterId: input.character.characterId,
    variantId: input.character.variantId,
    referenceStatus: input.reference?.status ?? "none",
    referencePath: input.reference?.path ?? null,
    referenceSha256: input.reference?.sha256 ?? null,
    appearanceAnchors: input.character.appearanceAnchors,
    wardrobeAnchors: input.character.wardrobeAnchors
  } : null;

  const composition = compositionFor(input);
  const positivePrompt = [
    STYLE,
    input.scene?.visualDescription ?? `portrait of ${input.character.characterId}`,
    input.scene?.location ?? "neutral Joseon backdrop",
    input.scene?.action ?? "standing neutral pose",
    input.scene?.emotion ?? "neutral expression",
    ...(input.character?.appearanceAnchors ?? []),
    ...(input.character?.wardrobeAnchors ?? []),
    ...(input.scene?.props ?? []),
    `shot ${composition.shotSize}`,
    `camera ${composition.cameraAngle}`,
    `focal subject ${composition.focalPosition}`,
    composition.reservedTextRect ? `clean negative space reserved for title at normalized rectangle ${composition.reservedTextRect.join(",")}` : ""
  ].filter(Boolean).join(", ");

  // Clash checking
  const positiveTokens = positivePrompt.toLowerCase().split(/[,\s\.\-]+/).map(t => t.trim()).filter(Boolean);
  const negativeTokens = NEGATIVE.toLowerCase().split(/[,\s\.\-]+/).map(t => t.trim()).filter(Boolean);
  const clash = positiveTokens.filter(t => negativeTokens.includes(t) && t.length > 2 && t !== "korean"); // ignore tiny tokens and "korean"
  if (clash.length) {
    throw Object.assign(new Error(`Style clause conflict: ${clash.join(", ")}`), { code: "prompt_clause_conflict" });
  }

  const conditioning = input.character && input.reference ? {
    method: "sdxl-ipadapter-plus-face",
    preset: "PLUS FACE (portraits)",
    weightType: "standard",
    referenceSha256: input.reference.sha256,
    weight: 0.8,
    start: 0,
    end: 0.85
  } : {
    method: "none",
    preset: null,
    weightType: null,
    referenceSha256: null,
    weight: 0,
    start: 0,
    end: 0
  };

  if (conditioning.method === "sdxl-ipadapter-plus-face" && conditioning.start >= conditioning.end) {
    throw Object.assign(new Error("Conditioning start must be less than end"), { code: "conditioning_time_invalid" });
  }

  const request = {
    schemaVersion: "1.0.0",
    jobId: input.jobId,
    assetId: input.assetId,
    mode: input.mode,
    visualSlotId: input.visualSlot.visualSlotId,
    sourceSceneIds: input.purpose === "reference" ? [] : [...input.visualSlot.sourceSceneIds].sort(),
    primarySceneId: input.purpose === "reference" ? null : (input.visualSlot.primarySceneId ?? null),
    sourceScenes: input.purpose === "reference" ? [] : input.visualSlot.sourceSceneIds.map(sceneId => {
      const row = input.sourceScenes.find(s => s.sceneId === sceneId);
      return { sceneId, sourceHash: row.sourceHash };
    }),
    purpose: input.purpose,
    identity,
    story: {
      subject: input.scene?.visualDescription ?? `portrait of ${input.character.characterId}`,
      action: input.scene?.action ?? "standing neutral pose",
      emotion: input.scene?.emotion ?? "neutral expression",
      location: input.scene?.location ?? "neutral Joseon backdrop",
      era: "Joseon-era Korea",
      wardrobe: input.character?.wardrobeAnchors ?? [],
      props: input.scene?.props ?? []
    },
    composition,
    positivePrompt,
    negativePrompt: NEGATIVE,
    conditioning,
    render: {
      ...input.render,
      seed: deriveImageSeed({ jobSeed: input.jobSeed, assetId: input.assetId })
    },
    provenance: {
      compilerVersion: input.stack.compilerVersion,
      schemaVersion: "1.0.0",
      styleVersion: input.stack.styleVersion ?? "1.0.0",
      workflowHash: input.stack.workflowHash,
      checkpointHash: input.stack.checkpointHash,
      clipVisionHash: input.stack.clipVisionHash,
      ipAdapterHash: input.stack.ipAdapterHash,
      loraHash: null
    },
    idempotencyKey: ""
  };

  const requestProjection = structuredClone(request);
  delete requestProjection.idempotencyKey;
  delete requestProjection.jobId;
  delete requestProjection.assetId;
  delete requestProjection.mode;
  if (requestProjection.identity) {
    delete requestProjection.identity.referenceStatus;
    delete requestProjection.identity.referencePath;
  }
  request.idempotencyKey = hashCanonical({
    provider: "comfyui",
    adapterVersion: "1.0.0",
    request: requestProjection
  });

  validateSchema(REQUEST_SCHEMA_PATH, request);
  return request;
}
