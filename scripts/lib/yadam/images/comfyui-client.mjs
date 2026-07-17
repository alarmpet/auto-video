import { createHash } from "node:crypto";
import { basename } from "node:path";

function checkedBaseUrl(value) {
  let url;
  try { url = new URL(value); }
  catch (cause) { throw Object.assign(new Error("ComfyUI must be a bare loopback HTTP origin"), { code: "comfyui_non_loopback", cause }); }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw Object.assign(new Error("ComfyUI must be a bare loopback HTTP origin"), { code: "comfyui_non_loopback" });
  }
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
  if (!name || name === "." || name === ".." || basename(name) !== name || /[\\/:]/.test(name) || subfolder.startsWith("/") || subfolder.includes("\\") || subfolder.includes(":") || segments.some(segment => segment === "." || segment === ".." || segment === "" && subfolder !== "")) {
    throw Object.assign(new Error("unsafe ComfyUI path"), { code: "comfy_path_traversal" });
  }
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
      if (timeoutSignal.aborted || cause?.name === "TimeoutError") {
        throw Object.assign(new Error("ComfyUI HTTP request timed out"), { code: "comfy_http_timeout", cause });
      }
      throw cause;
    }
  };
  const getJson = (path, options) => request(path, options).then(response => checkedJson(response, "comfy_http_error"));
  const downloadFile = async ({ filename, name, subfolder = "", type = "output", maxBytes, signal }) => {
    const actualName = filename || name;
    if (!Number.isInteger(maxBytes) || maxBytes < 1) throw Object.assign(new Error("explicit download byte limit required"), { code: "comfy_download_limit_required" });
    safeRemoteName({ name: actualName, subfolder, type });
    const query = new URLSearchParams({ filename: actualName, subfolder, type });
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
    },
    async uploadReference({ jobId, bytes, sha256, signal }) {
      if (!/^job-[0-9]{8}-[0-9]{6}-[0-9a-f]{8}$/.test(jobId)) throw Object.assign(new Error("invalid job id for upload"), { code: "comfy_upload_job_id_invalid" });
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (actual !== sha256) throw Object.assign(new Error("local reference hash mismatch"), { code: "reference_hash_mismatch" });
      const filename = `yadam_${jobId}_${sha256}.png`;
      const expectedRemote = { name: filename, subfolder: "yadam-references", type: "input" };
      try {
        const existing = await downloadFile({ ...expectedRemote, maxBytes: bytes.length, signal });
        if (createHash("sha256").update(existing).digest("hex") !== sha256) {
          throw Object.assign(new Error("content-addressed remote name has different bytes"), { code: "uploaded_reference_hash_mismatch" });
        }
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
      if (remote.name !== filename || remote.subfolder !== "yadam-references" || remote.type !== "input") {
        throw Object.assign(new Error("upload response path differs from request"), { code: "comfy_upload_path_mismatch" });
      }
      const workflowImageName = safeRemoteName(remote);
      const verified = await downloadFile({ ...remote, maxBytes: bytes.length, signal });
      if (createHash("sha256").update(verified).digest("hex") !== sha256) {
        throw Object.assign(new Error("uploaded reference hash mismatch"), { code: "uploaded_reference_hash_mismatch" });
      }
      return { ...remote, workflowImageName, sha256, reused: false };
    },
    async waitForOutput({ promptId, outputNodeId, timeoutMs, signal }) {
      const started = now();
      while (now() - started <= timeoutMs) {
        if (signal?.aborted) throw Object.assign(new Error("ComfyUI wait cancelled"), { code: "cancelled" });
        const history = await getJson(`/history/${encodeURIComponent(promptId)}`, { signal });
        const entry = history[promptId];
        if (entry?.status?.status_str === "error") {
          throw Object.assign(new Error("ComfyUI execution failed"), { code: "comfy_execution_failed", messages: entry.status.messages ?? [] });
        }
        if (entry?.status?.completed) {
          const images = entry.outputs?.[outputNodeId]?.images;
          if (!Array.isArray(images) || images.length !== 1) {
            throw Object.assign(new Error("fixed output node did not return exactly one image"), { code: "comfy_output_cardinality" });
          }
          return images[0];
        }
        await wait(1000);
      }
      throw Object.assign(new Error("ComfyUI prompt timed out"), { code: "comfy_prompt_timeout", promptId });
    },
    downloadFile
  };
}
