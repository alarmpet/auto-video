import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractPsychTheme,
  filterUnusedTopicCandidates,
  isTopicUsed,
  loadTopicHistory,
  normalizeTopicKey,
  normalizeTopicTitle,
  recordTopicSelection,
} from "./lib/topic-history.mjs";

const temp = mkdtempSync(join(tmpdir(), "topic-history-"));
const historyPath = join(temp, "topic-history.json");

assert.equal(
  normalizeTopicTitle("  요셉은 어떻게 억울함 속에서도 무너지지 않았을까 | 배신과 기다림의 심리  "),
  "요셉은어떻게억울함속에서도무너지지않았을까|배신과기다림의심리",
);
assert.equal(
  extractPsychTheme("요셉은 어떻게 억울함 속에서도 무너지지 않았을까 | 배신과 기다림의 심리"),
  "배신과 기다림의 심리",
);
assert.equal(
  normalizeTopicKey({ title: "요셉은 어떻게 억울함 속에서도 무너지지 않았을까 | 배신과 기다림의 심리" }),
  "배신과기다림의심리",
);

recordTopicSelection({
  historyPath,
  title: "요셉은 어떻게 억울함 속에서도 무너지지 않았을까 | 배신과 기다림의 심리",
  slug: "gguljam-bible-joseph-betrayal-waiting-20min-001",
  targetMinutes: 20,
  stage: "chapter_storyboard",
  selectedAt: "2026-07-02T00:00:00.000Z",
});

let history = loadTopicHistory(historyPath);
assert.equal(history.selectedTopics.length, 1);
assert.equal(history.selectedTopics[0].psychTheme, "배신과 기다림의 심리");
assert.equal(history.selectedTopics[0].topicKey, "배신과기다림의심리");
assert.equal(
  isTopicUsed("룻은 낯선 땅에서 어떻게 버텼을까 | 배신과 기다림의 심리", history),
  true,
);

recordTopicSelection({
  historyPath,
  title: "룻은 낯선 땅에서 어떻게 다시 걸었을까 | 배신과 기다림의 심리",
  slug: "other-slug",
  targetMinutes: 20,
  stage: "script",
  selectedAt: "2026-07-02T00:10:00.000Z",
});

history = loadTopicHistory(historyPath);
assert.equal(history.selectedTopics.length, 1);
assert.equal(history.selectedTopics[0].slug, "other-slug");
assert.equal(history.selectedTopics[0].stage, "script");

const filtered = filterUnusedTopicCandidates(
  [
    "요셉은 어떻게 억울함 속에서도 무너지지 않았을까 | 배신과 기다림의 심리",
    "요셉은 왜 용서한 뒤에도 눈물을 흘렸을까 | 용서와 애도의 심리",
    { title: "야곱은 왜 사랑받고도 불안했을까 | 인정 욕구와 불안의 심리" },
  ],
  history,
);

assert.deepEqual(filtered, [
  "요셉은 왜 용서한 뒤에도 눈물을 흘렸을까 | 용서와 애도의 심리",
  { title: "야곱은 왜 사랑받고도 불안했을까 | 인정 욕구와 불안의 심리" },
]);

const raw = JSON.parse(readFileSync(historyPath, "utf8"));
assert.equal(raw.version, 1);

console.log("test_topic_history: pass");
