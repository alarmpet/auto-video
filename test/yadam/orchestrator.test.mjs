import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createMasterOrchestrator } from "../../scripts/lib/pipeline/master-orchestrator.mjs";
import { writeCanonicalJson } from "../../scripts/lib/pipeline/atomic-store.mjs";
import { sha256Bytes } from "../../scripts/lib/pipeline/canonical-json.mjs";

test("Orchestrator sequential gates and service calls E2E with fakes", async () => {
  const tempJobDir = resolve(`test/yadam/tmp/orchestrator-e2e-${Date.now()}`);
  await rm(tempJobDir, { recursive: true, force: true });
  await mkdir(tempJobDir, { recursive: true });

  try {
    // 1. Initial request setup
    const request = {
      schemaVersion: "1.0.0",
      jobId: "job-123",
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
      jobId: "job-123",
      status: "running",
      durationRepairAttemptsUsed: 0,
      history: []
    });
    await writeCanonicalJson(join(tempJobDir, "artifact-manifest.json"), {
      schemaVersion: "1.0.0",
      jobId: "job-123",
      artifacts: [
        {
          artifactId: "pipeline-request",
          logicalRole: "pipeline.request",
          path: "request.json",
          sha256: sha256Bytes(readFileSync(join(tempJobDir, "request.json"))),
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

    const mockServices = {
      generateConceptOptions: async ({ jobDir }) => {
        calls.push("generateConceptOptions");
        const opts = { schemaVersion: "1.0.0", jobId: "job-123", options: [] };
        const optWrite = await writeCanonicalJson(join(jobDir, "planning/concept-options.json"), opts);
        const inputWrite = await writeCanonicalJson(join(jobDir, "planning/concept-inputs.json"), { req: "none" });

        const manifest = JSON.parse(readFileSync(join(jobDir, "artifact-manifest.json"), "utf8"));
        manifest.artifacts.push(
          { artifactId: "yadam-concept-options", logicalRole: "yadam.concept.options", path: "planning/concept-options.json", sha256: optWrite.sha256, schemaVersion: "1.0.0", producerStage: "concept-generation", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} },
          { artifactId: "yadam-concept-inputs", logicalRole: "yadam.concept.inputs", path: "planning/concept-inputs.json", sha256: inputWrite.sha256, schemaVersion: "1.0.0", producerStage: "concept-generation", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} }
        );
        writeFileSync(join(jobDir, "artifact-manifest.json"), JSON.stringify(manifest, null, 2));

        const state = JSON.parse(readFileSync(join(jobDir, "pipeline-state.json"), "utf8"));
        state.history.push({
          from: "running", to: "awaiting_approval", stage: "CONCEPT_OPTIONS_READY",
          inputHash: sha256Bytes(readFileSync(join(jobDir, "request.json"))),
          outputHash: optWrite.sha256,
          artifactPaths: ["planning/concept-inputs.json", "planning/concept-options.json"].sort(),
          at: new Date().toISOString()
        });
        state.status = "awaiting_approval";
        writeFileSync(join(jobDir, "pipeline-state.json"), JSON.stringify(state, null, 2));
        return { status: "options_ready" };
      },

      buildApprovalOneBundle: async ({ jobDir }) => {
        calls.push("buildApprovalOneBundle");
        const bundle = { schemaVersion: "1.0.0", jobId: "job-123" };
        const bWrite = await writeCanonicalJson(join(jobDir, "approvals/approval-1-bundle.json"), bundle);

        const manifest = JSON.parse(readFileSync(join(jobDir, "artifact-manifest.json"), "utf8"));
        manifest.artifacts.push(
          { artifactId: "yadam-approval-1-bundle", logicalRole: "yadam.approval.1.bundle", path: "approvals/approval-1-bundle.json", sha256: bWrite.sha256, schemaVersion: "1.0.0", producerStage: "approval-1-bundle", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} }
        );
        writeFileSync(join(jobDir, "artifact-manifest.json"), JSON.stringify(manifest, null, 2));

        const state = JSON.parse(readFileSync(jobDir + "/pipeline-state.json", "utf8"));
        state.history.push({
          from: "running", to: "awaiting_approval", stage: "APPROVAL_ONE_BUNDLE_READY",
          inputHash: "0".repeat(64), outputHash: bWrite.sha256,
          artifactPaths: ["approvals/approval-1-bundle.json"], at: new Date().toISOString()
        });
        state.status = "awaiting_approval";
        writeFileSync(jobDir + "/pipeline-state.json", JSON.stringify(state, null, 2));
        return { status: "bundle_ready" };
      },

      buildStoryBible: async ({ jobDir }) => {
        calls.push("buildStoryBible");
        const bible = { schemaVersion: "1.0.0" };
        const bWrite = await writeCanonicalJson(join(jobDir, "planning/story-bible.json"), bible);
        const manifest = JSON.parse(readFileSync(jobDir + "/artifact-manifest.json", "utf8"));
        manifest.artifacts.push({ artifactId: "yadam-story-bible", logicalRole: "yadam.story.bible", path: "planning/story-bible.json", sha256: bWrite.sha256, schemaVersion: "1.0.0", producerStage: "bible", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} });
        writeFileSync(jobDir + "/artifact-manifest.json", JSON.stringify(manifest, null, 2));

        const state = JSON.parse(readFileSync(jobDir + "/pipeline-state.json", "utf8"));
        state.history.push({ from: "running", to: "running", stage: "STORY_BIBLE_READY", inputHash: "0".repeat(64), outputHash: bWrite.sha256, artifactPaths: ["planning/story-bible.json"], at: new Date().toISOString() });
        writeFileSync(jobDir + "/pipeline-state.json", JSON.stringify(state, null, 2));
      },

      buildScriptPlan: async ({ jobDir }) => {
        calls.push("buildScriptPlan");
        const plan = { schemaVersion: "1.0.0", segments: [{ segmentId: "segment-01" }] };
        const pWrite = await writeCanonicalJson(join(jobDir, "planning/script-plan.json"), plan);
        const manifest = JSON.parse(readFileSync(jobDir + "/artifact-manifest.json", "utf8"));
        manifest.artifacts.push({ artifactId: "yadam-script-plan", logicalRole: "yadam.script.plan", path: "planning/script-plan.json", sha256: pWrite.sha256, schemaVersion: "1.0.0", producerStage: "script-planning", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} });
        writeFileSync(jobDir + "/artifact-manifest.json", JSON.stringify(manifest, null, 2));

        const state = JSON.parse(readFileSync(jobDir + "/pipeline-state.json", "utf8"));
        state.history.push({ from: "running", to: "running", stage: "SCRIPT_PLAN_READY", inputHash: "0".repeat(64), outputHash: pWrite.sha256, artifactPaths: ["planning/script-plan.json"], at: new Date().toISOString() });
        writeFileSync(jobDir + "/pipeline-state.json", JSON.stringify(state, null, 2));
      },

      draftNextSegment: async ({ jobDir }) => {
        calls.push("draftNextSegment");
        draftCount++;
        if (draftCount === 1) {
          const seg = { segmentId: "segment-01" };
          await mkdir(join(jobDir, "segments/segment-01"), { recursive: true });
          const sWrite = await writeCanonicalJson(join(jobDir, "segments/segment-01/script-segment.json"), seg);
          const manifest = JSON.parse(readFileSync(jobDir + "/artifact-manifest.json", "utf8"));
          manifest.artifacts.push({ artifactId: "yadam-script-segment-segment-01", logicalRole: "yadam.script.segment", path: "segments/segment-01/script-segment.json", sha256: sWrite.sha256, schemaVersion: "1.0.0", producerStage: "drafting", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} });
          writeFileSync(jobDir + "/artifact-manifest.json", JSON.stringify(manifest, null, 2));

          const state = JSON.parse(readFileSync(jobDir + "/pipeline-state.json", "utf8"));
          state.history.push({ from: "running", to: "running", stage: "SEGMENT_DRAFTED", inputHash: "0".repeat(64), outputHash: sWrite.sha256, artifactPaths: ["segments/segment-01/script-segment.json"], at: new Date().toISOString() });
          writeFileSync(jobDir + "/pipeline-state.json", JSON.stringify(state, null, 2));

          return { status: "drafted", remainingSegments: 0 };
        } else {
          return { status: "complete", remainingSegments: 0 };
        }
      },

      finalizeScriptPackage: async ({ jobDir }) => {
        calls.push("finalizeScriptPackage");
        const scriptScenes = { schemaVersion: "1.0.0", scenes: [] };
        const ssWrite = await writeCanonicalJson(join(jobDir, "script/script-scenes.json"), scriptScenes);
        await writeFile(join(jobDir, "script/final.txt"), "hello");
        const ftHash = sha256Bytes(Buffer.from("hello"));

        const manifest = JSON.parse(readFileSync(jobDir + "/artifact-manifest.json", "utf8"));
        manifest.artifacts.push(
          { artifactId: "yadam-script-scenes", logicalRole: "yadam.script.scenes", path: "script/script-scenes.json", sha256: ssWrite.sha256, schemaVersion: "1.0.0", producerStage: "finalize", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} },
          { artifactId: "yadam-final-text", logicalRole: "yadam.script.final_text", path: "script/final.txt", sha256: ftHash, schemaVersion: "1.0.0", producerStage: "finalize", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} }
        );
        writeFileSync(jobDir + "/artifact-manifest.json", JSON.stringify(manifest, null, 2));

        const state = JSON.parse(readFileSync(jobDir + "/pipeline-state.json", "utf8"));
        state.history.push({ from: "running", to: "running", stage: "SCRIPT_PACKAGE_READY", inputHash: "0".repeat(64), outputHash: ssWrite.sha256, artifactPaths: ["script/script-scenes.json", "script/final.txt"].sort(), at: new Date().toISOString() });
        writeFileSync(jobDir + "/pipeline-state.json", JSON.stringify(state, null, 2));
      },

      generateThumbnailPlan: async ({ jobDir }) => {
        calls.push("generateThumbnailPlan");
        const tPlan = { schemaVersion: "1.0.0" };
        const tpWrite = await writeCanonicalJson(join(jobDir, "planning/thumbnail-plan.json"), tPlan);
        const manifest = JSON.parse(readFileSync(jobDir + "/artifact-manifest.json", "utf8"));
        manifest.artifacts.push({ artifactId: "yadam-thumbnail-plan", logicalRole: "yadam.thumbnail.plan", path: "planning/thumbnail-plan.json", sha256: tpWrite.sha256, schemaVersion: "1.0.0", producerStage: "thumbnail-plan", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} });
        writeFileSync(jobDir + "/artifact-manifest.json", JSON.stringify(manifest, null, 2));

        const state = JSON.parse(readFileSync(jobDir + "/pipeline-state.json", "utf8"));
        state.history.push({ from: "running", to: "awaiting_approval", stage: "THUMBNAIL_OPTIONS_READY", inputHash: "0".repeat(64), outputHash: tpWrite.sha256, artifactPaths: ["planning/thumbnail-plan.json"], at: new Date().toISOString() });
        state.status = "awaiting_approval";
        writeFileSync(jobDir + "/pipeline-state.json", JSON.stringify(state, null, 2));
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

    // Run first stage -> stops at concept_selection user gate
    const res1 = await orchestrator.runJobUntilBlocked({ jobDir: tempJobDir });
    assert.equal(res1.status, "awaiting_user");
    assert.equal(res1.gate, "concept_selection");
    assert.equal(res1.bundlePath, "reviews/concept-selection-r001.md");

    // Mock Concept Selection Command
    const sel = { candidateId: "concept-c01" };
    const selWrite = await writeCanonicalJson(join(tempJobDir, "planning/concept-selection.json"), sel);
    const manifest = JSON.parse(readFileSync(tempJobDir + "/artifact-manifest.json", "utf8"));
    manifest.artifacts.push({ artifactId: "yadam-concept-selection", logicalRole: "yadam.concept.selection", path: "planning/concept-selection.json", sha256: selWrite.sha256, schemaVersion: "1.0.0", producerStage: "concept-selection", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} });
    writeFileSync(tempJobDir + "/artifact-manifest.json", JSON.stringify(manifest, null, 2));
    const state = JSON.parse(readFileSync(tempJobDir + "/pipeline-state.json", "utf8"));
    state.history.push({ from: "awaiting_approval", to: "running", stage: "CONCEPT_SELECTED", inputHash: "0".repeat(64), outputHash: selWrite.sha256, artifactPaths: ["planning/concept-selection.json"], at: new Date().toISOString() });
    state.status = "running";
    writeFileSync(tempJobDir + "/pipeline-state.json", JSON.stringify(state, null, 2));

    // Run next stage -> calls buildApprovalOneBundle and stops at approval_1 user gate
    const res2 = await orchestrator.runJobUntilBlocked({ jobDir: tempJobDir });
    assert.equal(res2.status, "awaiting_user");
    assert.equal(res2.gate, "approval_1");

    // Mock Approval 1 Command
    const app1 = { status: "valid", approvedArtifactSetHash: "0".repeat(64) };
    const app1Write = await writeCanonicalJson(join(tempJobDir, "approvals/approval-1-r001.json"), app1);
    await writeCanonicalJson(join(tempJobDir, "approvals/current-approval-1.json"), { status: "valid", revision: 1, path: "approvals/approval-1-r001.json", sha256: app1Write.sha256, approvedArtifactSetHash: "0".repeat(64) });
    const manifest2 = JSON.parse(readFileSync(tempJobDir + "/artifact-manifest.json", "utf8"));
    manifest2.artifacts.push({ artifactId: "yadam-approval-1-current", logicalRole: "yadam.approval.1", path: "approvals/approval-1-r001.json", sha256: app1Write.sha256, schemaVersion: "1.0.0", producerStage: "approval-1", gateStatus: "pass", dependencyHashes: {}, dependencyKinds: {}, dependencyOwners: {} });
    writeFileSync(tempJobDir + "/artifact-manifest.json", JSON.stringify(manifest2, null, 2));
    const state2 = JSON.parse(readFileSync(tempJobDir + "/pipeline-state.json", "utf8"));
    state2.history.push({ from: "awaiting_approval", to: "running", stage: "APPROVAL_ONE_GRANTED", inputHash: "0".repeat(64), outputHash: app1Write.sha256, artifactPaths: ["approvals/approval-1-r001.json", "approvals/current-approval-1.json"].sort(), at: new Date().toISOString() });
    state2.status = "running";
    writeFileSync(tempJobDir + "/pipeline-state.json", JSON.stringify(state2, null, 2));

    // Run next stage -> calls story_bible, script_plan, repeats draftNextSegment (1 segment), finalizeScriptPackage, generateThumbnailPlan, stops at thumbnail_copy_selection
    const res3 = await orchestrator.runJobUntilBlocked({ jobDir: tempJobDir });
    assert.equal(res3.status, "awaiting_user");
    assert.equal(res3.gate, "thumbnail_copy_selection");
    assert.equal(calls.includes("buildStoryBible"), true);
    assert.equal(calls.includes("buildScriptPlan"), true);
    assert.equal(draftCount, 2); // proof that it ran first and second draft calls to finish repeating drafts!

  } finally {
    await rm(tempJobDir, { recursive: true, force: true });
  }
});
