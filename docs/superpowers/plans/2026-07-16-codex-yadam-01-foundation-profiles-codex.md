# Codex 야담 기반·프로필·Codex CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 gguljam-bible 동작을 건드리지 않으면서 yadam 작업의 프로필, 정본 저장소, 상태·artifact 관리, Codex CLI stage 실행과 초기 CLI를 제공한다.

**Architecture:** 새 코드는 기존 `scripts/lib` 패턴을 따라 작고 독립적인 ES module로 추가한다. Pipeline core만 파일·상태·hash·의존성을 소유하고 Codex는 read-only sandbox에서 구조화 결과만 반환한다. 이후 대본·TTS·이미지·영상 계획은 이 계획이 고정한 public interface를 소비한다.

**Tech Stack:** Windows 11, Node.js 22.16.0 ES modules, npm 10.9.2, Ajv 8.20.0, json-canonicalize 2.0.0, Node built-in test runner, Codex CLI 0.144.0-alpha.4.

## Global Constraints

- 작업공간은 `C:/Users/petbl/auto-video`이며 현재 Git 저장소가 아니다.
- 실행 전 `git rev-parse --is-inside-work-tree`가 실패하면 `git init`을 자동 실행하지 말고 사용자에게 저장소 사용 여부를 요청한다.
- yadam 목표 시간은 10~120분, 10분 단위이며 duration tolerance는 0.20이다.
- production 정본 JSON은 UTF-8, Unicode NFC, BOM 없음, RFC 8785 canonical JSON과 SHA-256 lowercase hex를 사용한다.
- 모든 정본 write는 같은 디렉터리의 임시 파일에 쓴 뒤 검증하고 atomic rename한다.
- Codex child process는 `shell:false`, approval `never`, sandbox `read-only`, stdin prompt를 사용하며 model `gpt-5.6-sol`, reasoning effort `ultra`, `--ignore-user-config`, `--ignore-rules`, `--strict-config`를 명시한다. `--ignore-rules`는 execpolicy `.rules`만 제외하므로 `AGENTS.md`는 별도의 absent-or-pinned 검사로 통제한다.
- 사용자 문자열을 shell command에 보간하지 않는다.
- 오케스트레이터의 직접 write는 job root와 명시된 repo test fixture에 한정한다.
- gguljam-bible은 legacy compatibility profile로 유지하며 yadam strict 정책을 섞지 않는다.
- 실제 Codex smoke는 opt-in 한 건이며 일반 테스트는 fake executable을 사용한다.

---

## Locked File Map

| Path | Responsibility |
|---|---|
| `package.json` | Node module mode, exact dependencies와 test/CLI scripts |
| `.gitignore` | local host config, job export, dependency와 temp 제외 |
| `config/profiles/gguljam-bible.json` | 기존 파이프라인 compatibility boundary |
| `config/profiles/yadam.json` | 야담 content·media·strict gate 설정 정본 |
| `config/host.local.example.json` | 이 PC에서 확인한 executable·provider 경로 예시 |
| `schemas/pipeline/request.schema.json` | 새 job 입력 계약 |
| `schemas/pipeline/pipeline-state.schema.json` | 상태와 stage 실행 기록 계약 |
| `schemas/pipeline/artifact-manifest.schema.json` | artifact와 dependency hash 계약 |
| `scripts/auto-video-pipeline.mjs` | 초기 Node CLI entrypoint |
| `scripts/lib/pipeline/canonical-json.mjs` | NFC, JCS와 SHA-256 |
| `scripts/lib/pipeline/atomic-store.mjs` | atomic JSON/text read·write |
| `scripts/lib/pipeline/path-policy.mjs` | job/provider root containment |
| `scripts/lib/pipeline/schema-registry.mjs` | Ajv schema load·validation |
| `scripts/lib/pipeline/profile-registry.mjs` | profile·host config load와 validation |
| `scripts/lib/pipeline/job-store.mjs` | createJob·loadJob와 표준 폴더 생성 |
| `scripts/lib/pipeline/state-machine.mjs` | transitionJob과 append-only stage history |
| `scripts/lib/pipeline/success-evidence.mjs` | cross-subsystem success event의 canonical input/output projection |
| `scripts/lib/pipeline/artifact-store.mjs` | registerArtifact와 재사용 판정 |
| `scripts/lib/pipeline/dependency-graph.mjs` | reverse dependency invalidation |
| `scripts/lib/providers/codex-cli.mjs` | executable discovery·version·login preflight |
| `scripts/lib/pipeline/codex-stage-runner.mjs` | Codex JSONL process, timeout, schema와 promotion |
| `scripts/lib/pipeline/cli-args.mjs` | shell 없는 deterministic CLI argument parsing |
| `test/yadam/foundation.test.mjs` | request/profile/job/state/artifact tests |
| `test/yadam/codex-runner.test.mjs` | fake Codex process integration tests |
| `test/yadam/fixtures/fake-codex.mjs` | JSONL 성공·오류·timeout fixture |

## Public Interfaces Locked by This Plan

```js
// scripts/lib/pipeline/job-store.mjs
createJob({ workspaceRoot, request, profile, hostConfig }): Promise<JobContext>
loadJob(jobDir): Promise<JobContext>

// scripts/lib/pipeline/atomic-store.mjs
writeCanonicalJson(filePath, value): Promise<{ path, sha256, sizeBytes }>
writeUtf8Atomic(filePath, text): Promise<{ path, sha256, sizeBytes }>
writeBinaryAtomic(filePath, bytes): Promise<{ path, sha256, sizeBytes }>
writeCanonicalJsonExclusive(filePath, value): Promise<{ path, sha256, sizeBytes }>

// scripts/lib/pipeline/canonical-json.mjs
canonicalJson(value): string
sha256Bytes(input): string
hashCanonical(value): string

// scripts/lib/pipeline/artifact-store.mjs
registerArtifact(jobDir, record): Promise<ArtifactRecord>
canReuseArtifact(jobDir, artifactId, dependencyHashes): Promise<boolean>

// scripts/lib/pipeline/dependency-graph.mjs
invalidateFromChanges(jobDir, changedArtifactIds): Promise<ArtifactManifest>

// scripts/lib/pipeline/state-machine.mjs
transitionJob(jobDir, event): Promise<PipelineState>

// scripts/lib/pipeline/success-evidence.mjs
buildSuccessEvidence(stage, inputRecords, outputRecords, opaqueInputs):
  { inputHash: string, outputHash: string, artifactPaths: string[] }

// scripts/lib/pipeline/codex-stage-runner.mjs
runCodexStage({ jobDir, stageId, prompt, schemaPath, inputHash, timeoutMs, signal }):
  Promise<{ payload, outputHash, eventsPath, provenance }>
```

