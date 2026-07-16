import { splitParagraphs } from "./script-structure-analysis.mjs";

function normalize(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function charNgrams(text, n = 4) {
  const value = normalize(text).replace(/\s+/g, "");
  const grams = new Map();
  for (let index = 0; index <= value.length - n; index += 1) {
    const gram = value.slice(index, index + n);
    grams.set(gram, (grams.get(gram) || 0) + 1);
  }
  return grams;
}

function cosine(a, b) {
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (const value of a.values()) aNorm += value * value;
  for (const value of b.values()) bNorm += value * value;
  for (const [key, value] of a.entries()) dot += value * (b.get(key) || 0);
  if (!aNorm || !bNorm) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

export function analyzeSemanticOverlap(text, options = {}) {
  const threshold = options.threshold ?? 0.82;
  const maxPairs = options.maxPairs ?? 20;
  const paragraphs = splitParagraphs(text).filter((paragraph) => [...paragraph].length >= 80);
  const vectors = paragraphs.map((paragraph) => charNgrams(paragraph, 4));
  const overlaps = [];
  for (let left = 0; left < paragraphs.length; left += 1) {
    for (let right = left + 1; right < paragraphs.length; right += 1) {
      const score = cosine(vectors[left], vectors[right]);
      if (score >= threshold) {
        overlaps.push({
          leftParagraph: left + 1,
          rightParagraph: right + 1,
          score: Number(score.toFixed(3)),
          leftPreview: paragraphs[left].slice(0, 80),
          rightPreview: paragraphs[right].slice(0, 80),
        });
      }
    }
  }
  overlaps.sort((a, b) => b.score - a.score);
  return {
    ok: overlaps.length === 0,
    threshold,
    overlapCount: overlaps.length,
    overlaps: overlaps.slice(0, maxPairs),
  };
}
