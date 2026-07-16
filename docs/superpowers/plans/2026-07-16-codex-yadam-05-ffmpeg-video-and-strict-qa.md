# Codex Yadam FFmpeg Video and Strict Release QA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 03의 measured-audio handoff와 Plan 04의 passed production image handoff를 하나의 hash-locked `render-manifest.json`으로 확정하고, 기존 Hermes 호환 조립기와 FFmpeg를 사용해 색상·속도·타임라인을 보존한 segment/final MP4를 만들며 warning 없는 strict release QA를 통과시킨다.

**Architecture:** `video-service.mjs`가 유일한 public façade다. Subtitle builder와 render-manifest finalizer가 먼저 모든 audio/image/thumbnail/hash를 고정한다. Hermes compatibility adapter는 canonical ID/timeline을 기존 `sceneplan.json`, keyframe manifest, visual timeline, voice copy로 투영할 뿐 정본 join을 소유하지 않는다. 기존 `assemble_cain_fast_from_hermes_job.mjs`는 yadam visual timeline일 때 global rescale과 atempo를 금지하고 exact frame boundaries, `--preserve-color`, Ken Burns와 fixed output profile을 사용한다. Segment QA가 통과한 파일만 `segment-manifest.json`에 등록하며, concat-copy와 final strict QA가 통과해야 final artifacts와 `completed` 상태를 publish한다.

**Tech Stack:** Node.js 22.16.0 ES modules, Python 3.13 validator compatibility, Plan 01 atomic/artifact/state core, Plan 03 TTS handoff, Plan 04 image handoff, existing FFmpeg/ffprobe scripts, H.264/yuv420p/AAC 48 kHz, Node built-in tests and synthetic media fixtures.

## Global Constraints

- 이 계획은 Plan 01–04 구현이 통과하고 현재 approval 2가 valid인 job만 조립한다.
- Plan 03 `loadPassedAudioHandoff(jobDir)`와 Plan 04 `loadPassedImageHandoff(jobDir)` public return만 subsystem handoff로 사용한다. provider output directory, preview filename 또는 ComfyUI history를 추측하지 않는다.
- `render-plan.json`은 Plan 04가 image submission 전에 게시한 unresolved production plan이고, `render-manifest.json`은 normalized WAV, passed production PNG, subtitle cues와 thumbnail이 모두 검증된 뒤 FFmpeg 직전에 게시하는 production timeline 정본이다.
- FFmpeg 시작 전 모든 audio/image/thumbnail/subtitle dependency hash를 다시 계산한다. 실행 중 하나라도 바뀌면 현재 assembly를 폐기·quarantine하고 render manifest부터 다시 확정한다.
- canonical joins는 `sceneId`, `segmentId`, `visualSlotId`, `sourceSceneIds`, `primarySceneId`로만 수행한다. 배열 index join은 compatibility projection 내부에서 count parity와 `visualSlotId` equality를 먼저 확인한 뒤에만 허용한다.
- audio scene 수 N과 visual slot 수 M은 독립적이다. 한 audio scene을 여러 intro slot이 참조하거나 한 body slot이 여러 audio scene을 참조할 수 있다.
- compatibility voice filename은 segment-local 1-based decimal order에 최소 두 자리 `padStart(2,"0")`를 적용한다. 100 이상은 `voice_100.wav`이며 자르지 않는다.
- yadam assembler invocation은 `--final-name final.mp4 --preserve-audio-tempo --motion-fps 24 --preserve-color`를 강제한다. `--allow-fast-audio`와 `--max-audio-tempo`는 yadam release에서 금지한다.
- yadam은 `segments/{segmentId}/visual-timeline.json`이 반드시 있어야 한다. timeline이 없을 때의 `findKeyframe`, fixed-grid, first-image와 circular keyframe fallback은 legacy에서만 접근 가능하다.
- yadam visual timeline이 존재하면 `Math.ceil(lastVisualEnd)`와 global slot rescale을 사용하지 않는다. `abs(lastVisualEnd-measuredAudioSeconds)>0.05`이면 fail하고 0.05 이내 차이는 마지막 frame pad/cut으로만 맞춘다.
- yadam `audioTempoFactor`는 정확히 1이며 strict tolerance는 `abs(factor-1)<=0.001`이다. 시각 계획에 맞추기 위한 atempo를 사용하지 않는다.
- frame boundary는 `round(startSeconds*fps)`와 `round(endSeconds*fps)`로 계산하며 manifest/actual start·end 차이는 한 output frame 이내여야 한다. `timelineScale`은 1이다.
- yadam은 색상 만화다. assembler 연결은 `forceMonochrome: !options.preserveColor`; legacy default는 계속 monochrome `true`다.
- source image color-pixel ratio는 0.10 이상, motion clip midpoint는 `max(0.05,sourceRatio*0.50)` 이상, Plan 04 vision `colorStyleMatch`는 7 이상이다. 하나라도 실패하거나 final segment sample이 monochrome이면 strict fail이다.
- still motion은 기존 deterministic Ken Burns move set을 사용하고 24 FPS로 인코딩한다. intro acceptance는 cut 연결이며 dissolve/xfade는 이 compatibility plan의 범위가 아니다.
- subtitle text는 Plan 02 canonical source text에서 만들고 Plan 03 measured scene boundaries에 배치한다. native Supertonic SRT를 alignment 정본으로 사용하지 않는다.
- 모든 cue는 0.2–8.0초, inverted/overlap 0, audio end delta <=0.5초, video end delta <=0.75초이며 required scene text coverage가 100%여야 한다.
- segment final/audio delta <=0.25초, motion clip error <=`max(0.75,planned*0.03)`, first/last 0.25초를 제외한 0.5초 이상 black interval 0을 hard gate로 사용한다.
- concat 전 모든 segment H.264/yuv420p/1920×1080/24 FPS/AAC/48 kHz stream profile이 exact parity여야 한다. concat은 `-c copy`만 사용한다.
- final/sum-segments delta <=`max(0.5,2*segmentCount/fps)`, overall target 80–120%, merged upload SRT cue count >0, missing/unparseable/timing warning 0을 hard gate로 사용한다.
- yadam strict release에서 missing report와 warning은 성공이 아니다. 모든 required check가 pass일 때만 `qualityOk:true`, `finalVerdict:"pass"`, exit 0이다.
- intro visual slot은 segment 1에만 있어야 한다. later segment intro slot은 hard fail이다.
- missing image, slate, first-image fallback, circular reuse와 automatic image cycling을 금지한다.
- cancellation은 먼저 `cancel_requested`를 기록하고 새 FFmpeg를 시작하지 않는다. owned assembler/FFmpeg process tree는 graceful termination 후 5초에 강제 종료하고 partial manual assembly를 quarantine한다.
- resume은 input manifest hash, output file hash, gate status를 모두 확인하며 통과한 segment만 skip한다. failed/cancelled/changed segment만 최소 단위로 다시 조립한다.
- 기존 `gguljam-bible` path와 defaults는 회귀 테스트로 잠근다. yadam strict policy를 legacy run에 적용하지 않는다.
- 실제 10분 acceptance render는 Plan 06 runner의 exact `--confirm-live YADAM_LOCAL_10_MIN_ACCEPTANCE` 토큰과 사용자 opt-in이 있을 때만 수행한다. 별도 환경변수 guard를 두지 않으며 일반 테스트는 synthetic PNG/WAV/SRT/MP4를 사용한다.
- 모든 명령은 PowerShell에서 `C:\Users\petbl\auto-video`를 working directory로 실행한다.
- 현재 workspace는 Git repository가 아니다. commit step은 먼저 `git status --short`를 실행하고 실패하면 `SKIP: not a git repository`를 기록하며 `git init`을 실행하지 않는다.

---

## Interfaces Consumed Without Redefinition

### Plan 01 core

```js
import { lstat, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { loadJob } from "../pipeline/job-store.mjs";
import { writeCanonicalJson, writeUtf8Atomic, writeBinaryAtomic, writeCanonicalJsonExclusive } from "../pipeline/atomic-store.mjs";
import { sha256Bytes, hashCanonical } from "../pipeline/canonical-json.mjs";
import { registerArtifact, canReuseArtifact } from "../pipeline/artifact-store.mjs";
import { transitionJob } from "../pipeline/state-machine.mjs";
import { validateSchema } from "../pipeline/schema-registry.mjs";
import { assertPathWithin, assertRealPathWithin, assertAnyAllowedRealPath } from "../pipeline/path-policy.mjs";
```

The exact consumed contracts are:

```js
loadJob(jobDir): Promise<JobContext>
writeCanonicalJson(filePath, value): Promise<{ path: string, sha256: string, sizeBytes: number }>
writeUtf8Atomic(filePath, text): Promise<{ path: string, sha256: string, sizeBytes: number }>
writeBinaryAtomic(filePath, bytes): Promise<{ path: string, sha256: string, sizeBytes: number }>
writeCanonicalJsonExclusive(filePath, value): Promise<{ path: string, sha256: string, sizeBytes: number }>
sha256Bytes(input): string
hashCanonical(value): string
registerArtifact(jobDir, record): Promise<ArtifactRecord>
canReuseArtifact(jobDir, artifactId, dependencyHashes): Promise<boolean>
transitionJob(jobDir, event): Promise<PipelineState>
validateSchema(schemaPath, value): object
assertPathWithin(root, candidate): string
assertRealPathWithin(root, candidate): Promise<string>
assertAnyAllowedRealPath(roots, candidate): Promise<string>
```

`render-manifest.json`, assembly/concat/segment/final reports and `segment-manifest.json` are immutable publication files and use `writeCanonicalJsonExclusive` or, for an already-validated staged report, equivalent exclusive-create promotion. A failed or stale fixed-path publication is never replaced in place: under the job lock, rehash it, move the file and its invalidation evidence to `quarantine/video/publications/{artifactId}-{sha256}/`, verify the canonical target is absent, then publish the next attempt exclusively. Mutable `render-checkpoint.json`, cancellation bookkeeping and pointers continue to use `writeCanonicalJson`.

Small buffered PNG copies use Plan 01 `writeBinaryAtomic`; large WAV/MP4 and FFmpeg outputs stream or render only to a same-directory `.part`, flush/sync, validate and hash, then atomically rename or exclusively promote. Plan 05 does not implement a second buffered binary writer and no canonical media path is an FFmpeg work target.

Internal `scripts/lib/yadam/video-layout.mjs` owns `ensureVideoJobLayout(jobDir)` and `ensureContainedVideoDirectory(jobDir,relativePath)`; these are Plan 05 module utilities, not `video-service.mjs` public exports. Under the job lock, the full initializer runs only after `loadJob` has established the verified real job root and before any nonterminal Plan 05 file, state transition or child process. Its fixed bytewise-sorted relative directory set is `final/incidents`, `logs/video`, `quarantine/video`, and `quarantine/video/publications`; Plan 01 already creates the other static parents. Use a no-write preflight pass over all targets first: resolve each lexically below the verified root with `assertPathWithin`, walk every existing component with `lstat`, reject a regular file, symlink, junction or other reparse-point component, and require the nearest existing real ancestor to pass `assertRealPathWithin`. Only when every target passes does a second pass call `mkdir(target,{recursive:true})`; a third pass walks and real-resolves every completed chain again. Any unsafe component throws `video_layout_unsafe` before creating a sibling directory, artifact, state row or child. Dynamic `compat/hermes/{segmentId}`, `segments/{segmentId}/manual-assembly`, `final/.attempt-{segmentManifestHash}` and hash-addressed quarantine directories use `ensureContainedVideoDirectory` immediately before first use. A completed fast path never runs the full layout initializer; normal jobs already created it before completion. Only after completed-artifact tamper is proven may incident publication recreate a missing `final/incidents` directory through that same primitive as part of the single append-only incident exception.

### Plan 02 script and coverage service

```js
import { updateCoverageSection } from "./script-service.mjs";

updateCoverageSection({
  jobDir,
  section: "subtitle",
  report,
}): Promise<{
  relativePath: "script/coverage-report.json",
  sha256: string,
  sectionArtifact: {
    section: "subtitle",
    relativePath: string,
    sha256: string,
    revision: number,
  },
  complete: boolean,
  sections: {
    script: "pass",
    audio: "pending" | "pass",
    subtitle: "pending" | "pass",
    visual: "pending" | "pass",
  },
}>
```

Plan 05 reads the registered canonical `yadam.script.scenes` artifact only to construct subtitle text and verifies its hash equals the current approval and Plan 03 dependencies.

### Plan 03 passed audio handoff

```js
import { loadPassedAudioHandoff } from "./tts-service.mjs";
```

Plan 05 consumes the exact success value locked by Plan 03: artifact paths/hashes, `measuredAudioSeconds`, accepted range, `audioTempoFactor:1`, `scenes`, `segments` and `visualSlots`. In particular each audio scene provides normalized WAV path/hash and measured start/end; each visual slot provides `sourceSceneIds`, `primarySceneId`, start/end/duration and timing band.

### Plan 04 passed image handoff

