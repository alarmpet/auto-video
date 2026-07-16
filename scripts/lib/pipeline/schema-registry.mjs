import Ajv2020 from "ajv/dist/2020.js";
import { readJson } from "./atomic-store.mjs";
import { resolve } from "node:path";

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  useDefaults: true
});

const compiledCache = new Map();

export async function validateSchema(schemaPath, value) {
  const absPath = resolve(schemaPath);
  let validate = compiledCache.get(absPath);
  if (!validate) {
    let schemaJson;
    try {
      schemaJson = await readJson(absPath);
    } catch (err) {
      throw new Error(`failed to load schema at ${absPath}: ${err.message}`, { cause: err });
    }
    validate = ajv.compile(schemaJson);
    compiledCache.set(absPath, validate);
  }

  const valid = validate(value);
  if (!valid) {
    const sortedErrors = [...validate.errors].sort((a, b) => {
      const pathA = a.instancePath || "";
      const pathB = b.instancePath || "";
      if (pathA < pathB) return -1;
      if (pathA > pathB) return 1;
      const kwA = a.keyword || "";
      const kwB = b.keyword || "";
      if (kwA < kwB) return -1;
      if (kwA > kwB) return 1;
      return 0;
    });

    const details = sortedErrors.map(err => ({
      instancePath: err.instancePath,
      keyword: err.keyword,
      message: err.message
    }));

    const error = new Error(`schema validation failed for ${schemaPath}`);
    error.name = "SchemaValidationError";
    error.code = "schema_validation_failed";
    error.details = details;
    throw error;
  }
  return value;
}
