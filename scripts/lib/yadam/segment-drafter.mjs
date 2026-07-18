// scripts/lib/yadam/segment-drafter.mjs
import { join, dirname, resolve } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { loadJob } from "../pipeline/job-store.mjs";
import { writeCanonicalJson } from "../pipeline/atomic-store.mjs";
import { registerArtifact } from "../pipeline/artifact-store.mjs";
import { transitionJob } from "../pipeline/state-machine.mjs";
import { sha256Bytes, hashCanonical, canonicalJson } from "../pipeline/canonical-json.mjs";
import { loadYadamReferences } from "./reference-store.mjs";
import { runYadamJsonStage } from "./codex-json-stage.mjs";

function drafterError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function checkSegmentHardGates(payload, plannedSegment, isFirst, isLast, hookBrief, fixedEnding, previousSegment) {
  const violations = [];
  
  if (!payload.text) {
    violations.push("Segment is missing text content");
  }

  // Check delivery rules or structure
  if (payload.scenes && Array.isArray(payload.scenes)) {
    let continuousCount = 0;
    payload.scenes.forEach((scene, idx) => {
      const delivery = scene.delivery || {};
      if (delivery.continuousNext) {
        continuousCount++;
        if (continuousCount > 4) {
          violations.push("Too many consecutive continuousNext scenes");
        }
      } else {
        continuousCount = 0;
      }

      // continuousNext must be false on final scene of segment or fixed ending scenes
      if (idx === payload.scenes.length - 1 && delivery.continuousNext) {
        violations.push("Last scene in segment must have continuousNext: false");
      }
      if (scene.sceneRole === "fixed_ending" && delivery.continuousNext) {
        violations.push("Fixed ending scenes must have continuousNext: false");
      }
    });

    if (isFirst) {
      // Compare intro text to hookBrief
      const introScenes = payload.scenes.filter(s => s.sceneRole === "story_intro");
      const introTextConcat = introScenes.map(s => s.text).join(" ").normalize("NFC");
      if (hookBrief && hookBrief.sentences) {
        const expectedIntroText = hookBrief.sentences.map(s => s.text).join(" ").normalize("NFC");
        if (introTextConcat.replace(/\s+/g, "") !== expectedIntroText.replace(/\s+/g, "")) {
          violations.push("Story intro text does not match hook brief");
        }
      }
    }

    if (isLast) {
      const endingScenes = payload.scenes.filter(s => s.sceneRole === "fixed_ending");
      if (endingScenes.length !== 3) {
        violations.push("Expected exactly 3 fixed ending scenes");
      } else if (fixedEnding) {
        endingScenes.forEach((s, idx) => {
          if (s.text.normalize("NFC").trim() !== fixedEnding[idx].normalize("NFC").trim()) {
            violations.push(`Fixed ending scene ${idx + 1} text mismatch`);
          }
        });
      }
    }
  }

  return violations;
}