```js
import { loadPassedImageHandoff } from "./image-service.mjs";

loadPassedImageHandoff(jobDir): Promise<{
  renderPlanPath: string,
  renderPlanHash: string,
  imageAssetManifestPath: string,
  imageAssetManifestHash: string,
  visualQaReportPath: string,
  visualQaReportHash: string,
  thumbnail: {
    path: string,
    sha256: string,
    qaPath: string,
    qaSha256: string,
  },
  visualSlots: Array<{
    visualSlotId: string,
    startSeconds: number,
    endSeconds: number,
    imagePath: string,
    imageSha256: string,
    qaStatus: "pass",
  }>,
}>
```

Canonical relative artifacts are `render-plan.json`, `assets/asset-manifest.json`, `assets/visual-qa-report.json`, `thumbnail/final.png` and `thumbnail/qa.json`. Every handoff path must rehash to the returned hash and its registry record must be pass before use.

---

## Public Interface Produced for Plan 06

Create `scripts/lib/yadam/video-service.mjs` with exactly these public exports:

```js
export async function assembleAllSegments({ jobDir, signal });
export async function publishFinalVideo({ jobDir, signal });
export async function loadFinalQa(jobDir);
```

`assembleAllSegments` returns only after every segment strict QA passes:

```js
{
  status: "segments_passed",
  renderManifestPath: string,
  renderManifestHash: string,
  segmentManifestPath: string,
  segmentManifestHash: string,
  segments: Array<{
    segmentId: string,
    plannedDurationSeconds: number,
    measuredAudioSeconds: number,
    renderDurationSeconds: number,
    finalDurationSeconds: number,
    finalPath: string,
    finalSha256: string,
    qaPath: string,
    qaSha256: string,
  }>,
}
```

`publishFinalVideo` returns only after final strict QA passes:

```js
{
  status: "completed",
  finalPath: string,
  finalSha256: string,
  uploadSrtPath: string,
  uploadSrtSha256: string,
  thumbnailPath: string,
  thumbnailSha256: string,
  qaPath: string,
  qaSha256: string,
  finalDurationSeconds: number,
  qualityOk: true,
  finalVerdict: "pass",
}
```

`loadFinalQa(jobDir)` returns pass or fail evidence without starting work:

```js
{
  qaPath: string,
  qaSha256: string,
  qualityOk: boolean,
  finalVerdict: "pass" | "fail",
  finalDurationSeconds: number,
  checks: Record<string, {
    status: "pass" | "fail",
    actual: unknown,
    limit: unknown,
  }>,
}
```

Both mutation functions are hash/gate-idempotent. AbortSignal causes an AbortError after cancellation bookkeeping; neither returns partial success.

A segment strict failure throws with `code:"segment_qa_failed"` and job-relative `reportPath`; a final strict failure throws with `code:"final_qa_failed"` and job-relative `reportPath:"final/final-qa-report.json"`. These reports are re-readable registered fail evidence for Plan 06. If a job is already `completed` and any of the six terminal output artifacts is missing or no longer matches its registered/completed-event hash, `publishFinalVideo` must not regress the terminal state or rerender that job: it publishes or reuses the immutable incident report described below and throws `{code:"completed_artifact_tampered",reportPath}`. The only permitted write in that branch is the new append-only incident file/record; completed state, success history, preexisting registry records and canonical release artifacts remain read-only. `loadFinalQa` itself remains strictly read-only: it throws the same code, includes `reportPath` only when a matching registered incident already exists, and never creates one. Other pre-report contract failures retain their stable subsystem code and do not fabricate a report path, and cancellation rethrows AbortError after bookkeeping without one. Plan 06 keeps `reportPath` required on its aggregate `RunOutcome`, so its own `writeOutcomeReport` contract publishes/registers a real orchestrator report whenever a subsystem error has no readable report; it never invents a Plan 05 path. The Plan 06 full-run path calls `publishFinalVideo`, so completed-artifact tamper always has a real incident path there.

Every public `*Path` above and every Plan 03/04 handoff path is job-relative with `/` separators. The implementation derives absolute child-process paths only after containing them under the verified `jobDir`; provider or host-absolute paths never cross the public boundary.

Plan 05 uses the same success-evidence function as Plan 03 and the Plan 06 consumer. Resolve only current verified Plan 01 records, normalize paths before projection, and use bytewise code-unit comparison:

```js
import { buildSuccessEvidence } from "../pipeline/success-evidence.mjs";

// Plan 01's locked helper computes exactly:
// inputHash  = hashCanonical({schemaVersion:"1.0.0",eventStage:stage,inputArtifacts,opaqueInputs:sortedOpaqueInputs})
// outputHash = hashCanonical({schemaVersion:"1.0.0",eventStage:stage,inputHash,outputArtifacts})
// artifactPaths = outputArtifacts.map(({path}) => path)
```

Both Plan 05 success stages pass exactly `{profileHash,ffmpegVersionHash,assemblerPolicyHash,qaPolicyHash}` as `opaqueInputs`; missing/extra keys or non-lowercase-64-hex values fail before hashing. `profileHash` is the verified Plan 01 yadam profile hash. `ffmpegVersionHash = hashCanonical({ffmpegVersionOutputHash,ffprobeVersionOutputHash})`, where each inner hash covers the corresponding bounded full `-version` stdout normalized to LF with trailing whitespace removed. `assemblerPolicyHash = hashCanonical({contractVersion:"1.0.0",files})`, where `files` is the bytewise path-sorted `{path,sha256}` projection of `scripts/lib/yadam/render-manifest.mjs`, `scripts/lib/yadam/subtitle-service.mjs`, `scripts/lib/yadam/hermes-compat.mjs`, `scripts/lib/yadam/exact-video-policy.mjs`, `scripts/assemble_cain_fast_from_hermes_job.mjs`, `scripts/lib/kenburns-motion.mjs`, and `scripts/concat_segments.mjs`. `qaPolicyHash` uses the same wrapper over `scripts/lib/yadam/color-ratio.mjs`, `scripts/lib/yadam/video-qa.mjs`, `schemas/yadam/assembly-report.schema.json`, `schemas/yadam/segment-manifest.schema.json`, `schemas/yadam/segment-qa-report.schema.json`, `schemas/yadam/concat-report.schema.json`, `schemas/yadam/final-qa-report.schema.json`, `schemas/yadam/completed-artifact-incident.schema.json`, `scripts/check_audio_speed_profile.mjs`, `scripts/check_subtitle_render_quality.mjs`, `scripts/check_motion_manifest.mjs`, and `scripts/validate_segmented_export.py`. Recompute all four pins immediately before each new success event; Plan 06 derives the identical maps. At final publication, persist that exact completion-time map both in `final-qa-report.json.successEvidenceInput.opaqueInputs` and under the same four named opaque `dependencyHashes` on each of the six final output records. A later completed-job read first recovers the mutually identical values from the six immutable records and rebuilds `FINAL_QA_PASSED` with that completion-time map; after the six files rehash, it also requires the final report copy to agree. This ordering still classifies a missing/tampered final report file as artifact tamper. It must not recompute pins from the current host: a later FFmpeg, profile or policy-file change applies only to a new job and does not make an already completed job unreadable.

For `SEGMENTS_PASSED`, `inputRecords` contains exactly one current passed record for each upstream role `yadam.approval.2`, `yadam.script.final_text`, `yadam.script.scenes`, `yadam.audio.manifest`, `yadam.audio.timeline`, `yadam.render_plan_input`, `yadam.render.plan`, `yadam.image.asset-manifest`, `yadam.image.visual-qa`, `yadam.thumbnail.final`, `yadam.thumbnail.qa`, `yadam.coverage.audio`, and `yadam.coverage.visual`. `outputRecords` contains exactly the Plan 05-owned current `yadam.coverage.subtitle`, `yadam.render.manifest`, `yadam.segment.manifest`, and for every segment ID in canonical segment-manifest order, `yadam.video.segment.{segmentId}` plus `yadam.qa.segment.{segmentId}`. Resolve `subtitleCoveragePath` from the verified current section record rather than predicting a revision. The mutable `yadam.coverage.report` is not an input or output record: immediately before evidence construction it must rehash and bind the exact current script/audio/visual/subtitle section records; an aggregate-only stale condition is repaired through `publishSubtitles`/`updateCoverageSection` without changing any event hash. The exact sorted paths are:

```js
[
  "render-manifest.json",
  "segment-manifest.json",
  subtitleCoveragePath,
  ...segments.flatMap(({ segmentId }) => [
    `segments/${segmentId}/manual-assembly/final.mp4`,
    `segments/${segmentId}/manual-assembly/segment-qa-report.json`,
  ]),
].sort(compareText)
```

After reloading all those records and bytes, verifying the dynamic subtitle revision/path/hash and the aggregate binding, `assembleAllSegments` calls `buildSuccessEvidence("SEGMENTS_PASSED",inputRecords,outputRecords,{profileHash,ffmpegVersionHash,assemblerPolicyHash,qaPolicyHash})`, passes its three returned fields to `transitionJob` with `{stage:"SEGMENTS_PASSED",to:"running"}`, re-reads the exact row and only then returns. A second call with only aggregate staleness rebuilds that derived aggregate, recomputes the same input/output evidence, reuses the one exact row and starts no FFmpeg/provider child.

For `FINAL_QA_PASSED`, `inputRecords` contains exactly the current passed `yadam.segment.manifest`. `outputRecords` contains exactly `yadam.video.concat_list`, `yadam.video.concat_report`, `yadam.video.final`, `yadam.qa.final`, `yadam.thumbnail.release`, and `yadam.subtitle.upload`. Its exact sorted paths are:

```js
[
  "final/concat-list.txt",
  "final/concat-report.json",
  "final/final-full.mp4",
  "final/final-qa-report.json",
  "final/thumbnail.png",
  "final/upload-subtitles/final-full.upload.srt",
]
```

Only after `loadFinalQa` and both concat-evidence records reverify does `publishFinalVideo` call `buildSuccessEvidence("FINAL_QA_PASSED",inputRecords,outputRecords,{profileHash,ffmpegVersionHash,assemblerPolicyHash,qaPolicyHash})`, pass its three returned fields to `transitionJob` with `{stage:"FINAL_QA_PASSED",to:"completed"}`, and re-read completed state before returning. Each producer permits exactly one row per stage/inputHash. Zero permits one transition followed by a full same-stage/input re-read requiring total cardinality one exact; exactly one exact row is reused; duplicate exact rows, an exact-plus-conflicting row, or any different output/path row is `success_evidence_conflict` and cannot create another success. Needs-review, strict-failure, cancellation and reapproval branches append neither event. Plan 06 recomputes this identical projection and never emits either transition.

---

## Canonical Paths and Compatibility Projection

| Role | Canonical relative path |
|---|---|
| production timeline | `render-manifest.json` |
| segment index | `segment-manifest.json` |
| segment timeline | `segments/{segmentId}/visual-timeline.json` |
| segment source subtitle | `compat/hermes/{segmentId}/subtitles.srt` |
| segment compatibility scene plan | `compat/hermes/{segmentId}/sceneplan.json` |
| segment compatibility voice | `compat/hermes/{segmentId}/voice/voice_01.wav` |
| segment compatibility keyframes | `compat/hermes/{segmentId}/keyframes/manifest.json` |
| subtitle coverage (`yadam.coverage.subtitle`) | `script/coverage/subtitle-rNNN.json` |
| segment assembled narration | `segments/{segmentId}/manual-assembly/narration.wav` |
| segment burned/upload source subtitle | `segments/{segmentId}/manual-assembly/subtitles.srt` |
| segment video | `segments/{segmentId}/manual-assembly/final.mp4` |
| segment assembly report | `segments/{segmentId}/manual-assembly/assembly-report.json` |
| segment strict QA | `segments/{segmentId}/manual-assembly/segment-qa-report.json` |
| final concat list (`yadam.video.concat_list`) | `final/concat-list.txt` |
| final concat report (`yadam.video.concat_report`) | `final/concat-report.json` |
| final video | `final/final-full.mp4` |
| upload subtitle | `final/upload-subtitles/final-full.upload.srt` |
| release thumbnail (`yadam.thumbnail.release`) | `final/thumbnail.png` |
| final strict QA | `final/final-qa-report.json` |
| completed-artifact incident (`yadam.incident.completed_artifact_tampered`) | `final/incidents/completed-artifact-tampered-{incidentKeyHash}.json` |

`compat/hermes/{segmentId}` is a projection of canonical assets. Copies are rehashed and must equal the source hash. The compatibility tree is never used to decide canonical source or timing.

Plan 04 remains the sole owner of role `yadam.thumbnail.final` at `thumbnail/final.png`. Plan 05 verifies that passed source role and its handoff hash, then registers the immutable release copy at `final/thumbnail.png` under the distinct role `yadam.thumbnail.release`; the two paths and roles must never alias or overwrite one another.

## Locked File Map

- Create `schemas/yadam/subtitle-cues.schema.json`
- Create `schemas/yadam/render-manifest.schema.json`
- Create `schemas/yadam/hermes-compatibility.schema.json`
- Create `schemas/yadam/assembly-report.schema.json`
- Create `schemas/yadam/segment-manifest.schema.json`
- Create `schemas/yadam/concat-report.schema.json`
- Create `schemas/yadam/segment-qa-report.schema.json`
- Create `schemas/yadam/final-qa-report.schema.json`
- Create `schemas/yadam/completed-artifact-incident.schema.json`
- Create `scripts/lib/yadam/subtitle-service.mjs`
  - Canonical scene text coverage, measured cue allocation and SRT serialization.
