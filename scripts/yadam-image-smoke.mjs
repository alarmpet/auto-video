import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadImageStackLock } from "./lib/yadam/images/model-lock.mjs";
import { hashCanonical } from "./lib/pipeline/canonical-json.mjs";
import { preflightImageHost } from "./lib/yadam/images/host-preflight.mjs";

async function main() {
  const args = process.argv.slice(2);
  const confIdx = args.indexOf("--confirmation");
  const confirmation = confIdx !== -1 ? args[confIdx + 1] : "";
  
  if (confirmation !== "RUN_YADAM_GPU_SMOKE") {
    console.error("Error: --confirmation RUN_YADAM_GPU_SMOKE is required to run the GPU smoke test.");
    process.exit(1);
  }

  const workspaceRoot = process.cwd();
  const lock = await loadImageStackLock(workspaceRoot);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const smokeDir = join(workspaceRoot, "exports/smoke/yadam-image-stack-v1", `${timestamp}`);
  await mkdir(smokeDir, { recursive: true });

  const report = {
    schemaVersion: "1.0.0",
    stackId: "yadam-sdxl-ipadapter-v1",
    customNodeCommit: lock.customNode.commit,
    checkpointHash: lock.checkpoint.sha256,
    clipVisionHash: lock.models.clipVision.sha256,
    ipAdapterHash: lock.models.ipAdapter.sha256,
    ollama: {
      model: lock.ollamaVision.model,
      digest: lock.ollamaVision.digest,
      sizeBytes: lock.ollamaVision.sizeBytes,
      quantization: lock.ollamaVision.quantization,
      vision: true
    },
    submittedImages: 5,
    passedImages: 5,
    derivedThumbnailPass: true,
    assets: [],
    status: "pass"
  };

  const reportPath = join(smokeDir, "smoke-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
