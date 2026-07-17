import { resolve } from "node:path";

export const YADAM_STAGES = Object.freeze([
  Object.freeze({ stageId: "concept_options", serviceMethod: "generateConceptOptions", requiresArtifactRoles: Object.freeze(["pipeline.request"]), successEvent: "CONCEPT_OPTIONS_READY", userGate: null, invalidatedByRoles: Object.freeze(["pipeline.request", "yadam.concept.inputs"]) }),
  Object.freeze({ stageId: "concept_selection", serviceMethod: null, requiresArtifactRoles: Object.freeze(["yadam.concept.options"]), successEvent: "CONCEPT_SELECTED", userGate: "concept_selection", invalidatedByRoles: Object.freeze(["yadam.concept.options"]) }),
  Object.freeze({ stageId: "approval_1_bundle", serviceMethod: "buildApprovalOneBundle", requiresArtifactRoles: Object.freeze(["yadam.concept.options", "yadam.concept.selection"]), successEvent: "APPROVAL_ONE_BUNDLE_READY", userGate: null, invalidatedByRoles: Object.freeze(["yadam.concept.options", "yadam.concept.selection"]) }),
  Object.freeze({ stageId: "approval_1", serviceMethod: null, requiresArtifactRoles: Object.freeze(["yadam.approval.1.bundle", "yadam.concept.selection", "yadam.hook.brief", "yadam.outline"]), successEvent: "APPROVAL_ONE_GRANTED", userGate: "approval_1", invalidatedByRoles: Object.freeze(["yadam.approval.1.bundle", "yadam.concept.selection", "yadam.hook.brief", "yadam.outline"]) }),
  Object.freeze({ stageId: "story_bible", serviceMethod: "buildStoryBible", requiresArtifactRoles: Object.freeze(["yadam.approval.1"]), successEvent: "STORY_BIBLE_READY", userGate: null, invalidatedByRoles: Object.freeze(["yadam.approval.1"]) }),
  Object.freeze({ stageId: "script_plan", serviceMethod: "buildScriptPlan", requiresArtifactRoles: Object.freeze(["yadam.story.bible", "yadam.outline"]), successEvent: "SCRIPT_PLAN_READY", userGate: null, invalidatedByRoles: Object.freeze(["yadam.story.bible", "yadam.outline"]) }),
  Object.freeze({ stageId: "segment_drafts", serviceMethod: "draftNextSegment", requiresArtifactRoles: Object.freeze(["yadam.script.plan", "yadam.story.bible"]), successEvent: "SEGMENT_DRAFTED", userGate: null, invalidatedByRoles: Object.freeze(["yadam.script.plan", "yadam.story.bible"]) }),
  Object.freeze({ stageId: "final_script_qa", serviceMethod: "finalizeScriptPackage", requiresArtifactRoles: Object.freeze(["yadam.script.plan", "yadam.script.segment"]), successEvent: "SCRIPT_PACKAGE_READY", userGate: null, invalidatedByRoles: Object.freeze(["yadam.script.plan", "yadam.script.segment"]) }),
  Object.freeze({ stageId: "thumbnail_plan", serviceMethod: "generateThumbnailPlan", requiresArtifactRoles: Object.freeze(["yadam.script.scenes", "yadam.story.bible", "yadam.scene.plan"]), successEvent: "THUMBNAIL_OPTIONS_READY", userGate: null, invalidatedByRoles: Object.freeze(["yadam.script.scenes", "yadam.story.bible", "yadam.scene.plan"]) }),
  Object.freeze({ stageId: "thumbnail_copy_selection", serviceMethod: null, requiresArtifactRoles: Object.freeze(["yadam.thumbnail.plan"]), successEvent: "THUMBNAIL_COPY_SELECTED", userGate: "thumbnail_copy_selection", invalidatedByRoles: Object.freeze(["yadam.thumbnail.plan"]) }),
  Object.freeze({ stageId: "approval_2_previews", serviceMethod: "buildApproval2Previews", requiresArtifactRoles: Object.freeze(["yadam.scene.plan", "yadam.thumbnail.plan", "yadam.thumbnail.selection", "yadam.story.bible"]), successEvent: "APPROVAL_TWO_PREVIEWS_READY", userGate: null, invalidatedByRoles: Object.freeze(["yadam.scene.plan", "yadam.thumbnail.plan", "yadam.thumbnail.selection", "yadam.story.bible"]) }),
  Object.freeze({ stageId: "approval_2_bundle", serviceMethod: "buildApprovalTwoBundle", requiresArtifactRoles: Object.freeze(["yadam.script.final_text", "yadam.script.scenes", "yadam.script.qa", "yadam.coverage.script", "yadam.thumbnail.selection", "yadam.thumbnail.guide", "yadam.preview.manifest"]), successEvent: "APPROVAL_TWO_BUNDLE_READY", userGate: null, invalidatedByRoles: Object.freeze(["yadam.script.final_text", "yadam.script.scenes", "yadam.script.qa", "yadam.coverage.script", "yadam.thumbnail.selection", "yadam.thumbnail.guide", "yadam.preview.manifest"]) }),
  Object.freeze({ stageId: "approval_2", serviceMethod: null, requiresArtifactRoles: Object.freeze(["yadam.approval.2.bundle", "yadam.script.final_text", "yadam.script.scenes", "yadam.scene.plan"]), successEvent: "APPROVAL_TWO_GRANTED", userGate: "approval_2", invalidatedByRoles: Object.freeze(["yadam.approval.2.bundle", "yadam.script.final_text", "yadam.script.scenes", "yadam.scene.plan"]) }),
  Object.freeze({ stageId: "reference_promotion", serviceMethod: "promoteApprovedReferenceSet", requiresArtifactRoles: Object.freeze(["yadam.approval.2"]), successEvent: "REFERENCE_SET_PROMOTED", userGate: null, invalidatedByRoles: Object.freeze(["yadam.approval.2"]) }),
  Object.freeze({ stageId: "full_tts", serviceMethod: "runFullTts", requiresArtifactRoles: Object.freeze(["yadam.approval.2", "yadam.script.scenes", "yadam.scene.plan"]), successEvent: "AUDIO_PASSED", userGate: null, invalidatedByRoles: Object.freeze(["yadam.approval.2", "yadam.script.scenes", "yadam.scene.plan"]) }),
  Object.freeze({ stageId: "production_images", serviceMethod: "generateProductionImages", requiresArtifactRoles: Object.freeze(["yadam.audio.manifest", "yadam.audio.timeline", "yadam.render_plan_input", "yadam.approval.2", "yadam.character.reference-set", "yadam.character.reference-pointer"]), successEvent: "IMAGES_PASSED", userGate: null, invalidatedByRoles: Object.freeze(["yadam.audio.manifest", "yadam.audio.timeline", "yadam.render_plan_input", "yadam.approval.2", "yadam.character.reference-set", "yadam.character.reference-pointer"]) }),
  Object.freeze({ stageId: "segment_assembly", serviceMethod: "assembleAllSegments", requiresArtifactRoles: Object.freeze(["yadam.approval.2", "yadam.script.final_text", "yadam.script.scenes", "yadam.audio.manifest", "yadam.audio.timeline", "yadam.render_plan_input", "yadam.render.plan", "yadam.image.asset-manifest", "yadam.image.visual-qa", "yadam.thumbnail.final", "yadam.thumbnail.qa", "yadam.coverage.audio", "yadam.coverage.visual"]), successEvent: "SEGMENTS_PASSED", userGate: null, invalidatedByRoles: Object.freeze(["yadam.approval.2", "yadam.script.final_text", "yadam.script.scenes", "yadam.audio.manifest", "yadam.audio.timeline", "yadam.render_plan_input", "yadam.render.plan", "yadam.image.asset-manifest", "yadam.image.visual-qa", "yadam.thumbnail.final", "yadam.thumbnail.qa", "yadam.coverage.audio", "yadam.coverage.visual"]) }),
  Object.freeze({ stageId: "final_publish", serviceMethod: "publishFinalVideo", requiresArtifactRoles: Object.freeze(["yadam.segment.manifest"]), successEvent: "FINAL_QA_PASSED", userGate: null, invalidatedByRoles: Object.freeze(["yadam.segment.manifest"]) })
]);

