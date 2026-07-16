// scripts/lib/yadam/tts-policy.mjs
import { hashCanonical } from "../pipeline/canonical-json.mjs";

export function buildTtsOptions({ profile, delivery }) {
  return {
    provider: profile?.tts?.provider || "supertonic",
    voice: profile?.tts?.voice || "M1",
    speed: profile?.tts?.speed || 1.04,
    readSlow: !!delivery?.readSlow,
    continuousNext: !!delivery?.continuousNext
  };
}

export function hashTtsOptions(options) {
  return hashCanonical(options);
}
