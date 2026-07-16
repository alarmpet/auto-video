export function normalizeForRepetition(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/["']/g, "")
    .replace(/[^\p{L}\p{N}\s.,!?]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitSentencesForRepetition(text) {
  return normalizeForRepetition(text)
    .split(/(?<=[.!?])\s+|(?<=[.!?])/u)
    .map((value) => value.trim())
    .filter((value) => value.length >= 8);
}

export function repeatedNgrams(text, n = 5, minCount = 4) {
  const tokens = normalizeForRepetition(text)
    .replace(/[.,!?]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
  const counts = new Map();
  for (let index = 0; index <= tokens.length - n; index += 1) {
    const key = tokens.slice(index, index + n).join(" ");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 30)
    .map(([phrase, count]) => ({ phrase, count }));
}

export function repeatedSentencePrefixes(text, prefixLength = 18, minCount = 4) {
  const counts = new Map();
  for (const sentence of splitSentencesForRepetition(text)) {
    const key = sentence.slice(0, prefixLength);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((left, right) => right[1] - left[1])
    .map(([prefix, count]) => ({ prefix, count }));
}

export function phraseCount(text, phrases) {
  const normalized = normalizeForRepetition(text);
  return Object.fromEntries(phrases.map((phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = normalized.match(new RegExp(escaped, "g")) || [];
    return [phrase, matches.length];
  }));
}

export function analyzeLongformRepetition(text, options = {}) {
  const watchPhrases = options.watchPhrases || [
    "잠들기 전 듣는 이야기",
    "오늘 밤",
    "우리 마음",
    "성경 속",
  ];
  return {
    repeatedFiveGrams: repeatedNgrams(text, 5, options.minNgramCount ?? 4),
    repeatedSevenGrams: repeatedNgrams(text, 7, options.minLongNgramCount ?? 3),
    repeatedSentencePrefixes: repeatedSentencePrefixes(text, 18, options.minPrefixCount ?? 4),
    watchedPhraseCounts: phraseCount(text, watchPhrases),
  };
}
