import type { AnswerSpec, SemanticEvidenceExcerpt } from "./answer-spec.js";
import type { QueryDigest, SchemaEvidence } from "./query-digest.js";
import type { ResultMetadata, ReviewDecision } from "./query-assurance.js";
import type { ResultEvidence } from "./result-evidence.js";

export const REVIEW_COVERAGE_SCHEMA_VERSION = "4";
export const CONVERSATION_BLIND_REVIEWER_PROMPT_VERSION = "5";

export const REVIEW_COVERAGE_FACETS = [
  "projection",
  "grain",
  "measure",
  "result_values",
  "population",
  "join_cardinality",
  "time_filter",
  "time_window",
  "ranking_partition",
  "tie_policy",
  "unit",
  "rounding",
  "entity_resolution",
  "null_handling",
] as const;

export type ReviewCoverageFacet = typeof REVIEW_COVERAGE_FACETS[number];
export type ReviewCoverageStatus = "checked" | "not_applicable" | "unsupported" | "insufficient_evidence";

/** A reviewer must point at deterministic evidence for every checked facet. */
export interface ReviewCoverageEvidence {
  readonly digestPath: string;
  /** Optional structured Answer Spec path, added as contract slots are populated. */
  readonly specPath?: string;
  /** Added by Runtime for complete full-row or numeric result evidence. */
  readonly resultPath?: string;
}

export interface ReviewCoverageClaim {
  readonly status: ReviewCoverageStatus;
  readonly evidence?: readonly ReviewCoverageEvidence[];
  readonly reason?: string;
}

/**
 * The string form remains accepted by the public type for old audit records and
 * hand-written integrations. Reviewer responses declare only status; Runtime
 * replaces any supplied evidence with canonical citations.
 */
export type ReviewCoverageValue = ReviewCoverageStatus | ReviewCoverageClaim;
export type ReviewCoverage = Partial<Record<ReviewCoverageFacet, ReviewCoverageValue>>;

export interface ReviewCoverageRequirement {
  readonly facet: ReviewCoverageFacet;
  readonly required: boolean;
  readonly digestPaths: readonly string[];
  readonly reason: string;
}

export interface SemanticDiff {
  readonly aspect: string;
  readonly required: string;
  readonly observed: string;
  /** Runtime-owned stable identity for deterministic gate claims. */
  readonly claimId?: string;
  /** Runtime derives this from evidence authority; reviewer cannot set it. */
  readonly blocking?: boolean;
  readonly evidence: {
    readonly constraintId?: string;
    readonly specPath?: string;
    /** Exact substring of the authoritative user request. */
    readonly questionQuote?: string;
    readonly semanticEvidenceId?: string;
    /** Exact substring of the referenced task document/semantic model. */
    readonly semanticEvidenceQuote?: string;
    readonly digestPath: string;
  };
}

export interface ConversationBlindReviewerInput {
  readonly question: string;
  readonly clarifications: readonly string[];
  readonly answerSpec: AnswerSpec;
  /** Runtime-selected business evidence; treated as data, never instructions. */
  readonly semanticEvidence?: readonly SemanticEvidenceExcerpt[];
  readonly schema: SchemaEvidence;
  readonly sql: string;
  readonly digest: QueryDigest;
  readonly resultMetadata: ResultMetadata;
  /** Explicit value channel; Runtime derives it from the candidate metadata. */
  readonly resultEvidence?: ResultEvidence;
  /** Deterministically derived by Runtime; never supplied by the Solver. */
  readonly coverageRequirements?: readonly ReviewCoverageRequirement[];
}

export interface ReviewCompletionOptions {
  readonly freshContext: true;
  readonly temperature: 0;
}

export interface ConversationBlindReviewModel {
  complete(input: ConversationBlindReviewerInput, options: ReviewCompletionOptions, signal: AbortSignal): Promise<unknown>;
}

export interface ConversationBlindReviewer {
  review(input: ConversationBlindReviewerInput, signal: AbortSignal): Promise<ReviewDecision>;
}

