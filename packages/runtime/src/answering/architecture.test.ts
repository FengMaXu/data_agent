import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { ANSWERING_QUERY_PARAMETERS, BEGIN_ANSWER_SPEC_PARAMETERS, REVISE_ANSWER_SPEC_PARAMETERS, createAnsweringAgentToolDefinitions, prepareSpecArguments } from "../tools/answering.js";
import { InMemoryAnsweringStore, type AnsweringStore, type AnsweringTransaction } from "./answering-store.js";
import { InMemoryAnswering } from "./service.js";
import { InMemoryResultStore } from "./result-store.js";
import type { BusinessContext } from "./model.js";

const context = (invocationId: string): BusinessContext => ({
  principal: { id: "user-1" },
  sessionId: "session-1",
  lane: "main",
  operationId: "operation-1",
  invocationId,
});

class GateEncodingResultStore extends InMemoryResultStore {
  started!: () => void;
  release!: () => void;
  private readonly startedPromise = new Promise<void>((resolve) => { this.started = resolve; });
  private readonly releasePromise = new Promise<void>((resolve) => { this.release = resolve; });
  waitUntilStarted(): Promise<void> { return this.startedPromise; }
  override async encodeCsv(ref: Parameters<InMemoryResultStore["encodeCsv"]>[0], context: BusinessContext) {
    this.started();
    await this.releasePromise;
    return super.encodeCsv(ref, context);
  }
}

class FailOnceAtReceiptCommit implements AnsweringStore {
  private failed = false;
  constructor(private delegate: InMemoryAnsweringStore, private readonly responseLost: boolean) {}

  async transact<T>(command: (state: AnsweringTransaction) => T | Promise<T>, context: BusinessContext): Promise<T> {
    let wroteReceipt = false;
    const before = this.delegate.snapshot();
    const answer = await this.delegate.transact((tx) => command(new Proxy(tx, {
      get(target, property, receiver) {
        if (property === "putReceipt") return (...args: Parameters<AnsweringTransaction["putReceipt"]>) => { wroteReceipt = true; return target.putReceipt(...args); };
        return Reflect.get(target, property, receiver);
      },
    })), context);
    if (wroteReceipt && !this.failed) {
      this.failed = true;
      if (!this.responseLost) this.delegate = new InMemoryAnsweringStore(before);
      throw new Error(this.responseLost ? "RECEIPT_RESPONSE_LOST" : "RECEIPT_COMMIT_FAILED");
    }
    return answer;
  }

  inspect(taskId: Parameters<AnsweringStore["inspect"]>[0], context: BusinessContext) { return this.delegate.inspect(taskId, context); }
  list(context: BusinessContext) { return this.delegate.list(context); }
  listReferencedResultRefs(context: BusinessContext) { return this.delegate.listReferencedResultRefs(context); }
}

const scalarSpec = {
  entity: "orders",
  metric: "count",
  filters: [],
  groupBy: [],
  time: { state: "not_applicable" },
  ranking: { state: "not_applicable" },
  output: { rowMode: "scalar", rowCount: 1 },
};

