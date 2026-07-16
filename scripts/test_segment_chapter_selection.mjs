import assert from "node:assert/strict";
import { selectChaptersForSegment } from "./lib/segment-chapter-selection.mjs";

const sourceChapters = [
  { index: 1, title: "도입", bibleRef: "" },
  { index: 2, title: "작은 말", bibleRef: "사무엘상 1:6" },
  { index: 3, title: "회복", bibleRef: "누가복음 10:41" },
];

const segmentScript = `
챕터 2. 작은 말

사무엘상 1장 6절은 한나의 마음을 보여 줍니다.

챕터 3. 회복

누가복음 10장 41절은 염려와 근심을 말합니다.
`;

const selected = selectChaptersForSegment(segmentScript, sourceChapters);
assert.deepEqual(selected.map((chapter) => chapter.index), [2, 3]);
assert.equal(selected[0].bibleRef, "사무엘상 1:6");
assert.equal(selected[1].bibleRef, "누가복음 10:41");

console.log("test_segment_chapter_selection: pass");