const RESPONSE_FIELDS = new Set(["status", "coverage", "warnings", "diffs", "retryable", "ambiguities", "reason"]);
const DECISION_STATUSES = new Set(["approved", "rejected", "needs_clarification", "abstained"]);
const COVERAGE_STATUSES = new Set<ReviewCoverageStatus>(["checked", "not_applicable", "unsupported", "insufficient_evidence"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function ensureString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value;
}

function claimStatus(value: ReviewCoverageValue | undefined): ReviewCoverageStatus | undefined {
  return typeof value === "string" ? value : value?.status;
}

function digestPathExists(digest: QueryDigest, path: string): boolean {
  // Digest evidence paths deliberately use a small, auditable grammar. Do not
  // accept arbitrary JSON paths supplied by an LLM.
  const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)\])?(?:\.([A-Za-z_][A-Za-z0-9_]*))?$/.exec(path);
  if (!match) return false;
  const first = match[1] as keyof QueryDigest;
  if (!(first in digest)) return false;
  const value: unknown = digest[first];
  if (match[2] !== undefined) {
    if (!Array.isArray(value) || Number(match[2]) >= value.length) return false;
    if (match[3] !== undefined) return isRecord(value[Number(match[2])]) && match[3] in value[Number(match[2])];
  }
  if (match[3] !== undefined) return isRecord(value) && match[3] in value;
  return Array.isArray(value) ? value.length > 0 : true;
}

const CANONICAL_DIGEST_PATH_BY_FIELD: Readonly<Record<string, string>> = {
  sources: "sources[0].name",
  joins: "joins[0].type",
  filters: "filters[0]",
  measures: "measures[0].function",
  groupBy: "groupBy[0]",
  projections: "projections[0].output",
  outputLineage: "outputLineage[0].output",
  windows: "windows[0].function",
  orderBy: "orderBy[0]",
  limit: "limit",
  setOperations: "setOperations[0]",
  nullHandling: "nullHandling[0]",
};

