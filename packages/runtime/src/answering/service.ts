import { randomUUID } from "node:crypto";
import {
  clone,
  contentHash,
  normalizeLimit,
  isReadOnlySql,
  type AnswerRevisionRecord,
  type AnswerRevisionView,
  type AnswerSpec,
  type CheckCoverage,
  type ExecutionOutcome,
  type EvidenceId,
  type ImplementationObstacle,
  type ImplementationObstacleKind,
  type AnswerSpecProposal,
  type AnswerTaskView,
  type BoundedResult,
  type BeginAnswer,
  type BusinessContext,
  type Choice,
  type ChoiceProposal,
  type ChoiceResolution,
  type Evidence,
  type Facet,
  type Finding,
  type FacetName,
  type FilterSpec,
  type GroupingSpec,
  type Hypothesis,
  type HypothesisProposal,
  type InspectAnswer,
  type MetricSpec,
  type PublishCandidate,
  type PublicationPermit,
  type PublicationReceipt,
  type PublicationDisclosure,
  type QueryExecutionView,
  type QueryTaskRecord,
  type QueryExecutionScope,
  type QueryAttemptRecord,
  type QueryAttemptKind,
  type QueryAttemptPurpose,
  type QueryBudgetPolicy,
  type FanoutReport,
  type QueryBudgetState,
  type ResultCandidateRecord,
  type ReviseAnswer,
  type RevisionId,
  type SpecFeedback,
  type TaskId,
  type ExecuteQuery,
  type UntrustedEvidenceInput,
} from "./model.js";
import { assertTaskAccess, type AnsweringStore, type AnsweringTransaction } from "./answering-store.js";
import { makeInternalId } from "./internal-ids.js";
import {
  assertChoiceAlternative,
  qualifyEvidence,
  sealForResult,
  unresolvedChoices,
  unresolvedFacets,
  unresolvedHypotheses,
} from "./qualification.js";
import { InMemoryResultStore, type PrivateResultObject, type ResultStore } from "./result-store.js";
import { candidateCheckFailure, evaluateCandidateCheckReport } from "./candidate-checks.js";
import {
  checkFanout,
  hasPotentialFanout,
  type FanoutDialect,
  type FanoutProbeRequest,
  type FanoutProbeResult,
  type FanoutSchema,
} from "./fanout-check.js";
import type { SpecAlignmentAssessor } from "../judgment/spec-alignment.js";
import {
  assembleSpecFeedbackInput,
  completedSpecFeedback,
  initialSpecFeedback,
  SPEC_FEEDBACK_CHECK_ID,
  SPEC_FEEDBACK_DEFAULT_TIMEOUT_MS,
  SPEC_FEEDBACK_MAX_INPUT_BYTES,
  specFeedbackCoverage,
  specFeedbackDisclosureSummary,
  unavailableSpecFeedback,
  type SpecFeedbackAssembly,
} from "./spec-feedback.js";

export interface SqlQueryResult {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
  readonly truncated: boolean;
  readonly columnTypes?: readonly string[];
}

/** Adapter errors may mark an external call as unknown; Answering must not retry it. */
export class SqlExecutionError extends Error {
  readonly outcome: "failed" | "unknown";
  readonly obstacleKind: "technical_failure" | "mapping_insufficient" | "business_judgment_required";

  constructor(
    message: string,
    outcome: "failed" | "unknown" = "failed",
    obstacleKind: "technical_failure" | "mapping_insufficient" | "business_judgment_required" = "technical_failure",
  ) {
    super(message);
    this.name = "SqlExecutionError";
    this.outcome = outcome;
    this.obstacleKind = obstacleKind;
  }
}

export interface AnsweringSqlExecutor {
  readonly dialect?: FanoutDialect;
  readonly getSchema?: (signal?: AbortSignal) => Promise<FanoutSchema>;
  run(sql: string, rowLimit: number, options: {
    readonly kind: "exploration" | "result";
    readonly idempotencyKey: string;
    readonly signal?: AbortSignal;
    readonly deadlineAt?: number;
    readonly maxPreviewBytes?: number;
    readonly scope?: QueryExecutionScope;
  }): Promise<SqlQueryResult>;
}

export interface FanoutAnsweringOptions {
  readonly enabled?: boolean;
  readonly dialect?: FanoutDialect;
  readonly schema?: FanoutSchema;
  readonly maxTargets?: number;
  readonly maxInputRows?: number;
}

export interface SpecFeedbackOptions {
  readonly assessor: SpecAlignmentAssessor;
  readonly getOriginalQuestion: (requestMessageId: string, options?: { readonly signal?: AbortSignal }) => Promise<string | undefined>;
  readonly timeoutMs?: number;
  readonly maxInputBytes?: number;
}

type ResolvedSpecFeedbackOptions = Omit<SpecFeedbackOptions, "timeoutMs" | "maxInputBytes"> & {
  readonly timeoutMs: number;
  readonly maxInputBytes: number;
};

export interface Answering {
  begin(input: BeginAnswer, context: BusinessContext): Promise<AnswerRevisionView>;
  revise(input: ReviseAnswer, context: BusinessContext): Promise<AnswerRevisionView>;
  execute(input: ExecuteQuery, context: BusinessContext): Promise<QueryExecutionView>;
  publish(input: PublishCandidate, context: BusinessContext): Promise<PublicationReceipt>;
  inspect(input: InspectAnswer, context: BusinessContext): Promise<AnswerTaskView>;
}

export class AnsweringError extends Error {
  readonly code:
    | "ANSWERING_CONTEXT_INVALID"
    | "INVALID_REQUEST"
    | "TASK_NOT_FOUND"
    | "REVISION_STALE"
    | "REVISION_NOT_FOUND"
    | "UNRESOLVED_ASSUMPTIONS"
    | "INVALID_QUERY"
    | "QUERY_EXECUTION_FAILED"
    | "EXPLORATION_NOT_PUBLISHABLE"
    | "CANDIDATE_NOT_FOUND"
    | "RESULT_INCOMPLETE"
    | "RESULT_REF_MISSING"
    | "RESULT_INTEGRITY_MISMATCH"
    | "RESULT_EXECUTION_OUTCOME_UNKNOWN"
    | "CANDIDATE_CHECK_FAILED"
    | "IMPLEMENTATION_BUDGET_EXHAUSTED"
    | "INLINE_RESULT_TOO_LARGE"
    | "PUBLICATION_STALE"
    | "PUBLICATION_ALREADY_EXISTS";
  readonly details?: unknown;
  readonly obstacle?: ImplementationObstacle;

  constructor(code: AnsweringError["code"], message: string, details?: unknown) {
    super(message);
    this.name = "AnsweringError";
    this.code = code;
    this.details = details;
    const record = details && typeof details === "object" && !Array.isArray(details) ? details as Record<string, unknown> : undefined;
    if (record?.obstacle && typeof record.obstacle === "object") this.obstacle = record.obstacle as ImplementationObstacle;
  }
}

export const DEFAULT_QUERY_BUDGET_POLICY: QueryBudgetPolicy = {
  version: "answering-dual-loop-v1",
  maxRevisions: 8,
  maxExplorationAttempts: 16,
  maxResultAttempts: 8,
  maxElapsedMs: 15 * 60 * 1_000,
  maxObservedRows: 200_000,
};

const MAX_RESULT_ROWS = 100_000;
const INLINE_ROW_LIMIT = 10;

function assertContext(context: BusinessContext): void {
  if (!context?.principal?.id || !context.sessionId || !context.operationId || !context.invocationId) {
    throw new AnsweringError("ANSWERING_CONTEXT_INVALID", "Answering requires principal, session, operation and invocation identities");
  }
  if (context.signal?.aborted) throw new AnsweringError("ANSWERING_CONTEXT_INVALID", "Answering operation was cancelled");
}

function now(): string { return new Date().toISOString(); }

function validateBudgetPolicy(policy: QueryBudgetPolicy): QueryBudgetPolicy {
  const values = [policy.maxRevisions, policy.maxExplorationAttempts, policy.maxResultAttempts, policy.maxElapsedMs, policy.maxObservedRows];
  if (policy.version !== "answering-dual-loop-v1" || values.some((value) => !Number.isSafeInteger(value) || value < 1)) {
    throw new AnsweringError("INVALID_REQUEST", "Invalid Answering dual-loop budget policy");
  }
  return { ...policy };
}

function newBudget(policy: QueryBudgetPolicy, startedAt: string): QueryBudgetState {
  return {
    policy,
    startedAt,
    revisionCount: 0,
    explorationAttempts: 0,
    resultAttempts: 0,
    observedRows: 0,
  };
}

function taskBudget(task: QueryTaskRecord, policy: QueryBudgetPolicy): QueryBudgetState {
  return task.budget ? { ...task.budget, policy: { ...task.budget.policy } } : newBudget(policy, task.createdAt);
}

