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
  type SpecStep,
  type StepOutcome,
  type Supersession,
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
import { beginTransition, reviseTransition, type ChoiceGovernance, type EvidenceResolver, type RevisionBody } from "./transition.js";
import { QualificationError } from "./qualification.js";
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

/** Errors that reject one step of a stepped call; anything else aborts the whole call. */
const STEP_REJECTIONS = new Set(["SPEC_TRANSITION_INVALID", "INVALID_REQUEST", "EVIDENCE_REJECTED"]);

function stepRejection(label: string, error: unknown): StepOutcome | undefined {
  if (error instanceof AnsweringError && STEP_REJECTIONS.has(error.code)) return { label, status: "rejected", code: error.code, message: error.message };
  if (error instanceof QualificationError) return { label, status: "rejected", code: error.code, message: error.message };
  return undefined;
}

interface PreparedStep {
  readonly label: string;
  readonly step: SpecStep;
  readonly admitted: readonly AdmittedEvidence[];
  /** Set when trusted-source checks already rejected the step. */
  readonly rejected?: StepOutcome;
}

const SINGLE_DELTA_FIELDS = ["hypotheses", "choices", "addHypotheses", "addChoices", "dispositions", "notProbeable", "decisionPoints", "evidence"] as const;

function assertStepsAlone(input: BeginAnswer | ReviseAnswer, extra: readonly string[]): void {
  const record = input as unknown as Record<string, unknown>;
  const mixed = [...SINGLE_DELTA_FIELDS, ...extra].filter((key) => record[key] !== undefined);
  if (mixed.length > 0) throw new AnsweringError("INVALID_REQUEST", `steps cannot be combined with ${mixed.join(", ")}; put every change in a step`);
  if (!Array.isArray(input.steps) || input.steps.length === 0) throw new AnsweringError("INVALID_REQUEST", "steps must list at least one step");
}

/** Evidence admission and request quotes are checked per step, before the Store transaction (ADR-0004). */
async function prepareSteps(deps: AnsweringDeps, steps: readonly SpecStep[], taskRequestMessageId: string, context: BusinessContext): Promise<readonly PreparedStep[]> {
  const prepared: PreparedStep[] = [];
  for (const [index, step] of steps.entries()) {
    const label = typeof step.label === "string" && step.label.trim() ? step.label.trim() : `step ${index + 1}`;
    try {
      const admitted = await admit(step.evidence, { sessionId: context.sessionId, taskRequestMessageId, ...admissionSource(deps, context) });
      await verifyDecisionPointQuotes(deps, step.decisionPoints, taskRequestMessageId, context);
      prepared.push({ label, step, admitted });
    } catch (error) {
      const rejected = stepRejection(label, error);
      if (!rejected) throw error;
      prepared.push({ label, step, admitted: [], rejected });
    }
  }
  return prepared;
}

/**
 * Applies each step to the state the earlier applied steps left. A rejected
 * step changes nothing, and its Evidence is not registered.
 */
function applySteps(base: RevisionBody, steps: readonly PreparedStep[], registered: readonly Evidence[], governance: ChoiceGovernance | undefined, createdAt: string) {
  let body = base;
  const supersessions: Supersession[] = [];
  const outcomes: StepOutcome[] = [];
  const added: Evidence[] = [];
  for (const prepared of steps) {
    if (prepared.rejected) {
      outcomes.push(prepared.rejected);
      continue;
    }
    const { step, label } = prepared;
    const stepEvidence = prepared.admitted.map((item) => ({ ...(item.localId ? { localId: item.localId } : {}), evidence: evidenceFromAdmission(item, createdAt) }));
    try {
      const { supersessions: replaced, ...next } = reviseTransition(body, {
        ...(step.spec ? { spec: step.spec } : {}),
        ...(step.addHypotheses ? { addHypotheses: step.addHypotheses } : {}),
        ...(step.addChoices ? { addChoices: step.addChoices } : {}),
        ...(step.dispositions ? { dispositions: step.dispositions } : {}),
        ...(step.notProbeable ? { notProbeable: step.notProbeable } : {}),
        ...(step.decisionPoints ? { decisionPoints: step.decisionPoints } : {}),
      }, evidenceResolver([...registered, ...added], stepEvidence), governance);
      body = next;
      supersessions.push(...replaced);
      added.push(...stepEvidence.map((item) => item.evidence));
      outcomes.push({ label, status: "applied" });
    } catch (error) {
      const rejected = stepRejection(label, error);
      if (!rejected) throw error;
      outcomes.push(rejected);
    }
  }
  return { body, supersessions, outcomes, added, applied: outcomes.some((outcome) => outcome.status === "applied") };
}

function withSteps(view: AnswerRevisionView, steps: readonly StepOutcome[] | undefined): AnswerRevisionView {
  return steps ? { ...view, steps } : view;
}

