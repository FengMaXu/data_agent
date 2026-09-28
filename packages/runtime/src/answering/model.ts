import type { DecisionPointName, DecisionPointProposal, DecisionPoints } from "./decision-points.js";
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
export type QueryAttemptPurpose = "user_exploration" | "fanout_probe" | "choice_probe";
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
  readonly purpose?: QueryAttemptPurpose;
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
  readonly ruleVersion?: string;
  readonly outcome: "clear" | "finding" | "not_applicable" | "unknown";
  readonly reason?: string;
}

export type SpecFeedbackStatus = "pending" | "completed" | "unavailable" | "disabled";
export type SpecFeedbackRelation = "supported" | "contradicted" | "not_established" | "not_applicable";
export type SpecFeedbackCoverage = "complete" | "partial" | "missing" | "not_applicable";
export type SpecFeedbackRelationProbability = Readonly<Record<SpecFeedbackRelation, number>>;
export type SpecFeedbackCoverageProbability = Readonly<Record<SpecFeedbackCoverage, number>>;

export interface SpecFeedbackChoice<TChoice extends string, TProbabilities extends Readonly<Record<TChoice, number>>> {
  readonly choice: TChoice;
  readonly probabilities: TProbabilities;
  /** Concentration of this Choice distribution; not calibrated correctness. */
  readonly confidence: number;
}

export interface SpecFeedbackFacetAssessment {
  readonly facet: FacetName;
  readonly relation: SpecFeedbackChoice<SpecFeedbackRelation, SpecFeedbackRelationProbability>;
  readonly coverage: SpecFeedbackChoice<SpecFeedbackCoverage, SpecFeedbackCoverageProbability>;
}

export interface SpecFeedbackAssessment {
  readonly model: string;
  readonly ruleVersion: string;
  readonly facets: readonly SpecFeedbackFacetAssessment[];
}

export interface SpecFeedbackDeterministicIssue {
  readonly code: "scalar_row_count_conflict" | "strict_top_n_row_count_conflict";
  readonly facets: NonEmpty<FacetName>;
  readonly message: string;
  readonly actual?: number;
  readonly expected?: number;
}

export interface SpecFeedback {
  readonly taskId: TaskId;
  readonly revisionId: RevisionId;
  readonly ruleVersion: string;
  readonly status: SpecFeedbackStatus;
  readonly deterministicIssues: readonly SpecFeedbackDeterministicIssue[];
  readonly assessment?: SpecFeedbackAssessment;
  readonly inputHash?: string;
  readonly evidenceIds: readonly EvidenceId[];
  readonly limitations: readonly string[];
  readonly reason?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  /** The report was bound to an older Revision when it was persisted. */
  readonly stale?: true;
  readonly currentRevisionId?: RevisionId;
}

export interface FanoutProbeObservation {
  readonly sourceRows: number;
  readonly sourceNonNullKeys: number;
  readonly sourceDistinctKeys: number;
  readonly joinedRows: number;
  readonly joinedNonNullKeys: number;
  readonly joinedDistinctKeys: number;
  readonly complete: boolean;
  readonly fanoutFactor?: number;
  readonly sourceRelation: string;
  readonly sourceKey: string;
}

export interface FanoutTargetReport {
  readonly targetId: string;
  readonly blockDepth: number;
  readonly aggregateExpressions: readonly string[];
  readonly aggregateFunctions: readonly ("COUNT" | "SUM")[];
  readonly sourceRelation: string;
  readonly sourceAlias: string;
  readonly sourceKey: string;
  readonly sourceKeySql: string;
  readonly sourceSql: string;
  readonly joinedRelation?: string;
  readonly fromSql: string;
  readonly status: "clear" | "finding" | "unknown";
  readonly reason?: string;
  readonly observation?: FanoutProbeObservation;
}

export interface FanoutReport {
  readonly ruleVersion: string;
  readonly status: "clear" | "finding" | "not_applicable" | "unknown";
  readonly snapshotScope: "probe_statement" | "result_snapshot" | "unbound";
  readonly targets: readonly FanoutTargetReport[];
  readonly unsupportedReasons?: readonly string[];
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
        | { readonly kind: "hypothesis"; readonly hypothesisId: HypothesisId }
        /** Model inference without a bound Hypothesis or qualifying Evidence; disclosed, not blocking. */
        | { readonly kind: "inference" };
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
  /** Set only by Runtime Evidence Admission after the quote was found in a trusted source text. */
  readonly verification?: EvidenceVerification;
}

export interface EvidenceVerification {
  readonly method: "user_message_quote" | "document_quote";
  /** Hash of the complete trusted source text at admission time. */
  readonly sourceContentHash: string;
}

