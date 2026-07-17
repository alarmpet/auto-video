import { loadJob } from "../pipeline/job-store.mjs";
import { getApprovedTtsInput, requestDurationRepair, rebuildApproval2AfterDurationRepair } from "./script-service.mjs";
import { publishAudioNeedsReview } from "./audio-needs-review.mjs";
import { runSceneBatch } from "./tts-checkpoint.mjs";
import { publishRenderPlanInput } from "./audio-timeline.mjs";
import { createTtsService } from "./tts-service-core.mjs";

async function lazyRefreshApproval2Previews({ jobDir, changedSceneIds, signal }) {
  try {
    const { refreshApproval2Previews } = await import("./image-service.mjs");
    return await refreshApproval2Previews({ jobDir, changedSceneIds, signal });
  } catch (err) {
    if (err.code === "ERR_MODULE_NOT_FOUND") {
      throw Object.assign(new Error("Preview refresh dependency is missing"), {
        code: "preview_refresh_dependency_missing"
      });
    }
    throw err;
  }
}

const service = createTtsService({
  loadJob,
  getApprovedTtsInput,
  requestDurationRepair,
  rebuildApproval2AfterDurationRepair,
  refreshApproval2Previews: lazyRefreshApproval2Previews,
  publishAudioNeedsReview,
  runSceneBatch,
  buildAndPublishAudioTimeline: () => {}, // Timeline is published directly in core
  publishRenderPlanInput,
  now: () => new Date().toISOString()
});

export async function runFullTts({ jobDir, signal }) {
  return service.runFullTtsCore({ jobDir, signal });
}

export async function loadPassedAudioHandoff(jobDir) {
  return service.loadPassedAudioHandoffCore(jobDir);
}
