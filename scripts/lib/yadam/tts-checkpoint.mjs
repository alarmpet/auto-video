import { existsSync, promises as fsPromises, createReadStream } from "node:fs";
import { join, resolve } from "node:path";
import crypto from "node:crypto";
import { loadJob } from "../pipeline/job-store.mjs";
import { loadProfile, loadHostConfig } from "../pipeline/profile-registry.mjs";
import { registerArtifact, canReuseArtifact } from "../pipeline/artifact-store.mjs";
import { writeCanonicalJson, readJson } from "../pipeline/atomic-store.mjs";
import { validateSchema } from "../pipeline/schema-registry.mjs";
import { importProviderAudio } from "./provider-audio-import.mjs";
import { normalizeAudioScene, writeNormalizationReport } from "./audio-normalizer.mjs";
import { runAsyncTtsJob, preflightSupertonicHttp } from "../providers/supertonic-http.mjs";
import { runSupertonicCli, preflightSupertonicCli, selectTtsTransport } from "../providers/supertonic-cli.mjs";

const STATUS_ORDER = {
  pending: 0,
  submitted: 1,
  polling: 2,
  provider_done: 3,
  raw_verified: 4,
  normalized: 5,
  cancel_requested: 6,
  orphaned: 7,
  failed: 8
};

function hashFile(filePath) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
    stream.on("error", rejectHash);
  });
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== "ESRCH";
  }
}

export async function acquireSceneLock({ jobDir, sceneId, requestHash, leaseId }) {
  const lockDir = join(jobDir, "assets/audio/checkpoints");
  await fsPromises.mkdir(lockDir, { recursive: true });
  const lockPath = join(lockDir, `${sceneId}.lock`);

  let attempts = 0;
  while (attempts < 2) {
    attempts++;
    try {
      // Try to open with wx flag for exclusive creation
      const handle = await fsPromises.open(lockPath, "wx");
      const lockData = {
        schemaVersion: "1.0.0",
        pid: process.pid,
        leaseId,
        requestHash,
        startedAt: new Date().toISOString()
      };
      await handle.write(JSON.stringify(lockData, null, 2) + "\n");
      await handle.close();
      return true;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;

      // Lock file exists. Read it.
      let existingLock;
      try {
        existingLock = JSON.parse(await fsPromises.readFile(lockPath, "utf8"));
      } catch (readErr) {
        // If read fails, it might be partially written or corrupted. Wait a bit.
        await new Promise(r => setTimeout(r, 100));
        continue;
      }

      const lockAgeSeconds = (Date.now() - new Date(existingLock.startedAt).getTime()) / 1000;
      const pidAlive = isPidAlive(existingLock.pid);

      if (lockAgeSeconds > 300 && !pidAlive) {
        // Quarantine stale dead lock
        const quarantineDir = join(jobDir, "quarantine/locks");
        await fsPromises.mkdir(quarantineDir, { recursive: true });
        const quarantinePath = join(quarantineDir, `tts-${sceneId}-${existingLock.leaseId}.json`);
        try {
          await fsPromises.rename(lockPath, quarantinePath);
        } catch (renameErr) {
          // If rename fails (e.g. someone else renamed it), retry loop
        }
        continue;
      }

      // Lock is still live or indeterminate
      throw Object.assign(new Error(`Scene ${sceneId} is locked by PID ${existingLock.pid}`), {
        code: "tts_scene_locked"
      });
    }
  }

  throw Object.assign(new Error(`Failed to acquire lock for scene ${sceneId}`), {
    code: "tts_scene_locked"
  });
}

export async function releaseSceneLock({ jobDir, sceneId, leaseId }) {
  const lockPath = join(jobDir, "assets/audio/checkpoints", `${sceneId}.lock`);
  if (!existsSync(lockPath)) return;

  try {
    const existingLock = JSON.parse(await fsPromises.readFile(lockPath, "utf8"));
    if (existingLock.leaseId === leaseId) {
      await fsPromises.unlink(lockPath);
    }
  } catch (err) {
    // If read/delete fails, ignore
  }
}

export async function loadCheckpoint({ jobDir, sceneId }) {
  const cpPath = join(jobDir, "assets/audio/checkpoints", `${sceneId}.json`);
  if (!existsSync(cpPath)) return null;
  return JSON.parse(await fsPromises.readFile(cpPath, "utf8"));
}

