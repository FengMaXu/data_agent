import type { AnswerRevisionView, BusinessContext, Evidence, RevisionId, SpecFeedback, TaskId } from "./model.js";
import { assertTaskAccess } from "./answering-store.js";
import { AnsweringError } from "./errors.js";
import { taskBudget } from "./budget.js";
import { now } from "./support.js";
import { probeContextFor, viewFromRevision } from "./views.js";
import type { AnsweringDeps, ResolvedSpecFeedbackOptions } from "./deps.js";
import type { RequirementPhrase } from "../judgment/spec-alignment.js";
import {
  admitRequirements,
  assembleSpecFeedbackInput,
  completedSpecFeedback,
  initialSpecFeedback,
  unavailableSpecFeedback,
  type SpecFeedbackAssembly,
} from "./spec-feedback.js";

export interface RevisionFeedbackTarget {
  readonly taskId: TaskId;
  readonly revisionId: RevisionId;
  readonly requestMessageId: string;
  /** Evidence frozen in the same transaction that created the Revision. */
  readonly evidence: readonly Evidence[];
}

/** What a view says about the call and the task rather than the Revision; kept when the view is re-read. */
function extrasOf(view: AnswerRevisionView): Partial<AnswerRevisionView> {
  return {
    ...(view.outcomes ? { outcomes: view.outcomes } : {}),
    ...(view.role ? { role: view.role } : {}),
    ...(view.parent ? { parent: view.parent } : {}),
  };
}

export interface RevisionSubmissionOutcome {
  readonly view: AnswerRevisionView;
  readonly feedbackTarget?: RevisionFeedbackTarget;
}

/**
 * Post-commit, advisory SpecFeedback. The Revision is already durable; a
 * failed or slow assessment never changes qualification or the returned view
 * beyond attaching the report.
 */
export async function finishRevisionSubmission(deps: AnsweringDeps, outcome: RevisionSubmissionOutcome, context: BusinessContext): Promise<AnswerRevisionView> {
  const target = outcome.feedbackTarget;
  if (!target || !deps.specFeedback) return outcome.view;
  const feedback = await evaluateSpecFeedback(deps, deps.specFeedback, target, context);
  let persisted: SpecFeedback | undefined;
  try {
    persisted = await persistSpecFeedback(deps, target, feedback, context);
  } catch (error) {
    // The Revision is already committed. A failed feedback write must not be
    // presented as completed; inspect/recovery can still observe pending.
    if (context.signal?.aborted) throw error;
    return outcome.view;
  }
  if (!persisted) return outcome.view;
  try {
    const stored = await deps.store.transact((tx) => ({ revision: tx.getRevision(target.revisionId), task: tx.getTask(target.taskId) }), context);
    if (!stored.revision) return outcome.view;
    return { ...viewFromRevision(target.taskId, stored.revision, stored.task ? probeContextFor(deps, stored.task, target.evidence) : undefined, stored.task?.role === "report"), ...extrasOf(outcome.view) };
  } catch (error) {
    if (context.signal?.aborted) throw error;
    return outcome.view;
  }
}