- Create `scripts/lib/yadam/render-manifest.mjs`
  - Cross-handoff hash/ID join, timeline gate and atomic finalization.
- Create `scripts/lib/yadam/hermes-compat.mjs`
  - N audio scenes and M visual slots to exact legacy file mapping.
- Create `scripts/lib/yadam/exact-video-policy.mjs`
  - Pure frame-boundary, exact-timeline and forbidden-option assertions imported by the existing assembler.
- Create `scripts/lib/yadam/color-ratio.mjs`
  - Source PNG, motion midpoint and final sample color-pixel measurement.
- Create `scripts/lib/yadam/video-qa.mjs`
  - Segment/final numeric checks and strict report aggregation.
- Create `scripts/lib/yadam/video-layout.mjs`
  - Verified-root static/dynamic directory creation with file/reparse escape rejection.
- Create `scripts/lib/yadam/video-service.mjs`
  - Public façade, contained pristine-layout initialization, assembler child orchestration, checkpoint/resume/cancel and artifact registration.
- Create `scripts/run_yadam_video.mjs`
  - `assemble`, `publish`, `status` CLI.
- Modify `scripts/assemble_cain_fast_from_hermes_job.mjs`
  - Add `--preserve-color`, yadam exact-timeline branch, no atempo/rescale and boundary-rich report.
- Modify `scripts/lib/kenburns-motion.mjs`
  - Accept an exact `frameCount` override without changing legacy duration behavior.
- Modify `scripts/concat_segments.mjs`
  - Opt-in yadam staging output, strict missing/unparseable/timing handling, contained manifest paths, manifest durations and returned hashes; legacy destructive cleanup remains isolated to legacy mode.
- Modify `scripts/validate_segmented_export.py`
  - Add yadam strict branch and exact numeric thresholds while preserving legacy warn semantics.
- Modify `scripts/check_audio_speed_profile.mjs`
  - Enforce yadam factor 1.0±0.001 and keep legacy 0.92–1.18.
- Modify `scripts/check_subtitle_render_quality.mjs`
  - Enforce max 8 seconds, empty/unparseable cue failure and source coverage report.
- Modify `scripts/check_motion_manifest.mjs`
  - Read manifest/actual boundaries and enforce one-frame timeline error for yadam.
- Create `test/yadam/video-contract.test.mjs`
- Create `test/yadam/subtitle-service.test.mjs`
- Create `test/yadam/hermes-compat.test.mjs`
- Create `test/yadam/exact-assembler.test.mjs`
- Create `test/yadam/video-qa.test.mjs`
- Create `test/yadam/video-service.test.mjs`
- Create `test/yadam/fixtures/video/make-media.mjs`
- Create `test/yadam/fixtures/video/fake-assembler.mjs`
- Create `test/yadam/fixtures/video/two-segment-handoff.json`

---

## Task 1: Lock video contracts and the pristine Plan 05 layout

**Files:**
- Create: `schemas/yadam/subtitle-cues.schema.json`
- Create: `schemas/yadam/render-manifest.schema.json`
- Create: `schemas/yadam/hermes-compatibility.schema.json`
- Create: `schemas/yadam/assembly-report.schema.json`
- Create: `schemas/yadam/segment-manifest.schema.json`
- Create: `schemas/yadam/concat-report.schema.json`
- Create: `schemas/yadam/segment-qa-report.schema.json`
- Create: `schemas/yadam/final-qa-report.schema.json`
- Create: `schemas/yadam/completed-artifact-incident.schema.json`
- Create: `scripts/lib/yadam/video-layout.mjs`
- Create: `test/yadam/video-contract.test.mjs`

**Interfaces:**
- Consumes: Plan 01 schema registry, Plan 03/04 handoff types.
- Produces: closed contracts for every Plan 05 canonical artifact/public return plus internal `ensureVideoJobLayout` and `ensureContainedVideoDirectory`.

- [ ] **Step 1 (5 minutes): Write failing closed-schema tests.**

Create a minimal two-scene/two-slot render manifest fixture, one boundary-rich yadam assembly report fixture, one warning-free concat report fixture and one completed-artifact incident fixture; assert all validate. Clone them with an unknown `fallbackImagePath`, missing `sourceSceneIds`, `audioTempoFactor:1.01`, empty subtitle cues, thumbnail `qaStatus:"warning"`, missing group `visualSlotId`, `timelineScale:0.99`, a concat absolute path, one concat timing warning, an incident with an unknown recovery action, or an observed artifact that does not belong to the completed event's exact output set; each clone must fail schema or semantic validation.

Create a pristine verified Plan 01 job and assert both layout functions are missing. The future tests require the exact four static directories, idempotent second call, a contained dynamic segment directory, no-write rejection for a regular-file component and Windows junction/symlink escape at every static target, plus post-mkdir real-path revalidation.

- [ ] **Step 2 (4 minutes): Add strict report truth-table tests.**

Validate one segment report and one final report with every check `status:"pass"`, `qualityOk:true`, `finalVerdict:"pass"`. Change one check to fail while leaving the summary true and assert schema or semantic validation rejects the inconsistent report.

- [ ] **Step 3 (2 minutes): Run and confirm schemas are absent.**

Run:

```powershell
node --test test/yadam/video-contract.test.mjs
```

Expected: FAIL because `render-manifest.schema.json` and `video-layout.mjs` do not exist.

- [ ] **Step 4 (5 minutes): Create the closed subtitle and render-manifest schemas.**

Use JSON Schema 2020-12 and `additionalProperties:false`. Require:

- subtitle cue: `cueId`, `segmentId`, nonempty `sceneIds`, `startSeconds`, `endSeconds`, `durationSeconds`, nonempty `text`, `sourceHashes`; duration >0;
- render manifest: schema/profile/job/approval, 1920×1080, 24 FPS, script, audio/image/thumbnail handoff hashes, current audio/visual/subtitle coverage section path/hash/revision, `subtitleSetHash`, `audioTempoFactor` const 1, scenes, visual slots, subtitle cues, segments and intro IDs;
- each scene: source/WAV path+hash, measured duration and start/end;
- each visual slot: source/primary IDs, image path+hash, start/end/duration, `qaStatus` const pass, provider/model/workflow/seed/attempt provenance;
- thumbnail: PNG path/hash and QA path/hash with `qaStatus` const pass;
- all paths are nonempty job-root relative strings and all hashes are lowercase 64 hex.

- [ ] **Step 5 (5 minutes): Create compatibility and segment schemas.**

`hermes-compatibility.schema.json` has three definitions: audio scene plan rows with segment-local continuous order, visual keyframe rows with continuous `visualOrder`, and visual timeline rows with `visualSlotId`, sources, primary and timing. Require root planned/measured/render values and `durationSeconds === renderDurationSeconds` in semantic validation. `assembly-report.schema.json` requires yadam profile, exact invocation options, measured duration, `timelineScale` const 1, `audioTempoFactor` const 1, final stream evidence and nonempty existing field `visualGroups` with manifest/actual frame boundaries, image hash, motion and color evidence.

`segment-manifest.schema.json` requires profile `yadam`, render manifest path/hash, FPS 24 and ordered segments with planned/measured/render/final durations, cumulative start/end, job-relative slash-normalized `dir`, final path/hash and passed QA path/hash. Schema and semantics reject drive letters, leading slash, `..`, backslash and a final/QA path outside its declared `dir`.

- [ ] **Step 6 (5 minutes): Create concat, segment and final strict report schemas.**

`concat-report.schema.json` is a closed success-evidence contract requiring `schemaVersion`, `reportType:"yadam_concat"`, `profileId:"yadam"`, `jobId`, segment-manifest path/hash, ordered segment MP4/SRT path/hash/duration rows, exact stream fingerprint, `ffmpegArgs`, canonical candidate paths/hashes for `final/concat-list.txt`, `final/final-full.mp4` and `final/upload-subtitles/final-full.upload.srt`, and `subtitleMerge:{mergedCueCount,missingSrt,unparseableSrt,timingWarnings}`. Every path is job-relative and slash-normalized; all three diagnostic arrays must be empty, the cue count must be positive and semantic validation must require exact segment order/duration/hash equality with the segment manifest. The report may be physically staged, but its recorded candidate paths are the canonical destinations and it contains no absolute attempt-directory path.

Every segment/final QA report requires `qualityOk`, `finalVerdict`, nonempty `checks`, `failures`, `warnings`, artifact hashes and measured durations. The final report additionally requires `successEvidenceInput:{stage:"FINAL_QA_PASSED",inputArtifacts,opaqueInputs,inputHash}`: `inputArtifacts` is exactly the shared-helper projection of the one `yadam.segment.manifest` record, `opaqueInputs` has exactly the four completion-time pins, and `inputHash` must recompute through Plan 01's shared formula. Permit `acknowledgedNotices` only as a separate array. Semantic validation must enforce:

```text
qualityOk = every required check status is pass
finalVerdict = pass only when qualityOk is true and warnings is empty
```

No check status other than `pass|fail` is permitted.

`completed-artifact-incident.schema.json` is a closed append-only diagnostic contract. Require `schemaVersion:"1.0.0"`, `reportType:"completed_artifact_tampered"`, `errorCode:"completed_artifact_tampered"`, `jobId`, `incidentKeyHash`, `firstObservedAt`, the immutable completed event projection `{stage:"FINAL_QA_PASSED",inputHash,outputHash,artifactPaths}`, ordered `expectedArtifacts` rows `{artifactId,logicalRole,path,expectedSha256}`, ordered `observedArtifacts` rows `{artifactId,logicalRole,path,status:"missing"|"hash_mismatch",expectedSha256,observedSha256:string|null}`, `stateStatus:"completed"`, `mutationPolicy:"read_only_except_append_only_incident"`, `recovery:"trusted_backup_or_new_job"`, and `completionOpaqueInputs` containing exactly the four mutually agreed completion-time pins recovered from the six final artifact records. When the final QA file is intact, its redundant pin copy must agree; incident creation does not depend on parsing that file. Require at least one observed mismatch, lowercase hashes, job-relative normalized paths, exact membership in the completed event's six output paths, and `observedSha256:null` if and only if status is `missing`. Compute `incidentKeyHash = hashCanonical({jobId,completedEvent,expectedArtifacts,observedArtifacts})`; the timestamp and current host pins are deliberately excluded from this key. Sort both artifact arrays with the shared success-evidence output comparator. A matching report is reusable only after schema, semantic, registry and byte-hash verification.

- [ ] **Step 7 (5 minutes): Implement the shared contained layout utility.**

Export only `ensureVideoJobLayout(jobDir)` and `ensureContainedVideoDirectory(jobDir,relativePath)` from `video-layout.mjs`. Implement the locked three-pass algorithm above with the imported `lstat`, `mkdir`, `resolve`, `assertPathWithin` and `assertRealPathWithin`; reject an empty/absolute/backslash/drive/`..` relative path and map every unsafe component/race to `video_layout_unsafe`. Return only the verified absolute directory path(s) internally. Do not register directories as artifacts and do not catch an unsafe result to continue.

- [ ] **Step 8 (3 minutes): Run contract and layout tests.**

Run `node --test test/yadam/video-contract.test.mjs`.

Expected: valid render, assembly, concat, segment-QA, final-QA and completed-incident fixtures pass; pristine static/dynamic directory creation is contained and idempotent; every unknown property, missing mapping, non-1 tempo, empty cue, absolute concat path, concat warning, inconsistent summary, invalid incident, file component and reparse escape fails.

- [ ] **Step 9 (2 minutes): Record the contract commit.**

Run `git status --short`. In Git, stage the Task 1 files and run:

```powershell
git commit -m "feat(yadam): lock render and strict QA contracts"
```

Expected now: `SKIP: not a git repository`.

---

## Task 2: Build measured subtitles with canonical scene coverage

**Files:**
- Use: `scripts/lib/yadam/video-layout.mjs`
- Create: `scripts/lib/yadam/subtitle-service.mjs`
- Create: `test/yadam/subtitle-service.test.mjs`

**Interfaces:**
- Consumes: current approved `script/script-scenes.json`, Plan 03 measured scene rows, Plan 02 `updateCoverageSection`.
- Produces: pure `buildSubtitleCues({scriptScenes,audioScenes})`, `serializeSrt(cues)`, mutation `publishSubtitles({jobDir,audioHandoff})` and verified internal `loadPassedSubtitleHandoff(jobDir)`.

`publishSubtitles` and the loader return this exact job-relative handoff; it is internal to Plan 05 and is not re-exported by `video-service.mjs`:

```js
{
  coverageReportPath: "script/coverage-report.json",
  coverageReportHash: string,
  subtitleCoveragePath: string,
  subtitleCoverageHash: string,
  subtitleCoverageRevision: number,
  subtitleSetHash: string,
  segments: Array<{
    segmentId: string,
    srtPath: string,
    srtHash: string,
    cueIds: string[],
  }>,
  cues: Array<{
    cueId: string,
    segmentId: string,
    sceneIds: string[],
    sourceHashes: string[],
    startSeconds: number,
    endSeconds: number,
    durationSeconds: number,
    text: string,
  }>,
}
```