export async function writeCheckpoint({ jobDir, sceneId, checkpoint }) {
  const schemaPath = join(jobDir, "schemas/yadam/tts-scene-checkpoint.schema.json");
  await validateSchema(schemaPath, checkpoint);

  const cpPath = join(jobDir, "assets/audio/checkpoints", `${sceneId}.json`);
  await writeCanonicalJson(cpPath, checkpoint);
}

export async function updateCheckpointStatus({ jobDir, sceneId, status, updates = {} }) {
  const current = await loadCheckpoint({ jobDir, sceneId });
  if (!current) {
    throw new Error(`Checkpoint for ${sceneId} does not exist`);
  }

  const currentIndex = STATUS_ORDER[current.status];
  const newIndex = STATUS_ORDER[status];

  // If current is normalized, transitions are forbidden
  if (current.status === "normalized" && status !== "normalized") {
    throw Object.assign(new Error(`Illegal transition from normalized to ${status}`), {
      code: "illegal_tts_checkpoint_transition"
    });
  }

  // If both are in main sequence and going backward
  if (currentIndex <= 5 && newIndex <= 5 && newIndex < currentIndex) {
    throw Object.assign(new Error(`Illegal backward transition from ${current.status} to ${status}`), {
      code: "illegal_tts_checkpoint_transition"
    });
  }

  const updated = {
    ...current,
    status,
    ...updates,
    updatedAt: new Date().toISOString()
  };

  await writeCheckpoint({ jobDir, sceneId, checkpoint: updated });
  return updated;
}

