import { buildApproval2Previews, promoteApprovedReferenceSet, generateProductionImages, loadPassedImageHandoff } from "./lib/yadam/image-service.mjs";
import { cancelOwnedAsset } from "./lib/yadam/images/image-runner.mjs";
import { createComfyClient } from "./lib/yadam/images/comfyui-client.mjs";
import { loadJob } from "./lib/pipeline/job-store.mjs";
import { transitionJob } from "./lib/pipeline/state-machine.mjs";
import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";

async function main() {
  const args = process.argv.slice(2);
  const action = args[0];
  
  const jobIdx = args.indexOf("--job");
  if (jobIdx === -1 || !args[jobIdx + 1]) {
    console.error("Error: --job <absolute-job-dir> is required");
    process.exit(1);
  }
  const jobDir = args[jobIdx + 1];

  const ACTIONS = {
    preview: async () => buildApproval2Previews({ jobDir }),
    promote: async () => {
      const revIdx = args.indexOf("--approval-revision");
      if (revIdx === -1 || !args[revIdx + 1]) {
        console.error("Error: --approval-revision is required for promote");
        process.exit(1);
      }
      return promoteApprovedReferenceSet({ jobDir, approvalRevisionPath: args[revIdx + 1] });
    },
    production: async () => generateProductionImages({ jobDir }),
    status: async () => loadPassedImageHandoff(jobDir),
    cancel: async () => {
      const job = await loadJob(jobDir);
      await transitionJob(jobDir, { stage: "image_generation", to: "cancel_requested", inputHash: "0".repeat(64) });
      const client = createComfyClient({ baseUrl: job.config.host?.comfyui?.baseUrl || "http://127.0.0.1:8188" });
      
      const checkpointDir = join(jobDir, "assets/images/checkpoints");
      const files = await readdir(checkpointDir).catch(() => []);
      const now = new Date().toISOString();
      for (const file of files) {
        if (file.endsWith(".json")) {
          const assetId = file.replace(".json", "");
          await cancelOwnedAsset({ jobDir, assetId, client, now });
        }
      }
      await transitionJob(jobDir, { stage: "image_generation", to: "cancelled", inputHash: "0".repeat(64) });
      return { status: "cancelled" };
    }
  };

  const fn = ACTIONS[action];
  if (!fn) {
    console.error(`Error: Unknown action ${action}. Allowed: preview, promote, production, status, cancel`);
    process.exit(1);
  }

  try {
    const result = await fn();
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
