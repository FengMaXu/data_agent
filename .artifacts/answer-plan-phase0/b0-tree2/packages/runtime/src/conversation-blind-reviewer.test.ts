import { describe, expect, it } from "vitest";
import { createConversationBlindReviewer, deriveReviewCoverageRequirements, REVIEW_COVERAGE_FACETS, validateReviewDecision, type ConversationBlindReviewerInput } from "./conversation-blind-reviewer.js";
import { createAnswerSpec } from "./answer-spec.js";
import { buildResultEvidence } from "./result-evidence.js";

const input: ConversationBlindReviewerInput = {
  question: "List customers",
  clarifications: [],
  answerSpec: { taskId: "task-1", specVersion: "1", question: "List customers", hardConstraints: [], hypotheses: [], ambiguities: [], provenance: [] },
  schema: { connectionId: "connection-1", dialect: "sqlite", tables: [] },
  sql: "SELECT customer_id, SUM(amount) AS revenue FROM orders GROUP BY customer_id ORDER BY revenue DESC LIMIT 3",
  digest: { normalizedSql: "SELECT customer_id, SUM(amount) AS revenue FROM orders GROUP BY customer_id ORDER BY revenue DESC LIMIT 3", normalizedSqlHash: "hash", dialect: "sqlite", parserVersion: "p", parserEngine: "sqlglot", queryDigestVersion: "1", schemaEvidenceFingerprint: "schema", sources: [], joins: [], filters: [], measures: [], groupBy: [], projections: [], outputLineage: [], windows: [], orderBy: [], setOperations: [], nullHandling: [], coverage: {}, unsupportedNodes: [], lineageCompleteness: "complete" },
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
  resultMetadata: {
    columns: ["answer"],
    columnTypes: ["INTEGER"],
    rowCount: 1,
    truncated: false,
    nullCounts: { answer: 0 },
    resultEvidence: buildResultEvidence(["answer"], [[1]], false),
  },
};

