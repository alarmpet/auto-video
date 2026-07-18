import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { loadProfile } from "../../scripts/lib/pipeline/profile-registry.mjs";

test("gguljam-bible profile regression check", async () => {
  const workspaceRoot = resolve(".");
  const profile = await loadProfile("gguljam-bible", workspaceRoot);

  // Assert legacy configurations remain exactly untouched
  assert.equal(profile.profileId, "gguljam-bible");
  assert.equal(profile.mode, "legacy-compatibility");
  assert.equal(profile.strictRelease, false);
  assert.equal(profile.assemblerScript, "scripts/assembler.mjs");
  assert.equal(profile.concatScript, "scripts/concat.mjs");

  // Ensure no yadam-specific keys leaked into the legacy profile
  assert.equal(profile.codex, undefined);
  assert.equal(profile.tts, undefined);
  assert.equal(profile.visual, undefined);
  assert.equal(profile.video, undefined);
});