The section fields must equal `updateCoverageSection(...).sectionArtifact` and the re-read stable artifact ID/role `yadam-coverage-subtitle-current` / `yadam.coverage.subtitle`; revision is a positive integer and the path must match `script/coverage/subtitle-rNNN.json` for that exact revision. `subtitleSetHash` is exactly `hashCanonical({subtitleCoverageHash,segments,cues})`, where segments are in canonical segment order and cues in `{startSeconds,cueId}` order. It never includes mutable `coverageReportHash`. Each SRT is registered as `yadam.subtitle.segment.{segmentId}` with script-scenes, audio-manifest/timeline and serializer-version dependencies; the subsequently updated subtitle section names every SRT path/hash, while `script/coverage-report.json` is only the deterministic aggregate binding of the four current sections. The loader rehashes every SRT, the current subtitle section and the aggregate, requires the section record to pass and the aggregate's subtitle revision/path/hash binding to match, then recomputes `subtitleSetHash` before returning.

- [ ] **Step 1 (5 minutes): Write failing Korean split and timing tests.**

Use one 18-second scene with Korean dialogue and narration. Assert every cue is 0.2–8.0 seconds, sorted, nonoverlapping, nonempty, starts no earlier than the scene, the final cue ends exactly at scene end, and display text is at most 26 Unicode graphemes before line wrapping.

- [ ] **Step 2 (4 minutes): Write source coverage tests.**

For three required scenes, assert:

```js
assert.deepEqual(report.subtitleRequiredSceneIds, ["scene-0001", "scene-0002", "scene-0003"]);
assert.deepEqual(report.sceneIdsReferencedByAtLeastOneCue, ["scene-0001", "scene-0002", "scene-0003"]);
assert.equal(report.missingSceneIds.length, 0);
assert.equal(report.orphanSceneIds.length, 0);
assert.equal(report.textMismatchSceneIds.length, 0);
assert.equal(report.qualityOk, true);
```

Delete one cue, duplicate another scene ID and alter one Korean syllable in separate fixtures; each report must fail with exact evidence.

Publish a passing fixture and require returned `subtitleCoverageRevision`, `subtitleCoveragePath` and `subtitleCoverageHash` to equal the current registered `yadam.coverage.subtitle` section. Tamper only the mutable aggregate file/record while leaving that section and every SRT exact, call `publishSubtitles` again, and assert `updateCoverageSection` rebuilds only the aggregate: SRT writes, provider calls, FFmpeg calls and section revision changes are all zero, while the returned section fields and `subtitleSetHash` remain byte-identical. Independently tamper the current subtitle section and require `coverage_section_conflict` or owner rebuild under a genuinely changed subtitle input; an aggregate repair cannot bless it.

- [ ] **Step 3 (4 minutes): Write SRT serialization and parse-roundtrip tests.**

Assert cue numbers start at 1, timestamps use `HH:MM:SS,mmm`, file text is LF-only with one terminal LF, no BOM, and parse-roundtrip retains start/end within 0.001 seconds and exact normalized text. A segment SRT path is `compat/hermes/segment-01/subtitles.srt`. Publish the same dependencies twice and assert the second call verifies/reuses the passed SRT and performs zero writes.

- [ ] **Step 4 (2 minutes): Run and verify the subtitle module is absent.**

Run:

```powershell
node --test test/yadam/subtitle-service.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `subtitle-service.mjs`.

- [ ] **Step 5 (5 minutes): Implement canonical subtitle normalization and splitting.**

Export:

```js
export function normalizeSubtitleCoverageText(value) {
  return String(value).normalize("NFC").replace(/\r\n?/g, "\n").replace(/\s+/gu, "");
}
```

Split on Korean/Latin sentence punctuation, then word boundaries, then `Intl.Segmenter("ko",{granularity:"grapheme"})` only when a unit exceeds 26 graphemes. Preserve every source grapheme; do not summarize, invent or discard text.

- [ ] **Step 6 (5 minutes): Implement bounded duration allocation.**

For scene duration `D`, require at least `ceil(D/8)` chunks and at most `floor(D/0.2)` chunks. Split the longest chunk at its grapheme midpoint until the minimum count is reached; merge the shortest adjacent pair until the maximum count is met. If a nonempty source cannot satisfy the bounds, throw `subtitle_density_unsatisfiable`.

Allocate remaining display time by grapheme weight with lower bound 0.2 and upper bound 8 using iterative water-filling. Insert a `1/24` second display gap by shortening each nonfinal cue only when it remains >=0.2. Keep the final cue end equal to the measured scene end.

- [ ] **Step 7 (5 minutes): Attach exact scene/source evidence and coverage.**

Each cue has one source scene ID in v1 and that scene's source hash. Coverage compares `normalizeSubtitleCoverageText(cue texts joined)` with the same normalization of the canonical scene source. Reject missing, duplicate, orphan, wrong hash, text mismatch, inverted or overlapping cues. Build the coverage section in memory here; its `artifactRefs` are filled only after Step 8 has published and rehashed every segment SRT.

The final call, owned by Step 8, is:

```js
await updateCoverageSection({ jobDir, section: "subtitle", report });
```

Require `sections.subtitle === "pass"`, `sectionArtifact.section === "subtitle"`, a positive revision, a revision-matching path, and a current passed `yadam.coverage.subtitle` record whose path/hash/revision exactly equal the returned section artifact. Re-read the aggregate and require its subtitle binding equals that same record before render-manifest finalization; `complete` may remain false until Plan 04 publishes visual coverage. If only aggregate bytes/record are stale and this exact current subtitle section remains valid, call the same update once to rebuild the aggregate provider-free and retain the section revision.

- [ ] **Step 8 (4 minutes): Implement atomic per-segment SRT writes.**

Group cues by segment, subtract the segment cumulative start for local SRT timing, and serialize. Call `ensureContainedVideoDirectory(jobDir,"compat/hermes/{segmentId}")` before the first SRT write. Reuse an existing SRT only when `canReuseArtifact`, exact script/audio/serializer dependency hashes, file hash and parse/semantic gates all pass. Otherwise use `writeUtf8Atomic` at `compat/hermes/{segmentId}/subtitles.srt`. Reparse every written/reused SRT, rerun 0.2–8.0, overlap and end-delta gates, and register its pass artifact. Fill the in-memory coverage report with the sorted SRT path/hash refs, call `updateCoverageSection` once, verify/re-read both returned aggregate and current section records, compute `subtitleSetHash` from `subtitleCoverageHash` plus canonical segments/cues, and implement the exact hash-verifying loader before returning. An aggregate-only repair must reach this same return without rewriting an SRT or advancing `subtitleCoverageRevision`.

- [ ] **Step 9 (3 minutes): Run subtitle tests.**

Run `node --test test/yadam/subtitle-service.test.mjs`.

Expected: splitting, bounded timing, exact Korean coverage, section revision/path/hash, aggregate-only provider-free reuse, tamper evidence, serialization and segment-local offset tests pass.

- [ ] **Step 10 (2 minutes): Record the subtitle commit.**

Run `git status --short`. In Git, stage Task 2 files and run:

```powershell
git commit -m "feat(yadam): build source-covered measured subtitles"
```

---

## Task 3: Finalize the production render manifest from passed handoffs

**Files:**
- Use: `scripts/lib/yadam/video-layout.mjs`
- Create: `scripts/lib/yadam/render-manifest.mjs`
- Modify: `test/yadam/video-contract.test.mjs`

**Interfaces:**
- Consumes: `loadPassedAudioHandoff`, `loadPassedImageHandoff`, `loadPassedSubtitleHandoff`, current approval/artifact manifest.
- Produces: `finalizeRenderManifest({jobDir})`, `loadVerifiedRenderManifest(jobDir)`.

- [ ] **Step 1 (5 minutes): Write the passing M≠N join test.**

Use six audio scenes and three visual slots. Image handoff order must be deliberately shuffled. Assert the finalizer joins by `visualSlotId`, preserves each slot's `sourceSceneIds` and `primarySceneId`, binds the correct PNG hash, and keeps all six audio rows in measured order.

- [ ] **Step 2 (5 minutes): Write cross-handoff mismatch tests.**

Reject image slot missing/duplicate/orphan IDs, time difference >0.01, image QA status other than pass, render plan hash mismatch, visual QA hash mismatch, audio/image manifest file tamper, thumbnail/QA tamper, invalid current approval, and a visual slot whose source scene does not exist.

- [ ] **Step 3 (4 minutes): Write continuity and intro ownership tests.**

Assert first visual start <=0.01, adjacent gap/overlap <=0.01, duration arithmetic <=0.01, last end/audio <=0.05, every audio interval overlaps at least one visual slot, and all intro IDs belong to segment 1. Test every boundary at pass and fail values.

- [ ] **Step 4 (3 minutes): Write manifest immutability tests.**

After finalization, mutate one consumed image and assert `loadVerifiedRenderManifest` throws `render_manifest_dependency_changed`; restore it and mutate one subtitle hash or the current subtitle coverage section with the same result. Tamper only `script/coverage-report.json` while leaving all four section records exact, call finalization through the subtitle owner preparation path, and assert provider-free aggregate repair followed by byte-identical render-manifest reuse. Call finalization again with identical dependencies and assert zero render-manifest write and no FFmpeg call. Separately call Plan 01's exclusive primitive against the occupied path with different bytes and assert `immutable_target_exists`. For a stale publication, assert the service records its old hash/invalidation cause under `quarantine/video/publications/`, removes no unrelated path, then publishes the replacement exclusively.

- [ ] **Step 5 (2 minutes): Run and verify the finalizer is missing.**

Run `node --test test/yadam/video-contract.test.mjs`.

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `render-manifest.mjs`.

- [ ] **Step 6 (5 minutes): Implement verified handoff loading and ID maps.**

Call the two upstream public handoff loaders and the internal passed-subtitle loader. Rehash each handoff manifest and each referenced asset; require passed artifact registry rows/dependencies plus exact current `yadam.coverage.audio`, `yadam.coverage.visual`, and `yadam.coverage.subtitle` records. Require the subtitle loader's revision/path/hash to equal the current subtitle record and require the current aggregate has `complete:true`, all four sections `pass`, and bindings equal the four current section records. The aggregate is validation evidence, not a render-manifest hash dependency; aggregate-only staleness must already have been repaired by the subtitle owner. Build maps with duplicate detection. Never fall back to basename, array position or nearest time.

- [ ] **Step 7 (5 minutes): Construct the exact render manifest.**

Include:

```js
{
  schemaVersion: "1.0.0",
  profileId: "yadam",
  jobId,
  approvalRevisionPath,
  width: 1920,
  height: 1080,
  fps: 24,
  audioTempoFactor: 1,
  plannedDurationSeconds,
  measuredAudioSeconds,
  renderDurationSeconds: measuredAudioSeconds,
  script,
  dependencies,
  coverage: {
    audio: { path: audioCoveragePath, sha256: audioCoverageHash, revision: audioCoverageRevision },
    visual: { path: visualCoveragePath, sha256: visualCoverageHash, revision: visualCoverageRevision },
    subtitle: { path: subtitleCoveragePath, sha256: subtitleCoverageHash, revision: subtitleCoverageRevision },
  },
  subtitleSetHash,
  scenes,
  visualSlots,
  subtitleCues,
  segments,
  introSceneIds,
  introVisualSlotIds,
  thumbnail,
}
```

`visualSlots` merge canonical Plan 03 mapping/timing with Plan 04 PNG/provenance by ID. `segments` use measured boundaries, not forced 600-second cuts. `subtitleSetHash` must recompute as `hashCanonical({subtitleCoverageHash,segments:subtitleHandoff.segments,cues:subtitleHandoff.cues})`; aggregate coverage hash is deliberately absent.

- [ ] **Step 8 (4 minutes): Validate, exclusively publish and register.**

Run schema and semantic gates. If an existing passed render manifest has the exact candidate/dependency hash, return it unchanged. Otherwise, if an existing publication is stale, call `ensureContainedVideoDirectory(jobDir,"quarantine/video/publications")` and quarantine it under the locked rule in the Plan 01 interface section. Publish the absent `render-manifest.json` through `writeCanonicalJsonExclusive` and register logical role `yadam.render.manifest` with dependencies on approval, final/script scenes, audio manifest/timeline/render-plan-input, render plan, image manifest, visual QA, the exact audio/visual/subtitle section hashes, subtitle set, thumbnail and thumbnail QA hashes; never include mutable aggregate hash and never call replacing `writeCanonicalJson` on this path.

- [ ] **Step 9 (4 minutes): Implement verified reload.**

`loadVerifiedRenderManifest` rehashes the manifest and every dependency, verifies current artifact registry rows/gates, requires its three section bindings remain current, separately verifies the aggregate binds those sections, reruns timeline/coverage semantics, and returns the parsed value plus manifest path/hash. It never repairs or rewrites a changed manifest or aggregate.

- [ ] **Step 10 (3 minutes): Run render-manifest tests.**

Run `node --test test/yadam/video-contract.test.mjs`.

Expected: shuffled M≠N join passes; every mismatch/tamper/continuity/intro case fails before FFmpeg.

- [ ] **Step 11 (2 minutes): Record the render-manifest commit.**

Run `git status --short`. In Git, stage Task 3 files and run:

```powershell
git commit -m "feat(yadam): finalize hash-locked render manifests"
```

---

## Task 4: Generate exact Hermes compatibility artifacts for N audio and M visuals

**Files:**
- Create: `scripts/lib/yadam/hermes-compat.mjs`
- Create: `test/yadam/hermes-compat.test.mjs`

**Interfaces:**
- Consumes: verified render manifest.
- Produces: `buildHermesCompatibility({jobDir,renderManifest})` and exact per-segment compatibility files.

- [ ] **Step 1 (5 minutes): Write a six-audio/three-visual failing fixture.**

Put two visual slots over multiple short scenes and split one long scene across two slots. Assert segment scene-plan count 6, keyframe/timeline count 3, source IDs are preserved, and each `narration_refs` array contains all and only temporally intersecting segment-local audio orders.

- [ ] **Step 2 (4 minutes): Write independent ordering tests.**

Shuffle canonical audio and visual arrays. Assert compatibility audio `order` is continuous 1..N by measured start and visual `visualOrder` is continuous 1..M by start. Assert keyframe and visual-timeline rows at each index have the same `visualSlotId` after sorting.

- [ ] **Step 3 (4 minutes): Write filename and copy-integrity tests.**

Generate 101 synthetic audio rows and assert names `voice_01.wav`, `voice_99.wav`, `voice_100.wav`, `voice_101.wav`. Copy one PNG and WAV, tamper the destination, and assert the adapter rejects hash mismatch rather than leaving the copy.

- [ ] **Step 4 (4 minutes): Write mapping failure tests.**

Reject missing source scene, primary not in sources, slot crossing a segment boundary, keyframe count mismatch, duplicated `visualOrder`, unreferenced audio scene, and output path escaping the compatibility root.

- [ ] **Step 5 (2 minutes): Run and confirm the adapter is missing.**

Run:

```powershell
node --test test/yadam/hermes-compat.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `hermes-compat.mjs`.

