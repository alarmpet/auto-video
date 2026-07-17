import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const DESCRIPTORS = {
  none: { relativePath: "assets/workflows/yadam_sdxl_reference_v1.json", outputNodeId: "9", placeholders: ["CKPT", "PROMPT", "NEGATIVE_PROMPT", "WIDTH", "HEIGHT", "SEED", "STEPS", "CFG", "SAMPLER", "SCHEDULER", "FILENAME_PREFIX"] },
  "sdxl-ipadapter-plus-face": { relativePath: "assets/workflows/yadam_sdxl_ipadapter_v1.json", outputNodeId: "9", placeholders: ["CKPT", "REFERENCE_IMAGE", "PROMPT", "NEGATIVE_PROMPT", "WIDTH", "HEIGHT", "SEED", "STEPS", "CFG", "SAMPLER", "SCHEDULER", "IPADAPTER_WEIGHT", "IPADAPTER_START", "IPADAPTER_END", "FILENAME_PREFIX"] }
};

const NUMERIC = new Set(["WIDTH", "HEIGHT", "SEED", "STEPS", "CFG", "IPADAPTER_WEIGHT", "IPADAPTER_START", "IPADAPTER_END"]);

export async function loadWorkflowDescriptor({ workspaceRoot, conditioning }) {
  const base = DESCRIPTORS[conditioning];
  if (!base) throw Object.assign(new Error(`unsupported conditioning: ${conditioning}`), { code: "unsupported_conditioning" });
  const path = resolve(workspaceRoot, base.relativePath);
  return { ...base, path, template: JSON.parse(await readFile(path, "utf8")) };
}

function substitute(value, values, seen) {
  if (Array.isArray(value)) return value.map(item => substitute(item, values, seen));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, values, seen)]));
  if (typeof value !== "string") return value;
  const match = /^\{\{([A-Z_]+)\}\}$/.exec(value);
  if (!match) {
    if (value.includes("{{")) throw Object.assign(new Error(`embedded placeholder: ${value}`), { code: "embedded_workflow_placeholder" });
    return value;
  }
  const key = match[1];
  if (!(key in values)) throw Object.assign(new Error(`missing placeholder: ${key}`), { code: "missing_workflow_placeholder" });
  seen.add(key);
  const replacement = values[key];
  if (NUMERIC.has(key) && typeof replacement !== "number") throw Object.assign(new Error(`${key} must be numeric`), { code: "workflow_placeholder_type" });
  return replacement;
}

export function compileWorkflow({ descriptor, values, objectInfo }) {
  const unknown = Object.keys(values).filter(key => !descriptor.placeholders.includes(key));
  if (unknown.length) throw Object.assign(new Error(`unknown placeholders: ${unknown.join(",")}`), { code: "unknown_workflow_placeholder" });
  const seen = new Set();
  const graph = substitute(descriptor.template, values, seen);
  const missing = descriptor.placeholders.filter(key => !seen.has(key));
  if (missing.length) throw Object.assign(new Error(`unused descriptor placeholders: ${missing.join(",")}`), { code: "unused_workflow_placeholder" });
  for (const [nodeId, node] of Object.entries(graph)) {
    if (!objectInfo[node.class_type]) throw Object.assign(new Error(`missing node class ${node.class_type}`), { code: "missing_comfy_node", nodeId });
    for (const input of Object.values(node.inputs)) {
      if (Array.isArray(input) && input.length === 2 && typeof input[0] === "string" && !graph[input[0]]) throw Object.assign(new Error(`broken node reference ${input[0]}`), { code: "broken_workflow_reference", nodeId });
    }
    if (node.class_type.includes("Lora")) throw Object.assign(new Error("LoRA nodes are forbidden in yadam v1"), { code: "forbidden_lora_node" });
  }
  if (graph[descriptor.outputNodeId]?.class_type !== "SaveImage") throw Object.assign(new Error("fixed output node missing"), { code: "workflow_output_node_missing" });
  return graph;
}
