import { describe, expect, it, vi } from "vitest";
import { JevHypothesisChoiceAdvisor } from "./jev-hypothesis-choice-advisor.js";

const input = {
  originalQuestion: "年度月均收入应使用哪个分母？",
  hypotheses: [
    { id: "h-calendar", statement: "按全年十二个月计算，无收入月份计零" },
    { id: "h-observed", statement: "只按有收入记录的月份计算" },
  ],
  evidence: [
    { id: "e-request", kind: "request_wording", authority: "request_wording", authorityRank: 3, sourceRef: "message-1", content: "请计算年度月均收入" },
    { id: "e-definition", kind: "reviewed_definition", authority: "reviewed_business_definition", authorityRank: 1, sourceRef: "metric.md#monthly-average", content: "全年十二个月参与平均，无收入月份按零计算。" },
  ],
} as const;

function response(answer: object): Response {
  return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
}

describe("JevHypothesisChoiceAdvisor", () => {
  it("compares all hypotheses against the same original question and evidence set", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => response({
      model: "jev-1.13.0",
      answers: {
        best_hypothesis: {
          type: "choice",
          choice: "hypothesis_1",
          probabilities: {
            hypothesis_1: 0.82,
            hypothesis_2: 0.03,
            insufficient_evidence: 0.08,
            multiple_plausible: 0.05,
            none_supported: 0.02,
          },
          confidence: 0.71,
        },
      },
    }));
    const advisor = new JevHypothesisChoiceAdvisor({ apiKey: "secret", fetch: fetcher as typeof fetch });

    const result = await advisor.compare(input);

    expect(result).toEqual({
      model: "jev-1.13.0",
      recommendation: { kind: "hypothesis", hypothesisId: "h-calendar" },
      probabilities: [
        { hypothesisId: "h-calendar", probability: 0.82 },
        { hypothesisId: "h-observed", probability: 0.03 },
      ],
      abstentionProbabilities: { insufficientEvidence: 0.08, multiplePlausible: 0.05, noneSupported: 0.02 },
      confidence: 0.71,
    });
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body)) as Record<string, any>;
    expect(body.model).toBe("jev-1.13.0");
    expect(body.state.original_question).toBe(input.originalQuestion);
    expect(body.state.evidence).toHaveLength(2);
    expect(body.state.evidence[1]).toMatchObject({ authority: "reviewed_business_definition", authority_rank: 1 });
    expect(body.questions.best_hypothesis.criteria).toMatchObject({
      hypothesis_1: input.hypotheses[0].statement,
      hypothesis_2: input.hypotheses[1].statement,
      insufficient_evidence: expect.any(String),
      multiple_plausible: expect.any(String),
      none_supported: expect.any(String),
    });
    expect((fetcher.mock.calls[0]![1]?.headers as Record<string, string>).authorization).toBe("Bearer secret");
  });

  it("preserves Jev abstention instead of forcing a hypothesis", async () => {
    const fetcher = vi.fn(async () => response({
      model: "jev-1.13.0",
      answers: {
        best_hypothesis: {
          type: "choice",
          choice: "insufficient_evidence",
          probabilities: {
            hypothesis_1: 0.1,
            hypothesis_2: 0.1,
            insufficient_evidence: 0.6,
            multiple_plausible: 0.15,
            none_supported: 0.05,
          },
          confidence: 0.5,
        },
      },
    }));
    const advisor = new JevHypothesisChoiceAdvisor({ apiKey: "secret", fetch: fetcher as typeof fetch });

    await expect(advisor.compare(input)).resolves.toMatchObject({ recommendation: { kind: "insufficient_evidence" } });
  });

  it("rejects malformed or out-of-space answers", async () => {
    const fetcher = vi.fn(async () => response({
      model: "jev-1.13.0",
      answers: { best_hypothesis: { type: "choice", choice: "invented", probabilities: {}, confidence: 0.9 } },
    }));
    const advisor = new JevHypothesisChoiceAdvisor({ apiKey: "secret", fetch: fetcher as typeof fetch });

    await expect(advisor.compare(input)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