function budgetFailure(budget: QueryBudgetState, kind: QueryAttemptKind, at: number): string | undefined {
  if (Date.parse(budget.startedAt) + budget.policy.maxElapsedMs <= at) return "task time budget exhausted";
  if (kind === "revision" && budget.revisionCount >= budget.policy.maxRevisions) return "revision budget exhausted";
  if (kind === "exploration" && budget.explorationAttempts >= budget.policy.maxExplorationAttempts) return "exploration budget exhausted";
  if (kind === "result" && budget.resultAttempts >= budget.policy.maxResultAttempts) return "result implementation budget exhausted";
  if (budget.observedRows >= budget.policy.maxObservedRows) return "observed-row budget exhausted";
  return undefined;
}

function makeAttempt(
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

function obstacle(
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

function obstacleDetails(details: unknown, value: ImplementationObstacle): Record<string, unknown> {
  const existing = details && typeof details === "object" && !Array.isArray(details) ? details as Record<string, unknown> : {};
  return { ...existing, obstacle: value };
}

function reserveAttempt(
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
  const reason = budgetFailure(budget, kind, at);
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
  const nextBudget: QueryBudgetState = kind === "revision"
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

function updateAttempt(
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

function localId(value: string, prefix: string): string {
  const normalized = value.trim();
  if (!normalized) throw new AnsweringError("INVALID_REQUEST", `${prefix} must not be empty`);
  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function parseOutput(value: unknown): { rowMode?: OutputMode; rowCount?: number; columns?: readonly string[] } | undefined {
  if (value === undefined || value === null) return undefined;
  const record = asRecord(value);
  if (!record) return undefined;
  const raw = "value" in record ? record.value : record;
  const body = asRecord(raw);
  if (!body) return undefined;
  const rowMode = body.rowMode;
  const rowCount = body.rowCount;
  const columns = body.columns;
  if (rowMode !== undefined && !["scalar", "top_n", "grouped", "full", "detail"].includes(String(rowMode))) return undefined;
  if (rowCount !== undefined && (!Number.isSafeInteger(rowCount) || Number(rowCount) < 0)) return undefined;
  if (columns !== undefined && (!Array.isArray(columns) || columns.some((item) => typeof item !== "string"))) return undefined;
  if (rowMode === undefined && rowCount === undefined && columns === undefined) return undefined;
  return {
    ...(rowMode !== undefined ? { rowMode: rowMode as OutputMode } : {}),
    ...(rowCount !== undefined ? { rowCount: Number(rowCount) } : {}),
    ...(columns !== undefined ? { columns: [...columns as string[]] } : {}),
  };
}

type OutputMode = "scalar" | "top_n" | "grouped" | "full" | "detail";

function requestEvidenceId(requestMessageId: string): string {
  return `request_${contentHash(requestMessageId).slice(0, 24)}`;
}

function makeEvidence(input: UntrustedEvidenceInput, id: string, observedAt: string): Evidence {
  switch (input.kind) {
    case "user_confirmation": return { id: id as Evidence["id"], kind: input.kind, authority: "user", sourceRef: input.sourceRef, ...(input.contentHash ? { contentHash: input.contentHash } : {}), ...(input.quote ? { quote: input.quote } : {}), observedAt };
    case "reviewed_definition": return { id: id as Evidence["id"], kind: input.kind, authority: "reviewed_business_definition", sourceRef: input.sourceRef, ...(input.contentHash ? { contentHash: input.contentHash } : {}), ...(input.quote ? { quote: input.quote } : {}), observedAt };
    case "task_document": return { id: id as Evidence["id"], kind: input.kind, authority: "task_document", sourceRef: input.sourceRef, ...(input.contentHash ? { contentHash: input.contentHash } : {}), ...(input.quote ? { quote: input.quote } : {}), observedAt };
    case "request_wording": return { id: id as Evidence["id"], kind: input.kind, authority: "request_wording", sourceRef: input.sourceRef, ...(input.contentHash ? { contentHash: input.contentHash } : {}), ...(input.quote ? { quote: input.quote } : {}), observedAt };
    case "schema_fact": return { id: id as Evidence["id"], kind: input.kind, authority: "schema", sourceRef: input.sourceRef, ...(input.contentHash ? { contentHash: input.contentHash } : {}), ...(input.quote ? { quote: input.quote } : {}), observedAt };
    case "query_observation":
      if (!input.preview) throw new AnsweringError("INVALID_REQUEST", "Query observation evidence requires a bounded preview");
      return { id: id as Evidence["id"], kind: input.kind, authority: "observation", sourceRef: input.sourceRef, preview: clone(input.preview), ...(input.contentHash ? { contentHash: input.contentHash } : {}), ...(input.quote ? { quote: input.quote } : {}), observedAt };
    default: throw new AnsweringError("INVALID_REQUEST", "Unsupported evidence kind");
  }
}

function facetUnknown<T>(): Facet<T> { return { state: "unknown" }; }
function facetNotApplicable<T>(): Facet<T> { return { state: "not_applicable" }; }

function proposalFacet<T>(value: unknown, facet: FacetName, hypothesesByLocalId: ReadonlyMap<string, Hypothesis>, requestEvidence: Evidence["id"]): Facet<T> {
  if (value === undefined || value === null || value === "") return facetUnknown<T>();
  const record = asRecord(value);
  if (record?.state === "unknown") return facetUnknown<T>();
  if (record?.state === "not_applicable") return facetNotApplicable<T>();
  const raw = record && "value" in record ? record.value : value;
  if (raw === null || raw === undefined || raw === "") return facetUnknown<T>();
  const hypothesisLocalId = record && typeof record.hypothesisId === "string" ? record.hypothesisId : undefined;
  const hypothesis = hypothesisLocalId ? hypothesesByLocalId.get(hypothesisLocalId) : undefined;
  if (hypothesisLocalId && !hypothesis) throw new AnsweringError("INVALID_REQUEST", `Unknown hypothesis for ${facet}`);
  const basis = hypothesis
    ? { kind: "hypothesis" as const, hypothesisId: hypothesis.id }
    : { kind: "evidence" as const, evidenceIds: [requestEvidence] as [Evidence["id"]] };
  return { state: "specified", value: normalizeFacetValue<T>(facet, raw), basis };
}

function invalidFacet(facet: FacetName): never {
  throw new AnsweringError("INVALID_REQUEST", `Invalid ${facet} facet value`);
}

function optionalTrimmedString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.trim();
}

function normalizeFacetValue<T>(facet: FacetName, value: unknown): T {
  if (facet === "entity") {
    if (typeof value === "string" && value.trim()) return { name: value.trim() } as T;
    const record = asRecord(value);
    if (record && typeof record.name === "string" && record.name.trim()) {
      if (record.keyColumns !== undefined && (!Array.isArray(record.keyColumns) || record.keyColumns.some((item) => typeof item !== "string" || !item.trim()))) invalidFacet(facet);
      return { name: record.name.trim(), ...(Array.isArray(record.keyColumns) ? { keyColumns: record.keyColumns.map((item) => String(item).trim()) } : {}) } as T;
    }
  }
  if (facet === "metric") {
    if (typeof value === "string" && value.trim()) return { kind: value.trim() } as T;
    const record = asRecord(value);
    if (record && typeof record.kind === "string" && record.kind.trim()) {
      const expression = optionalTrimmedString(record.expression);
      const unit = optionalTrimmedString(record.unit);
      if ((record.expression !== undefined && !expression) || (record.unit !== undefined && !unit)) invalidFacet(facet);
      return { kind: record.kind.trim(), ...(expression ? { expression } : {}), ...(unit ? { unit } : {}) } as T;
    }
  }
  if (facet === "filters" || facet === "groupBy") {
    const record = asRecord(value);
    const expression = typeof value === "string" ? value.trim() : typeof record?.expression === "string" ? record.expression.trim() : "";
    if (expression) return { expression } as T;
  }
  if (facet === "time") {
    if (typeof value === "string" && value.trim()) return { expression: value.trim() } as T;
    const record = asRecord(value);
    const boundaries = new Set(["inclusive", "exclusive", "mixed", "unspecified"]);
    if (record && typeof record.expression === "string" && record.expression.trim()
      && (record.boundary === undefined || boundaries.has(String(record.boundary)))) {
      return { expression: record.expression.trim(), ...(record.boundary !== undefined ? { boundary: record.boundary as "inclusive" | "exclusive" | "mixed" | "unspecified" } : {}) } as T;
    }
  }
  if (facet === "ranking") {
    const record = asRecord(value);
    const tiePolicies = new Set(["strict", "include_ties", "unspecified"]);
    if (record && Number.isSafeInteger(record.n) && Number(record.n) > 0 && typeof record.orderBy === "string" && record.orderBy.trim()
      && (record.tiePolicy === undefined || tiePolicies.has(String(record.tiePolicy)))) {
      return { n: Number(record.n), orderBy: record.orderBy.trim(), ...(record.tiePolicy !== undefined ? { tiePolicy: record.tiePolicy as "strict" | "include_ties" | "unspecified" } : {}) } as T;
    }
  }
  if (facet === "output") {
    const parsed = parseOutput(value);
    if (parsed) return parsed as T;
  }
  return invalidFacet(facet);
}

function buildSpec(
  proposal: AnswerSpecProposal,
  hypothesesByLocalId: ReadonlyMap<string, Hypothesis>,
  requestEvidence: Evidence["id"],
): AnswerSpec {
  const filters = Array.isArray(proposal.filters)
    ? proposal.filters.map((value) => proposalFacet<FilterSpec>(value, "filters", hypothesesByLocalId, requestEvidence))
    : [facetUnknown<FilterSpec>()];
  const groupBy = Array.isArray(proposal.groupBy)
    ? proposal.groupBy.map((value) => proposalFacet<GroupingSpec>(value, "groupBy", hypothesesByLocalId, requestEvidence))
    : [facetUnknown<GroupingSpec>()];
  return {
    entity: proposalFacet(proposal.entity, "entity", hypothesesByLocalId, requestEvidence),
    metric: proposalFacet<MetricSpec>(proposal.metric, "metric", hypothesesByLocalId, requestEvidence),
    filters,
    groupBy,
    time: proposalFacet(proposal.time, "time", hypothesesByLocalId, requestEvidence),
    ranking: proposalFacet(proposal.ranking, "ranking", hypothesesByLocalId, requestEvidence),
    output: proposalFacet(proposal.output, "output", hypothesesByLocalId, requestEvidence),
  };
}

function createHypotheses(inputs: readonly HypothesisProposal[], evidence: readonly Evidence[]): { hypotheses: readonly Hypothesis[]; byLocalId: ReadonlyMap<string, Hypothesis>; resolutions: readonly AnswerRevisionRecord["resolutions"][number][] } {
  const byLocalId = new Map<string, Hypothesis>();
  for (const input of inputs) {
    const local = localId(input.localId, "hypothesis.localId");
    if (byLocalId.has(local)) throw new AnsweringError("INVALID_REQUEST", `Duplicate hypothesis ${local}`);
    if (!["business_semantics", "physical_mapping", "data_property"].includes(input.kind) || !input.statement.trim() || !input.basis.trim() || !input.impact.trim() || input.affects.length === 0 || input.affects.some((facet) => !["entity", "metric", "filters", "groupBy", "time", "ranking", "output"].includes(facet))) {
      throw new AnsweringError("INVALID_REQUEST", `Invalid hypothesis ${local}`);
    }
    const hypothesis: Hypothesis = { id: makeInternalId("hypothesis") as unknown as Hypothesis["id"], kind: input.kind, statement: input.statement.trim(), affects: [...new Set(input.affects)] as unknown as Hypothesis["affects"], basis: input.basis.trim(), impact: input.impact.trim() };
    byLocalId.set(local, hypothesis);
  }
  const resolutions: AnswerRevisionRecord["resolutions"][number][] = [];
  for (const input of inputs) {
    const hypothesis = byLocalId.get(input.localId.trim())!;
    const evidenceIds = input.proposedEvidenceIds ?? [];
    const qualified = evidenceIds.flatMap((id) => {
      const item = evidence.find((candidate) => candidate.id === id || candidate.sourceRef === id);
      if (!item) return [];
      try { return [qualifyEvidence(hypothesis, item)]; } catch { return []; }
    });
    if (qualified.length > 0) {
      resolutions.push({ outcome: "supported", hypothesisId: hypothesis.id, proof: qualified as [typeof qualified[number], ...typeof qualified[number][]] });
    }
  }
  return { hypotheses: [...byLocalId.values()], byLocalId, resolutions };
}

function createChoices(inputs: readonly ChoiceProposal[], evidence: readonly Evidence[]): { choices: readonly Choice[]; resolutions: readonly ChoiceResolution[] } {
  const byLocalId = new Map<string, Choice>();
  const alternativesByLocalChoice = new Map<string, ReadonlyMap<string, Choice["alternatives"][number]["id"]>>();
  for (const input of inputs) {
    const local = localId(input.localId, "choice.localId");
    if (byLocalId.has(local) || input.affects.length === 0 || input.affects.some((facet) => !["entity", "metric", "filters", "groupBy", "time", "ranking", "output"].includes(facet)) || input.alternatives.length < 2) throw new AnsweringError("INVALID_REQUEST", `Invalid choice ${local}`);
    if (input.selectedAlternativeId && input.provisionalAlternativeId) throw new AnsweringError("INVALID_REQUEST", `Choice ${local} cannot be both selected and provisional`);
    if (input.provisionalAlternativeId && input.affects.some((facet) => facet === "entity" || facet === "filters")) {
      throw new AnsweringError("INVALID_REQUEST", `Material population choice ${local} requires qualified evidence or user clarification`);
    }
    const alternativeLocals = new Set<string>();
    const alternatives = input.alternatives.map((alternative) => {
      const alternativeLocal = localId(alternative.localId, "choice.alternative.localId");
      if (alternativeLocals.has(alternativeLocal)) throw new AnsweringError("INVALID_REQUEST", `Duplicate alternative ${alternativeLocal}`);
      alternativeLocals.add(alternativeLocal);
      return { id: makeInternalId("alternative") as unknown as Choice["alternatives"][number]["id"], statement: localId(alternative.statement, "choice.alternative.statement"), localId: alternativeLocal };
    });
    const choice: Choice = { id: makeInternalId("choice") as unknown as Choice["id"], affects: [...new Set(input.affects)] as unknown as Choice["affects"], alternatives: alternatives.map(({ id, statement }) => ({ id, statement })) as unknown as Choice["alternatives"] };
    byLocalId.set(local, choice);
    alternativesByLocalChoice.set(local, new Map(alternatives.map((alternative) => [alternative.localId, alternative.id])));
  }
  const resolutions: ChoiceResolution[] = [];
  for (const input of inputs) {
    const choice = byLocalId.get(input.localId.trim())!;
    const localAlternatives = alternativesByLocalChoice.get(input.localId.trim())!;
    const selectedLocal = input.selectedAlternativeId ?? input.provisionalAlternativeId;
    if (!selectedLocal) continue;
    const alternativeId = localAlternatives.get(selectedLocal) ?? selectedLocal;
    assertChoiceAlternative(choice, alternativeId);
    if (input.provisionalAlternativeId) {
      resolutions.push({ outcome: "provisional", choiceId: choice.id, alternativeId: alternativeId as unknown as Choice["alternatives"][number]["id"], disclosureRequired: true });
      continue;
    }
    const qualified = (input.selectionEvidenceIds ?? []).flatMap((id) => {
      const item = evidence.find((candidate) => candidate.id === id || candidate.sourceRef === id);
      if (!item) return [];
      // Choices can only be selected with evidence that qualifies at least one
      // affected semantic facet. Use a synthetic business hypothesis solely to
      // apply the same authority matrix; it is not persisted.
      const synthetic: Hypothesis = { id: makeInternalId("choice-proof") as unknown as Hypothesis["id"], kind: "business_semantics", statement: choice.alternatives.find((a) => a.id === alternativeId)?.statement ?? "choice", affects: choice.affects, basis: "choice selection", impact: "choice selection" };
      try { return [qualifyEvidence(synthetic, item)]; } catch { return []; }
    });
    if (qualified.length > 0) resolutions.push({ outcome: "selected", choiceId: choice.id, alternativeId: alternativeId as unknown as Choice["alternatives"][number]["id"], proof: qualified as [typeof qualified[number], ...typeof qualified[number][]] });
  }
  return { choices: [...byLocalId.values()], resolutions };
}

function viewFromRevision(taskId: TaskId, revision: AnswerRevisionRecord): AnswerRevisionView {
  return {
    taskId,
    revisionId: revision.revisionId,
    spec: clone(revision.spec),
    unresolvedFacets: unresolvedFacets(revision.spec),
    unresolvedHypotheses: unresolvedHypotheses(revision.hypotheses, revision.resolutions),
    unresolvedChoices: unresolvedChoices(revision.choices, revision.choiceResolutions),
    ...(revision.specFeedback ? { specFeedback: clone(revision.specFeedback) } : {}),
  };
}

function serializedByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? { __type: "bigint", value: item.toString() } : item), "utf8");
}

function boundedResult(result: SqlQueryResult, maxBytes?: number): BoundedResult {
  const columns = [...result.columns];
  const rows = result.rows.map((row) => [...row]);
  const columnTypes = [...(result.columnTypes ?? columns.map((_, index) => inferType(rows[0]?.[index])))];
  let bounded: BoundedResult = { columns, rows, columnTypes, rowCount: rows.length, truncated: result.truncated };
  if (maxBytes === undefined) return bounded;
  const limit = Math.max(1_024, Math.min(Math.trunc(maxBytes), 64 * 1_024));
  while (bounded.rows.length > 0 && serializedByteLength(bounded) > limit) {
    const nextRows = bounded.rows.slice(0, -1);
    bounded = { ...bounded, rows: nextRows, truncated: true };
  }
  if (serializedByteLength(bounded) > limit) {
    throw new AnsweringError("INVALID_REQUEST", "Exploration preview metadata exceeds the serialized byte limit");
  }
  return bounded;
}

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

interface FanoutExecutionMemo {
  readonly state: "started" | "settled";
  readonly taskId: string;
  readonly revisionId: string;
  readonly queryHash: string;
  readonly report?: FanoutReport;
}

function fanoutExecutionMemo(value: unknown): FanoutExecutionMemo | undefined {
  const record = asRecord(value);
  if (!record || (record.state !== "started" && record.state !== "settled") || typeof record.taskId !== "string" || typeof record.revisionId !== "string" || typeof record.queryHash !== "string") return undefined;
  const report = record.report as FanoutReport | undefined;
  if (record.state === "settled" && (!report || typeof report !== "object")) return undefined;
  return { state: record.state, taskId: record.taskId, revisionId: record.revisionId, queryHash: record.queryHash, ...(report ? { report } : {}) };
}

function unknownFanoutReport(reason: string): FanoutReport {
  return { ruleVersion: "answering-fanout-v1", status: "unknown", snapshotScope: "unbound", targets: [], unsupportedReasons: [reason] };
}

function fanoutCoverage(report: FanoutReport): CheckCoverage {
  const reason = report.status === "finding"
    ? "A bounded probe observed a source key repeated after a JOIN. This is an observational metric-copy risk, not a business semantic verdict."
    : report.unsupportedReasons?.join(", ")
      ?? (report.status === "clear" ? "Supported JOIN aggregate targets were checked without observed source-key duplication." : undefined);
  return { checkId: "join_fanout", outcome: report.status === "not_applicable" ? "not_applicable" : report.status === "clear" ? "clear" : report.status === "finding" ? "finding" : "unknown", ...(reason ? { reason } : {}) };
}

function fanoutFindings(report: FanoutReport): readonly Finding[] {
  return report.targets.filter((target) => target.status === "finding").map((target) => ({
    id: `finding_join_fanout_${randomUUID()}`,
    kind: "join_fanout" as const,
    blocking: false,
    checkId: "join_fanout",
    message: `JOIN fanout observed for ${target.aggregateFunctions.join("/")}(${target.aggregateExpressions.join(", ")}) from ${target.sourceRelation}.${target.sourceKey}; source distinct keys=${target.observation?.sourceDistinctKeys ?? "unknown"}, joined rows=${target.observation?.joinedRows ?? "unknown"}, joined distinct keys=${target.observation?.joinedDistinctKeys ?? "unknown"}. This is a bounded observation, not a business-semantic decision.`,
  }));
}

function fanoutDisclosureSummary(report: FanoutReport): string {
  if (report.status === "finding") return "JOIN fanout 检查观察到来源键在连接后重复；这表示度量复制风险，不等于已裁决业务口径。";
  if (report.status === "unknown") return `JOIN fanout 检查未能完整完成：${report.unsupportedReasons?.join(", ") ?? "coverage unavailable"}。`;
  return "";
}

function inferType(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "bigint") return "BIGINT";
  if (typeof value === "number") return Number.isInteger(value) ? "INTEGER" : "REAL";
  if (typeof value === "boolean") return "BOOLEAN";
  if (typeof value === "object") return "JSON";
  return "TEXT";
}

