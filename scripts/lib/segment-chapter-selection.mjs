import { splitChapters } from "./script-structure-analysis.mjs";

export function selectChaptersForSegment(segmentScript, sourceChapters = []) {
  if (!Array.isArray(sourceChapters) || !sourceChapters.length) return [];
  const parsed = splitChapters(segmentScript, { inferChapters: false });
  const selected = [];

  for (const chapter of parsed) {
    const title = String(chapter.title || "");
    const match =
      title.match(/(?:Chapter|챕터)\s*(\d+)/iu) ||
      title.match(/^(\d+)\s*[.)]\s*챕터/iu);
    if (!match) continue;
    const chapterIndex = Number(match[1]);
    const source = sourceChapters.find((item) => Number(item.index) === chapterIndex);
    if (source) selected.push(source);
  }

  if (!selected.length && parsed.length === sourceChapters.length) return sourceChapters;
  return selected;
}
