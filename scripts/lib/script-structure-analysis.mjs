export function splitParagraphs(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function splitKoreanSentences(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/(?<=[.!?。！？])\s+|(?<=[.!?。！？])|(?<=다\.)\s*/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function splitChapters(text, options = {}) {
  const paragraphs = splitParagraphs(text);
  const explicit = splitExplicitChapters(paragraphs);
  if (explicit.explicitChapterCount > 0) return explicit.chapters;
  if (options.inferChapters && Number(options.minChapters) > 1) {
    return inferChaptersFromParagraphs(paragraphs, Number(options.minChapters));
  }
  return explicit.chapters;
}

function splitExplicitChapters(paragraphs) {
  const chapters = [];
  let explicitChapterCount = 0;
  let current = { title: "도입", paragraphs: [], inferred: false };
  for (const paragraph of paragraphs) {
    if (isChapterHeading(paragraph)) {
      explicitChapterCount += 1;
      if (current.paragraphs.length) chapters.push(current);
      current = { title: paragraph.replace(/^#{1,3}\s+/, "").trim(), paragraphs: [], inferred: false };
    } else {
      current.paragraphs.push(paragraph);
    }
  }
  if (current.paragraphs.length) chapters.push(current);
  return { chapters, explicitChapterCount };
}

function isChapterHeading(paragraph) {
  return /^(#{1,3}\s+|Chapter\s*\d+|챕터\s*\d+|\d+\s*[.)]\s*챕터)/iu.test(String(paragraph || "").trim());
}

function inferChaptersFromParagraphs(paragraphs, minChapters) {
  const clean = paragraphs.map((paragraph) => paragraph.trim()).filter(Boolean);
  if (!clean.length) return [];
  const safeChapterCount = Math.min(
    Math.max(1, Math.round(minChapters)),
    Math.max(1, Math.floor(clean.length / 4)),
  );
  if (safeChapterCount <= 1) return [{ title: "도입", paragraphs: clean, inferred: false }];

  const chapters = [];
  for (let index = 0; index < safeChapterCount; index += 1) {
    const start = Math.floor((index * clean.length) / safeChapterCount);
    const end = Math.floor(((index + 1) * clean.length) / safeChapterCount);
    chapters.push({
      title: `자동 챕터 ${index + 1}`,
      paragraphs: clean.slice(start, Math.max(start + 1, end)),
      inferred: true,
    });
  }
  return chapters;
}

export function extractKeywords(text, limit = 12) {
  const stopwords = new Set([
    "그리고", "그러나", "하지만", "그래서", "오늘", "우리", "마음", "이야기", "성경",
    "하나", "사람", "자신", "때문", "것입니다", "있습니다", "합니다", "됩니다",
  ]);
  const words = String(text || "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !stopwords.has(word));
  const counts = new Map();
  for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

export function analyzeScriptStructure(text, options = {}) {
  const minChapters = options.minChapters ?? 4;
  const chapters = splitChapters(text, {
    inferChapters: options.inferChapters,
    minChapters,
  });
  const maxChapterLengthRatio = options.maxChapterLengthRatio ?? 1.65;
  const chapterReports = chapters.map((chapter, index) => {
    const body = chapter.paragraphs.join("\n\n");
    const charCount = [...body].length;
    const sentences = splitKoreanSentences(body);
    return {
      index: index + 1,
      title: chapter.title,
      inferred: Boolean(chapter.inferred),
      paragraphCount: chapter.paragraphs.length,
      sentenceCount: sentences.length,
      charCount,
      keywords: extractKeywords(body, 10),
    };
  });
  const avgChars = chapterReports.reduce((sum, chapter) => sum + chapter.charCount, 0) / Math.max(1, chapterReports.length);
  const failures = [];
  if (chapterReports.length < minChapters) failures.push(`chapter_count_too_low:${chapterReports.length}<${minChapters}`);
  for (const chapter of chapterReports) {
    if (avgChars > 0 && chapter.charCount > avgChars * maxChapterLengthRatio) {
      failures.push(`chapter_too_long:${chapter.index}:${chapter.charCount}>${Math.round(avgChars * maxChapterLengthRatio)}`);
    }
    if (chapter.paragraphCount < 4) failures.push(`chapter_paragraphs_too_low:${chapter.index}:${chapter.paragraphCount}<4`);
    if (chapter.sentenceCount < 8) failures.push(`chapter_sentences_too_low:${chapter.index}:${chapter.sentenceCount}<8`);
  }
  return {
    ok: failures.length === 0,
    failures,
    chapterCount: chapterReports.length,
    averageChapterChars: Math.round(avgChars),
    chapters: chapterReports,
  };
}
