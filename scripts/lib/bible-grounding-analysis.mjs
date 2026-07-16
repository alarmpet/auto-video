import { splitChapters } from "./script-structure-analysis.mjs";

const CITATION_RE = /\[성경인용:([^\]]+)\]\s*["“”‘’]([^"“”‘’]+)["“”‘’]/gu;
const SPECIFIC_REF_RE = /(?:창세기|출애굽기|레위기|민수기|신명기|여호수아|사사기|룻기|사무엘상|사무엘하|열왕기상|열왕기하|역대상|역대하|에스라|느헤미야|에스더|욥기|시편|잠언|전도서|아가|이사야|예레미야|예레미야애가|에스겔|다니엘|호세아|요엘|아모스|오바댜|요나|미가|나훔|하박국|스바냐|학개|스가랴|말라기|마태복음|마가복음|누가복음|요한복음|사도행전|로마서|고린도전서|고린도후서|갈라디아서|에베소서|빌립보서|골로새서|데살로니가전서|데살로니가후서|디모데전서|디모데후서|디도서|빌레몬서|히브리서|야고보서|베드로전서|베드로후서|요한일서|요한이서|요한삼서|유다서|요한계시록)\s*\d+\s*(?:장|:)\s*\d+/u;
const VAGUE_CLAIM_RE = /성경(?:은|에서는|에선)?\s+[^.?!\n]{0,30}(?:말합니다|보여\s*줍니다|기록합니다)/gu;

export function extractCitationBlocks(text) {
  const normalizedText = String(text || "").normalize("NFC");
  return [...normalizedText.matchAll(CITATION_RE)].map((match) => ({
    reference: match[1].trim(),
    quote: match[2].trim(),
    index: match.index,
  }));
}

export function analyzeBibleGrounding(text, options = {}) {
  const normalizedText = String(text || "").normalize("NFC");
  const chaptersInput = Array.isArray(options.chapters) ? options.chapters : [];
  const minCitationsPerChapter = Number(options.minCitationsPerChapter ?? 1);
  const scriptChapters = splitChapters(normalizedText, {
    inferChapters: true,
    minChapters: Math.max(1, chaptersInput.length || Number(options.minChapters || 1)),
  });
  const citations = extractCitationBlocks(normalizedText);
  const vagueClaims = [...normalizedText.matchAll(VAGUE_CLAIM_RE)]
    .map((match) => match[0])
    .filter((claim) => !SPECIFIC_REF_RE.test(claim));
  const failures = [];

  const chapterReports = scriptChapters.map((chapter, index) => {
    const body = chapter.paragraphs.join("\n\n");
    const chapterCitations = extractCitationBlocks(body);
    const hasSpecificReference = SPECIFIC_REF_RE.test(body);
    const expectedRef = chaptersInput[index]?.bibleRef || "";
    const expectedBook = expectedRef.replace(/\s*\d+.*/u, "").trim();
    const requiresGrounding = Boolean(expectedRef);
    const expectedBookMentioned = expectedBook ? body.includes(expectedBook) : true;
    const expectedReferenceMentioned = !requiresGrounding
      || chapterCitations.some((citation) => referencesOverlap(citation.reference, expectedRef))
      || body.includes(expectedRef)
      || body.includes(expectedRef.replace(/:/u, "장 "));
    const citationOk = !requiresGrounding || chapterCitations.length >= minCitationsPerChapter;
    const referenceOk = !requiresGrounding || hasSpecificReference;
    const bookOk = !requiresGrounding || expectedBookMentioned;
    const expectedRefOk = !requiresGrounding || expectedReferenceMentioned;
    const ok = citationOk && referenceOk && bookOk && expectedRefOk;
    if (requiresGrounding) {
      if (!citationOk) failures.push(`chapter_${index + 1}_missing_citation`);
      if (!referenceOk) failures.push(`chapter_${index + 1}_missing_specific_reference`);
      if (!bookOk) failures.push(`chapter_${index + 1}_missing_expected_book:${expectedBook}`);
      if (!expectedRefOk) failures.push(`chapter_${index + 1}_missing_expected_reference:${expectedRef}`);
    }
    return {
      index: index + 1,
      title: chapter.title,
      expectedRef,
      requiresGrounding,
      citationCount: chapterCitations.length,
      hasSpecificReference,
      expectedBookMentioned,
      expectedReferenceMentioned,
      ok,
    };
  });

  if (vagueClaims.length) failures.push(`vague_bible_claims:${vagueClaims.length}`);
  return {
    ok: failures.length === 0,
    failures,
    citationCount: citations.length,
    vagueClaims,
    chapterReports,
  };
}

function parseLooseReference(reference) {
  const normalized = String(reference || "")
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .replace(/절/gu, "")
    .trim();
  const match = normalized.match(/^(.+?)\s*(\d+)(?:장|:)\s*(\d+)(?:\s*-\s*(\d+))?$/u);
  if (!match) return null;
  const [, book, chapter, startVerse, endVerse] = match;
  return {
    book: book.trim(),
    chapter: Number(chapter),
    startVerse: Number(startVerse),
    endVerse: Number(endVerse || startVerse),
  };
}

function referencesOverlap(candidate, expected) {
  const left = parseLooseReference(candidate);
  const right = parseLooseReference(expected);
  if (!left || !right) return String(candidate || "").trim() === String(expected || "").trim();
  if (left.book !== right.book || left.chapter !== right.chapter) return false;
  return left.startVerse <= right.endVerse && right.startVerse <= left.endVerse;
}
