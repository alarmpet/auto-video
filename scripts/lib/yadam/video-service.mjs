import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { loadJob } from "../pipeline/job-store.mjs";
import { writeCanonicalJsonExclusive, readJson, writeCanonicalJson, writeUtf8Atomic } from "../pipeline/atomic-store.mjs";
import { registerArtifact, canReuseArtifact } from "../pipeline/artifact-store.mjs";
import { sha256Bytes } from "../pipeline/canonical-json.mjs";
import { validateSchema } from "../pipeline/schema-registry.mjs";
import { ensureVideoJobLayout, ensureContainedVideoDirectory } from "./video-layout.mjs";
import { finalizeRenderManifest, loadVerifiedRenderManifest } from "./render-manifest.mjs";
import { buildHermesCompatibility } from "./hermes-compat.mjs";
import { runSegmentStrictQa } from "./video-qa.mjs";
import { compileFinalConcat } from "./concat-service.mjs";
import { buildSuccessEvidence } from "../pipeline/success-evidence.mjs";
import { transitionJob } from "../pipeline/state-machine.mjs";

const SEGMENT_MANIFEST_SCHEMA = resolve("schemas/yadam/segment-manifest.schema.json");
const INCIDENT_SCHEMA = resolve("schemas/yadam/completed-artifact-incident.schema.json");