### Task 1: Establish the Node package and test harness

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `.gitignore`
- Create: `test/yadam/foundation.test.mjs`

**Interfaces:**
- Consumes: Node.js 22.16.0 and npm 10.9.2.
- Produces: `npm run test:yadam`, ESM imports, exact dependency lock.

- [ ] **Step 1: Verify the Git authority boundary**

Run: `git rev-parse --is-inside-work-tree`

Expected now: nonzero exit because this workspace is not a Git repository. Stop execution and obtain the user's Git choice before any later commit step; do not initialize a repository automatically. Continue writing files only when the execution session has explicit authority.

- [ ] **Step 2: Write the failing package smoke test**

Create `test/yadam/foundation.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";

test("test harness runs as ESM", () => {
  assert.equal(import.meta.url.startsWith("file:"), true);
});
```

- [ ] **Step 3: Run the test before package setup**

Run: `node --test test/yadam/foundation.test.mjs`

Expected: PASS. This proves Node itself works; `npm run test:yadam` must still fail because `package.json` does not exist.

- [ ] **Step 4: Create the exact package metadata**

Create `package.json`:

```json
{
  "name": "auto-video-local-pipeline",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.16.0" },
  "scripts": {
    "test:yadam": "node --test test/yadam",
    "auto-video": "node scripts/auto-video-pipeline.mjs"
  },
  "dependencies": {
    "ajv": "8.20.0",
    "json-canonicalize": "2.0.0"
  }
}
```

Create `.gitignore`:

```gitignore
node_modules/
config/host.local.json
exports/
*.tmp
*.part
logs/
```

- [ ] **Step 5: Install exact dependencies and lock them**

Run: `npm install --save-exact`

Expected: exit 0; `package-lock.json` records Ajv 8.20.0 and json-canonicalize 2.0.0.

- [ ] **Step 6: Run the package test**

Run: `npm run test:yadam`

Expected: 1 test passes, 0 fails.

- [ ] **Step 7: Commit the package boundary**

```bash
git add package.json package-lock.json .gitignore test/yadam/foundation.test.mjs
git commit -m "build: add local pipeline test harness"
```

### Task 2: Add canonical JSON, hashing and atomic writes

**Files:**
- Create: `scripts/lib/pipeline/canonical-json.mjs`
- Create: `scripts/lib/pipeline/atomic-store.mjs`
- Create: `scripts/lib/pipeline/path-policy.mjs`
- Modify: `test/yadam/foundation.test.mjs`

**Interfaces:**
- Consumes: `canonicalize(value)` from json-canonicalize.
- Produces: `sha256Bytes`, `hashCanonical`, `writeCanonicalJson`, `writeUtf8Atomic`, `assertPathWithin`.

- [ ] **Step 1: Add failing NFC/JCS/hash and containment tests**

Append to `test/yadam/foundation.test.mjs`:

```js
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, hashCanonical } from "../../scripts/lib/pipeline/canonical-json.mjs";
import { writeBinaryAtomic, writeCanonicalJson, writeCanonicalJsonExclusive } from "../../scripts/lib/pipeline/atomic-store.mjs";
import { assertPathWithin, assertRealPathWithin } from "../../scripts/lib/pipeline/path-policy.mjs";

test("canonical JSON normalizes strings and sorts object keys", () => {
  assert.equal(canonicalJson({ z: "e\u0301", a: 1 }), '{"a":1,"z":"é"}');
  assert.equal(hashCanonical({ z: "e\u0301", a: 1 }).length, 64);
  assert.throws(
    () => canonicalJson({ "e\u0301": 1, "é": 2 }),
    /duplicate object key after NFC normalization/
  );
});

test("atomic JSON write returns the on-disk hash", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yadam-store-"));
  try {
    const out = await writeCanonicalJson(join(dir, "value.json"), { b: 2, a: "가" });
    assert.equal(await readFile(out.path, "utf8"), '{"a":"가","b":2}\n');
    assert.equal(out.sha256.length, 64);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("exclusive canonical JSON never replaces an immutable revision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yadam-exclusive-"));
  const path = join(dir, "approval-r001.json");
  try {
    const first = await writeCanonicalJsonExclusive(path, { revision: 1 });
    await assert.rejects(
      writeCanonicalJsonExclusive(path, { revision: 2 }),
      error => error.code === "immutable_target_exists"
    );
    assert.equal(await readFile(path, "utf8"), '{"revision":1}\n');
    assert.equal(first.sha256.length, 64);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("binary atomic write preserves exact bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yadam-binary-"));
  const bytes = Buffer.from([0, 255, 1, 254, 2, 253]);
  try {
    const output = await writeBinaryAtomic(join(dir, "asset.bin"), bytes);
    assert.deepEqual(await readFile(output.path), bytes);
    assert.equal(output.sizeBytes, bytes.length);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("path policy rejects sibling-prefix escapes", () => {
  assert.throws(() => assertPathWithin("C:/jobs/a", "C:/jobs/ab/file.json"), /outside allowed root/);
});

test("real path policy rejects a Windows junction escape", async () => {
  const root = await mkdtemp(join(tmpdir(), "yadam-root-"));
  const outside = await mkdtemp(join(tmpdir(), "yadam-outside-"));
  try {
    await writeFile(join(outside, "secret.txt"), "outside", "utf8");
    await symlink(outside, join(root, "escape"), "junction");
    await assert.rejects(
      assertRealPathWithin(root, join(root, "escape", "secret.txt")),
      /outside allowed root/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the tests and verify missing modules**

Run: `node --test test/yadam/foundation.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `canonical-json.mjs`.

- [ ] **Step 3: Implement canonical JSON and hashes**

Create `scripts/lib/pipeline/canonical-json.mjs`:

```js
import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";

export function normalizeNfcDeep(value) {
  if (typeof value === "string") return value.normalize("NFC");
  if (Array.isArray(value)) return value.map(normalizeNfcDeep);
  if (value && typeof value === "object") {
    const normalized = {};
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.normalize("NFC");
      if (Object.hasOwn(normalized, normalizedKey)) {
        throw new Error(`duplicate object key after NFC normalization: ${normalizedKey}`);
      }
      normalized[normalizedKey] = normalizeNfcDeep(child);
    }
    return normalized;
  }
  return value;
}

export function canonicalJson(value) {
  return canonicalize(normalizeNfcDeep(value));
}

export function sha256Bytes(input) {
  return createHash("sha256").update(input).digest("hex");
}

export function hashCanonical(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
}
```

- [ ] **Step 4: Implement atomic storage and path containment**

Create `scripts/lib/pipeline/atomic-store.mjs` exactly as follows:

```js
import { randomBytes } from "node:crypto";
import { link, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { canonicalJson, sha256Bytes } from "./canonical-json.mjs";

async function writeBytesAtomic(filePath, bytes) {
  const targetPath = resolve(filePath);
  const parent = dirname(targetPath);
  const tempPath = join(
    parent,
    `.${basename(targetPath)}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`
  );
  await mkdir(parent, { recursive: true });
  let handle;
  try {
    handle = await open(tempPath, "wx");
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(tempPath, targetPath);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
  return {
    path: targetPath,
    sha256: sha256Bytes(bytes),
    sizeBytes: bytes.byteLength
  };
}

async function writeBytesExclusive(filePath, bytes) {
  const targetPath = resolve(filePath);
  const parent = dirname(targetPath);
  const tempPath = join(
    parent,
    `.${basename(targetPath)}.exclusive-${process.pid}-${randomBytes(8).toString("hex")}`
  );
  await mkdir(parent, { recursive: true });
  let handle;
  try {
    handle = await open(tempPath, "wx");
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(tempPath, targetPath);
    await rm(tempPath, { force: true });
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(tempPath, { force: true }).catch(() => {});
    if (error.code === "EEXIST") {
      error.code = "immutable_target_exists";
    }
    throw error;
  }
  return {
    path: targetPath,
    sha256: sha256Bytes(bytes),
    sizeBytes: bytes.byteLength
  };
}

export async function writeUtf8Atomic(filePath, text) {
  if (typeof text !== "string") throw new TypeError("text must be a string");
  return writeBytesAtomic(filePath, Buffer.from(text.normalize("NFC"), "utf8"));
}

export async function writeBinaryAtomic(filePath, bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw new TypeError("bytes must be a Buffer or Uint8Array");
  }
  return writeBytesAtomic(filePath, Buffer.from(bytes));
}

export async function writeCanonicalJson(filePath, value) {
  return writeUtf8Atomic(filePath, `${canonicalJson(value)}\n`);
}

export async function writeCanonicalJsonExclusive(filePath, value) {
  return writeBytesExclusive(
    filePath,
    Buffer.from(`${canonicalJson(value)}\n`, "utf8")
  );
}

export async function readJson(filePath) {
  const text = await readFile(resolve(filePath), "utf8");
  if (text.startsWith("\uFEFF")) {
    const error = new Error("JSON must not contain a UTF-8 BOM");
    error.code = "json_bom_not_allowed";
    throw error;
  }
  return JSON.parse(text);
}
```

Create `scripts/lib/pipeline/path-policy.mjs` exactly as follows:

```js
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

function outsideError(roots, candidate) {
  const error = new Error(`path is outside allowed root: ${resolve(candidate)}`);
  error.code = "path_outside_allowed_root";
  error.details = { roots: roots.map(resolve), candidate: resolve(candidate) };
  return error;
}

export function assertPathWithin(root, candidate) {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))) {
    return resolvedCandidate;
  }
  throw outsideError([resolvedRoot], resolvedCandidate);
}

export function assertAnyAllowedRoot(roots, candidate) {
  if (!Array.isArray(roots) || roots.length === 0) {
    throw new TypeError("roots must contain at least one path");
  }
  for (const root of roots) {
    try {
      return assertPathWithin(root, candidate);
    } catch (error) {
      if (error.code !== "path_outside_allowed_root") throw error;
    }
  }
  throw outsideError(roots, candidate);
}

export async function assertRealPathWithin(root, candidate) {
  const [realRoot, realCandidate] = await Promise.all([
    realpath(resolve(root)),
    realpath(resolve(candidate))
  ]);
  return assertPathWithin(realRoot, realCandidate);
}

export async function assertAnyAllowedRealPath(roots, candidate) {
  const realCandidate = await realpath(resolve(candidate));
  for (const root of roots) {
    try {
      const realRoot = await realpath(resolve(root));
      return assertPathWithin(realRoot, realCandidate);
    } catch (error) {
      if (error.code !== "path_outside_allowed_root") throw error;
    }
  }
  throw outsideError(roots, realCandidate);
}
```

`writeCanonicalJson` writes `${canonicalJson(value)}\n`; `writeUtf8Atomic` hashes the exact NFC-normalized UTF-8 bytes written and returns `{ path: resolve(filePath), sha256, sizeBytes }`. `writeBinaryAtomic` uses the same synced temp/rename path without text normalization and is the only binary promotion primitive for audio, image and video adapters. `writeCanonicalJsonExclusive` fsyncs a same-directory temp file and atomically hard-links it to a previously absent immutable revision path; it maps `EEXIST` to `immutable_target_exists` and never replaces an existing revision. Lexical containment protects not-yet-created targets; artifact registration, provider import and cleanup call the real-path variants for existing files so a symlink or Windows junction cannot escape an allowed root.

- [ ] **Step 5: Run the focused tests**

Run: `node --test test/yadam/foundation.test.mjs`

Expected: all canonical storage and path tests pass; no `.tmp-` files remain.

- [ ] **Step 6: Commit canonical storage**

```bash
git add scripts/lib/pipeline/canonical-json.mjs scripts/lib/pipeline/atomic-store.mjs scripts/lib/pipeline/path-policy.mjs test/yadam/foundation.test.mjs
git commit -m "feat: add canonical atomic artifact storage"
```

### Task 3: Lock yadam, legacy and host profiles

