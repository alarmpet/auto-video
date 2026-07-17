import { inspectPng } from "./raster-inspector.mjs";

const FALSE_FLAGS = ["unexpectedFocalSubject", "readableText", "watermark", "modernObject", "severeAnatomyDefect", "minorSafetyViolation"];
const THUMBNAIL_ONLY_FLAGS = ["reservedTextRectClear", "faceInTextRect", "criticalObjectInTextRect", "subjectPlacementMatch"];

export function decideCritic({ request, result, thresholds }) {
  if (result.status !== "ok") return { status: "needs_review", criticStatus: result.status, failedAxes: [result.errorCode ?? result.status] };
  const { scores, flags } = result.value;
  const failedAxes = [];
  if (scores.contextMatch < thresholds.contextMin) failedAxes.push("contextMatch");
  if (request.identity && scores.focalCharacterMatch < thresholds.identityMin) failedAxes.push("focalCharacterMatch");
  if (scores.eraWardrobeMatch < thresholds.eraWardrobeMin) failedAxes.push("eraWardrobeMatch");
  if (scores.colorStyleMatch < thresholds.colorStyleMin) failedAxes.push("colorStyleMatch");
  if (request.identity && flags.requiredFocalSubjectPresent !== true) failedAxes.push("requiredFocalSubjectPresent");
  for (const key of FALSE_FLAGS) if (flags[key] !== false) failedAxes.push(key);
  if (request.purpose === "thumbnail-background") {
    if (flags.reservedTextRectClear !== true) failedAxes.push("reservedTextRectClear");
    if (flags.faceInTextRect !== false) failedAxes.push("faceInTextRect");
    if (flags.criticalObjectInTextRect !== false) failedAxes.push("criticalObjectInTextRect");
    if (flags.subjectPlacementMatch !== true) failedAxes.push("subjectPlacementMatch");
  } else {
    for (const key of THUMBNAIL_ONLY_FLAGS) if (flags[key] !== null) failedAxes.push(key);
  }
  return { status: failedAxes.length ? "needs_review" : "pass", criticStatus: failedAxes.length ? "fail" : "pass", failedAxes: [...new Set(failedAxes)].sort() };
}

function projectCriticEvidence(result, decision) {
  if (result.status === "ok") return { status: decision.criticStatus, model: result.model, responseHash: result.responseHash, scores: result.value.scores, flags: result.value.flags };
  return { status: result.status, model: result.model, responseHash: result.responseHash ?? null, errorCode: result.errorCode };
}

export async function evaluateVisualQa({ asset, request, referenceBytes, duplicateOwners, profile, critic, repairAttemptUsed, signal }) {
  if (asset.visualSlotId !== request.visualSlotId) return { status: "needs_review", failedAxes: ["visual_slot_parity"], repairAllowed: false };
  const deterministic = await inspectPng({ assetId: asset.assetId, bytes: asset.bytes, expectedWidth: request.render.width, expectedHeight: request.render.height, colorPixelRatioMin: profile.visual.qa.sourceColorPixelRatioMin, duplicateOwners });
  if (deterministic.status !== "pass") {
    return { status: "needs_review", deterministic, critic: { status: "not_run", reason: "deterministic_failed" }, failedAxes: deterministic.failures, repairAllowed: repairAttemptUsed === false };
  }
  const criticResult = await critic.inspect({ imageBytes: asset.bytes, referenceBytes, request, signal });
  const decision = decideCritic({ request, result: criticResult, thresholds: profile.visual.qa });
  const criticEvidence = projectCriticEvidence(criticResult, decision);
  return { status: decision.status, deterministic, critic: criticEvidence, failedAxes: decision.failedAxes, repairAllowed: decision.status !== "pass" && repairAttemptUsed === false && criticResult.status === "ok" };
}
