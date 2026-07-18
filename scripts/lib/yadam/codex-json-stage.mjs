// scripts/lib/yadam/codex-json-stage.mjs
import { readFile } from "node:fs/promises";
import { runCodexStage } from "../pipeline/codex-stage-runner.mjs";
import { canonicalJson, sha256Bytes } from "../pipeline/canonical-json.mjs";
import { validateSchema } from "./schema-validator.mjs";

function codedError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

export async function runYadamJsonStage({
  jobDir,
  stageId,
  promptPath,
  schemaPath,
  input,
  timeoutMs,
  signal,
  runStage = runCodexStage
}) {
  let promptBody;
  let schemaJson;
  try {
    promptBody = await readFile(promptPath, "utf8");
    schemaJson = JSON.parse(await readFile(schemaPath, "utf8"));
  } catch (err) {
    throw new Error(`Failed to load stage inputs: ${err.message}`);
  }

  const nfcPromptBody = promptBody.normalize("NFC");
  const canonicalInput = canonicalJson(input);
  const inputHash = sha256Bytes(Buffer.from(canonicalInput, "utf8"));

  const prompt = `${nfcPromptBody.trimEnd()}\n\n` +
    `You must set the "inputHash" field in the output JSON to exactly: "${inputHash}" (echo it byte-for-byte).\n\n` +
    `--- BEGIN CANONICAL INPUT JSON ---\n${canonicalInput}\n--- END CANONICAL INPUT JSON ---\n`;

  const result = await runStage({
    jobDir,
    stageId,
    prompt,
    schemaPath,
    inputHash,
    timeoutMs,
    signal
  });

  const validation = validateSchema(schemaJson, result.payload);
  if (!validation.valid) {
    throw codedError("codex_payload_schema_invalid", "Local schema validation of Codex payload failed", validation.errors);
  }

  return {
    payload: result.payload,
    outputHash: result.outputHash,
    eventsPath: result.eventsPath,
    provenance: result.provenance
  };
}
