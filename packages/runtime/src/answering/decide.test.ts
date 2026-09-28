import { describe, expect, it } from "vitest";
import { InMemoryAnswering, InMemoryAnsweringStore, InMemoryResultStore, type BusinessContext } from "./public.js";

const context = (invocationId: string): BusinessContext => ({ principal: { id: "user-1" }, sessionId: "session-1", lane: "main", operationId: "operation-1", invocationId });
const REQUEST = "How many delivered orders were counted in each delivery month of 2017?";
const spec = { entity: "orders", metric: "count", filters: [], groupBy: [], time: { state: "not_applicable" }, ranking: { state: "not_applicable" }, output: { rowMode: "scalar", rowCount: 1 } };
const rationale = "Delivered orders are counted in the month the delivery happened";

function service(populationDecisions?: "require_evidence" | "allow_disclosed") {
  return new InMemoryAnswering({
    store: new InMemoryAnsweringStore(),
    resultStore: new InMemoryResultStore(),
    sqlExecutor: { run: async (sql) => ({ columns: ["n"], rows: [[sql.includes("delivered") ? 205 : 265]], truncated: false }) },
    choiceProbes: true,
    ...(populationDecisions ? { populationDecisions } : {}),
    evidenceSource: { readUserMessage: async (_sessionId, messageId) => messageId === "message-1" ? REQUEST : undefined },
  });
}

async function probed(answering: InMemoryAnswering, affects: readonly string[] = ["time"]) {
  const view = await answering.begin({
    requestMessageId: "message-1",
    requestId: "begin",
    spec,
    choices: [{ localId: "c", affects, alternatives: [{ localId: "purchase", statement: "purchase month" }, { localId: "delivered", statement: "delivery month" }] }],
  } as never, context("begin"));
  const choice = view.choices[0]!;
  const [purchase, delivered] = choice.alternatives.map((alternative) => alternative.id);
  const probe = await answering.execute({ kind: "exploration", taskId: view.taskId, sql: "SELECT purchase", probe: { choiceId: choice.id, alternativeId: purchase! } }, context("p1"));
  await answering.execute({ kind: "exploration", taskId: view.taskId, sql: "SELECT delivered", probe: { choiceId: choice.id, alternativeId: delivered! } }, context("p2"));
  const observation = probe.artifact.kind === "exploration" ? probe.artifact.evidenceId : "";
  const revise = (requestId: string, disposition: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    answering.revise({ taskId: view.taskId, baseRevisionId: view.revisionId, requestId, dispositions: [{ action: "decide", choiceId: choice.id, ...disposition }], ...extra } as never, context(requestId));
  return { view, choiceId: choice.id, purchase: purchase!, delivered: delivered!, observation, revise };
}

describe("decide (ADR-0006)", () => {
  it("records a decision backed by qualifying evidence as selected", async () => {
    const { delivered, revise } = await probed(service());
    const decided = await revise("verified", { alternativeId: delivered, rationale, evidenceIds: ["q"] }, { evidence: [{ localId: "q", kind: "request_wording", quote: "each delivery month" }] });
    expect(decided.choices[0]).toMatchObject({ status: "selected", alternativeId: delivered, rationale });
  });

  it("records a decision with non-qualifying or no evidence as provisional instead of failing", async () => {
    const answering = service();
    const { delivered, observation, revise } = await probed(answering);
    const decided = await revise("unverified", { alternativeId: delivered, rationale, evidenceIds: [observation] });
    expect(decided.choices[0]).toMatchObject({ status: "provisional", alternativeId: delivered, rationale });
    const task = await answering.inspect({ taskId: decided.taskId }, context("inspect"));
    expect(task.currentRevision.choiceResolutions[0]).toMatchObject({ outcome: "provisional", disclosureRequired: true, citedEvidenceIds: [observation] });
    const bare = await probed(service());
    await expect(bare.revise("bare", { alternativeId: bare.purchase, rationale })).resolves.toMatchObject({ choices: [expect.objectContaining({ status: "provisional" })] });
  });

  it("rejects unknown evidence and a missing rationale", async () => {
    const { delivered, revise } = await probed(service());
    await expect(revise("unknown", { alternativeId: delivered, rationale, evidenceIds: ["evidence_missing"] })).rejects.toMatchObject({ code: "EVIDENCE_REJECTED" });
    await expect(revise("short", { alternativeId: delivered, rationale: "fits" })).rejects.toMatchObject({ code: "SPEC_TRANSITION_INVALID", message: expect.stringContaining("requires a rationale") });
  });

  it("keeps ADR-0005 preconditions: no decision before every alternative is probed", async () => {
    const answering = service();
    const view = await answering.begin({ requestMessageId: "message-1", requestId: "begin", spec, choices: [{ localId: "c", affects: ["time"], alternatives: [{ localId: "a", statement: "purchase month" }, { localId: "b", statement: "delivery month" }] }] } as never, context("begin"));
    const choice = view.choices[0]!;
    await expect(answering.revise({ taskId: view.taskId, baseRevisionId: view.revisionId, requestId: "early", dispositions: [{ action: "decide", choiceId: choice.id, alternativeId: choice.alternatives[0]!.id, rationale }] } as never, context("early")))
      .rejects.toMatchObject({ code: "SPEC_TRANSITION_INVALID", message: expect.stringContaining("probe {choiceId") });
  });

  it("blocks an unverified population decision only when a clarification path exists", async () => {
    const strict = await probed(service("require_evidence"), ["filters"]);
    await expect(strict.revise("strict", { alternativeId: strict.delivered, rationale })).rejects.toMatchObject({ code: "SPEC_TRANSITION_INVALID", message: expect.stringContaining("material population") });
    const verified = await strict.revise("strict-verified", { alternativeId: strict.delivered, rationale, evidenceIds: ["q"] }, { evidence: [{ localId: "q", kind: "request_wording", quote: "delivered orders" }] });
    expect(verified.choices[0]).toMatchObject({ status: "selected" });
    const headless = await probed(service("allow_disclosed"), ["filters"]);
    await expect(headless.revise("headless", { alternativeId: headless.delivered, rationale })).resolves.toMatchObject({ choices: [expect.objectContaining({ status: "provisional" })] });
  });

  it("applies the same rules to a decision made when the Choice is created", async () => {
    const answering = service();
    const reason = "The purchase month cannot be separated from other fields here";
    const view = await answering.begin({
      requestMessageId: "message-1",
      requestId: "begin",
      spec,
      choices: [{ localId: "c", affects: ["time"], alternatives: [{ localId: "a", statement: "purchase month" }, { localId: "b", statement: "delivery month" }], decidedAlternativeId: "b", decisionRationale: rationale }],
      notProbeable: [{ choiceId: "c", alternativeId: "a", reason }, { choiceId: "c", alternativeId: "b", reason }],
    } as never, context("begin"));
    expect(view.choices[0]).toMatchObject({ status: "provisional", rationale });
    await expect(answering.begin({
      requestMessageId: "message-1",
      requestId: "begin-no-reason",
      spec,
      choices: [{ localId: "c", affects: ["time"], alternatives: [{ localId: "a", statement: "purchase month" }, { localId: "b", statement: "delivery month" }], decidedAlternativeId: "b" }],
      notProbeable: [{ choiceId: "c", alternativeId: "a", reason }, { choiceId: "c", alternativeId: "b", reason }],
    } as never, context("begin-no-reason"))).rejects.toMatchObject({ code: "SPEC_TRANSITION_INVALID" });
  });
});