- [ ] **Step 6 (4 minutes): Implement segment-local audio projection.**

For each segment, select canonical scenes, sort by global start, assign local order, subtract segment start from timing, and emit:

```js
{
  order: localOrder,
  scene_id: scene.sceneId,
  narration: scene.sourceText,
  video_prompt: firstIntersectingVisual.compatibilityPrompt,
  duration_seconds: scene.durationSeconds,
}
```

Require orders continuous and local duration sum within 0.05 seconds of segment measured duration.

- [ ] **Step 7 (5 minutes): Implement visual/keyframe projection by ID.**

Sort segment slots by start, assign `visualOrder`, calculate `narration_refs` from half-open time intersection, and write keyframe rows with:

```js
{
  visualOrder,
  visualSlotId,
  output_path: `keyframes/visual_${String(visualOrder).padStart(3, "0")}.png`,
  narration_refs,
  prompt: slot.compatibilityPrompt,
  image_sha256: slot.imageSha256,
}
```

Read the already size-bounded passed PNG, verify its source hash, and copy it to that relative path with Plan 01 `writeBinaryAtomic`; require the returned hash to equal `image_sha256`. Do not implement another binary copy helper or use a source image twice unless the render manifest explicitly represents an extended hold in the same visual slot.

- [ ] **Step 8 (5 minutes): Implement the exact visual timeline.**

Subtract segment start and emit rows with `order`, `visualOrder`, `visualSlotId`, `sourceSceneIds`, `primarySceneId`, `startSeconds`, `endSeconds`, `durationSeconds`, `timingBand`, `extendedHold`, `holdReason`. Root fields are:

```js
{
  schemaVersion: "1.0.0",
  profileId: "yadam",
  segmentId,
  plannedDurationSeconds,
  measuredAudioSeconds,
  renderDurationSeconds: measuredAudioSeconds,
  durationSeconds: measuredAudioSeconds,
  scenes,
}
```

Write the canonical compatibility timeline at `segments/{segmentId}/visual-timeline.json`.

- [ ] **Step 9 (4 minutes): Copy normalized voice assets and verify the source SRT.**

Stream each canonical normalized WAV to `compat/hermes/{segmentId}/voice/voice_{paddedOrder}.part.wav`, flush/sync, rehash against the source and atomically rename it to the absent canonical `voice_{paddedOrder}.wav`. Quarantine a stale part or mismatched prior canonical copy before retry; never write the canonical WAV path directly. Task 2 already owns canonical `compat/hermes/{segmentId}/subtitles.srt`; rehash and reparse that exact file, require its registered subtitle dependency, and do not rewrite or self-copy it. Provider raw audio is never copied.

- [ ] **Step 10 (4 minutes): Write and validate sceneplan/keyframe manifests.**

Write `compat/hermes/{segmentId}/sceneplan.json` and `keyframes/manifest.json`, run the closed schema plus count/order/ID-pair/source-hash semantic gates, and register each compatibility artifact with `logicalRole` beginning `yadam.compat.hermes.` and dependencies on render manifest plus source asset hashes.

- [ ] **Step 11 (3 minutes): Run compatibility tests.**

Run `node --test test/yadam/hermes-compat.test.mjs`.

Expected: N≠M, split/merged coverage, independent order, voice 100+, hash copy and all failure cases pass.

- [ ] **Step 12 (2 minutes): Record the compatibility commit.**

Run `git status --short`. In Git, stage Task 4 files and run:

```powershell
git commit -m "feat(yadam): project canonical assets for Hermes assembly"
```

---

## Task 5: Patch the existing assembler for exact timeline, color and frame boundaries

**Files:**
- Create: `scripts/lib/yadam/exact-video-policy.mjs`
- Modify: `scripts/assemble_cain_fast_from_hermes_job.mjs`
- Modify: `scripts/lib/kenburns-motion.mjs`
- Create: `test/yadam/exact-assembler.test.mjs`

**Interfaces:**
- Consumes: Task 4 compatibility paths and the current assembler CLI.
- Produces: yadam-aware exact motion clips and boundary-rich `assembly-report.json`; legacy behavior remains the default.

- [ ] **Step 1 (5 minutes): Write parser and invocation policy tests.**

Assert `--preserve-color` sets `preserveColor:true`; no flag leaves false. For profile yadam, require an existing `visual-timeline.json`, final name `final.mp4`, preserve audio tempo, motion FPS 24 and preserve color. Assert a missing timeline throws `yadam_visual_timeline_required`, while `--allow-fast-audio` or `--max-audio-tempo 1.1` throws `forbidden_yadam_audio_option`.

- [ ] **Step 2 (5 minutes): Write exact timeline boundary tests.**

At 24 FPS, use boundaries 0, 5.03, 10.11, 18.42. Assert frame windows use rounded global frames, every actual boundary differs by <=1/24 second, frame counts are positive, timeline scale is 1, and last end/audio differences 0.05 and 0.051 respectively pass and fail. Independently reject unsorted slots, first start outside 0.01, adjacent gap/overlap above 0.01, nonpositive spans and `abs(durationSeconds-(endSeconds-startSeconds))>0.01`.

- [ ] **Step 3 (4 minutes): Write no-rescale/no-atempo tests.**

Given measured audio 18.42 and last visual end 18.42, assert groups retain exact manifest start/end/duration and narration copy path is used without `atempo`. Spy on filter construction and assert no audio filter contains `atempo`. Assert `Math.ceil` is not applied to the yadam end.

- [ ] **Step 4 (4 minutes): Write color and legacy regression tests.**

Assert yadam calls `buildKenBurnsFilter` with `forceMonochrome:false`; legacy calls it with true. Snapshot legacy parse defaults, fixed-grid `Math.ceil` behavior, existing 0.92–1.18 preview tempo guard and `hue=s=0` filter so the yadam branch cannot change them.

- [ ] **Step 5 (4 minutes): Write visualSlotId, keyframe, subtitle and report tests.**

Reject keyframe/timeline count inequality in both directions, any index ID mismatch, missing/escaping keyframe path and PNG hash mismatch against `image_sha256`. Return an empty source SRT and an empty scene-derived cue set separately; both must throw `yadam_subtitles_empty` before last-cue or `Math.max` arithmetic. Assert each `assembly-report.json.visualGroups` row contains `visualSlotId`, manifest start/end/duration, actual frame start/end/duration, frame count, `timelineScale:1`, image hash, motion, color mode and clip filename.

- [ ] **Step 6 (2 minutes): Run and verify the pure policy module is absent.**

Run:

```powershell
node --test test/yadam/exact-assembler.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `exact-video-policy.mjs`.

- [ ] **Step 7 (5 minutes): Implement pure yadam policy guards.**

Create exports `isYadamTimeline`, `assertYadamAssemblerOptions`, `assertExactTimelineEnd`, `assertTimelineContinuity`, `buildFrameWindows`, `assertVisualKeyframePairs`. `buildFrameWindows` uses:

```js
const startFrame = Math.round(slot.startSeconds * fps);
const endFrame = Math.round(slot.endSeconds * fps);
const frameCount = endFrame - startFrame;
```

It returns actual seconds from frames and rejects `frameCount < 1` or boundary difference >`1/fps`.

- [ ] **Step 8 (4 minutes): Add `--preserve-color` and exact ID pair loading.**

Modify the existing parser, `loadVisualTimeline` and yadam preflight only. The loader must retain closed root fields `schemaVersion`, `profileId`, `segmentId`, `plannedDurationSeconds`, `measuredAudioSeconds`, `renderDurationSeconds`, `durationSeconds` and `scenes` instead of returning only path/scenes. Detect yadam from the requested job/profile contract before group construction, require `visualTimeline.profileId === "yadam"`, run continuity/end guards, and require keyframe length exactly equal timeline length plus per-index `visualSlotId` equality. Resolve every `output_path` inside the compatibility job root, require the file, rehash it against `image_sha256`, and do all of this before launching FFmpeg. Keep current `findKeyframe`, fixed-grid and prompt/first-image/circular fallback reachable only for non-yadam legacy input.

- [ ] **Step 9 (5 minutes): Add exact frame-count support to Ken Burns.**

Extend `buildKenBurnsFilter` with optional `frameCount:null`. When a positive integer is supplied, use it as `frames`; otherwise preserve `round(durationSeconds*fps)`. In yadam `renderMotionClip`, pass the pure policy frame count, target only `{clipBase}.part.mp4`, use FFmpeg `-frames:v String(frameCount)` instead of `-t`, flush/probe/hash the part and same-directory rename it only after the frame/duration gate passes; legacy keeps its current `-t` call.

- [ ] **Step 10 (5 minutes): Remove yadam ceiling, global scale and atempo.**

Branch on `isYadamTimeline`. For yadam, take exact `groups.at(-1).end`, compare to raw narration duration with 0.05 tolerance, set target media to raw narration duration, set every `timelineScale:1`, stream `narration-raw.wav` to `narration.part.wav`, flush/probe/hash and atomically rename it to `narration.wav`, and set `audioTempoFactor=1`, `subtitleScale=1`. Require at least one parsed canonical subtitle cue before computing end values, preserve its 0.2–8.0 second validated timing without re-splitting, and publish the output `subtitles.srt` through Plan 01 `writeUtf8Atomic`. Leave the old rescale/atempo, direct subtitle write and scene-derived subtitle fallback code reachable only for legacy.

- [ ] **Step 11 (3 minutes): Preserve color at the existing call site.**

Change the existing argument to exactly:

```js
forceMonochrome: !options.preserveColor,
```

Do not remove `hue=s=0` from `kenburns-motion.mjs`; it remains required for legacy when `forceMonochrome` is true.

- [ ] **Step 12 (5 minutes): Probe the final stream and exclusively publish the assembly report.**

Probe each motion clip, record global frame-derived actual start/end, actual duration and requested manifest boundary. In yadam, make FFmpeg write `final.part.mp4`, flush/sync it, probe and require H.264, yuv420p, 1920×1080, exactly 24 FPS, AAC and 48 kHz, then same-directory rename it to `final.mp4`; never target the canonical name from FFmpeg. Add root `profileId`, `measuredAudioSeconds`, `timelineScale`, `preserveColor`, `audioTempoFactor`, final stream evidence and exact invocation options; keep existing motion/zoom fields. Validate and publish `manual-assembly/assembly-report.json` with Plan 01 `writeCanonicalJsonExclusive`; legacy retains its existing direct write. The façade quarantines any prior manual-assembly directory before a yadam retry, so an existing report is `immutable_target_exists`, never overwritten.

- [ ] **Step 13 (4 minutes): Run exact and legacy assembler tests.**

Run `node --test test/yadam/exact-assembler.test.mjs`.

Expected: yadam parser, forbidden options, exact boundaries, no rescale/atempo, color and report tests pass; legacy snapshots pass unchanged.

- [ ] **Step 14 (2 minutes): Record the existing-assembler patch commit.**

Run `git status --short`. In Git, stage only the exact Task 5 paths and run:

```powershell
git commit -m "feat(yadam): preserve exact color audio timelines in assembler"
```

---

## Task 6: Implement color inspection and numeric segment strict QA

**Files:**
- Create: `scripts/lib/yadam/color-ratio.mjs`
- Create: `scripts/lib/yadam/video-qa.mjs`
- Modify: `scripts/check_audio_speed_profile.mjs`
- Modify: `scripts/check_subtitle_render_quality.mjs`
- Modify: `scripts/check_motion_manifest.mjs`
- Modify: `scripts/validate_segmented_export.py`
- Create: `test/yadam/video-qa.test.mjs`
- Create: `test/yadam/fixtures/video/make-media.mjs`

**Interfaces:**
- Consumes: render manifest, assembly report, Plan 04 visual QA, segment MP4/SRT/motion clips, FFmpeg/ffprobe.
- Produces: `measureColorPixelRatio`, `runSegmentStrictQa`, yadam strict branches in existing validators.

- [ ] **Step 1 (5 minutes): Generate deterministic color and grayscale fixtures.**

Use FFmpeg lavfi through `execFile` to generate a saturated 1024×576 PNG, grayscale PNG, 24 FPS 1920×1080 motion clips, 48 kHz mono PCM and 30-second H.264/AAC MP4. Keep all outputs under `test/yadam/tmp/video-qa`; no network/provider call is allowed.

- [ ] **Step 2 (4 minutes): Write source and clip color-ratio boundary tests.**

Assert only pixels with alpha >=250 enter the denominator and those with `max(R,G,B)-min(R,G,B)>=12` enter the color numerator. Source ratios 0.10 and 0.099 pass/fail. For source ratio 0.20, clip ratios 0.10 and 0.099 pass/fail; for source 0.06, the clip minimum is 0.05.

- [ ] **Step 3 (5 minutes): Write exact segment threshold tests.**

Test both sides of every threshold:

- final/audio delta 0.25 pass, 0.251 fail;
- motion clip delta `max(0.75,planned*0.03)` pass at equality and fail at +0.001;
- tempo factor 0.999 and 1.001 pass, 1.0011 fail;
- cue duration 0.2 and 8.0 pass, 0.199 and 8.001 fail;
- audio/subtitle end 0.5 pass, 0.501 fail;
- video/subtitle end 0.75 pass, 0.751 fail;
- timeline start/gap/duration 0.01 pass, 0.011 fail;
- timeline end/audio 0.05 pass, 0.051 fail;
- manifest/actual boundary `1/24` pass, `1/24+0.001` fail.

- [ ] **Step 4 (4 minutes): Write black/decode/profile and warning tests.**

Mock blackdetect intervals and assert black duration 0.5 inside the protected middle fails while first/last 0.25-only intervals are ignored. Assert FFmpeg decode nonzero or parse error fails. Assert exact H.264/yuv420p/1920×1080/24 FPS/AAC/48 kHz profile passes and one-field drift fails. Any unresolved warning must set `qualityOk:false`.

- [ ] **Step 5 (4 minutes): Write color-style and final-segment sample tests.**

Assert every source image has Plan 04 `colorStyleMatch>=7`, source ratio >=0.10, motion midpoint threshold pass, and the corresponding final segment slot-midpoint sample threshold pass. Test vision 6.99, one grayscale clip and one monochrome final sample as independent failures.

- [ ] **Step 6 (2 minutes): Run and verify QA modules are absent.**

Run:

```powershell
node --test test/yadam/video-qa.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `color-ratio.mjs` or `video-qa.mjs`.

