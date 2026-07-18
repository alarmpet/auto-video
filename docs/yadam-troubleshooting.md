# Yadam Video Pipeline: Troubleshooting Guide

This guide lists the stable error codes used in the Yadam pipeline, their evidence paths, and the required recovery actions.

---

## 1. Stable Error Codes & Recovery Directory

| Error Code | Meaning | Evidence File Path | Action / Recovery Procedure |
| :--- | :--- | :--- | :--- |
| `invalid_cli_argument` | Command line arguments parsed incorrectly. | Standard Out/Err JSON | Verify flag spellings, types, or missing required values via the Runbook. |
| `schema_validation_failed` | Manifest or state JSON violates schema. | Standard Out/Err JSON | Run `npm run test:yadam` to see if schemas/code are modified, or inspect the file. |
| `duration_refresh_scope_expanded` | TTS audio length exceeds bounds after repair. | `reports/duration-incident-*.json` | The script has changed too much. You **MUST** trigger re-review and Approval 2 reapproval. |
| `completed_artifact_tampered` | Final video or QA report has altered hash. | `final/incidents/tampered-*.json` | Verify if manual files were modified post-run. Rerun `publishFinalVideo` to re-generate. |
| `resource_locked` | GPU lease is active or process is dead with active lock. | `exports/.locks/gpu.lock` | Check if another job is running. If not, wait `staleAfterMs` (1hr) or delete the lock file. |
| `preflight_failed` | Prerequisite tool or local server is offline. | Standard Out/Err JSON | Check if Supertonic TTS (3093), ComfyUI (8188) or Ollama (11434) ports are listening. |

---

## 2. Detailed Incident Handlers

### Incident: `duration_refresh_scope_expanded`
- **Why it happens**: When TTS audio generated for beats is too long or short, and the automatic repair algorithm's beat modifications still fall outside the tolerance threshold.
- **Recovery**:
  1. Open the job directory and inspect `reports/duration-incident-*.json`.
  2. The pipeline status will show `needs_review` or `awaiting_approval`.
  3. Re-run `resume` to re-generate the approval 2 bundle.
  4. Manually re-approve using `approve-production` with the updated artifact set hash.

### Incident: `completed_artifact_tampered`
- **Why it happens**: A completed job's final assets (`final/final-full.mp4` or `final/final-qa-report.json`) have hashes differing from what was locked in the artifact manifest.
- **Recovery**:
  1. Check if an operator manually edited the video or subtitle files.
  2. Restore the original files from backups, or delete the final outputs and re-run the `run` command to let the orchestrator re-verify and re-publish the final outputs safely.
