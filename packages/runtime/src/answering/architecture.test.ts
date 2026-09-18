import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { ANSWERING_QUERY_PARAMETERS, UPDATE_ANSWER_PARAMETERS, createAnsweringAgentTools } from "../tools/answering.js";
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
  override async encodeInline(ref: Parameters<InMemoryResultStore["encodeInline"]>[0], context: BusinessContext) {
    this.started();
    await this.releasePromise;
    return super.encodeInline(ref, context);
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
    expect(Value.Check(UPDATE_ANSWER_PARAMETERS, { kind: "begin", spec: scalarSpec })).toBe(true);
    expect(Value.Check(UPDATE_ANSWER_PARAMETERS, {
      kind: "begin",
      spec: {
        entity: { value: { name: "players", keyColumns: ["player_id"] } },
        metric: { value: { kind: "average", expression: "AVG(career_days)", unit: "days" } },
        filters: [{ value: "debut IS NOT NULL" }],
        groupBy: [],
        time: { value: { expression: "final_game - debut", boundary: "inclusive" } },
        ranking: { state: "not_applicable" },
        output: { value: { rowMode: "scalar", rowCount: 1, columns: ["average_days"] } },
      },
    })).toBe(true);
    expect(Value.Check(UPDATE_ANSWER_PARAMETERS, { kind: "begin", spec: { ...scalarSpec, groupBy: { expression: "team_id" } } })).toBe(false);
    expect(Value.Check(UPDATE_ANSWER_PARAMETERS, { kind: "begin", spec: { ...scalarSpec, time: { value: { field: "debut" } } } })).toBe(false);
    expect(Value.Check(UPDATE_ANSWER_PARAMETERS, { kind: "begin", spec: scalarSpec, evidence: [{ kind: "query_observation", sourceRef: "invented", preview: {} }] })).toBe(false);
    expect(Value.Check(UPDATE_ANSWER_PARAMETERS, { kind: "revise", taskId: "task-1", spec: scalarSpec })).toBe(false);
    expect(Value.Check(ANSWERING_QUERY_PARAMETERS, { kind: "result", taskId: "task-1", sql: "SELECT 1" })).toBe(false);
    expect(Value.Check(ANSWERING_QUERY_PARAMETERS, { kind: "exploration", taskId: "task-1", revisionId: "revision-1", sql: "SELECT 1" })).toBe(false);
    expect(Value.Check(ANSWERING_QUERY_PARAMETERS, { kind: "result", taskId: "task-1", revisionId: "revision-1", sql: "SELECT 1" })).toBe(true);
  });

  it("places host-generated exploration and candidate handles in model-visible tool text", async () => {
    const answering = new InMemoryAnswering({
      store: new InMemoryAnsweringStore(),
      resultStore: new InMemoryResultStore(),
      sqlExecutor: { run: async () => ({ columns: ["value"], rows: [[1]], truncated: false }) },
    });
    const begun = await answering.begin({ requestMessageId: "message-handles", requestId: "begin-handles", spec: scalarSpec }, context("begin-handles"));
    const query = createAnsweringAgentTools(answering).find((tool) => tool.name === "query_database")!;
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
