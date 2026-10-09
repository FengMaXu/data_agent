import { describe, expect, it } from "vitest";
import {
  InMemoryAnswering,
  InMemoryAnsweringStore,
  InMemoryResultStore,
  type EvidenceSource,
} from "../answering/public.js";
import { FIELD_PATHS, compileFields } from "./answer-fields.js";
import { createAnsweringAgentToolDefinitions } from "./answering.js";

function one(fields: Record<string, unknown>, revision?: Parameters<typeof compileFields>[1]["revision"]) {
  const [compiled] = compileFields(fields, revision ? { revision } : {}, "message-2");
  return compiled!;
}

describe("field compiler", () => {
  it("rejects an unknown path and lists the valid ones", () => {
    expect(one({ "metric.foo": "n/a" }).error).toContain(FIELD_PATHS.join(", "));
  });

  it("takes a bare slot value as inference and a slot n/a as explicit absence", () => {
    expect(one({ output: { rowMode: "scalar", rowCount: 1 } }).step).toEqual({ label: "output", spec: { output: { rowMode: "scalar", rowCount: 1 } } });
    expect(one({ filters: "n/a" }).step).toEqual({ label: "filters", spec: { filters: [] } });
    expect(one({ ranking: "n/a" }).step).toEqual({ label: "ranking", spec: { ranking: { state: "not_applicable" } } });
  });

  it("binds a slot to the request quote it cites", () => {
    expect(one({ filters: { value: "order_status = 'delivered'", basis: "request", quote: "已送达" } }).step).toEqual({
      label: "filters",
      evidence: [{ localId: "filters#request", kind: "request_wording", quote: "已送达" }],
      spec: { filters: [{ value: "order_status = 'delivered'", evidenceIds: ["filters#request"] }] },
    });
  });

  it("needs a stated basis for a sub-field", () => {
    expect(one({ "metric.denominator": "全部订单" }).error).toContain("needs a stated basis");
    expect(one({ "metric.denominator": { value: "全部订单" } }).error).toContain("needs a stated basis");
  });

  it("compiles a sub-field into a hypothesis and its decision point", () => {
    expect(one({ "metric.denominator": { value: "全部下单订单", basis: "assumed", rationale: "题面没有限定状态" } }).step).toEqual({
      label: "metric.denominator",
      addHypotheses: [{ localId: "metric.denominator#item", kind: "business_semantics", statement: "metric.denominator: 全部下单订单", affects: ["metric"], basis: "题面没有限定状态", impact: "decides metric.denominator", assumed: true }],
      decisionPoints: [{ name: "denominator", status: "assumed", hypothesisId: "metric.denominator#item" }],
    });
    const request = one({ "filters.population": { value: "全部订单", basis: "request", quote: "所有订单" } }).step!;
    expect(request.decisionPoints).toEqual([{ name: "population", status: "fixed_by_request", quote: "所有订单" }]);
    expect(request.addHypotheses![0]).toMatchObject({ proposedEvidenceIds: ["filters.population#request"] });
    expect(one({ "entity.joinMultiplicity": "n/a" }).step).toEqual({ label: "entity.joinMultiplicity", decisionPoints: [{ name: "join_multiplicity", status: "not_applicable" }] });
  });

  it("turns cite sources into evidence of the matching kind", () => {
    const step = one({ "time.field": { value: "按下单时间", cite: [
      { source: "knowledge:business-definitions", quote: "订单时间指下单时间" },
      { source: "schema:orders.order_purchase_timestamp" },
      { source: "clarification:3a895d79-bf0a-465a-ba05-e92b20efe9b8", quote: "按下单" },
      { source: "message", quote: "按下单时间" },
    ] } }).step!;
    expect(step.evidence).toEqual([
      { localId: "time.field#cite1", kind: "document", sourceRef: "business-definitions", quote: "订单时间指下单时间" },
      { localId: "time.field#cite2", kind: "schema_fact", sourceRef: "orders.order_purchase_timestamp" },
      { localId: "time.field#cite3", kind: "user_confirmation", sourceRef: "clarification:3a895d79-bf0a-465a-ba05-e92b20efe9b8", quote: "按下单" },
      { localId: "time.field#cite4", kind: "user_confirmation", sourceRef: "message-2", quote: "按下单时间" },
    ]);
    expect(one({ "time.field": { value: "x", cite: [{ source: "wiki:page", quote: "q" }] } }).error).toContain("knowledge:<id>, schema:<table.column>, clarification:<id> or message");
  });

  it("refuses text candidates for object slots", () => {
    expect(one({ ranking: { open: ["前 10", "前 20"] } }).error).toContain("ranking.ties");
  });

  it("needs a reason to change a field that is already set, and supersedes its items", () => {
    const revision = {
      spec: { entity: { state: "unknown" }, metric: { state: "unknown" }, filters: [{ state: "unknown" }], groupBy: [{ state: "unknown" }], time: { state: "unknown" }, ranking: { state: "unknown" }, output: { state: "unknown" } },
      hypotheses: [{ id: "hypothesis_1", kind: "business_semantics", statement: "metric.denominator: 全部订单", affects: ["metric"], basis: "b", impact: "i" }],
      choices: [],
      choiceResolutions: [],
      decisionPoints: { denominator: { status: "assumed", hypothesisId: "hypothesis_1" } },
    } as never;
    const value = { value: "已送达订单", basis: "assumed", rationale: "看板只看已送达" };
    expect(one({ "metric.denominator": value }, revision).error).toContain('add "reason"');
    const step = one({ "metric.denominator": { ...value, reason: "用户改为只看已送达" } }, revision).step!;
    expect(step.dispositions).toEqual([{ action: "supersede", targetId: "hypothesis_1", replacementIds: ["metric.denominator#item"], reason: "用户改为只看已送达" }]);
    expect(step.decisionPoints).toEqual([{ name: "denominator", status: "assumed", hypothesisId: "metric.denominator#item" }]);
  });

  it("decides an open field only with one of its candidates", () => {
    const revision = {
      spec: { entity: { state: "unknown" }, metric: { state: "unknown" }, filters: [], groupBy: [], time: { state: "unknown" }, ranking: { state: "unknown" }, output: { state: "unknown" } },
      hypotheses: [],
      choices: [{ id: "choice_1", affects: ["metric"], alternatives: [{ id: "alt_1", statement: "metric.countGrain: 按订单" }, { id: "alt_2", statement: "metric.countGrain: 按订单行" }] }],
      choiceResolutions: [],
      decisionPoints: { count_grain: { status: "choice", choiceId: "choice_1" } },
    } as never;
    expect(one({ "metric.countGrain": { value: "按商品", rationale: "a rationale long enough" } }, revision).error).toContain('"按订单", "按订单行"');
    expect(one({ "metric.countGrain": { value: "按订单", rationale: "订单量指不重复订单" } }, revision).step).toEqual({
      label: "metric.countGrain",
      dispositions: [{ action: "decide", choiceId: "choice_1", alternativeId: "alt_1", rationale: "订单量指不重复订单" }],
    });
  });
});

