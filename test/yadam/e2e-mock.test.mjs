import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createMasterOrchestrator } from "../../scripts/lib/pipeline/master-orchestrator.mjs";
import { writeCanonicalJson } from "../../scripts/lib/pipeline/atomic-store.mjs";
import { sha256Bytes } from "../../scripts/lib/pipeline/canonical-json.mjs";
import { buildSuccessEvidence } from "../../scripts/lib/pipeline/success-evidence.mjs";

test("Full E2E Mock Orchestrator lifecycle run", async () => {
  const tempJobDir = resolve(`test/yadam/tmp/e2e-mock-job-${Date.now()}`);
  await rm(tempJobDir, { recursive: true, force: true });
  await mkdir(tempJobDir, { recursive: true });

  try {
    // 1. Setup Request & Config
    const request = {
      schemaVersion: "1.0.0",
      jobId: "job-e2e-123",
      profileId: "yadam",
      targetMinutes: 10,
      seed: 42,
      inputMode: "reference",
      source: { kind: "script", value: "hello" },
      createdAt: new Date().toISOString()
    };
    await writeCanonicalJson(join(tempJobDir, "request.json"), request);
    await writeCanonicalJson(join(tempJobDir, "pipeline-state.json"), {
      schemaVersion: "1.0.0",
      jobId: "job-e2e-123",
      status: "running",
      durationRepairAttemptsUsed: 0,
      history: []
    });

    const requestHash = sha256Bytes(readFileSync(join(tempJobDir, "request.json")));
    await writeCanonicalJson(join(tempJobDir, "artifact-manifest.json"), {
      schemaVersion: "1.0.0",
      jobId: "job-e2e-123",
      artifacts: [
        {
          artifactId: "pipeline-request",
          logicalRole: "pipeline.request",
          path: "request.json",
          sha256: requestHash,
          schemaVersion: "1.0.0",
          producerStage: "job-create",
          gateStatus: "pass",
          dependencyHashes: {},
          dependencyKinds: {},
          dependencyOwners: {}
        }
      ]
    });

    const calls = [];
    let draftCount = 0;

    // Helper to register mock artifacts and return their hash
    async function registerMockArtifact(jobDir, logicalRole, filename, content = { mock: logicalRole }) {
      const dir = join(jobDir, filename.includes("/") ? filename.substring(0, filename.lastIndexOf("/")) : "");
      if (dir) await mkdir(dir, { recursive: true });
      const filePath = join(jobDir, filename);
      await writeFile(filePath, JSON.stringify(content));
      const sha = sha256Bytes(readFileSync(filePath));
      const manifest = JSON.parse(readFileSync(join(jobDir, "artifact-manifest.json"), "utf8"));
      manifest.artifacts.push({
        artifactId: `mock-${logicalRole.replaceAll(".", "-")}`,
        logicalRole,
        path: filename,
        sha256: sha,
        schemaVersion: "1.0.0",
        producerStage: "mock",
        gateStatus: "pass",
        dependencyHashes: {},
        dependencyKinds: {},
        dependencyOwners: {}
      });
      writeFileSync(join(jobDir, "artifact-manifest.json"), JSON.stringify(manifest, null, 2));
      return { artifactId: `mock-${logicalRole.replaceAll(".", "-")}`, logicalRole, path: filename, sha256: sha };
    }

    // Helper to transition state correctly
    async function transitionMockStage({ jobDir, stageId, successEvent, toStatus, inputs, outputs, opaque = {} }) {
      const state = JSON.parse(readFileSync(join(jobDir, "pipeline-state.json"), "utf8"));
      const manifest = JSON.parse(readFileSync(join(jobDir, "artifact-manifest.json"), "utf8"));

      let inputHash = "0".repeat(64);
      let outputHash = "0".repeat(64);

      const getArtHash = (role) => manifest.artifacts.find(a => a.logicalRole === role && a.gateStatus === "pass")?.sha256 || "0".repeat(64);

      if (stageId === "concept_options") {
        inputHash = manifest.artifacts.find(a => a.logicalRole === "pipeline.request").sha256;
        outputHash = getArtHash("yadam.concept.options");
      } else if (stageId === "approval_1_bundle") {
        inputHash = getArtHash("yadam.concept.options");
        outputHash = getArtHash("yadam.approval.1.bundle");
      } else if (stageId === "story_bible") {
        inputHash = getArtHash("yadam.approval.1");
        outputHash = getArtHash("yadam.story.bible");
      } else if (stageId === "script_plan") {
        inputHash = getArtHash("yadam.story.bible");
        outputHash = getArtHash("yadam.script.plan");
      } else if (stageId === "final_script_qa") {
        inputHash = getArtHash("yadam.script.plan");
        outputHash = getArtHash("yadam.script.scenes");
      } else if (stageId === "thumbnail_plan") {
        inputHash = getArtHash("yadam.script.scenes");
        outputHash = getArtHash("yadam.thumbnail.plan");
      } else if (stageId === "thumbnail_copy_selection") {
        inputHash = getArtHash("yadam.thumbnail.plan");
        outputHash = getArtHash("yadam.thumbnail.selection");
      } else if (stageId === "approval_2_previews") {
        inputHash = getArtHash("yadam.script.scenes");
        outputHash = getArtHash("yadam.preview.manifest");
      } else if (stageId === "approval_2_bundle") {
        inputHash = getArtHash("yadam.preview.manifest");
        outputHash = getArtHash("yadam.approval.2.bundle");
      } else if (stageId === "reference_promotion") {
        inputHash = getArtHash("yadam.approval.2");
        outputHash = getArtHash("yadam.character.reference-pointer");
      } else {
        const inputRecs = manifest.artifacts.filter(a => inputs.includes(a.logicalRole) && a.gateStatus === "pass");
        const outputRecs = manifest.artifacts.filter(a => outputs.some(o => o.path === a.path) && a.gateStatus === "pass");
        const evidence = buildSuccessEvidence(successEvent, inputRecs, outputRecs, opaque);
        inputHash = evidence.inputHash;
        outputHash = evidence.outputHash;
      }

      state.history.push({
        from: state.status,
        to: toStatus,
        stage: successEvent,
        inputHash,
        outputHash,
        artifactPaths: outputs.map(o => o.path).sort(),
        at: new Date().toISOString()
      });
      state.status = toStatus;
      writeFileSync(join(jobDir, "pipeline-state.json"), JSON.stringify(state, null, 2));
    }

    const mockServices = {
      generateConceptOptions: async ({ jobDir }) => {
        calls.push("generateConceptOptions");
        await mkdir(join(jobDir, "planning"), { recursive: true });
        const optsRec = await registerMockArtifact(jobDir, "yadam.concept.options", "planning/concept-options.json", { schemaVersion: "1.0.0", options: [] });
        const inputsRec = await registerMockArtifact(jobDir, "yadam.concept.inputs", "planning/concept-inputs.json");
        
        await transitionMockStage({
          jobDir, stageId: "concept_options", successEvent: "CONCEPT_OPTIONS_READY", toStatus: "awaiting_approval",
          inputs: ["pipeline.request"], outputs: [optsRec, inputsRec]
        });
        return { status: "options_ready" };
      },

      buildApprovalOneBundle: async ({ jobDir }) => {
        calls.push("buildApprovalOneBundle");
        // Register Brief & Outline required inputs
        await registerMockArtifact(jobDir, "yadam.hook.brief", "planning/brief.json");
        await registerMockArtifact(jobDir, "yadam.outline", "planning/outline.json");

        const bundleRec = await registerMockArtifact(jobDir, "yadam.approval.1.bundle", "approvals/approval-1-bundle.json");

        await transitionMockStage({
          jobDir, stageId: "approval_1_bundle", successEvent: "APPROVAL_ONE_BUNDLE_READY", toStatus: "awaiting_approval",
          inputs: ["yadam.concept.options", "yadam.concept.selection"], outputs: [bundleRec]
        });
      },

      buildStoryBible: async ({ jobDir }) => {
        calls.push("buildStoryBible");
        const bibleRec = await registerMockArtifact(jobDir, "yadam.story.bible", "planning/story-bible.json");
        await transitionMockStage({
          jobDir, stageId: "story_bible", successEvent: "STORY_BIBLE_READY", toStatus: "running",
          inputs: ["yadam.approval.1"], outputs: [bibleRec]
        });
      },

      buildScriptPlan: async ({ jobDir }) => {
        calls.push("buildScriptPlan");
        const planRec = await registerMockArtifact(jobDir, "yadam.script.plan", "planning/script-plan.json", { schemaVersion: "1.0.0", segments: [{ segmentId: "segment-01" }] });
        await transitionMockStage({
          jobDir, stageId: "script_plan", successEvent: "SCRIPT_PLAN_READY", toStatus: "running",
          inputs: ["yadam.story.bible", "yadam.outline"], outputs: [planRec]
        });
      },

      draftNextSegment: async ({ jobDir }) => {
        calls.push("draftNextSegment");
        draftCount++;
        if (draftCount === 1) {
          const segRec = await registerMockArtifact(jobDir, "yadam.script.segment", "segments/segment-01/script-segment.json", { segmentId: "segment-01" });
          
          await transitionMockStage({
            jobDir, stageId: "segment_drafts", successEvent: "SEGMENT_DRAFTED", toStatus: "running",
            inputs: ["yadam.script.plan", "yadam.story.bible"], outputs: [segRec]
          });
          return { status: "drafted", remainingSegments: 0 };
        } else {
          return { status: "complete", remainingSegments: 0 };
        }
      },

      finalizeScriptPackage: async ({ jobDir }) => {
        calls.push("finalizeScriptPackage");
        const scenesRec = await registerMockArtifact(jobDir, "yadam.script.scenes", "script/script-scenes.json", { schemaVersion: "1.0.0", scenes: [] });
        const finalTextRec = await registerMockArtifact(jobDir, "yadam.script.final_text", "script/final.txt");
        const scenePlanRec = await registerMockArtifact(jobDir, "yadam.scene.plan", "planning/scene-plan.json");

        await transitionMockStage({
          jobDir, stageId: "final_script_qa", successEvent: "SCRIPT_PACKAGE_READY", toStatus: "running",
          inputs: ["yadam.script.plan", "yadam.script.segment"], outputs: [scenesRec, finalTextRec, scenePlanRec]
        });
      },

      generateThumbnailPlan: async ({ jobDir }) => {
        calls.push("generateThumbnailPlan");
        const tPlanRec = await registerMockArtifact(jobDir, "yadam.thumbnail.plan", "planning/thumbnail-plan.json");
        await transitionMockStage({
          jobDir, stageId: "thumbnail_plan", successEvent: "THUMBNAIL_OPTIONS_READY", toStatus: "awaiting_approval",
          inputs: ["yadam.script.scenes", "yadam.story.bible", "yadam.scene.plan"], outputs: [tPlanRec]
        });
      },

      buildApproval2Previews: async ({ jobDir }) => {
        calls.push("buildApproval2Previews");
        const prevRec = await registerMockArtifact(jobDir, "yadam.preview.manifest", "previews/preview-manifest.json", { schemaVersion: "1.0.0", previews: [] });
        await transitionMockStage({
          jobDir, stageId: "approval_2_previews", successEvent: "APPROVAL_TWO_PREVIEWS_READY", toStatus: "pass",
          inputs: ["yadam.scene.plan", "yadam.thumbnail.plan", "yadam.thumbnail.selection", "yadam.story.bible"], outputs: [prevRec]
        });
      },

      buildApprovalTwoBundle: async ({ jobDir }) => {
        calls.push("buildApprovalTwoBundle");
        // Register required items before bundle
        await registerMockArtifact(jobDir, "yadam.script.qa", "script/qa-report.json");
        await registerMockArtifact(jobDir, "yadam.coverage.script", "script/coverage-report.json");
        await registerMockArtifact(jobDir, "yadam.thumbnail.guide", "planning/thumbnail-guide.json");

        const bundle2Rec = await registerMockArtifact(jobDir, "yadam.approval.2.bundle", "approvals/approval-2-bundle.json");

        await transitionMockStage({
          jobDir, stageId: "approval_2_bundle", successEvent: "APPROVAL_TWO_BUNDLE_READY", toStatus: "awaiting_approval",
          inputs: ["yadam.script.final_text", "yadam.script.scenes", "yadam.script.qa", "yadam.coverage.script", "yadam.thumbnail.selection", "yadam.thumbnail.guide", "yadam.preview.manifest"], outputs: [bundle2Rec]
        });
      },

      promoteApprovedReferenceSet: async ({ jobDir }) => {
        calls.push("promoteApprovedReferenceSet");
        await registerMockArtifact(jobDir, "yadam.character.reference-set", "character/reference-set.json");
        const refPointerRec = await registerMockArtifact(jobDir, "yadam.character.reference-pointer", "character/reference-pointer.json");

        await transitionMockStage({
          jobDir, stageId: "reference_promotion", successEvent: "REFERENCE_SET_PROMOTED", toStatus: "pass",
          inputs: ["yadam.approval.2"], outputs: [refPointerRec]
        });
      },

      runFullTts: async ({ jobDir }) => {
        calls.push("runFullTts");
        await registerMockArtifact(jobDir, "yadam.audio.timeline", "audio/audio-timeline.json");
        await registerMockArtifact(jobDir, "yadam.render_plan_input", "audio/render-plan-input.json");

        const audioRec = await registerMockArtifact(jobDir, "yadam.audio.manifest", "audio/audio-manifest.json");

        await transitionMockStage({
          jobDir, stageId: "full_tts", successEvent: "AUDIO_PASSED", toStatus: "running",
          inputs: ["yadam.approval.2", "yadam.script.scenes", "yadam.scene.plan"], outputs: [audioRec]
        });
      },

      generateProductionImages: async ({ jobDir }) => {
        calls.push("generateProductionImages");
        await registerMockArtifact(jobDir, "yadam.render.plan", "planning/render-plan.json");
        await registerMockArtifact(jobDir, "yadam.thumbnail.final", "planning/thumbnail-final.png");
        await registerMockArtifact(jobDir, "yadam.thumbnail.qa", "planning/thumbnail-qa.json");
        await registerMockArtifact(jobDir, "yadam.coverage.visual", "planning/coverage-visual.json");

        const imagesRec = await registerMockArtifact(jobDir, "yadam.image.asset-manifest", "assets/asset-manifest.json");
        const visualQaRec = await registerMockArtifact(jobDir, "yadam.image.visual-qa", "assets/visual-qa.json");

        await transitionMockStage({
          jobDir, stageId: "production_images", successEvent: "IMAGES_PASSED", toStatus: "pass",
          inputs: ["yadam.audio.manifest", "yadam.audio.timeline", "yadam.render_plan_input", "yadam.approval.2", "yadam.character.reference-set", "yadam.character.reference-pointer"], outputs: [imagesRec, visualQaRec]
        });
      },

      assembleAllSegments: async ({ jobDir }) => {
        calls.push("assembleAllSegments");
        await registerMockArtifact(jobDir, "yadam.coverage.audio", "planning/coverage-audio.json");
        await registerMockArtifact(jobDir, "yadam.coverage.subtitle", "planning/coverage-subtitle.json");

        const smRec = await registerMockArtifact(jobDir, "yadam.segment.manifest", "segment-manifest.json");

        await transitionMockStage({
          jobDir, stageId: "segment_assembly", successEvent: "SEGMENTS_PASSED", toStatus: "running",
          inputs: ["yadam.approval.2", "yadam.script.final_text", "yadam.script.scenes", "yadam.audio.manifest", "yadam.audio.timeline", "yadam.render_plan_input", "yadam.render.plan", "yadam.image.asset-manifest", "yadam.image.visual-qa", "yadam.thumbnail.final", "yadam.thumbnail.qa", "yadam.coverage.audio", "yadam.coverage.visual"], outputs: [smRec]
        });
      },

      publishFinalVideo: async ({ jobDir }) => {
        calls.push("publishFinalVideo");
        const state = JSON.parse(readFileSync(jobDir + "/pipeline-state.json", "utf8"));
        state.status = "completed";
        state.history.push({ from: "running", to: "completed", stage: "FINAL_QA_PASSED", inputHash: "0".repeat(64), outputHash: "0".repeat(64), artifactPaths: [], at: new Date().toISOString() });
        writeFileSync(jobDir + "/pipeline-state.json", JSON.stringify(state, null, 2));
        return { finalPath: "final/final-full.mp4", qaPath: "final/final-qa-report.json" };
      },

      loadFinalQa: async () => {
        calls.push("loadFinalQa");
        return { qualityOk: true, finalVerdict: "pass" };
      },

      recordCompletedStoryFingerprint: async () => {
        calls.push("recordCompletedStoryFingerprint");
        return { entryHash: "1".repeat(64) };
      }
    };

    const mockRenderReviewBundle = async ({ jobDir, gate }) => {
      const slug = gate.replaceAll("_", "-");
      const name = `${slug}-r001.md`;
      const bundleRel = `reviews/${name}`;
      const bundlePath = join(jobDir, bundleRel);
      await mkdir(join(jobDir, "reviews"), { recursive: true });
      writeFileSync(bundlePath, "human review markdown bundle content");
      const hash = sha256Bytes(Buffer.from("human review markdown bundle content"));
      return {
        bundlePath: bundleRel,
        bundleHash: hash,
        indexPath: `reviews/${gate}-index-r001.json`
      };
    };

    const orchestrator = createMasterOrchestrator({
      services: mockServices,
      renderReviewBundle: mockRenderReviewBundle
    });

    // Run E2E step-by-step
    // 1. Start -> concept options ready, stops at concept_selection
    let res = await orchestrator.runJobUntilBlocked({ jobDir: tempJobDir });
    assert.equal(res.status, "awaiting_user");
    assert.equal(res.gate, "concept_selection");

    // Mock Concept Selection
    const selRec = await registerMockArtifact(tempJobDir, "yadam.concept.selection", "planning/concept-selection.json", { candidateId: "concept-c01" });
    let state = JSON.parse(readFileSync(tempJobDir + "/pipeline-state.json", "utf8"));
    state.history.push({ from: "awaiting_approval", to: "running", stage: "CONCEPT_SELECTED", inputHash: "0".repeat(64), outputHash: selRec.sha256, artifactPaths: ["planning/concept-selection.json"], at: new Date().toISOString() });
    state.status = "running";
    writeFileSync(tempJobDir + "/pipeline-state.json", JSON.stringify(state, null, 2));

    // 2. Resume -> approval 1 bundle ready, stops at approval_1
    res = await orchestrator.runJobUntilBlocked({ jobDir: tempJobDir });
    assert.equal(res.status, "awaiting_user");
    assert.equal(res.gate, "approval_1");

    // Mock Approval 1
    const app1 = { status: "valid", approvedArtifactSetHash: "0".repeat(64) };
    const app1Write = await writeCanonicalJson(join(tempJobDir, "approvals/approval-1-r001.json"), app1);
    await writeCanonicalJson(join(tempJobDir, "approvals/current-approval-1.json"), { status: "valid", revision: 1, path: "approvals/approval-1-r001.json", sha256: app1Write.sha256, approvedArtifactSetHash: "0".repeat(64) });
    let manifest = JSON.parse(readFileSync(tempJobDir + "/artifact-manifest.json", "utf8"));
    manifest.artifacts.push({ artifactId: "yadam-approval-1-current", logicalRole: "yadam.approval.1", path: "approvals/approval-1-r001.json", sha256: app1Write.sha256, schemaVersion: "1.0.0", producerStage: "approval-1", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} });
    writeFileSync(tempJobDir + "/artifact-manifest.json", JSON.stringify(manifest, null, 2));
    state = JSON.parse(readFileSync(tempJobDir + "/pipeline-state.json", "utf8"));
    state.history.push({ from: "awaiting_approval", to: "running", stage: "APPROVAL_ONE_GRANTED", inputHash: "0".repeat(64), outputHash: app1Write.sha256, artifactPaths: ["approvals/approval-1-r001.json", "approvals/current-approval-1.json"].sort(), at: new Date().toISOString() });
    state.status = "running";
    writeFileSync(tempJobDir + "/pipeline-state.json", JSON.stringify(state, null, 2));

    // 3. Resume -> story_bible, script_plan, repeats drafts, final_script_qa, thumbnail_plan, stops at thumbnail_copy_selection
    res = await orchestrator.runJobUntilBlocked({ jobDir: tempJobDir });
    assert.equal(res.status, "awaiting_user");
    assert.equal(res.gate, "thumbnail_copy_selection");

    // Mock Thumbnail Selection
    const thSelRec = await registerMockArtifact(tempJobDir, "yadam.thumbnail.selection", "planning/thumbnail-selection.json", { copyId: "copy-01" });
    state = JSON.parse(readFileSync(tempJobDir + "/pipeline-state.json", "utf8"));
    state.history.push({ from: "awaiting_approval", to: "running", stage: "THUMBNAIL_COPY_SELECTED", inputHash: "0".repeat(64), outputHash: thSelRec.sha256, artifactPaths: ["planning/thumbnail-selection.json"], at: new Date().toISOString() });
    state.status = "running";
    writeFileSync(tempJobDir + "/pipeline-state.json", JSON.stringify(state, null, 2));

    // 4. Resume -> approval_2_previews, approval_2_bundle, stops at approval_2
    const debugState = JSON.parse(readFileSync(tempJobDir + "/pipeline-state.json", "utf8"));
    console.error("STEP 4 START. History stages:", debugState.history.map(h => `${h.stage} (${h.to})`));
    res = await orchestrator.runJobUntilBlocked({ jobDir: tempJobDir });
    console.error("STEP 4 RESULT:", res);
    assert.equal(res.status, "awaiting_user");
    assert.equal(res.gate, "approval_2");

    // Mock Approval 2
    const app2 = { status: "valid", approvedArtifactSetHash: "0".repeat(64) };
    const app2Write = await writeCanonicalJson(join(tempJobDir, "approvals/approval-2-r001.json"), app2);
    await writeCanonicalJson(join(tempJobDir, "approvals/current-approval-2.json"), { status: "valid", revision: 1, path: "approvals/approval-2-r001.json", sha256: app2Write.sha256, approvedArtifactSetHash: "0".repeat(64) });
    manifest = JSON.parse(readFileSync(tempJobDir + "/artifact-manifest.json", "utf8"));
    manifest.artifacts.push({ artifactId: "yadam-approval-2-current", logicalRole: "yadam.approval.2", path: "approvals/approval-2-r001.json", sha256: app2Write.sha256, schemaVersion: "1.0.0", producerStage: "approval-2", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} });
    writeFileSync(tempJobDir + "/artifact-manifest.json", JSON.stringify(manifest, null, 2));
    state = JSON.parse(readFileSync(tempJobDir + "/pipeline-state.json", "utf8"));
    state.history.push({ from: "awaiting_approval", to: "running", stage: "APPROVAL_TWO_GRANTED", inputHash: "0".repeat(64), outputHash: app2Write.sha256, artifactPaths: ["approvals/approval-2-r001.json", "approvals/current-approval-2.json"].sort(), at: new Date().toISOString() });
    state.status = "running";
    writeFileSync(tempJobDir + "/pipeline-state.json", JSON.stringify(state, null, 2));

    // 5. Resume -> promote reference, tts, images, segments, publish, completes!
    res = await orchestrator.runJobUntilBlocked({ jobDir: tempJobDir });
    assert.equal(res.status, "completed");
    assert.equal(res.finalVideoPath, "final/final-full.mp4");
    assert.equal(res.finalQaPath, "final/final-qa-report.json");

  } finally {
    await rm(tempJobDir, { recursive: true, force: true });
  }
});