export interface InMemoryAnsweringOptions {
  readonly store: AnsweringStore;
  readonly sqlExecutor: AnsweringSqlExecutor;
  readonly resultStore?: ResultStore;
  readonly maxResultRows?: number;
  /** Versioned task budget; revision/delegation work must not reset it. */
  readonly budgetPolicy?: QueryBudgetPolicy;
  /** Optional bounded JOIN fanout diagnostics; enabled by default when applicable. */
  readonly fanout?: FanoutAnsweringOptions;
  /** Optional post-commit, advisory Spec alignment feedback. */
  readonly specFeedback?: SpecFeedbackOptions;
}

interface RevisionFeedbackTarget {
  readonly taskId: TaskId;
  readonly revisionId: RevisionId;
  readonly requestMessageId: string;
  /** Evidence frozen in the same transaction that created the Revision. */
  readonly evidence: readonly Evidence[];
}

interface RevisionSubmissionOutcome {
  readonly view: AnswerRevisionView;
  readonly feedbackTarget?: RevisionFeedbackTarget;
}

/**
 * The deep Answering module. It owns semantic state and publication policy;
 * Pi, Hosts and Tools only supply invocation context and call these methods.
 */
export class InMemoryAnswering implements Answering {
  private readonly resultStore: ResultStore;
  private readonly maxResultRows: number;
  private readonly budgetPolicy: QueryBudgetPolicy;
  private readonly fanoutOptions: FanoutAnsweringOptions;
  private readonly specFeedbackOptions: ResolvedSpecFeedbackOptions | undefined;
  private fanoutSchema: FanoutSchema | undefined;
  private fanoutSchemaLoaded = false;
  /** Ephemeral coalescing only; Pi Invocation remains the durable replay authority. */
  private readonly invocationExecutions = new Map<string, { signature: string; promise: Promise<QueryExecutionView> }>();
  /** Coalesce equivalent final executions even when a transport retry receives a new invocation id. */
  private readonly resultExecutions = new Map<string, Promise<QueryExecutionView>>();

