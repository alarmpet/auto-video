import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "bible-citation-gate-"));
const emptyPath = join(dir, "empty.txt");
const groundedPath = join(dir, "grounded.txt");

writeFileSync(emptyPath, "성경은 한나가 아팠다고 말합니다.\n", "utf8");
writeFileSync(groundedPath, `
사무엘상 1장 6절은 브닌나가 한나를 격동하게 했다고 말합니다.
[성경인용:사무엘상 1:6] "여호와께서 그로 성태치 못하게 하시므로 그 대적 브닌나가 그를 심히 격동하여 번민케 하더라"
`, "utf8");

let failed = false;
try {
  execFileSync("node", [
    "scripts/check_bible_citation.mjs",
    emptyPath,
    "--min-citations",
    "1",
  ], { cwd: "C:/Users/petbl/auto-video", encoding: "utf8" });
} catch (error) {
  failed = true;
  const output = `${error.stdout || ""}${error.stderr || ""}`;
  assert.match(output, /citation_count_too_low:0<1/u);
}
assert.equal(failed, true, "empty citation script must fail when min citations is required");

const output = execFileSync("node", [
  "scripts/check_bible_citation.mjs",
  groundedPath,
  "--min-citations",
  "1",
  "--require-reference",
  "사무엘상 1장 6절",
], { cwd: "C:/Users/petbl/auto-video", encoding: "utf8" });
assert.match(output, /"ok": true/u);
assert.match(output, /"citationCount": 1/u);

console.log("test_bible_citation_required_gate: pass");
