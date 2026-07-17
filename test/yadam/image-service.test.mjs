import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hashCanonical } from "../../scripts/lib/pipeline/canonical-json.mjs";
import { writeProvisionalReferenceSet, loadReferencePointer, promoteApprovedReferenceSet } from "../../scripts/lib/yadam/images/reference-store.mjs";

test("approval promotes a pointer without changing reference pixels or set hash", async () => {
  const jobDir = await mkdtemp(join(tmpdir(), "reference-set-"));
  await mkdir(join(jobDir, "assets", "character-references"), { recursive: true });
  const primaryPath = join(jobDir, "assets", "character-references", "primary.png");
  await writeFile(primaryPath, Buffer.from("approved-pixels"));
  await writeFile(join(jobDir, "artifact-manifest.json"), JSON.stringify({ schemaVersion: "1.0.0", jobId: "job-001", artifacts: [] }));
  
  const reference = {
    characterId: "char-1",
    variantId: "base",
    appearanceAnchors: ["round face"],
    wardrobeAnchors: ["blue hanbok"],
    primaryPath,
    primarySha256: "a95a889d40c037699a5336e59b3b7df6785a5c33d6ab8c54b1209f23b205a10c", // approved-pixels sha256
    width: 768,
    height: 1024,
    seed: 7,
    checkpointHash: "a".repeat(64),
    workflowHash: "b".repeat(64),
    compiledRequestId: "compiled-image-request-ref-char-1-base-primary",
    compiledRequestHash: "c".repeat(64),
    derived: []
  };

  const semanticHash = hashCanonical([{ characterId: reference.characterId, variantId: reference.variantId, appearanceAnchors: reference.appearanceAnchors, wardrobeAnchors: reference.wardrobeAnchors }]);
  const provisional = await writeProvisionalReferenceSet({
    jobDir,
    jobId: "job-001",
    revision: 1,
    createdAt: "2026-07-16T00:00:00.000Z",
    references: [reference],
    dependencies: {
      storyBibleHash: "d".repeat(64),
      semanticHash,
      referenceWorkflowHash: reference.workflowHash,
      conditionedWorkflowHash: "e".repeat(64),
      checkpointHash: reference.checkpointHash,
      clipVisionHash: "f".repeat(64),
      ipAdapterHash: "1".repeat(64)
    }
  });

  const before = await readFile(primaryPath);
  const approvalRevisionPath = "approvals/approval-2-r001.json";
  const approvalPath = join(jobDir, approvalRevisionPath);
  await mkdir(join(jobDir, "approvals"), { recursive: true });
  
  const mockApproval = {
    revision: 1,
    approvedArtifactSetHash: "0".repeat(64),
    artifacts: [
      { logicalRole: "yadam.character.reference-set", sha256: provisional.referenceSetHash }
    ]
  };
  await writeFile(approvalPath, JSON.stringify(mockApproval));

  const approved = await promoteApprovedReferenceSet({ jobDir, approvalRevisionPath });
  assert.equal(approved.referenceSetHash, provisional.referenceSetHash);
  assert.equal((await loadReferencePointer(jobDir)).status, "approved");
  assert.deepEqual(await readFile(primaryPath), before);
});
