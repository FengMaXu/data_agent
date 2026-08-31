import { createHash, randomUUID } from "node:crypto";
import { createSpecAuthority, type AmbiguityInput, type AnswerContractInput, type AnswerRowMode, type AnswerSpec, type AnswerSpecGenerator, type ConstraintInput, type HypothesisInput, type SpecAuthority } from "./answer-spec.js";
import { createQueryDigestCompiler, type QueryDigest, type QueryDigestCompiler, type SchemaEvidence, type SqlDialect } from "./query-digest.js";
import { deriveReviewCoverageRequirements, validateReviewDecision, REVIEW_COVERAGE_SCHEMA_VERSION, type ConversationBlindReviewer, type ConversationBlindReviewerInput, type ReviewCoverage, type SemanticDiff } from "./conversation-blind-reviewer.js";
import type { ExportCandidate } from "./export-candidate.js";
import { PublicationRegistry, type PublicationAuthorization, type PublicationReceipt, type ReviewToken } from "./publication.js";
import { ReviewCache, type ReviewCacheIdentity } from "./review-cache.js";
import { type AssuranceMetrics, type ReviewModeController } from "./review-policy.js";
import { InMemoryAssuranceAuditStore, type AssuranceAuditRecord, type AssuranceAuditStore, type SpecGenerationFailure } from "./assurance-audit.js";
import { InvariantProbeRegistry, type ProbeOutcome } from "./invariant-probe.js";
import { buildResultEvidence, type ResultEvidence } from "./result-evidence.js";

/** Runtime modes are explicit so Review Off cannot be confused with Shadow Review. */
export type QueryAssuranceMode = "off" | "shadow" | "enforce";

/**
 * Evidence available while preparing a free-SQL Query Task.
 *
 * The open record keeps this first seam extensible; later slices add the
 * concrete reviewed-model, task-document, clarification and schema evidence
 * types without making AgentAssembly know about those collaborators.
 */
export interface TaskEvidence {
  readonly question: string;
  readonly clarifications?: readonly string[];
  readonly constraints?: readonly ConstraintInput[];
  readonly hypotheses?: readonly HypothesisInput[];
  readonly ambiguities?: readonly AmbiguityInput[];
  readonly outputColumns?: readonly string[];
  readonly rowMode?: AnswerRowMode;
  readonly rowCount?: number;
  /** Structured output/grain/measure/denominator contract from authoritative evidence. */
  readonly answerContract?: AnswerContractInput;
  readonly dialect?: SqlDialect;
  readonly schema?: SchemaEvidence;
  readonly [key: string]: unknown;
}

/** The task identity returned by Query Assurance before a query is executed. */
export interface PreparedQueryTask {
  readonly taskId: string;
  readonly mode: QueryAssuranceMode;
  readonly specVersion?: string;
  readonly specStatus?: "available" | "unavailable";
  /** Indicates that the basic request-only Spec was used after planner failure. */
  readonly specGenerationStatus?: "generated" | "fallback";
  /** Read-only planner output supplied to Solver; Solver cannot mutate authority. */
  readonly answerSpec?: AnswerSpec;
}

export interface QueryPreviewResult {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
  readonly truncated: boolean;
  readonly columnTypes?: readonly string[];
}

export interface ResultMetadata {
  readonly columns: readonly string[];
  readonly columnTypes: readonly string[];
  readonly rowCount: number;
  readonly truncated: boolean;
  readonly nullCounts: Readonly<Record<string, number>>;
  readonly minMax?: Readonly<Record<string, { readonly min?: unknown; readonly max?: unknown }>>;
  readonly distinctCounts?: Readonly<Record<string, number>>;
  /** Bounded value evidence for blind semantic review; never written to audit. */
  readonly resultEvidence?: ResultEvidence;
}

export interface QueryPreviewRegistration {
  readonly task: PreparedQueryTask;
  readonly sql: string;
  readonly result: QueryPreviewResult;
  readonly purpose?: "reconciliation" | "verification";
  readonly dialect?: SqlDialect;
  readonly schema?: SchemaEvidence;
}

export interface ValidatedQueryArtifact {
  readonly taskId: string;
  readonly queryArtifactId: string;
  readonly normalizedSql: string;
  readonly normalizedSqlHash: string;
  readonly previewMetadata: ResultMetadata;
  readonly queryDigest?: QueryDigest;
  readonly schemaEvidence?: SchemaEvidence;
  readonly specVersion?: string;
  readonly specStatus?: "available" | "unavailable";
  readonly preflightOutcomes?: readonly ProbeOutcome[];
  readonly internalEvidence: true;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly purpose?: "reconciliation" | "verification";
}

/** Opaque publication input; candidate details belong to later assurance slices. */
export interface PublicationReviewRequest {
  readonly task: PreparedQueryTask;
  readonly candidate: unknown;
  /** Reviewer input is carried opaquely until the Candidate slice is wired. */
  readonly reviewInput?: ConversationBlindReviewerInput;
}

export type ReviewDecisionStatus = "approved" | "rejected" | "needs_clarification" | "abstained";

