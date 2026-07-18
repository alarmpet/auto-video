import { readFile, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadJob } from "../pipeline/job-store.mjs";
import { writeCanonicalJson, writeUtf8Atomic } from "../pipeline/atomic-store.mjs";
import { registerArtifact, canReuseArtifact } from "../pipeline/artifact-store.mjs";
import { hashCanonical, sha256Bytes } from "../pipeline/canonical-json.mjs";
import { updateCoverageSection } from "./script-service.mjs";
import { ensureContainedVideoDirectory } from "./video-layout.mjs";
import { validateSchema } from "../pipeline/schema-registry.mjs";

const SUBTITLE_CUES_SCHEMA = resolve("schemas/yadam/subtitle-cues.schema.json");

export function normalizeSubtitleCoverageText(value) {
  return String(value).normalize("NFC").replace(/\r\n?/g, "\n").replace(/\s+/gu, "");
}

function graphemeLength(str) {
  const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });
  return Array.from(segmenter.segment(str)).length;
}

function splitGraphemesAtMidpoint(str) {
  const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });
  const graphemes = Array.from(segmenter.segment(str)).map(s => s.segment);
  const mid = Math.ceil(graphemes.length / 2);
  return [graphemes.slice(0, mid).join(""), graphemes.slice(mid).join("")];
}

export function splitTextIntoCues(text) {
  const normalized = text.replace(/\r\n?/g, "\n");
  const sentences = normalized.split(/(?<=[.!?\n])\s+/);
  const results = [];
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if (graphemeLength(trimmed) <= 26) {
      results.push(trimmed);
    } else {
      const words = trimmed.split(/\s+/);
      let currentGroup = [];
      for (const word of words) {
        if (graphemeLength(word) > 26) {
          if (currentGroup.length > 0) {
            results.push(currentGroup.join(" "));
            currentGroup = [];
          }
          const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });
          const segments = Array.from(segmenter.segment(word)).map(s => s.segment);
          for (let i = 0; i < segments.length; i += 26) {
            results.push(segments.slice(i, i + 26).join(""));
          }
        } else {
          const testGroup = [...currentGroup, word].join(" ");
          if (graphemeLength(testGroup) <= 26) {
            currentGroup.push(word);
          } else {
            if (currentGroup.length > 0) {
              results.push(currentGroup.join(" "));
            }
            currentGroup = [word];
          }
        }
      }
      if (currentGroup.length > 0) {
        results.push(currentGroup.join(" "));
      }
    }
  }
  return results;
}

function allocateDurations(graphemeCounts, D) {
  const n = graphemeCounts.length;
  const dur = new Array(n).fill(0);
  const fixed = new Array(n).fill(false);
  
  let remainingD = D;
  
  while (true) {
    let unallocatedGraphemes = 0;
    for (let i = 0; i < n; i++) {
      if (!fixed[i]) unallocatedGraphemes += graphemeCounts[i];
    }
    
    for (let i = 0; i < n; i++) {
      if (!fixed[i]) {
        dur[i] = unallocatedGraphemes > 0 ? (graphemeCounts[i] / unallocatedGraphemes) * remainingD : 0;
      }
    }
    
    let adjusted = false;
    for (let i = 0; i < n; i++) {
      if (!fixed[i]) {
        if (dur[i] < 0.2) {
          dur[i] = 0.2;
          fixed[i] = true;
          remainingD -= 0.2;
          adjusted = true;
          break;
        } else if (dur[i] > 8.0) {
          dur[i] = 8.0;
          fixed[i] = true;
          remainingD -= 8.0;
          adjusted = true;
          break;
        }
      }
    }
    
    if (!adjusted) {
      break;
    }
    
    if (remainingD < 0) {
      throw Object.assign(new Error("subtitle_density_unsatisfiable"), { code: "subtitle_density_unsatisfiable" });
    }
  }
  
  for (let i = 0; i < n; i++) {
    if (dur[i] < 0.199 || dur[i] > 8.001) {
      throw Object.assign(new Error("subtitle_density_unsatisfiable"), { code: "subtitle_density_unsatisfiable" });
    }
  }
  
  return dur;
}

