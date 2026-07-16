import assert from "node:assert/strict";
import { analyzeBibleGrounding } from "./lib/bible-grounding-analysis.mjs";

const chapters = [
  { index: 1, title: "반복된 말", bibleRef: "사무엘상 1:6-7" },
  { index: 2, title: "통곡의 기도", bibleRef: "사무엘상 1:10-11" },
];

const grounded = `
챕터 1. 반복된 말

사무엘상 1장 6절은 브닌나가 한나를 격동하게 했다고 말합니다.
[성경인용:사무엘상 1:6] "여호와께서 그로 성태치 못하게 하시므로 그 대적 브닌나가 그를 심히 격동하여 번민케 하더라"

그 장면은 오늘 작은 말이 왜 크게 들리는지 보여 줍니다.

챕터 2. 통곡의 기도

사무엘상 1장 10절은 한나가 마음이 괴로워 통곡했다고 말합니다.
[성경인용:사무엘상 1:10] "한나가 마음이 괴로와서 여호와께 기도하고 통곡하며"

여기서 울음은 믿음 없음이 아니라 안전한 곳에서 마음이 흘러나오는 길입니다.
`;

const report = analyzeBibleGrounding(grounded, { chapters, minCitationsPerChapter: 1 });
assert.equal(report.ok, true, JSON.stringify(report, null, 2));
assert.equal(report.citationCount, 2);
assert.equal(report.chapterReports.length, 2);
assert.deepEqual(report.failures, []);

const smartQuote = `
챕터 1. 반복된 말

사무엘상 1장 6절은 브닌나가 한나를 격동하게 했다고 말합니다.
[성경인용:사무엘상 1:6] “여호와께서 그로 성태치 못하게 하시므로 그 대적 브닌나가 그를 심히 격동하여 번민케 하더라”
`;
const smartReport = analyzeBibleGrounding(smartQuote, {
  chapters: [{ index: 1, title: "반복된 말", bibleRef: "사무엘상 1:6" }],
  minCitationsPerChapter: 1,
});
assert.equal(smartReport.ok, true, JSON.stringify(smartReport, null, 2));
assert.equal(smartReport.citationCount, 1);

const introOutro = `
챕터 1. 들어가며

오늘 밤에는 마음이 조금 천천히 내려앉아도 됩니다.

챕터 2. 반복된 말

사무엘상 1장 6절은 브닌나가 한나를 격동하게 했다고 말합니다.
[성경인용:사무엘상 1:6] "여호와께서 그로 성태치 못하게 하시므로 그 대적 브닌나가 그를 심히 격동하여 번민케 하더라"
`;
const optionalChapterReport = analyzeBibleGrounding(introOutro, {
  chapters: [
    { index: 1, title: "들어가며", bibleRef: "" },
    { index: 2, title: "반복된 말", bibleRef: "사무엘상 1:6" },
  ],
  minCitationsPerChapter: 1,
});
assert.equal(optionalChapterReport.ok, true, JSON.stringify(optionalChapterReport, null, 2));
assert.equal(optionalChapterReport.chapterReports[0].requiresGrounding, false);

const vague = `
챕터 1. 반복된 말

성경은 그 일이 해마다 반복되었다고 말합니다.
반복된 말은 마음에 길을 냅니다.

챕터 2. 통곡의 기도

성경에서는 한나가 울었다고 말합니다.
울음은 길이 될 수 있습니다.
`;

const bad = analyzeBibleGrounding(vague, { chapters, minCitationsPerChapter: 1 });
assert.equal(bad.ok, false);
assert(bad.failures.includes("chapter_1_missing_citation"));
assert(bad.failures.includes("chapter_2_missing_citation"));
assert(bad.failures.some((item) => item.startsWith("vague_bible_claims:")));

const wrongVerse = `
챕터 1. 반복된 말

사무엘상 1장 10절은 한나가 마음이 괴로워 통곡했다고 말합니다.
[성경인용:사무엘상 1:10] "한나가 마음이 괴로와서 여호와께 기도하고 통곡하며"
`;
const wrongVerseReport = analyzeBibleGrounding(wrongVerse, {
  chapters: [{ index: 1, title: "반복된 말", bibleRef: "사무엘상 1:6" }],
  minCitationsPerChapter: 1,
});
assert.equal(wrongVerseReport.ok, false);
assert(wrongVerseReport.failures.includes("chapter_1_missing_expected_reference:사무엘상 1:6"));

console.log("test_bible_grounding_analysis: pass");