/** The available decision envelope, intentionally without reviewer internals. */
export interface ReviewDecision {
  readonly status: ReviewDecisionStatus;
  readonly coverage?: ReviewCoverage;
  readonly warnings?: readonly string[];
  readonly diffs?: readonly SemanticDiff[];
  readonly retryable?: boolean;
  readonly ambiguities?: readonly string[];
  readonly reason?: string;
  readonly blocking?: boolean;
}

export interface ReviewFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

/** Separates a successful reviewer decision from a reviewer that could not run. */
export type ReviewOutcome =
  | { readonly availability: "available"; readonly decision: ReviewDecision; readonly reviewToken?: ReviewToken; readonly cacheHit?: boolean }
  | { readonly availability: "unavailable"; readonly failure: ReviewFailure; readonly reviewToken?: ReviewToken; readonly cacheHit?: boolean };

export interface QueryAssurance {
  readonly mode: QueryAssuranceMode;
  prepareTask(input: TaskEvidence, signal: AbortSignal): Promise<PreparedQueryTask>;
  recordPreview?(input: QueryPreviewRegistration, signal: AbortSignal): Promise<ValidatedQueryArtifact>;
  getArtifact?(taskId: string, queryArtifactId: string, signal: AbortSignal): Promise<ValidatedQueryArtifact | undefined>;
  getAnswerSpec?(taskId: string, specVersion?: string): AnswerSpec | undefined;
  applyClarification?(taskId: string, baseSpecVersion: string, clarification: string): AnswerSpec;
  submitSpecChange?(proposal: Parameters<SpecAuthority["submitProposal"]>[0]): ReturnType<SpecAuthority["submitProposal"]>;
  reviewForPublication(input: PublicationReviewRequest, signal: AbortSignal): Promise<ReviewOutcome>;
  publishCandidate?(input: { reviewToken: ReviewToken; candidate: ExportCandidate; targetPath: string; authorization?: PublicationAuthorization; promote?: () => Promise<void> }, signal: AbortSignal): Promise<PublicationReceipt>;
  hasInternalEvidence?(taskId: string): boolean;
  hasPublication?(taskId: string): boolean;
  publicationForArtifact?(taskId: string, queryArtifactId: string): PublicationReceipt | undefined;
  publicationForTask?(taskId: string): PublicationReceipt | undefined;
  claimAutomaticRepair?(taskId: string, specVersion: string): { readonly allowed: boolean; readonly attempt: number };
}

export class QueryAssuranceAbortError extends Error {
  readonly code = "QUERY_ASSURANCE_ABORTED";

  constructor() {
    super("Query Assurance operation was aborted");
    this.name = "AbortError";
  }
}

export interface QueryAssuranceOptions {
  artifactTtlMs?: number;
  now?: () => number;
  specAuthority?: SpecAuthority;
  digestCompiler?: QueryDigestCompiler;
  mode?: QueryAssuranceMode;
  reviewer?: ConversationBlindReviewer;
  publicationRegistry?: PublicationRegistry;
  allowUnavailablePublication?: boolean;
  /** Shadow records reviewer decisions; record_only additionally fails closed. */
  shadowDelivery?: "publish_with_disagreement" | "record_only";
  reviewCache?: ReviewCache;
  reviewerModel?: string;
  reviewerPromptVersion?: string;
  reviewPolicyVersion?: string;
  reviewCoverageSchemaVersion?: string;
  modeController?: ReviewModeController;
  auditStore?: AssuranceAuditStore;
  specGenerator?: AnswerSpecGenerator;
  invariantProbes?: InvariantProbeRegistry;
}

export function normalizeQuerySql(sql: string): string {
  return sql.trim().replace(/;\s*$/, "").replace(/\s+/g, " ");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new QueryAssuranceAbortError();
}

function specGenerationFailure(error: unknown): SpecGenerationFailure {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
  const rawMessage = error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  const explicitCode = typeof record?.code === "string" && record.code.trim() ? record.code.trim() : undefined;
  const messageCode = /^([A-Z][A-Z0-9_]*(?::|$))/.exec(rawMessage)?.[1]?.replace(/:$/, "");
  const code = explicitCode ?? messageCode ?? (error instanceof Error && error.name ? error.name : "SPEC_GENERATOR_FAILED");
  return { code, message: rawMessage.slice(0, 2_000) };
}

function inferColumnType(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isInteger(value) ? "INTEGER" : "REAL";
  if (typeof value === "boolean") return "BOOLEAN";
  if (typeof value === "bigint") return "BIGINT";
  if (value instanceof Date) return "DATETIME";
  if (typeof value === "object") return "JSON";
  return "TEXT";
}

