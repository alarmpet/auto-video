# Codex 야담 ComfyUI 이미지·인트로·썸네일 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 01~03의 정본과 승인 계약을 소비해 SDXL/IP-Adapter 기반 캐릭터 reference, 승인용 대표 이미지, 실측 오디오에 맞춘 장면·인트로 still, 한글 썸네일과 strict visual QA를 재개 가능한 로컬 서비스로 만든다.

**Architecture:** `scripts/lib/yadam/image-service.mjs`가 유일한 public facade이며 prompt compiler, 두 ComfyUI workflow, provider client, reference lifecycle, GPU resource lock, visual QA와 Sharp compositor를 작은 모듈로 조합한다. ComfyUI는 raster만 생성하고 오케스트레이터가 hash·승인·재시도·artifact promotion을 소유한다. 외부 ComfyUI 설치 변경과 실제 GPU 생성은 별도 confirmation token이 있어야 실행된다.

**Tech Stack:** Windows 11, Node.js 22.16.0 ES modules, npm 10.9.2, Ajv 8.20.0, json-canonicalize 2.0.0, Sharp 0.35.3, YAML 2.9.0, ComfyUI 0.24.0 REST API, SDXL Base 1.0, comfyorg/comfyui-ipadapter commit `b188a6cb39b512a9c6da7235b880af42c78ccd0d`, Ollama `gemma4:12b`, Node built-in test runner.

## Global Constraints

- 작업공간은 `C:/Users/petbl/auto-video`다. 구현 시작 전 `git rev-parse --is-inside-work-tree`가 실패하면 자동으로 `git init`하지 않고 사용자의 Git 선택을 받는다.
- Plan 01의 `loadJob`, `writeCanonicalJson`, `writeCanonicalJsonExclusive`, `writeBinaryAtomic`, `registerArtifact`, `transitionJob`, `canonicalJson`, `hashCanonical`, `sha256Bytes`, `validateSchema`를 다시 구현하지 않는다.
- Plan 02의 `story-bible.json`, `scene-plan.json`, `thumbnail-plan.json`, thumbnail copy selection과 approval-2 API를 정본으로 소비한다.
- Plan 03의 `loadPassedAudioHandoff(jobDir)` 결과에 포함된 `audioManifestPath`, `audioManifestHash`, `audioTimelinePath`, `audioTimelineHash`, `renderPlanInputPath`, `renderPlanInputHash`, `measuredAudioSeconds`, `acceptedRangeSeconds`, `audioTempoFactor`, `scenes`, `segments`, `visualSlots`를 이름과 타입까지 그대로 소비한다.
- yadam visual stack은 SDXL Base 1.0 + IP-Adapter Plus Face SDXL ViT-H이며 LoRA, FaceID, InsightFace와 AI I2V를 사용하지 않는다.
- 캐릭터 reference는 768×1024, scene·intro는 1024×576, thumbnail background와 final canvas는 1280×720이다.
- sampler는 `dpmpp_2m`, scheduler는 `karras`, CFG는 `6.0`; reference는 28 steps, scene·intro·thumbnail은 24 steps다.
- IP-Adapter preset은 exact enum `PLUS FACE (portraits)`, `weight_type`은 `standard`, 초기 weight/start/end는 `0.80/0.00/0.85`다.
- 첫 60초 visual slot은 5~7초, 이후는 20~40초이며 30초를 목표로 한다. 10분 기본 28 slot, 120분 hard maximum 260 slot이다.
- 한 visual slot에서 얼굴을 강하게 고정하는 focal character는 최대 1명이다. 비인물 establishing·prop slot은 conditioning `none`과 reference T2I workflow를 사용한다.
- production은 approval-2가 승인한 exact reference-set hash만 사용한다. 이전 scene 결과를 다음 scene reference로 사용하지 않는다.
- ComfyUI 요청 concurrency는 1이다. ComfyUI와 Ollama vision model을 동시에 GPU에 올리지 않는다.
- missing image, slate, first-image substitution, circular reuse와 vision critic 자동 통과를 금지한다.
- ComfyUI raster에는 읽을 수 있는 한글·영문·숫자를 생성하지 않는다. thumbnail 문자는 Sharp compositor만 그린다.
- 모든 job 정본 JSON은 UTF-8 NFC, RFC 8785 canonical JSON, lowercase SHA-256과 same-directory atomic rename을 사용한다.
- 모든 public `approvalRevisionPath`와 `relativePath`, registry `path`는 job-relative `/` 경로다. 파일 접근 시에만 `join(jobDir,path)`하고 Plan 01 containment를 다시 검증한다.
- 외부 ComfyUI root, model directory와 `extra_model_paths.yaml` 변경은 `INSTALL_YADAM_IMAGE_STACK` confirmation token이 있을 때만 수행한다.
- 실제 5장 GPU smoke는 `RUN_YADAM_GPU_SMOKE` confirmation token이 있을 때만 수행한다. 일반 테스트는 fake HTTP server와 synthetic PNG를 사용한다.
- gguljam-bible profile, 기존 Flux workflow와 기존 export 결과를 변경하지 않는다.
- Tasks 1–8에서 시간이 생략된 checkbox도 구현/fixture는 최대 5분, 실행/검증/commit은 2–3분의 한 작업 단위로 취급한다. 5분을 넘기면 같은 red-green-refactor 경계 안에서 더 작은 checkbox로 분할하고 다음 항목으로 넘어가지 않는다.

---

## Locked Upstream Interfaces

```js
// Plan 01
// scripts/lib/pipeline/job-store.mjs
loadJob(jobDir): Promise<JobContext>

// scripts/lib/pipeline/atomic-store.mjs
writeCanonicalJson(filePath, value): Promise<{ path, sha256, sizeBytes }>
writeCanonicalJsonExclusive(filePath, value): Promise<{ path, sha256, sizeBytes }>
writeBinaryAtomic(filePath, bytes): Promise<{ path, sha256, sizeBytes }>

// scripts/lib/pipeline/artifact-store.mjs
registerArtifact(jobDir, record): Promise<ArtifactRecord>
canReuseArtifact(jobDir, artifactId, dependencyHashes): Promise<boolean>

// scripts/lib/pipeline/path-policy.mjs
assertPathWithin(root, candidate): string
assertRealPathWithin(root, candidate): Promise<string>

// scripts/lib/pipeline/state-machine.mjs
transitionJob(jobDir, { stage, to, inputHash, outputHash?, artifactPaths?, error?, note? }): Promise<PipelineState>

// scripts/lib/pipeline/canonical-json.mjs
canonicalJson(value): string
hashCanonical(value): string
sha256Bytes(input): string

// scripts/lib/pipeline/schema-registry.mjs
validateSchema(schemaPath, value): unknown

// Plan 02
// scripts/lib/yadam/script-service.mjs
buildApprovalTwoBundle({ jobDir, previewArtifacts }): Promise<object>
approveProduction({ jobDir, expectedArtifactSetHash, approvedAt, userInstructions }): Promise<object>
getApprovedVisualPlanningInput(jobDir): Promise<{
  approvalRevisionPath: string,
  approvedArtifactSetHash: string,
  storyBible: { relativePath: string, sha256: string, schemaVersion: string, schemaHash: string },
  scenePlan: { relativePath: string, sha256: string, schemaVersion: string, schemaHash: string },
  thumbnailPlan: { relativePath: string, sha256: string, schemaVersion: string, schemaHash: string },
  thumbnailSelection: { relativePath: string, sha256: string, copyId: string },
  spoilerSealIds: string[]
}>
rebuildApproval2AfterDurationRepair({ jobDir, changedSceneIds, signal }): Promise<object>
updateCoverageSection({ jobDir, section, report }): Promise<object>
selectThumbnailCopy({ jobDir, copyId, selectedAt }): Promise<object>

// Plan 03
// scripts/lib/yadam/tts-service.mjs
loadPassedAudioHandoff(jobDir): Promise<{
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
    sceneId: string, segmentId: string, order: number, sourceHash: string,
    ttsNormalizedHash: string, ttsOptionsHash: string,
    normalizedWavPath: string, normalizedWavHash: string,
    durationSeconds: number, startSeconds: number, endSeconds: number
  }>,
  segments: Array<{
    segmentId: string, plannedDurationSeconds: 600, measuredAudioSeconds: number,
    startSeconds: number, endSeconds: number
  }>,
  visualSlots: Array<{
    visualSlotId: string, visualOrder: number, segmentId: string,
    sourceSceneIds: string[], primarySceneId: string,
    startSeconds: number, endSeconds: number, durationSeconds: number,
    timingBand: "intro" | "body", extendedHold: boolean,
    holdReason: "cta" | "short_tail" | null, purpose: "intro" | "scene"
  }>
}>
```

## Public Interfaces Produced by This Plan

```js
// scripts/lib/yadam/image-service.mjs
buildApproval2Previews({ jobDir, signal }): Promise<{
  previewManifestPath: string,
  previewManifestHash: string,
  characterReferenceSetHash: string,
  representativePreviewSetHash: string,
  thumbnailPreviewPath: string,
  previewArtifacts: {
    thumbnailPreview: { artifactId: string, relativePath: string, sha256: string },
    thumbnailGuide: { artifactId: "thumbnail-reserved-guide", relativePath: "previews/thumbnail-reserved-guide.png", sha256: string, dependencyHash: string },
    characterReferenceSet: { artifactId: "character-reference-set-current", relativePath: string, sha256: string },
    representativePreviews: Array<{
      role: "intro" | "body" | "climax",
      artifactId: string, relativePath: string, sha256: string
    }>,
    styleProfile: { artifactId: string, relativePath: string, sha256: string }
  }
}>

refreshApproval2Previews({ jobDir, changedSceneIds, signal }): Promise<Array<{
  role: "intro" | "body" | "climax",
  artifactId: string,
  relativePath: string,
  sha256: string,
  dependencyHash: string
}>>

promoteApprovedReferenceSet({ jobDir, approvalRevisionPath }): Promise<{
  referenceSetPath: string,
  referenceSetHash: string,
  status: "approved",
  approvalRevisionPath: string
}>

generateProductionImages({ jobDir, signal }): Promise<PassedImageHandoff>
loadPassedImageHandoff(jobDir): Promise<PassedImageHandoff>

type PassedImageHandoff = {
  renderPlanPath: string,
  renderPlanHash: string,
  imageAssetManifestPath: string,
  imageAssetManifestHash: string,
  visualQaReportPath: string,
  visualQaReportHash: string,
  thumbnail: { path: string, sha256: string, qaPath: string, qaSha256: string },
  visualSlots: Array<{
    visualSlotId: string,
    startSeconds: number,
    endSeconds: number,
    imagePath: string,
    imageSha256: string,
    qaStatus: "pass"
  }>
}
```

Plan 05는 오직 `loadPassedImageHandoff(jobDir)`와 등록된 artifact를 소비한다. 이 계획이 등록하는 원본 썸네일 역할은 `yadam.thumbnail.final`이며, Plan 05가 release 디렉터리에 byte-identical copy를 만든 뒤 등록하는 별도 역할은 `yadam.thumbnail.release`다. provider output path, ComfyUI prompt history 또는 `previews/` 파일명을 추측하지 않는다.

## Locked Subsystem Success Evidence

Plan 02/04 producers and Plan 04/06 consumers compute the object projections shown with Plan 01 `hashCanonical` and use exact registered file-byte SHA-256 where a field is already named `*Hash`; they do not rename keys, add undeclared fields, or hash an unordered object assembled from optional fields. `artifactPaths` is the shown already-sorted job-relative array. State history stores the event name in `stage`:

Four current policy pins are exact and shared with Plan 06. For each, hash every listed repository file's raw bytes, sort `{path,sha256}` rows by UTF-8 path bytes, reject a missing/extra/duplicate path, and compute `hashCanonical({contractVersion:"1.0.0",files})`:

- `compilerVersionHash`: `schemas/yadam/compiled-image-request.schema.json`, `scripts/lib/yadam/images/prompt-compiler.mjs`, `scripts/lib/yadam/images/visual-slot-plan.mjs`, `scripts/lib/yadam/images/workflow-template.mjs`.
- `imageQaPolicyHash`: `schemas/yadam/vision-critic-response.schema.json`, `schemas/yadam/visual-asset-qa.schema.json`, `schemas/yadam/visual-qa-report.schema.json`, `scripts/lib/yadam/images/ollama-vision-critic.mjs`, `scripts/lib/yadam/images/raster-inspector.mjs`, `scripts/lib/yadam/images/visual-qa.mjs`.
- `thumbnailCompositorPolicyHash`: use the same wrapper with repository files `schemas/yadam/thumbnail-qa.schema.json` and `scripts/lib/yadam/images/thumbnail-compositor.mjs`, plus exact `fontPins` sorted by path for `C:/Windows/Fonts/malgunbd.ttf` hash `e8cbc0b2afcc14fb45dfb6086d5102c0b23a96e7b6e708f3122acde1b86c9082` and `C:/Windows/Fonts/malgun.ttf` hash `7a183cf1c6c56b9609fcc16eda8b5229fbc11758a21e669ec00343239b02192f`; compute `hashCanonical({contractVersion:"1.0.0",files,fontPins})`.
- `comfyProviderContractHash`: use the file wrapper over `scripts/lib/yadam/images/comfyui-client.mjs` and `scripts/lib/yadam/images/image-runner.mjs`.

Preview manifest/style/compiled-request records and production render/image/QA/thumbnail records carry all four pins as named opaque dependencies. Initial preview, refresh and production reuse rederive and compare them before accepting any event; mutating any listed policy/provider/font file changes the appropriate input hash and cannot reuse pixels or QA silently.

```js
// Consumed Plan 02 gate evidence before preview generation.
const thumbnailCopySelected = {
  stage: "THUMBNAIL_COPY_SELECTED",
  inputHash: hashCanonical({ thumbnailPlanHash, copyId, selectedAt }),
  outputHash: thumbnailSelectionHash,
  artifactPaths: ["approvals/thumbnail-copy-selection.json"]
};

const approvalTwoPreviewsReady = {
  stage: "APPROVAL_TWO_PREVIEWS_READY",
  inputHash: hashCanonical({
    storyBibleHash,
    scenePlanHash,
    thumbnailPlanHash,
    thumbnailSelectionHash,
    profileHash,
    modelLockHash,
    referenceWorkflowHash,
    conditionedWorkflowHash,
    compilerVersionHash,
    imageQaPolicyHash,
    thumbnailCompositorPolicyHash,
    comfyProviderContractHash
  }),
  outputHash: previewManifestHash,
  artifactPaths: ["previews/preview-manifest.json"]
};

// Consumed Plan 02 approval evidence before reference promotion.
const approvalTwoGranted = {
  stage: "APPROVAL_TWO_GRANTED",
  inputHash: approvedArtifactSetHash,
  outputHash: approvalRevisionHash,
  artifactPaths: [approvalRevisionPath, "approvals/current-approval-2.json"].sort()
};

const referenceSetPromoted = {
  stage: "REFERENCE_SET_PROMOTED",
  inputHash: hashCanonical({
    approvalRevisionPath,
    approvalRevisionHash,
    approvedArtifactSetHash,
    referenceSetHash
  }),
  outputHash: referencePointerHash,
  artifactPaths: ["assets/character-references/current-reference-set.json"]
};

const imagesPassed = {
  stage: "IMAGES_PASSED",
  inputHash: hashCanonical({
    approvedArtifactSetHash,
    audioManifestHash,
    audioTimelineHash,
    renderPlanInputHash,
    referenceSetHash,
    referencePointerHash,
    profileHash,
    modelLockHash,
    compilerVersionHash,
    imageQaPolicyHash,
    thumbnailCompositorPolicyHash,
    comfyProviderContractHash
  }),
  outputHash: hashCanonical({
    renderPlanHash,
    imageAssetManifestHash,
    visualQaReportHash,
    thumbnailHash,
    thumbnailQaHash,
    visualCoverageHash
  }),
  artifactPaths: [
    "assets/asset-manifest.json",
    "assets/visual-qa-report.json",
    "render-plan.json",
    "thumbnail/final.png",
    "thumbnail/qa.json",
    visualCoveragePath
  ].sort()
};
```

The producer appends each success only after re-reading the listed artifacts and recomputing these values. Plan 06 resolves current passed roles, re-hashes the same files, projects the same keys from the preview result/current approval or `loadPassedImageHandoff`, and requires exact `stage`, `inputHash`, `outputHash`, and ordered `artifactPaths`. A history row alone is never reusable evidence.

## Locked File Map

| Path | Responsibility |
|---|---|
| `package.json` | Sharp·YAML exact dependencies와 image CLI scripts |
| `config/profiles/yadam.json` | visual stack, cadence, QA와 thumbnail constants |
| `config/host.local.example.json` | ComfyUI·Ollama·font·GPU lock host paths |
| `config/model-locks/yadam-sdxl-ipadapter-v1.json` | checkpoint, custom node, model, font, legacy migration provenance |
| `assets/workflows/yadam_sdxl_reference_v1.json` | core SDXL T2I graph |
| `assets/workflows/yadam_sdxl_ipadapter_v1.json` | SDXL Plus Face conditioned graph |
| `schemas/yadam/compiled-image-request.schema.json` | deterministic prompt compiler output |
| `schemas/yadam/render-plan.schema.json` | closed Plan 03 timing plus compiled-request binding |
| `schemas/yadam/character-reference-set.schema.json` | immutable reference-set manifest |
| `schemas/yadam/reference-set-pointer.schema.json` | provisional/approved pointer |
| `schemas/yadam/preview-manifest.schema.json` | approval-2 preview handoff |
| `schemas/yadam/image-asset-manifest.schema.json` | production visual slot to image mapping |
| `schemas/yadam/vision-critic-response.schema.json` | one closed Ollama request/response format source |
| `schemas/yadam/visual-asset-qa.schema.json` | one generated asset's deterministic and semantic QA evidence |
| `schemas/yadam/visual-qa-report.schema.json` | raster and vision QA evidence |
| `schemas/yadam/thumbnail-qa.schema.json` | copy, font, geometry and overlap evidence |
| `scripts/lib/yadam/images/model-lock.mjs` | exact size/hash and source lock validation |
| `scripts/lib/yadam/images/host-installer.mjs` | opt-in download, custom-node checkout and legacy path migration |
| `scripts/lib/yadam/images/host-preflight.mjs` | read-only host, node, model, workflow, font and queue checks |
| `scripts/lib/yadam/images/workflow-template.mjs` | typed placeholder substitution and graph validation |
| `scripts/lib/yadam/images/prompt-compiler.mjs` | story/scene/reference to compiled request |
| `scripts/lib/yadam/images/visual-slot-plan.mjs` | cadence and Plan 03 handoff validation, render-plan publish input |
| `scripts/lib/yadam/images/comfyui-client.mjs` | upload, prompt, history, view, queue, interrupt and free API |
| `scripts/lib/pipeline/resource-lock.mjs` | workspace-level cross-job ComfyUI/Ollama mutual exclusion |
| `scripts/lib/yadam/images/reference-store.mjs` | immutable candidate set and approval pointer |
| `scripts/lib/yadam/images/raster-inspector.mjs` | PNG, dimensions, luminance, alpha, color and duplicate checks |
| `scripts/lib/yadam/images/ollama-vision-critic.mjs` | `gemma4:12b` JSON Schema critic and unload |
| `scripts/lib/yadam/images/visual-qa.mjs` | deterministic + semantic QA, one repair decision |
| `scripts/lib/yadam/images/thumbnail-compositor.mjs` | Sharp Korean text layout and exact output QA |
| `scripts/lib/yadam/images/image-runner.mjs` | one-asset generation, retry, checkpoint, resume and cancellation |
| `scripts/lib/yadam/image-service.mjs` | approval preview, production and Plan 05 handoff facade |
| `scripts/yadam-image-host.mjs` | host check/apply CLI |
| `scripts/yadam-image-stage.mjs` | preview, promote, production and status CLI |
| `scripts/yadam-image-smoke.mjs` | opt-in five-image GPU suite |
| `test/yadam/visual-source-disposition.test.mjs` | three legacy visual documents' byte locks and accepted/adapted/rejected rule audit |
| `test/yadam/fixtures/images/legacy-source-disposition.v1.json` | development-only rule-to-owner/test mapping; never imported at runtime |
| `test/yadam/image-config.test.mjs` | lock/profile/host/migration tests |
| `test/yadam/image-workflow.test.mjs` | workflow/compiler/cadence tests |
| `test/yadam/image-provider.test.mjs` | fake ComfyUI/upload/resume/cancel/preflight tests |
| `test/yadam/image-qa.test.mjs` | raster/Ollama/GPU lock tests |
| `test/yadam/thumbnail.test.mjs` | Sharp geometry/glyph/safe-zone tests |
| `test/yadam/image-service.test.mjs` | approval lifecycle, production handoff and duration-repair tests |
| `test/yadam/fixtures/images/` | closed JSON, PNG and fake API fixtures |

### Task 1: Lock the image stack, profile, host configuration and dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `config/profiles/yadam.json`
- Modify: `config/host.local.example.json`
- Create: `config/model-locks/yadam-sdxl-ipadapter-v1.json`
- Create: `scripts/lib/yadam/images/model-lock.mjs`
- Create: `test/yadam/visual-source-disposition.test.mjs`
- Create: `test/yadam/fixtures/images/legacy-source-disposition.v1.json`
- Create: `test/yadam/image-config.test.mjs`
- Read only: `data/yadam/reference/script-rules.v1.json`
- Read only: `module/시스템프롬프트_Sonnet.txt`
- Read only: `module/prompt_v5.2_sonnet.md`
- Read only: `module/썸네일 프롬프트 (opus) 260601.md`

**Interfaces:**
- Consumes: Plan 01 `loadProfile`, `loadHostConfig`, `hashCanonical`, `sha256Bytes`.
- Development-time only: consumes Plan 02 `script-rules.v1.json.sources` plus the three locked legacy visual documents; no production module imports the audit fixture or reads `module/`.
- Produces: `loadImageStackLock(workspaceRoot)` with an attached pre-attachment `modelLockHash`, and `verifyLockedFile(filePath, lockEntry)`.

- [ ] **Step 1: Write the failing model-lock and profile tests**

First create `test/yadam/fixtures/images/legacy-source-disposition.v1.json` as a closed development-only catalog with `schemaVersion:"1.0.0"`, `sourceDispositionVersion:"2026-07-16"`, and exactly these three source rows. Each row stores the exact raw-byte hash, `acceptedRules`, `adaptedRules`, `rejectedRules`, implementation owners and named downstream tests:

- `module/시스템프롬프트_Sonnet.txt` / `6cad802444c51daf009e9d47de7a140224d01cb4097a3b0bf87cb590a85d4ab9`: retain source grounding, spoiler discipline, period-safe subject/action/location separation and reference continuity; adapt motion-language to still-image composition and the one-focal-conditioned-face rule; reject Sonnet/Grok/video-provider coupling and free-form orchestration.
- `module/prompt_v5.2_sonnet.md` / `af2b889f671223e71c002c440387dd23ac7f4d56d89bdc465ba4ffe15226b172`: retain Joseon era/location/cast/wardrobe/headcount evidence, anonymous-extra specificity, negative text and modern-object gates; adapt chapter count, prompt length and G1–G25 overlaps into the closed compiled-request schema, visual-slot plan and local validators; reject Google Flow/Nano Banana, `present_files`, embedded Python and model-chosen counts.
- `module/썸네일 프롬프트 (opus) 260601.md` / `fe6b08667f91aa17cd7ca29a259c16e2edf927faf6db2e29cdc9f892a1fd0e25`: retain four provisional copy candidates, copy hierarchy, background subject/composition and protected-area principles; adapt raster generation to a text-free background plus deterministic Sharp Korean composition and guide overlay; reject Opus coupling, model-rendered text and mandatory photorealistic/cinematic styling.

Create `test/yadam/visual-source-disposition.test.mjs`. It hashes the three raw source files, finds the same path/hash rows in Plan 02 `script-rules.v1.json.sources`, validates the catalog's exact three-row closed shape and unique rule IDs, and requires every implementation owner/test ID to be allowlisted. It also scans all existing `scripts/lib/yadam/images/*.mjs` plus `scripts/lib/yadam/image-service.mjs` and fails if a runtime file imports the fixture, contains a `module/` path, or names a legacy provider. The explicit `--source-only` mode used in Task 1 permits not-yet-created runtime files but still scans every one that exists; normal Node test mode, used by Task 13 Step 6 and `test:yadam:image`, requires the exact runtime file set from the Locked File Map. The mapped behavioral assertions are implemented in `image-workflow.test.mjs`, `image-service.test.mjs`, and `thumbnail.test.mjs`; the catalog itself is never runtime input.

Then create `test/yadam/image-config.test.mjs` with tests that assert all exact values below and reject one-byte size/hash drift:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadImageStackLock, verifyLockedFile } from "../../scripts/lib/yadam/images/model-lock.mjs";

test("yadam image lock pins immutable sources", async () => {
  const lock = await loadImageStackLock(process.cwd());
  assert.equal(lock.stackId, "yadam-sdxl-ipadapter-v1");
  assert.equal(lock.customNode.commit, "b188a6cb39b512a9c6da7235b880af42c78ccd0d");
  assert.equal(lock.models.clipVision.sizeBytes, 2528373448);
  assert.equal(lock.models.clipVision.sha256, "6ca9667da1ca9e0b0f75e46bb030f7e011f44f86cbfb8d5a36590fcd7507b030");
  assert.equal(lock.models.ipAdapter.sizeBytes, 847517512);
  assert.equal(lock.models.ipAdapter.sha256, "677ad8860204f7d0bfba12d29e6c31ded9beefdf3e4bbd102518357d31a292c1");
  assert.equal(lock.ollamaVision.model, "gemma4:12b");
  assert.equal(lock.ollamaVision.digest, "4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c");
  assert.equal(lock.ollamaVision.sizeBytes, 7556508396);
  assert.equal(lock.ollamaVision.quantization, "Q4_K_M");
  assert.match(lock.modelLockHash, /^[0-9a-f]{64}$/);
});

test("locked file rejects byte drift", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yadam-lock-"));
  const file = join(dir, "model.bin");
  await writeFile(file, Buffer.from("wrong"));
  await assert.rejects(
    verifyLockedFile(file, { sizeBytes: 5, sha256: "0".repeat(64) }),
    error => error.code === "locked_file_hash_mismatch"
  );
});
```

- [ ] **Step 2: Run the tests and confirm the missing module failure**

Run: `node --test test/yadam/image-config.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `model-lock.mjs`.

- [ ] **Step 3: Merge exact image dependencies and scripts without replacing the Plan 02 test aggregator**

Modify `package.json` by adding only the three `yadam:image-*` commands and the two image dependencies. Preserve the Plan 01/02 aggregate test commands exactly; the merged keys must be:

```json
{
  "scripts": {
    "test:yadam": "npm run test:yadam:node && npm run test:yadam:script",
    "test:yadam:node": "node --test test/yadam",
    "test:yadam:script": "node scripts/run-yadam-script-tests.mjs",
    "test:yadam:image": "node --test test/yadam/visual-source-disposition.test.mjs test/yadam/image-config.test.mjs test/yadam/image-workflow.test.mjs test/yadam/image-provider.test.mjs test/yadam/resource-lock.test.mjs test/yadam/image-qa.test.mjs test/yadam/thumbnail.test.mjs test/yadam/image-service.test.mjs",
    "auto-video": "node scripts/auto-video-pipeline.mjs",
    "yadam:image-host": "node scripts/yadam-image-host.mjs",
    "yadam:image-stage": "node scripts/yadam-image-stage.mjs",
    "yadam:image-smoke": "node scripts/yadam-image-smoke.mjs"
  },
  "dependencies": {
    "ajv": "8.20.0",
    "json-canonicalize": "2.0.0",
    "sharp": "0.35.3",
    "yaml": "2.9.0"
  }
}
```

Run: `npm install --save-exact sharp@0.35.3 yaml@2.9.0`

Run: `node -e "const p=require('./package.json'); const expected={all:'npm run test:yadam:node && npm run test:yadam:script',node:'node --test test/yadam',script:'node scripts/run-yadam-script-tests.mjs'}; if(p.scripts['test:yadam']!==expected.all||p.scripts['test:yadam:node']!==expected.node||p.scripts['test:yadam:script']!==expected.script||!p.scripts['test:yadam:image']?.startsWith('node --test ')) process.exit(1); console.log(require('sharp/package.json').version, require('yaml/package.json').version)"`

Expected: both commands exit 0; the assertion prints `0.35.3 2.9.0`, proving Plan 04 did not narrow `test:yadam` to only Node tests.

- [ ] **Step 4: Create the exact immutable model lock**

Create `config/model-locks/yadam-sdxl-ipadapter-v1.json`:

```json
{
  "schemaVersion": "1.0.0",
  "stackId": "yadam-sdxl-ipadapter-v1",
  "checkpoint": {
    "sourceKind": "existing-local",
    "filename": "sd_xl_base_1.0.safetensors",
    "path": "C:/Users/petbl/hermes-studio/hermes-local/models/checkpoints/sd_xl_base_1.0.safetensors",
    "sizeBytes": 6938078334,
    "sha256": "31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b"
  },
  "customNode": {
    "id": "comfyorg-comfyui-ipadapter",
    "gitUrl": "https://github.com/comfyorg/comfyui-ipadapter.git",
    "commitUrl": "https://github.com/comfyorg/comfyui-ipadapter/commit/b188a6cb39b512a9c6da7235b880af42c78ccd0d",
    "commit": "b188a6cb39b512a9c6da7235b880af42c78ccd0d",
    "license": "GPL-3.0",
    "targetPath": "C:/Users/petbl/ComfyUI_windows_portable/ComfyUI/custom_nodes/comfyui-ipadapter"
  },
  "models": {
    "clipVision": {
      "repo": "h94/IP-Adapter",
      "repoCommit": "018e402774aeeddd60609b4ecdb7e298259dc729",
      "license": "Apache-2.0",
      "url": "https://huggingface.co/h94/IP-Adapter/resolve/018e402774aeeddd60609b4ecdb7e298259dc729/models/image_encoder/model.safetensors?download=true",
      "filename": "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors",
      "targetPath": "C:/Users/petbl/ComfyUI_windows_portable/ComfyUI/models/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors",
      "sizeBytes": 2528373448,
      "sha256": "6ca9667da1ca9e0b0f75e46bb030f7e011f44f86cbfb8d5a36590fcd7507b030"
    },
    "ipAdapter": {
      "repo": "h94/IP-Adapter",
      "repoCommit": "018e402774aeeddd60609b4ecdb7e298259dc729",
      "license": "Apache-2.0",
      "url": "https://huggingface.co/h94/IP-Adapter/resolve/018e402774aeeddd60609b4ecdb7e298259dc729/sdxl_models/ip-adapter-plus-face_sdxl_vit-h.safetensors?download=true",
      "filename": "ip-adapter-plus-face_sdxl_vit-h.safetensors",
      "targetPath": "C:/Users/petbl/ComfyUI_windows_portable/ComfyUI/models/ipadapter/ip-adapter-plus-face_sdxl_vit-h.safetensors",
      "sizeBytes": 847517512,
      "sha256": "677ad8860204f7d0bfba12d29e6c31ded9beefdf3e4bbd102518357d31a292c1"
    }
  },
  "ollamaVision": {
    "model": "gemma4:12b",
    "digest": "4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c",
    "sizeBytes": 7556508396,
    "quantization": "Q4_K_M",
    "capabilities": ["vision"]
  },
  "fonts": {
    "bold": { "path": "C:/Windows/Fonts/malgunbd.ttf", "sizeBytes": 12600392, "sha256": "e8cbc0b2afcc14fb45dfb6086d5102c0b23a96e7b6e708f3122acde1b86c9082" },
    "regular": { "path": "C:/Windows/Fonts/malgun.ttf", "sizeBytes": 13459196, "sha256": "7a183cf1c6c56b9609fcc16eda8b5229fbc11758a21e669ec00343239b02192f" }
  },
  "legacyMigration": {
    "extraModelPaths": "C:/Users/petbl/ComfyUI_windows_portable/ComfyUI/extra_model_paths.yaml",
    "acceptedInputSha256": "e5ed7e0dfd928d82798593706ca97825f02604bc6b1a037ef99177b630a1888c",
    "legacyRoot": "C:/Users/petbl/hermes_models",
    "legacyLoras": [
      { "filename": "stickfigures_lora.safetensors", "sizeBytes": 228462156, "sha256": "76232996877d29c8433fce10a4fb8a8bf7c9aedb4cef7fab3ba01ca5d074e222" },
      { "filename": "stickman_lora.safetensors", "sizeBytes": 228465612, "sha256": "4907bfe1e2b7af0bd7ead7811e6747917bd3ed7a48e606d29176a0a99f85c711" }
    ]
  }
}
```