/** Evidence kinds whose authority comes from a quoted text and therefore require verification. */
export type TextEvidenceKind = "user_confirmation" | "reviewed_definition" | "task_document" | "request_wording";

export function isTextEvidenceKind(kind: EvidenceKind): kind is TextEvidenceKind {
  return kind === "user_confirmation" || kind === "reviewed_definition" || kind === "task_document" || kind === "request_wording";
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
  /** Required with selectedAlternativeId: why the cited evidence rules out every other alternative. */
  readonly selectionRationale?: string;
  readonly provisionalAlternativeId?: string;
  /** Decide at creation (ADR-0006); verification is derived from decisionEvidenceIds. */
  readonly decidedAlternativeId?: string;
  readonly decisionRationale?: string;
  readonly decisionEvidenceIds?: readonly string[];
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
      /**
       * Supported, but no cited evidence qualifies it (ADR-0006 applied to
       * Hypotheses): unverified and disclosed at publication. Legacy snapshots
       * carry the Choice that settled it instead of cited evidence.
       */
      readonly outcome: "provisional";
      readonly hypothesisId: HypothesisId;
      readonly choiceId?: ChoiceId;
      readonly disclosureRequired: true;
      readonly citedEvidenceIds?: readonly EvidenceId[];
    };

export type ChoiceResolution =
  | {
      readonly outcome: "selected";
      readonly choiceId: ChoiceId;
      readonly alternativeId: AlternativeId;
      readonly proof: NonEmpty<QualifiedEvidenceId>;
      /** Discriminating argument recorded at selection; absent on legacy snapshots. */
      readonly rationale?: string;
      readonly adviceOverride?: AdviceOverride;
    }
  | {
      readonly outcome: "provisional";
      readonly choiceId: ChoiceId;
      readonly alternativeId: AlternativeId;
      readonly disclosureRequired: true;
      /** Required when Choice governance is on (ADR-0005); absent on legacy snapshots. */
      readonly rationale?: string;
      readonly adviceOverride?: AdviceOverride;
      /** Evidence the decision cited that did not qualify it (ADR-0006); disclosed with the decision. */
      readonly citedEvidenceIds?: readonly EvidenceId[];
    }
  | {
      /** Every alternative's probe produced the same output; no decision or disclosure is needed. */
      readonly outcome: "equivalent";
      readonly choiceId: ChoiceId;
    };

/** Why a decision departs from compare_hypotheses' clear lean, with the evidence that outweighs it. */
export interface AdviceOverride {
  readonly reason: string;
  readonly evidenceIds: NonEmpty<EvidenceId>;
}

export interface AdviceOverrideProposal {
  readonly reason: string;
  readonly evidenceIds: readonly string[];
}

/** An alternative that cannot be executed on its own; recorded instead of a probe (ADR-0005). */
export interface ProbeWaiver {
  readonly choiceId: ChoiceId;
  readonly alternativeId: AlternativeId;
  readonly reason: string;
}

export interface ProbeWaiverProposal {
  /** Existing Choice id, or the localId of a Choice added in the same call. */
  readonly choiceId: string;
  /** Existing alternative id, or the localId of an alternative added in the same call. */
  readonly alternativeId: string;
  readonly reason: string;
}

/**
 * Runtime record of one exploration executed as an alternative's probe. The
 * fingerprint compares complete outputs the way the answer will be judged.
 */
export interface ChoiceProbeRecord {
  readonly choiceId: ChoiceId;
  readonly alternativeId: AlternativeId;
  readonly revisionId: RevisionId;
  readonly evidenceId: EvidenceId;
  readonly rowCount: number;
  readonly outcome:
    | { readonly state: "available"; readonly fingerprint: string }
    | { readonly state: "unavailable"; readonly reason: string };
  readonly probedAt: string;
}

/**
 * Explicit handling of an existing Hypothesis or Choice in a revision. Runtime
 * applies it to the carried-forward state; omission is never a disposition.
 */
