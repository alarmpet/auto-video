import { writeFile } from "node:fs/promises";

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--version")) {
    console.log("codex-cli 0.144.0-alpha.4");
    process.exit(0);
  }

  if (args.includes("login") && args.includes("status")) {
    console.log("Logged in successfully");
    process.exit(0);
  }

  if (args.includes("exec")) {
    const mode = process.env.FAKE_CODEX_MODE || "success";

    if (mode === "success") {
      console.log(JSON.stringify({ status: "running", stage: "exec" }));
      console.log(JSON.stringify({ status: "success", info: "done" }));

      const outIdx = args.indexOf("--output-last-message");
      if (outIdx !== -1 && args[outIdx + 1]) {
        const candidatePath = args[outIdx + 1];
        const payload = {
          jobId: process.env.FAKE_CODEX_JOB_ID || "job-123",
          stageId: process.env.FAKE_CODEX_STAGE_ID || "stage-1",
          inputHash: process.env.FAKE_CODEX_INPUT_HASH || "hash-1",
          data: { success: true }
        };
        await writeFile(candidatePath, JSON.stringify(payload) + "\n", "utf8");
      }
      process.exit(0);
    }

    if (mode === "jsonl-error") {
      console.log(JSON.stringify({ status: "running" }));
      console.log(JSON.stringify({ status: "failed", error: { message: "Generation failed" } }));
      process.exit(1);
    }

    if (mode === "malformed-json") {
      console.log(JSON.stringify({ status: "success" }));
      const outIdx = args.indexOf("--output-last-message");
      if (outIdx !== -1 && args[outIdx + 1]) {
        const candidatePath = args[outIdx + 1];
        await writeFile(candidatePath, "{malformed json", "utf8");
      }
      process.exit(0);
    }

    if (mode === "schema-error") {
      console.log(JSON.stringify({ status: "success" }));
      const outIdx = args.indexOf("--output-last-message");
      if (outIdx !== -1 && args[outIdx + 1]) {
        const candidatePath = args[outIdx + 1];
        await writeFile(candidatePath, JSON.stringify({ wrongField: true }) + "\n", "utf8");
      }
      process.exit(0);
    }

    if (mode === "timeout") {
      console.log(JSON.stringify({ status: "running" }));
      await new Promise(resolve => setTimeout(resolve, 60000));
      process.exit(0);
    }
  }

  console.error("Unknown arguments:", args);
  process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