- [ ] **Step 7 (5 minutes): Implement RGBA extraction and ratio calculation.**

Spawn FFmpeg with optional `-ss`, one video frame, `-vf format=rgba`, `-f rawvideo`, `pipe:1`; cap stdout at 64 MiB. Iterate four-byte pixels, count only alpha >=250 pixels as opaque, count their colorful subset with channel range >=12, and return `{opaquePixels,colorPixels,ratio:colorPixels/opaquePixels}`. Require at least one opaque pixel.

- [ ] **Step 8 (5 minutes): Implement media probes, decode and blackdetect.**

Use ffprobe JSON for streams/durations. Decode with FFmpeg `-v error -i input -f null -` and require exit 0. Run `blackdetect=d=0.5:pix_th=0.10`, parse every interval, clip it to `[0.25,duration-0.25]`, and fail any clipped interval duration >=0.5.

- [ ] **Step 9 (5 minutes): Implement the required check registry.**

`runSegmentStrictQa` creates named checks for input hashes, stream profile, exact timeline, frame boundaries, tempo, segment/audio duration, motion duration/variety, decode, black intervals, source/motion/final color, vision color style, subtitle structure/coverage/end deltas and intro ownership. Each check has exact actual/limit/evidence and status pass/fail; summary derives mechanically from all required checks.

- [ ] **Step 10 (4 minutes): Exclusively write and register segment QA.**

Validate schema/semantics, then publish `segments/{segmentId}/manual-assembly/segment-qa-report.json` with `writeCanonicalJsonExclusive`. Register only pass reports. A failed report is still exclusively written for diagnostics, registered with gate fail and throws `{code:"segment_qa_failed",reportPath}`. Before a retry, move the prior report plus invalidation evidence to its hash-addressed publication quarantine; never replace it in place.

- [ ] **Step 11 (5 minutes): Add profile-aware strict behavior to existing checks.**

- `check_audio_speed_profile.mjs`: when manifest `profileId` is yadam, consume `segmentId`, job-relative contained `dir`, measured/render/final duration fields and require `abs(factor-1)<=0.001`; keep legacy `id`/`durationSeconds` and 0.92–1.18 unchanged.
- `check_subtitle_render_quality.mjs`: fail empty/unparseable SRT, max cue >8, min cue <0.2, overlap/inversion and source-coverage mismatch for yadam.
- `check_motion_manifest.mjs`: for yadam require visualSlotId, manifest/actual boundaries, timelineScale 1 and one-frame error; retain current legacy checks.
- `validate_segmented_export.py`: detect `profileId == "yadam"`, resolve job-relative `segmentId`/`dir`, use measured/render/final duration fields instead of legacy `durationSeconds`, use timingBand `intro` instead of `opening`, apply every Task 6 boundary and make any missing/unparseable report or warning return exit 1; leave current legacy fields, `opening` handling and warn exit 0 behavior unchanged.

- [ ] **Step 12 (4 minutes): Run Node and Python boundary tests.**

Run:

```powershell
node --test test/yadam/video-qa.test.mjs
python scripts\validate_segmented_export.py --export-dir test\yadam\tmp\video-qa\passing-segmented-export
```

Expected: Node tests pass; Python prints `Segmented export validation: pass`. The paired failing fixture returns exit 1 and lists exact numeric evidence.

- [ ] **Step 13 (2 minutes): Record the segment-QA commit.**

Run `git status --short`. In Git, stage only Task 6 paths and run:

```powershell
git commit -m "feat(yadam): enforce color and numeric segment QA"
```

---

## Task 7: Assemble all segments with hash-safe resume and cancellation

**Files:**
- Use: `scripts/lib/yadam/video-layout.mjs`
- Create: `scripts/lib/yadam/video-service.mjs`
- Create: `test/yadam/video-service.test.mjs`
- Create: `test/yadam/fixtures/video/fake-assembler.mjs`

**Interfaces:**
- Consumes: Tasks 2–6, current existing assembler path, Plan 01 state/artifact reuse.
- Produces: public `assembleAllSegments({jobDir,signal})` and passed `segment-manifest.json`.

- [ ] **Step 1 (5 minutes): Write pristine-layout and exact child invocation tests.**

For segment 1 assert the child executable/argv is exactly:

```text
node
scripts/assemble_cain_fast_from_hermes_job.mjs
--job-dir
C:/Users/petbl/auto-video/test/yadam/tmp/video-job/compat/hermes/segment-01
--export-dir
C:/Users/petbl/auto-video/test/yadam/tmp/video-job/segments/segment-01
--final-name
final.mp4
--preserve-audio-tempo
--motion-fps
24
--preserve-color
```

Start from a real pristine Plan 01 fixture where `final/incidents`, `logs/video`, `quarantine/video`, and `quarantine/video/publications` are absent. Assert the first nonterminal façade call creates all four contained directories before any artifact/child and then uses `shell:false`, `windowsHide:true`, no forbidden audio option and no alternate assembler filename. In separate fresh fixtures, place a regular file or Windows junction/symlink escape at each target or one intermediate component; snapshot the tree and assert `video_layout_unsafe`, zero new sibling directories, zero artifact/state writes and zero child calls. Also reject a race fixture whose component becomes a junction between mkdir and post-create verification.

- [ ] **Step 2 (5 minutes): Write segment resume tests.**

Use three segments. First run passes segments 1–2 and fails 3. Second run must skip 1–2 only when render manifest hash, compatibility hashes, final MP4 hash and QA hash/status all match; it reruns 3 once. Independently build the exact 13-role input projection locked above and the dynamic output projection containing current `yadam.coverage.subtitle`, render/segment manifests and every segment video/QA, with opaque inputs exactly `{profileHash,ffmpegVersionHash,assemblerPolicyHash,qaPolicyHash}`. The initial fixture begins with pending subtitle r001; only after `publishSubtitles` returns passed r002 may the service resolve `subtitleCoveragePath` and build output evidence. Shuffle registry record order and opaque-key insertion order and assert stable inputHash/outputHash/sorted paths; mutate each pin independently and assert `inputHash` changes, and reject a missing/extra pin or non-lowercase-64-hex value before hashing. A third identical call performs zero children and keeps exactly one exact `SEGMENTS_PASSED` event for the same input hash. Then corrupt only the derived aggregate: assert one provider-free aggregate rebuild, unchanged subtitle r002/path/hash and exact success-row reuse with zero assembler/QA/state calls. Tamper segment 2 final file and assert only 2 reruns; the deterministic rebuild must restore the same output evidence and reuse the row. Seed the same stage/input with a different output hash or path and require `success_evidence_conflict` with no second event.

- [ ] **Step 3 (5 minutes): Write cancellation tests.**

Abort before first segment, during fake assembler and between segments. Assert new child counts 0, 1 and 1 respectively; state records cancel requested, owned child receives graceful termination then 5-second process-tree kill if needed, partial `manual-assembly` moves to the absent path `quarantine/video/{segmentId}-{renderManifestHashPrefix}-attempt-{attempt}`, and no segment pass record is created.

- [ ] **Step 4 (4 minutes): Write manifest-change-during-assembly test.**

Mutate one image after child start but before QA. Assert the service rehashes dependencies after child exit, discards/quarantines output, invalidates render manifest and segment descendants, and never runs segment QA as pass.

- [ ] **Step 5 (4 minutes): Write segment-manifest cumulative duration tests.**

Assert each row records planned/measured/render/final, `dir`, final/QA paths+hashes and cumulative start/end. The next start equals prior end; final cumulative end equals sum of probed segment final durations. Intro IDs occur only in the first row.

- [ ] **Step 6 (2 minutes): Run and verify the façade implementation is incomplete.**

Run:

```powershell
node --test test/yadam/video-service.test.mjs
```

Expected: FAIL because `assembleAllSegments` is absent or incomplete.

- [ ] **Step 7 (5 minutes): Implement start-of-run canonical preparation.**

Validate current job/profile/approval, then call `ensureVideoJobLayout` before any Plan 05 mutation. Load the passed audio handoff, call `publishSubtitles`, and only after its returned current subtitle section is passed resolve/re-load it through `loadPassedSubtitleHandoff`; never precompute the pending revision path seen at stage entry. Call `finalizeRenderManifest`, generate/reuse compatibility artifacts, re-load the verified render manifest and all prospective success inputs/outputs, and derive the four current pins. If exactly one `SEGMENTS_PASSED` row already matches the now-current 13 inputs, dynamic subtitle coverage plus all other outputs, return only after full row/artifact/aggregate re-verification with no transition or child; this is the aggregate-only repair exact-reuse path. With zero same-input rows, transition to stage `ASSEMBLING_SEGMENTS`, state `running` and continue. Any duplicate/conflicting row fails before a child. Check cancellation before every file publication and child start.

- [ ] **Step 8 (5 minutes): Implement owned assembler execution.**

Before each child, call `ensureContainedVideoDirectory` for `segments/{segmentId}`, `segments/{segmentId}/manual-assembly`, and `logs/video/{segmentId}`; the assembler never creates an unchecked parent. Spawn `process.execPath` with the exact Step 1 args, piped stdout/stderr logs inside `logs/video/{segmentId}`, `shell:false`, hidden window. Cap each log at 8 MiB. On abort, terminate the owned tree using the same graceful/5-second policy as Plan 03 and create the hash-addressed `quarantine/video/{segmentId}-{renderManifestHashPrefix}-attempt-{attempt}` only through the same contained helper before moving output.

- [ ] **Step 9 (5 minutes): Implement per-segment checkpoint and reuse validation.**

Write `segments/{segmentId}/render-checkpoint.json` before/after child and QA with render manifest hash, compatibility artifact hashes, attempt, status, child log paths, final/QA paths+hashes. Reuse only when `canReuseArtifact` passes for both video and QA and every checkpoint input hash matches.

- [ ] **Step 10 (5 minutes): Run segment strict QA and register passed output.**

After child exit 0, rehash render dependencies, invoke `runSegmentStrictQa`, require pass, hash final MP4/report and register logical roles `yadam.video.segment.{segmentId}` and `yadam.qa.segment.{segmentId}`. Failure stops later segments and returns no public partial result.

- [ ] **Step 11 (5 minutes): Exclusively publish the exact segment manifest.**