**Files:**
- Create: `config/profiles/yadam.json`
- Create: `config/profiles/gguljam-bible.json`
- Create: `config/host.local.example.json`
- Create: `scripts/lib/pipeline/profile-registry.mjs`
- Modify: `test/yadam/foundation.test.mjs`

**Interfaces:**
- Consumes: `readJson`, `hashCanonical`.
- Produces: `loadProfile(profileId, workspaceRoot)`, `loadHostConfig(workspaceRoot)`, `validateTargetMinutes(value)`.

- [ ] **Step 1: Write failing profile isolation tests**

Add tests asserting yadam accepts only 10-step values from 10 through 120, has `durationTolerance:0.20`, Codex model `gpt-5.6-sol`/reasoning `ultra`, user-config and execpolicy isolation, a dedicated-empty-stage-dir working-directory policy, `projectRootMarkers:[]`, and absent-or-profile-pinned instruction sources; also assert `visual.styleId:"yadam-color-manhwa-v1"`, Supertonic M1/1.04, SDXL/IP-Adapter and 24 FPS. Assert gguljam has `mode:"legacy-compatibility"` and no `yadam` object.

- [ ] **Step 2: Run and observe the missing registry failure**

Run: `node --test test/yadam/foundation.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `profile-registry.mjs`.

- [ ] **Step 3: Create the yadam profile**

Create a JSON object with these exact top-level keys and values:

```json
{
  "schemaVersion": "1.0.0",
  "profileId": "yadam",
  "targetMinutes": { "min": 10, "max": 120, "step": 10, "durationTolerance": 0.2 },
  "segments": { "plannedSeconds": 600 },
  "codex": { "promptPack": "prompts/yadam", "approval": "never", "sandbox": "read-only", "model": "gpt-5.6-sol", "reasoningEffort": "ultra", "ignoreUserConfig": true, "ignoreExecpolicyRules": true, "strictConfig": true, "workingDirectoryPolicy": "dedicated-empty-stage-dir", "projectRootMarkers": [], "instructionSourcePolicy": "absent-or-profile-pinned", "instructionSourcePins": {} },
  "tts": { "provider": "supertonic", "model": "supertonic-3", "voice": "M1", "language": "ko", "speed": 1.04, "totalStep": 8, "sceneSilenceSeconds": 0.38, "continuousSilenceSeconds": 0.04 },
  "visual": { "styleId": "yadam-color-manhwa-v1", "sceneWidth": 1024, "sceneHeight": 576, "referenceWidth": 768, "referenceHeight": 1024, "thumbnailWidth": 1280, "thumbnailHeight": 720, "maxSlots": 260, "focalConditionedCharacters": 1 },
  "video": { "width": 1920, "height": 1080, "fps": 24, "videoCodec": "h264", "pixelFormat": "yuv420p", "audioCodec": "aac", "audioSampleRate": 48000, "preserveColor": true },
  "strictRelease": true
}
```

Create `gguljam-bible.json` with `schemaVersion`, `profileId`, `mode:"legacy-compatibility"`, `policyDocument:"auto-video.md"`, `strictRelease:false`, and existing assembler/concat script paths only. Do not copy yadam visual, TTS or QA values into it.

- [ ] **Step 4: Create the foundation host example**

Create `config/host.local.example.json` with the host facts needed by the foundation phase:

```json
{
  "schemaVersion": "1.0.0",
  "workspaceRoot": "C:/Users/petbl/auto-video",
  "exportsRoot": "C:/Users/petbl/auto-video/exports",
  "codex": {
    "executable": "C:/Users/petbl/AppData/Local/OpenAI/Codex/bin/a7c12ebff69fb123/codex.exe",
    "verifiedVersion": "codex-cli 0.144.0-alpha.4",
    "versionTimeoutMs": 15000
  },
  "ffmpeg": {
    "executable": "C:/Users/petbl/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.1-full_build/bin/ffmpeg.exe",
    "ffprobeExecutable": "C:/Users/petbl/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.1-full_build/bin/ffprobe.exe"
  }
}
```

Plans 03 and 04 add their exact `supertonic`, `comfyui`, `ollama` and workspace GPU-lock objects through failing configuration tests. Keeping those additions in the owning subsystem avoids making their TDD tests pass before implementation. `config/host.local.json` may override the example on another machine and remains ignored by Git.

- [ ] **Step 5: Implement the registry and validation**

`loadProfile` must allow only `/^[a-z0-9-]+$/`, resolve under `config/profiles`, deep-freeze the parsed value and attach `profileHash`. `loadHostConfig` reads ignored `config/host.local.json` when present, otherwise the example, and attaches `hostConfigHash`. `validateTargetMinutes` returns the number or throws `targetMinutes must be 10..120 in steps of 10`.

- [ ] **Step 6: Run profile tests**

Run: `node --test test/yadam/foundation.test.mjs`

Expected: target 10 and 120 pass; 5, 15 and 130 fail; profile isolation passes.

- [ ] **Step 7: Commit profiles**

```bash
git add config/profiles config/host.local.example.json scripts/lib/pipeline/profile-registry.mjs test/yadam/foundation.test.mjs
git commit -m "feat: add isolated yadam and legacy profiles"
```

### Task 4: Add schemas and a strict schema registry

**Files:**
- Create: `schemas/pipeline/request.schema.json`
- Create: `schemas/pipeline/pipeline-state.schema.json`
- Create: `schemas/pipeline/artifact-manifest.schema.json`
- Create: `scripts/lib/pipeline/schema-registry.mjs`
- Modify: `test/yadam/foundation.test.mjs`

**Interfaces:**
- Consumes: Ajv 2020, profile validation.
- Produces: `validateSchema(schemaPath, value)` returning the same value or throwing `SchemaValidationError` with JSON Pointer evidence.

- [ ] **Step 1: Write request and error-evidence tests**

The valid request fixture must include schemaVersion, jobId, profileId, inputMode, source `{kind,value}`, targetMinutes, durationTolerance, approvalMode `two-stage`, integer seed and createdAt. `source.kind` is exactly `reference_title` when `inputMode:"reference"` and exactly `genre` when `inputMode:"genre"`; `source.value` is a nonempty size-bounded NFC string. The only optional request field is bounded NFC `optionalInstructions`, normalized to `""` when omitted. Invalid fixtures omit source, mismatch mode/kind, use 15 minutes, add `referenceTitle`, `genre` or `referenceAssetIds` as undeclared top-level fields, or add any other unknown property.

- [ ] **Step 2: Run and verify missing schemas fail**

Run: `node --test test/yadam/foundation.test.mjs`

Expected: FAIL because `request.schema.json` is absent.

- [ ] **Step 3: Create closed JSON Schemas**

Use draft 2020-12, `additionalProperties:false`, exact enums and a conditional `inputMode`/`source.kind` discriminator for request modes `reference|genre`, approvalMode `two-stage`, state status `pending|running|awaiting_approval|cancel_requested|retrying|completed|needs_review|failed|cancelled`, and artifact gate `pass|fail|warning|pending|invalidated`. Pipeline state requires top-level `durationRepairAttemptsUsed` as an integer in `[0,1]`, initialized to `0`. A state-history row requires `from,to,stage,inputHash,at` and allows only optional `outputHash`, sorted job-relative `artifactPaths`, structured `error`, `note`, and `attempt`; `outputHash` and `artifactPaths` are a dependent pair, never supplied separately. When present, `attempt` is exactly integer `1` and is legal only on stage `DURATION_REPAIR_REQUIRED`. All supplied evidence must be retained exactly.

The artifact schema requires `artifactId`, `logicalRole`, job-root relative `path`, 64-lowercase-hex `sha256`, `schemaVersion`, `producerStage`, `gateStatus`, and an object `dependencyHashes` whose values are 64-lowercase-hex strings. Stored records also require store-derived `dependencyKinds` with exactly the same keys and values `artifact|opaque`, plus `dependencyOwners` whose keys are exactly the `artifact` dependencies and whose values are non-empty sorted artifact-ID arrays. Callers do not guess these fields; `registerArtifact` derives them under the job lock before schema validation. `opaque` covers pinned profile/model/font/compiler/provider inputs that are compared for exact reuse but have no job artifact owner.

- [ ] **Step 4: Implement Ajv 2020 validation**

Import `Ajv2020` from `ajv/dist/2020.js`; compile each absolute schema path once; sort errors by instancePath then keyword; throw an Error with `name="SchemaValidationError"`, `code="schema_validation_failed"`, and `details` containing `{instancePath,keyword,message}`.

- [ ] **Step 5: Run schema tests**

Run: `node --test test/yadam/foundation.test.mjs`

Expected: valid fixtures pass; unknown fields and invalid target values fail with stable evidence.

- [ ] **Step 6: Commit schemas**

```bash
git add schemas/pipeline scripts/lib/pipeline/schema-registry.mjs test/yadam/foundation.test.mjs
git commit -m "feat: validate pipeline contracts with closed schemas"
```

### Task 5: Implement job creation, loading and state transitions

**Files:**
- Create: `scripts/lib/pipeline/job-store.mjs`
- Create: `scripts/lib/pipeline/state-machine.mjs`
- Create: `scripts/lib/pipeline/success-evidence.mjs`
- Modify: `test/yadam/foundation.test.mjs`

**Interfaces:**
- Consumes: request schema, profiles, canonical atomic store.
- Produces: the locked `createJob`, `loadJob`, `transitionJob`, `buildSuccessEvidence` interfaces.

- [ ] **Step 1: Add failing job-layout and illegal-transition tests**

Create a temp workspace, call `createJob`, assert request/state/artifact manifests and exactly the Plan 01-owned pristine directory list from Step 3 exists; stage-owned children shown in the design's eventual layout must still be absent. Assert the initial state has `durationRepairAttemptsUsed:0` and the initial artifact manifest contains exactly one passed input record with `artifactId:"pipeline-request"`, `logicalRole:"pipeline.request"`, `path:"request.json"`, and a SHA-256 matching the canonical request bytes; this is the first prerequisite consumed by Plan 06's stage registry. Under one lock, assert `transitionJob(...{stage:"DURATION_REPAIR_REQUIRED",attempt:1,...})` appends the exact attempt evidence and atomically changes the counter `0 -> 1`; a second reservation, a missing/non-1 attempt on that stage, or `attempt` on any other stage fails without another history row. For hash-bound success evidence, assert a first `{stage,inputHash,to,outputHash,artifactPaths}` appends one row, an exact repeat returns the current state without mutation, and a same-stage/input row with another `to`, output hash or normalized path set throws `success_evidence_conflict`. Launch two identical zero-row calls concurrently and require the locked implementation leaves exactly one row; launch conflicting calls and require at most the single winner plus one conflict, never two rows. Reject `outputHash` without `artifactPaths` and vice versa. Assert a transition from `completed` to `running` throws `illegal_state_transition`; assert state history is append-only. Create one live-PID lock and assert contention returns `job_locked`; create a lock older than 300 seconds with a definitely absent fixture PID and assert it is moved under `quarantine/locks/` before one successful retry. A stale timestamp with a live PID must remain locked. Add shuffled-record success-evidence fixtures: input order and output order must not change hashes, changing one opaque pin must change `inputHash`, changing one output byte hash must change `outputHash`, Windows separators normalize to `/`, and duplicate/invalid record fields or a non-hash opaque value fail.

- [ ] **Step 2: Run the tests and verify missing exports**

Run: `node --test test/yadam/foundation.test.mjs`

Expected: FAIL because `createJob` is not exported.

- [ ] **Step 3: Implement deterministic job IDs and layout**

Use `job-YYYYMMDD-HHMMSS-<8 lowercase hex>` where the suffix is the first 8 characters of SHA-256 over canonical `{requestWithoutJobId,createdAt}`. Reject an existing directory rather than merging jobs. Build `planning`, `script/chapters`, `approvals`, `reviews`, `assets/images`, `assets/audio/raw`, `assets/audio/normalized`, `assets/audio/requests`, `assets/audio/checkpoints`, `previews`, `thumbnail`, `segments`, `final/upload-subtitles`, `compat/hermes`, `logs`, `quarantine` and `quarantine/locks` exactly. The shared `quarantine/locks` parent is required by pipeline and TTS stale-lock recovery; there is no unused job-root `locks` directory. `assets/character-references` and later subsystem quarantine/coverage/review children remain stage-owned. Write the normalized closed request to `request.json`, seed `pipeline-state.json` with `durationRepairAttemptsUsed:0`, then seed `artifact-manifest.json` with one current record `{artifactId:"pipeline-request",logicalRole:"pipeline.request",path:"request.json",sha256,schemaVersion:"1.0.0",producerStage:"job-create",gateStatus:"pass",dependencyHashes:{},dependencyKinds:{},dependencyOwners:{}}`; validate this record through the artifact schema and never treat `pipeline.request` as an unregistered pseudo-role. Tests compare the sorted relative directory list so later plans cannot silently depend on an undeclared folder.

- [ ] **Step 4: Implement transitionJob**

Guard a job with `pipeline.lock` created using exclusive `open("wx")`. Write and sync canonical `{schemaVersion:"1.0.0",pid,leaseId,acquiredAt}` before entering the critical section. If the file exists, reclaim it only when its age is greater than 300 seconds **and** `process.kill(pid,0)` proves the PID absent; atomically rename the old record to `quarantine/locks/pipeline-<leaseId>.json` and retry acquisition once. A live or indeterminate PID returns `job_locked`. Event requires `stage`, `to`, `inputHash`; optional fields are `outputHash`, `artifactPaths`, `error`, `note`, and `attempt`. Validate hashes, require `outputHash` and `artifactPaths` together, normalize/sort contained job-relative artifact paths, permit only the status transitions in the design, and reject `attempt` unless `stage==="DURATION_REPAIR_REQUIRED" && attempt===1`. While still holding the lock, a hash-bound event first collects history rows with the same `{stage,inputHash}`: zero rows may append; exactly one row whose `to`, `outputHash`, and normalized `artifactPaths` all match returns the current state without another timestamp or mutation; any mismatch or cardinality above one throws `success_evidence_conflict`. This check and append are one critical section, making subsystem helper prechecks advisory rather than the concurrency authority. For `DURATION_REPAIR_REQUIRED` require current `durationRepairAttemptsUsed===0`, set it to `1`, and append `{from,to,stage,inputHash,at,attempt:1,...suppliedEvidenceWithoutDuplicateAttempt}` in the same canonical atomic state replacement; a used budget returns `duration_repair_budget_exhausted` without mutation. All other non-hash-bound events preserve the counter exactly and forbid `attempt`. Atomically replace state only for a new legal row, then remove the lock in `finally` only after re-reading and matching the caller's `leaseId`.

- [ ] **Step 5: Implement canonical cross-subsystem success evidence**

`success-evidence.mjs` owns the one shared implementation used by Plans 03, 05 and 06; those plans import it and must not copy a local variant. Project each already-verified record to exactly `{artifactId,logicalRole,path:path.replaceAll("\\","/"),sha256}`. Validate IDs/roles, lowercase SHA-256 and job-relative normalized paths; reject duplicate input `{logicalRole,artifactId}` pairs and duplicate output `{path,artifactId}` pairs. Sort inputs by bytewise code-unit `logicalRole`, then `artifactId`; sort outputs by bytewise `path`, then `artifactId`, using `left < right ? -1 : left > right ? 1 : 0` and never locale collation. Validate `opaqueInputs` as a nonempty or empty plain object whose keys match `/^[a-z][A-Za-z0-9]*Hash$/` and values are lowercase SHA-256, then rebuild it in bytewise key order. Compute exactly:

```js
inputHash = hashCanonical({
  schemaVersion: "1.0.0",
  eventStage: stage,
  inputArtifacts,
  opaqueInputs: sortedOpaqueInputs,
});
outputHash = hashCanonical({
  schemaVersion: "1.0.0",
  eventStage: stage,
  inputHash,
  outputArtifacts,
});
artifactPaths = outputArtifacts.map(({ path }) => path);
```

The caller owns the exact allowed input/output role set and opaque-pin key set for its event. The helper only canonicalizes and validates; it never discovers current records, reads the manifest or appends state.

- [ ] **Step 6: Run state and success-evidence tests**

Run: `node --test test/yadam/foundation.test.mjs`

Expected: layout and legal transition tests pass; lock contention returns `job_locked`.

- [ ] **Step 7: Commit job state core**

```bash
git add scripts/lib/pipeline/job-store.mjs scripts/lib/pipeline/state-machine.mjs scripts/lib/pipeline/success-evidence.mjs test/yadam/foundation.test.mjs
git commit -m "feat: add durable job and state stores"
```

### Task 6: Add artifact registration and dependency invalidation

**Files:**
- Create: `scripts/lib/pipeline/artifact-store.mjs`
- Create: `scripts/lib/pipeline/dependency-graph.mjs`
- Modify: `test/yadam/foundation.test.mjs`

**Interfaces:**
- Consumes: artifact schema, path policy, job lock and hashing.
- Produces: `registerArtifact`, `canReuseArtifact`, `invalidateFromChanges(jobDir, changedArtifactIds)`.

- [ ] **Step 1: Add failing reuse and transitive invalidation tests**

Register script→WAV→render-manifest→segment-video→final-video dependencies. Save the script's original hash, atomically replace the script and register its new revision, then call `invalidateFromChanges(jobDir,["script-final"])`. Assert the WAV that still depends on the original script hash and every transitive consumer becomes invalidated while an unrelated thumbnail background remains pass. Add a pinned external checkpoint hash with no artifact owner and assert registration classifies it `opaque`, exact-current reuse passes, a changed expected checkpoint hash makes reuse false, and reverse traversal does not invent an owner or throw. Test that a path outside job root and a forged file hash are rejected. This case prevents an implementation from losing reverse edges when the changed artifact's current hash has already moved to a new revision while still supporting explicitly pinned non-job inputs.

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/yadam/foundation.test.mjs`

