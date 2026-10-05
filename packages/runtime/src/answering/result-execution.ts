import { randomUUID } from "node:crypto";
import {
  contentHash,
  type AnswerRevisionRecord,
  type BoundedResult,
  type BusinessContext,
  type CheckCoverage,
  type ExecuteQuery,
  type QueryAttemptRecord,
  type QueryExecutionView,
  type ReadyRevision,
  type ResultCandidateRecord,
  type RevisionId,
  type TaskId,
} from "./model.js";
import { assertTaskAccess } from "./answering-store.js";
import { AnsweringError } from "./errors.js";
import { makeInternalId } from "./internal-ids.js";
import { makeAttempt, obstacle, obstacleDetails, reserveAttempt, taskBudget, throwExecutionFailure, updateAttempt } from "./budget.js";
import { sealForResult } from "./qualification.js";
import { assertDeliverable } from "./report.js";
import { candidateCheckFailure, evaluateCandidateCheckReport } from "./candidate-checks.js";
import { evaluateFanout, fanoutCoverage, fanoutFindings } from "./fanout-execution.js";
import { specFeedbackCoverage } from "./spec-feedback.js";
import type { PrivateResultObject } from "./result-store.js";
import { boundedResult } from "./sql-execution.js";
import { realizationConflicts } from "./choice-realization.js";
import { resultFingerprint } from "./result-fingerprint.js";
import { asRecord, now } from "./support.js";
import type { AnsweringDeps } from "./deps.js";

type ResultInput = Extract<ExecuteQuery, { readonly kind: "result" }>;

interface ResultExecutionMemo {
  readonly state: "started" | "settled";
  readonly taskId: string;
  readonly revisionId: string;
  readonly queryHash: string;
  /** Settled memos point at ResultStore; result rows never enter Pi Session state. */
  readonly resultRef?: string;
  readonly contentHash?: string;
}

function resultExecutionMemo(value: unknown): ResultExecutionMemo | undefined {
  const record = asRecord(value);
  if (!record || (record.state !== "started" && record.state !== "settled") || typeof record.taskId !== "string" || typeof record.revisionId !== "string" || typeof record.queryHash !== "string") return undefined;
  if (record.state === "settled") {
    if (typeof record.resultRef !== "string" || typeof record.contentHash !== "string") return undefined;
    return { state: "settled", taskId: record.taskId, revisionId: record.revisionId, queryHash: record.queryHash, resultRef: record.resultRef, contentHash: record.contentHash };
  }
  return { state: "started", taskId: record.taskId, revisionId: record.revisionId, queryHash: record.queryHash };
}

export async function markCandidateCorrupt(deps: AnsweringDeps, candidate: ResultCandidateRecord, context: BusinessContext): Promise<void> {
  await deps.store.transact((tx) => {
    const current = tx.getCandidate(candidate.candidateId);
    if (!current || current.status === "corrupt") return;
    tx.putCandidate({ ...current, status: "corrupt", publishable: false, findings: [...current.findings, { id: `integrity-${current.candidateId}`, kind: "integrity_conflict", message: "ResultStore object is missing or does not match the Candidate content hash.", blocking: true }] });
  }, context).catch(() => undefined);
}

async function resultView(deps: AnsweringDeps, candidate: ResultCandidateRecord, context: BusinessContext): Promise<QueryExecutionView> {
  if (candidate.status !== "ready" || !candidate.publishable) throw new AnsweringError("RESULT_INTEGRITY_MISMATCH", "Result Candidate is corrupt and cannot be used");
  try {
    const result = await deps.resultStore.openPrivate(candidate.resultRef, context);
    if (!result || result.contentHash !== candidate.contentHash) throw new Error("RESULT_INTEGRITY_MISMATCH");
    const preview: BoundedResult = { columns: result.columns, rows: result.rows.slice(0, 50), columnTypes: result.columnTypes, rowCount: result.rowCount, truncated: result.rowCount > 50 };
    return {
      kind: "result",
      artifact: { kind: "candidate", candidateId: candidate.candidateId, revisionId: candidate.revisionId, resultRef: candidate.resultRef },
      preview,
      findings: candidate.findings,
      ...(candidate.coverage ? { coverage: candidate.coverage } : {}),
      ...(candidate.fanout ? { fanout: candidate.fanout } : {}),
      ...(candidate.attemptId ? { attemptId: candidate.attemptId } : {}),
    };
  } catch {
    await markCandidateCorrupt(deps, candidate, context);
    throw new AnsweringError("RESULT_INTEGRITY_MISMATCH", "Result Candidate references a missing or changed private result");
  }
}

