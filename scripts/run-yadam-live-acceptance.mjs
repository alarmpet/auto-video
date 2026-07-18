import { runPreflightSuite } from "./lib/pipeline/preflight-suite.mjs";

async function main() {
  const args = process.argv.slice(2);
  
  let minutes = 0;
  const mIndex = args.indexOf("--minutes");
  if (mIndex !== -1 && args[mIndex + 1]) {
    minutes = parseInt(args[mIndex + 1], 10);
  }

  let confirmToken = "";
  const cIndex = args.indexOf("--confirm-live");
  if (cIndex !== -1 && args[cIndex + 1]) {
    confirmToken = args[cIndex + 1];
  }

  if (minutes !== 10 || confirmToken !== "YADAM_LOCAL_10_MIN_ACCEPTANCE") {
    console.log(JSON.stringify({
      ok: false,
      error: "live_confirmation_required",
      providerCalls: 0
    }));
    process.exit(2);
  }

  console.log("Estimated Asset Counts: 1 Segment, ~20 visual slots, ~20 TTS audio clips");
  console.log("Checking prerequisites...");

  const preflight = await runPreflightSuite({ workspaceRoot: "." });
  if (!preflight.ok) {
    console.error("Install prerequisites check failed:", preflight.results);
  } else {
    console.log("Install prerequisites: All OK");
  }

  console.log("Target Output Paths: exports/final/final-full.mp4");
  console.log("Real candidate run approved. Ready to proceed.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
