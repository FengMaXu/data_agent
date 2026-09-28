import { decisionPointQuotes } from "./decision-points.js";
import { randomUUID } from "node:crypto";
import {
  clone,
  contentHash,
  type AnswerRevisionRecord,
  type AnswerRevisionView,
  type BeginAnswer,
  type BusinessContext,
  type Evidence,
  type QueryTaskRecord,
  type ReviseAnswer,
  type RevisionId,
  type TaskId,
  type UntrustedEvidenceInput,
} from "./model.js";
import { assertTaskAccess } from "./answering-store.js";
import { AnsweringError } from "./errors.js";
import { makeInternalId } from "./internal-ids.js";
import { newBudget, obstacleDetails, reserveAttempt } from "./budget.js";
import {
  EvidenceAdmissionError,
  admitEvidence,
  type AdmissionScope,
  type AdmittedEvidence,
} from "./evidence-admission.js";
import { beginTransition, reviseTransition, type ChoiceGovernance, type EvidenceResolver } from "./transition.js";
import { initialSpecFeedback } from "./spec-feedback.js";
import { finishRevisionSubmission } from "./spec-feedback-execution.js";
import { localId, now } from "./support.js";
import { choiceContextFor, viewFromRevision } from "./views.js";
import type { AnsweringDeps } from "./deps.js";

function requestEvidenceId(requestMessageId: string): string {
  return `request_${contentHash(requestMessageId).slice(0, 24)}`;
}

/**
 * The auto-registered request handle gives SpecFeedback and reviewers the
 * original message identity. It has no quote or verification and therefore
 * never qualifies a Resolution or an evidence facet basis.
 */
function requestHandleEvidence(requestMessageId: string, observedAt: string): Evidence {
  return { id: requestEvidenceId(requestMessageId) as Evidence["id"], kind: "request_wording", authority: "request_wording", sourceRef: requestMessageId, observedAt };
}

const EVIDENCE_AUTHORITY = {
  user_confirmation: "user",
  reviewed_definition: "reviewed_business_definition",
  task_document: "task_document",
  request_wording: "request_wording",
  schema_fact: "schema",
} as const;

function evidenceFromAdmission(item: AdmittedEvidence, observedAt: string): Evidence {
  if (item.kind === "query_observation") throw new AnsweringError("EVIDENCE_REJECTED", "query_observation is registered only by exploration queries");
  return {
    id: `evidence_${randomUUID()}` as Evidence["id"],
    kind: item.kind,
    authority: EVIDENCE_AUTHORITY[item.kind],
    sourceRef: item.sourceRef,
    ...(item.contentHash ? { contentHash: item.contentHash } : {}),
    ...(item.quote ? { quote: item.quote } : {}),
    ...(item.verification ? { verification: item.verification } : {}),
    observedAt,
  } as Evidence;
}

/** Same-call localIds shadow nothing: they are checked first, then task Evidence ids. */
function evidenceResolver(registered: readonly Evidence[], added: readonly { readonly localId?: string; readonly evidence: Evidence }[]): EvidenceResolver {
  const byLocal = new Map(added.flatMap((item) => item.localId ? [[item.localId, item.evidence] as const] : []));
  const byId = new Map([...registered, ...added.map((item) => item.evidence)].map((item) => [item.id as string, item]));
  return Object.assign((ref: string) => byLocal.get(ref) ?? byId.get(ref), { localIds: [...byLocal.keys()] });
}

async function admit(inputs: readonly UntrustedEvidenceInput[] | undefined, scope: AdmissionScope): Promise<readonly AdmittedEvidence[]> {
  if (!inputs || inputs.length === 0) return [];
  try {
    return await admitEvidence(inputs, scope);
  } catch (error) {
    if (error instanceof EvidenceAdmissionError) throw new AnsweringError("EVIDENCE_REJECTED", error.message);
    throw error;
  }
}

function admissionSource(deps: AnsweringDeps, context: BusinessContext): Pick<AdmissionScope, "source" | "signal"> {
  return {
    ...(deps.evidenceSource ? { source: deps.evidenceSource } : {}),
    ...(context.signal ? { signal: context.signal } : {}),
  };
}

