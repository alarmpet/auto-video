// scripts/test_yadam_codex_stage_adapter.mjs
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runYadamJsonStage } from "./lib/yadam/codex-json-stage.mjs";
import { sha256Bytes, canonicalJson } from "./lib/pipeline/canonical-json.mjs";
import { validateSchema } from "./lib/yadam/schema-validator.mjs";

// Test 1: yadam Codex JSON stage adapter
async function testStageAdapter() {
  const tempDir = await mkdtemp(join(tmpdir(), "yadam-adapter-test-"));
  const promptPath = join(tempDir, "prompt.md");
  const schemaPath = join(tempDir, "schema.json");

  const testSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://auto-video/schemas/test/v1",
    type: "object",
    properties: {
      schemaVersion: { const: "1.0.0" },
      options: { type: "array" }
    },
    required: ["schemaVersion", "options"],
    additionalProperties: false
  };

  await writeFile(promptPath, "Korean: 한글 🌸\n", "utf8");
  await writeFile(schemaPath, JSON.stringify(testSchema), "utf8");

  const input = { key: "Value 🌿" };
  const expectedCanonicalInput = canonicalJson(input);
  const expectedInputHash = sha256Bytes(Buffer.from(expectedCanonicalInput, "utf8"));

  let capturedOptions = null;
  const fakeRunStage = async (opts) => {
    capturedOptions = opts;
    return {
      payload: { schemaVersion: "1.0.0", options: [] },
      outputHash: "a".repeat(64),
      eventsPath: "runs/events.jsonl",
      provenance: { provider: "fake" }
    };
  };

  // Success path
  const result = await runYadamJsonStage({
    jobDir: "C:/fake/job",
    stageId: "yadam.test.v1",
    promptPath,
    schemaPath,
    input,
    timeoutMs: 120000,
    signal: null,
    runStage: fakeRunStage
  });

  // Verify prompt and input envelope properties
  assert.ok(capturedOptions);
  assert.equal(capturedOptions.prompt.normalize("NFC"), capturedOptions.prompt);
  assert.equal(capturedOptions.prompt.endsWith("\n"), true);
  assert.ok(capturedOptions.prompt.includes("--- BEGIN CANONICAL INPUT JSON ---"));
  assert.equal(capturedOptions.inputHash, expectedInputHash);

  // Verify result fields preserved
  assert.deepEqual(result.payload, { schemaVersion: "1.0.0", options: [] });
  assert.equal(result.outputHash, "a".repeat(64));
  assert.equal(result.eventsPath, "runs/events.jsonl");
  assert.deepEqual(result.provenance, { provider: "fake" });

  // Schema violation validation failure path
  const badRunStage = async () => {
    return {
      payload: { schemaVersion: "1.0.0", options: [], extraKey: true },
      outputHash: "b".repeat(64),
      eventsPath: "runs/events2.jsonl",
      provenance: { provider: "fake2" }
    };
  };

  await assert.rejects(
    runYadamJsonStage({
      jobDir: "C:/fake/job",
      stageId: "yadam.test.v1",
      promptPath,
      schemaPath,
      input,
      timeoutMs: 120000,
      signal: null,
      runStage: badRunStage
    }),
    error => error.code === "codex_payload_schema_invalid"
  );

  await rm(tempDir, { recursive: true, force: true });
  console.log("ok - yadam Codex JSON stage adapter");
}

