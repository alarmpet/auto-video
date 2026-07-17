import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { writeBinaryAtomic, writeCanonicalJson } from "../../pipeline/atomic-store.mjs";
import { registerArtifact } from "../../pipeline/artifact-store.mjs";
import { validateSchema } from "../../pipeline/schema-registry.mjs";
import { verifyLockedFile } from "./model-lock.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const nfc = value => value.normalize("NFC");

export function rectsOverlap(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function normalizedRectToPixels(rect, canvas) {
  if (!Array.isArray(rect) || rect.length !== 4) {
    throw Object.assign(new Error("normalized rectangle must contain four values"), { code: "thumbnail_rect_invalid" });
  }
  const [normalizedX, normalizedY, normalizedWidth, normalizedHeight] = rect;
  for (const [key, value] of [["x", normalizedX], ["y", normalizedY], ["width", normalizedWidth], ["height", normalizedHeight]]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw Object.assign(new Error(`invalid ${key}`), { code: "thumbnail_rect_invalid" });
    }
  }
  if (normalizedWidth <= 0 || normalizedHeight <= 0 || normalizedX + normalizedWidth > 1.0001 || normalizedY + normalizedHeight > 1.0001) {
    throw Object.assign(new Error("rectangle outside canvas"), { code: "thumbnail_rect_invalid" });
  }
  const x = Math.floor(normalizedX * canvas.width);
  const y = Math.floor(normalizedY * canvas.height);
  const right = Math.ceil(Number(((normalizedX + normalizedWidth) * canvas.width).toFixed(4)));
  const bottom = Math.ceil(Number(((normalizedY + normalizedHeight) * canvas.height).toFixed(4)));
  return { x, y, width: right - x, height: bottom - y };
}

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function validateCopy(option, selection) {
  const lines = option.lines.map(nfc);
  if (selection.copyId !== option.copyId || nfc(selection.exactText) !== nfc(option.exactText) || nfc(option.exactText) !== lines.join("\n")) {
    throw Object.assign(new Error("selected thumbnail copy changed"), { code: "thumbnail_copy_mismatch" });
  }
  if (lines.length < 1 || lines.length > option.geometry.maxLineCount) {
    throw Object.assign(new Error("thumbnail line count invalid"), { code: "thumbnail_line_count" });
  }
  return lines;
}

function effectInsets(outline, shadow) {
  const stroke = outline.width / 2;
  const blur = shadow.blur * 2;
  return {
    left: Math.ceil(stroke + blur + Math.max(0, -shadow.x)),
    right: Math.ceil(stroke + blur + Math.max(0, shadow.x)),
    top: Math.ceil(stroke + blur + Math.max(0, -shadow.y)),
    bottom: Math.ceil(stroke + blur + Math.max(0, shadow.y))
  };
}

export function buildTextSvg({ canvas, textRect, lines, fontBytes, fallbackBytes, fontSize, lineSpacing, alignment, fill, outline, shadow }) {
  const inset = effectInsets(outline, shadow);
  const inner = { x: textRect.x + inset.left, y: textRect.y + inset.top, width: textRect.width - inset.left - inset.right, height: textRect.height - inset.top - inset.bottom };
  if (inner.width <= 0 || inner.height <= 0) {
    throw Object.assign(new Error("thumbnail effects consume text rectangle"), { code: "thumbnail_text_overflow" });
  }
  const anchor = alignment === "right" ? "end" : alignment === "center" ? "middle" : "start";
  const x = alignment === "right" ? inner.x + inner.width : alignment === "center" ? inner.x + inner.width / 2 : inner.x;
  const lineHeight = fontSize * lineSpacing;
  const blockHeight = fontSize + lineHeight * (lines.length - 1);
  const startY = inner.y + (inner.height - blockHeight) / 2 + fontSize;
  const text = lines.map((line, index) => `<text x="${x}" y="${startY + index * lineHeight}" text-anchor="${anchor}" class="copy">${escapeXml(line)}</text>`).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}"><style>@font-face{font-family:YadamBold;src:url(data:font/ttf;base64,${fontBytes.toString("base64")})}@font-face{font-family:YadamFallback;src:url(data:font/ttf;base64,${fallbackBytes.toString("base64")})}.copy{font-family:YadamBold,YadamFallback;font-size:${fontSize}px;font-weight:700;fill:${fill};stroke:${outline.color};stroke-width:${outline.width}px;paint-order:stroke fill;filter:drop-shadow(${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.color})}</style>${text}</svg>`, "utf8");
}

