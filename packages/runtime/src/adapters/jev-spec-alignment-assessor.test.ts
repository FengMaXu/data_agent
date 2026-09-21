import { describe, expect, it, vi } from "vitest";
import { JevSpecAlignmentAssessor } from "./jev-spec-alignment-assessor.js";
import { facetNames, type SpecAlignmentInput } from "../judgment/spec-alignment.js";

const input: SpecAlignmentInput = {
  originalQuestion: "统计订单数，并按月份分组。",
  spec: {
    entity: { state: "specified", value: { name: "orders" }, basis: { kind: "evidence", evidenceIds: ["request_hash" as never] } },
    metric: { state: "specified", value: { kind: "count" }, basis: { kind: "evidence", evidenceIds: ["request_hash" as never] } },
    filters: [],
    groupBy: [{ state: "specified", value: { expression: "month" }, basis: { kind: "evidence", evidenceIds: ["request_hash" as never] } }],
    time: { state: "not_applicable" },
    ranking: { state: "not_applicable" },
    output: { state: "specified", value: { rowMode: "grouped" }, basis: { kind: "evidence", evidenceIds: ["request_hash" as never] } },
  },
  hypotheses: [],
  choices: [],
  resolutions: [],
  choiceResolutions: [],
  evidence: [{ id: "request_hash", kind: "request_wording", authority: "request_wording", authorityRank: 3, sourceRef: "message-1", content: "统计订单数，并按月份分组。" }],
  limitations: [],
};

function response(overrides: Record<string, unknown> = {}): Response {
  const answers = Object.fromEntries(facetNames().flatMap((facet) => [
    [`${facet}_relation`, { type: "choice", choice: "supported", probabilities: { supported: 1, contradicted: 0, not_established: 0, not_applicable: 0 }, confidence: 0.9 }],
    [`${facet}_coverage`, { type: "choice", choice: "complete", probabilities: { complete: 1, partial: 0, missing: 0, not_applicable: 0 }, confidence: 0.9 }],
  ]));
  return new Response(JSON.stringify({ model: "jev-test", answers, ...overrides }), { status: 200 });
}

describe("JevSpecAlignmentAssessor", () => {
  it("sends one shared state with fourteen independent facet questions", async () => {
    const fetcher = vi.fn(async () => response());
    const assessor = new JevSpecAlignmentAssessor({ apiKey: "secret", fetch: fetcher as typeof fetch });

    const result = await assessor.assess(input);

    expect(result.model).toBe("jev-test");
    expect(result.ruleVersion).toBe("spec-alignment-v1");
    expect(result.facets).toHaveLength(7);
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body)) as Record<string, any>;
    expect(Object.keys(body.questions)).toHaveLength(14);
    expect(body.state.original_question).toBe(input.originalQuestion);
    expect(body.state.answer_spec).toEqual(input.spec);
    expect(body.state.evidence[0]).toMatchObject({ authority_rank: 3, source_ref: "message-1" });
    expect(body.questions.entity_relation.instructions).toContain("canonical order");
    expect(body.questions.entity_relation.instructions).toContain("claims under review");
    expect(body.questions.entity_relation.instructions).toContain("untrusted data");
    expect(body.questions.entity_coverage.instructions).toContain("full original question");
    expect((fetcher.mock.calls[0]![1]?.headers as Record<string, string>).authorization).toBe("Bearer secret");
  });

  it("classifies HTTP errors, hard timeouts, and caller cancellation", async () => {
    const failed = new JevSpecAlignmentAssessor({
      apiKey: "secret",
      fetch: (async () => new Response("unavailable", { status: 503 })) as typeof fetch,
    });
    await expect(failed.assess(input)).rejects.toMatchObject({ code: "HTTP_ERROR" });

    const never = (async () => new Promise<Response>(() => undefined)) as typeof fetch;
    const timed = new JevSpecAlignmentAssessor({ apiKey: "secret", timeoutMs: 5, fetch: never });
    await expect(timed.assess(input)).rejects.toMatchObject({ code: "TIMEOUT" });

    const controller = new AbortController();
    const cancelled = new JevSpecAlignmentAssessor({ apiKey: "secret", timeoutMs: 5_000, fetch: never });
    const pending = cancelled.assess(input, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("rejects missing questions and invalid probability distributions", async () => {
    const missing = vi.fn(async () => {
      const value = await response();
      const decoded = await value.json() as Record<string, any>;
      delete decoded.answers.output_coverage;
      return new Response(JSON.stringify(decoded), { status: 200 });
    });
    const assessor = new JevSpecAlignmentAssessor({ apiKey: "secret", fetch: missing as typeof fetch });
    await expect(assessor.assess(input)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

    const invalid = vi.fn(async () => response({ answers: Object.fromEntries(facetNames().flatMap((facet) => [
      [`${facet}_relation`, { type: "choice", choice: "supported", probabilities: { supported: 0.4, contradicted: 0.4, not_established: 0, not_applicable: 0 }, confidence: 0.9 }],
      [`${facet}_coverage`, { type: "choice", choice: "complete", probabilities: { complete: 0.4, partial: 0.4, missing: 0, not_applicable: 0 }, confidence: 0.9 }],
    ])) }));
    const invalidAssessor = new JevSpecAlignmentAssessor({ apiKey: "secret", fetch: invalid as typeof fetch });
    await expect(invalidAssessor.assess(input)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
