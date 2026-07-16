import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dataPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "bible-krv.json");

let cached = null;
function loadBible() {
  if (!cached) cached = JSON.parse(readFileSync(dataPath, "utf8"));
  return cached;
}

export function parseReference(reference) {
  const normalized = String(reference || "")
    .replace(/\s+/g, " ")
    .replace(/절/g, "")
    .trim();
  const match = normalized.match(/^(.+?)\s*(\d+)(?:장|:)\s*(\d+)(?:\s*-\s*(\d+))?$/u);
  if (!match) throw new Error(`Invalid bible reference: ${reference}`);
  const [, book, chapter, startVerse, endVerse] = match;
  return {
    book: book.trim(),
    chapter,
    startVerse: Number(startVerse),
    endVerse: Number(endVerse || startVerse),
  };
}

export function lookupVerses(reference) {
  const bible = loadBible();
  const { book, chapter, startVerse, endVerse } = parseReference(reference);
  const chapterVerses = bible.books?.[book]?.[chapter];
  if (!chapterVerses) throw new Error(`Missing chapter in bible-krv.json: ${book} ${chapter}`);
  const verses = [];
  for (let verse = startVerse; verse <= endVerse; verse += 1) {
    const text = chapterVerses[String(verse)];
    if (!text) throw new Error(`Missing verse in bible-krv.json: ${book} ${chapter}:${verse}`);
    verses.push({ verse, text });
  }
  return { book, chapter, translation: bible.translation, verses };
}

export function formatCitation(reference) {
  const parsed = parseReference(reference);
  const { book, chapter, translation, verses } = lookupVerses(reference);
  const range = verses.length > 1 ? `${verses[0].verse}-${verses.at(-1).verse}` : `${verses[0].verse}`;
  const body = verses.map((v) => v.text).join(" ");
  return `${book} ${chapter}장 ${range}절, ${translation}\n[성경인용:${book} ${chapter}:${parsed.startVerse}${parsed.endVerse !== parsed.startVerse ? `-${parsed.endVerse}` : ""}] "${body}"`;
}