describe("Answering architecture boundaries", () => {
  it("uses strict discriminated tool schemas instead of conditional optional fields", () => {
    expect(Value.Check(BEGIN_ANSWER_SPEC_PARAMETERS, { spec: scalarSpec })).toBe(true);
    expect(Value.Check(BEGIN_ANSWER_SPEC_PARAMETERS, { spec: {
        entity: { value: { name: "players", keyColumns: ["player_id"] } },
        metric: { value: { kind: "average", expression: "AVG(career_days)", unit: "days" } },
        filters: [{ value: "debut IS NOT NULL" }],
        groupBy: [],
        time: { value: { expression: "final_game - debut", boundary: "inclusive" } },
        ranking: { state: "not_applicable" },
        output: { value: { rowMode: "scalar", rowCount: 1, columns: ["average_days"] } },
      },
    })).toBe(true);
    expect(Value.Check(BEGIN_ANSWER_SPEC_PARAMETERS, { spec: { ...scalarSpec, groupBy: { expression: "team_id" } } })).toBe(false);
    expect(Value.Check(BEGIN_ANSWER_SPEC_PARAMETERS, { spec: { ...scalarSpec, time: { value: { field: "debut" } } } })).toBe(false);
    expect(Value.Check(BEGIN_ANSWER_SPEC_PARAMETERS, { spec: scalarSpec, evidence: [{ kind: "query_observation", sourceRef: "invented", preview: {} }] })).toBe(false);
    expect(Value.Check(REVISE_ANSWER_SPEC_PARAMETERS, { taskId: "task-1", spec: scalarSpec })).toBe(false);
    // ADR-0004: revise is a delta; the old full-proposal fields are rejected, not silently ignored.
    expect(Value.Check(REVISE_ANSWER_SPEC_PARAMETERS, { taskId: "task-1", baseRevisionId: "revision-1", spec: scalarSpec, hypotheses: [] })).toBe(false);
    expect(Value.Check(REVISE_ANSWER_SPEC_PARAMETERS, { taskId: "task-1", baseRevisionId: "revision-1", choices: [] })).toBe(false);
    expect(Value.Check(REVISE_ANSWER_SPEC_PARAMETERS, { taskId: "task-1",
      baseRevisionId: "revision-1",
      spec: { metric: { value: "count", evidenceIds: ["q"] } },
      evidence: [{ localId: "q", kind: "request_wording", quote: "订单数" }],
      dispositions: [
        { action: "support", hypothesisId: "hypothesis-1", evidenceIds: ["q"] },
        { action: "decide", choiceId: "choice-1", alternativeId: "alternative-1", rationale: "Counted in the delivery month because the request says delivered" },
        { action: "supersede", targetId: "choice-2", replacementIds: ["new-choice"], reason: "reframed" },
      ],
    })).toBe(true);
    expect(Value.Check(REVISE_ANSWER_SPEC_PARAMETERS, { taskId: "task-1", baseRevisionId: "revision-1", dispositions: [{ action: "support", hypothesisId: "h", evidenceIds: [] }] })).toBe(false);
    // ADR-0006: the model has one decision action; select/provisional are not model-facing.
    expect(Value.Check(REVISE_ANSWER_SPEC_PARAMETERS, { taskId: "task-1", baseRevisionId: "revision-1", dispositions: [{ action: "provisional", choiceId: "c", alternativeId: "a" }] })).toBe(false);
    expect(Value.Check(REVISE_ANSWER_SPEC_PARAMETERS, { taskId: "task-1", baseRevisionId: "revision-1", dispositions: [{ action: "decide", choiceId: "c", alternativeId: "a" }] })).toBe(false);
    expect(Value.Check(BEGIN_ANSWER_SPEC_PARAMETERS, { kind: "begin", spec: scalarSpec })).toBe(false);
    expect(Value.Check(ANSWERING_QUERY_PARAMETERS, { kind: "result", taskId: "task-1", sql: "SELECT 1" })).toBe(false);
    expect(Value.Check(ANSWERING_QUERY_PARAMETERS, { kind: "exploration", taskId: "task-1", revisionId: "revision-1", sql: "SELECT 1" })).toBe(false);
    expect(Value.Check(ANSWERING_QUERY_PARAMETERS, { kind: "result", taskId: "task-1", revisionId: "revision-1", sql: "SELECT 1" })).toBe(true);
  });

  it("repairs nested begin fields and single filter/groupBy entries before validation", () => {
    const prepare = prepareSpecArguments(["hypotheses", "choices", "notProbeable", "decisionPoints", "evidence"]);
    const prepared = prepare({
      kind: "begin",
      spec: { ...scalarSpec, groupBy: { value: "team_id" }, choices: [{ localId: "c" }], evidence: [{ localId: "q" }] },
      evidence: [{ localId: "top" }],
    });
    expect(prepared).toEqual({
      // A top-level field wins; the nested copy stays where it was and is still rejected by the schema.
      spec: { ...scalarSpec, groupBy: [{ value: "team_id" }], evidence: [{ localId: "q" }] },
      choices: [{ localId: "c" }],
      evidence: [{ localId: "top" }],
    });
    expect(Value.Check(BEGIN_ANSWER_SPEC_PARAMETERS, prepared)).toBe(false);
    const lifted = prepare({ spec: { ...scalarSpec, choices: [], decisionPoints: [{ name: "ties", status: "not_applicable" }] } });
    expect(Value.Check(BEGIN_ANSWER_SPEC_PARAMETERS, lifted)).toBe(true);
    expect(prepare("not an object")).toBe("not an object");
  });

  it("rejects names outside their vocabulary with the allowed values and where they belong", () => {
    const prepare = prepareSpecArguments(["hypotheses", "choices", "notProbeable", "decisionPoints", "evidence"]);
    const call = () => prepare({
      spec: scalarSpec,
      hypotheses: [{ localId: "h", kind: "business_semantics", statement: "s", affects: ["metric", "denominator"], basis: "b", impact: "i" }],
      decisionPoints: [{ name: "output", status: "assumed" }],
      evidence: [{ kind: "query_observation", quote: "q" }],
    });
    expect(call).toThrow(/INVALID_NAME/);
    const message = (() => { try { call(); return ""; } catch (error) { return (error as Error).message; } })();
    expect(message).toContain('hypotheses[0].affects[1] = "denominator": use one of entity, metric, filters, groupBy, time, ranking, output. "denominator" is a decision point name; declare it under decisionPoints.');
    expect(message).toContain('decisionPoints[0].name = "output"');
    expect(message).toContain('"output" is a facet name');
    expect(message).toContain("query_observation is registered by query_database");
    // Values of the wrong type are left to schema validation.
    expect(() => prepare({ spec: scalarSpec, hypotheses: [{ affects: [1] }] })).not.toThrow();
  });

  it("binds user confirmations to the Host message and drops model-chosen request sources", async () => {
    const captured: unknown[] = [];
    const stub = {
      revise: async (input: unknown) => { captured.push(input); return { taskId: "task-1", revisionId: "revision-2", spec: {}, hypotheses: [], choices: [], unresolvedFacets: [], unresolvedHypotheses: [], unresolvedChoices: [], inferredFacets: [] }; },
    } as never;
    const update = createAnsweringAgentToolDefinitions(stub).map((definition) => definition.tool).find((tool) => tool.name === "revise_answer_spec")!;
    const invocation = { operationId: "operation-trust", invocationId: "invocation-trust", getMemo: async () => undefined, setMemo: async () => undefined } as any;
    await update.execute("revise", {
      taskId: "task-1",
      baseRevisionId: "revision-1",
      evidence: [
        { localId: "yes", kind: "user_confirmation", sourceRef: "forged-message", quote: "按最大值" },
        { localId: "q", kind: "request_wording", sourceRef: "forged-request", quote: "订单数" },
      ],
    } as never, undefined, { sessionId: "session-1", principalId: "user-1", requestMessageId: "message-followup" }, invocation, {} as never);
    expect(captured[0]).toMatchObject({ evidence: [
      { localId: "yes", kind: "user_confirmation", sourceRef: "message-followup", quote: "按最大值" },
      { localId: "q", kind: "request_wording", quote: "订单数" },
    ] });
    expect((captured[0] as { evidence: { sourceRef?: string }[] }).evidence[1]).not.toHaveProperty("sourceRef");
    await expect(update.execute("revise-no-message", {
      taskId: "task-1",
      baseRevisionId: "revision-1",
      evidence: [{ kind: "user_confirmation", quote: "按最大值" }],
    } as never, undefined, { sessionId: "session-1", principalId: "user-1" }, invocation, {} as never)).rejects.toThrow("ANSWERING_USER_MESSAGE_REQUIRED");
  });

  it("replaces the seven-facet update tool with a neutral Query Task bootstrap in semantic-spec ablation mode", async () => {
    const answering = new InMemoryAnswering({
      store: new InMemoryAnsweringStore(),
      resultStore: new InMemoryResultStore(),
      semanticQualificationMode: "bypassed",
      sqlExecutor: { run: async () => ({ columns: ["value"], rows: [[1]], truncated: false }) },
    });
    const definitions = createAnsweringAgentToolDefinitions(answering, undefined, undefined, { semanticSpecMode: "disabled" });
    const tools = definitions.map((definition) => definition.tool);
    expect(tools.map((tool) => tool.name)).toContain("begin_query_task");
    expect(tools.map((tool) => tool.name)).not.toContain("begin_answer_spec");
    expect(tools.map((tool) => tool.name)).not.toContain("revise_answer_spec");
    const begin = tools.find((tool) => tool.name === "begin_query_task")!;
    const invocation = (invocationId: string) => ({
      operationId: "operation-ablation",
      invocationId,
      getMemo: async () => undefined,
      setMemo: async () => undefined,
    }) as any;
    const toolContext = { sessionId: "session-1", principalId: "user-1", requestMessageId: "message-ablation" };
    const begun = await begin.execute("begin", {}, undefined, toolContext, invocation("begin-ablation"), {} as never);
    const view = begun.details as { taskId: string; revisionId: string; unresolvedFacets: string[] };
    expect(view.unresolvedFacets).toEqual(["entity", "metric", "time", "ranking", "output", "filters", "groupBy"]);
    const duplicate = await begin.execute("begin-again", {}, undefined, toolContext, invocation("begin-ablation-again"), {} as never);
    expect(duplicate.details).toMatchObject({ taskId: view.taskId, revisionId: view.revisionId });
    const query = tools.find((tool) => tool.name === "query_database")!;
    const candidate = await query.execute("result", { kind: "result", taskId: view.taskId, revisionId: view.revisionId, sql: "SELECT 1" } as never, undefined, toolContext, invocation("result-ablation"), {} as never);
    expect((candidate.content[0] as { text: string }).text).toMatch(/^\[RESULT_CANDIDATE\] candidateId=candidate_/);
    const candidateId = (candidate.details as { artifact: { candidateId: string } }).artifact.candidateId;
    const publish = tools.find((tool) => tool.name === "export_query")!;
    const receipt = await publish.execute("publish", { candidateId, format: "csv" }, undefined, toolContext, invocation("publish-ablation"), {} as never);
    expect(receipt.details).toMatchObject({ candidateId, format: "csv" });
  });

  it("places host-generated exploration and candidate handles in model-visible tool text", async () => {
    const answering = new InMemoryAnswering({
      store: new InMemoryAnsweringStore(),
      resultStore: new InMemoryResultStore(),
      sqlExecutor: { run: async () => ({ columns: ["value"], rows: [[1]], truncated: false }) },
    });
    const begun = await answering.begin({ requestMessageId: "message-handles", requestId: "begin-handles", spec: scalarSpec }, context("begin-handles"));
    const query = createAnsweringAgentToolDefinitions(answering).map((definition) => definition.tool).find((tool) => tool.name === "query_database")!;
    const invocation = (invocationId: string) => ({
      operationId: "operation-handles",
      invocationId,
      getMemo: async () => undefined,
      setMemo: async () => undefined,
    }) as any;
    const toolContext = { sessionId: "session-1", principalId: "user-1" };

    const exploration = await query.execute("explore", { kind: "exploration", taskId: begun.taskId, sql: "SELECT 1" } as never, undefined, toolContext, invocation("explore-handles"), {} as never);
    expect((exploration.content[0] as { text: string }).text).toMatch(/^\[EXPLORATION_EVIDENCE\] evidenceId=evidence_/);
    expect((exploration.content[0] as { text: string }).text).toContain("do not resubmit the observation body");

    const candidate = await query.execute("result", { kind: "result", taskId: begun.taskId, revisionId: begun.revisionId, sql: "SELECT 1" } as never, undefined, toolContext, invocation("result-handles"), {} as never);
    expect((candidate.content[0] as { text: string }).text).toMatch(/^\[RESULT_CANDIDATE\] candidateId=candidate_/);
  });

  it("executes result SQL once and publishes only the immutable candidate", async () => {
    let calls = 0;
    const answering = new InMemoryAnswering({
      store: new InMemoryAnsweringStore(),
      resultStore: new InMemoryResultStore(),
      sqlExecutor: { run: async () => { calls += 1; return { columns: ["value"], rows: [[1]], truncated: false }; } },
    });
    const begun = await answering.begin({ requestMessageId: "message-1", requestId: "begin-1", spec: scalarSpec }, context("begin-1"));
    const execution = await answering.execute({ kind: "result", taskId: begun.taskId, revisionId: begun.revisionId, sql: "SELECT 1" }, context("execute-1"));
    if (execution.artifact.kind !== "candidate") throw new Error("expected Result Candidate");
    const receipt = await answering.publish({ candidateId: execution.artifact.candidateId, format: "auto", requestId: "publish-1" }, context("publish-1"));
    const retry = await answering.publish({ candidateId: execution.artifact.candidateId, format: "auto", requestId: "publish-2" }, context("publish-2"));
    expect(calls).toBe(1);
    expect(retry).toEqual(receipt);
    expect(receipt.revisionId).toBe(execution.artifact.revisionId);
    expect(receipt.resultRef).toBe(execution.artifact.resultRef);
    expect(receipt.contentHash).toBeTruthy();
    expect(receipt.policyVersion).toBe("answering-publication-v1");
  });

  it("marks a Candidate corrupt when its private object disappears, including Receipt retry", async () => {
    const resultStore = new InMemoryResultStore();
    const answering = new InMemoryAnswering({
      store: new InMemoryAnsweringStore(),
      resultStore,
      sqlExecutor: { run: async () => ({ columns: ["value"], rows: [[1]], truncated: false }) },
    });
    const begun = await answering.begin({ requestMessageId: "message-integrity", requestId: "begin-integrity", spec: scalarSpec }, context("begin-integrity"));
    const execution = await answering.execute({ kind: "result", taskId: begun.taskId, revisionId: begun.revisionId, sql: "SELECT 1" }, context("execute-integrity"));
    if (execution.artifact.kind !== "candidate") throw new Error("expected Result Candidate");
    await resultStore.discard(execution.artifact.resultRef, context("discard-integrity"));
    await expect(answering.publish({ candidateId: execution.artifact.candidateId, format: "inline", requestId: "publish-integrity" }, context("publish-integrity"))).rejects.toMatchObject({ code: "RESULT_INTEGRITY_MISMATCH" });
    await expect(answering.inspect({ taskId: begun.taskId }, context("inspect-integrity"))).resolves.toMatchObject({ candidate: { status: "corrupt", publishable: false } });
  });

  it("does not return a committed Receipt when its ResultStore object is later lost", async () => {
    const resultStore = new InMemoryResultStore();
    const answering = new InMemoryAnswering({
      store: new InMemoryAnsweringStore(),
      resultStore,
      sqlExecutor: { run: async () => ({ columns: ["value"], rows: [[1]], truncated: false }) },
    });
    const begun = await answering.begin({ requestMessageId: "message-receipt-loss", requestId: "begin-receipt-loss", spec: scalarSpec }, context("begin-receipt-loss"));
    const execution = await answering.execute({ kind: "result", taskId: begun.taskId, revisionId: begun.revisionId, sql: "SELECT 1" }, context("execute-receipt-loss"));
    if (execution.artifact.kind !== "candidate") throw new Error("expected Result Candidate");
    const receipt = await answering.publish({ candidateId: execution.artifact.candidateId, format: "inline", requestId: "publish-receipt-loss" }, context("publish-receipt-loss"));
    await resultStore.discard(execution.artifact.resultRef, context("discard-receipt-loss"));
    await expect(answering.publish({ candidateId: execution.artifact.candidateId, format: "inline", requestId: "publish-receipt-retry" }, context("publish-receipt-retry"))).rejects.toMatchObject({ code: "RESULT_INTEGRITY_MISMATCH" });
    expect(receipt.resultRef).toBe(execution.artifact.resultRef);
  });

  it("rejects publication when the current Revision changes during encoding", async () => {
    const resultStore = new GateEncodingResultStore();
    let calls = 0;
    const answering = new InMemoryAnswering({
      store: new InMemoryAnsweringStore(),
      resultStore,
      sqlExecutor: { run: async () => { calls += 1; return { columns: ["value"], rows: [[1]], truncated: false }; } },
    });
    const begun = await answering.begin({ requestMessageId: "message-publish-race", requestId: "begin-publish-race", spec: scalarSpec }, context("begin-publish-race"));
    const execution = await answering.execute({ kind: "result", taskId: begun.taskId, revisionId: begun.revisionId, sql: "SELECT 1" }, context("execute-publish-race"));
    if (execution.artifact.kind !== "candidate") throw new Error("expected candidate");
    const publishing = answering.publish({ candidateId: execution.artifact.candidateId, format: "inline", requestId: "publish-race" }, context("publish-race"));
    await resultStore.waitUntilStarted();
    await answering.revise({ taskId: begun.taskId, baseRevisionId: begun.revisionId, requestId: "revise-during-publish", spec: scalarSpec }, context("revise-during-publish"));
    resultStore.release();
    await expect(publishing).rejects.toMatchObject({ code: "PUBLICATION_STALE" });
    await expect(answering.inspect({ taskId: begun.taskId }, context("inspect-publish-race"))).resolves.not.toHaveProperty("publication");
    expect(calls).toBe(1);
  });

  it("keeps publication invisible before Receipt commit and recovers after retry", async () => {
    const store = new FailOnceAtReceiptCommit(new InMemoryAnsweringStore(), false);
    let calls = 0;
    const answering = new InMemoryAnswering({
      store,
      resultStore: new InMemoryResultStore(),
      sqlExecutor: { run: async () => { calls += 1; return { columns: ["value"], rows: [[1]], truncated: false }; } },
    });
    const begun = await answering.begin({ requestMessageId: "message-receipt-fail", requestId: "begin-receipt-fail", spec: scalarSpec }, context("begin-receipt-fail"));
    const execution = await answering.execute({ kind: "result", taskId: begun.taskId, revisionId: begun.revisionId, sql: "SELECT 1" }, context("execute-receipt-fail"));
    if (execution.artifact.kind !== "candidate") throw new Error("expected candidate");
    await expect(answering.publish({ candidateId: execution.artifact.candidateId, format: "inline", requestId: "publish-receipt-fail" }, context("publish-receipt-fail"))).rejects.toThrow("RECEIPT_COMMIT_FAILED");
    await expect(answering.inspect({ taskId: begun.taskId }, context("inspect-before-retry"))).resolves.not.toHaveProperty("publication");
    const receipt = await answering.publish({ candidateId: execution.artifact.candidateId, format: "inline", requestId: "publish-receipt-fail" }, context("publish-receipt-retry"));
    expect(receipt.candidateId).toBe(execution.artifact.candidateId);
    expect(calls).toBe(1);
  });

  it("finds the same Receipt when commit succeeded but its response was lost", async () => {
    const store = new FailOnceAtReceiptCommit(new InMemoryAnsweringStore(), true);
    let calls = 0;
    const answering = new InMemoryAnswering({
      store,
      resultStore: new InMemoryResultStore(),
      sqlExecutor: { run: async () => { calls += 1; return { columns: ["value"], rows: [[1]], truncated: false }; } },
    });
    const begun = await answering.begin({ requestMessageId: "message-receipt-lost", requestId: "begin-receipt-lost", spec: scalarSpec }, context("begin-receipt-lost"));
    const execution = await answering.execute({ kind: "result", taskId: begun.taskId, revisionId: begun.revisionId, sql: "SELECT 1" }, context("execute-receipt-lost"));
    if (execution.artifact.kind !== "candidate") throw new Error("expected candidate");
    await expect(answering.publish({ candidateId: execution.artifact.candidateId, format: "inline", requestId: "publish-receipt-lost" }, context("publish-receipt-lost"))).rejects.toThrow("RECEIPT_RESPONSE_LOST");
    const committed = (await answering.inspect({ taskId: begun.taskId }, context("inspect-committed"))).publication;
    const recovered = await answering.publish({ candidateId: execution.artifact.candidateId, format: "inline", requestId: "publish-receipt-lost" }, context("publish-receipt-retry"));
    expect(recovered).toEqual(committed);
    expect(calls).toBe(1);
  });

  it("records disclosure for a provisional Choice without granting reviewer authority", async () => {
    const answering = new InMemoryAnswering({
      store: new InMemoryAnsweringStore(),
      resultStore: new InMemoryResultStore(),
      sqlExecutor: { run: async () => ({ columns: ["value"], rows: [[1]], truncated: false }) },
    });
    const begun = await answering.begin({
      requestMessageId: "message-2",
      requestId: "begin-2",
      spec: scalarSpec,
      choices: [{
        localId: "ranking-ties",
        affects: ["ranking"],
        alternatives: [{ localId: "strict", statement: "return exactly N rows" }, { localId: "ties", statement: "include ties at N" }],
        provisionalAlternativeId: "strict",
      }],
    }, context("begin-2"));
    const execution = await answering.execute({ kind: "result", taskId: begun.taskId, revisionId: begun.revisionId, sql: "SELECT 1" }, context("execute-2"));
    if (execution.artifact.kind !== "candidate") throw new Error("expected Result Candidate");
    const receipt = await answering.publish({ candidateId: execution.artifact.candidateId, format: "inline", requestId: "publish-3" }, context("publish-3"));
    expect(receipt.disclosure?.required).toBe(true);
    expect(receipt.disclosure?.summary).toContain("权威证据");
  });
});
