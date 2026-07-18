#!/usr/bin/env node
import { assembleAllSegments, publishFinalVideo, loadFinalQa } from "./lib/yadam/video-service.mjs";
import { resolve } from "node:path";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  let jobDir = null;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--job-dir") {
      jobDir = resolve(args[i + 1]);
      break;
    }
  }

  if (!command || !jobDir) {
    console.error("Usage: node scripts/run_yadam_video.mjs <assemble|publish|status> --job-dir <jobDir>");
    process.exit(1);
  }

  try {
    if (command === "assemble") {
      const res = await assembleAllSegments({ jobDir });
      console.log(JSON.stringify(res, null, 2));
    } else if (command === "publish") {
      const res = await publishFinalVideo({ jobDir });
      console.log(JSON.stringify(res, null, 2));
    } else if (command === "status") {
      const res = await loadFinalQa(jobDir);
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.error(`Unknown command: ${command}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(JSON.stringify({
      error: err.message,
      code: err.code,
      reportPath: err.reportPath
    }, null, 2));
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
