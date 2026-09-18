import { describe, expect, it } from "vitest";
import { InMemoryAssuranceAuditStore } from "./assurance-audit.js";

describe("AssuranceAuditRecord", () => {
  it("retains non-sensitive provenance and strips raw rows, credentials and reasoning", () => {
    const store = new InMemoryAssuranceAuditStore();
    const record = store.append({
      taskId: "task-1",
      queryArtifactId: "artifact-1",
      sqlHash: "sql-1",
      specVersion: "spec-1",
      schemaEvidenceFingerprint: "schema-1",
      semanticEvidenceFingerprint: "semantic-1",
      queryDigestVersion: "digest-1",
      reviewerModel: "model-1",
      reviewerPromptVersion: "prompt-1",
      reviewPolicyVersion: "policy-1",
      reviewAvailability: "available",
      decision: "abstained",
      decisionReason: "REVIEW_DIFF_EVIDENCE_INSUFFICIENT",
      reviewWarnings: ["Reviewer diff could not be bound to canonical evidence"],
      coverage: { projection: "checked" },
      semanticDiffs: [],
      repairAttempt: 0,
      publicationStatus: "published_with_disagreement",
      reviewMode: "shadow",
      latencyMs: 10,
      tokens: 20,
      cost: 0.01,
      rawRows: [["secret"]],
      credentials: "password",
      reasoning: "hidden chain of thought",
    } as any);

    expect(record).toMatchObject({
      taskId: "task-1",
      decision: "abstained",
      semanticEvidenceFingerprint: "semantic-1",
      decisionReason: "REVIEW_DIFF_EVIDENCE_INSUFFICIENT",
      reviewWarnings: ["Reviewer diff could not be bound to canonical evidence"],
      publicationStatus: "published_with_disagreement",
    });
    expect(record).not.toHaveProperty("rawRows");
    expect(record).not.toHaveProperty("credentials");
    expect(record).not.toHaveProperty("reasoning");
    expect(store.list()).toHaveLength(1);
  });
});
