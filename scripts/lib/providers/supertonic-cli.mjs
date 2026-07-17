import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { writeUtf8Atomic } from "../pipeline/atomic-store.mjs";

export function buildSupertonicCliArgs({ scriptPath, request, inputPath, outputPath }) {
  return [
    scriptPath,
    "--input", inputPath,
    "--output", outputPath,
    "--model", request.model,
    "--voice", request.voice,
    "--lang", request.language,
    "--speed", String(request.speed),
    "--total-step", String(request.totalStep),
    "--silence-duration", String(request.silenceSeconds),
    "--json",
  ];
}

export async function preflightSupertonicCli({ pythonExecutable, scriptPath, cwd, signal, timeoutMs = 15000 }) {
  if (!pythonExecutable || !scriptPath || !cwd) {
    throw new Error("missing CLI config parameters");
  }

  const absPython = resolve(pythonExecutable);
  const absScript = resolve(scriptPath);
  const absCwd = resolve(cwd);

  if (!existsSync(absPython)) throw new Error(`pythonExecutable does not exist: ${absPython}`);
  if (!existsSync(absScript)) throw new Error(`scriptPath does not exist: ${absScript}`);
  if (!existsSync(absCwd)) throw new Error(`cwd does not exist: ${absCwd}`);

  return new Promise((resolvePromise, rejectPromise) => {
    const combinedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);

    const proc = spawn(absPython, [absScript, "--help"], {
      cwd: absCwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      signal: combinedSignal
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => { stdout += chunk; });
    proc.stderr.on("data", (chunk) => { stderr += chunk; });

    proc.on("error", (err) => {
      rejectPromise(Object.assign(new Error(`Failed to execute CLI preflight: ${err.message}`), {
        code: "supertonic_cli_preflight_failed",
        cause: err
      }));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolvePromise({ ok: true, stdout });
      } else {
        rejectPromise(Object.assign(new Error(`CLI preflight exited with code ${code}. Stderr: ${stderr}`), {
          code: "supertonic_cli_preflight_failed",
          exitCode: code,
          stderr
        }));
      }
    });
  });
}

// Graceful child killer helper
export function terminateOwnedProcess(proc, graceMs = 5000, killTreeCallback = null) {
  if (!proc || proc.killed || proc.exitCode !== null) return;

  proc.kill("SIGTERM");

  const timer = setTimeout(() => {
    // If still alive, force kill
    if (proc.exitCode === null) {
      if (process.platform === "win32") {
        if (killTreeCallback) {
          killTreeCallback(proc.pid);
        } else {
          try {
            spawn("C:/Windows/System32/taskkill.exe", ["/PID", String(proc.pid), "/T", "/F"], {
              shell: false,
              windowsHide: true
            });
          } catch {}
        }
      } else {
        proc.kill("SIGKILL");
      }
    }
  }, graceMs);

  proc.on("close", () => {
    clearTimeout(timer);
  });
}

export async function runSupertonicCli({ pythonExecutable, scriptPath, cwd, request, jobDir, signal, killTreeCallback = null }) {
  const startTime = Date.now();

  const relativeInputPath = `assets/audio/requests/${request.sceneId}.txt`;
  const relativeOutputPath = `assets/audio/raw/${request.sceneId}.part.wav`;

  const absInputPath = resolve(jobDir, relativeInputPath);
  const absOutputPath = resolve(jobDir, relativeOutputPath);

  // Write nfc text
  await writeUtf8Atomic(absInputPath, request.text.normalize("NFC") + "\n");

  const args = buildSupertonicCliArgs({
    scriptPath: resolve(scriptPath),
    request,
    inputPath: absInputPath,
    outputPath: absOutputPath
  });

  return new Promise((resolvePromise, rejectPromise) => {
    if (signal?.aborted) {
      return rejectPromise(new DOMException("The user aborted a request.", "AbortError"));
    }

    const proc = spawn(resolve(pythonExecutable), args, {
      cwd: resolve(cwd),
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let stdoutCapExceeded = false;
    let stderrCapExceeded = false;

    proc.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024) {
        stdoutCapExceeded = true;
        terminateOwnedProcess(proc, 1000, killTreeCallback);
      }
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 1024 * 1024) {
        stderrCapExceeded = true;
        terminateOwnedProcess(proc, 1000, killTreeCallback);
      }
    });

    const abortHandler = () => {
      terminateOwnedProcess(proc, 5000, killTreeCallback);
    };

    if (signal) {
      signal.addEventListener("abort", abortHandler);
    }

    proc.on("error", (err) => {
      if (signal) signal.removeEventListener("abort", abortHandler);
      rejectPromise(Object.assign(new Error(`CLI spawn error: ${err.message}`), {
        code: "supertonic_cli_failed",
        cause: err
      }));
    });

    proc.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", abortHandler);

      const elapsedMs = Date.now() - startTime;

      if (signal?.aborted) {
        return rejectPromise(new DOMException("The user aborted a request.", "AbortError"));
      }

      if (stdoutCapExceeded || stderrCapExceeded) {
        return rejectPromise(Object.assign(new Error("CLI output buffer size limit exceeded 1 MiB"), {
          code: "supertonic_cli_failed"
        }));
      }

      if (code !== 0) {
        return rejectPromise(Object.assign(new Error(`CLI process exited with code ${code}. Stderr: ${stderr}`), {
          code: "supertonic_cli_failed",
          exitCode: code,
          stderr
        }));
      }

      const lines = stdout.trim().split("\n");
      const lastLine = lines[lines.length - 1];
      let parsed;
      try {
        parsed = JSON.parse(lastLine);
      } catch (err) {
        return rejectPromise(Object.assign(new Error(`CLI stdout JSON parse failed on last line: ${lastLine}`), {
          code: "supertonic_cli_failed"
        }));
      }

      if (parsed.ok !== true) {
        return rejectPromise(Object.assign(new Error(`CLI reported ok: false. Result: ${stdout}`), {
          code: "supertonic_cli_failed"
        }));
      }

      resolvePromise({
        transport: "cli",
        providerJobId: null,
        providerResult: { path: relativeOutputPath },
        stdoutJson: parsed,
        elapsedMs
      });
    });
  });
}

export function selectTtsTransport({ httpPreflightResult, cliPreflightResult }) {
  if (httpPreflightResult && httpPreflightResult.status === "fulfilled") {
    return "http";
  }

  const httpErr = httpPreflightResult?.reason;
  if (httpErr && httpErr.code === "supertonic_unreachable") {
    if (cliPreflightResult && cliPreflightResult.status === "fulfilled") {
      return "cli";
    }
  }

  throw Object.assign(new Error("No suitable TTS transport available"), {
    code: "no_tts_transport_available",
    httpError: httpErr,
    cliError: cliPreflightResult?.reason
  });
}
