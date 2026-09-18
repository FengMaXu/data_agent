import { createHash } from "node:crypto";

/**
 * Domain identities are branded at the Answering boundary. Constructors are
 * intentionally private to this module; callers receive opaque strings from
 * the five public use cases and must still be checked by the Store.
 */
declare const identityBrand: unique symbol;
export type Id<K extends string> = string & { readonly [identityBrand]: K };

export type TaskId = Id<"TaskId">;
export type RevisionId = Id<"RevisionId">;
export type ReadyRevisionId = Id<"ReadyRevisionId">;
export type HypothesisId = Id<"HypothesisId">;
export type EvidenceId = Id<"EvidenceId">;
export type QualifiedEvidenceId = Id<"QualifiedEvidenceId">;
export type ChoiceId = Id<"ChoiceId">;
export type AlternativeId = Id<"AlternativeId">;
export type CandidateId = Id<"CandidateId">;
export type PrivateResultRef = Id<"PrivateResultRef">;
export type PublicationId = Id<"PublicationId">;

export type NonEmpty<T> = readonly [T, ...T[]];

export type FacetName = "entity" | "metric" | "filters" | "groupBy" | "time" | "ranking" | "output";
export type HypothesisKind = "business_semantics" | "physical_mapping" | "data_property";

/**
 * The inner loop reports obstacles instead of collapsing every failure into a
 * semantic disagreement.  This is an internal Answering contract: it does
 * not add a sixth public use case or give an Agent permission to mutate the
 * current Spec.
 */
export type ImplementationObstacleKind =
  | "technical_failure"
  | "mapping_insufficient"
  | "business_judgment_required"
  | "budget_exhausted"
  | "execution_outcome_unknown";

export type ExecutionOutcome = "not_started" | "failed" | "succeeded" | "unknown";

export type QueryAttemptKind = "revision" | "exploration" | "result";
export type QueryAttemptState = "blocked" | "started" | "succeeded" | "failed" | "unknown";

export interface QueryBudgetPolicy {
  readonly version: "answering-dual-loop-v1";
  /** Number of revisions after begin; a revision never resets the other counters. */
  readonly maxRevisions: number;
  /** Bounded semantic/data-property probes for one Query Task. */
  readonly maxExplorationAttempts: number;
  /** Bounded final-query implementations for one Query Task. */
  readonly maxResultAttempts: number;
  /** Wall-clock lifetime of the task budget. */
  readonly maxElapsedMs: number;
  /** Maximum observed result rows charged to the task across attempts. */
  readonly maxObservedRows: number;
}

export interface QueryBudgetState {
  readonly policy: QueryBudgetPolicy;
  readonly startedAt: string;
  readonly revisionCount: number;
  readonly explorationAttempts: number;
  readonly resultAttempts: number;
  readonly observedRows: number;
}

