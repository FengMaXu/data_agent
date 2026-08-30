import { createHash, randomUUID } from "node:crypto";
import { createSpecAuthority, type AmbiguityInput, type AnswerRowMode, type AnswerSpec, type AnswerSpecGenerator, type ConstraintInput, type HypothesisInput, type SpecAuthority } from "./answer-spec.js";
import { createQueryDigestCompiler, type QueryDigest, type QueryDigestCompiler, type SchemaEvidence, type SqlDialect } from "./query-digest.js";
import type { ConversationBlindReviewer, ConversationBlindReviewerInput, ReviewCoverage, SemanticDiff } from "./conversation-blind-reviewer.js";
import type { ExportCandidate } from "./export-candidate.js";
import { PublicationRegistry, type PublicationAuthorization, type PublicationReceipt, type ReviewToken } from "./publication.js";
import { ReviewCache, type ReviewCacheIdentity } from "./review-cache.js";
import { type AssuranceMetrics, type ReviewModeController } from "./review-policy.js";
import { InMemoryAssuranceAuditStore, type AssuranceAuditRecord, type AssuranceAuditStore } from "./assurance-audit.js";

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
  reviewCache?: ReviewCache;
  reviewerModel?: string;
  reviewerPromptVersion?: string;
  reviewPolicyVersion?: string;
  reviewCoverageSchemaVersion?: string;
  modeController?: ReviewModeController;
  auditStore?: AssuranceAuditStore;
  specGenerator?: AnswerSpecGenerator;
}

export function normalizeQuerySql(sql: string): string {
  return sql.trim().replace(/;\s*$/, "").replace(/\s+/g, " ");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new QueryAssuranceAbortError();
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
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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

  constructor(options: QueryAssuranceOptions = {}) {
    this.modeController = options.modeController;
    this.configuredMode = options.mode === "enforce" && !this.modeController ? "shadow" : (options.mode ?? "off");
    this.artifactTtlMs = options.artifactTtlMs ?? 5 * 60 * 1000;
    this.now = options.now ?? Date.now;
    this.specAuthority = options.specAuthority ?? createSpecAuthority();
    this.digestCompiler = options.digestCompiler ?? createQueryDigestCompiler();
    this.reviewer = options.reviewer;
    this.publicationRegistry = options.publicationRegistry ?? new PublicationRegistry({
      mode: this.configuredMode,
      modeFor: () => this.mode,
      specVersionFor: (taskId) => this.specAuthority.get(taskId)?.specVersion,
    });
    this.reviewCache = options.reviewCache ?? new ReviewCache();
    this.reviewerModel = options.reviewerModel ?? "unknown";
    this.reviewerPromptVersion = options.reviewerPromptVersion ?? "1";
    this.reviewPolicyVersion = options.reviewPolicyVersion ?? "1";
    this.reviewCoverageSchemaVersion = options.reviewCoverageSchemaVersion ?? "1";
    this.auditStore = options.auditStore ?? new InMemoryAssuranceAuditStore({ now: this.now });
    this.specGenerator = options.specGenerator;
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
    };
    try {
      if (this.specGenerator) {
        const generated = await this.specGenerator.generate(specInput, signal);
        const prepared = this.specAuthority.prepare({ ...generated, taskId, question: input.question });
        return { taskId, mode: this.mode, specVersion: prepared.specVersion, specStatus: "available" };
      }
      const prepared = this.specAuthority.prepare(specInput);
      return { taskId, mode: this.mode, specVersion: prepared.specVersion, specStatus: "available" };
    } catch (error) {
      if (error instanceof QueryAssuranceAbortError) throw error;
      this.auditStore.append({
        taskId,
        reviewAvailability: "unavailable",
        specStatus: "unavailable",
        repairAttempt: 0,
        reviewMode: this.mode,
      });
      return { taskId, mode: this.mode, specStatus: "unavailable" };
    }
  }

  getAnswerSpec(taskId: string, specVersion?: string): AnswerSpec | undefined {
    return this.specAuthority.get(taskId, specVersion);
  }

  getTaskEvidence(taskId: string): TaskEvidence | undefined { return this.taskEvidence.get(taskId); }
  hasInternalEvidence(taskId: string): boolean { return (this.artifacts.get(taskId)?.size ?? 0) > 0; }
  hasPublication(taskId: string): boolean { return this.publicationRegistry.hasReceipt(taskId); }

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
    const artifact: ValidatedQueryArtifact = {
      taskId: input.task.taskId,
      queryArtifactId: randomUUID(),
      normalizedSql,
      normalizedSqlHash: hash(normalizedSql),
      previewMetadata: resultMetadata(input.result),
      ...(dialect ? { queryDigest: this.digestCompiler.compile({ sql: normalizedSql, dialect, schema }) } : {}),
      ...(schema ? { schemaEvidence: schema } : {}),
      ...(input.task.specVersion ? { specVersion: input.task.specVersion } : {}),
      ...(input.task.specStatus ? { specStatus: input.task.specStatus } : {}),
      internalEvidence: true,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + this.artifactTtlMs).toISOString(),
      ...(input.purpose ? { purpose: input.purpose } : {}),
    };
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
    let outcome: ReviewOutcome;
    if (this.mode === "off") {
      outcome = {
        availability: "unavailable",
        failure: { code: "REVIEW_OFF", message: "Query Assurance review is disabled", retryable: false },
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
          return { availability: "available", decision: await this.reviewer!.review(input.reviewInput!, signal) };
        } catch (error) {
          if (error instanceof QueryAssuranceAbortError) throw error;
          return {
            availability: "unavailable",
            failure: { code: "REVIEWER_FAILED", message: error instanceof Error ? error.message : String(error), retryable: true },
          };
        }
      };
      const digest = input.reviewInput.digest;
      const identity: ReviewCacheIdentity = {
        taskId: input.task.taskId,
        taskQuestionHash: hash(input.reviewInput.question),
        specVersion: input.reviewInput.answerSpec.specVersion,
        schemaEvidenceFingerprint: digest.schemaEvidenceFingerprint,
        normalizedSqlHash: digest.normalizedSqlHash,
        queryDigestVersion: digest.queryDigestVersion,
        reviewerModel: this.reviewerModel,
        reviewerPromptVersion: this.reviewerPromptVersion,
        reviewPolicyVersion: this.reviewPolicyVersion,
        reviewCoverageSchemaVersion: this.reviewCoverageSchemaVersion,
        parserVersion: digest.parserVersion,
      };
      const cached = await this.reviewCache.getOrCreate(identity, review, signal);
      outcome = { ...cached.outcome, cacheHit: cached.cacheHit };
    }
    const candidate = input.candidate as Partial<ExportCandidate> & { normalizedSqlHash?: string; specVersion?: string; schemaEvidenceFingerprint?: string };
    if (candidate && typeof candidate.candidateId === "string" && typeof candidate.taskId === "string" && typeof candidate.queryArtifactId === "string" && typeof candidate.normalizedSqlHash === "string" && typeof candidate.specVersion === "string" && typeof candidate.schemaEvidenceFingerprint === "string") {
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
