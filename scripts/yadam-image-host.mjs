import { inspectHostInstallation, applyHostInstallation } from "./lib/yadam/images/host-installer.mjs";
import { loadImageStackLock } from "./lib/yadam/images/model-lock.mjs";
import { loadJob } from "./lib/pipeline/job-store.mjs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const isApply = args.includes("--apply");
  
  if (!isCheck && !isApply) {
    console.error("Usage: node scripts/yadam-image-host.mjs --check | --apply --confirmation INSTALL_YADAM_IMAGE_STACK");
    process.exit(1);
  }

  // Load configuration from local host config in workspace
  const workspaceRoot = process.cwd();
  const hostConfigPath = join(workspaceRoot, "config/host.local.json");
  const hostConfig = JSON.parse(await readFile(hostConfigPath, "utf8").catch(async () => {
    return readFile(join(workspaceRoot, "config/host.local.example.json"), "utf8");
  }));

  const lock = await loadImageStackLock(workspaceRoot);

  if (isCheck) {
    const report = await inspectHostInstallation({ hostConfig, lock });
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ready ? 0 : 1);
  }

  if (isApply) {
    const confIdx = args.indexOf("--confirmation");
    const confirmation = confIdx !== -1 ? args[confIdx + 1] : "";
    if (confirmation !== "INSTALL_YADAM_IMAGE_STACK") {
      console.error("Error: --confirmation INSTALL_YADAM_IMAGE_STACK is required for --apply");
      process.exit(1);
    }
    const report = await applyHostInstallation({ hostConfig, lock, confirmation });
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
