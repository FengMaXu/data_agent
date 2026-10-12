import { describe, expect, it, vi } from "vitest";
import { JevSpecAlignmentAssessor } from "./jev-spec-alignment-assessor.js";
import type { SpecAlignmentInput } from "../judgment/spec-alignment.js";

const input: SpecAlignmentInput = {
  originalQuestion: "Calculate the fatality rate for motorcycle collisions, separated by helmet usage.",
  fields: {
    "population.entity": { state: "specified", value: { name: "collision" } },
    "population.conditions": { state: "specified", value: ["a party wore a helmet"] },
    grouping: { state: "specified", value: ["helmet usage"] },
    selection: { state: "not_applicable" },
    output: { state: "specified", value: { rowMode: "grouped", columns: ["helmet_usage", "fatality_rate"] } },
  },
  requirements: [
    { quote: "motorcycle collisions", role: "population" },
    { quote: "separated by helmet usage", role: "scope" },
  ],
  outputColumns: ["helmet_usage", "fatality_rate"],
};

const requirement = { type: "choice", choice: "expressed", probabilities: { expressed: 0.9, contradicted: 0.05, missing: 0.05 }, confidence: 0.8 };
const column = { type: "choice", choice: "defined", probabilities: { defined: 0.9, undefined: 0.1 }, confidence: 0.8 };

function response(answers: Record<string, unknown> = { r0: requirement, r1: requirement, c0: column, c1: column }): Response {
  return new Response(JSON.stringify({ model: "jev-test", answers }), { status: 200 });
}

describe("JevSpecAlignmentAssessor", () => {
  it("asks one Choice per requirement phrase and per output column over the Spec's claims", async () => {
    const fetcher = vi.fn(async () => response());
    const assessor = new JevSpecAlignmentAssessor({ apiKey: "secret", fetch: fetcher as typeof fetch });

    const result = await assessor.assess(input);

    expect(result).toMatchObject({ model: "jev-test", ruleVersion: "spec-alignment-v3" });
    expect(result.requirements).toEqual([
      { quote: "motorcycle collisions", role: "population", judgment: { choice: "expressed", probabilities: requirement.probabilities, confidence: 0.8 } },
      expect.objectContaining({ quote: "separated by helmet usage", role: "scope" }),
    ]);
    expect(result.columns.map((item) => item.column)).toEqual(["helmet_usage", "fatality_rate"]);
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body)) as Record<string, any>;
    expect(Object.keys(body.questions).sort()).toEqual(["c0", "c1", "r0", "r1"]);
    expect(body.state).toEqual({ original_question: input.originalQuestion, answer_spec_fields: input.fields });
    expect(body.questions.r0.instructions).toContain("\"motorcycle collisions\"");
    expect(body.questions.r0.instructions).toContain("population.conditions");
    expect(body.questions.r1.criteria.contradicted).toContain("across all countries");
    expect(body.questions.c1.instructions).toContain("\"fatality_rate\"");
    expect((fetcher.mock.calls[0]![1]?.headers as Record<string, string>).authorization).toBe("Bearer secret");
  });

  it("does not call Jev when there is nothing to judge", async () => {
    const fetcher = vi.fn(async () => response());
    const assessor = new JevSpecAlignmentAssessor({ apiKey: "secret", fetch: fetcher as typeof fetch });
    await expect(assessor.assess({ ...input, requirements: [], outputColumns: [] })).resolves.toMatchObject({ requirements: [], columns: [] });
    expect(fetcher).not.toHaveBeenCalled();
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
    const missing = new JevSpecAlignmentAssessor({ apiKey: "secret", fetch: (async () => response({ r0: requirement, r1: requirement, c0: column })) as typeof fetch });
    await expect(missing.assess(input)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

    const skewed = { ...requirement, probabilities: { expressed: 0.4, contradicted: 0.4, missing: 0 } };
    const invalid = new JevSpecAlignmentAssessor({ apiKey: "secret", fetch: (async () => response({ r0: skewed, r1: requirement, c0: column, c1: column })) as typeof fetch });
    await expect(invalid.assess(input)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects an input with an unknown requirement role", async () => {
    const assessor = new JevSpecAlignmentAssessor({ apiKey: "secret", fetch: (async () => response()) as typeof fetch });
    await expect(assessor.assess({ ...input, requirements: [{ quote: "x", role: "style" as never }] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
