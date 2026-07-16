import { analyzePhase3ScriptQuality } from "./phase3-script-quality.mjs";

const EMPATHY_PASSAGES = [
  "오늘 밤 당신도 사랑받고 있는데도 마음 한쪽이 불안했다면, 그 마음을 너무 빨리 밀어내지 않아도 괜찮습니다.",
  "혹시 당신도 누군가의 시선 하나에 오래 흔들렸다면, 그 흔들림은 약함이 아니라 오래 애쓴 마음의 신호일 수 있습니다.",
  "여러분의 마음이 인정받고 싶은 마음 때문에 지쳐 있었다면, 지금은 증명보다 숨을 고르는 시간이 먼저여도 괜찮습니다.",
  "오늘 밤 당신의 마음 안에 비교와 두려움이 함께 있었다면, 그 마음을 조용히 바라보는 것만으로도 충분히 시작입니다.",
  "혹시 당신도 사랑을 잃을까 봐 먼저 붙잡고 먼저 계산했던 밤이 있었다면, 그 마음을 혼자 부끄러워하지 않아도 됩니다.",
];

export function reinforcePhase3Empathy(text, options = {}) {
  const minSecondPersonTouchpoints = Number(options.minSecondPersonTouchpoints ?? 3);
  const maxInsertedParagraphs = Number(options.maxInsertedParagraphs ?? 3);
  const baseOptions = {
    minConcreteRatio: options.minConcreteRatio,
    minConcreteHits: options.minConcreteHits,
    maxRepeatedPointRatio: options.maxRepeatedPointRatio,
    minTensionStages: options.minTensionStages,
    minSecondPersonTouchpoints,
  };
  let output = String(text || "").trim();
  const insertedParagraphs = [];

  for (let index = 0; index < maxInsertedParagraphs; index += 1) {
    const report = analyzePhase3ScriptQuality(output, baseOptions);
    if (report.secondPersonEmpathy.ok) break;
    const passage = EMPATHY_PASSAGES[index % EMPATHY_PASSAGES.length];
    output = insertParagraphNearEmotionalTurn(output, passage, index);
    insertedParagraphs.push(passage);
  }

  return {
    text: output.trim(),
    insertedParagraphs,
    before: analyzePhase3ScriptQuality(text, baseOptions),
    after: analyzePhase3ScriptQuality(output, baseOptions),
  };
}

function insertParagraphNearEmotionalTurn(text, passage, insertIndex) {
  const paragraphs = String(text || "")
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (!paragraphs.length) return passage;

  const preferredIndex = paragraphs.findIndex((paragraph) => (
    /불안|비교|인정|사랑|두려움|상처|축복/.test(paragraph)
  ));
  const baseIndex = preferredIndex >= 0 ? preferredIndex : Math.floor(paragraphs.length / 2);
  const targetIndex = Math.min(paragraphs.length, baseIndex + 1 + insertIndex);
  paragraphs.splice(targetIndex, 0, passage);
  return paragraphs.join("\n\n");
}
