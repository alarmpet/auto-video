import { createHash } from "node:crypto";
import sharp from "sharp";

const round6 = value => Number(value.toFixed(6));

export async function inspectPng({ assetId, bytes, expectedWidth, expectedHeight, colorPixelRatioMin, duplicateOwners }) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const failures = [];
  if (bytes.length < 1024) failures.push("insufficient_bytes");
  let decoded;
  try {
    decoded = await sharp(bytes, { failOn: "error", limitInputPixels: 2000000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch (cause) {
    return { status: "fail", format: "unknown", sizeBytes: bytes.length, sha256, width: 0, height: 0, meanLuminance: 0, luminanceStdDev: 0, visiblePixelRatio: 0, colorPixelRatio: 0, failures: ["png_decode_failed"], causeCode: cause.code ?? "sharp_error" };
  }
  const metadata = await sharp(bytes).metadata();
  if (metadata.format !== "png") failures.push("format_not_png");
  if (decoded.info.width !== expectedWidth || decoded.info.height !== expectedHeight) failures.push("dimension_mismatch");
  let visible = 0;
  let colored = 0;
  let sum = 0;
  let sumSquares = 0;
  for (let index = 0; index < decoded.data.length; index += 4) {
    const red = decoded.data[index];
    const green = decoded.data[index + 1];
    const blue = decoded.data[index + 2];
    const alpha = decoded.data[index + 3];
    if (alpha >= 250) {
      visible += 1;
      if (Math.max(red, green, blue) - Math.min(red, green, blue) >= 12) colored += 1;
    }
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    sum += luminance;
    sumSquares += luminance * luminance;
  }
  const pixels = decoded.info.width * decoded.info.height;
  const meanLuminance = sum / pixels;
  const luminanceStdDev = Math.sqrt(Math.max(0, sumSquares / pixels - meanLuminance ** 2));
  const visiblePixelRatio = visible / pixels;
  const colorPixelRatio = visible === 0 ? 0 : colored / visible;
  if (visiblePixelRatio < 0.999) failures.push("transparent_pixels");
  if (meanLuminance < 4) failures.push("black_frame");
  if (meanLuminance > 251) failures.push("white_frame");
  if (luminanceStdDev < 2) failures.push("near_solid_frame");
  if (colorPixelRatio < colorPixelRatioMin) failures.push("insufficient_color");
  const duplicateOwner = duplicateOwners.get(sha256);
  if (duplicateOwner !== undefined && duplicateOwner !== assetId) failures.push("duplicate_pixels");
  return {
    status: failures.length ? "fail" : "pass",
    format: metadata.format,
    sizeBytes: bytes.length,
    sha256,
    width: decoded.info.width,
    height: decoded.info.height,
    meanLuminance: round6(meanLuminance),
    luminanceStdDev: round6(luminanceStdDev),
    visiblePixelRatio: round6(visiblePixelRatio),
    colorPixelRatio: round6(colorPixelRatio),
    failures: [...new Set(failures)].sort()
  };
}
