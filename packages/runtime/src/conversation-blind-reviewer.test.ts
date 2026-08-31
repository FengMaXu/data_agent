import { describe, expect, it } from "vitest";
import { createConversationBlindReviewer, deriveReviewCoverageRequirements, REVIEW_COVERAGE_FACETS, type ConversationBlindReviewerInput } from "./conversation-blind-reviewer.js";
import { createAnswerSpec } from "./answer-spec.js";
import { buildResultEvidence } from "./result-evidence.js";

const input: ConversationBlindReviewerInput = {
  question: "List customers",
  clarifications: [],
  answerSpec: { taskId: "task-1", specVersion: "1", question: "List customers", hardConstraints: [], hypotheses: [], ambiguities: [], provenance: [] },
  schema: { connectionId: "connection-1", dialect: "sqlite", tables: [] },
  sql: "SELECT customer_id, SUM(amount) AS revenue FROM orders GROUP BY customer_id ORDER BY revenue DESC LIMIT 3",
  digest: { normalizedSql: "SELECT customer_id, SUM(amount) AS revenue FROM orders GROUP BY customer_id ORDER BY revenue DESC LIMIT 3", normalizedSqlHash: "hash", dialect: "sqlite", parserVersion: "p", queryDigestVersion: "1", schemaEvidenceFingerprint: "schema", sources: [], joins: [], filters: [], measures: [], groupBy: [], projections: [], outputLineage: [], windows: [], orderBy: [], setOperations: [], nullHandling: [], coverage: {}, unsupportedNodes: [], lineageCompleteness: "complete" },
  resultMetadata: { columns: ["customer_id", "revenue"], columnTypes: ["TEXT", "REAL"], rowCount: 3, truncated: false, nullCounts: { customer_id: 0, revenue: 0 } },
};

function notApplicableCoverage(): Record<string, { status: "not_applicable" }> {
  return Object.fromEntries(REVIEW_COVERAGE_FACETS.map((facet) => [facet, { status: "not_applicable" }]));
}

const projectedInput: ConversationBlindReviewerInput = {
  ...input,
  digest: {
    ...input.digest,
    projections: [{ output: "answer", expression: "1" }],
    outputLineage: [{ output: "answer", expression: "1", columns: [] }],
  },
};

function projectedCoverage(status: "checked" | "unsupported" = "checked") {
  return {
    ...notApplicableCoverage(),
    projection: status === "checked"
      ? { status, evidence: [{ digestPath: "projections[0].output" }] }
      : { status },
  };
}