const REQUEST = "统计 2018 年所有订单的订单量";

function setup() {
  const evidenceSource: EvidenceSource = { readUserMessage: async (_session, id) => id === "message-1" ? REQUEST : undefined };
  const outputs: Record<string, { columns: string[]; rows: unknown[][]; truncated: boolean }> = {
    "SELECT orders": { columns: ["n"], rows: [[99441]], truncated: false },
    "SELECT lines": { columns: ["n"], rows: [[112650]], truncated: false },
  };
  const answering = new InMemoryAnswering({
    store: new InMemoryAnsweringStore(),
    resultStore: new InMemoryResultStore(),
    sqlExecutor: { run: async (sql) => outputs[sql] ?? (() => { throw new Error(`unexpected ${sql}`); })() },
    evidenceSource,
    choiceProbes: true,
  });
  const tools = createAnsweringAgentToolDefinitions(answering, undefined, undefined, { specInterface: "fields" }).map((definition) => definition.tool);
  let calls = 0;
  const run = async (name: string, input: unknown) => {
    const tool = tools.find((item) => item.name === name)!;
    calls += 1;
    const invocation = { operationId: "operation-1", invocationId: `invocation-${calls}`, getMemo: async () => undefined, setMemo: async () => undefined } as never;
    const output = await tool.execute(`call-${calls}`, input as never, undefined, { sessionId: "session-1", principalId: "user-1", requestMessageId: "message-1" }, invocation, {} as never);
    return { text: (output.content[0] as { text: string }).text, details: output.details as Record<string, any> };
  };
  return { tools, run };
}

