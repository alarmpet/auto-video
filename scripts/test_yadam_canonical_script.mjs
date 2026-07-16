// scripts/test_yadam_canonical_script.mjs
import assert from "node:assert/strict";
import { calculateByteSpans, renderFinalText } from "./lib/yadam/canonical-script.mjs";

async function runTest() {
  const scenes = [
    { text: "옛날 옛적에 🌸" }, // Has a 4-byte emoji
    { text: "두 번째 장면입니다." }
  ];

  const finalText = renderFinalText(scenes);
  assert.equal(finalText.endsWith("\n"), true);

  const spans = calculateByteSpans(scenes);
  assert.equal(spans.length, 2);

  // Check UTF-8 byte sizes
  const firstTextBytes = Buffer.from(scenes[0].text.normalize("NFC").trim(), "utf8").length;
  assert.equal(spans[0].startByte, 0);
  assert.equal(spans[0].endByteExclusive, firstTextBytes);

  assert.equal(spans[1].startByte, firstTextBytes + 2); // 2 LFs
  const secondTextBytes = Buffer.from(scenes[1].text.normalize("NFC").trim(), "utf8").length;
  assert.equal(spans[1].endByteExclusive, spans[1].startByte + secondTextBytes);

  console.log("ok - yadam canonical script byte spans");
}

runTest().catch(err => {
  console.error(err);
  process.exit(1);
});
