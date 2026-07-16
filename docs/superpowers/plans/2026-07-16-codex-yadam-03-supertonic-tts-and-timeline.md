# Codex Yadam Supertonic TTS and Measured-Audio Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 승인 2에 묶인 야담 장면을 로컬 Supertonic으로 재개 가능한 방식으로 합성하고, 모든 결과를 48 kHz mono PCM으로 정규화·실측한 뒤 Plan 04가 소비할 `render-plan-input.json`을 만든다.

**Architecture:** `tts-service.mjs`가 유일한 public façade이며 Plan 01의 job·atomic store·artifact·state interface와 Plan 02의 승인·duration-repair interface만 사용한다. 실제 provider adapter는 production에서 비동기 `/api/tts-job`만 사용하고, 서버가 연결 불가능할 때에만 검증된 local CLI로 fallback한다. scene별 request, provider job ID, raw/normalized hash와 상태를 checkpoint하여 중복 제출과 orphan 재개를 제어한다. 실측 WAV timeline은 음성·visual slot·subtitle 계획의 시간 정본이며, Plan 04는 이 계획의 handoff에 compiled image request ID만 붙여 `render-plan.json`을 게시한다.

**Tech Stack:** Node.js 22.16.0 ES modules, Node built-in test runner, Node built-in `fetch` and `spawn`, Plan 01 Ajv/JCS/atomic store, local Supertonic 3 Flask API, local Supertonic Python CLI, FFmpeg/ffprobe.

## Global Constraints

- 이 계획은 Plan 01과 Plan 02 구현 및 테스트가 통과한 뒤 실행한다. duration-repair preview integration test는 Plan 04의 `image-service.mjs`가 구현된 뒤 실행한다.
- `getApprovedTtsInput(jobDir)`이 반환한 현재 approval-2 revision과 exact script hashes만 최초 full TTS 입력으로 허용한다.
- approval 2가 무효인 동안 `getApprovedTtsInput`을 호출해 우회하지 않는다. repair 재생성은 `script/duration-repair-report.json`과 repaired `script-scenes.json`을 함께 검증하는 Plan 03 비공개 로더만 사용한다.
- production HTTP는 항상 `POST /api/tts-job` 후 template path ``GET /api/tts-job/${providerJobId}`` polling이다. 동기 `POST /api/tts`는 opt-in 한 문장 diagnostic 전용이며 `runFullTts`에서 호출하지 않는다.
- HTTP에서 provider job ID를 받은 즉시 scene checkpoint를 atomic write한 뒤 첫 poll을 시작한다.
- HTTP server가 연결 불가능하고 local CLI preflight가 성공한 경우에만 CLI fallback을 허용한다. HTTP 400, invalid WAV, outside-root path, hash mismatch와 unsupported option은 CLI fallback 사유가 아니다.
- 같은 scene request는 local idempotency key와 exclusive scene lock으로 직렬화한다. Supertonic server가 idempotency를 제공한다고 가정하지 않는다.
- async POST는 응답을 받기 전에 server가 이미 job을 만들 수 있다. request body 전송 뒤 response timeout·socket close·caller cancellation·형식 불명 응답·job 생성 여부를 보장하지 않는 5xx는 submission ambiguity다. scene checkpoint를 `orphaned`로 저장하고 자동 POST·CLI fallback을 모두 중지한다. non-cancel 경로는 `supertonic_submission_ambiguous`를 반환하고, caller cancellation은 같은 orphan 증거를 먼저 영속화한 뒤 AbortError로 종료한다. 재시도는 body가 전송되지 않았음이 증명된 pre-connect 실패 또는 응답이 `job_created:false`를 명시한 경우에만 허용한다.
- provider-owned HTTP output path는 provenance일 뿐 production manifest path가 아니다. allowed root 안의 file copy 또는 같은 loopback origin의 `/audio/` download를 job root `.part`로 받아 검증한 뒤에만 raw asset으로 promote한다. CLI transport는 외부 provider path를 반환하지 않고 Codex가 미리 contain한 정확한 job-root `.part.wav`에 직접 쓰며, 그 경로를 외부 allowed-root 규칙으로 다시 분류하지 않는다.
- 모든 normalized WAV는 `pcm_s16le`, sample format `s16`, 48,000 Hz, 1 channel, `mono`, duration > 0이어야 한다.
- yadam playback tempo는 1.0이며 `render-plan-input.json`에는 `audioTempoFactor:1`만 기록한다.
- `readSlow`는 hash-bound metadata로 보존하지만 v1의 실제 합성 speed는 항상 audition이 끝난 profile value 1.04다. scripture용 0.96 또는 정의되지 않은 slow-speed field로 매핑하지 않는다. 다른 speed는 새 audition과 profile revision 없이는 허용하지 않는다.
- measured scene duration은 ffprobe 값이고, scene·segment·whole-job timeline은 이 값의 순차 누적이다. planned 600초를 경계로 WAV를 자르거나 늘리지 않는다.
- segment 480–720초는 `acknowledgedNotice`가 될 수 있는 planning warning일 뿐 release hard gate가 아니다. job 전체는 target의 80–120%를 hard gate로 사용한다.
- job 전체 automatic duration repair는 정확히 한 번이다. repair 뒤에도 범위를 벗어나거나 approval 1의 의미 계약이 바뀌면 `needs_review` 또는 `approval1_invalidated`로 멈춘다.
- repair 뒤에는 changed scene WAV 재생성, affected approval preview refresh, approval-2 새 revision bundle 게시 순서를 지키며 사용자 재승인 전 `audio_passed`를 반환하지 않는다.
- cancellation 요청 뒤에는 새 TTS·CLI·FFmpeg process를 시작하지 않는다. Supertonic HTTP job은 cancel endpoint가 없으므로 provider job ID를 orphan으로 남기고 polling을 멈춘다.
- sibling `C:/Users/petbl/hermes-studio` module을 import하지 않는다. 기존 `scripts/generate_hermes_voice_for_job.mjs`는 compatibility 참고 자료일 뿐 새 production façade가 아니다.
- 실제 음성 생성 smoke는 `YADAM_LIVE_TTS=1`일 때 한 문장만 실행한다. unit/integration test는 fake HTTP, fake CLI와 synthetic WAV를 사용한다.
- 모든 명령은 PowerShell에서 `C:\Users\petbl\auto-video`를 working directory로 실행한다.
- 현재 workspace는 Git repository가 아니다. 각 commit step에서 먼저 `git status --short`를 실행하고 실패하면 `SKIP: not a git repository`를 execution log에 기록한다. 이 계획은 `git init`을 실행하지 않는다.

---

## Interfaces Consumed Without Redefinition

### Plan 01 pipeline core

```js
import { loadJob } from "../pipeline/job-store.mjs";
import { writeCanonicalJson, writeUtf8Atomic, writeCanonicalJsonExclusive } from "../pipeline/atomic-store.mjs";
import { sha256Bytes, hashCanonical } from "../pipeline/canonical-json.mjs";
import { registerArtifact, canReuseArtifact } from "../pipeline/artifact-store.mjs";
import { transitionJob } from "../pipeline/state-machine.mjs";
import { validateSchema } from "../pipeline/schema-registry.mjs";
import { assertPathWithin, assertAnyAllowedRealPath } from "../pipeline/path-policy.mjs";
```

Plan 03 uses the exact Plan 01 return contracts:

```js
loadJob(jobDir): Promise<JobContext>
writeCanonicalJson(filePath, value): Promise<{ path: string, sha256: string, sizeBytes: number }>
writeUtf8Atomic(filePath, text): Promise<{ path: string, sha256: string, sizeBytes: number }>
writeCanonicalJsonExclusive(filePath, value): Promise<{ path: string, sha256: string, sizeBytes: number }>
sha256Bytes(input): string
hashCanonical(value): string
registerArtifact(jobDir, record): Promise<ArtifactRecord>
canReuseArtifact(jobDir, artifactId, dependencyHashes): Promise<boolean>
transitionJob(jobDir, event): Promise<PipelineState>
validateSchema(schemaPath, value): object
assertPathWithin(root, candidate): string
assertAnyAllowedRealPath(roots, candidate): Promise<string>
```

Every artifact record uses Plan 01's exact shape and a job-root relative path:

```js
{
  artifactId: string,
  logicalRole: string,
  path: string,
  sha256: string,
  schemaVersion: string,
  producerStage: string,
  gateStatus: "pass",
  dependencyHashes: Record<string, string>,
}
```

Plan 03 does not create approval or duration-repair revision files: those immutable revisions remain owned by Plan 02, are written there with Plan 01 `writeCanonicalJsonExclusive`, and are only verified here. Plan 03's own hash-addressed needs-review evidence also uses `writeCanonicalJsonExclusive`. Scene checkpoints, per-scene requests, audio manifests/timelines and `render-plan-input.json` are fixed-path canonical state that must be rebound after the single duration repair or a new approval hash, so they use `writeCanonicalJson`; Plan 03 must never use that replacing writer on an immutable revision/report path.

Plan 01 `writeBinaryAtomic(filePath,bytes)` is the only buffered binary writer. Because provider/normalized WAV files may approach the 512 MiB cap, production audio import and FFmpeg normalization use a same-directory `.part`, bounded streaming or owned FFmpeg output, file flush/sync, full validation/hash, then one same-directory atomic rename. No Plan 03 module implements another small-buffer binary writer or writes a canonical WAV path directly.

### Plan 02 script and approval service

```js
import {
  getApprovedTtsInput,
  requestDurationRepair,
  rebuildApproval2AfterDurationRepair,
  updateCoverageSection,
} from "./script-service.mjs";
```

The first full TTS run consumes exactly:

```js
getApprovedTtsInput(jobDir): Promise<{
  approvalRevisionPath: string,
  finalTextHash: string,
  scriptScenesHash: string,
  scenes: Array<{
    sceneId: string,
    segmentId: string,
    ordinal: number,
    sourceText: string,
    sourceHash: string,
    ttsNormalizedText: string,
    ttsNormalizedHash: string,
    ttsOptionsHash: string,
  }>,
}>
```

Duration repair calls and branches on the complete discriminated result:

```js
requestDurationRepair({
  jobDir,
  measuredDurationSeconds,
  acceptedRangeSeconds: { minimum, maximum },
  signal,
}): Promise<
  | {
      status: "repaired",
      attempt: 1,
      changedSegmentIds: string[],
      changedSceneIds: string[],
      beforeFinalTextHash: string,
      afterFinalTextHash: string,
    }
  | {
      status: "needs_review",
      attempt: 1,
      changedSegmentIds: string[],
      changedSceneIds: string[],
      beforeFinalTextHash: string,
      afterFinalTextHash: null,
    }
  | {
      status: "approval1_invalidated",
      attempt: 1,
      changedSegmentIds: string[],
      changedSceneIds: string[],
      beforeFinalTextHash: string,
      afterFinalTextHash: null,
    }
>

rebuildApproval2AfterDurationRepair({
  jobDir,
  changedSceneIds,
  signal,
}): Promise<{
  status: "awaiting_reapproval",
  revision: number,
  bundlePath: string,
  approvedArtifactSetHash: string,
}>
```

The Plan 02 repair report consumed by the private loader is fixed to this shape:

```js
{
  schemaVersion: "1.0.0",
  reportType: "yadam_duration_repair_authorization",
  jobId: string,
  attempt: 1,
  status: "repaired",
  createdAt: string,
  approvalTwo: {
    invalidatedRevisionPath: string,
    approvedArtifactSetHash: string,
  },
  measurement: {
    measuredDurationSeconds: number,
    acceptedRangeSeconds: { minimum: number, maximum: number },
    sourceArtifactId: string,
    sourceArtifactHash: string,
  },
  semanticContractHash: string,
  changedSegmentIds: string[],
  changedSceneIds: string[],
  before: {
    finalTextHash: string,
    scriptScenesHash: string,
    scenePlanHash: string,
    qaReportHash: string,
    scriptCoverageHash: string,
  },
  after: {
    finalTextHash: string,
    scriptScenesHash: string,
    scenePlanHash: string,
    qaReportHash: string,
    scriptCoverageHash: string,
  },
  changedScenes: Array<{
    sceneId: string,
    segmentId: string,
    ordinal: number,
    sourceHash: string,
    ttsNormalizedText: string,
    ttsNormalizedHash: string,
    ttsOptionsHash: string,
  }>,
  changedSceneSetHash: string,
  dependencyHashes: Record<string, string>,
  provenance: { stageId: string, inputHash: string, outputHash: string, eventsPath: string },
  authorizationHash: string,
}
```