- [ ] **Step 5: Extend the yadam profile and host example with exact values**

Merge this object under `config/profiles/yadam.json.visual`:

```json
{
  "stackId": "yadam-sdxl-ipadapter-v1",
  "styleId": "yadam-color-manhwa-v1",
  "workflows": { "unconditioned": "assets/workflows/yadam_sdxl_reference_v1.json", "conditioned": "assets/workflows/yadam_sdxl_ipadapter_v1.json" },
  "sampler": "dpmpp_2m",
  "scheduler": "karras",
  "cfg": 6,
  "referenceSteps": 28,
  "sceneSteps": 24,
  "ipAdapter": { "preset": "PLUS FACE (portraits)", "weightType": "standard", "weight": 0.8, "start": 0, "end": 0.85 },
  "intro": { "endSeconds": 60, "minSlotSeconds": 5, "maxSlotSeconds": 7, "targetSlotSeconds": 6 },
  "body": { "minSlotSeconds": 20, "maxSlotSeconds": 40, "targetSlotSeconds": 30 },
  "maxSlots": 260,
  "qa": { "contextMin": 7, "identityMin": 6, "eraWardrobeMin": 7, "colorStyleMin": 7, "sourceColorPixelRatioMin": 0.1, "repairAttempts": 1 }
}
```

Merge this object under `config/host.local.example.json`:

```json
{
  "comfyui": {
    "baseUrl": "http://127.0.0.1:8188",
    "portableRoot": "C:/Users/petbl/ComfyUI_windows_portable",
    "startupBatch": "C:/Users/petbl/ComfyUI_windows_portable/run_nvidia_gpu.bat",
    "extraModelPaths": "C:/Users/petbl/ComfyUI_windows_portable/ComfyUI/extra_model_paths.yaml",
    "autoStart": false,
    "startupTimeoutMs": 180000,
    "promptTimeoutMs": 900000
  },
  "ollama": { "baseUrl": "http://127.0.0.1:11434", "visionModel": "gemma4:12b", "requestTimeoutMs": 180000 },
  "gpuLockPath": "C:/Users/petbl/auto-video/exports/.locks/gpu.lock"
}
```

- [ ] **Step 6: Implement model-lock loading and streaming hash verification**

Create `scripts/lib/yadam/images/model-lock.mjs`:

```js
import { createReadStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { hashCanonical } from "../../pipeline/canonical-json.mjs";

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export async function loadImageStackLock(workspaceRoot) {
  const path = resolve(workspaceRoot, "config/model-locks/yadam-sdxl-ipadapter-v1.json");
  const lock = JSON.parse(await readFile(path, "utf8"));
  if (lock.schemaVersion !== "1.0.0" || lock.stackId !== "yadam-sdxl-ipadapter-v1") {
    throw Object.assign(new Error("invalid image stack lock"), { code: "invalid_image_stack_lock" });
  }
  return deepFreeze({ ...lock, modelLockHash: hashCanonical(lock) });
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifyLockedFile(filePath, entry) {
  const info = await stat(filePath).catch(() => null);
  if (!info) throw Object.assign(new Error(`missing locked file: ${filePath}`), { code: "locked_file_missing" });
  if (info.size !== entry.sizeBytes) throw Object.assign(new Error(`size mismatch: ${filePath}`), { code: "locked_file_size_mismatch" });
  const actual = await sha256File(filePath);
  if (actual !== entry.sha256) throw Object.assign(new Error(`hash mismatch: ${filePath}`), { code: "locked_file_hash_mismatch", actual });
  return { path: resolve(filePath), sizeBytes: info.size, sha256: actual };
}
```

- [ ] **Step 7: Run config tests**

Run:

```powershell
node test/yadam/visual-source-disposition.test.mjs --source-only
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node --test test/yadam/image-config.test.mjs
```

Expected: the three-source disposition/hash audit and both config tests pass with 0 failures; package versions and all lock constants match.

- [ ] **Step 8: Commit the locked stack boundary**

```bash
git add package.json package-lock.json config/profiles/yadam.json config/host.local.example.json config/model-locks/yadam-sdxl-ipadapter-v1.json scripts/lib/yadam/images/model-lock.mjs test/yadam/visual-source-disposition.test.mjs test/yadam/fixtures/images/legacy-source-disposition.v1.json test/yadam/image-config.test.mjs
git commit -m "feat: lock yadam SDXL image stack"
```

### Task 2: Build the opt-in host migration and installer without touching the live host in tests

**Files:**
- Create: `scripts/lib/yadam/images/host-installer.mjs`
- Create: `scripts/yadam-image-host.mjs`
- Modify: `test/yadam/image-config.test.mjs`
- Create: `test/yadam/fixtures/images/extra-model-paths-polluted.yaml`

**Interfaces:**
- Consumes: `loadImageStackLock`, `verifyLockedFile`, YAML 2.9.0 and Plan 01 host config.
- Produces: `inspectHostInstallation({ hostConfig, lock, spawnImpl })`, `applyHostInstallation({ hostConfig, lock, confirmation, fetchImpl, spawnImpl })`.

- [ ] **Step 1: Add the polluted-path and no-confirmation tests**

Create `test/yadam/fixtures/images/extra-model-paths-polluted.yaml`:

```yaml
hermes:
  base_path: C:/Users/petbl/hermes_models
  checkpoints: .
  loras: .
hermes_local:
  base_path: C:/Users/petbl/hermes-studio/hermes-local/models
  checkpoints: checkpoints
  loras: loras
```

Extend `test/yadam/image-config.test.mjs`:

```js
import { cp, mkdir, readFile } from "node:fs/promises";
import { inspectHostInstallation, applyHostInstallation } from "../../scripts/lib/yadam/images/host-installer.mjs";

test("host apply requires exact confirmation", async () => {
  await assert.rejects(
    applyHostInstallation({ hostConfig: {}, lock: {}, confirmation: "wrong" }),
    error => error.code === "external_change_confirmation_required"
  );
});

test("migration removes ambiguous root and preserves legacy LoRAs by copy", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yadam-host-"));
  const comfyRoot = join(dir, "ComfyUI");
  const legacyRoot = join(dir, "hermes_models");
  await mkdir(join(comfyRoot, "models", "loras"), { recursive: true });
  await mkdir(legacyRoot, { recursive: true });
  await cp("test/yadam/fixtures/images/extra-model-paths-polluted.yaml", join(comfyRoot, "extra_model_paths.yaml"));
  await writeFile(join(legacyRoot, "a.safetensors"), Buffer.from("legacy-a"));
  const lock = {
    legacyMigration: {
      extraModelPaths: join(comfyRoot, "extra_model_paths.yaml"),
      legacyRoot,
      acceptedInputSha256: await import("../../scripts/lib/yadam/images/model-lock.mjs").then(async m => m.sha256File(join(comfyRoot, "extra_model_paths.yaml"))),
      legacyLoras: [{ filename: "a.safetensors", sizeBytes: 8, sha256: "655c53155857aae2c2ceae22976dbdb221d73745a28cd24dfb67e9a8b385d42f" }]
    }
  };
  const report = await applyHostInstallation({
    hostConfig: { comfyui: { portableRoot: dir } },
    lock,
    confirmation: "INSTALL_YADAM_IMAGE_STACK",
    installModels: false,
    installCustomNode: false
  });
  const yamlText = await readFile(join(comfyRoot, "extra_model_paths.yaml"), "utf8");
  assert.equal(yamlText.includes("checkpoints: ."), false);
  assert.equal(report.legacyLorasCopied, 1);
});
```

The literal `655c53155857aae2c2ceae22976dbdb221d73745a28cd24dfb67e9a8b385d42f` is the verified SHA-256 of the eight UTF-8 bytes in `legacy-a`; keep this assertion fixed so the migration test detects fixture drift.
Add one fake-git test where an existing custom-node directory returns commit `"0".repeat(40)` and assert both inspection and apply report `custom_node_commit_mismatch`. Add one streamed response containing exactly `entry.sizeBytes + 1` bytes and assert `model_download_oversized`, the final target is absent, and only the exact sibling `<target>.part` is removed.

- [ ] **Step 2: Run the migration tests and observe the missing export**

Run: `node --test test/yadam/image-config.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `host-installer.mjs`.

- [ ] **Step 3: Implement a read-only installation inspection**

Create the inspection portion of `scripts/lib/yadam/images/host-installer.mjs`:

```js
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import YAML from "yaml";
import { sha256File, verifyLockedFile } from "./model-lock.mjs";

const REQUIRED_CONFIRMATION = "INSTALL_YADAM_IMAGE_STACK";

async function exists(path) {
  return access(path).then(() => true, () => false);
}

export async function inspectHostInstallation({ hostConfig, lock, spawnImpl = spawn }) {
  let customNodeCommit = null;
  let customNodeStatus = "custom_node_missing";
  if (await exists(lock.customNode.targetPath)) {
    customNodeCommit = await spawnChecked("git", ["-C", lock.customNode.targetPath, "rev-parse", "HEAD"], {}, spawnImpl).then(result => result.stdout.trim(), () => null);
    customNodeStatus = customNodeCommit === lock.customNode.commit ? "pass" : "custom_node_commit_mismatch";
  }
  const checkpoint = await verifyLockedFile(lock.checkpoint.path, lock.checkpoint).then(() => "pass", error => error.code);
  const clipVision = await verifyLockedFile(lock.models.clipVision.targetPath, lock.models.clipVision).then(() => "pass", error => error.code);
  const ipAdapter = await verifyLockedFile(lock.models.ipAdapter.targetPath, lock.models.ipAdapter).then(() => "pass", error => error.code);
  const yamlText = await readFile(lock.legacyMigration.extraModelPaths, "utf8");
  const parsed = YAML.parse(yamlText);
  const ambiguous = parsed?.hermes?.checkpoints === "." || parsed?.hermes?.loras === ".";
  return { customNodeCommit, customNodeStatus, checkpoint, clipVision, ipAdapter, ambiguousExtraModelPaths: ambiguous, ready: customNodeStatus === "pass" && checkpoint === "pass" && clipVision === "pass" && ipAdapter === "pass" && !ambiguous };
}
```

- [ ] **Step 4: Implement safe download and detached custom-node checkout**

Add these functions to `host-installer.mjs`:

```js
async function downloadLockedModel(entry, authorizedModelRoot, fetchImpl = fetch) {
  const relativeTarget = relative(resolve(authorizedModelRoot), resolve(entry.targetPath));
  if (isAbsolute(relativeTarget) || relativeTarget === ".." || relativeTarget.startsWith(`..${sep}`)) throw Object.assign(new Error("model target outside authorized root"), { code: "model_target_unsafe" });
  if (await exists(entry.targetPath)) return verifyLockedFile(entry.targetPath, entry);
  await mkdir(dirname(entry.targetPath), { recursive: true });
  const part = `${entry.targetPath}.part`;
  if (resolve(part) !== resolve(`${entry.targetPath}.part`) || dirname(resolve(part)) !== dirname(resolve(entry.targetPath))) throw Object.assign(new Error("unsafe model partial path"), { code: "model_part_path_unsafe" });
  await rm(part, { force: true, recursive: false });
  const response = await fetchImpl(entry.url, { redirect: "follow" });
  if (!response.ok || !response.body) throw Object.assign(new Error(`download failed: ${response.status}`), { code: "model_download_failed" });
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > entry.sizeBytes) throw Object.assign(new Error("model response exceeds locked size"), { code: "model_download_oversized" });
  let received = 0;
  const { Transform } = await import("node:stream");
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      callback(received > entry.sizeBytes ? Object.assign(new Error("model response exceeds locked size"), { code: "model_download_oversized" }) : null, chunk);
    }
  });
  try {
    await pipeline(Readable.fromWeb(response.body), limiter, (await import("node:fs")).createWriteStream(part, { flags: "wx" }));
    await verifyLockedFile(part, entry);
    await rename(part, entry.targetPath);
  } catch (error) {
    await rm(part, { force: true, recursive: false });
    throw error;
  }
  return verifyLockedFile(entry.targetPath, entry);
}

function spawnChecked(executable, args, options, spawnImpl = spawn) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawnImpl(executable, args, { ...options, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    const collect = (target, chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > 1024 * 1024) {
        child.kill();
        rejectPromise(Object.assign(new Error("git output exceeded 1 MiB"), { code: "git_output_limit" }));
        return target;
      }
      return target + chunk.toString("utf8");
    };
    child.stdout?.on("data", chunk => { stdout = collect(stdout, chunk); });
    child.stderr?.on("data", chunk => { stderr = collect(stderr, chunk); });
    child.once("error", rejectPromise);
    child.once("exit", code => code === 0 ? resolvePromise({ stdout, stderr }) : rejectPromise(Object.assign(new Error(stderr.trim() || `exit ${code}`), { code: "git_install_failed" })));
  });
}

async function installCustomNode(entry, spawnImpl = spawn) {
  if (await exists(entry.targetPath)) {
    const result = await spawnChecked("git", ["-C", entry.targetPath, "rev-parse", "HEAD"], {}, spawnImpl);
    const actualCommit = result.stdout.trim();
    if (actualCommit !== entry.commit) throw Object.assign(new Error(`custom node commit mismatch: ${actualCommit}`), { code: "custom_node_commit_mismatch" });
    return { path: entry.targetPath, commit: actualCommit, reused: true };
  }
  const temp = `${entry.targetPath}.tmp`;
  await rm(temp, { recursive: true, force: true });
  await mkdir(dirname(entry.targetPath), { recursive: true });
  await spawnChecked("git", ["clone", "--no-checkout", entry.gitUrl, temp], {}, spawnImpl);
  await spawnChecked("git", ["-C", temp, "checkout", "--detach", entry.commit], {}, spawnImpl);
  const result = await spawnChecked("git", ["-C", temp, "rev-parse", "HEAD"], {}, spawnImpl);
  if (result.stdout.trim() !== entry.commit) throw Object.assign(new Error("checked out custom node commit does not match lock"), { code: "custom_node_commit_mismatch" });
  await rename(temp, entry.targetPath);
  return { path: entry.targetPath, commit: entry.commit, reused: false };
}
```

- [ ] **Step 5: Implement the exact non-destructive extra-model-path migration**

Add this function to `host-installer.mjs`:

```js
async function migrateLegacyPaths(lock) {
  const migration = lock.legacyMigration;
  const actualInputHash = await sha256File(migration.extraModelPaths);
  const yamlText = await readFile(migration.extraModelPaths, "utf8");
  const config = YAML.parse(yamlText);
  const isExpectedPollution = config?.hermes?.base_path === "C:/Users/petbl/hermes_models" && config?.hermes?.checkpoints === "." && config?.hermes?.loras === ".";
  if (!isExpectedPollution && config?.hermes === undefined) return { legacyLorasCopied: 0, changed: false };
  if (!isExpectedPollution || actualInputHash !== migration.acceptedInputSha256) {
    throw Object.assign(new Error("extra_model_paths.yaml does not match the audited migration input"), { code: "extra_model_paths_unexpected" });
  }
  const comfyRoot = dirname(migration.extraModelPaths);
  const nativeLoraDir = join(comfyRoot, "models", "loras");
  await mkdir(nativeLoraDir, { recursive: true });
  let copied = 0;
  for (const entry of migration.legacyLoras) {
    const source = join(migration.legacyRoot, entry.filename);
    const target = join(nativeLoraDir, entry.filename);
    await verifyLockedFile(source, entry);
    if (!(await exists(target))) {
      await copyFile(source, target);
      copied += 1;
    }
    await verifyLockedFile(target, entry);
  }
  const backup = `${migration.extraModelPaths}.yadam-${actualInputHash}.bak`;
  if (!(await exists(backup))) await copyFile(migration.extraModelPaths, backup);
  delete config.hermes;
  const temp = `${migration.extraModelPaths}.tmp`;
  await writeFile(temp, YAML.stringify(config), "utf8");
  await rename(temp, migration.extraModelPaths);
  return { legacyLorasCopied: copied, changed: true, backup };
}
```

This migration copies the two legacy LoRAs into native `ComfyUI/models/loras`, leaves the original flat files untouched, removes only the audited ambiguous `hermes` mapping and preserves `hermes_local` plus every unrelated YAML section.

- [ ] **Step 6: Implement the confirmation-gated apply function and CLI**

Complete `host-installer.mjs`:

```js
export async function applyHostInstallation({ hostConfig, lock, confirmation, fetchImpl = fetch, spawnImpl = spawn, installModels = true, installCustomNode: shouldInstallNode = true }) {
  if (confirmation !== REQUIRED_CONFIRMATION) throw Object.assign(new Error("external image stack changes require confirmation"), { code: "external_change_confirmation_required" });
  const migration = await migrateLegacyPaths(lock);
  if (installModels) {
    const authorizedModelRoot = join(hostConfig.comfyui.portableRoot, "ComfyUI", "models");
    await downloadLockedModel(lock.models.clipVision, authorizedModelRoot, fetchImpl);
    await downloadLockedModel(lock.models.ipAdapter, authorizedModelRoot, fetchImpl);
  }
  if (shouldInstallNode) await installCustomNode(lock.customNode, spawnImpl);
  const report = await inspectHostInstallation({ hostConfig, lock, spawnImpl });
  return { ...report, ...migration, restartRequired: true };
}
```

Create `scripts/yadam-image-host.mjs` so `--check` calls only `inspectHostInstallation`, while `--apply --confirmation INSTALL_YADAM_IMAGE_STACK` calls `applyHostInstallation`. Reject every other argument and print one JSON object. Never stop or restart an already-running ComfyUI process.

- [ ] **Step 7: Run installer tests**

Run: `node --test test/yadam/image-config.test.mjs`

Expected: confirmation, copy-without-delete, exact YAML migration and read-only inspection tests pass; no request reaches the public internet.

- [ ] **Step 8: Commit the opt-in installer**

```bash
git add scripts/lib/yadam/images/host-installer.mjs scripts/yadam-image-host.mjs test/yadam/image-config.test.mjs test/yadam/fixtures/images/extra-model-paths-polluted.yaml
git commit -m "feat: add opt-in ComfyUI image stack installer"
```

### Task 3: Create both exact ComfyUI workflow JSON files and typed substitution

**Files:**
- Create: `assets/workflows/yadam_sdxl_reference_v1.json`
- Create: `assets/workflows/yadam_sdxl_ipadapter_v1.json`
- Create: `scripts/lib/yadam/images/workflow-template.mjs`
- Create: `test/yadam/image-workflow.test.mjs`

**Interfaces:**
- Consumes: ComfyUI API workflow format and `/object_info` class map.
- Produces: `loadWorkflowDescriptor({ workspaceRoot, conditioning })`, `compileWorkflow({ descriptor, values, objectInfo })`.

- [ ] **Step 1: Write failing graph and placeholder tests**

Create `test/yadam/image-workflow.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { loadWorkflowDescriptor, compileWorkflow } from "../../scripts/lib/yadam/images/workflow-template.mjs";

const required = ["CheckpointLoaderSimple", "CLIPTextEncode", "EmptyLatentImage", "KSampler", "VAEDecode", "SaveImage", "LoadImage", "IPAdapterUnifiedLoader", "IPAdapter"];
const objectInfo = Object.fromEntries(required.map(name => [name, {}]));

test("conditioned workflow has fixed output and no LoRA", async () => {
  const descriptor = await loadWorkflowDescriptor({ workspaceRoot: process.cwd(), conditioning: "sdxl-ipadapter-plus-face" });
  const graph = compileWorkflow({ descriptor, objectInfo, values: {
    CKPT: "sd_xl_base_1.0.safetensors", REFERENCE_IMAGE: "yadam-references/ref.png", PROMPT: "color Joseon illustration", NEGATIVE_PROMPT: "text", WIDTH: 1024, HEIGHT: 576, SEED: 7, STEPS: 24, CFG: 6, SAMPLER: "dpmpp_2m", SCHEDULER: "karras", IPADAPTER_WEIGHT: 0.8, IPADAPTER_START: 0, IPADAPTER_END: 0.85, FILENAME_PREFIX: "yadam/job/slot"
  }});
  assert.equal(graph["9"].class_type, "SaveImage");
  assert.equal(graph["22"].inputs.weight_type, "standard");
  assert.equal(graph["5"].inputs.batch_size, 1);
  assert.equal(JSON.stringify(graph).includes("Lora"), false);
  assert.equal(JSON.stringify(graph).includes("{{"), false);
});
```

- [ ] **Step 2: Run and verify the workflow module is missing**

Run: `node --test test/yadam/image-workflow.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `workflow-template.mjs`.

- [ ] **Step 3: Create the reference T2I graph**

Create `assets/workflows/yadam_sdxl_reference_v1.json` exactly:

```json
{
  "3": { "class_type": "KSampler", "inputs": { "seed": "{{SEED}}", "steps": "{{STEPS}}", "cfg": "{{CFG}}", "sampler_name": "{{SAMPLER}}", "scheduler": "{{SCHEDULER}}", "denoise": 1.0, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0] } },
  "4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "{{CKPT}}" } },
  "5": { "class_type": "EmptyLatentImage", "inputs": { "width": "{{WIDTH}}", "height": "{{HEIGHT}}", "batch_size": 1 } },
  "6": { "class_type": "CLIPTextEncode", "inputs": { "text": "{{PROMPT}}", "clip": ["4", 1] } },
  "7": { "class_type": "CLIPTextEncode", "inputs": { "text": "{{NEGATIVE_PROMPT}}", "clip": ["4", 1] } },
  "8": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0], "vae": ["4", 2] } },
  "9": { "class_type": "SaveImage", "inputs": { "filename_prefix": "{{FILENAME_PREFIX}}", "images": ["8", 0] } }
}
```

- [ ] **Step 4: Create the IP-Adapter conditioned graph**

Create `assets/workflows/yadam_sdxl_ipadapter_v1.json` exactly:

```json
{
  "3": { "class_type": "KSampler", "inputs": { "seed": "{{SEED}}", "steps": "{{STEPS}}", "cfg": "{{CFG}}", "sampler_name": "{{SAMPLER}}", "scheduler": "{{SCHEDULER}}", "denoise": 1.0, "model": ["22", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0] } },
  "4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "{{CKPT}}" } },
  "5": { "class_type": "EmptyLatentImage", "inputs": { "width": "{{WIDTH}}", "height": "{{HEIGHT}}", "batch_size": 1 } },
  "6": { "class_type": "CLIPTextEncode", "inputs": { "text": "{{PROMPT}}", "clip": ["4", 1] } },
  "7": { "class_type": "CLIPTextEncode", "inputs": { "text": "{{NEGATIVE_PROMPT}}", "clip": ["4", 1] } },
  "8": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0], "vae": ["4", 2] } },
  "9": { "class_type": "SaveImage", "inputs": { "filename_prefix": "{{FILENAME_PREFIX}}", "images": ["8", 0] } },
  "20": { "class_type": "LoadImage", "inputs": { "image": "{{REFERENCE_IMAGE}}" } },
  "21": { "class_type": "IPAdapterUnifiedLoader", "inputs": { "model": ["4", 0], "preset": "PLUS FACE (portraits)" } },
  "22": { "class_type": "IPAdapter", "inputs": { "model": ["21", 0], "ipadapter": ["21", 1], "image": ["20", 0], "weight": "{{IPADAPTER_WEIGHT}}", "start_at": "{{IPADAPTER_START}}", "end_at": "{{IPADAPTER_END}}", "weight_type": "standard" } }
}
```

- [ ] **Step 5: Implement typed substitution and graph validation**

Create `scripts/lib/yadam/images/workflow-template.mjs`:

```js
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const DESCRIPTORS = {
  none: { relativePath: "assets/workflows/yadam_sdxl_reference_v1.json", outputNodeId: "9", placeholders: ["CKPT", "PROMPT", "NEGATIVE_PROMPT", "WIDTH", "HEIGHT", "SEED", "STEPS", "CFG", "SAMPLER", "SCHEDULER", "FILENAME_PREFIX"] },
  "sdxl-ipadapter-plus-face": { relativePath: "assets/workflows/yadam_sdxl_ipadapter_v1.json", outputNodeId: "9", placeholders: ["CKPT", "REFERENCE_IMAGE", "PROMPT", "NEGATIVE_PROMPT", "WIDTH", "HEIGHT", "SEED", "STEPS", "CFG", "SAMPLER", "SCHEDULER", "IPADAPTER_WEIGHT", "IPADAPTER_START", "IPADAPTER_END", "FILENAME_PREFIX"] }
};

const NUMERIC = new Set(["WIDTH", "HEIGHT", "SEED", "STEPS", "CFG", "IPADAPTER_WEIGHT", "IPADAPTER_START", "IPADAPTER_END"]);

export async function loadWorkflowDescriptor({ workspaceRoot, conditioning }) {
  const base = DESCRIPTORS[conditioning];
  if (!base) throw Object.assign(new Error(`unsupported conditioning: ${conditioning}`), { code: "unsupported_conditioning" });
  const path = resolve(workspaceRoot, base.relativePath);
  return { ...base, path, template: JSON.parse(await readFile(path, "utf8")) };
}

function substitute(value, values, seen) {
  if (Array.isArray(value)) return value.map(item => substitute(item, values, seen));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, values, seen)]));
  if (typeof value !== "string") return value;
  const match = /^\{\{([A-Z_]+)\}\}$/.exec(value);
  if (!match) {
    if (value.includes("{{")) throw Object.assign(new Error(`embedded placeholder: ${value}`), { code: "embedded_workflow_placeholder" });
    return value;
  }
  const key = match[1];
  if (!(key in values)) throw Object.assign(new Error(`missing placeholder: ${key}`), { code: "missing_workflow_placeholder" });
  seen.add(key);
  const replacement = values[key];
  if (NUMERIC.has(key) && typeof replacement !== "number") throw Object.assign(new Error(`${key} must be numeric`), { code: "workflow_placeholder_type" });
  return replacement;
}

export function compileWorkflow({ descriptor, values, objectInfo }) {
  const unknown = Object.keys(values).filter(key => !descriptor.placeholders.includes(key));
  if (unknown.length) throw Object.assign(new Error(`unknown placeholders: ${unknown.join(",")}`), { code: "unknown_workflow_placeholder" });
  const seen = new Set();
  const graph = substitute(descriptor.template, values, seen);
  const missing = descriptor.placeholders.filter(key => !seen.has(key));
  if (missing.length) throw Object.assign(new Error(`unused descriptor placeholders: ${missing.join(",")}`), { code: "unused_workflow_placeholder" });
  for (const [nodeId, node] of Object.entries(graph)) {
    if (!objectInfo[node.class_type]) throw Object.assign(new Error(`missing node class ${node.class_type}`), { code: "missing_comfy_node", nodeId });
    for (const input of Object.values(node.inputs)) {
      if (Array.isArray(input) && input.length === 2 && typeof input[0] === "string" && !graph[input[0]]) throw Object.assign(new Error(`broken node reference ${input[0]}`), { code: "broken_workflow_reference", nodeId });
    }
    if (node.class_type.includes("Lora")) throw Object.assign(new Error("LoRA nodes are forbidden in yadam v1"), { code: "forbidden_lora_node" });
  }
  if (graph[descriptor.outputNodeId]?.class_type !== "SaveImage") throw Object.assign(new Error("fixed output node missing"), { code: "workflow_output_node_missing" });
  return graph;
}
```

- [ ] **Step 6: Run workflow tests**

Run: `node --test test/yadam/image-workflow.test.mjs`

Expected: conditioned and unconditioned graphs compile, output node `9` is fixed, every placeholder is consumed, LoRA injection and missing node classes fail.

- [ ] **Step 7: Commit the two workflows**

```bash
git add assets/workflows/yadam_sdxl_reference_v1.json assets/workflows/yadam_sdxl_ipadapter_v1.json scripts/lib/yadam/images/workflow-template.mjs test/yadam/image-workflow.test.mjs
git commit -m "feat: add deterministic yadam SDXL workflows"
```

### Task 4: Define closed image contracts and the deterministic prompt/idempotency compiler

**Files:**
- Create: `schemas/yadam/compiled-image-request.schema.json`
- Create: `scripts/lib/yadam/images/prompt-compiler.mjs`
- Modify: `test/yadam/image-workflow.test.mjs`

**Interfaces:**
- Consumes: Plan 01 `hashCanonical`, Plan 02 story bible/scene plan/thumbnail plan, reference-set pointer and image stack lock.
- Produces: `compileImageRequest(input): CompiledImageRequest` and `deriveImageSeed({ jobSeed, assetId }): number`.

- [ ] **Step 1: Write failing deterministic, non-character and approval-state tests**

Add to `test/yadam/image-workflow.test.mjs`:

