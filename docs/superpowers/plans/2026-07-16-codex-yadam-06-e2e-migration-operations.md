# Codex 야담 E2E·마이그레이션·운영 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앞선 다섯 subsystem을 하나의 재개 가능한 CLI 작업으로 연결하고, 기존 gguljam-bible 회귀를 보존하며, mock E2E와 10분 실제 acceptance를 거쳐 운영 가능한 야담 영상 제작 경로를 완성한다.

**Architecture:** Master orchestrator는 stage registry와 artifact dependency graph만 조정하고 각 subsystem의 public service를 호출한다. 사용자에게 멈추는 지점은 provisional selection과 두 formal approval뿐이며 provider failure, cancel, resume는 durable state로 처리한다. 기존 gguljam-bible 진입점은 새 yadam stage를 통과하지 않는 compatibility route로 유지한다.

**Tech Stack:** Node.js 22.16.0 ES modules, Node built-in test runner, Plan 01 pipeline core, Codex CLI, Supertonic, ComfyUI/SDXL/IP-Adapter, Ollama gemma4:12b, FFmpeg/ffprobe, Windows PowerShell.

## Global Constraints

- 작업공간은 `C:/Users/petbl/auto-video`이며 구현 전 Git 사용 여부가 명시적으로 결정되어야 한다.
- yadam 입력 시간은 10~120분, 10분 단위이고 최종 hard duration은 목표의 80~120%다.
- formal approval 종류는 concept와 production 두 개뿐이며 후보·카피 선택은 provisional selection이다.
- duration repair는 job 전체 한 번이며 finalTextHash가 바뀌면 approval-2 새 revision이 필요하다.
- TTS는 normalized PCM s16le 48 kHz mono, final playback tempo 1.0을 사용한다.
- ComfyUI와 Ollama GPU 작업은 동시에 실행하지 않는다.
- yadam release는 fallback/slate/circular image reuse, fast audio, monochrome output과 unresolved warning을 허용하지 않는다.
- gguljam-bible의 기존 profile·paths·default monochrome behavior는 별도 회귀 개선 전까지 유지한다.
- 실제 Codex·TTS·GPU·장편 FFmpeg 실행은 explicit live confirmation 없이는 테스트가 시작하지 않는다.
- 자동 cleanup은 job root 밖 파일을 삭제하지 않고 provider-owned 원본을 기본 보존한다.

---

## Consumed Interfaces

```js
// Plan 01
loadJob(jobDir)
transitionJob(jobDir, event)
registerArtifact(jobDir, record)
invalidateFromChanges(jobDir, changedArtifactIds)

// Plan 02: scripts/lib/yadam/script-service.mjs
generateConceptOptions({ jobDir, historyPath, now })
selectConcept({ jobDir, candidateId, userInstructions, selectedAt })
buildApprovalOneBundle({ jobDir })
approveConcept({ jobDir, expectedArtifactSetHash, approvedAt, userInstructions })
buildStoryBible({ jobDir })
buildScriptPlan({ jobDir })
draftNextSegment({ jobDir })
finalizeScriptPackage({ jobDir })
generateThumbnailPlan({ jobDir })
selectThumbnailCopy({ jobDir, copyId, selectedAt })
buildApprovalTwoBundle({ jobDir, previewArtifacts })
approveProduction({ jobDir, expectedArtifactSetHash, approvedAt, userInstructions })
getApprovedTtsInput(jobDir)
getApprovedVisualPlanningInput(jobDir)
requestDurationRepair({ jobDir, measuredDurationSeconds, acceptedRangeSeconds, signal })
rebuildApproval2AfterDurationRepair({ jobDir, changedSceneIds, signal })
recordCompletedStoryFingerprint({ jobDir, historyPath, completedAt })

// Plan 03: scripts/lib/yadam/tts-service.mjs
runFullTts({ jobDir, signal })
loadPassedAudioHandoff(jobDir)

// Plan 04: scripts/lib/yadam/image-service.mjs
buildApproval2Previews({ jobDir, signal })
refreshApproval2Previews({ jobDir, changedSceneIds, signal })
promoteApprovedReferenceSet({ jobDir, approvalRevisionPath })
generateProductionImages({ jobDir, signal })
loadPassedImageHandoff(jobDir)

// Plan 05: scripts/lib/yadam/video-service.mjs
assembleAllSegments({ jobDir, signal })
publishFinalVideo({ jobDir, signal })
loadFinalQa(jobDir)
```

## Locked File Map

| Path | Responsibility |
|---|---|
| `scripts/lib/pipeline/stage-registry.mjs` | stage IDs, prerequisites, next-state rules |
| `scripts/lib/pipeline/master-orchestrator.mjs` | run-until-blocked loop and service composition |
| `scripts/lib/pipeline/outcome-report.mjs` | every terminal non-success outcome의 canonical local evidence report |
| `scripts/lib/pipeline/preflight-suite.mjs` | Codex, Supertonic, ComfyUI, Ollama, FFmpeg aggregate report |
| `scripts/lib/pipeline/resource-lock.mjs` | Plan 04가 제공하는 workspace-wide GPU lease; 이 계획은 aggregate preflight에서 소비 |
| `scripts/lib/pipeline/resume-engine.mjs` | artifact verification and minimal restart point |
| `scripts/lib/pipeline/cancel-engine.mjs` | owned process and provider-specific cancellation hooks |
| `scripts/lib/pipeline/review-bundle.mjs` | Markdown/JSON/image review bundle renderer |
| `scripts/lib/pipeline/cleanup-policy.mjs` | temp/quarantine/provider provenance retention |
| `scripts/auto-video-pipeline.mjs` | complete command surface wiring |
| `scripts/run-yadam-live-acceptance.mjs` | explicit 10-minute live candidate runner |
| `scripts/run-yadam-scale-dry-run.mjs` | 20/60/120-minute no-provider planning check |
| `test/yadam/orchestrator.test.mjs` | state and service-order tests with fakes |
| `test/yadam/e2e-mock.test.mjs` | full two-approval mock E2E |
| `test/yadam/gguljam-regression.test.mjs` | legacy route and artifact snapshot |
| `test/yadam/cancel-resume.test.mjs` | interruption matrix |
| `docs/yadam-operator-runbook.md` | commands, gates and artifact locations |
| `docs/yadam-troubleshooting.md` | error code to action mapping |
| `docs/yadam-artifact-contract.md` | logical roles, paths, hashes and compatibility files |

## Public Interfaces Produced

```js
type RunOutcome =
  | { status: "awaiting_user", gate: "concept_selection"|"approval_1"|"thumbnail_copy_selection"|"approval_2", bundlePath: string }
  | { status: "completed", finalVideoPath: string, finalQaPath: string, historyEntryHash: string }
  | { status: "needs_review"|"failed"|"cancel_requested"|"cancelled", errorCode: string, reportPath: string };
runJobUntilBlocked({ jobDir, signal }): Promise<RunOutcome>
resumeJob({ jobDir, signal }): Promise<RunOutcome>
type OrphanedProviderJob = {
  provider: "supertonic"|"comfyui",
  idKind: "tts_job_id"|"prompt_id",
  id: string,
  stage: "full_tts"|"approval_2_previews"|"production_images",
  checkpoint: { path: string, sha256: string },
  terminalObservationStatus: "still_running"|"not_found_unproven"|"unreachable"|"unknown",
  observationReport: { path: string, sha256: string }
}
cancelJob({ jobDir }): Promise<{ status: "cancel_requested"|"cancelled", orphanedProviderJobs: OrphanedProviderJob[], reportPath: string }>
```

Every `awaiting_user.bundlePath` is a contained, slash-normalized, job-relative path to the verified immutable human Markdown review bundle `reviews/<canonical-slug>-rNNN.md`; it is never an absolute Windows path and never the raw Plan 02/03 JSON bundle path.
Every public `reportPath`, orphan checkpoint path and observation-report path follows the same contained job-relative `/` rule. Hash fields are lowercase 64-character SHA-256 strings, IDs are size-bounded provider-native opaque strings, arrays are bytewise sorted, and every public object rejects unknown fields.

### Task 1: Lock the stage registry and run-until-blocked state machine

**Files:**
- Create: `scripts/lib/pipeline/stage-registry.mjs`
- Create: `scripts/lib/pipeline/master-orchestrator.mjs`
- Create: `scripts/lib/pipeline/outcome-report.mjs`
- Use: `scripts/lib/pipeline/success-evidence.mjs` from Plan 01
- Create: `test/yadam/orchestrator.test.mjs`