Expected: FAIL with missing `registerArtifact`.

- [ ] **Step 3: Implement verified artifact registration**

Resolve record.path under jobDir, call `assertRealPathWithin(jobDir,resolvedPath)` to reject symlink/junction escapes, hash the existing file, compare the supplied hash, validate schema, and replace only the same artifactId revision. Before replacement append the complete previous current projection `{path,sha256,schemaVersion,producerStage,gateStatus,dependencyHashes,dependencyKinds,dependencyOwners,replacedAt}` to that record's revision history; this preserves old immutable approval/reference paths, not only their hashes. While the job lock is held, resolve each dependency hash against current and retained artifact hashes: persist `kind:"artifact"` and all sorted matching owner IDs when at least one exists, otherwise persist `kind:"opaque"` with no owner. Persisted kinds never change merely because a later unrelated artifact happens to have the same bytes. `canReuseArtifact` repeats real-path and file-hash checks, requires the caller's complete dependency-hash map to match exactly, re-verifies current owner hashes for every artifact-kind dependency, compares every opaque pin to the caller's current pin, and requires producer schema version plus `gateStatus==="pass"`.

- [ ] **Step 4: Implement reverse dependency traversal**

For each changed artifact ID, seed an ownership map with both its current SHA-256 and every prior revision SHA-256 retained in its revision history. For unchanged artifacts, index the current SHA-256. Build reverse edges only from consumer dependencies whose persisted `dependencyKinds[key]==="artifact"`, and verify their persisted owner IDs still exist and own the recorded current/retained hash; a missing artifact-kind owner is `artifact_dependency_owner_missing`. Opaque dependencies deliberately create no reverse edge and are invalidated through `canReuseArtifact` when the caller presents changed current pins. Breadth-first traverse from the changed IDs, add each newly invalidated artifact's current hash as the next owner key, set downstream `gateStatus:"invalidated"`, record the sorted root `invalidatedBy` IDs, and write one atomic manifest update.

