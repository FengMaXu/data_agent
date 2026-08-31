import type { AnswerSpec } from "./answer-spec.js";
import type { QueryDigest, SchemaEvidence } from "./query-digest.js";
import type { ResultMetadata, ReviewDecision } from "./query-assurance.js";
import type { ResultEvidence } from "./result-evidence.js";

export const REVIEW_COVERAGE_SCHEMA_VERSION = "2";

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
  /** Required by result_values to prove the reviewer saw complete numeric data. */
  readonly resultPath?: string;
}

export interface ReviewCoverageClaim {
  readonly status: ReviewCoverageStatus;
  readonly evidence?: readonly ReviewCoverageEvidence[];
  readonly reason?: string;
}

/**
 * The string form remains accepted by the public type for old audit records and
 * hand-written integrations. Reviewer responses are normalized to claims and
 * a checked string is rejected because it has no evidence.
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
  /** Runtime derives this from evidence authority; reviewer cannot set it. */
  readonly blocking?: boolean;
  readonly evidence: {
    readonly constraintId?: string;
    readonly specPath?: string;
    readonly digestPath: string;
  };
}

export interface ConversationBlindReviewerInput {
  readonly question: string;
  readonly clarifications: readonly string[];
  readonly answerSpec: AnswerSpec;
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
const COVERAGE_FIELDS = new Set(["status", "evidence", "reason"]);
const COVERAGE_EVIDENCE_FIELDS = new Set(["digestPath", "specPath", "resultPath"]);
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

function pathMatchesBase(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}[`);
}

function digestPathSupported(digest: QueryDigest, path: string): boolean {
  const base = path.split("[")[0];
  const status = digest.coverage[base];
  return status === undefined || status === "checked" || status === "not_applicable";
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
    ["result_values", requirement("result_values", hasAggregates || contractHasMeasures, measurePaths, "the result contains numeric measure values that must be available to review")],
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

function resultPathExists(metadata: ResultMetadata, path: string, explicitEvidence?: ResultEvidence): boolean {
  const evidence = explicitEvidence ?? metadata.resultEvidence;
  if (!evidence) return false;
  if (path === "resultEvidence") return true;
  if (path === "resultEvidence.rows") return Boolean(evidence.rows && evidence.rows.length > 0);
  if (path === "resultEvidence.numericRows") return evidence.numericRows.length > 0;
  if (path === "resultEvidence.numericColumns") return evidence.numericColumns.length > 0;
  const match = /^resultEvidence\.(rows|numericRows)\[(\d+)\]$/.exec(path);
  if (!match) return false;
  const values = match[1] === "rows" ? evidence.rows : evidence.numericRows;
  return Boolean(values && Number(match[2]) < values.length);
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
  const match = /^answerContract\.(output|grain|measures(?:\[\d+\])?|denominator|ranking|time|unit|rounding)(?:\.|$)/.exec(path);
  if (!match) return undefined;
  const field = match[1].replace(/\[\d+\]$/, "") as keyof typeof answerSpec.answerContract;
  const value = answerSpec.answerContract?.[field];
  if (Array.isArray(value)) {
    const index = Number(/\[(\d+)\]/.exec(match[1])?.[1]);
    return value[index]?.binding;
  }
  return (value as { binding?: "hard" | "hypothesis" } | undefined)?.binding;
}

function normalizeClaim(value: unknown, facet: ReviewCoverageFacet, requirementForFacet: ReviewCoverageRequirement, digest: QueryDigest, metadata: ResultMetadata, answerSpec: AnswerSpec, explicitEvidence?: ResultEvidence): ReviewCoverageClaim {
  let claim: ReviewCoverageClaim;
  if (typeof value === "string") {
    if (!COVERAGE_STATUSES.has(value as ReviewCoverageStatus)) throw new Error("REVIEW_COVERAGE_INVALID");
    claim = { status: value as ReviewCoverageStatus };
  } else if (isRecord(value)) {
    for (const key of Object.keys(value)) if (!COVERAGE_FIELDS.has(key)) throw new Error(`REVIEW_COVERAGE_UNKNOWN_FIELD:${key}`);
    if (!COVERAGE_STATUSES.has(value.status as ReviewCoverageStatus)) throw new Error("REVIEW_COVERAGE_INVALID");
    let evidence: ReviewCoverageEvidence[] | undefined;
    if (value.evidence !== undefined) {
      if (!Array.isArray(value.evidence)) throw new Error("REVIEW_COVERAGE_EVIDENCE_INVALID");
      evidence = value.evidence.map((item) => {
        if (!isRecord(item) || typeof item.digestPath !== "string" || !item.digestPath.trim()) throw new Error("REVIEW_COVERAGE_EVIDENCE_INVALID");
        for (const key of Object.keys(item)) if (!COVERAGE_EVIDENCE_FIELDS.has(key)) throw new Error(`REVIEW_COVERAGE_EVIDENCE_UNKNOWN_FIELD:${key}`);
        if (item.specPath !== undefined && (typeof item.specPath !== "string" || !item.specPath.trim())) throw new Error("REVIEW_COVERAGE_EVIDENCE_INVALID");
        if (item.resultPath !== undefined && (typeof item.resultPath !== "string" || !item.resultPath.trim())) throw new Error("REVIEW_COVERAGE_EVIDENCE_INVALID");
        // A reviewer may copy a stale/speculative specPath even when the
        // Digest evidence is valid (especially with a request-only fallback
        // Answer Spec). Drop that optional citation rather than spending a
        // second provider request on a non-semantic formatting defect.
        const specPath = item.specPath !== undefined && answerSpecPathExists(answerSpec, item.specPath as string)
          ? item.specPath as string
          : undefined;
        if (!digestPathExists(digest, item.digestPath)) throw new Error("REVIEW_COVERAGE_DIGEST_PATH_UNKNOWN");
        if (!digestPathSupported(digest, item.digestPath as string)) throw new Error("REVIEW_COVERAGE_DIGEST_UNSUPPORTED");
        if (!requirementForFacet.digestPaths.some((base) => pathMatchesBase(item.digestPath as string, base))) throw new Error(`REVIEW_COVERAGE_DIGEST_PATH_WRONG_FACET:${facet}`);
        if (item.resultPath !== undefined && !resultPathExists(metadata, item.resultPath as string, explicitEvidence)) throw new Error("REVIEW_COVERAGE_RESULT_PATH_UNKNOWN");
        return { digestPath: item.digestPath as string, ...(specPath ? { specPath } : {}), ...(item.resultPath !== undefined ? { resultPath: item.resultPath as string } : {}) };
      });
    }
    claim = {
      status: value.status as ReviewCoverageStatus,
      ...(evidence ? { evidence } : {}),
      ...(value.reason !== undefined ? { reason: ensureString(value.reason, "REVIEW_COVERAGE_REASON_INVALID") } : {}),
    };
  } else {
    throw new Error("REVIEW_COVERAGE_INVALID");
  }
  if (!requirementForFacet.required && claim.status !== "not_applicable") throw new Error(`REVIEW_COVERAGE_APPLICABILITY_MISMATCH:${facet}`);
  if (requirementForFacet.required && claim.status === "not_applicable") throw new Error(`REVIEW_COVERAGE_APPLICABILITY_MISMATCH:${facet}`);
  if (claim.status === "checked" && (!claim.evidence || claim.evidence.length === 0)) throw new Error(`REVIEW_COVERAGE_EVIDENCE_REQUIRED:${facet}`);
  return claim;
}

/** Runtime-owned coverage validation. It verifies both applicability and all evidence paths. */
export function validateReviewCoverage(value: unknown, input: Pick<ConversationBlindReviewerInput, "question" | "answerSpec" | "digest" | "resultMetadata" | "resultEvidence"> & { coverageRequirements?: readonly ReviewCoverageRequirement[] }): ReviewCoverage {
  if (value === undefined || !isRecord(value)) throw new Error("REVIEW_COVERAGE_REQUIRED");
  // Never trust a caller-provided requirement list. It is an explanatory
  // challenge payload only; applicability is recomputed from the Digest here.
  const requirements = deriveReviewCoverageRequirements(input);
  const byFacet = new Map(requirements.map((item) => [item.facet, item]));
  for (const facet of Object.keys(value)) if (!byFacet.has(facet as ReviewCoverageFacet)) throw new Error(`REVIEW_COVERAGE_UNKNOWN_FACET:${facet}`);
  const coverage: Partial<Record<ReviewCoverageFacet, ReviewCoverageClaim>> = {};
  for (const facet of REVIEW_COVERAGE_FACETS) {
    if (!(facet in value)) throw new Error(`REVIEW_COVERAGE_FACET_REQUIRED:${facet}`);
    const claim = normalizeClaim(value[facet], facet, byFacet.get(facet)!, input.digest, input.resultMetadata, input.answerSpec, input.resultEvidence);
    const resultEvidence = input.resultEvidence ?? input.resultMetadata.resultEvidence;
    if (facet === "result_values" && claim.status === "checked") {
      const hasCompleteValues = claim.evidence?.some((evidence) => evidence.resultPath !== undefined
        && resultEvidence?.numericCompleteness === "complete"
        && (resultEvidence.numericColumns.length > 0 || input.resultMetadata.rowCount === 0));
      if (!hasCompleteValues) throw new Error("REVIEW_COVERAGE_RESULT_EVIDENCE_INSUFFICIENT");
    }
    coverage[facet] = claim;
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
  if (value.status === "rejected") {
    const diffs = validateDiffs(value.diffs, input);
    return { ...value, coverage, diffs, blocking: diffs.some((diff) => diff.blocking !== false) };
  }
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
    if (!constraintId && !specPath) throw new Error("REVIEW_DIFF_EVIDENCE_REQUIRED");
    if (constraintId && !hardConstraintIds.has(constraintId)) throw new Error("REVIEW_DIFF_CONSTRAINT_UNKNOWN");
    if (specPath && !answerSpecPathExists(input.answerSpec, specPath)) throw new Error("REVIEW_DIFF_SPEC_PATH_UNKNOWN");
    if (!digestPathExists(input.digest, evidence.digestPath)) throw new Error("REVIEW_DIFF_DIGEST_PATH_UNKNOWN");
    const blocking = Boolean(constraintId) || (specPath ? answerSpecPathBinding(input.answerSpec, specPath) === "hard" : false);
    return {
      aspect: ensureString(item.aspect, "REVIEW_DIFF_ASPECT_INVALID"),
      required: ensureString(item.required, "REVIEW_DIFF_REQUIRED_INVALID"),
      observed: ensureString(item.observed, "REVIEW_DIFF_OBSERVED_INVALID"),
      blocking,
      evidence: { ...(constraintId ? { constraintId } : {}), ...(specPath ? { specPath } : {}), digestPath: evidence.digestPath },
    };
  });
}

function validateResponse(value: unknown, input: ConversationBlindReviewerInput): ReviewDecision {
  if (!isRecord(value)) throw new Error("REVIEW_RESPONSE_INVALID");
  for (const key of Object.keys(value)) if (!RESPONSE_FIELDS.has(key)) throw new Error(`REVIEW_RESPONSE_UNKNOWN_FIELD:${key}`);
  if (![...DECISION_STATUSES].includes(value.status as string)) throw new Error("REVIEW_STATUS_INVALID");
  const status = value.status as ReviewDecision["status"];
  const coverage = validateReviewCoverage(value.coverage, input);
  if (status === "approved") {
    if (hasInsufficientCoverage(coverage)) return { status: "abstained", coverage, reason: "REVIEW_COVERAGE_INSUFFICIENT" };
    return { status, coverage, ...(Array.isArray(value.warnings) ? { warnings: value.warnings.map((warning) => ensureString(warning, "REVIEW_WARNING_INVALID")) } : {}) };
  }
  if (status === "rejected") {
    const diffs = validateDiffs(value.diffs, input);
    return { status, coverage, diffs, blocking: diffs.some((diff) => diff.blocking !== false), retryable: value.retryable === true };
  }
  if (status === "needs_clarification") {
    if (!Array.isArray(value.ambiguities)) throw new Error("REVIEW_AMBIGUITIES_INVALID");
    return { status, coverage, ambiguities: value.ambiguities.map((ambiguity) => ensureString(ambiguity, "REVIEW_AMBIGUITY_INVALID")) };
  }
  return { status, coverage, reason: ensureString(value.reason, "REVIEW_REASON_INVALID") };
}

function declaredInput(input: ConversationBlindReviewerInput): ConversationBlindReviewerInput {
  const resultEvidence = input.resultEvidence ?? input.resultMetadata.resultEvidence;
  const { resultEvidence: _metadataEvidence, ...metadataWithoutValues } = input.resultMetadata;
  return {
    question: input.question,
    clarifications: [...input.clarifications],
    answerSpec: input.answerSpec,
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