Plan 02 path values in this contract, including `approvalRevisionPath` and every rebuild `bundlePath`, are job-relative and slash-normalized; Plan 03 joins them to the verified `jobDir` and never treats them as absolute host paths.

`loadAuthorizedRepairTtsInput` is private to `tts-service.mjs`. It requires pipeline state stage `REGENERATING_CHANGED_AUDIO`, report `attempt:1`, top-level state `durationRepairAttemptsUsed===1`, and exactly one `DURATION_REPAIR_REQUIRED` history row with `{to:"running",attempt:1,inputHash:report.provenance.inputHash}`. Recompute Plan 02's closed `durationRepairInputHash` projection from the invalidated approval revision, report `before` hashes and sealed historical evidence, original audio manifest/timeline measurement, unchanged semantic/story/outline inputs, and the exact profile/prompt/schema/Codex/canonicalizer pins; require it equals both row and report provenance. Before any replacement has occurred, rehash the live original measurement inputs; on resume after the authorized current audio record moved, require the sealed old hashes in retained revision evidence plus the already verified immutable report/reservation chain instead of hashing the overwritten fixed path. Also require a passed registered `yadam.duration.repair_report`, exact report/file hash, its exact five-key opaque registry dependency map, RFC 8785 `authorizationHash` with that field omitted, `changedSceneSetHash`, before linkage to the invalidated immutable approval-2 revision, after linkage to the current repaired script/scene-plan/QA artifacts plus current passed `yadam.coverage.script`, and exact ordered equality between `changedSceneIds` and `changedScenes[].sceneId`. Require the current aggregate's script binding to equal that section, but require neither a specific aggregate hash nor downstream-section hashes in the immutable report/live dependency map; changed audio must be able to advance them while the authorization remains passed for preview refresh and bundle rebuild. The report's explicit before/after script-coverage hashes, sealed historical map, current registry records and file bytes must all agree. It returns only the `changedScenes` request rows and is never exported.

### Plan 04 preview refresh boundary

The repair branch dynamically loads this one Plan 04 function only after changed WAV validation, avoiding an eager ES-module cycle:

```js
const { refreshApproval2Previews } = await import("./image-service.mjs");

refreshApproval2Previews({
  jobDir,
  changedSceneIds,
  signal,
}): Promise<Array<{
  role: "intro" | "body" | "climax",
  artifactId: string,
  relativePath: string,
  sha256: string,
  dependencyHash: string,
}>>
```

Plan 03 verifies that every refreshed entry hash exists in the updated `previews/preview-manifest.json`, then calls `rebuildApproval2AfterDurationRepair`. It does not call `generateProductionImages`.

---

## Public Interface Produced for Plans 04, 05 and 06

Create `scripts/lib/yadam/tts-service.mjs` with exactly these public exports:

```js
export async function runFullTts({ jobDir, signal });
export async function loadPassedAudioHandoff(jobDir);
```

`runFullTts` returns one of these exact values:

```js
{
  status: "audio_passed",
  audioManifestPath: string,
  audioManifestHash: string,
  audioTimelinePath: string,
  audioTimelineHash: string,
  renderPlanInputPath: string,
  renderPlanInputHash: string,
  measuredAudioSeconds: number,
}

{
  status: "awaiting_reapproval",
  revision: number,
  bundlePath: string,
  approvedArtifactSetHash: string,
}

{
  status: "needs_review",
  reason: "supertonic_submission_ambiguous" | "duration_repair_failed" | "approval1_invalidated" | "repaired_duration_out_of_range",
  errorCode: "supertonic_submission_ambiguous" | "duration_repair_failed" | "approval1_invalidated" | "repaired_duration_out_of_range",
  reportPath: string,
}
```

For this union, `errorCode === reason` and `reportPath` is the job-relative immutable report path `assets/audio/reviews/{errorCode}-{inputHashPrefix12}.json`. The report is schema-validated, exclusively written/registered and re-read before the needs-review value is returned.

`loadPassedAudioHandoff(jobDir)` throws `audio_handoff_not_passed` unless current approval 2 is valid and every referenced artifact has `gateStatus:"pass"`, exact file hash and exact dependency hashes. Its success value is:

```js
{
  audioManifestPath: string,
  audioManifestHash: string,
  audioTimelinePath: string,
  audioTimelineHash: string,
  renderPlanInputPath: string,
  renderPlanInputHash: string,
  measuredAudioSeconds: number,
  acceptedRangeSeconds: { minimum: number, maximum: number },
  audioTempoFactor: 1,
  scenes: Array<{
    sceneId: string,
    segmentId: string,
    order: number,
    sourceHash: string,
    ttsNormalizedHash: string,
    ttsOptionsHash: string,
    normalizedWavPath: string,
    normalizedWavHash: string,
    durationSeconds: number,
    startSeconds: number,
    endSeconds: number,
  }>,
  segments: Array<{
    segmentId: string,
    plannedDurationSeconds: 600,
    measuredAudioSeconds: number,
    startSeconds: number,
    endSeconds: number,
  }>,
  visualSlots: Array<{
    visualSlotId: string,
    visualOrder: number,
    segmentId: string,
    sourceSceneIds: string[],
    primarySceneId: string,
    startSeconds: number,
    endSeconds: number,
    durationSeconds: number,
    timingBand: "intro" | "body",
    extendedHold: boolean,
    holdReason: "cta" | "short_tail" | null,
    purpose: "intro" | "scene",
  }>,
}
```

Every `*Path` returned by Plan 03 is job-relative with `/` separators. Provider paths remain checkpoint provenance only and never cross this handoff.

Plan 01 owns `scripts/lib/pipeline/success-evidence.mjs`; Plan 03/05 producers and the Plan 06 verifier import its sole `buildSuccessEvidence` export rather than copying hash logic. `AUDIO_PASSED` uses the canonicalization below. `record` is the current verified Plan 01 artifact record; path normalization happens before projection, and comparison is bytewise code-unit order rather than locale-aware order:

```js
import { buildSuccessEvidence } from "../pipeline/success-evidence.mjs";

// Plan 01's locked helper computes exactly:
// inputHash  = hashCanonical({schemaVersion:"1.0.0",eventStage:stage,inputArtifacts,opaqueInputs:sortedOpaqueInputs})
// outputHash = hashCanonical({schemaVersion:"1.0.0",eventStage:stage,inputHash,outputArtifacts})
// artifactPaths = outputArtifacts.map(({path}) => path)
```

For `AUDIO_PASSED`, `inputRecords` contains exactly the singleton current roles `yadam.approval.2`, `yadam.script.scenes`, and `yadam.scene.plan`. `outputRecords` contains exactly `yadam.audio.manifest` at `assets/audio/audio-manifest.json`, `yadam.audio.timeline` at `assets/audio/audio-timeline.json`, `yadam.render_plan_input` at `render-plan-input.json`, and the current passed `yadam.coverage.audio` at `script/coverage/audio-rNNN.json`. Reject a missing/duplicate role, duplicate path, non-pass record or unexpected record before hashing. The mutable aggregate `yadam.coverage.report` is not an output record because later section owners legitimately change its hash.

The exact `opaqueInputs` keys are `profileHash`, `ttsProviderContractHash`, and `normalizerVersionHash`, with no extras and lowercase 64-hex values. `profileHash` is the verified current Plan 01 yadam profile hash. Derive `ttsProviderContractHash = hashCanonical({contractVersion:"1.0.0",files})`, where `files` is the bytewise path-sorted `{path,sha256}` projection of `scripts/lib/providers/supertonic-http.mjs`, `scripts/lib/providers/supertonic-cli.mjs`, and `schemas/yadam/tts-scene-request.schema.json`. Derive `normalizerVersionHash = hashCanonical({contractVersion:"1.0.0",files,ffmpegVersionOutputHash,ffprobeVersionOutputHash})`, where `files` similarly contains `scripts/lib/yadam/provider-audio-import.mjs`, `scripts/lib/yadam/audio-normalizer.mjs`, and `schemas/yadam/audio-normalization-report.schema.json`; each version-output hash is SHA-256 over the corresponding bounded `-version` stdout normalized to LF with trailing whitespace removed. The exact state-machine call is:

```js
const evidence = buildSuccessEvidence("AUDIO_PASSED", inputRecords, outputRecords, {
  profileHash,
  ttsProviderContractHash,
  normalizerVersionHash,
});
await transitionJob(jobDir, {
  stage: "AUDIO_PASSED",
  to: "running",
  inputHash: evidence.inputHash,
  outputHash: evidence.outputHash,
  artifactPaths: evidence.artifactPaths,
});
```

Thus the exact sorted `artifactPaths` array is `['assets/audio/audio-manifest.json','assets/audio/audio-timeline.json','render-plan-input.json',audioCoveragePath].sort()`, where `audioCoveragePath` is the exact current registered `script/coverage/audio-rNNN.json`. Before returning `status:"audio_passed"`, the service re-loads the three media/timeline artifacts through `loadPassedAudioHandoff`, re-verifies the audio section record and aggregate audio binding, recomputes evidence from all four output records, ensures exactly one subsystem-owned state-history event for the input hash, then re-reads state and requires byte-for-byte equality of stage/to/inputHash/outputHash/artifactPaths. An existing exact event is reused rather than duplicated. An existing same-stage/same-input row with a different output hash/path set is `success_evidence_conflict`, never permission to append a second success. If only the derived aggregate is stale, call `updateCoverageSection` with the verified current audio section payload to rebuild it provider-free before reuse; a stale/current audio section itself invalidates the event and enters this façade's bounded owner path. `awaiting_reapproval`, needs-review and thrown failure branches never append `AUDIO_PASSED`.

Plan 04 consumes this handoff, compiles provider requests, adds `compiledRequestId`, atomically publishes root `render-plan.json`, and only then submits image jobs. `render-plan-input.json` contains no image path, image hash, provider job ID or compiled request ID.

---

## Canonical Artifacts and Checkpoint Paths

| Logical role | Relative path | Producer |
|---|---|---|
| `yadam.tts.request.{sceneId}` | `assets/audio/requests/{sceneId}.json` | request builder |
| `yadam.tts.checkpoint.{sceneId}` | `assets/audio/checkpoints/{sceneId}.json` | scene runner |
| `yadam.audio.raw.{sceneId}` | `assets/audio/raw/{sceneId}.wav` | provider output importer |
| `yadam.audio.normalized.{sceneId}` | `assets/audio/normalized/{sceneId}.wav` | normalizer |
| `yadam.audio.normalization_report` | `assets/audio/normalization-report.json` | normalizer |
| `yadam.audio.manifest` | `assets/audio/audio-manifest.json` | scene runner |
| `yadam.audio.timeline` | `assets/audio/audio-timeline.json` | timeline builder |
| `yadam.render_plan_input` | `render-plan-input.json` | timeline builder |
| `yadam.audio.needs_review` | `assets/audio/reviews/{errorCode}-{inputHashPrefix12}.json` | TTS/duration orchestrator |

Provider files remain outside this table and are recorded only inside checkpoint provenance. Scene lock files live at `assets/audio/checkpoints/{sceneId}.lock` and are not artifacts.

## Locked File Map

- Modify `config/profiles/yadam.json`
  - Add exact async/polling/retry/normalization policy without changing Plan 01 content and video values.
- Modify `config/host.local.example.json`
  - Add verified Supertonic allowed output root and CLI executable/script/cwd paths.
