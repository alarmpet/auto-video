import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, cp, mkdir, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadImageStackLock, verifyLockedFile } from "../../scripts/lib/yadam/images/model-lock.mjs";
import { inspectHostInstallation, applyHostInstallation } from "../../scripts/lib/yadam/images/host-installer.mjs";

test("yadam image lock pins immutable sources", async () => {
  const lock = await loadImageStackLock(process.cwd());
  assert.equal(lock.stackId, "yadam-sdxl-ipadapter-v1");
  assert.equal(lock.customNode.commit, "b188a6cb39b512a9c6da7235b880af42c78ccd0d");
  assert.equal(lock.models.clipVision.sizeBytes, 2528373448);
  assert.equal(lock.models.clipVision.sha256, "6ca9667da1ca9e0b0f75e46bb030f7e011f44f86cbfb8d5a36590fcd7507b030");
  assert.equal(lock.models.ipAdapter.sizeBytes, 847517512);
  assert.equal(lock.models.ipAdapter.sha256, "677ad8860204f7d0bfba12d29e6c31ded9beefdf3e4bbd102518357d31a292c1");
  assert.equal(lock.ollamaVision.model, "gemma4:12b");
  assert.equal(lock.ollamaVision.digest, "4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c");
  assert.equal(lock.ollamaVision.sizeBytes, 7556508396);
  assert.equal(lock.ollamaVision.quantization, "Q4_K_M");
  assert.match(lock.modelLockHash, /^[0-9a-f]{64}$/);
});

test("locked file rejects byte drift", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yadam-lock-"));
  const file = join(dir, "model.bin");
  await writeFile(file, Buffer.from("wrong"));
  await assert.rejects(
    verifyLockedFile(file, { sizeBytes: 5, sha256: "0".repeat(64) }),
    error => error.code === "locked_file_hash_mismatch"
  );
});

test("host apply requires exact confirmation", async () => {
  await assert.rejects(
    applyHostInstallation({ hostConfig: {}, lock: {}, confirmation: "wrong" }),
    error => error.code === "external_change_confirmation_required"
  );
});

test("migration removes ambiguous root and preserves legacy LoRAs by copy", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yadam-host-"));
  const comfyRoot = join(dir, "ComfyUI");
  const legacyRoot = join(dir, "hermes_models");
  await mkdir(join(comfyRoot, "models", "loras"), { recursive: true });
  await mkdir(legacyRoot, { recursive: true });
  await cp("test/yadam/fixtures/images/extra-model-paths-polluted.yaml", join(comfyRoot, "extra_model_paths.yaml"));
  await writeFile(join(legacyRoot, "a.safetensors"), Buffer.from("legacy-a"));
  const realLock = await import("../../scripts/lib/yadam/images/model-lock.mjs").then(m => m.loadImageStackLock(process.cwd()));
  const lock = {
    ...realLock,
    legacyMigration: {
      extraModelPaths: join(comfyRoot, "extra_model_paths.yaml"),
      legacyRoot,
      acceptedInputSha256: await import("../../scripts/lib/yadam/images/model-lock.mjs").then(async m => m.sha256File(join(comfyRoot, "extra_model_paths.yaml"))),
      legacyLoras: [{ filename: "a.safetensors", sizeBytes: 8, sha256: "655c53155857aae2c2ceae22976dbdb221d73745a28cd24dfb67e9a8b385d42f" }]
    }
  };
  const report = await applyHostInstallation({
    hostConfig: { comfyui: { portableRoot: dir } },
    lock,
    confirmation: "INSTALL_YADAM_IMAGE_STACK",
    installModels: false,
    installCustomNode: false
  });
  const yamlText = await readFile(join(comfyRoot, "extra_model_paths.yaml"), "utf8");
  assert.equal(yamlText.includes("checkpoints: ."), false);
  assert.equal(report.legacyLorasCopied, 1);
});

test("inspection and apply report custom_node_commit_mismatch if commit differs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yadam-host-git-"));
  const comfyRoot = join(dir, "ComfyUI");
  const targetPath = join(comfyRoot, "custom_nodes", "comfyui-ipadapter");
  await mkdir(targetPath, { recursive: true });
  
  const fakeSpawn = () => {
    return {
      stdout: {
        on: (evt, cb) => {
          if (evt === 'data') cb(Buffer.from("0000000000000000000000000000000000000000\n"));
        }
      },
      stderr: { on: () => {} },
      once: (evt, cb) => {
        if (evt === 'exit') cb(0);
      }
    };
  };

  const lock = {
    customNode: { targetPath, commit: "b188a6cb39b512a9c6da7235b880af42c78ccd0d" },
    checkpoint: { path: join(dir, "ckpt.safetensors"), sizeBytes: 5, sha256: "0".repeat(64) },
    models: {
      clipVision: { targetPath: join(dir, "clip.safetensors"), sizeBytes: 5, sha256: "0".repeat(64) },
      ipAdapter: { targetPath: join(dir, "ip.safetensors"), sizeBytes: 5, sha256: "0".repeat(64) }
    },
    legacyMigration: { extraModelPaths: join(comfyRoot, "extra_model_paths.yaml") }
  };
  
  await writeFile(lock.checkpoint.path, Buffer.from("wrong"));
  await writeFile(lock.models.clipVision.targetPath, Buffer.from("wrong"));
  await writeFile(lock.models.ipAdapter.targetPath, Buffer.from("wrong"));
  await writeFile(lock.legacyMigration.extraModelPaths, "{}");

  const report = await inspectHostInstallation({ hostConfig: {}, lock, spawnImpl: fakeSpawn });
  assert.equal(report.customNodeStatus, "custom_node_commit_mismatch");
});

test("streamed response exceeding sizeBytes throws model_download_oversized and cleans up .part file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yadam-host-download-"));
  const targetPath = join(dir, "ComfyUI", "models", "model.bin");
  const lock = {
    legacyMigration: {
      extraModelPaths: join(dir, "extra_model_paths.yaml"),
      legacyRoot: join(dir, "legacy"),
      legacyLoras: []
    },
    models: {
      clipVision: { targetPath, sizeBytes: 5, sha256: "0".repeat(64), url: "http://example.com/model" },
      ipAdapter: { targetPath: join(dir, "ComfyUI", "models", "ip.bin"), sizeBytes: 5, sha256: "0".repeat(64) }
    }
  };
  await writeFile(lock.legacyMigration.extraModelPaths, "{}");

  const fakeFetch = async () => {
    let called = false;
    const stream = new ReadableStream({
      pull(controller) {
        if (!called) {
          controller.enqueue(Buffer.from("123456"));
          called = true;
        } else {
          controller.close();
        }
      }
    });
    return {
      ok: true,
      body: stream,
      headers: new Map([["content-length", "6"]])
    };
  };

  await assert.rejects(
    applyHostInstallation({
      hostConfig: { comfyui: { portableRoot: dir } },
      lock,
      confirmation: "INSTALL_YADAM_IMAGE_STACK",
      installModels: true,
      installCustomNode: false,
      fetchImpl: fakeFetch
    }),
    error => error.code === "model_download_oversized"
  );

  const existsTarget = await access(targetPath).then(() => true, () => false);
  const existsPart = await access(targetPath + ".part").then(() => true, () => false);
  assert.equal(existsTarget, false);
  assert.equal(existsPart, false);
});