```js
import { compileImageRequest, deriveImageSeed } from "../../scripts/lib/yadam/images/prompt-compiler.mjs";

const baseInput = {
  jobId: "job-001",
  jobSeed: 17,
  mode: "preview",
  purpose: "scene",
  assetId: "img-slot-001",
  visualSlot: { visualSlotId: "slot-001", primarySceneId: "scene-0001", sourceSceneIds: ["scene-0001"] },
  sourceScenes: [{ sceneId: "scene-0001", sourceHash: "f".repeat(64) }],
  scene: { sceneId: "scene-0001", visualDescription: "마당에서 봉투를 건네는 하인", activeCharacters: [{ characterId: "char-servant", variantId: "v-base", focal: true }], location: "조선시대 한옥 마당", action: "봉투를 건넨다", emotion: "불안", props: ["봉투"] },
  character: { characterId: "char-servant", variantId: "v-base", appearanceAnchors: ["young Korean male servant", "narrow face"], wardrobeAnchors: ["brown hemp hanbok"] },
  reference: { status: "provisional", path: "assets/character-references/char-servant/v-base/primary.png", sha256: "a".repeat(64) },
  render: { width: 1024, height: 576, steps: 24, cfg: 6, sampler: "dpmpp_2m", scheduler: "karras" },
  stack: { workflowHash: "b".repeat(64), checkpointHash: "c".repeat(64), clipVisionHash: "d".repeat(64), ipAdapterHash: "e".repeat(64), compilerVersion: "1.0.0", schemaVersion: "1.0.0", styleVersion: "1.0.0" }
};

test("prompt compilation is deterministic and binds reference bytes", () => {
  const first = compileImageRequest(baseInput);
  const second = compileImageRequest(structuredClone(baseInput));
  assert.deepEqual(second, first);
  assert.equal(first.conditioning.method, "sdxl-ipadapter-plus-face");
  assert.match(first.idempotencyKey, /^[0-9a-f]{64}$/);
  assert.equal(first.render.seed, deriveImageSeed({ jobSeed: 17, assetId: "img-slot-001" }));
});

test("production rejects provisional references", () => {
  assert.throws(() => compileImageRequest({ ...baseInput, mode: "production" }), error => error.code === "reference_not_approved");
});

test("non-character slot uses the same SDXL style without IPAdapter", () => {
  const request = compileImageRequest({ ...baseInput, mode: "production", purpose: "intro", character: null, reference: null, scene: { ...baseInput.scene, activeCharacters: [] } });
  assert.equal(request.identity, null);
  assert.equal(request.conditioning.method, "none");
});

test("a primary character reference keeps identity anchors but is unconditioned", () => {
  const request = compileImageRequest({ ...baseInput, purpose: "reference", reference: null, visualSlot: { visualSlotId: "reference-char-servant-v-base", primarySceneId: null, sourceSceneIds: [] }, sourceScenes: [] });
  assert.equal(request.identity.referenceStatus, "none");
  assert.equal(request.identity.referencePath, null);
  assert.equal(request.conditioning.method, "none");
});
```

- [ ] **Step 2: Run and verify the compiler is missing**

Run: `node --test test/yadam/image-workflow.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `prompt-compiler.mjs`.

- [ ] **Step 3: Create the closed compiled request schema**

Create `schemas/yadam/compiled-image-request.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://auto-video.local/schemas/yadam/compiled-image-request.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "jobId", "assetId", "mode", "visualSlotId", "sourceSceneIds", "primarySceneId", "sourceScenes", "purpose", "identity", "story", "composition", "positivePrompt", "negativePrompt", "conditioning", "render", "provenance", "idempotencyKey"],
  "properties": {
    "schemaVersion": { "const": "1.0.0" },
    "jobId": { "type": "string", "minLength": 1 },
    "assetId": { "type": "string", "pattern": "^[a-z0-9-]+$" },
    "mode": { "enum": ["preview", "production"] },
    "visualSlotId": { "type": "string", "minLength": 1 },
    "sourceSceneIds": { "type": "array", "uniqueItems": true, "items": { "type": "string", "pattern": "^scene-[0-9]{4}$" } },
    "primarySceneId": { "oneOf": [{ "type": "null" }, { "type": "string", "pattern": "^scene-[0-9]{4}$" }] },
    "sourceScenes": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["sceneId", "sourceHash"],
        "properties": {
          "sceneId": { "type": "string", "pattern": "^scene-[0-9]{4}$" },
          "sourceHash": { "type": "string", "pattern": "^[0-9a-f]{64}$" }
        }
      }
    },
    "purpose": { "enum": ["reference", "scene", "intro", "thumbnail-background"] },
    "identity": {
      "oneOf": [
        { "type": "null" },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["characterId", "variantId", "referenceStatus", "referencePath", "referenceSha256", "appearanceAnchors", "wardrobeAnchors"],
          "properties": {
            "characterId": { "type": "string", "minLength": 1 },
            "variantId": { "type": "string", "minLength": 1 },
            "referenceStatus": { "enum": ["none", "provisional", "approved"] },
            "referencePath": { "oneOf": [{ "type": "null" }, { "type": "string", "minLength": 1 }] },
            "referenceSha256": { "oneOf": [{ "type": "null" }, { "type": "string", "pattern": "^[0-9a-f]{64}$" }] },
            "appearanceAnchors": { "type": "array", "minItems": 1, "uniqueItems": true, "items": { "type": "string", "minLength": 1 } },
            "wardrobeAnchors": { "type": "array", "minItems": 1, "uniqueItems": true, "items": { "type": "string", "minLength": 1 } }
          }
        }
      ]
    },
    "story": {
      "type": "object",
      "additionalProperties": false,
      "required": ["subject", "action", "emotion", "location", "era", "wardrobe", "props"],
      "properties": {
        "subject": { "type": "string", "minLength": 1 },
        "action": { "type": "string", "minLength": 1 },
        "emotion": { "type": "string", "minLength": 1 },
        "location": { "type": "string", "minLength": 1 },
        "era": { "const": "Joseon-era Korea" },
        "wardrobe": { "type": "array", "items": { "type": "string" } },
        "props": { "type": "array", "items": { "type": "string" } }
      }
    },
    "composition": {
      "type": "object",
      "additionalProperties": false,
      "required": ["shotSize", "cameraAngle", "focalPosition", "focalHeadcount", "gaze", "reservedTextRect"],
      "properties": {
        "shotSize": { "enum": ["close-up", "medium", "wide", "establishing"] },
        "cameraAngle": { "enum": ["eye-level", "low", "high", "three-quarter"] },
        "focalPosition": { "enum": ["left", "center", "right", "background"] },
        "focalHeadcount": { "type": "integer", "minimum": 0, "maximum": 1 },
        "gaze": { "enum": ["camera", "left", "right", "down", "away"] },
        "reservedTextRect": { "oneOf": [{ "type": "null" }, { "type": "array", "prefixItems": [{ "type": "number", "minimum": 0, "maximum": 1 }, { "type": "number", "minimum": 0, "maximum": 1 }, { "type": "number", "exclusiveMinimum": 0, "maximum": 1 }, { "type": "number", "exclusiveMinimum": 0, "maximum": 1 }], "minItems": 4, "maxItems": 4 }] }
      }
    },
    "positivePrompt": { "type": "string", "minLength": 40 },
    "negativePrompt": { "type": "string", "minLength": 40 },
    "conditioning": {
      "type": "object",
      "additionalProperties": false,
      "required": ["method", "preset", "weightType", "referenceSha256", "weight", "start", "end"],
      "properties": {
        "method": { "enum": ["none", "sdxl-ipadapter-plus-face"] },
        "preset": { "oneOf": [{ "type": "null" }, { "const": "PLUS FACE (portraits)" }] },
        "weightType": { "oneOf": [{ "type": "null" }, { "const": "standard" }] },
        "referenceSha256": { "oneOf": [{ "type": "null" }, { "type": "string", "pattern": "^[0-9a-f]{64}$" }] },
        "weight": { "type": "number", "minimum": 0, "maximum": 1.5 },
        "start": { "type": "number", "minimum": 0, "maximum": 1 },
        "end": { "type": "number", "minimum": 0, "maximum": 1 }
      }
    },
    "render": {
      "type": "object",
      "additionalProperties": false,
      "required": ["width", "height", "seed", "steps", "cfg", "sampler", "scheduler"],
      "properties": {
        "width": { "enum": [768, 1024, 1280] },
        "height": { "enum": [576, 720, 1024] },
        "seed": { "type": "integer", "minimum": 0, "maximum": 281474976710655 },
        "steps": { "enum": [24, 28] },
        "cfg": { "const": 6 },
        "sampler": { "const": "dpmpp_2m" },
        "scheduler": { "const": "karras" }
      }
    },
    "provenance": {
      "type": "object",
      "additionalProperties": false,
      "required": ["compilerVersion", "schemaVersion", "styleVersion", "workflowHash", "checkpointHash", "clipVisionHash", "ipAdapterHash", "loraHash"],
      "properties": {
        "compilerVersion": { "type": "string", "minLength": 1 },
        "schemaVersion": { "const": "1.0.0" },
        "styleVersion": { "type": "string", "minLength": 1 },
        "workflowHash": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
        "checkpointHash": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
        "clipVisionHash": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
        "ipAdapterHash": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
        "loraHash": { "type": "null" }
      }
    },
    "idempotencyKey": { "type": "string", "pattern": "^[0-9a-f]{64}$" }
  }
}
```

- [ ] **Step 4: Implement stable clauses, seed and idempotency projection**

Create `scripts/lib/yadam/images/prompt-compiler.mjs`:

```js
import { fileURLToPath } from "node:url";
import { hashCanonical } from "../../pipeline/canonical-json.mjs";
import { validateSchema } from "../../pipeline/schema-registry.mjs";

const REQUEST_SCHEMA_PATH = fileURLToPath(new URL("../../../../schemas/yadam/compiled-image-request.schema.json", import.meta.url));

const STYLE = "color Joseon-era Korean historical manhwa illustration, clean expressive ink outlines, restrained painterly color, warm cinematic lighting, 2D semi-realistic storybook art";
const NEGATIVE = "photorealistic photo, 3D render, stick figure, monochrome, grayscale, modern objects, modern clothing, readable text, Korean letters, English letters, numbers, watermark, logo, malformed hands, extra fingers, extra faces";

export function deriveImageSeed({ jobSeed, assetId }) {
  if (!Number.isSafeInteger(jobSeed) || jobSeed < 0 || typeof assetId !== "string" || !assetId) throw Object.assign(new Error("invalid image seed input"), { code: "image_seed_input_invalid" });
  const hex = hashCanonical({ jobSeed, assetId }).slice(0, 12);
  return Number.parseInt(hex, 16);
}

function compositionFor(input) {
  const thumbnailRect = input.purpose === "thumbnail-background" ? input.thumbnail?.textRect : null;
  const focal = input.character ? (thumbnailRect ? (thumbnailRect[0] + thumbnailRect[2] / 2 <= 0.5 ? "right" : "left") : "center") : "background";
  return {
    shotSize: input.scene.shotSize ?? (input.character ? "medium" : "establishing"),
    cameraAngle: input.scene.cameraAngle ?? "eye-level",
    focalPosition: input.scene.focalPosition ?? focal,
    focalHeadcount: input.character ? 1 : 0,
    gaze: input.scene.gaze ?? "away",
    reservedTextRect: thumbnailRect ?? null
  };
}

export function compileImageRequest(input) {
  if (input.character && input.purpose !== "reference" && !input.reference) throw Object.assign(new Error("focal character requires reference"), { code: "reference_missing" });
  if (input.mode === "production" && input.character && input.purpose !== "reference" && input.reference?.status !== "approved") throw Object.assign(new Error("production requires approved reference"), { code: "reference_not_approved" });
  const sourceSceneIds = [...input.visualSlot.sourceSceneIds].sort();
  if (new Set(sourceSceneIds).size !== sourceSceneIds.length) throw Object.assign(new Error("duplicate source scene"), { code: "source_scene_duplicate" });
  if ((input.visualSlot.primarySceneId ?? null) !== null && !sourceSceneIds.includes(input.visualSlot.primarySceneId)) throw Object.assign(new Error("primary scene is outside source projection"), { code: "primary_scene_invalid" });
  const sourceById = new Map(input.sourceScenes.map(scene => [scene.sceneId, scene]));
  if (sourceById.size !== input.sourceScenes.length) throw Object.assign(new Error("duplicate source-scene projection row"), { code: "source_scene_duplicate" });
  const sourceScenes = sourceSceneIds.map(sceneId => {
    const scene = sourceById.get(sceneId);
    if (!scene || !/^[0-9a-f]{64}$/.test(scene.sourceHash)) throw Object.assign(new Error(`source scene/hash missing: ${sceneId}`), { code: "source_scene_hash_missing" });
    return { sceneId, sourceHash: scene.sourceHash };
  });
  if (sourceById.size !== sourceScenes.length) throw Object.assign(new Error("orphan source scene projection"), { code: "source_scene_orphan" });
  const identity = input.character ? {
    characterId: input.character.characterId,
    variantId: input.character.variantId,
    referenceStatus: input.reference?.status ?? "none",
    referencePath: input.reference?.path ?? null,
    referenceSha256: input.reference?.sha256 ?? null,
    appearanceAnchors: input.character.appearanceAnchors,
    wardrobeAnchors: input.character.wardrobeAnchors
  } : null;
  const composition = compositionFor(input);
  const positivePrompt = [
    STYLE,
    input.scene.visualDescription,
    input.scene.location,
    input.scene.action,
    input.scene.emotion,
    ...(input.character?.appearanceAnchors ?? []),
    ...(input.character?.wardrobeAnchors ?? []),
    ...(input.scene.props ?? []),
    `shot ${composition.shotSize}`,
    `camera ${composition.cameraAngle}`,
    `focal subject ${composition.focalPosition}`,
    composition.reservedTextRect ? `clean negative space reserved for title at normalized rectangle ${composition.reservedTextRect.join(",")}` : ""
  ].filter(Boolean).join(", ");
  const conditioning = input.character && input.reference ? { method: "sdxl-ipadapter-plus-face", preset: "PLUS FACE (portraits)", weightType: "standard", referenceSha256: input.reference.sha256, weight: 0.8, start: 0, end: 0.85 } : { method: "none", preset: null, weightType: null, referenceSha256: null, weight: 0, start: 0, end: 0 };
  const request = {
    schemaVersion: "1.0.0",
    jobId: input.jobId,
    assetId: input.assetId,
    mode: input.mode,
    visualSlotId: input.visualSlot.visualSlotId,
    sourceSceneIds,
    primarySceneId: input.visualSlot.primarySceneId ?? null,
    sourceScenes,
    purpose: input.purpose,
    identity,
    story: { subject: input.scene.visualDescription, action: input.scene.action, emotion: input.scene.emotion, location: input.scene.location, era: "Joseon-era Korea", wardrobe: input.character?.wardrobeAnchors ?? [], props: input.scene.props ?? [] },
    composition,
    positivePrompt,
    negativePrompt: NEGATIVE,
    conditioning,
    render: { ...input.render, seed: deriveImageSeed({ jobSeed: input.jobSeed, assetId: input.assetId }) },
    provenance: { compilerVersion: input.stack.compilerVersion, schemaVersion: input.stack.schemaVersion, styleVersion: input.stack.styleVersion, workflowHash: input.stack.workflowHash, checkpointHash: input.stack.checkpointHash, clipVisionHash: input.stack.clipVisionHash, ipAdapterHash: input.stack.ipAdapterHash, loraHash: null },
    idempotencyKey: ""
  };
  const requestProjection = structuredClone(request);
  delete requestProjection.idempotencyKey;
  delete requestProjection.jobId;
  delete requestProjection.assetId;
  delete requestProjection.mode;
  if (requestProjection.identity) {
    delete requestProjection.identity.referenceStatus;
    delete requestProjection.identity.referencePath;
  }
  request.idempotencyKey = hashCanonical({
    provider: "comfyui",
    adapterVersion: "1.0.0",
    request: requestProjection
  });
  validateSchema(REQUEST_SCHEMA_PATH, request);
  return request;
}
```

- [ ] **Step 5: Add source-projection, conflict and focal-headcount guards**

Before returning, reject `(input.scene.activeCharacters ?? []).filter(item => item.focal).length > 1` with code `focal_character_limit`; reject a normalized thumbnail rectangle whose `x+w` or `y+h` exceeds `1`; for conditioned requests reject `conditioning.start >= conditioning.end`; and reject any style clause that appears in both positive and negative token sets. Enforce the only legal render tuples: reference `768×1024/28`, scene or intro `1024×576/24`, thumbnail background `1280×720/24`, all with the locked CFG/sampler/scheduler. For `method:"none"`, require `preset:null`, `weightType:null`, `referenceSha256:null` and zero weight/start/end. Enforce identity coherence: `referenceStatus:"none"` requires null path/hash and is allowed only for an unconditioned primary `purpose:"reference"`; provisional/approved statuses require both path/hash; a derived reference must point directly to its pair's primary; every non-reference focal request requires one.

A `purpose:"reference"` request must have `primarySceneId:null`, empty source-scene arrays and a fixed reference brief derived only from the story-bible character/variant semantic row: neutral Joseon backdrop, standing neutral pose for primary or fixed half-side pose for the one derived view, neutral expression, and the immutable appearance/wardrobe anchors. Reject a caller that supplies a Plan 02 narration scene ID/hash or narration-derived visual/action text for a reference. This is what makes character references structurally disjoint from duration-repair scene hashes. Validate every non-reference sorted source projection against both Plan 02 scene-plan IDs and Plan 03 scene `{sceneId,sourceHash}` rows and reject duplicate projection rows.

Validate the completed request against `compiled-image-request.schema.json` before returning. The pixel-idempotency projection starts from the entire closed request, then removes only `idempotencyKey` and the five declared non-pixel authorization/location fields: top-level `jobId`, `assetId`, `mode`, plus `identity.referenceStatus` and `identity.referencePath`; `render.seed`, reference content hash, all semantic/composition fields and provenance remain bound. This default-includes future schema fields while allowing a byte-identical provisional preview raster to be rebound after approval. Add one test for each guard; prove mode/status/path-only changes keep `idempotencyKey` but change the persisted request file hash, then mutate purpose, one identity anchor, reference content hash, one story field, gaze, reserved rectangle, one source hash, conditioning preset, workflow hash, checkpoint hash, CLIP Vision hash and IP-Adapter hash independently and assert every pixel-affecting mutation changes `idempotencyKey`.

- [ ] **Step 6: Run compiler tests**

Run: `node --test test/yadam/image-workflow.test.mjs`

Expected: deterministic requests match byte-for-byte; provisional production, source hash drift, source ID mismatch, two focal faces, invalid timing and conflicting clauses fail; every source/preset/model mutation changes the key; non-character slots pass with conditioning `none`, `preset:null` and `weightType:null`.

- [ ] **Step 7: Commit request contracts**

```bash
git add schemas/yadam/compiled-image-request.schema.json scripts/lib/yadam/images/prompt-compiler.mjs test/yadam/image-workflow.test.mjs
git commit -m "feat: compile deterministic yadam image requests"
```

### Task 5: Validate scene/intro cadence and publish the unresolved canonical render plan

**Files:**
- Create: `schemas/yadam/render-plan.schema.json`
- Create: `scripts/lib/yadam/images/visual-slot-plan.mjs`
- Modify: `test/yadam/image-workflow.test.mjs`

**Interfaces:**
- Consumes: Plan 03 `loadPassedAudioHandoff(jobDir)` without renaming its fields, Plan 02 `getApprovedVisualPlanningInput(jobDir)`, and compiled request artifacts.
- Produces: `validateVisualSlots({ audioHandoff, profile })` and `publishRenderPlan({ jobDir, audioHandoff, compiledRequests, profile, visualPlanning })`, where each compiled entry is `{artifactId,relativePath,sha256,value}` from immutable compiled-request persistence; validates the result against `render-plan.schema.json` before any write.

- [ ] **Step 1: Add failing 10-minute cadence and boundary tests**

Add to `test/yadam/image-workflow.test.mjs`:

```js
import { validateVisualSlots } from "../../scripts/lib/yadam/images/visual-slot-plan.mjs";

function tenMinuteHandoff() {
  const slots = [];
  for (let index = 0; index < 10; index += 1) slots.push({ visualSlotId: `intro-${index + 1}`, visualOrder: index + 1, segmentId: "segment-01", startSeconds: index * 6, endSeconds: (index + 1) * 6, durationSeconds: 6, timingBand: "intro", purpose: "intro", sourceSceneIds: ["scene-0001"], primarySceneId: "scene-0001", extendedHold: false, holdReason: null });
  for (let index = 0; index < 18; index += 1) {
    const sceneId = `scene-${String(index + 2).padStart(4, "0")}`;
    slots.push({ visualSlotId: `body-${index + 1}`, visualOrder: index + 11, segmentId: "segment-01", startSeconds: 60 + index * 30, endSeconds: 60 + (index + 1) * 30, durationSeconds: 30, timingBand: "body", purpose: "scene", sourceSceneIds: [sceneId], primarySceneId: sceneId, extendedHold: false, holdReason: null });
  }
  const scenes = [{ sceneId: "scene-0001", segmentId: "segment-01", order: 1, sourceHash: "1".repeat(64), ttsNormalizedHash: "2".repeat(64), ttsOptionsHash: "3".repeat(64), normalizedWavPath: "assets/audio/normalized/scene-0001.wav", normalizedWavHash: "4".repeat(64), durationSeconds: 60, startSeconds: 0, endSeconds: 60 }];
  for (let index = 0; index < 18; index += 1) scenes.push({ sceneId: `scene-${String(index + 2).padStart(4, "0")}`, segmentId: "segment-01", order: index + 2, sourceHash: `${(index % 9) + 1}`.repeat(64), ttsNormalizedHash: "a".repeat(64), ttsOptionsHash: "b".repeat(64), normalizedWavPath: `assets/audio/normalized/scene-${String(index + 2).padStart(4, "0")}.wav`, normalizedWavHash: "c".repeat(64), durationSeconds: 30, startSeconds: 60 + index * 30, endSeconds: 90 + index * 30 });
  return { measuredAudioSeconds: 600, scenes, visualSlots: slots };
}

test("ten-minute cadence has 28 continuous slots", () => {
  const audioHandoff = tenMinuteHandoff();
  const out = validateVisualSlots({ audioHandoff, profile: { visual: { intro: { endSeconds: 60, minSlotSeconds: 5, maxSlotSeconds: 7, targetSlotSeconds: 6 }, body: { minSlotSeconds: 20, maxSlotSeconds: 40, targetSlotSeconds: 30 }, maxSlots: 260 } } });
  assert.equal(out.length, 28);
});

test("gap and body slot over forty seconds fail", () => {
  const audioHandoff = tenMinuteHandoff();
  audioHandoff.visualSlots[11] = { ...audioHandoff.visualSlots[11], startSeconds: 91, durationSeconds: 29 };
  assert.throws(() => validateVisualSlots({ audioHandoff, profile: { visual: { intro: { endSeconds: 60, minSlotSeconds: 5, maxSlotSeconds: 7, targetSlotSeconds: 6 }, body: { minSlotSeconds: 20, maxSlotSeconds: 40, targetSlotSeconds: 30 }, maxSlots: 260 } } }), error => error.code === "visual_timeline_gap");
});
```

- [ ] **Step 2: Run and verify the cadence module is missing**

Run: `node --test test/yadam/image-workflow.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `visual-slot-plan.mjs`.

- [ ] **Step 3: Create the closed render-plan schema and implement exact timeline validation**

Create `schemas/yadam/render-plan.schema.json` with `additionalProperties:false` recursively. Require the exact Plan 03 fields `audioManifestPath/hash`, `audioTimelinePath/hash`, `renderPlanInputPath/hash`, `measuredAudioSeconds`, `acceptedRangeSeconds`, `audioTempoFactor:1`, closed `scenes`, closed `segments`, and closed `visualSlots`; add Plan 02 `approvalRevisionPath`, `approvedArtifactSetHash`, story-bible/scene-plan/thumbnail-plan/selection refs, and only `compiledRequestId/compiledRequestHash` to each otherwise unchanged Plan 03 slot. All paths are job-relative `/` paths, hashes are lowercase SHA-256, scene/slot IDs are unique, and every visual slot has its original `visualOrder`, `timingBand`, `extendedHold`, `holdReason` and `purpose`.

Create `scripts/lib/yadam/images/visual-slot-plan.mjs`:

```js
import { join, relative } from "node:path";
import { writeCanonicalJson } from "../../pipeline/atomic-store.mjs";
import { registerArtifact } from "../../pipeline/artifact-store.mjs";
import { validateSchema } from "../../pipeline/schema-registry.mjs";

const EPSILON = 0.01;

export function validateVisualSlots({ audioHandoff, profile }) {
  const inputSlots = structuredClone(audioHandoff.visualSlots);
  const slots = structuredClone(inputSlots).sort((a, b) => a.startSeconds - b.startSeconds || a.visualOrder - b.visualOrder);
  const scenes = structuredClone(audioHandoff.scenes).sort((a, b) => a.startSeconds - b.startSeconds);
  const sceneById = new Map(scenes.map(scene => [scene.sceneId, scene]));
  if (sceneById.size !== scenes.length) throw Object.assign(new Error("duplicate audio scene id"), { code: "audio_scene_duplicate" });
  if (!slots.length || slots.length > profile.visual.maxSlots) throw Object.assign(new Error("visual slot count outside range"), { code: "visual_slot_count" });
  if (new Set(slots.map(slot => slot.visualSlotId)).size !== slots.length) throw Object.assign(new Error("duplicate visual slot id"), { code: "visual_slot_duplicate" });
  if (inputSlots.some((slot, index) => slot.visualSlotId !== slots[index].visualSlotId)) throw Object.assign(new Error("visual slots must already be chronological"), { code: "visual_slot_order" });
  if (Math.abs(slots[0].startSeconds) > EPSILON) throw Object.assign(new Error("visual timeline must start at zero"), { code: "visual_timeline_start" });
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (slot.visualOrder !== index + 1) throw Object.assign(new Error(`visual order is not contiguous: ${slot.visualSlotId}`), { code: "visual_order_invalid" });
    if (![slot.startSeconds, slot.endSeconds, slot.durationSeconds].every(Number.isFinite) || slot.startSeconds < 0 || slot.endSeconds <= slot.startSeconds) throw Object.assign(new Error(`visual time invalid: ${slot.visualSlotId}`), { code: "visual_time_invalid" });
    if ((slot.timingBand === "intro") !== (slot.purpose === "intro")) throw Object.assign(new Error(`purpose/band mismatch: ${slot.visualSlotId}`), { code: "visual_purpose_mismatch" });
    const computed = slot.endSeconds - slot.startSeconds;
    if (Math.abs(computed - slot.durationSeconds) > EPSILON) throw Object.assign(new Error(`duration mismatch: ${slot.visualSlotId}`), { code: "visual_duration_mismatch" });
    if (!slot.sourceSceneIds?.length || new Set(slot.sourceSceneIds).size !== slot.sourceSceneIds.length || !slot.sourceSceneIds.includes(slot.primarySceneId)) throw Object.assign(new Error(`source scenes invalid: ${slot.visualSlotId}`), { code: "visual_source_invalid" });
    for (const sceneId of slot.sourceSceneIds) if (!sceneById.has(sceneId)) throw Object.assign(new Error(`unknown source scene: ${sceneId}`), { code: "visual_source_unknown" });
    if (index > 0) {
      const delta = slot.startSeconds - slots[index - 1].endSeconds;
      if (Math.abs(delta) > EPSILON) throw Object.assign(new Error(`timeline gap/overlap: ${slot.visualSlotId}`), { code: delta > 0 ? "visual_timeline_gap" : "visual_timeline_overlap" });
    }
    const band = slot.timingBand === "intro" ? profile.visual.intro : profile.visual.body;
    if (!slot.extendedHold && slot.holdReason !== null) throw Object.assign(new Error(`hold reason without extension: ${slot.visualSlotId}`), { code: "visual_hold_invalid" });
    if (slot.timingBand === "intro" && slot.startSeconds >= profile.visual.intro.endSeconds - EPSILON) throw Object.assign(new Error(`intro band starts after intro: ${slot.visualSlotId}`), { code: "visual_timing_band_invalid" });
    if (slot.timingBand === "body" && slot.startSeconds < profile.visual.intro.endSeconds - EPSILON) throw Object.assign(new Error(`body band starts before body: ${slot.visualSlotId}`), { code: "visual_timing_band_invalid" });
    const allowedExtendedHold = slot.extendedHold === true && ((slot.timingBand === "intro" && slot.holdReason === "cta") || (index === slots.length - 1 && slot.holdReason === "short_tail"));
    if (slot.extendedHold && !allowedExtendedHold) throw Object.assign(new Error(`invalid extended hold: ${slot.visualSlotId}`), { code: "visual_hold_invalid" });
    if (allowedExtendedHold && slot.durationSeconds > band.maxSlotSeconds + band.targetSlotSeconds + EPSILON) throw Object.assign(new Error(`extended hold too long: ${slot.visualSlotId}`), { code: "visual_hold_too_long" });
    if (!allowedExtendedHold && (slot.durationSeconds < band.minSlotSeconds - EPSILON || slot.durationSeconds > band.maxSlotSeconds + EPSILON)) throw Object.assign(new Error(`cadence violation: ${slot.visualSlotId}`), { code: "visual_cadence_violation" });
  }
  if (Math.abs(slots.at(-1).endSeconds - audioHandoff.measuredAudioSeconds) > 0.05) throw Object.assign(new Error("visual timeline does not cover measured audio"), { code: "visual_audio_coverage" });
  for (const scene of scenes) {
    const ranges = slots.filter(slot => slot.sourceSceneIds.includes(scene.sceneId) && slot.endSeconds > scene.startSeconds && slot.startSeconds < scene.endSeconds).map(slot => ({ start: Math.max(scene.startSeconds, slot.startSeconds), end: Math.min(scene.endSeconds, slot.endSeconds) })).sort((a, b) => a.start - b.start);
    if (!ranges.length || Math.abs(ranges[0].start - scene.startSeconds) > EPSILON) throw Object.assign(new Error(`scene coverage starts late: ${scene.sceneId}`), { code: "visual_scene_uncovered" });
    let cursor = ranges[0].end;
    for (const range of ranges.slice(1)) {
      if (range.start - cursor > EPSILON) throw Object.assign(new Error(`scene coverage gap: ${scene.sceneId}`), { code: "visual_scene_uncovered" });
      cursor = Math.max(cursor, range.end);
    }
    if (Math.abs(cursor - scene.endSeconds) > EPSILON) throw Object.assign(new Error(`scene coverage ends early: ${scene.sceneId}`), { code: "visual_scene_uncovered" });
  }
  return slots;
}

export async function publishRenderPlan({ jobDir, audioHandoff, compiledRequests, profile, visualPlanning }) {
  const slots = validateVisualSlots({ audioHandoff, profile });
  const bySlot = new Map(compiledRequests.map(entry => [entry.value.visualSlotId, entry]));
  if (bySlot.size !== compiledRequests.length) throw Object.assign(new Error("duplicate compiled slot request"), { code: "compiled_request_duplicate" });
  const slotIds = new Set(slots.map(slot => slot.visualSlotId));
  const orphan = compiledRequests.filter(entry => !slotIds.has(entry.value.visualSlotId));
  if (orphan.length) throw Object.assign(new Error(`orphan compiled request: ${orphan[0].artifactId}`), { code: "compiled_request_orphan" });
  const audioSceneById = new Map(audioHandoff.scenes.map(scene => [scene.sceneId, scene]));
  const visualSlots = slots.map(slot => {
    const entry = bySlot.get(slot.visualSlotId);
    if (!entry) throw Object.assign(new Error(`compiled request missing: ${slot.visualSlotId}`), { code: "compiled_request_missing" });
    const request = entry.value;
    if (entry.artifactId !== `compiled-image-request-${request.assetId}` || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw Object.assign(new Error(`compiled request artifact invalid: ${request.assetId}`), { code: "compiled_request_artifact_invalid" });
    if (JSON.stringify(request.sourceSceneIds) !== JSON.stringify([...slot.sourceSceneIds].sort())) throw Object.assign(new Error(`compiled source IDs differ: ${slot.visualSlotId}`), { code: "compiled_source_mismatch" });
    for (const source of request.sourceScenes) if (audioSceneById.get(source.sceneId)?.sourceHash !== source.sourceHash) throw Object.assign(new Error(`compiled source hash differs: ${source.sceneId}`), { code: "compiled_source_hash_mismatch" });
    return { ...slot, compiledRequestId: entry.artifactId, compiledRequestHash: entry.sha256 };
  });
  const value = {
    schemaVersion: "1.0.0",
    profileId: "yadam",
    approvedArtifactSetHash: visualPlanning.approvedArtifactSetHash,
    approvalRevisionPath: visualPlanning.approvalRevisionPath,
    storyBible: visualPlanning.storyBible,
    scenePlan: visualPlanning.scenePlan,
    thumbnailPlan: visualPlanning.thumbnailPlan,
    thumbnailSelection: visualPlanning.thumbnailSelection,
    audioManifestPath: audioHandoff.audioManifestPath,
    audioManifestHash: audioHandoff.audioManifestHash,
    audioTimelinePath: audioHandoff.audioTimelinePath,
    audioTimelineHash: audioHandoff.audioTimelineHash,
    renderPlanInputPath: audioHandoff.renderPlanInputPath,
    renderPlanInputHash: audioHandoff.renderPlanInputHash,
    measuredAudioSeconds: audioHandoff.measuredAudioSeconds,
    acceptedRangeSeconds: audioHandoff.acceptedRangeSeconds,
    audioTempoFactor: audioHandoff.audioTempoFactor,
    scenes: audioHandoff.scenes,
    segments: audioHandoff.segments,
    visualSlots
  };
  await validateSchema(join(process.cwd(), "schemas", "yadam", "render-plan.schema.json"), value);
  const output = await writeCanonicalJson(join(jobDir, "render-plan.json"), value);
  const compiledDependencies = Object.fromEntries([...compiledRequests].sort((a, b) => a.artifactId.localeCompare(b.artifactId)).map(entry => [`compiled:${entry.artifactId}`, entry.sha256]));
  await registerArtifact(jobDir, {
    artifactId: "render-plan",
    logicalRole: "yadam.render.plan",
    path: relative(jobDir, output.path).replaceAll("\\", "/"),
    sha256: output.sha256,
    schemaVersion: "1.0.0",
    producerStage: "image-plan",
    gateStatus: "pass",
    dependencyHashes: {
      audioManifest: audioHandoff.audioManifestHash,
      audioTimeline: audioHandoff.audioTimelineHash,
      renderPlanInput: audioHandoff.renderPlanInputHash,
      approvalSet: visualPlanning.approvedArtifactSetHash,
      storyBible: visualPlanning.storyBible.sha256,
      scenePlan: visualPlanning.scenePlan.sha256,
      thumbnailPlan: visualPlanning.thumbnailPlan.sha256,
      thumbnailSelection: visualPlanning.thumbnailSelection.sha256,
      ...compiledDependencies
    }
  });
  return { ...output, value };
}
```

