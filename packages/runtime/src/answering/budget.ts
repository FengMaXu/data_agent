import type {
  BusinessContext,
  CheckCoverage,
  EvidenceId,
  ExecutionOutcome,
  ImplementationObstacle,
  ImplementationObstacleKind,
  QueryAttemptKind,
  QueryAttemptPurpose,
  QueryAttemptRecord,
  QueryBudgetPolicy,
  QueryBudgetState,
  QueryTaskRecord,
  RevisionId,
  TaskId,
} from "./model.js";
import { assertTaskAccess, type AnsweringStore, type AnsweringTransaction } from "./answering-store.js";
import { AnsweringError, DATABASE_UNAVAILABLE, isDatabaseUnavailable } from "./errors.js";
import { makeInternalId } from "./internal-ids.js";
import { SqlExecutionError } from "./sql-execution.js";
import { now } from "./support.js";
import { MAX_CHOICE_PROBES } from "./choice-probe.js";

/**
 * Query Task budget, attempt records and Implementation Obstacles. Every
 * revision, exploration, probe and result attempt is charged here so outer
 * revisions and delegation never reset the task budget.
 */
export const DEFAULT_QUERY_BUDGET_POLICY: QueryBudgetPolicy = {
  version: "answering-dual-loop-v1",
  maxRevisions: 8,
  maxExplorationAttempts: 16,
  maxResultAttempts: 8,
  maxElapsedMs: 15 * 60 * 1_000,
  maxObservedRows: 200_000,
};

export function validateBudgetPolicy(policy: QueryBudgetPolicy): QueryBudgetPolicy {
  const values = [policy.maxRevisions, policy.maxExplorationAttempts, policy.maxResultAttempts, policy.maxElapsedMs, policy.maxObservedRows];
  if (policy.version !== "answering-dual-loop-v1" || values.some((value) => !Number.isSafeInteger(value) || value < 1)) {
    throw new AnsweringError("INVALID_REQUEST", "Invalid Answering dual-loop budget policy");
  }
  return { ...policy };
}

export function newBudget(policy: QueryBudgetPolicy, startedAt: string): QueryBudgetState {
  return {
    policy,
    startedAt,
    revisionCount: 0,
    explorationAttempts: 0,
    resultAttempts: 0,
    observedRows: 0,
  };
}

export function taskBudget(task: QueryTaskRecord, policy: QueryBudgetPolicy): QueryBudgetState {
  return task.budget ? { ...task.budget, policy: { ...task.budget.policy } } : newBudget(policy, task.createdAt);
}

export function budgetFailure(budget: QueryBudgetState, kind: QueryAttemptKind, at: number): string | undefined {
  if (Date.parse(budget.startedAt) + budget.policy.maxElapsedMs <= at) return "task time budget exhausted";
  if (kind === "revision" && budget.revisionCount >= budget.policy.maxRevisions) return "revision budget exhausted";
  if (kind === "exploration" && budget.explorationAttempts >= budget.policy.maxExplorationAttempts) return "exploration budget exhausted";
  if (kind === "result" && budget.resultAttempts >= budget.policy.maxResultAttempts) return "result implementation budget exhausted";
  if (budget.observedRows >= budget.policy.maxObservedRows) return "observed-row budget exhausted";
  return undefined;
}

export function makeAttempt(
  taskId: TaskId,
  kind: QueryAttemptKind,
  revisionId: RevisionId,
  invocationId: string,
  createdAt: string,
  state: QueryAttemptRecord["state"],
  outcome: ExecutionOutcome,
  sqlExecuted: boolean,
  obstacleKind?: ImplementationObstacleKind,
  queryHash?: string,
  purpose?: QueryAttemptPurpose,
): QueryAttemptRecord {
  return {
    attemptId: makeInternalId("attempt"),
    taskId,
    kind,
    ...(purpose ? { purpose } : {}),
    revisionId,
    invocationId,
    ...(queryHash ? { queryHash } : {}),
    state,
    sqlExecuted,
    outcome,
    ...(obstacleKind ? { obstacleKind } : {}),
    createdAt,
    updatedAt: createdAt,
  };
}

export function obstacle(
  tx: AnsweringTransaction,
  task: QueryTaskRecord,
  revisionId: RevisionId,
  kind: ImplementationObstacleKind,
  message: string,
  options: {
    readonly requiresOuterDecision: boolean;
    readonly retryable: boolean;
    readonly sqlExecuted: boolean;
    readonly executionOutcome: ExecutionOutcome;
    readonly queryHash?: string;
    readonly coverage?: readonly CheckCoverage[];
    readonly evidenceIds?: readonly EvidenceId[];
  },
): ImplementationObstacle {
  return {
    kind,
    taskId: task.taskId,
    revisionId,
    message,
    evidenceIds: [...(options.evidenceIds ?? [])],
    attempts: tx.listAttempts(task.taskId),
    coverage: [...(options.coverage ?? [])],
    requiresOuterDecision: options.requiresOuterDecision,
    retryable: options.retryable,
    sqlExecuted: options.sqlExecuted,
    executionOutcome: options.executionOutcome,
    ...(options.queryHash ? { queryHash: options.queryHash } : {}),
  };
}

export function obstacleDetails(details: unknown, value: ImplementationObstacle): Record<string, unknown> {
  const existing = details && typeof details === "object" && !Array.isArray(details) ? details as Record<string, unknown> : {};
  return { ...existing, obstacle: value };
}