export type DispositionProposal =
  | {
      readonly action: "support" | "refute";
      readonly hypothesisId: string;
      readonly evidenceIds: readonly string[];
    }
  | {
      readonly action: "select";
      readonly choiceId: string;
      readonly alternativeId: string;
      readonly evidenceIds: readonly string[];
      /** Why the cited evidence rules out every other alternative; quoting the request alone is not enough. */
      readonly rationale: string;
      /** Required when the decision departs from compare_hypotheses' clear lean. */
      readonly adviceOverride?: AdviceOverrideProposal;
    }
  | {
      readonly action: "provisional";
      readonly choiceId: string;
      readonly alternativeId: string;
      /** Why this alternative fits the request best; required when Choice governance is on. */
      readonly rationale?: string;
      readonly adviceOverride?: AdviceOverrideProposal;
    }
  | {
      /**
       * The one model-facing decision (ADR-0006). Runtime records it as
       * selected when the cited evidence qualifies, otherwise as a disclosed
       * provisional decision.
       */
      readonly action: "decide";
      readonly choiceId: string;
      readonly alternativeId: string;
      readonly rationale: string;
      readonly evidenceIds?: readonly string[];
      readonly adviceOverride?: AdviceOverrideProposal;
    }
  | {
      /** Accepted only when every alternative's probe produced the same output. */
      readonly action: "equivalent";
      readonly choiceId: string;
    }
  | {
      readonly action: "supersede";
      readonly targetId: string;
      /** New item localIds from this revision or existing item ids that take over every affected facet. */
      readonly replacementIds: readonly string[];
      readonly reason: string;
    };

export interface Supersession {
  readonly targetId: HypothesisId | ChoiceId;
  readonly replacementIds: NonEmpty<HypothesisId | ChoiceId>;
  readonly reason: string;
}

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
  readonly kind: "shape_conflict" | "result_incomplete" | "integrity_conflict" | "join_fanout";
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
  /** Latest probe per Choice alternative; Choice ids are stable across revisions. */
  readonly choiceProbes?: readonly ChoiceProbeRecord[];
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
  /** Items removed from this Revision by explicit supersession; absent on legacy snapshots. */
  readonly supersessions?: readonly Supersession[];
  /** Advisory report attached to this Revision; it never changes qualification. */
  readonly specFeedback?: SpecFeedback;
  /** Alternatives declared not probeable; carried forward like other revision items. */
  readonly probeWaivers?: readonly ProbeWaiver[];
  /** Declared decision points (ADR-0005); absent on legacy revisions, which are exempt. */
  readonly decisionPoints?: DecisionPoints;
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
  /** Immutable bounded JOIN fanout evidence for this exact candidate. */
  readonly fanout?: FanoutReport;
  readonly attemptId?: string;
  readonly createdByInvocationId: string;
  readonly createdAt: string;
  readonly status: "ready" | "corrupt";
  readonly publishable: boolean;
}

export interface PublicationDisclosure {
  readonly required: true;
  readonly provisionalChoiceIds: readonly ChoiceId[];
  /** Hypotheses supported without qualifying evidence (ADR-0006 applied to Hypotheses). */
  readonly provisionalHypothesisIds?: readonly HypothesisId[];
  /** Specified facets whose basis is model inference rather than a Hypothesis or qualifying Evidence. */
  readonly inferredFacets?: readonly FacetName[];
  readonly summary: string;
  readonly fanoutStatus?: FanoutReport["status"];
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
  /** Immutable fanout evidence is disclosed with the exact published Candidate. */
  readonly fanout?: FanoutReport;
  /** Observed column facts of the published rows; absent on Receipts published before profiling existed. */
  readonly physicalProfile?: PhysicalProfile;
  /** Published bytes/rows remain in ResultStore and are read only through this Receipt. */
  readonly createdByInvocationId: string;
  readonly requestId: string;
  readonly createdAt: string;
}

/**
 * Facts observed by scanning every stored row of one column. It never decides
 * scale, unit or additivity; those belong to Dataset Annotations (ADR-0008).
 */
export interface ColumnProfile {
  readonly name: string;
  readonly kind: "integer" | "decimal" | "text" | "boolean" | "json" | "null" | "mixed";
  /** Wire encoding of a numeric column, when every value shares one; DECIMAL text is "string". */
  readonly encodedAs?: "number" | "bigint" | "string";
  readonly nullCount: number;
  /** Exact number of distinct non-null values, omitted once it exceeds the counting limit. */
  readonly distinctCount?: number;
  /** Numeric columns only, as plain decimal text so no precision is lost. */
  readonly min?: string;
  readonly max?: string;
}

