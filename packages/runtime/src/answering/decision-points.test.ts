import { describe, expect, it } from "vitest";
import { InMemoryAnswering, InMemoryAnsweringStore, InMemoryResultStore, type BusinessContext } from "./public.js";
import { DECISION_POINTS } from "./decision-points.js";

const context = (invocationId: string): BusinessContext => ({ principal: { id: "user-1" }, sessionId: "session-1", lane: "main", operationId: "operation-1", invocationId });
const spec = { entity: "orders", metric: "count", filters: [], groupBy: [], time: { state: "not_applicable" }, ranking: { state: "not_applicable" }, output: { rowMode: "scalar", rowCount: 1 } };
const REQUEST = "How many delivered orders were placed in each month of 2017?";

function service(choiceProbes = true) {
  return new InMemoryAnswering({
    store: new InMemoryAnsweringStore(),
    resultStore: new InMemoryResultStore(),
    sqlExecutor: { run: async () => ({ columns: ["n"], rows: [[1]], truncated: false }) },
    choiceProbes,
    evidenceSource: { readUserMessage: async (_sessionId, messageId) => messageId === "message-1" ? REQUEST : undefined },
  });
}

const rest = (except: readonly string[]) => DECISION_POINTS.filter((name) => !except.includes(name)).map((name) => ({ name, status: "not_applicable" }));

describe("decision points", () => {
  it("blocks the result query until every decision point is declared, then allows it", async () => {
    const answering = service();
    const begun = await answering.begin({ requestMessageId: "message-1", requestId: "begin", spec, decisionPoints: [{ name: "population", status: "not_applicable" }] } as never, context("begin"));
    expect(begun.undeclaredDecisionPoints).toEqual(DECISION_POINTS.filter((name) => name !== "population"));
    await expect(answering.execute({ kind: "exploration", taskId: begun.taskId, sql: "SELECT 1" }, context("explore"))).resolves.toMatchObject({ kind: "exploration" });
    await expect(answering.execute({ kind: "result", taskId: begun.taskId, revisionId: begun.revisionId, sql: "SELECT 1" }, context("result-blocked"))).rejects.toMatchObject({
      code: "UNRESOLVED_ASSUMPTIONS",
      message: expect.stringContaining("declare decision points: join_multiplicity"),
      details: { undeclaredDecisionPoints: expect.arrayContaining(["time_field", "output_shape"]) },
    });
    const declared = await answering.revise({ taskId: begun.taskId, baseRevisionId: begun.revisionId, requestId: "declare", decisionPoints: [
      { name: "time_field", status: "fixed_by_request", quote: "placed in each month" },
      ...rest(["population", "time_field"]),
    ] } as never, context("declare"));
    expect(declared.undeclaredDecisionPoints).toEqual([]);
    expect(declared.decisionPoints).toMatchObject({ population: { status: "not_applicable" }, time_field: { status: "fixed_by_request", quote: "placed in each month" } });
    await expect(answering.execute({ kind: "result", taskId: begun.taskId, revisionId: declared.revisionId, sql: "SELECT 1" }, context("result"))).resolves.toMatchObject({ artifact: { kind: "candidate" } });
  });

  it("rejects a fixed_by_request quote that is not in the original request", async () => {
    const answering = service();
    await expect(answering.begin({ requestMessageId: "message-1", requestId: "begin", spec, decisionPoints: [{ name: "time_field", status: "fixed_by_request", quote: "by delivery date" }] } as never, context("begin")))
      .rejects.toMatchObject({ code: "EVIDENCE_REJECTED" });
  });

  it("binds declarations to Choices and Hypotheses and keeps them consistent across supersession", async () => {
    const answering = service();
    const begun = await answering.begin({
      requestMessageId: "message-1",
      requestId: "begin",
      spec,
      hypotheses: [{ localId: "unique", kind: "data_property", statement: "order_id is unique", affects: ["metric"], basis: "schema", impact: "count rows" }],
      choices: [{ localId: "time", affects: ["time"], alternatives: [{ localId: "a", statement: "purchase month" }, { localId: "b", statement: "delivery month" }] }],
      decisionPoints: [{ name: "time_field", status: "choice", choiceId: "time" }, { name: "count_grain", status: "assumed", hypothesisId: "unique" }],
    } as never, context("begin"));
    const choiceId = begun.choices[0]!.id;
    expect(begun.decisionPoints).toMatchObject({ time_field: { status: "choice", choiceId }, count_grain: { status: "assumed", hypothesisId: begun.hypotheses[0]!.id } });
    await expect(answering.begin({ requestMessageId: "message-1", requestId: "begin-bad", spec, decisionPoints: [{ name: "ties", status: "choice", choiceId: "missing" }] } as never, context("begin-bad")))
      .rejects.toMatchObject({ code: "SPEC_TRANSITION_INVALID", message: expect.stringContaining("unknown choice missing") });
    await expect(answering.revise({
      taskId: begun.taskId,
      baseRevisionId: begun.revisionId,
      requestId: "supersede",
      addChoices: [{ localId: "time2", affects: ["time"], alternatives: [{ localId: "c", statement: "purchase month in UTC" }, { localId: "d", statement: "delivery month in UTC" }] }],
      dispositions: [{ action: "supersede", targetId: choiceId, replacementIds: ["time2"], reason: "Split by timezone" }],
    } as never, context("supersede"))).rejects.toMatchObject({ code: "SPEC_TRANSITION_INVALID", message: expect.stringContaining("time_field still references removed item") });
    const moved = await answering.revise({
      taskId: begun.taskId,
      baseRevisionId: begun.revisionId,
      requestId: "supersede-moved",
      addChoices: [{ localId: "time2", affects: ["time"], alternatives: [{ localId: "c", statement: "purchase month in UTC" }, { localId: "d", statement: "delivery month in UTC" }] }],
      dispositions: [{ action: "supersede", targetId: choiceId, replacementIds: ["time2"], reason: "Split by timezone" }],
      decisionPoints: [{ name: "time_field", status: "choice", choiceId: "time2" }],
    } as never, context("supersede-moved"));
    expect(moved.decisionPoints!.time_field).toMatchObject({ status: "choice", choiceId: moved.choices.find((item) => item.status === "unresolved")!.id });
  });

  it("leaves Answering without Choice governance and legacy revisions exempt", async () => {
    const answering = service(false);
    const begun = await answering.begin({ requestMessageId: "message-1", requestId: "begin", spec }, context("begin"));
    expect(begun).not.toHaveProperty("undeclaredDecisionPoints");
    await expect(answering.execute({ kind: "result", taskId: begun.taskId, revisionId: begun.revisionId, sql: "SELECT 1" }, context("result"))).resolves.toMatchObject({ artifact: { kind: "candidate" } });
  });
});