- Create `schemas/yadam/tts-scene-request.schema.json`
- Create `schemas/yadam/tts-scene-checkpoint.schema.json`
- Create `schemas/yadam/audio-normalization-report.schema.json`
- Create `schemas/yadam/audio-manifest.schema.json`
- Create `schemas/yadam/audio-timeline.schema.json`
- Create `schemas/yadam/render-plan-input.schema.json`
- Create `schemas/yadam/audio-needs-review.schema.json`
- Create `scripts/lib/yadam/tts-request.mjs`
  - Validates approved rows, resolves effective profile options and derives the local idempotency key.
- Create `scripts/lib/providers/supertonic-http.mjs`
  - Health, async submission, accepted-job checkpoint callback and bounded polling.
- Create `scripts/lib/providers/supertonic-cli.mjs`
  - CLI preflight, safe argv and cancellation-aware execution.
- Create `scripts/lib/yadam/provider-audio-import.mjs`
  - Allowed-root copy or loopback download, RIFF/ffprobe validation and raw promotion.
- Create `scripts/lib/yadam/audio-normalizer.mjs`
  - FFmpeg PCM conversion, ffprobe parity gate, hashes and atomic promotion.
- Create `scripts/lib/yadam/tts-checkpoint.mjs`
  - Scene lock, checkpoint transitions, orphan resume and retry budget.
- Create `scripts/lib/yadam/audio-timeline.mjs`
  - Scene/segment cumulative timing, visual slot partitioning and coverage assertions.
- Create `scripts/lib/yadam/tts-service.mjs`
  - Public façade, coverage update, duration repair, approval-2 rebuild and handoff loader.
- Create `scripts/lib/yadam/tts-service-core.mjs`
  - Internal dependency-injection seam for duration-repair orchestration; not re-exported by the public façade.
- Create `scripts/lib/yadam/audio-needs-review.mjs`
  - Hash-addressed exclusive needs-review reports and Plan 06-compatible report paths.
- Create `scripts/run_yadam_tts.mjs`
  - Manual `run` and `status` commands without changing Plan 01's main CLI dispatcher.
- Create `test/yadam/tts-contract.test.mjs`
- Create `test/yadam/supertonic-http.test.mjs`
- Create `test/yadam/supertonic-cli.test.mjs`
- Create `test/yadam/audio-normalization.test.mjs`
- Create `test/yadam/tts-resume.test.mjs`
- Create `test/yadam/audio-timeline.test.mjs`
- Create `test/yadam/duration-repair-tts.test.mjs`
- Create `test/yadam/fixtures/fake-supertonic-cli.mjs`
- Create `test/yadam/fixtures/wav-fixture.mjs`

---

## Task 1: Lock TTS profile, host configuration and closed schemas

**Files:**
- Modify: `config/profiles/yadam.json`
- Modify: `config/host.local.example.json`
- Create: `schemas/yadam/tts-scene-request.schema.json`
- Create: `schemas/yadam/tts-scene-checkpoint.schema.json`
- Create: `schemas/yadam/audio-normalization-report.schema.json`
- Create: `schemas/yadam/audio-manifest.schema.json`
- Create: `schemas/yadam/audio-timeline.schema.json`
- Create: `schemas/yadam/render-plan-input.schema.json`
- Create: `schemas/yadam/audio-needs-review.schema.json`
- Create: `test/yadam/tts-contract.test.mjs`

**Interfaces:**
- Consumes: Plan 01 profile and host loaders, Plan 02 approved TTS row.
- Produces: closed TTS, checkpoint, audio and render-plan-input contracts used by every later task.

- [ ] **Step 1 (4 minutes): Write the failing profile and request-schema tests.**

Create `test/yadam/tts-contract.test.mjs` with tests that load `yadam.json`, assert the exact values below, validate one request fixture, and reject an added `imagePath` property. Add a one-row normalization-report fixture and reject an absolute `normalizedPath`, missing request dependency and unknown media field. Add a closed needs-review fixture using `errorCode:"duration_repair_failed"`, null provider orphan, one audio-manifest evidence row and the exact fields in Step 6; reject an extra `retryAutomatically` key. Use `validateSchema` from Plan 01.

```js
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { loadProfile, loadHostConfig } from "../../scripts/lib/pipeline/profile-registry.mjs";
import { validateSchema } from "../../scripts/lib/pipeline/schema-registry.mjs";

const root = resolve(".");

test("yadam locks asynchronous Supertonic production policy", async () => {
  const profile = await loadProfile("yadam", root);
  assert.equal(profile.tts.productionEndpoint, "/api/tts-job");
  assert.equal(profile.tts.diagnosticEndpoint, "/api/tts");
  assert.equal(profile.tts.pollIntervalMs, 1000);
  assert.equal(profile.tts.sceneTimeoutMs, 900000);
  assert.equal(profile.tts.transientAttempts, 3);
  assert.deepEqual(profile.tts.normalizedAudio, {
    codec: "pcm_s16le", sampleFormat: "s16", sampleRate: 48000, channels: 1, channelLayout: "mono",
  });
  const host = await loadHostConfig(root);
  assert.equal(host.supertonic.baseUrl, "http://127.0.0.1:3093");
  assert.equal(host.supertonic.allowedOutputRoots.length, 1);
});

test("TTS request schema is closed", async () => {
  const request = {
    schemaVersion: "1.0.0", jobId: "job-20260716-230000-1234abcd", sceneId: "scene-0001",
    segmentId: "segment-01", order: 1, sourceHash: "a".repeat(64),
    ttsNormalizedHash: "b".repeat(64), ttsOptionsHash: "c".repeat(64),
    idempotencyKey: "d".repeat(64), text: "옛날 어느 고을에 한 선비가 살았습니다.",
    provider: "supertonic", adapterVersion: "1.0.0", model: "supertonic-3", voice: "M1",
    language: "ko", speed: 1.04, totalStep: 8, silenceSeconds: 0.38,
    readSlow: false, continuousNext: false,
  };
  const schema = resolve("schemas/yadam/tts-scene-request.schema.json");
  assert.deepEqual(validateSchema(schema, request), request);
  assert.throws(
    () => validateSchema(schema, { ...request, imagePath: "assets/images/a.png" }),
    error => error.name === "SchemaValidationError" && error.code === "schema_validation_failed",
  );
});
```

- [ ] **Step 2 (2 minutes): Run the focused test and confirm the contract is absent.**

Run:

```powershell
node --test test/yadam/tts-contract.test.mjs
```

Expected: FAIL because the new TTS profile fields, request schema or needs-review schema do not exist.

- [ ] **Step 3 (3 minutes): Add the exact yadam transport and normalization settings.**

Extend only `config/profiles/yadam.json.tts` with:

```json
{
  "productionEndpoint": "/api/tts-job",
  "diagnosticEndpoint": "/api/tts",
  "pollIntervalMs": 1000,
  "sceneTimeoutMs": 900000,
  "requestTimeoutMs": 15000,
  "transientAttempts": 3,
  "normalizedAudio": {
    "codec": "pcm_s16le",
    "sampleFormat": "s16",
    "sampleRate": 48000,
    "channels": 1,
    "channelLayout": "mono"
  }
}
```

Keep Plan 01's `provider`, `model`, `voice`, `language`, `speed`, `totalStep`, `sceneSilenceSeconds` and `continuousSilenceSeconds` unchanged.

- [ ] **Step 4 (3 minutes): Add the verified local Supertonic host entry.**

Extend `config/host.local.example.json` with this exact object:

```json
{
  "supertonic": {
    "baseUrl": "http://127.0.0.1:3093",
    "allowedOutputRoots": [
      "C:/Users/petbl/supertonic3-local-tts-20260517-r4/supertonic3-local-tts/data"
    ],
    "cli": {
      "pythonExecutable": "C:/Users/petbl/supertonic3-local-tts-20260517-r4/supertonic3-local-tts/.venv-win/Scripts/python.exe",
      "scriptPath": "C:/Users/petbl/supertonic3-local-tts-20260517-r4/supertonic3-local-tts/src/supertonic3_cli.py",
      "cwd": "C:/Users/petbl/supertonic3-local-tts-20260517-r4/supertonic3-local-tts/src"
    }
  }
}
```

Do not put `SUPERTONIC3_OUTPUT_DIR` or another mutable machine override into the profile. `config/host.local.json` may override the example on a different host and remains ignored by Git.

- [ ] **Step 5 (5 minutes): Create the closed request and checkpoint schemas.**

Use draft 2020-12, `additionalProperties:false`, lowercase 64-hex patterns for every hash, positive durations, and these exact checkpoint statuses:

```json
[
  "pending",
  "submitted",
  "polling",
  "provider_done",
  "raw_verified",
  "normalized",
  "cancel_requested",
  "orphaned",
  "failed"
]
```

`tts-scene-request.schema.json` requires every field in the valid Step 1 fixture. `tts-scene-checkpoint.schema.json` requires `schemaVersion`, `sceneId`, `requestHash`, `idempotencyKey`, `status`, `transport`, `attempt`, `updatedAt`; it permits nullable `providerJobId`, `providerResult`, `rawAsset`, `normalizedAsset`, `error` and requires `attempt` from 1 through 3.

- [ ] **Step 6 (5 minutes): Create the normalization, audio and render-plan-input schemas.**

Apply these exact rules:

- `audio-normalization-report`: closed root with `schemaVersion`, `profileId:"yadam"`, `jobId`, sorted nonempty `rows` and `dependencyHashes`; every row uses the exact Task 5 Step 8 shape, job-relative raw/normalized production paths, lowercase hashes, positive attempts/duration, nonnegative elapsed time, fixed canonical media fields and provider path/URL only inside `providerProvenance`.
- `audio-manifest`: `profileId` const `yadam`, current approval path/hash dependencies, nonempty `scenes`, positive `measuredAudioSeconds`, accepted range, `audioTempoFactor` const 1, normalization report path/hash.
- `audio-timeline`: scene rows sorted by `order`; segment rows; positive total; `audioTempoFactor` const 1.
- `render-plan-input`: profile/dimensions/FPS, script and audio dependencies, scene rows, segment rows, visual slots and subtitle source rows.
- `audio-needs-review`: closed root `{schemaVersion,reportType,jobId,status,errorCode,createdAt,inputHash,measuredAudioSeconds,acceptedRangeSeconds,repairAttempt,providerOrphan,evidence,dependencyHashes}`. `reportType` is `yadam_audio_needs_review`, status is `needs_review`, error code uses the public four-value enum, `repairAttempt` is 0 or 1, nullable provider orphan contains `{sceneId,requestHash,providerJobId,checkpointPath}`, and evidence rows contain `{artifactId,path,sha256}`.
- Visual slot `sourceSceneIds` is nonempty and unique, `primarySceneId` is a member, `durationSeconds` is positive, and `timingBand` is `intro|body`.
- Add a schema-level `not` guard for each of `imagePath`, `imageSha256`, `providerJobId` and `compiledRequestId` anywhere a visual slot is defined.

- [ ] **Step 7 (2 minutes): Run the focused contract test.**

Run:

```powershell
node --test test/yadam/tts-contract.test.mjs
```

Expected:

```text
ok - yadam locks asynchronous Supertonic production policy
ok - TTS request schema is closed
ok - audio normalization report schema is closed
ok - audio needs-review evidence schema is closed
```

- [ ] **Step 8 (2 minutes): Record the contract task commit.**

Run `git status --short`. In a Git repository, stage the Task 1 files and run:

```powershell
git commit -m "feat(yadam): lock Supertonic audio contracts"
```

Expected now: `SKIP: not a git repository`. Expected in Git: one commit containing only the profile, host example, schemas and contract test.

---

## Task 2: Build approved scene requests and deterministic idempotency keys

**Files:**
- Create: `scripts/lib/yadam/tts-request.mjs`
- Modify: `test/yadam/tts-contract.test.mjs`

**Interfaces:**
- Consumes: `getApprovedTtsInput`, approved `planning/scene-plan.json`, yadam profile, `hashCanonical`, request schema.
- Produces: `buildTtsRequests({jobDir,approvedInput})` and `buildTtsIdempotencyKey(requestWithoutKey)` for internal use.

- [ ] **Step 1 (4 minutes): Add failing hash, option and ordering tests.**

