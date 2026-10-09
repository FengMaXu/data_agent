import { describe, expect, it } from "vitest";
import {
  InMemoryAnswering,
  InMemoryAnsweringStore,
  InMemoryResultStore,
  type BusinessContext,
  type EvidenceSource,
} from "./public.js";

const context = (invocationId: string): BusinessContext => ({
  principal: { id: "user-1" },
  sessionId: "session-1",
  lane: "main",
  operationId: "operation-1",
  invocationId,
});

const REQUEST = "统计 2018 年已送达订单的数量";

const evidenceSource: EvidenceSource = {
  readUserMessage: async (_sessionId, messageId) => messageId === "message-1" ? REQUEST : undefined,
};

function service() {
  return new InMemoryAnswering({
    store: new InMemoryAnsweringStore(),
    resultStore: new InMemoryResultStore(),
    sqlExecutor: { run: async () => ({ columns: ["n"], rows: [[1]], truncated: false }) },
    evidenceSource,
  });
}

const spec = { entity: "orders", metric: "count", filters: [], groupBy: [], time: { state: "not_applicable" }, ranking: { state: "not_applicable" }, output: { rowMode: "scalar", rowCount: 1 } };

async function begin(answering: InMemoryAnswering) {
  return answering.begin({ requestMessageId: "message-1", requestId: "begin-1", spec } as never, context("begin"));
}

describe("stepped revise", () => {
  it("lands every applied step as one Revision charged once", async () => {
    const answering = service();
    const view = await begin(answering);
    const revised = await answering.revise({
      taskId: view.taskId,
      baseRevisionId: view.revisionId,
      requestId: "revise-1",
      steps: [
        { label: "metric", spec: { metric: { kind: "count", expression: "COUNT(DISTINCT order_id)" } } },
        { label: "filters", spec: { filters: ["order_status = 'delivered'"] } },
      ],
    } as never, context("revise-1"));
    expect(revised.steps).toEqual([{ label: "metric", status: "applied" }, { label: "filters", status: "applied" }]);
    expect(revised.parentRevisionId).toBe(view.revisionId);
    expect(revised.spec.metric).toMatchObject({ state: "specified", value: { expression: "COUNT(DISTINCT order_id)" } });
    expect(revised.spec.filters).toEqual([expect.objectContaining({ value: { expression: "order_status = 'delivered'" } })]);
    const inspected = await answering.inspect({ taskId: view.taskId }, context("inspect"));
    expect(inspected.task.budget?.revisionCount).toBe(1);
  });

  it("skips a rejected step, applies the others and reports why", async () => {
    const answering = service();
    const view = await begin(answering);
    const revised = await answering.revise({
      taskId: view.taskId,
      baseRevisionId: view.revisionId,
      requestId: "revise-1",
      steps: [
        { label: "bad", dispositions: [{ action: "support", hypothesisId: "hypothesis-missing", evidenceIds: ["e"] }] },
        { label: "quote", evidence: [{ localId: "q", kind: "request_wording", quote: "不在原题里的话" }], spec: { metric: { value: "count", evidenceIds: ["q"] } } },
        { label: "time", spec: { time: { expression: "2018 年", boundary: "inclusive" } } },
      ],
    } as never, context("revise-1"));
    expect(revised.steps).toEqual([
      expect.objectContaining({ label: "bad", status: "rejected", code: "SPEC_TRANSITION_INVALID", message: expect.stringContaining("hypothesis-missing") }),
      expect.objectContaining({ label: "quote", status: "rejected", code: "EVIDENCE_REJECTED" }),
      { label: "time", status: "applied" },
    ]);
    expect(revised.spec.time).toMatchObject({ state: "specified", value: { expression: "2018 年" } });
    expect(revised.spec.metric).toMatchObject({ state: "specified", basis: { kind: "inference" } });
  });

  it("writes and charges nothing when every step is rejected", async () => {
    const answering = service();
    const view = await begin(answering);
    const revised = await answering.revise({
      taskId: view.taskId,
      baseRevisionId: view.revisionId,
      requestId: "revise-1",
      steps: [{ label: "bad", dispositions: [{ action: "decide", choiceId: "choice-missing", alternativeId: "a", rationale: "a rationale long enough to pass" }] }],
    } as never, context("revise-1"));
    expect(revised.revisionId).toBe(view.revisionId);
    expect(revised.steps).toEqual([expect.objectContaining({ label: "bad", status: "rejected" })]);
    const inspected = await answering.inspect({ taskId: view.taskId }, context("inspect"));
    expect(inspected.task.budget?.revisionCount).toBe(0);
    expect(inspected.currentRevision.revisionId).toBe(view.revisionId);
  });

  it("lets a later step build on what an earlier step applied", async () => {
    const answering = service();
    const view = await begin(answering);
    const revised = await answering.revise({
      taskId: view.taskId,
      baseRevisionId: view.revisionId,
      requestId: "revise-1",
      steps: [
        { label: "assume", addHypotheses: [{ localId: "h", kind: "business_semantics", statement: "已送达指 order_status = delivered", affects: ["filters"], basis: "字面", impact: "总体" }], spec: { filters: [{ value: "order_status = 'delivered'", hypothesisId: "h" }] } },
        // Only the state left by "assume" makes this a repeat.
        { label: "repeat", addHypotheses: [{ localId: "h2", kind: "business_semantics", statement: "已送达指 order_status = delivered", affects: ["filters"], basis: "字面", impact: "总体" }] },
      ],
    } as never, context("revise-1"));
    expect(revised.steps?.map((step) => step.status)).toEqual(["applied", "rejected"]);
    expect(revised.steps?.[1]?.message).toContain("repeats existing");
    expect(revised.hypotheses).toHaveLength(1);
    expect(revised.spec.filters[0]).toMatchObject({ basis: { kind: "hypothesis", hypothesisId: revised.hypotheses[0]!.id } });
  });

  it("refuses steps mixed with single-delta fields", async () => {
    const answering = service();
    const view = await begin(answering);
    await expect(answering.revise({
      taskId: view.taskId,
      baseRevisionId: view.revisionId,
      requestId: "revise-1",
      spec: { metric: "count" },
      steps: [{ label: "time", spec: { time: "2018" } }],
    } as never, context("revise-1"))).rejects.toMatchObject({ code: "INVALID_REQUEST", message: expect.stringContaining("spec") });
  });
});