export async function beginAnswer(deps: AnsweringDeps, input: BeginAnswer, context: BusinessContext): Promise<AnswerRevisionView> {
  if (input.steps !== undefined) return beginStepped(deps, input, context);
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
  if (input.steps !== undefined) return reviseStepped(deps, input, context);
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

/**
 * Stepped begin: the task always starts, from an empty spec, so a later call
 * can continue it even when every step was rejected. Begin is not charged.
 */
async function beginStepped(deps: AnsweringDeps, input: BeginAnswer, context: BusinessContext): Promise<AnswerRevisionView> {
  assertStepsAlone(input, []);
  const requestMessageId = localId(input.requestMessageId, "requestMessageId");
  const requestId = localId(input.requestId, "requestId");
  const prepared = await prepareSteps(deps, input.steps!, requestMessageId, context);
  let outcomes: readonly StepOutcome[] | undefined;
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
    const governance = governanceFor(deps, { taskId, choiceProbes: [] });
    const empty = beginTransition({ spec: {} }, evidenceResolver([requestEvidence], []), governance);
    const stepped = applySteps(empty, prepared, [requestEvidence], governance, createdAt);
    outcomes = stepped.outcomes;
    const evidence = [requestEvidence, ...stepped.added];
    for (const item of evidence) tx.appendEvidence(taskId, item);
    const baseRevision: AnswerRevisionRecord = {
      taskId,
      revisionId,
      requestId,
      ...stepped.body,
      state: { state: "draft", revisionId },
      createdAt,
      ...(stepped.supersessions.length > 0 ? { supersessions: stepped.supersessions } : {}),
    };
    const revision: AnswerRevisionRecord = { ...baseRevision, specFeedback: initialSpecFeedback(baseRevision, evidence, Boolean(deps.specFeedback), createdAt) };
    const task: QueryTaskRecord = { taskId, sessionId: context.sessionId, principalId: context.principal.id, requestMessageId, requestId, currentRevisionId: revisionId, lifecycle: "open", budget: newBudget(deps.budgetPolicy, createdAt), createdAt, updatedAt: createdAt };
    tx.putRevision(revision);
    tx.putTask(task);
    return {
      view: viewFromRevision(taskId, revision, choiceContextFor(deps, task)),
      feedbackTarget: { taskId, revisionId, requestMessageId, evidence: clone(evidence) },
    } as const;
  }, context);
  return withSteps(await finishRevisionSubmission(deps, outcome, context), outcomes);
}

/**
 * Stepped revise: every step is checked on its own and the applied ones land
 * as one Revision, charged once to the revision budget. When no step applies,
 * nothing is written or charged and the current Revision is returned.
 */
async function reviseStepped(deps: AnsweringDeps, input: ReviseAnswer, context: BusinessContext): Promise<AnswerRevisionView> {
  assertStepsAlone(input, ["spec"]);
  const taskId = input.taskId as TaskId;
  const baseRevisionId = input.baseRevisionId as RevisionId;
  const requestId = localId(input.requestId, "requestId");
  const taskRequestMessageId = await deps.store.transact((tx) => {
    const task = tx.getTask(taskId);
    assertTaskAccess(task, context);
    return task.requestMessageId;
  }, context);
  const prepared = await prepareSteps(deps, input.steps!, taskRequestMessageId, context);
  let outcomes: readonly StepOutcome[] | undefined;
  const outcome = await deps.store.transact(async (tx) => {
    const existingTask = tx.getTask(taskId);
    assertTaskAccess(existingTask, context);
    if (existingTask.currentRevisionId !== baseRevisionId) throw new AnsweringError("REVISION_STALE", `Revision ${input.baseRevisionId} is stale`, { currentRevisionId: existingTask.currentRevisionId });
    const previous = tx.getRevision(baseRevisionId);
    if (!previous) throw new AnsweringError("REVISION_NOT_FOUND", `Revision ${input.baseRevisionId} was not found`);
    const createdAt = now();
    const evidence = tx.listEvidence(taskId);
    const stepped = applySteps(previous, prepared, evidence, governanceFor(deps, existingTask), createdAt);
    outcomes = stepped.outcomes;
    if (!stepped.applied) return { view: viewFromRevision(taskId, previous, choiceContextFor(deps, existingTask)) } as const;
    const reservation = reserveAttempt(tx, existingTask, deps.budgetPolicy, "revision", baseRevisionId, context.invocationId);
    if (reservation.obstacle) return { obstacle: reservation.obstacle } as const;
    const task = reservation.task;
    for (const item of stepped.added) tx.appendEvidence(taskId, item);
    const allEvidence = [...evidence, ...stepped.added];
    const revisionId = makeInternalId("revision") as unknown as RevisionId;
    const baseRevision: AnswerRevisionRecord = {
      taskId,
      revisionId,
      parentRevisionId: previous.revisionId,
      requestId,
      ...stepped.body,
      state: { state: "draft", revisionId },
      createdAt,
      ...(stepped.supersessions.length > 0 ? { supersessions: stepped.supersessions } : {}),
    };
    const revision: AnswerRevisionRecord = { ...baseRevision, specFeedback: initialSpecFeedback(baseRevision, allEvidence, Boolean(deps.specFeedback), createdAt) };
    tx.putRevision(revision);
    const { latestCandidateId: _latestCandidateId, publicationId: _publicationId, ...taskWithoutResults } = task;
    tx.putAttempt({ ...reservation.attempt!, state: "succeeded", outcome: "succeeded", sqlExecuted: false, updatedAt: createdAt });
    tx.putTask({ ...taskWithoutResults, currentRevisionId: revisionId, lifecycle: "open", updatedAt: createdAt });
    return { view: viewFromRevision(taskId, revision, choiceContextFor(deps, task)), feedbackTarget: { taskId, revisionId, requestMessageId: task.requestMessageId, evidence: clone(allEvidence) } } as const;
  }, context);
  if ("obstacle" in outcome) {
    throw new AnsweringError("IMPLEMENTATION_BUDGET_EXHAUSTED", outcome.obstacle.message, obstacleDetails(undefined, outcome.obstacle));
  }
  return withSteps(await finishRevisionSubmission(deps, outcome, context), outcomes);
}
