import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { rm, mkdir } from "node:fs/promises";
import { writeCanonicalJson } from "../../scripts/lib/pipeline/atomic-store.mjs";
import { runPreflightSuite } from "../../scripts/lib/pipeline/preflight-suite.mjs";

test("preflight-suite behaves correctly with mocked hostConfig", async () => {
  const tempWorkspace = resolve(`test/yadam/tmp/preflight-ws-${Date.now()}`);
  await rm(tempWorkspace, { recursive: true, force: true });
  await mkdir(tempWorkspace, { recursive: true });

  try {
    // Seed mock config/host.local.json
    const hostConfig = {
      schemaVersion: "1.0.0",
      workspaceRoot: tempWorkspace,
      exportsRoot: join(tempWorkspace, "exports"),
      codex: { executable: "mock-codex.exe" },
      ffmpeg: { executable: "mock-ffmpeg.exe", ffprobeExecutable: "mock-ffprobe.exe" },
      supertonic: { baseUrl: "http://127.0.0.1:9999" },
      comfyui: { baseUrl: "http://127.0.0.1:9998" },
      ollama: { baseUrl: "http://127.0.0.1:9997" }
    };
    await writeCanonicalJson(join(tempWorkspace, "config/host.local.json"), hostConfig);
    
    // Seed yadam profile
    await mkdir(join(tempWorkspace, "config/profiles"), { recursive: true });
    const profile = { schemaVersion: "1.0.0", profileId: "yadam" };
    await writeCanonicalJson(join(tempWorkspace, "config/profiles/yadam.json"), profile);

    // Run preflight suite (should fail because executables don't exist and servers are offline)
    const result = await runPreflightSuite({ workspaceRoot: tempWorkspace, profileId: "yadam" });
    
    assert.equal(result.ok, false);
    assert.equal(result.results.length, 5);
    assert.equal(result.results.find(r => r.name === "ffmpeg").ok, false);

  } finally {
    await rm(tempWorkspace, { recursive: true, force: true });
  }
});
