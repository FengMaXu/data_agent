import { describe, expect, it } from "vitest";
import { createConversationBlindReviewer, REVIEW_COVERAGE_FACETS, type ConversationBlindReviewerInput } from "./conversation-blind-reviewer.js";

const input: ConversationBlindReviewerInput = {
  question: "Top customers by revenue",
  clarifications: [],
  answerSpec: { taskId: "task-1", specVersion: "1", question: "Top customers by revenue", hardConstraints: [], hypotheses: [], ambiguities: [], provenance: [] },
  schema: { connectionId: "connection-1", dialect: "sqlite", tables: [] },
  sql: "SELECT customer_id, SUM(amount) AS revenue FROM orders GROUP BY customer_id ORDER BY revenue DESC LIMIT 3",
  digest: { normalizedSql: "SELECT customer_id, SUM(amount) AS revenue FROM orders GROUP BY customer_id ORDER BY revenue DESC LIMIT 3", normalizedSqlHash: "hash", dialect: "sqlite", parserVersion: "p", queryDigestVersion: "1", schemaEvidenceFingerprint: "schema", sources: [], joins: [], filters: [], measures: [], groupBy: [], projections: [], outputLineage: [], windows: [], orderBy: [], setOperations: [], nullHandling: [], coverage: {}, unsupportedNodes: [], lineageCompleteness: "complete" },
  resultMetadata: { columns: ["customer_id", "revenue"], columnTypes: ["TEXT", "REAL"], rowCount: 3, truncated: false, nullCounts: { customer_id: 0, revenue: 0 } },
};

describe("ConversationBlindReviewer", () => {
  it("sends only the declared evidence envelope with a fresh zero-temperature context", async () => {
    let received: unknown;
    let options: unknown;
    const reviewer = createConversationBlindReviewer({
      complete: async (candidate, completeOptions) => {
        received = candidate;
        options = completeOptions;
        return { status: "approved", coverage: Object.fromEntries(REVIEW_COVERAGE_FACETS.map((facet) => [facet, "checked"])) };
      },
    });

    const decision = await reviewer.review({ ...input, conversation: "solver reasoning", gold: "answer" } as ConversationBlindReviewerInput & { conversation: string; gold: string }, new AbortController().signal);

    expect(decision).toMatchObject({ status: "approved" });
    expect(options).toEqual({ freshContext: true, temperature: 0 });
    expect(received).not.toHaveProperty("conversation");
    expect(received).not.toHaveProperty("gold");
    expect(REVIEW_COVERAGE_FACETS).toContain("grain");
  });

  it("rejects unknown fields and evidence-free Semantic Diffs", async () => {
    const unknown = createConversationBlindReviewer({ complete: async () => ({ status: "approved", coverage: {}, extra: true }) });
    await expect(unknown.review(input, new AbortController().signal)).rejects.toThrow("REVIEW_RESPONSE_UNKNOWN_FIELD");

    const invalidDiff = createConversationBlindReviewer({ complete: async () => ({ status: "rejected", diffs: [{ aspect: "grain", required: "one", observed: "many" }], coverage: {} }) });
    await expect(invalidDiff.review(input, new AbortController().signal)).rejects.toThrow("REVIEW_DIFF_EVIDENCE_REQUIRED");
  });

  it("retries one malformed response as infrastructure work and accepts the next valid response", async () => {
    let calls = 0;
    const reviewer = createConversationBlindReviewer({
      complete: async () => {
        calls += 1;
        return calls === 1 ? { status: "approved", extra: true } : { status: "approved", coverage: { projection: "checked" } };
      },
    });
    await expect(reviewer.review(input, new AbortController().signal)).resolves.toMatchObject({ status: "approved" });
    expect(calls).toBe(2);
  });

  it("returns abstained when the reviewer lacks evidence instead of approving", async () => {
    const reviewer = createConversationBlindReviewer({ complete: async () => ({ status: "abstained", reason: "unsupported SQL", coverage: { grain: "unsupported" } }) });
    await expect(reviewer.review(input, new AbortController().signal)).resolves.toMatchObject({ status: "abstained", coverage: { grain: "unsupported" } });
  });
});
