import { spawn } from "node:child_process";

export function measureColorPixelRatio(filePath, options = {}) {
  return new Promise((resolve, reject) => {
    const args = ["-y"];
    if (options.ss !== undefined) {
      args.push("-ss", String(options.ss));
    }
    args.push("-i", filePath);
    if (options.ss !== undefined) {
      args.push("-vframes", "1");
    }
    args.push("-vf", "format=rgba", "-f", "rawvideo", "pipe:1");

    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });

    const buffers = [];
    let totalLength = 0;
    const maxBytes = 64 * 1024 * 1024; // 64 MiB limit

    child.stdout.on("data", (chunk) => {
      if (totalLength + chunk.length > maxBytes) {
        child.kill();
        reject(new Error("FFmpeg output exceeded 64 MiB limit"));
        return;
      }
      buffers.push(chunk);
      totalLength += chunk.length;
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg process exited with code ${code}. Stderr: ${stderr}`));
        return;
      }

      const buffer = Buffer.concat(buffers);
      let opaquePixels = 0;
      let colorPixels = 0;

      for (let i = 0; i < buffer.length; i += 4) {
        if (i + 3 >= buffer.length) break;
        const r = buffer[i];
        const g = buffer[i + 1];
        const b = buffer[i + 2];
        const a = buffer[i + 3];

        if (a >= 250) {
          opaquePixels++;
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          if (max - min >= 12) {
            colorPixels++;
          }
        }
      }

      if (opaquePixels === 0) {
        reject(new Error("No opaque pixels (alpha >= 250) found in frame"));
        return;
      }

      resolve({
        opaquePixels,
        colorPixels,
        ratio: colorPixels / opaquePixels
      });
    });

    child.on("error", (err) => {
      reject(err);
    });

    if (options.signal) {
      options.signal.addEventListener("abort", () => {
        child.kill();
        reject(options.signal.reason || new Error("Aborted"));
      });
    }
  });
}
