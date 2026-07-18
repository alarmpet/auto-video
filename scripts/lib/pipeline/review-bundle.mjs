import { join, resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { loadJob } from "./job-store.mjs";
import { hashCanonical, sha256Bytes, canonicalJson } from "./canonical-json.mjs";
import { writeCanonicalJsonExclusive } from "./atomic-store.mjs";

export async function renderReviewBundle({ jobDir, gate }) {
  const resolvedJobDir = resolve(jobDir);
  const job = await loadJob(resolvedJobDir);
  const { manifest } = job;

  const slug = gate.replaceAll("_", "-");

  // Determine next revision number NNN
  const reviewsDir = join(resolvedJobDir, "reviews");
  await mkdir(reviewsDir, { recursive: true });

  let nextRev = 1;
  const files = await readdir(reviewsDir);
  const pattern = new RegExp(`^${slug}-r(\\d+)\\.md$`);
  for (const file of files) {
    const match = file.match(pattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num >= nextRev) {
        nextRev = num + 1;
      }
    }
  }

  const revisionStr = String(nextRev).padStart(3, "0");
  const bundleFilename = `reviews/${slug}-r${revisionStr}.md`;
  const indexFilename = `reviews/${slug}-index-r${revisionStr}.json`;

  const absoluteBundlePath = join(resolvedJobDir, bundleFilename);
  const absoluteIndexPath = join(resolvedJobDir, indexFilename);

  // Load stage-required inputs and compute sourceSetHash
  let sourceSetHash = "0".repeat(64);
  let mdContent = `# Human Review Bundle for Gate: ${gate}\n\n`;

  if (gate === "concept_selection") {
    const optsArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.concept.options" && a.gateStatus === "pass");
    const optsHash = optsArt ? optsArt.sha256 : "0".repeat(64);
    sourceSetHash = hashCanonical({ optionsHash: optsHash });
    mdContent += `## Concept Options\n- Artifact SHA-256: ${optsHash}\n`;
  } else if (gate === "approval_1") {
    const bundleArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.approval.1.bundle" && a.gateStatus === "pass");
    const selectionArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.concept.selection" && a.gateStatus === "pass");
    const briefArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.hook.brief" && a.gateStatus === "pass");
    const outlineArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.outline" && a.gateStatus === "pass");

    sourceSetHash = hashCanonical({
      bundleHash: bundleArt?.sha256 || "0".repeat(64),
      selectionHash: selectionArt?.sha256 || "0".repeat(64),
      briefHash: briefArt?.sha256 || "0".repeat(64),
      outlineHash: outlineArt?.sha256 || "0".repeat(64)
    });
    mdContent += `## Approval 1 Inputs\n`;
    mdContent += `- Bundle SHA-256: ${bundleArt?.sha256 || "N/A"}\n`;
    mdContent += `- Selection SHA-256: ${selectionArt?.sha256 || "N/A"}\n`;
    mdContent += `- Brief SHA-256: ${briefArt?.sha256 || "N/A"}\n`;
    mdContent += `- Outline SHA-256: ${outlineArt?.sha256 || "N/A"}\n`;
  } else if (gate === "thumbnail_copy_selection") {
    const tPlanArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.thumbnail.plan" && a.gateStatus === "pass");
    const tPlanHash = tPlanArt ? tPlanArt.sha256 : "0".repeat(64);
    sourceSetHash = hashCanonical({ optionsHash: tPlanHash });
    mdContent += `## Thumbnail Options\n- Artifact SHA-256: ${tPlanHash}\n`;
  } else if (gate === "approval_2") {
    const bundleArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.approval.2.bundle" && a.gateStatus === "pass");
    const finalTextArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.script.final_text" && a.gateStatus === "pass");
    const scenesArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.script.scenes" && a.gateStatus === "pass");
    const scenePlanArt = manifest.artifacts?.find(a => a.logicalRole === "yadam.scene.plan" && a.gateStatus === "pass");

    sourceSetHash = hashCanonical({
      bundleHash: bundleArt?.sha256 || "0".repeat(64),
      finalTextHash: finalTextArt?.sha256 || "0".repeat(64),
      scenesHash: scenesArt?.sha256 || "0".repeat(64),
      scenePlanHash: scenePlanArt?.sha256 || "0".repeat(64)
    });
    mdContent += `## Approval 2 Inputs\n`;
    mdContent += `- Bundle SHA-256: ${bundleArt?.sha256 || "N/A"}\n`;
    mdContent += `- Final Text SHA-256: ${finalTextArt?.sha256 || "N/A"}\n`;
    mdContent += `- Scenes SHA-256: ${scenesArt?.sha256 || "N/A"}\n`;
    mdContent += `- Scene Plan SHA-256: ${scenePlanArt?.sha256 || "N/A"}\n`;
  }

  // Write bundle file exclusively/atomically
  writeFileSync(absoluteBundlePath, mdContent);
  const bundleHash = sha256Bytes(readFileSync(absoluteBundlePath));

  const indexPayload = {
    schemaVersion: "1.0.0",
    gate,
    revision: nextRev,
    bundlePath: bundleFilename,
    bundleHash,
    sourceSetHash
  };

  await writeCanonicalJsonExclusive(absoluteIndexPath, indexPayload);

  return {
    bundlePath: bundleFilename,
    bundleHash,
    indexPath: indexFilename
  };
}
