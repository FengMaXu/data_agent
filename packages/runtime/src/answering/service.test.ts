import { describe, expect, it } from "vitest";
import {
  AnsweringError,
  DEFAULT_QUERY_BUDGET_POLICY,
  InMemoryAnswering,
  InMemoryAnsweringStore,
  InMemoryResultStore,
  type AnsweringStore,
  type BusinessContext,
  isScopedReadOnlySql,
  SqlExecutionError,
} from "./public.js";

const context = (invocationId = "invocation-1"): BusinessContext => ({
  principal: { id: "user-1" },
  sessionId: "session-1",
  lane: "main",
  operationId: "operation-1",
  invocationId,
});

class FailOnceAtCandidateCommit implements AnsweringStore {
  private count = 0;
  private failed = false;
  constructor(private delegate: InMemoryAnsweringStore) {}

  async transact<T>(command: Parameters<AnsweringStore["transact"]>[0], context: BusinessContext): Promise<T> {
    this.count += 1;
    if (!this.failed && this.count === 5) {
      const before = this.delegate.snapshot();
      await this.delegate.transact(command, context);
      this.delegate = new InMemoryAnsweringStore(before);
      this.failed = true;
      throw new Error("SESSION_COMMIT_FAILED");
    }
    return this.delegate.transact(command, context) as Promise<T>;
  }

  inspect(taskId: Parameters<AnsweringStore["inspect"]>[0], context: BusinessContext) { return this.delegate.inspect(taskId, context); }
  list(context: BusinessContext) { return this.delegate.list(context); }
  listReferencedResultRefs(context: BusinessContext) { return this.delegate.listReferencedResultRefs(context); }
}

function answering(run: (sql: string, limit: number, options: { kind: "exploration" | "result"; idempotencyKey: string }) => Promise<{ columns: string[]; rows: unknown[][]; truncated: boolean }>) {
  return new InMemoryAnswering({
    store: new InMemoryAnsweringStore(),
    resultStore: new InMemoryResultStore(),
    sqlExecutor: { run },
  });
}

const simpleSpec = { entity: "orders", metric: "count", filters: [], groupBy: [], time: { state: "not_applicable" }, ranking: { state: "not_applicable" }, output: { rowMode: "scalar", rowCount: 1 } };

