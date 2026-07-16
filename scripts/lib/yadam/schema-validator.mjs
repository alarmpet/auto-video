// scripts/lib/yadam/schema-validator.mjs
import Ajv from "ajv/dist/2020.js";

const ALLOWED_KEYWORDS = new Set([
  "$schema", "$id", "$defs", "$ref", "type", "required", "additionalProperties",
  "properties", "items", "minItems", "maxItems", "uniqueItems", "enum", "const",
  "pattern", "minimum", "maximum", "minLength", "maxLength", "oneOf", "allOf",
  "title", "description", "default"
]);

export function verifySchemaKeywords(schema) {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return;
  for (const [key, val] of Object.entries(schema)) {
    if (key === "properties" || key === "$defs") {
      if (val && typeof val === "object") {
        for (const subSchema of Object.values(val)) {
          verifySchemaKeywords(subSchema);
        }
      }
    } else {
      if (!ALLOWED_KEYWORDS.has(key)) {
        const err = new Error(`Unsupported schema keyword: ${key}`);
        err.code = "schema_keyword_unsupported";
        throw err;
      }
      if (val && typeof val === "object") {
        verifySchemaKeywords(val);
      }
    }
  }
}

export function validateSchema(schema, value) {
  // Enforce no unsupported keywords in the schema
  verifySchemaKeywords(schema);

  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const valid = validate(value);

  if (valid) {
    return { valid: true };
  } else {
    const errors = validate.errors.map(err => ({
      instancePath: err.instancePath,
      keyword: err.keyword,
      message: err.message
    })).toSorted((left, right) => {
      return left.instancePath.localeCompare(right.instancePath) ||
        left.keyword.localeCompare(right.keyword) ||
        left.message.localeCompare(right.message);
    });
    return { valid: false, errors };
  }
}
