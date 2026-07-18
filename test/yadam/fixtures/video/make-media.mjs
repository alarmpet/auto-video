import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function generateSyntheticPng(path, width = 100, height = 100, color = "red") {
  mkdirSync(dirname(path), { recursive: true });
  execFileSync("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=${color}:s=${width}x${height}:d=1`,
    "-vframes", "1",
    path
  ], { stdio: "ignore" });
}

export function generateSyntheticWav(path, durationSeconds = 1, sampleRate = 48000) {
  mkdirSync(dirname(path), { recursive: true });
  execFileSync("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `anullsrc=r=${sampleRate}:cl=stereo:d=${durationSeconds}`,
    "-t", String(durationSeconds),
    path
  ], { stdio: "ignore" });
}

export function generateSyntheticMp4(path, durationSeconds = 1, options = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const color = options.color || "red";
  const fps = options.fps || 24;
  const sampleRate = options.sampleRate || 48000;
  
  execFileSync("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=${color}:s=1920x1080:d=${durationSeconds}:r=${fps}`,
    "-f", "lavfi",
    "-i", `anullsrc=r=${sampleRate}:cl=stereo`,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-t", String(durationSeconds),
    "-c:a", "aac",
    "-b:a", "160k",
    "-pix_fmt", "yuv420p",
    path
  ], { stdio: "ignore" });
}

export function generateSyntheticSrt(path, cues = []) {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [];
  cues.forEach((cue, index) => {
    lines.push(String(index + 1));
    lines.push(`${formatTime(cue.start)} --> ${formatTime(cue.end)}`);
    lines.push(cue.text);
    lines.push("");
  });
  writeFileSync(path, lines.join("\n"), "utf8");
}

function formatTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const x = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(x).padStart(3, "0")}`;
}