export async function draftNextSegment({ jobDir }) {
  const context = await loadJob(jobDir);
  const { request } = context;
  const workspaceRoot = dirname(dirname(resolve(jobDir)));

  // Load script plan
  const planRecord = context.manifest.artifacts.find(a => a.logicalRole === "yadam.script.plan");
  if (!planRecord) throw drafterError("script_plan_missing", "Script plan is missing");

  const planBytes = await readFile(join(jobDir, planRecord.path));
  const plan = JSON.parse(planBytes.toString("utf8"));

  // Find first segment to draft
  const segments = plan.segments;
  let nextSegmentIndex = -1;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const path = `script/chapters/segment-${seg.segmentId.slice(-2)}.json`;
    const regRecord = context.manifest.artifacts.find(a => a.path === path);
    if (!regRecord || regRecord.gateStatus !== "pass") {
      nextSegmentIndex = i;
      break;
    }
  }

  if (nextSegmentIndex === -1) {
    return {
      status: "complete",
      remainingSegments: 0
    };
  }

  const plannedSegment = segments[nextSegmentIndex];
  const isFirst = nextSegmentIndex === 0;
  const isLast = nextSegmentIndex === segments.length - 1;

  // Load story bible
  const bibleRecord = context.manifest.artifacts.find(a => a.logicalRole === "yadam.story.bible");
  const bible = JSON.parse(await readFile(join(jobDir, bibleRecord.path), "utf8"));

  // Load hook brief if first
  let hookBrief = null;
  if (isFirst) {
    const hookRecord = context.manifest.artifacts.find(a => a.logicalRole === "yadam.hook.brief");
    hookBrief = JSON.parse(await readFile(join(jobDir, hookRecord.path), "utf8"));
  }

  // Load outline
  const outlineRecord = context.manifest.artifacts.find(a => a.logicalRole === "yadam.outline");
  const outline = JSON.parse(await readFile(join(jobDir, outlineRecord.path), "utf8"));

  // Load previous segment
  let previousSegment = null;
  let prevSceneCount = 0;
  if (nextSegmentIndex > 0) {
    const prevSeg = segments[nextSegmentIndex - 1];
    const prevPath = join(jobDir, `script/chapters/segment-${prevSeg.segmentId.slice(-2)}.json`);
    previousSegment = JSON.parse(await readFile(prevPath, "utf8"));
    
    // Count prior scenes
    for (let k = 0; k < nextSegmentIndex; k++) {
      try {
        const sBytes = await readFile(join(jobDir, `script/chapters/segment-${segments[k].segmentId.slice(-2)}.json`), "utf8");
        const s = JSON.parse(sBytes);
        prevSceneCount += s.scenes?.length || 0;
      } catch (e) {
        // ignore
      }
    }
  }

  const references = await loadYadamReferences({ rootDir: workspaceRoot });

  const stageInput = {
    schemaVersion: "1.0.0",
    segment: plannedSegment,
    approvedIntro: isFirst ? hookBrief.sentences : null,
    fixedEnding: isLast ? references.beats.fixedEnding : null,
    storyFacts: bible,
    canonicalOutline: outline,
    priorContinuity: previousSegment?.outgoingContinuity ?? bible.initialContinuity ?? {},
    priorTail: previousSegment?.scenes?.slice(-2).map(({ sceneId, text }) => ({ sceneId, text })) ?? [],
    obligations: plannedSegment.obligations,
    styleRules: references.rules.narrationRules
  };

  const segmentId = plannedSegment.segmentId;
  const stageId = `yadam.script.${segmentId}.v1`;
  const promptPath = join(workspaceRoot, "prompts/yadam/segment-draft.md");
  const schemaPath = join(workspaceRoot, "schemas/yadam/segment-draft.schema.json");

  let result;
  let attempt = 1;
  let violations = [];
  let rejectedOutputHash = "0000000000000000000000000000000000000000000000000000000000000000";

  try {
    result = await runYadamJsonStage({
      jobDir,
      stageId,
      promptPath,
      schemaPath,
      input: stageInput,
      timeoutMs: 300000
    });

    violations = checkSegmentHardGates(result.payload, plannedSegment, isFirst, isLast, hookBrief, references.beats.fixedEnding, previousSegment);
    if (violations.length > 0) {
      const err = new Error("Segment hard gate failed");
      err.code = "segment_hard_gate_failed";
      err.details = violations;
      err.payload = result.payload;
      throw err;
    }
  } catch (err) {
    attempt = 2;
    rejectedOutputHash = err.payload ? hashCanonical(err.payload) : "0000000000000000000000000000000000000000000000000000000000000000";
    violations = err.details || [err.message];
  }

  if (attempt === 2) {
    try {
      result = await runYadamJsonStage({
        jobDir,
        stageId: `${stageId}.repair-1`,
        promptPath,
        schemaPath,
        input: {
          ...stageInput,
          violations: violations.sort(),
          rejectedOutputHash
        },
        timeoutMs: 300000
      });
      const repViolations = checkSegmentHardGates(result.payload, plannedSegment, isFirst, isLast, hookBrief, references.beats.fixedEnding, previousSegment);
      if (repViolations.length > 0) {
        throw drafterError("segment_hard_gate_failed", `Segment repair failed: ${repViolations.join(", ")}`);
      }
    } catch (repErr) {
      await transitionJob(jobDir, {
        stage: stageId,
        to: "needs_review",
        inputHash: hashCanonical(stageInput)
      });
      throw drafterError("segment_gate_failed", `Segment generation failed: ${repErr.message}`);
    }
  }

  // Assign global scene IDs
  const payload = {
    ...result.payload,
    scenes: (result.payload.scenes || []).map((scene, idx) => {
      const globalOrdinal = prevSceneCount + idx + 1;
      const sceneId = `scene-${String(globalOrdinal).padStart(4, "0")}`;
      return {
        ...scene,
        sceneId
      };
    })
  };

  const segmentFilename = `script/chapters/segment-${segmentId.slice(-2)}.json`;
  const segmentPath = join(jobDir, segmentFilename);
  const segmentWrite = await writeCanonicalJson(segmentPath, payload);
  const segmentHash = segmentWrite.sha256;

  await registerArtifact(jobDir, {
    artifactId: `yadam-script-segment-${segmentId.slice(-2)}`,
    logicalRole: "yadam.script.segment",
    path: segmentFilename,
    sha256: segmentHash,
    schemaVersion: "1.0.0",
    producerStage: "segment-drafting",
    gateStatus: "pass",
    dependencyHashes: {
      "scriptPlan": planRecord.sha256
    }
  });

  const remainingSegments = segments.length - (nextSegmentIndex + 1);

  await transitionJob(jobDir, {
    stage: "SEGMENT_DRAFTED",
    to: "running",
    inputHash: hashCanonical(stageInput),
    outputHash: segmentHash,
    artifactPaths: [segmentFilename]
  });

  return {
    status: "drafted",
    segmentId,
    relativePath: segmentFilename,
    sha256: segmentHash,
    remainingSegments
  };
}