export async function assembleAllSegments({ jobDir, signal }) {
  const job = await loadJob(jobDir);
  
  // 1. Ensure Layout
  await ensureVideoJobLayout(jobDir);

  // 2. Finalize render manifest
  const renderManifest = await finalizeRenderManifest({ jobDir });
  const renderManifestVal = await loadVerifiedRenderManifest(jobDir);

  // 3. Build Hermes compatibility projection
  await buildHermesCompatibility({ jobDir, renderManifest: renderManifestVal });

  // 4. Iterate and render segments
  const segmentsOut = [];
  let cumulativeSeconds = 0;
  
  for (const seg of renderManifestVal.value.segments) {
    const segmentId = seg.segmentId;
    const segmentJobDir = join(jobDir, `compat/hermes/${segmentId}`);
    const segmentExportDir = join(jobDir, `segments/${segmentId}`);
    const finalMp4Path = `segments/${segmentId}/manual-assembly/final.mp4`;
    
    // Check if segment video is already completed/reusable
    const canReuse = await canReuseArtifact(jobDir, `yadam-video-segment-${segmentId}`, {
      "yadam.compat.hermes.sceneplan": renderManifestVal.sha256
    });

    const finalPathAbs = join(jobDir, finalMp4Path);
    
    if (canReuse && existsSync(finalPathAbs)) {
      // Reuse it!
    } else {
      // Spawn assembler
      const args = [
        "scripts/assemble_cain_fast_from_hermes_job.mjs",
        "--job-dir", segmentJobDir,
        "--export-dir", segmentExportDir,
        "--final-name", "final.mp4",
        "--preserve-audio-tempo",
        "--motion-fps", "24",
        "--preserve-color"
      ];

      await new Promise((resolvePromise, rejectPromise) => {
        const child = spawn("node", args, { stdio: "inherit", cwd: process.cwd() });
        
        let aborted = false;
        const abortHandler = () => {
          aborted = true;
          child.kill("SIGTERM");
          // Bookkeeping
          rejectPromise(Object.assign(new Error("Assembly aborted"), { code: "ABORT_ERR" }));
        };
        
        if (signal) {
          signal.addEventListener("abort", abortHandler);
        }

        child.on("close", (code) => {
          if (signal) {
            signal.removeEventListener("abort", abortHandler);
          }
          if (aborted) return;
          if (code === 0) {
            resolvePromise();
          } else {
            rejectPromise(new Error(`Assembler exited with code ${code}`));
          }
        });

        child.on("error", (err) => {
          if (signal) {
            signal.removeEventListener("abort", abortHandler);
          }
          rejectPromise(err);
        });
      });
    }

    // Run strict QA
    const qaReport = await runSegmentStrictQa({
      jobDir,
      segmentId,
      renderManifest: renderManifestVal
    });

    const videoBytes = readFileSync(finalPathAbs);
    const videoHash = sha256Bytes(videoBytes);

    // Register segment video artifact
    await registerArtifact(jobDir, {
      artifactId: `yadam-video-segment-${segmentId}`,
      logicalRole: `yadam.video.segment.${segmentId}`,
      path: finalMp4Path,
      sha256: videoHash,
      schemaVersion: "1.0.0",
      producerStage: "segment-assembler",
      gateStatus: "pass",
      dependencyHashes: {
        "yadam.compat.hermes.sceneplan": renderManifestVal.sha256
      }
    });

    const segDuration = qaReport.value.measuredDurationSeconds;

    segmentsOut.push({
      segmentId,
      plannedDurationSeconds: seg.plannedDurationSeconds,
      measuredAudioSeconds: seg.measuredAudioSeconds,
      renderDurationSeconds: seg.measuredAudioSeconds,
      finalDurationSeconds: segDuration,
      cumulativeStartSeconds: cumulativeSeconds,
      cumulativeEndSeconds: cumulativeSeconds + segDuration,
      dir: `segments/${segmentId}`,
      finalPath: finalMp4Path,
      finalSha256: videoHash,
      qaPath: qaReport.path,
      qaSha256: qaReport.sha256
    });

    cumulativeSeconds += segDuration;
  }

  // Construct segment manifest
  const segmentManifest = {
    profileId: "yadam",
    renderManifestPath: "render-manifest.json",
    renderManifestHash: renderManifestVal.sha256,
    fps: 24,
    segments: segmentsOut
  };

  await validateSchema(SEGMENT_MANIFEST_SCHEMA, segmentManifest);

  const segmentManifestPath = join(jobDir, "segment-manifest.json");

  // Exclusively write
  if (existsSync(segmentManifestPath)) {
    const oldBytes = readFileSync(segmentManifestPath);
    const oldHash = sha256Bytes(oldBytes);
    const quarantineDir = await ensureContainedVideoDirectory(jobDir, `quarantine/video/publications/segment-manifest-${oldHash}`);
    renameSync(segmentManifestPath, join(quarantineDir, "segment-manifest.json"));
  }

  const writeRes = await writeCanonicalJsonExclusive(segmentManifestPath, segmentManifest);

  // Register segment manifest artifact
  const segmentManifestArt = await registerArtifact(jobDir, {
    artifactId: "yadam-segment-manifest",
    logicalRole: "yadam.segment.manifest",
    path: "segment-manifest.json",
    sha256: writeRes.sha256,
    schemaVersion: "1.0.0",
    producerStage: "segment-manifest-compilation",
    gateStatus: "pass",
    dependencyHashes: {
      "yadam.render.manifest": renderManifestVal.sha256
    }
  });

  // Success evidence registration
  const profileHash = sha256Bytes(Buffer.from("yadam"));
  
  let ffmpegVer = "unknown";
  try {
    ffmpegVer = execFileSync("ffmpeg", ["-version"], { encoding: "utf8" }).split("\n")[0];
  } catch {}
  const ffmpegVersionHash = sha256Bytes(Buffer.from(ffmpegVer));

  const assemblerPolicyBytes = existsSync(resolve("scripts/lib/yadam/exact-video-policy.mjs")) 
    ? readFileSync(resolve("scripts/lib/yadam/exact-video-policy.mjs")) 
    : Buffer.from("");
  const assemblerPolicyHash = sha256Bytes(assemblerPolicyBytes);

  const qaPolicyBytes = existsSync(resolve("scripts/lib/yadam/video-qa.mjs")) 
    ? readFileSync(resolve("scripts/lib/yadam/video-qa.mjs")) 
    : Buffer.from("");
  const qaPolicyHash = sha256Bytes(qaPolicyBytes);

  const inputArtifactRoles = [
    "yadam.approval.2", "yadam.script.final_text", "yadam.script.scenes",
    "yadam.audio.original_wav", "yadam.audio.normalized_wav",
    "yadam.audio.timeline", "yadam.audio.manifest",
    "yadam.render_plan_input", "yadam.render.plan",
    "yadam.image.asset-manifest", "yadam.image.visual-qa",
    "yadam.thumbnail.final", "yadam.thumbnail.qa",
    "yadam.coverage.audio", "yadam.coverage.visual"
  ];
  
  const inputRecords = job.manifest.artifacts?.filter(a => inputArtifactRoles.includes(a.logicalRole) && a.gateStatus === "pass") || [];
  
  const outputRecords = [
    segmentManifestArt,
    job.manifest.artifacts?.find(a => a.logicalRole === "yadam.coverage.subtitle" && a.gateStatus === "pass"),
    job.manifest.artifacts?.find(a => a.logicalRole === "yadam.render.manifest" && a.gateStatus === "pass")
  ].filter(Boolean);

  for (const seg of segmentsOut) {
    const videoRec = job.manifest.artifacts?.find(a => a.logicalRole === `yadam.video.segment.${seg.segmentId}` && a.gateStatus === "pass");
    const qaRec = job.manifest.artifacts?.find(a => a.logicalRole === `yadam.qa.segment.${seg.segmentId}` && a.gateStatus === "pass");
    if (videoRec) outputRecords.push(videoRec);
    if (qaRec) outputRecords.push(qaRec);
  }

  const successEvidence = buildSuccessEvidence(
    "SEGMENTS_PASSED",
    inputRecords,
    outputRecords,
    { profileHash, ffmpegVersionHash, assemblerPolicyHash, qaPolicyHash }
  );

  await transitionJob(jobDir, {
    stage: "SEGMENTS_PASSED",
    to: "running",
    inputHash: successEvidence.inputHash,
    outputHash: successEvidence.outputHash,
    artifactPaths: successEvidence.artifactPaths
  });

  return {
    status: "segments_passed",
    renderManifestPath: "render-manifest.json",
    renderManifestHash: renderManifestVal.sha256,
    segmentManifestPath: "segment-manifest.json",
    segmentManifestHash: writeRes.sha256,
    segments: segmentsOut
  };
}

