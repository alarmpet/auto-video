import { isAbsolute, resolve } from "node:path";
import { runFullTts, loadPassedAudioHandoff } from "./lib/yadam/tts-service.mjs";

function printResult(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    process.exitCode = 1;
    printResult({ code: "missing_command", message: "Usage: run|status --job-dir <path>" });
    return;
  }

  const command = args[0];
  if (command !== "run" && command !== "status") {
    process.exitCode = 1;
    printResult({ code: "invalid_command", message: "Command must be 'run' or 'status'" });
    return;
  }

  let jobDir = null;
  const flagMap = new Map();

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      if (flagMap.has(arg)) {
        process.exitCode = 1;
        printResult({ code: "duplicate_flag", message: `Duplicate flag: ${arg}` });
        return;
      }
      if (arg !== "--job-dir") {
        process.exitCode = 1;
        printResult({ code: "unknown_flag", message: `Unknown flag: ${arg}` });
        return;
      }
      jobDir = args[i + 1];
      flagMap.set(arg, jobDir);
      i++;
    } else {
      process.exitCode = 1;
      printResult({ code: "invalid_argument", message: `Unexpected positional argument: ${arg}` });
      return;
    }
  }

  if (!jobDir) {
    process.exitCode = 1;
    printResult({ code: "missing_job_dir", message: "Missing required flag: --job-dir" });
    return;
  }

  if (!isAbsolute(jobDir)) {
    process.exitCode = 1;
    printResult({ code: "relative_job_dir", message: "Job directory must be an absolute path" });
    return;
  }

  // Resolve and clean path
  const resolvedJobDir = resolve(jobDir).replaceAll("\\", "/");

  const controller = new AbortController();
  const signal = controller.signal;

  // Handle Ctrl+C (SIGINT)
  process.on("SIGINT", () => {
    controller.abort();
    process.exitCode = 130;
  });

  if (command === "run") {
    try {
      const res = await runFullTts({ jobDir: resolvedJobDir, signal });
      if (res.status === "audio_passed") {
        process.exitCode = 0;
        printResult({
          ok: true,
          command,
          status: "audio_passed",
          audioManifestPath: res.audioManifestPath,
          audioTimelinePath: res.audioTimelinePath,
          renderPlanInputPath: res.renderPlanInputPath
        });
      } else if (res.status === "awaiting_reapproval") {
        process.exitCode = 0;
        printResult({
          ok: true,
          command,
          status: "awaiting_reapproval",
          revision: res.revision,
          bundlePath: res.bundlePath
        });
      } else if (res.status === "needs_review") {
        process.exitCode = 1;
        printResult({
          ok: false,
          command,
          status: "needs_review",
          reason: res.reason,
          errorCode: res.errorCode,
          reportPath: res.reportPath
        });
      } else {
        process.exitCode = 1;
        printResult({ ok: false, command, status: "unknown", error: res });
      }
    } catch (err) {
      if (err.name === "AbortError" || signal.aborted) {
        process.exitCode = 130;
        printResult({ code: "cancelled", message: "Operation was aborted" });
      } else {
        process.exitCode = 1;
        printResult({ code: err.code || "execution_failed", message: err.message });
      }
    }
  } else if (command === "status") {
    try {
      const res = await loadPassedAudioHandoff(resolvedJobDir);
      process.exitCode = 0;
      printResult({
        ok: true,
        command,
        status: "audio_passed",
        audioManifestPath: res.audioManifestPath,
        audioTimelinePath: res.audioTimelinePath,
        renderPlanInputPath: res.renderPlanInputPath,
        measuredAudioSeconds: res.measuredAudioSeconds
      });
    } catch (err) {
      process.exitCode = 1;
      printResult({
        ok: false,
        command,
        status: "not_passed",
        code: err.code || "audio_handoff_not_passed",
        message: err.message
      });
    }
  }
}

main().catch(err => {
  console.error("Fatal CLI Error:", err);
  process.exit(1);
});
