import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const defaultTopicHistoryPath = join(root, "data", "topic-history.json");

export function normalizeTopicTitle(title) {
  return String(title || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim();
}

export function extractPsychTheme(title) {
  const text = String(title || "").trim();
  if (!text) return "";
  const parts = text.split("|");
  return (parts.length > 1 ? parts.at(-1) : text).trim();
}

export function normalizeTopicKey({ title = "", theme = "" } = {}) {
  return normalizeTopicTitle(theme || extractPsychTheme(title));
}

export function loadTopicHistory(historyPath = defaultTopicHistoryPath) {
  if (!existsSync(historyPath)) {
    return { version: 1, selectedTopics: [] };
  }
  const parsed = JSON.parse(readFileSync(historyPath, "utf8"));
  return {
    version: Number(parsed.version || 1),
    selectedTopics: Array.isArray(parsed.selectedTopics) ? parsed.selectedTopics : [],
  };
}

export function saveTopicHistory(history, historyPath = defaultTopicHistoryPath) {
  mkdirSync(dirname(historyPath), { recursive: true });
  const normalized = {
    version: 1,
    selectedTopics: [...(history.selectedTopics || [])].sort((a, b) =>
      String(a.selectedAt || "").localeCompare(String(b.selectedAt || "")),
    ),
  };
  writeFileSync(historyPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export function isTopicUsed(title, history = loadTopicHistory()) {
  const key = normalizeTopicKey({ title });
  if (!key) return false;
  return (history.selectedTopics || []).some((topic) => (topic.topicKey || topic.normalizedTitle) === key);
}

export function recordTopicSelection({
  historyPath = defaultTopicHistoryPath,
  title,
  theme = "",
  biblicalAnchor = "",
  slug = "",
  targetMinutes = null,
  stage = "selected",
  selectedAt = new Date().toISOString(),
  notes = "",
} = {}) {
  const normalizedTitle = normalizeTopicTitle(title);
  if (!normalizedTitle) throw new Error("title is required");
  const psychTheme = String(theme || extractPsychTheme(title)).trim();
  const topicKey = normalizeTopicKey({ title, theme: psychTheme });

  const history = loadTopicHistory(historyPath);
  const entry = {
    title: String(title).trim(),
    normalizedTitle,
    psychTheme,
    topicKey,
    biblicalAnchor: String(biblicalAnchor || inferBiblicalAnchor(title)).trim(),
    slug: String(slug || "").trim(),
    targetMinutes: targetMinutes === null || targetMinutes === "" ? null : Number(targetMinutes),
    stage: String(stage || "selected"),
    selectedAt,
    notes: String(notes || "").trim(),
  };
  const index = history.selectedTopics.findIndex(
    (topic) => (topic.topicKey || topic.normalizedTitle) === topicKey,
  );
  if (index >= 0) {
    history.selectedTopics[index] = {
      ...history.selectedTopics[index],
      ...entry,
      firstSelectedAt: history.selectedTopics[index].firstSelectedAt || history.selectedTopics[index].selectedAt,
    };
  } else {
    history.selectedTopics.push({ ...entry, firstSelectedAt: selectedAt });
  }
  return saveTopicHistory(history, historyPath);
}

export function filterUnusedTopicCandidates(candidates, history = loadTopicHistory()) {
  return (candidates || []).filter((candidate) => {
    const title = typeof candidate === "string" ? candidate : candidate?.title;
    const theme = typeof candidate === "string" ? "" : candidate?.theme;
    const key = normalizeTopicKey({ title, theme });
    if (!key) return true;
    return !(history.selectedTopics || []).some((topic) => (topic.topicKey || topic.normalizedTitle) === key);
  });
}

export function listSelectedTopicTitles(history = loadTopicHistory()) {
  return (history.selectedTopics || []).map((topic) => topic.title);
}

function inferBiblicalAnchor(title) {
  const text = String(title || "");
  const beforeSeparator = text.split("|")[0] || text;
  const match = beforeSeparator.match(/([가-힣]{2,6})(?:은|는|이|가|도|와|과|에게|처럼|의)?/);
  return match?.[1] || "";
}
