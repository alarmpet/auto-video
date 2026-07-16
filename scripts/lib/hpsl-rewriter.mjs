import { analyzeChapterHpsl, analyzeScriptHpsl } from "./hpsl-structure-analysis.mjs";
import { splitParagraphs } from "./script-structure-analysis.mjs";

const POINT_PASSAGES = [
  "이 질문은 사랑받고 싶은 마음이 어떻게 불안으로 바뀌는지를 보여 줍니다.",
  "이 질문은 비교가 어떻게 마음의 방향을 흔드는지를 보여 줍니다.",
  "이 질문은 인정 욕구가 왜 우리를 더 조급하게 만드는지를 보여 줍니다.",
];

const LESSON_PASSAGES = [
  "오늘 밤 당신도 마음이 흔들린다면 괜찮습니다. 잠시 숨을 고르고 조용히 바라봅니다.",
  "혹시 당신도 오래 비교하고 있었다면 괜찮습니다. 지금은 마음을 쉬게 해도 됩니다.",
  "여러분의 마음이 지쳐 있었다면 괜찮습니다. 오늘 밤은 증명보다 쉼을 먼저 놓아 봅니다.",
];

export function reinforceHpslStructure(text, options = {}) {
  const minChapters = Math.max(1, Number(options.minChapters ?? 2));
  const minChapterPassRate = Number(options.minChapterPassRate ?? 0.8);
  const before = analyzeScriptHpsl(text, { minChapters, minChapterPassRate, inferChapters: true });
  if (before.ok) {
    return { text: String(text || "").trim(), insertedParagraphs: [], before, after: before };
  }

  let currentText = String(text || "").trim();
  const insertedParagraphs = [];

  for (let pass = 0; pass < 3; pass += 1) {
    const report = analyzeScriptHpsl(currentText, { minChapters, minChapterPassRate, inferChapters: true });
    if (report.ok) break;
    const result = reinforceOnce(currentText, minChapters, insertedParagraphs);
    if (!result.changed) break;
    currentText = result.text;
  }

  const rewritten = currentText.trim();
  const after = analyzeScriptHpsl(rewritten, { minChapters, minChapterPassRate, inferChapters: true });
  return {
    text: rewritten,
    insertedParagraphs,
    before,
    after,
  };
}

function reinforceOnce(text, minChapters, insertedParagraphs) {
  const paragraphs = splitParagraphs(text);
  const chapterCount = Math.min(minChapters, Math.max(1, Math.floor(paragraphs.length / 4)));
  const rebuilt = [];
  let changed = false;

  for (let chapterIndex = 0; chapterIndex < chapterCount; chapterIndex += 1) {
    const start = Math.floor((chapterIndex * paragraphs.length) / chapterCount);
    const end = Math.floor(((chapterIndex + 1) * paragraphs.length) / chapterCount);
    const chapterParagraphs = paragraphs.slice(start, Math.max(start + 1, end));
    const report = analyzeChapterHpsl(chapterParagraphs.join("\n\n"));

    if (!report.point) {
      const passage = POINT_PASSAGES[chapterIndex % POINT_PASSAGES.length];
      rebuilt.push(passage);
      insertedParagraphs.push({ chapterIndex: chapterIndex + 1, kind: "point", text: passage });
      changed = true;
    }
    rebuilt.push(...chapterParagraphs);
    if (!report.lesson) {
      const passage = LESSON_PASSAGES[chapterIndex % LESSON_PASSAGES.length];
      rebuilt.push(passage);
      insertedParagraphs.push({ chapterIndex: chapterIndex + 1, kind: "lesson", text: passage });
      changed = true;
    }
  }

  return { text: rebuilt.join("\n\n").trim(), changed };
}