  constructor(private readonly options: InMemoryAnsweringOptions) {
    this.resultStore = options.resultStore ?? new InMemoryResultStore();
    this.maxResultRows = Math.max(1, Math.trunc(options.maxResultRows ?? MAX_RESULT_ROWS));
    this.budgetPolicy = validateBudgetPolicy(options.budgetPolicy ?? DEFAULT_QUERY_BUDGET_POLICY);
    this.fanoutOptions = { ...(options.fanout ?? {}) };
    const specFeedbackTimeout = options.specFeedback?.timeoutMs ?? SPEC_FEEDBACK_DEFAULT_TIMEOUT_MS;
    const specFeedbackMaxInputBytes = options.specFeedback?.maxInputBytes ?? SPEC_FEEDBACK_MAX_INPUT_BYTES;
    if (options.specFeedback && (!Number.isSafeInteger(specFeedbackTimeout) || specFeedbackTimeout <= 0)) {
      throw new AnsweringError("INVALID_REQUEST", "Invalid Spec feedback timeout");
    }
    if (options.specFeedback && (!Number.isSafeInteger(specFeedbackMaxInputBytes) || specFeedbackMaxInputBytes <= 0)) {
      throw new AnsweringError("INVALID_REQUEST", "Invalid Spec feedback input byte limit");
    }
    this.specFeedbackOptions = options.specFeedback ? {
      ...options.specFeedback,
      timeoutMs: specFeedbackTimeout,
      maxInputBytes: specFeedbackMaxInputBytes,
    } : undefined;
    if (options.fanout?.schema) {
      this.fanoutSchema = options.fanout.schema;
      this.fanoutSchemaLoaded = true;
    }
  }

  async begin(input: BeginAnswer, context: BusinessContext): Promise<AnswerRevisionView> {
    assertContext(context);
    const requestMessageId = localId(input.requestMessageId, "requestMessageId");
    const requestId = localId(input.requestId, "requestId");
    const outcome = await this.options.store.transact(async (tx) => {
      const existing = tx.findTaskByRequest(context.sessionId, requestId);
      if (existing) {
        assertTaskAccess(existing, context);
        const revision = tx.getCurrentRevision(existing.taskId);
        if (!revision) throw new AnsweringError("REVISION_NOT_FOUND", "Existing task has no current revision");
        return { view: viewFromRevision(existing.taskId, revision) } as const;
      }
      const taskId = makeInternalId("task") as unknown as TaskId;
      const revisionId = makeInternalId("revision") as unknown as RevisionId;
      const requestEvidence = makeEvidence({ kind: "request_wording", sourceRef: requestMessageId }, requestEvidenceId(requestMessageId), now());
      tx.appendEvidence(taskId, requestEvidence);
      const evidence = [requestEvidence, ...(input.evidence ?? []).map((item, index) => makeEvidence(item, `evidence_${randomUUID()}_${index}`, now()))];
      for (const item of evidence.slice(1)) tx.appendEvidence(taskId, item);
      const hypotheses = createHypotheses(input.hypotheses ?? [], evidence);
      const choices = createChoices(input.choices ?? [], evidence);
      const spec = buildSpec(input.spec, hypotheses.byLocalId, requestEvidence.id);
      const createdAt = now();
      const baseRevision: AnswerRevisionRecord = { taskId, revisionId, requestId, spec, hypotheses: hypotheses.hypotheses, choices: choices.choices, resolutions: hypotheses.resolutions, choiceResolutions: choices.resolutions, state: { state: "draft", revisionId }, createdAt };
      const revision: AnswerRevisionRecord = { ...baseRevision, specFeedback: initialSpecFeedback(baseRevision, evidence, Boolean(this.specFeedbackOptions), createdAt) };
      const task: QueryTaskRecord = { taskId, sessionId: context.sessionId, principalId: context.principal.id, requestMessageId, requestId, currentRevisionId: revisionId, lifecycle: "open", budget: newBudget(this.budgetPolicy, createdAt), createdAt, updatedAt: createdAt };
      tx.putRevision(revision);
      tx.putTask(task);
      return {
        view: viewFromRevision(taskId, revision),
        feedbackTarget: { taskId, revisionId, requestMessageId, evidence: clone(evidence) },
      } as const;
    }, context);
    return this.finishRevisionSubmission(outcome, context);
  }