- [ ] **Step 5: Run artifact tests**

Run: `node --test test/yadam/foundation.test.mjs`

Expected: transitive invalidation and unrelated reuse tests pass.

- [ ] **Step 6: Commit artifact dependency core**

```bash
git add scripts/lib/pipeline/artifact-store.mjs scripts/lib/pipeline/dependency-graph.mjs test/yadam/foundation.test.mjs
git commit -m "feat: track and invalidate pipeline artifacts"
```

### Task 7: Discover and preflight the real Codex CLI safely

**Files:**
- Create: `scripts/lib/providers/codex-cli.mjs`
- Create: `test/yadam/codex-runner.test.mjs`
- Create: `test/yadam/fixtures/fake-codex.mjs`

**Interfaces:**
- Consumes: host config and `spawn` with `shell:false`.
- Produces: `discoverCodex(hostConfig)`, `preflightCodex(executable,{timeoutMs,signal,profile,stageWorkDir})`.

- [ ] **Step 1: Write discovery tests**

Test explicit verified path first, bundled path second, executable Get-Command candidate third, and reject a WindowsApps shim whose version process exits nonzero or access-denied. Fake preflight must report version and login status. Add instruction-source fixtures proving: no source passes with an empty pin map; an unpinned global or stage `AGENTS.md` fails before model invocation; an exact profile path/hash pin passes; a changed byte fails; and a stage `.codex/config.toml` always fails for the dedicated-empty policy.

