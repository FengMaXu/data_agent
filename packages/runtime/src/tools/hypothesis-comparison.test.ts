import { describe, expect, it, vi } from "vitest";
import { TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { InMemoryAnswering } from "../answering/service.js";
import { InMemoryAnsweringStore } from "../answering/answering-store.js";
import { InMemoryResultStore } from "../answering/result-store.js";
import { createAnsweringAgentTools, HYPOTHESIS_COMPARISON_PARAMETERS } from "./answering.js";
import { Value } from "typebox/value";

const answering = () => new InMemoryAnswering({
  store: new InMemoryAnsweringStore(),
  resultStore: new InMemoryResultStore(),
  sqlExecutor: { run: async () => ({ columns: ["value"], rows: [[1]], truncated: false }) },
});

describe("compare_hypotheses tool", () => {
  it("uses trusted request wording, registered context, and memoized advisory output", async () => {
    const compare = vi.fn(async () => ({
      model: "jev-1.13.0",
      recommendation: { kind: "hypothesis" as const, hypothesisId: "alternative-1" },
      probabilities: [
        { hypothesisId: "alternative-1", probability: 0.8 },
        { hypothesisId: "alternative-2", probability: 0.05 },
      ],
      abstentionProbabilities: { insufficientEvidence: 0.1, multiplePlausible: 0.03, noneSupported: 0.02 },
      confidence: 0.7,
    }));
    const tools = createAnsweringAgentTools(answering(), undefined, {
      advisor: { compare },
      contextReader: {
        read: async () => ({
          originalQuestion: "年度月均收入如何计算？",
          hypotheses: [
            { id: "alternative-1", statement: "按十二个月计算" },
            { id: "alternative-2", statement: "按有记录月份计算" },
          ],
          evidence: [{ id: "evidence-1", kind: "reviewed_definition", authority: "reviewed_business_definition", authorityRank: 1, sourceRef: "metric.md", content: "无收入月份按零计算" }],
          omittedEvidenceRefs: [],
        }),
      },
    });
    const tool = tools.find((item) => item.name === "compare_hypotheses");
    if (!tool) throw new Error("compare_hypotheses not registered");
    const memo = new Map<string, unknown>();
    const invocation = {
      invocationId: "invocation-1",
      operationId: "operation-1",
      turnId: "turn-1",
      getMemo: async (key: string) => memo.get(key),
      setMemo: async (key: string, value: unknown) => { memo.set(key, value); },
    };
    const toolContext = { sessionId: "session-1", principalId: "user-1", requestMessageId: "current-message" };
    const input = { taskId: "task-1", revisionId: "revision-1", choiceId: "choice-1" };

    const first = await tool.execute("call-1", input, undefined, toolContext, invocation, TODO_CONTEXT);
    const second = await tool.execute("call-1", input, undefined, toolContext, invocation, TODO_CONTEXT);

    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare.mock.calls[0]![0]).toMatchObject({
      originalQuestion: "年度月均收入如何计算？",
      hypotheses: [{ id: "alternative-1" }, { id: "alternative-2" }],
      evidence: [
        { id: "request:task-1", kind: "request_wording", content: "年度月均收入如何计算？" },
        { id: "evidence-1", kind: "reviewed_definition" },
      ],
    });
    expect(first.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("not evidence") });
    expect(second.details).toEqual(first.details);
  });

  it("does not accept model-supplied original wording or hypothesis text", () => {
    expect(Value.Check(HYPOTHESIS_COMPARISON_PARAMETERS, {
      taskId: "task-1",
      revisionId: "revision-1",
      choiceId: "choice-1",
      originalQuestion: "invented",
      hypotheses: [{ id: "h1", statement: "invented" }],
    })).toBe(false);
  });
});