describe("ConversationBlindReviewer", () => {
  it("sends only the declared evidence envelope with a fresh zero-temperature context", async () => {
    let received: unknown;
    let options: unknown;
    const reviewer = createConversationBlindReviewer({
      complete: async (candidate, completeOptions) => {
        received = candidate;
        options = completeOptions;
        return { status: "approved", coverage: notApplicableCoverage() };
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

    const invalidDiff = createConversationBlindReviewer({ complete: async () => ({ status: "rejected", diffs: [{ aspect: "grain", required: "one", observed: "many" }], coverage: notApplicableCoverage() }) });
    await expect(invalidDiff.review(input, new AbortController().signal)).rejects.toThrow("REVIEW_DIFF_EVIDENCE_REQUIRED");
  });

  it("retries one malformed response as infrastructure work and accepts the next valid response", async () => {
    let calls = 0;
    const reviewer = createConversationBlindReviewer({
      complete: async () => {
        calls += 1;
        return calls === 1 ? { status: "approved", extra: true } : { status: "approved", coverage: notApplicableCoverage() };
      },
    });
    await expect(reviewer.review(input, new AbortController().signal)).resolves.toMatchObject({ status: "approved" });
    expect(calls).toBe(2);
  });

  it("bounds a hung reviewer request without retrying the timeout", async () => {
    let calls = 0;
    const reviewer = createConversationBlindReviewer({
      complete: async (_candidate, _options, signal) => {
        calls += 1;
        await new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("provider aborted")), { once: true }));
      },
    }, { timeoutMs: 10 });

    await expect(reviewer.review(input, new AbortController().signal)).rejects.toThrow("REVIEW_TIMEOUT");
    expect(calls).toBe(1);
  });

  it("turns approved output with unsupported coverage into Abstained", async () => {
    const reviewer = createConversationBlindReviewer({ complete: async () => ({ status: "approved", coverage: projectedCoverage("unsupported") }) });
    await expect(reviewer.review(projectedInput, new AbortController().signal)).resolves.toMatchObject({ status: "abstained", reason: "REVIEW_COVERAGE_INSUFFICIENT" });
  });

  it("requires complete coverage and deterministic evidence for checked facets", async () => {
    let received: any;
    const reviewer = createConversationBlindReviewer({ complete: async (candidate) => {
      received = candidate;
      return { status: "approved", coverage: projectedCoverage() };
    } });
    await expect(reviewer.review(projectedInput, new AbortController().signal)).resolves.toMatchObject({ status: "approved", coverage: { projection: { status: "checked", evidence: [{ digestPath: "projections[0].output" }] } } });
    expect(received.coverageRequirements.find((item: any) => item.facet === "projection")).toMatchObject({ required: true });
    expect(received.coverageRequirements.find((item: any) => item.facet === "join_cardinality")).toMatchObject({ required: false });

    const missingEvidence = createConversationBlindReviewer({ complete: async () => ({ status: "approved", coverage: { ...projectedCoverage(), projection: { status: "checked" } } }) });
    await expect(missingEvidence.review(projectedInput, new AbortController().signal)).rejects.toThrow("REVIEW_COVERAGE_EVIDENCE_REQUIRED:projection");
  });

  it("drops stale optional spec citations without retrying a valid Digest citation", async () => {
    const coverage = {
      ...projectedCoverage(),
      projection: { status: "checked" as const, evidence: [{ digestPath: "projections[0].output", specPath: "answerContract.output.value.columns" }] },
    };
    const reviewer = createConversationBlindReviewer({ complete: async () => ({ status: "approved", coverage }) });
    const decision = await reviewer.review(projectedInput, new AbortController().signal);
    expect(decision.coverage?.projection).toMatchObject({ status: "checked", evidence: [{ digestPath: "projections[0].output" }] });
    expect(decision.coverage?.projection).not.toHaveProperty("evidence[0].specPath");
  });

  it("does not allow the reviewer or caller to change Digest applicability", async () => {
    const reviewer = createConversationBlindReviewer({ complete: async () => ({ status: "abstained", reason: "not enough evidence", coverage: { ...projectedCoverage(), projection: { status: "not_applicable" } } }) });
    await expect(reviewer.review(projectedInput, new AbortController().signal)).rejects.toThrow("REVIEW_COVERAGE_APPLICABILITY_MISMATCH:projection");
    const forgedRequirements = projectedInput.digest ? {
      ...projectedInput,
      coverageRequirements: deriveReviewCoverageRequirements(input).map((requirement) => ({ ...requirement, required: false })),
    } : projectedInput;
    const forgedReviewer = createConversationBlindReviewer({ complete: async () => ({ status: "abstained", reason: "not enough evidence", coverage: { ...projectedCoverage(), projection: { status: "not_applicable" } } }) });
    await expect(forgedReviewer.review(forgedRequirements, new AbortController().signal)).rejects.toThrow("REVIEW_COVERAGE_APPLICABILITY_MISMATCH:projection");
  });

  it("marks diffs against hypothesis-only contract fields as non-blocking", async () => {
    const softInput: ConversationBlindReviewerInput = {
      ...projectedInput,
      answerSpec: createAnswerSpec({
        taskId: "task-1",
        question: "List customers",
        answerContract: { output: { value: { columns: ["answer"] }, authority: "model_inference", source: "planner" } },
      }),
    };
    const reviewer = createConversationBlindReviewer({ complete: async () => ({
      status: "rejected",
      coverage: projectedCoverage(),
      diffs: [{ aspect: "projection", required: "answer", observed: "actual", evidence: { specPath: "answerContract.output.value.columns", digestPath: "projections[0].output" } }],
    }) });
    await expect(reviewer.review(softInput, new AbortController().signal)).resolves.toMatchObject({ status: "rejected", blocking: false, diffs: [{ blocking: false }] });
  });

  it("requires complete numeric evidence before approving an aggregate review", async () => {
    const aggregateInput: ConversationBlindReviewerInput = {
      ...input,
      question: "What is the total revenue?",
      answerSpec: createAnswerSpec({ taskId: "task-1", question: "What is the total revenue?" }),
      digest: {
        ...input.digest,
        sources: [{ name: "orders" }],
        measures: [{ function: "SUM", expression: "amount", output: "revenue" }],
        projections: [{ output: "revenue", expression: "SUM(amount)" }],
        outputLineage: [{ output: "revenue", expression: "SUM(amount)", columns: ["amount"] }],
        coverage: { sources: "checked", measures: "checked", projections: "checked", outputLineage: "checked" },
      },
      resultMetadata: {
        columns: ["revenue"],
        columnTypes: ["REAL"],
        rowCount: 1,
        truncated: false,
        nullCounts: { revenue: 0 },
        resultEvidence: buildResultEvidence(["revenue"], [[42]], false),
      },
    };
    const requirements = deriveReviewCoverageRequirements(aggregateInput);
    const coverage = Object.fromEntries(requirements.map((requirement) => [requirement.facet, requirement.required
      ? { status: "checked", evidence: [{ digestPath: requirement.digestPaths[0], ...(requirement.facet === "result_values" ? { resultPath: "resultEvidence.numericRows" } : {}) }] }
      : { status: "not_applicable" }]));
    const reviewer = createConversationBlindReviewer({ complete: async () => ({ status: "approved", coverage }) });
    await expect(reviewer.review(aggregateInput, new AbortController().signal)).resolves.toMatchObject({ status: "approved" });

    const incomplete = createConversationBlindReviewer({ complete: async () => ({ status: "approved", coverage: { ...coverage, result_values: { status: "checked", evidence: [{ digestPath: "measures[0].function" }] } } }) });
    await expect(incomplete.review(aggregateInput, new AbortController().signal)).rejects.toThrow("REVIEW_COVERAGE_RESULT_EVIDENCE_INSUFFICIENT");
  });

  it("returns abstained when the reviewer lacks evidence instead of approving", async () => {
    const reviewer = createConversationBlindReviewer({ complete: async () => ({ status: "abstained", reason: "unsupported SQL", coverage: projectedCoverage("unsupported") }) });
    await expect(reviewer.review(projectedInput, new AbortController().signal)).resolves.toMatchObject({ status: "abstained", coverage: { projection: { status: "unsupported" } } });
  });
});
