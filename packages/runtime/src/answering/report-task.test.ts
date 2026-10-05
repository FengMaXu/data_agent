import { describe, expect, it } from "vitest";
import {
  InMemoryAnswering,
  InMemoryAnsweringStore,
  InMemoryResultStore,
  type BusinessContext,
} from "./public.js";

const context = (invocationId: string): BusinessContext => ({
  principal: { id: "user-1" },
  sessionId: "session-1",
  lane: "main",
  operationId: "operation-1",
  invocationId,
});

function service() {
  return new InMemoryAnswering({
    store: new InMemoryAnsweringStore(),
    resultStore: new InMemoryResultStore(),
    sqlExecutor: { run: async () => ({ columns: ["n"], rows: [[42]], truncated: false }) },
    choiceProbes: true,
  });
}

const na = (name: string) => ({ name, status: "not_applicable" });

const sharedStep = {
  label: "shared",
  spec: { entity: "orders", filters: ["order_status = 'delivered'"], time: { expression: "2018", boundary: "inclusive" } },
  decisionPoints: ["population", "join_multiplicity", "time_field", "window"].map(na),
};

const ownStep = {
  label: "own",
  spec: { metric: "count", groupBy: [], ranking: { state: "not_applicable" }, output: { rowMode: "scalar", rowCount: 1 } },
  decisionPoints: ["count_grain", "denominator", "ties", "output_shape"].map(na),
};

async function report(answering: InMemoryAnswering) {
  return answering.begin({ requestMessageId: "message-1", requestId: "report", spec: {}, report: true, steps: [sharedStep] } as never, context("report"));
}

async function chart(answering: InMemoryAnswering, parentTaskId: string, requestId = "chart", steps: unknown[] = [ownStep], extra: Record<string, unknown> = {}) {
  return answering.begin({ requestMessageId: "message-1", requestId, spec: {}, parent: { taskId: parentTaskId }, steps, ...extra } as never, context(requestId));
}

async function result(answering: InMemoryAnswering, taskId: string, revisionId: string, invocation: string) {
  return answering.execute({ kind: "result", taskId, revisionId, sql: "SELECT 42" }, context(invocation));
}