After all segment pass records exist, build cumulative rows and validate schema/intro ownership. Reuse an existing passed `segment-manifest.json` only when its complete candidate/dependency hash matches. Otherwise quarantine an invalidated prior publication, publish the absent path with `writeCanonicalJsonExclusive`, and register `yadam.segment.manifest` with dependencies on render manifest plus every segment video/QA hash and current subtitle-section hash. Re-load the exact 13 upstream input-role records, the current passed `yadam.coverage.subtitle`, render/segment manifests and every returned video/QA record/hash; exclude mutable `yadam.coverage.report` from both helper arrays but separately reverify that it binds the current four sections. Derive the four current pins, call the locked `buildSuccessEvidence("SEGMENTS_PASSED",inputRecords,outputRecords,{profileHash,ffmpegVersionHash,assemblerPolicyHash,qaPolicyHash})`, append or reuse exactly its `{stage:"SEGMENTS_PASSED",to:"running",inputHash,outputHash,artifactPaths}` row, re-read state history, then return the locked `segments_passed` shape with job-relative slash-normalized paths.

- [ ] **Step 12 (4 minutes): Run resume, cancellation and tamper tests.**

Run `node --test test/yadam/video-service.test.mjs`.

Expected: pristine-layout safety, dynamic subtitle-section evidence, aggregate-only exact reuse, exact invocation, minimal rerun, three cancellation timings, dependency mutation and cumulative segment-manifest tests pass with exact child call counts.

- [ ] **Step 13 (2 minutes): Record the segment service commit.**

Run `git status --short`. In Git, stage Task 7 files and run:

```powershell
git commit -m "feat(yadam): assemble resumable strict video segments"
```

---

## Task 8: Harden concat-copy and publish final strict release artifacts

**Files:**
- Read: `schemas/yadam/completed-artifact-incident.schema.json`
- Modify: `scripts/concat_segments.mjs`
- Modify: `scripts/lib/yadam/video-qa.mjs`
- Modify: `scripts/lib/yadam/video-service.mjs`
- Modify: `test/yadam/video-service.test.mjs`
- Modify: `test/yadam/video-qa.test.mjs`

**Interfaces:**
- Consumes: passed segment manifest, exact stream profiles, segment SRTs, Plan 04 thumbnail.
- Produces: public `publishFinalVideo`, `loadFinalQa`, final MP4/upload SRT/thumbnail/strict report.

- [ ] **Step 1 (5 minutes): Write concat containment and precondition tests.**

Assert a direct nonterminal `publishFinalVideo` call against a pristine Plan 01 layout runs the same static-directory initializer before its first attempt write. Then require the passed registered segment manifest, its complete render/video/QA dependency closure, current approval and the matching exactly-once `SEGMENTS_PASSED` row with canonical inputHash/outputHash/path set; a missing/stale/non-pass/mismatched event, unsafe layout or cancellation makes zero concat calls. Assert yadam concat requires every manifest `dir` to be job-relative, resolves it against `exportDir`, applies Plan 01 real-path containment to the directory, MP4 and SRT, and refuses an absolute/escaping path, missing segment MP4, missing SRT, unparseable SRT, empty cue set, subtitle timing warning and one-field stream profile mismatch before running FFmpeg. A valid fixture must invoke concat demuxer with `-c copy` exactly once. Seed unrelated root-level SRT files and assert yadam mode neither deletes nor rewrites them.

- [ ] **Step 2 (5 minutes): Write subtitle offset and final-delta tests.**

Merge three local SRTs using probed segment final durations. Assert cue numbering is continuous, segment 2 first cue is offset by segment 1 final duration, no overlap occurs, and final upload SRT is only `final/upload-subtitles/final-full.upload.srt`. Test final/sum delta at `max(0.5,2*segmentCount/24)` and +0.001.

- [ ] **Step 3 (4 minutes): Write overall target and final artifact tests.**

For a 10-minute target assert 480 and 720 seconds pass, 479.999 and 720.001 fail. Assert final thumbnail bytes/hash exactly equal Plan 04 passed thumbnail. Assert final video, upload SRT, thumbnail and QA paths match the canonical table.

- [ ] **Step 4 (4 minutes): Write final strict summary and resume tests.**

One failed segment QA, concat warning, final decode error, SRT cue count 0 or final duration failure must yield `qualityOk:false`, `finalVerdict:"fail"` and no `FINAL_QA_PASSED`/completed transition. Simulate a crash after only the staged MP4 was promoted while the state is still nonterminal; resume must quarantine that partial pre-completion set and republish from verified segment artifacts without rerunning segment assembly. Independently recompute the one-input/six-output evidence from shuffled records and opaque inputs exactly `{profileHash,ffmpegVersionHash,assemblerPolicyHash,qaPolicyHash}`; require the exact six sorted paths, insertion-order stability, a changed `inputHash` when any one pin changes, and rejection of missing/extra/invalid pins. A second call after a fully verified completed artifact set must perform zero concat/copy/promotion calls and keep one exact event for the same input hash.

Then snapshot state, success history, existing registry records and all canonical final bytes. In separate fixtures, delete or tamper each of the six completed output artifacts, including `final/final-full.mp4`; `publishFinalVideo` must perform zero FFmpeg, concat, copy, quarantine, promotion or state-transition work, append/reuse only one immutable `yadam.incident.completed_artifact_tampered` gate-fail record, and throw `{code:"completed_artifact_tampered",reportPath:"final/incidents/completed-artifact-tampered-{incidentKeyHash}.json"}`. The report must identify the exact expected and observed set, and every preexisting snapshot must remain unchanged. A repeated call with the same observation reuses the same report/record. Restoring a trusted byte-identical backup whose hashes equal the original completed event makes the original completed result readable again with no new success row; any nonidentical rebuild is forbidden and requires a new job. Change the current FFmpeg version output, profile file or policy file after completion and assert the old job still verifies from the four completion-time pins persisted in the final report and all six records. In contrast, disagreement among those persisted pins, the final report's stored inputHash, the terminal event or the exact role/path set fails `completed_evidence_not_verifiable` without falling through to `FINAL_QA`. A seeded same-input/different-output event before completion still fails `success_evidence_conflict`.

- [ ] **Step 5 (2 minutes): Run and confirm current concat behavior fails strict cases.**

Run:

```powershell
node --test test/yadam/video-service.test.mjs test/yadam/video-qa.test.mjs
```

Expected: FAIL because current concat records missing/unparseable SRT without failing and final strict publication is absent.

- [ ] **Step 6 (5 minutes): Add a yadam staging boundary while preserving legacy output.**

In the façade, load/re-read the job and current approval under the job lock. Branch on state before any attempt path, transition or child process. If state is `completed`, require exactly one internally consistent `FINAL_QA_PASSED` row and the exact six role/path records. Extract only the four named opaque dependency values persisted on every one of those records and require all six maps to be byte-for-byte equal. Rebuild the final inputHash/outputHash/path set through Plan 01's shared helper using that completion-time map, not the current host/toolchain. A missing/conflicting event, role/path set or stored record pin map throws `completed_evidence_not_verifiable` and never falls through; current FFmpeg/profile/policy drift is ignored for this terminal read and applies only when creating a new job. Next hash all six canonical bytes. If any byte is missing or mismatched, compute the sorted expected/observed projections and `incidentKeyHash`; only now may the branch verify or create the single contained `final/incidents` directory through the layout primitive, then exclusively publish or verify `final/incidents/completed-artifact-tampered-{incidentKeyHash}.json` with the recovered `completionOpaqueInputs`. Re-read it through its closed schema, register or reuse exactly one gate-fail artifact with `artifactId:"completed-artifact-tampered-{incidentKeyHash}"` and `logicalRole:"yadam.incident.completed_artifact_tampered"`, then throw `{code:"completed_artifact_tampered",reportPath}`. This includes a missing or hash-mismatched final QA report; do not parse an unverified report. If all six hashes match, parse the final report, require its stored pin map/input projection/inputHash to match the completion-time record map and terminal event, re-run the read-only QA consistency check and return the locked completed shape with zero mutation. A semantically contradictory but hash-matching stored report is `completed_evidence_not_verifiable`. The incident directory/file/record append is the tamper branch's only allowed mutation: do not run full layout initialization or alter completed state/history, existing registry records, canonical release bytes, quarantine paths or attempts. If incident publication/registration cannot be verified, throw `completed_artifact_incident_publish_failed` without a fabricated path and still do no render work. Historical incident records do not invalidate a later operator restoration when all six bytes again equal the completed event. Recovery is limited to an operator-supplied trusted byte-identical backup or a new job; `publishFinalVideo` contains no same-job rebuild/restore option.

Only for a nonterminal job, call `ensureVideoJobLayout` before any write, then require the passed `yadam.segment.manifest`, its render-manifest dependency, every segment MP4/QA record and the recomputed exact `SEGMENTS_PASSED` evidence before transitioning to stage `FINAL_QA`, state `running`, or creating an attempt directory. Reject cancellation before every new child/publication. Detect `manifest.profileId === "yadam"`. Add exact parser option `--yadam-staging-dir {absoluteAttemptDir}`, valid only for a yadam manifest, and create/verify the dynamic directory through the shared contained primitive; it must resolve lexically and by real path to `final/.attempt-{segmentManifestHash}/`. All reads remain real-path-contained under the job root. The façade spawns exactly `process.execPath scripts/concat_segments.mjs --export-dir {absoluteJobDir} --final-name final-full.mp4 --yadam-staging-dir {absoluteAttemptDir}` with `shell:false,windowsHide:true`. For yadam, require every segment final/SRT, exact stream parity and zero missing/unparseable/timing warnings before success, write only staged `final-full.mp4`, `concat-list.txt`, upload SRT and `concat-report.json`; use `writeUtf8Atomic` for both text files and `writeCanonicalJsonExclusive` for the report, then exit 0. The façade does not parse mixed FFmpeg/stdout as control data: after child exit it reads the known contained `concat-report.json`, validates its schema and hash, and derives all staging paths from that report. Bypass the current root-level SRT deletion and minimal `final-qa-report.json` writer. Keep current legacy behavior and paths unchanged.

- [ ] **Step 7 (4 minutes): Use actual manifest-verified offsets and copy concat.**

For yadam, resolve each job-relative `segments[].dir` against `exportDir`, recontain its existing real path, reprobe the segment and require duration within 0.001 of `segment-manifest.json.finalDurationSeconds` before merging. Build the concat list with `writeUtf8Atomic` inside the staging directory from those verified `manual-assembly/final.mp4` paths and run:

```text
ffmpeg -y -f concat -safe 0 -i final/.attempt-{segmentManifestHash}/concat-list.txt -c copy final/.attempt-{segmentManifestHash}/final-full.mp4
```

Do not add a re-encode fallback.

- [ ] **Step 8 (5 minutes): Implement final strict checks.**

Aggregate required checks for all segment presence/pass reports, identical streams, concat decode, final/sum delta, target range, upload SRT cue count and missing/unparseable/timing arrays, intro only first segment, and final output paths. Require video/audio stream start times within one video frame of zero, final video/audio stream durations within 0.25 seconds, final video and upload-SRT ends within 0.75 seconds, and upload-SRT end against final audio end within 0.5 seconds. Recheck the final H.264/yuv420p/1920×1080/24 FPS/AAC/48 kHz profile. Reuse segment color/black/decode evidence only after verifying each report hash; run a final decode probe independently.

- [ ] **Step 9 (4 minutes): Stage and verify the release thumbnail.**

Read the already size-bounded Plan 04 `thumbnail/final.png`, verify the passed `yadam.thumbnail.final` source role and handoff hash, and write the attempt-directory thumbnail with Plan 01 `writeBinaryAtomic`; require its returned hash, PNG decode/dimension 1280×720 and thumbnail QA hash verification. Never use a video frame as thumbnail fallback. Build one ordered promotion set for the staged MP4, upload SRT, thumbnail, concat list and schema-validated concat report, with each source hash and locked canonical destination, but do not promote or register any member in this step. Do not register or reuse Plan 04's source role; Step 10 promotes the set under one job lock and registers the thumbnail copy exactly once as `yadam.thumbnail.release`.

- [ ] **Step 10 (5 minutes): Exclusively publish final QA and register all final artifacts.**

Derive the current four-pin map and the one-record final input projection before constructing the report; store their shared-helper `inputHash`, projection and `opaqueInputs` under `successEvidenceInput`. If any required check fails, write an exclusive `final/final-qa-report.json` that names staging evidence/hashes, register only `yadam.qa.final` with gate fail, promote no final media, append no terminal success event and throw `{code:"final_qa_failed",reportPath:"final/final-qa-report.json"}`. A retry first preserves that diagnostic under the hash-addressed publication quarantine rule. If all checks pass, acquire the job lock, revalidate every staged source hash and canonical-target condition, then exclusively promote the ordered set with same-volume hard-link or exclusive-create semantics; `EEXIST` is `immutable_target_exists`, and a stale or partial prior final set must first move to hash-addressed quarantine. Rehash the canonical three media outputs plus concat list/report, validate the pass truth table, and register the internal evidence roles `yadam.video.concat_list` and `yadam.video.concat_report` against the segment-manifest hash. Publish the QA report as the fourth public final artifact with `writeCanonicalJsonExclusive`, and register public roles `yadam.video.final`, `yadam.subtitle.upload`, `yadam.thumbnail.release`, `yadam.qa.final` with segment manifest, render manifest and concat-report dependencies. Every one of these six output records must also carry the exact named opaque dependencies `{profileHash,ffmpegVersionHash,assemblerPolicyHash,qaPolicyHash}` used for this publication. Call `loadFinalQa`, re-read all six output records/hashes, call the locked `buildSuccessEvidence("FINAL_QA_PASSED",[segmentManifestRecord],sixOutputRecords,{profileHash,ffmpegVersionHash,assemblerPolicyHash,qaPolicyHash})`, append or reuse exactly its `{stage:"FINAL_QA_PASSED",to:"completed",inputHash,outputHash,artifactPaths}` row, then re-read completed state and only then return the locked object.

