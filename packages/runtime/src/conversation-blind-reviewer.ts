import type { AnswerSpec } from "./answer-spec.js";
import type { QueryDigest, SchemaEvidence } from "./query-digest.js";
import type { ResultMetadata, ReviewDecision } from "./query-assurance.js";

export const REVIEW_COVERAGE_FACETS = [
  "projection",
  "grain",
  "measure",
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
export type ReviewCoverage = Partial<Record<ReviewCoverageFacet, ReviewCoverageStatus>>;

export interface SemanticDiff {
  readonly aspect: string;
  readonly required: string;
  readonly observed: string;
  readonly evidence: {
    readonly constraintId: string;
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

function validateCoverage(value: unknown): ReviewCoverage {
  if (value === undefined) throw new Error("REVIEW_COVERAGE_REQUIRED");
  if (!isRecord(value)) throw new Error("REVIEW_COVERAGE_INVALID");
  const coverage: Partial<Record<ReviewCoverageFacet, ReviewCoverageStatus>> = {};
  for (const [facet, status] of Object.entries(value)) {
    if (!(REVIEW_COVERAGE_FACETS as readonly string[]).includes(facet) || !COVERAGE_STATUSES.has(status as ReviewCoverageStatus)) throw new Error("REVIEW_COVERAGE_INVALID");
    coverage[facet as ReviewCoverageFacet] = status as ReviewCoverageStatus;
  }
  for (const facet of REVIEW_COVERAGE_FACETS) if (coverage[facet] === undefined) coverage[facet] = "insufficient_evidence";
  return coverage;
}

function digestPathExists(digest: QueryDigest, path: string): boolean {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)\])?(?:\.([A-Za-z_][A-Za-z0-9_]*))?$/.exec(path);
  if (!match) return false;
  const first = match[1] as keyof QueryDigest;
  if (!(first in digest)) return false;
  const value: unknown = digest[first];
  if (match[2] !== undefined) {
    if (!Array.isArray(value) || Number(match[2]) >= value.length) return false;
    if (match[3] !== undefined) return isRecord(value[Number(match[2])]) && match[3] in value[Number(match[2])];
  }
  return match[3] === undefined || (isRecord(value) && match[3] in value);
}

function validateDiffs(value: unknown, input: ConversationBlindReviewerInput): SemanticDiff[] {
  if (!Array.isArray(value)) throw new Error("REVIEW_DIFFS_INVALID");
  const hardConstraintIds = new Set(input.answerSpec.hardConstraints.map((constraint) => constraint.id));
  return value.map((item) => {
    if (!isRecord(item)) throw new Error("REVIEW_DIFF_INVALID");
    const evidence = item.evidence;
    if (!isRecord(evidence) || typeof evidence.constraintId !== "string" || !evidence.constraintId.trim() || typeof evidence.digestPath !== "string" || !evidence.digestPath.trim()) {
      throw new Error("REVIEW_DIFF_EVIDENCE_REQUIRED");
    }
    if (!hardConstraintIds.has(evidence.constraintId)) throw new Error("REVIEW_DIFF_CONSTRAINT_UNKNOWN");
    if (!digestPathExists(input.digest, evidence.digestPath)) throw new Error("REVIEW_DIFF_DIGEST_PATH_UNKNOWN");
    return {
      aspect: ensureString(item.aspect, "REVIEW_DIFF_ASPECT_INVALID"),
      required: ensureString(item.required, "REVIEW_DIFF_REQUIRED_INVALID"),
      observed: ensureString(item.observed, "REVIEW_DIFF_OBSERVED_INVALID"),
      evidence: { constraintId: evidence.constraintId, digestPath: evidence.digestPath },
    };
  });
}

function validateResponse(value: unknown, input: ConversationBlindReviewerInput): ReviewDecision {
  if (!isRecord(value)) throw new Error("REVIEW_RESPONSE_INVALID");
  for (const key of Object.keys(value)) if (!RESPONSE_FIELDS.has(key)) throw new Error(`REVIEW_RESPONSE_UNKNOWN_FIELD:${key}`);
  if (!DECISION_STATUSES.has(value.status as string)) throw new Error("REVIEW_STATUS_INVALID");
  const status = value.status as ReviewDecision["status"];
  const coverage = validateCoverage(value.coverage);
  if (status === "approved") {
    return {
      status,
      coverage,
      ...(Array.isArray(value.warnings) ? { warnings: value.warnings.map((warning) => ensureString(warning, "REVIEW_WARNING_INVALID")) } : {}),
    };
  }
  if (status === "rejected") {
    return {
      status,
      coverage,
      diffs: validateDiffs(value.diffs, input),
      retryable: value.retryable === true,
    };
  }
  if (status === "needs_clarification") {
    if (!Array.isArray(value.ambiguities)) throw new Error("REVIEW_AMBIGUITIES_INVALID");
    return {
      status,
      coverage,
      ambiguities: value.ambiguities.map((ambiguity) => ensureString(ambiguity, "REVIEW_AMBIGUITY_INVALID")),
    };
  }
  return {
    status,
    coverage,
    reason: ensureString(value.reason, "REVIEW_REASON_INVALID"),
  };
}

function declaredInput(input: ConversationBlindReviewerInput): ConversationBlindReviewerInput {
  return {
    question: input.question,
    clarifications: [...input.clarifications],
    answerSpec: input.answerSpec,
    schema: input.schema,
    sql: input.sql,
    digest: input.digest,
    resultMetadata: input.resultMetadata,
  };
}

export function createConversationBlindReviewer(model: ConversationBlindReviewModel, options: { maxAttempts?: number } = {}): ConversationBlindReviewer {
  const maxAttempts = Math.min(2, Math.max(1, options.maxAttempts ?? 2));
  return {
    async review(input, signal) {
      let lastError: unknown;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          const response = await model.complete(
            declaredInput(input),
            { freshContext: true, temperature: 0 },
            signal,
          );
          return validateResponse(response, input);
        } catch (error) {
          lastError = error;
          if (attempt + 1 >= maxAttempts) throw error;
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    },
  };
}
