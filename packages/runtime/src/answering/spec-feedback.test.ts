import { describe, expect, it } from "vitest";
import { MemorySessionRepo, TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { PiSessionAnsweringStore } from "../adapters/pi-session-answering-store.js";
import { InMemoryAnswering, InMemoryAnsweringStore, InMemoryResultStore, type BusinessContext } from "./public.js";
import type { AnsweringStore, AnsweringTransaction } from "./answering-store.js";
import { facetNames, type SpecAlignmentAssessor, type SpecAlignmentInput } from "../judgment/spec-alignment.js";
import type { SpecFeedbackAssessment } from "./model.js";

const context = (invocationId: string, signal?: AbortSignal): BusinessContext => ({
  principal: { id: "user-1" },
  sessionId: "session-1",
  lane: "main",
  operationId: `operation-${invocationId}`,
  invocationId,
  ...(signal ? { signal } : {}),
});

const simpleSpec = {
  entity: "orders",
  metric: "count",
  filters: [],
  groupBy: [],
  time: { state: "not_applicable" },
  ranking: { state: "not_applicable" },
  output: { rowMode: "scalar", rowCount: 1 },
};

function assessment(relation: "supported" | "contradicted" = "supported"): SpecFeedbackAssessment {
  return {
    model: "jev-test",
    ruleVersion: "spec-alignment-v1",
    facets: facetNames().map((facet) => ({
      facet,
      relation: {
        choice: relation,
        probabilities: { supported: relation === "supported" ? 1 : 0, contradicted: relation === "contradicted" ? 1 : 0, not_established: 0, not_applicable: 0 },
        confidence: 0.9,
      },
      coverage: {
        choice: "complete" as const,
        probabilities: { complete: 1, partial: 0, missing: 0, not_applicable: 0 },
        confidence: 0.9,
      },
    })),
  };
}

function serviceWithFeedback(
  assessor: SpecAlignmentAssessor,
  getOriginalQuestion: (requestMessageId: string, options?: { readonly signal?: AbortSignal }) => Promise<string | undefined>,
  options: { readonly timeoutMs?: number; readonly maxInputBytes?: number } = {},
) {
  return new InMemoryAnswering({
    store: new InMemoryAnsweringStore(),
    resultStore: new InMemoryResultStore(),
    sqlExecutor: { run: async () => ({ columns: ["value"], rows: [[1], [2], [3]], truncated: false }) },
    specFeedback: { assessor, getOriginalQuestion, ...options },
  });
}

describe("Answering Spec feedback", () => {
  it("runs once after a successful Revision commit and binds the complete input to that Revision", async () => {
    const inputs: SpecAlignmentInput[] = [];
    let calls = 0;
    const service = serviceWithFeedback({
      assess: async (input) => { calls += 1; inputs.push(input); return assessment(); },
    }, async (requestMessageId) => {
      expect(requestMessageId).toBe("message-1");
      return "请统计订单数";
    });

    const begun = await service.begin({
      requestMessageId: "message-1",
      requestId: "begin-feedback",
      spec: simpleSpec,
      evidence: [{ kind: "reviewed_definition", sourceRef: "metric.md", quote: "订单数按订单实体计数" }],
    }, context("begin-feedback"));

    expect(calls).toBe(1);
    expect(begun.specFeedback).toMatchObject({ status: "completed", taskId: begun.taskId, revisionId: begun.revisionId, assessment: { model: "jev-test" } });
    expect(inputs[0]).toMatchObject({ originalQuestion: "请统计订单数", spec: expect.any(Object), evidence: [
      { kind: "request_wording", sourceRef: "message-1" },
      { kind: "reviewed_definition", content: "订单数按订单实体计数" },
    ], limitations: [] });

    const replay = await service.begin({ requestMessageId: "message-1", requestId: "begin-feedback", spec: simpleSpec }, context("begin-replay"));
    expect(replay.revisionId).toBe(begun.revisionId);
    expect(calls).toBe(1);
    await expect(service.inspect({ taskId: begun.taskId }, context("inspect-feedback"))).resolves.toMatchObject({ currentRevision: { specFeedback: { status: "completed" } } });
  });

  it("uses the Evidence snapshot captured by each Revision commit", async () => {
    const inner = new InMemoryAnsweringStore();
    let transactionCount = 0;
    let releaseSnapshot: (() => void) | undefined;
    let markSnapshotWaiting: (() => void) | undefined;
    const snapshotWaiting = new Promise<void>((resolve) => { markSnapshotWaiting = resolve; });
    const snapshotGate = new Promise<void>((resolve) => { releaseSnapshot = resolve; });
    const store: AnsweringStore = {
      transact: async <T>(command: (state: AnsweringTransaction) => T | Promise<T>, business: BusinessContext): Promise<T> => {
        transactionCount += 1;
        if (transactionCount === 2) {
          markSnapshotWaiting?.();
          await snapshotGate;
        }
        return inner.transact(command, business);
      },
      inspect: (taskId, business) => inner.inspect(taskId, business),
      list: (business) => inner.list(business),
      listReferencedResultRefs: (business) => inner.listReferencedResultRefs(business),
    };
    const inputs: SpecAlignmentInput[] = [];
    const service = new InMemoryAnswering({
      store,
      resultStore: new InMemoryResultStore(),
      sqlExecutor: { run: async () => ({ columns: ["value"], rows: [[1]], truncated: false }) },
      specFeedback: {
        getOriginalQuestion: async () => "原题",
        assessor: { assess: async (value) => { inputs.push(value); return assessment(); } },
      },
    });

    const begunPromise = service.begin({ requestMessageId: "message-snapshot-race", requestId: "begin-snapshot-race", spec: simpleSpec }, context("begin-snapshot-race"));
    await snapshotWaiting;
    const task = (await inner.list(context("list-snapshot-race")))[0];
    if (!task) throw new Error("task missing");
    await service.revise({
      taskId: task.taskId,
      baseRevisionId: task.currentRevisionId,
      requestId: "revise-snapshot-race",
      spec: simpleSpec,
      evidence: [{ kind: "task_document", sourceRef: "later.md", quote: "later evidence" }],
    }, context("revise-snapshot-race"));
    releaseSnapshot?.();
    await begunPromise;

    expect(inputs.map((value) => value.evidence.map((item) => item.sourceRef).sort())).toEqual(expect.arrayContaining([
      ["later.md", "message-snapshot-race"],
      ["message-snapshot-race"],
    ]));
  });

  it("keeps Jev feedback advisory while deterministic conflicts become Candidate coverage and disclosure", async () => {
    const service = serviceWithFeedback({ assess: async () => assessment() }, async () => "请返回严格 Top N");
    const begun = await service.begin({
      requestMessageId: "message-top-n",
      requestId: "begin-top-n",
      spec: {
        ...simpleSpec,
        ranking: { n: 2, orderBy: "score", tiePolicy: "strict" },
        output: { rowMode: "top_n", rowCount: 3 },
      },
    }, context("begin-top-n"));
    expect(begun.specFeedback?.deterministicIssues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "strict_top_n_row_count_conflict" })]));

    const execution = await service.execute({ kind: "result", taskId: begun.taskId, revisionId: begun.revisionId, sql: "SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3" }, context("result-top-n"));
    expect(execution.coverage).toEqual(expect.arrayContaining([expect.objectContaining({ checkId: "spec_feedback", ruleVersion: "spec-feedback-v1", outcome: "finding" })]));
    if (execution.artifact.kind !== "candidate") throw new Error("expected candidate");
    const receipt = await service.publish({ candidateId: execution.artifact.candidateId, format: "inline", requestId: "publish-top-n" }, context("publish-top-n"));
    expect(receipt.disclosure?.summary).toContain("Answer Spec");
    const inspected = await service.inspect({ taskId: begun.taskId }, context("inspect-top-n"));
    expect(inspected.candidate?.coverage).toEqual(expect.arrayContaining([expect.objectContaining({ checkId: "spec_feedback", outcome: "finding" })]));
  });

  it("returns unavailable without changing the committed Revision when the original question cannot be read", async () => {
    let calls = 0;
    const service = serviceWithFeedback({ assess: async () => { calls += 1; return assessment(); } }, async () => undefined);
    const begun = await service.begin({ requestMessageId: "missing-message", requestId: "begin-unavailable", spec: simpleSpec }, context("begin-unavailable"));
    expect(calls).toBe(0);
    expect(begun.specFeedback).toMatchObject({ status: "unavailable", reason: "original_question_unavailable" });
    expect(begun.taskId).toMatch(/^task_/);
    const inspected = await service.inspect({ taskId: begun.taskId }, context("inspect-unavailable"));
    expect(inspected.currentRevision.specFeedback).toMatchObject({ status: "unavailable" });
  });

  it("keeps the committed Revision pending when the feedback write fails", async () => {
    const inner = new InMemoryAnsweringStore();
    let transactionCount = 0;
    const store: AnsweringStore = {
      transact: async <T>(command: (state: AnsweringTransaction) => T | Promise<T>, business: BusinessContext): Promise<T> => {
        transactionCount += 1;
        if (transactionCount === 3) throw new Error("FEEDBACK_WRITE_FAILED");
        return inner.transact(command, business);
      },
      inspect: (taskId, business) => inner.inspect(taskId, business),
      list: (business) => inner.list(business),
      listReferencedResultRefs: (business) => inner.listReferencedResultRefs(business),
    };
    const service = new InMemoryAnswering({
      store,
      resultStore: new InMemoryResultStore(),
      sqlExecutor: { run: async () => ({ columns: ["value"], rows: [[1]], truncated: false }) },
      specFeedback: { getOriginalQuestion: async () => "原题", assessor: { assess: async () => assessment() } },
    });

    const begun = await service.begin({ requestMessageId: "message-write-failure", requestId: "begin-write-failure", spec: simpleSpec }, context("begin-write-failure"));
    expect(begun.specFeedback).toMatchObject({ status: "pending" });
    const inspected = await service.inspect({ taskId: begun.taskId }, context("inspect-write-failure"));
    expect(inspected.currentRevision.specFeedback).toMatchObject({ status: "pending" });
  });

  it("round-trips the optional report through the Pi Session snapshot without re-running it", async () => {
    const session = await new MemorySessionRepo().create({ id: "feedback-session" }, TODO_CONTEXT);
    let calls = 0;
    const options = {
      specFeedback: {
        getOriginalQuestion: async () => "原题",
        assessor: { assess: async () => { calls += 1; return assessment(); } },
      },
    };
    const first = new InMemoryAnswering({
      store: new PiSessionAnsweringStore(session),
      resultStore: new InMemoryResultStore(),
      sqlExecutor: { run: async () => ({ columns: ["value"], rows: [[1]], truncated: false }) },
      ...options,
    });
    const begun = await first.begin({ requestMessageId: "message-snapshot", requestId: "begin-snapshot", spec: simpleSpec }, context("begin-snapshot"));
    expect(calls).toBe(1);
    const recovered = new InMemoryAnswering({
      store: new PiSessionAnsweringStore(session),
      resultStore: new InMemoryResultStore(),
      sqlExecutor: { run: async () => ({ columns: ["value"], rows: [[1]], truncated: false }) },
      specFeedback: { getOriginalQuestion: async () => { throw new Error("MUST_NOT_RERUN"); }, assessor: { assess: async () => { throw new Error("MUST_NOT_RERUN"); } } },
    });
    const inspected = await recovered.inspect({ taskId: begun.taskId }, context("inspect-snapshot"));
    expect(inspected.currentRevision.specFeedback).toMatchObject({ status: "completed", revisionId: begun.revisionId });
    expect(calls).toBe(1);
  });

  it("reports input limits and provider timeouts without calling SQL or retrying the assessor", async () => {
    let calls = 0;
    const tooLarge = serviceWithFeedback({ assess: async () => { calls += 1; return assessment(); } }, async () => "原题", { maxInputBytes: 32 });
    const oversized = await tooLarge.begin({ requestMessageId: "message-large", requestId: "begin-large", spec: simpleSpec }, context("begin-large"));
    expect(oversized.specFeedback).toMatchObject({ status: "unavailable", reason: "input_too_large" });
    expect(calls).toBe(0);

    const timedOut = serviceWithFeedback({ assess: async () => { calls += 1; return assessment(); } }, async () => new Promise<string>(() => undefined), { timeoutMs: 10 });
    const timed = await timedOut.begin({ requestMessageId: "message-timeout", requestId: "begin-timeout", spec: simpleSpec }, context("begin-timeout"));
    expect(timed.specFeedback).toMatchObject({ status: "unavailable", reason: "timeout" });
    expect(calls).toBe(0);
  });

  it("leaves pending feedback after parent cancellation instead of fabricating completion", async () => {
    const controller = new AbortController();
    const store = new InMemoryAnsweringStore();
    const service = new InMemoryAnswering({
      store,
      resultStore: new InMemoryResultStore(),
      sqlExecutor: { run: async () => ({ columns: ["value"], rows: [[1]], truncated: false }) },
      specFeedback: {
        assessor: { assess: async () => assessment() },
        getOriginalQuestion: async () => new Promise<string>(() => undefined),
        timeoutMs: 5_000,
      },
    });
    const begun = service.begin({ requestMessageId: "message-cancel", requestId: "begin-cancel", spec: simpleSpec }, context("begin-cancel", controller.signal));
    let tasks = await store.list(context("list-cancel-wait"));
    while (tasks.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      tasks = await store.list(context("list-cancel-wait"));
    }
    controller.abort();
    await expect(begun).rejects.toThrow();
    tasks = await store.list(context("list-cancel"));
    const task = tasks[0];
    expect(task).toBeDefined();
    if (task) {
      const inspected = await service.inspect({ taskId: task.taskId }, context("inspect-cancel"));
      expect(inspected.currentRevision.specFeedback).toMatchObject({ status: "pending" });
    }
  });

  it("marks a late report stale instead of attaching it to a newer Revision", async () => {
    const store = new InMemoryAnsweringStore();
    let calls = 0;
    let releaseFirst: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const service = new InMemoryAnswering({
      store,
      resultStore: new InMemoryResultStore(),
      sqlExecutor: { run: async () => ({ columns: ["value"], rows: [[1]], truncated: false }) },
      specFeedback: {
        getOriginalQuestion: async () => "原题",
        assessor: {
          assess: async () => {
            calls += 1;
            if (calls === 1) await firstBlocked;
            return assessment();
          },
        },
      },
    });
    const begunPromise = service.begin({ requestMessageId: "message-race", requestId: "begin-race", spec: simpleSpec }, context("begin-race"));
    while (calls === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    const tasks = await store.list(context("list-race"));
    const task = tasks[0];
    if (!task) throw new Error("task missing");
    const revised = await service.revise({ taskId: task.taskId, baseRevisionId: task.currentRevisionId, requestId: "revise-race", spec: simpleSpec }, context("revise-race"));
    releaseFirst?.();
    const begun = await begunPromise;
    expect(begun.specFeedback).toMatchObject({ status: "completed", stale: true, currentRevisionId: revised.revisionId });
    const oldRevision = await store.transact((tx) => tx.getRevision(begun.revisionId), context("read-old-race"));
    expect(oldRevision?.specFeedback?.currentRevisionId).toBe(revised.revisionId);
    expect(calls).toBe(2);
  });

  it("freezes pending coverage on a Candidate before a late feedback write", async () => {
    const store = new InMemoryAnsweringStore();
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const service = new InMemoryAnswering({
      store,
      resultStore: new InMemoryResultStore(),
      sqlExecutor: { run: async () => ({ columns: ["value"], rows: [[1]], truncated: false }) },
      specFeedback: {
        getOriginalQuestion: async () => "原题",
        assessor: { assess: async () => { calls += 1; await blocked; return assessment(); } },
      },
    });
    const begunPromise = service.begin({ requestMessageId: "message-freeze", requestId: "begin-freeze", spec: simpleSpec }, context("begin-freeze"));
    while (calls === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    const tasks = await store.list(context("list-freeze"));
    const task = tasks[0];
    if (!task) throw new Error("task missing");
    const execution = await service.execute({ kind: "result", taskId: task.taskId, revisionId: task.currentRevisionId, sql: "SELECT 1" }, context("result-freeze"));
    expect(execution.coverage).toEqual(expect.arrayContaining([expect.objectContaining({ checkId: "spec_feedback", outcome: "unknown" })]));
    release?.();
    const begun = await begunPromise;
    expect(begun.specFeedback?.status).toBe("completed");
    const inspected = await service.inspect({ taskId: task.taskId }, context("inspect-freeze"));
    expect(inspected.candidate?.coverage).toEqual(expect.arrayContaining([expect.objectContaining({ checkId: "spec_feedback", outcome: "unknown" })]));
  });

  it("does not invoke the assessor for a failed proposal or an already existing begin", async () => {
    let calls = 0;
    const service = serviceWithFeedback({ assess: async () => { calls += 1; return assessment(); } }, async () => "原题");
    await expect(service.begin({ requestMessageId: "bad", requestId: "bad", spec: { ...simpleSpec, output: { rowMode: "invalid" } } }, context("bad"))).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(calls).toBe(0);
    const begun = await service.begin({ requestMessageId: "message-existing", requestId: "begin-existing", spec: simpleSpec }, context("begin-existing"));
    expect(calls).toBe(1);
    await service.begin({ requestMessageId: "message-existing", requestId: "begin-existing", spec: simpleSpec }, context("begin-existing-replay"));
    expect(calls).toBe(1);
    expect(begun.specFeedback?.status).toBe("completed");
  });
});