async function evaluateSpecFeedback(deps: AnsweringDeps, options: ResolvedSpecFeedbackOptions, target: RevisionFeedbackTarget, context: BusinessContext): Promise<SpecFeedback> {
  const startedAt = now();
  const startedAtMs = Date.now();
  const snapshot = await deps.store.transact((tx) => {
    const task = tx.getTask(target.taskId);
    assertTaskAccess(task, context);
    const revision = tx.getRevision(target.revisionId);
    if (!revision) throw new AnsweringError("REVISION_NOT_FOUND", `Revision ${target.revisionId} was not found`);
    return { task, revision };
  }, context);
  const evidence = target.evidence;
  const base = snapshot.revision.specFeedback ?? initialSpecFeedback(snapshot.revision, evidence, true, startedAt);
  if (base.status === "skipped") return base;
  const configuredTimeout = options.timeoutMs;
  const budget = taskBudget(snapshot.task, deps.budgetPolicy);
  const taskDeadline = Date.parse(budget.startedAt) + budget.policy.maxElapsedMs;
  const externalDeadline = context.deadlineAt ?? Number.POSITIVE_INFINITY;
  const feedbackDeadline = Math.min(startedAtMs + configuredTimeout, taskDeadline, externalDeadline);
  const unavailable = (reason: string, assembly?: SpecFeedbackAssembly): SpecFeedback => unavailableSpecFeedback(
    snapshot.revision,
    base,
    reason,
    {
      ...(assembly?.inputHash ? { inputHash: assembly.inputHash } : {}),
      ...(assembly?.evidenceIds ? { evidenceIds: assembly.evidenceIds } : {}),
      ...(assembly?.limitations ? { limitations: assembly.limitations } : {}),
      startedAt,
      completedAt: now(),
    },
  );
  if (feedbackDeadline <= Date.now()) return unavailable("task_time_budget_exhausted");

  const controller = new AbortController();
  let timedOut = false;
  let rejectDeadline: ((reason?: unknown) => void) | undefined;
  const deadlinePromise = new Promise<never>((_, reject) => { rejectDeadline = reject; });
  let rejectCancelled: ((reason?: unknown) => void) | undefined;
  const cancellationPromise = new Promise<never>((_, reject) => { rejectCancelled = reject; });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectDeadline?.(new Error("SPEC_FEEDBACK_TIMEOUT"));
  }, Math.max(1, feedbackDeadline - Date.now()));
  const forwardAbort = () => {
    controller.abort();
    rejectCancelled?.(new Error("SPEC_FEEDBACK_CANCELLED"));
  };
  if (context.signal?.aborted) {
    clearTimeout(timeout);
    throw new AnsweringError("ANSWERING_CONTEXT_INVALID", "Answering operation was cancelled");
  }
  context.signal?.addEventListener("abort", forwardAbort, { once: true });
  let assembly: SpecFeedbackAssembly | undefined;
  try {
    const originalQuestion = await Promise.race([
      options.getOriginalQuestion(target.requestMessageId, { signal: controller.signal }),
      deadlinePromise,
      cancellationPromise,
    ]);
    if (!originalQuestion) throw new Error("ORIGINAL_QUESTION_UNAVAILABLE");
    if (context.signal?.aborted) throw new AnsweringError("ANSWERING_CONTEXT_INVALID", "Answering operation was cancelled");
    if (timedOut) return unavailable("timeout", assembly);
    const phrases = options.requirementExtractor
      ? await Promise.race([requirementsOf(options, target.requestMessageId, originalQuestion, controller.signal), deadlinePromise, cancellationPromise])
      : undefined;
    if (timedOut) return unavailable("timeout", assembly);
    const admitted = admitRequirements(originalQuestion, phrases ?? []);
    const limitations = [
      ...(!options.requirementExtractor ? ["requirement_extractor_not_configured"] : []),
      ...(admitted.dropped > 0 ? [`requirements_not_verbatim:${admitted.dropped}`] : []),
    ];
    assembly = assembleSpecFeedbackInput(snapshot.revision, evidence, originalQuestion, admitted.admitted, limitations, options.maxInputBytes);
    if (context.signal?.aborted) throw new AnsweringError("ANSWERING_CONTEXT_INVALID", "Answering operation was cancelled");
    if (timedOut) return unavailable("timeout", assembly);
    const assessment = await Promise.race([
      options.assessor.assess(assembly.input, { signal: controller.signal }),
      deadlinePromise,
      cancellationPromise,
    ]);
    if (context.signal?.aborted) throw new AnsweringError("ANSWERING_CONTEXT_INVALID", "Answering operation was cancelled");
    if (timedOut) return unavailable("timeout", assembly);
    const completedAt = now();
    return completedSpecFeedback(snapshot.revision, base, assessment, assembly.inputHash, assembly.evidenceIds, assembly.limitations, startedAt, completedAt);
  } catch (error) {
    if (context.signal?.aborted) throw error;
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
    const message = error instanceof Error ? error.message : String(error);
    const reason = timedOut || code === "TIMEOUT" ? "timeout"
      : code === "ABORTED" ? "cancelled"
        : code === "input_too_large" || message.includes("exceeds") ? "input_too_large"
          : code === "original_question_unavailable" || message.includes("ORIGINAL_QUESTION_UNAVAILABLE") ? "original_question_unavailable"
            : code === "INVALID_RESPONSE" || message.startsWith("INVALID_SPEC_FEEDBACK_ASSESSMENT") ? "invalid_provider_response"
              : code === "INVALID_INPUT" || code === "invalid_input" ? "invalid_assessor_input"
                : code === "HTTP_ERROR" ? "provider_http_error"
                  : "provider_unavailable";
    return unavailable(reason, assembly);
  } finally {
    clearTimeout(timeout);
    context.signal?.removeEventListener("abort", forwardAbort);
  }
}

/** One extraction per request message: the request does not change across Revisions. A failed extraction is not cached. */
const extractions = new WeakMap<ResolvedSpecFeedbackOptions, Map<string, Promise<readonly RequirementPhrase[]>>>();

function requirementsOf(options: ResolvedSpecFeedbackOptions, requestMessageId: string, originalQuestion: string, signal: AbortSignal): Promise<readonly RequirementPhrase[]> {
  let cache = extractions.get(options);
  if (!cache) extractions.set(options, cache = new Map());
  const key = `${requestMessageId} ${originalQuestion}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = options.requirementExtractor!.extract(originalQuestion, { signal });
  cache.set(key, pending);
  pending.catch(() => cache!.delete(key));
  return pending;
}

async function persistSpecFeedback(deps: AnsweringDeps, target: RevisionFeedbackTarget, feedback: SpecFeedback, context: BusinessContext): Promise<SpecFeedback | undefined> {
  return deps.store.transact((tx) => {
    const revision = tx.getRevision(target.revisionId);
    if (!revision) return undefined;
    const existing = revision.specFeedback;
    if (!existing || existing.status !== "pending") return existing;
    const task = tx.getTask(target.taskId);
    assertTaskAccess(task, context);
    const stale = task.currentRevisionId !== target.revisionId;
    const persisted: SpecFeedback = stale
      ? { ...feedback, stale: true, currentRevisionId: task.currentRevisionId }
      : feedback;
    tx.putRevision({ ...revision, specFeedback: persisted });
    return persisted;
  }, context);
}
