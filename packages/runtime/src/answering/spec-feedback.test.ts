import { describe, expect, it } from "vitest";
import { MemorySessionRepo, TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { PiSessionAnsweringStore } from "../adapters/pi-session-answering-store.js";
import { InMemoryAnswering, InMemoryAnsweringStore, InMemoryResultStore, type BusinessContext, type EvidenceSource } from "./public.js";
import type { AnsweringStore, AnsweringTransaction } from "./answering-store.js";
import type { RequirementExtractor, SpecAlignmentAssessor, SpecAlignmentInput } from "../judgment/spec-alignment.js";
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
  "population.entity": "orders",
  "population.eligibility": "n/a",
  "population.conditions": "n/a",
  "population.time": "n/a",
  "measure.formula": { op: "count", of: "orders" },
  "measure.countGrain": "one row per order",
  grouping: "n/a",
  selection: "n/a",
  output: { rowMode: "scalar", rowCount: 1 },
};

/** A strict top N whose declared row count contradicts n. */
const conflictingTopN = { ...simpleSpec, selection: { n: 2, orderBy: "score DESC" }, "selection.ties": "strict", output: { rowMode: "top_n", rowCount: 3 } };

/** Trusted test documents; Evidence Admission verifies quotes against this text. */
const documentSource: EvidenceSource = {
  readUserMessage: async () => undefined,
  readDocument: async (sourceRef) => ({
    "metric.md": { kind: "reviewed_definition" as const, content: "口径：订单数按订单实体计数。" },
    "later.md": { kind: "task_document" as const, content: "Appendix: later evidence for the task." },
  } as Record<string, { kind: "reviewed_definition" | "task_document"; content: string }>)[sourceRef],
};

function assessment(input?: SpecAlignmentInput, contradicted: readonly string[] = []): SpecFeedbackAssessment {
  return {
    model: "jev-test",
    ruleVersion: "spec-alignment-v3",
    requirements: (input?.requirements ?? []).map((item) => {
      const against = contradicted.includes(item.quote);
      return { ...item, judgment: { choice: against ? "contradicted" as const : "expressed" as const, probabilities: { expressed: against ? 0.1 : 0.9, contradicted: against ? 0.9 : 0.1, missing: 0 }, confidence: 0.8 } };
    }),
    columns: (input?.outputColumns ?? []).map((column) => ({ column, judgment: { choice: "defined" as const, probabilities: { defined: 1, undefined: 0 }, confidence: 0.9 } })),
  };
}