function resultMetadata(result: QueryPreviewResult): ResultMetadata {
  const columns = [...result.columns];
  const firstRow = result.rows[0] ?? [];
  const columnTypes = columns.map((_, index) => result.columnTypes?.[index] ?? inferColumnType(firstRow[index]));
  const nullCounts: Record<string, number> = Object.fromEntries(columns.map((column) => [column, 0]));
  const distinct: Array<Set<string>> = columns.map(() => new Set());
  const minMax: Record<string, { min?: unknown; max?: unknown }> = {};
  for (const row of result.rows) {
    for (let index = 0; index < columns.length; index += 1) {
      const value = row[index];
      if (value === null || value === undefined) nullCounts[columns[index]] += 1;
      else {
        distinct[index].add(JSON.stringify(value));
        const current = minMax[columns[index]];
        if (!current) minMax[columns[index]] = { min: value, max: value };
        else {
          if (current.min === undefined || String(value) < String(current.min)) current.min = value;
          if (current.max === undefined || String(value) > String(current.max)) current.max = value;
        }
      }
    }
  }
  return {
    columns,
    columnTypes,
    rowCount: result.rows.length,
    truncated: result.truncated,
    nullCounts,
    ...(columns.length ? { minMax, distinctCounts: Object.fromEntries(columns.map((column, index) => [column, distinct[index].size])) } : {}),
    resultEvidence: buildResultEvidence(columns, result.rows, result.truncated),
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

function normalizedExpression(value: string): string {
  return value.toLowerCase().replace(/[\[\]`"']/g, "").replace(/\s+/g, " ").trim();
}

function contractDiff(
  spec: AnswerSpec,
  digest: QueryDigest,
  metadata: ResultMetadata,
): SemanticDiff[] {
  const diffs: SemanticDiff[] = [];
  const contract = spec.answerContract;
  if (!contract) return diffs;
  const outputField = contract.output;
  const grainField = contract.grain;
  const rankingField = contract.ranking;
  const output = outputField?.binding === "hard" ? outputField.value : undefined;
  const grain = grainField?.binding === "hard" ? grainField.value : undefined;
  const measures = contract.measures?.filter((measure) => measure.binding === "hard").map((measure) => measure.value) ?? [];
  const ranking = rankingField?.binding === "hard" ? rankingField.value : undefined;
  const digestPath = digest.projections.length > 0 ? "projections" : "outputLineage";
  const outputColumns = output?.columns ?? [];
  const grainColumns = grain?.keyColumns ?? [];
  if (outputColumns.length > 0 && digestCoverageSupports(digest, ["projections", "outputLineage"])) {
    const observed = digest.projections.map((projection) => projection.output);
    if (!sameStringArray(outputColumns, observed) || !sameStringArray(outputColumns, metadata.columns)) {
      diffs.push({ aspect: "projection", required: outputColumns.join(", "), observed: observed.join(", ") || metadata.columns.join(", "), blocking: true, evidence: { specPath: "answerContract.output.value.columns", digestPath } });
    }
  }
  if (output?.rowCount !== undefined && metadata.rowCount !== output.rowCount) {
    diffs.push({ aspect: "row_count", required: String(output.rowCount), observed: String(metadata.rowCount), blocking: true, evidence: { specPath: "answerContract.output.value.rowCount", digestPath } });
  }
  if (output?.rowMode === "scalar" && metadata.rowCount !== 1) {
    diffs.push({ aspect: "row_mode", required: "exactly one scalar row", observed: `${metadata.rowCount} rows`, blocking: true, evidence: { specPath: "answerContract.output.value.rowMode", digestPath } });
  }
  if (grainColumns.length > 0 && digestCoverageSupports(digest, ["groupBy", "windows", "projections"])) {
    const observedGroupBy = digest.groupBy.map(normalizedExpression);
    const missing = grainColumns.filter((column) => !observedGroupBy.includes(normalizedExpression(column)));
    if (missing.length > 0) diffs.push({ aspect: "grain", required: `grouped by ${grainColumns.join(", ")}`, observed: digest.groupBy.join(", ") || "no GROUP BY", blocking: true, evidence: { specPath: "answerContract.grain.value.keyColumns", digestPath: digest.groupBy.length > 0 ? "groupBy" : "projections" } });
  }
  for (const measure of measures) {
    if (measure.kind === "unknown") continue;
    const expectedFunction = measure.kind === "count" || measure.kind === "count_distinct" ? "COUNT" : measure.kind.toUpperCase();
    const matched = digest.measures.some((candidate) => candidate.function === expectedFunction
      && (measure.kind !== "count_distinct" || /DISTINCT/i.test(candidate.expression))
      && (measure.kind !== "count" || !/DISTINCT/i.test(candidate.expression)));
    if (!matched && digestCoverageSupports(digest, ["measures", "outputLineage"])) diffs.push({ aspect: "measure", required: measure.kind, observed: digest.measures.map((candidate) => candidate.function).join(", ") || "no aggregate", blocking: true, evidence: { specPath: "answerContract.measures", digestPath: digest.measures.length > 0 ? "measures" : "projections" } });
  }
  if (ranking) {
    const expectedPartition = ranking.partitionBy.map(normalizedExpression);
    const matched = digest.windows.some((window) => sameStringArray(expectedPartition, window.partitionBy.map(normalizedExpression)))
      || (expectedPartition.length === 0 && digest.limit !== undefined && digest.orderBy.length > 0);
    if (!matched && digestCoverageSupports(digest, ["windows", "orderBy", "limit"])) diffs.push({ aspect: "ranking_partition", required: expectedPartition.length ? expectedPartition.join(", ") : "global", observed: digest.windows.map((window) => window.partitionBy.join(", ")).join("; ") || "global/non-window", blocking: true, evidence: { specPath: "answerContract.ranking.value.partitionBy", digestPath: digest.windows.length > 0 ? "windows" : "orderBy" } });
  }
  return diffs;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => normalizedExpression(value) === normalizedExpression(right[index]));
}

function digestCoverageSupports(digest: QueryDigest, paths: readonly string[]): boolean {
  return paths.some((path) => {
    const status = digest.coverage[path];
    return status === undefined || status === "checked" || status === "not_applicable";
  });
}

/**
 * In-memory Query Assurance used for the pre-wired seam and local hosts.
 * Review Off preserves the existing delivery behavior while making the lack
 * of a Review Decision explicit. Later slices can replace this coordinator
 * without changing AgentAssembly's dependency shape.
 */
export class InMemoryQueryAssurance implements QueryAssurance {
  private readonly configuredMode: QueryAssuranceMode;
  private readonly modeController?: ReviewModeController;
  private readonly artifactTtlMs: number;
  private readonly now: () => number;
  private readonly artifacts = new Map<string, Map<string, ValidatedQueryArtifact>>();
  private readonly taskEvidence = new Map<string, TaskEvidence>();
  private readonly repairAttempts = new Map<string, number>();
  private readonly specAuthority: SpecAuthority;
  private readonly digestCompiler: QueryDigestCompiler;
  private readonly reviewer?: ConversationBlindReviewer;
  private readonly publicationRegistry: PublicationRegistry;
  private readonly reviewCache: ReviewCache;
  private readonly reviewerModel: string;
  private readonly reviewerPromptVersion: string;
  private readonly reviewPolicyVersion: string;
  private readonly reviewCoverageSchemaVersion: string;
  private readonly auditStore: AssuranceAuditStore;
  private readonly specGenerator?: AnswerSpecGenerator;
  private readonly invariantProbes?: InvariantProbeRegistry;

  constructor(options: QueryAssuranceOptions = {}) {
    this.modeController = options.modeController;
    this.configuredMode = options.mode ?? this.modeController?.mode() ?? "off";
    this.artifactTtlMs = options.artifactTtlMs ?? 5 * 60 * 1000;
    this.now = options.now ?? Date.now;
    this.specAuthority = options.specAuthority ?? createSpecAuthority();
    this.digestCompiler = options.digestCompiler ?? createQueryDigestCompiler();
    this.reviewer = options.reviewer;
    this.publicationRegistry = options.publicationRegistry ?? new PublicationRegistry({
      mode: this.configuredMode,
      modeFor: () => this.mode,
      allowUnavailablePublication: options.allowUnavailablePublication,
      shadowDelivery: options.shadowDelivery,
      specVersionFor: (taskId) => this.specAuthority.get(taskId)?.specVersion,
    });
    this.reviewCache = options.reviewCache ?? new ReviewCache();
    this.reviewerModel = options.reviewerModel ?? "unknown";
    this.reviewerPromptVersion = options.reviewerPromptVersion ?? "2";
    this.reviewPolicyVersion = options.reviewPolicyVersion ?? "2";
    this.reviewCoverageSchemaVersion = options.reviewCoverageSchemaVersion ?? REVIEW_COVERAGE_SCHEMA_VERSION;
    this.auditStore = options.auditStore ?? new InMemoryAssuranceAuditStore({ now: this.now });
    this.specGenerator = options.specGenerator;
    this.invariantProbes = options.invariantProbes;
  }

  get mode(): QueryAssuranceMode { return this.modeController?.mode() ?? this.configuredMode; }

  observeMetrics(metrics: AssuranceMetrics): void { this.modeController?.circuitBreaker().observe(metrics); }
  auditRecords(taskId?: string): readonly AssuranceAuditRecord[] { return this.auditStore.list(taskId); }

  async prepareTask(input: TaskEvidence, signal: AbortSignal): Promise<PreparedQueryTask> {
    throwIfAborted(signal);
    const taskId = randomUUID();
    this.taskEvidence.set(taskId, input);
    const specInput = {
      taskId,
      question: input.question,
      clarifications: input.clarifications,
      constraints: input.constraints,
      hypotheses: input.hypotheses,
      ambiguities: input.ambiguities,
      outputColumns: input.outputColumns,
      rowMode: input.rowMode,
      rowCount: input.rowCount,
      answerContract: input.answerContract,
      schema: input.schema,
    };
    if (!this.specGenerator) {
      const prepared = this.specAuthority.prepare(specInput);
      return { taskId, mode: this.mode, specVersion: prepared.specVersion, specStatus: "available", answerSpec: prepared };
    }

    try {
      const generated = await this.specGenerator.generate(specInput, signal);
      const prepared = this.specAuthority.prepare({ ...generated, taskId, question: input.question });
      return { taskId, mode: this.mode, specVersion: prepared.specVersion, specStatus: "available", specGenerationStatus: "generated", answerSpec: prepared };
    } catch (error) {
      // A planner is an enrichment step, not an authority boundary. Preserve
      // cancellation, but never make a valid database task unpublishable just
      // because the optional planner failed or returned an unsupported shape.
      throwIfAborted(signal);
      const failure = specGenerationFailure(error);
      try {
        const fallback = this.specAuthority.prepare(specInput);
        this.auditStore.append({
          taskId,
          reviewAvailability: this.mode === "off" ? "off" : "unavailable",
          specStatus: "available",
          specGenerationStatus: "fallback",
          specGenerationFailure: failure,
          repairAttempt: 0,
          reviewMode: this.mode,
        });
        return { taskId, mode: this.mode, specVersion: fallback.specVersion, specStatus: "available", specGenerationStatus: "fallback", answerSpec: fallback };
      } catch (fallbackError) {
        // This should only be reachable for invalid task evidence (for
        // example, an empty question). Keep the original planner failure and
        // the fallback failure visible instead of losing both in "unavailable".
        const fallbackFailure = specGenerationFailure(fallbackError);
        this.auditStore.append({
          taskId,
          reviewAvailability: "unavailable",
          specStatus: "unavailable",
          specGenerationFailure: { code: `${failure.code};${fallbackFailure.code}`, message: `${failure.message}; fallback: ${fallbackFailure.message}`.slice(0, 2_000) },
          repairAttempt: 0,
          reviewMode: this.mode,
        });
        return { taskId, mode: this.mode, specStatus: "unavailable" };
      }
    }
  }

  getAnswerSpec(taskId: string, specVersion?: string): AnswerSpec | undefined {
    return this.specAuthority.get(taskId, specVersion);
  }

  getTaskEvidence(taskId: string): TaskEvidence | undefined { return this.taskEvidence.get(taskId); }
  hasInternalEvidence(taskId: string): boolean { return (this.artifacts.get(taskId)?.size ?? 0) > 0; }
  hasPublication(taskId: string): boolean { return this.publicationRegistry.hasReceipt(taskId); }
  publicationForArtifact(taskId: string, queryArtifactId: string): PublicationReceipt | undefined { return this.publicationRegistry.receiptForArtifact(taskId, queryArtifactId); }
  publicationForTask(taskId: string): PublicationReceipt | undefined { return this.publicationRegistry.receiptForTask(taskId); }
  claimAutomaticRepair(taskId: string, specVersion: string): { readonly allowed: boolean; readonly attempt: number } {
    const key = `${taskId}:${specVersion}`;
    const attempt = this.repairAttempts.get(key) ?? 0;
    if (attempt >= 1) return { allowed: false, attempt };
    const next = attempt + 1;
    this.repairAttempts.set(key, next);
    return { allowed: true, attempt: next };
  }

  applyClarification(taskId: string, baseSpecVersion: string, clarification: string): AnswerSpec {
    return this.specAuthority.applyClarification(taskId, baseSpecVersion, clarification);
  }

  submitSpecChange(proposal: Parameters<SpecAuthority["submitProposal"]>[0]): ReturnType<SpecAuthority["submitProposal"]> {
    return this.specAuthority.submitProposal(proposal);
  }

  async recordPreview(input: QueryPreviewRegistration, signal: AbortSignal): Promise<ValidatedQueryArtifact> {
    throwIfAborted(signal);
    const normalizedSql = normalizeQuerySql(input.sql);
    const createdAtMs = this.now();
    const taskContext = this.taskEvidence.get(input.task.taskId);
    const dialect = input.dialect ?? taskContext?.dialect;
    const schema = input.schema ?? taskContext?.schema;
    let digest: QueryDigest | undefined;
    if (dialect) {
      try {
        digest = this.digestCompiler.compile({ sql: normalizedSql, dialect, schema });
      } catch (error) {
        const fallback = createQueryDigestCompiler().compile({ sql: normalizedSql, dialect, schema });
        const fallbackCoverage = Object.fromEntries(Object.keys(fallback.coverage).map((key) => [key, "unsupported" as const]));
        digest = {
          ...fallback,
          parserVersion: `fallback-after-${error instanceof Error ? error.name : "parser-error"}`,
          parserEngine: "deterministic-tokenizer",
          coverage: fallbackCoverage,
          unsupportedNodes: [...new Set([...fallback.unsupportedNodes, "strict_parser_error"])],
          lineageCompleteness: "unsupported",
        };
      }
    }
    let artifact: ValidatedQueryArtifact = {
      taskId: input.task.taskId,
      queryArtifactId: randomUUID(),
      normalizedSql,
      normalizedSqlHash: digest?.normalizedSqlHash ?? hash(normalizedSql),
      previewMetadata: resultMetadata(input.result),
      ...(digest ? { queryDigest: digest } : {}),
      ...(schema ? { schemaEvidence: schema } : {}),
      ...(input.task.specVersion ? { specVersion: input.task.specVersion } : {}),
      ...(input.task.specStatus ? { specStatus: input.task.specStatus } : {}),
      internalEvidence: true,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + this.artifactTtlMs).toISOString(),
      ...(input.purpose ? { purpose: input.purpose } : {}),
    };
    const spec = this.getAnswerSpec(input.task.taskId, input.task.specVersion);
    if (this.invariantProbes && spec) {
      const preflightOutcomes = this.invariantProbes.ids().map((id) => this.invariantProbes!.evaluate(id, { answerSpec: spec, digest: artifact.queryDigest, schema: artifact.schemaEvidence, resultMetadata: artifact.previewMetadata }));
      artifact = { ...artifact, preflightOutcomes };
    }
    let taskArtifacts = this.artifacts.get(input.task.taskId);
    if (!taskArtifacts) {
      taskArtifacts = new Map();
      this.artifacts.set(input.task.taskId, taskArtifacts);
    }
    taskArtifacts.set(artifact.queryArtifactId, artifact);
    this.auditStore?.append({
      taskId: artifact.taskId,
      queryArtifactId: artifact.queryArtifactId,
      sqlHash: artifact.normalizedSqlHash,
      ...(artifact.specVersion ? { specVersion: artifact.specVersion } : {}),
      ...(artifact.queryDigest ? { queryDigestVersion: artifact.queryDigest.queryDigestVersion } : {}),
      reviewAvailability: this.mode === "off" ? "off" : "unavailable",
      repairAttempt: 0,
      reviewMode: this.mode,
    });
    return artifact;
  }

  async getArtifact(taskId: string, queryArtifactId: string, signal: AbortSignal): Promise<ValidatedQueryArtifact | undefined> {
    throwIfAborted(signal);
    const artifact = this.artifacts.get(taskId)?.get(queryArtifactId);
    if (!artifact) return undefined;
    if (Date.parse(artifact.expiresAt) <= this.now()) {
      this.artifacts.get(taskId)?.delete(queryArtifactId);
      return undefined;
    }
    return artifact;
  }

  async reviewForPublication(input: PublicationReviewRequest, signal: AbortSignal): Promise<ReviewOutcome> {
    throwIfAborted(signal);
    const startedAt = this.now();
    const candidate = input.candidate as Partial<ExportCandidate> & { normalizedSqlHash?: string; specVersion?: string; schemaEvidenceFingerprint?: string };
    const candidateArtifact = typeof candidate?.queryArtifactId === "string"
      ? await this.getArtifact(input.task.taskId, candidate.queryArtifactId, signal)
      : undefined;
    const hasCandidateBinding = Boolean(candidate && typeof candidate.candidateId === "string");
    const expectedSchemaFingerprint = candidateArtifact?.queryDigest?.schemaEvidenceFingerprint ?? "unknown";
    const expectedSpecVersion = candidateArtifact?.specVersion ?? input.task.specVersion ?? "1";
    const storedSpec = this.getAnswerSpec(input.task.taskId, expectedSpecVersion);
    const candidateMetadata = candidate?.metadata;
    const suppliedReviewInput = input.reviewInput;
    // Coverage is a runtime challenge, not a field the Solver or Reviewer can
    // choose. Recompute it from the canonical stored Digest before invoking a
    // reviewer, so a forged/ stale coverageRequirements field is ignored.
    const reviewInput = suppliedReviewInput && suppliedReviewInput.digest
      ? {
        ...suppliedReviewInput,
        coverageRequirements: deriveReviewCoverageRequirements(suppliedReviewInput),
      }
      : suppliedReviewInput;
    const reviewInputBindingValid = !hasCandidateBinding || this.mode === "off" || (
      candidateArtifact !== undefined
      && reviewInput !== undefined
      && normalizeQuerySql(reviewInput.sql) === candidateArtifact.normalizedSql
      && reviewInput.digest.normalizedSqlHash === candidateArtifact.normalizedSqlHash
      && reviewInput.digest.schemaEvidenceFingerprint === expectedSchemaFingerprint
      && reviewInput.answerSpec.taskId === input.task.taskId
      && reviewInput.answerSpec.specVersion === expectedSpecVersion
      && storedSpec !== undefined
      && stable(reviewInput.answerSpec) === stable(storedSpec)
      && (!candidateArtifact.schemaEvidence || stable(reviewInput.schema) === stable(candidateArtifact.schemaEvidence))
      && reviewInput.resultMetadata.columns.length === candidateArtifact.previewMetadata.columns.length
      && reviewInput.resultMetadata.columns.every((column, index) => column === candidateArtifact.previewMetadata.columns[index])
      && (!candidateMetadata?.resultEvidence || reviewInput.resultMetadata.resultEvidence?.evidenceHash === candidateMetadata.resultEvidence.evidenceHash)
      && (!candidateMetadata?.resultEvidence || reviewInput.resultEvidence?.evidenceHash === candidateMetadata.resultEvidence.evidenceHash)
    );
    const candidateBindingValid = !hasCandidateBinding || (
      candidateArtifact !== undefined
      && candidate.taskId === input.task.taskId
      && candidate.queryArtifactId === candidateArtifact.queryArtifactId
      && candidateArtifact.specVersion === (input.task.specVersion ?? candidateArtifact.specVersion)
      && candidate.normalizedSqlHash === candidateArtifact.normalizedSqlHash
      && candidate.specVersion === expectedSpecVersion
      && candidate.schemaEvidenceFingerprint === expectedSchemaFingerprint
      && typeof candidate.path === "string"
      && typeof candidate.contentSha256 === "string"
      && candidateMetadata !== undefined
      && candidateMetadata.columns.length === candidateArtifact.previewMetadata.columns.length
      && candidateMetadata.columns.every((column, index) => column === candidateArtifact.previewMetadata.columns[index])
      && reviewInputBindingValid
    );
    const blockingPreflight = candidateArtifact?.preflightOutcomes?.find((probe) => probe.status === "failed" && probe.blocking);
    const deterministicContractDiffs = candidateArtifact?.queryDigest && storedSpec && candidateMetadata
      ? contractDiff(storedSpec, candidateArtifact.queryDigest, candidateMetadata)
      : [];
    let outcome: ReviewOutcome;
    if (hasCandidateBinding && !candidateBindingValid) {
      outcome = { availability: "unavailable", failure: { code: "REVIEW_CANDIDATE_BINDING_INVALID", message: "Candidate identity does not match the Validated Query Artifact", retryable: false } };
    } else if (this.mode === "off") {
      outcome = {
        availability: "unavailable",
        failure: { code: "REVIEW_OFF", message: "Query Assurance review is disabled", retryable: false },
      };
    } else if (blockingPreflight) {
      outcome = {
        availability: "available",
        decision: { status: "rejected", blocking: true, reason: "A deterministic Hard Constraint or Structural Fact probe failed" },
      };
    } else if (deterministicContractDiffs.length > 0) {
      outcome = {
        availability: "available",
        decision: { status: "rejected", blocking: true, diffs: deterministicContractDiffs, retryable: true, reason: "A hard Answer Contract facet does not match the Query Digest or result shape" },
      };
    } else if (!this.reviewer) {
      outcome = {
        availability: "unavailable",
        failure: { code: "REVIEWER_NOT_CONFIGURED", message: "Conversation-Blind Reviewer is not configured", retryable: false },
      };
    } else if (!input.reviewInput || !input.reviewInput.digest || !input.reviewInput.answerSpec || !input.reviewInput.resultMetadata) {
      outcome = {
        availability: "unavailable",
        failure: { code: "REVIEW_INPUT_INCOMPLETE", message: "Publication review input is incomplete", retryable: false },
      };
    } else {
      const review = async (): Promise<ReviewOutcome> => {
        try {
          const decision = await this.reviewer!.review(reviewInput!, signal);
          // Defense in depth: custom reviewer adapters may bypass the standard
          // response parser. Never let such an adapter self-assert coverage.
          return { availability: "available", decision: validateReviewDecision(decision, reviewInput!) };
        } catch (error) {
          if (error instanceof QueryAssuranceAbortError) throw error;
          const message = error instanceof Error ? error.message : String(error);
          const timedOut = error instanceof Error && error.name === "ReviewTimeoutError";
          return {
            availability: "unavailable",
            failure: { code: timedOut ? "REVIEW_TIMEOUT" : "REVIEWER_FAILED", message, retryable: !timedOut },
          };
        }
      };
      const digest = reviewInput!.digest;
      const identity: ReviewCacheIdentity = {
        taskId: input.task.taskId,
        taskQuestionHash: hash(reviewInput!.question),
        specVersion: reviewInput!.answerSpec.specVersion,
        schemaEvidenceFingerprint: digest.schemaEvidenceFingerprint,
        normalizedSqlHash: digest.normalizedSqlHash,
        queryDigestVersion: digest.queryDigestVersion,
        reviewerModel: this.reviewerModel,
        reviewerPromptVersion: this.reviewerPromptVersion,
        reviewPolicyVersion: this.reviewPolicyVersion,
        reviewCoverageSchemaVersion: this.reviewCoverageSchemaVersion,
        parserVersion: digest.parserVersion,
        resultEvidenceHash: reviewInput!.resultMetadata.resultEvidence?.evidenceHash ?? hash(stable(reviewInput!.resultMetadata)),
      };
      const cached = await this.reviewCache.getOrCreate(identity, review, signal);
      outcome = { ...cached.outcome, cacheHit: cached.cacheHit };
    }
    if (!candidateBindingValid) {
      this.recordReviewAudit(input, outcome, candidate, startedAt);
      return outcome;
    }
    if (candidate && typeof candidate.candidateId === "string" && typeof candidate.taskId === "string" && typeof candidate.queryArtifactId === "string" && typeof candidate.normalizedSqlHash === "string" && typeof candidate.specVersion === "string" && typeof candidate.schemaEvidenceFingerprint === "string" && typeof candidate.path === "string" && typeof candidate.contentSha256 === "string" && candidate.metadata !== undefined) {
      const reviewToken = this.publicationRegistry.issueToken({
        taskId: candidate.taskId,
        queryArtifactId: candidate.queryArtifactId,
        normalizedSqlHash: candidate.normalizedSqlHash,
        specVersion: candidate.specVersion,
        schemaEvidenceFingerprint: candidate.schemaEvidenceFingerprint,
        candidate: candidate as ExportCandidate,
        outcome,
        reviewerVersion: `${this.reviewerModel}:${this.reviewerPromptVersion}`,
        policyVersion: this.reviewPolicyVersion,
      });
      const withToken = { ...outcome, reviewToken } as ReviewOutcome;
      this.recordReviewAudit(input, withToken, candidate, startedAt);
      return withToken;
    }
    this.recordReviewAudit(input, outcome, candidate, startedAt);
    return outcome;
  }

  private recordReviewAudit(input: PublicationReviewRequest, outcome: ReviewOutcome, candidate: Partial<ExportCandidate> & { normalizedSqlHash?: string; specVersion?: string; schemaEvidenceFingerprint?: string }, startedAt: number): void {
    if (!this.auditStore) return;
    const decision = outcome.availability === "available" ? outcome.decision : undefined;
    this.auditStore.append({
      taskId: input.task.taskId,
      ...(typeof candidate.queryArtifactId === "string" ? { queryArtifactId: candidate.queryArtifactId } : {}),
      ...(typeof candidate.normalizedSqlHash === "string" ? { sqlHash: candidate.normalizedSqlHash } : {}),
      ...(typeof candidate.specVersion === "string" ? { specVersion: candidate.specVersion } : {}),
      ...(typeof candidate.schemaEvidenceFingerprint === "string" ? { schemaEvidenceFingerprint: candidate.schemaEvidenceFingerprint } : {}),
      ...(input.reviewInput?.digest ? { queryDigestVersion: input.reviewInput.digest.queryDigestVersion } : {}),
      reviewerModel: this.reviewerModel,
      reviewerPromptVersion: this.reviewerPromptVersion,
      reviewPolicyVersion: this.reviewPolicyVersion,
      reviewAvailability: outcome.availability === "unavailable" && outcome.failure.code === "REVIEW_OFF" ? "off" : outcome.availability,
      ...(outcome.availability === "unavailable" ? { reviewFailure: { ...outcome.failure, message: outcome.failure.message.slice(0, 2_000) } } : {}),
      ...(decision ? { decision: decision.status, ...(decision.coverage ? { coverage: decision.coverage } : {}), ...(decision.diffs ? { semanticDiffs: decision.diffs } : {}) } : {}),
      repairAttempt: 0,
      reviewMode: this.mode,
      ...(outcome.cacheHit !== undefined ? { cacheHit: outcome.cacheHit } : {}),
      latencyMs: Math.max(0, this.now() - startedAt),
    });
  }

  async publishCandidate(input: { reviewToken: ReviewToken; candidate: ExportCandidate; targetPath: string; authorization?: PublicationAuthorization; promote?: () => Promise<void> }, signal: AbortSignal): Promise<PublicationReceipt> {
    throwIfAborted(signal);
    const receipt = await this.publicationRegistry.publish(input.reviewToken, input.candidate, input.targetPath, input.authorization, input.promote);
    if (this.auditStore) this.auditStore.append({
      taskId: receipt.taskId,
      queryArtifactId: receipt.queryArtifactId,
      publicationStatus: receipt.status,
      reviewAvailability: receipt.reviewOutcome.availability === "unavailable" ? "unavailable" : "available",
      ...(receipt.reviewOutcome.availability === "unavailable" ? { reviewFailure: { ...receipt.reviewOutcome.failure, message: receipt.reviewOutcome.failure.message.slice(0, 2_000) } } : {}),
      ...(receipt.reviewOutcome.availability === "available" ? {
        decision: receipt.reviewOutcome.decision.status,
        ...(receipt.reviewOutcome.decision.coverage ? { coverage: receipt.reviewOutcome.decision.coverage } : {}),
        ...(receipt.reviewOutcome.decision.diffs ? { semanticDiffs: receipt.reviewOutcome.decision.diffs } : {}),
      } : {}),
      reviewerModel: this.reviewerModel,
      reviewerPromptVersion: this.reviewerPromptVersion,
      reviewPolicyVersion: this.reviewPolicyVersion,
      repairAttempt: 0,
      reviewMode: receipt.mode,
    });
    return receipt;
  }
}

/** The default implementation is explicit Review Off and never fabricates approval. */
export type ReviewOffQueryAssuranceOptions = QueryAssuranceOptions;

export function createQueryAssurance(options: QueryAssuranceOptions = {}): InMemoryQueryAssurance {
  return new InMemoryQueryAssurance(options);
}

export function createReviewOffQueryAssurance(options: QueryAssuranceOptions = {}): QueryAssurance {
  return new InMemoryQueryAssurance({ ...options, mode: "off" });
}