export async function renderedAlphaBounds(svg) {
  const rendered = await sharp(svg, { failOn: "error", limitInputPixels: 2000000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = rendered.info;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (rendered.data[(y * width + x) * channels + channels - 1] === 0) continue;
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return right < left ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

const contains = (outer, inner) => inner && inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

async function largestFittingSize(input) {
  let low = input.minFontSize;
  let high = input.maxFontSize;
  let selected = null;
  while (low <= high) {
    const candidate = Math.floor((low + high) / 2);
    const svg = buildTextSvg({ ...input, fontSize: candidate });
    const bounds = await renderedAlphaBounds(svg);
    if (contains(input.textRect, bounds)) {
      selected = { fontSize: candidate, svg, bounds };
      low = candidate + 1;
    } else {
      high = candidate - 1;
    }
  }
  if (!selected) throw Object.assign(new Error("selected copy cannot fit"), { code: "thumbnail_text_overflow" });
  return selected;
}

export async function composeThumbnail({ jobDir, background, option, selection, fontLock, backgroundQa, stage }) {
  if (backgroundQa.status !== "pass") throw Object.assign(new Error("background QA not pass"), { code: "thumbnail_background_qa_failed" });
  const flags = backgroundQa.critic?.flags;
  if (!flags) throw Object.assign(new Error("background QA has no critic flags"), { code: "thumbnail_background_qa_failed" });
  if (flags.readableText !== false || flags.reservedTextRectClear !== true || flags.faceInTextRect !== false || flags.criticalObjectInTextRect !== false || flags.subjectPlacementMatch !== true) {
    throw Object.assign(new Error("background QA critic flags mismatch"), { code: "thumbnail_background_qa_failed" });
  }

  const lines = validateCopy(option, selection);
  await verifyLockedFile(fontLock.bold.path, fontLock.bold);
  await verifyLockedFile(fontLock.regular.path, fontLock.regular);

  const fontBytes = await readFile(fontLock.bold.path);
  const fallbackBytes = await readFile(fontLock.regular.path);

  const canvas = { width: 1280, height: 720 };
  const textRect = normalizedRectToPixels(option.geometry.textRect, canvas);

  const protectedRects = (option.geometry.protectedRects || []).map(r => {
    return {
      id: r.id,
      kind: r.kind,
      ...normalizedRectToPixels(r.rect, canvas)
    };
  });

  const minimumX = Math.ceil(1280 * 0.04);
  const minimumY = Math.ceil(720 * 0.04);
  const margins = {
    left: textRect.x,
    top: textRect.y,
    right: 1280 - (textRect.x + textRect.width),
    bottom: 720 - (textRect.y + textRect.height)
  };
  if (margins.left < minimumX || margins.right < minimumX || margins.top < minimumY || margins.bottom < minimumY) {
    throw Object.assign(new Error("thumbnail edge margin below four percent"), { code: "thumbnail_edge_margin" });
  }
  for (const protectedRect of protectedRects) {
    if (rectsOverlap(textRect, protectedRect)) {
      throw Object.assign(new Error(`text overlaps ${protectedRect.id}`), { code: "thumbnail_protected_overlap", protectedRectId: protectedRect.id });
    }
  }

  const fit = await largestFittingSize({
    canvas,
    textRect,
    lines,
    fontBytes,
    fallbackBytes,
    minFontSize: option.geometry.minFontSize,
    maxFontSize: option.geometry.maxFontSize,
    lineSpacing: option.geometry.lineSpacing,
    alignment: option.geometry.alignment,
    fill: option.geometry.fill,
    outline: option.geometry.outline,
    shadow: option.geometry.shadow
  });

  // verify background bytes match background.sha256
  const bgBytes = background.bytes;
  if (sha256(bgBytes) !== background.sha256) {
    throw Object.assign(new Error("background bytes hash mismatch"), { code: "background_hash_mismatch" });
  }

  // write background.png
  await writeBinaryAtomic(join(jobDir, "thumbnail/background.png"), bgBytes);

  // composite final
  const finalBytes = await sharp(bgBytes)
    .composite([{ input: fit.svg }])
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();

  const finalOutput = await writeBinaryAtomic(join(jobDir, "thumbnail/final.png"), finalBytes);

  // composite guide overlay
  // Draw translucent text rect and protected rects on top of background
  const guideSvg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
      <rect x="${textRect.x}" y="${textRect.y}" width="${textRect.width}" height="${textRect.height}" fill="none" stroke="blue" stroke-width="4" stroke-dasharray="5,5" />
      ${protectedRects.map(r => `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="rgba(255, 0, 0, 0.3)" stroke="red" stroke-width="2" />`).join("")}
    </svg>
  `, "utf8");

  const guideBytes = await sharp(bgBytes)
    .composite([{ input: guideSvg }])
    .png()
    .toBuffer();

  const guideOutput = await writeBinaryAtomic(join(jobDir, "previews/thumbnail-reserved-guide.png"), guideBytes);

  const compositorVersionHash = sha256(Buffer.from("yadam-thumbnail-compositor-v1", "utf8"));
  const geometryHash = hashCanonical(option.geometry);

  const lineHashes = lines.map(l => sha256(Buffer.from(l, "utf8")));

  const qaVal = {
    schemaVersion: "1.0.0",
    status: "pass",
    copyId: option.copyId,
    exactText: selection.exactText,
    lines,
    lineHashes,
    lineCount: lines.length,
    layout: option.layout,
    canvas,
    normalizedTextRect: option.geometry.textRect,
    pixelTextRect: textRect,
    protectedPixelRects: protectedRects,
    edgeMargins: { ...margins, minimumRatio: 0.04 },
    typography: {
      fontPath: fontLock.bold.path,
      fontSha256: fontLock.bold.sha256,
      fallbackPath: fontLock.regular.path,
      fallbackSha256: fontLock.regular.sha256,
      fontSize: fit.fontSize,
      minFontSize: option.geometry.minFontSize,
      maxFontSize: option.geometry.maxFontSize,
      lineSpacing: option.geometry.lineSpacing,
      alignment: option.geometry.alignment,
      fill: option.geometry.fill,
      outline: option.geometry.outline,
      shadow: option.geometry.shadow
    },
    background: {
      path: "thumbnail/background.png",
      sha256: background.sha256,
      qaPath: rel(jobDir, join(jobDir, "assets/images/qa/thumbnail-background.json")),
      qaSha256: backgroundQa.sha256 || hashCanonical(backgroundQa)
    },
    textLayerSha256: sha256(fit.svg),
    finalPath: "thumbnail/final.png",
    finalSha256: finalOutput.sha256
  };

  const schemaPath = join(process.cwd(), "schemas/yadam/thumbnail-qa.schema.json");
  await validateSchema(schemaPath, qaVal);

  const qaOutput = await writeCanonicalJson(join(jobDir, "thumbnail/qa.json"), qaVal);

  // Register artifacts
  await registerArtifact(jobDir, {
    artifactId: "thumbnail-background",
    logicalRole: "yadam.thumbnail.background",
    path: "thumbnail/background.png",
    sha256: background.sha256,
    schemaVersion: "1.0.0",
    producerStage: stage,
    gateStatus: "pass",
    dependencyHashes: {
      rawBackground: background.sha256
    }
  });

  await registerArtifact(jobDir, {
    artifactId: "thumbnail-final",
    logicalRole: "yadam.thumbnail.final",
    path: "thumbnail/final.png",
    sha256: finalOutput.sha256,
    schemaVersion: "1.0.0",
    producerStage: stage,
    gateStatus: "pass",
    dependencyHashes: {
      background: background.sha256,
      selection: selection.sha256,
      font: fontLock.bold.sha256,
      compositor: compositorVersionHash
    }
  });

  await registerArtifact(jobDir, {
    artifactId: "thumbnail-qa",
    logicalRole: "yadam.thumbnail.qa",
    path: "thumbnail/qa.json",
    sha256: qaOutput.sha256,
    schemaVersion: "1.0.0",
    producerStage: stage,
    gateStatus: "pass",
    dependencyHashes: {
      thumbnail: finalOutput.sha256,
      backgroundQa: backgroundQa.sha256 || hashCanonical(backgroundQa)
    }
  });

  const guideDependencyHash = hashCanonical({
    backgroundHash: background.sha256,
    thumbnailSelectionHash: selection.sha256,
    geometryHash,
    compositorVersionHash
  });

  await registerArtifact(jobDir, {
    artifactId: "thumbnail-reserved-guide",
    logicalRole: "yadam.thumbnail.guide",
    path: "previews/thumbnail-reserved-guide.png",
    sha256: guideOutput.sha256,
    schemaVersion: "1.0.0",
    producerStage: stage,
    gateStatus: "pass",
    dependencyHashes: {
      background: background.sha256,
      selection: selection.sha256,
      geometry: geometryHash,
      compositor: compositorVersionHash
    }
  });

  return {
    qaPath: "thumbnail/qa.json",
    qaHash: qaOutput.sha256,
    finalPath: "thumbnail/final.png",
    finalSha256: finalOutput.sha256,
    guideHash: guideOutput.sha256,
    guideDependencyHash
  };
}