export interface QueryAttemptRecord {
  readonly attemptId: string;
  readonly taskId: TaskId;
  readonly kind: QueryAttemptKind;
  readonly revisionId: RevisionId;
  readonly invocationId: string;
  readonly queryHash?: string;
  readonly state: QueryAttemptState;
  readonly sqlExecuted: boolean;
  readonly outcome: ExecutionOutcome;
  readonly obstacleKind?: ImplementationObstacleKind;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CheckCoverage {
  readonly checkId: string;
  readonly outcome: "clear" | "finding" | "not_applicable" | "unknown";
  readonly reason?: string;
}

export interface ImplementationObstacle {
  readonly kind: ImplementationObstacleKind;
  readonly taskId: TaskId;
  readonly revisionId: RevisionId;
  readonly message: string;
  readonly evidenceIds: readonly EvidenceId[];
  readonly attempts: readonly QueryAttemptRecord[];
  readonly coverage: readonly CheckCoverage[];
  readonly requiresOuterDecision: boolean;
  readonly retryable: boolean;
  readonly sqlExecuted: boolean;
  readonly executionOutcome: ExecutionOutcome;
  readonly queryHash?: string;
}

export interface EntitySpec {
  readonly name: string;
  readonly keyColumns?: readonly string[];
}

export interface MetricSpec {
  readonly kind: string;
  readonly expression?: string;
  readonly unit?: string;
}

export interface FilterSpec {
  readonly expression: string;
}

export interface GroupingSpec {
  readonly expression: string;
}

export interface TimeSpec {
  readonly expression: string;
  readonly boundary?: "inclusive" | "exclusive" | "mixed" | "unspecified";
}

export interface RankingSpec {
  readonly n: number;
  readonly orderBy: string;
  readonly tiePolicy?: "strict" | "include_ties" | "unspecified";
}

export interface OutputSpec {
  readonly rowMode?: "scalar" | "top_n" | "grouped" | "full" | "detail";
  readonly rowCount?: number;
  readonly columns?: readonly string[];
}

export type Facet<T> =
  | { readonly state: "unknown" }
  | { readonly state: "not_applicable" }
  | {
      readonly state: "specified";
      readonly value: T;
      readonly basis:
        | { readonly kind: "evidence"; readonly evidenceIds: NonEmpty<EvidenceId> }
        | { readonly kind: "hypothesis"; readonly hypothesisId: HypothesisId };
    };

export interface AnswerSpec {
  readonly entity: Facet<EntitySpec>;
  readonly metric: Facet<MetricSpec>;
  readonly filters: readonly Facet<FilterSpec>[];
  readonly groupBy: readonly Facet<GroupingSpec>[];
  readonly time: Facet<TimeSpec>;
  readonly ranking: Facet<RankingSpec>;
  readonly output: Facet<OutputSpec>;
}

/** Minimal, untrusted model/application proposal accepted by begin/revise. */
export interface AnswerSpecProposal {
  readonly entity?: unknown;
  readonly metric?: unknown;
  readonly filters?: readonly unknown[];
  readonly groupBy?: readonly unknown[];
  readonly time?: unknown;
  readonly ranking?: unknown;
  readonly output?: unknown;
}

export interface EvidenceBase {
  readonly id: EvidenceId;
  readonly kind: EvidenceKind;
  readonly authority: EvidenceAuthority;
  readonly sourceRef: string;
  readonly contentHash?: string;
  /** For query observations, binds a replayed invocation to its SQL input. */
  readonly queryHash?: string;
  readonly quote?: string;
  readonly observedAt: string;
}

export type EvidenceKind =
  | "user_confirmation"
  | "reviewed_definition"
  | "task_document"
  | "request_wording"
  | "schema_fact"
  | "query_observation";

export type EvidenceAuthority =
  | "user"
  | "reviewed_business_definition"
  | "task_document"
  | "request_wording"
  | "schema"
  | "observation";

export type Evidence =
  | (EvidenceBase & { readonly kind: "user_confirmation"; readonly authority: "user" })
  | (EvidenceBase & { readonly kind: "reviewed_definition"; readonly authority: "reviewed_business_definition" })
  | (EvidenceBase & { readonly kind: "task_document"; readonly authority: "task_document" })
  | (EvidenceBase & { readonly kind: "request_wording"; readonly authority: "request_wording" })
  | (EvidenceBase & { readonly kind: "schema_fact"; readonly authority: "schema" })
  | (EvidenceBase & { readonly kind: "query_observation"; readonly authority: "observation"; readonly preview: BoundedResult });

export interface Hypothesis {
  readonly id: HypothesisId;
  readonly kind: HypothesisKind;
  readonly statement: string;
  readonly affects: NonEmpty<FacetName>;
  readonly basis: string;
  readonly impact: string;
}

export interface HypothesisProposal {
  readonly localId: string;
  readonly kind: HypothesisKind;
  readonly statement: string;
  readonly affects: readonly FacetName[];
  readonly basis: string;
  readonly impact: string;
  readonly proposedEvidenceIds?: readonly string[];
}

export interface ChoiceAlternative {
  readonly id: AlternativeId;
  readonly statement: string;
}

export interface Choice {
  readonly id: ChoiceId;
  readonly affects: NonEmpty<FacetName>;
  readonly alternatives: NonEmpty<ChoiceAlternative>;
}

export interface ChoiceProposal {
  readonly localId: string;
  readonly affects: readonly FacetName[];
  readonly alternatives: readonly { readonly localId: string; readonly statement: string }[];
  readonly selectedAlternativeId?: string;
  readonly selectionEvidenceIds?: readonly string[];
  readonly provisionalAlternativeId?: string;
}

export type Resolution =
  | {
      readonly outcome: "supported";
      readonly hypothesisId: HypothesisId;
      readonly proof: NonEmpty<QualifiedEvidenceId>;
    }
  | {
      readonly outcome: "refuted";
      readonly hypothesisId: HypothesisId;
      readonly proof: NonEmpty<QualifiedEvidenceId>;
    }
  | {
      readonly outcome: "provisional";
      readonly hypothesisId: HypothesisId;
      readonly choiceId: ChoiceId;
      readonly disclosureRequired: true;
    };

export type ChoiceResolution =
  | {
      readonly outcome: "selected";
      readonly choiceId: ChoiceId;
      readonly alternativeId: AlternativeId;
      readonly proof: NonEmpty<QualifiedEvidenceId>;
    }
  | {
      readonly outcome: "provisional";
      readonly choiceId: ChoiceId;
      readonly alternativeId: AlternativeId;
      readonly disclosureRequired: true;
    };

export interface DraftRevision {
  readonly state: "draft";
  readonly revisionId: RevisionId;
}

export interface ReadyRevision {
  readonly state: "ready";
  readonly revisionId: RevisionId;
  readonly ready: ReadyRevisionId;
}

export type RevisionState = DraftRevision | ReadyRevision;

export interface BoundedResult {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
  readonly columnTypes: readonly string[];
  readonly rowCount: number;
  readonly truncated: boolean;
}

export type QueryArtifact =
  | { readonly kind: "exploration"; readonly evidenceId: EvidenceId; readonly preview: BoundedResult }
  | {
      readonly kind: "candidate";
      readonly candidateId: CandidateId;
      readonly revisionId: RevisionId;
      readonly resultRef: PrivateResultRef;
    };

export interface Finding {
  readonly id: string;
  readonly kind: "shape_conflict" | "result_incomplete" | "integrity_conflict";
  readonly message: string;
  readonly blocking: boolean;
  readonly checkId?: string;
}

export interface QueryTaskRecord {
  readonly taskId: TaskId;
  readonly sessionId: string;
  readonly principalId: string;
  readonly requestMessageId: string;
  readonly requestId: string;
  readonly currentRevisionId: RevisionId;
  readonly latestCandidateId?: CandidateId;
  readonly publicationId?: PublicationId;
  readonly lifecycle: "open" | "published" | "closed";
  /** Persisted task budget; omitted only for legacy snapshots and normalized on read/write. */
  readonly budget?: QueryBudgetState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AnswerRevisionRecord {
  readonly taskId: TaskId;
  readonly revisionId: RevisionId;
  readonly parentRevisionId?: RevisionId;
  readonly requestId: string;
  readonly spec: AnswerSpec;
  readonly hypotheses: readonly Hypothesis[];
  readonly choices: readonly Choice[];
  readonly resolutions: readonly Resolution[];
  readonly choiceResolutions: readonly ChoiceResolution[];
  readonly state: RevisionState;
  readonly createdAt: string;
}

export interface ResultCandidateRecord {
  readonly candidateId: CandidateId;
  readonly taskId: TaskId;
  readonly revisionId: RevisionId;
  readonly resultRef: PrivateResultRef;
  readonly resultSchema: readonly string[];
  readonly rowCount: number;
  readonly contentHash: string;
  /** Canonical submitted SQL retained so an authorized reviewer can inspect the exact candidate. */
  readonly sql: string;
  readonly queryHash: string;
  readonly findings: readonly Finding[];
  /** Check coverage is retained even when no blocking Finding was produced. */
  readonly coverage?: readonly CheckCoverage[];
  readonly attemptId?: string;
  readonly createdByInvocationId: string;
  readonly createdAt: string;
  readonly status: "ready" | "corrupt";
  readonly publishable: boolean;
}

export interface PublicationDisclosure {
  readonly required: true;
  readonly provisionalChoiceIds: readonly ChoiceId[];
  readonly summary: string;
}

/** Internal typestate. No model/HTTP caller can construct this permit. */
export interface PublicationPermit {
  readonly candidateId: CandidateId;
  readonly taskId: TaskId;
  readonly revisionId: RevisionId;
  readonly resultRef: PrivateResultRef;
  readonly contentHash: string;
  readonly policyVersion: "answering-publication-v1";
}

export interface PublicationReceipt {
  readonly receiptId: PublicationId;
  readonly taskId: TaskId;
  readonly principalId: string;
  readonly sessionId: string;
  readonly candidateId: CandidateId;
  readonly revisionId: RevisionId;
  readonly resultRef: PrivateResultRef;
  readonly format: "inline" | "csv";
  readonly publicRef: string;
  /** Hash of the immutable ResultStore object bound to this receipt. */
  readonly contentHash: string;
  /** Hash of the selected inline/CSV representation, when it is encoded. */
  readonly presentationContentHash?: string;
  readonly disclosure?: PublicationDisclosure;
  readonly policyVersion: "answering-publication-v1";
  /** Coverage is not a semantic approval; it records checks that were unavailable or inapplicable. */
  readonly coverage?: readonly CheckCoverage[];
  /** Published bytes/rows remain in ResultStore and are read only through this Receipt. */
  readonly createdByInvocationId: string;
  readonly requestId: string;
  readonly createdAt: string;
}

export interface AnswerTaskView {
  readonly task: QueryTaskRecord;
  readonly currentRevision: AnswerRevisionRecord;
  readonly unresolvedFacets: readonly FacetName[];
  readonly unresolvedHypotheses: readonly HypothesisId[];
  readonly unresolvedChoices: readonly ChoiceId[];
  readonly attempts: readonly QueryAttemptRecord[];
  readonly candidate?: ResultCandidateRecord;
  readonly publication?: PublicationReceipt;
}

export interface AnswerRevisionView {
  readonly taskId: TaskId;
  readonly revisionId: RevisionId;
  readonly spec: AnswerSpec;
  readonly unresolvedFacets: readonly FacetName[];
  readonly unresolvedHypotheses: readonly HypothesisId[];
  readonly unresolvedChoices: readonly ChoiceId[];
}

export interface QueryExecutionView {
  readonly kind: "exploration" | "result";
  readonly artifact: QueryArtifact;
  readonly preview: BoundedResult;
  readonly findings: readonly Finding[];
  readonly coverage?: readonly CheckCoverage[];
  readonly attemptId?: string;
}

export interface BeginAnswer {
  readonly requestMessageId: string;
  readonly spec: AnswerSpecProposal;
  readonly hypotheses?: readonly HypothesisProposal[];
  readonly choices?: readonly ChoiceProposal[];
  readonly evidence?: readonly UntrustedEvidenceInput[];
  readonly requestId: string;
}

export interface ReviseAnswer {
  readonly taskId: string;
  readonly baseRevisionId: string;
  readonly spec: AnswerSpecProposal;
  readonly hypotheses?: readonly HypothesisProposal[];
  readonly choices?: readonly ChoiceProposal[];
  readonly evidence?: readonly UntrustedEvidenceInput[];
  readonly requestId: string;
}

export interface UntrustedEvidenceInput {
  readonly kind: EvidenceKind;
  readonly sourceRef: string;
  readonly contentHash?: string;
  readonly quote?: string;
  readonly preview?: BoundedResult;
}

export type ExecuteQuery =
  | {
      readonly kind: "exploration";
      readonly taskId: string;
      readonly sql: string;
      readonly limit?: number;
      /** Host-owned serialized preview cap; model-facing tools do not expose it. */
      readonly maxPreviewBytes?: number;
      readonly requestId?: string;
    }
  | {
      readonly kind: "result";
      readonly taskId: string;
      readonly revisionId: string;
      readonly sql: string;
      readonly requestId?: string;
    };

export interface PublishCandidate {
  readonly candidateId: string;
  readonly format: "auto" | "inline" | "csv";
  readonly requestId: string;
}

export interface InspectAnswer {
  readonly taskId: string;
}

export interface Principal {
  readonly id: string;
}

export interface InvocationMemo {
  get(name: string): Promise<unknown | undefined>;
  set(name: string, value: unknown): Promise<void>;
}

export interface QueryExecutionScope {
  /** Opaque host-issued scope identity; the executor must enforce its policy. */
  readonly scopeId: string;
  readonly connectionId: string;
}

export interface BusinessContext {
  readonly principal: Principal;
  readonly sessionId: string;
  readonly lane: string;
  readonly operationId: string;
  readonly invocationId: string;
  /** Pi invocation memo; Answering never persists a parallel operation checkpoint. */
  readonly memo?: InvocationMemo;
  readonly signal?: AbortSignal;
  /** Host-owned deadline propagated to a scoped external executor. */
  readonly deadlineAt?: number;
  /** Only a trusted application composition may provide this capability. */
  readonly queryScope?: QueryExecutionScope;
  /** Optional host-owned optimistic guard for delegated work on one Revision. */
  readonly expectedRevisionId?: string;
}

export function isFacetName(value: unknown): value is FacetName {
  return value === "entity" || value === "metric" || value === "filters" || value === "groupBy"
    || value === "time" || value === "ranking" || value === "output";
}

export function isHypothesisKind(value: unknown): value is HypothesisKind {
  return value === "business_semantics" || value === "physical_mapping" || value === "data_property";
}

export function isEvidenceKind(value: unknown): value is EvidenceKind {
  return value === "user_confirmation" || value === "reviewed_definition" || value === "task_document"
    || value === "request_wording" || value === "schema_fact" || value === "query_observation";
}

export function isReadOnlySql(sql: string): boolean {
  const normalized = sql.trim().replace(/;+$|\s+/g, (match) => match.includes(";") ? "" : " ").trim();
  if (!normalized || normalized.includes(";")) return false;
  return /^(?:select|with|explain|show|describe|pragma)\b/i.test(normalized)
    && !/\b(?:insert|update|delete|drop|alter|create|truncate|replace|merge|grant|revoke|call|vacuum)\b/i.test(normalized);
}

/**
 * Conservative preflight for the delegated path. This is not a database
 * security boundary; the injected scoped executor must still enforce a
 * read-only connection and relation policy.
 */
export function isScopedReadOnlySql(sql: string): boolean {
  if (!isReadOnlySql(sql)) return false;
  const normalized = sql.trim();
  if (!/^(?:select|with)\b/i.test(normalized)) return false;
  return !/\b(?:insert|update|delete|drop|alter|create|truncate|replace|merge|grant|revoke|call|copy|attach|detach|vacuum|load_file|pg_read_file|pg_ls_dir|dblink|pg_sleep|set_config|lo_import|lo_export|benchmark|sleep|sys_exec|into\s+(?:out|dump)file)\b/i.test(normalized);
}

export function normalizeLimit(limit: number | undefined, fallback = 50, maximum = 10_000): number {
  if (limit === undefined) return fallback;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("INVALID_QUERY_LIMIT");
  return Math.min(limit, maximum);
}

export function contentHash(value: unknown): string {
  const canonical = JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint") return { __type: "bigint", value: item.toString() };
    if (item === undefined) return { __type: "undefined" };
    return item;
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