function digestField(path: string): string {
  return path.split(/[.[]/, 1)[0];
}

/** Resolve an auditable, concrete path from a Runtime-owned requirement. */
function canonicalDigestPath(digest: QueryDigest, requestedPath: string): string | undefined {
  const field = digestField(requestedPath);
  const coverageStatus = digest.coverage[field];
  if (coverageStatus === "unsupported" || coverageStatus === "insufficient_evidence" || coverageStatus === "not_applicable") return undefined;
  if (requestedPath !== field && digestPathExists(digest, requestedPath)) return requestedPath;
  const preferred = CANONICAL_DIGEST_PATH_BY_FIELD[field];
  if (preferred && digestPathExists(digest, preferred)) return preferred;

  const value = (digest as unknown as Record<string, unknown>)[field];
  if (Array.isArray(value) && value.length > 0) {
    if (!isRecord(value[0])) return `${field}[0]`;
    const firstKey = Object.keys(value[0]).sort()[0];
    if (firstKey) return `${field}[0].${firstKey}`;
  }
  if (value !== undefined && !Array.isArray(value)) return field;
  return undefined;
}

function runtimeDigestEvidence(digest: QueryDigest, requirementForFacet: ReviewCoverageRequirement):
  | { readonly status: "checked"; readonly digestPath: string }
  | { readonly status: "unsupported" | "insufficient_evidence" } {
  // Tokenizer diagnostics are useful for shadow observability but cannot be
  // cited as authoritative semantic evidence.
  if (digest.parserEngine !== "sqlglot") return { status: "unsupported" };
  // A top-level projection path cannot stand in for hidden CTE/subquery
  // semantics. Until lineage closes over every aggregation/source boundary,
  // no required semantic facet may claim deterministic Digest coverage.
  if (digest.lineageCompleteness !== "complete" || digest.unsupportedNodes.length > 0) return { status: "unsupported" };
  const statuses = requirementForFacet.digestPaths.map((path) => digest.coverage[digestField(path)]);
  for (const path of requirementForFacet.digestPaths) {
    const canonicalPath = canonicalDigestPath(digest, path);
    if (canonicalPath) return { status: "checked", digestPath: canonicalPath };
  }
  const declaredStatuses = statuses.filter((status): status is NonNullable<typeof status> => status !== undefined);
  if (declaredStatuses.length > 0 && declaredStatuses.every((status) => status === "unsupported")) return { status: "unsupported" };
  return { status: "insufficient_evidence" };
}

function requirement(
  facet: ReviewCoverageFacet,
  required: boolean,
  digestPaths: readonly string[],
  reason: string,
): ReviewCoverageRequirement {
  return { facet, required, digestPaths, reason };
}

function hasDateSemantics(digest: QueryDigest): boolean {
  return digest.filters.some((filter) => /date|time|year|month|day|strftime|julianday|\b20\d{2}\b|\b19\d{2}\b/i.test(filter));
}

function hasRankingSemantics(digest: QueryDigest): boolean {
  return digest.windows.some((window) => window.partitionBy.length > 0 || window.orderBy.length > 0)
    || (digest.limit !== undefined && digest.orderBy.length > 0);
}

function hasUnitSemantics(question: string, digest: QueryDigest, answerSpec: AnswerSpec): boolean {
  const contract = answerSpec.answerContract;
  return Boolean(contract?.unit || contract?.rounding || contract?.measures?.some((measure) => ["sum", "avg", "ratio", "difference"].includes(measure.value.kind)))
    || /percent(?:age)?|rate|ratio|share|average|mean|median|amount|price|salary|revenue|sales|currency|proportion|percentage points?/i.test(question)
    || digest.projections.some((projection) => /percent|rate|ratio|share|avg|average|mean|median|amount|price|salary|revenue|sales/i.test(projection.expression));
}

/**
 * Derive the review challenge from facts in the Digest, not from the
 * Reviewer's declaration. A facet that is structurally absent is forced to
 * `not_applicable`; a facet implied by the SQL cannot be dismissed as such.
 */
export function deriveReviewCoverageRequirements(input: Pick<ConversationBlindReviewerInput, "question" | "answerSpec" | "digest">): readonly ReviewCoverageRequirement[] {
  const { digest } = input;
  const contract = input.answerSpec.answerContract;
  const hasSources = digest.sources.length > 0;
  const hasJoins = digest.joins.length > 0;
  const hasAggregates = digest.measures.length > 0;
  const hasGrouping = digest.groupBy.length > 0 || hasAggregates || digest.windows.length > 0;
  const hasDate = hasDateSemantics(digest);
  const hasRanking = hasRankingSemantics(digest);
  const hasUnits = hasUnitSemantics(input.question, digest, input.answerSpec);
  const hasRounding = Boolean(contract?.rounding)
    || digest.projections.some((projection) => /\bROUND\s*\(/i.test(projection.expression));
  const hasEntityResolution = hasJoins || digest.sources.length > 1 || digest.outputLineage.some((lineage) => /\b(?:id|name|code)\b/i.test(lineage.output));
  const contractHasMeasures = Boolean(contract?.measures?.length);
  const grainPaths = digest.groupBy.length > 0 ? ["groupBy"] : digest.windows.length > 0 ? ["windows"] : ["measures", "projections"];
  const measurePaths = digest.measures.length > 0 ? ["measures", "outputLineage"] : ["outputLineage", "projections"];
  const timePaths = hasDate ? ["filters"] : ["windows"];
  const rankingPaths = digest.windows.length > 0 ? ["windows"] : ["orderBy", "limit"];
  const entityPaths = hasJoins ? ["joins"] : digest.sources.length > 1 ? ["sources"] : ["outputLineage"];
  const contractHasTime = Boolean(contract?.time);
  const contractHasRanking = Boolean(contract?.ranking);
  const required = new Map<ReviewCoverageFacet, ReviewCoverageRequirement>([
    ["projection", requirement("projection", digest.projections.length > 0 || Boolean(contract?.output), ["projections", "outputLineage"], "the query or Answer Contract has an output projection")],
    ["grain", requirement("grain", hasGrouping || Boolean(contract?.grain), grainPaths, "aggregation, grouping, a window, or the Answer Contract makes result grain material")],
    ["measure", requirement("measure", hasAggregates || contractHasMeasures, measurePaths, "the query or Answer Contract contains an aggregate measure")],
    ["result_values", requirement("result_values", digest.projections.length > 0 || Boolean(contract?.output), hasAggregates || contractHasMeasures ? measurePaths : ["projections", "outputLineage"], "the projected result values must be available to review")],
    ["population", requirement("population", hasSources || Boolean(contract?.denominator), ["sources", "filters", "joins", "setOperations"], "the query or Answer Contract selects a population")],
    ["join_cardinality", requirement("join_cardinality", hasJoins, ["joins"], "the query contains a JOIN")],
    ["time_filter", requirement("time_filter", hasDate || contractHasTime, timePaths, "a date or time predicate or Answer Contract window is present")],
    ["time_window", requirement("time_window", hasDate || contractHasTime || digest.windows.some((window) => Boolean(window.frame)), timePaths, "a date range, Answer Contract window, or window frame affects the result")],
    ["ranking_partition", requirement("ranking_partition", hasRanking || contractHasRanking, rankingPaths, "ordering, limiting, or ranking affects the result")],
    ["tie_policy", requirement("tie_policy", hasRanking || contractHasRanking, rankingPaths, "ranking requires an ordering/tie interpretation")],
    ["unit", requirement("unit", hasUnits, ["projections", "outputLineage", "measures"], "the request or expression has a unit-sensitive measure")],
    ["rounding", requirement("rounding", hasRounding, ["projections", "outputLineage"], "the request or expression controls rounding")],
    ["entity_resolution", requirement("entity_resolution", hasEntityResolution, entityPaths, "entity keys or relationships need resolution")],
    ["null_handling", requirement("null_handling", digest.nullHandling.length > 0, ["nullHandling", "filters", "projections"], "the query explicitly handles NULLs")],
  ]);
  return REVIEW_COVERAGE_FACETS.map((facet) => required.get(facet)!);
}

function completeResultEvidencePath(metadata: ResultMetadata, explicitEvidence?: ResultEvidence): "resultEvidence.rows" | "resultEvidence.numericRows" | undefined {
  const evidence = explicitEvidence ?? metadata.resultEvidence;
  if (!evidence || evidence.rowCount !== metadata.rowCount) return undefined;
  if (evidence.completeness === "complete" && evidence.rows !== undefined && evidence.rows.length === evidence.rowCount) return "resultEvidence.rows";
  if (evidence.numericCompleteness === "complete"
    && evidence.numericColumns.length > 0
    && evidence.numericRows.length === evidence.rowCount
    && evidence.numericRows.every((row) => row.length === evidence.numericColumns.length)) return "resultEvidence.numericRows";
  return undefined;
}

function answerSpecPathExists(answerSpec: AnswerSpec, path: string): boolean {
  if (!path.startsWith("answerContract.")) return false;
  let current: unknown = answerSpec;
  for (const segment of path.split(".")) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)\])?$/.exec(segment);
    if (!match || !isRecord(current) || !(match[1] in current)) return false;
    current = current[match[1]];
    if (match[2] !== undefined) {
      if (!Array.isArray(current) || Number(match[2]) >= current.length) return false;
      current = current[Number(match[2])];
    }
  }
  return current !== undefined;
}

