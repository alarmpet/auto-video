import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function detectCapCutTools() {
  const tools = { capcutCli: false, pyCapCut: false };
  try {
    execFileSync("npx.cmd", ["-y", "capcut-cli", "--help"], { stdio: "ignore", timeout: 20000 });
    tools.capcutCli = true;
  } catch {
    try {
      execFileSync("npx", ["-y", "capcut-cli", "--help"], { stdio: "ignore", timeout: 20000 });
      tools.capcutCli = true;
    } catch {}
  }
  try {
    execFileSync("python", ["-c", "import pycapcut; print('ok')"], { stdio: "ignore", timeout: 10000 });
    tools.pyCapCut = true;
  } catch {
    try {
      execFileSync("py", ["-c", "import pycapcut; print('ok')"], { stdio: "ignore", timeout: 10000 });
      tools.pyCapCut = true;
    } catch {}
  }
  return tools;
}

export function buildCapCutQaManifest({ exportDir, outputDir }) {
  const segmentManifest = JSON.parse(readFileSync(join(exportDir, "segment-manifest.json"), "utf8"));
  const finalSrtPath = join(exportDir, "final", "final-full.srt");
  const segments = (segmentManifest.segments || []).map((segment) => ({
    id: segment.id,
    finalPath: segment.finalPath || join(segment.dir, "manual-assembly", "final.mp4"),
    srtPath: join(segment.dir, "manual-assembly", "subtitles.srt"),
    timelinePath: join(segment.dir, "visual-timeline.json"),
    durationSeconds: segment.durationSeconds,
  }));
  mkdirSync(outputDir, { recursive: true });
  const manifest = {
    format: "auto-video-capcut-qa-manifest-only-v1",
    sourceExportDir: exportDir,
    finalSrtPath: existsSync(finalSrtPath) ? finalSrtPath : null,
    segments,
    notes: [
      "This package does not create draft_content.json.",
      "Import MP4/SRT files into CapCut manually for QA.",
      "FFmpeg output remains the canonical automated render.",
    ],
  };
  const manifestPath = join(outputDir, "capcut-draft-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  writeFileSync(join(outputDir, "README-capcut-import.md"), buildImportGuide(manifest), "utf8");
  return { manifestPath, manifest };
}

function buildImportGuide(manifest) {
  return [
    "# CapCut Manual QA Import",
    "",
    "This is a manifest-only QA package, not a native CapCut draft_content.json.",
    "",
    "1. Open CapCut desktop.",
    "2. Create a 16:9 project.",
    "3. Import segment MP4 files in order.",
    "4. Import final-full.srt when available, or each segment subtitles.srt.",
    "5. Check repeated narration, pacing changes, and long still-image stretches.",
    "",
    "## Segments",
    ...manifest.segments.map((segment) => `- ${segment.id}: ${segment.finalPath}`),
    "",
  ].join("\n");
}
