import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const autoVideo = readFileSync("C:/Users/petbl/auto-video/auto-video.md", "utf8");
const templates = readFileSync("C:/Users/petbl/auto-video/docs/agent-invocation-templates.md", "utf8");
const handoff = readFileSync("C:/Users/petbl/auto-video/docs/agent-handoff-contract.md", "utf8");

assert.match(autoVideo, /각 챕터의 Story 단계에는 짧은 성경 원문 인용을 최소 1회 포함해야 한다/u);
assert.match(autoVideo, /사무엘상 1장 6절/u);
assert.match(autoVideo, /성경은 .* 말합니다.*처럼 뭉뚱그리지 않는다/u);
assert.match(templates, /chapters\.json.*bibleRef/u);
assert.match(templates, /각 담당 챕터마다 \[성경인용:/u);
assert.match(templates, /bibleGrounding/u);
assert.match(templates, /bibleCitation/u);
assert.match(handoff, /script-quality-suite-report\.json.*bibleGrounding.*bibleCitation/u);

console.log("test_bible_authoring_docs: pass");