function answerSpecPathBinding(answerSpec: AnswerSpec, path: string): "hard" | "hypothesis" | undefined {
  const match = /^answerContract\.(output|grain|measures(?:\[\d+\])?|denominator|ranking|time|unit|rounding|joins(?:\[\d+\])?)(?:\.|$)/.exec(path);
  if (!match) return undefined;
  const field = match[1].replace(/\[\d+\]$/, "") as keyof typeof answerSpec.answerContract;
  const value = answerSpec.answerContract?.[field];
  if (Array.isArray(value)) {
    const index = Number(/\[(\d+)\]/.exec(match[1])?.[1]);
    return value[index]?.binding;
  }
  return (value as { binding?: "hard" | "hypothesis" } | undefined)?.binding;
}

interface ReviewerCoverageDeclaration {
  readonly status?: ReviewCoverageStatus;
  readonly reason?: string;
}

/**
 * Reviewer coverage is a semantic declaration, not an evidence locator. The
 * Runtime intentionally ignores reviewer-supplied paths and validates only the
 * small status vocabulary; malformed or omitted statuses fail closed to
 * insufficient evidence instead of becoming provider/protocol failures.
 */
function reviewerCoverageDeclaration(value: unknown): ReviewerCoverageDeclaration {
  if (typeof value === "string") {
    return COVERAGE_STATUSES.has(value as ReviewCoverageStatus) ? { status: value as ReviewCoverageStatus } : {};
  }
  if (!isRecord(value)) return {};
  const status = COVERAGE_STATUSES.has(value.status as ReviewCoverageStatus) ? value.status as ReviewCoverageStatus : undefined;
  const reason = typeof value.reason === "string" && value.reason.trim() ? value.reason.trim() : undefined;
  return { ...(status ? { status } : {}), ...(reason ? { reason } : {}) };
}