function serviceWithFeedback(
  assessor: SpecAlignmentAssessor,
  getOriginalQuestion: (requestMessageId: string, options?: { readonly signal?: AbortSignal }) => Promise<string | undefined>,
  options: { readonly timeoutMs?: number; readonly maxInputBytes?: number; readonly requirementExtractor?: RequirementExtractor } = {},
) {
  return new InMemoryAnswering({
    store: new InMemoryAnsweringStore(),
    resultStore: new InMemoryResultStore(),
    sqlExecutor: { run: async () => ({ columns: ["value"], rows: [[1], [2], [3]], truncated: false }) },
    evidenceSource: documentSource,
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

    const begun = await service.set({
      requestMessageId: "message-1",
      requestId: "begin-feedback",
      fields: { ...simpleSpec, "measure.countGrain": { value: "one row per order", cite: [{ source: "knowledge:metric.md", quote: "订单数按订单实体计数" }] } },
    }, context("begin-feedback"));

    expect(calls).toBe(1);
    expect(begun.specFeedback).toMatchObject({ status: "completed", taskId: begun.taskId, revisionId: begun.revisionId, assessment: { model: "jev-test" } });
    // Claims only: no basis, rationale or evidence text reaches the assessor.
    expect(inputs[0]).toEqual({ originalQuestion: "请统计订单数", fields: expect.objectContaining({ "measure.countGrain": { state: "specified", value: "one row per order" } }), requirements: [], outputColumns: [] });
    expect(begun.specFeedback?.limitations).toEqual(["requirement_extractor_not_configured"]);

    const replay = await service.set({ requestMessageId: "message-1", requestId: "begin-feedback", fields: simpleSpec }, context("begin-replay"));
    expect(replay.revisionId).toBe(begun.revisionId);
    expect(calls).toBe(1);
    await expect(service.inspect({ taskId: begun.taskId }, context("inspect-feedback"))).resolves.toMatchObject({ currentRevision: { specFeedback: { status: "completed" } } });
  });

  it("judges verbatim requirement phrases extracted once per request, and reports a contradicted one", async () => {
    let extractions = 0;
    const inputs: SpecAlignmentInput[] = [];
    const service = serviceWithFeedback(
      { assess: async (input) => { inputs.push(input); return assessment(input, ["for each customer"]); } },
      async () => "Average sales per order for each customer within RFM segments",
      { requirementExtractor: { extract: async () => { extractions += 1; return [{ quote: "for each customer", role: "scope" }, { quote: "per customer per month", role: "scope" }]; } } },
    );
    const begun = await service.set({ requestMessageId: "message-req", requestId: "begin-req", fields: { ...simpleSpec, output: { rowMode: "full", columns: ["value"] } } }, context("begin-req"));
    expect(inputs[0]).toMatchObject({ requirements: [{ quote: "for each customer", role: "scope" }], outputColumns: ["value"] });
    expect(begun.specFeedback).toMatchObject({ status: "completed", limitations: ["requirements_not_verbatim:1"] });
    await service.set({ taskId: begun.taskId, requestId: "revise-req", fields: { grouping: { value: ["rfm_segment"], reason: "per segment" } } }, context("revise-req"));
    expect(extractions).toBe(1);
    const execution = await service.execute({ kind: "result", taskId: begun.taskId, revisionId: (await service.inspect({ taskId: begun.taskId }, context("i"))).currentRevision.revisionId, sql: "SELECT 1 AS avg_sales" }, context("result-req"));
    expect(execution.coverage).toEqual(expect.arrayContaining([expect.objectContaining({ checkId: "spec_feedback", outcome: "finding", reason: expect.stringContaining("contradicted(p=0.90) [scope] \"for each customer\"") })]));
  });

  it("skips a Revision whose required fields are not all declared", async () => {
    let calls = 0;
    const service = serviceWithFeedback({ assess: async () => { calls += 1; return assessment(); } }, async () => "原题");
    const { grouping: _grouping, ...incomplete } = simpleSpec;
    const begun = await service.set({ requestMessageId: "message-incomplete", requestId: "begin-incomplete", fields: incomplete }, context("begin-incomplete"));
    expect(begun.specFeedback).toMatchObject({ status: "skipped", reason: "spec_incomplete" });
    expect(calls).toBe(0);
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
      evidenceSource: documentSource,
      specFeedback: {
        getOriginalQuestion: async () => "原题",
        assessor: { assess: async (value) => { inputs.push(value); return assessment(); } },
      },
    });

    const begunPromise = service.set({ requestMessageId: "message-snapshot-race", requestId: "begin-snapshot-race", fields: simpleSpec }, context("begin-snapshot-race"));
    await snapshotWaiting;
    const task = (await inner.list(context("list-snapshot-race")))[0];
    if (!task) throw new Error("task missing");
    const revisedView = await service.set({
      taskId: task.taskId,
      requestId: "revise-snapshot-race",
      fields: { "population.conditions": { value: ["status = 'paid'"], cite: [{ source: "knowledge:later.md", quote: "later evidence" }], reason: "the appendix restricts the orders" } },
    }, context("revise-snapshot-race"));
    releaseSnapshot?.();
    const begunView = await begunPromise;

    expect(inputs).toHaveLength(2);
    expect(begunView.specFeedback?.evidenceIds).toHaveLength(1);
    expect(revisedView.specFeedback?.evidenceIds).toHaveLength(2);
  });

  it("keeps Jev feedback advisory while deterministic conflicts become Candidate coverage and disclosure", async () => {
    const service = serviceWithFeedback({ assess: async () => assessment() }, async () => "请返回严格 Top N");
    const begun = await service.set({
      requestMessageId: "message-top-n",
      requestId: "begin-top-n",
      fields: conflictingTopN,
    }, context("begin-top-n"));
    expect(begun.specFeedback?.deterministicIssues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "strict_top_n_row_count_conflict" })]));

    const execution = await service.execute({ kind: "result", taskId: begun.taskId, revisionId: begun.revisionId, sql: "SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3" }, context("result-top-n"));
    expect(execution.coverage).toEqual(expect.arrayContaining([expect.objectContaining({ checkId: "spec_feedback", ruleVersion: "spec-feedback-v3", outcome: "finding" })]));
    if (execution.artifact.kind !== "candidate") throw new Error("expected candidate");
    const receipt = await service.publish({ candidateId: execution.artifact.candidateId, format: "inline", requestId: "publish-top-n" }, context("publish-top-n"));
    expect(receipt.disclosure?.summary).toContain("Answer Spec");
    const inspected = await service.inspect({ taskId: begun.taskId }, context("inspect-top-n"));
    expect(inspected.candidate?.coverage).toEqual(expect.arrayContaining([expect.objectContaining({ checkId: "spec_feedback", outcome: "finding" })]));
  });

  it("records an unconfigured assessor without disclosing it on every result; deterministic conflicts still disclose", async () => {
    const service = (rows: unknown[][]) => new InMemoryAnswering({
      store: new InMemoryAnsweringStore(),
      resultStore: new InMemoryResultStore(),
      sqlExecutor: { run: async () => ({ columns: ["value"], rows, truncated: false }) },
      evidenceSource: documentSource,
    });
    const publish = async (answering: InMemoryAnswering, spec: Record<string, unknown>, sql: string, id: string) => {
      const begun = await answering.set({ requestMessageId: `message-${id}`, requestId: `begin-${id}`, fields: spec }, context(`begin-${id}`));
      const execution = await answering.execute({ kind: "result", taskId: begun.taskId, revisionId: begun.revisionId, sql }, context(`result-${id}`));
      if (execution.artifact.kind !== "candidate") throw new Error("expected candidate");
      const receipt = await answering.publish({ candidateId: execution.artifact.candidateId, format: "inline", requestId: `publish-${id}` }, context(`publish-${id}`));
      return { coverage: execution.coverage.find((coverage) => coverage.checkId === "spec_feedback"), disclosure: receipt.disclosure?.summary ?? "" };
    };

    const clean = await publish(service([[1]]), simpleSpec, "SELECT 1", "clean");
    expect(clean.coverage).toMatchObject({ outcome: "not_applicable", reason: expect.stringContaining("not configured") });
    expect(clean.disclosure).not.toContain("Answer Spec");

    const conflicting = await publish(service([[1], [2], [3]]), conflictingTopN, "SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3", "conflict");
    expect(conflicting.coverage?.outcome).toBe("finding");
    expect(conflicting.disclosure).toContain("Answer Spec");
  });

  it("returns unavailable without changing the committed Revision when the original question cannot be read", async () => {
    let calls = 0;
    const service = serviceWithFeedback({ assess: async () => { calls += 1; return assessment(); } }, async () => undefined);
    const begun = await service.set({ requestMessageId: "missing-message", requestId: "begin-unavailable", fields: simpleSpec }, context("begin-unavailable"));
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

    const begun = await service.set({ requestMessageId: "message-write-failure", requestId: "begin-write-failure", fields: simpleSpec }, context("begin-write-failure"));
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
    const begun = await first.set({ requestMessageId: "message-snapshot", requestId: "begin-snapshot", fields: simpleSpec }, context("begin-snapshot"));
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
    const oversized = await tooLarge.set({ requestMessageId: "message-large", requestId: "begin-large", fields: simpleSpec }, context("begin-large"));
    expect(oversized.specFeedback).toMatchObject({ status: "unavailable", reason: "input_too_large" });
    expect(calls).toBe(0);

    const timedOut = serviceWithFeedback({ assess: async () => { calls += 1; return assessment(); } }, async () => new Promise<string>(() => undefined), { timeoutMs: 10 });
    const timed = await timedOut.set({ requestMessageId: "message-timeout", requestId: "begin-timeout", fields: simpleSpec }, context("begin-timeout"));
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
    const begun = service.set({ requestMessageId: "message-cancel", requestId: "begin-cancel", fields: simpleSpec }, context("begin-cancel", controller.signal));
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
    const begunPromise = service.set({ requestMessageId: "message-race", requestId: "begin-race", fields: simpleSpec }, context("begin-race"));
    while (calls === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    const tasks = await store.list(context("list-race"));
    const task = tasks[0];
    if (!task) throw new Error("task missing");
    const revised = await service.set({ taskId: task.taskId, requestId: "revise-race", fields: { grouping: { value: ["region"], reason: "per region" } } }, context("revise-race"));
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
    const begunPromise = service.set({ requestMessageId: "message-freeze", requestId: "begin-freeze", fields: simpleSpec }, context("begin-freeze"));
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

  it("does not invoke the assessor for a call that writes nothing or an already existing begin", async () => {
    let calls = 0;
    const service = serviceWithFeedback({ assess: async () => { calls += 1; return assessment(); } }, async () => "原题");
    const begun = await service.set({ requestMessageId: "message-existing", requestId: "begin-existing", fields: simpleSpec }, context("begin-existing"));
    expect(calls).toBe(1);
    await service.set({ requestMessageId: "message-existing", requestId: "begin-existing", fields: simpleSpec }, context("begin-existing-replay"));
    expect(calls).toBe(1);
    const rejected = await service.set({ taskId: begun.taskId, requestId: "bad", fields: { output: { rowMode: "invalid" } } }, context("bad"));
    expect(rejected.revisionId).toBe(begun.revisionId);
    expect(calls).toBe(1);
    expect(begun.specFeedback?.status).toBe("completed");
  });
});