describe("stepped begin", () => {
  it("starts the task from an empty spec and applies each step on its own", async () => {
    const answering = service();
    const view = await answering.begin({
      requestMessageId: "message-1",
      requestId: "begin-1",
      spec: {},
      steps: [
        { label: "entity", spec: { entity: "orders" } },
        { label: "metric", evidence: [{ localId: "q", kind: "request_wording", quote: "已送达订单的数量" }], spec: { metric: { value: "count", evidenceIds: ["q"] } } },
        { label: "bad", spec: { ranking: { n: 0, orderBy: "x" } } },
      ],
    } as never, context("begin"));
    expect(view.steps?.map((step) => [step.label, step.status])).toEqual([["entity", "applied"], ["metric", "applied"], ["bad", "rejected"]]);
    expect(view.spec.entity).toMatchObject({ state: "specified", value: { name: "orders" } });
    expect(view.spec.metric).toMatchObject({ state: "specified", basis: { kind: "evidence" } });
    expect(view.spec.ranking).toEqual({ state: "unknown" });
    expect(view.unresolvedFacets).toEqual(expect.arrayContaining(["time", "ranking", "output"]));
    const inspected = await answering.inspect({ taskId: view.taskId }, context("inspect"));
    expect(inspected.task.budget?.revisionCount).toBe(0);
  });

  it("starts the task even when every step is rejected", async () => {
    const answering = service();
    const view = await answering.begin({
      requestMessageId: "message-1",
      requestId: "begin-1",
      spec: {},
      steps: [{ label: "bad", spec: { ranking: { n: 0, orderBy: "x" } } }],
    } as never, context("begin"));
    expect(view.steps).toEqual([expect.objectContaining({ label: "bad", status: "rejected" })]);
    await expect(answering.inspect({ taskId: view.taskId }, context("inspect"))).resolves.toBeDefined();
  });
});