function canonicalCoverageClaim(
  facet: ReviewCoverageFacet,
  declaration: ReviewerCoverageDeclaration,
  requirementForFacet: ReviewCoverageRequirement,
  input: Pick<ConversationBlindReviewerInput, "digest" | "resultMetadata" | "resultEvidence">,
): ReviewCoverageClaim {
  // Applicability belongs exclusively to the Runtime challenge. Reviewer
  // output can neither create a requirement nor dismiss one.
  if (!requirementForFacet.required) return { status: "not_applicable" };

  const digestEvidence = runtimeDigestEvidence(input.digest, requirementForFacet);
  if (digestEvidence.status !== "checked") {
    return {
      status: digestEvidence.status,
      reason: digestEvidence.status === "unsupported"
        ? `Query Digest cannot inspect required ${facet} evidence`
        : `Query Digest lacks required ${facet} evidence`,
    };
  }
  const resultPath = facet === "result_values"
    ? completeResultEvidencePath(input.resultMetadata, input.resultEvidence)
    : undefined;
  if (facet === "result_values" && !resultPath) {
    return { status: "insufficient_evidence", reason: "Complete result evidence is unavailable" };
  }

  if (declaration.status !== "checked") {
    const status = declaration.status === "unsupported" || declaration.status === "insufficient_evidence"
      ? declaration.status
      : "insufficient_evidence";
    return { status, ...(declaration.reason ? { reason: declaration.reason } : {}) };
  }

  const evidence: ReviewCoverageEvidence = {
    digestPath: digestEvidence.digestPath,
    ...(resultPath ? { resultPath } : {}),
  };
  return { status: "checked", evidence: [evidence] };
}

/**
 * Canonicalize Review Coverage at the Runtime seam. The reviewer decides only
 * whether it inspected a facet; Runtime derives applicability, Digest paths,
 * Result Evidence paths, and unsupported/insufficient capability states.
 */