- [ ] **Step 2: Run and verify missing provider**

Run: `node --test test/yadam/codex-runner.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `codex-cli.mjs`.

- [ ] **Step 3: Implement safe discovery**

Use file existence plus an actual `--version` child process; never treat path discovery alone as success. The current bundled candidate is `C:/Users/petbl/AppData/Local/OpenAI/Codex/bin/a7c12ebff69fb123/codex.exe`. Preflight runs `--version` and `login status`, caps stdout/stderr at 1 MiB, uses a 15-second timeout, and resolves `CODEX_HOME` without printing auth contents. It then evaluates the effective global choice (`AGENTS.override.md` when present, otherwise `AGENTS.md`) and the equivalent files in the newly created stage workdir. Because runtime passes `project_root_markers=[]`, no parent project directory is part of the effective project instruction chain. Reject any present effective instruction source unless its normalized absolute path and bytes SHA-256 exactly match `profile.codex.instructionSourcePins`; reject any `.codex/config.toml` in the stage workdir. Return `{ok,executable,version,loggedIn,instructionSourceHashes,checkedInstructionPaths,diagnostics}`. On the audited PC, both global candidates and both workspace-root candidates are absent; runtime still rechecks rather than trusting this snapshot.

- [ ] **Step 4: Run discovery tests**

Run: `node --test test/yadam/codex-runner.test.mjs`

Expected: fake explicit path wins; access-denied shim is skipped; auth false is reported without invoking a model; absent/pinned instruction fixtures behave exactly as specified and a mismatch returns `codex_instruction_source_changed` before spawn.

- [ ] **Step 5: Commit Codex preflight**

```bash
git add scripts/lib/providers/codex-cli.mjs test/yadam/codex-runner.test.mjs test/yadam/fixtures/fake-codex.mjs
git commit -m "feat: discover and preflight Codex CLI"
```

### Task 8: Implement the schema-gated Codex stage runner

**Files:**
- Create: `scripts/lib/pipeline/codex-stage-runner.mjs`
- Modify: `test/yadam/codex-runner.test.mjs`
- Modify: `test/yadam/fixtures/fake-codex.mjs`

**Interfaces:**
- Consumes: preflightCodex, schema registry, atomic store, transitionJob.
- Produces: locked `runCodexStage` interface for Plan 02.

- [ ] **Step 1: Add success, JSONL error, malformed JSON, timeout and cancellation tests**

The fake executable accepts an environment fixture mode and emits deterministic JSONL. Assert the runner writes stdin, passes the exact args, separates event/stderr logs, validates final JSON, and never promotes failed output.

- [ ] **Step 2: Run and verify missing runner**

Run: `node --test test/yadam/codex-runner.test.mjs`

Expected: FAIL because `runCodexStage` is missing.

- [ ] **Step 3: Implement the exact process contract**

Build this argument array without shell interpolation:

```js
[
  "exec", "-a", "never", "-s", "read-only", "--json",
  "--model", "gpt-5.6-sol", "-c", "model_reasoning_effort=\"ultra\"",
  "-C", stageWorkDir, "-c", "project_root_markers=[]",
  "--ignore-user-config", "--ignore-rules", "--strict-config",
  "--output-schema", schemaPath,
  "--output-last-message", candidatePath,
  "--ephemeral", "--skip-git-repo-check", "-"
]
```

Load these model/isolation values from the frozen yadam profile and assert they equal the locked revision before spawning; do not fall back to whatever resolved `CODEX_HOME/config.toml` currently says. Create `logs/codex/<stageId>/<attemptId>/workspace` with exclusive semantics, require it to be empty, and pass its absolute path as `stageWorkDir`. `--ignore-user-config` still uses the existing Codex authentication store; `--ignore-rules` means execpolicy `.rules`, not `AGENTS.md`. Call the instruction-aware preflight after creating the workdir and immediately before spawn. Record executable version, explicit model, reasoning effort, CLI isolation flags, `project_root_markers`, checked instruction paths and hashes, stage workdir and profile hash in provenance so a later model or instruction change requires a profile revision and fresh stage input hash.

Spawn hidden with piped stdin/stdout/stderr. Write prompt then close stdin. Parse one JSON object per stdout line; any event with error/failed status is fatal. On timeout or AbortSignal, terminate the owned process, quarantine candidate output, and transition the stage to retrying or cancel_requested. On success, parse candidate JSON, validate schema, verify payload jobId/stageId/inputHash, canonicalize it, then return payload and provenance.

- [ ] **Step 4: Enforce bounded retries outside the process function**

Expose `runCodexStage` as one attempt only. Add `runCodexStageWithPolicy` with transient attempts 1+2 and schema repair once per input hash; persist attempt count so resume cannot reset the budget.

- [ ] **Step 5: Run Codex runner tests**

Run: `node --test test/yadam/codex-runner.test.mjs`

Expected: success promotes one payload; JSONL error, malformed JSON, timeout and cancellation produce no canonical output; retry counts are exact.

- [ ] **Step 6: Re-run the runner suite as this task's independent gate**

Run: `node --test test/yadam/codex-runner.test.mjs`

Expected: exit 0; fake success, structured error, malformed output, timeout, cancellation and persisted retry-budget cases all pass without invoking the real model. The real no-generation preflight is intentionally placed after CLI wiring in Task 9.

- [ ] **Step 7: Commit the runner**

```bash
git add scripts/lib/pipeline/codex-stage-runner.mjs test/yadam/codex-runner.test.mjs test/yadam/fixtures/fake-codex.mjs
git commit -m "feat: run schema-gated Codex stages"
```

### Task 9: Add the initial CLI and machine-readable output

**Files:**
- Create: `scripts/lib/pipeline/cli-args.mjs`
- Create: `scripts/auto-video-pipeline.mjs`
- Create: `test/yadam/cli.test.mjs`

**Interfaces:**
- Consumes: createJob, loadJob, transitionJob, Codex preflight.
- Produces: `new`, `status`, `preflight`, `resume`, `cancel` commands; Plan 02 adds selection and approval commands through the same dispatcher.

- [ ] **Step 1: Write failing CLI parser and command tests**

Test:

```text
new --profile yadam --mode genre --source "의리와 배신" --minutes 10 --seed 42 --instructions "가족 회복을 강조"
status --job <absolute-job-dir>
preflight --provider codex --no-generate
cancel --job <absolute-job-dir>
```

Reject duplicate flags, unknown flags, missing/blank source, noninteger seed, minutes 15 and oversized instructions. Require every command to print one final JSON object with `ok`, `command` and either result or structured error.

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/yadam/cli.test.mjs`