Append tests with three scenes and assert:

```js
assert.deepEqual(requests.map((row) => row.order), [1, 2, 3]);
assert.deepEqual(requests.map((row) => row.silenceSeconds), [0.38, 0.04, 0.38]);
assert.deepEqual(requests.map((row) => row.speed), [1.04, 1.04, 1.04]);
assert.deepEqual(requests.map((row) => row.readSlow), [false, true, false]);
assert.equal(requests[0].idempotencyKey.length, 64);
assert.equal(requests[0].text, "옛날 어느 고을에 한 선비가 살았습니다.");
assert.notEqual(requests[0].idempotencyKey, requests[1].idempotencyKey);
assert.throws(() => assertApprovedSceneOrder([{ ordinal: 1 }, { ordinal: 3 }]), /scene_order_not_contiguous/);
```

The fixture scene plan sets scene 1 `continuousNext:false,readSlow:false`, scene 2 `continuousNext:true,readSlow:true`, and scene 3 `continuousNext:false,readSlow:false`. Assert `readSlow:true` changes the hash-bound options metadata but does not change the v1 speed from 1.04.

- [ ] **Step 2 (2 minutes): Run the test and verify module absence.**

Run `node --test test/yadam/tts-contract.test.mjs`.

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `tts-request.mjs`.

- [ ] **Step 3 (4 minutes): Implement exact order and approved-row hash validation.**

Create `scripts/lib/yadam/tts-request.mjs` with these pure guards:

```js
import { hashCanonical, sha256Bytes } from "../pipeline/canonical-json.mjs";

const HASH = /^[0-9a-f]{64}$/;

export function assertApprovedSceneOrder(scenes) {
  const sorted = [...scenes].sort((a, b) => a.ordinal - b.ordinal);
  sorted.forEach((scene, index) => {
    if (scene.ordinal !== index + 1) throw Object.assign(new Error("scene_order_not_contiguous"), { code: "scene_order_not_contiguous" });
  });
  return sorted;
}

export function assertApprovedSceneHashes(scene) {
  const sourceHash = sha256Bytes(Buffer.from(scene.sourceText.normalize("NFC"), "utf8"));
  const normalizedHash = sha256Bytes(Buffer.from(scene.ttsNormalizedText.normalize("NFC"), "utf8"));
  if (sourceHash !== scene.sourceHash) throw Object.assign(new Error("source_hash_mismatch"), { code: "source_hash_mismatch", sceneId: scene.sceneId });
  if (normalizedHash !== scene.ttsNormalizedHash) throw Object.assign(new Error("tts_normalized_hash_mismatch"), { code: "tts_normalized_hash_mismatch", sceneId: scene.sceneId });
  if (!HASH.test(scene.ttsOptionsHash)) throw Object.assign(new Error("tts_options_hash_invalid"), { code: "tts_options_hash_invalid", sceneId: scene.sceneId });
}
```

- [ ] **Step 4 (5 minutes): Resolve and verify effective options.**

Read the passed `yadam.scene.plan` artifact through `loadJob(jobDir).manifest`, rehash the file, and match each scene by `sceneId`, never array position. Construct options exactly as follows and require `hashCanonical(effectiveOptions) === scene.ttsOptionsHash`:

```js
const effectiveOptions = {
  model: profile.tts.model,
  voice: profile.tts.voice,
  language: profile.tts.language,
  speed: profile.tts.speed,
  totalStep: profile.tts.totalStep,
  silenceSeconds: scenePlanRow.tts.continuousNext
    ? profile.tts.continuousSilenceSeconds
    : profile.tts.sceneSilenceSeconds,
  readSlow: scenePlanRow.tts.readSlow,
  continuousNext: scenePlanRow.tts.continuousNext,
};
```

Reject a missing scene-plan row, duplicate scene ID, `readSlow` or `continuousNext` that is not boolean, and any hash mismatch.

- [ ] **Step 5 (4 minutes): Implement request and idempotency construction.**

The idempotency material is exact and excludes path and time:

```js
export function buildTtsIdempotencyKey(request) {
  return hashCanonical({
    provider: request.provider,
    adapterVersion: request.adapterVersion,
    sceneId: request.sceneId,
    sourceHash: request.sourceHash,
    ttsNormalizedHash: request.ttsNormalizedHash,
    ttsOptionsHash: request.ttsOptionsHash,
    model: request.model,
    voice: request.voice,
    language: request.language,
    speed: request.speed,
    totalStep: request.totalStep,
    silenceSeconds: request.silenceSeconds,
  });
}
```

`buildTtsRequests` sets `schemaVersion:"1.0.0"`, job ID from `loadJob`, adapter version `1.0.0`, `text` from `ttsNormalizedText`, validates every request with Plan 01's schema registry, and returns ordinal order.

- [ ] **Step 6 (3 minutes): Verify deterministic Korean and option behavior.**

Run:

```powershell
node --test test/yadam/tts-contract.test.mjs
```

Expected: all request tests pass; changing only path or test clock leaves the key unchanged; changing text, voice, speed or silence changes it.

- [ ] **Step 7 (2 minutes): Record the request-builder commit.**

Run `git status --short`. In Git, stage the Task 2 files and run:

```powershell
git commit -m "feat(yadam): build idempotent TTS scene requests"
```

---

## Task 3: Implement asynchronous Supertonic HTTP submission and polling

**Files:**
- Create: `scripts/lib/providers/supertonic-http.mjs`
- Create: `test/yadam/supertonic-http.test.mjs`

**Interfaces:**
- Consumes: Node `fetch` for bounded health/poll reads, `node:http.request` for observable POST transmission, exact `/health`, `POST /api/tts-job`, and template path ``GET /api/tts-job/${providerJobId}`` server behavior.
- Produces: `preflightSupertonicHttp`, `submitTtsJob`, `pollTtsJob`, `runAsyncTtsJob`.

- [ ] **Step 1 (5 minutes): Write the fake-server success test.**

Create a loopback `node:http` server that records method/path/body, returns `202` with `job_id:"provider-job-001"`, returns `running` once and then `done` with a result containing `path`, `audio_url`, `duration`, `sample_rate`, `model`, `voice`, `lang`, `speed`, `total_step`, `silence_duration`. Assert the `onAccepted` callback runs before the first GET.

- [ ] **Step 2 (4 minutes): Add failure-classification and ambiguous-submit tests.**

Test all of these cases:

- connect refusal yields `code:"supertonic_unreachable"`;
- HTTP 400 yields `code:"supertonic_request_rejected"` and is nontransient;
- HTTP 500 without explicit `job_created:false`, response timeout after body write and socket close after job acceptance each yield `code:"supertonic_submission_ambiguous"` and are nontransient;
- caller abort before any body byte writes yields AbortError with no orphan, while abort after body transmission first persists an orphan with `causeCode:"cancel_after_post_body"`, performs no subsequent GET/POST/CLI call and then yields AbortError;
- a fake server that creates a job and destroys the response socket receives exactly one POST, produces one orphan checkpoint and receives no CLI fallback call;
- a successful 202 whose `onAccepted` persistence callback fails yields `supertonic_submission_ambiguous` with provider job ID and `causeCode:"supertonic_checkpoint_persist_failed"`, capped emergency evidence, exactly one POST and no GET/CLI call;
- an explicit error envelope `{ok:false,job_created:false,retryable:true}` and an adapter-classified pre-connect failure are the only retryable submission failures;
- poll `status:"error"` yields `code:"supertonic_job_failed"`;
- poll 404 yields `code:"supertonic_job_lost"` with the accepted provider job ID;
- timeout after acceptance yields `code:"supertonic_poll_timeout"` and never submits a second POST;
- no request path equals `/api/tts`.

- [ ] **Step 3 (2 minutes): Run and verify the provider module is missing.**

Run:

```powershell
node --test test/yadam/supertonic-http.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `supertonic-http.mjs`.

- [ ] **Step 4 (5 minutes): Implement bounded JSON reads and health preflight.**

For `/health` and accepted-job GET polling, use `AbortSignal.any([callerSignal, AbortSignal.timeout(timeoutMs)])`, require loopback `http:` origin, set `redirect:"error"`, require JSON `content-type`, cap response text at 1 MiB, and classify status codes before parsing payload. `preflightSupertonicHttp` calls only `/health`, requires `ok:true`, and maps `output_dir`/`model_loaded` to `{baseUrl,outputDir,modelLoaded}`. Do not use opaque `fetch` transport errors to claim that a POST body was unsent.

- [ ] **Step 5 (4 minutes): Implement POST payload mapping and immediate acceptance callback.**

Map a request to the server exactly:

```js
export function toSupertonicPayload(request) {
  return {
    text: request.text,
    model: request.model,
    voice: request.voice,
    lang: request.language,
    speed: request.speed,
    total_step: request.totalStep,
    silence_duration: request.silenceSeconds,
  };
}
```

`submitTtsJob` requires status 202, `ok:true`, a nonempty `job_id`, calls `await onAccepted({providerJobId,response})`, and returns only after the callback succeeds. A callback write failure is fatal because the provider has already created a job but durable resume state is missing: emit capped emergency evidence carrying the received provider job ID and `causeCode:"supertonic_checkpoint_persist_failed"`, then throw `supertonic_submission_ambiguous`. Start neither polling nor another POST/CLI call; the façade publishes the same orphan-linked immutable needs-review contract used for other post-submission ambiguity.

Implement this POST with `node:http.request`, `agent:false`, explicit JSON `Content-Type`/byte `Content-Length`, and a 1 MiB response cap. Attach the socket before sending and delay `request.end(bodyBytes)` until a new socket emits `connect`; set `bodyStarted=true` immediately before `end`. An already-connected injected test socket takes the same transition synchronously. Only an error/timeout/abort observed while `bodyStarted===false` is proven pre-body; from the moment it flips true, every transport failure is ambiguous unless a complete parsed response explicitly states `job_created:false`. Never infer safety from an error string or zero-length response.

- [ ] **Step 6 (5 minutes): Implement bounded polling without hidden resubmission.**

`pollTtsJob` accepts only `queued`, `running`, `done`, `error`. It sleeps `pollIntervalMs` with an abort-aware timer, stops at `deadlineMs`, and returns `done.result` only when `result.ok === true`. It does not call POST. A 404 is returned to the scene orchestrator as `supertonic_job_lost` so checkpoint/file recovery can choose verified artifact reuse or needs-review; it never makes a previously accepted job safe to resubmit.

- [ ] **Step 7 (4 minutes): Add the non-duplicating submission boundary.**

`runAsyncTtsJob` records whether a POST body could have reached the server. It may retry, with total attempt cap 3 and delays 250 ms then 1000 ms, only when failure evidence proves the body was not accepted or a parsed response explicitly says `job_created:false` and `retryable:true`. Any timeout, reset, close or unqualified 5xx after body transmission becomes `supertonic_submission_ambiguous`; invoke `onAmbiguous` to atomically persist an `orphaned` checkpoint containing request hash, attempt, timestamps and capped transport evidence, then throw without another POST or CLI fallback. If the triggering condition is caller cancellation after body transmission, await the same durable `onAmbiguous` write with `causeCode:"cancel_after_post_body"` and then throw AbortError annotated with the orphan checkpoint path; never convert it to a needs-review success in the cancelling call. An abort proven to occur before body transmission writes no orphan and throws AbortError directly. Once a provider job ID has been accepted, retry only GET polling; a confirmed 404 returns to the scene orchestrator for artifact reconciliation and can lead only to verified artifact reuse or needs-review, never a new POST.

- [ ] **Step 8 (3 minutes): Run all HTTP adapter tests.**

Run `node --test test/yadam/supertonic-http.test.mjs`.

Expected: success, callback order, exactly-one-POST ambiguous failure, proven-safe retry, polling timeout and no-sync-endpoint tests pass.

- [ ] **Step 9 (2 minutes): Record the async HTTP adapter commit.**

Run `git status --short`. In Git, stage the Task 3 files and run:

```powershell
git commit -m "feat(yadam): add resumable Supertonic async HTTP client"
```

---

## Task 4: Add the local CLI fallback and owned-process cancellation

**Files:**
- Create: `scripts/lib/providers/supertonic-cli.mjs`
- Create: `test/yadam/supertonic-cli.test.mjs`
- Create: `test/yadam/fixtures/fake-supertonic-cli.mjs`
- Create: `test/yadam/fixtures/wav-fixture.mjs`

**Interfaces:**
- Consumes: verified host CLI paths, `writeUtf8Atomic`, Node `spawn`, AbortSignal.
- Produces: `preflightSupertonicCli`, `runSupertonicCli`, `terminateOwnedProcess`.

- [ ] **Step 1 (4 minutes): Create a deterministic fake CLI fixture.**

`fake-supertonic-cli.mjs` must parse the real flag names, read the UTF-8 `--input` file, write a 1-second RIFF PCM fixture to `--output`, and print one JSON object when `--json` is present. It exits 2 for an empty input and supports `FAKE_TTS_MODE=hang|exit5|success`.

- [ ] **Step 2 (5 minutes): Write preflight, argv and Korean-path tests.**

Use a temporary directory named `야담 음성 fixture`. Assert:

- executable, script and cwd must all exist;
- the executable runs `scriptPath --help` successfully within 15 seconds;
- `shell:false` and `windowsHide:true` are passed;
- Korean text is read through a file, never a command argument;
- model/voice/lang/speed/step/silence flags equal the request;
- output is the contained job-root path `assets/audio/raw/{sceneId}.part.wav`, keeping a `.wav` suffix so the real CLI selects WAV encoding;
- exit 5 includes capped stderr and `code:"supertonic_cli_failed"`.

- [ ] **Step 3 (3 minutes): Add the cancellation process-tree test.**

Start `FAKE_TTS_MODE=hang`, abort the signal, and assert the direct child exits. Inject a fake `killTree` callback and assert it runs exactly once after the configured 5-second grace when the child ignores the first termination request. Assert no final raw artifact exists.

- [ ] **Step 4 (2 minutes): Run the tests and confirm module absence.**

Run:

```powershell
node --test test/yadam/supertonic-cli.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `supertonic-cli.mjs`.