**Interfaces:**
- Consumes: all service names listed above, an injected `renderReviewBundle` seam, and Plan 01 `buildSuccessEvidence`; no provider internals.
- Produces: `createMasterOrchestrator({services,renderReviewBundle})`, public `runJobUntilBlocked`, the Plan 06-internal shared `writeOutcomeReport`, closed `YADAM_STAGES`, and closed `YADAM_COVERAGE_OWNER_STAGES`. Task 1 tests inject a fake renderer so this task has no forward import of the Task 5 module; Task 5 wires the real renderer and adds integration coverage.

- [ ] **Step 1: Write the failing stage-order test**

Use fake services that append their names to an array. Assert a new yadam job stops after concept options with gate `concept_selection`; after selection it stops at approval 1; after approval 1 it drafts and stops at thumbnail copy selection; after the copy it builds previews and stops at approval 2; after approval 2 it runs TTS, production images, video and QA.

```js
assert.deepEqual(calls, ["generateConceptOptions"]);
assert.deepEqual(outcome, {
  status: "awaiting_user",
  gate: "concept_selection",
  bundlePath: "reviews/concept-selection-r001.md"
});

assert.deepEqual(afterConceptSelectionCalls, ["buildApprovalOneBundle"]);
assert.deepEqual(afterApprovalOneCalls, [
  "buildStoryBible",
  "buildScriptPlan",
  "draftNextSegment",
  "draftNextSegment",
  "finalizeScriptPackage",
  "generateThumbnailPlan"
]);
assert.deepEqual(afterThumbnailSelectionCalls, [
  "buildApproval2Previews",
  "buildApprovalTwoBundle"
]);
assert.deepEqual(afterApprovalTwoCalls, [
  "promoteApprovedReferenceSet",
  "runFullTts",
  "generateProductionImages",
  "assembleAllSegments",
  "publishFinalVideo",
  "loadFinalQa",
  "recordCompletedStoryFingerprint"
]);
```

The one-segment fake makes the first `draftNextSegment` return `status:"drafted",remainingSegments:0` and the second return `status:"complete"`; this proves the orchestrator does not guess completion from `remainingSegments` alone.

Keep renderer calls in a separate fake log. For each of the four gates, assert exactly one call with the canonical gate, a job-relative revisioned result, and no absolute/raw approval JSON path. The fake must also prove the orchestrator re-reads the returned Markdown and JSON index hash before returning the gate result.

Seed exact dynamic `yadam.coverage.audio`, `yadam.coverage.visual`, and `yadam.coverage.subtitle` current records and success paths. Independently remove/tamper each section while keeping the other artifacts and aggregate text plausible: `resolveForwardCursor` must select only `full_tts`/`runFullTts`, `production_images`/`generateProductionImages`, or `segment_assembly`/`assembleAllSegments` respectively, and the master must never call `updateCoverageSection` itself. For aggregate-only staleness with all current sections exact, select the latest already-reached coverage owner façade; its fake records one aggregate rebuild and exact event reuse with zero TTS/image/FFmpeg provider calls. The initial subtitle fixture is pending r001, and segment evidence may resolve passed r002 only after the owner façade returns.

- [ ] **Step 2: Run and verify missing registry failure**

Run: `node --test test/yadam/orchestrator.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `master-orchestrator.mjs`.

- [ ] **Step 3: Define the exact registry**

Create `scripts/lib/pipeline/stage-registry.mjs` with this ordered mapping. `stageId` is the master's internal dispatch key; `successEvent` is the exact Plan 01 state-history `stage` value the called subsystem must already have appended with its current full-input hash and artifact paths. `null` service methods are user gates whose matching CLI command invokes the exact Plan 02 selection/approval API; that API alone writes the selection, approval artifact and state event, while the CLI remains a validation/transport adapter. The master verifies success evidence and never writes a duplicate transition. `draftNextSegment` repeats until it returns `status:"complete"`.

Nonterminal traversal is forward-only from a verified cursor; it does not replay every earlier facade on every pass. Before dispatch, `resolveForwardCursor(jobDir)` performs a read-only scan of current files, registry records, dependency/opaque-pin maps, state rows and the exact producer evidence formulas already locked in Plans 02–05. A historical row or role name alone never advances the cursor. For an unsealed stage at or after the cursor, exactly one current success row plus byte/schema/gate/dependency/pin-valid outputs means advance without calling the facade; missing/invalid evidence identifies the earliest restart stage and only that facade and later stages may run. A current profile/model/workflow/compiler/font/provider pin change is therefore detected by the read-only evidence scan even when logical-role bytes are unchanged; no provider mutation is needed merely to discover drift.

Formal approval and authorized repair define cryptographic forward floors. A current valid approval 1 revision, pointer and exact unique grant row whose complete approved dependency/opaque-pin closure still passes seals stages through `approval_1`; earlier concept/bundle facades are not revisited. A current valid approval 2 equivalently seals stages through `approval_2`, including current artifacts replaced by an authorized duration repair, so the next cursor is `reference_promotion`. While state is `AWAITING_APPROVAL_2`, a current passed `yadam.approval.2.bundle` with exact `APPROVAL_TWO_BUNDLE_READY` evidence and either the normal producer closure or the one signed duration-repair authorization sets the cursor to the `approval_2` user gate. Active `REGENERATING_CHANGED_AUDIO` or `REBUILDING_APPROVAL_2_BUNDLE` state with the exact attempt-1 repair report resumes only `full_tts`, whose internal Plan 03/04/02 sequence owns changed audio, preview refresh and bundle rebuild. Verify that report through its immutable bytes/schema/authorization hash, exact reservation input hash, sealed historical source map, current repaired-artifact linkage and exactly the five opaque live registry dependencies fixed in Plan 02. Never add the invalidated approval, original audio, mutable coverage sections or aggregate as live registry dependencies: authorized audio/coverage replacement must not invalidate its own repair floor. These seals replace old per-segment/script/preview master evidence only for cursor selection; they do not forge or rewrite those historical events. If any approved/bundled file, policy pin, pointer, grant row or sealed repair authorization fails, invalidate the affected approval/bundle and move the cursor back to the earliest legitimately unsealed stage. This makes a repaired r002 job continue to promotion/TTS without redrafting repaired text or calling the normal preview builder, while a real pin drift cannot hide behind an approval label.

Tests cover an unchanged mid-pipeline resume with zero earlier facade/provider calls, an unapproved opaque-pin-only drift that selects the exact earliest producer, approval-1 and approval-2 forward floors, an invalidated approval reopening the correct earlier stage, interruption in each repair substate, and r002 approval after duration repair proceeding `reference_promotion → runFullTts` with zero concept/draft/finalize/normal-preview calls. The completed terminal branch below remains the separate completion-pinned rule: it ignores later host upgrades and never invalidates or rerenders; internally inconsistent completion evidence requires an incident/outcome and a new job.

```js
export const YADAM_STAGES = Object.freeze([
  { stageId: "concept_options", serviceMethod: "generateConceptOptions", requiresArtifactRoles: ["pipeline.request"], successEvent: "CONCEPT_OPTIONS_READY", userGate: null, invalidatedByRoles: ["pipeline.request", "yadam.concept.inputs"] },
  { stageId: "concept_selection", serviceMethod: null, requiresArtifactRoles: ["yadam.concept.options"], successEvent: "CONCEPT_SELECTED", userGate: "concept_selection", invalidatedByRoles: ["yadam.concept.options"] },
  { stageId: "approval_1_bundle", serviceMethod: "buildApprovalOneBundle", requiresArtifactRoles: ["yadam.concept.options", "yadam.concept.selection"], successEvent: "APPROVAL_ONE_BUNDLE_READY", userGate: null, invalidatedByRoles: ["yadam.concept.options", "yadam.concept.selection"] },
  { stageId: "approval_1", serviceMethod: null, requiresArtifactRoles: ["yadam.approval.1.bundle", "yadam.concept.selection", "yadam.hook.brief", "yadam.outline"], successEvent: "APPROVAL_ONE_GRANTED", userGate: "approval_1", invalidatedByRoles: ["yadam.approval.1.bundle", "yadam.concept.selection", "yadam.hook.brief", "yadam.outline"] },
  { stageId: "story_bible", serviceMethod: "buildStoryBible", requiresArtifactRoles: ["yadam.approval.1"], successEvent: "STORY_BIBLE_READY", userGate: null, invalidatedByRoles: ["yadam.approval.1"] },
  { stageId: "script_plan", serviceMethod: "buildScriptPlan", requiresArtifactRoles: ["yadam.story.bible", "yadam.outline"], successEvent: "SCRIPT_PLAN_READY", userGate: null, invalidatedByRoles: ["yadam.story.bible", "yadam.outline"] },
  { stageId: "segment_drafts", serviceMethod: "draftNextSegment", requiresArtifactRoles: ["yadam.script.plan", "yadam.story.bible"], successEvent: "SEGMENT_DRAFTED", userGate: null, invalidatedByRoles: ["yadam.script.plan", "yadam.story.bible"] },
  { stageId: "final_script_qa", serviceMethod: "finalizeScriptPackage", requiresArtifactRoles: ["yadam.script.plan", "yadam.script.segment"], successEvent: "SCRIPT_PACKAGE_READY", userGate: null, invalidatedByRoles: ["yadam.script.plan", "yadam.script.segment"] },
  { stageId: "thumbnail_plan", serviceMethod: "generateThumbnailPlan", requiresArtifactRoles: ["yadam.script.scenes", "yadam.story.bible", "yadam.scene.plan"], successEvent: "THUMBNAIL_OPTIONS_READY", userGate: null, invalidatedByRoles: ["yadam.script.scenes", "yadam.story.bible", "yadam.scene.plan"] },
  { stageId: "thumbnail_copy_selection", serviceMethod: null, requiresArtifactRoles: ["yadam.thumbnail.plan"], successEvent: "THUMBNAIL_COPY_SELECTED", userGate: "thumbnail_copy_selection", invalidatedByRoles: ["yadam.thumbnail.plan"] },
  { stageId: "approval_2_previews", serviceMethod: "buildApproval2Previews", requiresArtifactRoles: ["yadam.scene.plan", "yadam.thumbnail.plan", "yadam.thumbnail.selection", "yadam.story.bible"], successEvent: "APPROVAL_TWO_PREVIEWS_READY", userGate: null, invalidatedByRoles: ["yadam.scene.plan", "yadam.thumbnail.plan", "yadam.thumbnail.selection", "yadam.story.bible"] },
  { stageId: "approval_2_bundle", serviceMethod: "buildApprovalTwoBundle", requiresArtifactRoles: ["yadam.script.final_text", "yadam.script.scenes", "yadam.script.qa", "yadam.coverage.script", "yadam.thumbnail.selection", "yadam.thumbnail.guide", "yadam.preview.manifest"], successEvent: "APPROVAL_TWO_BUNDLE_READY", userGate: null, invalidatedByRoles: ["yadam.script.final_text", "yadam.script.scenes", "yadam.script.qa", "yadam.coverage.script", "yadam.thumbnail.selection", "yadam.thumbnail.guide", "yadam.preview.manifest"] },
  { stageId: "approval_2", serviceMethod: null, requiresArtifactRoles: ["yadam.approval.2.bundle", "yadam.script.final_text", "yadam.script.scenes", "yadam.scene.plan"], successEvent: "APPROVAL_TWO_GRANTED", userGate: "approval_2", invalidatedByRoles: ["yadam.approval.2.bundle", "yadam.script.final_text", "yadam.script.scenes", "yadam.scene.plan"] },
  { stageId: "reference_promotion", serviceMethod: "promoteApprovedReferenceSet", requiresArtifactRoles: ["yadam.approval.2"], successEvent: "REFERENCE_SET_PROMOTED", userGate: null, invalidatedByRoles: ["yadam.approval.2"] },
  { stageId: "full_tts", serviceMethod: "runFullTts", requiresArtifactRoles: ["yadam.approval.2", "yadam.script.scenes", "yadam.scene.plan"], successEvent: "AUDIO_PASSED", userGate: null, invalidatedByRoles: ["yadam.approval.2", "yadam.script.scenes", "yadam.scene.plan"] },
  { stageId: "production_images", serviceMethod: "generateProductionImages", requiresArtifactRoles: ["yadam.audio.manifest", "yadam.audio.timeline", "yadam.render_plan_input", "yadam.approval.2", "yadam.character.reference-set", "yadam.character.reference-pointer"], successEvent: "IMAGES_PASSED", userGate: null, invalidatedByRoles: ["yadam.audio.manifest", "yadam.audio.timeline", "yadam.render_plan_input", "yadam.approval.2", "yadam.character.reference-set", "yadam.character.reference-pointer"] },
  { stageId: "segment_assembly", serviceMethod: "assembleAllSegments", requiresArtifactRoles: ["yadam.approval.2", "yadam.script.final_text", "yadam.script.scenes", "yadam.audio.manifest", "yadam.audio.timeline", "yadam.render_plan_input", "yadam.render.plan", "yadam.image.asset-manifest", "yadam.image.visual-qa", "yadam.thumbnail.final", "yadam.thumbnail.qa", "yadam.coverage.audio", "yadam.coverage.visual"], successEvent: "SEGMENTS_PASSED", userGate: null, invalidatedByRoles: ["yadam.approval.2", "yadam.script.final_text", "yadam.script.scenes", "yadam.audio.manifest", "yadam.audio.timeline", "yadam.render_plan_input", "yadam.render.plan", "yadam.image.asset-manifest", "yadam.image.visual-qa", "yadam.thumbnail.final", "yadam.thumbnail.qa", "yadam.coverage.audio", "yadam.coverage.visual"] },
  { stageId: "final_publish", serviceMethod: "publishFinalVideo", requiresArtifactRoles: ["yadam.segment.manifest"], successEvent: "FINAL_QA_PASSED", userGate: null, invalidatedByRoles: ["yadam.segment.manifest"] }
]);

