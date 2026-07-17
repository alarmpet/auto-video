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