- [ ] **Step 5 (4 minutes): Implement CLI preflight and exact argv.**

Build this array without shell interpolation:

```js
export function buildSupertonicCliArgs({ scriptPath, request, inputPath, outputPath }) {
  return [
    scriptPath,
    "--input", inputPath,
    "--output", outputPath,
    "--model", request.model,
    "--voice", request.voice,
    "--lang", request.language,
    "--speed", String(request.speed),
    "--total-step", String(request.totalStep),
    "--silence-duration", String(request.silenceSeconds),
    "--json",
  ];
}
```

Reject any host path that is relative, missing, outside the configured Supertonic home, or not the exact configured file after `realpath` resolution.

- [ ] **Step 6 (5 minutes): Implement cancellation-aware owned process execution.**

Spawn `{cwd,stdio:["ignore","pipe","pipe"],shell:false,windowsHide:true}`. On abort, send the direct child a graceful termination signal, wait at most 5000 ms, then on Windows invoke `C:/Windows/System32/taskkill.exe` with `[/PID,String(pid),/T,/F]` using `shell:false` only if that exact owned child is still alive. Cap stdout and stderr at 1 MiB and reject output after the cap.

- [ ] **Step 7 (4 minutes): Implement safe text input and result parsing.**

Write `assets/audio/requests/{sceneId}.txt` with NFC text and one terminal LF through `writeUtf8Atomic`. Parse the final nonempty stdout line as JSON, require `ok:true`, and return:

```js
{
  transport: "cli",
  providerJobId: null,
  providerResult: { path: outputPartPath },
  stdoutJson: parsed,
  elapsedMs: number,
}
```

Do not rename the output; Task 5 owns validation and promotion.

- [ ] **Step 8 (3 minutes): Enforce fallback eligibility in tests.**

Add a pure `selectTtsTransport({httpPreflight,cliPreflight})` test. It returns `http` when health succeeds, `cli` only when HTTP preflight has `code:"supertonic_unreachable"` before any POST and CLI preflight passes, and throws for HTTP 400, reachable-health HTTP 500, `supertonic_submission_ambiguous`, checkpoint persistence failure, invalid output, outside-root path and both transports unavailable.

- [ ] **Step 9 (3 minutes): Run CLI adapter tests.**

Run `node --test test/yadam/supertonic-cli.test.mjs`.

Expected: preflight, Korean path, exact argv, exit, fallback eligibility and cancellation tests pass.

- [ ] **Step 10 (2 minutes): Record the CLI fallback commit.**

Run `git status --short`. In Git, stage the Task 4 files and run:

```powershell
git commit -m "feat(yadam): add safe Supertonic CLI fallback"
```

---

## Task 5: Import provider output and normalize canonical 48 kHz PCM

**Files:**
- Create: `scripts/lib/yadam/provider-audio-import.mjs`
- Create: `scripts/lib/yadam/audio-normalizer.mjs`
- Create: `test/yadam/audio-normalization.test.mjs`
- Modify: `test/yadam/fixtures/wav-fixture.mjs`

**Interfaces:**
- Consumes: provider result path or loopback audio URL, Plan 01 path policy and hashes, FFmpeg/ffprobe host paths.
- Produces: verified raw asset, normalized audio asset and normalization report row.

- [ ] **Step 1 (4 minutes): Add a 44.1 kHz stereo fixture generator.**

In the test fixture, invoke configured FFmpeg with:

```powershell
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=1.25" -ar 44100 -ac 2 -c:a pcm_s16le test\yadam\tmp\provider-stereo.wav
```

The helper must use `execFile`, not a shell string, and return the absolute path after confirming it is inside the test temp root.

- [ ] **Step 2 (5 minutes): Write failing import security tests.**

Test allowed-root HTTP file copy, valid same-origin `/audio/name.wav` download, outside-root path rejection, nonloopback URL rejection, `../` URL path rejection, non-RIFF bytes, zero-duration WAV and truncated download. Add a CLI case whose closed child wrote the exact contained `assets/audio/raw/{sceneId}.part.wav`; assert it is validated in place without allowed-provider-root lookup or self-copy. Reject a CLI result that names any other path, a symlink/junction escape, an oversized/nonregular part or a still-running writer. Assert provider source files are never deleted.

- [ ] **Step 3 (5 minutes): Write failing normalization parity tests.**

Normalize the 44.1 kHz stereo input and assert exact probe fields:

```js
assert.deepEqual(asset.media, {
  codec: "pcm_s16le",
  sampleFormat: "s16",
  sampleRate: 48000,
  channels: 1,
  channelLayout: "mono",
  durationSeconds: asset.media.durationSeconds,
});
assert.ok(asset.media.durationSeconds > 1.20 && asset.media.durationSeconds < 1.30);
assert.match(asset.rawSha256, /^[0-9a-f]{64}$/);
assert.match(asset.normalizedSha256, /^[0-9a-f]{64}$/);
```

Also abort FFmpeg midway and assert `.part` is quarantined and no normalized final exists.

- [ ] **Step 4 (2 minutes): Run and confirm both modules are absent.**

Run:

```powershell
node --test test/yadam/audio-normalization.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 5 (5 minutes): Implement transport-specific raw-part acquisition.**

Branch on the verified transport before interpreting `providerResult.path`. For HTTP, call Plan 01 `await assertAnyAllowedRealPath(allowedRoots, candidate)` so a symlink or Windows junction cannot escape the configured provider root. Open the returned real path read-only, require a regular file with size from 1 byte through 512 MiB, then stream that descriptor—not the unchecked original path—to the contained raw part while enforcing the observed-byte cap. For HTTP `audio_url`, resolve against the configured base URL and require the exact protocol, hostname, port and `/audio/` prefix; fetch with `redirect:"error"`, no credentials and an audio/octet-stream content type. Prefer a valid allowed-real-root HTTP path; use URL only when the path is absent or outside the allowed roots, and reject the scene if neither source is admissible.

For CLI, require the owned child has exited successfully and `providerResult.path` resolves to exactly the precomputed `assertPathWithin(jobDir, rawPartPath)` value `assets/audio/raw/{sceneId}.part.wav`. Re-resolve its existing real path under the job root, reject a symlink/junction mismatch, require a regular 1-byte-through-512-MiB file, and do not copy it onto itself or consult provider allowed roots. Both HTTP copy/download modes create an absent/exclusively prepared raw part; all three modes close source/destination handles, flush and sync the raw part, enforce observed byte/content-length bounds, then pass that same contained path to Step 6.

- [ ] **Step 6 (4 minutes): Validate raw WAV before promotion.**

Read the first 12 bytes and require ASCII `RIFF` at bytes 0–3 and `WAVE` at bytes 8–11. Run ffprobe:

```js
[
  "-v", "error",
  "-show_entries", "stream=index,codec_type,codec_name,sample_fmt,sample_rate,channels,channel_layout:format=duration",
  "-of", "json", rawPartPath,
]
```

Filter the returned stream array by `codec_type === "audio"`, require exactly one audio stream and no non-audio stream, and require finite duration > 0. This full-stream probe—not `-select_streams a:0`—makes the cardinality assertion testable. Hash the `.part`, atomically rename it to `assets/audio/raw/{sceneId}.wav`, and return provider path/URL only under `provenance`.

- [ ] **Step 7 (5 minutes): Implement canonical PCM normalization.**

Set `normalizedPartPath` to the contained same-directory path `assets/audio/normalized/{sceneId}.part.wav`, then spawn FFmpeg with exact arguments:

```js
[
  "-y", "-v", "error", "-i", rawPath,
  "-map", "0:a:0", "-vn", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "1",
  normalizedPartPath,
]
```

After FFmpeg closes, flush/sync the part and probe it with the same field selection. Require codec `pcm_s16le`, sample format `s16`, sample rate numeric 48000, channels numeric 1, channel layout `mono` or an empty value only when channels is exactly 1, and duration > 0. Record canonical channel layout `mono`, hash, then perform one same-directory atomic rename. A failed probe or cancellation quarantines/removes the part and never exposes a canonical WAV.

- [ ] **Step 8 (4 minutes): Return and record the complete normalization row.**

Use this exact shape:

```js
{
  sceneId: request.sceneId,
  segmentId: request.segmentId,
  order: request.order,
  sourceHash: request.sourceHash,
  ttsNormalizedHash: request.ttsNormalizedHash,
  ttsOptionsHash: request.ttsOptionsHash,
  transport,
  providerJobId,
  rawPath: relativeRawPath,
  rawSha256,
  normalizedPath: relativeNormalizedPath,
  normalizedSha256,
  media: {
    codec: "pcm_s16le",
    sampleFormat: "s16",
    sampleRate: 48000,
    channels: 1,
    channelLayout: "mono",
    durationSeconds,
  },
  attempts,
  elapsedMs,
  providerProvenance,
}
```

Sort the accumulated rows by scene order, reject duplicates/missing approved scene IDs, and build the closed report with dependency hashes for every request, raw and normalized artifact. Validate it with `audio-normalization-report.schema.json`, write `assets/audio/normalization-report.json` through `writeCanonicalJson`, re-read/hash it, and return its job-relative path/hash with the rows. Task 6 registers `yadam.audio.normalization_report` only after every referenced file and dependency rehashes successfully.

- [ ] **Step 9 (3 minutes): Run import and normalization tests.**

Run `node --test test/yadam/audio-normalization.test.mjs`.

Expected: 44.1 kHz stereo converts to exact 48 kHz mono PCM; every security and abort fixture produces the specified error and no promoted invalid asset.

- [ ] **Step 10 (2 minutes): Record the audio importer commit.**

Run `git status --short`. In Git, stage the Task 5 files and run:

```powershell
git commit -m "feat(yadam): verify and normalize provider audio"
```

---

## Task 6: Add scene checkpoints, orphan recovery and exact audio coverage

**Files:**
- Create: `scripts/lib/yadam/tts-checkpoint.mjs`
- Create: `test/yadam/tts-resume.test.mjs`
- Modify: `scripts/lib/yadam/tts-service.mjs`

**Interfaces:**
- Consumes: Tasks 2–5, `canReuseArtifact`, `registerArtifact`, `updateCoverageSection`, pipeline state.
- Produces: internal `runSceneBatch`, passed `audio-manifest.json`, durable scene resume semantics.

- [ ] **Step 1 (5 minutes): Write the checkpoint transition test.**

Assert the exact successful status sequence:

```text
pending -> submitted -> polling -> provider_done -> raw_verified -> normalized
```

Assert `providerJobId` is present from `submitted` onward for HTTP, null for CLI, `attempt` never exceeds 3, and a transition backward or from `normalized` to `submitted` throws `illegal_tts_checkpoint_transition`.

- [ ] **Step 2 (5 minutes): Write idempotent resume tests.**

Cover these fixtures:

1. normalized file and all hashes valid: zero HTTP/CLI calls;
2. checkpoint says normalized but file hash differs: quarantine file and rerun one scene;
3. HTTP checkpoint has provider job ID and GET returns done: no POST;
4. GET returns 404 and verified raw exists: import/normalize from raw, no POST;
5. GET returns 404 and verified normalized exists: reuse, no POST;
6. GET returns 404 and neither file exists: preserve the accepted job ID as orphan evidence, return `supertonic_submission_ambiguous` needs-review, and perform no POST or CLI fallback;
7. two concurrent runners for one scene: one exclusive lock winner and one `tts_scene_locked` error.
8. a lock older than 300 seconds with a proven-dead PID is quarantined and retried once; a live or indeterminate PID is never reclaimed, and a stale different-request lock still forces checkpoint/orphan reconciliation before POST.

- [ ] **Step 3 (4 minutes): Write cancellation and ambiguous-orphan tests.**

Abort while an HTTP job is running. Assert polling stops, checkpoint becomes `orphaned`, state appends `{provider:"supertonic",providerJobId,sceneId,requestHash}` to `orphanedProviderJobs`, no asset is promoted, and the next resume starts with GET. Abort an in-flight POST once before body transmission and once after the fake server receives the body: the first writes no orphan, while the second persists `providerJobId:null`, `code:"supertonic_submission_ambiguous"`, `causeCode:"cancel_after_post_body"` and capped evidence before the call rethrows AbortError; neither path makes a fallback call and the latter cannot POST on resume. Also simulate a server that creates a job then drops the POST response: persist an `orphaned` checkpoint with `providerJobId:null`, `code:"supertonic_submission_ambiguous"`, request hash, attempt and capped transport evidence; current and resumed runs perform no second POST, no CLI fallback, transition state to `needs_review` and throw that structured code until an operator reconciles provider output. Abort during CLI or FFmpeg and assert owned process termination and `.part` quarantine.

- [ ] **Step 4 (4 minutes): Write audio coverage equality tests.**

Expected IDs come from the exact approved input. Passed IDs come only from normalized rows. Assert missing, duplicate and orphan IDs each fail. A passing report has:

```js
{
  expectedAudioSceneIds: ["scene-0001", "scene-0002"],
  passedNormalizedWavSceneIds: ["scene-0001", "scene-0002"],
  missingAudioSceneIds: [],
  duplicateAudioSceneIds: [],
  orphanAudioSceneIds: [],
  qualityOk: true,
}
```

- [ ] **Step 5 (2 minutes): Run and verify checkpoint module absence.**

Run `node --test test/yadam/tts-resume.test.mjs`.

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `tts-checkpoint.mjs`.

- [ ] **Step 6 (5 minutes): Implement exclusive locks and atomic checkpoints.**

Open `assets/audio/checkpoints/{sceneId}.lock` with exclusive create, store `{pid,leaseId,requestHash,startedAt}`, and release it in `finally` only after re-reading the caller's lease ID. Reclaim only when age exceeds 300 seconds and `process.kill(pid,0)` proves the PID absent: atomically move the old lock to `quarantine/locks/tts-{sceneId}-{leaseId}.json` and retry acquisition once. A live/indeterminate PID returns `tts_scene_locked`; a differing stale request hash is preserved in quarantine and forces checkpoint/provider reconciliation before any new submission. Validate every checkpoint write against its schema before `writeCanonicalJson`.

- [ ] **Step 7 (5 minutes): Implement resume-first scene execution.**

Use this decision order without reordering:

```text
validate normalized asset -> validate raw asset -> resume accepted provider job -> select new transport -> submit/generate -> import raw -> normalize -> register artifacts
```

Before entering that decision tree, schema-validate the direct request object, publish it to `assets/audio/requests/{sceneId}.json` with `writeCanonicalJson`, and require the returned SHA-256 to equal the canonical request hash used by the checkpoint and provider evidence. Register `yadam.tts.request.{sceneId}` with current approval, script-scenes, scene-plan/profile and TTS-options dependencies, then re-read it; no provider preflight or submission may begin from an in-memory-only, unregistered or stale request. On repair, changed request paths are invalidated/rebound while byte-identical unchanged requests may pass the normal reuse gate.

For an accepted HTTP job, poll GET first. On 404, repeat normalized/raw validation under the same scene lock. Reuse a valid artifact when present; if both are absent, atomically preserve the accepted provider job ID plus `code:"supertonic_submission_ambiguous"` as orphan evidence, publish the immutable needs-review report and stop without another POST or CLI fallback. A known job ID proves the prior submission created a job, so a later 404 is not a safe-resubmission signal. Reuse requires request hash, idempotency key, source hash, TTS normalized hash, options hash, on-disk hash and `gateStatus:"pass"` equality.

Handle an `orphaned` checkpoint with `providerJobId:null` and `code:"supertonic_submission_ambiguous"` before transport selection. It is never resubmitted or switched to CLI automatically; record a structured needs-review reason and leave the checkpoint evidence intact.

- [ ] **Step 8 (5 minutes): Implement sequential batch and retry budgets.**

Sort requests by ordinal and run one scene at a time. Check `signal.aborted` and job `cancel_requested` before every new provider or FFmpeg submission. Persist attempt count before each proven-safe retry and stop after attempt 3. Submission ambiguity, invalid WAV, invalid option, forbidden path, schema and hash failures transition directly to needs-review/failed without another provider or fallback call.

- [ ] **Step 9 (5 minutes): Publish audio manifest and shared coverage.**

After all scenes normalize, write `assets/audio/audio-manifest.json` atomically with approval revision path, final/script scene hashes, request hashes, normalization report hash, accepted range, scene rows and measured sum. Register every request/raw/normalized/report/manifest artifact. Call:

```js
const coverage = await updateCoverageSection({ jobDir, section: "audio", report: audioCoverageReport });
```

Require returned `sections.audio === "pass"`, `sectionArtifact.section === "audio"`, a current passed role `yadam.coverage.audio` whose path/hash/revision exactly match that object, and the new aggregate hash; `complete` may still be false while subtitle/visual sections are pending. Reject any other audio section state and do not silently preserve a prior audio coverage section. Register the audio-section hash as an `AUDIO_PASSED` output dependency.

- [ ] **Step 10 (4 minutes): Run checkpoint and coverage tests.**

Run:

```powershell
node --test test/yadam/tts-resume.test.mjs
```

Expected: all seven resume fixtures, lock contention, cancellation/orphan and set-equality tests pass with the exact provider call counts.

- [ ] **Step 11 (2 minutes): Record the durable scene-runner commit.**

Run `git status --short`. In Git, stage the Task 6 files and run:

```powershell
git commit -m "feat(yadam): checkpoint and resume TTS scenes"
```

---

## Task 7: Build the measured audio timeline and unresolved render-plan input

**Files:**
- Create: `scripts/lib/yadam/audio-timeline.mjs`
- Create: `test/yadam/audio-timeline.test.mjs`
- Modify: `scripts/lib/yadam/tts-service.mjs`

**Interfaces:**
- Consumes: passed audio manifest, approved scene-plan artifact, target/profile timing policy.
- Produces: passed `audio-timeline.json`, an in-memory unresolved render-plan candidate, `publishRenderPlanInput` for the duration/approval gate, and `loadPassedAudioHandoff` timing rows.

- [ ] **Step 1 (5 minutes): Write scene and segment accumulation tests.**

Use durations 5.25, 7.50 and 22.25 seconds across two segments. Assert scene 1 starts at 0, every later start equals the prior end, the total is 35.0, each segment measured duration equals its scene sum, planned duration is 600, and no value is rounded to an integer.

- [ ] **Step 2 (5 minutes): Write intro/body partition tests.**

For a synthetic 600-second first segment, assert 10 intro slots cover `[0,60)`, 18 body slots cover `[60,600)`, intro slot duration is 6, body duration is 30, the last end is exactly 600, and every slot has a distinct stable ID. For a 600-second second segment starting at 600, assert every slot is `body`.

- [ ] **Step 3 (5 minutes): Write M≠N and source mapping tests.**

Create 12 audio scenes and 4 visual slots. Assert each slot contains every temporally intersecting scene ID, `primarySceneId` is the row with the largest overlap and lowest ordinal on a tie, every audio scene overlaps at least one slot, and no positional join assumption exists. Add one long audio scene split across three intro slots and assert the same scene ID appears in all three.

- [ ] **Step 4 (4 minutes): Write CTA and short-tail hold tests.**

Mark an intro audio row `narrativeRole:"cta"`. Assert no visual slot uses it as the primary grounding scene, the prior hook slot extends over the CTA interval with `extendedHold:true` and `holdReason:"cta"`. For a body tail shorter than 20 seconds, assert the prior slot extends with `holdReason:"short_tail"` instead of creating an extra visual slot.

- [ ] **Step 5 (3 minutes): Add strict continuity and forbidden-field tests.**

Assert first start absolute value <= 0.01, adjacent gap/overlap <= 0.01, `abs(duration-(end-start)) <= 0.01`, final end/audio delta <= 0.05, and visual count <= profile max 260. Assert the serialized render-plan candidate contains none of `imagePath`, `imageSha256`, `providerJobId`, `compiledRequestId`. Before the duration gate, assert `render-plan-input.json` and role `yadam.render_plan_input` do not exist while the passed audio timeline does.

- [ ] **Step 6 (2 minutes): Run and confirm the timeline module is absent.**

Run:

```powershell
node --test test/yadam/audio-timeline.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `audio-timeline.mjs`.

- [ ] **Step 7 (5 minutes): Implement exact scene and segment accumulation.**

Sort by approved global ordinal. Use unrounded finite ffprobe durations for arithmetic; round only diagnostic JSON display fields to six decimal places after assertions. Fail duplicate/missing ordinals, nonpositive durations, segment order regression and measured-total mismatch greater than 0.05 seconds.

```js
export function buildAudioTimeline(rows) {
  let cursor = 0;
  const scenes = rows.map((row, index) => {
    if (row.order !== index + 1 || !(row.media.durationSeconds > 0)) {
      throw Object.assign(new Error("invalid_audio_timeline_input"), { code: "invalid_audio_timeline_input" });
    }
    const startSeconds = cursor;
    const endSeconds = startSeconds + row.media.durationSeconds;
    cursor = endSeconds;
    return { ...row, durationSeconds: row.media.durationSeconds, startSeconds, endSeconds };
  });
  return { scenes, measuredAudioSeconds: cursor, audioTempoFactor: 1 };
}
```

- [ ] **Step 8 (5 minutes): Implement deterministic span partitioning.**

For each span, choose `count = max(1, round(total/target))`, decrement while `total/count < min` and count > 1, increment while `total/count > max`, then divide evenly. Use `{min:5,target:6,max:7}` only for global time below 60 and `{min:20,target:30,max:40}` elsewhere. Never cross logical segment boundaries. Merge only the explicitly tested CTA and short-tail cases.

- [ ] **Step 9 (5 minutes): Attach source scene IDs and stable visual IDs.**

Use half-open overlap `audio.startSeconds < slot.endSeconds && audio.endSeconds > slot.startSeconds`. Sort sources by audio ordinal. Select primary by descending overlap then ascending ordinal. Generate global IDs `visual-slot-0001` through `visual-slot-0260`; IDs do not depend on image paths or provider state.

