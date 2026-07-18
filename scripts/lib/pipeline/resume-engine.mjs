import { resolve } from "node:path";
import { loadJob } from "./job-store.mjs";

export async function runResumeEngine({ jobDir }) {
  const resolvedJobDir = resolve(jobDir);
  const job = await loadJob(resolvedJobDir);
  return {
    jobId: job.state.jobId,
    status: job.state.status,
    historyLength: job.state.history?.length || 0
  };
}