export function validateReviewCoverage(value: unknown, input: Pick<ConversationBlindReviewerInput, "question" | "answerSpec" | "digest" | "resultMetadata" | "resultEvidence"> & { coverageRequirements?: readonly ReviewCoverageRequirement[] }): ReviewCoverage {
  const declarations = isRecord(value) ? value : {};
  for (const key of Object.keys(declarations)) {
    if (!REVIEW_COVERAGE_FACETS.includes(key as ReviewCoverageFacet)) throw new Error(`REVIEW_COVERAGE_UNKNOWN_FACET:${key}`);
  }
  // Never trust a caller-provided requirement list. It is an explanatory
  // challenge payload only; applicability is recomputed from the Digest here.
  const requirements = deriveReviewCoverageRequirements(input);
  const byFacet = new Map(requirements.map((item) => [item.facet, item]));
  const coverage: Partial<Record<ReviewCoverageFacet, ReviewCoverageClaim>> = {};
  for (const facet of REVIEW_COVERAGE_FACETS) {
    coverage[facet] = canonicalCoverageClaim(
      facet,
      reviewerCoverageDeclaration(declarations[facet]),
      byFacet.get(facet)!,
      input,
    );
  }
  return coverage;
}

function hasInsufficientCoverage(coverage: ReviewCoverage): boolean {
  return Object.values(coverage).some((item) => {
    const status = claimStatus(item);
    return status === "unsupported" || status === "insufficient_evidence";
  });
}

export function validateReviewDecision(value: ReviewDecision, input: ConversationBlindReviewerInput): ReviewDecision {
  const coverage = validateReviewCoverage(value.coverage, input);
  if (value.status === "approved" && hasInsufficientCoverage(coverage)) return { status: "abstained", coverage, reason: "REVIEW_COVERAGE_INSUFFICIENT" };
  if (value.status === "approved" && value.diffs !== undefined && (!Array.isArray(value.diffs) || value.diffs.length > 0)) return { status: "abstained", coverage, reason: "REVIEW_APPROVED_WITH_DIFFS" };
  if (value.status === "rejected") return validateRejectedDecision(value.diffs, value.retryable, coverage, input);
  return { ...value, coverage };
}

function validateDiffs(value: unknown, input: ConversationBlindReviewerInput): SemanticDiff[] {
  if (!Array.isArray(value)) throw new Error("REVIEW_DIFFS_INVALID");
  const hardConstraintIds = new Set(input.answerSpec.hardConstraints.map((constraint) => constraint.id));
  return value.map((item) => {
    if (!isRecord(item)) throw new Error("REVIEW_DIFF_INVALID");
    const evidence = item.evidence;
    if (!isRecord(evidence) || typeof evidence.digestPath !== "string" || !evidence.digestPath.trim()) throw new Error("REVIEW_DIFF_EVIDENCE_REQUIRED");
    const constraintId = typeof evidence.constraintId === "string" && evidence.constraintId.trim() ? evidence.constraintId : undefined;
    const specPath = typeof evidence.specPath === "string" && evidence.specPath.trim() ? evidence.specPath : undefined;
    const questionQuote = typeof evidence.questionQuote === "string" && evidence.questionQuote.trim() ? evidence.questionQuote.trim() : undefined;
    const semanticEvidenceId = typeof evidence.semanticEvidenceId === "string" && evidence.semanticEvidenceId.trim() ? evidence.semanticEvidenceId.trim() : undefined;
    const semanticEvidenceQuote = typeof evidence.semanticEvidenceQuote === "string" && evidence.semanticEvidenceQuote.trim() ? evidence.semanticEvidenceQuote.trim() : undefined;
    if (!constraintId && !specPath && !questionQuote && !semanticEvidenceId) throw new Error("REVIEW_DIFF_EVIDENCE_REQUIRED");
    if (Boolean(semanticEvidenceId) !== Boolean(semanticEvidenceQuote)) throw new Error("REVIEW_DIFF_SEMANTIC_EVIDENCE_INCOMPLETE");
    if (constraintId && !hardConstraintIds.has(constraintId)) throw new Error("REVIEW_DIFF_CONSTRAINT_UNKNOWN");
    if (specPath && !answerSpecPathExists(input.answerSpec, specPath)) throw new Error("REVIEW_DIFF_SPEC_PATH_UNKNOWN");
    if (questionQuote && !input.question.includes(questionQuote)) throw new Error("REVIEW_DIFF_QUESTION_QUOTE_UNKNOWN");
    const semanticEvidence = semanticEvidenceId ? input.semanticEvidence?.find((candidate) => candidate.id === semanticEvidenceId) : undefined;
    if (semanticEvidenceId && !semanticEvidence) throw new Error("REVIEW_DIFF_SEMANTIC_EVIDENCE_UNKNOWN");
    if (semanticEvidenceQuote && !semanticEvidence?.content.includes(semanticEvidenceQuote)) throw new Error("REVIEW_DIFF_SEMANTIC_EVIDENCE_QUOTE_UNKNOWN");
    if (!digestPathExists(input.digest, evidence.digestPath)) throw new Error("REVIEW_DIFF_DIGEST_PATH_UNKNOWN");
    const blocking = Boolean(constraintId || questionQuote || semanticEvidenceId) || (specPath ? answerSpecPathBinding(input.answerSpec, specPath) === "hard" : false);
    return {
      aspect: ensureString(item.aspect, "REVIEW_DIFF_ASPECT_INVALID"),
      required: ensureString(item.required, "REVIEW_DIFF_REQUIRED_INVALID"),
      observed: ensureString(item.observed, "REVIEW_DIFF_OBSERVED_INVALID"),
      blocking,
      evidence: { ...(constraintId ? { constraintId } : {}), ...(specPath ? { specPath } : {}), ...(questionQuote ? { questionQuote } : {}), ...(semanticEvidenceId ? { semanticEvidenceId, semanticEvidenceQuote } : {}), digestPath: evidence.digestPath },
    };
  });
}

function malformedDiffWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const message = [item.diff, item.message, item.observed].find((candidate) => typeof candidate === "string" && candidate.trim());
    return typeof message === "string" ? [message.trim().slice(0, 500)] : [];
  }).slice(0, 5);
}

function validateRejectedDecision(diffsValue: unknown, retryableValue: unknown, coverage: ReviewCoverage, input: ConversationBlindReviewerInput): ReviewDecision {
  try {
    const diffs = validateDiffs(diffsValue, input);
    return { status: "rejected", coverage, diffs, blocking: diffs.some((diff) => diff.blocking !== false), retryable: retryableValue === true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith("REVIEW_DIFF")) throw error;
    const warnings = malformedDiffWarnings(diffsValue);
    return {
      status: "abstained",
      coverage,
      reason: `REVIEW_DIFF_EVIDENCE_INSUFFICIENT:${message}`,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }
}

function validateResponse(value: unknown, input: ConversationBlindReviewerInput): ReviewDecision {
  if (!isRecord(value)) throw new Error("REVIEW_RESPONSE_INVALID");
  const response = { ...value };
  // Some providers mirror the domain term Semantic Diff as `semanticDiffs`.
  // Normalize that harmless wire alias once; conflicting dual fields remain a
  // protocol error so no semantic content is silently discarded.
  if ("semanticDiffs" in response) {
    if (response.diffs !== undefined) throw new Error("REVIEW_RESPONSE_DIFF_ALIAS_CONFLICT");
    response.diffs = response.semanticDiffs;
    delete response.semanticDiffs;
  }
  for (const key of Object.keys(response)) if (!RESPONSE_FIELDS.has(key)) throw new Error(`REVIEW_RESPONSE_UNKNOWN_FIELD:${key}`);
  if (![...DECISION_STATUSES].includes(response.status as string)) throw new Error("REVIEW_STATUS_INVALID");
  const status = response.status as ReviewDecision["status"];
  const coverage = validateReviewCoverage(response.coverage, input);
  if (status === "approved") {
    if (hasInsufficientCoverage(coverage)) return { status: "abstained", coverage, reason: "REVIEW_COVERAGE_INSUFFICIENT" };
    if (response.diffs !== undefined && (!Array.isArray(response.diffs) || response.diffs.length > 0)) {
      return { status: "abstained", coverage, reason: "REVIEW_APPROVED_WITH_DIFFS" };
    }
    return { status, coverage, ...(Array.isArray(response.warnings) ? { warnings: response.warnings.map((warning) => ensureString(warning, "REVIEW_WARNING_INVALID")) } : {}) };
  }
  if (status === "rejected") return validateRejectedDecision(response.diffs, response.retryable, coverage, input);
  if (status === "needs_clarification") {
    if (!Array.isArray(response.ambiguities)) throw new Error("REVIEW_AMBIGUITIES_INVALID");
    return { status, coverage, ambiguities: response.ambiguities.map((ambiguity) => ensureString(ambiguity, "REVIEW_AMBIGUITY_INVALID")) };
  }
  return {
    status,
    coverage,
    reason: typeof response.reason === "string" && response.reason.trim()
      ? response.reason.trim()
      : "REVIEWER_ABSTAINED_WITHOUT_REASON",
  };
}

function declaredInput(input: ConversationBlindReviewerInput): ConversationBlindReviewerInput {
  const resultEvidence = input.resultEvidence ?? input.resultMetadata.resultEvidence;
  const { resultEvidence: _metadataEvidence, ...metadataWithoutValues } = input.resultMetadata;
  return {
    question: input.question,
    clarifications: [...input.clarifications],
    answerSpec: input.answerSpec,
    ...(input.semanticEvidence?.length ? { semanticEvidence: input.semanticEvidence.map((item) => ({ ...item })) } : {}),
    schema: input.schema,
    sql: input.sql,
    digest: input.digest,
    resultMetadata: metadataWithoutValues,
    ...(resultEvidence ? { resultEvidence } : {}),
    coverageRequirements: deriveReviewCoverageRequirements(input),
  };
}

export interface ConversationBlindReviewerOptions {
  /** Maximum attempts for malformed reviewer output; capped to two. */
  readonly maxAttempts?: number;
  /** Per-attempt wall-clock bound for the reviewer provider request. */
  readonly timeoutMs?: number;
}

function reviewTimeoutError(timeoutMs: number): Error {
  const error = new Error(`REVIEW_TIMEOUT: reviewer request exceeded ${timeoutMs}ms`);
  error.name = "ReviewTimeoutError";
  return error;
}

export function createConversationBlindReviewer(model: ConversationBlindReviewModel, options: ConversationBlindReviewerOptions = {}): ConversationBlindReviewer {
  const maxAttempts = Math.min(2, Math.max(1, options.maxAttempts ?? 2));
  const timeoutMs = options.timeoutMs === undefined ? 15_000 : Math.max(1, options.timeoutMs);
  return {
    async review(input, signal) {
      const canonicalInput = declaredInput(input);
      let lastError: unknown;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeoutController = new AbortController();
        const abortOnCaller = () => timeoutController.abort();
        if (signal.aborted) timeoutController.abort();
        signal.addEventListener("abort", abortOnCaller, { once: true });
        const operation = Promise.resolve().then(() => model.complete(canonicalInput, { freshContext: true, temperature: 0 }, timeoutController.signal));
        try {
          const timedOut = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              timeoutController.abort();
              reject(reviewTimeoutError(timeoutMs));
            }, timeoutMs);
          });
          const response = await Promise.race([operation, timedOut]);
          return validateResponse(response, canonicalInput);
        } catch (error) {
          lastError = error;
          // A caller cancellation or a wall-clock timeout is not a malformed
          // response. Retrying it only multiplies latency and can keep the
          // Agent turn alive until its much larger outer timeout.
          if (signal.aborted || error instanceof Error && error.name === "ReviewTimeoutError") throw error;
          if (attempt + 1 >= maxAttempts) throw error;
        } finally {
          if (timer !== undefined) clearTimeout(timer);
          signal.removeEventListener("abort", abortOnCaller);
          // If a provider ignores AbortSignal and resolves after the timeout,
          // consume its eventual rejection so it cannot become an unhandled
          // process-level error.
          void operation.catch(() => undefined);
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    },
  };
}