- [ ] **Step 10 (5 minutes): Publish audio timing and stage the unresolved render candidate.**

Write/register `assets/audio/audio-timeline.json` with gate pass before any duration-repair call. Build, schema-validate and return the unresolved render candidate in memory; it contains output 1920×1080 at 24 FPS, script hashes, audio manifest/timeline hashes, scene audio rows, segment boundaries, visual slots, and `subtitleSources` with `{sceneId,sourceText,sourceHash,startSeconds,endSeconds}`. Include planning notices for segment durations outside 480–720 but do not set a failing gate for those notices. Implement `publishRenderPlanInput({jobDir,candidate,currentApproval})` to reverify the current approval/dependencies, write/register root `render-plan-input.json` with gate pass, and call it only from Task 8's in-range valid-approval branch; an out-of-range or approval-invalid run leaves no current file/role.

- [ ] **Step 11 (3 minutes): Run timeline and schema tests.**

Run `node --test test/yadam/audio-timeline.test.mjs`.

Expected: accumulation, 28-slot 10-minute case, later-segment body policy, M≠N mapping, CTA hold, short-tail hold, continuity, forbidden-field and pre-duration-gate absence tests all pass.

- [ ] **Step 12 (2 minutes): Record the measured-timeline commit.**

Run `git status --short`. In Git, stage the Task 7 files and run:

```powershell
git commit -m "feat(yadam): derive render timing from measured audio"
```

---

## Task 8: Enforce one duration repair and approval-2 reapproval

**Files:**
- Modify: `scripts/lib/yadam/tts-service.mjs`
- Create: `scripts/lib/yadam/tts-service-core.mjs`
- Create: `scripts/lib/yadam/audio-needs-review.mjs`
- Create: `test/yadam/duration-repair-tts.test.mjs`

**Interfaces:**
- Consumes: Plan 02 `requestDurationRepair` and `rebuildApproval2AfterDurationRepair`, Plan 04 `refreshApproval2Previews`, Tasks 6–7.
- Produces: exact one-repair orchestration, immutable needs-review evidence and `awaiting_reapproval` public result.

- [ ] **Step 1 (4 minutes): Write the no-repair pass test.**

For target 10 minutes and measured 599.5 seconds, assert accepted range `{minimum:480,maximum:720}`, zero repair calls, current approval unchanged, artifacts published/re-read, one terminal `AUDIO_PASSED` event after artifact verification, and `runFullTts` returns `status:"audio_passed"`. Independently recompute the locked input/output formulas from shuffled registry records and reverse-ordered opaque keys; require the exact four sorted paths including current audio-coverage revision plus matching event fields. A second identical call performs no transition; changing any artifact hash or each of `profileHash`, `ttsProviderContractHash`, and `normalizerVersionHash` separately changes `inputHash`, changing any output hash changes `outputHash`, and seeding the same stage/input with a different output/path set fails `success_evidence_conflict`. Reject an extra/missing opaque key or non-lowercase/non-64-hex value. A missing event or event written before re-read fails the test.

- [ ] **Step 2 (5 minutes): Write the successful repair/reapproval test.**

Start at 760 seconds. Stub `requestDurationRepair` with the exact `status:"repaired"` contract and changed scenes `scene-0003`, `scene-0004`. Provide the exact signed/hash-linked repair report and repaired script scenes, rerun only two scene requests, obtain 680 seconds, assert state becomes `REBUILDING_APPROVAL_2_BUNDLE`, refresh only affected preview roles, then assert `rebuildApproval2AfterDurationRepair` is called once, state becomes `AWAITING_APPROVAL_2`, and the public result is `awaiting_reapproval`. Assert no `audio_passed` result occurs in this run.

- [ ] **Step 3 (4 minutes): Write exhausted and semantic-change branch tests.**

Test `needs_review`, `approval1_invalidated`, and repaired audio still at 730 seconds. Each must transition to a terminal review state, submit no image production job, build no approval-2 revision, and return the exact public `reason/errorCode/reportPath`. Validate/re-hash the closed report, require the deterministic 12-character input-hash suffix, pass registry record and zero duplicate report writes on the same input. Advance the injected clock before an identical retry and assert the same stored report/hash/original `createdAt` is reused; changing one evidence hash must derive a different path.

- [ ] **Step 4 (5 minutes): Write private repair authorization tests.**

`loadAuthorizedRepairTtsInput` must reject:

- state stage other than `REGENERATING_CHANGED_AUDIO`;
- missing/duplicate reservation row, reservation `to`/attempt mismatch, or row/report/recomputed `durationRepairInputHash` disagreement;
- report attempt other than 1;
- unregistered or non-pass report;
- report file hash mismatch;
- `authorizationHash`, `changedSceneSetHash`, measurement source artifact/hash or accepted-range mismatch;
- before hash not matching the invalidated approval-2 revision;
- before/after `scriptCoverageHash` missing, a forbidden `coverageReportHash`/unknown nested field, or after hashes not matching current final text, `script-scenes.json`, scene plan, QA and current passed `yadam.coverage.script`;
- changed-scene set mismatch, duplicates or unlisted scene read;
- TTS normalized text/hash/options hash mismatch.

Assert it returns only the exact changed rows when all evidence passes. The valid closed fixture contains `scriptCoverageHash` in both `before` and `after`; deleting either, swapping pre/post values, changing the current script section, adding `coverageReportHash`, or adding another unknown nested field fails schema/authorization before a TTS request is built. Updating only audio coverage and the derived aggregate after the loader succeeds must leave the repair-report record passed for Plan 04/02 consumers.

- [ ] **Step 5 (4 minutes): Write resume-after-user-reapproval test.**

After a new approval-2 revision is present, call `runFullTts` again. `getApprovedTtsInput` now succeeds with repaired hashes; all normalized WAVs are reused, no provider call occurs, render-plan input is re-bound to the new approval hash, and the result is `audio_passed`.

- [ ] **Step 6 (2 minutes): Run and verify repair orchestration is not implemented.**

Run:

```powershell
node --test test/yadam/duration-repair-tts.test.mjs
```

Expected: FAIL on the first missing repair branch assertion.

- [ ] **Step 7 (5 minutes): Create the exact private dependency-injection seam.**

`scripts/lib/yadam/tts-service-core.mjs` exports `createTtsService` for focused tests, but `tts-service.mjs` does not re-export it. Its constructor requires the concrete Plan 01/02 functions and a preview refresh callback:

```js
export function createTtsService({
  loadJob,
  getApprovedTtsInput,
  requestDurationRepair,
  rebuildApproval2AfterDurationRepair,
  refreshApproval2Previews,
  publishAudioNeedsReview,
  runSceneBatch,
  buildAndPublishAudioTimeline,
  publishRenderPlanInput,
  now,
}) {
  if (typeof refreshApproval2Previews !== "function") {
    throw Object.assign(new Error("preview refresh dependency is required"), { code: "preview_refresh_dependency_missing" });
  }
  if (typeof publishAudioNeedsReview !== "function") {
    throw Object.assign(new Error("needs-review publisher is required"), { code: "needs_review_publisher_missing" });
  }
  if (typeof publishRenderPlanInput !== "function") {
    throw Object.assign(new Error("render-plan publisher is required"), { code: "render_plan_publisher_missing" });
  }
  if (typeof now !== "function") {
    throw Object.assign(new Error("clock dependency is required"), { code: "clock_dependency_missing" });
  }
  return { runFullTtsCore, loadPassedAudioHandoffCore };
}
```

The production `tts-service.mjs` supplies a lazy callback that imports `image-service.mjs` only when the repaired-in-range branch invokes it. Task 8 tests import `createTtsService` directly and inject a fake callback, so they pass before Plan 04 exists. A missing Plan 04 module in a live repair run is a hard `preview_refresh_dependency_missing` failure, never a reused preview or production fallback.

- [ ] **Step 8 (5 minutes): Implement accepted-range and first duration decision.**

Compute `minimum = targetMinutes*60*0.8` and `maximum = targetMinutes*60*1.2`. Transition through `CHECKING_MEASURED_DURATION`. The audio manifest/timeline are already passed evidence. If inside inclusive bounds and approval 2 is still current, call Task 7 `publishRenderPlanInput` and continue to `PRODUCTION_READY`. If outside, leave `render-plan-input.json` absent and call `requestDurationRepair` exactly once with the object fixed in the consumed interface.

- [ ] **Step 9 (5 minutes): Implement the private repair loader.**

Keep `loadAuthorizedRepairTtsInput` unexported. Read state, registered repair-report record, report, invalidated approval revision, measurement audio manifest and current repaired final/script/scene-plan/QA/script-coverage artifacts, plus the aggregate only to verify its current script binding. Validate the exact closed report shape including `scriptCoverageHash` in `before` and `after` and forbidding aggregate/downstream coverage hashes; recompute the report's RFC 8785 `authorizationHash`, ordered `changedSceneSetHash`, every dependency/file hash and exact changed-set equality before constructing changed request rows. Do not call `getApprovedTtsInput` while approval 2 is invalid.

- [ ] **Step 10 (5 minutes): Regenerate only changed audio and remeasure all audio.**

Invalidate any existing `yadam.render_plan_input` record and quarantine its fixed-path file before changed-audio work. Invalidate request/raw/normalized rows whose scene ID is changed, preserve unchanged rows only when their dependency hashes still pass, run changed scenes, rebuild and register the entire audio manifest/timeline from passed rows, and recheck the inclusive range. Store repair attempt 1 in state so resume cannot receive another repair budget. When the repaired duration passes, transition from `REGENERATING_CHANGED_AUDIO` to `REBUILDING_APPROVAL_2_BUNDLE` before invoking any Plan 04 refresh.

- [ ] **Step 11 (5 minutes): Refresh dependent previews before rebuilding approval 2.**

Dynamically import `refreshApproval2Previews` only on the repaired-in-range branch and require state stage `REBUILDING_APPROVAL_2_BUNDLE`. If it throws Plan 04's exact typed `{code:"duration_refresh_scope_expanded",stage:"duration_preview_refresh",inputHash}` error, call neither `rebuildApproval2AfterDurationRepair` nor normal preview/image generation, add no Plan 03 report path, and rethrow it unchanged so Plan 06 alone writes the durable needs-review outcome report. Test that this branch performs zero further provider/bundle/audio-success work. After a successful refresh, read `previews/preview-manifest.json`, rehash every returned path and require the listed dependency hash to include the repaired scene or scene-plan dependency closure. Then call:

```js
await rebuildApproval2AfterDurationRepair({ jobDir, changedSceneIds, signal });
```

Require `status:"awaiting_reapproval"` and verify Plan 02 has set stage `AWAITING_APPROVAL_2` with state status `awaiting_approval`; do not apply a second/invented transition. Return the public result without publishing `render-plan-input.json` as passed.

- [ ] **Step 12 (4 minutes): Implement all terminal review branches.**

Create `scripts/lib/yadam/audio-needs-review.mjs` with `publishAudioNeedsReview({jobDir,errorCode,createdAt,measuredAudioSeconds,acceptedRangeSeconds,repairAttempt,providerOrphan,evidence})`; `createdAt` comes from the service's injected UTC clock and is never read inside the helper. Normalize every evidence path to a contained job-relative `/` path, require unique artifact IDs, sort by artifact ID then path, and derive `dependencyHashes = Object.fromEntries(evidence.map(({artifactId,sha256}) => [artifactId,sha256]))`. Derive `inputHash = hashCanonical({reportType:"yadam_audio_needs_review",jobId,errorCode,measuredAudioSeconds,acceptedRangeSeconds,repairAttempt,providerOrphan,evidence:evidence.map(({artifactId,path,sha256}) => ({artifactId,path,sha256})),dependencyHashes})`; callers cannot supply either `inputHash` or `dependencyHashes`. Derive the hash-addressed path. Under the job lock, resolve `assets/audio/reviews` from the verified job root, reject a pre-existing non-directory or reparse-point escape, create the contained parent with `mkdir({recursive:true})` when absent, then re-resolve and recheck containment immediately before the exclusive write. On first publication use the injected `createdAt` and `writeCanonicalJsonExclusive`; on an existing path, validate the stored report/schema/input hash/registry and reuse its original `createdAt` when every hash-bound field matches, without comparing it to the retry clock. Register `yadam.audio.needs_review`, re-read bytes/registry and return `{errorCode,reportPath,reportHash}`. Map Plan 02 `needs_review` to `duration_repair_failed`, `approval1_invalidated` to the same named public reason, and repaired duration outside bounds to `repaired_duration_out_of_range`; publish evidence and return `{status:"needs_review",reason:errorCode,errorCode,reportPath}`. In every branch, stop provider submission, preserve diagnostics, mark unapproved repaired downstream artifacts invalidated, and set state status `needs_review`.

