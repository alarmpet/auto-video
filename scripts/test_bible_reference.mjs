import assert from "node:assert/strict";
import { formatCitation, lookupVerses, parseReference } from "./lib/bible-reference.mjs";

assert.deepEqual(parseReference("사무엘상 1:6-7"), {
  book: "사무엘상",
  chapter: "1",
  startVerse: 6,
  endVerse: 7,
});

assert.deepEqual(parseReference("사무엘상 1장 10-11절"), {
  book: "사무엘상",
  chapter: "1",
  startVerse: 10,
  endVerse: 11,
});

assert.deepEqual(parseReference("사무엘상 1장 10 - 11절"), {
  book: "사무엘상",
  chapter: "1",
  startVerse: 10,
  endVerse: 11,
});

const first = lookupVerses("사무엘상 1:6");
assert.equal(first.book, "사무엘상");
assert.equal(first.chapter, "1");
assert.equal(first.translation, "개역한글판");
assert.equal(first.verses.length, 1);
assert.match(first.verses[0].text, /브닌나|격동|번민/u);

const citation = formatCitation("사무엘상 1:10-11");
assert.match(citation, /^사무엘상 1장 10-11절, 개역한글판/u);
assert.match(citation, /\[성경인용:사무엘상 1:10-11\]/u);
assert.match(citation, /마음이 괴로와서/u);

console.log("test_bible_reference: pass");
