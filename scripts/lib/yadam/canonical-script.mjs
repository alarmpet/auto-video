// scripts/lib/yadam/canonical-script.mjs
import { sha256Bytes } from "../pipeline/canonical-json.mjs";

export function calculateByteSpans(scenes) {
  let currentByteOffset = 0;
  return scenes.map((s, idx) => {
    const sceneText = s.text.normalize("NFC").trim();
    const sceneBytes = Buffer.from(sceneText, "utf8").length;
    
    const startByte = currentByteOffset;
    const endByteExclusive = startByte + sceneBytes;
    
    const separatorBytes = (idx === scenes.length - 1) ? 1 : 2;
    currentByteOffset = endByteExclusive + separatorBytes;

    return {
      startByte,
      endByteExclusive
    };
  });
}

export function renderFinalText(scenes) {
  return scenes.map(s => s.text.normalize("NFC").trim()).join("\n\n") + "\n";
}
