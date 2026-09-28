import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUERY_BUDGET_POLICY,
  InMemoryAnswering,
  InMemoryAnsweringStore,
  InMemoryResultStore,
  type BusinessContext,
} from "./public.js";
import { resultFingerprint } from "./result-fingerprint.js";

const context = (invocationId: string): BusinessContext => ({
  principal: { id: "user-1" },
  sessionId: "session-1",
  lane: "main",
  operationId: "operation-1",
  invocationId,
});

const spec = { entity: "orders", metric: "count", filters: [], groupBy: [], time: { state: "not_applicable" }, ranking: { state: "not_applicable" }, output: { rowMode: "scalar", rowCount: 1 } };
const timeChoice = {
  localId: "time-event",
  affects: ["time"],
  alternatives: [
    { localId: "purchase", statement: "Count each order in the month it was purchased" },
    { localId: "delivered", statement: "Count each order in the month it was delivered" },
  ],
};

type Output = { columns: string[]; rows: unknown[][]; truncated: boolean };

function service(outputs: Record<string, Output>, options: { choiceProbes?: boolean; budgetPolicy?: typeof DEFAULT_QUERY_BUDGET_POLICY } = {}) {
  const calls: { sql: string; limit: number }[] = [];
  const answering = new InMemoryAnswering({
    store: new InMemoryAnsweringStore(),
    resultStore: new InMemoryResultStore(),
    sqlExecutor: {
      run: async (sql, limit) => {
        calls.push({ sql, limit });
        const output = outputs[sql];
        if (!output) throw new Error(`unexpected SQL ${sql}`);
        return output;
      },
    },
    choiceProbes: options.choiceProbes ?? true,
    ...(options.budgetPolicy ? { budgetPolicy: options.budgetPolicy } : {}),
  });
  return { answering, calls };
}

/** Every decision point declared: time_field by the Choice, the rest not applicable. */
const decisionPoints = ["population", "join_multiplicity", "time_field", "count_grain", "denominator", "window", "ties", "output_shape"]
  .map((name) => name === "time_field" ? { name, status: "choice", choiceId: "time-event" } : { name, status: "not_applicable" });

async function begin(answering: InMemoryAnswering, extra: Record<string, unknown> = {}) {
  const view = await answering.begin({ requestMessageId: "message-1", requestId: "begin-1", spec, choices: [timeChoice], decisionPoints, ...extra } as never, context("begin"));
  const choice = view.choices[0]!;
  return { view, choiceId: choice.id, purchase: choice.alternatives[0]!.id, delivered: choice.alternatives[1]!.id };
}

describe("result fingerprint", () => {
  it("ignores column names, column order and row order", () => {
    expect(resultFingerprint(["a", "b"], [[1, "x"], [2, "y"]])).toBe(resultFingerprint(["y", "z"], [["y", 2], ["x", 1]]));
  });

  it("compares numbers at two decimals and numeric text as numbers", () => {
    expect(resultFingerprint(["v"], [[1.004]])).toBe(resultFingerprint(["v"], [[1]]));
    expect(resultFingerprint(["v"], [["205"]])).toBe(resultFingerprint(["v"], [[205]]));
    expect(resultFingerprint(["v"], [[" x "]])).toBe(resultFingerprint(["v"], [["x"]]));
  });

  it("distinguishes different values, row counts and shapes", () => {
    expect(resultFingerprint(["v"], [[205]])).not.toBe(resultFingerprint(["v"], [[265]]));
    expect(resultFingerprint(["v"], [[1]])).not.toBe(resultFingerprint(["v"], [[1], [1]]));
    expect(resultFingerprint(["a", "b"], [[1, 2], [3, 4]])).not.toBe(resultFingerprint(["a", "b"], [[1, 4], [3, 2]]));
    expect(resultFingerprint(["v"], [[null]])).not.toBe(resultFingerprint(["v"], [[""]]));
  });
});

