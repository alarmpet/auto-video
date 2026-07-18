# Yadam Video Pipeline: Artifact Contract & Integrity Schema

This document defines the formal artifact contracts, schemas, production timing, and provenance rules for the Yadam local video pipeline.

---

## 1. Artifact Classification & Roles

All artifacts produced during the pipeline run are classified into three distinct roles:

| Logical Role | Artifact Type | Creator / Producer Stage | Description / Guarantee |
| :--- | :--- | :--- | :--- |
| `pipeline.request` | Canonical | `job-create` | Immutable request payload including seed, profile, and source. |
| `yadam.concept.options` | Preview | `concept-generation` | Candidate concept proposals generated for selection. |
| `yadam.concept.selection` | Canonical | `concept-selection` | Selected candidate ID, timestamp, and operator notes. |
| `yadam.approval.1.bundle` | Preview | `approval-1-bundle` | Bundle markdown, outline, and brief package for review. |
| `yadam.approval.1` | Canonical | `approval-1` | Immutable signed approval revision file on disk. |
| `yadam.story.bible` | Canonical | `story-bible` | Character traits, relationships, beats, and spoiler seals. |
| `yadam.script.plan` | Canonical | `script-planning` | Deterministic segments plan based on duration matrix. |
| `yadam.script.segment` | Canonical | `drafting` | Individual segment scripts including dialog and visuals. |
| `yadam.script.scenes` | Canonical | `final-script-qa` | Finalized compiled scenes mapping all beats. |
| `yadam.scene.plan` | Canonical | `final-script-qa` | Visual layout template coordinates per scene. |
| `yadam.preview.manifest` | Preview | `approval-2-previews` | Generated preview asset references (contact sheets, audio). |
| `yadam.approval.2.bundle` | Preview | `approval-2-bundle` | Compiles previews, QA logs, and thumbnail proposals. |
| `yadam.approval.2` | Canonical | `approval-2` | Signed production approval revision file. |
| `yadam.character.reference-pointer` | Canonical | `reference_promotion` | Pointers to promoted character model assets. |
| `yadam.audio.manifest` | Canonical | `full_tts` | Completed s16le normalization audio segment clips path. |
| `yadam.audio.timeline` | Canonical | `full_tts` | Exact millisecond timestamp cue start/end bounds. |
| `yadam.image.asset-manifest` | Canonical | `production_images` | Rendered png visual files for all scenes. |
| `yadam.segment.manifest` | Canonical | `segment_assembly` | Individual compiled mp4 segment files with hard subtitles. |
| `yadam.segment.manifest` | Canonical | `final_publish` | Final master video asset path. |

---

## 2. Timing Rules: Render-Plan vs. Render-Manifest

- **`yadam.render.plan`**: Generated at the end of the TTS timeline phase. It maps the visual frames to audio tracks. It is **read-only** during image rendering.
- **`yadam.image.asset-manifest`**: Generated *after* visual image generation is fully completed. It lists the actual rendered files and their SHA-256 hashes.
- **CRITICAL TIMING**: Visual image generation *must* read coordinates and duration values from the approved `yadam.render.plan`. It cannot generate assets on ad-hoc timings.

---

## 3. Provenance & Integrity Guarantees

1. **Existence is NOT Success**: A file's presence in the directory does not mean the stage succeeded. Every file **MUST** match the SHA-256 hash locked in `artifact-manifest.json` and pass schema validation.
2. **Immutability of Signed Revisions**: Once `current-approval-1.json` or `current-approval-2.json` is set to `status: "valid"`, the stages covered by those gates are sealed. The master orchestrator will reject any modifications to artifacts produced in those stages.
3. **Provider-Owned Provenance**: When Codex or Supertonic processes complete, they append metadata files containing tool version hashes and execution parameters. If these are missing or altered, the orchestrator triggers a tampering block.
