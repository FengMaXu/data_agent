import { describe, expect, it, vi } from "vitest";
import { TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { InMemoryAnswering } from "../answering/service.js";
import { InMemoryAnsweringStore } from "../answering/answering-store.js";
import { InMemoryResultStore } from "../answering/result-store.js";
import { InMemoryAdvisoryLedger } from "../answering/advisory-ledger.js";
import { createAnsweringAgentToolDefinitions, HYPOTHESIS_COMPARISON_PARAMETERS } from "./answering.js";
import { Value } from "typebox/value";

const spec = { "population.entity": "orders", "population.eligibility": "n/a", "population.conditions": "n/a", "population.time": "n/a", "measure.formula": { op: "count", of: "orders" }, "measure.countGrain": "one row per order", grouping: "n/a", selection: "n/a", output: { rowMode: "scalar", rowCount: 1 } };
const business = (invocationId: string) => ({ principal: { id: "user-1" }, sessionId: "session-1", lane: "main", operationId: "operation-1", invocationId });
const PATH = "population.timeField";

async function setup() {
  const outputs: Record<string, { columns: string[]; rows: unknown[][]; truncated: boolean }> = {
    "SELECT purchase": { columns: ["n"], rows: [[265]], truncated: false },
    "SELECT delivered": { columns: ["n"], rows: [[205]], truncated: false },
  };
  const ledger = new InMemoryAdvisoryLedger();
  const answering = new InMemoryAnswering({
    store: new InMemoryAnsweringStore(),
    resultStore: new InMemoryResultStore(),
    sqlExecutor: { run: async (sql) => outputs[sql]! },
    fieldProbes: true,
    advisoryLedger: ledger,
    requireAdvice: true,
  });
  const view = await answering.set({
    requestMessageId: "current-message",
    requestId: "begin",
    fields: { ...spec, [PATH]: { open: ["按下单时间", "按送达时间"] } },
  }, business("begin"));
  const field = view.fields.find((item) => item.path === PATH)!;
  const [purchase, delivered] = field.alternatives!.map((alternative) => alternative.id);
  await answering.execute({ kind: "exploration", taskId: view.taskId, sql: "SELECT purchase", probe: { path: PATH, alternativeId: purchase! } }, business("probe-1"));
  await answering.execute({ kind: "exploration", taskId: view.taskId, sql: "SELECT delivered", probe: { path: PATH, alternativeId: delivered! } }, business("probe-2"));
  return { answering, ledger, view, purchase: purchase!, delivered: delivered! };
}

function invocationFor(memo: Map<string, unknown>) {
  return {
    invocationId: "invocation-1",
    operationId: "operation-1",
    turnId: "turn-1",
    getMemo: async (key: string) => memo.get(key),
    setMemo: async (key: string, value: unknown) => { memo.set(key, value); },
  };
}

describe("compare_hypotheses tool", () => {
  it("compares the alternatives of one open field, adds probe outputs, records the lean and memoizes", async () => {
    const { answering, ledger, view, purchase, delivered } = await setup();
    const compare = vi.fn(async () => ({
      model: "jev-1.13.0",
      recommendation: { kind: "insufficient_evidence" as const },
      probabilities: [
        { hypothesisId: purchase, probability: 0 },
        { hypothesisId: delivered, probability: 0.25 },
      ],
      abstentionProbabilities: { insufficientEvidence: 0.43, multiplePlausible: 0.32, noneSupported: 0 },
      confidence: 0.27,
    }));
    const tool = createAnsweringAgentToolDefinitions(answering, undefined, {
      advisor: { compare },
      getOriginalQuestion: async () => "每月已送达订单数",
      ledger,
    }).map((definition) => definition.tool).find((item) => item.name === "compare_hypotheses")!;
    const memo = new Map<string, unknown>();
    const toolContext = { sessionId: "session-1", principalId: "user-1", requestMessageId: "current-message" };
    const input = { taskId: view.taskId, path: PATH, evidence: [{ content: "送达事件以 delivered_date 记录", sourceRef: "schema" }] };

    const first = await tool.execute("call-1", input, undefined, toolContext, invocationFor(memo), TODO_CONTEXT);
    const second = await tool.execute("call-1", input, undefined, toolContext, invocationFor(memo), TODO_CONTEXT);

    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare.mock.calls[0]![0]).toMatchObject({
      originalQuestion: "每月已送达订单数",
      hypotheses: [{ id: purchase, statement: `${PATH}: 按下单时间` }, { id: delivered, statement: `${PATH}: 按送达时间` }],
      evidence: [
        { id: "request", kind: "request_wording" },
        { id: "probe_outputs", content: expect.stringContaining("alternative 1: 1 output rows") },
        { id: "inline_0", content: "送达事件以 delivered_date 记录" },
      ],
    });
    expect(ledger.latest(view.taskId, PATH)).toMatchObject({ recommendation: "insufficient_evidence", lean: { alternativeId: delivered, probability: 0.25 } });
    expect(first.content[0]).toMatchObject({ type: "text", text: expect.stringContaining(`[ADVICE_LEAN] alternativeId=${delivered}`) });
    expect(second.details).toEqual(first.details);
  });

  it("rejects a path that is not open in the current Revision", async () => {
    const { answering, ledger, view } = await setup();
    const tool = createAnsweringAgentToolDefinitions(answering, undefined, { advisor: { compare: vi.fn() }, getOriginalQuestion: async () => "q", ledger })
      .map((definition) => definition.tool).find((item) => item.name === "compare_hypotheses")!;
    await expect(tool.execute("call-1", { taskId: view.taskId, path: "grouping" }, undefined, { sessionId: "session-1", principalId: "user-1", requestMessageId: "current-message" }, invocationFor(new Map()), TODO_CONTEXT))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("takes a task and a field path instead of free-form hypotheses", () => {
    expect(Value.Check(HYPOTHESIS_COMPARISON_PARAMETERS, { taskId: "task", path: PATH })).toBe(true);
    expect(Value.Check(HYPOTHESIS_COMPARISON_PARAMETERS, { hypotheses: [{ id: "h1", statement: "a" }, { id: "h2", statement: "b" }] })).toBe(false);
  });
});

describe("deciding against advice (ADR-0005)", () => {
  const rationale = "The request counts orders when they are purchased";
  const decide = (answering: InMemoryAnswering, taskId: string, value: string, extra: Record<string, unknown> = {}) =>
    answering.set({ taskId, requestId: `decide-${value}-${Object.keys(extra).length}`, fields: { [PATH]: { value, rationale, ...extra } } }, business(`decide-${value}-${Object.keys(extra).length}`));

  it("requires advice before deciding a decisive open field", async () => {
    const { answering, view } = await setup();
    const result = await decide(answering, view.taskId, "按下单时间");
    expect(result.outcomes?.[0]).toMatchObject({ status: "rejected", code: "SPEC_TRANSITION_INVALID", message: expect.stringContaining("call compare_hypotheses") });
  });

  it("requires a reason and evidence to decide against a clear lean", async () => {
    const { answering, ledger, view, purchase, delivered } = await setup();
    ledger.record({ taskId: view.taskId, path: PATH, alternativeIds: [purchase, delivered], model: "jev", probabilities: [{ alternativeId: purchase, probability: 0.04 }, { alternativeId: delivered, probability: 0.53 }], recommendation: "alternative", recommendedAlternativeId: delivered, lean: { alternativeId: delivered, probability: 0.53 }, recordedAt: "now" });
    const against = await decide(answering, view.taskId, "按下单时间");
    expect(against.outcomes?.[0]).toMatchObject({ status: "rejected", message: expect.stringContaining(`leaned to alternative ${delivered} (p=0.53)`) });
    const inspected = await answering.inspect({ taskId: view.taskId }, business("inspect"));
    const observation = inspected.task.fieldProbes!.find((probe) => probe.alternativeId === purchase)!.evidenceId;
    const overridden = await decide(answering, view.taskId, "按下单时间", { adviceOverride: { reason: "Only the purchase month is defined for every order in 2016", evidenceIds: [observation] } });
    expect(overridden.fields.find((item) => item.path === PATH)).toMatchObject({ status: "decided", verified: false, rationale, advice: { lean: { alternativeId: delivered } }, adviceOverride: { evidenceIds: [observation] } });
  });

  it("accepts the leaned alternative without an override", async () => {
    const { answering, ledger, view, purchase, delivered } = await setup();
    ledger.record({ taskId: view.taskId, path: PATH, alternativeIds: [purchase, delivered], model: "jev", probabilities: [{ alternativeId: purchase, probability: 0 }, { alternativeId: delivered, probability: 0.25 }], recommendation: "insufficient_evidence", lean: { alternativeId: delivered, probability: 0.25 }, recordedAt: "now" });
    const decided = await decide(answering, view.taskId, "按送达时间");
    const field = decided.fields.find((item) => item.path === PATH);
    expect(field).toMatchObject({ status: "decided", value: "按送达时间" });
    expect(field).not.toHaveProperty("adviceOverride");
  });
});