export interface PhysicalProfile {
  readonly version: 1;
  readonly rowCount: number;
  /** When true, the profile describes only the stored rows, not the full query result. */
  readonly truncated: boolean;
  readonly columns: readonly ColumnProfile[];
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

export interface HypothesisView {
  readonly id: HypothesisId;
  readonly kind: HypothesisKind;
  readonly statement: string;
  readonly affects: NonEmpty<FacetName>;
  /** provisional: supported without qualifying evidence; resolved, and disclosed at publication. */
  readonly status: "unresolved" | "supported" | "provisional" | "refuted";
}

export interface ChoiceView {
  readonly id: ChoiceId;
  readonly affects: NonEmpty<FacetName>;
  readonly alternatives: NonEmpty<ChoiceAlternative>;
  readonly status: "unresolved" | "selected" | "provisional" | "equivalent";
  readonly alternativeId?: AlternativeId;
  readonly rationale?: string;
  /** Present when probes are tracked: per-alternative probe state and whether outputs differ. */
  readonly probes?: readonly ChoiceProbeView[];
  readonly outputs?: ChoiceOutputs;
  /** Latest compare_hypotheses advice for this Choice; advisory only. */
  readonly advice?: ChoiceAdviceView;
  readonly adviceOverride?: AdviceOverride;
}

export interface ChoiceAdviceView {
  readonly recommendation: "alternative" | "insufficient_evidence" | "multiple_plausible" | "none_supported";
  readonly probabilities: readonly { readonly alternativeId: string; readonly probability: number }[];
  readonly lean?: { readonly alternativeId: string; readonly probability: number };
}

/** identical: every alternative produced the same output; distinct: at least two differ; incomplete: some output unknown. */
export type ChoiceOutputs = "identical" | "distinct" | "incomplete";

export interface ChoiceProbeView {
  readonly alternativeId: AlternativeId;
  readonly state: "missing" | "available" | "unavailable" | "waived";
  readonly rowCount?: number;
  /** Short fingerprint prefix; equal prefixes mean equal outputs. */
  readonly output?: string;
  readonly reason?: string;
}

export interface AnswerRevisionView {
  readonly taskId: TaskId;
  readonly revisionId: RevisionId;
  readonly parentRevisionId?: RevisionId;
  readonly spec: AnswerSpec;
  /** Stable Runtime ids; a revision references these instead of resubmitting items. */
  readonly hypotheses: readonly HypothesisView[];
  readonly choices: readonly ChoiceView[];
  readonly unresolvedFacets: readonly FacetName[];
  readonly unresolvedHypotheses: readonly HypothesisId[];
  readonly unresolvedChoices: readonly ChoiceId[];
  /** Specified facets based on model inference; disclosed at publication, not blocking. */
  readonly inferredFacets: readonly FacetName[];
  /** Declared decision points and the ones still undeclared; present when decision points are tracked. */
  readonly decisionPoints?: DecisionPoints;
  readonly undeclaredDecisionPoints?: readonly DecisionPointName[];
  readonly specFeedback?: SpecFeedback;
}

export interface QueryExecutionView {
  readonly kind: "exploration" | "result";
  readonly artifact: QueryArtifact;
  readonly preview: BoundedResult;
  readonly findings: readonly Finding[];
  readonly coverage?: readonly CheckCoverage[];
  readonly fanout?: FanoutReport;
  readonly attemptId?: string;
  /** Set when the exploration ran as a Choice probe. */
  readonly probe?: ChoiceProbeView & { readonly choiceId: ChoiceId };
}

export interface BeginAnswer {
  readonly requestMessageId: string;
  readonly spec: AnswerSpecProposal;
  readonly hypotheses?: readonly HypothesisProposal[];
  readonly choices?: readonly ChoiceProposal[];
  readonly notProbeable?: readonly ProbeWaiverProposal[];
  readonly decisionPoints?: readonly DecisionPointProposal[];
  readonly evidence?: readonly UntrustedEvidenceInput[];
  readonly requestId: string;
}

/**
 * A delta against the current Revision. Runtime copies the base Revision and
 * applies only what is listed here; omitted facets and items carry forward.
 */
export interface ReviseAnswer {
  readonly taskId: string;
  readonly baseRevisionId: string;
  /** Facet patch: only present keys are replaced; filters/groupBy replace the whole list. */
  readonly spec?: AnswerSpecProposal;
  readonly addHypotheses?: readonly HypothesisProposal[];
  readonly addChoices?: readonly ChoiceProposal[];
  readonly notProbeable?: readonly ProbeWaiverProposal[];
  readonly decisionPoints?: readonly DecisionPointProposal[];
  readonly dispositions?: readonly DispositionProposal[];
  readonly evidence?: readonly UntrustedEvidenceInput[];
  readonly requestId: string;
}

export interface UntrustedEvidenceInput {
  /** Caller-local handle for references inside the same begin/revise call. */
  readonly localId?: string;
  readonly kind: EvidenceKind;
  /**
   * Document kinds: authorized knowledge id. request_wording: ignored, Runtime
   * binds the task request message. user_confirmation: set by the trusted Host.
   */
  readonly sourceRef?: string;
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
      /** Run this exploration as the probe of one Choice alternative (ADR-0005). */
      readonly probe?: { readonly choiceId: string; readonly alternativeId: string };
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

