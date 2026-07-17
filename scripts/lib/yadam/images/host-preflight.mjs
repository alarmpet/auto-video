import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { loadImageStackLock, verifyLockedFile } from "./model-lock.mjs";
import { loadWorkflowDescriptor, compileWorkflow } from "./workflow-template.mjs";

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
    child.once("exit", code => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
      } else {
        rejectPromise(Object.assign(new Error(stderr.trim() || `exit ${code}`), { code: "git_install_failed" }));
      }
    });
  });
}

function waitForSpawnOrError(child) {
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("spawn", () => {
      resolvePromise();
    });
    child.once("error", err => {
      rejectPromise(err);
    });
  });
}

export async function preflightImageHost({ workspaceRoot = process.cwd(), hostConfig, autoStart = false, signal, fetchImpl = fetch, spawnImpl = spawn }) {
  const lock = await loadImageStackLock(workspaceRoot);
  const comfyUrl = hostConfig.comfyui.baseUrl;
  const ollamaUrl = hostConfig.ollama.baseUrl;
  const failures = [];

  let stats = null;
  let queue = null;
  let objectInfo = null;

  const tryConnect = async () => {
    try {
      const statsRes = await fetchImpl(`${comfyUrl}/system_stats`, { signal });
      if (!statsRes.ok) return false;
      const qRes = await fetchImpl(`${comfyUrl}/queue`, { signal });
      if (!qRes.ok) return false;
      const infoRes = await fetchImpl(`${comfyUrl}/object_info`, { signal });
      if (!infoRes.ok) return false;
      stats = await statsRes.json();
      queue = await qRes.json();
      objectInfo = await infoRes.json();
      return true;
    } catch {
      return false;
    }
  };

  let connected = await tryConnect();
  if (!connected && autoStart && hostConfig.comfyui.autoStart) {
    if (hostConfig.comfyui.startupBatch !== "C:/Users/petbl/ComfyUI_windows_portable/run_nvidia_gpu.bat") {
      throw Object.assign(new Error("unsafe startup batch path"), { code: "comfy_startup_batch_unsafe" });
    }
    const child = spawnImpl("C:/Windows/System32/cmd.exe", ["/d", "/s", "/c", `"${hostConfig.comfyui.startupBatch}"`], {
      cwd: hostConfig.comfyui.portableRoot,
      shell: false,
      windowsHide: true,
      detached: false,
      stdio: "ignore"
    });
    try {
      await waitForSpawnOrError(child);
      child.unref();
    } catch (err) {
      failures.push({ code: "comfy_autostart_failed", evidence: err.message });
    }
    
    // Poll up to startupTimeoutMs
    const timeout = hostConfig.comfyui.startupTimeoutMs || 180000;
    const pollStart = Date.now();
    while (Date.now() - pollStart < timeout) {
      if (signal?.aborted) throw Object.assign(new Error("cancelled"), { code: "cancelled" });
      connected = await tryConnect();
      if (connected) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!connected) {
      failures.push({ code: "comfy_connection_failed", evidence: `unreachable after autostart poll` });
    }
  } else if (!connected) {
    failures.push({ code: "comfy_connection_failed", evidence: `unreachable` });
  }

  // 1. Custom node check
  let customNodeCommit = null;
  let customNodeStatus = "custom_node_missing";
  try {
    const gitRes = await spawnChecked("git", ["-C", lock.customNode.targetPath, "rev-parse", "HEAD"], {}, spawnImpl);
    customNodeCommit = gitRes.stdout.trim();
    customNodeStatus = customNodeCommit === lock.customNode.commit ? "pass" : "custom_node_commit_mismatch";
  } catch (err) {
    failures.push({ code: "custom_node_git_error", evidence: err.message });
  }
  if (customNodeStatus !== "pass") {
    failures.push({ code: "custom_node_status_failed", evidence: customNodeStatus });
  }

  // 2. Check models
  const checkpointStatus = await verifyLockedFile(lock.checkpoint.path, lock.checkpoint).then(() => "pass", err => err.code);
  const clipVisionStatus = await verifyLockedFile(lock.models.clipVision.targetPath, lock.models.clipVision).then(() => "pass", err => err.code);
  const ipAdapterStatus = await verifyLockedFile(lock.models.ipAdapter.targetPath, lock.models.ipAdapter).then(() => "pass", err => err.code);
  
  if (checkpointStatus !== "pass") failures.push({ code: "model_checkpoint_invalid", evidence: checkpointStatus });
  if (clipVisionStatus !== "pass") failures.push({ code: "model_clip_vision_invalid", evidence: clipVisionStatus });
  if (ipAdapterStatus !== "pass") failures.push({ code: "model_ip_adapter_invalid", evidence: ipAdapterStatus });

  // 3. Font check
  const fontBoldStatus = await verifyLockedFile(lock.fonts.bold.path, lock.fonts.bold).then(() => "pass", err => err.code);
  const fontRegularStatus = await verifyLockedFile(lock.fonts.regular.path, lock.fonts.regular).then(() => "pass", err => err.code);
  
  if (fontBoldStatus !== "pass") failures.push({ code: "font_bold_invalid", evidence: fontBoldStatus });
  if (fontRegularStatus !== "pass") failures.push({ code: "font_regular_invalid", evidence: fontRegularStatus });

  // 4. Object info classes & workflow compilation checks
  let missingNodes = [];
  let referenceWorkflowStatus = "not_checked";
  let conditionedWorkflowStatus = "not_checked";

  if (objectInfo) {
    const required = ["CheckpointLoaderSimple", "CLIPTextEncode", "EmptyLatentImage", "KSampler", "VAEDecode", "SaveImage", "LoadImage", "IPAdapterUnifiedLoader", "IPAdapter"];
    missingNodes = required.filter(cls => !objectInfo[cls]);
    if (missingNodes.length) {
      failures.push({ code: "comfy_missing_nodes", evidence: missingNodes.join(",") });
    }

    try {
      const refDesc = await loadWorkflowDescriptor({ workspaceRoot, conditioning: "none" });
      compileWorkflow({
        descriptor: refDesc,
        objectInfo,
        values: {
          CKPT: lock.checkpoint.filename,
          PROMPT: "dummy prompt",
          NEGATIVE_PROMPT: "dummy negative",
          WIDTH: 1024,
          HEIGHT: 576,
          SEED: 1,
          STEPS: 24,
          CFG: 6,
          SAMPLER: "dpmpp_2m",
          SCHEDULER: "karras",
          FILENAME_PREFIX: "dummy"
        }
      });
      referenceWorkflowStatus = "pass";
    } catch (err) {
      referenceWorkflowStatus = "fail";
      failures.push({ code: "reference_workflow_compile_failed", evidence: err.message });
    }

    try {
      const condDesc = await loadWorkflowDescriptor({ workspaceRoot, conditioning: "sdxl-ipadapter-plus-face" });
      compileWorkflow({
        descriptor: condDesc,
        objectInfo,
        values: {
          CKPT: lock.checkpoint.filename,
          REFERENCE_IMAGE: "dummy.png",
          PROMPT: "dummy prompt",
          NEGATIVE_PROMPT: "dummy negative",
          WIDTH: 1024,
          HEIGHT: 576,
          SEED: 1,
          STEPS: 24,
          CFG: 6,
          SAMPLER: "dpmpp_2m",
          SCHEDULER: "karras",
          IPADAPTER_WEIGHT: 0.8,
          IPADAPTER_START: 0,
          IPADAPTER_END: 0.85,
          FILENAME_PREFIX: "dummy"
        }
      });
      conditionedWorkflowStatus = "pass";
    } catch (err) {
      conditionedWorkflowStatus = "fail";
      failures.push({ code: "conditioned_workflow_compile_failed", evidence: err.message });
    }
  } else {
    failures.push({ code: "comfy_object_info_missing", evidence: "could not query ComfyUI" });
  }

  // 5. Ollama preflight checks
  let ollamaOk = false;
  let ollamaModelInfo = null;

  try {
    const tagsRes = await fetchImpl(`${ollamaUrl}/api/tags`, { signal });
    if (tagsRes.ok) {
      const tags = await tagsRes.json();
      const modelTag = tags.models?.find(m => m.name === lock.ollamaVision.model || m.name?.startsWith(lock.ollamaVision.model + ":"));
      if (modelTag) {
        // model found, now check show details
        const showRes = await fetchImpl(`${ollamaUrl}/api/show`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: lock.ollamaVision.model }),
          signal
        });
        if (showRes.ok) {
          const show = await showRes.json();
          // check digest, size, capabilities, quantization
          const sizeBytes = modelTag.size || show.size || 0;
          const digest = modelTag.digest || show.digest || "";
          const quantization = show.details?.quantization_level || "";
          const capabilities = show.projector_info || show.model_info || {};
          const isVision = show.details?.families?.includes("clip") || show.details?.families?.includes("mllm") || JSON.stringify(capabilities).includes("vision") || JSON.stringify(show).includes("vision");
          
          if (digest.includes(lock.ollamaVision.digest) && sizeBytes === lock.ollamaVision.sizeBytes && quantization === lock.ollamaVision.quantization && isVision) {
            ollamaOk = true;
            ollamaModelInfo = {
              model: lock.ollamaVision.model,
              digest: lock.ollamaVision.digest,
              sizeBytes: lock.ollamaVision.sizeBytes,
              quantization: lock.ollamaVision.quantization,
              vision: true
            };
          } else {
            failures.push({ code: "ollama_model_mismatch", evidence: `digest: ${digest}, size: ${sizeBytes}, quant: ${quantization}, vision: ${isVision}` });
          }
        } else {
          failures.push({ code: "ollama_show_failed", evidence: `status ${showRes.status}` });
        }
      } else {
        failures.push({ code: "ollama_model_missing", evidence: `${lock.ollamaVision.model} not found in tags` });
      }
    } else {
      failures.push({ code: "ollama_tags_failed", evidence: `status ${tagsRes.status}` });
    }
  } catch (err) {
    failures.push({ code: "ollama_connection_failed", evidence: err.message });
  }

  const queueRunning = queue?.queue_running?.length || 0;
  const queuePending = queue?.queue_pending?.length || 0;

  if (queueRunning > 0 || queuePending > 0) {
    failures.push({ code: "comfy_queue_not_empty", evidence: `running: ${queueRunning}, pending: ${queuePending}` });
  }

  const ready = failures.length === 0;

  return {
    schemaVersion: "1.0.0",
    ready,
    comfyUi: {
      version: "0.24.0",
      baseUrl: comfyUrl,
      queueRunning,
      queuePending
    },
    customNode: { commit: lock.customNode.commit, status: customNodeStatus },
    models: { checkpoint: checkpointStatus, clipVision: clipVisionStatus, ipAdapter: ipAdapterStatus },
    nodes: { missing: missingNodes },
    workflows: { reference: referenceWorkflowStatus, conditioned: conditionedWorkflowStatus },
    font: { bold: fontBoldStatus, regular: fontRegularStatus },
    ollama: ollamaModelInfo || {
      model: lock.ollamaVision.model,
      digest: lock.ollamaVision.digest,
      sizeBytes: lock.ollamaVision.sizeBytes,
      quantization: lock.ollamaVision.quantization,
      vision: false
    },
    failures
  };
}
