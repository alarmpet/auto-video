import { createHash } from "node:crypto";
import { mkdir, readFile, rename } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { writeBinaryAtomic, writeCanonicalJson } from "../../pipeline/atomic-store.mjs";
import { registerArtifact } from "../../pipeline/artifact-store.mjs";
import { assertRealPathWithin } from "../../pipeline/path-policy.mjs";
import { validateSchema } from "../../pipeline/schema-registry.mjs";
import { hashCanonical } from "../../pipeline/canonical-json.mjs";
import { sha256File } from "./model-lock.mjs";

const rel = (jobDir, filePath) => relative(jobDir, filePath).replaceAll("\\", "/");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function checkpointPath(jobDir, assetId) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,95}$/.test(assetId)) {
    throw Object.assign(new Error("invalid asset id"), { code: "asset_id_invalid" });
  }
  return join(jobDir, "assets", "images", "checkpoints", `${assetId}.json`);
}

function stablePromptId(idempotencyKey) {
  if (!/^[0-9a-f]{64}$/.test(idempotencyKey)) {
    throw Object.assign(new Error("invalid idempotency key"), { code: "idempotency_key_invalid" });
  }
  return `${idempotencyKey.slice(0, 8)}-${idempotencyKey.slice(8, 12)}-${idempotencyKey.slice(12, 16)}-${idempotencyKey.slice(16, 20)}-${idempotencyKey.slice(20, 32)}`;
}

async function quarantineMismatch({ jobDir, filePath, assetId, actualHash }) {
  await assertRealPathWithin(jobDir, filePath);
  const target = join(jobDir, "quarantine", "images", `${assetId}-${actualHash.slice(0, 12)}.png`);
  await assertRealPathWithin(jobDir, target);
  await mkdir(dirname(target), { recursive: true });
  await rename(filePath, target);
  return rel(jobDir, target);
}