- [ ] **Step 11 (4 minutes): Implement `loadFinalQa`.**

Load state before report contents. When state is nonterminal, read/hash/schema-validate the final QA report, verify its artifact record and all dependency/output hashes, rerun summary truth consistency, and return the locked load shape without starting FFmpeg; a valid failed diagnostic may return `qualityOk:false`, while a tampered report throws `final_qa_not_verifiable`. When state is `completed`, recover and cross-check the completion-time pins from the six artifact records, rebuild the terminal event with those stored pins, then hash all six terminal outputs before parsing the final report. Any missing/hash-mismatched artifact throws `completed_artifact_tampered` and never invokes repair, quarantine, FFmpeg or a state transition. Only after every byte matches may the loader parse/schema-validate the report, require its stored pin/input copy to agree, and rerun summary truth consistency. Never consult current host/toolchain pins on this branch. `loadFinalQa` is read-only, so it includes `reportPath` only if it can find and fully verify the matching registered hash-addressed incident; otherwise the error has no `reportPath`, allowing the status CLI/Plan 06 generic outcome contract to represent a pre-report failure honestly. The mutating full-run producer `publishFinalVideo` owns incident creation and always returns a verified real path for this condition.

- [ ] **Step 12 (4 minutes): Run concat/final tests.**

Run:

```powershell
node --test test/yadam/video-service.test.mjs test/yadam/video-qa.test.mjs
```

Expected: strict SRT/profile checks, offsets, copy concat, duration boundaries, thumbnail hash, fail summary, pre-completion resume, completed fail-closed tamper/incident and trusted-restore tests pass; legacy fixtures remain unchanged.

- [ ] **Step 13 (2 minutes): Record the final publication commit.**

Run `git status --short`. In Git, stage Task 8 files and run:

```powershell
git commit -m "feat(yadam): publish concat-copy video with strict final QA"
```

---

## Task 9: Add CLI, end-to-end synthetic coverage and legacy regression gates

**Files:**
- Create: `scripts/run_yadam_video.mjs`
- Create: `test/yadam/fixtures/video/two-segment-handoff.json`
- Modify: `test/yadam/video-service.test.mjs`
- Modify: `test/yadam/exact-assembler.test.mjs`

**Interfaces:**
- Consumes: the complete Plan 05 façade and all existing script paths.
- Produces: `assemble|publish|status` stage commands, synthetic release proof and the Plan 05 gates consumed by the token-guarded Plan 06 live runner.

- [ ] **Step 1 (4 minutes): Write closed CLI tests.**

Support only:

```text
assemble --job-dir C:/Users/petbl/auto-video/test/yadam/tmp/video-job
publish --job-dir C:/Users/petbl/auto-video/test/yadam/tmp/video-job
status --job-dir C:/Users/petbl/auto-video/test/yadam/tmp/video-job
```

Reject relative/outside paths, duplicate flags, unknown commands and extra arguments. Print one final JSON object. Exit codes are 0 success, 1 strict failure, 2 argument error and 130 cancellation.

- [ ] **Step 2 (5 minutes): Create the two-segment synthetic handoff fixture.**

The fixture has 6 audio scenes, 4 visual slots, intro only in segment 1, exact sourceSceneIds/primarySceneId, passed image/thumbnail QA and different N/M per segment. The media helper creates real color PNG, normalized WAV and deterministic SRT/MP4 assets under a temp job.

- [ ] **Step 3 (5 minutes): Write full synthetic `assemble` then `publish` test.**

Run public services with the real existing assembler and FFmpeg on short fixtures. Assert `render-manifest.json`, both compatibility trees, two manual assemblies, segment manifest, concat MP4, upload SRT, final thumbnail and final QA exist; all returned hashes match; final verdict is pass. Independently recompute both canonical evidence objects through Plan 01's shared helper with opaque inputs exactly `{profileHash,ffmpegVersionHash,assemblerPolicyHash,qaPolicyHash}` and assert one exact `SEGMENTS_PASSED` precedes one exact `FINAL_QA_PASSED`, the latter alone owns the completed transition, and neither service returns before the matching state re-read.

- [ ] **Step 4 (5 minutes): Write restart/cancel test across the whole flow.**

Cancel during segment 2, resume, cancel during concat, resume. Assert segment 1 is never rebuilt, segment 2 rebuild count is one after its cancelled partial is quarantined, final concat reruns once, and valid canonical audio/images remain untouched.

- [ ] **Step 5 (4 minutes): Expand legacy regression coverage.**

Run a legacy fixture without `profileId:"yadam"` and assert no `--preserve-color` requirement, `forceMonochrome:true`, old fixed-grid fallback, legacy tempo range, legacy validation warning exit 0 and current concat report path. Assert no yadam schema is required for legacy.

- [ ] **Step 6 (3 minutes): Implement the CLI with Ctrl+C propagation.**

Use the Plan 01 closed parser pattern. `assemble` calls `assembleAllSegments`, `publish` calls `publishFinalVideo`, and `status` calls `loadFinalQa`. Ctrl+C aborts the controller once and waits for process-tree cleanup before exit 130.

- [ ] **Step 7 (5 minutes): Run focused Plan 05 tests.**

Run:

```powershell
node --test test/yadam/video-contract.test.mjs test/yadam/subtitle-service.test.mjs test/yadam/hermes-compat.test.mjs test/yadam/exact-assembler.test.mjs test/yadam/video-qa.test.mjs test/yadam/video-service.test.mjs
```

Expected: all Plan 05 unit/integration and legacy regression tests pass with no network/GPU/TTS provider access.

- [ ] **Step 8 (4 minutes): Run all yadam and existing targeted regressions.**

Run:

```powershell
npm run test:yadam
node scripts\test_sentence_grounded_visual_timeline.mjs
node scripts\test_segmented_storyboard_grounded_timeline.mjs
```

Expected: all commands exit 0. The legacy tests retain existing profile behavior.

- [ ] **Step 9 (4 minutes): Run strict validators on the synthetic export.**

Run:

```powershell
python scripts\validate_segmented_export.py --export-dir test\yadam\tmp\video-job
node scripts\check_audio_speed_profile.mjs test\yadam\tmp\video-job
node scripts\check_subtitle_render_quality.mjs --export-dir test\yadam\tmp\video-job --out test\yadam\tmp\video-job\validation\subtitle-quality.json
```

Expected: Python status pass, audio factor exactly 1 within tolerance, subtitle report pass, and every process exits 0.

- [ ] **Step 10 (5 minutes): Run the deferred token-guarded 10-minute acceptance.**

Only after the user explicitly opts in, all Plan 01–06 implementation gates pass and the Plan 06 runner exists, run the single canonical live command:

```powershell
node scripts\run-yadam-live-acceptance.mjs --minutes 10 --confirm-live YADAM_LOCAL_10_MIN_ACCEPTANCE
```

Expected: 8–12 minute final duration, 24 FPS color output, tempo 1, no fallback, all strict checks pass and the four public canonical final artifacts plus internal concat evidence exist. Omitting or changing the exact confirmation token exits 2 before any provider preflight or FFmpeg. No environment-variable guard is required; `run_yadam_video.mjs` remains a stage CLI for already-authorized jobs, while the Plan 06 runner is the sole full live-acceptance authority boundary.

- [ ] **Step 11 (2 minutes): Record the CLI and integration commit.**

Run `git status --short`. In Git, stage Task 9 files and run:

```powershell
git commit -m "test(yadam): prove strict video release and legacy isolation"
```

---

## Plan 05 Completion Gate

- [ ] `video-service.mjs` exports exactly `assembleAllSegments`, `publishFinalVideo`, `loadFinalQa`.
- [ ] `render-manifest.json` is exclusively published only after every audio/image/subtitle/thumbnail path and hash passes.
- [ ] pristine Plan 01 jobs create only the contained Plan 05 layout through `ensureVideoJobLayout`; file/symlink/junction escapes fail before any write or child.
- [ ] Canonical joins use IDs; compatibility positional arrays pass count and visualSlotId equality first.
- [ ] N audio scenes and M visual slots work for split and merged timing cases.
- [ ] Compatibility paths and manual-assembly/final/upload paths match the locked table exactly.
- [ ] Existing assembler invocation contains all four required yadam options and no forbidden audio option.
- [ ] yadam timeline uses exact last end, no `Math.ceil`, no global scale, no atempo and `timelineScale:1`.
- [ ] yadam requires a closed `visual-timeline.json`; fixed-grid, first-image and circular keyframe fallbacks are unreachable.
- [ ] manifest and actual visual boundaries differ by no more than one 24 FPS frame.
- [ ] yadam preserves color, meets source/motion/final pixel ratios and Plan 04 colorStyleMatch >=7.
- [ ] segment/audio, motion, black, decode, subtitle and stream numeric checks all pass at exact limits.
- [ ] every required scene subtitle is covered with no missing/duplicate/orphan/text mismatch.
- [ ] `publishSubtitles` returns/reloads the current passed `yadam.coverage.subtitle` revision/path/hash, and `subtitleSetHash` depends on that section hash rather than mutable aggregate hash.
- [ ] empty/unparseable subtitle sets fail before last-cue arithmetic; yadam keeps canonical cue timing without resplitting.
- [ ] segment manifest contains passed video/QA hashes, measured durations and continuous cumulative offsets.
- [ ] concat uses `-c copy`, exact stream parity and strict SRT merge with no warnings.
- [ ] concat writes only inside a contained attempt directory, never deletes root-level SRTs, and promotes canonical final media/report paths exclusively.
- [ ] final/sum and target duration gates pass; intro appears only in segment 1.
- [ ] concat list/report and final video, upload SRT, thumbnail and final QA all exist at canonical paths with registered hashes.
- [ ] Plan 04 retains `yadam.thumbnail.final`; the verified Plan 05 release copy is registered only as `yadam.thumbnail.release`.
- [ ] `qualityOk:true` and `finalVerdict:"pass"` are mechanically derived from warning-free required checks.
- [ ] both success stages import Plan 01's shared `buildSuccessEvidence`, pass exactly `{profileHash,ffmpegVersionHash,assemblerPolicyHash,qaPolicyHash}`, and reject missing/extra/invalid pins; no Plan 05-local helper exists.
- [ ] `SEGMENTS_PASSED` uses the exact 13 upstream inputs and dynamic current subtitle-section output/path; aggregate-only stale repair starts no provider/FFmpeg work and reuses exact success evidence.
- [ ] subsystem returns occur only after artifact re-read plus exactly one `SEGMENTS_PASSED` or `FINAL_QA_PASSED` row whose canonical inputHash, outputHash and exact sorted artifactPaths match the locked formulas.
- [ ] cancellation promotes no partial artifact and nonterminal resume reruns only invalid minimal units.
- [ ] a completed job never transitions back to running or performs same-job rerender; terminal byte tamper yields a verified immutable `completed_artifact_tampered` incident, then requires byte-identical trusted restore or a new job.
- [ ] gguljam-bible defaults and validation semantics pass regression tests unchanged.
- [ ] no Git repository or live acceptance render is started without explicit authority.

## Self-Review Commands and Expected Results

- [ ] **Required-path scan:**

```powershell
rg -n "assemble_cain_fast_from_hermes_job|kenburns-motion|concat_segments|validate_segmented_export|manual-assembly|upload-subtitles" docs\superpowers\plans\2026-07-16-codex-yadam-05-ffmpeg-video-and-strict-qa.md
```

Expected: exact existing modify paths and compatibility/final paths appear in constraints, file map and tasks.

- [ ] **Strict numeric scan:**

```powershell
rg -n "0\.05|0\.01|0\.25|0\.75|0\.2|8\.0|0\.001|480|720|2\*segmentCount|sourceRatio" docs\superpowers\plans\2026-07-16-codex-yadam-05-ffmpeg-video-and-strict-qa.md
```

Expected: every required threshold appears in both tests and implementation steps.

- [ ] **Placeholder scan:**

```powershell
$forbidden = @(("TO"+"DO"),("TB"+"D"),("implement"+" later"),("similar"+" to task"))
Select-String -LiteralPath docs\superpowers\plans\2026-07-16-codex-yadam-05-ffmpeg-video-and-strict-qa.md -Pattern $forbidden
```

Expected: no output.

- [ ] **Public-interface scan:**

```powershell
rg -n "assembleAllSegments|publishFinalVideo|loadFinalQa|loadPassedAudioHandoff|loadPassedImageHandoff" docs\superpowers\plans\2026-07-16-codex-yadam-05-ffmpeg-video-and-strict-qa.md
```

Expected: names and return fields match Plans 03, 04 and 06; no alternative façade name appears.

- [ ] **Final diff review:**

```powershell
git diff -- docs\superpowers\plans\2026-07-16-codex-yadam-05-ffmpeg-video-and-strict-qa.md
```

Expected in Git: only this plan file. Expected now: record `SKIP: not a git repository` and inspect the file directly.