describe("Choice probes", () => {
  const outputs = {
    "SELECT purchase": { columns: ["n"], rows: [[265]], truncated: false },
    "SELECT delivered": { columns: ["n"], rows: [[205]], truncated: false },
    "SELECT delivered again": { columns: ["total"], rows: [[265.001]], truncated: false },
  };

  it("refuses to decide a Choice before every alternative has a probe", async () => {
    const { answering } = service(outputs);
    const { view, choiceId, purchase } = await begin(answering);
    expect(view.choices[0]).toMatchObject({ outputs: "incomplete", probes: [{ state: "missing" }, { state: "missing" }] });
    await expect(answering.revise({ taskId: view.taskId, baseRevisionId: view.revisionId, requestId: "decide", dispositions: [{ action: "provisional", choiceId, alternativeId: purchase }] }, context("decide")))
      .rejects.toMatchObject({ code: "SPEC_TRANSITION_INVALID", message: expect.stringContaining("probe {choiceId") });
  });

  it("refuses an inline decision on a new Choice unless every alternative is declared not probeable", async () => {
    const { answering } = service(outputs);
    await expect(answering.begin({ requestMessageId: "message-1", requestId: "begin-inline", spec, choices: [{ ...timeChoice, provisionalAlternativeId: "purchase" }] } as never, context("begin-inline")))
      .rejects.toMatchObject({ code: "SPEC_TRANSITION_INVALID" });
    const waived = await answering.begin({
      requestMessageId: "message-1",
      requestId: "begin-waived",
      spec,
      choices: [{ ...timeChoice, provisionalAlternativeId: "purchase", selectionRationale: "The request counts orders by their purchase month" }],
      notProbeable: [
        { choiceId: "time-event", alternativeId: "purchase", reason: "Needs a calendar table that is not in this database" },
        { choiceId: "time-event", alternativeId: "delivered", reason: "Needs a calendar table that is not in this database" },
      ],
    } as never, context("begin-waived"));
    expect(waived.choices[0]).toMatchObject({ status: "provisional", probes: [{ state: "waived" }, { state: "waived" }] });
  });

  it("records probe outputs, shows that they differ and then allows a decision", async () => {
    const { answering, calls } = service(outputs);
    const { view, choiceId, purchase, delivered } = await begin(answering);
    const first = await answering.execute({ kind: "exploration", taskId: view.taskId, sql: "SELECT purchase", probe: { choiceId, alternativeId: purchase } }, context("probe-purchase"));
    expect(first.probe).toMatchObject({ choiceId, alternativeId: purchase, state: "available", rowCount: 1 });
    expect(calls.at(-1)!.limit).toBe(10_000);
    await answering.execute({ kind: "exploration", taskId: view.taskId, sql: "SELECT delivered", probe: { choiceId, alternativeId: delivered } }, context("probe-delivered"));
    const decided = await answering.revise({ taskId: view.taskId, baseRevisionId: view.revisionId, requestId: "decide", dispositions: [{ action: "provisional", choiceId, alternativeId: delivered, rationale: "Delivered orders are counted when the delivery event happens" }] }, context("decide"));
    expect(decided.choices[0]).toMatchObject({ status: "provisional", outputs: "distinct" });
    expect(decided.choices[0]!.probes!.map((probe) => probe.state)).toEqual(["available", "available"]);
  });

  it("accepts equivalent only when every alternative produced the same output", async () => {
    const { answering } = service(outputs);
    const { view, choiceId, purchase, delivered } = await begin(answering);
    await answering.execute({ kind: "exploration", taskId: view.taskId, sql: "SELECT purchase", probe: { choiceId, alternativeId: purchase } }, context("probe-purchase"));
    await answering.execute({ kind: "exploration", taskId: view.taskId, sql: "SELECT delivered", probe: { choiceId, alternativeId: delivered } }, context("probe-delivered"));
    await expect(answering.revise({ taskId: view.taskId, baseRevisionId: view.revisionId, requestId: "equivalent-distinct", dispositions: [{ action: "equivalent", choiceId }] }, context("equivalent-distinct")))
      .rejects.toMatchObject({ code: "SPEC_TRANSITION_INVALID", message: expect.stringContaining("distinct") });
    // Re-probing an alternative replaces its record.
    await answering.execute({ kind: "exploration", taskId: view.taskId, sql: "SELECT delivered again", probe: { choiceId, alternativeId: delivered } }, context("probe-delivered-again"));
    const equivalent = await answering.revise({ taskId: view.taskId, baseRevisionId: view.revisionId, requestId: "equivalent", dispositions: [{ action: "equivalent", choiceId }] }, context("equivalent"));
    expect(equivalent.choices[0]).toMatchObject({ status: "equivalent", outputs: "identical" });
    expect(equivalent.choices[0]).not.toHaveProperty("alternativeId");
    expect(equivalent.unresolvedChoices).toEqual([]);
  });

  it("marks an over-cap probe output unavailable but counts it as probed", async () => {
    const { answering } = service({ ...outputs, "SELECT big": { columns: ["n"], rows: [[1]], truncated: true } });
    const { view, choiceId, purchase, delivered } = await begin(answering);
    await answering.execute({ kind: "exploration", taskId: view.taskId, sql: "SELECT big", probe: { choiceId, alternativeId: purchase } }, context("probe-big"));
    await answering.execute({ kind: "exploration", taskId: view.taskId, sql: "SELECT delivered", probe: { choiceId, alternativeId: delivered } }, context("probe-delivered"));
    const decided = await answering.revise({ taskId: view.taskId, baseRevisionId: view.revisionId, requestId: "decide", dispositions: [{ action: "provisional", choiceId, alternativeId: delivered, rationale: "Delivered orders are counted when the delivery event happens" }] }, context("decide"));
    expect(decided.choices[0]).toMatchObject({ outputs: "incomplete", probes: [{ state: "unavailable" }, { state: "available" }] });
  });

  it("does not charge probes to the exploration budget and shows only a bounded preview", async () => {
    const many = { columns: ["n"], rows: Array.from({ length: 300 }, (_, index) => [index]), truncated: false };
    const { answering } = service({ ...outputs, "SELECT many": many }, { budgetPolicy: { ...DEFAULT_QUERY_BUDGET_POLICY, maxExplorationAttempts: 1 } });
    const { view, choiceId, purchase, delivered } = await begin(answering);
    const probe = await answering.execute({ kind: "exploration", taskId: view.taskId, sql: "SELECT many", probe: { choiceId, alternativeId: purchase } }, context("probe-many"));
    expect(probe.preview.rows).toHaveLength(50);
    expect(probe.probe).toMatchObject({ rowCount: 300, state: "available" });
    await answering.execute({ kind: "exploration", taskId: view.taskId, sql: "SELECT delivered", probe: { choiceId, alternativeId: delivered } }, context("probe-delivered"));
    await expect(answering.execute({ kind: "exploration", taskId: view.taskId, sql: "SELECT purchase" }, context("explore"))).resolves.toMatchObject({ kind: "exploration" });
  });

  it("rejects probes of unknown alternatives and probes when tracking is off", async () => {
    const { answering } = service(outputs);
    const { view, choiceId } = await begin(answering);
    await expect(answering.execute({ kind: "exploration", taskId: view.taskId, sql: "SELECT purchase", probe: { choiceId, alternativeId: "alternative_missing" } }, context("probe-missing")))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
    const off = service(outputs, { choiceProbes: false });
    const legacy = await begin(off.answering);
    expect(legacy.view.choices[0]).not.toHaveProperty("probes");
    await expect(off.answering.execute({ kind: "exploration", taskId: legacy.view.taskId, sql: "SELECT purchase", probe: { choiceId: legacy.choiceId, alternativeId: legacy.purchase } }, context("probe-off")))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(off.answering.revise({ taskId: legacy.view.taskId, baseRevisionId: legacy.view.revisionId, requestId: "decide", dispositions: [{ action: "provisional", choiceId: legacy.choiceId, alternativeId: legacy.purchase }] }, context("decide-off")))
      .resolves.toMatchObject({ choices: [expect.objectContaining({ status: "provisional" })] });
  });

  it("blocks a result that reproduces the output of an alternative the Revision did not adopt", async () => {
    const { answering } = service({ ...outputs, "SELECT final purchase": { columns: ["orders"], rows: [["265"]], truncated: false }, "SELECT final delivered": { columns: ["orders"], rows: [[205]], truncated: false } });
    const { view, choiceId, purchase, delivered } = await begin(answering);
    await answering.execute({ kind: "exploration", taskId: view.taskId, sql: "SELECT purchase", probe: { choiceId, alternativeId: purchase } }, context("probe-purchase"));
    await answering.execute({ kind: "exploration", taskId: view.taskId, sql: "SELECT delivered", probe: { choiceId, alternativeId: delivered } }, context("probe-delivered"));
    const decided = await answering.revise({ taskId: view.taskId, baseRevisionId: view.revisionId, requestId: "decide", dispositions: [{ action: "provisional", choiceId, alternativeId: delivered, rationale: "Delivered orders are counted when the delivery event happens" }] }, context("decide"));
    const blocked = await answering.execute({ kind: "result", taskId: view.taskId, revisionId: decided.revisionId, sql: "SELECT final purchase" }, context("result-purchase")).catch((error: unknown) => error);
    expect(blocked).toMatchObject({
      code: "CHOICE_NOT_REALIZED",
      message: expect.stringContaining(`adopted ${delivered}, but the result equals the probe output of ${purchase}`),
      obstacle: { kind: "business_judgment_required", retryable: true },
      details: { conflicts: [{ choiceId, adoptedAlternativeId: delivered, realizedAlternativeId: purchase }] },
    });
    const accepted = await answering.execute({ kind: "result", taskId: view.taskId, revisionId: decided.revisionId, sql: "SELECT final delivered" }, context("result-delivered"));
    expect(accepted.artifact.kind).toBe("candidate");
  });

  it("does not block a result when the rejected alternative was never probed", async () => {
    const { answering } = service({ ...outputs, "SELECT final purchase": { columns: ["orders"], rows: [[265]], truncated: false } });
    const waiver = "The purchase month cannot be separated from other fields in this query";
    const view = await answering.begin({
      requestMessageId: "message-1",
      requestId: "begin-waived",
      spec,
      choices: [{ ...timeChoice, provisionalAlternativeId: "delivered", selectionRationale: "Delivered orders are counted when the delivery event happens" }],
      notProbeable: [{ choiceId: "time-event", alternativeId: "purchase", reason: waiver }, { choiceId: "time-event", alternativeId: "delivered", reason: waiver }],
      decisionPoints,
    } as never, context("begin-waived"));
    await expect(answering.execute({ kind: "result", taskId: view.taskId, revisionId: view.revisionId, sql: "SELECT final purchase" }, context("result"))).resolves.toMatchObject({ artifact: { kind: "candidate" } });
  });
});
