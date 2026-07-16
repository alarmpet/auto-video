// scripts/test_yadam_script_validators.mjs
import assert from "node:assert/strict";
import { checkHanja, checkMeta, checkQuotePairs, performAllChecks } from "./lib/yadam/script-validators.mjs";

async function runTest() {
  assert.equal(checkHanja("한글 漢字 없음").passed, false);
  assert.equal(checkHanja("한글 한문 없음").passed, true);
  
  assert.equal(checkMeta("챕터 1: 시작").passed, false);
  assert.equal(checkMeta("그냥 텍스트입니다.").passed, true);

  assert.equal(checkQuotePairs('“따옴표가 열렸습니다.').passed, false);
  assert.equal(checkQuotePairs('“따옴표가 있고” "다른 따옴표"').passed, true);

  const res = performAllChecks("평화로운 마을에 살고 있었습니다. “이건 말도 안 돼요! 당장 멈추세요!”");
  assert.equal(res.gateStatus, "pass");

  console.log("ok - yadam script validators");
}

runTest().catch(err => {
  console.error(err);
  process.exit(1);
});