/** Seal the current Revision, or record a blocked result attempt while anything is unresolved. */
async function sealRevision(deps: AnsweringDeps, input: ResultInput, taskId: TaskId, revisionId: RevisionId, queryHash: string, context: BusinessContext): Promise<AnswerRevisionRecord> {
  const sealedOutcome = await deps.store.transact((tx) => {
    const currentTask = tx.getTask(taskId);
    assertTaskAccess(currentTask, context);
    if (currentTask.currentRevisionId !== revisionId) throw new AnsweringError("REVISION_STALE", "Result query must use the current revision", { currentRevisionId: currentTask.currentRevisionId });
    // ADR-0009: a Report Task never delivers; a chart query needs a current, handled Report Task.
    assertDeliverable(tx, currentTask);
    const revision = tx.getRevision(revisionId);
    if (!revision) throw new AnsweringError("REVISION_NOT_FOUND", `Revision ${input.revisionId} was not found`);
    const result = deps.semanticQualificationMode === "required"
      ? sealForResult(revision)
      : {
          ok: true as const,
          revision: {
            state: "ready" as const,
            revisionId: revision.revisionId,
            ready: `ready_${randomUUID()}` as ReadyRevision["ready"],
          },
        };
    if (!result.ok) {
      const blocked = makeAttempt(taskId, "result", revisionId, context.invocationId, now(), "blocked", "not_started", false, "business_judgment_required", queryHash);
      tx.putAttempt(blocked);
      const undeclared = "undeclaredDecisionPoints" in result ? result.undeclaredDecisionPoints : [];
      const pointsText = undeclared.length > 0 ? `; declare decision points: ${undeclared.join(", ")}` : "";
      const details = obstacle(tx, currentTask, revisionId, "business_judgment_required", `Final query is blocked until all required facets, hypotheses, choices and decision points are handled${pointsText}`, {
        requiresOuterDecision: true,
        retryable: false,
        sqlExecuted: false,
        executionOutcome: "not_started",
        queryHash,
      });
      return { obstacle: details, unresolvedFacets: result.unresolvedFacets, unresolvedHypotheses: result.unresolvedHypotheses, unresolvedChoices: result.unresolvedChoices, undeclaredDecisionPoints: undeclared } as const;
    }
    const readyRevision: AnswerRevisionRecord = { ...revision, state: result.revision };
    tx.putRevision(readyRevision);
    return { revision: readyRevision } as const;
  }, context);
  if ("obstacle" in sealedOutcome) {
    throw new AnsweringError("UNRESOLVED_ASSUMPTIONS", sealedOutcome.obstacle.message, obstacleDetails({ unresolvedFacets: sealedOutcome.unresolvedFacets, unresolvedHypotheses: sealedOutcome.unresolvedHypotheses, unresolvedChoices: sealedOutcome.unresolvedChoices, undeclaredDecisionPoints: sealedOutcome.undeclaredDecisionPoints }, sealedOutcome.obstacle));
  }
  return sealedOutcome.revision;
}

/**
 * The one final query of a sealed Revision. It executes at most once per
 * invocation (Pi memo + stable query identity), freezes an immutable Result
 * Candidate, and never retries an unknown external outcome.
 */