describe("set_answer_spec", () => {
  it("replaces begin and revise when the field interface is on", () => {
    const names = setup().tools.map((tool) => tool.name);
    expect(names).toContain("set_answer_spec");
    expect(names).not.toContain("begin_answer_spec");
    expect(names).not.toContain("revise_answer_spec");
  });

  it("goes from no task to a published result with fields alone", async () => {
    const { run } = setup();
    const first = await run("set_answer_spec", { fields: {
      entity: { value: "orders", basis: "request", quote: "订单" },
      metric: { value: { kind: "count", expression: "COUNT(*)" }, basis: "request", quote: "订单量" },
      filters: "n/a",
      groupBy: "n/a",
      time: { value: "2018 年", basis: "request", quote: "2018 年" },
      ranking: "n/a",
      output: { rowMode: "scalar", rowCount: 1 },
      "filters.population": { value: "全部订单", basis: "request", quote: "所有订单" },
      "entity.joinMultiplicity": "n/a",
      "metric.countGrain": { open: ["按订单", "按订单行"] },
      "metric.denominator": "n/a",
      "time.field": { value: "order_purchase_timestamp", cite: [{ source: "schema:orders.order_purchase_timestamp" }] },
      "time.window": "n/a",
      "ranking.ties": "n/a",
      "output.shape": "n/a",
      "metric.foo": "n/a",
    } });
    expect(first.text).toContain("✗ metric.foo");
    expect(first.text).toContain("✓ filters.population");
    expect(first.text).toContain("- 待定 metric.countGrain: choiceId=");
    const taskId = first.details.taskId as string;
    const choice = (first.details.choices as { id: string; alternatives: { id: string }[] }[])[0]!;

    await run("query_database", { kind: "exploration", taskId, sql: "SELECT orders", probe: { choiceId: choice.id, alternativeId: choice.alternatives[0]!.id } });
    await run("query_database", { kind: "exploration", taskId, sql: "SELECT lines", probe: { choiceId: choice.id, alternativeId: choice.alternatives[1]!.id } });

    const unchanged = await run("set_answer_spec", { taskId, fields: { "time.field": { value: "order_delivered_timestamp", basis: "assumed", rationale: "看送达" } } });
    expect(unchanged.text).toContain('add "reason"');
    const changed = await run("set_answer_spec", { taskId, fields: { "time.field": { value: "order_delivered_timestamp", basis: "assumed", rationale: "看板关注送达时点", reason: "改按送达时间归属年份" } } });
    expect(changed.text).toContain("✓ time.field");
    expect((changed.details.hypotheses as { statement: string }[]).map((item) => item.statement)).toEqual(["filters.population: 全部订单", "time.field: order_delivered_timestamp"]);

    const decided = await run("set_answer_spec", { taskId, fields: { "metric.countGrain": { value: "按订单", rationale: "订单量按不重复订单计数，订单行会重复计入同一订单" } } });
    expect(decided.text).toContain("✓ metric.countGrain");
    expect(decided.text).toContain("可以执行结果查询");

    const result = await run("query_database", { kind: "result", taskId, revisionId: decided.details.revisionId, sql: "SELECT orders" });
    expect(result.text).toContain("[RESULT_CANDIDATE]");
    const published = await run("publish_query_result", { candidateId: result.details.artifact.candidateId, format: "inline" });
    expect(published.details.disclosure?.provisionalChoiceIds).toEqual([choice.id]);
  });

  it("builds a report: one Report Task, three chart queries in parallel, three publications", async () => {
    const { run } = setup();
    const report = await run("set_answer_spec", { report: true, fields: {
      entity: { value: "orders", basis: "request", quote: "订单" },
      filters: "n/a",
      time: { value: "2018 年", basis: "request", quote: "2018 年" },
      "filters.population": { value: "全部订单", basis: "request", quote: "所有订单" },
      "entity.joinMultiplicity": "n/a",
      "time.field": { value: "order_purchase_timestamp", cite: [{ source: "schema:orders.order_purchase_timestamp" }] },
      "time.window": "n/a",
      "metrics.orders": { value: { kind: "count", expression: "COUNT(DISTINCT order_id)", countGrain: "按订单" }, basis: "request", quote: "订单量" },
    } });
    expect(report.text).toContain("共享字段已处理");
    const reportId = report.details.taskId as string;

    const chartFields = (groupBy: unknown) => ({
      metric: { ref: "orders" },
      groupBy,
      ranking: "n/a",
      output: { rowMode: groupBy === "n/a" ? "scalar" : "grouped" },
      "metric.denominator": "n/a",
      "ranking.ties": "n/a",
      "output.shape": "n/a",
    });
    const charts = await Promise.all([
      run("set_answer_spec", { parentTaskId: reportId, fields: chartFields("n/a") }),
      run("set_answer_spec", { parentTaskId: reportId, fields: chartFields(["customer_state"]) }),
      run("set_answer_spec", { parentTaskId: reportId, fields: chartFields(["order_month"]) }),
    ]);
    for (const chart of charts) {
      expect(chart.text).toContain("指标取自报告任务的 metrics.orders");
      expect(chart.text).toContain("可以执行结果查询");
    }
    const results = await Promise.all(charts.map((chart) => run("query_database", { kind: "result", taskId: chart.details.taskId, revisionId: chart.details.revisionId, sql: "SELECT orders" })));
    const receipts = await Promise.all(results.map((item) => run("publish_query_result", { candidateId: item.details.artifact.candidateId, format: "inline" })));
    expect(new Set(receipts.map((item) => item.details.receiptId)).size).toBe(3);

    // The Report Task changes: a chart query is refused until it rebinds.
    const changed = await run("set_answer_spec", { taskId: reportId, fields: { time: { value: "2017 年", basis: "assumed", rationale: "对比上一年", reason: "改看 2017 年" } } });
    expect(changed.text).toContain("✓ time");
    const first = charts[0]!.details;
    await expect(run("query_database", { kind: "result", taskId: first.taskId, revisionId: first.revisionId, sql: "SELECT lines" })).rejects.toMatchObject({ code: "PARENT_REVISION_STALE" });
    const rebound = await run("set_answer_spec", { taskId: first.taskId, fields: {}, rebind: true });
    expect(rebound.text).toContain(`继承自 ${changed.details.revisionId}`);
    await expect(run("query_database", { kind: "result", taskId: first.taskId, revisionId: rebound.details.revisionId, sql: "SELECT lines" })).resolves.toMatchObject({ text: expect.stringContaining("[RESULT_CANDIDATE]") });

    // Changing an inherited field in a chart query is a disclosed deviation.
    const deviated = await run("set_answer_spec", { taskId: charts[1]!.details.taskId, fields: { filters: { value: "order_status = 'delivered'", basis: "assumed", rationale: "这张图只看已送达", reason: "只看已送达订单" } } });
    expect(deviated.text).toContain("偏离共享口径（发布时披露）: filters（只看已送达订单）");
  });

  it("refuses an assumed population while the user can still be asked, and keeps the other paths", async () => {
    const { run } = setup();
    const first = await run("set_answer_spec", { fields: {
      entity: { value: "orders", basis: "request", quote: "订单" },
      "filters.population": { value: "只含已送达订单", basis: "assumed", rationale: "看板一般只看已完成的订单" },
    } });
    expect(first.text).toContain("✓ entity");
    expect(first.text).toMatch(/✗ filters\.population: .*material population/);
  });
});
