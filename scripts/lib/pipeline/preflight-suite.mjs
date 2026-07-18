import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { loadHostConfig, loadProfile } from "./profile-registry.mjs";
import { preflightCodex } from "../providers/codex-cli.mjs";

export async function runPreflightSuite({ workspaceRoot = process.cwd(), profileId = "yadam" }) {
  const hostConfig = await loadHostConfig(workspaceRoot);
  const profile = await loadProfile(profileId, workspaceRoot);

  const results = [];
  let overallOk = true;

  // 1. FFmpeg
  try {
    if (!hostConfig.ffmpeg?.executable || !hostConfig.ffmpeg?.ffprobeExecutable) {
      throw new Error("FFmpeg or ffprobe executable path is missing in host config");
    }
    execFileSync(hostConfig.ffmpeg.executable, ["-version"]);
    execFileSync(hostConfig.ffmpeg.ffprobeExecutable, ["-version"]);
    results.push({ name: "ffmpeg", ok: true });
  } catch (err) {
    overallOk = false;
    results.push({ name: "ffmpeg", ok: false, error: err.message });
  }

  // 2. Codex
  try {
    if (!hostConfig.codex?.executable) {
      throw new Error("Codex executable path is missing in host config");
    }
    const res = await preflightCodex(hostConfig.codex.executable, { profile, workspaceRoot });
    results.push({ name: "codex", ok: res.loggedIn });
    if (!res.loggedIn) overallOk = false;
  } catch (err) {
    overallOk = false;
    results.push({ name: "codex", ok: false, error: err.message });
  }

  // 3. Supertonic
  try {
    if (!hostConfig.supertonic?.baseUrl) {
      throw new Error("Supertonic baseUrl is missing in host config");
    }
    const res = await fetch(hostConfig.supertonic.baseUrl, { signal: AbortSignal.timeout(2000) });
    results.push({ name: "supertonic", ok: res.status < 500 });
    if (res.status >= 500) overallOk = false;
  } catch (err) {
    overallOk = false;
    results.push({ name: "supertonic", ok: false, error: err.message });
  }

  // 4. ComfyUI
  try {
    if (!hostConfig.comfyui?.baseUrl) {
      throw new Error("ComfyUI baseUrl is missing in host config");
    }
    const res = await fetch(hostConfig.comfyui.baseUrl, { signal: AbortSignal.timeout(2000) });
    results.push({ name: "comfyui", ok: res.ok || res.status < 500 });
    if (res.status >= 500) overallOk = false;
  } catch (err) {
    overallOk = false;
    results.push({ name: "comfyui", ok: false, error: err.message });
  }

  // 5. Ollama
  try {
    if (!hostConfig.ollama?.baseUrl) {
      throw new Error("Ollama baseUrl is missing in host config");
    }
    const res = await fetch(hostConfig.ollama.baseUrl, { signal: AbortSignal.timeout(2000) });
    results.push({ name: "ollama", ok: res.ok || res.status < 500 });
    if (res.status >= 500) overallOk = false;
  } catch (err) {
    overallOk = false;
    results.push({ name: "ollama", ok: false, error: err.message });
  }

  return {
    ok: overallOk,
    results
  };
}