  async revise(input: ReviseAnswer, context: BusinessContext): Promise<AnswerRevisionView> {
    assertContext(context);
    const taskId = input.taskId as TaskId;
    const baseRevisionId = input.baseRevisionId as RevisionId;
    const requestId = localId(input.requestId, "requestId");
    const outcome = await this.options.store.transact(async (tx) => {
      const existingTask = tx.getTask(taskId);
      assertTaskAccess(existingTask, context);
      if (existingTask.currentRevisionId !== baseRevisionId) throw new AnsweringError("REVISION_STALE", `Revision ${input.baseRevisionId} is stale`, { currentRevisionId: existingTask.currentRevisionId });
      const reservation = reserveAttempt(tx, existingTask, this.budgetPolicy, "revision", baseRevisionId, context.invocationId);
      if (reservation.obstacle) return { obstacle: reservation.obstacle } as const;
      const task = reservation.task;
      const previous = tx.getRevision(baseRevisionId);
      if (!previous) throw new AnsweringError("REVISION_NOT_FOUND", `Revision ${input.baseRevisionId} was not found`);
      const evidence = tx.listEvidence(taskId);
      const addedEvidence = (input.evidence ?? []).map((item, index) => makeEvidence(item, `evidence_${randomUUID()}_${index}`, now()));
      for (const item of addedEvidence) tx.appendEvidence(taskId, item);
      const allEvidence = [...evidence, ...addedEvidence];
      const hypotheses = createHypotheses(input.hypotheses ?? [], allEvidence);
      const choices = createChoices(input.choices ?? [], allEvidence);
      const requestEvidence = allEvidence.find((item) => item.kind === "request_wording") ?? makeEvidence({ kind: "request_wording", sourceRef: task.requestMessageId }, requestEvidenceId(task.requestMessageId), now());
      const revisionId = makeInternalId("revision") as unknown as RevisionId;
      const baseRevision: AnswerRevisionRecord = { taskId, revisionId, parentRevisionId: previous.revisionId, requestId, spec: buildSpec(input.spec, hypotheses.byLocalId, requestEvidence.id), hypotheses: hypotheses.hypotheses, choices: choices.choices, resolutions: hypotheses.resolutions, choiceResolutions: choices.resolutions, state: { state: "draft", revisionId }, createdAt: now() };
      const revision: AnswerRevisionRecord = { ...baseRevision, specFeedback: initialSpecFeedback(baseRevision, allEvidence, Boolean(this.specFeedbackOptions), baseRevision.createdAt) };
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
      return { view: viewFromRevision(taskId, revision), feedbackTarget: { taskId, revisionId, requestMessageId: task.requestMessageId, evidence: clone(allEvidence) } } as const;
    }, context);
    if ("obstacle" in outcome) {
      throw new AnsweringError("IMPLEMENTATION_BUDGET_EXHAUSTED", outcome.obstacle.message, obstacleDetails(undefined, outcome.obstacle));
    }
    return this.finishRevisionSubmission(outcome, context);
  }

  private async finishRevisionSubmission(outcome: RevisionSubmissionOutcome, context: BusinessContext): Promise<AnswerRevisionView> {
    const target = outcome.feedbackTarget;
    if (!target || !this.specFeedbackOptions) return outcome.view;
    const feedback = await this.evaluateSpecFeedback(target, context);
    let persisted: SpecFeedback | undefined;
    try {
      persisted = await this.persistSpecFeedback(target, feedback, context);
    } catch (error) {
      // The Revision is already committed. A failed feedback write must not be
      // presented as completed; inspect/recovery can still observe pending.
      if (context.signal?.aborted) throw error;
      return outcome.view;
    }
    if (!persisted) return outcome.view;
    try {
      const revision = await this.options.store.transact((tx) => tx.getRevision(target.revisionId), context);
      return revision ? viewFromRevision(target.taskId, revision) : outcome.view;
    } catch (error) {
      if (context.signal?.aborted) throw error;
      return outcome.view;
    }
  }