- [ ] **Step 4: Add maximum, extended-hold, source-scene and compiled-request bijection tests**

Add tests for exactly 260 slots passing and 261 failing with `visual_slot_count`; pre-shuffled input, duplicate/noncontiguous `visualOrder`, NaN/reversed time and purpose/band mismatch failing; CTA represented by extending an intro slot with `holdReason:"cta"`; `short_tail` permitted only on the final slot; either hold capped at `band.maxSlotSeconds + band.targetSlotSeconds`; any other reason failing; `primarySceneId` absent from `sourceSceneIds`, duplicate/unknown source IDs, one audio scene with a 0.011-second coverage gap, and a source hash mismatch failing; and `lastSlot.end` differing from measured audio by `0.051` failing. For persisted compiled requests, independently test duplicate slot request, missing slot request, orphan slot request, differing source-ID projection, differing source hash, wrong stable artifact ID, registry/path/file hash drift and an idempotency key being incorrectly substituted for the canonical request file SHA.

- [ ] **Step 5: Run cadence tests**

Run: `node --test test/yadam/image-workflow.test.mjs`

Expected: closed schema, 28-slot, maximum, full per-audio-scene coverage, exact source hashes, compiled-request bijection and the two allowed extended-hold cases pass; every numeric/dependency boundary fails with its declared code.

- [ ] **Step 6: Commit cadence and render-plan publication**

```bash
git add schemas/yadam/render-plan.schema.json scripts/lib/yadam/images/visual-slot-plan.mjs test/yadam/image-workflow.test.mjs
git commit -m "feat: validate yadam visual cadence and render plan"
```

### Task 6: Implement the ComfyUI transport, reference upload, fixed-output download and targeted cancellation

**Files:**
- Create: `scripts/lib/yadam/images/comfyui-client.mjs`
- Create: `test/yadam/image-provider.test.mjs`
- Create: `test/yadam/fixtures/images/comfy-object-info.json`
- Create: `test/yadam/fixtures/images/comfy-history-success.json`

**Interfaces:**
- Consumes: loopback ComfyUI base URL and compiled workflow graph.
- Produces: `createComfyClient({ baseUrl, fetchImpl, now, wait })` with upload, prompt, history, view, queue, interrupt and free methods.

- [ ] **Step 1: Write failing fake-transport tests**

Create `test/yadam/image-provider.test.mjs` using a request-recording `fetchImpl`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createComfyClient } from "../../scripts/lib/yadam/images/comfyui-client.mjs";

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("client uploads content-addressed reference and uses returned name", async () => {
  const calls = [];
  let uploaded = false;
  const jobId = "job-20260716-000000-1234abcd";
  const sha256 = createHash("sha256").update("png-bytes").digest("hex");
  const client = createComfyClient({
    baseUrl: "http://127.0.0.1:8188",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith("/upload/image")) { uploaded = true; return json({ name: `yadam_${jobId}_${sha256}.png`, subfolder: "yadam-references", type: "input" }); }
      if (String(url).includes("/view?")) return uploaded ? new Response(Buffer.from("png-bytes")) : new Response("missing", { status: 404 });
      throw new Error(`unexpected URL ${url}`);
    }
  });
  const result = await client.uploadReference({ jobId, bytes: Buffer.from("png-bytes"), sha256 });
  assert.equal(result.workflowImageName, `yadam-references/yadam_${jobId}_${sha256}.png`);
  assert.equal(calls[1].options.method, "POST");
});

test("client selects only SaveImage node 9", async () => {
  const client = createComfyClient({
    baseUrl: "http://127.0.0.1:8188",
    wait: async () => {},
    fetchImpl: async url => String(url).includes("/history/")
      ? json({ p1: { status: { completed: true, status_str: "success", messages: [] }, outputs: { "2": { images: [{ filename: "wrong.png", subfolder: "", type: "output" }] }, "9": { images: [{ filename: "right.png", subfolder: "yadam", type: "output" }] } } } })
      : new Response(Buffer.from("right-image"))
  });
  const out = await client.waitForOutput({ promptId: "p1", outputNodeId: "9", timeoutMs: 1000 });
  assert.equal(out.filename, "right.png");
});
```

- [ ] **Step 2: Run and verify the provider module is missing**

Run: `node --test test/yadam/image-provider.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `comfyui-client.mjs`.

- [ ] **Step 3: Implement loopback URL enforcement and JSON requests**

Create the foundation of `scripts/lib/yadam/images/comfyui-client.mjs`:

```js
import { createHash } from "node:crypto";
import { basename } from "node:path";

function checkedBaseUrl(value) {
  let url;
  try { url = new URL(value); }
  catch (cause) { throw Object.assign(new Error("ComfyUI must be a bare loopback HTTP origin"), { code: "comfyui_non_loopback", cause }); }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw Object.assign(new Error("ComfyUI must be a bare loopback HTTP origin"), { code: "comfyui_non_loopback" });
  return url.origin;
}

async function readBounded(response, maximumBytes, code) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) throw Object.assign(new Error(`${code}: response too large`), { code: `${code}_oversized` });
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw Object.assign(new Error(`${code}: response too large`), { code: `${code}_oversized` });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function checkedJson(response, code) {
  if (!response.ok) throw Object.assign(new Error(`${code}: HTTP ${response.status}`), { code, status: response.status });
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) throw Object.assign(new Error(`${code}: JSON content type required`), { code: `${code}_content_type` });
  const bytes = await readBounded(response, 1024 * 1024, code);
  try { return JSON.parse(bytes.toString("utf8")); } catch { throw Object.assign(new Error(`${code}: invalid JSON`), { code: `${code}_invalid_json` }); }
}

async function checkedOk(response, code) {
  if (!response.ok) throw Object.assign(new Error(`${code}: HTTP ${response.status}`), { code, status: response.status });
  await readBounded(response, 1024, code);
}

function safeRemoteName({ name, subfolder, type }) {
  if (type !== "input" && type !== "output") throw Object.assign(new Error("invalid ComfyUI file type"), { code: "comfy_file_type" });
  const segments = subfolder.split("/");
  if (!name || name === "." || name === ".." || basename(name) !== name || /[\\/:]/.test(name) || subfolder.startsWith("/") || subfolder.includes("\\") || subfolder.includes(":") || segments.some(segment => segment === "." || segment === ".." || segment === "" && subfolder !== "")) throw Object.assign(new Error("unsafe ComfyUI path"), { code: "comfy_path_traversal" });
  return subfolder ? `${subfolder}/${name}` : name;
}

export function createComfyClient({ baseUrl, fetchImpl = fetch, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), fetchTimeoutMs = 30000 }) {
  const base = checkedBaseUrl(baseUrl);
  const request = async (path, options = {}) => {
    const timeoutSignal = AbortSignal.timeout(fetchTimeoutMs);
    const boundedSignal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
    try { return await fetchImpl(`${base}${path}`, { ...options, signal: boundedSignal }); }
    catch (cause) {
      if (options.signal?.aborted) throw cause;
      if (timeoutSignal.aborted || cause?.name === "TimeoutError") throw Object.assign(new Error("ComfyUI HTTP request timed out"), { code: "comfy_http_timeout", cause });
      throw cause;
    }
  };
  const getJson = (path, options) => request(path, options).then(response => checkedJson(response, "comfy_http_error"));
  const downloadFile = async ({ filename: name, subfolder = "", type = "output", maxBytes, signal }) => {
    if (!Number.isInteger(maxBytes) || maxBytes < 1) throw Object.assign(new Error("explicit download byte limit required"), { code: "comfy_download_limit_required" });
    safeRemoteName({ name, subfolder, type });
    const query = new URLSearchParams({ filename: name, subfolder, type });
    const response = await request(`/view?${query}`, { signal });
    if (!response.ok) throw Object.assign(new Error(`view failed: ${response.status}`), { code: "comfy_view_failed", status: response.status });
    return readBounded(response, maxBytes, "comfy_view");
  };
  return {
    getSystemStats: ({ signal } = {}) => getJson("/system_stats", { signal }),
    getObjectInfo: ({ signal } = {}) => getJson("/object_info", { signal }),
    getQueue: ({ signal } = {}) => getJson("/queue", { signal }),
    getHistory: ({ promptId, signal }) => getJson(`/history/${encodeURIComponent(promptId)}`, { signal }),
    async submitPrompt({ workflow, clientId, promptId, signal }) {
      const response = await request("/prompt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: workflow, client_id: clientId, prompt_id: promptId }), signal });
      const value = await checkedJson(response, "comfy_prompt_rejected");
      if (value.prompt_id !== promptId) throw Object.assign(new Error("ComfyUI response prompt_id differs"), { code: "comfy_prompt_id_mismatch" });
      return { promptId: value.prompt_id, number: value.number ?? null };
    },
    async deleteQueued(promptId, { signal } = {}) {
      await checkedOk(await request("/queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ delete: [promptId] }), signal }), "comfy_queue_delete_failed");
    },
    async interruptOwned(promptId, { signal } = {}) {
      await checkedOk(await request("/interrupt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt_id: promptId }), signal }), "comfy_interrupt_failed");
    },
    async freeMemory({ signal } = {}) {
      await checkedOk(await request("/free", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }), signal }), "comfy_free_failed");
    }
  };
}
```

- [ ] **Step 4: Add content-addressed upload and resume verification**

Add these methods inside the returned client object:

```js
async uploadReference({ jobId, bytes, sha256, signal }) {
  if (!/^job-[0-9]{8}-[0-9]{6}-[0-9a-f]{8}$/.test(jobId)) throw Object.assign(new Error("invalid job id for upload"), { code: "comfy_upload_job_id_invalid" });
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== sha256) throw Object.assign(new Error("local reference hash mismatch"), { code: "reference_hash_mismatch" });
  const filename = `yadam_${jobId}_${sha256}.png`;
  const expectedRemote = { name: filename, subfolder: "yadam-references", type: "input" };
  try {
    const existing = await downloadFile({ ...expectedRemote, maxBytes: bytes.length, signal });
    if (createHash("sha256").update(existing).digest("hex") !== sha256) throw Object.assign(new Error("content-addressed remote name has different bytes"), { code: "uploaded_reference_hash_mismatch" });
    return { ...expectedRemote, workflowImageName: safeRemoteName(expectedRemote), sha256, reused: true };
  } catch (error) {
    if (error.code !== "comfy_view_failed" || error.status !== 404) throw error;
  }
  const form = new FormData();
  form.append("image", new Blob([bytes], { type: "image/png" }), filename);
  form.append("subfolder", "yadam-references");
  form.append("type", "input");
  form.append("overwrite", "false");
  const remote = await checkedJson(await request("/upload/image", { method: "POST", body: form, signal }), "comfy_upload_failed");
  if (remote.name !== filename || remote.subfolder !== "yadam-references" || remote.type !== "input") throw Object.assign(new Error("upload response path differs from request"), { code: "comfy_upload_path_mismatch" });
  const workflowImageName = safeRemoteName(remote);
  const verified = await downloadFile({ ...remote, maxBytes: bytes.length, signal });
  if (createHash("sha256").update(verified).digest("hex") !== sha256) throw Object.assign(new Error("uploaded reference hash mismatch"), { code: "uploaded_reference_hash_mismatch" });
  return { ...remote, workflowImageName, sha256, reused: false };
},
downloadFile,
```

- [ ] **Step 5: Add bounded history polling and execution-error evidence**

Add:

```js
async waitForOutput({ promptId, outputNodeId, timeoutMs, signal }) {
  const started = now();
  while (now() - started <= timeoutMs) {
    if (signal?.aborted) throw Object.assign(new Error("ComfyUI wait cancelled"), { code: "cancelled" });
    const history = await getJson(`/history/${encodeURIComponent(promptId)}`, { signal });
    const entry = history[promptId];
    if (entry?.status?.status_str === "error") throw Object.assign(new Error("ComfyUI execution failed"), { code: "comfy_execution_failed", messages: entry.status.messages ?? [] });
    if (entry?.status?.completed) {
      const images = entry.outputs?.[outputNodeId]?.images;
      if (!Array.isArray(images) || images.length !== 1) throw Object.assign(new Error("fixed output node did not return exactly one image"), { code: "comfy_output_cardinality" });
      return images[0];
    }
    await wait(1000);
  }
  throw Object.assign(new Error("ComfyUI prompt timed out"), { code: "comfy_prompt_timeout", promptId });
},
```

- [ ] **Step 6: Add stable prompt-ID, empty-response, size-bound, cancellation and unsafe-path tests**

Derive a UUID-shaped prompt ID from the compiled `idempotencyKey`, submit it in `prompt_id`, and reject a response containing any other ID. Call `uploadReference` twice for the same job/hash and assert the second call verifies `/view` and makes zero upload POSTs; a pre-existing same name with different bytes is a hard hash conflict and is never overwritten. Assert an invalid job ID fails before HTTP. Assert queued cancellation sends `POST /queue` with `{delete:[promptId]}`, running cancellation sends `POST /interrupt` with `{prompt_id:promptId}`, and `/free` sends the locked body; all three fake endpoints return an empty HTTP 200 and must succeed without JSON parsing. Assert no global interrupt body is sent. Assert an explicit caller abort propagates its cancellation while an internal fetch deadline throws typed `comfy_http_timeout`. Assert missing/incorrect JSON content type, JSON over 1 MiB, `/view` over the explicit maximum, empty/dot/dot-dot names, leading slash, colon, backslash, empty path segment and `subfolder:"../../outside"` fail with stable codes before bytes are accepted. Test bare IPv4/IPv6 loopback origins and reject malformed URLs, credentials, a base path, query, fragment and non-loopback host.

- [ ] **Step 7: Run provider tests**

Run: `node --test test/yadam/image-provider.test.mjs`

Expected: upload/hash, caller-owned prompt ID, fixed node 9, bounded responses, execution error, timeout, empty-200 queue delete/targeted interrupt/free and traversal tests pass.

- [ ] **Step 8: Commit the provider transport**

```bash
git add scripts/lib/yadam/images/comfyui-client.mjs test/yadam/image-provider.test.mjs test/yadam/fixtures/images/comfy-object-info.json test/yadam/fixtures/images/comfy-history-success.json
git commit -m "feat: add resumable ComfyUI image transport"
```

### Task 7: Add shared cross-job GPU locking, safe auto-start and strict host preflight

**Files:**
- Create: `scripts/lib/pipeline/resource-lock.mjs`
- Create: `scripts/lib/yadam/images/host-preflight.mjs`
- Modify: `test/yadam/image-provider.test.mjs`
- Create: `test/yadam/resource-lock.test.mjs`

**Interfaces:**
- Consumes: host config, model lock, workflow descriptors, ComfyUI client and fixed startup batch.
- Produces: `acquireResourceLock({workspaceRoot,lockPath,resource,ownerJobId,ownerStage,signal,staleAfterMs})`, `releaseResourceLock`, `withResourceLock`, `preflightImageHost({ workspaceRoot, hostConfig, autoStart, signal })`.

- [ ] **Step 1: Write failing cross-job lock tests**

Create `test/yadam/resource-lock.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireResourceLock, releaseResourceLock } from "../../scripts/lib/pipeline/resource-lock.mjs";

test("one workspace GPU lease serializes different jobs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gpu-lock-"));
  const lockPath = join(dir, "exports", ".locks", "gpu.lock");
  const first = await acquireResourceLock({ workspaceRoot: dir, lockPath, resource: "gpu", ownerJobId: "job-a", ownerStage: "comfy", staleAfterMs: 3600000 });
  await assert.rejects(acquireResourceLock({ workspaceRoot: dir, lockPath, resource: "gpu", ownerJobId: "job-b", ownerStage: "ollama", staleAfterMs: 3600000 }), error => error.code === "resource_locked");
  await releaseResourceLock(first);
  const second = await acquireResourceLock({ workspaceRoot: dir, lockPath, resource: "gpu", ownerJobId: "job-b", ownerStage: "ollama", staleAfterMs: 3600000 });
  await releaseResourceLock(second);
});
```

- [ ] **Step 2: Run and verify the shared lock is missing**

Run: `node --test test/yadam/resource-lock.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `resource-lock.mjs`.

- [ ] **Step 3: Implement atomic lease ownership**

Create `scripts/lib/pipeline/resource-lock.mjs`:

```js
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

function pidState(pid) {
  try { process.kill(pid, 0); return "alive"; } catch (error) { return error.code === "ESRCH" ? "dead" : "indeterminate"; }
}

function validateLockPath({ workspaceRoot, lockPath, resource }) {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(resource)) throw Object.assign(new Error("resource name is unsafe"), { code: "resource_lock_name_invalid" });
  const expected = resolve(workspaceRoot, "exports", ".locks", `${resource}.lock`);
  if (resolve(lockPath) !== expected) throw Object.assign(new Error(`resource lock path must equal ${expected}`), { code: "resource_lock_path_invalid" });
}

