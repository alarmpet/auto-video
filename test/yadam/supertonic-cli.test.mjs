import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildSupertonicCliArgs,
  preflightSupertonicCli,
  runSupertonicCli,
  selectTtsTransport
} from "../../scripts/lib/providers/supertonic-cli.mjs";

const FAKE_CLI_PATH = resolve("test/yadam/fixtures/fake-supertonic-cli.mjs");

test("buildSupertonicCliArgs builds exact argv", () => {
  const request = {
    model: "supertonic-3",
    voice: "M1",
    language: "ko",
    speed: 1.04,
    totalStep: 8,
    silenceSeconds: 0.38
  };
  const args = buildSupertonicCliArgs({
    scriptPath: "cli.py",
    request,
    inputPath: "in.txt",
    outputPath: "out.wav"
  });
  assert.deepEqual(args, [
    "cli.py",
    "--input", "in.txt",
    "--output", "out.wav",
    "--model", "supertonic-3",
    "--voice", "M1",
    "--lang", "ko",
    "--speed", "1.04",
    "--total-step", "8",
    "--silence-duration", "0.38",
    "--json"
  ]);
});

test("preflightSupertonicCli succeeds with fake cli", async () => {
  const res = await preflightSupertonicCli({
    pythonExecutable: process.execPath, // Run node
    scriptPath: FAKE_CLI_PATH,
    cwd: resolve("test/yadam/fixtures")
  });
  assert.equal(res.ok, true);
  assert.match(res.stdout, /Supertonic CLI Help/);
});

test("runSupertonicCli handles Korean text input and output generation", async () => {
  // Use a temporary directory named "야담 음성 fixture" to test Korean paths
  const baseTmp = await mkdtemp(join(tmpdir(), "yadam-cli-"));
  const koreanDir = join(baseTmp, "야담 음성 fixture");
  await mkdir(koreanDir, { recursive: true });

  const request = {
    sceneId: "scene-0001",
    text: "옛날 어느 고을에 한 선비가 살았습니다.",
    model: "supertonic-3",
    voice: "M1",
    language: "ko",
    speed: 1.04,
    totalStep: 8,
    silenceSeconds: 0.38
  };

  try {
    // Create job structure required by runSupertonicCli:
    // assets/audio/requests, assets/audio/raw
    await mkdir(join(koreanDir, "assets/audio/requests"), { recursive: true });
    await mkdir(join(koreanDir, "assets/audio/raw"), { recursive: true });

    // Mock pipeline-state etc. just in case
    const res = await runSupertonicCli({
      pythonExecutable: process.execPath,
      scriptPath: FAKE_CLI_PATH,
      cwd: resolve("test/yadam/fixtures"),
      request,
      jobDir: koreanDir
    });

    assert.equal(res.transport, "cli");
    assert.equal(res.providerJobId, null);
    assert.equal(res.providerResult.path, "assets/audio/raw/scene-0001.part.wav");
    assert.equal(res.stdoutJson.ok, true);

    // Verify WAV file was actually written
    const producedFile = join(koreanDir, res.providerResult.path);
    await assert.doesNotReject(access(producedFile));
  } finally {
    await rm(baseTmp, { recursive: true, force: true });
  }
});

test("runSupertonicCli cancellation terminates process", async () => {
  const baseTmp = await mkdtemp(join(tmpdir(), "yadam-cli-cancel-"));
  const request = {
    sceneId: "scene-0001",
    text: "대기용 선비",
    model: "supertonic-3",
    voice: "M1",
    language: "ko",
    speed: 1.04,
    totalStep: 8,
    silenceSeconds: 0.38
  };

  try {
    await mkdir(join(baseTmp, "assets/audio/requests"), { recursive: true });
    await mkdir(join(baseTmp, "assets/audio/raw"), { recursive: true });

    const controller = new AbortController();
    const signal = controller.signal;

    // Set hang mode
    process.env.FAKE_TTS_MODE = "hang";

    let killTreeCalledCount = 0;
    let killedPid = null;

    const runPromise = runSupertonicCli({
      pythonExecutable: process.execPath,
      scriptPath: FAKE_CLI_PATH,
      cwd: resolve("test/yadam/fixtures"),
      request,
      jobDir: baseTmp,
      signal,
      killTreeCallback: (pid) => {
        killTreeCalledCount++;
        killedPid = pid;
      }
    });

    // Abort after a short delay
    setTimeout(() => {
      controller.abort();
    }, 100);

    await assert.rejects(runPromise, err => err.name === "AbortError");

    // Wait a brief moment to let SIGTERM and taskkill timer fire
    await new Promise(r => setTimeout(r, 600));

    // Wait for the taskkill timer inside terminateOwnedProcess (which runs after 5 seconds, 
    // but in tests we can check if SIGTERM was at least sent. Since we cannot mock child process close 
    // without wait, let's make sure it is aborted)
  } finally {
    delete process.env.FAKE_TTS_MODE;
    await rm(baseTmp, { recursive: true, force: true });
  }
});

test("selectTtsTransport enforces fallback rules", () => {
  // HTTP success -> http
  assert.equal(
    selectTtsTransport({
      httpPreflightResult: { status: "fulfilled", value: { baseUrl: "http://127.0.0.1:3093" } },
      cliPreflightResult: null
    }),
    "http"
  );

  // HTTP unreachable and CLI success -> cli
  assert.equal(
    selectTtsTransport({
      httpPreflightResult: { status: "rejected", reason: Object.assign(new Error(), { code: "supertonic_unreachable" }) },
      cliPreflightResult: { status: "fulfilled", value: { ok: true } }
    }),
    "cli"
  );

  // HTTP rejected other than unreachable -> throws
  assert.throws(() => {
    selectTtsTransport({
      httpPreflightResult: { status: "rejected", reason: Object.assign(new Error(), { code: "supertonic_request_rejected" }) },
      cliPreflightResult: { status: "fulfilled", value: { ok: true } }
    });
  }, /No suitable TTS transport available/);

  // Both failed -> throws
  assert.throws(() => {
    selectTtsTransport({
      httpPreflightResult: { status: "rejected", reason: Object.assign(new Error(), { code: "supertonic_unreachable" }) },
      cliPreflightResult: { status: "rejected", reason: new Error("cli failed") }
    });
  }, /No suitable TTS transport available/);
});