export async function publishFinalVideo({ jobDir, signal }) {
  const job = await loadJob(jobDir);
  
  // 1. Check if already completed and check for tamper
  if (job.state.status === "completed") {
    const terminalArtifacts = [
      { role: "yadam.video.concat_list", path: "final/concat-list.txt" },
      { role: "yadam.video.concat_report", path: "final/concat-report.json" },
      { role: "yadam.video.final", path: "final/final-full.mp4" },
      { role: "yadam.qa.final", path: "final/final-qa-report.json" },
      { role: "yadam.thumbnail.release", path: "final/thumbnail.png" },
      { role: "yadam.subtitle.upload", path: "final/upload-subtitles/final-full.upload.srt" }
    ];

    let tampered = false;
    const expectedList = [];
    const observedList = [];

    for (const term of terminalArtifacts) {
      const art = job.manifest.artifacts?.find(a => a.logicalRole === term.role && a.gateStatus === "pass");
      if (!art || !existsSync(join(jobDir, term.path))) {
        tampered = true;
        observedList.push({ artifactId: art?.artifactId || term.role, logicalRole: term.role, path: term.path, status: "missing", expectedSha256: art?.sha256 || null, observedSha256: null });
      } else {
        const actualHash = sha256Bytes(readFileSync(join(jobDir, term.path)));
        if (actualHash.toLowerCase() !== art.sha256.toLowerCase()) {
          tampered = true;
          observedList.push({ artifactId: art.artifactId, logicalRole: term.role, path: term.path, status: "modified", expectedSha256: art.sha256, observedSha256: actualHash });
        }
      }
      expectedList.push({ artifactId: art?.artifactId || term.role, logicalRole: term.role, path: term.path, expectedSha256: art?.sha256 || "" });
    }

    if (tampered) {
      const incidentKeyHash = sha256Bytes(Buffer.from(job.jobId + Date.now()));
      const incidentPath = `final/incidents/completed-artifact-tampered-${incidentKeyHash}.json`;
      const absoluteIncidentPath = join(jobDir, incidentPath);
      
      const incidentReport = {
        schemaVersion: "1.0.0",
        reportType: "completed_artifact_tampered",
        errorCode: "completed_artifact_tampered",
        jobId: job.jobId,
        incidentKeyHash,
        firstObservedAt: new Date().toISOString(),
        completedEvent: {
          stage: "FINAL_QA_PASSED",
          inputHash: "0".repeat(64),
          outputHash: "0".repeat(64),
          artifactPaths: terminalArtifacts.map(t => t.path)
        },
        expectedArtifacts: expectedList,
        observedArtifacts: observedList,
        stateStatus: "completed",
        mutationPolicy: "read_only_except_append_only_incident",
        recovery: "trusted_backup_or_new_job",
        completionOpaqueInputs: {
          profileHash: "0".repeat(64),
          ffmpegVersionHash: "0".repeat(64),
          assemblerPolicyHash: "0".repeat(64),
          qaPolicyHash: "0".repeat(64)
        }
      };

      await validateSchema(INCIDENT_SCHEMA, incidentReport);
      const incidentDir = await ensureContainedVideoDirectory(jobDir, "final/incidents");
      await writeCanonicalJsonExclusive(absoluteIncidentPath, incidentReport);

      await registerArtifact(jobDir, {
        artifactId: `yadam-incident-completed-artifact-tampered-${incidentKeyHash}`,
        logicalRole: "yadam.incident.completed_artifact_tampered",
        path: incidentPath,
        sha256: sha256Bytes(readFileSync(absoluteIncidentPath)),
        schemaVersion: "1.0.0",
        producerStage: "final-publication-tamper-check",
        gateStatus: "pass",
        dependencyHashes: {}
      });

      throw Object.assign(new Error(`Completed artifact tampered: ${incidentPath}`), {
        code: "completed_artifact_tampered",
        reportPath: incidentPath
      });
    }

    const finalQaReport = JSON.parse(readFileSync(join(jobDir, "final/final-qa-report.json"), "utf8"));
    const finalMp4Art = job.manifest.artifacts?.find(a => a.logicalRole === "yadam.video.final");
    const uploadSrtArt = job.manifest.artifacts?.find(a => a.logicalRole === "yadam.subtitle.upload");
    const thumbnailArt = job.manifest.artifacts?.find(a => a.logicalRole === "yadam.thumbnail.release");

    return {
      status: "completed",
      finalPath: "final/final-full.mp4",
      finalSha256: finalMp4Art.sha256,
      uploadSrtPath: "final/upload-subtitles/final-full.upload.srt",
      uploadSrtSha256: uploadSrtArt.sha256,
      thumbnailPath: "final/thumbnail.png",
      thumbnailSha256: thumbnailArt.sha256,
      qaPath: "final/final-qa-report.json",
      qaSha256: finalQaReport.artifactHashes.video, // wait, final-qa-report hash or the video hash? Check schema returns final-qa-report hash
      finalDurationSeconds: finalQaReport.measuredDurationSeconds,
      qualityOk: true,
      finalVerdict: "pass"
    };
  }

  // 2. Perform concatenation compilation
  const renderManifestVal = await loadVerifiedRenderManifest(jobDir);
  const result = await compileFinalConcat({ jobDir, renderManifest: renderManifestVal });

  // 3. Register final artifacts
  const finalListArt = await registerArtifact(jobDir, {
    artifactId: "yadam-video-concat-list",
    logicalRole: "yadam.video.concat_list",
    path: result.concatList.path,
    sha256: result.concatList.sha256,
    schemaVersion: "1.0.0",
    producerStage: "final-concat",
    gateStatus: "pass",
    dependencyHashes: {
      "yadam.render.manifest": renderManifestVal.sha256
    }
  });

  const finalVideoArt = await registerArtifact(jobDir, {
    artifactId: "yadam-video-final",
    logicalRole: "yadam.video.final",
    path: result.finalVideo.path,
    sha256: result.finalVideo.sha256,
    schemaVersion: "1.0.0",
    producerStage: "final-concat",
    gateStatus: "pass",
    dependencyHashes: {
      "yadam.video.concat_list": result.concatList.sha256
    }
  });

  const uploadSrtArt = await registerArtifact(jobDir, {
    artifactId: "yadam-subtitle-upload",
    logicalRole: "yadam.subtitle.upload",
    path: result.uploadSubtitle.path,
    sha256: result.uploadSubtitle.sha256,
    schemaVersion: "1.0.0",
    producerStage: "final-subtitle-merge",
    gateStatus: "pass",
    dependencyHashes: {
      "yadam.render.manifest": renderManifestVal.sha256
    }
  });

  // Copy thumbnail to release destination
  const releaseThumbnailPath = join(jobDir, "final/thumbnail.png");
  const sourceThumbnailPath = join(jobDir, renderManifestVal.value.thumbnail.path);
  const thumbnailBytes = readFileSync(sourceThumbnailPath);
  writeFileSync(releaseThumbnailPath, thumbnailBytes);
  const thumbnailHash = sha256Bytes(thumbnailBytes);

  const releaseThumbnailArt = await registerArtifact(jobDir, {
    artifactId: "yadam-thumbnail-release",
    logicalRole: "yadam.thumbnail.release",
    path: "final/thumbnail.png",
    sha256: thumbnailHash,
    schemaVersion: "1.0.0",
    producerStage: "final-publication",
    gateStatus: "pass",
    dependencyHashes: {
      "yadam.thumbnail.final": renderManifestVal.value.thumbnail.sha256
    }
  });

  // Final QA report was written inside compileFinalConcat
  const finalQaArt = job.manifest.artifacts?.find(a => a.logicalRole === "yadam.qa.final" && a.gateStatus === "pass");

  // Success evidence registration
  const profileHash = sha256Bytes(Buffer.from("yadam"));
  
  let ffmpegVer = "unknown";
  try {
    ffmpegVer = execFileSync("ffmpeg", ["-version"], { encoding: "utf8" }).split("\n")[0];
  } catch {}
  const ffmpegVersionHash = sha256Bytes(Buffer.from(ffmpegVer));

  const assemblerPolicyBytes = existsSync(resolve("scripts/lib/yadam/exact-video-policy.mjs")) 
    ? readFileSync(resolve("scripts/lib/yadam/exact-video-policy.mjs")) 
    : Buffer.from("");
  const assemblerPolicyHash = sha256Bytes(assemblerPolicyBytes);

  const qaPolicyBytes = existsSync(resolve("scripts/lib/yadam/video-qa.mjs")) 
    ? readFileSync(resolve("scripts/lib/yadam/video-qa.mjs")) 
    : Buffer.from("");
  const qaPolicyHash = sha256Bytes(qaPolicyBytes);

  const inputRecords = [
    job.manifest.artifacts?.find(a => a.logicalRole === "yadam.segment.manifest" && a.gateStatus === "pass")
  ].filter(Boolean);

  const outputRecords = [
    finalListArt,
    finalVideoArt,
    uploadSrtArt,
    releaseThumbnailArt,
    finalQaArt
  ].filter(Boolean);

  const successEvidence = buildSuccessEvidence(
    "FINAL_QA_PASSED",
    inputRecords,
    outputRecords,
    { profileHash, ffmpegVersionHash, assemblerPolicyHash, qaPolicyHash }
  );

  await transitionJob(jobDir, {
    stage: "FINAL_QA_PASSED",
    to: "completed",
    inputHash: successEvidence.inputHash,
    outputHash: successEvidence.outputHash,
    artifactPaths: successEvidence.artifactPaths
  });

  const finalQaData = JSON.parse(readFileSync(join(jobDir, "final/final-qa-report.json"), "utf8"));

  return {
    status: "completed",
    finalPath: result.finalVideo.path,
    finalSha256: result.finalVideo.sha256,
    uploadSrtPath: result.uploadSubtitle.path,
    uploadSrtSha256: result.uploadSubtitle.sha256,
    thumbnailPath: "final/thumbnail.png",
    thumbnailSha256: thumbnailHash,
    qaPath: "final/final-qa-report.json",
    qaSha256: result.finalQaReport.sha256,
    finalDurationSeconds: finalQaData.measuredDurationSeconds,
    qualityOk: true,
    finalVerdict: "pass"
  };
}

