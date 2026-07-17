import http from "node:http";
import { URL } from "node:url";

export function toSupertonicPayload(request) {
  return {
    text: request.text,
    model: request.model,
    voice: request.voice,
    lang: request.language,
    speed: request.speed,
    total_step: request.totalStep,
    silence_duration: request.silenceSeconds,
  };
}

function assertLoopbackHttp(urlStr) {
  const url = new URL(urlStr);
  if (url.protocol !== "http:") {
    throw new Error(`Forbidden protocol: ${url.protocol}. Only http: is allowed.`);
  }
  const hostname = url.hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(`Forbidden origin: ${hostname}. Only loopback (127.0.0.1/localhost) is allowed.`);
  }
}

export async function preflightSupertonicHttp({ baseUrl, signal, timeoutMs = 5000 }) {
  assertLoopbackHttp(baseUrl);
  const healthUrl = new URL("/health", baseUrl).toString();

  const signals = [signal, AbortSignal.timeout(timeoutMs)].filter(Boolean);
  const combinedSignal = AbortSignal.any(signals);

  try {
    const res = await fetch(healthUrl, {
      method: "GET",
      signal: combinedSignal,
      redirect: "error"
    });

    if (!res.ok) {
      throw Object.assign(new Error(`Health check returned status ${res.status}`), {
        code: "supertonic_unreachable",
        status: res.status
      });
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw Object.assign(new Error("Health check response is not JSON"), {
        code: "supertonic_unreachable"
      });
    }

    const bodyText = await res.text();
    if (bodyText.length > 1024 * 1024) {
      throw Object.assign(new Error("Health check response exceeded 1 MiB"), {
        code: "supertonic_unreachable"
      });
    }

    const data = JSON.parse(bodyText);
    if (data.ok !== true) {
      throw Object.assign(new Error("Health check returned ok: false"), {
        code: "supertonic_unreachable"
      });
    }

    return {
      baseUrl,
      outputDir: data.output_dir,
      modelLoaded: data.model_loaded
    };
  } catch (err) {
    if (err.name === "TimeoutError" || err.code === "UND_ERR_ABORTED" || err.code === "ECONNREFUSED") {
      throw Object.assign(new Error(`Supertonic health unreachable: ${err.message}`), {
        code: "supertonic_unreachable",
        cause: err
      });
    }
    throw err;
  }
}