/** A fixed_by_request declaration must quote the original request verbatim, checked like request_wording Evidence. */
async function verifyDecisionPointQuotes(deps: AnsweringDeps, proposals: BeginAnswer["decisionPoints"], taskRequestMessageId: string, context: BusinessContext): Promise<void> {
  const quotes = decisionPointQuotes(proposals);
  if (quotes.length === 0) return;
  await admit(quotes.map((quote) => ({ kind: "request_wording" as const, quote })), { sessionId: context.sessionId, taskRequestMessageId, ...admissionSource(deps, context) });
}

function governanceFor(deps: AnsweringDeps, task: Pick<QueryTaskRecord, "taskId" | "choiceProbes">): ChoiceGovernance | undefined {
  const choiceContext = choiceContextFor(deps, task);
  return choiceContext ? { ...choiceContext, adviceRequired: deps.adviceRequired, populationDecisions: deps.populationDecisions } : undefined;
}

export async function beginAnswer(deps: AnsweringDeps, input: BeginAnswer, context: BusinessContext): Promise<AnswerRevisionView> {
  const requestMessageId = localId(input.requestMessageId, "requestMessageId");
  const requestId = localId(input.requestId, "requestId");
  // Trusted source reads happen before the Store transaction (ADR-0004).
  const admitted = await admit(input.evidence, { sessionId: context.sessionId, taskRequestMessageId: requestMessageId, ...admissionSource(deps, context) });
  await verifyDecisionPointQuotes(deps, input.decisionPoints, requestMessageId, context);
  const outcome = await deps.store.transact(async (tx) => {
    const existing = tx.findTaskByRequest(context.sessionId, requestId);
    if (existing) {
      assertTaskAccess(existing, context);
      const revision = tx.getCurrentRevision(existing.taskId);
      if (!revision) throw new AnsweringError("REVISION_NOT_FOUND", "Existing task has no current revision");
      return { view: viewFromRevision(existing.taskId, revision, choiceContextFor(deps, existing)) } as const;
    }
    const taskId = makeInternalId("task") as unknown as TaskId;
    const revisionId = makeInternalId("revision") as unknown as RevisionId;
    const createdAt = now();
    const requestEvidence = requestHandleEvidence(requestMessageId, createdAt);
    const added = admitted.map((item) => ({ ...(item.localId ? { localId: item.localId } : {}), evidence: evidenceFromAdmission(item, createdAt) }));
    const evidence = [requestEvidence, ...added.map((item) => item.evidence)];
    for (const item of evidence) tx.appendEvidence(taskId, item);
    const body = beginTransition(
      { spec: input.spec, ...(input.hypotheses ? { hypotheses: input.hypotheses } : {}), ...(input.choices ? { choices: input.choices } : {}), ...(input.notProbeable ? { notProbeable: input.notProbeable } : {}), ...(input.decisionPoints ? { decisionPoints: input.decisionPoints } : {}) },
      evidenceResolver([requestEvidence], added),
      governanceFor(deps, { taskId, choiceProbes: [] }),
    );
    const baseRevision: AnswerRevisionRecord = { taskId, revisionId, requestId, ...body, state: { state: "draft", revisionId }, createdAt };
    const revision: AnswerRevisionRecord = { ...baseRevision, specFeedback: initialSpecFeedback(baseRevision, evidence, Boolean(deps.specFeedback), createdAt) };
    const task: QueryTaskRecord = { taskId, sessionId: context.sessionId, principalId: context.principal.id, requestMessageId, requestId, currentRevisionId: revisionId, lifecycle: "open", budget: newBudget(deps.budgetPolicy, createdAt), createdAt, updatedAt: createdAt };
    tx.putRevision(revision);
    tx.putTask(task);
    return {
      view: viewFromRevision(taskId, revision, choiceContextFor(deps, task)),
      feedbackTarget: { taskId, revisionId, requestMessageId, evidence: clone(evidence) },
    } as const;
  }, context);
  return finishRevisionSubmission(deps, outcome, context);
}

/**
 * Apply a revision delta to the current Revision (ADR-0004). Runtime copies
 * the base Revision; omitted facets and items carry forward unchanged and an
 * item leaves only through an explicit disposition or supersession.
 */
