const DEFAULT_STOPWORDS = new Set([
  "그리고", "그러나", "하지만", "오늘", "우리", "당신", "마음", "사람", "이야기",
  "것입니다", "있습니다", "합니다", "됩니다", "입니다", "질문입니다", "때문입니다",
]);

export function splitKoreanSentences(text) {
  const compact = String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (!compact) return [];
  return compact
    .split(/(?<=[.!?。！？])\s+/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function estimateNarrationSeconds(text, charsPerSecond = 5.2) {
  const chars = String(text || "").replace(/\s/g, "").length;
  return Math.max(0.5, chars / Math.max(1, Number(charsPerSecond) || 5.2));
}

export function extractChunkKeywords(text, limit = 8) {
  const words = String(text || "")
    .replace(/[^\p{Script=Hangul}A-Za-z0-9\s]/gu, " ")
    .split(/\s+/)
    .map((word) => stripKoreanParticle(word.trim()))
    .filter((word) => word.length >= 2)
    .filter((word) => !DEFAULT_STOPWORDS.has(word));
  const scored = new Map();
  for (const word of words) scored.set(word, (scored.get(word) || 0) + 1);
  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit)
    .map(([word]) => word);
}

function stripKoreanParticle(word) {
  return String(word || "").replace(/(에게서|에게|으로|로는|로서|라는|이라도|이라|이며|부터|까지|처럼|보다|만큼|밖에|마저|조차|은|는|이|가|을|를|에|도|만)$/u, "");
}

export function buildSentenceGroundedVisualTimeline({
  script,
  targetSeconds,
  globalStartSeconds = 0,
  openingSeconds = 60,
  openingSceneSeconds = 6,
  bodyMinSeconds = 20,
  bodyTargetSeconds = 30,
  bodyMaxSeconds = 40,
  charsPerSecond = 5.2,
} = {}) {
  const sentences = splitKoreanSentences(script);
  if (!sentences.length) return [];
  const total = Math.max(1, Number(targetSeconds) || 1);
  const weighted = sentences.map((sentence) => ({
    text: sentence,
    estimatedSeconds: estimateNarrationSeconds(sentence, charsPerSecond),
  }));
  const estimatedTotal = weighted.reduce((sum, item) => sum + item.estimatedSeconds, 0) || 1;
  const scale = total / estimatedTotal;
  const scenes = [];
  let sentenceIndex = 0;
  let localCursor = 0;

  while (localCursor < total - 0.001 && sentenceIndex < weighted.length) {
    const globalCursor = globalStartSeconds + localCursor;
    const inOpening = globalCursor < openingSeconds - 0.001;
    const limit = inOpening
      ? Math.min(openingSceneSeconds, openingSeconds - globalCursor, total - localCursor)
      : Math.min(bodyTargetSeconds, total - localCursor);
    const minLimit = inOpening ? 0.5 : Math.min(bodyMinSeconds, limit);
    const maxLimit = inOpening ? Math.max(0.5, limit) : Math.min(bodyMaxSeconds, total - localCursor);
    const chunk = [];
    let estimated = 0;

    while (sentenceIndex < weighted.length) {
      const next = weighted[sentenceIndex];
      const nextSeconds = next.estimatedSeconds * scale;
      const wouldExceed = chunk.length > 0 && estimated + nextSeconds > maxLimit;
      const hasEnough = estimated >= minLimit;
      if (wouldExceed && hasEnough) break;
      chunk.push(next.text);
      estimated += nextSeconds;
      sentenceIndex += 1;
      if (inOpening && estimated >= limit * 0.75) break;
      if (!inOpening && estimated >= bodyTargetSeconds && chunk.length > 0) break;
    }

    const remaining = total - localCursor;
    const duration = Number(Math.min(
      remaining,
      inOpening ? limit : Math.max(minLimit, Math.min(maxLimit, estimated)),
    ).toFixed(3));
    const narration = chunk.join(" ").trim();
    scenes.push({
      order: scenes.length + 1,
      startSeconds: Number(localCursor.toFixed(3)),
      endSeconds: Number((localCursor + duration).toFixed(3)),
      globalStartSeconds: Number(globalCursor.toFixed(3)),
      globalEndSeconds: Number((globalCursor + duration).toFixed(3)),
      durationSeconds: duration,
      narration,
      keywords: extractChunkKeywords(narration),
      timingBand: inOpening ? "opening" : "body",
    });
    localCursor += duration;
  }

  if (scenes.length && scenes.at(-1).endSeconds < total) {
    const last = scenes.at(-1);
    const desiredDuration = Number((total - last.startSeconds).toFixed(3));
    const maxTailDuration = last.timingBand === "opening" ? openingSceneSeconds : bodyMaxSeconds;
    if (desiredDuration > maxTailDuration && last.timingBand === "body") {
      const originalNarration = last.narration;
      const parts = splitNarrationForTail(originalNarration);
      const firstDuration = Number((desiredDuration / 2).toFixed(3));
      const secondDuration = Number((desiredDuration - firstDuration).toFixed(3));
      last.durationSeconds = firstDuration;
      last.endSeconds = Number((last.startSeconds + firstDuration).toFixed(3));
      last.globalEndSeconds = Number((globalStartSeconds + last.endSeconds).toFixed(3));
      last.narration = parts[0];
      last.keywords = extractChunkKeywords(last.narration);
      scenes.push({
        order: scenes.length + 1,
        startSeconds: last.endSeconds,
        endSeconds: Number(total.toFixed(3)),
        globalStartSeconds: last.globalEndSeconds,
        globalEndSeconds: Number((globalStartSeconds + total).toFixed(3)),
        durationSeconds: secondDuration,
        narration: parts[1],
        keywords: extractChunkKeywords(parts[1]),
        timingBand: "body",
      });
    } else {
      last.endSeconds = Number(total.toFixed(3));
      last.globalEndSeconds = Number((globalStartSeconds + total).toFixed(3));
      last.durationSeconds = Number((last.endSeconds - last.startSeconds).toFixed(3));
    }
  }
  if (scenes.length && sentenceIndex < weighted.length) {
    const last = scenes.at(-1);
    const remainder = weighted.slice(sentenceIndex).map((item) => item.text).join(" ").trim();
    if (remainder) {
      last.narration = `${last.narration} ${remainder}`.trim();
      last.keywords = extractChunkKeywords(last.narration);
    }
  }
  return scenes;
}

function splitNarrationForTail(narration) {
  const sentences = splitKoreanSentences(narration);
  if (sentences.length >= 2) {
    const mid = Math.ceil(sentences.length / 2);
    return [
      sentences.slice(0, mid).join(" ").trim(),
      sentences.slice(mid).join(" ").trim(),
    ];
  }
  const words = String(narration || "").split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const mid = Math.ceil(words.length / 2);
    return [
      words.slice(0, mid).join(" "),
      words.slice(mid).join(" "),
    ];
  }
  return [String(narration || "").trim(), String(narration || "").trim()];
}