// Test 2: yadam schemas reject malformed payloads
async function testSchemaRejections() {
  // Load some of the real schemas and verify they reject bad values
  const hookSchema = JSON.parse(await readFile("schemas/yadam/hook-brief.schema.json", "utf8"));
  
  // Malformed: missing sentences
  const badHook1 = { schemaVersion: "1.0.0", jobId: "job-1", stageId: "stage-1", inputHash: "hash-1", characterCount: 250 };
  const res1 = validateSchema(hookSchema, badHook1);
  assert.equal(res1.valid, false);
  assert.ok(res1.errors.length > 0);

  // Malformed: hook with 5 sentences instead of 6
  const badHook2 = {
    schemaVersion: "1.0.0",
    jobId: "job-1",
    stageId: "stage-1",
    inputHash: "hash-1",
    characterCount: 250,
    sentences: Array.from({ length: 5 }, (_, i) => ({ ordinal: i + 1, text: "Sentence", role: "none" }))
  };
  const res2 = validateSchema(hookSchema, badHook2);
  assert.equal(res2.valid, false);

  // Malformed: outline schema with 10 beats instead of 15
  const outlineSchema = JSON.parse(await readFile("schemas/yadam/outline.schema.json", "utf8"));
  const badOutline = {
    schemaVersion: "1.0.0",
    jobId: "job-1",
    stageId: "stage-1",
    inputHash: "hash-1",
    beats: Array.from({ length: 10 }, (_, i) => ({ beatId: `beat-${String(i+1).padStart(2, "0")}`, summary: "Summary" })),
    twists: Array.from({ length: 6 }, (_, i) => ({ twistId: `twist-${String(i+1).padStart(2, "0")}`, description: "Twist" })),
    emotionPoints: Array.from({ length: 6 }, (_, i) => ({ emotionPointId: `emotion-${String(i+1).padStart(2, "0")}`, description: "Emotion" })),
    themePlacements: Array.from({ length: 3 }, (_, i) => ({ themePlacementId: `theme-${String(i+1).padStart(2, "0")}`, beatId: "beat-01", description: "Theme" })),
    foreshadowing: [{ foreshadowId: "foreshadow-1", plantBeatId: "beat-03", recoveryBeatId: "beat-07", description: "Foreshadow" }],
    finaleStages: Array.from({ length: 5 }, (_, i) => ({ finaleStageId: `finale-${String(i+1).padStart(2, "0")}`, description: "Finale" })),
    fixedEnding: ["Ending 1", "Ending 2", "Ending 3"]
  };
  const res3 = validateSchema(outlineSchema, badOutline);
  assert.equal(res3.valid, false);

  console.log("ok - yadam schemas reject malformed payloads");
}

// Test 3: yadam schemas accept canonical fixtures
async function testSchemaAcceptances() {
  const hookSchema = JSON.parse(await readFile("schemas/yadam/hook-brief.schema.json", "utf8"));
  const validHook = {
    schemaVersion: "1.0.0",
    jobId: "job-1",
    stageId: "stage-1",
    inputHash: "hash-1",
    characterCount: 250,
    sentences: Array.from({ length: 6 }, (_, i) => ({ ordinal: i + 1, text: "Sentence text in Korean.", role: i === 5 ? "cta" : "intro" }))
  };
  const res1 = validateSchema(hookSchema, validHook);
  assert.equal(res1.valid, true);

  const outlineSchema = JSON.parse(await readFile("schemas/yadam/outline.schema.json", "utf8"));
  const validOutline = {
    schemaVersion: "1.0.0",
    jobId: "job-1",
    stageId: "stage-1",
    inputHash: "hash-1",
    beats: Array.from({ length: 15 }, (_, i) => ({ beatId: `beat-${String(i+1).padStart(2, "0")}`, summary: "Summary" })),
    twists: Array.from({ length: 6 }, (_, i) => ({ twistId: `twist-${String(i+1).padStart(2, "0")}`, description: "Twist" })),
    emotionPoints: Array.from({ length: 6 }, (_, i) => ({ emotionPointId: `emotion-${String(i+1).padStart(2, "0")}`, description: "Emotion" })),
    themePlacements: Array.from({ length: 3 }, (_, i) => ({ themePlacementId: `theme-${String(i+1).padStart(2, "0")}`, beatId: "beat-01", description: "Theme" })),
    foreshadowing: [{ foreshadowId: "foreshadow-1", plantBeatId: "beat-03", recoveryBeatId: "beat-07", description: "Foreshadow" }],
    finaleStages: Array.from({ length: 5 }, (_, i) => ({ finaleStageId: `finale-${String(i+1).padStart(2, "0")}`, description: "Finale" })),
    fixedEnding: ["Ending 1", "Ending 2", "Ending 3"]
  };
  const res2 = validateSchema(outlineSchema, validOutline);
  assert.equal(res2.valid, true);

  console.log("ok - yadam schemas accept canonical fixtures");
}

async function runAll() {
  await testStageAdapter();
  await testSchemaRejections();
  await testSchemaAcceptances();
}

runAll().catch(err => {
  console.error(err);
  process.exit(1);
});