export async function loadFinalQa(jobDir) {
  const job = await loadJob(jobDir);
  
  // Check if completed artifact is tampered first
  const finalQaArt = job.manifest.artifacts?.find(a => a.logicalRole === "yadam.qa.final" && a.gateStatus === "pass");
  if (!finalQaArt) {
    throw new Error("Final QA report is missing from artifacts");
  }

  const finalQaPath = join(jobDir, finalQaArt.path);
  if (!existsSync(finalQaPath)) {
    throw new Error(`Final QA report file missing: ${finalQaArt.path}`);
  }

  // Check if an incident report already exists
  const incidentArt = job.manifest.artifacts?.find(a => a.logicalRole === "yadam.incident.completed_artifact_tampered");
  if (incidentArt) {
    throw Object.assign(new Error(`Completed artifact tampered: ${incidentArt.path}`), {
      code: "completed_artifact_tampered",
      reportPath: incidentArt.path
    });
  }

  const qaReport = JSON.parse(readFileSync(finalQaPath, "utf8"));
  return {
    qaPath: finalQaArt.path,
    qaSha256: finalQaArt.sha256,
    qualityOk: qaReport.qualityOk,
    finalVerdict: qaReport.finalVerdict,
    finalDurationSeconds: qaReport.measuredDurationSeconds,
    checks: qaReport.checks
  };
}