export function submitTtsJob({ baseUrl, payload, onAccepted, signal, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    assertLoopbackHttp(baseUrl);
    const postUrl = new URL("/api/tts-job", baseUrl);

    const bodyBytes = Buffer.from(JSON.stringify(payload), "utf8");

    let bodyStarted = false;
    let requestAborted = false;

    const options = {
      method: "POST",
      hostname: postUrl.hostname,
      port: postUrl.port || 80,
      path: postUrl.pathname,
      agent: false,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": bodyBytes.length
      }
    };

    const req = http.request(options);

    const cleanupSignal = () => {
      requestAborted = true;
      req.destroy(new DOMException("The user aborted a request.", "AbortError"));
    };

    if (signal) {
      if (signal.aborted) {
        return reject(new DOMException("The user aborted a request.", "AbortError"));
      }
      signal.addEventListener("abort", cleanupSignal);
    }

    const timeoutTimer = setTimeout(() => {
      req.destroy(Object.assign(new Error("Request timeout"), { code: "ETIMEDOUT" }));
    }, timeoutMs);

    req.on("socket", (socket) => {
      if (socket.connecting) {
        socket.once("connect", () => {
          if (requestAborted) return;
          bodyStarted = true;
          req.end(bodyBytes);
        });
      } else {
        bodyStarted = true;
        req.end(bodyBytes);
      }
    });

    req.on("error", (err) => {
      clearTimeout(timeoutTimer);
      if (signal) signal.removeEventListener("abort", cleanupSignal);

      const isPreBody = !bodyStarted;
      // Classify error
      if (err.name === "AbortError" || err.message?.includes("aborted")) {
        if (isPreBody) {
          return reject(new DOMException("The user aborted a request.", "AbortError"));
        } else {
          // post-body cancellation: must throw structured error after caller persists orphan
          return reject(Object.assign(new Error("Aborted after body transmission"), {
            code: "supertonic_submission_ambiguous",
            causeCode: "cancel_after_post_body",
            isPreBody: false
          }));
        }
      }

      if (isPreBody) {
        reject(Object.assign(new Error(`Pre-connect submission failed: ${err.message}`), {
          code: "supertonic_unreachable",
          isPreBody: true
        }));
      } else {
        reject(Object.assign(new Error(`Post-connect submission failed: ${err.message}`), {
          code: "supertonic_submission_ambiguous",
          causeCode: "post_connect_error",
          isPreBody: false,
          originalError: err
        }));
      }
    });

    req.on("response", (res) => {
      clearTimeout(timeoutTimer);
      if (signal) signal.removeEventListener("abort", cleanupSignal);

      const chunks = [];
      let size = 0;

      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > 1024 * 1024) {
          req.destroy(new Error("Response limit exceeded 1 MiB"));
          return;
        }
        chunks.push(chunk);
      });

      res.on("end", async () => {
        try {
          const bodyText = Buffer.concat(chunks).toString("utf8");
          const statusCode = res.statusCode;

          if (statusCode === 400) {
            return reject(Object.assign(new Error(`HTTP 400: ${bodyText}`), {
              code: "supertonic_request_rejected",
              isPreBody: false
            }));
          }

          if (statusCode !== 202) {
            // Check if response is JSON and explicitly says job_created: false
            let isExplicitNoJob = false;
            let isRetryable = false;
            try {
              const data = JSON.parse(bodyText);
              if (data.job_created === false) {
                isExplicitNoJob = true;
                if (data.retryable === true) {
                  isRetryable = true;
                }
              }
            } catch {}

            if (isExplicitNoJob) {
              return reject(Object.assign(new Error(`Submission rejected by server: ${bodyText}`), {
                code: isRetryable ? "supertonic_retryable_rejection" : "supertonic_request_rejected",
                isPreBody: true // proven safe to retry if job_created is false
              }));
            }

            return reject(Object.assign(new Error(`HTTP status ${statusCode}: ${bodyText}`), {
              code: "supertonic_submission_ambiguous",
              causeCode: `http_${statusCode}`,
              isPreBody: false
            }));
          }

          let data;
          try {
            data = JSON.parse(bodyText);
          } catch (jsonErr) {
            return reject(Object.assign(new Error(`Malformed JSON response: ${bodyText}`), {
              code: "supertonic_submission_ambiguous",
              causeCode: "malformed_response_json",
              isPreBody: false
            }));
          }

          if (!data.ok || !data.job_id) {
            return reject(Object.assign(new Error(`Invalid response envelope: ${bodyText}`), {
              code: "supertonic_submission_ambiguous",
              causeCode: "invalid_response_envelope",
              isPreBody: false
            }));
          }

          const providerJobId = data.job_id;
          try {
            await onAccepted({ providerJobId, response: data });
            resolve({ providerJobId, response: data });
          } catch (callbackErr) {
            // Callback write failure is fatal and ambiguous
            reject(Object.assign(new Error(`Callback persist failed: ${callbackErr.message}`), {
              code: "supertonic_submission_ambiguous",
              causeCode: "supertonic_checkpoint_persist_failed",
              providerJobId,
              isPreBody: false
            }));
          }
        } catch (err) {
          reject(Object.assign(err, {
            code: "supertonic_submission_ambiguous",
            isPreBody: false
          }));
        }
      });
    });
  });
}

