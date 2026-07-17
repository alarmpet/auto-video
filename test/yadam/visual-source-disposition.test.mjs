import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

async function sha256File(filePath) {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

const expectedSources = {
  "module/시스템프롬프트_Sonnet.txt": "6cad802444c51daf009e9d47de7a140224d01cb4097a3b0bf87cb590a85d4ab9",
  "module/prompt_v5.2_sonnet.md": "af2b889f671223e71c002c440387dd23ac7f4d56d89bdc465ba4ffe15226b172",
  "module/썸네일 프롬프트 (opus) 260601.md": "fe6b08667f91aa17cd7ca29a259c16e2edf927faf6db2e29cdc9f892a1fd0e25"
};

const allowlistedOwners = new Set(["yadam-image-developer"]);
const allowlistedTestIds = new Set(["visual-source-disposition-test"]);

const runtimeFiles = [
  "scripts/lib/yadam/images/model-lock.mjs",
  "scripts/lib/yadam/images/host-installer.mjs",
  "scripts/yadam-image-host.mjs",
  "scripts/lib/yadam/images/workflow-template.mjs",
  "scripts/lib/yadam/images/prompt-compiler.mjs",
  "scripts/lib/yadam/images/visual-slot-plan.mjs",
  "scripts/lib/yadam/images/comfyui-client.mjs",
  "scripts/lib/pipeline/resource-lock.mjs",
  "scripts/lib/yadam/images/reference-store.mjs",
  "scripts/lib/yadam/images/raster-inspector.mjs",
  "scripts/lib/yadam/images/ollama-vision-critic.mjs",
  "scripts/lib/yadam/images/visual-qa.mjs",
  "scripts/lib/yadam/images/thumbnail-compositor.mjs",
  "scripts/lib/yadam/images/image-runner.mjs",
  "scripts/lib/yadam/image-service.mjs",
  "scripts/yadam-image-stage.mjs",
  "scripts/yadam-image-smoke.mjs"
];

const legacyKeywords = [
  "Sonnet",
  "Grok",
  "Opus",
  "Google Flow",
  "Nano Banana"
];

test("visual source disposition hashes match script rules and catalog", async () => {
  // 1. Hash the three raw source files
  for (const [path, expectedHash] of Object.entries(expectedSources)) {
    const actualHash = await sha256File(join(process.cwd(), path));
    assert.equal(actualHash, expectedHash, `Hash mismatch for ${path}`);
  }

  // 2. Load script-rules.v1.json and check that these three are matching
  const rulesText = await readFile(join(process.cwd(), "data/yadam/reference/script-rules.v1.json"), "utf8");
  const rules = JSON.parse(rulesText);
  assert.ok(rules.sources, "script-rules.v1.json should contain sources");
  const rulesMap = new Map(rules.sources.map(s => [s.path, s.sha256]));

  for (const [path, expectedHash] of Object.entries(expectedSources)) {
    assert.equal(rulesMap.get(path), expectedHash, `Script rules hash mismatch for ${path}`);
  }

  // 3. Load catalog legacy-source-disposition.v1.json and validate structure
  const catalogText = await readFile(join(process.cwd(), "test/yadam/fixtures/images/legacy-source-disposition.v1.json"), "utf8");
  const catalog = JSON.parse(catalogText);
  assert.equal(catalog.schemaVersion, "1.0.0");
  assert.equal(catalog.sourceDispositionVersion, "2026-07-16");
  assert.equal(catalog.sources.length, 3);

  for (const src of catalog.sources) {
    assert.ok(expectedSources[src.path], `Unexpected path in catalog: ${src.path}`);
    assert.equal(src.sha256, expectedSources[src.path], `Hash mismatch in catalog for ${src.path}`);
    assert.ok(Array.isArray(src.acceptedRules));
    assert.ok(Array.isArray(src.adaptedRules));
    assert.ok(Array.isArray(src.rejectedRules));
    for (const owner of src.implementationOwners) {
      assert.ok(allowlistedOwners.has(owner), `Unauthorized owner: ${owner}`);
    }
    for (const testId of src.downstreamTests) {
      assert.ok(allowlistedTestIds.has(testId), `Unauthorized test ID: ${testId}`);
    }
  }

  // 4. Scan existing files
  const isSourceOnly = process.argv.includes("--source-only");
  for (const relativePath of runtimeFiles) {
    const fullPath = join(process.cwd(), relativePath);
    const exists = await access(fullPath).then(() => true, () => false);
    if (!exists) {
      if (!isSourceOnly) {
        assert.fail(`Missing required runtime file in normal mode: ${relativePath}`);
      }
      continue;
    }

    const content = await readFile(fullPath, "utf8");
    // Check that it doesn't import or reference legacy-source-disposition
    assert.equal(content.includes("legacy-source-disposition.v1.json"), false, `${relativePath} should not reference legacy-source-disposition`);
    assert.equal(content.includes("legacy-source-disposition"), false, `${relativePath} should not reference legacy-source-disposition`);
    // Check that it doesn't reference module/
    assert.equal(content.includes("module/"), false, `${relativePath} should not contain module/ path`);

    // Check that it doesn't contain legacy provider keywords
    for (const keyword of legacyKeywords) {
      // Avoid false positive on normal words if any, but let's do a strict substring check as required
      assert.equal(content.includes(keyword), false, `${relativePath} contains legacy provider keyword: ${keyword}`);
    }
  }
});
