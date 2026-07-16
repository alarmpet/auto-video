export const KENBURNS_MOVES = [
  "zoomin",
  "zoomout",
  "panL",
  "panR",
  "panU",
  "panD",
  "diagUL",
  "diagUR",
  "diagDL",
  "diagDR",
];

const CENTER_X = "iw/2-(iw/zoom/2)";
const CENTER_Y = "ih/2-(ih/zoom/2)";

export function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function zoomAmountForDuration(durationSeconds) {
  const duration = Number(durationSeconds) || 0;
  if (duration <= 6.5) return 0.035;
  if (duration <= 12) return 0.045;
  return 0.07;
}

export function createMotionPlan({ groups = [], seed = "", minUnique = 5 } = {}) {
  const targetUnique = Math.min(Number(minUnique) || 1, groups.length, KENBURNS_MOVES.length);
  const plan = [];
  const used = new Set();
  let previous = null;

  for (let index = 0; index < groups.length; index += 1) {
    const remainingSlots = groups.length - index;
    const missing = KENBURNS_MOVES.filter((move) => !used.has(move));
    let candidates = KENBURNS_MOVES.filter((move) => move !== previous);

    if (used.size < targetUnique && missing.length >= remainingSlots) {
      candidates = missing.filter((move) => move !== previous);
    } else if (used.size < targetUnique) {
      const unseen = missing.filter((move) => move !== previous);
      if (unseen.length) candidates = unseen;
    }

    const base = hashString(`${seed}:${index}`);
    const motion = candidates[base % candidates.length] || KENBURNS_MOVES[index % KENBURNS_MOVES.length];
    used.add(motion);
    previous = motion;
    plan.push({ index, motion });
  }

  return plan;
}

export function motionExpressions({ move, zoomAmount, frames }) {
  const safeFrames = Math.max(1, Math.round(Number(frames) || 1));
  const progress = `on/${safeFrames}`;
  const effectiveZoom = Number(zoomAmount);
  const zEnd = (1 + effectiveZoom).toFixed(5);
  const travelZoom = zEnd;

  switch (move) {
    case "zoomin":
      return {
        z: `min(1.0+${effectiveZoom.toFixed(5)}*${progress},${zEnd})`,
        x: CENTER_X,
        y: CENTER_Y,
        effectiveZoom,
        travelZoom: null,
      };
    case "zoomout":
      return {
        z: `max(${zEnd}-${effectiveZoom.toFixed(5)}*${progress},1.0)`,
        x: CENTER_X,
        y: CENTER_Y,
        effectiveZoom,
        travelZoom: null,
      };
    case "panL":
      return { z: travelZoom, x: `(iw-iw/zoom)*(1-${progress})`, y: CENTER_Y, effectiveZoom, travelZoom: effectiveZoom };
    case "panR":
      return { z: travelZoom, x: `(iw-iw/zoom)*${progress}`, y: CENTER_Y, effectiveZoom, travelZoom: effectiveZoom };
    case "panU":
      return { z: travelZoom, x: CENTER_X, y: `(ih-ih/zoom)*(1-${progress})`, effectiveZoom, travelZoom: effectiveZoom };
    case "panD":
      return { z: travelZoom, x: CENTER_X, y: `(ih-ih/zoom)*${progress}`, effectiveZoom, travelZoom: effectiveZoom };
    case "diagUL":
      return { z: travelZoom, x: `(iw-iw/zoom)*(1-${progress})`, y: `(ih-ih/zoom)*(1-${progress})`, effectiveZoom, travelZoom: effectiveZoom };
    case "diagUR":
      return { z: travelZoom, x: `(iw-iw/zoom)*${progress}`, y: `(ih-ih/zoom)*(1-${progress})`, effectiveZoom, travelZoom: effectiveZoom };
    case "diagDL":
      return { z: travelZoom, x: `(iw-iw/zoom)*(1-${progress})`, y: `(ih-ih/zoom)*${progress}`, effectiveZoom, travelZoom: effectiveZoom };
    case "diagDR":
      return { z: travelZoom, x: `(iw-iw/zoom)*${progress}`, y: `(ih-ih/zoom)*${progress}`, effectiveZoom, travelZoom: effectiveZoom };
    default:
      return {
        z: `min(1.0+${effectiveZoom.toFixed(5)}*${progress},${zEnd})`,
        x: CENTER_X,
        y: CENTER_Y,
        effectiveZoom,
        travelZoom: null,
      };
  }
}

export function buildKenBurnsFilter({
  width = 1920,
  height = 1080,
  fps = 24,
  durationSeconds = 8,
  move = "zoomin",
  zoomAmount = zoomAmountForDuration(durationSeconds),
  forceMonochrome = true,
  upscale = 2,
} = {}) {
  const safeFps = Math.max(1, Math.round(Number(fps) || 24));
  const safeDuration = Math.max(0.1, Number(durationSeconds) || 8);
  const safeUpscale = Math.max(1, Math.round(Number(upscale) || 2));
  const frames = Math.max(1, Math.round(safeDuration * safeFps));
  const expr = motionExpressions({ move, zoomAmount, frames });
  const parts = [
    `scale=${width * safeUpscale}:${height * safeUpscale}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${width * safeUpscale}:${height * safeUpscale}`,
    `zoompan=z='${expr.z}':x='${expr.x}':y='${expr.y}':d=1:s=${width}x${height}:fps=${safeFps}`,
  ];
  if (forceMonochrome) parts.push("hue=s=0");
  parts.push("format=yuv420p");
  return {
    filter: parts.join(","),
    frames,
    move,
    zoomAmount,
    effectiveZoom: expr.effectiveZoom,
    travelZoom: expr.travelZoom,
    fps: safeFps,
    upscale: safeUpscale,
  };
}