export async function executeResult(
  deps: AnsweringDeps,
  input: ResultInput,
  revisionId: RevisionId,
  limit: number,
  context: BusinessContext,
): Promise<QueryExecutionView> {
  const taskId = input.taskId as TaskId;
  const queryHash = contentHash(input.sql.trim());
  const sealed = await sealRevision(deps, input, taskId, revisionId, queryHash, context);

  const memo = resultExecutionMemo(await context.memo?.get("answering.result-execution"));
  if (memo && (memo.taskId !== input.taskId || memo.revisionId !== input.revisionId || memo.queryHash !== queryHash)) {
    throw new AnsweringError("INVALID_REQUEST", "RESULT_INVOCATION_IDEMPOTENCY_CONFLICT");
  }
  let attempt: QueryAttemptRecord | undefined;
  if (memo?.state === "started") {
    const details = await deps.store.transact((tx) => {
      const current = tx.getTask(taskId);
      assertTaskAccess(current, context);
      const priorAttempt = tx.findAttemptByInvocation(taskId, context.invocationId, "result");
      if (priorAttempt && priorAttempt.state === "started") updateAttempt(tx, priorAttempt, "unknown", "unknown", true, "execution_outcome_unknown");
      return obstacle(tx, current, revisionId, "execution_outcome_unknown", "The previous result execution has no safe replay outcome; SQL was not retried", {
        requiresOuterDecision: true,
        retryable: false,
        sqlExecuted: true,
        executionOutcome: "unknown",
        queryHash,
      });
    }, context);
    throw new AnsweringError("RESULT_EXECUTION_OUTCOME_UNKNOWN", details.message, obstacleDetails(undefined, details));
  }
  if (!memo) {
    const preflight = await deps.store.transact((tx) => {
      const existing = tx.findCandidateByInvocation(taskId, context.invocationId) ?? tx.findCandidateByQuery(taskId, revisionId, queryHash);
      if (existing) return { existing } as const;
      const current = tx.getTask(taskId);
      assertTaskAccess(current, context);
      const unknownAttempt = tx.findAttemptByQuery(taskId, revisionId, queryHash, "result");
      if (unknownAttempt?.outcome === "unknown") {
        return { unknown: obstacle(tx, current, revisionId, "execution_outcome_unknown", "A matching result query has an unknown execution outcome; SQL was not retried", {
          requiresOuterDecision: true,
          retryable: false,
          sqlExecuted: true,
          executionOutcome: "unknown",
          queryHash,
        }) } as const;
      }
      return { reservation: reserveAttempt(tx, current, deps.budgetPolicy, "result", revisionId, context.invocationId, queryHash) } as const;
    }, context);
    if ("existing" in preflight) {
      if (preflight.existing.queryHash !== queryHash) throw new AnsweringError("INVALID_REQUEST", "RESULT_INVOCATION_IDEMPOTENCY_CONFLICT");
      return resultView(deps, preflight.existing, context);
    }
    if ("unknown" in preflight) throw new AnsweringError("RESULT_EXECUTION_OUTCOME_UNKNOWN", preflight.unknown.message, obstacleDetails(undefined, preflight.unknown));
    if (preflight.reservation.obstacle) throw new AnsweringError("IMPLEMENTATION_BUDGET_EXHAUSTED", preflight.reservation.obstacle.message, obstacleDetails(undefined, preflight.reservation.obstacle));
    attempt = preflight.reservation.attempt;
  } else {
    const existing = await deps.store.transact((tx) => tx.findCandidateByInvocation(taskId, context.invocationId) ?? tx.findCandidateByQuery(taskId, revisionId, queryHash), context);
    if (existing) {
      if (existing.queryHash !== queryHash) throw new AnsweringError("INVALID_REQUEST", "RESULT_INVOCATION_IDEMPOTENCY_CONFLICT");
      return resultView(deps, existing, context);
    }
    attempt = await deps.store.transact((tx) => tx.findAttemptByInvocation(taskId, context.invocationId, "result"), context);
  }

  let privateResult: PrivateResultObject;
  let sqlStarted = memo?.state === "settled";
  try {
    if (memo?.state === "settled") {
      const reopened = await deps.resultStore.openPrivate(memo.resultRef as PrivateResultObject["resultRef"], context);
      if (!reopened || reopened.contentHash !== memo.contentHash) {
        const details = await deps.store.transact((tx) => {
          const current = tx.getTask(taskId);
          assertTaskAccess(current, context);
          return obstacle(tx, current, revisionId, "execution_outcome_unknown", "The settled execution no longer has its immutable ResultStore object; SQL was not retried", {
            requiresOuterDecision: true,
            retryable: false,
            sqlExecuted: true,
            executionOutcome: "unknown",
            queryHash,
          });
        }, context);
        throw new AnsweringError("RESULT_EXECUTION_OUTCOME_UNKNOWN", details.message, obstacleDetails(undefined, details));
      }
      privateResult = reopened;
    } else {
      await context.memo?.set("answering.result-execution", { state: "started", taskId: input.taskId, revisionId: input.revisionId, queryHash });
      sqlStarted = true;
      const executionKey = `result:${contentHash({ taskId, revisionId, queryHash })}`;
      const result = boundedResult(await deps.sqlExecutor.run(input.sql, limit, {
        kind: "result",
        idempotencyKey: executionKey,
        ...(context.signal ? { signal: context.signal } : {}),
        ...(context.deadlineAt ? { deadlineAt: context.deadlineAt } : {}),
      }));
      if (result.truncated) {
        const details = await deps.store.transact((tx) => {
          const current = tx.getTask(taskId);
          assertTaskAccess(current, context);
          if (attempt) updateAttempt(tx, attempt, "failed", "succeeded", true, "technical_failure");
          return obstacle(tx, current, revisionId, "technical_failure", "A truncated result cannot become a Result Candidate", {
            requiresOuterDecision: false,
            retryable: true,
            sqlExecuted: true,
            executionOutcome: "succeeded",
            queryHash,
          });
        }, context);
        throw new AnsweringError("RESULT_INCOMPLETE", details.message, obstacleDetails(undefined, details));
      }
      privateResult = await deps.resultStore.createPrivate(result, context);
      await context.memo?.set("answering.result-execution", { state: "settled", taskId: input.taskId, revisionId: input.revisionId, queryHash, resultRef: privateResult.resultRef, contentHash: privateResult.contentHash });
    }
  } catch (error) {
    return throwExecutionFailure(deps.store, taskId, revisionId, attempt, error, sqlStarted, queryHash, context);
  }

  const checkReport = evaluateCandidateCheckReport({ spec: sealed.spec, result: privateResult, queryHash });
  const failure = candidateCheckFailure(checkReport.findings);
  if (failure) {
    await deps.resultStore.discard(privateResult.resultRef, context);
    const details = await deps.store.transact((tx) => {
      const current = tx.getTask(taskId);
      assertTaskAccess(current, context);
      if (attempt) updateAttempt(tx, attempt, "failed", "succeeded", true, "technical_failure");
      // The finding leads the message so the fix is on the first line, not after the attempt history.
      return obstacle(tx, current, revisionId, "technical_failure", `The result failed an online CandidateCheck: ${failure.message}`, {
        requiresOuterDecision: false,
        retryable: true,
        sqlExecuted: true,
        executionOutcome: "succeeded",
        queryHash,
        coverage: checkReport.coverage,
      });
    }, context);
    throw new AnsweringError("CANDIDATE_CHECK_FAILED", details.message, obstacleDetails({ findings: checkReport.findings, coverage: checkReport.coverage }, details));
  }

  if (deps.choiceProbes) {
    // ADR-0005: the delivered result must not be the output of an alternative the Revision did not adopt.
    const fingerprint = resultFingerprint(privateResult.columns, privateResult.rows);
    const probes = await deps.store.transact((tx) => tx.getTask(taskId)?.choiceProbes ?? [], context);
    const conflicts = realizationConflicts(sealed, probes, fingerprint);
    if (conflicts.length > 0) {
      await deps.resultStore.discard(privateResult.resultRef, context);
      const explanation = conflicts.map((conflict) => `Choice ${conflict.choiceId} adopted ${conflict.adoptedAlternativeId}, but the result equals the probe output of ${conflict.realizedAlternativeId}`).join("; ");
      const details = await deps.store.transact((tx) => {
        const current = tx.getTask(taskId);
        assertTaskAccess(current, context);
        if (attempt) updateAttempt(tx, attempt, "failed", "succeeded", true, "business_judgment_required");
        return obstacle(tx, current, revisionId, "business_judgment_required", `${explanation}. Make the SQL implement the adopted alternative, or revise the decision with its rationale before querying again.`, {
          requiresOuterDecision: true,
          retryable: true,
          sqlExecuted: true,
          executionOutcome: "succeeded",
          queryHash,
        });
      }, context);
      throw new AnsweringError("CHOICE_NOT_REALIZED", details.message, obstacleDetails({ conflicts }, details));
    }
  }

  const fanout = await evaluateFanout(deps, taskId, revisionId, queryHash, input.sql.trim(), context);
  const combinedCoverage: readonly CheckCoverage[] = [...checkReport.coverage, fanoutCoverage(fanout)];
  const combinedFindings = [...checkReport.findings, ...fanoutFindings(fanout)];

  const budgetAfterResult = await deps.store.transact((tx) => {
    const current = tx.getTask(taskId);
    assertTaskAccess(current, context);
    const budget = taskBudget(current, deps.budgetPolicy);
    if (budget.observedRows + privateResult.rowCount > budget.policy.maxObservedRows) {
      const chargedTask = { ...current, budget: { ...budget, observedRows: budget.observedRows + privateResult.rowCount }, updatedAt: now() };
      tx.putTask(chargedTask);
      if (attempt) updateAttempt(tx, attempt, "failed", "succeeded", true, "budget_exhausted");
      return obstacle(tx, chargedTask, revisionId, "budget_exhausted", "Observed-row budget exhausted after result execution", {
        requiresOuterDecision: true,
        retryable: false,
        sqlExecuted: true,
        executionOutcome: "succeeded",
        queryHash,
        coverage: combinedCoverage,
      });
    }
    tx.putTask({ ...current, budget: { ...budget, observedRows: budget.observedRows + privateResult.rowCount }, updatedAt: now() });
    if (attempt) updateAttempt(tx, attempt, "succeeded", "succeeded", true);
    return undefined;
  }, context);
  if (budgetAfterResult) {
    await deps.resultStore.discard(privateResult.resultRef, context);
    throw new AnsweringError("IMPLEMENTATION_BUDGET_EXHAUSTED", budgetAfterResult.message, obstacleDetails(undefined, budgetAfterResult));
  }

  const baseCandidate: ResultCandidateRecord = {
    candidateId: makeInternalId("candidate") as unknown as ResultCandidateRecord["candidateId"],
    taskId,
    revisionId,
    resultRef: privateResult.resultRef,
    resultSchema: [...privateResult.columns],
    rowCount: privateResult.rowCount,
    contentHash: privateResult.contentHash,
    sql: input.sql.trim(),
    queryHash,
    findings: combinedFindings,
    coverage: combinedCoverage,
    fanout,
    ...(attempt ? { attemptId: attempt.attemptId } : {}),
    createdByInvocationId: context.invocationId,
    createdAt: now(),
    status: "ready",
    publishable: true,
  };
  let committed: ResultCandidateRecord;
  try {
    committed = await deps.store.transact((tx) => {
      const currentTask = tx.getTask(taskId);
      assertTaskAccess(currentTask, context);
      if (currentTask.currentRevisionId !== revisionId) throw new AnsweringError("REVISION_STALE", "Revision changed while the result was executing");
      const prior = tx.findCandidateByInvocation(taskId, context.invocationId) ?? tx.findCandidateByQuery(taskId, revisionId, queryHash);
      if (prior) return prior;
      // Feedback is read in the same transaction that freezes the Candidate,
      // so a later report write cannot mutate this Candidate or its Receipt.
      const latestRevision = tx.getRevision(revisionId);
      const feedbackCoverage = specFeedbackCoverage(latestRevision?.specFeedback);
      const candidate: ResultCandidateRecord = {
        ...baseCandidate,
        coverage: [...combinedCoverage, feedbackCoverage],
      };
      tx.putCandidate(candidate);
      tx.putTask({ ...currentTask, latestCandidateId: candidate.candidateId, updatedAt: candidate.createdAt });
      return candidate;
    }, context);
  } catch (error) {
    // A commit response may be lost after the Candidate became durable. Look
    // it up by stable query identity before reporting failure. Otherwise keep
    // the private object for Pi invocation replay; a later GC pass removes
    // objects that remain unreferenced after the invocation is settled.
    const recovered = await deps.store.transact((tx) => tx.findCandidateByQuery(taskId, revisionId, queryHash), context).catch(() => undefined);
    if (recovered) return resultView(deps, recovered, context);
    throw error;
  }
  if (committed.candidateId !== baseCandidate.candidateId) await deps.resultStore.discard(privateResult.resultRef, context);
  return resultView(deps, committed, context);
}