describe("Answering vertical slice", () => {
  it("keeps the delegated SQL preflight conservative without treating it as a security boundary", () => {
    expect(isScopedReadOnlySql("SELECT * FROM orders")).toBe(true);
    expect(isScopedReadOnlySql("PRAGMA user_version")).toBe(false);
    expect(isScopedReadOnlySql("SELECT pg_read_file('secret')")).toBe(false);
    expect(isScopedReadOnlySql("WITH changed AS (DELETE FROM orders RETURNING id) SELECT * FROM changed")).toBe(false);
  });

  it("rejects malformed facet values instead of sealing unchecked proposal objects", async () => {
    const service = answering(async () => ({ columns: ["value"], rows: [[1]], truncated: false }));
    await expect(service.begin({ requestMessageId: "message-invalid-time", requestId: "begin-invalid-time", spec: { ...simpleSpec, time: { expression: "created_at", boundary: "sometimes" } } }, context("begin-invalid-time"))).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(service.begin({ requestMessageId: "message-invalid-filter", requestId: "begin-invalid-filter", spec: { ...simpleSpec, filters: [{}] } }, context("begin-invalid-filter"))).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(service.begin({ requestMessageId: "message-invalid-ranking", requestId: "begin-invalid-ranking", spec: { ...simpleSpec, ranking: { n: 10, orderBy: "score", tiePolicy: "arbitrary" } } }, context("begin-invalid-ranking"))).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("rejects a provisional choice that changes the material population", async () => {
    const service = answering(async () => ({ columns: ["value"], rows: [[1]], truncated: false }));
    await expect(service.begin({
      requestMessageId: "message-population-choice",
      requestId: "begin-population-choice",
      spec: simpleSpec,
      choices: [{
        localId: "population",
        affects: ["filters"],
        alternatives: [{ localId: "all", statement: "all rows" }, { localId: "completed", statement: "completed rows" }],
        provisionalAlternativeId: "all",
      }],
    }, context("begin-population-choice"))).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("creates and revises one task with optimistic revision control", async () => {
    const service = answering(async () => ({ columns: ["value"], rows: [[1]], truncated: false }));
    const first = await service.begin({ requestMessageId: "message-1", requestId: "begin-1", spec: simpleSpec }, context());
    expect(first.taskId).toEqual(expect.stringContaining("task_"));
    const revised = await service.revise({ taskId: first.taskId, baseRevisionId: first.revisionId, requestId: "revise-1", spec: simpleSpec }, context("revise"));
    expect(revised.revisionId).not.toBe(first.revisionId);
    await expect(service.revise({ taskId: first.taskId, baseRevisionId: first.revisionId, requestId: "stale", spec: simpleSpec }, context("stale"))).rejects.toMatchObject({ code: "REVISION_STALE" });
  });

  it("blocks a final query while a key hypothesis is unresolved", async () => {
    let calls = 0;
    const service = answering(async () => { calls += 1; return { columns: ["value"], rows: [[1]], truncated: false }; });
    const first = await service.begin({
      requestMessageId: "message-1", requestId: "begin-2", spec: { ...simpleSpec, metric: { value: "count", hypothesisId: "meaning" } },
      hypotheses: [{ localId: "meaning", kind: "business_semantics", statement: "completed means business-complete", affects: ["metric"], basis: "model inference", impact: "changes metric eligibility" }],
    }, context("begin-2"));
    await expect(service.execute({ kind: "result", taskId: first.taskId, revisionId: first.revisionId, sql: "select 1" }, context("result-blocked"))).rejects.toMatchObject({ code: "UNRESOLVED_ASSUMPTIONS" });
    expect(calls).toBe(0);
  });

  it("does not let an exploration observation support a business hypothesis", async () => {
    const service = answering(async () => ({ columns: ["status"], rows: [["completed"]], truncated: false }));
    const first = await service.begin({
      requestMessageId: "message-1", requestId: "begin-3", spec: simpleSpec,
      hypotheses: [{ localId: "meaning", kind: "business_semantics", statement: "completed is the business completed status", affects: ["filters"], basis: "observed enum", impact: "changes population" }],
    }, context("begin-3"));
    const explored = await service.execute({ kind: "exploration", taskId: first.taskId, sql: "select status from orders", limit: 5 }, context("explore"));
    expect(explored.artifact.kind).toBe("exploration");
    await expect(service.execute({ kind: "result", taskId: first.taskId, revisionId: first.revisionId, sql: "select 1" }, context("result-after-observation"))).rejects.toMatchObject({ code: "UNRESOLVED_ASSUMPTIONS" });
  });

  it("executes final SQL once and publishes the same immutable candidate", async () => {
    let calls = 0;
    const executionKinds: string[] = [];
    const service = answering(async (_sql, _limit, options) => { calls += 1; executionKinds.push(options.kind); return { columns: ["value"], rows: [[1]], truncated: false }; });
    const first = await service.begin({ requestMessageId: "message-1", requestId: "begin-4", spec: simpleSpec }, context("begin-4"));
    const execution = await service.execute({ kind: "result", taskId: first.taskId, revisionId: first.revisionId, sql: "select 1" }, context("result-1"));
    expect(calls).toBe(1);
    expect(executionKinds).toEqual(["result"]);
    expect(execution.artifact.kind).toBe("candidate");
    if (execution.artifact.kind !== "candidate") throw new Error("expected candidate");
    const replayedByNewInvocation = await service.execute({ kind: "result", taskId: first.taskId, revisionId: first.revisionId, sql: "select 1" }, context("result-new-invocation"));
    expect(replayedByNewInvocation.artifact).toEqual(execution.artifact);
    expect(calls).toBe(1);
    const receipt = await service.publish({ candidateId: execution.artifact.candidateId, format: "auto", requestId: "publish-1" }, context("publish-1"));
    const repeated = await service.publish({ candidateId: execution.artifact.candidateId, format: "auto", requestId: "publish-1" }, context("publish-retry"));
    expect(repeated).toEqual(receipt);
    expect(calls).toBe(1);
    expect(receipt.format).toBe("inline");
    expect(receipt.resultRef).toBe(execution.artifact.resultRef);
  });

  it("coalesces concurrent final retries with different invocation ids", async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const service = answering(async () => {
      calls += 1;
      await blocked;
      return { columns: ["value"], rows: [[1]], truncated: false };
    });
    const first = await service.begin({ requestMessageId: "message-concurrent", requestId: "begin-concurrent", spec: simpleSpec }, context("begin-concurrent"));
    const input = { kind: "result" as const, taskId: first.taskId, revisionId: first.revisionId, sql: "select 1" };
    const left = service.execute(input, context("result-concurrent-left"));
    const right = service.execute(input, context("result-concurrent-right"));
    await Promise.resolve();
    release?.();
    const [leftResult, rightResult] = await Promise.all([left, right]);
    expect(rightResult.artifact).toEqual(leftResult.artifact);
    expect(calls).toBe(1);
  });

  it("does not rerun SQL after a Session commit failure when Pi memo has a settled result", async () => {
    const delegate = new InMemoryAnsweringStore();
    const store = new FailOnceAtCandidateCommit(delegate);
    const resultStore = new InMemoryResultStore();
    let calls = 0;
    const memoValues = new Map<string, unknown>();
    const memo = {
      get: async (name: string) => memoValues.get(name),
      set: async (name: string, value: unknown) => { memoValues.set(name, value); },
    };
    const firstService = new InMemoryAnswering({
      store,
      resultStore,
      sqlExecutor: { run: async () => { calls += 1; return { columns: ["value"], rows: [[1]], truncated: false }; } },
    });
    const first = await firstService.begin({ requestMessageId: "message-crash", requestId: "begin-crash", spec: simpleSpec }, context("begin-crash"));
    const executionInput = { kind: "result" as const, taskId: first.taskId, revisionId: first.revisionId, sql: "select 1" };
    await expect(firstService.execute(executionInput, { ...context("crash-invocation"), memo })).rejects.toThrow("SESSION_COMMIT_FAILED");
    expect(calls).toBe(1);
    const settledMemo = memoValues.get("answering.result-execution") as Record<string, unknown>;
    expect(settledMemo).toMatchObject({ state: "settled" });
    expect(settledMemo.resultRef).toMatch(/^result_/);
    expect(settledMemo).not.toHaveProperty("result");
    expect(JSON.stringify(settledMemo)).not.toContain("rows");

    const recovered = new InMemoryAnswering({
      store,
      resultStore,
      sqlExecutor: { run: async () => { calls += 1; throw new Error("SQL_MUST_NOT_RUN"); } },
    });
    const replay = await recovered.execute(executionInput, { ...context("crash-invocation"), operationId: "operation-after-restart", memo });
    expect(replay.artifact.kind).toBe("candidate");
    expect(calls).toBe(1);
  });

  it("records a detected CandidateCheck as a finding rather than unknown coverage", async () => {
    const service = answering(async () => ({ columns: ["value"], rows: [[1], [2]], truncated: false }));
    const first = await service.begin({ requestMessageId: "message-shape", requestId: "begin-shape", spec: simpleSpec }, context("begin-shape"));
    await expect(service.execute({ kind: "result", taskId: first.taskId, revisionId: first.revisionId, sql: "select 1 union all select 2" }, context("result-shape"))).rejects.toMatchObject({
      code: "CANDIDATE_CHECK_FAILED",
      details: { coverage: expect.arrayContaining([expect.objectContaining({ checkId: "result_shape", outcome: "finding" })]) },
    });
  });

  it("leads the obstacle with the declared and actual columns when they differ", async () => {
    const service = answering(async () => ({ columns: ["industry", "cumulative_sales_yi"], rows: [["批发业", 1]], truncated: false }));
    const spec = { ...simpleSpec, output: { rowMode: "grouped", columns: ["行业", "累计销售额(亿元)"] } };
    const first = await service.begin({ requestMessageId: "message-columns", requestId: "begin-columns", spec }, context("begin-columns"));
    await expect(service.execute({ kind: "result", taskId: first.taskId, revisionId: first.revisionId, sql: "select 1" }, context("result-columns"))).rejects.toMatchObject({
      code: "CANDIDATE_CHECK_FAILED",
      details: { obstacle: { message: 'The result failed an online CandidateCheck: Result columns do not match the declared output shape: declared ["行业","累计销售额(亿元)"], result ["industry","cumulative_sales_yi"]. Alias the SQL columns to the declared names in the same order, or revise output.columns if the declaration is wrong' } },
    });
  });

  it("checks a declared grouped row count and leaves an undeclared one alone", async () => {
    const rows = [["批发业", 1], ["零售业", 2]];
    const service = answering(async () => ({ columns: ["industry", "sales"], rows, truncated: false }));
    const declared = await service.begin({ requestMessageId: "message-grouped", requestId: "begin-grouped", spec: { ...simpleSpec, output: { rowMode: "grouped", rowCount: 3 } } }, context("begin-grouped"));
    await expect(service.execute({ kind: "result", taskId: declared.taskId, revisionId: declared.revisionId, sql: "select 1" }, context("result-grouped"))).rejects.toMatchObject({
      code: "CANDIDATE_CHECK_FAILED",
      details: { obstacle: { message: expect.stringContaining("Expected 3 grouped rows but received 2") } },
    });
    const open = await service.begin({ requestMessageId: "message-grouped-open", requestId: "begin-grouped-open", spec: { ...simpleSpec, output: { rowMode: "grouped" } } }, context("begin-grouped-open"));
    await expect(service.execute({ kind: "result", taskId: open.taskId, revisionId: open.revisionId, sql: "select 1" }, context("result-grouped-open"))).resolves.toMatchObject({ artifact: { kind: "candidate" } });
  });

  it("never promotes a truncated result into a Candidate", async () => {
    const service = answering(async () => ({ columns: ["value"], rows: [[1]], truncated: true }));
    const first = await service.begin({ requestMessageId: "message-truncated", requestId: "begin-truncated", spec: simpleSpec }, context("begin-truncated"));
    await expect(service.execute({ kind: "result", taskId: first.taskId, revisionId: first.revisionId, sql: "select 1" }, context("result-truncated"))).rejects.toMatchObject({ code: "RESULT_INCOMPLETE" });
    await expect(service.inspect({ taskId: first.taskId }, context("inspect-truncated"))).resolves.not.toHaveProperty("candidate");
  });

  it("bounds an exploration preview by serialized bytes before evidence is persisted", async () => {
    const service = answering(async () => ({ columns: ["value"], rows: [["x".repeat(100_000)], ["small"]], truncated: false }));
    const first = await service.begin({ requestMessageId: "message-preview-bytes", requestId: "begin-preview-bytes", spec: simpleSpec }, context("begin-preview-bytes"));
    const explored = await service.execute({ kind: "exploration", taskId: first.taskId, sql: "select value from orders", limit: 50, maxPreviewBytes: 16 * 1024 }, context("exploration-preview-bytes"));
    expect(Buffer.byteLength(JSON.stringify(explored.preview), "utf8")).toBeLessThanOrEqual(16 * 1024);
    expect(explored.preview).toMatchObject({ rows: [], rowCount: 2, truncated: true });
  });

  it("does not rerun an exploration whose external outcome is unknown under a new invocation", async () => {
    let calls = 0;
    const service = answering(async () => {
      calls += 1;
      throw new SqlExecutionError("connection lost", "unknown");
    });
    const first = await service.begin({ requestMessageId: "message-unknown-exploration", requestId: "begin-unknown-exploration", spec: simpleSpec }, context("begin-unknown-exploration"));
    const input = { kind: "exploration" as const, taskId: first.taskId, sql: "select 1", limit: 1 };
    await expect(service.execute(input, context("unknown-exploration-one"))).rejects.toMatchObject({ code: "RESULT_EXECUTION_OUTCOME_UNKNOWN" });
    await expect(service.execute(input, context("unknown-exploration-two"))).rejects.toMatchObject({ code: "RESULT_EXECUTION_OUTCOME_UNKNOWN", obstacle: { sqlExecuted: true, retryable: false } });
    expect(calls).toBe(1);
  });

  it("rejects exploration replay when the same invocation changes SQL or limit", async () => {
    const service = answering(async () => ({ columns: ["value"], rows: [[1]], truncated: false }));
    const first = await service.begin({ requestMessageId: "message-exploration", requestId: "begin-exploration", spec: simpleSpec }, context("begin-exploration"));
    await service.execute({ kind: "exploration", taskId: first.taskId, sql: "select 1", limit: 1 }, context("exploration-invocation"));
    await expect(service.execute({ kind: "exploration", taskId: first.taskId, sql: "select 2", limit: 1 }, context("exploration-invocation"))).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("rejects exploration artifacts as publication candidates", async () => {
    const service = answering(async () => ({ columns: ["value"], rows: [[1]], truncated: false }));
    const first = await service.begin({ requestMessageId: "message-1", requestId: "begin-5", spec: { ...simpleSpec, output: null } }, context("begin-5"));
    const exploration = await service.execute({ kind: "exploration", taskId: first.taskId, sql: "select 1", limit: 1 }, context("explore-5"));
    expect(exploration.artifact.kind).toBe("exploration");
    await expect(service.publish({ candidateId: "evidence_not_candidate", format: "auto", requestId: "publish-5" }, context("publish-5"))).rejects.toBeInstanceOf(AnsweringError);
  });

  it("keeps omitted list facets unknown instead of treating them as empty", async () => {
    let calls = 0;
    const service = answering(async () => { calls += 1; return { columns: ["value"], rows: [[1]], truncated: false }; });
    const { filters: _filters, ...withoutFilters } = simpleSpec;
    const first = await service.begin({ requestMessageId: "message-missing-filters", requestId: "begin-missing-filters", spec: withoutFilters }, context("begin-missing-filters"));
    expect(first.unresolvedFacets).toContain("filters");
    await expect(service.execute({ kind: "result", taskId: first.taskId, revisionId: first.revisionId, sql: "select 1" }, context("result-missing-filters"))).rejects.toMatchObject({ code: "UNRESOLVED_ASSUMPTIONS" });
    expect(calls).toBe(0);
  });

  it("returns a structured obstacle for unresolved facets without executing SQL", async () => {
    let calls = 0;
    const service = answering(async () => { calls += 1; return { columns: ["value"], rows: [[1]], truncated: false }; });
    const first = await service.begin({ requestMessageId: "message-unknown-facet", requestId: "begin-unknown-facet", spec: { ...simpleSpec, time: { state: "unknown" } } }, context("begin-unknown-facet"));
    await expect(service.execute({ kind: "result", taskId: first.taskId, revisionId: first.revisionId, sql: "select 1" }, context("result-unknown-facet"))).rejects.toMatchObject({
      code: "UNRESOLVED_ASSUMPTIONS",
      details: { unresolvedFacets: ["time"] },
      obstacle: { kind: "business_judgment_required", sqlExecuted: false, executionOutcome: "not_started", requiresOuterDecision: true },
    });
    expect(calls).toBe(0);
    await expect(service.inspect({ taskId: first.taskId }, context("inspect-unknown-facet"))).resolves.toMatchObject({ unresolvedFacets: ["time"], attempts: [{ kind: "result", state: "blocked" }] });
  });

  it("keeps a technical SQL failure inside the inner loop and records the attempt", async () => {
    let calls = 0;
    const service = answering(async () => {
      calls += 1;
      throw new SqlExecutionError("dialect syntax error");
    });
    const first = await service.begin({ requestMessageId: "message-technical-failure", requestId: "begin-technical-failure", spec: simpleSpec }, context("begin-technical-failure"));
    await expect(service.execute({ kind: "result", taskId: first.taskId, revisionId: first.revisionId, sql: "select bad" }, context("result-technical-failure"))).rejects.toMatchObject({
      code: "QUERY_EXECUTION_FAILED",
      obstacle: { kind: "technical_failure", retryable: true, requiresOuterDecision: false, sqlExecuted: true, executionOutcome: "failed" },
    });
    expect(calls).toBe(1);
    const inspected = await service.inspect({ taskId: first.taskId }, context("inspect-technical-failure"));
    expect(inspected.attempts).toEqual(expect.arrayContaining([expect.objectContaining({ state: "failed", obstacleKind: "technical_failure", sqlExecuted: true })]));
    expect(inspected.currentRevision.spec).toEqual(expect.objectContaining({ metric: expect.objectContaining({ state: "specified" }) }));
  });

  it("ends the operation instead of returning an obstacle when the database is unavailable", async () => {
    const unavailable = Object.assign(new Error("DATABASE_UNAVAILABLE: database process unavailable after 3 reconnects (Connection closed)"), { code: "DATABASE_UNAVAILABLE" });
    const service = answering(async () => { throw unavailable; });
    const first = await service.begin({ requestMessageId: "message-db-down", requestId: "begin-db-down", spec: simpleSpec }, context("begin-db-down"));
    for (const request of [
      { kind: "exploration" as const, taskId: first.taskId, sql: "select 1" },
      { kind: "result" as const, taskId: first.taskId, revisionId: first.revisionId, sql: "select 1" },
    ]) {
      const failure = await service.execute(request, context(`db-down-${request.kind}`)).catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: "DATABASE_UNAVAILABLE", message: expect.stringMatching(/^DATABASE_UNAVAILABLE: /) });
      expect((failure as { obstacle?: unknown }).obstacle).toBeUndefined();
    }
    const inspected = await service.inspect({ taskId: first.taskId }, context("inspect-db-down"));
    expect(inspected.attempts.filter((attempt) => attempt.state === "failed")).toHaveLength(2);
  });

  it("does not retry a result whose external execution outcome is unknown", async () => {
    let calls = 0;
    const memoValues = new Map<string, unknown>();
    const memo = {
      get: async (name: string) => memoValues.get(name),
      set: async (name: string, value: unknown) => { memoValues.set(name, value); },
    };
    const service = new InMemoryAnswering({
      store: new InMemoryAnsweringStore(),
      resultStore: new InMemoryResultStore(),
      sqlExecutor: { run: async () => { calls += 1; throw new SqlExecutionError("connection lost", "unknown"); } },
    });
    const first = await service.begin({ requestMessageId: "message-unknown-execution", requestId: "begin-unknown-execution", spec: simpleSpec }, context("begin-unknown-execution"));
    const input = { kind: "result" as const, taskId: first.taskId, revisionId: first.revisionId, sql: "select 1" };
    await expect(service.execute(input, { ...context("unknown-invocation"), memo })).rejects.toMatchObject({ code: "RESULT_EXECUTION_OUTCOME_UNKNOWN", obstacle: { kind: "execution_outcome_unknown" } });
    await expect(service.execute(input, { ...context("unknown-invocation"), memo })).rejects.toMatchObject({ code: "RESULT_EXECUTION_OUTCOME_UNKNOWN", obstacle: { kind: "execution_outcome_unknown", sqlExecuted: true } });
    await expect(service.execute(input, context("unknown-new-invocation"))).rejects.toMatchObject({ code: "RESULT_EXECUTION_OUTCOME_UNKNOWN", obstacle: { kind: "execution_outcome_unknown", sqlExecuted: true } });
    expect(calls).toBe(1);
  });

  it("charges exploration budget for observed rows removed from a byte-bounded preview", async () => {
    const service = new InMemoryAnswering({
      store: new InMemoryAnsweringStore(),
      resultStore: new InMemoryResultStore(),
      budgetPolicy: { ...DEFAULT_QUERY_BUDGET_POLICY, maxObservedRows: 1 },
      sqlExecutor: { run: async () => ({ columns: ["value"], rows: [["x".repeat(100_000)], ["small"]], truncated: false }) },
    });
    const first = await service.begin({ requestMessageId: "message-row-budget", requestId: "begin-row-budget", spec: simpleSpec }, context("begin-row-budget"));
    await expect(service.execute({ kind: "exploration", taskId: first.taskId, sql: "select value from orders", maxPreviewBytes: 16 * 1024 }, context("row-budget-exploration"))).rejects.toMatchObject({
      code: "IMPLEMENTATION_BUDGET_EXHAUSTED",
      obstacle: { kind: "budget_exhausted", sqlExecuted: true, executionOutcome: "succeeded" },
    });
    await expect(service.inspect({ taskId: first.taskId }, context("inspect-row-budget"))).resolves.toMatchObject({ task: { budget: { observedRows: 2 } } });
  });

  it("does not reset the task budget when the outer loop revises the Spec", async () => {
    let calls = 0;
    const service = new InMemoryAnswering({
      store: new InMemoryAnsweringStore(),
      resultStore: new InMemoryResultStore(),
      budgetPolicy: { ...DEFAULT_QUERY_BUDGET_POLICY, maxResultAttempts: 1, maxRevisions: 4 },
      sqlExecutor: { run: async () => { calls += 1; throw new SqlExecutionError("temporary SQL failure"); } },
    });
    const first = await service.begin({ requestMessageId: "message-budget", requestId: "begin-budget", spec: simpleSpec }, context("begin-budget"));
    await expect(service.execute({ kind: "result", taskId: first.taskId, revisionId: first.revisionId, sql: "select 1" }, context("budget-result-1"))).rejects.toMatchObject({ code: "QUERY_EXECUTION_FAILED" });
    const revised = await service.revise({ taskId: first.taskId, baseRevisionId: first.revisionId, requestId: "revise-budget", spec: simpleSpec }, context("budget-revise"));
    await expect(service.execute({ kind: "result", taskId: first.taskId, revisionId: revised.revisionId, sql: "select 2" }, context("budget-result-2"))).rejects.toMatchObject({
      code: "IMPLEMENTATION_BUDGET_EXHAUSTED",
      obstacle: { kind: "budget_exhausted", sqlExecuted: false, executionOutcome: "not_started" },
    });
    expect(calls).toBe(1);
    await expect(service.inspect({ taskId: first.taskId }, context("inspect-budget"))).resolves.toMatchObject({ task: { budget: { resultAttempts: 1, revisionCount: 1 } } });
  });
});

describe("Answering revision ownership (ADR-0004)", () => {
  const requestText = "统计每年各销售员订单金额与年度配额";
  const evidenceSource = {
    readUserMessage: async (_sessionId: string, messageId: string) => messageId === "message-141" ? requestText : undefined,
  };
  const serviceWithSource = (run: () => Promise<{ columns: string[]; rows: unknown[][]; truncated: boolean }>) => {
    let calls = 0;
    const store = new InMemoryAnsweringStore();
    const service = new InMemoryAnswering({
      store,
      resultStore: new InMemoryResultStore(),
      evidenceSource,
      sqlExecutor: { run: async () => { calls += 1; return run(); } },
    });
    const evidenceCount = (taskId: string) => store.transact((tx) => tx.listEvidence(taskId as never).length, context("evidence-count"));
    return { service, calls: () => calls, evidenceCount };
  };
  const salesSpec = { ...simpleSpec, metric: { value: { kind: "sum", expression: "SUM(subtotal)" }, hypothesisId: "amount" }, output: { rowMode: "grouped" } };
  const beginLocal141 = (service: InMemoryAnswering) => service.begin({
    requestMessageId: "message-141",
    requestId: "begin-141",
    spec: salesSpec,
    hypotheses: [{ localId: "amount", kind: "business_semantics", statement: "subtotal is the order amount", affects: ["metric"], basis: "column name", impact: "changes totals" }],
    choices: [{ localId: "quota", affects: ["metric"], alternatives: [{ localId: "sum", statement: "SUM annual quota" }, { localId: "max", statement: "MAX annual quota" }] }],
  }, context("begin-141"));

  it("keeps omitted unresolved items so the final query stays blocked (local141 replay)", async () => {
    const { service, calls } = serviceWithSource(async () => ({ columns: ["value"], rows: [[1]], truncated: false }));
    const first = await beginLocal141(service);
    expect(first.unresolvedHypotheses).toHaveLength(1);
    expect(first.unresolvedChoices).toHaveLength(1);
    await service.execute({ kind: "exploration", taskId: first.taskId, sql: "select max(quota) from q", limit: 5 }, context("explore-141"));
    const revised = await service.revise({ taskId: first.taskId, baseRevisionId: first.revisionId, requestId: "revise-141", spec: { groupBy: [{ value: "year" }, { value: "salesperson" }] } }, context("revise-141"));
    expect(revised.unresolvedHypotheses).toEqual(first.unresolvedHypotheses);
    expect(revised.unresolvedChoices).toEqual(first.unresolvedChoices);
    expect(revised.hypotheses.map((item) => item.id)).toEqual(first.hypotheses.map((item) => item.id));
    await expect(service.execute({ kind: "result", taskId: first.taskId, revisionId: revised.revisionId, sql: "select 1" }, context("result-141"))).rejects.toMatchObject({ code: "UNRESOLVED_ASSUMPTIONS" });
    expect(calls()).toBe(1);
  });

  it("rolls back a rejected revision without charging budget or registering evidence", async () => {
    const { service, evidenceCount } = serviceWithSource(async () => ({ columns: ["value"], rows: [[1]], truncated: false }));
    const first = await beginLocal141(service);
    const before = await service.inspect({ taskId: first.taskId }, context("inspect-before"));
    const evidenceBefore = await evidenceCount(first.taskId);
    await expect(service.revise({
      taskId: first.taskId,
      baseRevisionId: first.revisionId,
      requestId: "revise-bad",
      evidence: [{ localId: "q", kind: "request_wording", quote: "年度配额" }],
      dispositions: [{ action: "support", hypothesisId: first.hypotheses[0]!.id, evidenceIds: ["message-141"] }],
    }, context("revise-bad"))).rejects.toMatchObject({ code: "EVIDENCE_REJECTED" });
    const after = await service.inspect({ taskId: first.taskId }, context("inspect-after"));
    expect(after.task.currentRevisionId).toBe(first.revisionId);
    expect(after.task.budget?.revisionCount).toBe(before.task.budget?.revisionCount);
    expect(await evidenceCount(first.taskId)).toBe(evidenceBefore);
  });

  it("publishes after verified dispositions and discloses inferred facets and provisional choices", async () => {
    const { service } = serviceWithSource(async () => ({ columns: ["value"], rows: [[1]], truncated: false }));
    const first = await beginLocal141(service);
    const choice = first.choices[0]!;
    const revised = await service.revise({
      taskId: first.taskId,
      baseRevisionId: first.revisionId,
      requestId: "revise-good",
      evidence: [{ localId: "amount-quote", kind: "request_wording", quote: "订单金额" }],
      dispositions: [
        { action: "support", hypothesisId: first.hypotheses[0]!.id, evidenceIds: ["amount-quote"] },
        { action: "provisional", choiceId: choice.id, alternativeId: choice.alternatives[1].id },
      ],
    }, context("revise-good"));
    expect(revised.unresolvedHypotheses).toEqual([]);
    expect(revised.unresolvedChoices).toEqual([]);
    expect(revised.inferredFacets).toEqual(expect.arrayContaining(["entity", "output"]));
    const execution = await service.execute({ kind: "result", taskId: first.taskId, revisionId: revised.revisionId, sql: "select 1" }, context("result-good"));
    if (execution.artifact.kind !== "candidate") throw new Error("expected candidate");
    const receipt = await service.publish({ candidateId: execution.artifact.candidateId, format: "inline", requestId: "publish-good" }, context("publish-good"));
    expect(receipt.disclosure).toMatchObject({ required: true, provisionalChoiceIds: [choice.id], inferredFacets: expect.arrayContaining(["entity"]) });
    expect(receipt.disclosure?.summary).toContain("模型推断");
  });

  it("rejects a request quote that is not in the original request", async () => {
    const { service } = serviceWithSource(async () => ({ columns: ["value"], rows: [[1]], truncated: false }));
    await expect(service.begin({
      requestMessageId: "message-141",
      requestId: "begin-forged-quote",
      spec: simpleSpec,
      evidence: [{ localId: "q", kind: "request_wording", quote: "按最大值计算配额" }],
    }, context("begin-forged-quote"))).rejects.toMatchObject({ code: "EVIDENCE_REJECTED" });
  });
});
