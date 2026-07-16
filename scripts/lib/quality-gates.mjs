import { analyzeLongformRepetition } from "./repetition-analysis.mjs";

export function splitParagraphs(text) {
  return String(text || "")
    .split(/\n\s*\n/g)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function normalizeKoreanText(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function countRepeatedParagraphStarts(text, prefixLength = 42) {
  const counts = new Map();
  for (const paragraph of splitParagraphs(text)) {
    const key = normalizeKoreanText(paragraph).slice(0, prefixLength);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1]);
}

export function countRepeatedSentences(text, minLength = 24) {
  const counts = new Map();
  const sentences = normalizeKoreanText(text)
    .split(/(?<=[.!?])\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length >= minLength);
  for (const sentence of sentences) {
    counts.set(sentence, (counts.get(sentence) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1]);
}

export function tokenSet(value) {
  return new Set(
    normalizeKoreanText(value)
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2),
  );
}

export function jaccardSimilarity(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size && !right.size) return 1;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function findNearDuplicateParagraphs(text, threshold = 0.82) {
  const paragraphs = splitParagraphs(text);
  const matches = [];
  for (let i = 0; i < paragraphs.length; i += 1) {
    for (let j = i + 1; j < paragraphs.length; j += 1) {
      const score = jaccardSimilarity(paragraphs[i], paragraphs[j]);
      if (score >= threshold) {
        matches.push({
          left: i + 1,
          right: j + 1,
          score: Number(score.toFixed(3)),
        });
      }
    }
  }
  return matches.slice(0, 50);
}

export function assertLongformScriptQuality(text, options = {}) {
  const maxRepeatedStart = options.maxRepeatedStart ?? 3;
  const maxRepeatedSentence = options.maxRepeatedSentence ?? 2;
  const minParagraphs = options.minParagraphs ?? 90;
  const repeatedStarts = countRepeatedParagraphStarts(text);
  const repeatedSentences = countRepeatedSentences(text);
  const nearDuplicateParagraphs = findNearDuplicateParagraphs(
    text,
    options.nearDuplicateThreshold ?? 0.82,
  );
  const paragraphs = splitParagraphs(text);
  const repetition = analyzeLongformRepetition(text, options.repetition || {});
  const overusedWatchedPhrases = Object.entries(repetition.watchedPhraseCounts)
    .filter(([, count]) => count > (options.maxWatchedPhraseCount ?? 8));
  const failures = [];

  if (paragraphs.length < minParagraphs) {
    failures.push(`paragraph_count_too_low:${paragraphs.length}<${minParagraphs}`);
  }
  if (repeatedStarts.some(([, count]) => count > maxRepeatedStart)) {
    failures.push(`repeated_paragraph_start:${JSON.stringify(repeatedStarts.slice(0, 5))}`);
  }
  if (repeatedSentences.some(([, count]) => count > maxRepeatedSentence)) {
    failures.push(`repeated_sentence:${JSON.stringify(repeatedSentences.slice(0, 5))}`);
  }
  if (nearDuplicateParagraphs.length > (options.maxNearDuplicateParagraphs ?? 8)) {
    failures.push(`near_duplicate_paragraphs:${JSON.stringify(nearDuplicateParagraphs.slice(0, 8))}`);
  }
  if (repetition.repeatedFiveGrams.length > (options.maxRepeatedFiveGrams ?? 12)) {
    failures.push(`repeated_five_grams:${JSON.stringify(repetition.repeatedFiveGrams.slice(0, 8))}`);
  }
  if (repetition.repeatedSevenGrams.length > (options.maxRepeatedSevenGrams ?? 6)) {
    failures.push(`repeated_seven_grams:${JSON.stringify(repetition.repeatedSevenGrams.slice(0, 6))}`);
  }
  if (repetition.repeatedSentencePrefixes.length > (options.maxRepeatedSentencePrefixes ?? 10)) {
    failures.push(`repeated_sentence_prefixes:${JSON.stringify(repetition.repeatedSentencePrefixes.slice(0, 8))}`);
  }
  if (overusedWatchedPhrases.length) {
    failures.push(`overused_watch_phrases:${JSON.stringify(overusedWatchedPhrases)}`);
  }

  return {
    ok: failures.length === 0,
    failures,
    paragraphs: paragraphs.length,
    repeatedStarts: repeatedStarts.slice(0, 20),
    repeatedSentences: repeatedSentences.slice(0, 20),
    nearDuplicateParagraphs,
    repetition,
  };
}