Expected: FAIL because the CLI files are absent.

- [ ] **Step 3: Implement a closed argument parser**

`parseCli(argv, commandDefinitions)` consumes only declared flags, does not coerce arbitrary strings, and throws `{code:"invalid_cli_argument",details}`. It must preserve Korean and spaces exactly.

- [ ] **Step 4: Implement the entrypoint**

Dispatch with a command map. `new` validates input before creating a job and normalizes the request to the closed Plan 01 shape: `--mode reference` maps `--source` to `{kind:"reference_title",value}`, genre maps it to `{kind:"genre",value}`, and optional `--instructions` maps only to `optionalInstructions`; it never emits legacy top-level `referenceTitle`/`genre`. `status` verifies hashes and returns current stage plus next action. Foundation `resume` returns the first incomplete stage without running later subsystem code. `cancel` records `cancel_requested`; provider-specific cancellation hooks arrive in Plans 03–05.

- [ ] **Step 5: Run CLI tests and a local new/status smoke**

Run: `node --test test/yadam/cli.test.mjs`

Expected: all parser tests pass.

Run: `npm run auto-video -- new --profile yadam --mode genre --source "의리와 배신" --minutes 10 --seed 42`

Expected: final JSON has `ok:true`, an absolute jobDir under `exports`, and state pending. Remove only this known smoke job after verifying its resolved path is inside the workspace exports root.

- [ ] **Step 6: Run one opt-in real Codex preflight without generation**

Run: `node scripts/auto-video-pipeline.mjs preflight --provider codex --no-generate`

Expected: version `codex-cli 0.144.0-alpha.4` or a newer explicitly reported version, `loggedIn:true`, and `generationInvoked:false`; no prompt is submitted.

- [ ] **Step 7: Run all foundation tests**

Run: `npm run test:yadam`

Expected: all foundation, Codex and CLI tests pass with no live generation.

- [ ] **Step 8: Commit the CLI foundation**

```bash
git add scripts/auto-video-pipeline.mjs scripts/lib/pipeline/cli-args.mjs test/yadam/cli.test.mjs
git commit -m "feat: add durable auto-video pipeline CLI"
```

## Plan 01 Completion Gate

- [ ] `npm run test:yadam` exits 0.
- [ ] All eight locked public modules export exactly the signatures listed above.
- [ ] `new` rejects invalid target times before any Codex call.
- [ ] Codex preflight bypasses the WindowsApps access-denied shim.
- [ ] A failed Codex attempt leaves no promoted artifact.
- [ ] Profile tests prove yadam settings cannot enter gguljam-bible.
- [ ] Artifact invalidation is transitive and unrelated artifacts remain reusable.
- [ ] Artifact-kind dependencies retain verified owners; opaque profile/model/font/provider pins compare exactly without inventing reverse edges.
- [ ] No Git repository was initialized without explicit user authority.

## Self-Review Notes

- Spec coverage: sections 7–12, common ID storage foundations, security, retry state, profile isolation and Codex integration are mapped to Tasks 1–9.
- Placeholder scan: no deferred implementation markers are used; every failure path has a code, test and expected result.
- Type consistency: downstream plans must import the exact modules and signatures in “Public Interfaces Locked by This Plan”.
