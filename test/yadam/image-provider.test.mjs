import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createComfyClient } from "../../scripts/lib/yadam/images/comfyui-client.mjs";

const validPngBytes = Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
]);

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("client uploads content-addressed reference and uses returned name", async () => {
  const calls = [];
  let uploaded = false;
  const jobId = "job-20260716-000000-1234abcd";
  const sha256 = createHash("sha256").update(validPngBytes).digest("hex");
  const client = createComfyClient({
    baseUrl: "http://127.0.0.1:8188",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith("/upload/image")) {
        uploaded = true;
        return json({ name: `yadam_${jobId}_${sha256}.png`, subfolder: "yadam-references", type: "input" });
      }
      if (String(url).includes("/view?")) {
        return uploaded ? new Response(validPngBytes) : new Response("missing", { status: 404 });
      }
      throw new Error(`unexpected URL ${url}`);
    }
  });
  const result = await client.uploadReference({ jobId, bytes: validPngBytes, sha256 });
  assert.equal(result.workflowImageName, `yadam-references/yadam_${jobId}_${sha256}.png`);
  assert.equal(calls[1].options.method, "POST");
});

test("client selects only SaveImage node 9", async () => {
  const client = createComfyClient({
    baseUrl: "http://127.0.0.1:8188",
    wait: async () => {},
    fetchImpl: async url => String(url).includes("/history/")
      ? json({ p1: { status: { completed: true, status_str: "success", messages: [] }, outputs: { "2": { images: [{ filename: "wrong.png", subfolder: "", type: "output" }] }, "9": { images: [{ filename: "right.png", subfolder: "yadam", type: "output" }] } } } })
      : new Response(validPngBytes)
  });
  const out = await client.waitForOutput({ promptId: "p1", outputNodeId: "9", timeoutMs: 1000 });
  assert.equal(out.filename, "right.png");
});

test("client enforces loopback origin only", () => {
  assert.throws(() => createComfyClient({ baseUrl: "https://example.com" }), error => error.code === "comfyui_non_loopback");
  assert.throws(() => createComfyClient({ baseUrl: "http://127.0.0.1:8188/path" }), error => error.code === "comfyui_non_loopback");
  assert.ok(createComfyClient({ baseUrl: "http://127.0.0.1:8188" }));
});