describe("Report Task", () => {
  it("gives a chart query the shared fields of its Report Task", async () => {
    const answering = service();
    const parent = await report(answering);
    expect(parent.role).toBe("report");
    const child = await chart(answering, parent.taskId);
    expect(child.parent).toEqual({ taskId: parent.taskId, revisionId: parent.revisionId, current: true });
    expect(child.spec.entity).toEqual({ state: "specified", value: { name: "orders" }, basis: { kind: "inherited", taskId: parent.taskId, revisionId: parent.revisionId } });
    expect(child.spec.filters).toEqual([expect.objectContaining({ basis: expect.objectContaining({ kind: "inherited" }) })]);
    expect(child.decisionPoints).toMatchObject({ population: { status: "inherited" }, window: { status: "inherited" }, count_grain: { status: "not_applicable" } });
    expect(child.undeclaredDecisionPoints).toEqual([]);
    expect(child.unresolvedFacets).toEqual([]);
  });

  it("refuses a change to an inherited field without a reason, and records and discloses one with a reason", async () => {
    const answering = service();
    const parent = await report(answering);
    const refused = await chart(answering, parent.taskId, "chart-refused", [ownStep, { label: "narrow", spec: { filters: ["order_status = 'shipped'"] } }]);
    expect(refused.steps).toEqual([{ label: "own", status: "applied" }, expect.objectContaining({ label: "narrow", status: "rejected", message: expect.stringContaining("inherited from the Report Task") })]);

    const deviated = await chart(answering, parent.taskId, "chart-deviated", [ownStep, { label: "narrow", spec: { filters: ["order_status = 'shipped'"] }, deviations: [{ path: "filters", reason: "这张图只看已发货订单" }] }]);
    expect(deviated.steps?.map((step) => step.status)).toEqual(["applied", "applied"]);
    expect(deviated.deviations).toEqual([{ path: "filters", reason: "这张图只看已发货订单" }]);
    const candidate = await result(answering, deviated.taskId, deviated.revisionId, "result");
    const receipt = await answering.publish({ candidateId: (candidate.artifact as { candidateId: string }).candidateId, format: "inline", requestId: "publish" }, context("publish"));
    expect(receipt.disclosure?.deviations).toEqual([{ path: "filters", reason: "这张图只看已发货订单" }]);
    expect(receipt.disclosure?.summary).toContain("偏离报告任务的共享口径");
  });

  it("blocks a chart query after its Report Task changes, keeps exploration, and lets it rebind", async () => {
    const answering = service();
    const parent = await report(answering);
    const child = await chart(answering, parent.taskId);
    const changed = await answering.revise({ taskId: parent.taskId, baseRevisionId: parent.revisionId, requestId: "parent-2", steps: [{ label: "time", spec: { time: { expression: "2017", boundary: "inclusive" } } }] } as never, context("parent-2"));
    await expect(result(answering, child.taskId, child.revisionId, "stale")).rejects.toMatchObject({ code: "PARENT_REVISION_STALE" });
    await expect(answering.execute({ kind: "exploration", taskId: child.taskId, sql: "SELECT 1" }, context("explore"))).resolves.toMatchObject({ kind: "exploration" });

    const rebound = await answering.revise({ taskId: child.taskId, baseRevisionId: child.revisionId, requestId: "rebind", rebind: true } as never, context("rebind"));
    expect(rebound.parent).toEqual({ taskId: parent.taskId, revisionId: changed.revisionId, current: true });
    expect(rebound.spec.time).toMatchObject({ value: { expression: "2017" }, basis: { kind: "inherited", revisionId: changed.revisionId } });
    await expect(result(answering, child.taskId, rebound.revisionId, "fresh")).resolves.toMatchObject({ kind: "result" });
  });

  it("keeps a deviated field on rebind", async () => {
    const answering = service();
    const parent = await report(answering);
    const child = await chart(answering, parent.taskId, "chart", [ownStep, { label: "time", spec: { time: { expression: "2018 Q4" } }, deviations: [{ path: "time", reason: "只看第四季度" }] }]);
    await answering.revise({ taskId: parent.taskId, baseRevisionId: parent.revisionId, requestId: "parent-2", steps: [{ label: "entity", spec: { entity: "order_items" }, decisionPoints: [] }] } as never, context("parent-2"));
    const rebound = await answering.revise({ taskId: child.taskId, baseRevisionId: child.revisionId, requestId: "rebind", rebind: true } as never, context("rebind"));
    expect(rebound.spec.time).toMatchObject({ value: { expression: "2018 Q4" } });
    expect(rebound.spec.entity).toMatchObject({ value: { name: "order_items" }, basis: { kind: "inherited" } });
  });

  it("blocks every chart query while the Report Task has an unhandled hypothesis", async () => {
    const answering = service();
    const parent = await report(answering);
    const child = await chart(answering, parent.taskId);
    await answering.revise({ taskId: parent.taskId, baseRevisionId: parent.revisionId, requestId: "parent-2", steps: [{
      label: "doubt",
      addHypotheses: [{ localId: "h", kind: "business_semantics", statement: "已送达指 order_status = delivered", affects: ["filters"], basis: "字面", impact: "总体" }],
    }] } as never, context("parent-2"));
    const rebound = await answering.revise({ taskId: child.taskId, baseRevisionId: child.revisionId, requestId: "rebind", rebind: true } as never, context("rebind"));
    await expect(result(answering, child.taskId, rebound.revisionId, "blocked")).rejects.toMatchObject({ code: "PARENT_UNRESOLVED" });
  });

  it("does not block chart queries on a Report Task Choice whose probes all match", async () => {
    const answering = service();
    const parent = await answering.begin({ requestMessageId: "message-1", requestId: "report", spec: {}, report: true, steps: [{
      ...sharedStep,
      decisionPoints: ["join_multiplicity", "time_field", "window"].map(na),
      addChoices: [{ localId: "population", affects: ["filters"], alternatives: [{ localId: "all", statement: "全部订单" }, { localId: "delivered", statement: "已送达订单" }] }],
    }] } as never, context("report"));
    const choice = parent.choices[0]!;
    await answering.revise({ taskId: parent.taskId, baseRevisionId: parent.revisionId, requestId: "point", steps: [{ label: "point", decisionPoints: [{ name: "population", status: "choice", choiceId: choice.id }] }] } as never, context("point"));
    const child = await chart(answering, parent.taskId);
    await expect(result(answering, child.taskId, child.revisionId, "before")).rejects.toMatchObject({ code: "PARENT_UNRESOLVED" });
    for (const alternative of choice.alternatives) {
      await answering.execute({ kind: "exploration", taskId: parent.taskId, sql: "SELECT 42", probe: { choiceId: choice.id, alternativeId: alternative.id } }, context(`probe-${alternative.id}`));
    }
    await expect(result(answering, child.taskId, child.revisionId, "after")).resolves.toMatchObject({ kind: "result" });
  });

  it("lets a chart query cite its Report Task's evidence", async () => {
    const answering = service();
    const parent = await report(answering);
    const observed = await answering.execute({ kind: "exploration", taskId: parent.taskId, sql: "SELECT COUNT(*)" }, context("observe"));
    const evidenceId = (observed.artifact as { evidenceId: string }).evidenceId;
    const child = await chart(answering, parent.taskId, "chart", [{ ...ownStep, spec: { ...ownStep.spec, metric: { value: "count", evidenceIds: [evidenceId] } } }]);
    expect(child.steps).toEqual([{ label: "own", status: "applied" }]);
    expect(child.spec.metric).toMatchObject({ basis: { kind: "evidence", evidenceIds: [evidenceId] } });
  });

  it("never runs a result query or publishes on the Report Task itself", async () => {
    const answering = service();
    const parent = await report(answering);
    await expect(result(answering, parent.taskId, parent.revisionId, "report-result")).rejects.toMatchObject({ code: "REPORT_TASK_NOT_PUBLISHABLE" });
  });

  it("lets a chart query take a named metric definition with its denominator and count grain", async () => {
    const answering = service();
    const parent = await answering.begin({ requestMessageId: "message-1", requestId: "report", spec: {}, report: true, steps: [sharedStep, {
      label: "metrics",
      spec: { metrics: {
        negative_rate: { kind: "ratio", expression: "1-2 星订单 / 有评价订单", denominator: "有评价的订单", countGrain: "按订单" },
        late_rate: { kind: "ratio", expression: "超期送达订单 / 已送达订单" },
      } },
    }] } as never, context("report"));
    const ownWithRef = { ...ownStep, spec: { ...ownStep.spec, metric: { ref: "negative_rate" } }, decisionPoints: ["ties", "output_shape"].map(na) };
    const child = await chart(answering, parent.taskId, "chart", [ownWithRef]);
    expect(child.steps).toEqual([{ label: "own", status: "applied" }]);
    expect(child.metricRef).toBe("negative_rate");
    expect(child.spec.metric).toMatchObject({ value: { kind: "ratio", denominator: "有评价的订单" }, basis: { kind: "inherited", taskId: parent.taskId } });
    expect(child.decisionPoints).toMatchObject({ denominator: { status: "inherited" }, count_grain: { status: "inherited" } });
    expect(child.undeclaredDecisionPoints).toEqual([]);

    const unknown = await chart(answering, parent.taskId, "chart-unknown", [{ ...ownWithRef, spec: { ...ownWithRef.spec, metric: { ref: "gmv" } } }]);
    expect(unknown.steps?.[0]).toMatchObject({ status: "rejected", message: expect.stringContaining("negative_rate, late_rate") });
  });

  it("asks for a reason before a chart query uses a metric of its own when the Report Task defines metrics", async () => {
    const answering = service();
    const parent = await answering.begin({ requestMessageId: "message-1", requestId: "report", spec: {}, report: true, steps: [sharedStep, { label: "metrics", spec: { metrics: { orders: { kind: "count" } } } }] } as never, context("report"));
    const refused = await chart(answering, parent.taskId, "chart-own");
    expect(refused.steps?.[0]).toMatchObject({ status: "rejected", message: expect.stringContaining("metric: { ref }") });
    const own = await chart(answering, parent.taskId, "chart-own-reason", [{ ...ownStep, deviations: [{ path: "metric", reason: "这张图看 GMV，报告未定义" }] }]);
    expect(own.steps?.[0]?.status).toBe("applied");
    expect(own.deviations).toEqual([{ path: "metric", reason: "这张图看 GMV，报告未定义" }]);
  });

  it("follows a changed definition only after rebinding, and blocks a reference to an unspecified one", async () => {
    const answering = service();
    const parent = await answering.begin({ requestMessageId: "message-1", requestId: "report", spec: {}, report: true, steps: [sharedStep, { label: "metrics", spec: { metrics: { orders: { kind: "count", expression: "COUNT(*)" }, late: { state: "unknown" } } } }] } as never, context("report"));
    const ownWith = (ref: string) => [{ ...ownStep, spec: { ...ownStep.spec, metric: { ref } } }];
    const orders = await chart(answering, parent.taskId, "chart-orders", ownWith("orders"));
    const late = await chart(answering, parent.taskId, "chart-late", ownWith("late"));
    await expect(result(answering, late.taskId, late.revisionId, "late")).rejects.toMatchObject({ code: "PARENT_UNRESOLVED", message: expect.stringContaining("late") });
    await expect(result(answering, orders.taskId, orders.revisionId, "orders")).resolves.toMatchObject({ kind: "result" });

    await answering.revise({ taskId: parent.taskId, baseRevisionId: parent.revisionId, requestId: "parent-2", steps: [{ label: "metrics", spec: { metrics: { orders: { kind: "count", expression: "COUNT(DISTINCT order_id)" } } } }] } as never, context("parent-2"));
    const rebound = await answering.revise({ taskId: orders.taskId, baseRevisionId: orders.revisionId, requestId: "rebind", rebind: true } as never, context("rebind"));
    expect(rebound.spec.metric).toMatchObject({ value: { expression: "COUNT(DISTINCT order_id)" } });
    expect(rebound.metricRef).toBe("orders");
  });

  it("starts Report Tasks and chart queries only with steps, and only under a Report Task", async () => {
    const answering = service();
    await expect(answering.begin({ requestMessageId: "message-1", requestId: "legacy", spec: {}, report: true } as never, context("legacy"))).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    const plain = await answering.begin({ requestMessageId: "message-1", requestId: "plain", spec: {}, steps: [sharedStep] } as never, context("plain"));
    await expect(chart(answering, plain.taskId, "orphan")).rejects.toMatchObject({ code: "INVALID_REQUEST", message: expect.stringContaining("not a Report Task") });
  });
});