export async function pollTtsJob({ baseUrl, providerJobId, signal, pollIntervalMs = 1000, deadlineMs = 900000 }) {
  assertLoopbackHttp(baseUrl);
  const getUrl = new URL(`/api/tts-job/${providerJobId}`, baseUrl).toString();
  const startTime = Date.now();

  while (true) {
    if (signal?.aborted) {
      throw new DOMException("The user aborted a request.", "AbortError");
    }

    if (Date.now() - startTime > deadlineMs) {
      throw Object.assign(new Error("Polling timeout exceeded"), {
        code: "supertonic_poll_timeout"
      });
    }

    try {
      const res = await fetch(getUrl, {
        method: "GET",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
        redirect: "error"
      });

      if (res.status === 404) {
        throw Object.assign(new Error("Job not found"), {
          code: "supertonic_job_lost"
        });
      }

      if (!res.ok) {
        // Poll transient errors do not fail immediately, they just wait for the next iteration unless timeout
      } else {
        const bodyText = await res.text();
        const data = JSON.parse(bodyText);

        const status = data.status; //queued, running, done, error
        if (status === "done") {
          if (data.result && data.result.ok === true) {
            return data.result;
          } else {
            throw Object.assign(new Error("Job done with error result"), {
              code: "supertonic_job_failed",
              result: data.result
            });
          }
        } else if (status === "error") {
          throw Object.assign(new Error("Job failed"), {
            code: "supertonic_job_failed",
            result: data.result || data.error
          });
        }
      }
    } catch (err) {
      if (err.code === "supertonic_job_lost" || err.code === "supertonic_job_failed") {
        throw err;
      }
      // other errors are treated as transient poll errors and retried until timeout
    }

    // sleep
    await new Promise((resolveSleep, rejectSleep) => {
      const t = setTimeout(resolveSleep, pollIntervalMs);
      if (signal) {
        signal.addEventListener("abort", () => {
          clearTimeout(t);
          rejectSleep(new DOMException("The user aborted a request.", "AbortError"));
        }, { once: true });
      }
    });
  }
}

export async function runAsyncTtsJob({ baseUrl, request, onAccepted, onAmbiguous, signal, pollIntervalMs = 1000, deadlineMs = 900000 }) {
  const payload = toSupertonicPayload(request);
  let attempt = 0;
  const maxAttempts = 3;

  while (true) {
    attempt++;
    try {
      if (signal?.aborted) {
        throw new DOMException("The user aborted a request.", "AbortError");
      }

      const res = await submitTtsJob({
        baseUrl,
        payload,
        onAccepted,
        signal,
        timeoutMs: 15000
      });

      // Poll
      const result = await pollTtsJob({
        baseUrl,
        providerJobId: res.providerJobId,
        signal,
        pollIntervalMs,
        deadlineMs
      });

      return {
        transport: "http",
        providerJobId: res.providerJobId,
        providerResult: result,
        elapsedMs: 0 // Will be computed by caller or track timestamps
      };
    } catch (err) {
      if (err.name === "AbortError" || err.code === "AbortError") {
        // cancellation
        if (err.isPreBody === false) {
          // Cancelled after body transmission: must record orphan
          await onAmbiguous({
            causeCode: "cancel_after_post_body",
            error: err,
            attempt
          });
          throw Object.assign(new DOMException("The user aborted a request.", "AbortError"), {
            causeCode: "cancel_after_post_body"
          });
        }
        throw err;
      }

      const isRetryable = err.isPreBody === true || err.code === "supertonic_retryable_rejection";
      if (isRetryable && attempt < maxAttempts) {
        const delay = attempt === 1 ? 250 : 1000;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      // If ambiguous, write orphan checkpoint
      if (err.code === "supertonic_submission_ambiguous") {
        await onAmbiguous({
          causeCode: err.causeCode,
          error: err,
          providerJobId: err.providerJobId,
          attempt
        });
        throw err;
      }

      // non-ambiguous errors
      throw err;
    }
  }
}
