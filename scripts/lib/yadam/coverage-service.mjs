// scripts/lib/yadam/coverage-service.mjs
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { loadJob } from "../pipeline/job-store.mjs";
import { writeCanonicalJson } from "../pipeline/atomic-store.mjs";
import { registerArtifact } from "../pipeline/artifact-store.mjs";

function coverageError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function updateCoverageSection({ jobDir, section, report }) {
  const context = await loadJob(jobDir);
  const { request } = context;

  if (section !== "audio" && section !== "subtitle" && section !== "visual") {
    throw coverageError("invalid_section", `Invalid coverage section: ${section}`);
  }

  // Load existing coverage report if it exists
  const coverageReportPath = join(jobDir, "script/coverage-report.json");
  let currentReport;
  try {
    const content = await readFile(coverageReportPath, "utf8");
    currentReport = JSON.parse(content);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    currentReport = {
      schemaVersion: "1.0.0",
      jobId: request.jobId,
      sections: {
        script: "pass",
        audio: "pending",
        subtitle: "pending",
        visual: "pending"
      },
      audioSection: null,
      subtitleSection: null,
      visualSection: null
    };
  }

  // Update section
  currentReport.sections[section] = report.status || "pass";
  currentReport[`${section}Section`] = {
    relativePath: report.relativePath || `script/coverage/${section}-rNNN.json`,
    sha256: report.sha256 || "0000000000000000000000000000000000000000000000000000000000000000",
    revision: report.revision || 1
  };

  const writeResult = await writeCanonicalJson(coverageReportPath, currentReport);
  const coverageReportHash = writeResult.sha256;

  await registerArtifact(jobDir, {
    artifactId: "yadam-coverage-report",
    logicalRole: "yadam.coverage.report",
    path: "script/coverage-report.json",
    sha256: coverageReportHash,
    schemaVersion: "1.0.0",
    producerStage: "coverage-update",
    gateStatus: "pass",
    dependencyHashes: {}
  });

  const complete = Object.values(currentReport.sections).every(s => s === "pass");

  return {
    relativePath: "script/coverage-report.json",
    sha256: coverageReportHash,
    sectionArtifact: currentReport[`${section}Section`],
    complete,
    sections: currentReport.sections
  };
}