- [ ] **Step 13 (4 minutes): Run duration-repair tests.**

Run `node --test test/yadam/duration-repair-tts.test.mjs`.

Expected: pass, repaired-in-range, three terminal branches, private authorization failures and post-reapproval reuse all pass with exact call counts.

- [ ] **Step 14 (5 minutes): Run the post-Plan-04 live repair integration gate.**

After Plan 04 is implemented, run the integration fixture without real GPU generation:

```powershell
node --test --test-name-pattern "repair refreshes affected previews before reapproval" test/yadam/duration-repair-tts.test.mjs
```

Expected: the public lazy import resolves the real `refreshApproval2Previews`, only dependency-affected preview roles are rebuilt by the fake provider layer, and Plan 02 receives the refreshed manifest before creating the next approval-2 bundle. Before Plan 04 exists this gate is not run; the independent DI tests above remain mandatory.

- [ ] **Step 15 (2 minutes): Record the duration-repair commit.**

Run `git status --short`. In Git, stage the Task 8 files and run:

```powershell
git commit -m "feat(yadam): require reapproval after TTS duration repair"
```

---

## Task 9: Finish the public façade, CLI, cancellation and integration verification

**Files:**
- Modify: `scripts/lib/yadam/tts-service.mjs`
- Create: `scripts/run_yadam_tts.mjs`
- Modify: `test/yadam/tts-resume.test.mjs`
- Modify: `test/yadam/duration-repair-tts.test.mjs`

**Interfaces:**
- Consumes: all preceding tasks and current approval/hash state.
- Produces: the two locked public exports, manual run/status CLI and a Plan 04-ready passed handoff.

- [ ] **Step 1 (4 minutes): Add public return-shape tests.**

Assert `Object.keys(await import("../../scripts/lib/yadam/tts-service.mjs")).sort()` equals `['loadPassedAudioHandoff','runFullTts']` and import Plan 01 `success-evidence.mjs` without a local duplicate. Assert job-relative slash-normalized artifact paths, lowercase hashes, numeric duration and exact status union fields; reject an absolute path or extra public export. For all four needs-review reasons assert `errorCode===reason`, the immutable report exists/rehashes/passes registry, and no `AUDIO_PASSED` event exists. A pristine fixture with no `assets/audio/reviews` directory must create it and publish successfully; a file/junction escape at that parent must fail before the report or registry row is written.

- [ ] **Step 2 (5 minutes): Add handoff tamper and approval tests.**

After a passing run, mutate one normalized WAV byte, one manifest dependency hash, the current approval pointer, and render-plan input image fields in separate fixtures. Each call to `loadPassedAudioHandoff` must throw `audio_handoff_not_passed`. A valid handoff must include exact scene, segment and visual slot arrays and `audioTempoFactor:1`.

- [ ] **Step 3 (4 minutes): Add CLI parser tests.**

Support only:

```text
run --job-dir C:/Users/petbl/auto-video/test/yadam/tmp/approved-job
status --job-dir C:/Users/petbl/auto-video/test/yadam/tmp/approved-job
```

Reject relative job paths, duplicate/unknown flags and a path outside the workspace/test temp roots. Print one final JSON object with `ok`, `command`, `status` and artifact paths or a structured `{code,message}` error.

- [ ] **Step 4 (3 minutes): Add cancel-before-submit and cancel-between-scenes tests.**

Set state `cancel_requested` before run and after the first scene. Assert respectively zero and one provider submission, no later scene starts, no passed manifest is published, and state becomes `cancelled` only after owned local processes stop and HTTP provider jobs are recorded as orphaned.

- [ ] **Step 5 (5 minutes): Implement `runFullTts` as a narrow orchestration façade.**

The public function validates job/profile/state, calls `getApprovedTtsInput` only when approval 2 is valid, executes Tasks 2–8, and returns only the documented union. On the passed branch, call `loadPassedAudioHandoff`, resolve only the locked three input and four output roles including current `yadam.coverage.audio`, derive the exact three opaque pin hashes, call Plan 01 `buildSuccessEvidence("AUDIO_PASSED",inputRecords,outputRecords,opaqueInputs)`, append or reuse that exact `AUDIO_PASSED` row, re-read state history and only then return. On exact event reuse, verify/repair only the derived aggregate audio binding before returning and never resubmit TTS. Catch internal `supertonic_submission_ambiguous` only to publish/re-read its orphan-linked immutable needs-review report and return the exact public union; do not retry or fallback. Catch AbortError only to finish cancellation bookkeeping, first requiring any annotated post-body orphan checkpoint to rehash and appear in state, then rethrow AbortError. All other structured failures remain thrown and cancellation is never converted into success or needs-review.

- [ ] **Step 6 (5 minutes): Implement `loadPassedAudioHandoff`.**

Require current approval hash equality, passed artifact registry rows, exact file hashes, dependency hashes, current `yadam.coverage.audio` `qualityOk:true`, aggregate audio binding equality, accepted duration, exact audio format, timing continuity, every audio scene intersecting a visual slot, and no forbidden render-plan-input fields. Return only job-relative slash-normalized paths after resolving and containing them for verification.

- [ ] **Step 7 (4 minutes): Implement the standalone run/status CLI.**

Use Plan 01's closed CLI parser pattern. `run` creates an AbortController for Ctrl+C and calls `runFullTts`; `status` calls `loadPassedAudioHandoff` and reports `audio_passed` or a structured non-pass reason without starting work. Use `process.exitCode=1` for failure, 130 for cancellation and 0 only for documented success or awaiting user reapproval.

- [ ] **Step 8 (4 minutes): Run the complete fake-provider suite.**

Run:

```powershell
node --test test/yadam/tts-contract.test.mjs test/yadam/supertonic-http.test.mjs test/yadam/supertonic-cli.test.mjs test/yadam/audio-normalization.test.mjs test/yadam/tts-resume.test.mjs test/yadam/audio-timeline.test.mjs test/yadam/duration-repair-tts.test.mjs
```

Expected: all tests pass, no live HTTP/CLI/GPU generation occurs, and no file outside test temp roots changes.

- [ ] **Step 9 (3 minutes): Run the package regression suite.**

Run:

```powershell
npm run test:yadam
```

Expected: all Plan 01–03 yadam tests pass with 0 failures.

- [ ] **Step 10 (5 minutes): Run the opt-in one-sentence live async smoke.**

Only after the user opts in, run:

```powershell
$env:YADAM_LIVE_TTS='1'
node --test --test-name-pattern "live one-sentence async smoke" test/yadam/supertonic-http.test.mjs
$testExit = $LASTEXITCODE
Remove-Item Env:YADAM_LIVE_TTS
if ($testExit -ne 0) { exit $testExit }
```

Expected: the test calls `/api/tts-job`, records a provider job ID before polling, imports one WAV, normalizes it to 48 kHz mono PCM, reports duration > 0, and leaves the provider-owned source untouched. It must skip with exit 0 when the environment variable is absent.

- [ ] **Step 11 (2 minutes): Record the façade task commit.**

Run `git status --short`. In Git, stage the Task 9 files and run:

```powershell
git commit -m "feat(yadam): expose measured-audio TTS service"
```

---

## Plan 03 Completion Gate

- [ ] `npm run test:yadam` exits 0 with no live provider access.
- [ ] Production code contains no call to synchronous `/api/tts`.
- [ ] Every accepted HTTP provider job ID is checkpointed before its first GET.
- [ ] An ambiguous POST response produces exactly one POST, an orphan checkpoint, no automatic POST/CLI retry and a re-readable public needs-review report path.
- [ ] Caller cancellation after POST-body transmission durably records the same no-resubmit orphan before AbortError is rethrown.
- [ ] GET 404 checks valid normalized/raw assets first; when both are absent it preserves orphan evidence and returns needs-review without POST or CLI resubmission.
- [ ] CLI fallback occurs only after an unreachable HTTP health preflight and successful CLI preflight.
- [ ] Existing provider paths pass allowed-root realpath checks; provider paths remain provenance and all production audio paths are under the job root.
- [ ] CLI fallback writes only the pre-contained job-root `.part.wav`; it never enters provider allowed-root lookup or self-copy.
- [ ] Raw/normalized WAVs are published only from synced same-directory `.part.wav` files after full validation and hashing.
- [ ] Every passed WAV is `pcm_s16le`, `s16`, 48 kHz, mono and duration > 0.
- [ ] The closed normalization report rehashes every request/raw/normalized dependency before audio-manifest publication.
- [ ] expected audio scene IDs equal passed normalized WAV scene IDs with missing, duplicate and orphan counts all zero.
- [ ] Audio, segment and visual slot timelines are continuous and end within 0.05 seconds of measured audio.
- [ ] `render-plan-input.json` contains no image/provider/compiled-request output fields.
- [ ] yadam `audioTempoFactor` is exactly 1.
- [ ] `readSlow` remains hash-bound metadata and never changes v1 speed from 1.04.
- [ ] Out-of-range audio receives at most one constrained repair, changed-scene-only TTS regeneration, affected preview refresh and a new approval-2 revision bundle.
- [ ] Repaired content cannot return `audio_passed` until the new approval-2 revision is user-approved.
- [ ] Repair state order is exactly `REGENERATING_CHANGED_AUDIO` → `REBUILDING_APPROVAL_2_BUNDLE` → `AWAITING_APPROVAL_2`.
- [ ] Abort stops new submissions, terminates owned CLI/FFmpeg processes, records HTTP orphans and promotes no partial asset.
- [ ] `tts-service.mjs` exports exactly `runFullTts` and `loadPassedAudioHandoff`.
- [ ] `audio_passed` returns only after artifact re-read and exactly one verified `AUDIO_PASSED` row whose canonical inputHash, outputHash and four sorted artifactPaths, including the current audio-coverage revision, match the locked formula.
- [ ] No Git repository is initialized implicitly.

## Self-Review Commands and Expected Results

- [ ] **Spec coverage scan:**

```powershell
rg -n "api/tts-job|idempotency|orphan|48000|pcm_s16le|render-plan-input|sourceSceneIds|duration repair|reapproval|cancel" docs\superpowers\plans\2026-07-16-codex-yadam-03-supertonic-tts-and-timeline.md
```

Expected: matches in constraints, interfaces and executable tasks for every required topic.

- [ ] **Placeholder scan:**

```powershell
$forbidden = @(("TO"+"DO"),("TB"+"D"),("implement"+" later"),("similar"+" to task"))
Select-String -LiteralPath docs\superpowers\plans\2026-07-16-codex-yadam-03-supertonic-tts-and-timeline.md -Pattern $forbidden
```

Expected: no output.

- [ ] **Public-interface consistency scan:**

```powershell
rg -n "runFullTts|loadPassedAudioHandoff|getApprovedTtsInput|requestDurationRepair|rebuildApproval2AfterDurationRepair|refreshApproval2Previews" docs\superpowers\plans\2026-07-16-codex-yadam-03-supertonic-tts-and-timeline.md
```

Expected: names and argument shapes match Plans 01, 02 and 04; no alternate spelling appears.

- [ ] **Final diff review:**

```powershell
git diff -- docs\superpowers\plans\2026-07-16-codex-yadam-03-supertonic-tts-and-timeline.md
```

Expected in Git: only this plan file is shown. Expected now: Git reports that the workspace is not a repository; verify the file directly and record the documented skip.