async function createLease({ lockPath, resource, ownerJobId, ownerStage }) {
  const lease = { schemaVersion: "1.0.0", leaseId: randomUUID(), resource, ownerJobId, ownerStage, pid: process.pid, acquiredAtMs: Date.now(), lockPath };
  const handle = await open(lockPath, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(lease)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return Object.freeze(lease);
}

export async function acquireResourceLock({ workspaceRoot = process.cwd(), lockPath, resource, ownerJobId, ownerStage, signal, staleAfterMs = 3600000 }) {
  if (signal?.aborted) throw Object.assign(new Error("resource wait cancelled"), { code: "cancelled" });
  validateLockPath({ workspaceRoot, lockPath, resource });
  await mkdir(dirname(lockPath), { recursive: true });
  try {
    return await createLease({ lockPath, resource, ownerJobId, ownerStage });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const observed = JSON.parse(await readFile(lockPath, "utf8"));
    const reclaimPath = `${lockPath}.reclaim`;
    let reclaimHandle;
    try {
      reclaimHandle = await open(reclaimPath, "wx");
      await reclaimHandle.writeFile(`${JSON.stringify({ schemaVersion: "1.0.0", pid: process.pid, leaseId: randomUUID(), observedLeaseId: observed.leaseId })}\n`, "utf8");
      await reclaimHandle.sync();
    } catch (reclaimError) {
      if (reclaimError.code === "EEXIST") throw Object.assign(new Error("resource reclaim already in progress"), { code: "resource_locked", current: observed });
      throw reclaimError;
    } finally {
      await reclaimHandle?.close();
    }
    try {
      const current = JSON.parse(await readFile(lockPath, "utf8"));
      const reclaimable = current.leaseId === observed.leaseId && Date.now() - current.acquiredAtMs > staleAfterMs && pidState(current.pid) === "dead";
      if (!reclaimable) throw Object.assign(new Error(`resource owned by ${current.ownerJobId}:${current.ownerStage}`), { code: "resource_locked", current });
      const evidencePath = join(dirname(lockPath), `${resource}.stale-${current.leaseId}-${randomUUID()}.json`);
      await rename(lockPath, evidencePath);
    } finally {
      await rm(reclaimPath, { force: true });
    }
    if (signal?.aborted) throw Object.assign(new Error("resource wait cancelled"), { code: "cancelled" });
    try { return await createLease({ lockPath, resource, ownerJobId, ownerStage }); } catch (raceError) {
      if (raceError.code === "EEXIST") throw Object.assign(new Error("resource acquired by another contender"), { code: "resource_locked" });
      throw raceError;
    }
  }
}

export async function releaseResourceLock(lease) {
  const current = JSON.parse(await readFile(lease.lockPath, "utf8"));
  if (current.leaseId !== lease.leaseId || current.pid !== process.pid) throw Object.assign(new Error("resource lease ownership mismatch"), { code: "resource_lease_mismatch" });
  await rm(lease.lockPath);
}

export async function withResourceLock(options, fn) {
  const lease = await acquireResourceLock(options);
  try { return await fn(lease); } finally { await releaseResourceLock(lease); }
}
```

- [ ] **Step 4: Add ownership, containment, race-safe stale reclaim and abort tests**

Assert an unsafe resource containing slash, backslash, dot-dot, colon or uppercase and a path outside exact `<workspaceRoot>/exports/.locks/<resource>.lock` are rejected, a different `leaseId` cannot release a lock, a live PID is never broken even after the age threshold, and `EPERM`/unknown PID results are treated as alive. Seed one definitely dead stale PID, start two reclaimers concurrently, assert only one may acquire, the stale lease is atomically renamed to unique evidence, the loser cannot remove the winner's new lease, and the reclaim mutex is removed only by its owner. An already-aborted signal creates no file.

- [ ] **Step 5: Write failing exact-model preflight and safe-start tests**

Add tests that require loopback URL, exact custom-node commit, all nine node classes, checkpoint name, model/font hashes, empty queue and Ollama row `{name:"gemma4:12b",digest:"4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c",size:7556508396}` plus `vision` capability and `Q4_K_M` quantization. Mutate tag, digest, size, capability and quantization independently and require `ready:false`. Assert auto-start spawns only `C:/Windows/System32/cmd.exe` with `shell:false`, `windowsHide:true`, cwd equal to portable root and arguments `[/d,/s,/c,"<fixed batch>"]`.

- [ ] **Step 6: Implement strict preflight**

Create `scripts/lib/yadam/images/host-preflight.mjs` with this result contract:

```js
{
  schemaVersion: "1.0.0",
  ready: true,
  comfyUi: { version: "0.24.0", baseUrl: hostConfig.comfyui.baseUrl, queueRunning: 0, queuePending: 0 },
  customNode: { commit: "b188a6cb39b512a9c6da7235b880af42c78ccd0d", status: "pass" },
  models: { checkpoint: "pass", clipVision: "pass", ipAdapter: "pass" },
  nodes: { missing: [] },
  workflows: { reference: "pass", conditioned: "pass" },
  font: { bold: "pass", regular: "pass" },
  ollama: { model: "gemma4:12b", digest: "4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c", sizeBytes: 7556508396, quantization: "Q4_K_M", vision: true },
  failures: []
}
```

Implement the body by loading the lock, verifying all files, running `git -C <target> rev-parse HEAD` with `shell:false` and a 1 MiB combined output cap, calling `/system_stats`, `/object_info`, `/queue`, `GET http://127.0.0.1:11434/api/tags`, and `POST http://127.0.0.1:11434/api/show` body `{"model":"gemma4:12b"}`. Match tag name, digest and size to the lock, then match show capabilities and quantization. Required node classes are `CheckpointLoaderSimple`, `CLIPTextEncode`, `EmptyLatentImage`, `KSampler`, `VAEDecode`, `LoadImage`, `SaveImage`, `IPAdapterUnifiedLoader`, `IPAdapter`. Compile both workflows against object info. Any failure sets `ready:false` and adds a stable `{code,evidence}` item; it never becomes a warning.

- [ ] **Step 7: Implement allowlisted auto-start only when health is unreachable**

When `autoStart===true` and the first `/system_stats` connection fails, require the fixed batch path from host config to equal `C:/Users/petbl/ComfyUI_windows_portable/run_nvidia_gpu.bat`, then spawn:

```js
const child = spawn("C:/Windows/System32/cmd.exe", ["/d", "/s", "/c", `"${hostConfig.comfyui.startupBatch}"`], {
  cwd: hostConfig.comfyui.portableRoot,
  shell: false,
  windowsHide: true,
  detached: false,
  stdio: "ignore"
});
await waitForSpawnOrError(child);
child.unref();
```

`waitForSpawnOrError` races the one-shot `spawn` and `error` events so a bad executable never becomes an unhandled child-process error. `unref` prevents the focused Codex CLI from hanging forever on the foreground Python process launched by the fixed batch; the child remains the user's local ComfyUI host. Poll once per second for at most 180 seconds, honor `AbortSignal`, then rerun the full preflight. Do not auto-stop or restart a server that was already reachable.

- [ ] **Step 8: Run resource and preflight tests**

Run: `node --test test/yadam/resource-lock.test.mjs test/yadam/image-provider.test.mjs`

Expected: cross-job serialization, ownership, stale lease, node/model/font failures, Ollama capability and allowlisted start tests pass.

- [ ] **Step 9: Commit shared GPU locking and preflight**

```bash
git add scripts/lib/pipeline/resource-lock.mjs scripts/lib/yadam/images/host-preflight.mjs test/yadam/resource-lock.test.mjs test/yadam/image-provider.test.mjs
git commit -m "feat: serialize GPU providers and preflight image host"
```

### Task 8: Implement immutable character-reference candidates and approval promotion

**Files:**
- Create: `schemas/yadam/character-reference-set.schema.json`
- Create: `schemas/yadam/reference-set-pointer.schema.json`
- Create: `scripts/lib/yadam/images/reference-store.mjs`
- Modify: `test/yadam/image-service.test.mjs`

**Interfaces:**
- Consumes: Plan 02 story-bible characters/variants and approval-2 revision; Plan 01 canonical/artifact stores.
- Produces: `writeProvisionalReferenceSet`, `loadReferencePointer`, `promoteApprovedReferenceSet`.

- [ ] **Step 1: Write failing provisional-to-approved tests**

Create `test/yadam/image-service.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hashCanonical } from "../../scripts/lib/pipeline/canonical-json.mjs";
import { writeProvisionalReferenceSet, loadReferencePointer, promoteApprovedReferenceSet } from "../../scripts/lib/yadam/images/reference-store.mjs";

test("approval promotes a pointer without changing reference pixels or set hash", async () => {
  const jobDir = await mkdtemp(join(tmpdir(), "reference-set-"));
  await mkdir(join(jobDir, "assets", "character-references"), { recursive: true });
  const primaryPath = join(jobDir, "assets", "character-references", "primary.png");
  await writeFile(primaryPath, Buffer.from("approved-pixels"));
  const reference = { characterId: "char-1", variantId: "base", appearanceAnchors: ["round face"], wardrobeAnchors: ["blue hanbok"], primaryPath, width: 768, height: 1024, seed: 7, checkpointHash: "a".repeat(64), workflowHash: "b".repeat(64), compiledRequestHash: "c".repeat(64), derived: [] };
  const semanticHash = hashCanonical([{ characterId: reference.characterId, variantId: reference.variantId, appearanceAnchors: reference.appearanceAnchors, wardrobeAnchors: reference.wardrobeAnchors }]);
  const provisional = await writeProvisionalReferenceSet({ jobDir, jobId: "job-001", revision: 1, createdAt: "2026-07-16T00:00:00.000Z", references: [reference], dependencies: { storyBibleHash: "d".repeat(64), semanticHash, referenceWorkflowHash: reference.workflowHash, conditionedWorkflowHash: "e".repeat(64), checkpointHash: reference.checkpointHash, clipVisionHash: "f".repeat(64), ipAdapterHash: "1".repeat(64) } });
  const before = await readFile(primaryPath);
  const approvalRevisionPath = "approvals/approval-2-r001.json";
  const approvalPath = join(jobDir, approvalRevisionPath);
  await mkdir(join(jobDir, "approvals"), { recursive: true });
  await writeFile(approvalPath, JSON.stringify({ revision: 1, artifacts: [{ logicalRole: "yadam.character.reference-set", sha256: provisional.referenceSetHash }] }));
  const approved = await promoteApprovedReferenceSet({ jobDir, approvalRevisionPath });
  assert.equal(approved.referenceSetHash, provisional.referenceSetHash);
  assert.equal((await loadReferencePointer(jobDir)).status, "approved");
  assert.deepEqual(await readFile(primaryPath), before);
});
```

- [ ] **Step 2: Run and verify the reference store is missing**

Run: `node --test test/yadam/image-service.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `reference-store.mjs`.

- [ ] **Step 3: Create closed reference-set and pointer schemas**

The immutable set schema requires `schemaVersion:"1.0.0"`, `jobId`, integer `revision`, `createdAt`, `semanticHash`, `references` with unique `characterId+variantId`, and for each primary/derived asset: job-relative path, 64-hex hash, width, height, seed, checkpoint/workflow/compiled-request hashes. The primary workflow must be the locked unconditioned reference workflow. A derived row requires the locked conditioned workflow plus `primaryDependencyHash` equal to its own pair's primary hash; the set artifact dependencies also include that derived compiled-request hash and direct-primary hash. It does not contain approval status.

The pointer schema is exactly:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "status", "referenceSetPath", "referenceSetHash", "approvalRevisionPath", "approvalRevisionHash"],
  "properties": {
    "schemaVersion": { "const": "1.0.0" },
    "status": { "enum": ["provisional", "approved"] },
    "referenceSetPath": { "type": "string", "pattern": "^assets/character-references/reference-set-r[0-9]{3}\\.json$" },
    "referenceSetHash": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "approvalRevisionPath": { "oneOf": [{ "type": "null" }, { "type": "string", "pattern": "^approvals/approval-2-r[0-9]{3}\\.json$" }] },
    "approvalRevisionHash": { "oneOf": [{ "type": "null" }, { "type": "string", "pattern": "^[0-9a-f]{64}$" }] }
  }
}
```

The immutable `reference-set-rNNN.json` files remain revision-addressed on disk, but the artifact registry has exactly one current owner for logical role `yadam.character.reference-set`: stable artifact ID `character-reference-set-current`. Re-registering a later revision moves that record's `path` and `sha256`; Plan 01 `registerArtifact` retains the replaced path/hash/status in the same record's `revisionHistory`. Never register `character-reference-set-rNNN` as an artifact ID, because that would create multiple current owners for a singleton Plan 06 role.

- [ ] **Step 4: Implement immutable set write and pointer promotion**

Create `scripts/lib/yadam/images/reference-store.mjs` with these rules:

```js
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { writeCanonicalJson, writeCanonicalJsonExclusive } from "../../pipeline/atomic-store.mjs";
import { registerArtifact } from "../../pipeline/artifact-store.mjs";
import { hashCanonical } from "../../pipeline/canonical-json.mjs";
import { assertPathWithin, assertRealPathWithin } from "../../pipeline/path-policy.mjs";
import { validateSchema } from "../../pipeline/schema-registry.mjs";
import { sha256File } from "./model-lock.mjs";

const rel = (jobDir, path) => relative(jobDir, path).replaceAll("\\", "/");

export async function writeProvisionalReferenceSet({ jobDir, jobId, revision, createdAt, references, dependencies }) {
  if (!jobId || !createdAt || Number.isNaN(Date.parse(createdAt))) throw Object.assign(new Error("jobId and createdAt are required"), { code: "reference_set_metadata_invalid" });
  for (const key of ["storyBibleHash", "semanticHash", "referenceWorkflowHash", "conditionedWorkflowHash", "checkpointHash", "clipVisionHash", "ipAdapterHash"]) if (!/^[0-9a-f]{64}$/.test(dependencies[key])) throw Object.assign(new Error(`reference dependency invalid: ${key}`), { code: "reference_dependency_invalid" });
  const normalized = [];
  const seen = new Set();
  const artifactDependencies = { storyBible: dependencies.storyBibleHash, characterVariants: dependencies.semanticHash, referenceWorkflow: dependencies.referenceWorkflowHash, conditionedWorkflow: dependencies.conditionedWorkflowHash, checkpoint: dependencies.checkpointHash, clipVision: dependencies.clipVisionHash, ipAdapter: dependencies.ipAdapterHash };
  for (const item of references) {
    const pair = `${item.characterId}:${item.variantId}`;
    if (seen.has(pair)) throw Object.assign(new Error(`duplicate reference pair: ${pair}`), { code: "reference_pair_duplicate" });
    seen.add(pair);
    await assertRealPathWithin(jobDir, item.primaryPath);
    const primaryPath = rel(jobDir, item.primaryPath);
    if (primaryPath === ".." || primaryPath.startsWith("../") || primaryPath.includes("/../")) throw Object.assign(new Error("reference path escapes job"), { code: "reference_path_outside_job" });
    const primarySha256 = await sha256File(item.primaryPath);
    if (item.primarySha256 && item.primarySha256 !== primarySha256) throw Object.assign(new Error("primary reference hash differs"), { code: "reference_hash_mismatch" });
    if (!/^[0-9a-f]{64}$/.test(item.compiledRequestHash)) throw Object.assign(new Error("compiled reference request hash invalid"), { code: "reference_request_hash_invalid" });
    if (item.workflowHash !== dependencies.referenceWorkflowHash || item.checkpointHash !== dependencies.checkpointHash) throw Object.assign(new Error("primary reference stack differs"), { code: "reference_stack_mismatch" });
    artifactDependencies[`primary:${pair}`] = primarySha256;
    artifactDependencies[`compiled:${pair}`] = item.compiledRequestHash;
    const derived = [];
    const derivedIds = new Set();
    for (const candidate of item.derived ?? []) {
      if (derivedIds.has(candidate.derivedId)) throw Object.assign(new Error(`duplicate derived reference: ${candidate.derivedId}`), { code: "derived_reference_duplicate" });
      derivedIds.add(candidate.derivedId);
      await assertRealPathWithin(jobDir, candidate.path);
      const candidatePath = rel(jobDir, candidate.path);
      if (candidatePath === ".." || candidatePath.startsWith("../") || candidatePath.includes("/../")) throw Object.assign(new Error("derived path escapes job"), { code: "reference_path_outside_job" });
      const candidateHash = await sha256File(candidate.path);
      if (candidate.sha256 && candidate.sha256 !== candidateHash) throw Object.assign(new Error("derived reference hash differs"), { code: "reference_hash_mismatch" });
      if (candidate.primaryDependencyHash !== primarySha256) throw Object.assign(new Error("derived reference must bind direct primary"), { code: "derived_reference_chain_invalid" });
      if (!/^[0-9a-f]{64}$/.test(candidate.compiledRequestHash) || candidate.workflowHash !== dependencies.conditionedWorkflowHash || candidate.checkpointHash !== dependencies.checkpointHash) throw Object.assign(new Error("derived reference stack differs"), { code: "reference_stack_mismatch" });
      artifactDependencies[`derived:${pair}:${candidate.derivedId}`] = candidateHash;
      artifactDependencies[`derivedCompiled:${pair}:${candidate.derivedId}`] = candidate.compiledRequestHash;
      artifactDependencies[`derivedPrimary:${pair}:${candidate.derivedId}`] = primarySha256;
      derived.push({ ...candidate, path: candidatePath, sha256: candidateHash });
    }
    normalized.push({ ...item, primaryPath, primarySha256, derived });
  }
  normalized.sort((a, b) => `${a.characterId}:${a.variantId}`.localeCompare(`${b.characterId}:${b.variantId}`));
  const name = `reference-set-r${String(revision).padStart(3, "0")}.json`;
  const setPath = join(jobDir, "assets", "character-references", name);
  await assertPathWithin(jobDir, setPath);
  const value = { schemaVersion: "1.0.0", jobId, revision, createdAt, semanticHash: hashCanonical(normalized.map(item => ({ characterId: item.characterId, variantId: item.variantId, appearanceAnchors: item.appearanceAnchors, wardrobeAnchors: item.wardrobeAnchors }))), references: normalized };
  if (value.semanticHash !== dependencies.semanticHash) throw Object.assign(new Error("character/variant semantic hash differs"), { code: "reference_semantic_hash_mismatch" });
  await validateSchema(join(process.cwd(), "schemas", "yadam", "character-reference-set.schema.json"), value);
  let set;
  try {
    set = await writeCanonicalJsonExclusive(setPath, value);
  } catch (error) {
    if (error.code !== "immutable_target_exists") throw error;
    await assertRealPathWithin(jobDir, setPath);
    const existingBytes = await readFile(setPath);
    const expectedBytes = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
    if (!existingBytes.equals(expectedBytes)) throw Object.assign(new Error("immutable reference revision already has different bytes"), { code: "reference_revision_conflict" });
    set = { path: setPath, sha256: sha256Bytes(existingBytes), sizeBytes: existingBytes.length };
  }
  const pointer = await writeCanonicalJson(join(jobDir, "assets", "character-references", "current-reference-set.json"), { schemaVersion: "1.0.0", status: "provisional", referenceSetPath: rel(jobDir, set.path), referenceSetHash: set.sha256, approvalRevisionPath: null, approvalRevisionHash: null });
  if (!await artifactExactlyReusable(jobDir, { artifactId: "character-reference-set-current", path: rel(jobDir, set.path), sha256: set.sha256, dependencyHashes: artifactDependencies })) await registerArtifact(jobDir, { artifactId: "character-reference-set-current", logicalRole: "yadam.character.reference-set", path: rel(jobDir, set.path), sha256: set.sha256, schemaVersion: "1.0.0", producerStage: "image-preview", gateStatus: "pass", dependencyHashes: artifactDependencies });
  const pointerDependencies = { referenceSet: set.sha256 };
  if (!await artifactExactlyReusable(jobDir, { artifactId: "character-reference-pointer", path: rel(jobDir, pointer.path), sha256: pointer.sha256, dependencyHashes: pointerDependencies })) await registerArtifact(jobDir, { artifactId: "character-reference-pointer", logicalRole: "yadam.character.reference-pointer", path: rel(jobDir, pointer.path), sha256: pointer.sha256, schemaVersion: "1.0.0", producerStage: "image-preview", gateStatus: "pass", dependencyHashes: pointerDependencies });
  return { referenceSetPath: set.path, referenceSetHash: set.sha256, pointerPath: pointer.path, pointerHash: pointer.sha256 };
}

export async function loadReferencePointer(jobDir) {
  const pointerPath = join(jobDir, "assets", "character-references", "current-reference-set.json");
  await assertRealPathWithin(jobDir, pointerPath);
  const value = JSON.parse(await readFile(pointerPath, "utf8"));
  await validateSchema(join(process.cwd(), "schemas", "yadam", "reference-set-pointer.schema.json"), value);
  return value;
}

export async function promoteApprovedReferenceSet({ jobDir, approvalRevisionPath }) {
  const pointer = await loadReferencePointer(jobDir);
  if (isAbsolute(approvalRevisionPath) || approvalRevisionPath.includes("\\") || approvalRevisionPath === ".." || approvalRevisionPath.startsWith("../") || approvalRevisionPath.includes("/../")) throw Object.assign(new Error("approval path must be job-relative"), { code: "approval_path_outside_job" });
  const approvalPointerPath = join(jobDir, "approvals", "current-approval-2.json");
  await assertRealPathWithin(jobDir, approvalPointerPath);
  const approvalPointer = JSON.parse(await readFile(approvalPointerPath, "utf8"));
  if (approvalPointer.status !== "valid" || approvalPointer.path !== approvalRevisionPath) throw Object.assign(new Error("approval revision is not current"), { code: "approval2_not_valid" });
  const absoluteApprovalPath = join(jobDir, approvalRevisionPath);
  await assertRealPathWithin(jobDir, absoluteApprovalPath);
  const approvalBytes = await readFile(absoluteApprovalPath);
  if (await sha256File(absoluteApprovalPath) !== approvalPointer.sha256) throw Object.assign(new Error("approval pointer hash differs"), { code: "approval2_not_valid" });
  const approval = JSON.parse(approvalBytes.toString("utf8"));
  await validateSchema(join(process.cwd(), "schemas", "yadam", "approval.schema.json"), approval);
  if (approval.approvedArtifactSetHash !== approvalPointer.approvedArtifactSetHash) throw Object.assign(new Error("approval set hash differs from pointer"), { code: "approval2_not_valid" });
  const bound = approval.artifacts?.some(item => item.logicalRole === "yadam.character.reference-set" && item.sha256 === pointer.referenceSetHash);
  if (!bound || approval.referencePromotion?.from !== "provisional" || approval.referencePromotion?.to !== "approved" || approval.referencePromotion?.setHash !== pointer.referenceSetHash) throw Object.assign(new Error("approval does not bind/promote the reference set"), { code: "reference_set_not_approved" });
  const setPath = join(jobDir, pointer.referenceSetPath);
  await assertRealPathWithin(jobDir, setPath);
  if (await sha256File(setPath) !== pointer.referenceSetHash) throw Object.assign(new Error("reference set hash differs"), { code: "reference_set_stale" });
  await validateSchema(join(process.cwd(), "schemas", "yadam", "character-reference-set.schema.json"), JSON.parse(await readFile(setPath, "utf8")));
  const approvalHash = await sha256File(absoluteApprovalPath);
  const currentPointerPath = join(jobDir, "assets", "character-references", "current-reference-set.json");
  const currentPointerHash = await sha256File(currentPointerPath);
  if (pointer.status === "approved") {
    if (pointer.approvalRevisionPath === approvalRevisionPath && pointer.approvalRevisionHash === approvalHash) return { referenceSetPath: pointer.referenceSetPath, referenceSetHash: pointer.referenceSetHash, status: "approved", approvalRevisionPath, pointerHash: currentPointerHash };
  }
  const nextPointer = { ...pointer, status: "approved", approvalRevisionPath, approvalRevisionHash: approvalHash };
  await validateSchema(join(process.cwd(), "schemas", "yadam", "reference-set-pointer.schema.json"), nextPointer);
  const output = await writeCanonicalJson(join(jobDir, "assets", "character-references", "current-reference-set.json"), nextPointer);
  await registerArtifact(jobDir, { artifactId: "character-reference-pointer", logicalRole: "yadam.character.reference-pointer", path: "assets/character-references/current-reference-set.json", sha256: output.sha256, schemaVersion: "1.0.0", producerStage: "image-approval", gateStatus: "pass", dependencyHashes: { referenceSet: pointer.referenceSetHash, approvalRevision: approvalHash, approvalSet: approval.approvedArtifactSetHash } });
  return { referenceSetPath: pointer.referenceSetPath, referenceSetHash: pointer.referenceSetHash, status: "approved", approvalRevisionPath, pointerHash: output.sha256 };
}
```

`artifactExactlyReusable` loads the Plan 01 current manifest record by artifact ID, requires exact current `path`, `sha256`, schema version, producer stage, pass gate and complete dependency map, then calls `canReuseArtifact`; a dependency-only match cannot suppress a required path/hash revision. The immutable-target recovery path accepts only byte-for-byte `${canonicalJson(value)}\n`, so a crash after the exclusive set write resumes the same revision without overwriting it. The facade derives `revision` and `createdAt` from the same-input persisted `approval_2_previews` start row; it scans/reuses an exact orphaned immutable revision before allocating the next number. A different existing rNNN is `reference_revision_conflict`, not permission to increment silently.

- [ ] **Step 5: Replace the minimal red fixture with a schema-valid approval and add rejection/dependency tests**

Build the approval revision/current pointer with the exact Plan 02 approval schema, including `status:"valid"` pointer, `artifacts`, `approvedArtifactSetHash`, and `referencePromotion`. Assert promotion fails for an absolute/outside/symlinked primary, set, or approval path; `..` relative path; stale/noncurrent pointer; revision hash mismatch; schema mismatch; missing artifact binding; missing/wrong `referencePromotion.setHash`; and changed set bytes. Assert duplicate character/variant pairs fail. Approve r001, then make a schema-valid current r002 that binds the same immutable reference-set hash: promotion must update only the mutable pointer's approval path/hash and registry revision, leave set/pixel bytes unchanged, and return a new pointer hash; a noncurrent caller-supplied r002 still fails before mutation. Write reference-set revision 1 and revision 2, then assert the manifest contains exactly one current `yadam.character.reference-set` record with `artifactId:"character-reference-set-current"`, revision-2 path/hash, and a `revisionHistory` entry carrying revision 1's path/hash/status. Assert changing one primary image, story-bible character/variant semantic hash, either workflow, checkpoint, CLIP Vision, IP-Adapter, or any primary/derived compiled request hash changes/invalidates the reference artifact dependency closure and representative previews. Assert a derived reference depends directly on the primary hash and rejects a previous-scene image hash.

- [ ] **Step 6: Run reference lifecycle tests**

Run: `node --test test/yadam/image-service.test.mjs`

Expected: exclusive immutable candidate, job-root containment, complete dependency binding, current approval pointer/revision verification, exact promotion marker, rejection and no-scene-chaining tests pass.

- [ ] **Step 7: Commit reference lifecycle contracts**

```bash
git add schemas/yadam/character-reference-set.schema.json schemas/yadam/reference-set-pointer.schema.json scripts/lib/yadam/images/reference-store.mjs test/yadam/image-service.test.mjs
git commit -m "feat: bind yadam references to approval revisions"
```

### Task 9: Implement deterministic raster inspection and strict local Ollama visual QA

**Files:**
- Create: `schemas/yadam/vision-critic-response.schema.json`
- Create: `schemas/yadam/visual-asset-qa.schema.json`
- Create: `schemas/yadam/visual-qa-report.schema.json`
- Create: `scripts/lib/yadam/images/raster-inspector.mjs`
- Create: `scripts/lib/yadam/images/ollama-vision-critic.mjs`
- Create: `scripts/lib/yadam/images/visual-qa.mjs`
- Create: `test/yadam/image-qa.test.mjs`

**Interfaces:**
- Consumes: PNG bytes, the compiled request, optional approved reference PNG bytes, profile QA thresholds, loopback Ollama `gemma4:12b`.
- Produces: `inspectPng`, `createOllamaVisionCritic`, `evaluateVisualQa`, and a closed visual-QA report whose only production-eligible status is `pass`.

- [ ] **Step 1 (5 minutes): Write failing raster boundary tests.**

Build synthetic PNGs in memory with Sharp; do not check binary fixtures into the repository. The test must cover a valid 1024×576 colored gradient, wrong dimensions, JPEG bytes renamed as PNG, a 100% black frame, a one-color frame, transparent pixels, color-pixel ratio `0.099` versus `0.100`, a duplicate hash owned by a different asset, and the same hash owned by the same resumed asset:

```js
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { inspectPng } from "../../scripts/lib/yadam/images/raster-inspector.mjs";

async function coloredPng(width = 1024, height = 576) {
  const channels = 3;
  const data = Buffer.alloc(width * height * channels);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    data[pixel * channels] = 32 + (pixel % 190);
    data[pixel * channels + 1] = 48 + (pixel % 130);
    data[pixel * channels + 2] = 96 + (pixel % 120);
  }
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

test("raster inspector accepts exact colored PNG", async () => {
  const bytes = await coloredPng();
  const result = await inspectPng({ assetId: "slot-001", bytes, expectedWidth: 1024, expectedHeight: 576, colorPixelRatioMin: 0.1, duplicateOwners: new Map() });
  assert.equal(result.status, "pass");
  assert.equal(result.width, 1024);
  assert.equal(result.height, 576);
  assert.equal(result.failures.length, 0);
});

test("another asset cannot reuse identical pixels", async () => {
  const bytes = await coloredPng();
  const first = await inspectPng({ assetId: "slot-001", bytes, expectedWidth: 1024, expectedHeight: 576, colorPixelRatioMin: 0.1, duplicateOwners: new Map() });
  const duplicateOwners = new Map([[first.sha256, "slot-000"]]);
  const result = await inspectPng({ assetId: "slot-001", bytes, expectedWidth: 1024, expectedHeight: 576, colorPixelRatioMin: 0.1, duplicateOwners });
  assert.deepEqual(result.failures, ["duplicate_pixels"]);
});
```

- [ ] **Step 2 (2 minutes): Run the raster tests and confirm the missing module.**

Run: `node --test test/yadam/image-qa.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `raster-inspector.mjs`.

- [ ] **Step 3 (5 minutes): Create the closed critic, per-asset and aggregate visual-QA schemas.**

Create `schemas/yadam/visual-asset-qa.schema.json` as Draft 2020-12 with `additionalProperties:false` at every object level. Require:

```json
{
  "schemaVersion": "1.0.0",
  "assetId": "slot-001",
  "visualSlotId": "slot-001",
  "purpose": "scene",
  "attempt": 1,
  "compiledRequestHash": "<64 lowercase hex>",
  "asset": { "path": "assets/images/slot-001.png", "sha256": "<64 lowercase hex>", "width": 1024, "height": 576 },
  "deterministic": {
    "status": "pass",
    "format": "png",
    "sizeBytes": 1234,
    "meanLuminance": 100.0,
    "luminanceStdDev": 20.0,
    "visiblePixelRatio": 1.0,
    "colorPixelRatio": 0.5,
    "failures": []
  },
  "critic": {
    "status": "pass",
    "model": "gemma4:12b",
    "responseHash": "<64 lowercase hex>",
    "scores": { "contextMatch": 8, "focalCharacterMatch": 7, "eraWardrobeMatch": 8, "colorStyleMatch": 8 },
    "flags": {
      "requiredFocalSubjectPresent": true,
      "unexpectedFocalSubject": false,
      "readableText": false,
      "watermark": false,
      "modernObject": false,
      "severeAnatomyDefect": false,
      "minorSafetyViolation": false,
      "reservedTextRectClear": null,
      "faceInTextRect": null,
      "criticalObjectInTextRect": null,
      "subjectPlacementMatch": null
    }
  },
  "failedAxes": [],
  "repairAttemptUsed": false,
  "status": "pass"
}
```

Use enums `reference|intro|scene|thumbnail-background`, deterministic status `pass|fail`, critic status `not_run|pass|fail|unavailable|parse_error`, and report status `pass|needs_review`. Make `critic` a closed discriminated union: `not_run` requires only `reason:"deterministic_failed"`; `pass|fail` require the locked model, response hash, all scores and all flags; `unavailable|parse_error` require the locked model, nullable response hash and a bounded allowlisted `errorCode`, and forbid scores/flags. All four scores are integers from 0 through 10. Thumbnail-only flags are boolean for `thumbnail-background` and `null` for other purposes. `failedAxes` contains only the declared score/flag keys or deterministic/provider failure codes. This keeps raw provider envelopes and prose out of durable QA artifacts.

Create `schemas/yadam/visual-qa-report.schema.json` as the aggregate handoff schema:

```js
{
  schemaVersion: "1.0.0",
  jobId,
  approvalRevisionPath,
  approvedArtifactSetHash,
  renderPlanHash,
  referenceSetHash,
  status: "pass" | "needs_review",
  totalAssets,
  passedAssets,
  needsReviewAssets,
  assets: [{ assetId, visualSlotId, qaPath, qaHash, status: "pass" | "needs_review", failedAxes }]
}
```

Require `totalAssets === assets.length`, module-enforce unique asset/slot IDs and sorted visual order, and permit aggregate `pass` only when `passedAssets===totalAssets`, `needsReviewAssets===0`, every referenced per-asset file validates against `visual-asset-qa.schema.json`, and its registered record has `gateStatus:"pass"`.

Create `schemas/yadam/vision-critic-response.schema.json` as the single on-disk source for Ollama's `format` request and the returned value validator:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://auto-video.local/schemas/yadam/vision-critic-response.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["scores", "flags"],
  "properties": {
    "scores": {
      "type": "object",
      "additionalProperties": false,
      "required": ["contextMatch", "focalCharacterMatch", "eraWardrobeMatch", "colorStyleMatch"],
      "properties": {
        "contextMatch": { "type": "integer", "minimum": 0, "maximum": 10 },
        "focalCharacterMatch": { "type": "integer", "minimum": 0, "maximum": 10 },
        "eraWardrobeMatch": { "type": "integer", "minimum": 0, "maximum": 10 },
        "colorStyleMatch": { "type": "integer", "minimum": 0, "maximum": 10 }
      }
    },
    "flags": {
      "type": "object",
      "additionalProperties": false,
      "required": ["requiredFocalSubjectPresent", "unexpectedFocalSubject", "readableText", "watermark", "modernObject", "severeAnatomyDefect", "minorSafetyViolation", "reservedTextRectClear", "faceInTextRect", "criticalObjectInTextRect", "subjectPlacementMatch"],
      "properties": {
        "requiredFocalSubjectPresent": { "type": "boolean" },
        "unexpectedFocalSubject": { "type": "boolean" },
        "readableText": { "type": "boolean" },
        "watermark": { "type": "boolean" },
        "modernObject": { "type": "boolean" },
        "severeAnatomyDefect": { "type": "boolean" },
        "minorSafetyViolation": { "type": "boolean" },
        "reservedTextRectClear": { "type": ["boolean", "null"] },
        "faceInTextRect": { "type": ["boolean", "null"] },
        "criticalObjectInTextRect": { "type": ["boolean", "null"] },
        "subjectPlacementMatch": { "type": ["boolean", "null"] }
      }
    }
  }
}
```

The client reads this file relative to `import.meta.url`, recursively freezes the parsed object, sends that same object as `format`, and passes the parsed response through Plan 01 `validateSchema` against the same path. Add a drift test that deep-compares exported `CRITIC_FORMAT` with the JSON file and proves every nested object, array and property schema is frozen.

- [ ] **Step 4 (5 minutes): Implement exact PNG statistics and duplicate ownership.**

Create `scripts/lib/yadam/images/raster-inspector.mjs`:

```js
import { createHash } from "node:crypto";
import sharp from "sharp";

const round6 = value => Number(value.toFixed(6));

export async function inspectPng({ assetId, bytes, expectedWidth, expectedHeight, colorPixelRatioMin, duplicateOwners }) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const failures = [];
  if (bytes.length < 1024) failures.push("insufficient_bytes");
  let decoded;
  try {
    decoded = await sharp(bytes, { failOn: "error", limitInputPixels: 2000000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch (cause) {
    return { status: "fail", format: "unknown", sizeBytes: bytes.length, sha256, width: 0, height: 0, meanLuminance: 0, luminanceStdDev: 0, visiblePixelRatio: 0, colorPixelRatio: 0, failures: ["png_decode_failed"], causeCode: cause.code ?? "sharp_error" };
  }
  const metadata = await sharp(bytes).metadata();
  if (metadata.format !== "png") failures.push("format_not_png");
  if (decoded.info.width !== expectedWidth || decoded.info.height !== expectedHeight) failures.push("dimension_mismatch");
  let visible = 0;
  let colored = 0;
  let sum = 0;
  let sumSquares = 0;
  for (let index = 0; index < decoded.data.length; index += 4) {
    const red = decoded.data[index];
    const green = decoded.data[index + 1];
    const blue = decoded.data[index + 2];
    const alpha = decoded.data[index + 3];
    if (alpha >= 250) {
      visible += 1;
      if (Math.max(red, green, blue) - Math.min(red, green, blue) >= 12) colored += 1;
    }
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    sum += luminance;
    sumSquares += luminance * luminance;
  }
  const pixels = decoded.info.width * decoded.info.height;
  const meanLuminance = sum / pixels;
  const luminanceStdDev = Math.sqrt(Math.max(0, sumSquares / pixels - meanLuminance ** 2));
  const visiblePixelRatio = visible / pixels;
  const colorPixelRatio = visible === 0 ? 0 : colored / visible;
  if (visiblePixelRatio < 0.999) failures.push("transparent_pixels");
  if (meanLuminance < 4) failures.push("black_frame");
  if (meanLuminance > 251) failures.push("white_frame");
  if (luminanceStdDev < 2) failures.push("near_solid_frame");
  if (colorPixelRatio < colorPixelRatioMin) failures.push("insufficient_color");
  const duplicateOwner = duplicateOwners.get(sha256);
  if (duplicateOwner !== undefined && duplicateOwner !== assetId) failures.push("duplicate_pixels");
  return {
    status: failures.length ? "fail" : "pass",
    format: metadata.format,
    sizeBytes: bytes.length,
    sha256,
    width: decoded.info.width,
    height: decoded.info.height,
    meanLuminance: round6(meanLuminance),
    luminanceStdDev: round6(luminanceStdDev),
    visiblePixelRatio: round6(visiblePixelRatio),
    colorPixelRatio: round6(colorPixelRatio),
    failures: [...new Set(failures)].sort()
  };
}
```

- [ ] **Step 5 (5 minutes): Write failing critic request, threshold, parse, and outage tests.**

Record the `/api/chat` request and assert `model:"gemma4:12b"`, `stream:false`, the default `format` is the recursively frozen closed JSON Schema, reference images precede the output image, the zero-based `imageOrder.referenceImageIndexes` and `imageOrder.candidateImageIndex` labels exactly describe that binary order, `options.temperature` is `0`, and the compiled request identity/story/composition is present in the text instruction. Return valid JSON once, malformed content once, a schema-invalid but parseable value once, wrong content type once, a JSON body over 1 MiB once, HTTP 503 once, and an internal request timeout once. Abort an explicit caller-owned `AbortController` once and assert that cancellation error is rethrown; assert the internal timeout instead returns `status:"unavailable",errorCode:"vision_timeout"`, so it cannot impersonate cancellation. Test `http://127.0.0.1:11434`, `http://localhost:11434` and `http://[::1]:11434`, and reject HTTPS, credentials, a non-root path, query, fragment, and non-loopback hosts. Add boundary assertions for scores `7/6/7/7` passing, each value one lower failing its named axis, readable text and modern object failing, thumbnail reserved-area flags using exact booleans, and all four thumbnail-only flags being `null` for every non-thumbnail purpose. Test `unload` with `stream:false`, bounded JSON consumption, caller cancellation, timeout, non-2xx and oversized responses.

- [ ] **Step 6 (5 minutes): Implement the schema-constrained local vision critic and explicit unload.**

Create `scripts/lib/yadam/images/ollama-vision-critic.mjs` with a recursively frozen `CRITIC_FORMAT` loaded from `vision-critic-response.schema.json`; it requires all four score and eleven flag keys shown in Step 3. The client accepts only a bare loopback HTTP origin and returns a typed status instead of treating provider errors as a pass:

```js
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateSchema } from "../../pipeline/schema-registry.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

const CRITIC_SCHEMA_PATH = fileURLToPath(new URL("../../../../schemas/yadam/vision-critic-response.schema.json", import.meta.url));

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export const CRITIC_FORMAT = deepFreeze(JSON.parse(readFileSync(CRITIC_SCHEMA_PATH, "utf8")));

async function boundedJson(response, code) {
  if (!response.ok) return { errorStatus: response.status };
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) throw Object.assign(new Error("Ollama JSON content type required"), { code: `${code}_content_type` });
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 1024 * 1024) throw Object.assign(new Error("Ollama response exceeds 1 MiB"), { code: `${code}_oversized` });
  if (!response.body) throw Object.assign(new Error("Ollama response body missing"), { code: `${code}_body_missing` });
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 1024 * 1024) { await reader.cancel(); throw Object.assign(new Error("Ollama response exceeds 1 MiB"), { code: `${code}_oversized` }); }
    chunks.push(Buffer.from(value));
  }
  try { return JSON.parse(Buffer.concat(chunks, total).toString("utf8")); } catch { throw Object.assign(new Error("Ollama response JSON invalid"), { code: `${code}_invalid_json` }); }
}

function loopbackBase(value) {
  let url;
  try { url = new URL(value); }
  catch (cause) { throw Object.assign(new Error("Ollama must use a bare loopback HTTP origin"), { code: "ollama_non_loopback", cause }); }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash
  ) throw Object.assign(new Error("Ollama must use a bare loopback HTTP origin"), { code: "ollama_non_loopback" });
  return url.origin;
}

export function createOllamaVisionCritic({ baseUrl, model = "gemma4:12b", fetchImpl = fetch, format = CRITIC_FORMAT, requestTimeoutMs = 180000 }) {
  if (model !== "gemma4:12b") throw Object.assign(new Error("unlocked vision model"), { code: "vision_model_not_locked" });
  const base = loopbackBase(baseUrl);
  return Object.freeze({
    async inspect({ imageBytes, referenceBytes = [], request, signal }) {
      const referenceImageIndexes = referenceBytes.map((_, index) => index);
      const body = {
        model,
        stream: false,
        format,
        options: { temperature: 0, seed: request.render.seed },
        messages: [{ role: "user", content: JSON.stringify({ task: "Evaluate only the declared yadam axes; return one JSON object", imageOrder: { referenceImageIndexes, candidateImageIndex: referenceBytes.length }, identity: request.identity, story: request.story, composition: request.composition, purpose: request.purpose, reservedTextRect: request.composition.reservedTextRect ?? null }), images: [...referenceBytes, imageBytes].map(value => value.toString("base64")) }]
      };
      let response;
      const timeoutSignal = AbortSignal.timeout(requestTimeoutMs);
      try {
        const boundedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
        response = await fetchImpl(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: boundedSignal });
      } catch (cause) {
        if (signal?.aborted) throw cause;
        if (timeoutSignal.aborted || cause?.name === "TimeoutError") return { status: "unavailable", model, errorCode: "vision_timeout" };
        return { status: "unavailable", model, errorCode: "vision_unavailable" };
      }
      if (!response.ok) return { status: "unavailable", model, errorCode: `vision_http_${response.status}` };
      let envelope;
      try { envelope = await boundedJson(response, "vision_response"); }
      catch (error) {
        if (signal?.aborted) throw error;
        if (timeoutSignal.aborted || error?.name === "TimeoutError") return { status: "unavailable", model, errorCode: "vision_timeout" };
        return { status: "parse_error", model, errorCode: error.code ?? "vision_response_invalid" };
      }
      const content = envelope?.message?.content;
      if (typeof content !== "string") return { status: "parse_error", model, errorCode: "vision_content_missing" };
      const responseHash = sha256(Buffer.from(content, "utf8"));
      let value;
      try {
        value = JSON.parse(content);
      } catch {
        return { status: "parse_error", model, responseHash, errorCode: "vision_json_invalid" };
      }
      try { await validateSchema(CRITIC_SCHEMA_PATH, value); }
      catch { return { status: "parse_error", model, responseHash, errorCode: "vision_schema_invalid" }; }
      return { status: "ok", model, responseHash, value };
    },
    async unload({ signal } = {}) {
      const timeoutSignal = AbortSignal.timeout(requestTimeoutMs);
      const boundedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      let response;
      try {
        response = await fetchImpl(`${base}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, stream: false, keep_alive: 0 }), signal: boundedSignal });
      } catch (cause) {
        if (signal?.aborted) throw cause;
        const code = timeoutSignal.aborted || cause?.name === "TimeoutError" ? "vision_unload_timeout" : "vision_unload_failed";
        throw Object.assign(new Error(code), { code, cause });
      }
      if (!response.ok) throw Object.assign(new Error(`Ollama unload HTTP ${response.status}`), { code: "vision_unload_failed" });
      try { await boundedJson(response, "vision_unload_response"); }
      catch (cause) {
        if (signal?.aborted) throw cause;
        const code = timeoutSignal.aborted || cause?.name === "TimeoutError" ? "vision_unload_timeout" : cause.code ?? "vision_unload_failed";
        throw Object.assign(new Error(code), { code, cause });
      }
    }
  });
}
```

An extra key, missing key, non-integer score, or wrong null/boolean shape is `parse_error`. The default exported format and the validator must share the same schema file; a caller-supplied test `format` does not change response validation. Preflight separately proves the locked local model name, digest, size, `vision` capability and `Q4_K_M` quantization before this client is created.

- [ ] **Step 7 (5 minutes): Implement one deterministic decision function and repair-axis projection.**

Create `scripts/lib/yadam/images/visual-qa.mjs`:

```js
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
  if (deterministic.status !== "pass") return { status: "needs_review", deterministic, critic: { status: "not_run", reason: "deterministic_failed" }, failedAxes: deterministic.failures, repairAllowed: repairAttemptUsed === false };
  const criticResult = await critic.inspect({ imageBytes: asset.bytes, referenceBytes, request, signal });
  const decision = decideCritic({ request, result: criticResult, thresholds: profile.visual.qa });
  const criticEvidence = projectCriticEvidence(criticResult, decision);
  return { status: decision.status, deterministic, critic: criticEvidence, failedAxes: decision.failedAxes, repairAllowed: decision.status !== "pass" && repairAttemptUsed === false && criticResult.status === "ok" };
}
```

Import `inspectPng` explicitly. Build repair prompt clauses only from the sorted `failedAxes` allowlist; do not pass free-form critic prose into ComfyUI. Provider unavailable, parse failure, safety failure after the allowed repair, and schema failure set `repairAllowed:false` and force the stage to `needs_review`. Cancellation is rethrown and follows the job's `cancel_requested -> cancelled` path instead of writing a QA decision.

- [ ] **Step 8 (4 minutes): Run QA tests.**

Run: `node --test test/yadam/image-qa.test.mjs`

Expected: exact PNG, opaque-pixel color ratio, 2,000,000-pixel cap, threshold, duplicate, thumbnail geometry flags, bounded/malformed critic, HTTP outage, cancellation propagation, unload and one-repair decisions pass; no unavailable/parse result is production eligible.

- [ ] **Step 9 (2 minutes): Commit the visual QA boundary.**

```bash
git add schemas/yadam/vision-critic-response.schema.json schemas/yadam/visual-asset-qa.schema.json schemas/yadam/visual-qa-report.schema.json scripts/lib/yadam/images/raster-inspector.mjs scripts/lib/yadam/images/ollama-vision-critic.mjs scripts/lib/yadam/images/visual-qa.mjs test/yadam/image-qa.test.mjs
git commit -m "feat: enforce strict yadam visual QA"
```

### Task 10: Make ComfyUI generation durable, resumable, retry-bounded and owner-cancellable

**Files:**
- Create: `schemas/yadam/image-asset-manifest.schema.json`
- Create: `scripts/lib/yadam/images/image-runner.mjs`
- Modify: `test/yadam/image-provider.test.mjs`
- Modify: `test/yadam/image-service.test.mjs`

**Interfaces:**
- Consumes: one compiled request, one validated workflow graph, ComfyUI client, fixed SaveImage node `9`, and a caller-held GPU lease.
- Produces: `generateAssetRaster`, `resumeAssetRaster`, `cancelOwnedAsset`, `writeImageAssetManifest`; checkpoints are durable before any later provider request is submitted.

- [ ] **Step 1 (5 minutes): Write failing prompt-ID durability and resume tests.**

Use a fake client that records method order. Submit one prompt, make `waitForOutput` throw `comfy_prompt_timeout`, restart through `resumeAssetRaster`, then return history output. Assert the checkpoint already contains the original prompt ID, resume calls `waitForOutput` for that ID before any `submitPrompt`, and the final PNG is written once. Add a dropped-POST-response case where fake `/history/<stable-id>` contains the completed job; assert resume recovers that ID with zero additional POST calls and all observed prompt IDs are identical. Add a downloaded-checkpoint case where file/hash/request hash all match and assert no client method is called.

```js
test("resume polls the saved prompt before considering resubmission", async () => {
  const calls = [];
  const client = {
    submitPrompt: async ({ promptId }) => { calls.push(`submit:${promptId}`); return { promptId, number: 1 }; },
    waitForOutput: async ({ promptId }) => { calls.push(`wait:${promptId}`); if (calls.filter(item => item.startsWith("wait:")).length === 1) throw Object.assign(new Error("timeout"), { code: "comfy_prompt_timeout" }); return { filename: "slot.png", subfolder: "yadam", type: "output" }; },
    downloadFile: async () => Buffer.from(validPngBytes),
    getQueue: async () => ({ queue_running: [], queue_pending: [] })
  };
  await assert.rejects(generateAssetRaster(fixtureInput({ client })), error => error.code === "comfy_prompt_timeout");
  const result = await resumeAssetRaster(fixtureInput({ client }));
  assert.match(calls[0], /^submit:[0-9a-f-]{36}$/);
  assert.equal(calls[1], calls[0].replace("submit:", "wait:"));
  assert.equal(calls[2], calls[1]);
  assert.equal(result.status, "downloaded");
});
```

- [ ] **Step 2 (2 minutes): Run and confirm the runner is missing.**

Run: `node --test test/yadam/image-provider.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `image-runner.mjs`.