function projectedCoverage(status: "checked" | "unsupported" = "checked") {
  return {
    ...notApplicableCoverage(),
    projection: status === "checked"
      ? { status, evidence: [{ digestPath: "projections[0].output" }] }
      : { status },
    result_values: { status: "checked" as const },
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

  it("rejects unknown top-level response fields", async () => {
    const unknown = createConversationBlindReviewer({ complete: async () => ({ status: "approved", coverage: {}, extra: true }) });
    await expect(unknown.review(input, new AbortController().signal)).rejects.toThrow("REVIEW_RESPONSE_UNKNOWN_FIELD");

    const unknownCoverage = createConversationBlindReviewer({ complete: async () => ({ status: "approved", coverage: { ...projectedCoverage(), bogusFacet: "checked" } }) });
    await expect(unknownCoverage.review(projectedInput, new AbortController().signal)).rejects.toThrow("REVIEW_COVERAGE_UNKNOWN_FACET");
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

  it("fails closed when approved output carries a non-empty diff", async () => {
    const reviewer = createConversationBlindReviewer({ complete: async () => ({
      status: "approved",
      coverage: projectedCoverage(),
      diffs: [{ aspect: "projection", required: "customer", observed: "constant", evidence: { questionQuote: "List customers", digestPath: "projections[0].output" } }],
    }) });

    await expect(reviewer.review({ ...projectedInput, question: "List customers" }, new AbortController().signal)).resolves.toMatchObject({
      status: "abstained",
      reason: "REVIEW_APPROVED_WITH_DIFFS",
    });
  });

  it("fails closed for a direct reviewer adapter with a non-array diff payload", () => {
    const decision = validateReviewDecision({ status: "approved", coverage: projectedCoverage(), diffs: { length: 0 } } as never, projectedInput);
    expect(decision).toMatchObject({ status: "abstained", reason: "REVIEW_APPROVED_WITH_DIFFS" });
  });

  it("normalizes the common semanticDiffs response alias without retrying", async () => {
    let calls = 0;
    const reviewer = createConversationBlindReviewer({ complete: async () => {
      calls += 1;
      return { status: "approved", coverage: projectedCoverage(), semanticDiffs: [] };
    } });

    await expect(reviewer.review(projectedInput, new AbortController().signal)).resolves.toMatchObject({ status: "approved" });
    expect(calls).toBe(1);
  });

  it("degrades an unevidenced rejected diff to Abstained without retrying", async () => {
    let calls = 0;
    const reviewer = createConversationBlindReviewer({ complete: async () => {
      calls += 1;
      return {
        status: "rejected",
        coverage: projectedCoverage(),
        semanticDiffs: [{ specPath: "/answerContract", digestPath: "/projections", diff: "The requested output may be absent" }],
      };
    } });

    await expect(reviewer.review(projectedInput, new AbortController().signal)).resolves.toMatchObject({
      status: "abstained",
      reason: "REVIEW_DIFF_EVIDENCE_INSUFFICIENT:REVIEW_DIFF_EVIDENCE_REQUIRED",
    });
    expect(calls).toBe(1);
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

  it("canonicalizes checked coverage to Runtime-owned Digest evidence without retrying", async () => {
    let received: any;
    let calls = 0;
    const reviewer = createConversationBlindReviewer({ complete: async (candidate) => {
      calls += 1;
      received = candidate;
      return {
        status: "approved",
        coverage: {
          ...projectedCoverage(),
          projection: { status: "checked", evidence: "projections[99].invented" },
        },
      };
    } });

    await expect(reviewer.review(projectedInput, new AbortController().signal)).resolves.toMatchObject({
      status: "approved",
      coverage: { projection: { status: "checked", evidence: [{ digestPath: "projections[0].output" }] } },
    });
    expect(calls).toBe(1);
    expect(received.coverageRequirements.find((item: any) => item.facet === "projection")).toMatchObject({ required: true });
    expect(received.coverageRequirements.find((item: any) => item.facet === "join_cardinality")).toMatchObject({ required: false });
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
    let calls = 0;
    const reviewer = createConversationBlindReviewer({ complete: async () => {
      calls += 1;
      return { status: "abstained", reason: "not enough evidence", coverage: { ...projectedCoverage(), projection: { status: "not_applicable" } } };
    } });
    await expect(reviewer.review(projectedInput, new AbortController().signal)).resolves.toMatchObject({
      status: "abstained",
      coverage: { projection: { status: "insufficient_evidence" } },
    });
    expect(calls).toBe(1);

    const forgedRequirements = projectedInput.digest ? {
      ...projectedInput,
      coverageRequirements: deriveReviewCoverageRequirements(input).map((requirement) => ({ ...requirement, required: false })),
    } : projectedInput;
    const forgedReviewer = createConversationBlindReviewer({ complete: async () => ({ status: "abstained", reason: "not enough evidence", coverage: { ...projectedCoverage(), projection: { status: "not_applicable" } } }) });
    await expect(forgedReviewer.review(forgedRequirements, new AbortController().signal)).resolves.toMatchObject({
      status: "abstained",
      coverage: { projection: { status: "insufficient_evidence" } },
    });
  });

  it("treats exact request wording citations as blocking Semantic Diffs", async () => {
    const reviewer = createConversationBlindReviewer({ complete: async () => ({
      status: "rejected",
      coverage: projectedCoverage(),
      diffs: [{
        aspect: "projection",
        required: "customer list",
        observed: "constant",
        evidence: { questionQuote: "List customers", digestPath: "projections[0].output" },
      }],
    }) });

    await expect(reviewer.review(projectedInput, new AbortController().signal)).resolves.toMatchObject({
      status: "rejected",
      blocking: true,
      diffs: [{ blocking: true, evidence: { questionQuote: "List customers" } }],
    });
  });

  it("treats exact task-document citations as blocking Semantic Diffs", async () => {
    const documentedInput: ConversationBlindReviewerInput = {
      ...projectedInput,
      semanticEvidence: [{ id: "doc-1", authority: "task_document", path: "doc/business.md", title: "Metric", startLine: 1, endLine: 1, revision: 1, content: "Average each customer ratio before grouping by segment." }],
    };
    const reviewer = createConversationBlindReviewer({ complete: async () => ({
      status: "rejected",
      coverage: projectedCoverage(),
      diffs: [{
        aspect: "measure_grain",
        required: "average customer ratios",
        observed: "ratio of grouped sums",
        evidence: { semanticEvidenceId: "doc-1", semanticEvidenceQuote: "Average each customer ratio before grouping by segment.", digestPath: "projections[0].output" },
      }],
    }) });

    await expect(reviewer.review(documentedInput, new AbortController().signal)).resolves.toMatchObject({ status: "rejected", blocking: true, diffs: [{ blocking: true }] });
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

    let calls = 0;
    const reviewerWithoutPaths = createConversationBlindReviewer({ complete: async () => {
      calls += 1;
      return { status: "approved", coverage: { ...coverage, result_values: { status: "checked", evidence: [{ digestPath: "invented.path", resultPath: "invented.result" }] } } };
    } });
    await expect(reviewerWithoutPaths.review(aggregateInput, new AbortController().signal)).resolves.toMatchObject({
      status: "approved",
      coverage: { result_values: { status: "checked", evidence: [{ digestPath: "measures[0].function", resultPath: "resultEvidence.numericRows" }] } },
    });
    expect(calls).toBe(1);

    const partialInput: ConversationBlindReviewerInput = {
      ...aggregateInput,
      resultMetadata: {
        ...aggregateInput.resultMetadata,
        truncated: true,
        resultEvidence: buildResultEvidence(["revenue"], [[42]], true),
      },
    };
    const insufficient = createConversationBlindReviewer({ complete: async () => ({ status: "approved", coverage }) });
    await expect(insufficient.review(partialInput, new AbortController().signal)).resolves.toMatchObject({
      status: "abstained",
      reason: "REVIEW_COVERAGE_INSUFFICIENT",
      coverage: { result_values: { status: "insufficient_evidence" } },
    });
  });

  it("binds complete categorical rows to Runtime-owned result evidence", async () => {
    const categoricalInput: ConversationBlindReviewerInput = {
      ...projectedInput,
      resultMetadata: {
        columns: ["answer"],
        columnTypes: ["TEXT"],
        rowCount: 1,
        truncated: false,
        nullCounts: { answer: 0 },
        resultEvidence: buildResultEvidence(["answer"], [["Paris"]], false, { includeRows: true }),
      },
    };
    const coverage = {
      ...projectedCoverage(),
      result_values: { status: "checked" as const },
    };
    const reviewer = createConversationBlindReviewer({ complete: async () => ({ status: "approved", coverage }) });

    await expect(reviewer.review(categoricalInput, new AbortController().signal)).resolves.toMatchObject({
      status: "approved",
      coverage: { result_values: { status: "checked", evidence: [{ digestPath: "projections[0].output", resultPath: "resultEvidence.rows" }] } },
    });
  });

  it("uses Digest capability instead of reviewer claims and does not retry unsupported coverage", async () => {
    let calls = 0;
    const unsupportedInput: ConversationBlindReviewerInput = {
      ...projectedInput,
      digest: {
        ...projectedInput.digest,
        coverage: { projections: "checked", outputLineage: "unsupported" },
        unsupportedNodes: ["subquery"],
        lineageCompleteness: "partial",
      },
    };
    const reviewer = createConversationBlindReviewer({ complete: async () => {
      calls += 1;
      return { status: "approved", coverage: projectedCoverage() };
    } });
    await expect(reviewer.review(unsupportedInput, new AbortController().signal)).resolves.toMatchObject({
      status: "abstained",
      reason: "REVIEW_COVERAGE_INSUFFICIENT",
      coverage: { projection: { status: "unsupported" } },
    });
    expect(calls).toBe(1);
  });

  it("keeps a reason-less abstention available without inventing approval", async () => {
    const reviewer = createConversationBlindReviewer({ complete: async () => ({ status: "abstained", coverage: projectedCoverage("unsupported") }) });
    await expect(reviewer.review(projectedInput, new AbortController().signal)).resolves.toMatchObject({
      status: "abstained",
      reason: "REVIEWER_ABSTAINED_WITHOUT_REASON",
    });
  });

  it("returns abstained when the reviewer lacks evidence instead of approving", async () => {
    const reviewer = createConversationBlindReviewer({ complete: async () => ({ status: "abstained", reason: "unsupported SQL", coverage: projectedCoverage("unsupported") }) });
    await expect(reviewer.review(projectedInput, new AbortController().signal)).resolves.toMatchObject({ status: "abstained", coverage: { projection: { status: "unsupported" } } });
  });
});
