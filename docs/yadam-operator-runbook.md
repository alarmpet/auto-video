# Yadam Video Pipeline: Operator Runbook

This runbook outlines the operational procedures, CLI commands, user gates, and execution phases for the Yadam local video pipeline.

---

## 1. Prerequisites & One-time Setup

Before running the pipeline, ensure that the ComfyUI portable environment and model checkpoints are correctly configured.

### IP-Adapter Checkpoints Setup
The ComfyUI visual generation stage utilizes SDXL and IP-Adapter. Ensure the following files exist in your ComfyUI model paths:
- SDXL base model: `checkpoints/sd_xl_base_1.0.safetensors`
- IP-Adapter weights: `ipadapter/ip-adapter-plus-face_sdxl_vit-h.bin`
- ViT-H CLIP Vision model: `clip_vision/CLIP-docs-vit-h.safetensors`

Ensure the local API endpoints for Codex, Supertonic TTS, ComfyUI, and Ollama are configured correctly in `config/host.local.json`.

---

## 2. Pipeline CLI Commands Reference

All commands are run using Node.js from the project root.

### Job Lifecycle Commands

#### Create a New Job
Creates a new pipeline run from a reference title or genre.
```bash
node scripts/auto-video-pipeline.mjs new --profile yadam --mode reference --source "우주를 날아가는 고양이" --minutes 10 --seed 42 --instructions "신비로운 연출"
```

#### Check Job Status
Prints the current status, cursor, and history transitions in JSON format.
```bash
node scripts/auto-video-pipeline.mjs status --job exports/job-YYYYMMDD-HHMMSS-NNNNNNNN
```

#### Run/Resume Job Orchestration
Starts or resumes sequential execution of the pipeline from the current cursor until it is blocked by a user gate.
```bash
node scripts/auto-video-pipeline.mjs run --job exports/job-YYYYMMDD-HHMMSS-NNNNNNNN
node scripts/auto-video-pipeline.mjs resume --job exports/job-YYYYMMDD-HHMMSS-NNNNNNNN
```

#### Cancel Job
Safely stops execution and transitions the state to `cancelled`, scanning and moving any temporary `.tmp`/`.part` files into `quarantine/cancelled-temp/` to prevent corruption.
```bash
node scripts/auto-video-pipeline.mjs cancel --job exports/job-YYYYMMDD-HHMMSS-NNNNNNNN
```

---

## 3. Human Review & Approval Gates

The pipeline pauses at four logical user gates. To resolve each gate, run the corresponding CLI selection/approval command.

### Pause 1: Concept Selection
- **Description**: Inspect generated concepts under `planning/concept-options.json` and select one.
- **Resolution Command**:
  ```bash
  node scripts/auto-video-pipeline.mjs select-concept --job exports/job-DIR --option concept-c01 --note "Let's proceed with option 1"
  ```

### Pause 2: Approval 1 (Story/Outline Approval)
- **Description**: Review the outline bundle in `reviews/approval-1-rNNN.md` and approve it.
- **Resolution Command**:
  ```bash
  node scripts/auto-video-pipeline.mjs approve-concept --job exports/job-DIR --artifact-set-hash <hash_from_manifest> --note "Outline approved"
  ```

### Pause 3: Thumbnail Copy Selection
- **Description**: Review thumbnail text layout proposals and select one.
- **Resolution Command**:
  ```bash
  node scripts/auto-video-pipeline.mjs select-thumbnail-copy --job exports/job-DIR --copy copy-01
  ```

### Pause 4: Approval 2 (Production Approval)
- **Description**: Review visual contact sheets, scene previews, and audio tracks in `reviews/approval-2-rNNN.md` and approve for final rendering.
- **Resolution Command**:
  ```bash
  node scripts/auto-video-pipeline.mjs approve-production --job exports/job-DIR --artifact-set-hash <hash_from_manifest> --note "Production approved"
  ```

---

## 4. Operational Guardrails

### Target Duration Repair & Reapproval
If the generated TTS audio duration exceeds target tolerances (Plan 03):
1. The pipeline automatically triggers a **Duration Repair** attempt, modifying the script beats to shrink or expand the length.
2. **CRITICAL**: Because the script text has changed, any existing Approval 2 bundle is invalidated. The operator **MUST** perform reapproval at Approval 2 after duration repair finishes.

### Preflight Verification
To check if the local environment is ready (verifies Codex CLI, Supertonic TTS server, ComfyUI, Ollama, and FFmpeg):
```bash
node scripts/auto-video-pipeline.mjs preflight --provider codex
```

### Scale Dry-run Check
To perform a dry-run planning check for scale durations without invoking external AI providers:
```bash
node scripts/run-yadam-scale-dry-run.mjs --minutes 20,60,120
```

### Live Acceptance Check
To run a real candidate run, the confirmation token is strictly required:
```bash
node scripts/run-yadam-live-acceptance.mjs --minutes 10 --confirm-live YADAM_LOCAL_10_MIN_ACCEPTANCE
```

---

## 5. Output Locations

Upon pipeline completion, the final deliverables are located under the job directory:
- **Final Master Video**: `final/final-full.mp4`
- **Subtitles (SRT)**: `final/final-full.srt`
- **Thumbnail Image**: `planning/thumbnail-final.png`
- **Final QA Report**: `final/final-qa-report.json` (contains `qualityOk: true` and `finalVerdict: "pass"`)