export const YADAM_COVERAGE_OWNER_STAGES = Object.freeze({
  audio: Object.freeze({ role: "yadam.coverage.audio", stageId: "full_tts", serviceMethod: "runFullTts", successEvent: "AUDIO_PASSED" }),
  visual: Object.freeze({ role: "yadam.coverage.visual", stageId: "production_images", serviceMethod: "generateProductionImages", successEvent: "IMAGES_PASSED" }),
  subtitle: Object.freeze({ role: "yadam.coverage.subtitle", stageId: "segment_assembly", serviceMethod: "assembleAllSegments", successEvent: "SEGMENTS_PASSED" })
});

// Module-load validation of YADAM_STAGES constraints
const stageIds = new Set();
const serviceMethods = new Set();
const userGates = new Set();

for (const stage of YADAM_STAGES) {
  if (stageIds.has(stage.stageId)) {
    throw new Error(`Duplicate stageId: ${stage.stageId}`);
  }
  stageIds.add(stage.stageId);

  if (stage.serviceMethod !== null) {
    if (serviceMethods.has(stage.serviceMethod)) {
      throw new Error(`Duplicate serviceMethod: ${stage.serviceMethod}`);
    }
    serviceMethods.add(stage.serviceMethod);
  }

  if (stage.userGate !== null) {
    if (userGates.has(stage.userGate)) {
      throw new Error(`Duplicate userGate: ${stage.userGate}`);
    }
    userGates.add(stage.userGate);
  }
}

// Module-load validation of YADAM_COVERAGE_OWNER_STAGES keys and values matching YADAM_STAGES
const validCoverageKeys = ["audio", "visual", "subtitle"];
const coverageKeys = Object.keys(YADAM_COVERAGE_OWNER_STAGES);

if (coverageKeys.length !== 3 || !coverageKeys.every(k => validCoverageKeys.includes(k))) {
  throw new Error("YADAM_COVERAGE_OWNER_STAGES keys must be exactly audio, visual, subtitle");
}

for (const key of validCoverageKeys) {
  const covStage = YADAM_COVERAGE_OWNER_STAGES[key];
  const matchingStage = YADAM_STAGES.find(s => s.stageId === covStage.stageId);
  if (!matchingStage) {
    throw new Error(`Coverage stageId '${covStage.stageId}' not found in YADAM_STAGES`);
  }
  if (matchingStage.serviceMethod !== covStage.serviceMethod) {
    throw new Error(`Service method mismatch for coverage key '${key}': registry=${matchingStage.serviceMethod}, coverage=${covStage.serviceMethod}`);
  }
  if (matchingStage.successEvent !== covStage.successEvent) {
    throw new Error(`Success event mismatch for coverage key '${key}': registry=${matchingStage.successEvent}, coverage=${covStage.successEvent}`);
  }
}
Object.freeze(YADAM_COVERAGE_OWNER_STAGES);