export async function runSceneBatch({ jobDir, requests, signal, publishAudioNeedsReview }) {
  const context = await loadJob(jobDir);
  const profile = await loadProfile(context.request.profileId, context.workspaceRoot || ".");
  const hostConfig = await loadHostConfig(jobDir);

  const results = [];
  const requestHashes = {};

  for (const req of requests) {
    requestHashes[req.sceneId] = req.idempotencyKey; // wait, is req.idempotencyKey the request hash? Yes, we validated request.idempotencyKey.
  }

  for (const req of requests) {
    if (signal?.aborted) {
      throw new DOMException("The user aborted a request.", "AbortError");
    }

    const leaseId = crypto.randomUUID();
    await acquireSceneLock({ jobDir, sceneId: req.sceneId, requestHash: req.idempotencyKey, leaseId });

    try {
      let checkpoint = await loadCheckpoint({ jobDir, sceneId: req.sceneId });
      if (!checkpoint) {
        checkpoint = {
          schemaVersion: "1.0.0",
          sceneId: req.sceneId,
          requestHash: req.idempotencyKey,
          idempotencyKey: req.idempotencyKey,
          status: "pending",
          transport: null,
          attempt: 1,
          updatedAt: new Date().toISOString(),
          providerJobId: null,
          providerResult: null,
          rawAsset: null,
          normalizedAsset: null,
          error: null
        };
        await writeCheckpoint({ jobDir, sceneId: req.sceneId, checkpoint });
      }

      let rowResult = null;

      // Decision Order:
      // 1. Validate normalized asset
      if (checkpoint.status === "normalized") {
        const normPath = resolve(jobDir, `assets/audio/normalized/${req.sceneId}.wav`);
        if (existsSync(normPath)) {
          const actualHash = await hashFile(normPath);
          if (
            checkpoint.normalizedAsset?.sha256 === actualHash &&
            checkpoint.requestHash === req.idempotencyKey
          ) {
            // Re-verify artifact registration
            const registered = await canReuseArtifact(jobDir, `yadam.audio.normalized.${req.sceneId}`, {
              [`yadam.tts.request.${req.sceneId}`]: req.idempotencyKey
            });
            if (registered) {
              rowResult = {
                sceneId: req.sceneId,
                segmentId: req.segmentId,
                order: req.order,
                sourceHash: req.sourceHash,
                ttsNormalizedHash: req.ttsNormalizedHash,
                ttsOptionsHash: req.ttsOptionsHash,
                transport: checkpoint.transport,
                providerJobId: checkpoint.providerJobId,
                rawPath: checkpoint.rawAsset.path,
                rawSha256: checkpoint.rawAsset.sha256,
                normalizedPath: checkpoint.normalizedAsset.path,
                normalizedSha256: checkpoint.normalizedAsset.sha256,
                media: checkpoint.normalizedAsset.media,
                attempts: checkpoint.attempt,
                elapsedMs: 0,
                providerProvenance: checkpoint.providerResult
              };
            }
          }
        }

        if (!rowResult) {
          // Quarantine and rerun
          try {
            const qDir = join(jobDir, "quarantine/audio");
            await fsPromises.mkdir(qDir, { recursive: true });
            const normPath = resolve(jobDir, `assets/audio/normalized/${req.sceneId}.wav`);
            if (existsSync(normPath)) {
              await fsPromises.rename(normPath, join(qDir, `${req.sceneId}-normalized-failed.wav`));
            }
          } catch {}
          checkpoint = await updateCheckpointStatus({ jobDir, sceneId: req.sceneId, status: "pending", updates: { attempt: checkpoint.attempt + 1 } });
        }
      }

      // 2. Validate raw asset
      if (!rowResult && checkpoint.status === "raw_verified") {
        const rawPath = resolve(jobDir, `assets/audio/raw/${req.sceneId}.wav`);
        if (existsSync(rawPath)) {
          const actualHash = await hashFile(rawPath);
          if (checkpoint.rawAsset?.sha256 === actualHash) {
            // We can directly normalize
            const normRes = await normalizeAudioScene({
              rawPath: checkpoint.rawAsset.path,
              request: req,
              jobDir,
              signal
            });
            checkpoint = await updateCheckpointStatus({
              jobDir,
              sceneId: req.sceneId,
              status: "normalized",
              updates: {
                normalizedAsset: {
                  path: normRes.normalizedPath,
                  sha256: normRes.normalizedSha256,
                  media: normRes.media
                }
              }
            });

            // Register artifacts
            await registerArtifact(jobDir, {
              artifactId: `yadam-audio-raw-${req.sceneId}`,
              logicalRole: `yadam.audio.raw.${req.sceneId}`,
              path: checkpoint.rawAsset.path,
              sha256: checkpoint.rawAsset.sha256,
              schemaVersion: "1.0.0",
              producerStage: "audio-generation",
              gateStatus: "pass",
              dependencyHashes: {
                [`yadam.tts.request.${req.sceneId}`]: req.idempotencyKey
              }
            });

            await registerArtifact(jobDir, {
              artifactId: `yadam-audio-normalized-${req.sceneId}`,
              logicalRole: `yadam.audio.normalized.${req.sceneId}`,
              path: normRes.normalizedPath,
              sha256: normRes.normalizedSha256,
              schemaVersion: "1.0.0",
              producerStage: "audio-normalization",
              gateStatus: "pass",
              dependencyHashes: {
                [`yadam.audio.raw.${req.sceneId}`]: checkpoint.rawAsset.sha256
              }
            });

            rowResult = {
              sceneId: req.sceneId,
              segmentId: req.segmentId,
              order: req.order,
              sourceHash: req.sourceHash,
              ttsNormalizedHash: req.ttsNormalizedHash,
              ttsOptionsHash: req.ttsOptionsHash,
              transport: checkpoint.transport,
              providerJobId: checkpoint.providerJobId,
              rawPath: checkpoint.rawAsset.path,
              rawSha256: checkpoint.rawAsset.sha256,
              normalizedPath: normRes.normalizedPath,
              normalizedSha256: normRes.normalizedSha256,
              media: normRes.media,
              attempts: checkpoint.attempt,
              elapsedMs: 0,
              providerProvenance: checkpoint.providerResult
            };
          }
        }
      }

      // 3. Resume accepted provider job
      if (!rowResult && (checkpoint.status === "submitted" || checkpoint.status === "polling" || checkpoint.status === "provider_done")) {
        if (checkpoint.transport === "http" && checkpoint.providerJobId) {
          let get404 = false;
          let jobResult = null;
          try {
            jobResult = await pollTtsJob({
              baseUrl: hostConfig.supertonic.baseUrl,
              providerJobId: checkpoint.providerJobId,
              signal,
              pollIntervalMs: profile.tts.pollIntervalMs,
              deadlineMs: profile.tts.sceneTimeoutMs
            });
          } catch (pollErr) {
            if (pollErr.code === "supertonic_job_lost") {
              get404 = true;
            } else {
              throw pollErr;
            }
          }

          if (get404) {
            // Repeat normalized/raw validation under same lock
            const normPath = resolve(jobDir, `assets/audio/normalized/${req.sceneId}.wav`);
            const rawPath = resolve(jobDir, `assets/audio/raw/${req.sceneId}.wav`);
            if (existsSync(normPath) && checkpoint.normalizedAsset?.sha256 === await hashFile(normPath)) {
              // Reuse normalized
              checkpoint = await updateCheckpointStatus({ jobDir, sceneId: req.sceneId, status: "normalized" });
              rowResult = {
                sceneId: req.sceneId, segmentId: req.segmentId, order: req.order,
                sourceHash: req.sourceHash, ttsNormalizedHash: req.ttsNormalizedHash, ttsOptionsHash: req.ttsOptionsHash,
                transport: checkpoint.transport, providerJobId: checkpoint.providerJobId,
                rawPath: checkpoint.rawAsset.path, rawSha256: checkpoint.rawAsset.sha256,
                normalizedPath: checkpoint.normalizedAsset.path, normalizedSha256: checkpoint.normalizedAsset.sha256,
                media: checkpoint.normalizedAsset.media, attempts: checkpoint.attempt, elapsedMs: 0, providerProvenance: checkpoint.providerResult
              };
            } else if (existsSync(rawPath) && checkpoint.rawAsset?.sha256 === await hashFile(rawPath)) {
              // Reuse raw and normalize
              const normRes = await normalizeAudioScene({ rawPath: checkpoint.rawAsset.path, request: req, jobDir, signal });
              checkpoint = await updateCheckpointStatus({
                jobDir, sceneId: req.sceneId, status: "normalized",
                updates: { normalizedAsset: { path: normRes.normalizedPath, sha256: normRes.normalizedSha256, media: normRes.media } }
              });
              rowResult = {
                sceneId: req.sceneId, segmentId: req.segmentId, order: req.order,
                sourceHash: req.sourceHash, ttsNormalizedHash: req.ttsNormalizedHash, ttsOptionsHash: req.ttsOptionsHash,
                transport: checkpoint.transport, providerJobId: checkpoint.providerJobId,
                rawPath: checkpoint.rawAsset.path, rawSha256: checkpoint.rawAsset.sha256,
                normalizedPath: normRes.normalizedPath, normalizedSha256: normRes.normalizedSha256,
                media: normRes.media, attempts: checkpoint.attempt, elapsedMs: 0, providerProvenance: checkpoint.providerResult
              };
            } else {
              // Both files absent: preserve accepted job ID as orphan and return needs_review
              checkpoint = await updateCheckpointStatus({
                jobDir, sceneId: req.sceneId, status: "orphaned",
                updates: { error: { code: "supertonic_submission_ambiguous", causeCode: "job_lost_404" } }
              });
              const reviewOut = await publishAudioNeedsReview({
                jobDir,
                errorCode: "supertonic_submission_ambiguous",
                createdAt: new Date().toISOString(),
                measuredAudioSeconds: 0,
                acceptedRangeSeconds: { minimum: profile.targetMinutes.min * 60 * 0.8, maximum: profile.targetMinutes.min * 60 * 1.2 },
                repairAttempt: context.state.durationRepairAttemptsUsed,
                providerOrphan: {
                  sceneId: req.sceneId,
                  requestHash: req.idempotencyKey,
                  providerJobId: checkpoint.providerJobId,
                  checkpointPath: `assets/audio/checkpoints/${req.sceneId}.json`
                },
                evidence: [
                  { artifactId: `yadam.tts.request.${req.sceneId}`, path: `assets/audio/requests/${req.sceneId}.json`, sha256: req.idempotencyKey }
                ]
              });
              throw Object.assign(new Error("Supertonic submission ambiguous (404 orphan)"), {
                code: "supertonic_submission_ambiguous",
                reportPath: reviewOut.reportPath
              });
            }
          } else {
            // Poll succeeded
            const importRes = await importProviderAudio({
              transport: "http",
              providerResult: jobResult,
              jobDir,
              allowedRoots: hostConfig.supertonic.allowedOutputRoots,
              baseUrl: hostConfig.supertonic.baseUrl,
              request: req,
              signal
            });

            checkpoint = await updateCheckpointStatus({
              jobDir, sceneId: req.sceneId, status: "raw_verified",
              updates: {
                rawAsset: { path: importRes.rawPath, sha256: importRes.rawSha256 },
                providerResult: importRes.providerProvenance
              }
            });

            const normRes = await normalizeAudioScene({ rawPath: importRes.rawPath, request: req, jobDir, signal });
            checkpoint = await updateCheckpointStatus({
              jobDir, sceneId: req.sceneId, status: "normalized",
              updates: { normalizedAsset: { path: normRes.normalizedPath, sha256: normRes.normalizedSha256, media: normRes.media } }
            });

            rowResult = {
              sceneId: req.sceneId, segmentId: req.segmentId, order: req.order,
              sourceHash: req.sourceHash, ttsNormalizedHash: req.ttsNormalizedHash, ttsOptionsHash: req.ttsOptionsHash,
              transport: checkpoint.transport, providerJobId: checkpoint.providerJobId,
              rawPath: importRes.rawPath, rawSha256: importRes.rawSha256,
              normalizedPath: normRes.normalizedPath, normalizedSha256: normRes.normalizedSha256,
              media: normRes.media, attempts: checkpoint.attempt, elapsedMs: 0, providerProvenance: importRes.providerProvenance
            };
          }
        }
      }

      // Handle orphaned checkpoint with providerJobId: null (from previous runs)
      if (!rowResult && checkpoint.status === "orphaned") {
        const reviewOut = await publishAudioNeedsReview({
          jobDir,
          errorCode: "supertonic_submission_ambiguous",
          createdAt: new Date().toISOString(),
          measuredAudioSeconds: 0,
          acceptedRangeSeconds: { minimum: profile.targetMinutes.min * 60 * 0.8, maximum: profile.targetMinutes.min * 60 * 1.2 },
          repairAttempt: context.state.durationRepairAttemptsUsed,
          providerOrphan: {
            sceneId: req.sceneId,
            requestHash: req.idempotencyKey,
            providerJobId: checkpoint.providerJobId,
            checkpointPath: `assets/audio/checkpoints/${req.sceneId}.json`
          },
          evidence: [
            { artifactId: `yadam.tts.request.${req.sceneId}`, path: `assets/audio/requests/${req.sceneId}.json`, sha256: req.idempotencyKey }
          ]
        });
        throw Object.assign(new Error("Supertonic submission ambiguous (orphaned checkpoint)"), {
          code: "supertonic_submission_ambiguous",
          reportPath: reviewOut.reportPath
        });
      }

      // 4. Select transport & Run fresh generation
      if (!rowResult) {
        // Preflights
        let httpPreflightResult;
        let cliPreflightResult;

        try {
          const resVal = await preflightSupertonicHttp({ baseUrl: hostConfig.supertonic.baseUrl, signal, timeoutMs: 3000 });
          httpPreflightResult = { status: "fulfilled", value: resVal };
        } catch (httpPreflightErr) {
          httpPreflightResult = { status: "rejected", reason: httpPreflightErr };
        }

        try {
          const resVal = await preflightSupertonicCli({
            pythonExecutable: hostConfig.supertonic.cli.pythonExecutable,
            scriptPath: hostConfig.supertonic.cli.scriptPath,
            cwd: hostConfig.supertonic.cli.cwd,
            signal,
            timeoutMs: 5000
          });
          cliPreflightResult = { status: "fulfilled", value: resVal };
        } catch (cliPreflightErr) {
          cliPreflightResult = { status: "rejected", reason: cliPreflightErr };
        }

        const selectedTransport = selectTtsTransport({ httpPreflightResult, cliPreflightResult });
        checkpoint = await updateCheckpointStatus({
          jobDir, sceneId: req.sceneId, status: "pending",
          updates: { transport: selectedTransport }
        });

        if (selectedTransport === "http") {
          const res = await runAsyncTtsJob({
            baseUrl: hostConfig.supertonic.baseUrl,
            request: req,
            onAccepted: async ({ providerJobId }) => {
              checkpoint = await updateCheckpointStatus({
                jobDir, sceneId: req.sceneId, status: "submitted",
                updates: { providerJobId }
              });
            },
            onAmbiguous: async ({ causeCode, providerJobId, attempt }) => {
              checkpoint = await updateCheckpointStatus({
                jobDir, sceneId: req.sceneId, status: "orphaned",
                updates: { providerJobId: providerJobId || null, attempt, error: { code: "supertonic_submission_ambiguous", causeCode } }
              });
            },
            signal,
            pollIntervalMs: profile.tts.pollIntervalMs,
            deadlineMs: profile.tts.sceneTimeoutMs
          });

          // Import & Normalize
          const importRes = await importProviderAudio({
            transport: "http",
            providerResult: res.providerResult,
            jobDir,
            allowedRoots: hostConfig.supertonic.allowedOutputRoots,
            baseUrl: hostConfig.supertonic.baseUrl,
            request: req,
            signal
          });

          checkpoint = await updateCheckpointStatus({
            jobDir, sceneId: req.sceneId, status: "raw_verified",
            updates: {
              rawAsset: { path: importRes.rawPath, sha256: importRes.rawSha256 },
              providerResult: importRes.providerProvenance
            }
          });

          const normRes = await normalizeAudioScene({ rawPath: importRes.rawPath, request: req, jobDir, signal });
          checkpoint = await updateCheckpointStatus({
            jobDir, sceneId: req.sceneId, status: "normalized",
            updates: { normalizedAsset: { path: normRes.normalizedPath, sha256: normRes.normalizedSha256, media: normRes.media } }
          });

          rowResult = {
            sceneId: req.sceneId, segmentId: req.segmentId, order: req.order,
            sourceHash: req.sourceHash, ttsNormalizedHash: req.ttsNormalizedHash, ttsOptionsHash: req.ttsOptionsHash,
            transport: "http", providerJobId: checkpoint.providerJobId,
            rawPath: importRes.rawPath, rawSha256: importRes.rawSha256,
            normalizedPath: normRes.normalizedPath, normalizedSha256: normRes.normalizedSha256,
            media: normRes.media, attempts: checkpoint.attempt, elapsedMs: res.elapsedMs, providerProvenance: importRes.providerProvenance
          };
        } else if (selectedTransport === "cli") {
          checkpoint = await updateCheckpointStatus({ jobDir, sceneId: req.sceneId, status: "submitted" });

          const res = await runSupertonicCli({
            pythonExecutable: hostConfig.supertonic.cli.pythonExecutable,
            scriptPath: hostConfig.supertonic.cli.scriptPath,
            cwd: hostConfig.supertonic.cli.cwd,
            request: req,
            jobDir,
            signal,
            killTreeCallback: null
          });

          const importRes = await importProviderAudio({
            transport: "cli",
            providerResult: res.providerResult,
            jobDir,
            allowedRoots: [],
            baseUrl: "",
            request: req,
            signal
          });

          checkpoint = await updateCheckpointStatus({
            jobDir, sceneId: req.sceneId, status: "raw_verified",
            updates: {
              rawAsset: { path: importRes.rawPath, sha256: importRes.rawSha256 },
              providerResult: importRes.providerProvenance
            }
          });

          const normRes = await normalizeAudioScene({ rawPath: importRes.rawPath, request: req, jobDir, signal });
          checkpoint = await updateCheckpointStatus({
            jobDir, sceneId: req.sceneId, status: "normalized",
            updates: { normalizedAsset: { path: normRes.normalizedPath, sha256: normRes.normalizedSha256, media: normRes.media } }
          });

          rowResult = {
            sceneId: req.sceneId, segmentId: req.segmentId, order: req.order,
            sourceHash: req.sourceHash, ttsNormalizedHash: req.ttsNormalizedHash, ttsOptionsHash: req.ttsOptionsHash,
            transport: "cli", providerJobId: null,
            rawPath: importRes.rawPath, rawSha256: importRes.rawSha256,
            normalizedPath: normRes.normalizedPath, normalizedSha256: normRes.normalizedSha256,
            media: normRes.media, attempts: checkpoint.attempt, elapsedMs: res.elapsedMs, providerProvenance: importRes.providerProvenance
          };
        }
      }

      // Register raw and normalized artifacts
      await registerArtifact(jobDir, {
        artifactId: `yadam-audio-raw-${req.sceneId}`,
        logicalRole: `yadam.audio.raw.${req.sceneId}`,
        path: rowResult.rawPath,
        sha256: rowResult.rawSha256,
        schemaVersion: "1.0.0",
        producerStage: "audio-generation",
        gateStatus: "pass",
        dependencyHashes: {
          [`yadam.tts.request.${req.sceneId}`]: req.idempotencyKey
        }
      });

      await registerArtifact(jobDir, {
        artifactId: `yadam-audio-normalized-${req.sceneId}`,
        logicalRole: `yadam.audio.normalized.${req.sceneId}`,
        path: rowResult.normalizedPath,
        sha256: rowResult.normalizedSha256,
        schemaVersion: "1.0.0",
        producerStage: "audio-normalization",
        gateStatus: "pass",
        dependencyHashes: {
          [`yadam.audio.raw.${req.sceneId}`]: rowResult.rawSha256
        }
      });

      results.push(rowResult);
    } finally {
      await releaseSceneLock({ jobDir, sceneId: req.sceneId, leaseId });
    }
  }

  return { results, requestHashes };
}
