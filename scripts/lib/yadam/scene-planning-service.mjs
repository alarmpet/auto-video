// scripts/lib/yadam/scene-planning-service.mjs
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { loadJob } from "../pipeline/job-store.mjs";
import { writeCanonicalJson } from "../pipeline/atomic-store.mjs";
import { registerArtifact } from "../pipeline/artifact-store.mjs";
import { transitionJob } from "../pipeline/state-machine.mjs";
import { hashCanonical } from "../pipeline/canonical-json.mjs";

function scenePlanError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function buildScenePlan({ jobDir }) {
  const context = await loadJob(jobDir);
  const { request } = context;

  const scriptScenesRecord = context.manifest.artifacts.find(a => a.logicalRole === "yadam.script.scenes");
  if (!scriptScenesRecord) throw scenePlanError("script_scenes_missing", "Script scenes are missing");

  // Read scenes
  const scenesBytes = await readFile(join(jobDir, scriptScenesRecord.path));
  const { scenes } = JSON.parse(scenesBytes.toString("utf8"));

  const scenePlans = scenes.map((s, idx) => {
    return {
      sceneId: s.sceneId,
      slots: [
        {
          slotId: `slot-${s.sceneId.slice(-4)}-01`,
          narrativeText: s.sourceText,
          visualPrompt: `A beautiful historical Korean painting of scene ${s.sceneId}`
        }
      ],
      tts: {
        continuousNext: idx < scenes.length - 1,
        readSlow: false
      }
    };
  });

  const scenePlan = {
    schemaVersion: "1.0.0",
    jobId: request.jobId,
    stageId: "yadam.scene.plan.v1",
    inputHash: scriptScenesRecord.sha256,
    scenePlans
  };

  const scenePlanPath = join(jobDir, "planning/scene-plan.json");
  const writeRes = await writeCanonicalJson(scenePlanPath, scenePlan);
  const scenePlanHash = writeRes.sha256;

  await registerArtifact(jobDir, {
    artifactId: "yadam-scene-plan",
    logicalRole: "yadam.scene.plan",
    path: "planning/scene-plan.json",
    sha256: scenePlanHash,
    schemaVersion: "1.0.0",
    producerStage: "scene-planning",
    gateStatus: "pass",
    dependencyHashes: {
      "scriptScenes": scriptScenesRecord.sha256
    }
  });

  return {
    status: "ready",
    relativePath: "planning/scene-plan.json",
    sha256: scenePlanHash
  };
}
