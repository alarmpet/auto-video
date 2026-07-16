#!/usr/bin/env node
import { readFileSync } from "node:fs";
import {
  defaultTopicHistoryPath,
  filterUnusedTopicCandidates,
  listSelectedTopicTitles,
  loadTopicHistory,
  recordTopicSelection,
} from "./lib/topic-history.mjs";

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || "list";
const historyPath = args.history || defaultTopicHistoryPath;

if (command === "list") {
  const titles = listSelectedTopicTitles(loadTopicHistory(historyPath));
  console.log(JSON.stringify({ historyPath, count: titles.length, titles }, null, 2));
} else if (command === "record") {
  const history = recordTopicSelection({
    historyPath,
    title: required(args.title, "--title"),
    theme: args.theme || "",
    biblicalAnchor: args.biblicalAnchor || args["biblical-anchor"] || "",
    slug: args.slug || "",
    targetMinutes: args.targetMinutes || args["target-minutes"] || null,
    stage: args.stage || "selected",
    notes: args.notes || "",
  });
  console.log(JSON.stringify({ historyPath, count: history.selectedTopics.length }, null, 2));
} else if (command === "filter") {
  const candidates = args.candidatesJson
    ? JSON.parse(stripBom(readFileSync(args.candidatesJson, "utf8")))
    : JSON.parse(required(args.candidates || "[]", "--candidates or --candidates-json"));
  const filtered = filterUnusedTopicCandidates(candidates, loadTopicHistory(historyPath));
  console.log(JSON.stringify(filtered, null, 2));
} else {
  throw new Error(`Unknown command: ${command}`);
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function required(value, label) {
  if (!value) throw new Error(`${label} is required`);
  return value;
}

function stripBom(text) {
  return String(text || "").replace(/^\uFEFF/, "");
}