  private async evaluateSpecFeedback(target: RevisionFeedbackTarget, context: BusinessContext): Promise<SpecFeedback> {
    const options = this.specFeedbackOptions!;
    const startedAt = now();
    const startedAtMs = Date.now();
    const snapshot = await this.options.store.transact((tx) => {
      const task = tx.getTask(target.taskId);
      assertTaskAccess(task, context);
      const revision = tx.getRevision(target.revisionId);
      if (!revision) throw new AnsweringError("REVISION_NOT_FOUND", `Revision ${target.revisionId} was not found`);
      return { task, revision };
    }, context);
    const evidence = target.evidence;
    const base = snapshot.revision.specFeedback ?? initialSpecFeedback(snapshot.revision, evidence, true, startedAt);
    const configuredTimeout = options.timeoutMs;
    const budget = taskBudget(snapshot.task, this.budgetPolicy);
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
      assembly = assembleSpecFeedbackInput(snapshot.revision, evidence, originalQuestion, options.maxInputBytes);
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

  private async persistSpecFeedback(target: RevisionFeedbackTarget, feedback: SpecFeedback, context: BusinessContext): Promise<SpecFeedback | undefined> {
    return this.options.store.transact((tx) => {
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

  async execute(input: ExecuteQuery, context: BusinessContext): Promise<QueryExecutionView> {
    assertContext(context);
    const key = `${context.sessionId}:${context.invocationId}`;
    const signature = contentHash({ kind: input.kind, taskId: input.taskId, revisionId: "revisionId" in input ? input.revisionId : undefined, sql: input.sql.trim(), maxPreviewBytes: input.kind === "exploration" ? input.maxPreviewBytes : undefined });
    const existingExecution = this.invocationExecutions.get(key);
    if (existingExecution) {
      if (existingExecution.signature !== signature) throw new AnsweringError("INVALID_REQUEST", "RESULT_INVOCATION_IDEMPOTENCY_CONFLICT");
      return existingExecution.promise;
    }
    const resultKey = input.kind === "result"
      ? contentHash({ sessionId: context.sessionId, taskId: input.taskId, revisionId: input.revisionId, sql: input.sql.trim() })
      : undefined;
    let shared = resultKey ? this.resultExecutions.get(resultKey) : undefined;
    if (!shared) {
      shared = this.executeOnce(input, context);
      if (resultKey) {
        this.resultExecutions.set(resultKey, shared);
        void shared.finally(() => {
          if (this.resultExecutions.get(resultKey) === shared) this.resultExecutions.delete(resultKey);
        }).catch(() => undefined);
      }
    }
    const promise = shared.finally(() => {
      if (this.invocationExecutions.get(key)?.promise === promise) this.invocationExecutions.delete(key);
    });
    this.invocationExecutions.set(key, { signature, promise });
    return promise;
  }

  private async executeOnce(input: ExecuteQuery, context: BusinessContext): Promise<QueryExecutionView> {
    assertContext(context);
    const taskId = input.taskId as TaskId;
    const task = await this.options.store.transact((tx) => tx.getTask(taskId), context);
    assertTaskAccess(task, context);
    const revisionId = (input.kind === "result" ? input.revisionId : context.expectedRevisionId ?? task.currentRevisionId) as RevisionId;
    if (!isReadOnlySql(input.sql)) {
      const details = await this.options.store.transact((tx) => obstacle(tx, task, revisionId, "technical_failure", "Only one read-only SQL statement is allowed", {
        requiresOuterDecision: false,
        retryable: false,
        sqlExecuted: false,
        executionOutcome: "not_started",
      }), context);
      throw new AnsweringError("INVALID_QUERY", details.message, obstacleDetails(undefined, details));
    }
    const limit = input.kind === "exploration" ? normalizeLimit(input.limit, 50, 10_000) : this.maxResultRows;

    if (input.kind === "exploration") {
      const queryHash = contentHash({ sql: input.sql.trim(), limit, maxPreviewBytes: input.maxPreviewBytes });
      const prior = await this.options.store.transact((tx) => tx.findObservationByInvocation(taskId, context.invocationId), context);
      if (prior?.kind === "query_observation") {
        if (prior.queryHash !== queryHash) throw new AnsweringError("INVALID_REQUEST", "EXPLORATION_INVOCATION_IDEMPOTENCY_CONFLICT");
        return { kind: "exploration", artifact: { kind: "exploration", evidenceId: prior.id, preview: prior.preview }, preview: prior.preview, findings: [] };
      }
      const memoValue = asRecord(await context.memo?.get("answering.exploration-execution"));
      if (memoValue && (memoValue.taskId !== input.taskId || memoValue.queryHash !== queryHash)) {
        throw new AnsweringError("INVALID_REQUEST", "EXPLORATION_INVOCATION_IDEMPOTENCY_CONFLICT");
      }
      if (memoValue?.state === "started") {
        const details = await this.options.store.transact((tx) => {
          const current = tx.getTask(taskId);
          assertTaskAccess(current, context);
          const attempt = tx.findAttemptByInvocation(taskId, context.invocationId, "exploration");
          if (attempt && attempt.state === "started") updateAttempt(tx, attempt, "unknown", "unknown", true, "execution_outcome_unknown");
          return obstacle(tx, current, revisionId, "execution_outcome_unknown", "The exploration execution outcome is unknown; SQL was not retried", {
            requiresOuterDecision: true,
            retryable: false,
            sqlExecuted: true,
            executionOutcome: "unknown",
            queryHash,
          });
        }, context);
        throw new AnsweringError("RESULT_EXECUTION_OUTCOME_UNKNOWN", details.message, obstacleDetails(undefined, details));
      }
      const reservation = await this.options.store.transact((tx) => {
        const current = tx.getTask(taskId);
        assertTaskAccess(current, context);
        if (current.currentRevisionId !== revisionId) throw new AnsweringError("REVISION_STALE", "Exploration target Revision is stale", { currentRevisionId: current.currentRevisionId });
        const unknownAttempt = tx.findAttemptByQuery(taskId, revisionId, queryHash, "exploration");
        if (unknownAttempt?.outcome === "unknown") {
          return { task: current, obstacle: obstacle(tx, current, revisionId, "execution_outcome_unknown", "A matching exploration has an unknown execution outcome; SQL was not retried", {
            requiresOuterDecision: true,
            retryable: false,
            sqlExecuted: true,
            executionOutcome: "unknown",
            queryHash,
          }) };
        }
        return reserveAttempt(tx, current, this.budgetPolicy, "exploration", revisionId, context.invocationId, queryHash);
      }, context);
      if (reservation.obstacle) {
        const code = reservation.obstacle.kind === "execution_outcome_unknown" ? "RESULT_EXECUTION_OUTCOME_UNKNOWN" : "IMPLEMENTATION_BUDGET_EXHAUSTED";
        throw new AnsweringError(code, reservation.obstacle.message, obstacleDetails(undefined, reservation.obstacle));
      }
      const attempt = reservation.attempt!;
      let sqlStarted = false;
      try {
        await context.memo?.set("answering.exploration-execution", { state: "started", taskId: input.taskId, queryHash });
        sqlStarted = true;
        const raw = await this.options.sqlExecutor.run(input.sql, limit, {
          kind: "exploration",
          idempotencyKey: context.invocationId,
          ...(context.signal ? { signal: context.signal } : {}),
          ...(context.deadlineAt ? { deadlineAt: context.deadlineAt } : {}),
          ...(input.maxPreviewBytes ? { maxPreviewBytes: input.maxPreviewBytes } : {}),
          ...(context.queryScope ? { scope: context.queryScope } : {}),
        });
        const result = boundedResult(raw, input.maxPreviewBytes);
        const evidenceId = makeInternalId("evidence") as unknown as Evidence["id"];
        const observation: Evidence = { id: evidenceId, kind: "query_observation", authority: "observation", sourceRef: context.invocationId, preview: result, queryHash, contentHash: contentHash(result), observedAt: now() };
        const postExecution = await this.options.store.transact((tx) => {
          const current = tx.getTask(taskId);
          assertTaskAccess(current, context);
          const budget = taskBudget(current, this.budgetPolicy);
          const observedRows = raw.rows.length;
          if (budget.observedRows + observedRows > budget.policy.maxObservedRows) {
            const chargedTask = { ...current, budget: { ...budget, observedRows: budget.observedRows + observedRows }, updatedAt: now() };
            tx.putTask(chargedTask);
            updateAttempt(tx, attempt, "failed", "succeeded", true, "budget_exhausted");
            return obstacle(tx, chargedTask, revisionId, "budget_exhausted", "Observed-row budget exhausted after exploration", {
              requiresOuterDecision: true,
              retryable: false,
              sqlExecuted: true,
              executionOutcome: "succeeded",
              queryHash,
            });
          }
          tx.putTask({ ...current, budget: { ...budget, observedRows: budget.observedRows + observedRows }, updatedAt: now() });
          updateAttempt(tx, attempt, "succeeded", "succeeded", true);
          tx.appendEvidence(taskId, observation);
          return undefined;
        }, context);
        if (postExecution) {
          throw new AnsweringError("IMPLEMENTATION_BUDGET_EXHAUSTED", postExecution.message, obstacleDetails(undefined, postExecution));
        }
        await context.memo?.set("answering.exploration-execution", { state: "settled", taskId: input.taskId, queryHash, evidenceId });
        return { kind: "exploration", artifact: { kind: "exploration", evidenceId, preview: result }, preview: result, findings: [], attemptId: attempt.attemptId };
      } catch (error) {
        if (error instanceof AnsweringError) throw error;
        if (context.signal?.aborted) throw error;
        const unknown = error instanceof SqlExecutionError && error.outcome === "unknown";
        const kind: ImplementationObstacleKind = unknown ? "execution_outcome_unknown" : error instanceof SqlExecutionError ? error.obstacleKind : "technical_failure";
        const details = await this.options.store.transact((tx) => {
          const current = tx.getTask(taskId);
          assertTaskAccess(current, context);
          updateAttempt(tx, attempt, unknown ? "unknown" : "failed", unknown ? "unknown" : "failed", sqlStarted, kind);
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
    }

    const queryHash = contentHash(input.sql.trim());
    const sealedOutcome = await this.options.store.transact((tx) => {
      const currentTask = tx.getTask(taskId);
      assertTaskAccess(currentTask, context);
      if (currentTask.currentRevisionId !== revisionId) throw new AnsweringError("REVISION_STALE", "Result query must use the current revision", { currentRevisionId: currentTask.currentRevisionId });
      const revision = tx.getRevision(revisionId);
      if (!revision) throw new AnsweringError("REVISION_NOT_FOUND", `Revision ${input.revisionId} was not found`);
      const result = sealForResult(revision);
      if (!result.ok) {
        const blocked = makeAttempt(taskId, "result", revisionId, context.invocationId, now(), "blocked", "not_started", false, "business_judgment_required", queryHash);
        tx.putAttempt(blocked);
        const details = obstacle(tx, currentTask, revisionId, "business_judgment_required", "Final query is blocked until all required facets, hypotheses and choices are handled", {
          requiresOuterDecision: true,
          retryable: false,
          sqlExecuted: false,
          executionOutcome: "not_started",
          queryHash,
        });
        return { obstacle: details, unresolvedFacets: result.unresolvedFacets, unresolvedHypotheses: result.unresolvedHypotheses, unresolvedChoices: result.unresolvedChoices } as const;
      }
      const readyRevision: AnswerRevisionRecord = { ...revision, state: result.revision };
      tx.putRevision(readyRevision);
      return { revision: readyRevision } as const;
    }, context);
    if ("obstacle" in sealedOutcome) {
      throw new AnsweringError("UNRESOLVED_ASSUMPTIONS", sealedOutcome.obstacle.message, obstacleDetails({ unresolvedFacets: sealedOutcome.unresolvedFacets, unresolvedHypotheses: sealedOutcome.unresolvedHypotheses, unresolvedChoices: sealedOutcome.unresolvedChoices }, sealedOutcome.obstacle));
    }
    const sealed = sealedOutcome.revision;

    const memo = resultExecutionMemo(await context.memo?.get("answering.result-execution"));
    if (memo && (memo.taskId !== input.taskId || memo.revisionId !== input.revisionId || memo.queryHash !== queryHash)) {
      throw new AnsweringError("INVALID_REQUEST", "RESULT_INVOCATION_IDEMPOTENCY_CONFLICT");
    }
    let attempt: QueryAttemptRecord | undefined;
    if (memo?.state === "started") {
      const details = await this.options.store.transact((tx) => {
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
      const preflight = await this.options.store.transact((tx) => {
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
        return { reservation: reserveAttempt(tx, current, this.budgetPolicy, "result", revisionId, context.invocationId, queryHash) } as const;
      }, context);
      if ("existing" in preflight) {
        if (preflight.existing.queryHash !== queryHash) throw new AnsweringError("INVALID_REQUEST", "RESULT_INVOCATION_IDEMPOTENCY_CONFLICT");
        return this.resultView(preflight.existing, context);
      }
      if ("unknown" in preflight) throw new AnsweringError("RESULT_EXECUTION_OUTCOME_UNKNOWN", preflight.unknown.message, obstacleDetails(undefined, preflight.unknown));
      if (preflight.reservation.obstacle) throw new AnsweringError("IMPLEMENTATION_BUDGET_EXHAUSTED", preflight.reservation.obstacle.message, obstacleDetails(undefined, preflight.reservation.obstacle));
      attempt = preflight.reservation.attempt;
    } else {
      const existing = await this.options.store.transact((tx) => tx.findCandidateByInvocation(taskId, context.invocationId) ?? tx.findCandidateByQuery(taskId, revisionId, queryHash), context);
      if (existing) {
        if (existing.queryHash !== queryHash) throw new AnsweringError("INVALID_REQUEST", "RESULT_INVOCATION_IDEMPOTENCY_CONFLICT");
        return this.resultView(existing, context);
      }
      attempt = await this.options.store.transact((tx) => tx.findAttemptByInvocation(taskId, context.invocationId, "result"), context);
    }

    let privateResult: PrivateResultObject;
    let sqlStarted = memo?.state === "settled";
    try {
      if (memo?.state === "settled") {
        const reopened = await this.resultStore.openPrivate(memo.resultRef as PrivateResultObject["resultRef"], context);
        if (!reopened || reopened.contentHash !== memo.contentHash) {
          const details = await this.options.store.transact((tx) => {
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
        const result = boundedResult(await this.options.sqlExecutor.run(input.sql, limit, {
          kind: "result",
          idempotencyKey: executionKey,
          ...(context.signal ? { signal: context.signal } : {}),
          ...(context.deadlineAt ? { deadlineAt: context.deadlineAt } : {}),
        }));
        if (result.truncated) {
          const details = await this.options.store.transact((tx) => {
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
        privateResult = await this.resultStore.createPrivate(result, context);
        await context.memo?.set("answering.result-execution", { state: "settled", taskId: input.taskId, revisionId: input.revisionId, queryHash, resultRef: privateResult.resultRef, contentHash: privateResult.contentHash });
      }
    } catch (error) {
      if (error instanceof AnsweringError) throw error;
      if (context.signal?.aborted) throw error;
      const unknown = error instanceof SqlExecutionError && error.outcome === "unknown";
      const kind: ImplementationObstacleKind = unknown ? "execution_outcome_unknown" : error instanceof SqlExecutionError ? error.obstacleKind : "technical_failure";
      const details = await this.options.store.transact((tx) => {
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

    const checkReport = evaluateCandidateCheckReport({ spec: sealed.spec, result: privateResult, queryHash });
    const failure = candidateCheckFailure(checkReport.findings);
    if (failure) {
      await this.resultStore.discard(privateResult.resultRef, context);
      const details = await this.options.store.transact((tx) => {
        const current = tx.getTask(taskId);
        assertTaskAccess(current, context);
        if (attempt) updateAttempt(tx, attempt, "failed", "succeeded", true, "technical_failure");
        return obstacle(tx, current, revisionId, "technical_failure", "The result failed an online CandidateCheck", {
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

    const fanout = await this.evaluateFanout(taskId, revisionId, queryHash, input.sql.trim(), context);
    const combinedCoverage: readonly CheckCoverage[] = [...checkReport.coverage, fanoutCoverage(fanout)];
    const combinedFindings = [...checkReport.findings, ...fanoutFindings(fanout)];

    const budgetAfterResult = await this.options.store.transact((tx) => {
      const current = tx.getTask(taskId);
      assertTaskAccess(current, context);
      const budget = taskBudget(current, this.budgetPolicy);
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
      await this.resultStore.discard(privateResult.resultRef, context);
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
      committed = await this.options.store.transact((tx) => {
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
      const recovered = await this.options.store.transact((tx) => tx.findCandidateByQuery(taskId, revisionId, queryHash), context).catch(() => undefined);
      if (recovered) return this.resultView(recovered, context);
      throw error;
    }
    if (committed.candidateId !== baseCandidate.candidateId) await this.resultStore.discard(privateResult.resultRef, context);
    return this.resultView(committed, context);
  }

  private async loadFanoutSchema(context: BusinessContext): Promise<FanoutSchema | undefined> {
    if (this.fanoutOptions.schema) return this.fanoutOptions.schema;
    if (this.fanoutSchemaLoaded) return this.fanoutSchema;
    this.fanoutSchemaLoaded = true;
    if (!this.options.sqlExecutor.getSchema) return undefined;
    try {
      this.fanoutSchema = await this.options.sqlExecutor.getSchema(context.signal);
      return this.fanoutSchema;
    } catch (error) {
      if (context.signal?.aborted) throw error;
      return undefined;
    }
  }

  private async runFanoutProbe(
    taskId: TaskId,
    revisionId: RevisionId,
    request: FanoutProbeRequest,
    context: BusinessContext,
  ): Promise<FanoutProbeResult> {
    const queryHash = contentHash({ taskId, revisionId, targetId: request.targetId, sql: request.sql });
    let reservation: ReturnType<typeof reserveAttempt>;
    try {
      reservation = await this.options.store.transact((tx) => {
        const current = tx.getTask(taskId);
        assertTaskAccess(current, context);
        if (current.currentRevisionId !== revisionId) throw new AnsweringError("REVISION_STALE", "Fanout probe target Revision is stale", { currentRevisionId: current.currentRevisionId });
        return reserveAttempt(tx, current, this.budgetPolicy, "exploration", revisionId, context.invocationId, queryHash, "fanout_probe");
      }, context);
    } catch (error) {
      if (error instanceof AnsweringError) Object.assign(error, { fanoutFatal: true });
      throw error;
    }
    if (reservation.obstacle) throw new Error("probe_budget_exhausted");
    const attempt = reservation.attempt!;
    let sqlStarted = false;
    try {
      sqlStarted = true;
      const raw = await this.options.sqlExecutor.run(request.sql, 1, {
        kind: "exploration",
        idempotencyKey: `fanout:${queryHash}`,
        ...(request.signal ? { signal: request.signal } : {}),
        ...(request.deadlineAt ? { deadlineAt: request.deadlineAt } : {}),
        ...(context.queryScope ? { scope: context.queryScope } : {}),
      });
      const post = await this.options.store.transact((tx) => {
        const current = tx.getTask(taskId);
        assertTaskAccess(current, context);
        const budget = taskBudget(current, this.budgetPolicy);
        const observedRows = raw.rows.length;
        if (budget.observedRows + observedRows > budget.policy.maxObservedRows) {
          const charged = { ...current, budget: { ...budget, observedRows: budget.observedRows + observedRows }, updatedAt: now() };
          tx.putTask(charged);
          updateAttempt(tx, attempt, "failed", "succeeded", true, "budget_exhausted");
          return true;
        }
        tx.putTask({ ...current, budget: { ...budget, observedRows: budget.observedRows + observedRows }, updatedAt: now() });
        updateAttempt(tx, attempt, "succeeded", "succeeded", true);
        return false;
      }, context);
      if (post) throw new Error("probe_budget_exhausted");
      return { columns: raw.columns, rows: raw.rows, truncated: raw.truncated };
    } catch (error) {
      if (error instanceof AnsweringError) Object.assign(error, { fanoutFatal: true });
      if (context.signal?.aborted || request.signal?.aborted) throw error;
      const unknown = error instanceof SqlExecutionError && error.outcome === "unknown";
      await this.options.store.transact((tx) => {
        const current = tx.getTask(taskId);
        assertTaskAccess(current, context);
        updateAttempt(tx, attempt, unknown ? "unknown" : "failed", unknown ? "unknown" : "failed", sqlStarted, unknown ? "execution_outcome_unknown" : /budget/i.test(error instanceof Error ? error.message : String(error)) ? "budget_exhausted" : "technical_failure");
      }, context).catch(() => undefined);
      throw error;
    }
  }

  private async evaluateFanout(
    taskId: TaskId,
    revisionId: RevisionId,
    queryHash: string,
    sql: string,
    context: BusinessContext,
  ): Promise<FanoutReport> {
    const potential = hasPotentialFanout(sql);
    if (!potential) {
      return { ruleVersion: "answering-fanout-v1", status: "not_applicable", snapshotScope: "unbound", targets: [] };
    }
    if (this.fanoutOptions.enabled === false) return unknownFanoutReport("check_disabled");
    const memo = fanoutExecutionMemo(await context.memo?.get("answering.fanout-check"));
    if (memo && (memo.taskId !== taskId || memo.revisionId !== revisionId || memo.queryHash !== queryHash)) {
      throw new AnsweringError("INVALID_REQUEST", "FANOUT_INVOCATION_IDEMPOTENCY_CONFLICT");
    }
    if (memo?.state === "settled" && memo.report) return memo.report;
    if (memo?.state === "started") return unknownFanoutReport("probe_outcome_unknown");
    await context.memo?.set("answering.fanout-check", { state: "started", taskId, revisionId, queryHash });
    const schema = await this.loadFanoutSchema(context);
    const resolvedDialect = this.fanoutOptions.dialect ?? this.options.sqlExecutor.dialect ?? schema?.dialect;
    const report = await checkFanout({
      sql,
      ...(schema ? { schema } : {}),
      ...(resolvedDialect ? { dialect: resolvedDialect } : {}),
      runProbe: (request) => this.runFanoutProbe(taskId, revisionId, request, context),
      ...(context.signal ? { signal: context.signal } : {}),
      ...(context.deadlineAt ? { deadlineAt: context.deadlineAt } : {}),
      ...(this.fanoutOptions.maxTargets !== undefined ? { maxTargets: this.fanoutOptions.maxTargets } : {}),
      ...(this.fanoutOptions.maxInputRows !== undefined ? { maxInputRows: this.fanoutOptions.maxInputRows } : {}),
    });
    await context.memo?.set("answering.fanout-check", { state: "settled", taskId, revisionId, queryHash, report });
    return report;
  }

  private async markCandidateCorrupt(candidate: ResultCandidateRecord, context: BusinessContext): Promise<void> {
    await this.options.store.transact((tx) => {
      const current = tx.getCandidate(candidate.candidateId);
      if (!current || current.status === "corrupt") return;
      tx.putCandidate({ ...current, status: "corrupt", publishable: false, findings: [...current.findings, { id: `integrity-${current.candidateId}`, kind: "integrity_conflict", message: "ResultStore object is missing or does not match the Candidate content hash.", blocking: true }] });
    }, context).catch(() => undefined);
  }

  private async resultView(candidate: ResultCandidateRecord, context: BusinessContext): Promise<QueryExecutionView> {
    if (candidate.status !== "ready" || !candidate.publishable) throw new AnsweringError("RESULT_INTEGRITY_MISMATCH", "Result Candidate is corrupt and cannot be used");
    try {
      const result = await this.resultStore.openPrivate(candidate.resultRef, context);
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
      await this.markCandidateCorrupt(candidate, context);
      throw new AnsweringError("RESULT_INTEGRITY_MISMATCH", "Result Candidate references a missing or changed private result");
    }
  }

  async publish(input: PublishCandidate, context: BusinessContext): Promise<PublicationReceipt> {
    assertContext(context);
    const candidateId = input.candidateId as unknown as ResultCandidateRecord["candidateId"];
    const taskAndCandidate = await this.options.store.transact((tx) => {
      const candidate = tx.getCandidate(candidateId);
      if (!candidate) throw new AnsweringError("CANDIDATE_NOT_FOUND", `Candidate ${input.candidateId} was not found`);
      const task = tx.getTask(candidate.taskId);
      assertTaskAccess(task, context);
      if (task.currentRevisionId !== candidate.revisionId) throw new AnsweringError("PUBLICATION_STALE", "Candidate belongs to an old revision");
      if (candidate.status !== "ready" || !candidate.publishable) throw new AnsweringError("RESULT_INTEGRITY_MISMATCH", "Corrupt Result Candidate cannot be published");
      const revision = tx.getRevision(candidate.revisionId);
      if (!revision || revision.state.state !== "ready") throw new AnsweringError("PUBLICATION_STALE", "Candidate revision is not sealed for publication");
      const existingForTask = task.publicationId ? tx.getReceipt(task.publicationId) : undefined;
      if (existingForTask && existingForTask.candidateId !== candidate.candidateId) {
        throw new AnsweringError("PUBLICATION_ALREADY_EXISTS", "A Query Task already has a publication receipt for this revision", { receiptId: existingForTask.receiptId, candidateId: existingForTask.candidateId });
      }
      const existing = tx.findReceiptByRequest(candidate.taskId, input.requestId) ?? tx.findReceiptByCandidate(candidate.taskId, candidate.candidateId) ?? existingForTask;
      const provisionalChoiceIds = revision.choiceResolutions
        .filter((resolution) => resolution.outcome === "provisional")
        .map((resolution) => resolution.choiceId);
      const fanoutDisclosure = candidate.fanout && (candidate.fanout.status === "finding" || candidate.fanout.status === "unknown")
        ? fanoutDisclosureSummary(candidate.fanout)
        : "";
      const feedbackDisclosure = specFeedbackDisclosureSummary(candidate.coverage?.find((coverage) => coverage.checkId === SPEC_FEEDBACK_CHECK_ID));
      const disclosure: PublicationDisclosure | undefined = provisionalChoiceIds.length > 0 || fanoutDisclosure || feedbackDisclosure
        ? {
            required: true,
            provisionalChoiceIds,
            summary: [
              ...(provisionalChoiceIds.length > 0 ? ["结果包含按字面解释选择的口径；该选择未被权威证据唯一确定。"] : []),
              ...(fanoutDisclosure ? [fanoutDisclosure] : []),
              ...(feedbackDisclosure ? [feedbackDisclosure] : []),
            ].join(" "),
            ...(fanoutDisclosure && candidate.fanout ? { fanoutStatus: candidate.fanout.status } : {}),
          }
        : undefined;
      return { candidate, task, revision, existing, disclosure };
    }, context);
    if (taskAndCandidate.existing) {
      const requestedFormat = input.format === "auto" ? taskAndCandidate.existing.format : input.format;
      if (requestedFormat !== taskAndCandidate.existing.format) throw new AnsweringError("PUBLICATION_ALREADY_EXISTS", "A different format was already published for this request");
      try {
        await this.resultStore.openAuthorized(taskAndCandidate.candidate.resultRef, taskAndCandidate.existing, context);
      } catch {
        await this.markCandidateCorrupt(taskAndCandidate.candidate, context);
        throw new AnsweringError("RESULT_INTEGRITY_MISMATCH", "Published Receipt references a missing or changed private result");
      }
      return taskAndCandidate.existing;
    }
    const permit: PublicationPermit = {
      candidateId: taskAndCandidate.candidate.candidateId,
      taskId: taskAndCandidate.candidate.taskId,
      revisionId: taskAndCandidate.candidate.revisionId,
      resultRef: taskAndCandidate.candidate.resultRef,
      contentHash: taskAndCandidate.candidate.contentHash,
      policyVersion: "answering-publication-v1",
    };
    let result: PrivateResultObject;
    try {
      const opened = await this.resultStore.openPrivate(permit.resultRef, context);
      if (!opened || opened.contentHash !== permit.contentHash || opened.resultRef !== permit.resultRef) throw new Error("RESULT_INTEGRITY_MISMATCH");
      result = opened;
    } catch {
      await this.markCandidateCorrupt(taskAndCandidate.candidate, context);
      throw new AnsweringError("RESULT_INTEGRITY_MISMATCH", "Result Candidate content hash does not match ResultStore");
    }
    const format = input.format === "auto" ? (result.rowCount <= INLINE_ROW_LIMIT ? "inline" : "csv") : input.format;
    if (format === "inline" && result.rowCount > INLINE_ROW_LIMIT) throw new AnsweringError("INLINE_RESULT_TOO_LARGE", "Inline publication is limited to ten rows");
    const encoded = format === "inline"
      ? await this.resultStore.encodeInline(result.resultRef, context)
      : await this.resultStore.encodeCsv(result.resultRef, context);
    const receiptId = makeInternalId("publication") as unknown as PublicationReceipt["receiptId"];
    const receipt: PublicationReceipt = {
      receiptId,
      taskId: permit.taskId,
      principalId: context.principal.id,
      sessionId: context.sessionId,
      candidateId: permit.candidateId,
      revisionId: permit.revisionId,
      resultRef: permit.resultRef,
      format,
      publicRef: `/api/runtime/publications/${receiptId}?session_id=${encodeURIComponent(context.sessionId)}`,
      contentHash: permit.contentHash,
      presentationContentHash: encoded.contentHash,
      ...(taskAndCandidate.candidate.coverage ? { coverage: taskAndCandidate.candidate.coverage } : {}),
      ...(taskAndCandidate.candidate.fanout ? { fanout: taskAndCandidate.candidate.fanout } : {}),
      ...(taskAndCandidate.disclosure ? { disclosure: taskAndCandidate.disclosure } : {}),
      policyVersion: permit.policyVersion,
      createdByInvocationId: context.invocationId,
      requestId: input.requestId,
      createdAt: now(),
    };
    const committed = await this.options.store.transact((tx) => {
      const currentTask = tx.getTask(receipt.taskId);
      assertTaskAccess(currentTask, context);
      if (currentTask.currentRevisionId !== receipt.revisionId) throw new AnsweringError("PUBLICATION_STALE", "Revision changed during publication");
      const existing = tx.findReceiptByRequest(receipt.taskId, receipt.requestId) ?? tx.findReceiptByCandidate(receipt.taskId, receipt.candidateId);
      if (existing) return existing;
      tx.putReceipt(receipt);
      tx.putTask({ ...currentTask, publicationId: receipt.receiptId, lifecycle: "published", updatedAt: receipt.createdAt });
      return receipt;
    }, context);
    return committed;
  }

  async inspect(input: InspectAnswer, context: BusinessContext): Promise<AnswerTaskView> {
    assertContext(context);
    const view = await this.options.store.inspect(input.taskId as unknown as TaskId, context);
    if (!view) throw new AnsweringError("TASK_NOT_FOUND", `Task ${input.taskId} was not found`);
    return view;
  }
}
