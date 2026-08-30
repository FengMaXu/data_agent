import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExportCandidateStore, type ExportCandidate } from "./export-candidate.js";
import { PublicationRegistry, type PublicationAuthorization } from "./publication.js";
import { WorkspaceStore } from "./workspace.js";

const candidate = (id: string): ExportCandidate => ({
  candidateId: id,
  taskId: "task-1",
  queryArtifactId: "artifact-1",
  path: `.query-assurance/candidates/${id}.csv`,
  metadata: { columns: ["answer"], columnTypes: ["INTEGER"], rowCount: 1, truncated: false, nullCounts: { answer: 0 } },
  createdAt: "2026-01-01T00:00:00.000Z",
});

const approved = { availability: "available", decision: { status: "approved", coverage: { projection: "checked" } } } as const;
const unavailable = { availability: "unavailable", failure: { code: "REVIEW_OFF", message: "disabled", retryable: false } } as const;

describe("PublicationRegistry", () => {
  it("binds a single-use Review Token to the candidate and returns an idempotent Receipt", async () => {
    const registry = new PublicationRegistry({ mode: "shadow", specVersionFor: () => "spec-1" });
    const token = registry.issueToken({ taskId: "task-1", queryArtifactId: "artifact-1", normalizedSqlHash: "sql-1", specVersion: "spec-1", schemaEvidenceFingerprint: "schema-1", candidate: candidate("candidate-1"), outcome: approved });
    const receipts = await Promise.all([
      registry.publish(token, candidate("candidate-1"), "exports/result.csv"),
      registry.publish(token, candidate("candidate-1"), "exports/result.csv"),
    ]);

    expect(receipts[0]).toEqual(receipts[1]);
    expect(receipts[0]).toMatchObject({ status: "published_approved", taskId: "task-1", queryArtifactId: "artifact-1", candidateId: "candidate-1" });
    await expect(registry.publish(token, candidate("candidate-1"), "exports/other.csv")).resolves.toEqual(receipts[0]);
    await expect(registry.publish(token, candidate("candidate-2"), "exports/other.csv")).rejects.toThrow("REVIEW_TOKEN_CANDIDATE_MISMATCH");
  });

  it("does not publish an unavailable review in enforce mode and does publish it as disagreement in shadow mode", async () => {
    const enforce = new PublicationRegistry({ mode: "enforce", specVersionFor: () => "spec-1" });
    const shadow = new PublicationRegistry({ mode: "shadow", specVersionFor: () => "spec-1" });
    const tokenInput = { taskId: "task-1", queryArtifactId: "artifact-1", normalizedSqlHash: "sql-1", specVersion: "spec-1", schemaEvidenceFingerprint: "schema-1", candidate: candidate("candidate-1"), outcome: unavailable };
    const enforceToken = enforce.issueToken(tokenInput);
    await expect(enforce.publish(enforceToken, candidate("candidate-1"), "exports/result.csv")).rejects.toThrow("REVIEW_UNAVAILABLE");
    const shadowToken = shadow.issueToken(tokenInput);
    await expect(shadow.publish(shadowToken, candidate("candidate-1"), "exports/result.csv")).resolves.toMatchObject({ status: "published_with_disagreement" });
  });

  it("rejects changed candidates and spec versions", async () => {
    const registry = new PublicationRegistry({ mode: "shadow", specVersionFor: () => "spec-2" });
    const token = registry.issueToken({ taskId: "task-1", queryArtifactId: "artifact-1", normalizedSqlHash: "sql-1", specVersion: "spec-1", schemaEvidenceFingerprint: "schema-1", candidate: candidate("candidate-1"), outcome: approved });
    await expect(registry.publish(token, candidate("candidate-1"), "exports/result.csv")).rejects.toThrow("REVIEW_TOKEN_SPEC_STALE");

    const fresh = new PublicationRegistry({ mode: "shadow", specVersionFor: () => "spec-1" });
    const freshToken = fresh.issueToken({ taskId: "task-1", queryArtifactId: "artifact-1", normalizedSqlHash: "sql-1", specVersion: "spec-1", schemaEvidenceFingerprint: "schema-1", candidate: candidate("candidate-1"), outcome: approved });
    await expect(fresh.publish(freshToken, candidate("candidate-2"), "exports/result.csv")).rejects.toThrow("REVIEW_TOKEN_CANDIDATE_MISMATCH");
  });

  it("can atomically publish the exact candidate through ExportCandidateStore", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-receipt-"));
    const workspace = new WorkspaceStore(root);
    const candidates = new ExportCandidateStore(workspace);
    const stored = await candidates.create({ taskId: "task-1", queryArtifactId: "artifact-1", batches: (async function* () { yield { columns: ["answer"], rows: [[1]] }; })() });
    const registry = new PublicationRegistry({ mode: "shadow", specVersionFor: () => "spec-1", publishCandidate: (value, target) => candidates.publish(value, target) });
    const token = registry.issueToken({ taskId: "task-1", queryArtifactId: "artifact-1", normalizedSqlHash: "sql-1", specVersion: "spec-1", schemaEvidenceFingerprint: "schema-1", candidate: stored, outcome: approved });
    try {
      const receipt = await registry.publish(token, stored, "exports/result.csv");
      expect(receipt.receiptId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(await readFile(join(root, "exports/result.csv"), "utf8")).toBe("answer\n1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