export async function generateAssetRaster({ jobDir, jobId, request, workflow, workflowHash, client, promptTimeoutMs, signal, now }) {
  const checkpointFile = checkpointPath(jobDir, request.assetId);
  const requestHash = request.idempotencyKey;
  const prior = await readFile(checkpointFile, "utf8").then(JSON.parse, () => null);
  
  if (prior?.requestHash === requestHash && ["prepared", "outcome_unknown", "submitted", "running"].includes(prior.status) && prior.promptId) {
    return resumeAssetRaster({ jobDir, jobId, request, workflow, workflowHash, client, promptTimeoutMs, signal, now });
  }
  
  if (prior?.requestHash === requestHash && prior.status === "downloaded") {
    const bytes = await readFile(join(jobDir, prior.outputPath)).catch(() => null);
    if (bytes && sha256(bytes) === prior.outputHash) {
      return { ...prior, bytes };
    }
    if (bytes) {
      await quarantineMismatch({ jobDir, filePath: join(jobDir, prior.outputPath), assetId: request.assetId, actualHash: sha256(bytes) });
    }
  }
  
  if (signal?.aborted) throw Object.assign(new Error("image generation cancelled"), { code: "cancelled" });
  
  const clientId = `yadam-${jobId}-${request.assetId}`;
  const promptId = stablePromptId(requestHash);
  const prepared = {
    schemaVersion: "1.0.0",
    assetId: request.assetId,
    requestHash,
    workflowHash,
    status: "prepared",
    promptId,
    queueNumber: null,
    submitAttempt: (prior?.submitAttempt ?? 0) + 1,
    preparedAt: now(),
    outputPath: null,
    outputHash: null
  };
  await writeCanonicalJson(checkpointFile, prepared);
  
  let submitted;
  let attempt = 0;
  while (true) {
    try {
      submitted = await client.submitPrompt({ workflow, clientId, promptId, signal });
      break;
    } catch (error) {
      const isTransient = [429, 502, 503, 504].includes(error.status) || error.code === "ECONNRESET" || error.code === "ETIMEDOUT" || error.code === "comfy_http_timeout";
      attempt += 1;
      if (isTransient && attempt < 3) {
        const delay = attempt === 1 ? 1000 : 2000;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      await writeCanonicalJson(checkpointFile, { ...prepared, status: "outcome_unknown", submitErrorCode: error.code ?? error.name, submitResponseDroppedAt: now() });
      throw Object.assign(new Error("ComfyUI submit response was not confirmed; resume the known prompt ID"), { code: "comfy_submit_outcome_unknown", promptId, cause: error });
    }
  }
  
  await writeCanonicalJson(checkpointFile, { ...prepared, status: "submitted", queueNumber: submitted.number, submittedAt: now() });
  return resumeAssetRaster({ jobDir, jobId, request, workflow, workflowHash, client, promptTimeoutMs, signal, now });
}

function promptIds(rows) {
  return new Set((rows ?? []).map(row => String(row[1])));
}

export async function resumeAssetRaster({ jobDir, jobId, request, workflow, workflowHash, client, promptTimeoutMs, signal, now, confirmedServerRestart = false }) {
  const checkpointFile = checkpointPath(jobDir, request.assetId);
  let checkpoint = JSON.parse(await readFile(checkpointFile, "utf8"));
  if (checkpoint.requestHash !== request.idempotencyKey || checkpoint.workflowHash !== workflowHash) {
    throw Object.assign(new Error("checkpoint dependency mismatch"), { code: "image_checkpoint_stale" });
  }
  if (!checkpoint.promptId) {
    throw Object.assign(new Error("checkpoint lacks prompt id"), { code: "image_checkpoint_prompt_missing" });
  }
  
  if (["prepared", "outcome_unknown"].includes(checkpoint.status)) {
    const [history, queue] = await Promise.all([
      client.getHistory({ promptId: checkpoint.promptId, signal }).catch(() => ({})),
      client.getQueue({ signal }).catch(() => ({ queue_pending: [], queue_running: [] }))
    ]);
    const visible = history[checkpoint.promptId] || promptIds(queue.queue_pending).has(checkpoint.promptId) || promptIds(queue.queue_running).has(checkpoint.promptId);
    if (!visible && !confirmedServerRestart) {
      throw Object.assign(new Error("known prompt is absent but server restart is not proven"), { code: "comfy_prompt_absence_unproven", promptId: checkpoint.promptId });
    }
    if (!visible && confirmedServerRestart) {
      if (checkpoint.restartResubmitUsed === true) {
        throw Object.assign(new Error("restart resubmit already used"), { code: "comfy_restart_resubmit_exhausted" });
      }
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

export async function cancelOwnedAsset({ jobDir, assetId, client, now }) {
  const file = checkpointPath(jobDir, assetId);
  const checkpoint = JSON.parse(await readFile(file, "utf8"));
  if (!checkpoint.promptId || checkpoint.status === "downloaded") {
    return { status: checkpoint.status, action: "none" };
  }
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

export async function writeImageAssetManifest({ jobDir, jobId, approval, referenceSet, renderPlan, assets, visualQaReportHash }) {
  const assetIds = new Set();
  const slotIds = new Set();
  for (const asset of assets) {
    if (assetIds.has(asset.assetId)) throw Object.assign(new Error(`Duplicate assetId: ${asset.assetId}`), { code: "manifest_duplicate_asset" });
    assetIds.add(asset.assetId);
    if (asset.purpose !== "thumbnail-background") {
      if (slotIds.has(asset.visualSlotId)) throw Object.assign(new Error(`Duplicate slotId: ${asset.visualSlotId}`), { code: "manifest_duplicate_slot" });
      slotIds.add(asset.visualSlotId);
    }
  }

  const planSlotIds = new Set(renderPlan.visualSlots.map(s => s.visualSlotId));
  for (const slotId of planSlotIds) {
    const matching = assets.filter(a => a.visualSlotId === slotId);
    if (matching.length !== 1) throw Object.assign(new Error(`Slot ${slotId} must have exactly one asset in manifest`), { code: "manifest_slot_parity_failed" });
  }
  for (const asset of assets) {
    if (asset.purpose !== "thumbnail-background" && !planSlotIds.has(asset.visualSlotId)) {
      throw Object.assign(new Error(`Unknown slotId in manifest: ${asset.visualSlotId}`), { code: "manifest_unknown_slot" });
    }
    if (asset.qaStatus !== "pass") {
      throw Object.assign(new Error(`QA status must be pass: ${asset.assetId}`), { code: "manifest_qa_not_pass" });
    }
  }

  const thumbRows = assets.filter(a => a.purpose === "thumbnail-background");
  if (thumbRows.length !== 1 || thumbRows[0].visualSlotId !== "thumbnail-background") {
    throw Object.assign(new Error(`Manifest must have exactly one thumbnail-background with slotId 'thumbnail-background'`), { code: "manifest_thumbnail_invalid" });
  }

  const manifest = {
    schemaVersion: "1.0.0",
    jobId,
    approvalRevisionPath: approval.approvalRevisionPath,
    approvedArtifactSetHash: approval.approvedArtifactSetHash,
    referenceSetPath: referenceSet.referenceSetPath,
    referenceSetHash: referenceSet.referenceSetHash,
    renderPlanPath: "render-plan.json",
    renderPlanHash: renderPlan.sha256 || hashCanonical(renderPlan),
    assets: assets.map(a => ({
      assetId: a.assetId,
      visualSlotId: a.visualSlotId,
      purpose: a.purpose,
      path: a.path,
      sha256: a.sha256,
      width: a.width,
      height: a.height,
      compiledRequestPath: a.compiledRequestPath,
      compiledRequestHash: a.compiledRequestHash,
      workflowPath: a.workflowPath,
      workflowHash: a.workflowHash,
      checkpointHash: a.checkpointHash,
      referenceSetHash: a.referenceSetHash,
      seed: a.seed,
      generationAttempt: a.generationAttempt,
      repairAttemptUsed: a.repairAttemptUsed,
      qaPath: a.qaPath,
      qaHash: a.qaHash,
      qaStatus: "pass"
    }))
  };

  const schemaPath = join(process.cwd(), "schemas/yadam/image-asset-manifest.schema.json");
  await validateSchema(schemaPath, manifest);

  const manifestPath = join(jobDir, "assets/asset-manifest.json");
  const output = await writeCanonicalJson(manifestPath, manifest);

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
      renderPlan: renderPlan.sha256 || hashCanonical(renderPlan),
      referenceSet: referenceSet.referenceSetHash,
      visualQa: visualQaReportHash
    }
  });

  return { ...output, value: manifest };
}
