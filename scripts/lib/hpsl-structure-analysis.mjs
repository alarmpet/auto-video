import { splitChapters, splitKoreanSentences } from "./script-structure-analysis.mjs";

const HOOK_PATTERNS = [
  /[?？]\s*$/u,
  /까[요.]?\s*$/u,
  /습니다[.]?\s*$/u,
  /입니다[.]?\s*$/u,
];

const POINT_MARKERS = [
  "그러나",
  "하지만",
  "그래서",
  "필요한 것은",
  "문제는",
  "차이는",
  "이유는",
  "핵심은",
  "약한 마음이",
  "둔감해지라는",
  "거짓이 되는 것은",
  "길일 수 있습니다",
  "吏덈Ц",
  "蹂댁뿬",
  "?대뼸寃",
];

const STORY_ACTION_HINTS = [
  "한나",
  "브닌나",
  "엘리",
  "성전",
  "하나님",
  "기도",
  "성경",
  "통곡",
  "사무엘상",
  "올라가",
  "쏟아냈",
  "오해",
  "비교",
  "식탁",
  "말했습니다",
  "말합니다",
  "愿묒빞",
  "嫄몄뿀",
  "諛붾씪",
  "遺숈옟",
];

const LESSON_MARKERS = [
  "오늘",
  "오늘 밤",
  "좋습니다",
  "괜찮습니다",
  "않아도 됩니다",
  "필요합니다",
  "말해도 좋습니다",
  "물어봐도 좋습니다",
  "포기하지 않아도 됩니다",
  "숨을 쉬어",
  "쉬어도 됩니다",
  "수 있습니다",
  "못합니다",
  "되어 줍니다",
  "허락일 수 있습니다",
  "愿쒖갖",
  "諛붾씪",
  "怨좊Ⅴ",
];

function firstSentence(sentences) {
  return sentences[0] || "";
}

function lastSentences(sentences, count = 2) {
  return sentences.slice(-count);
}

function containsAny(text, markers) {
  return markers.some((marker) => text.includes(marker));
}

function hasHook(sentences) {
  const first = firstSentence(sentences);
  if (!first) return false;
  return HOOK_PATTERNS.some((pattern) => pattern.test(first)) || first.length <= 60;
}

function hasPoint(sentences) {
  const window = sentences.slice(0, 4).join(" ");
  return containsAny(window, POINT_MARKERS) || (sentences.length >= 8 && window.length >= 80);
}

function hasStoryBeat(sentences) {
  const body = sentences.slice(1, -2).join(" ");
  const hintCount = STORY_ACTION_HINTS.filter((hint) => body.includes(hint)).length;
  return hintCount >= 2 || (sentences.length >= 8 && body.length >= 120);
}

function hasLesson(sentences) {
  const window = lastSentences(sentences, 3).join(" ");
  return containsAny(window, LESSON_MARKERS);
}

export function analyzeChapterHpsl(chapterText) {
  const sentences = splitKoreanSentences(chapterText);
  const hook = hasHook(sentences);
  const point = hasPoint(sentences);
  const story = hasStoryBeat(sentences);
  const lesson = hasLesson(sentences);
  const missing = [];
  if (!hook) missing.push("hook");
  if (!point) missing.push("point");
  if (!story) missing.push("story");
  if (!lesson) missing.push("lesson");
  return {
    ok: missing.length === 0,
    missing,
    sentenceCount: sentences.length,
    hook,
    point,
    story,
    lesson,
  };
}

export function analyzeScriptHpsl(text, options = {}) {
  const minChapterPassRate = options.minChapterPassRate ?? 0.8;
  const chapters = splitChapters(text, {
    inferChapters: options.inferChapters,
    minChapters: options.minChapters,
  });
  const chapterReports = chapters.map((chapter, index) => {
    const body = chapter.paragraphs.join("\n\n");
    const hpsl = analyzeChapterHpsl(body);
    return { index: index + 1, title: chapter.title, inferred: Boolean(chapter.inferred), ...hpsl };
  });
  const passCount = chapterReports.filter((chapter) => chapter.ok).length;
  const passRate = chapterReports.length ? passCount / chapterReports.length : 0;
  const failures = [];
  if (!chapterReports.length) failures.push("no_chapters_found");
  if (chapterReports.length && passRate < minChapterPassRate) {
    failures.push(`hpsl_pass_rate_too_low:${passRate.toFixed(2)}<${minChapterPassRate}`);
  }
  const weakestChapters = chapterReports
    .filter((chapter) => !chapter.ok)
    .slice(0, 10);
  return {
    ok: failures.length === 0,
    failures,
    chapterCount: chapterReports.length,
    passRate: Number(passRate.toFixed(3)),
    weakestChapters,
    chapters: chapterReports,
  };
}