- [ ] **Step 3 (5 minutes): Create the closed production image manifest schema.**

Require this canonical shape in `schemas/yadam/image-asset-manifest.schema.json`; every object has `additionalProperties:false`, every path is job-relative with `/`, and every hash is lowercase SHA-256:

```js
{
  schemaVersion: "1.0.0",
  jobId,
  approvalRevisionPath,
  approvedArtifactSetHash,
  referenceSetPath,
  referenceSetHash,
  renderPlanPath: "render-plan.json",
  renderPlanHash,
  assets: [{
    assetId,
    visualSlotId,
    purpose: "intro" | "scene" | "thumbnail-background",
    path,
    sha256,
    width,
    height,
    compiledRequestPath,
    compiledRequestHash,
    workflowPath,
    workflowHash,
    checkpointHash,
    referenceSetHash,
    seed,
    generationAttempt,
    repairAttemptUsed,
    qaPath,
    qaHash,
    qaStatus: "pass"
  }]
}
```

Enforce unique `assetId` and unique non-thumbnail `visualSlotId` in module logic because JSON Schema cannot express those projections. The manifest may be published only when every render-plan slot has exactly one row, no unknown slot exists, every QA status is `pass`, and the one thumbnail-background row uses `visualSlotId:"thumbnail-background"`.

- [ ] **Step 4 (5 minutes): Reuse Plan 01 synced binary writes and implement checkpoint paths and quarantine.**

Create the foundation of `scripts/lib/yadam/images/image-runner.mjs`:

```js
import { createHash } from "node:crypto";
import { mkdir, readFile, rename } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { writeBinaryAtomic, writeCanonicalJson } from "../../pipeline/atomic-store.mjs";

const rel = (jobDir, filePath) => relative(jobDir, filePath).replaceAll("\\", "/");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function checkpointPath(jobDir, assetId) {
  if (!/^[a-z0-9][a-z0-9-]{0,95}$/.test(assetId)) throw Object.assign(new Error("invalid asset id"), { code: "asset_id_invalid" });
  return join(jobDir, "assets", "images", "checkpoints", `${assetId}.json`);
}

function stablePromptId(idempotencyKey) {
  if (!/^[0-9a-f]{64}$/.test(idempotencyKey)) throw Object.assign(new Error("invalid idempotency key"), { code: "idempotency_key_invalid" });
  return `${idempotencyKey.slice(0, 8)}-${idempotencyKey.slice(8, 12)}-${idempotencyKey.slice(12, 16)}-${idempotencyKey.slice(16, 20)}-${idempotencyKey.slice(20, 32)}`;
}

async function quarantineMismatch({ jobDir, filePath, assetId, actualHash }) {
  const target = join(jobDir, "quarantine", "images", `${assetId}-${actualHash.slice(0, 12)}.png`);
  await mkdir(dirname(target), { recursive: true });
  await rename(filePath, target);
  return rel(jobDir, target);
}
```

Plan 01 `writeBinaryAtomic` provides the synced temporary write, cleanup and same-directory rename; do not duplicate it here. Before any quarantine rename, assert both source and destination resolve under `jobDir` using Plan 01 path-policy helpers. If a canonical output already exists, verify its checkpoint hash and compiled-request hash; reuse it only when both match, otherwise quarantine it under the exact job.

- [ ] **Step 5 (5 minutes): Implement submit, immediate checkpoint, fixed output and same-prompt resume.**

The generation function writes statuses `prepared -> submitted -> downloaded`; it never marks QA itself:

```js
export async function generateAssetRaster({ jobDir, jobId, request, workflow, workflowHash, client, promptTimeoutMs, signal, now }) {
  const checkpointFile = checkpointPath(jobDir, request.assetId);
  const requestHash = request.idempotencyKey;
  const prior = await readFile(checkpointFile, "utf8").then(JSON.parse, () => null);
  if (prior?.requestHash === requestHash && ["prepared", "outcome_unknown", "submitted", "running"].includes(prior.status) && prior.promptId) {
    return resumeAssetRaster({ jobDir, jobId, request, workflow, workflowHash, client, promptTimeoutMs, signal, now });
  }
  if (prior?.requestHash === requestHash && prior.status === "downloaded") {
    const bytes = await readFile(join(jobDir, prior.outputPath)).catch(() => null);
    if (bytes && sha256(bytes) === prior.outputHash) return { ...prior, bytes };
    if (bytes) await quarantineMismatch({ jobDir, filePath: join(jobDir, prior.outputPath), assetId: request.assetId, actualHash: sha256(bytes) });
  }
  if (signal?.aborted) throw Object.assign(new Error("image generation cancelled"), { code: "cancelled" });
  const clientId = `yadam-${jobId}-${request.assetId}`;
  const promptId = stablePromptId(requestHash);
  const prepared = { schemaVersion: "1.0.0", assetId: request.assetId, requestHash, workflowHash, status: "prepared", promptId, queueNumber: null, submitAttempt: (prior?.submitAttempt ?? 0) + 1, preparedAt: now(), outputPath: null, outputHash: null };
  await writeCanonicalJson(checkpointFile, prepared);
  let submitted;
  try {
    submitted = await client.submitPrompt({ workflow, clientId, promptId, signal });
  } catch (error) {
    await writeCanonicalJson(checkpointFile, { ...prepared, status: "outcome_unknown", submitErrorCode: error.code ?? error.name, submitResponseDroppedAt: now() });
    throw Object.assign(new Error("ComfyUI submit response was not confirmed; resume the known prompt ID"), { code: "comfy_submit_outcome_unknown", promptId, cause: error });
  }
  await writeCanonicalJson(checkpointFile, { ...prepared, status: "submitted", queueNumber: submitted.number, submittedAt: now() });
  return resumeAssetRaster({ jobDir, jobId, request, workflow, workflowHash, client, promptTimeoutMs, signal, now });
}

export async function resumeAssetRaster({ jobDir, jobId, request, workflow, workflowHash, client, promptTimeoutMs, signal, now, confirmedServerRestart = false }) {
  const checkpointFile = checkpointPath(jobDir, request.assetId);
  let checkpoint = JSON.parse(await readFile(checkpointFile, "utf8"));
  if (checkpoint.requestHash !== request.idempotencyKey || checkpoint.workflowHash !== workflowHash) throw Object.assign(new Error("checkpoint dependency mismatch"), { code: "image_checkpoint_stale" });
  if (!checkpoint.promptId) throw Object.assign(new Error("checkpoint lacks prompt id"), { code: "image_checkpoint_prompt_missing" });
  if (["prepared", "outcome_unknown"].includes(checkpoint.status)) {
    const [history, queue] = await Promise.all([client.getHistory({ promptId: checkpoint.promptId, signal }), client.getQueue({ signal })]);
    const visible = history[checkpoint.promptId] || promptIds(queue.queue_pending).has(checkpoint.promptId) || promptIds(queue.queue_running).has(checkpoint.promptId);
    if (!visible && !confirmedServerRestart) throw Object.assign(new Error("known prompt is absent but server restart is not proven"), { code: "comfy_prompt_absence_unproven", promptId: checkpoint.promptId });
    if (!visible && confirmedServerRestart) {
      if (checkpoint.restartResubmitUsed === true) throw Object.assign(new Error("restart resubmit already used"), { code: "comfy_restart_resubmit_exhausted" });
      const submitted = await client.submitPrompt({ workflow, clientId: `yadam-${jobId}-${request.assetId}`, promptId: checkpoint.promptId, signal });
      checkpoint = { ...checkpoint, status: "submitted", queueNumber: submitted.number, restartResubmitUsed: true, restartedSubmitAt: now() };
      await writeCanonicalJson(checkpointFile, checkpoint);
    }
  }
  const remote = await client.waitForOutput({ promptId: checkpoint.promptId, outputNodeId: "9", timeoutMs: promptTimeoutMs, signal });
  const bytes = await client.downloadFile({ ...remote, maxBytes: request.render.width * request.render.height * 4 + 1024 * 1024, signal });
  const outputPath = join(jobDir, "assets", "images", `${request.assetId}.png`);
  const output = await writeBinaryAtomic(outputPath, bytes);
  const value = { ...checkpoint, status: "downloaded", remoteOutput: remote, outputPath: rel(jobDir, output.path), outputHash: output.sha256, sizeBytes: output.sizeBytes, downloadedAt: now() };
  const written = await writeCanonicalJson(checkpointFile, value);
  return { ...value, checkpointHash: written.sha256, bytes };
}
```

`now()` returns an injected UTC ISO-8601 millisecond string. A timeout retains `status:"submitted"` and the same prompt ID. The checkpoint with the deterministic ID is durable before POST. A dropped response becomes `outcome_unknown`; resume checks `/history/<known-id>` and `/queue` and recovers that same ID without a second POST. Only explicit `POST /prompt` HTTP 429/502/503/504 rejection, which proves the request was rejected, may retry the same ID with exponential delays 1 and 2 seconds and at most three total attempts. If the known ID is absent, resubmit the same ID/key exactly once only when host-control evidence proves a server restart; otherwise return `comfy_prompt_absence_unproven`. Execution failure, output cardinality failure, unsafe path and hash mismatch are not transient.

- [ ] **Step 6 (5 minutes): Implement owner-scoped cancellation from the current queue.**

```js
function promptIds(rows) {
  return new Set((rows ?? []).map(row => String(row[1])));
}

export async function cancelOwnedAsset({ jobDir, assetId, client, now }) {
  const file = checkpointPath(jobDir, assetId);
  const checkpoint = JSON.parse(await readFile(file, "utf8"));
  if (!checkpoint.promptId || checkpoint.status === "downloaded") return { status: checkpoint.status, action: "none" };
  const queue = await client.getQueue();
  const queued = promptIds(queue.queue_pending);
  const running = promptIds(queue.queue_running);
  let action = "none";
  if (queued.has(checkpoint.promptId)) {
    await client.deleteQueued(checkpoint.promptId);
    action = "queue_delete";
  } else if (running.has(checkpoint.promptId)) {
    await client.interruptOwned(checkpoint.promptId);
    action = "targeted_interrupt";
  }
  await writeCanonicalJson(file, { ...checkpoint, status: "cancelled", cancelledAt: now(), cancelAction: action });
  return { status: "cancelled", action };
}
```

Add tests where another job's prompt is also queued/running. Assert only the checkpoint-owned ID appears in `/queue` or `/interrupt`, `/free` is never used as cancellation, an unknown completed prompt performs no remote mutation, and a cancelled checkpoint is never promoted into the asset manifest.

- [ ] **Step 7 (5 minutes): Implement manifest construction with exact slot parity.**

`writeImageAssetManifest({jobDir,jobId,approval,referenceSet,renderPlan,assets,visualQaReportHash})` must sort rows by render-plan `visualOrder`, append the thumbnail background last, validate all schemas and hashes, and write `assets/asset-manifest.json`. Reject duplicate/missing/orphan slots before writing. Register it with:

```js
await registerArtifact(jobDir, {
  artifactId: "image-asset-manifest",
  logicalRole: "yadam.image.asset-manifest",
  path: "assets/asset-manifest.json",
  sha256: output.sha256,
  schemaVersion: "1.0.0",
  producerStage: "GENERATING_PRODUCTION_IMAGES",
  gateStatus: "pass",
  dependencyHashes: {
    approvalSet: approval.approvedArtifactSetHash,
    renderPlan: renderPlan.sha256,
    referenceSet: referenceSet.referenceSetHash,
    visualQa: visualQaReportHash
  }
});
```

The `visualQaReportHash` argument is required; no manifest is registered before the aggregated QA report exists and passes.

- [ ] **Step 8 (4 minutes): Run runner, stable-ID resume, retry, cancellation and manifest tests.**

Run: `node --test test/yadam/image-provider.test.mjs test/yadam/image-service.test.mjs`

Expected: prompt durability before POST, dropped-response recovery through the same ID, zero duplicate prompt IDs, exact three-rejected-submit bound, one restart resubmit bound, binary quarantine, owner cancellation, slot parity and pass-only manifest tests all pass.

- [ ] **Step 9 (2 minutes): Commit the durable image runner.**

```bash
git add schemas/yadam/image-asset-manifest.schema.json scripts/lib/yadam/images/image-runner.mjs test/yadam/image-provider.test.mjs test/yadam/image-service.test.mjs
git commit -m "feat: resume and cancel owned ComfyUI assets"
```

### Task 11: Compose the selected Korean thumbnail copy with Sharp and prove safe-zone integrity

**Files:**
- Create: `schemas/yadam/thumbnail-qa.schema.json`
- Create: `scripts/lib/yadam/images/thumbnail-compositor.mjs`
- Create: `test/yadam/thumbnail.test.mjs`

**Interfaces:**
- Consumes: Plan 02's exact selected `copyId`, `lines`, `exactText` and injected layout geometry, a passed 1280×720 text-free background, pinned Malgun font files, and passed thumbnail-background critic evidence.
- Produces: `composeThumbnail({jobDir,background,option,selection,fontLock,backgroundQa})` and immutable evidence for `thumbnail/background.png`, `thumbnail/final.png`, `thumbnail/qa.json`, and the approval guide overlay.

- [ ] **Step 1 (5 minutes): Write failing exact-copy, edge and overlap tests.**

Create a 1280×720 colored background in memory. Use a Korean selection whose `exactText` equals `lines.join("\n")`. Assert output is PNG 1280×720, metadata preserves the exact strings and line hashes, font size is within the approved min/max range, and the text pixel rectangle stays at least `ceil(width*0.04)` from horizontal edges and `ceil(height*0.04)` from vertical edges. Then assert each case fails with the named code: changed punctuation (`thumbnail_copy_mismatch`), normalized coordinate outside 0–1 (`thumbnail_rect_invalid`), text rectangle one pixel into a protected rectangle (`thumbnail_protected_overlap`), minimum font still overflowing (`thumbnail_text_overflow`), background QA not pass (`thumbnail_background_qa_failed`), and font hash drift (`locked_file_hash_mismatch`).

```js
test("one-pixel protected overlap is rejected", () => {
  const text = { x: 64, y: 72, width: 500, height: 560 };
  const protectedRect = { x: 563, y: 200, width: 100, height: 100 };
  assert.equal(rectsOverlap(text, protectedRect), true);
});

test("touching edges without shared pixels is allowed", () => {
  const text = { x: 64, y: 72, width: 500, height: 560 };
  const protectedRect = { x: 564, y: 200, width: 100, height: 100 };
  assert.equal(rectsOverlap(text, protectedRect), false);
});
```

- [ ] **Step 2 (2 minutes): Run and confirm the compositor is missing.**

Run: `node --test test/yadam/thumbnail.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `thumbnail-compositor.mjs`.

- [ ] **Step 3 (5 minutes): Create a closed thumbnail QA schema.**

Require:

```js
{
  schemaVersion: "1.0.0",
  status: "pass" | "needs_review",
  copyId: "copy-01",
  exactText,
  lines,
  lineHashes,
  lineCount,
  layout: "left-panel-4" | "right-panel-4" | "bottom-band-2",
  canvas: { width: 1280, height: 720 },
  normalizedTextRect: [x, y, width, height],
  pixelTextRect: { x, y, width, height },
  protectedPixelRects: [{ id, kind: "face" | "hand" | "critical-object", x, y, width, height }],
  edgeMargins: { left, top, right, bottom, minimumRatio: 0.04 },
  typography: { fontPath, fontSha256, fallbackPath, fallbackSha256, fontSize, minFontSize, maxFontSize, lineSpacing, alignment, fill, outline, shadow },
  background: { path, sha256, qaPath, qaSha256 },
  textLayerSha256,
  finalPath,
  finalSha256
}
```

All geometry numbers are finite. Status enum is `pass|needs_review`, but `finalPath` and `finalSha256` are required only for `pass`; service publication rejects any other status. `lineHashes` are SHA-256 of each exact NFC UTF-8 line, not hashes of model-normalized text.

- [ ] **Step 4 (5 minutes): Implement normalized-to-pixel geometry and XML-safe exact strings.**

Create `scripts/lib/yadam/images/thumbnail-compositor.mjs`:

```js
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { writeBinaryAtomic, writeCanonicalJson } from "../../pipeline/atomic-store.mjs";
import { registerArtifact } from "../../pipeline/artifact-store.mjs";
import { validateSchema } from "../../pipeline/schema-registry.mjs";
import { verifyLockedFile } from "./model-lock.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const nfc = value => value.normalize("NFC");

export function rectsOverlap(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function normalizedRectToPixels(rect, canvas) {
  if (!Array.isArray(rect) || rect.length !== 4) throw Object.assign(new Error("normalized rectangle must contain four values"), { code: "thumbnail_rect_invalid" });
  const [normalizedX, normalizedY, normalizedWidth, normalizedHeight] = rect;
  for (const [key, value] of [["x", normalizedX], ["y", normalizedY], ["width", normalizedWidth], ["height", normalizedHeight]]) if (!Number.isFinite(value) || value < 0 || value > 1) throw Object.assign(new Error(`invalid ${key}`), { code: "thumbnail_rect_invalid" });
  if (normalizedWidth <= 0 || normalizedHeight <= 0 || normalizedX + normalizedWidth > 1 || normalizedY + normalizedHeight > 1) throw Object.assign(new Error("rectangle outside canvas"), { code: "thumbnail_rect_invalid" });
  const x = Math.floor(normalizedX * canvas.width);
  const y = Math.floor(normalizedY * canvas.height);
  const right = Math.ceil((normalizedX + normalizedWidth) * canvas.width);
  const bottom = Math.ceil((normalizedY + normalizedHeight) * canvas.height);
  return { x, y, width: right - x, height: bottom - y };
}

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function validateCopy(option, selection) {
  const lines = option.lines.map(nfc);
  if (selection.copyId !== option.copyId || nfc(selection.exactText) !== nfc(option.exactText) || nfc(option.exactText) !== lines.join("\n")) throw Object.assign(new Error("selected thumbnail copy changed"), { code: "thumbnail_copy_mismatch" });
  if (lines.length < 1 || lines.length > option.geometry.maxLineCount) throw Object.assign(new Error("thumbnail line count invalid"), { code: "thumbnail_line_count" });
  return lines;
}
```

Before raster work, require `option.layout` to be one of the three Plan 02 enums, `option.geometry.edgeMargin === 0.04`, the selection's stored thumbnail-plan hash to match the loaded plan hash, and every spoiler seal used by Plan 02 to remain absent from the copy.

- [ ] **Step 5 (5 minutes): Build a pinned-font SVG layer and binary-search the largest fitting size.**

Read and verify both font files using the exact model lock. Embed the bold and fallback font bytes as separate `data:font/ttf;base64` faces and use the fixed family list `YadamBold,YadamFallback`; no host-discovered third face is allowed. Build one `<text>` per approved line; do not wrap, shorten, translate, re-punctuate or reflow the strings. Reserve deterministic outline/shadow insets before positioning, then prove the actual rendered alpha bounds—not only nominal font metrics—stay inside the approved text rectangle. Export `buildTextSvg` and `renderedAlphaBounds` for byte-level tests:

```js
function effectInsets(outline, shadow) {
  const stroke = outline.width / 2;
  const blur = shadow.blur * 2;
  return {
    left: Math.ceil(stroke + blur + Math.max(0, -shadow.x)),
    right: Math.ceil(stroke + blur + Math.max(0, shadow.x)),
    top: Math.ceil(stroke + blur + Math.max(0, -shadow.y)),
    bottom: Math.ceil(stroke + blur + Math.max(0, shadow.y))
  };
}

export function buildTextSvg({ canvas, textRect, lines, fontBytes, fallbackBytes, fontSize, lineSpacing, alignment, fill, outline, shadow }) {
  const inset = effectInsets(outline, shadow);
  const inner = { x: textRect.x + inset.left, y: textRect.y + inset.top, width: textRect.width - inset.left - inset.right, height: textRect.height - inset.top - inset.bottom };
  if (inner.width <= 0 || inner.height <= 0) throw Object.assign(new Error("thumbnail effects consume text rectangle"), { code: "thumbnail_text_overflow" });
  const anchor = alignment === "right" ? "end" : alignment === "center" ? "middle" : "start";
  const x = alignment === "right" ? inner.x + inner.width : alignment === "center" ? inner.x + inner.width / 2 : inner.x;
  const lineHeight = fontSize * lineSpacing;
  const blockHeight = fontSize + lineHeight * (lines.length - 1);
  const startY = inner.y + (inner.height - blockHeight) / 2 + fontSize;
  const text = lines.map((line, index) => `<text x="${x}" y="${startY + index * lineHeight}" text-anchor="${anchor}" class="copy">${escapeXml(line)}</text>`).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}"><style>@font-face{font-family:YadamBold;src:url(data:font/ttf;base64,${fontBytes.toString("base64")})}@font-face{font-family:YadamFallback;src:url(data:font/ttf;base64,${fallbackBytes.toString("base64")})}.copy{font-family:YadamBold,YadamFallback;font-size:${fontSize}px;font-weight:700;fill:${fill};stroke:${outline.color};stroke-width:${outline.width}px;paint-order:stroke fill;filter:drop-shadow(${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.color})}</style>${text}</svg>`, "utf8");
}