export function reserveAttempt(
  tx: AnsweringTransaction,
  task: QueryTaskRecord,
  policy: QueryBudgetPolicy,
  kind: QueryAttemptKind,
  revisionId: RevisionId,
  invocationId: string,
  queryHash?: string,
  purpose?: QueryAttemptPurpose,
): { readonly task: QueryTaskRecord; readonly attempt?: QueryAttemptRecord; readonly obstacle?: ImplementationObstacle } {
  const at = Date.now();
  const budget = taskBudget(task, policy);
  // Choice probes have their own per-task cap and do not consume exploration attempts (ADR-0005).
  const choiceProbe = purpose === "choice_probe";
  const probeCount = choiceProbe ? tx.listAttempts(task.taskId).filter((item) => item.purpose === "choice_probe" && item.state !== "blocked").length : 0;
  const reason = choiceProbe
    ? Date.parse(budget.startedAt) + budget.policy.maxElapsedMs <= at ? "task time budget exhausted"
      : budget.observedRows >= budget.policy.maxObservedRows ? "observed-row budget exhausted"
        : probeCount >= MAX_CHOICE_PROBES ? "choice probe budget exhausted" : undefined
    : budgetFailure(budget, kind, at);
  if (reason) {
    const blocked = makeAttempt(task.taskId, kind, revisionId, invocationId, now(), "blocked", "not_started", false, "budget_exhausted", queryHash, purpose);
    tx.putAttempt(blocked);
    const current = { ...task, budget, updatedAt: blocked.updatedAt };
    tx.putTask(current);
    return {
      task: current,
      obstacle: obstacle(tx, current, revisionId, "budget_exhausted", reason, {
        requiresOuterDecision: true,
        retryable: false,
        sqlExecuted: false,
        executionOutcome: "not_started",
        ...(queryHash ? { queryHash } : {}),
      }),
    };
  }
  const nextBudget: QueryBudgetState = choiceProbe
    ? budget
    : kind === "revision"
    ? { ...budget, revisionCount: budget.revisionCount + 1 }
    : kind === "exploration"
      ? { ...budget, explorationAttempts: budget.explorationAttempts + 1 }
      : { ...budget, resultAttempts: budget.resultAttempts + 1 };
  const started = makeAttempt(task.taskId, kind, revisionId, invocationId, now(), "started", "not_started", false, undefined, queryHash, purpose);
  const current = { ...task, budget: nextBudget, updatedAt: started.updatedAt };
  tx.putTask(current);
  tx.putAttempt(started);
  return { task: current, attempt: started };
}

export function updateAttempt(
  tx: AnsweringTransaction,
  attempt: QueryAttemptRecord,
  state: QueryAttemptRecord["state"],
  outcome: ExecutionOutcome,
  sqlExecuted: boolean,
  obstacleKind?: ImplementationObstacleKind,
): QueryAttemptRecord {
  const updated = {
    ...attempt,
    state,
    outcome,
    sqlExecuted,
    ...(obstacleKind ? { obstacleKind } : {}),
    updatedAt: now(),
  };
  tx.putAttempt(updated);
  return updated;
}

/**
 * Shared exploration/result handling of an executor failure: record the
 * attempt outcome, then raise the classified Implementation Obstacle. An
 * unknown external outcome is never retried.
 */
export async function throwExecutionFailure(
  store: AnsweringStore,
  taskId: TaskId,
  revisionId: RevisionId,
  attempt: QueryAttemptRecord | undefined,
  error: unknown,
  sqlStarted: boolean,
  queryHash: string,
  context: BusinessContext,
): Promise<never> {
  if (error instanceof AnsweringError) throw error;
  if (context.signal?.aborted) throw error;
  if (isDatabaseUnavailable(error)) {
    // Infrastructure loss ends the operation; it is not an obstacle for the Agent to work around.
    await store.transact((tx) => {
      const current = tx.getTask(taskId);
      assertTaskAccess(current, context);
      if (attempt) updateAttempt(tx, attempt, "failed", "failed", sqlStarted, "technical_failure");
    }, context);
    throw new AnsweringError(DATABASE_UNAVAILABLE, error instanceof Error ? error.message : String(error));
  }
  const unknown = error instanceof SqlExecutionError && error.outcome === "unknown";
  const kind: ImplementationObstacleKind = unknown ? "execution_outcome_unknown" : error instanceof SqlExecutionError ? error.obstacleKind : "technical_failure";
  const details = await store.transact((tx) => {
    const current = tx.getTask(taskId);
    assertTaskAccess(current, context);
    if (attempt) updateAttempt(tx, attempt, unknown ? "unknown" : "failed", unknown ? "unknown" : "failed", sqlStarted, kind);
    return obstacle(tx, current, revisionId, kind, error instanceof Error ? error.message : String(error), {
      requiresOuterDecision: unknown || kind !== "technical_failure",
      retryable: !unknown && kind === "technical_failure",
      sqlExecuted: sqlStarted,
      executionOutcome: unknown ? "unknown" : sqlStarted ? "failed" : "not_started",
      queryHash,
    });
  }, context);
  throw new AnsweringError(unknown ? "RESULT_EXECUTION_OUTCOME_UNKNOWN" : "QUERY_EXECUTION_FAILED", details.message, obstacleDetails(undefined, details));
}