export async function reviseAnswer(deps: AnsweringDeps, input: ReviseAnswer, context: BusinessContext): Promise<AnswerRevisionView> {
  const taskId = input.taskId as TaskId;
  const baseRevisionId = input.baseRevisionId as RevisionId;
  const requestId = localId(input.requestId, "requestId");
  const taskRequestMessageId = await deps.store.transact((tx) => {
    const task = tx.getTask(taskId);
    assertTaskAccess(task, context);
    return task.requestMessageId;
  }, context);
  const admitted = await admit(input.evidence, { sessionId: context.sessionId, taskRequestMessageId, ...admissionSource(deps, context) });
  await verifyDecisionPointQuotes(deps, input.decisionPoints, taskRequestMessageId, context);
  const outcome = await deps.store.transact(async (tx) => {
    const existingTask = tx.getTask(taskId);
    assertTaskAccess(existingTask, context);
    if (existingTask.currentRevisionId !== baseRevisionId) throw new AnsweringError("REVISION_STALE", `Revision ${input.baseRevisionId} is stale`, { currentRevisionId: existingTask.currentRevisionId });
    const reservation = reserveAttempt(tx, existingTask, deps.budgetPolicy, "revision", baseRevisionId, context.invocationId);
    if (reservation.obstacle) return { obstacle: reservation.obstacle } as const;
    const task = reservation.task;
    const previous = tx.getRevision(baseRevisionId);
    if (!previous) throw new AnsweringError("REVISION_NOT_FOUND", `Revision ${input.baseRevisionId} was not found`);
    const createdAt = now();
    const evidence = tx.listEvidence(taskId);
    const added = admitted.map((item) => ({ ...(item.localId ? { localId: item.localId } : {}), evidence: evidenceFromAdmission(item, createdAt) }));
    for (const item of added) tx.appendEvidence(taskId, item.evidence);
    const allEvidence = [...evidence, ...added.map((item) => item.evidence)];
    // A rejected transition throws inside the transaction: no Evidence, Revision or budget is committed.
    const transition = reviseTransition(previous, {
      ...(input.spec ? { spec: input.spec } : {}),
      ...(input.addHypotheses ? { addHypotheses: input.addHypotheses } : {}),
      ...(input.addChoices ? { addChoices: input.addChoices } : {}),
      ...(input.dispositions ? { dispositions: input.dispositions } : {}),
      ...(input.notProbeable ? { notProbeable: input.notProbeable } : {}),
      ...(input.decisionPoints ? { decisionPoints: input.decisionPoints } : {}),
    }, evidenceResolver(evidence, added), governanceFor(deps, task));
    const { supersessions, ...body } = transition;
    const revisionId = makeInternalId("revision") as unknown as RevisionId;
    const baseRevision: AnswerRevisionRecord = {
      taskId,
      revisionId,
      parentRevisionId: previous.revisionId,
      requestId,
      ...body,
      state: { state: "draft", revisionId },
      createdAt,
      ...(supersessions.length > 0 ? { supersessions } : {}),
    };
    const revision: AnswerRevisionRecord = { ...baseRevision, specFeedback: initialSpecFeedback(baseRevision, allEvidence, Boolean(deps.specFeedback), baseRevision.createdAt) };
    tx.putRevision(revision);
    const { latestCandidateId: _latestCandidateId, publicationId: _publicationId, ...taskWithoutResults } = task;
    const revisedTask: QueryTaskRecord = { ...taskWithoutResults, currentRevisionId: revisionId, lifecycle: "open", updatedAt: revision.createdAt };
    tx.putAttempt({
      ...reservation.attempt!,
      state: "succeeded",
      outcome: "succeeded",
      sqlExecuted: false,
      updatedAt: revision.createdAt,
    });
    tx.putTask(revisedTask);
    return { view: viewFromRevision(taskId, revision, choiceContextFor(deps, task)), feedbackTarget: { taskId, revisionId, requestMessageId: task.requestMessageId, evidence: clone(allEvidence) } } as const;
  }, context);
  if ("obstacle" in outcome) {
    throw new AnsweringError("IMPLEMENTATION_BUDGET_EXHAUSTED", outcome.obstacle.message, obstacleDetails(undefined, outcome.obstacle));
  }
  return finishRevisionSubmission(deps, outcome, context);
}