export async function renderedAlphaBounds(svg) {
  const rendered = await sharp(svg, { failOn: "error", limitInputPixels: 2_000_000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = rendered.info;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (rendered.data[(y * width + x) * channels + channels - 1] === 0) continue;
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return right < left ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

const contains = (outer, inner) => inner && inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

async function largestFittingSize(input) {
  let low = input.minFontSize;
  let high = input.maxFontSize;
  let selected = null;
  while (low <= high) {
    const candidate = Math.floor((low + high) / 2);
    const svg = buildTextSvg({ ...input, fontSize: candidate });
    const bounds = await renderedAlphaBounds(svg);
    if (contains(input.textRect, bounds)) {
      selected = { fontSize: candidate, svg, bounds };
      low = candidate + 1;
    } else {
      high = candidate - 1;
    }
  }
  if (!selected) throw Object.assign(new Error("selected copy cannot fit"), { code: "thumbnail_text_overflow" });
  return selected;
}
```

The glyph smoke renders `가나다라마바사아자차카타파하힣ABC123` once with the bold face and once with the fallback face, requires nonzero per-glyph alpha bounds, and rejects any glyph whose alpha mask equals the known missing-glyph mask produced by an unassigned Unicode fixture. Compare the SVG's decoded text nodes with the NFC input lines before compositing; a missing, substituted or changed node is `thumbnail_glyph_or_copy_mismatch`. After choosing the size, render once more and require the returned alpha rectangle to be wholly contained by `pixelTextRect`; this final check includes outline, shadow and negative font bearings.

- [ ] **Step 6 (5 minutes): Implement protected-area, edge-margin and background-QA gates.**

Convert `option.geometry.textRect:[x,y,width,height]` and each `option.geometry.protectedRects[]` row shaped `{id,kind,rect:[x,y,width,height]}` with `normalizedRectToPixels`. Reject duplicate protected IDs, an unknown kind, or a rectangle outside the canvas before rendering. Require:

```js
const minimumX = Math.ceil(1280 * 0.04);
const minimumY = Math.ceil(720 * 0.04);
const margins = {
  left: textRect.x,
  top: textRect.y,
  right: 1280 - (textRect.x + textRect.width),
  bottom: 720 - (textRect.y + textRect.height)
};
if (margins.left < minimumX || margins.right < minimumX || margins.top < minimumY || margins.bottom < minimumY) throw Object.assign(new Error("thumbnail edge margin below four percent"), { code: "thumbnail_edge_margin" });
for (const protectedRect of protectedRects) if (rectsOverlap(textRect, protectedRect)) throw Object.assign(new Error(`text overlaps ${protectedRect.id}`), { code: "thumbnail_protected_overlap", protectedRectId: protectedRect.id });
```

Require background QA status `pass`, `readableText:false`, `reservedTextRectClear:true`, `faceInTextRect:false`, `criticalObjectInTextRect:false`, and `subjectPlacementMatch:true`. Any mismatch returns `thumbnail_background_qa_failed`; it does not invoke the compositor.

- [ ] **Step 7 (5 minutes): Composite final, guide and canonical QA artifacts.**

Verify the background decodes as PNG 1280×720, copy it atomically to `thumbnail/background.png`, composite the SVG with `sharp(background).composite([{input:svg}]).png({compressionLevel:9,adaptiveFiltering:false,palette:false})`, and write every PNG with Plan 01 `writeBinaryAtomic`. Render `previews/thumbnail-reserved-guide.png` from the same background with a translucent text rectangle and labeled protected rectangles; this guide is review-only and never becomes the upload thumbnail. Derive `guideDependencyHash = hashCanonical({backgroundHash,thumbnailSelectionHash,geometryHash,compositorVersionHash})`, re-read the guide bytes, and require deterministic same-input `guideHash`.

Write `thumbnail/qa.json` last, re-read the final PNG, verify dimensions/hash and the exact line hashes, then register:

```js
await registerArtifact(jobDir, { artifactId: "thumbnail-background", logicalRole: "yadam.thumbnail.background", path: "thumbnail/background.png", sha256: backgroundHash, schemaVersion: "1.0.0", producerStage: stage, gateStatus: "pass", dependencyHashes: backgroundDependencies });
await registerArtifact(jobDir, { artifactId: "thumbnail-final", logicalRole: "yadam.thumbnail.final", path: "thumbnail/final.png", sha256: finalHash, schemaVersion: "1.0.0", producerStage: stage, gateStatus: "pass", dependencyHashes: { background: backgroundHash, selection: selection.sha256, font: fontLock.bold.sha256, compositor: compositorVersionHash } });
await registerArtifact(jobDir, { artifactId: "thumbnail-qa", logicalRole: "yadam.thumbnail.qa", path: "thumbnail/qa.json", sha256: qaHash, schemaVersion: "1.0.0", producerStage: stage, gateStatus: "pass", dependencyHashes: { thumbnail: finalHash, backgroundQa: backgroundQa.sha256 } });
await registerArtifact(jobDir, { artifactId: "thumbnail-reserved-guide", logicalRole: "yadam.thumbnail.guide", path: "previews/thumbnail-reserved-guide.png", sha256: guideHash, schemaVersion: "1.0.0", producerStage: stage, gateStatus: "pass", dependencyHashes: { background: backgroundHash, selection: selection.sha256, geometry: geometryHash, compositor: compositorVersionHash } });
```

If the user selects a different copy whose layout, normalized text rectangle, background request hash and protected-area contract are unchanged, reuse the passed background and rerun only composition/QA. If any of those four inputs changes, invalidate the background and run the single allowed background repair path.

- [ ] **Step 8 (4 minutes): Run compositor and schema tests.**

Run: `node --test test/yadam/thumbnail.test.mjs`

Expected: exact Korean copy, glyph smoke, binary search, four-percent margins, one-pixel overlap, background critic gates, deterministic same-input hash and copy-only recomposition tests pass.

- [ ] **Step 9 (2 minutes): Commit deterministic thumbnail composition.**

```bash
git add schemas/yadam/thumbnail-qa.schema.json scripts/lib/yadam/images/thumbnail-compositor.mjs test/yadam/thumbnail.test.mjs
git commit -m "feat: compose exact Korean yadam thumbnails"
```

### Task 12: Assemble the image-service facade, approval previews, production batches and strict Plan 05 handoff

**Files:**
- Create: `schemas/yadam/preview-manifest.schema.json`
- Create: `scripts/lib/yadam/image-service.mjs`
- Modify: `test/yadam/image-service.test.mjs`
- Modify: `test/yadam/image-qa.test.mjs`

**Interfaces:**
- Consumes before approval 2: passed registry records for story bible, scene plan, thumbnail plan and provisional thumbnail selection; this phase cannot call `getApprovedVisualPlanningInput` because approval 2 does not exist yet.
- Consumes after approval 2: Plan 02 `getApprovedVisualPlanningInput(jobDir)`, Plan 03 `loadPassedAudioHandoff(jobDir)`, current approved reference pointer, host preflight and every Task 3–11 internal service.
- Produces exactly the five public exports declared at the top of this plan; no provider client or mutable checkpoint leaks through the facade.

- [ ] **Step 1 (5 minutes): Write failing pre-approval preview contract tests.**

Seed a temp job with registered `gateStatus:"pass"` records for `yadam.story.bible`, `yadam.scene.plan`, `yadam.thumbnail.plan`, `yadam.thumbnail.selection` and the current profile. Inject fake generation/QA dependencies and call `buildApproval2Previews`. Assert its `previewArtifacts` is exactly:

```js
{
  thumbnailPreview: { artifactId, relativePath, sha256 },
  thumbnailGuide: { artifactId: "thumbnail-reserved-guide", relativePath: "previews/thumbnail-reserved-guide.png", sha256: guideHash, dependencyHash: guideDependencyHash },
  characterReferenceSet: { artifactId: "character-reference-set-current", relativePath, sha256 },
  representativePreviews: [
    { role: "intro", artifactId, relativePath, sha256 },
    { role: "body", artifactId, relativePath, sha256 },
    { role: "climax", artifactId, relativePath, sha256 }
  ],
  styleProfile: { artifactId, relativePath, sha256 }
}
```

Assert keys are neither missing nor added, representative roles are in the listed order, registry records use `path` and `gateStatus:"pass"`, public rows expose `relativePath`, all files stay under the job, and `buildApprovalTwoBundle({jobDir,previewArtifacts:result.previewArtifacts})` accepts the shape. Assert the service records exactly one `approval_2_previews` start and one `APPROVAL_TWO_PREVIEWS_READY` success for the exact input projection; a same-input second call strictly reloads the passed manifest and records neither again. Repeat with each input/artifact gate status set to `warning`, `pending`, `fail`, or `invalidated`; generation and state mutation must not begin.

- [ ] **Step 2 (5 minutes): Write failing production lock-order and handoff tests.**

Inject call-recording ComfyUI, critic, resource lock and stores. For an all-pass fixture assert this order:

```text
preflight
lock:gpu:comfy
comfy:all-missing-rasters-in-visual-order
comfy:free
unlock:gpu:comfy
lock:gpu:ollama
ollama:all-new-rasters-in-visual-order
ollama:unload
unlock:gpu:ollama
thumbnail:compose
qa:aggregate
manifest:publish
coverage:visual
handoff:verify
```

For one repairable failure, assert one additional Comfy batch followed by one additional Ollama batch and no third generation. Assert no Ollama call occurs while the Comfy lease is held and no Comfy call occurs while the Ollama lease is held. Provider unavailable, critic parse error, second QA failure, cancellation and non-pass registry input must transition to `needs_review` or `cancelled`, publish no passed manifest, and submit no later asset.

- [ ] **Step 3 (2 minutes): Run and confirm the facade/schema are missing.**

Run: `node --test test/yadam/image-service.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `image-service.mjs` or missing `preview-manifest.schema.json`.

- [ ] **Step 4 (5 minutes): Create the exact preview manifest and scoped dependency contract.**

Create `schemas/yadam/preview-manifest.schema.json` with a closed root:

```js
{
  schemaVersion: "1.0.0",
  jobId,
  createdAt,
  inputs: {
    storyBible: { relativePath, sha256, schemaVersion, schemaHash },
    scenePlan: { relativePath, sha256, schemaVersion, schemaHash },
    thumbnailPlan: { relativePath, sha256, schemaVersion, schemaHash },
    thumbnailSelection: { relativePath, sha256, copyId }
  },
  characterReferenceSet: { artifactId: "character-reference-set-current", relativePath, sha256, status: "provisional", dependencyHash },
  styleProfile: { artifactId, relativePath, sha256, dependencyHash },
  representativePreviews: [{ role: "intro" | "body" | "climax", artifactId, visualSlotId, sourceSceneIds, sourceSceneHashes, relativePath, sha256, qaPath, qaSha256, dependencyHash }],
  thumbnailPreview: { artifactId, relativePath, sha256, qaPath, qaSha256, dependencyHash },
  thumbnailGuide: { artifactId: "thumbnail-reserved-guide", relativePath: "previews/thumbnail-reserved-guide.png", sha256, dependencyHash },
  refreshEvidence: null | {
    refreshInputHash,
    repairReportHash,
    priorPreviewManifestPath,
    priorPreviewManifestHash,
    priorScenePlanHash,
    repairedScenePlanHash,
    requestedChangedSceneIds,
    changedSceneProjectionHash,
    referenceSetHash,
    styleProfileHash,
    profileHash,
    modelLockHash,
    referenceWorkflowHash,
    conditionedWorkflowHash,
    compilerVersionHash,
    imageQaPolicyHash,
    thumbnailCompositorPolicyHash,
    comfyProviderContractHash,
    affectedRoles,
    unaffectedRoles,
    refreshedAt
  }
}
```

Require three unique representative roles and visual slots, stable sorted source-scene IDs, unique IDs, valid hashes, `thumbnailPreview` bound to selection/layout/background/font/compositor hashes, and `thumbnailGuide` bound to the registered stable guide record plus background/selection/geometry/compositor projection. Compute each representative `dependencyHash` with `hashCanonical` over this exact projection:

When `refreshEvidence` is non-null, require every `*Hash` field above to be lowercase SHA-256, require its key set to be exact, and require `priorPreviewManifestPath === "previews/preview-manifest-prior-<priorPreviewManifestHash>.json"`; the schema pattern is `^previews/preview-manifest-prior-[0-9a-f]{64}\.json$`. Recompute `refreshInputHash` from exactly the identity fields in Step 7 rather than trusting the stored value. A missing policy/workflow/provider identity, an extra field, a nested preview-history path, another hash suffix, an absolute path or a backslash path is invalid.

```js
{
  role,
  visualSlotId,
  scenePlanSchemaHash,
  scopedScenePlanHash: hashCanonical({ visualSlot, sourceScenes }),
  sourceSceneHashes,
  characterReferenceSetHash,
  styleProfileHash,
  workflowHash,
  checkpointHash,
  ipAdapterHash,
  seed,
  compilerVersion
}
```

This binds the approved scene-plan schema and the exact source-scene projection without making an unrelated changed scene invalidate all three previews. The manifest root still records the current full scene-plan artifact hash.

- [ ] **Step 5 (5 minutes): Implement pass-only pre-approval artifact resolution and deterministic representative selection.**

In `scripts/lib/yadam/image-service.mjs`, use `loadJob(jobDir)` and the job's canonical `artifact-manifest.json`; never invent a second artifact registry API. A helper resolves a logical role by requiring one current record, `gateStatus === "pass"`, a job-contained `record.path`, matching bytes/hash and required schema version/hash, then maps it to public `relativePath:record.path`.

Plan 01 creates the common parent layout, including `previews`, but no history child below it. Add `ensureImageJobLayout(jobDir)`, which first applies Plan 01 path containment to and then `mkdir({recursive:true})` only these declared Plan 04-owned subdirectories: `assets/character-references`, `assets/compiled-image-requests`, `assets/images/checkpoints`, `assets/images/qa`, and `quarantine/images`. It separately resolves and real-path verifies the existing Plan 01-owned `previews` parent before any preview write; it does not create another preview subdirectory. Call it before any preview or production write. Tests start with a pristine Plan 01 job, assert `previews` already exists, compare the exact added directory set above, and prove neither an undeclared history child nor any other undeclared top-level/job directory is created; lower-level modules never assume Plan 04-owned subdirectories already exist.

Add one whole-operation mutex using Task 7's proven lease primitive:

```js
async function withImageMutationLock({ jobDir, ownerStage, signal }, fn) {
  const job = await loadJob(jobDir);
  const resource = `yadam-image-${job.jobId}`;
  const lockPath = join(job.workspaceRoot, "exports", ".locks", `${resource}.lock`);
  return withResourceLock({ workspaceRoot: job.workspaceRoot, lockPath, resource, ownerJobId: job.jobId, ownerStage, signal, staleAfterMs: 300000 }, async () => {
    const reloaded = await loadJob(jobDir);
    if (reloaded.jobId !== job.jobId) throw Object.assign(new Error("job changed while acquiring image lock"), { code: "image_job_changed" });
    return fn(reloaded);
  });
}
```

The four mutating facade calls `buildApproval2Previews`, `refreshApproval2Previews`, `promoteApprovedReferenceSet`, and `generateProductionImages` are thin wrappers that hold this same-job lock across their complete internal operation. The lock is always acquired before the GPU lock; no code acquires them in reverse order. The read-only loader/status path and cancellation adapter do not take it—cancellation must be able to set `cancel_requested` and target this job's live prompt while generation is running. Test two concurrent same-job preview calls and two concurrent preview/production calls: one owns the mutation lock, the other returns `resource_locked`, and only one state start/provider submission occurs.

Choose representatives deterministically from the Plan 02 scene plan:

- `intro`: the lowest visual order with purpose `intro`.
- `climax`: the highest visual order whose evidence IDs contain `finale-04` or `beat-14`; reject a scene plan without either climax marker.
- `body`: the non-intro, non-climax slot whose midpoint is nearest half the planned duration; break a tie by lower visual order.

Reject duplicate chosen slots. Record selection algorithm `yadam-representatives-v1` in `previews/style-profile.json`, along with the exact style clauses, negative clauses, compiler version, workflow hashes, model hashes and profile hash. Register the style profile with `path:"previews/style-profile.json"`, not an absolute path.

- [ ] **Step 6 (5 minutes): Implement provisional references and approval-ready preview publication.**

`buildApproval2Previews({jobDir,signal})` performs this exact transaction boundary:

1. Resolve and validate the four pre-approval Plan 02 artifacts and selected copy.
2. Preflight the locked image host; `ready:false` stops before state/provider mutation.
3. Compute `previewInputHash = hashCanonical({storyBibleHash,scenePlanHash,thumbnailPlanHash,thumbnailSelectionHash,profileHash,modelLockHash,referenceWorkflowHash,conditionedWorkflowHash,compilerVersionHash,imageQaPolicyHash,thumbnailCompositorPolicyHash,comfyProviderContractHash})` and collect all `APPROVAL_TWO_PREVIEWS_READY` rows with that same input. More than one row, or one row with nonexact paths, is `success_evidence_conflict`. If exactly one row has `artifactPaths:["previews/preview-manifest.json"]`, strictly reload/re-hash the passed preview manifest and all four named policy/provider dependencies, require its hash equals that row's `outputHash`, call `appendSubsystemSuccessOnce` to enforce the same cardinality/reuse rule, and only then return it. With zero rows, reject a currently valid/passed `yadam.approval.2` with `approval2_already_granted`; the preview path can never demote a reference pointer while its approval is current. If Plan 02 has explicitly invalidated the old approval because current plan/selection evidence changed, the service may re-provision the same immutable set by rewriting only the mutable pointer, with that invalidation/current-selection hash in its dependencies. Load the current selection file and collect all rows with `{stage:"THUMBNAIL_COPY_SELECTED",inputHash:hashCanonical({thumbnailPlanHash,copyId,selectedAt})}`; require exactly one whose output/path equal `{outputHash:thumbnailSelectionHash,artifactPaths:["approvals/thumbnail-copy-selection.json"]}`. Zero is missing selection evidence and any other cardinality/value is `success_evidence_conflict`; either fails before state/provider mutation. Then call `transitionJob({stage:"approval_2_previews",to:"running",inputHash:previewInputHash})`. Duration-repair rebuild uses only the separate stage-guarded refresh API.
4. Compile/generate each 768×1024 primary with the unconditioned workflow and at most one half-side derived candidate with the conditioned workflow bound directly to that primary. After validating safe character/variant IDs, write them only to `assets/character-references/<characterId>/<variantId>/primary.png` and `half-side.png`. Build asset IDs deterministically from character/variant/derived ID and use Task 4 `deriveImageSeed({jobSeed,assetId})`; no second seed formula is allowed. Introduce internal `persistCompiledRequest` here using Step 9's immutable-path/stable-artifact-ID contract, persist each request, QA every image, and register each passed raster before the set under stable IDs `character-reference-<characterId>-<variantId>-primary|half-side`, collection role `yadam.character.reference-image`, with compiled request/workflow/model/direct-primary dependencies. Then call `writeProvisionalReferenceSet` with the job's injected stage timestamp and exact `storyBibleHash`, character/variant `semanticHash`, `referenceWorkflowHash`, `conditionedWorkflowHash`, `checkpointHash`, `clipVisionHash`, and `ipAdapterHash` dependencies. This ordering lets Plan 01 classify primary/derived/compiled hashes as artifact-owned rather than opaque.
5. Compile the intro/body/climax requests against that provisional set; all focal scenes point directly to a primary/variant reference, never another preview.
6. Generate all missing preview rasters under one Comfy GPU lease, call `/free`, release it, QA them under one Ollama GPU lease, call unload, release it, then run one failed-axis repair cycle using the same two-phase ordering.
7. Generate/QA the 1280×720 text-free thumbnail background and call `composeThumbnail`; copy the byte-identical composed result to `previews/thumbnail-preview.png` with an atomic binary write.
8. Register every passed asset and `previews/preview-manifest.json` only after re-reading bytes/hashes. Require the manifest's `thumbnailGuide` to equal the current passed `yadam.thumbnail.guide` record. Register the manifest as artifact ID `preview-manifest`, logical role `yadam.preview.manifest`, registry `path:"previews/preview-manifest.json"`, `gateStatus:"pass"`, with dependencies on story bible, scene plan, thumbnail plan/selection, reference set, style profile, all three representative preview hashes, thumbnail-preview hash and guide hash. Re-read the registered file and call `appendSubsystemSuccessOnce({jobDir,event:"APPROVAL_TWO_PREVIEWS_READY",inputHash:previewInputHash,outputHash:previewManifestHash,artifactPaths:["previews/preview-manifest.json"]})`; Plan 06 verifies this exact evidence and never emits a duplicate. Any needs-review result leaves the provisional pointer intact for inspection but registers no approval-eligible preview manifest/event and transitions the owned start to `needs_review` with the same input hash.

The return object is:

```js
return {
  previewManifestPath: "previews/preview-manifest.json",
  previewManifestHash: manifest.sha256,
  characterReferenceSetHash: referenceSet.referenceSetHash,
  representativePreviewSetHash: hashCanonical(previewArtifacts.representativePreviews.map(({ role, artifactId, sha256 }) => ({ role, artifactId, sha256 }))),
  thumbnailPreviewPath: "previews/thumbnail-preview.png",
  previewArtifacts
};
```

All seven flattened Plan 02 approval preview assets—the reference set, style profile, three representatives, thumbnail preview and registered guide—have registry `gateStatus:"pass"`; per-asset QA and checkpoints remain supporting artifacts and are not substituted for an approved asset.

- [ ] **Step 7 (5 minutes): Implement exact changed-set preview refresh for duration repair.**

`refreshApproval2Previews({jobDir,changedSceneIds,signal})` first loads `pipeline-state.json` and requires exact stage `REBUILDING_APPROVAL_2_BUNDLE`; every other stage fails with `duration_preview_refresh_wrong_stage` before provider work and this function does not invent or transition to another stage. It rejects duplicates, unknown scene IDs, unsorted side effects and an empty array. It loads the registered current Plan 02 duration-repair report, current preview manifest, its prior scene-plan dependency, the repaired scene plan and exact changed scene source hashes. Before computing identity, branch on the parsed current manifest: when `refreshEvidence === null`, set `priorPreviewManifestHash` to the verified current file SHA; when refresh evidence exists, first require its repair-report hash, requested changed IDs and changed-scene projection match the current authorization, then set `priorPreviewManifestHash` from that evidence and verify it against the retained prior manifest record/hash plus its old scene-plan dependency. A mismatched existing evidence fails before identity/provider work. Only after this branch compute exactly:

```js
const changedScenes = changedSceneIds.map(sceneId => ({ sceneId, sourceHash: changedSceneHashById[sceneId] }));
const changedSceneProjectionHash = hashCanonical({ changedScenes });
const refreshInputHash = hashCanonical({
  stage: "duration_preview_refresh",
  repairReportHash,
  priorPreviewManifestHash,
  priorScenePlanHash,
  repairedScenePlanHash,
  changedSceneProjectionHash,
  referenceSetHash,
  styleProfileHash,
  profileHash,
  modelLockHash,
  referenceWorkflowHash,
  conditionedWorkflowHash,
  compilerVersionHash,
  imageQaPolicyHash,
  thumbnailCompositorPolicyHash,
  comfyProviderContractHash,
});
```

Require `changedSceneIds` in canonical scene ordinal order; `changedSceneHashById` must have exactly those keys and each value must be lowercase SHA-256. Thus `changedScenes` is an ordered closed array with no extra/missing scene and Plan 03/06 use the same key and order. All hashes come from re-read current/pass records or the verified prior manifest dependency; missing/extra keys are rejected, and Plan 06 recomputes this identical formula when handling a typed scope error. The current refreshed manifest's result hash must never be substituted into its own input identity. Add an explicit H0→H1→retry fixture proving both calls derive the same `refreshInputHash`, preserve the original timestamp/bytes and make zero second provider calls. Mutate each workflow and each policy pin independently and require a changed identity. Determine affected representatives by intersecting each representative row's `sourceSceneIds` with the exact sorted changed set and by comparing its scoped scene-plan/source-scene dependency projection. Walk each affected representative's compiled-request, raster and QA dependency subtree and refresh every record in that subtree whose closure hits a changed source hash before returning; do not sweep unrelated production-image records.

The locked duration-repair API can return only representative roles, so its scope is explicit: reference-set dependencies contain character/variant semantic hashes, reference compiled requests, workflows and model hashes but no full scene-plan or narration-scene hash; style-profile dependencies contain only the style/profile/workflow/model projection; thumbnail-preview dependencies contain only the selected thumbnail-plan/copy projection, reference-set hash, workflow/model hashes and its own compiled request; thumbnail-guide dependencies contain only background, selection, geometry and compositor hashes. Before any provider or manifest mutation, require all four non-representative top-level closures to be disjoint from the authorized changed source hashes. A hit is the fail-closed typed error `{code:"duration_refresh_scope_expanded",stage:"duration_preview_refresh",inputHash:refreshInputHash}`: transition the owned duration-repair stage to `needs_review`, perform zero provider/artifact mutation, and throw without a fabricated `reportPath`. Plan 06 is the sole owner that verifies the same formula and converts this pre-report error into a durable outcome through its exact `writeOutcomeReport` contract. Neither Plan 02 nor Plan 06 calls normal `buildApproval2Previews` from `REBUILDING_APPROVAL_2_BUNDLE`; same-job automatic recovery is forbidden because that public method rejects this state and there is no expanded-refresh API. Recovery is an operator-reviewed new job (or a later separately designed expanded workflow).

On the successful narrow path, before replacing the fixed current manifest, require H0 is lowercase SHA-256, resolve `priorPreviewManifestPath = "previews/preview-manifest-prior-<H0>.json"`, lexically contain the target under `jobDir`, and real-path contain its existing `previews` parent before writing. Exclusively preserve the verified canonical H0 bytes at that exact target with `writeCanonicalJsonExclusive`; never create or address a history subdirectory. Register one immutable collection record with artifact ID `preview-manifest-prior-<H0>`, role `yadam.preview.manifest.prior`, that exact path/hash/schema, `gateStatus:"pass"`, and the original dependency map. Exact reuse is allowed only after target bytes and the one exact record are re-read; a different existing byte/record is `duration_refresh_evidence_conflict`. Then re-hash/reuse the four non-representative assets, generate affected representatives through the same Comfy-free/Ollama-unload sequence, atomically replace the current preview manifest with unchanged non-representative hashes plus refreshed representative rows, and record that exact `priorPreviewManifestPath`, `refreshInputHash`, all fifteen non-self hash identity fields from the formula (`repairReportHash` through `comfyProviderContractHash`, excluding only the derived `refreshInputHash` itself), the requested changed IDs/projection, `affectedRoles`, `unaffectedRoles` and the persisted repair-stage timestamp as `refreshedAt`. Retry recomputes the closed formula from those stored fields, verifies H0 through its immutable record and bytes, and only then accepts H1 evidence. The pristine-layout fixture asserts the prior file is the only new direct child required under `previews`, no undeclared history child appears, a symlink/junction `previews` parent is rejected before a write, and a wrong hash suffix/path conflicts. Return only affected representative rows, sorted `intro`, `body`, `climax`, in the public locked shape:

```js
return refreshed.map(item => ({
  role: item.role,
  artifactId: item.artifactId,
  relativePath: item.relativePath,
  sha256: item.sha256,
  dependencyHash: item.dependencyHash
}));
```

Each returned `dependencyHash` includes that exact `changedSceneProjectionHash`. Before any new provider call, if the current passed preview manifest has `refreshEvidence.refreshInputHash === refreshInputHash`, re-read every manifest/supporting record, require every stored identity field and affected/unaffected row still matches, and return the existing rows with zero write/provider/state change while preserving its original `refreshedAt` and bytes. A same-input partial checkpoint resumes only its missing scoped subtree and reuses the repair-stage timestamp; a current manifest/checkpoint claiming the same repair report or changed set with conflicting identity is `duration_refresh_evidence_conflict` and mutates nothing. Tests cover crash after refresh but before bundle rebuild, exact repeat, partial scoped resume, and conflict. They also prove any stage other than `REBUILDING_APPROVAL_2_BUNDLE` makes zero provider calls, a changed unrepresented scene returns `[]` but still writes exact refresh evidence, an intro-only change refreshes only intro plus its supporting subtree, and a synthetic reference/style/thumbnail-guide closure hit throws the exact no-report typed error before provider/artifact mutation or normal-preview invocation. The Plan 06 integration test recomputes `refreshInputHash`, creates/re-reads one orchestrator outcome report and returns its real path. Unchanged non-representative paths and hashes remain byte-identical in the successful rewritten manifest, and passing a strict subset/superset of the authorized changed set fails before provider work. Callers may invoke `rebuildApproval2AfterDurationRepair({jobDir,changedSceneIds,signal})` only after this function succeeds and every affected representative/supporting registry record is current and pass; that Plan 02 call re-reads the manifest, proves the four reused non-representative records remain current/pass, and owns the transition to `AWAITING_APPROVAL_2`.

- [ ] **Step 8 (5 minutes): Expose single-owner approval-bound promotion and verify the already-approved pointer in production.**

The facade export wraps the internal reference store to prevent an arbitrary revision path from promoting pixels:

```js
import { getApprovedVisualPlanningInput, updateCoverageSection } from "./script-service.mjs";
import { loadPassedAudioHandoff } from "./tts-service.mjs";
import { promoteApprovedReferenceSet as promoteReferencePointer } from "./images/reference-store.mjs";
import { loadReferencePointer } from "./images/reference-store.mjs";
import { loadJob } from "../pipeline/job-store.mjs";
import { transitionJob } from "../pipeline/state-machine.mjs";
import { hashCanonical } from "../pipeline/canonical-json.mjs";

export async function promoteApprovedReferenceSet({ jobDir, approvalRevisionPath }) {
  const planning = await getApprovedVisualPlanningInput(jobDir);
  if (planning.approvalRevisionPath !== approvalRevisionPath) throw Object.assign(new Error("approval revision is not current"), { code: "approval2_not_valid" });
  const job = await loadJob(jobDir);
  const approvalRecord = await resolvePassedArtifactByRole(job, "yadam.approval.2");
  if (approvalRecord.path !== approvalRevisionPath) throw Object.assign(new Error("approval registry is not current"), { code: "approval2_not_valid" });
  const before = await loadReferencePointer(jobDir);
  const inputHash = hashCanonical({ approvalRevisionPath, approvalRevisionHash: approvalRecord.sha256, approvedArtifactSetHash: planning.approvedArtifactSetHash, referenceSetHash: before.referenceSetHash });
  const promotionPaths = ["assets/character-references/current-reference-set.json"];
  const priorSuccessRows = job.state.history.filter(item => item.stage === "REFERENCE_SET_PROMOTED" && item.inputHash === inputHash);
  if (priorSuccessRows.length > 1) throw Object.assign(new Error("conflicting reference promotion evidence"), { code: "success_evidence_conflict" });
  if (priorSuccessRows.length === 1) {
    const [priorSuccess] = priorSuccessRows;
    if (JSON.stringify(priorSuccess.artifactPaths) !== JSON.stringify(promotionPaths)) throw Object.assign(new Error("conflicting reference promotion paths"), { code: "success_evidence_conflict" });
    return verifyAndProjectApprovedPointer({ jobDir, approvalRevisionPath, referenceSetHash: before.referenceSetHash, expectedPointerHash: priorSuccess.outputHash });
  }
  const expectedGrantPaths = [approvalRevisionPath, "approvals/current-approval-2.json"].sort();
  const grantRows = job.state.history.filter(item => item.stage === "APPROVAL_TWO_GRANTED" && item.inputHash === planning.approvedArtifactSetHash);
  if (grantRows.length === 0) throw Object.assign(new Error("approval two grant event is absent"), { code: "approval2_not_granted" });
  if (grantRows.length !== 1 || grantRows[0].outputHash !== approvalRecord.sha256 || JSON.stringify(grantRows[0].artifactPaths) !== JSON.stringify(expectedGrantPaths)) throw Object.assign(new Error("conflicting approval two grant evidence"), { code: "success_evidence_conflict" });
  await transitionJob(jobDir, { stage: "reference_promotion", to: "running", inputHash, note: "begin approval-bound reference promotion" });
  try {
    const result = await promoteReferencePointer({ jobDir, approvalRevisionPath });
    const verified = await loadReferencePointer(jobDir);
    if (verified.status !== "approved" || verified.referenceSetHash !== result.referenceSetHash || verified.approvalRevisionPath !== approvalRevisionPath) throw Object.assign(new Error("promoted pointer verification failed"), { code: "reference_promotion_verify_failed" });
    await appendSubsystemSuccessOnce({ jobDir, event: "REFERENCE_SET_PROMOTED", inputHash, outputHash: result.pointerHash, artifactPaths: promotionPaths });
    return { referenceSetPath: result.referenceSetPath, referenceSetHash: result.referenceSetHash, status: "approved", approvalRevisionPath };
  } catch (error) {
    await transitionJob(jobDir, { stage: "reference_promotion", to: "retrying", inputHash, error: { code: error.code ?? "reference_promotion_failed", message: error.message } });
    throw error;
  }
}
```

`resolvePassedArtifactByRole` is the Step 5 singleton resolver. `verifyAndProjectApprovedPointer` re-reads the pointer, immutable set, approval revision and their registry records/hashes/schemas, requires the actual pointer hash equals `expectedPointerHash`, then returns the exact four-field public DTO. A prior success row is reusable only after that complete verification; an event alone is never enough.

`appendSubsystemSuccessOnce` uses only Plan 01 `transitionJob`: normalize/sort the caller's contained job-relative paths, then collect every history row with the same `{stage:event,inputHash}`. There are exactly three legal outcomes: zero rows means call `transitionJob(jobDir,{stage:event,to:"running",inputHash,outputHash,artifactPaths})`, then re-read all same-stage/input rows and require total cardinality one with exact output/paths; exactly one row whose `outputHash` and normalized `artifactPaths` are exact means re-verify every listed artifact path/hash and reuse it; any other cardinality or any same-input row with different output/path evidence throws `success_evidence_conflict` and appends nothing further. Plan 01 repeats the same zero/exact/conflict test while holding its state lock, so two callers that both observed zero cannot append two rows; this helper's precheck is an early diagnostic, not the concurrency authority. An exact row plus an additional conflicting/duplicate row is also conflict. Missing, extra, unsorted-after-normalization, stale or different paths can never authorize reuse. `outputHash` is the allowed Plan 01 evidence field; there is no invented `event` or `stageId` field because the success-event name is stored in `stage`. Run the same zero-row append, exact-row reuse, same-input wrong-output, same-input wrong/missing/extra-path, duplicate-row and exact-plus-conflict fixtures independently for `APPROVAL_TWO_PREVIEWS_READY`, `REFERENCE_SET_PROMOTED`, and `IMAGES_PASSED`. Every conflict fixture must prove zero provider call, zero artifact/pointer mutation, zero new transition and no duplicate success row; concurrent zero-row calls must leave exactly one row per `{stage,inputHash}` when evidence is identical, or one winner and one `success_evidence_conflict` when it differs.

The promotion start precondition is not merely the presence of an old grant event. Plan 02's current grant evidence is exactly `{stage:"APPROVAL_TWO_GRANTED",inputHash:currentApproval.approvedArtifactSetHash,outputHash:sha256(current immutable approval revision),artifactPaths:[current approvalRevisionPath,"approvals/current-approval-2.json"].sort()}`. The public method already revalidates the pointer/revision/registry closure through `getApprovedVisualPlanningInput`; it must then match all four event fields against that current revision. A stale r001 grant cannot authorize current r002 promotion. The method itself records the `reference_promotion` start before mutation and `REFERENCE_SET_PROMOTED` after strict verification. On a caught mutation/verification failure it records `reference_promotion` to `retrying` with the same input hash and structured error, preserving the valid approval for resume.

Only Plan 06's `reference_promotion` stage calls this mutation export, once, before TTS; the orchestrator does not pre-enter the stage or append success. Add tests for missing grant (zero transition/mutation), stale r001 grant with current r002, wrong grant input hash, wrong output hash, missing/extra/wrong artifact path, start then success, start then retrying on failure, and already-approved/same-input idempotency: the second call re-reads all hashes, returns the same result and finds the existing success row without rewriting the pointer or appending a duplicate. A caller path/hash that differs from the Plan 02 current approval creates neither an event nor pointer mutation. A genuinely new current r002 with exact grant evidence may rebind an already-approved same set from r001 to r002; it writes a new pointer revision/event but never changes reference-set or pixel bytes. Production never calls promotion again: it loads `current-reference-set.json`, requires `status:"approved"`, exact current `approvalRevisionPath`/hash, reference-set hash/bytes/schema, pass registry pointer/set records and dependency closure; absence or provisional status throws `reference_set_not_approved` before host/provider work.

Production calls the Plan 02 getter first and independently verifies every underlying registry record has `gateStatus:"pass"` and registry field `path` matching its public `relativePath`. It then calls `loadPassedAudioHandoff(jobDir)` and uses the exact field names at the top of this plan. Verify `audioTempoFactor===1`, measured duration lies within `acceptedRangeSeconds`, scenes/segments/slots are sorted and continuous, and every slot's source scene exists with the same source hash.

- [ ] **Step 9 (5 minutes): Implement compiled production planning and preview-safe reuse.**

Compile one request for every Plan 03 visual slot into `slotRequests` and separately compile one `thumbnailBackgroundRequest`. Reuse Step 6 `persistCompiledRequest`: it validates each request, computes `requestFileHash` over the exact UTF-8 `canonicalJson(request)` bytes followed by one LF, writes immutable `assets/compiled-image-requests/<assetId>-<requestFileHash>.json` with `writeCanonicalJsonExclusive`, requires the returned SHA to equal the suffix, and when the same path already exists reuses only after exact canonical bytes/hash verification. It returns `{artifactId:"compiled-image-request-<assetId>",relativePath,sha256:requestFileHash,value}` and registers that current revision under the same stable artifact ID, collection role `yadam.image.compiled-request`, passed gate, and dependency hashes for source-scene projection, workflow/checkpoint/CLIP Vision/IP-Adapter, reference image (when any), style/compiler/schema and thumbnail selection/layout (for the background). `requestFileHash` binds authorization/audit fields; `value.idempotencyKey` is the distinct pixel/provider key. Thus preview and production requests with equal pixel keys but different mode/approval fields occupy different immutable paths. A changed request moves the stable record to a new immutable content-addressed path and leaves the prior record in Plan 01 `revisionHistory`.

Persist into `persistedSlotRequests` and `persistedThumbnailRequest`, then call `publishRenderPlan({jobDir,audioHandoff,compiledRequests:persistedSlotRequests,profile,visualPlanning})`, producing canonical `render-plan.json` whose visual slots attach the stable registry `compiledRequestId` and canonical file `compiledRequestHash` without renaming any Plan 03 field. Never pass the thumbnail request into that visual-slot bijection—it would correctly fail as an orphan. Bind the separately registered thumbnail request file hash through the thumbnail-background asset row, aggregate QA, final-thumbnail dependencies and image asset manifest. Tests assert every render-plan/manifest `compiledRequestId/path/hash` resolves to its current passed registry record and exact bytes; no field may substitute `value.idempotencyKey` for that file SHA.

Reuse an approval preview raster as a production slot only when all pixel-affecting evidence matches: compiled `idempotencyKey` (not the mode/status-sensitive request file hash), workflow hash, checkpoint/CLIP Vision/IP-Adapter hashes, seed, approved reference-set content hash, style-profile hash, dimensions, source-scene hashes, per-asset QA hash/status and registry `gateStatus:"pass"`. Persist and register the new production-mode compiled request first, then rebind the reused raster and freshly projected production QA/manifest row to that production request's path/file hash. Otherwise generate a new production image. A representative preview made with the provisional set is eligible after promotion because `referenceStatus`/path are declared non-pixel fields while the immutable reference content hash and pixels do not change; the approval revision must explicitly bind that same set hash.

- [ ] **Step 10 (5 minutes): Implement serialized Comfy and Ollama production cycles.**

Create an internal `runProviderCycles` that receives all non-reused assets in render-plan order. Use the shared workspace lock `hostConfig.gpuLockPath`:

```js
await withResourceLock({ lockPath, resource: "gpu", ownerJobId: job.jobId, ownerStage: "comfy", signal, staleAfterMs: 3600000 }, async () => {
  for (const item of pending) {
    if (signal?.aborted) throw Object.assign(new Error("cancelled"), { code: "cancelled" });
    rasters.push(await generateAssetRaster(item));
  }
  await comfy.freeMemory();
});

await withResourceLock({ lockPath, resource: "gpu", ownerJobId: job.jobId, ownerStage: "ollama", signal, staleAfterMs: 3600000 }, async () => {
  for (const raster of rasters) qa.push(await evaluateVisualQa(raster));
  await critic.unload({ signal });
});
```

Both cleanup calls belong in `finally`; cleanup failure is recorded and prevents pass. Collect only `repairAllowed:true` rows, append sorted failed-axis allowlist clauses, set `repairAttemptUsed:true`, and repeat the two phases once. If any row remains non-pass, write per-asset and aggregate needs-review reports, transition with `{stage:"GENERATING_PRODUCTION_IMAGES",to:"needs_review",inputHash:renderPlanHash,error:{code:"visual_qa_exhausted"}}`, and throw; do not publish a pass manifest or start Plan 05.

On cancellation, transition to `cancel_requested`, call `cancelOwnedAsset` for each submitted checkpoint, perform provider cleanup, write no passed artifact, then transition to `cancelled`. Do not send a global interrupt and do not cancel prompt IDs absent from this job's checkpoints.

- [ ] **Step 11 (5 minutes): Aggregate QA, compose the approved thumbnail and publish visual coverage.**

Write/register each `assets/images/qa/<assetId>.json` after schema validation with artifact ID `image-qa-<assetId>`, collection role `yadam.image.asset-qa`, and dependency hashes for raster, compiled request, model, reference and critic evidence. Write canonical `assets/visual-qa-report.json` with status pass only when every row passes, re-read it, then register exact current record `{artifactId:"visual-qa-report",logicalRole:"yadam.image.visual-qa",path:"assets/visual-qa-report.json",gateStatus:"pass"}` with every sorted per-asset QA hash in `dependencyHashes`. Compose or reuse the approval-bound thumbnail, then call `writeImageAssetManifest`; its `visualQaReportHash` must equal that registered aggregate record.

Load the current registered `script/coverage-report.json`, require its registry record to be pass, re-hash it, validate its schema, and retain its exact `scriptScenesHash` as `currentCoverage.scriptScenesHash`. Build the Plan 02 visual coverage report with:

```js
const report = {
  schemaVersion: "1.0.0",
  section: "visual",
  scriptScenesHash: currentCoverage.scriptScenesHash,
  expectedIds: renderPlan.visualSlots.map(slot => slot.visualSlotId),
  coveredIds: imageManifest.assets.filter(asset => asset.purpose !== "thumbnail-background").map(asset => asset.visualSlotId),
  missingIds: [],
  duplicateIds: [],
  orphanIds: [],
  artifactRefs: [{ path: "assets/asset-manifest.json", sha256: imageManifest.sha256 }, { path: "assets/visual-qa-report.json", sha256: visualQa.sha256 }],
  dependencyHash: hashCanonical({ renderPlanHash, imageAssetManifestHash: imageManifest.sha256, visualQaReportHash: visualQa.sha256 })
};
const coverage = await updateCoverageSection({ jobDir, section: "visual", report });
```

Recompute missing/duplicate/orphan sets locally before the call. Require returned `sections.visual === "pass"`, `sectionArtifact.section === "visual"`, and a current passed `yadam.coverage.visual` whose revision/path/hash equal that object; a pending or failed section blocks handoff. The immutable current visual-section revision/hash/path is part of `IMAGES_PASSED` output evidence. Only the mutable aggregate `script/coverage-report.json`, which may later change when subtitle coverage is published, is excluded from that event.

- [ ] **Step 12 (5 minutes): Implement the facade orchestration and strict passed handoff loader.**

`generateProductionImages({jobDir,signal})` uses this fixed order: load job/profile/host, Plan 02 approved planning, Plan 03 passed audio, current approved reference-pointer verification, host preflight, compute `productionInputHash = hashCanonical({approvedArtifactSetHash,audioManifestHash,audioTimelineHash,renderPlanInputHash,referenceSetHash,referencePointerHash,profileHash,modelLockHash,compilerVersionHash,imageQaPolicyHash,thumbnailCompositorPolicyHash,comfyProviderContractHash})`, then collect all `IMAGES_PASSED` rows with that same input without predicting a coverage revision. More than one row is `success_evidence_conflict`. If exactly one row exists, require its paths are the five fixed outputs plus exactly one `script/coverage/visual-rNNN.json` path, call `loadPassedImageHandoff`, and require the row's dynamic path equals the loader-verified current passed visual-section record. Rederive all four policy/provider pins, verify/reuse that section (or provider-free rebuild only the derived aggregate through `updateCoverageSection`), recompute `productionOutputHash = hashCanonical({renderPlanHash,imageAssetManifestHash,visualQaReportHash,thumbnailHash,thumbnailQaHash,visualCoverageHash})`, require it equals the row's `outputHash`, call `appendSubsystemSuccessOnce` to enforce the same cardinality/reuse rule, and make no image provider/state transition. With zero rows, transition `{stage:"GENERATING_PRODUCTION_IMAGES",to:"running",inputHash:productionInputHash}`, compile requests, publish render plan, run provider cycles, compose thumbnail, aggregate QA, publish image manifest, and call Step 11's coverage update. Only after it returns and strict reload verifies the newly current passed section, set `visualCoveragePath = coverage.sectionArtifact.relativePath`, require its hash/revision equal the current registry record, derive `productionArtifactPaths = ["assets/asset-manifest.json","assets/visual-qa-report.json","render-plan.json","thumbnail/final.png","thumbnail/qa.json",visualCoveragePath].sort()` and the output hash, then call `appendSubsystemSuccessOnce({jobDir,event:"IMAGES_PASSED",inputHash:productionInputHash,outputHash:productionOutputHash,artifactPaths:productionArtifactPaths})`; Plan 06 verifies it and does not emit a second event. The method returns only `loadPassedImageHandoff(jobDir)`. Add an initial pending-r001→passed-r002 fixture proving the event names r002, exact-plus-conflicting-row fixtures for both preview and production reuse branches, mutate each of four pins independently, tamper section/aggregate independently, and assert zero unsafe reuse or unnecessary provider/state mutation.

The loader re-reads `artifact-manifest.json` and requires exact current artifact IDs/roles/paths: `render-plan` / `yadam.render.plan` / `render-plan.json`; `image-asset-manifest` / `yadam.image.asset-manifest` / `assets/asset-manifest.json`; `visual-qa-report` / `yadam.image.visual-qa` / `assets/visual-qa-report.json`; `thumbnail-final` / `yadam.thumbnail.final` / `thumbnail/final.png`; `thumbnail-qa` / `yadam.thumbnail.qa` / `thumbnail/qa.json`; and the stable current `yadam.coverage.visual` record at `script/coverage/visual-rNNN.json`. Every registry record must have `gateStatus:"pass"`; `warning`, `pending`, `fail` and `invalidated` are rejected. Re-hash every file, validate schemas, require aggregate QA pass, require the aggregate's visual binding equals the section record, require all image-manifest rows pass, and join render/image rows exclusively by `visualSlotId`. The coverage record remains internal evidence and does not add an unknown public handoff field. It returns exactly:

```js
{
  renderPlanPath: "render-plan.json",
  renderPlanHash,
  imageAssetManifestPath: "assets/asset-manifest.json",
  imageAssetManifestHash,
  visualQaReportPath: "assets/visual-qa-report.json",
  visualQaReportHash,
  thumbnail: {
    path: "thumbnail/final.png",
    sha256: thumbnailHash,
    qaPath: "thumbnail/qa.json",
    qaSha256: thumbnailQaHash
  },
  visualSlots: renderPlan.visualSlots.map(slot => ({
    visualSlotId: slot.visualSlotId,
    startSeconds: slot.startSeconds,
    endSeconds: slot.endSeconds,
    imagePath: imageBySlot.get(slot.visualSlotId).path,
    imageSha256: imageBySlot.get(slot.visualSlotId).sha256,
    qaStatus: "pass"
  }))
}
```

Reject a missing/orphan/duplicate slot, path traversal, hash drift, non-pass status, thumbnail mismatch, timing difference or manifest/QA dependency mismatch. `assets/asset-manifest.json` is the canonical slot mapping; Plan 05 never infers images from filenames or ComfyUI history.

- [ ] **Step 13 (4 minutes): Test duration refresh and strict handoff tamper cases.**

Tamper each of the following independently and assert `loadPassedImageHandoff` fails with a stable code: render-plan bytes, manifest hash, QA status, registry gate status, one slot ID, one start/end, image bytes, thumbnail bytes, current visual-coverage revision/path/hash and coverage status. Assert `refreshApproval2Previews` includes exact changed-set dependency evidence, uses only `previews/preview-manifest-prior-<H0>.json`, creates no preview-history subdirectory and never returns an unaffected row.

- [ ] **Step 14 (4 minutes): Run facade, QA and integration-contract tests.**

Run: `node --test test/yadam/image-service.test.mjs test/yadam/image-qa.test.mjs test/yadam/thumbnail.test.mjs`

Expected: approval preview shape, provisional promotion, exact Plan 02/03 consumption, GPU phase ordering, one repair, cancellation, scoped duration refresh, coverage and strict Plan 05 handoff tests pass.

- [ ] **Step 15 (2 minutes): Commit the image service facade.**

```bash
git add schemas/yadam/preview-manifest.schema.json scripts/lib/yadam/image-service.mjs test/yadam/image-service.test.mjs test/yadam/image-qa.test.mjs
git commit -m "feat: publish approval-bound yadam image handoff"
```

### Task 13: Wire focused CLIs, run the opt-in five-image compatibility smoke and close every contract

**Files:**
- Modify: `package.json`
- Create: `scripts/yadam-image-stage.mjs`
- Create: `scripts/yadam-image-smoke.mjs`
- Modify: `test/yadam/cli.test.mjs`
- Modify: `test/yadam/image-service.test.mjs`
- Modify: `test/yadam/image-provider.test.mjs`
- Modify: `test/yadam/image-qa.test.mjs`
- Modify: `test/yadam/thumbnail.test.mjs`

**Interfaces:**
- Consumes: Plan 01/06 main dispatcher, this plan's five facade exports, host installer/preflight and fixed confirmation tokens.
- Produces: a focused image-stage CLI for diagnostics, an actual five-raster compatibility report, and commands that the master roadmap can invoke without guessing flags.

- [ ] **Step 1 (5 minutes): Write failing CLI boundary tests.**

Spawn the scripts with fake service modules and assert:

- `yadam-image-host --check` is read-only and accepts no confirmation.
- `yadam-image-host --apply` fails unless `--confirmation INSTALL_YADAM_IMAGE_STACK` is exact.
- `yadam-image-stage preview|promote|production|status|cancel --job <absolute-job-dir>` rejects unknown/duplicate flags and relative/outside job paths.
- `promote` requires the current job-relative `--approval-revision approvals/approval-2-rNNN.json`, a passed current `yadam.approval.2` record and the exact current grant input/output/path evidence defined in Task 12 (or a strictly reverified same-input prior `REFERENCE_SET_PROMOTED` row); it must not require a pre-existing `reference_promotion` stage because the public service owns that start transition.
- `cancel` records cancel request first, cancels only checkpoint-owned prompt IDs and writes no passed event.
- `yadam-image-smoke` fails before preflight/filesystem/provider work unless `--confirmation RUN_YADAM_GPU_SMOKE` is exact.
- Every command prints exactly one JSON object to stdout, diagnostics to stderr, and uses exit 0 only for the declared success state.

- [ ] **Step 2 (2 minutes): Run and confirm the stage/smoke scripts are missing.**

Run: `node --test test/yadam/cli.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `yadam-image-stage.mjs` or `yadam-image-smoke.mjs`.

- [ ] **Step 3 (5 minutes): Implement the focused image-stage dispatcher without duplicating master orchestration.**

Create `scripts/yadam-image-stage.mjs` with a closed parser and these calls:

```js
const ACTIONS = Object.freeze({
  preview: args => buildApproval2Previews({ jobDir: args.job, signal: abort.signal }),
  promote: args => promoteApprovedReferenceSet({ jobDir: args.job, approvalRevisionPath: args.approvalRevision }),
  production: args => generateProductionImages({ jobDir: args.job, signal: abort.signal }),
  status: args => loadPassedImageHandoff(args.job),
  cancel: args => requestImageCancellation({ jobDir: args.job, signal: abort.signal })
});
```

`requestImageCancellation` is an internal CLI adapter over Plan 01 state plus Task 10 owner cancellation, not a sixth facade export. The Plan 06 master remains the production entry point and verifies the three subsystem success events; this focused CLI exists for tests, repair operations and direct stage diagnosis. It may not build approval bundles, TTS or video.

- [ ] **Step 4 (5 minutes): Define the exact five-raster smoke matrix.**

Create `scripts/yadam-image-smoke.mjs`. With the exact confirmation, create a non-production smoke directory under `exports/smoke/yadam-image-stack-v1/<UTC-basic>-<8hex>/` and write a request/report there; never register smoke files into a real job. Use these five and only these five ComfyUI prompt submissions:

| Order | Asset | Workflow | Conditioning | Size | Steps | Required evidence |
|---:|---|---|---|---:|---:|---|
| 1 | `reference-primary` | `yadam_sdxl_reference_v1.json` | none | 768×1024 | 28 | colored Joseon character portrait, fixed node 9 |
| 2 | `reference-half-side` | `yadam_sdxl_ipadapter_v1.json` | direct asset 1, `PLUS FACE (portraits)` | 768×1024 | 28 | half-side derived reference, direct-primary dependency |
| 3 | `character-scene` | `yadam_sdxl_ipadapter_v1.json` | direct asset 1 | 1024×576 | 24 | identity/context/color QA pass |
| 4 | `intro-establishing` | `yadam_sdxl_reference_v1.json` | none | 1024×576 | 24 | non-character intro, conditioning-none QA pass |
| 5 | `thumbnail-background` | `yadam_sdxl_ipadapter_v1.json` | direct asset 1, opposite subject placement | 1280×720 | 24 | text-free reserved rectangle QA pass |

Set `smokeInputHash = hashCanonical({stackId:"yadam-sdxl-ipadapter-v1",matrixVersion:"1.0.0",assets:theFiveRows})`, derive `smokeJobSeed = Number.parseInt(smokeInputHash.slice(0,12),16)`, and derive every seed only through Task 4 `deriveImageSeed({jobSeed:smokeJobSeed,assetId})`; record all three values. Use a synthetic but Plan 01-shaped upload ID `job-<UTC-date>-<UTC-time>-<smokeInputHash.slice(0,8)>` without creating a production job. Run all five under one Comfy lease, uploading asset 1 through `/upload/image` before conditioned requests 2, 3 and 5; request 4 must compile with conditioning `none`. Then `/free` and release. Run all five under one Ollama lease using locked `gemma4:12b` digest/size/capability/quantization, unload and release. Do not use automatic repair in this compatibility test because that would exceed five submissions. Compose one Korean glyph/copy thumbnail from asset 5 as a sixth non-Comfy derived artifact; it does not change `submittedImages:5`.

- [ ] **Step 5 (5 minutes): Implement the smoke report and non-production marker.**

Write `smoke-report.json` with a closed schema-equivalent object:

```js
{
  schemaVersion: "1.0.0",
  stackId: "yadam-sdxl-ipadapter-v1",
  customNodeCommit: "b188a6cb39b512a9c6da7235b880af42c78ccd0d",
  checkpointHash: "31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b",
  clipVisionHash: "6ca9667da1ca9e0b0f75e46bb030f7e011f44f86cbfb8d5a36590fcd7507b030",
  ipAdapterHash: "677ad8860204f7d0bfba12d29e6c31ded9beefdf3e4bbd102518357d31a292c1",
  ollama: { model: "gemma4:12b", digest: "4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c", sizeBytes: 7556508396, quantization: "Q4_K_M", vision: true },
  submittedImages: 5,
  passedImages: 5,
  derivedThumbnailPass: true,
  assets: [{ order, assetId, purpose, width, height, seed, workflowHash, promptId, path, sha256, qaPath, qaSha256, status: "pass" }],
  status: "pass"
}
```

Any preflight, raster, vision, glyph, hash, cleanup or lock failure writes `status:"fail"` evidence and exits nonzero. It never changes the immutable model lock automatically and never labels yadam production-ready. A human reviews the five images/report before accepting the stack in operations.

- [ ] **Step 6 (4 minutes): Run all fake-provider focused tests.**

Run: `npm run test:yadam:image`

Expected: exit 0; the legacy-source audit requires the complete runtime file set and proves no runtime `module/`/legacy-provider dependency, while config, workflows/compiler/render plan, provider/resume/cancel, GPU race lock, raster/vision QA, thumbnail and facade/handoff suites report 0 failures. No test reaches Hugging Face, GitHub, a live ComfyUI server, a live Ollama server or the GPU.

- [ ] **Step 7 (3 minutes): Run the complete yadam regression aggregate.**

Run: `npm run test:yadam`

Expected: exit 0; both `test:yadam:node` and `test:yadam:script` run. This proves Plan 04 preserved the Plan 02 `scripts/test_yadam_*.mjs` aggregate instead of narrowing it.

- [ ] **Step 8 (3 minutes): Run the read-only host preflight.**

Run: `npm run yadam:image-host -- --check`

Expected before opt-in install: exit nonzero with one JSON result whose `ready:false` failures name the currently missing custom node, CLIP Vision and IP-Adapter files; it performs no write. Expected after an approved install/restart: exit 0, `ready:true`, exact custom-node commit, all nine nodes, both workflow compiles, all locked model/font hashes, empty queue and exact Ollama digest/size/capability/quantization.

- [ ] **Step 9 (2 minutes): Keep external installation a separately approved operation.**

Run only after the user explicitly authorizes host mutation:

`npm run yadam:image-host -- --apply --confirmation INSTALL_YADAM_IMAGE_STACK`

Expected: exact two model downloads are size/hash verified before rename, custom node is at the pinned detached commit, only the audited `hermes` YAML mapping is removed, two legacy LoRAs are copied without deleting originals, a hash-named YAML backup exists, and `restartRequired:true` is printed. Restart ComfyUI through the allowlisted batch or manually, then rerun Step 8. This command is not part of automated tests.

- [ ] **Step 10 (2 minutes): Keep the real five-image smoke separately approved.**

Run only after Step 8 reports ready and the user explicitly authorizes GPU generation:

`npm run yadam:image-smoke -- --confirmation RUN_YADAM_GPU_SMOKE`

Expected: exit 0 with `submittedImages:5`, `passedImages:5`, `derivedThumbnailPass:true`, `status:"pass"`; output/report live only under `exports/smoke/yadam-image-stack-v1/`. This command is not part of `npm run test:yadam:image` or `npm run test:yadam`.

- [ ] **Step 11 (5 minutes): Audit public/upstream names, artifact paths and forbidden vague language.**

Run:

```powershell
$plan = 'docs/superpowers/plans/2026-07-16-codex-yadam-04-comfyui-images-intro-thumbnail.md'
$legacy = @('buildApproval2'+'Options','buildApproval2'+'Bundle','audio'+'Scenes','segment'+'Timelines','audioHandoff.'+'sourceHash','assets/images/'+'image-asset-manifest','assets/images/'+'visual-qa-report')
$legacyHits = Select-String -LiteralPath $plan -Pattern $legacy -CaseSensitive
$registryHits = Select-String -LiteralPath $plan -Pattern @('logicalRole:.*relative'+'Path','registerArtifact\([^\n]*relative'+'Path') -CaseSensitive
if ($legacyHits -or $registryHits) { $legacyHits; $registryHits; exit 1 }
$bad = @('TO'+'DO','T'+'BD','적'+'절히','implement'+' later','fill in'+' details','Add app'+'ropriate','Write tests for the'+' above','Similar to'+' Task')
$hits = Select-String -LiteralPath $plan -Pattern $bad -CaseSensitive:$false
if ($hits) { $hits; exit 1 }
```

Expected: both checks print nothing and exit 0. Then manually compare the top public block, every facade export and Plan 05's consumed block character-for-character. Confirm registry records use `path`, public DTOs use `relativePath`, `approvalRevisionPath` is job-relative, and canonical handoff paths are `render-plan.json`, `assets/asset-manifest.json`, `assets/visual-qa-report.json`, `thumbnail/final.png`, `thumbnail/qa.json`.

- [ ] **Step 12 (5 minutes): Perform the final implementation-plan coverage review.**

Check every item and record the result in the implementation PR description:

- Exact checkpoint, custom-node source/commit/license, CLIP Vision/IP-Adapter immutable URLs, sizes and hashes are present.
- Ollama name, digest, size, vision capability and quantization are pinned.
- Installer and smoke require different exact confirmations; regular tests are offline/fake.
- Polluted `extra_model_paths.yaml` cleanup preserves `hermes_local`, unrelated YAML and original LoRAs.
- Both LoRA-free workflows compile with fixed SaveImage node 9, batch 1 and denoise 1.
- Compiled requests bind source IDs/hashes, preset/weight type, model/workflow/reference/style/seed and use deterministic keys.
- Plan 03 cadence/source/timing coverage and Plan 02 approval/story/scene/thumbnail hashes bind the closed render plan.
- Reference pixels are promoted/rebound at most once per exact current approval input by Plan 06's stage, without regeneration or scene chaining.
- Prompt IDs are deterministic/durable before POST; response drop, resume, cancellation and bounded I/O are tested.
- Comfy and Ollama never share GPU residency; stale lock reclaim cannot delete a new lease.
- Deterministic raster QA and locked Ollama critic cannot silently pass outage/parse/safety failures.
- Sharp alone renders exact Korean copy, pinned fonts, 4% margins and zero protected overlap.
- Duration refresh requires `REBUILDING_APPROVAL_2_BUNDLE` and binds the exact changed set.
- `APPROVAL_TWO_PREVIEWS_READY`, `REFERENCE_SET_PROMOTED`, and `IMAGES_PASSED` are subsystem-owned, hash-bound and nonduplicated.
- Strict loader exposes exactly the Plan 05 handoff and only pass registry records.
- Five-image smoke covers primary reference, half-side derived reference, character-conditioned scene, non-character intro/establishing and thumbnail background.

- [ ] **Step 13 (3 minutes): Commit CLI, smoke and final contract tests.**

```bash
git add package.json scripts/yadam-image-stage.mjs scripts/yadam-image-smoke.mjs test/yadam/cli.test.mjs test/yadam/image-service.test.mjs test/yadam/image-provider.test.mjs test/yadam/image-qa.test.mjs test/yadam/thumbnail.test.mjs
git commit -m "test: verify yadam image stack end to end"
```

If the initial repository check at the top of this plan showed that the workspace is not a Git worktree, do not run this or any earlier commit block. Stop after verified file changes and ask the user whether to initialize Git, move to an existing repository, or keep an uncommitted directory.

## Implementation Handoff

The Codex CLI owns semantic generation through Plan 02's schema-gated story, scene and thumbnail planning stages. This plan consumes those artifacts and uses the locked local ComfyUI stack for pixels plus deterministic Sharp for Korean thumbnail text; it does not ask Codex to fabricate raster bytes. Execute tasks in order because installer/workflow/compiler contracts precede reference previews, approval-bound production and the strict Plan 05 handoff.

For implementation in this session, use `superpowers:subagent-driven-development` one task at a time with specification review and code-quality review after each commit. For implementation in a separate session or isolated worktree, use `superpowers:executing-plans` and stop at the two explicit host/GPU confirmation gates until the user authorizes them.
