import Ajv2020 from "ajv/dist/2020.js";
import { readJson } from "./atomic-store.mjs";
import { resolve, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_PROJECT_ROOT = resolve(__dirname, "..", "..", "..");

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  useDefaults: true
});

const compiledCache = new Map();

export async function validateSchema(schemaPath, value) {
  let absPath = resolve(schemaPath);
  if (!existsSync(absPath)) {
    const relativePart = schemaPath.includes("schemas")
      ? schemaPath.slice(schemaPath.indexOf("schemas"))
      : schemaPath;
    const fallbackPath = resolve(REAL_PROJECT_ROOT, relativePart);
    if (existsSync(fallbackPath)) {
      absPath = fallbackPath;
    }
  }

  let validatePromise = compiledCache.get(absPath);
  if (!validatePromise) {
    validatePromise = (async () => {
      let schemaJson;
      try {
        schemaJson = await readJson(absPath);
      } catch (err) {
        throw new Error(`failed to load schema at ${absPath}: ${err.message}`, { cause: err });
      }
      if (schemaJson.$id && ajv.getSchema(schemaJson.$id)) {
        return ajv.getSchema(schemaJson.$id);
      }
      return ajv.compile(schemaJson);
    })();
    compiledCache.set(absPath, validatePromise);
  }
  const validate = await validatePromise;

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
