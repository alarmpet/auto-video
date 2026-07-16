import { spawn } from "node:child_process";
import { stat, readFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { sha256Bytes } from "../pipeline/canonical-json.mjs";

async function findSystemCandidates() {
  return new Promise((resolve) => {
    const child = spawn("where.exe", ["codex"], { shell: false });
    let stdout = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.on("close", (code) => {
      if (code === 0) {
        const paths = stdout.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
        resolve(paths);
      } else {
        resolve([]);
      }
    });
    child.on("error", () => resolve([]));
  });
}

async function checkVersion(execPath, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const isMjs = execPath.endsWith(".mjs");
    const exec = isMjs ? process.execPath : execPath;
    const args = isMjs ? [execPath, "--version"] : ["--version"];
    const child = spawn(exec, args, { shell: false });
    let stdout = "";
    let stderr = "";
    
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: "timeout" });
    }, timeoutMs);

    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, version: stdout.trim() || stderr.trim() });
      } else {
        resolve({ ok: false, error: `exit code ${code}`, stderr });
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
  });
}

async function checkLoginStatus(executable, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const isMjs = executable.endsWith(".mjs");
    const exec = isMjs ? process.execPath : executable;
    const args = isMjs ? [executable, "login", "status"] : ["login", "status"];
    const child = spawn(exec, args, { shell: false });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: "timeout" });
    }, timeoutMs);

    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, output: (stdout + stderr).trim() });
      } else {
        resolve({ ok: false, error: `exit code ${code}`, output: (stdout + stderr).trim() });
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
  });
}

async function fileExists(path) {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch (e) {
    return false;
  }
}

export async function discoverCodex(hostConfig) {
  const candidates = [];
  if (hostConfig.codex && hostConfig.codex.executable) {
    candidates.push(resolve(hostConfig.codex.executable));
  }
  candidates.push("C:/Users/petbl/AppData/Local/OpenAI/Codex/bin/a7c12ebff69fb123/codex.exe");
  const systemCandidates = await findSystemCandidates();
  candidates.push(...systemCandidates);

  const uniqueCandidates = [...new Set(candidates)];
  const timeout = hostConfig.codex?.versionTimeoutMs || 15000;

  for (const cand of uniqueCandidates) {
    try {
      const statResult = await stat(cand);
      if (!statResult.isFile()) continue;
    } catch (e) {
      continue;
    }
    const check = await checkVersion(cand, timeout);
    if (check.ok) {
      return {
        executable: cand.replaceAll("\\", "/"),
        version: check.version
      };
    }
  }

  throw new Error("Codex CLI executable not found or not working");
}

export async function preflightCodex(executable, options = {}) {
  const { timeoutMs = 15000, profile, stageWorkDir } = options;
  const workspaceRoot = options.workspaceRoot || process.cwd();

  const check = await checkVersion(executable, timeoutMs);
  if (!check.ok) {
    throw new Error(`Codex CLI version check failed: ${check.error}`);
  }

  const login = await checkLoginStatus(executable, timeoutMs);
  if (!login.ok) {
    throw new Error(`Codex CLI login status check failed: ${login.error}`);
  }

  const instructionSourceHashes = {};
  const checkedInstructionPaths = [];
  const pins = profile.codex?.instructionSourcePins || {};

  let globalPath = null;
  const globalOverridePath = resolve(join(workspaceRoot, "AGENTS.override.md"));
  const globalNormalPath = resolve(join(workspaceRoot, "AGENTS.md"));

  if (await fileExists(globalOverridePath)) {
    globalPath = globalOverridePath;
  } else if (await fileExists(globalNormalPath)) {
    globalPath = globalNormalPath;
  }

  if (globalPath) {
    const normPath = resolve(globalPath).replaceAll("\\", "/");
    checkedInstructionPaths.push(normPath);
    const content = await readFile(globalPath);
    const hash = sha256Bytes(content);
    instructionSourceHashes[normPath] = hash;

    if (!pins[normPath] || pins[normPath] !== hash) {
      const err = new Error(`Instruction source unpinned or hash mismatch: ${normPath}`);
      err.code = "codex_instruction_source_changed";
      throw err;
    }
  }

  if (stageWorkDir) {
    const configTomlPath = join(stageWorkDir, ".codex", "config.toml");
    if (await fileExists(configTomlPath)) {
      const err = new Error("Stage .codex/config.toml is forbidden");
      err.code = "codex_stage_config_forbidden";
      throw err;
    }

    let stagePath = null;
    const stageOverridePath = resolve(join(stageWorkDir, "AGENTS.override.md"));
    const stageNormalPath = resolve(join(stageWorkDir, "AGENTS.md"));

    if (await fileExists(stageOverridePath)) {
      stagePath = stageOverridePath;
    } else if (await fileExists(stageNormalPath)) {
      stagePath = stageNormalPath;
    }

    if (stagePath) {
      const normPath = resolve(stagePath).replaceAll("\\", "/");
      checkedInstructionPaths.push(normPath);
      const content = await readFile(stagePath);
      const hash = sha256Bytes(content);
      instructionSourceHashes[normPath] = hash;

      if (!pins[normPath] || pins[normPath] !== hash) {
        const err = new Error(`Instruction source unpinned or hash mismatch in stage: ${normPath}`);
        err.code = "codex_instruction_source_changed";
        throw err;
      }
    }
  }

  return {
    ok: true,
    executable,
    version: check.version,
    loggedIn: true,
    instructionSourceHashes,
    checkedInstructionPaths,
    diagnostics: {
      versionOutput: check.version,
      loginOutput: login.output
    }
  };
}