export function buildSubtitleCues({ scriptScenes, audioScenes }) {
  const allCues = [];
  const requiredSceneIds = [];
  
  const audioSceneMap = new Map(audioScenes.map(s => [s.sceneId, s]));
  
  for (const sScene of scriptScenes) {
    if (!sScene.sourceText || !sScene.sourceText.trim()) continue;
    requiredSceneIds.push(sScene.sceneId);
    
    const aScene = audioSceneMap.get(sScene.sceneId);
    if (!aScene) {
      throw new Error(`Measured audio scene missing for script scene: ${sScene.sceneId}`);
    }
    
    const D = aScene.durationSeconds;
    const sceneStart = aScene.startSeconds;
    const sceneEnd = aScene.endSeconds;
    
    let chunks = splitTextIntoCues(sScene.sourceText);
    if (chunks.length === 0) {
      chunks = [sScene.sourceText];
    }
    
    // Bounded chunk adjustment
    const minC = Math.ceil(D / 8);
    const maxC = Math.floor(D / 0.2);
    
    if (minC > maxC) {
      throw Object.assign(new Error("subtitle_density_unsatisfiable"), { code: "subtitle_density_unsatisfiable" });
    }
    
    // Split longest until >= minC
    while (chunks.length < minC) {
      let longestIdx = -1;
      let maxLen = -1;
      for (let i = 0; i < chunks.length; i++) {
        const len = graphemeLength(chunks[i]);
        if (len > maxLen) {
          maxLen = len;
          longestIdx = i;
        }
      }
      
      if (longestIdx === -1 || maxLen <= 1) {
        throw Object.assign(new Error("subtitle_density_unsatisfiable"), { code: "subtitle_density_unsatisfiable" });
      }
      
      const [p1, p2] = splitGraphemesAtMidpoint(chunks[longestIdx]);
      if (!p1 || !p2) {
        throw Object.assign(new Error("subtitle_density_unsatisfiable"), { code: "subtitle_density_unsatisfiable" });
      }
      chunks.splice(longestIdx, 1, p1, p2);
    }
    
    // Merge shortest until <= maxC
    while (chunks.length > maxC) {
      let shortestPairIdx = -1;
      let minCombinedLen = Infinity;
      for (let i = 0; i < chunks.length - 1; i++) {
        const comb = graphemeLength(chunks[i] + " " + chunks[i+1]);
        if (comb < minCombinedLen) {
          minCombinedLen = comb;
          shortestPairIdx = i;
        }
      }
      
      if (shortestPairIdx === -1) {
        throw Object.assign(new Error("subtitle_density_unsatisfiable"), { code: "subtitle_density_unsatisfiable" });
      }
      
      const merged = chunks[shortestPairIdx] + " " + chunks[shortestPairIdx+1];
      chunks.splice(shortestPairIdx, 2, merged);
    }
    
    // Allocate durations
    const graphemeCounts = chunks.map(c => graphemeLength(c));
    const dur = allocateDurations(graphemeCounts, D);
    
    let currentStart = sceneStart;
    for (let i = 0; i < chunks.length; i++) {
      const unshortenedDuration = dur[i];
      let actualDuration = unshortenedDuration;
      if (i < chunks.length - 1) {
        if (unshortenedDuration - 1/24 >= 0.2) {
          actualDuration = unshortenedDuration - 1/24;
        }
      }
      
      allCues.push({
        cueId: `cue-${aScene.segmentId}-${sScene.sceneId}-${String(i + 1).padStart(3, "0")}`,
        segmentId: aScene.segmentId,
        sceneIds: [sScene.sceneId],
        startSeconds: currentStart,
        endSeconds: currentStart + actualDuration,
        durationSeconds: actualDuration,
        text: chunks[i],
        sourceHashes: [sScene.sourceHash]
      });
      currentStart += unshortenedDuration;
    }
  }
  
  return { allCues, requiredSceneIds };
}