export const YADAM_COVERAGE_OWNER_STAGES = Object.freeze({
  audio: Object.freeze({ role: "yadam.coverage.audio", stageId: "full_tts", serviceMethod: "runFullTts", successEvent: "AUDIO_PASSED" }),
  visual: Object.freeze({ role: "yadam.coverage.visual", stageId: "production_images", serviceMethod: "generateProductionImages", successEvent: "IMAGES_PASSED" }),
  subtitle: Object.freeze({ role: "yadam.coverage.subtitle", stageId: "segment_assembly", serviceMethod: "assembleAllSegments", successEvent: "SEGMENTS_PASSED" }),
});
```

`publishFinalVideo` is the single final media mutation stage: Plan 05 permits it to return only after publishing and reloading passed roles `yadam.video.final`, `yadam.subtitle.upload`, `yadam.thumbnail.release`, and `yadam.qa.final`, then transitioning the job to `completed`. Plan 04 keeps the production source thumbnail under the distinct role `yadam.thumbnail.final`; the release copy never creates a second current owner for that role. `loadFinalQa(jobDir)` remains a read-only post-return/status/resume verifier and is never scheduled as a second state-changing stage. After that verification, the orchestrator calls the idempotent `recordCompletedStoryFingerprint` once; only a successful history append returns the public `completed` outcome.

Validate at module load that stage IDs, non-null service methods and user gates are unique; freeze each entry and its arrays, not only the outer array. Also require `YADAM_COVERAGE_OWNER_STAGES` has exactly keys `audio|visual|subtitle`, three unique roles/stage IDs/service methods/events, and byte-for-byte equality with the corresponding `YADAM_STAGES` rows. Reject an unknown stage, service method, artifact role, coverage section or event instead of skipping it. `requiresArtifactRoles` and `invalidatedByRoles` are logical-role declarations, never arguments to Plan 01's artifact-ID API. Before advancing past or invoking an unsealed stage, resolve every required role through the current manifest to sorted current `artifactId` values and require file/hash/schema/gate verification plus the producer's current opaque-pin projection. Resolve `invalidatedByRoles` for proactive dependency invalidation and diagnostics, then pass changed artifact IDs to `invalidateFromChanges(jobDir, artifactIds)`; role equality alone never proves reuse because opaque pins are not job roles. Approval-floor verification checks the complete approved dependency/pin closure and exact grant evidence as the aggregate authority, but approval 2 binds immutable current `yadam.coverage.script` and explicitly excludes mutable `yadam.coverage.report`; downstream audio/visual/subtitle section or aggregate revisions therefore cannot stale a valid approval. Thus a new concept job can create `yadam.concept.inputs` inside `generateConceptOptions`, while a prior `CONCEPT_OPTIONS_READY` event without that role is inconsistent and cannot be reused. Every listed role is singleton except collection role `yadam.script.segment`; singleton resolution requires exactly one current record, while the collection requires one record per script-plan segment with no missing/duplicate segment ID. Stable approval/current-reference records replace path/hash under one artifact ID and retain old revisions in `revisionHistory`, so an old revision is not a second current role owner. The expanded `segment_assembly` closure is intentional: Plan 05 directly hash-locks approval, final/script scenes, audio manifest/timeline/render-plan-input plus current audio coverage, render plan, production image/visual QA plus current visual coverage, and source thumbnail/QA before creating `yadam.render.manifest`; its own current subtitle coverage is a success output. The derived aggregate is validated separately and never substituted for any section record. A changed PNG, QA, thumbnail or upstream section therefore cannot reuse an old `SEGMENTS_PASSED` merely because timing stayed equal.

- [ ] **Step 4: Implement runJobUntilBlocked**

Load and verify job context before cursor resolution and again before every dispatched stage; call one service at a time. Each subsystem remains the sole owner of its artifacts, coverage section, full current-input fingerprint and state transitions. The read-only cursor verifier may advance across an unsealed stage only after recomputing the producer-defined current input/output evidence and exact row cardinality. When it finds the earliest unsatisfied stage, call that façade; on declared success the façade must already have re-read the exact success row, then the master independently repeats the same verification before advancing. For coverage, resolve the dynamic current section path only after its owner façade has returned: a missing/non-pass/stale audio, visual or subtitle section routes to exactly the owner map's `runFullTts`, `generateProductionImages` or `assembleAllSegments`, never to Plan 02 `updateCoverageSection` from the master. The mutable aggregate is not event evidence. Verify it separately as a deterministic binding of the four current sections. If only that aggregate is stale, dispatch the latest already-reached coverage owner so it can rebuild the aggregate without provider work and reuse its exact prior success; section-invalid cases always dispatch that section's owner even if a later stage exists. Normal artifacts, including `yadam.approval.1.bundle` and `yadam.approval.2.bundle`, must rehash through their exact current registry record. The sole path-only exceptions are `approvals/current-approval-1.json` and `approvals/current-approval-2.json`: each pointer is contained/re-read, and its revision/path/hash/artifact-set fields must equal the matching current registered `yadam.approval.1` or `yadam.approval.2` revision plus the exact unique grant event. No pointer role is invented. A declared `awaiting_user`, `needs_review`, failure or cancellation branch is handled by its closed union/error contract and must not have a success row. The master never writes producer artifacts/events/coverage, calls `updateCoverageSection`, or infers opaque pins from role names.

At every user gate, call the injected `renderReviewBundle({jobDir,gate})` and accept only its closed `{bundlePath,bundleHash,indexPath}` result. Resolve both returned paths below the verified job root, require the exact gate-specific revisioned filenames from Task 5, re-read both files and their current stable artifact records, require the Markdown SHA-256 equals `bundleHash`, and require the canonical index binds that same hash and current source-set hash. Only then return `{status:"awaiting_user",gate,bundlePath}`. The renderer, not the master, owns review artifact writes/registration. The master never returns a provisional path assembled with `join(jobDir,...)`.

Before normal stage traversal, branch on a terminal `state.status === "completed"`. A completed job never re-enters concept, script, TTS, image, segment or nonterminal final stages and is not evaluated against newly installed current toolchain pins. Call only the Plan 05 completed verifier path in `publishFinalVideo`, then read-only `loadFinalQa`, and retry `recordCompletedStoryFingerprint` only when terminal media remains valid and its history row is missing. The final producer verifies the completion-pinned opaque inputs stored in the terminal artifacts/event. If it reports `completed_artifact_tampered`, return exactly `{status:"failed",errorCode:"completed_artifact_tampered",reportPath}` using the verified real incident path; do not quarantine, invalidate, replace, transition, or invoke any provider. This is not a user approval/needs-review gate. Recovery is a trusted byte-identical backup or a new job. Tests assert this exact discriminant and unchanged completed state/history/canonical outputs.

`segment_drafts` is the deliberate repeating exception. Every `draftNextSegment` result with `status:"drafted"` must identify the one current segment ID/path/hash and the facade must already have re-read that segment's exact Plan 02 `SEGMENT_DRAFTED` row. The master verifies that row, then calls again. The terminal `{status:"complete",remainingSegments:0}` creates no new artifact or event; instead the master reloads `yadam.script.plan`, requires the `yadam.script.segment` collection has exactly one current passed member for every planned segment and no extras, and verifies each member has its own current exact `SEGMENT_DRAFTED` evidence. Only then may it advance to `final_script_qa`. The one-segment test therefore expects one drafted call plus one complete call, one event total, and rejects a premature complete, missing/duplicate segment, stale segment hash or missing per-segment event. Use an exact per-method argument adapter because Plan 02 rejects unknown keys:

- `generateConceptOptions` receives `{jobDir,historyPath,now}`.
- `buildApprovalOneBundle`, `buildStoryBible`, `buildScriptPlan`, `draftNextSegment`, `finalizeScriptPackage`, and `generateThumbnailPlan` each receive exactly `{jobDir}`; never add `signal`.
- `buildApproval2Previews` receives `{jobDir,signal}`.
- `buildApprovalTwoBundle` receives `{jobDir,previewArtifacts}` projected from the current passed `yadam.preview.manifest`; never add `signal`.
- `promoteApprovedReferenceSet` receives `{jobDir,approvalRevisionPath}` loaded from `getApprovedVisualPlanningInput(jobDir)`; never add `signal`.
- `runFullTts`, `generateProductionImages`, `assembleAllSegments`, and `publishFinalVideo` each receive `{jobDir,signal}`.
- `loadFinalQa` receives the bare `jobDir` string, and `recordCompletedStoryFingerprint` receives `{jobDir,historyPath,completedAt}`.

Lock the three coverage-owner success verifiers explicitly; there is no legacy fixed output count:

| Stage/event | Exact current success output evidence |
|---|---|
| `full_tts` / `AUDIO_PASSED` | Plan 03 shared-helper output records `yadam.audio.manifest`, `yadam.audio.timeline`, `yadam.render_plan_input`, and the current passed `yadam.coverage.audio` at its dynamic `script/coverage/audio-rNNN.json` path |
| `production_images` / `IMAGES_PASSED` | Plan 04 stage-specific output projection `{renderPlanHash,imageAssetManifestHash,visualQaReportHash,thumbnailHash,thumbnailQaHash,visualCoverageHash}` and sorted paths for those five fixed artifacts plus the current passed dynamic `yadam.coverage.visual` path |
| `segment_assembly` / `SEGMENTS_PASSED` | Plan 05 shared-helper output records `yadam.render.manifest`, `yadam.segment.manifest`, current passed dynamic `yadam.coverage.subtitle`, and `yadam.video.segment.{segmentId}` plus `yadam.qa.segment.{segmentId}` for every canonical segment |

For the audio event, require Plan 03's exact three input roles and three opaque pins. For the image event, recompute Plan 04's exact field-based input/output formulas and six sorted paths; do not feed it to the record helper. For the segment event, require Plan 05's exact 13 upstream input roles, dynamic output set and four opaque pins. Never include `yadam.coverage.report` in any of these success hashes or paths; re-read it only to prove exact current section bindings. A pending section path observed before an owner call is not prospective evidence: reload the current registry after the façade returns, so initial pending subtitle r001 can become passed r002 without a false path conflict. Remove fixtures/assertions that expect the former audio-without-section, image-without-section or segment-without-subtitle-section output counts.

For `AUDIO_PASSED`, `SEGMENTS_PASSED`, and `FINAL_QA_PASSED`, import Plan 01 `buildSuccessEvidence`; do not reimplement it. For nonterminal verification and any new success event, resolve and strictly verify the exact current input/output role sets declared in Plans 03 and 05 and construct their exact current `opaqueInputs` pin maps. The terminal `completed` fast path is the sole exception: it must use the completion-time `opaqueInputs` map persisted by Plan 05, as specified above, so later host-toolchain drift cannot invalidate or rerender an already completed job. Then recompute:

```js
const expected = buildSuccessEvidence(successEvent, inputRecords, outputRecords, opaqueInputs);
const expectedTo = successEvent === "FINAL_QA_PASSED" ? "completed" : "running";
assert.deepEqual({
  stage: historyRow.stage,
  to: historyRow.to,
  inputHash: historyRow.inputHash,
  outputHash: historyRow.outputHash,
  artifactPaths: historyRow.artifactPaths,
}, {
  stage: successEvent,
  to: expectedTo,
  ...expected,
});
```

The helper owns path normalization, bytewise ordering and canonical projection. Plan 06 supplies current records and current pins and rejects missing/extra roles or pin keys before calling it. The shared events require exact `to`: `AUDIO_PASSED` and `SEGMENTS_PASSED` use `running`; `FINAL_QA_PASSED` alone uses `completed`. For Plan 02 events the master uses the closed map `{CONCEPT_OPTIONS_READY:"awaiting_approval",CONCEPT_SELECTED:"running",APPROVAL_ONE_BUNDLE_READY:"awaiting_approval",APPROVAL_ONE_GRANTED:"running",STORY_BIBLE_READY:"running",SCRIPT_PLAN_READY:"running",SEGMENT_DRAFTED:"running",SCRIPT_PACKAGE_READY:"running",THUMBNAIL_OPTIONS_READY:"awaiting_approval",THUMBNAIL_COPY_SELECTED:"running",APPROVAL_TWO_BUNDLE_READY:"awaiting_approval",APPROVAL_TWO_GRANTED:"running"}` and a contract test deep-compares it to Plan 02's producer fixture table. Plans 02 and 04 use their locked stage-specific projections because their success inputs include command fields or domain aggregates not representable as artifact records alone; the master recomputes each producer's exact `stage`, `to`, input/output formula and path set after the façade returns. A row with correct hashes/paths but wrong stage or wrong `to` never advances a nonterminal cursor. Tests shuffle manifest record order and process locale, change only one opaque pin, change only one output hash or section revision, and prove producer and consumer obtain byte-identical evidence while the master appends no event. Add a wrong-`to` fixture for every success event class. Independently tamper each section and the aggregate: section tamper selects only its owner; aggregate-only staleness yields provider-free repair and exact existing-row reuse.

These are explicit argument adapters, not provider parsing. After `publishFinalVideo`, call `loadFinalQa(jobDir)`, require `qualityOk:true` and `finalVerdict:"pass"`, then call `recordCompletedStoryFingerprint({jobDir,historyPath,completedAt})`. Cross-check the publication and loader paths/hashes, require the history result is the current job's verified row, and return exactly `{status:"completed",finalVideoPath:publish.finalPath,finalQaPath:qa.qaPath,historyEntryHash:history.entryHash}`; both paths are contained job-relative `/` paths and unknown result keys are not forwarded. The terminal fast path constructs the same projection from the same three verified sources. Exact-shape tests reject a mismatched `publish.qaPath`/`qa.qaPath`, wrong job history row, absolute path, missing hash or extra inferred field. A history failure returns `needs_review` with `errorCode:"history_record_failed"` while preserving the already-passed final artifacts; `resume` detects completed media plus a missing jobId history row, retries only the idempotent append, and then returns completed. Return immediately on a user gate, `needs_review`, `failed`, `cancel_requested` or `cancelled`. Catch structured errors and preserve a real subsystem `reportPath` when supplied rather than converting them to success.

Every public `needs_review|failed|cancel_requested|cancelled` `RunOutcome` must still have a readable `reportPath`. The Plan 06-internal shared API is `writeOutcomeReport({jobDir,status,errorCode,stage,inputHash,occurredAt,error,upstreamReportPath}): Promise<{reportPath:string,reportHash:string,reportIdentityHash:string}>`; it is used only by the master and cancel/resume engines and is not added to the master roadmap's subsystem façade list. All three returned hashes/paths are closed lowercase/job-relative values and no unknown keys are returned. It validates a closed, size-bounded `safeErrorProjection` and requires `errorCode`/`stage` to match closed lowercase identifier patterns before using them in a filename. When a subsystem supplied a report, resolve/contain/re-read it and bind `{path,sha256}`; otherwise bind `upstreamReport:null`. Compute `reportIdentityHash = hashCanonical({stageInputHash:inputHash,status,errorCode,safeErrorProjection,upstreamReport})`; `occurredAt` is evidence stored in the first report but is deliberately excluded from identity so an identical retry cannot create a new address. Resolve and contain `reviews/outcomes` below the verified job root, create that stage-owned subdirectory with `mkdir({recursive:true})`, re-resolve containment, then write canonical JSON at `reviews/outcomes/<status>-<errorCode>-<first12ReportIdentityHash>.json` with Plan 01 atomic/exclusive helpers. If that identity path already exists, ignore the retry's new `occurredAt`, re-read the stored original timestamp and require the stored schema/identity/status/error/safe projection/upstream binding to match before returning its existing byte hash; never construct a different candidate and call it byte-identical. Store the full `reportIdentityHash` and re-read/recompute it before reuse.

Every successfully published outcome is also a job artifact. After byte verification, register or reuse exactly one record `{artifactId:"yadam-outcome-<fullReportIdentityHash>",logicalRole:"yadam.outcome.report",path:reportPath,sha256:reportHash,schemaVersion:"1.0.0",producerStage:"outcome_report",gateStatus:"fail",dependencyHashes}` where `dependencyHashes` is exactly `{stageInput:inputHash}` plus `upstreamReport:upstreamReport.sha256` only when present. `yadam.outcome.report` is an intentional collection role; identity-specific artifact IDs never move revisions. A crash after the exclusive file write may register the verified existing file, but an existing same identity record with another path/hash/dependency map, duplicate artifact ID, unregistered tampered file, or more than one record for that identity is `outcome_report_conflict`. Re-read the file and exact record together before returning. This avoids colliding different safe errors or upstream report revisions that share one stage input hash. `upstreamReportPath` is accepted only when that verified binding exists; never invent a Plan 05 QA path for a pre-report contract/tamper error. If a returned terminal result or caught error lacks a readable report, the master writes this orchestrator-owned report and returns its path. `history_record_failed` uses this same writer. Tests start from a pristine Plan 01 job containing only the parent `reviews` directory, cover directory creation plus symlink/junction rejection, Plan 05 pre-report failure, a supplied QA report, history append failure, scope-expanded and both cancel statuses, same stage/input with different safe error or upstream hash producing different addresses, crash between file/register, duplicate/conflicting record, tampered existing outcome report and repeat-resume idempotency. Diagnostic fields exclude raw environment/auth data and cap code/message/detail lengths.

Handle the `runFullTts` union explicitly and reject unknown/extra result keys. `status:"audio_passed"` advances only after re-reading the current passed `yadam.coverage.audio`, requiring the aggregate's audio binding to match it, and verifying the exact `AUDIO_PASSED` output role/path set; any row omitting the section output is inconsistent. For `status:"awaiting_reapproval"`, require `bundlePath === "approvals/approval-2-bundle.json"`, a positive integer `revision`, and lowercase `approvedArtifactSetHash`. Re-read/hash the singleton passed `yadam.approval.2.bundle` record and exact `APPROVAL_TWO_BUNDLE_READY` evidence; schema-parse it and require `result.approvedArtifactSetHash === bundle.approvedArtifactSetHash === recomputed current artifact-set hash`, while `result.revision === bundle.candidateApprovalRevision === lastFormalApprovalRevision + 1` and the matching immutable `rNNN` target is absent. Require state is exactly `AWAITING_APPROVAL_2`; the signed registered bundle is the sole pending-revision source and no undeclared state field is read. A correct path with wrong hash/revision fails before review rendering. Do not forward that JSON path. Call `renderReviewBundle({jobDir,gate:"approval_2"})`, perform the same Markdown/index/registry verification as the normal approval-2 gate, and return that canonical human review path without requiring `AUDIO_PASSED` or starting images. A typed `duration_refresh_scope_expanded` error has no subsystem report path: independently recompute Plan 04's exact `refreshInputHash`, require it equals the error's input hash/stage, call `writeOutcomeReport` once, re-read the returned file/record, and return `needs_review`; never call the normal preview builder. Add correct-path/wrong-set, wrong-revision, already-used candidate and extra-key fixtures. After the user approves the displayed artifact-set hash, the forward cursor begins at `reference_promotion`, then `runFullTts` verifies/reuses the repaired passed audio and returns `audio_passed`. `status:"needs_review"` stops with its report. No generic truthy-result branch may treat these outcomes alike.

- [ ] **Step 5: Run focused state tests**

Run: `node --test test/yadam/orchestrator.test.mjs`

Expected: every test reaches exactly the next gate and no post-gate service is called.

Also change only the yadam profile hash/model-lock fixture while keeping every unapproved job artifact byte-identical. Expected: the read-only scan selects the exact affected earliest façade, its old input hash is rejected, and provider work follows its bounded policy. With no changes, resume skips already verified earlier façades and provider/event counts remain zero. Repeat with a current formal approval: if the changed pin is in its approved dependency closure, that approval is invalidated before any downstream provider; an unchanged approved closure retains its forward floor.

- [ ] **Step 6: Commit the stage machine**

```bash
git add scripts/lib/pipeline/stage-registry.mjs scripts/lib/pipeline/master-orchestrator.mjs scripts/lib/pipeline/outcome-report.mjs test/yadam/orchestrator.test.mjs
git commit -m "feat: orchestrate yadam stages to user gates"
```

### Task 2: Wire all provisional selection and approval CLI commands

**Files:**
- Modify: `scripts/auto-video-pipeline.mjs`
- Modify: `scripts/lib/pipeline/cli-args.mjs`
- Create: `test/yadam/approval-cli.test.mjs`

**Interfaces:**
- Consumes: Plan 02 selection/approval functions and `runJobUntilBlocked`.
- Produces: complete initial command surface.

- [ ] **Step 1: Add failing command tests**

Cover these exact commands:

```text
select-concept --job <dir> --option concept-02 --note "방향 유지"
approve-concept --job <dir> --artifact-set-hash <64hex> --note "승인"
select-thumbnail-copy --job <dir> --copy copy-03
approve-production --job <dir> --artifact-set-hash <64hex> --note "승인"
run --job <dir>
resume --job <dir>
```

Reject stale hash, unknown option/copy, approving before bundle completion and a second concurrent approval writer. Inject a fixed clock and deep-equal the exact Plan 02 call objects, proving there is no stray `signal` or CLI-only key.

- [ ] **Step 2: Run and confirm commands are unavailable**

Run: `node --test test/yadam/approval-cli.test.mjs`

Expected: FAIL with `unknown_command` for `select-concept`.

- [ ] **Step 3: Wire provisional selections**

Capture one UTC ISO-8601 millisecond value from an injected clock per command. `select-concept` calls `selectConcept({jobDir,candidateId:option,userInstructions:nfcNote,selectedAt})`; omitted `--note` becomes the explicit empty string. `select-thumbnail-copy` calls `selectThumbnailCopy({jobDir,copyId:copy,selectedAt})` and receives no note key. Selection commands return `formalApproval:false`, then call `runJobUntilBlocked` to build the corresponding bundle. They must not create an approval record, and the Plan 02 API—not the CLI—owns the selection file/event.

- [ ] **Step 4: Wire formal approvals with compare-and-swap hashes**

Approval commands map `--note` to NFC `userInstructions` (omission is `""`), capture one injected-clock `approvedAt`, and pass exact objects `{jobDir,expectedArtifactSetHash,approvedAt,userInstructions}` to `approveConcept` or `approveProduction`. A mismatch returns `approval_bundle_stale`, prints the current bundle path/hash, and does not advance state. After `approveProduction` returns its immutable `approvalRevisionPath`, do not call the image service directly from the CLI. Call `runJobUntilBlocked`; its `reference_promotion` stage passes that exact current path to `promoteApprovedReferenceSet`, persists the promotion, and only then advances to full TTS. If promotion fails, keep the valid approval revision, do not start TTS, and let `resume` retry only the idempotent promotion stage. This single ownership prevents a double promotion call.

- [ ] **Step 5: Run approval CLI tests**

Run: `node --test test/yadam/approval-cli.test.mjs`

Expected: provisional commands never increment approval revision; approval revision files are append-only.

- [ ] **Step 6: Commit command wiring**

```bash
git add scripts/auto-video-pipeline.mjs scripts/lib/pipeline/cli-args.mjs test/yadam/approval-cli.test.mjs
git commit -m "feat: expose two-stage yadam approvals"
```

### Task 3: Aggregate exact provider preflight and GPU locks

**Files:**
- Create: `scripts/lib/pipeline/preflight-suite.mjs`
- Verify: `scripts/lib/pipeline/resource-lock.mjs`
- Create: `test/yadam/preflight-suite.test.mjs`

**Interfaces:**
- Consumes: provider preflight methods from Plans 01, 03, 04 and 05.
- Consumes: Plan 04 `acquireResourceLock({lockPath,resource:"gpu",ownerJobId,ownerStage,signal,staleAfterMs})`, `releaseResourceLock(lease)`, `withResourceLock(options,fn)`.
- Produces: `runPreflightSuite({jobDir,live,signal})` and aggregate lock diagnostics.

- [ ] **Step 1: Write failing aggregate-report tests**

Assert report order Codex→Supertonic→ComfyUI models/nodes→Ollama vision→FFmpeg. A missing IP-Adapter model must produce `ready:false`, `blocking:true`, exact expected path/hash, and prevent live generation. Assert GPU lock rejects concurrent `comfyui` and `ollama-vision` owners.

- [ ] **Step 2: Run and verify missing suite**

Run: `node --test test/yadam/preflight-suite.test.mjs`

Expected: FAIL with missing export.

- [ ] **Step 3: Implement fail-fast and report-only modes**

`live:false` collects all diagnostics without model calls. `live:true` stops before the first paid/high-cost operation when any blocking check fails. Write `logs/preflight-report.json` with provider version, URL/path, lock hash and remediation command; redact unrelated environment values.

- [ ] **Step 4: Integrate the file-backed resource lease**

Use the Plan 04 workspace-level lock path `C:/Users/petbl/auto-video/exports/.locks/gpu.lock`; never place the only GPU lock under an individual job. Its canonical record contains resource, ownerJobId, ownerStage, pid, leaseId, acquiredAt and heartbeatAt. Reclaim only through the Plan 04 liveness/staleness policy; a live PID is never displaced merely because another job is waiting. ComfyUI generation and Ollama vision both request the same `resource:"gpu"` lease, so different jobs are serialized as well as stages within one job.

- [ ] **Step 5: Run preflight and lock tests**

Run: `node --test test/yadam/preflight-suite.test.mjs`

Expected: missing prerequisite blocks; stale lock reclamation is deterministic; live=false makes no POST request.

- [ ] **Step 6: Commit preflight orchestration**

```bash
git add scripts/lib/pipeline/preflight-suite.mjs test/yadam/preflight-suite.test.mjs
git commit -m "feat: aggregate local provider preflight"
```

### Task 4: Implement cross-provider cancel and minimal resume

**Files:**
- Create: `scripts/lib/pipeline/resume-engine.mjs`
- Create: `scripts/lib/pipeline/cancel-engine.mjs`
- Modify: `scripts/lib/pipeline/outcome-report.mjs`
- Create: `test/yadam/cancel-resume.test.mjs`

**Interfaces:**
- Consumes: artifact reuse, provider job IDs, Comfy targeted cancel, Supertonic orphan policy.
- Produces: `resumeJob`, `cancelJob` with the exact public union and `OrphanedProviderJob` projection above.

- [ ] **Step 1: Write the interruption matrix**

Test cancel during Codex, Supertonic queued/running, Comfy queued/running, FFmpeg and idle approval. Assert no new submission after cancel_requested, valid completed artifacts remain pass, temp outputs enter quarantine, Supertonic async IDs become orphaned, and Comfy uses only targeted queue delete/interrupt.

- [ ] **Step 2: Run and verify missing engines**

Run: `node --test test/yadam/cancel-resume.test.mjs`

Expected: FAIL for missing `cancelJob`.

- [ ] **Step 3: Implement cancelJob**

Set `cancel_requested` state first. Signal owned child controllers; after 5 seconds terminate only owned process trees. Invoke registered provider cancellation hooks with job/prompt IDs. Never call Comfy global interrupt or `/free` as cancel. Build `orphanedProviderJobs` only from owned IDs that lack a provider-terminal observation. Each row has exactly the public fields above; both evidence paths are contained job-relative `/` paths with verified lowercase hashes, and raw URLs, auth data, command lines or absolute paths are forbidden. Sort rows bytewise by `{provider,idKind,id,stage}` and require the persisted cancellation report contains the byte-identical projection.

Return `status:"cancelled"` only when all owned local controllers/process trees are proven stopped, every owned provider ID is proven cancelled or already terminal, the orphan array is empty, and the state transition to terminal cancelled re-reads successfully. Otherwise retain `cancel_requested` and return that status with one row per unresolved provider/local cancellation represented in the report; a local-only unresolved stop uses no fabricated provider row and is instead a closed report check. Write/re-read the matching immutable report through `writeOutcomeReport` with `errorCode:"user_cancelled"` for terminal cancelled or `errorCode:"cancel_pending"` for nonterminal cancel_requested, then return its exact `reportPath`. Because report identity includes status, a later `runJobUntilBlocked`/`resumeJob` that proves termination writes/reuses a distinct terminal cancelled report and never aliases the earlier cancel-requested report. Tests assert deterministic row ordering, exact report parity, both status rules, and no submission after either status.

- [ ] **Step 4: Implement resumeJob**

Load state before general invalidation. If it is `completed`, use the terminal-only branch above: do not find an earliest invalid stage, quarantine a canonical release file, invalidate an artifact, compare against newly installed toolchain pins or re-enter generation. Valid terminal media may retry only the idempotent history append; missing/hash-mismatched terminal media returns `completed_artifact_tampered` evidence and permits only trusted byte-identical backup restoration or a new job. For nonterminal jobs, verify current file and dependency hashes from the earliest invalid artifact, query Supertonic orphan IDs and Comfy history before resubmission, quarantine corrupt/partial files, and re-enter `runJobUntilBlocked` at the first required stage without resetting retry or duration-repair budgets.

- [ ] **Step 5: Run the matrix**

Run: `node --test test/yadam/cancel-resume.test.mjs`

Expected: all interruption points resume from the minimum stage and duplicate provider submissions are 0.

- [ ] **Step 6: Commit cancel/resume**

```bash
git add scripts/lib/pipeline/resume-engine.mjs scripts/lib/pipeline/cancel-engine.mjs scripts/lib/pipeline/outcome-report.mjs test/yadam/cancel-resume.test.mjs
git commit -m "feat: resume and cancel local video jobs"
```

### Task 5: Generate complete human review bundles

**Files:**
- Create: `scripts/lib/pipeline/review-bundle.mjs`
- Modify: `scripts/lib/pipeline/master-orchestrator.mjs`
- Create: `test/yadam/review-bundle.test.mjs`
- Modify: `test/yadam/orchestrator.test.mjs`

**Interfaces:**
- Consumes: the exact current Plan 02 concept/approval/thumbnail artifacts and Plan 04 preview artifacts named in the gate map below; raw provider output and Markdown are never inputs.
- Produces: `renderReviewBundle({jobDir,gate}) -> {bundlePath,bundleHash,indexPath}` plus stable registered Markdown/JSON artifacts for all four awaiting-user states. Unknown keys and unknown gates are rejected.

- [ ] **Step 1: Write bundle completeness tests**

Lock this canonical gate map in the test before implementation:

| gate | slug | exact required current sources |
|---|---|---|
| `concept_selection` | `concept-selection` | singleton passed role `yadam.concept.options` and its verified `CONCEPT_OPTIONS_READY` row |
| `approval_1` | `approval-1` | singleton passed role `yadam.approval.1.bundle` at `approvals/approval-1-bundle.json`, its exact current `APPROVAL_ONE_BUNDLE_READY` row, and singleton passed roles `yadam.concept.options`, `yadam.concept.selection`, `yadam.hook.brief`, `yadam.outline` |
| `thumbnail_copy_selection` | `thumbnail-copy-selection` | singleton passed role `yadam.thumbnail.plan` and its verified `THUMBNAIL_OPTIONS_READY` row |
| `approval_2` | `approval-2` | singleton passed role `yadam.approval.2.bundle` at `approvals/approval-2-bundle.json`, its exact current `APPROVAL_TWO_BUNDLE_READY` row, and every current passed registry artifact listed by that bundle, including the fixed core roles `yadam.script.final_text`, `yadam.script.scenes`, `yadam.scene.plan`, `yadam.story.bible`, `yadam.script.qa`, immutable `yadam.coverage.script`, `yadam.thumbnail.plan`, `yadam.thumbnail.selection`, registered `yadam.thumbnail.guide`, and `yadam.preview.manifest`; mutable `yadam.coverage.report` is excluded |

For every source record, re-read bytes and lock `{artifactId,logicalRole,path,sha256,schemaVersion}` plus the event/bundle binding. Compute `sourceSetHash = hashCanonical(sortedSourceProjection)` using the Plan 01 bytewise comparator; missing, extra, non-pass, stale, duplicate-current, unregistered, or hash-mismatched input fails `approval_bundle_incomplete`. Derive one closed `decisionSource` per gate: `{kind:"concept_options_hash",sha256:conceptOptionsHash}`, `{kind:"approval_artifact_set_hash",sha256:approvalOneArtifactSetHash}`, `{kind:"thumbnail_plan_hash",sha256:thumbnailPlanHash}`, or `{kind:"approval_artifact_set_hash",sha256:approvalTwoArtifactSetHash}` in table order. Only the two approval kinds are values passed as `expectedArtifactSetHash`; selection commands continue to receive their candidate/copy IDs and timestamps. Approval 1 must list selected concept, six-sentence intro, people/relationships, 6 twists, 6 emotional points, canonical 15 beats and spoiler seals. Approval 2 must link final text, script-scenes/scene-plan hashes and schemas, QA, selected copy, reference contact sheet, intro/body/climax previews, thumbnail with reserved-rect guide and final composition. Concept and thumbnail gates expose all candidate IDs/exact copy text needed by their Plan 02 selection commands.

- [ ] **Step 2: Run and verify missing renderer**

Run: `node --test test/yadam/review-bundle.test.mjs`

Expected: FAIL with missing renderer.

- [ ] **Step 3: Implement deterministic bundle rendering**

Render from verified JSON/registry records only; do not parse Markdown back into state. Under the per-job review lock, reuse the current pair only when its index, source set, registry records and bytes all reverify. Otherwise reserve the next three-digit revision and exclusively write the fixed pair `reviews/<slug>-rNNN.md` and `reviews/<slug>-rNNN.json`; never overwrite a prior revision. Links are job-root relative with `/`, user text is escaped, and the top of Markdown displays the exact gate-specific `decisionSource`, `sourceSetHash` and revision. For approval gates label that value as the exact `expectedArtifactSetHash`; never label a concept-options or thumbnail-plan hash as an artifact-set hash.

The canonical JSON index contains exactly the gate, slug, revision, Markdown path/hash, sorted source projection, `sourceSetHash`, the closed `decisionSource`, and creation time; the timestamp is excluded from source identity. Register the immutable pair through two stable current artifact IDs per gate, `yadam-review-<slug>-current` and `yadam-review-<slug>-index-current`, with roles `yadam.review.bundle.<gate>` and `yadam.review.index.<gate>`, exact current paths/hashes, `gateStatus:"pass"`, and dependency hashes for the source set and paired artifact. Moving either stable ID retains the old path/hash in `revisionHistory`; it never creates two current owners. Re-read both files, schemas, dependency hashes and registry records before returning exactly `{bundlePath,bundleHash,indexPath}` with job-relative slash-normalized paths.

Modify `master-orchestrator.mjs` to wire the real renderer as the production default while retaining the injected fake seam. Add integration tests proving all four normal gates return the renderer's exact revisioned Markdown path, a repeat with unchanged sources reuses r001, a source change produces r002, and neither raw approval JSON nor an absolute path escapes. For Plan 03 duration repair, seed `awaiting_reapproval.bundlePath:"approvals/approval-2-bundle.json"`; assert the raw JSON is verified only as input, the renderer is called for `approval_2`, and the public outcome returns `reviews/approval-2-rNNN.md`. Reject a raw path mismatch, source hash mismatch, renderer index mismatch, missing registered review artifact, or review file tamper before returning `awaiting_user`.

- [ ] **Step 4: Run bundle tests**

Run: `node --test test/yadam/review-bundle.test.mjs`

Expected: snapshot is stable across runs; stale artifacts are excluded.

- [ ] **Step 5: Commit review bundles**

```bash
git add scripts/lib/pipeline/review-bundle.mjs scripts/lib/pipeline/master-orchestrator.mjs test/yadam/review-bundle.test.mjs test/yadam/orchestrator.test.mjs
git commit -m "feat: render complete approval review bundles"
```

### Task 6: Build a full mock E2E with duration-repair branch

**Files:**
- Create: `test/yadam/e2e-mock.test.mjs`
- Create: `test/yadam/fixtures/mock-pipeline-services.mjs`

**Interfaces:**
- Consumes: master orchestrator and all public services through injected fakes.
- Produces: reproducible proof of two approvals, manifests, final artifacts and repair reapproval.

- [ ] **Step 1: Create a happy-path fixture**

Use a 10-minute request, 3 concept options, one selected concept, a valid approval-1 set, immutable passed `yadam.coverage.script`, 28 visual slots, normalized fake WAV metadata totaling 600 seconds, valid images, one logical segment with `manual-assembly/final.mp4`·SRT·QA compatibility records, final MP4/upload-SRT/thumbnail fixtures and a strict pass report. Start audio/visual/subtitle coverage as pending r001, then have the three owner fakes publish dynamic passed revisions in pipeline order. Seed `AUDIO_PASSED`, `IMAGES_PASSED`, and `SEGMENTS_PASSED` with the exact current audio/visual/subtitle section output paths and hashes, and make the aggregate bind all four current section records without entering any success hash.

- [ ] **Step 2: Assert the happy path**

Run: `node --test --test-name-pattern="happy path" test/yadam/e2e-mock.test.mjs`

Expected initially: FAIL until all injected interfaces match; then formal approval types count is exactly 2 and final state completed.

- [ ] **Step 3: Add the repair/reapproval fixture**

First audio totals 470 seconds, one repair changes a segment and totals 505 seconds. Assert approval-2-r001 invalidates because its immutable script coverage/script closure changes, not because a downstream aggregate revision changes; approval-2-r002 excludes `yadam.coverage.report`. Changed previews refresh by the exact `refreshInputHash`, unchanged WAV/images are reused, and production cannot start before r002. After r002, assert `resolveForwardCursor` starts at `reference_promotion`; concept/story/segment/finalizer/thumbnail/normal-preview façades have zero additional calls, then promotion rebinds r002 and `runFullTts` reuses the repaired passed audio/section before production. Add crash-after-H1-before-bundle and crash-after-bundle-before-r002 cases: both preserve the original refresh timestamp/manifest bytes, make zero duplicate provider calls and return the same revision/set hash. Independently advance only audio/visual/subtitle coverage and aggregate revisions after formal r002 and assert the approval remains valid, while tampering r002's immutable dependency/pin closure invalidates the floor instead of skipping backward validation.

- [ ] **Step 4: Add retry-exhaustion and no-fallback cases**

Assert a second duration miss becomes needs_review; missing one of 28 images fails; a slate hash fails; a vision skip fails; a warn final report exits nonzero.

- [ ] **Step 5: Run full mock E2E**

Run: `node --test test/yadam/e2e-mock.test.mjs`

Expected: all happy, reapproval and failure branches pass.

- [ ] **Step 6: Commit mock acceptance**

```bash
git add test/yadam/e2e-mock.test.mjs test/yadam/fixtures/mock-pipeline-services.mjs
git commit -m "test: cover yadam pipeline end to end"
```

### Task 7: Preserve the gguljam-bible boundary with regression fixtures

**Files:**
- Create: `test/yadam/gguljam-regression.test.mjs`
- Create: `test/yadam/fixtures/gguljam-route-snapshot.json`
- Modify: `scripts/auto-video-pipeline.mjs`

**Interfaces:**
- Consumes: legacy profile and existing scripts.
- Produces: a compatibility dispatcher with no yadam setting leakage.

- [ ] **Step 1: Snapshot the current route without changing output**

Record legacy policy document, assembler path, concat path, manual-assembly/final.mp4, upload SRT location, default monochrome behavior and current audio tempo range 0.92–1.18.

- [ ] **Step 2: Write the isolation test**

Assert selecting gguljam-bible never imports yadam prompt pack, IP-Adapter, 24 FPS, preserve-color or strict yadam QA. Assert selecting yadam never uses Bible data or scripture speed.

- [ ] **Step 3: Run and expose any route leak**

Run: `node --test test/yadam/gguljam-regression.test.mjs`

Expected: any shared default leak fails with the exact differing key.

- [ ] **Step 4: Implement compatibility dispatch only**

Route the profile to existing entry scripts with explicit args and captured reports; do not refactor the legacy generator in this task. Preserve existing output paths and exit semantics, while recording them in the common artifact manifest as compatibility roles.

- [ ] **Step 5: Run regression and existing fast checks**

Run: `node --test test/yadam/gguljam-regression.test.mjs`

Run: `node scripts/test_topic_history.mjs`

Expected: both pass; no legacy output is regenerated.

- [ ] **Step 6: Commit the profile boundary**

```bash
git add scripts/auto-video-pipeline.mjs test/yadam/gguljam-regression.test.mjs test/yadam/fixtures/gguljam-route-snapshot.json
git commit -m "test: preserve gguljam pipeline boundary"
```

### Task 8: Add dry-run scale checks and an explicit 10-minute live acceptance

**Files:**
- Create: `scripts/run-yadam-scale-dry-run.mjs`
- Create: `scripts/run-yadam-live-acceptance.mjs`
- Create: `test/yadam/scale-dry-run.test.mjs`

**Interfaces:**
- Consumes: preflight suite, master orchestrator, strict final QA.
- Produces: no-provider 20/60/120 planning reports and opt-in live runner.

- [ ] **Step 1: Write dry-run scale tests**

Generate plans for 20, 60 and 120 minutes without Codex/TTS/GPU. Assert 2, 6 and 12 logical segments; slot count never exceeds 260; ID/order/source coverage and manifest schemas pass; no provider POST occurs.

- [ ] **Step 2: Implement and run dry-run scale checks**

Run: `node scripts/run-yadam-scale-dry-run.mjs --minutes 20,60,120`

Expected: one canonical report per duration with `providerCalls:0`, `schemaOk:true`, `slotCapOk:true`.

- [ ] **Step 3: Implement a hard live confirmation token**

The live script must require `--confirm-live YADAM_LOCAL_10_MIN_ACCEPTANCE`, target exactly 10 minutes and a valid approval flow. Any other token exits 2 before provider preflight. It prints estimated asset counts, missing install prerequisites and target output paths before continuing.

- [ ] **Step 4: Run only the negative live guard in ordinary tests**

Run: `node scripts/run-yadam-live-acceptance.mjs --minutes 10`

Expected: exit 2, `live_confirmation_required`, zero provider calls.

- [ ] **Step 5: Run the real candidate only with explicit user authority**

Run after explicit approval:

```powershell
node scripts/run-yadam-live-acceptance.mjs --minutes 10 --confirm-live YADAM_LOCAL_10_MIN_ACCEPTANCE
```

Expected: the process pauses at concept selection, approval 1, thumbnail selection and approval 2; after approvals it produces 8–12 minutes of video, upload SRT, thumbnail and `qualityOk:true`/`finalVerdict:"pass"`. If any gate fails, retain reports and stop; do not substitute fallback media.

- [ ] **Step 6: Commit acceptance runners**

```bash
git add scripts/run-yadam-scale-dry-run.mjs scripts/run-yadam-live-acceptance.mjs test/yadam/scale-dry-run.test.mjs
git commit -m "test: add yadam scale and live acceptance gates"
```

### Task 9: Write the operator contract and bounded cleanup

**Files:**
- Create: `scripts/lib/pipeline/cleanup-policy.mjs`
- Create: `test/yadam/cleanup-policy.test.mjs`
- Create: `docs/yadam-operator-runbook.md`
- Create: `docs/yadam-troubleshooting.md`
- Create: `docs/yadam-artifact-contract.md`

**Interfaces:**
- Consumes: final error codes and exact artifact paths from all plans.
- Produces: safe maintenance commands and complete handoff documentation.

- [ ] **Step 1: Write cleanup containment tests**

Assert cleanup can remove only verified `.tmp`, `.part` and quarantine entries below one selected job root; never provider-owned output, approved references, passed artifacts, logs, approval revisions or final files. A symlink/junction escape must fail.

- [ ] **Step 2: Implement preview and execute modes**

`planCleanup({jobDir,olderThanDays})` returns paths, bytes and reasons. `executeCleanup(plan,{confirmationHash})` requires the SHA-256 of canonical plan JSON and revalidates every path immediately before delete.

- [ ] **Step 3: Run cleanup tests**

Run: `node --test test/yadam/cleanup-policy.test.mjs`

Expected: valid temp deletion passes; every escape and protected role is rejected.

- [ ] **Step 4: Write the operator runbook**

Document exact new/status/run/selection/approval/resume/cancel/preflight/dry-run/live commands, four user pauses, IP-Adapter one-time prerequisite, output locations, duration repair reapproval and strict pass interpretation.

- [ ] **Step 5: Write troubleshooting and artifact contracts**

Map each stable error code to evidence path and action. List canonical versus preview/compatibility artifacts, provider-owned provenance, render-plan versus render-manifest timing and final path names. State that file existence alone is not success.

- [ ] **Step 6: Run all automated checks**

Run: `npm run test:yadam`

Expected: all tests pass with no real Codex generation, TTS, GPU render or live FFmpeg candidate.

- [ ] **Step 7: Commit operations documentation**

```bash
git add scripts/lib/pipeline/cleanup-policy.mjs test/yadam/cleanup-policy.test.mjs docs/yadam-operator-runbook.md docs/yadam-troubleshooting.md docs/yadam-artifact-contract.md
git commit -m "docs: add yadam pipeline operations runbook"
```

## Plan 06 Completion Gate

- [ ] Mock E2E reaches completed only after two formal approval types.
- [ ] Duration repair invalidates and rebuilds approval 2 before production.
- [ ] approval 2 binds immutable `yadam.coverage.script`, excludes mutable aggregate coverage, and remains valid when downstream section revisions advance.
- [ ] forward-cursor verification includes current audio/visual/subtitle section outputs and routes each invalid section only to its owner façade; aggregate-only repair is provider-free exact reuse.
- [ ] Cancel/resume tests prove no duplicate provider submission.
- [ ] Missing visual/audio/subtitle or unresolved warning cannot become completed.
- [ ] gguljam-bible snapshot and profile-isolation tests pass.
- [ ] 20/60/120 dry-runs create correct segment counts with zero provider calls.
- [ ] Live runner is impossible to start without the exact confirmation token.
- [ ] A real 10-minute acceptance, when separately approved, must end with final strict pass.

## Self-Review Notes

- Spec coverage: approval UX, state transitions, retry/cancel/resume, strict completion, migration, E2E, 10/20/60/120 rollout and operations are each assigned to a task.
- Placeholder scan: operational actions, commands, error outcomes and safety boundaries are explicit.
- Type consistency: service method names match Plans 01–05; the final cross-plan review must reject any plan that defines a different public name.
