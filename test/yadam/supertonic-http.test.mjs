import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { runAsyncTtsJob, preflightSupertonicHttp } from "../../scripts/lib/providers/supertonic-http.mjs";

test("preflightSupertonicHttp handles successful health check", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, output_dir: "/data", model_loaded: true }));
    } else {
      res.writeHead(404).end();
    }
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await preflightSupertonicHttp({ baseUrl, timeoutMs: 1000 });
    assert.equal(res.outputDir, "/data");
    assert.equal(res.modelLoaded, true);
  } finally {
    server.close();
  }
});

test("runAsyncTtsJob runs successfully with a fake server", async () => {
  let postCount = 0;
  let getCount = 0;

  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/tts-job") {
      postCount++;
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, job_id: "prov-job-123" }));
    } else if (req.method === "GET" && req.url === "/api/tts-job/prov-job-123") {
      getCount++;
      res.writeHead(200, { "Content-Type": "application/json" });
      if (getCount === 1) {
        res.end(JSON.stringify({ status: "running" }));
      } else {
        res.end(JSON.stringify({
          status: "done",
          result: {
            ok: true,
            path: "audio.wav",
            duration: 5.5,
            sample_rate: 48000,
            model: "supertonic-3",
            voice: "M1",
            lang: "ko",
            speed: 1.04,
            total_step: 8,
            silence_duration: 0.38
          }
        }));
      }
    } else {
      res.writeHead(404).end();
    }
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let acceptedCalled = false;
  let ambiguousCalled = false;

  const request = {
    text: "테스트", model: "supertonic-3", voice: "M1", language: "ko", speed: 1.04, totalStep: 8, silenceSeconds: 0.38
  };

  try {
    const res = await runAsyncTtsJob({
      baseUrl,
      request,
      onAccepted: async ({ providerJobId }) => {
        assert.equal(providerJobId, "prov-job-123");
        acceptedCalled = true;
      },
      onAmbiguous: async () => {
        ambiguousCalled = true;
      },
      pollIntervalMs: 50,
      deadlineMs: 5000
    });

    assert.equal(res.transport, "http");
    assert.equal(res.providerJobId, "prov-job-123");
    assert.equal(res.providerResult.path, "audio.wav");
    assert.equal(postCount, 1);
    assert.equal(getCount, 2);
    assert.equal(acceptedCalled, true);
    assert.equal(ambiguousCalled, false);
  } finally {
    server.close();
  }
});

test("runAsyncTtsJob classifies connection refusal", async () => {
  const request = {
    text: "테스트", model: "supertonic-3", voice: "M1", language: "ko", speed: 1.04, totalStep: 8, silenceSeconds: 0.38
  };
  await assert.rejects(
    runAsyncTtsJob({
      baseUrl: "http://127.0.0.1:30999", // Unreachable port
      request,
      onAccepted: async () => {},
      onAmbiguous: async () => {},
      pollIntervalMs: 50,
      deadlineMs: 5000
    }),
    err => err.code === "supertonic_unreachable"
  );
});

test("runAsyncTtsJob classifies HTTP 400 as non-transient request rejection", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "bad voice" }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const request = {
    text: "테스트", model: "supertonic-3", voice: "M1", language: "ko", speed: 1.04, totalStep: 8, silenceSeconds: 0.38
  };

  try {
    await assert.rejects(
      runAsyncTtsJob({
        baseUrl,
        request,
        onAccepted: async () => {},
        onAmbiguous: async () => {},
        pollIntervalMs: 50
      }),
      err => err.code === "supertonic_request_rejected"
    );
  } finally {
    server.close();
  }
});

test("runAsyncTtsJob handles ambiguous submission on socket close", async () => {
  const server = http.createServer((req, res) => {
    // Destroy socket after reading some body
    req.socket.destroy();
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const request = {
    text: "테스트", model: "supertonic-3", voice: "M1", language: "ko", speed: 1.04, totalStep: 8, silenceSeconds: 0.38
  };

  let ambiguousCalled = false;
  let causeCode = null;

  try {
    await assert.rejects(
      runAsyncTtsJob({
        baseUrl,
        request,
        onAccepted: async () => {},
        onAmbiguous: async (evidence) => {
          ambiguousCalled = true;
          causeCode = evidence.causeCode;
        },
        pollIntervalMs: 50
      }),
      err => err.code === "supertonic_submission_ambiguous"
    );
    assert.equal(ambiguousCalled, true);
    assert.equal(causeCode, "post_connect_error");
  } finally {
    server.close();
  }
});
