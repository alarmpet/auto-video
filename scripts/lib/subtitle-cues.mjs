import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function findExistingSrt(jobDir) {
  for (const relativePath of ["0_tts.srt", "subs.srt", "subtitles.srt"]) {
    const candidate = join(jobDir, relativePath);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function parseSrt(content) {
  return String(content || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .split(/\n\s*\n/g)
    .map((block) => block.split("\n").map((line) => line.trim()).filter(Boolean))
    .map((lines) => {
      const timeIndex = lines.findIndex((line) => line.includes("-->"));
      if (timeIndex < 0) return null;
      const [startRaw, endRaw] = lines[timeIndex]
        .split("-->")
        .map((value) => value.trim().split(/\s+/)[0]);
      const text = lines.slice(timeIndex + 1).join(" ").trim();
      if (!text) return null;
      return {
        start: srtTimeToSeconds(startRaw),
        end: srtTimeToSeconds(endRaw),
        text,
      };
    })
    .filter(Boolean);
}

export function loadSourceSrtEvents(jobDir) {
  const srtPath = findExistingSrt(jobDir);
  if (!srtPath) return null;
  return { srtPath, events: parseSrt(readFileSync(srtPath, "utf8")) };
}

export function splitSubtitleTextSmart(text, maxChars = 34) {
  const clauses = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[,.;:?!。！？])\s+|(?<=[.?!。！？])/)
    .map((value) => value.trim())
    .filter(Boolean);
  const cues = [];
  for (const clause of clauses) {
    if (clause.length <= maxChars) {
      cues.push(clause);
      continue;
    }
    const words = clause.split(/\s+/);
    let line = "";
    for (const word of words) {
      if (word.length > maxChars) {
        if (line) {
          cues.push(line);
          line = "";
        }
        cues.push(...splitLongToken(word, maxChars));
        continue;
      }
      const next = line ? `${line} ${word}` : word;
      if (next.length > maxChars && line) {
        cues.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) cues.push(line);
  }
  return cues.length ? cues : [String(text || "").trim()].filter(Boolean);
}

export function normalizeSubtitleEvents(events, options = {}) {
  const maxCueSeconds = options.maxCueSeconds ?? 8;
  const minCueSeconds = options.minCueSeconds ?? 1.2;
  const normalized = [];
  for (const event of events) {
    const start = Number(event.start);
    const end = Number(event.end);
    const duration = Math.max(0, end - start);
    if (duration <= maxCueSeconds) {
      normalized.push({ start, end, text: event.text });
      continue;
    }
    const chunks = splitSubtitleTextSmart(event.text, options.maxChars ?? 34);
    normalized.push(...allocateWeightedCues(chunks, start, end, minCueSeconds));
  }
  // Merge degenerate (near-zero) cues into their neighbor instead of emitting
  // flash cues that some renderers draw on top of the adjacent cue.
  const merged = [];
  for (const cue of normalized) {
    const previous = merged.at(-1);
    if (previous && cue.end - cue.start < 0.2) {
      previous.text = `${previous.text} ${cue.text}`.trim();
      previous.end = Math.max(previous.end, cue.end);
      continue;
    }
    merged.push({ ...cue });
  }
  return merged;
}

export function subtitleCuesForRow(row, options = {}) {
  const chunks = splitSubtitleTextSmart(row.scene.narration, options.maxChars ?? 34);
  return allocateWeightedCues(chunks, row.start, row.end, options.minCueSeconds ?? 1.2);
}

export function wrapKorean(text, max = 24, maxLines = 2) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (compact.length <= max) return compact;

  const words = compact.split(" ").filter(Boolean);

  // Never drop text: if it cannot fit maxLines at `max` chars, widen the limit.
  const totalLen = compact.length;
  const effectiveMax = Math.max(max, Math.ceil(totalLen / maxLines) + 2);

  // Balanced greedy wrap: aim each line near totalLen / lineCount instead of
  // filling the first line to the brim (avoids orphan words like "됩니다.").
  const lineCount = Math.min(maxLines, Math.max(2, Math.ceil(totalLen / effectiveMax)));
  const target = Math.ceil(totalLen / lineCount);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (word.length > effectiveMax) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(...splitLongToken(word, effectiveMax));
      continue;
    }
    const next = line ? `${line} ${word}` : word;
    const isLastLine = lines.length >= lineCount - 1;
    const limit = isLastLine ? effectiveMax : Math.min(effectiveMax, target);
    if (next.length > limit && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);

  // If we still produced more lines than allowed, merge overflow into the last
  // permitted line rather than discarding it.
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines - 1);
    kept.push(lines.slice(maxLines - 1).join(" "));
    return kept.join("\n");
  }
  return lines.join("\n");
}

function splitLongToken(token, maxChars) {
  const chunks = [];
  for (let i = 0; i < token.length; i += maxChars) {
    const chunk = token.slice(i, i + maxChars).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

const CUE_GAP_SECONDS = 0.04; // ~1 frame at 25fps; prevents same-frame double render
const MIN_CUE_DISPLAY_SECONDS = 0.8;

function allocateWeightedCues(chunks, start, end, minCueSeconds) {
  let safeChunks = chunks.map((chunk) => String(chunk || "").trim()).filter(Boolean);
  if (!safeChunks.length) return [];
  const duration = Math.max(0.001, Number(end) - Number(start));
  const minDisplay = Math.min(minCueSeconds, MIN_CUE_DISPLAY_SECONDS);

  // If the window cannot give every chunk a readable duration, merge the
  // shortest adjacent chunks until it can (never emit zero/near-zero cues).
  while (safeChunks.length > 1 && duration / safeChunks.length < minDisplay) {
    let bestIndex = 0;
    let bestLen = Infinity;
    for (let i = 0; i < safeChunks.length - 1; i += 1) {
      const mergedLen = safeChunks[i].length + safeChunks[i + 1].length;
      if (mergedLen < bestLen) {
        bestLen = mergedLen;
        bestIndex = i;
      }
    }
    safeChunks.splice(bestIndex, 2, `${safeChunks[bestIndex]} ${safeChunks[bestIndex + 1]}`);
  }

  const totalWeight = safeChunks.reduce((sum, chunk) => sum + Math.max(1, chunk.length), 0) || 1;
  const minTotal = minCueSeconds * safeChunks.length;
  let cursor = Number(start);
  const cues = safeChunks.map((text, index) => {
    const cueStart = cursor;
    const isLast = index === safeChunks.length - 1;
    let cueDuration = duration * (Math.max(1, text.length) / totalWeight);
    if (duration >= minTotal) cueDuration = Math.max(minCueSeconds, cueDuration);
    cueDuration = Math.max(cueDuration, minDisplay);
    let cueEnd = isLast ? Number(end) : Math.min(Number(end), cueStart + cueDuration);
    if (!isLast && cueEnd <= cueStart) cueEnd = Math.min(Number(end), cueStart + minDisplay);
    cursor = cueEnd;
    return { start: cueStart, end: cueEnd, text };
  });

  // Insert a one-frame gap between consecutive cues so renderers never draw
  // two cues on the same frame (end == next start caused stacked subtitles).
  for (let i = 0; i < cues.length - 1; i += 1) {
    const gapEnd = cues[i + 1].start - CUE_GAP_SECONDS;
    if (gapEnd > cues[i].start + 0.2) cues[i].end = Math.min(cues[i].end, gapEnd);
  }
  return cues.filter((cue) => cue.end - cue.start > 0.01);
}


function srtTimeToSeconds(value) {
  const [hours, minutes, seconds] = value.replace(",", ".").split(":");
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}
