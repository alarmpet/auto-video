import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";

function runScript(scriptPath, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
    child.on("exit", code => {
      resolve({ code, stdout, stderr });
    });
  });
}

test("yadam-image-host --check is read-only", async () => {
  const result = await runScript("scripts/yadam-image-host.mjs", ["--check"]);
  // Since models are missing in the test workspace, this check should return non-zero exit code but valid output JSON
  assert.equal(result.code, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ready, false);
  assert.equal(parsed.customNodeStatus, "custom_node_missing");
});

test("yadam-image-host --apply fails without confirmation", async () => {
  const result = await runScript("scripts/yadam-image-host.mjs", ["--apply"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /confirmation/);
});

test("yadam-image-smoke fails without confirmation", async () => {
  const result = await runScript("scripts/yadam-image-smoke.mjs", []);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /confirmation/);
});