export function formatSrtTime(sec) {
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = Math.floor(sec % 60);
  const ms = Math.floor(Math.round((sec % 1) * 1000));
  const finalMs = ms === 1000 ? 999 : ms;
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(finalMs).padStart(3, "0")}`;
}

export function serializeSrt(cues) {
  let srt = "";
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    srt += `${i + 1}\n`;
    srt += `${formatSrtTime(cue.startSeconds)} --> ${formatSrtTime(cue.endSeconds)}\n`;
    srt += `${cue.text}\n\n`;
  }
  return srt.replace(/\r\n/g, "\n").trim() + "\n";
}

export function parseSrt(content) {
  return String(content || "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n\s*\n/g)
    .map((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      const timeIndex = lines.findIndex((line) => line.includes("-->"));
      if (timeIndex < 0) return null;
      const match = lines[timeIndex].match(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/);
      if (!match) return null;
      return {
        start: parseTime(match[1]),
        end: parseTime(match[2]),
        text: lines.slice(timeIndex + 1).join(" "),
      };
    })
    .filter(Boolean);
}

function parseTime(value) {
  const [h, m, sMs] = value.split(":");
  const [s, ms] = sMs.split(",");
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

export async function publishSubtitles({ jobDir, audioHandoff }) {
  const job = await loadJob(jobDir);
  const scriptScenesRec = job.manifest.artifacts?.find(a => a.logicalRole === "yadam.script.scenes" && a.gateStatus === "pass");
  if (!scriptScenesRec) {
    throw Object.assign(new Error("missing passed script scenes artifact"), { code: "artifact_missing" });
  }

  const scriptScenesPath = join(jobDir, scriptScenesRec.path);
  const scriptScenesData = JSON.parse(await readFile(scriptScenesPath, "utf8"));
  
  // Dependency hashes for segment SRT
  const scriptScenesHash = scriptScenesRec.sha256;
  const audioTimelineHash = audioHandoff.audioTimelineHash;
  const serializerVersionHash = sha256Bytes("serializer-v1.0.0");
  
  const dependencyHashes = {
    "yadam.script.scenes": scriptScenesHash,
    "yadam.audio.timeline": audioTimelineHash,
    "yadam.subtitle.serializer": serializerVersionHash
  };

  // Reuse check: see if current coverage exists and is valid
  const currentCoverageRec = job.manifest.artifacts?.find(a => a.logicalRole === "yadam.coverage.subtitle" && a.gateStatus === "pass");
  if (currentCoverageRec) {
    const isReusable = await canReuseArtifact(jobDir, currentCoverageRec.artifactId, dependencyHashes);
    if (isReusable) {
      const coverageReportPath = join(jobDir, "script/coverage-report.json");
      if (existsSync(coverageReportPath)) {
        const currentReport = JSON.parse(await readFile(coverageReportPath, "utf8"));
        if (currentReport.subtitleSection && currentReport.subtitleSection.sha256 === currentCoverageRec.sha256) {
          // Re-load and return without any writes
          return loadPassedSubtitleHandoff(jobDir);
        }
      }
    }
  }

  // Build cues
  const { allCues, requiredSceneIds } = buildSubtitleCues({
    scriptScenes: scriptScenesData.scenes,
    audioScenes: audioHandoff.scenes
  });

  // Semantic checks on cues
  for (let i = 0; i < allCues.length; i++) {
    const cue = allCues[i];
    if (cue.durationSeconds < 0.2 || cue.durationSeconds > 8.0) {
      throw Object.assign(new Error("subtitle_density_unsatisfiable"), { code: "subtitle_density_unsatisfiable" });
    }
    if (i > 0 && cue.startSeconds < allCues[i - 1].endSeconds - 0.001) {
      throw new Error(`Inverted or overlapping cues at index ${i}`);
    }
  }

  // Group by segment and write SRTs
  const cuesBySegment = new Map();
  for (const cue of allCues) {
    if (!cuesBySegment.has(cue.segmentId)) {
      cuesBySegment.set(cue.segmentId, []);
    }
    cuesBySegment.get(cue.segmentId).push(cue);
  }

  const segmentRefs = [];
  const orderedSegments = [...audioHandoff.segments].sort((a, b) => a.segmentId.localeCompare(b.segmentId));

  for (const segment of orderedSegments) {
    const segId = segment.segmentId;
    const segCues = cuesBySegment.get(segId) || [];
    
    // Subtract segment start time for local SRT timing
    const localCues = segCues.map(c => ({
      ...c,
      startSeconds: c.startSeconds - segment.startSeconds,
      endSeconds: c.endSeconds - segment.startSeconds
    }));

    const srtContent = serializeSrt(localCues);
    const relativeSrtPath = `compat/hermes/${segId}/subtitles.srt`;
    const absoluteSrtDir = await ensureContainedVideoDirectory(jobDir, `compat/hermes/${segId}`);
    const absoluteSrtPath = join(absoluteSrtDir, "subtitles.srt");

    // Reuse or write SRT
    const srtArtifactId = `yadam-subtitle-segment-${segId}`;
    const reuseSrt = await canReuseArtifact(jobDir, srtArtifactId, dependencyHashes);
    let srtHash;
    if (reuseSrt && existsSync(absoluteSrtPath)) {
      srtHash = sha256Bytes(await readFile(absoluteSrtPath));
    } else {
      const writeRes = await writeUtf8Atomic(absoluteSrtPath, srtContent);
      srtHash = writeRes.sha256;
      await registerArtifact(jobDir, {
        artifactId: srtArtifactId,
        logicalRole: `yadam.subtitle.segment.${segId}`,
        path: relativeSrtPath,
        sha256: srtHash,
        schemaVersion: "1.0.0",
        producerStage: "subtitle-generation",
        gateStatus: "pass",
        dependencyHashes
      });
    }

    segmentRefs.push({
      segmentId: segId,
      srtPath: relativeSrtPath,
      srtHash,
      cueIds: segCues.map(c => c.cueId)
    });
  }

  // Build coverage report
  const referencedIds = [...new Set(allCues.flatMap(c => c.sceneIds))];
  const missingSceneIds = requiredSceneIds.filter(id => !referencedIds.includes(id));
  const orphanSceneIds = referencedIds.filter(id => !requiredSceneIds.includes(id));
  
  // Text mismatch verification
  const textMismatchSceneIds = [];
  const sSceneMap = new Map(scriptScenesData.scenes.map(s => [s.sceneId, s]));
  for (const sceneId of requiredSceneIds) {
    const sScene = sSceneMap.get(sceneId);
    const sceneCues = allCues.filter(c => c.sceneIds.includes(sceneId));
    const joinedCueText = sceneCues.map(c => c.text).join(" ");
    if (normalizeSubtitleCoverageText(joinedCueText) !== normalizeSubtitleCoverageText(sScene.sourceText)) {
      textMismatchSceneIds.push(sceneId);
    }
  }

  const qualityOk = missingSceneIds.length === 0 && orphanSceneIds.length === 0 && textMismatchSceneIds.length === 0;

  const coverageReport = {
    schemaVersion: "1.0.0",
    section: "subtitle",
    subtitleRequiredSceneIds: requiredSceneIds,
    sceneIdsReferencedByAtLeastOneCue: referencedIds,
    missingSceneIds,
    orphanSceneIds,
    textMismatchSceneIds,
    qualityOk,
    status: qualityOk ? "pass" : "fail",
    artifactRefs: segmentRefs.map(s => ({ path: s.srtPath, sha256: s.srtHash })),
    dependencyHash: hashCanonical({
      scriptScenesHash,
      audioTimelineHash,
      serializerVersion: serializerVersionHash
    })
  };

  // Determine revision
  let nextRevision = 1;
  const historyRecs = job.manifest.artifacts?.filter(a => a.logicalRole === "yadam.coverage.subtitle") || [];
  if (historyRecs.length > 0) {
    // Extract max revision
    for (const r of historyRecs) {
      const match = r.path.match(/subtitle-r(\d+)\.json/);
      if (match) {
        const rev = parseInt(match[1], 10);
        if (rev >= nextRevision) nextRevision = rev + 1;
      }
    }
  }

  const coverageFilename = `script/coverage/subtitle-r${String(nextRevision).padStart(3, "0")}.json`;
  const absoluteCoveragePath = join(jobDir, coverageFilename);
  await ensureContainedVideoDirectory(jobDir, "script/coverage");

  const writeCov = await writeCanonicalJson(absoluteCoveragePath, coverageReport);
  const coverageHash = writeCov.sha256;

  await registerArtifact(jobDir, {
    artifactId: "yadam-coverage-subtitle-current",
    logicalRole: "yadam.coverage.subtitle",
    path: coverageFilename,
    sha256: coverageHash,
    schemaVersion: "1.0.0",
    producerStage: "subtitle-coverage",
    gateStatus: qualityOk ? "pass" : "fail",
    dependencyHashes: {
      ...dependencyHashes,
      ...Object.fromEntries(segmentRefs.map(s => [`srt:${s.segmentId}`, s.srtHash]))
    }
  });

  // Update script/coverage-report.json
  await updateCoverageSection({
    jobDir,
    section: "subtitle",
    report: {
      status: qualityOk ? "pass" : "fail",
      relativePath: coverageFilename,
      sha256: coverageHash,
      revision: nextRevision
    }
  });

  return loadPassedSubtitleHandoff(jobDir);
}

export async function loadPassedSubtitleHandoff(jobDir) {
  const job = await loadJob(jobDir);
  const coverageRec = job.manifest.artifacts?.find(a => a.logicalRole === "yadam.coverage.subtitle" && a.gateStatus === "pass");
  if (!coverageRec) {
    throw new Error("missing passed subtitle coverage artifact");
  }

  const coverageReportPath = join(jobDir, "script/coverage-report.json");
  if (!existsSync(coverageReportPath)) {
    throw new Error("missing script/coverage-report.json");
  }

  const currentReport = JSON.parse(await readFile(coverageReportPath, "utf8"));
  if (!currentReport.subtitleSection || currentReport.subtitleSection.sha256 !== coverageRec.sha256) {
    throw new Error("subtitle coverage mismatch in script/coverage-report.json");
  }

  const sectionPath = join(jobDir, coverageRec.path);
  const sectionContent = await readFile(sectionPath, "utf8");
  const sectionReport = JSON.parse(sectionContent);

  // Rehash and verify all SRT files referenced
  const segmentRefs = [];
  const segments = [];
  
  // Reconstruct segments and cues
  // Let's resolve the actual cues. We can load them from the script scenes and audio timeline.
  // Wait, let's load passed audio handoff to get scenes/segments
  const audioHandoffRec = job.manifest.artifacts?.find(a => a.logicalRole === "yadam.audio.timeline" && a.gateStatus === "pass");
  if (!audioHandoffRec) {
    throw new Error("missing passed audio timeline artifact");
  }
  
  const manifestRec = job.manifest.artifacts?.find(a => a.logicalRole === "yadam.audio.manifest" && a.gateStatus === "pass");
  const rpInputRec = job.manifest.artifacts?.find(a => a.logicalRole === "yadam.render_plan_input" && a.gateStatus === "pass");
  if (!manifestRec || !rpInputRec) {
    throw new Error("missing passed audio manifest or render plan input artifacts");
  }

  const manifestPath = join(jobDir, manifestRec.path);
  const timelinePath = join(jobDir, audioHandoffRec.path);
  const rpInputPath = join(jobDir, rpInputRec.path);

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const timeline = JSON.parse(await readFile(timelinePath, "utf8"));
  const rpInput = JSON.parse(await readFile(rpInputPath, "utf8"));

  const audioHandoff = {
    audioManifestPath: manifestRec.path,
    audioManifestHash: manifestRec.sha256,
    audioTimelinePath: audioHandoffRec.path,
    audioTimelineHash: audioHandoffRec.sha256,
    renderPlanInputPath: rpInputRec.path,
    renderPlanInputHash: rpInputRec.sha256,
    measuredAudioSeconds: manifest.measuredAudioSeconds,
    acceptedRangeSeconds: manifest.acceptedRangeSeconds,
    audioTempoFactor: 1,
    scenes: timeline.scenes,
    segments: timeline.segments,
    visualSlots: rpInput.visualSlots
  };

  const scriptScenesRec = job.manifest.artifacts?.find(a => a.logicalRole === "yadam.script.scenes" && a.gateStatus === "pass");
  const scriptScenesPath = join(jobDir, scriptScenesRec.path);
  const scriptScenesData = JSON.parse(await readFile(scriptScenesPath, "utf8"));

  const { allCues } = buildSubtitleCues({
    scriptScenes: scriptScenesData.scenes,
    audioScenes: audioHandoff.scenes
  });

  const cuesBySegment = new Map();
  for (const cue of allCues) {
    if (!cuesBySegment.has(cue.segmentId)) {
      cuesBySegment.set(cue.segmentId, []);
    }
    cuesBySegment.get(cue.segmentId).push(cue);
  }

  const orderedSegments = [...audioHandoff.segments].sort((a, b) => a.segmentId.localeCompare(b.segmentId));
  const handoffSegments = [];

  for (const segment of orderedSegments) {
    const segId = segment.segmentId;
    const srtArtifact = job.manifest.artifacts?.find(a => a.logicalRole === `yadam.subtitle.segment.${segId}` && a.gateStatus === "pass");
    if (!srtArtifact) {
      throw new Error(`missing subtitle segment artifact for ${segId}`);
    }
    
    const absPath = join(jobDir, srtArtifact.path);
    const content = await readFile(absPath);
    const h = sha256Bytes(content);
    if (h.toLowerCase() !== srtArtifact.sha256.toLowerCase()) {
      throw new Error(`SRT file hash mismatch for ${segId}`);
    }

    // Verify it parses correctly
    const parsed = parseSrt(content.toString("utf8"));
    const segCues = cuesBySegment.get(segId) || [];
    if (parsed.length !== segCues.length) {
      throw new Error(`SRT cue count mismatch for ${segId}`);
    }

    handoffSegments.push({
      segmentId: segId,
      srtPath: srtArtifact.path,
      srtHash: srtArtifact.sha256,
      cueIds: segCues.map(c => c.cueId)
    });
  }

  const subtitleSetHash = hashCanonical({
    subtitleCoverageHash: coverageRec.sha256,
    segments: handoffSegments,
    cues: allCues.sort((a, b) => a.startSeconds - b.startSeconds || a.cueId.localeCompare(b.cueId))
  });

  return {
    coverageReportPath: coverageRec.path,
    coverageReportHash: coverageRec.sha256,
    subtitleCoveragePath: coverageRec.path,
    subtitleCoverageHash: coverageRec.sha256,
    subtitleCoverageRevision: currentReport.subtitleSection.revision,
    subtitleSetHash,
    segments: handoffSegments,
    cues: allCues
  };
}
