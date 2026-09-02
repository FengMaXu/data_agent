import { createHash, randomUUID } from "node:crypto";
import { createSpecAuthority, type AmbiguityInput, type AnswerContractInput, type AnswerRowMode, type AnswerSpec, type AnswerSpecGenerator, type ConstraintInput, type HypothesisInput, type PhysicalMappingEvidence, type SemanticEvidenceExcerpt, type SpecAuthority } from "./answer-spec.js";
import { createQueryDigestCompiler, QUERY_DIGEST_PARSER_VERSION, QUERY_DIGEST_VERSION, type DigestCardinalityEvidence, type QueryDigest, type QueryDigestCompiler, type SchemaEvidence, type SqlDialect } from "./query-digest.js";
import { CONVERSATION_BLIND_REVIEWER_PROMPT_VERSION, deriveReviewCoverageRequirements, validateReviewDecision, REVIEW_COVERAGE_SCHEMA_VERSION, type ConversationBlindReviewer, type ConversationBlindReviewerInput, type ReviewCoverage, type SemanticDiff } from "./conversation-blind-reviewer.js";
import type { ExportCandidate } from "./export-candidate.js";
import { PublicationRegistry, type PublicationAuthorization, type PublicationReceipt, type ReviewToken } from "./publication.js";
import { ReviewCache, type ReviewCacheIdentity } from "./review-cache.js";
import { type AssuranceMetrics, type ReviewModeController } from "./review-policy.js";
import { InMemoryAssuranceAuditStore, type AssuranceAuditRecord, type AssuranceAuditStore, type SpecGenerationFailure } from "./assurance-audit.js";
import { InvariantProbeRegistry, type ProbeInstance, type ProbeOutcome } from "./invariant-probe.js";
import { buildResultEvidence, type ResultEvidence, type ResultEvidenceOptions } from "./result-evidence.js";
import { candidateSemanticFingerprint, candidateSemanticFingerprintForClaim, evaluateGates, GATE_APPLICABILITY_VERSION, type GateResult } from "./query-gates.js";
import { JsonFileQueryAssuranceStateStore, type QueryAssurancePersistedState, type QueryAssuranceStateIdentity, type QueryAssuranceStateStore } from "./query-assurance-store.js";

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
  /** Bounded business/semantic evidence retrieved before planning. */
  readonly semanticEvidence?: readonly SemanticEvidenceExcerpt[];
  readonly physicalMappings?: readonly PhysicalMappingEvidence[];
  readonly dialect?: SqlDialect;
  readonly schema?: SchemaEvidence;
  readonly [key: string]: unknown;
}

export type QueryTaskLifecycleStatus = "spec_pending" | "exploration" | "candidate_review" | "repair_available" | "awaiting_clarification" | "awaiting_authorization" | "published" | "closed_without_publication";

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
  readonly dataSnapshot?: string;
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
  /** Runtime classification; Solver cannot override exploration status. */
  readonly exploratory?: boolean;
  readonly cardinalityEvidence?: readonly DigestCardinalityEvidence[];
  readonly dataSnapshot?: string;
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
  readonly preflightInstances?: readonly ProbeInstance[];
  readonly deterministicGates?: readonly GateResult[];
  readonly exploratory?: boolean;
  readonly dataSnapshot?: string;
  readonly internalEvidence: true;
  readonly createdAt: string;
  readonly expiresAt: string;
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
  /** True when the Runtime, rather than the LLM reviewer, produced the decision. */
  readonly deterministic?: boolean;
  /** Runtime-owned gate observations attached to this publication decision. */
  readonly deterministicGates?: readonly GateResult[];
}

export interface ReviewFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  /** True when required deterministic coverage, rather than a provider, failed. */
  readonly deterministic?: boolean;
  readonly deterministicGates?: readonly GateResult[];
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
  getTaskEvidence?(taskId: string): TaskEvidence | undefined;
  getTaskStatus?(taskId: string): QueryTaskLifecycleStatus | undefined;
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
  parserVersion?: string;
  hardConstraintAdmissionPolicy?: string;
  gatePolicyVersion?: string;
  gateApplicabilityVersion?: string;
  probeTemplateVersion?: string;
  evidenceAdmissionPolicyVersion?: string;
  /** Dialect scope for persisted assurance state; product hosts provide one per runtime. */
  dialect?: SqlDialect;
  modeController?: ReviewModeController;
  auditStore?: AssuranceAuditStore;
  specGenerator?: AnswerSpecGenerator;
  invariantProbes?: InvariantProbeRegistry;
  /** Controls which bounded result values may be sent to the blind reviewer. */
  reviewEvidence?: ResultEvidenceOptions;
  /** Optional trusted persistence seam for product Enforce mode. */
  stateStore?: QueryAssuranceStateStore;
  /** Convenience file-backed state store; stateStore takes precedence. */
  statePath?: string;
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

function resultMetadata(result: QueryPreviewResult, reviewEvidence: ResultEvidenceOptions = {}): ResultMetadata {
  const columns = [...result.columns];
  if (result.rows.some((row) => row.length !== columns.length)) throw new Error("QUERY_ARTIFACT_ROW_WIDTH_MISMATCH");
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
    resultEvidence: buildResultEvidence(columns, result.rows, result.truncated, reviewEvidence),
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

function mergeStableItems<T>(trusted: readonly T[] | undefined, generated: readonly T[] | undefined): readonly T[] | undefined {
  if (trusted === undefined && generated === undefined) return undefined;
  const result: T[] = [];
  for (const item of [...(trusted ?? []), ...(generated ?? [])]) {
    if (!result.some((existing) => stable(existing) === stable(item))) result.push(item);
  }
  return result;
}

/** Clone task evidence at the authority boundary so later caller mutation cannot
 * change what the planner/reviewer sees for an existing Query Task. */
function cloneTaskEvidence<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => cloneTaskEvidence(item)) as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  const copy = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, cloneTaskEvidence(item)]));
  return copy as T;
}

function failedCandidateFingerprint(fingerprint: string): string {
  return hash(fingerprint);
}

function candidateEvidenceScope(digest: QueryDigest, dataSnapshot?: string): string {
  return `snapshot:${dataSnapshot ?? "unknown"}|schema:${digest.schemaEvidenceFingerprint}|digest:${digest.queryDigestVersion}|parser:${digest.parserVersion}|dialect:${digest.dialect}`;
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
  private readonly shadowDelivery: "publish_with_disagreement" | "record_only";
  private readonly allowUnavailablePublication: boolean;
  private readonly artifactTtlMs: number;
  private readonly now: () => number;
  private readonly artifacts = new Map<string, Map<string, ValidatedQueryArtifact>>();
  private readonly taskEvidence = new Map<string, TaskEvidence>();
  private readonly repairAttempts = new Map<string, number>();
  private readonly failedCandidates = new Map<string, { specVersion: string; candidateId?: string; queryArtifactId?: string; digestPaths?: readonly string[]; gatePolicyVersion?: string; gateApplicabilityVersion?: string; fingerprint: string; claimIds: readonly string[]; claimFingerprints?: readonly (readonly [string, string])[] }[]>();
  private readonly taskStatuses = new Map<string, QueryTaskLifecycleStatus>();
  private readonly specAuthority: SpecAuthority;
  private readonly digestCompiler: QueryDigestCompiler;
  private readonly reviewer?: ConversationBlindReviewer;
  private readonly publicationRegistry: PublicationRegistry;
  private readonly reviewCache: ReviewCache;
  private readonly reviewerModel: string;
  private readonly reviewerPromptVersion: string;
  private readonly reviewPolicyVersion: string;
  private readonly reviewCoverageSchemaVersion: string;
  private readonly parserVersion: string;
  private readonly hardConstraintAdmissionPolicy: string;
  private readonly gatePolicyVersion: string;
  private readonly gateApplicabilityVersion: string;
  private readonly probeTemplateVersion: string;
  private readonly evidenceAdmissionPolicyVersion: string;
  private readonly assuranceDialect: string;
  private readonly auditStore: AssuranceAuditStore;
  private readonly specGenerator?: AnswerSpecGenerator;
  private readonly invariantProbes?: InvariantProbeRegistry;
  private readonly reviewEvidence: ResultEvidenceOptions;
  private readonly stateStore?: QueryAssuranceStateStore;

  constructor(options: QueryAssuranceOptions = {}) {
    this.modeController = options.modeController;
    // Modes remain part of the receipt/audit identity during the migration,
    // but calibration no longer grants or removes publication authority.
    this.configuredMode = options.mode ?? this.modeController?.mode() ?? "off";
    this.artifactTtlMs = options.artifactTtlMs ?? 5 * 60 * 1000;
    this.now = options.now ?? Date.now;
    this.shadowDelivery = options.shadowDelivery ?? "publish_with_disagreement";
    this.allowUnavailablePublication = options.allowUnavailablePublication === true;
    this.specAuthority = options.specAuthority ?? createSpecAuthority();
    this.digestCompiler = options.digestCompiler ?? createQueryDigestCompiler();
    this.reviewer = options.reviewer;
    this.publicationRegistry = options.publicationRegistry ?? new PublicationRegistry({
      mode: this.configuredMode,
      modeFor: () => this.mode,
      allowUnavailablePublication: this.allowUnavailablePublication,
      shadowDelivery: this.shadowDelivery,
      specVersionFor: (taskId) => this.specAuthority.get(taskId)?.specVersion,
    });
    this.reviewCache = options.reviewCache ?? new ReviewCache();
    this.reviewerModel = options.reviewerModel ?? "unknown";
    this.reviewerPromptVersion = options.reviewerPromptVersion ?? CONVERSATION_BLIND_REVIEWER_PROMPT_VERSION;
    this.reviewPolicyVersion = options.reviewPolicyVersion ?? "2";
    this.reviewCoverageSchemaVersion = options.reviewCoverageSchemaVersion ?? REVIEW_COVERAGE_SCHEMA_VERSION;
    this.parserVersion = options.parserVersion ?? QUERY_DIGEST_PARSER_VERSION;
    this.hardConstraintAdmissionPolicy = options.hardConstraintAdmissionPolicy ?? "2";
    this.gatePolicyVersion = options.gatePolicyVersion ?? "1";
    this.gateApplicabilityVersion = options.gateApplicabilityVersion ?? GATE_APPLICABILITY_VERSION;
    this.probeTemplateVersion = options.probeTemplateVersion ?? "1";
    this.evidenceAdmissionPolicyVersion = options.evidenceAdmissionPolicyVersion ?? "1";
    this.assuranceDialect = options.dialect ?? "unknown";
    this.auditStore = options.auditStore ?? new InMemoryAssuranceAuditStore({ now: this.now });
    this.specGenerator = options.specGenerator;
    this.invariantProbes = options.invariantProbes;
    this.reviewEvidence = options.reviewEvidence ?? {};
    this.stateStore = options.stateStore ?? (options.statePath ? new JsonFileQueryAssuranceStateStore(options.statePath) : undefined);
    this.restoreState(this.stateStore?.load());
  }

  private currentStateIdentity(): QueryAssuranceStateIdentity {
    return {
      reviewerModel: this.reviewerModel,
      reviewerPromptVersion: this.reviewerPromptVersion,
      queryDigestVersion: QUERY_DIGEST_VERSION,
      parserVersion: this.parserVersion,
      reviewCoverageSchemaVersion: this.reviewCoverageSchemaVersion,
      reviewPolicyVersion: this.reviewPolicyVersion,
      hardConstraintAdmissionPolicy: this.hardConstraintAdmissionPolicy,
      gatePolicyVersion: this.gatePolicyVersion,
      gateApplicabilityVersion: this.gateApplicabilityVersion,
      probeTemplateVersion: this.probeTemplateVersion,
      evidenceAdmissionPolicyVersion: this.evidenceAdmissionPolicyVersion,
      dialect: this.assuranceDialect,
      deliveryMode: this.mode,
      shadowDelivery: this.shadowDelivery,
      allowUnavailablePublication: this.allowUnavailablePublication,
    };
  }

  private restoreState(state: QueryAssurancePersistedState | undefined): void {
    if (!state) return;
    const identity = this.currentStateIdentity();
    const identityMatches = Boolean(state.identity)
      && Object.keys({ ...state.identity, ...identity }).every((key) => state.identity?.[key as keyof QueryAssuranceStateIdentity] === identity[key as keyof QueryAssuranceStateIdentity]);
    // Every persisted object that can feed a new review is scoped to the exact
    // assurance implementation identity. A changed parser, gate, policy, or
    // reviewer must not retain an old Spec or Query Task and accidentally let
    // recordPreview reuse its stale contract.
    if (!identityMatches) {
      this.auditStore.restore?.(state.auditRecords ?? []);
      return;
    }
    this.specAuthority.restore?.(state.specs ?? []);
    for (const task of state.tasks ?? []) this.taskEvidence.set(task.taskId, cloneTaskEvidence(task.evidence));
    for (const artifact of state.artifacts ?? []) {
      const taskArtifacts = this.artifacts.get(artifact.taskId) ?? new Map<string, ValidatedQueryArtifact>();
      taskArtifacts.set(artifact.queryArtifactId, cloneTaskEvidence(artifact));
      this.artifacts.set(artifact.taskId, taskArtifacts);
    }
    for (const [key, attempt] of state.repairAttempts ?? []) this.repairAttempts.set(key, attempt);
    for (const entry of state.failedCandidates ?? []) this.failedCandidates.set(entry.taskId, entry.candidates.map((candidate) => ({
      ...candidate,
      claimIds: [...candidate.claimIds],
      ...(candidate.claimFingerprints ? { claimFingerprints: candidate.claimFingerprints.map(([claimId, fingerprint]) => [claimId, fingerprint] as const) } : {}),
    })));
    for (const entry of state.taskStatuses ?? []) this.taskStatuses.set(entry.taskId, entry.status);
    if (state.publication) this.publicationRegistry.restore(state.publication);
    this.auditStore.restore?.(state.auditRecords ?? []);
  }

  private persistState(): void {
    if (!this.stateStore) return;
    const persistedArtifact = (artifact: ValidatedQueryArtifact): ValidatedQueryArtifact => {
      const evidence = artifact.previewMetadata.resultEvidence;
      // Raw preview values belong to short-lived Internal Evidence, not a
      // durable control-plane snapshot. Metadata and identities remain enough
      // to reject stale publication; a post-restart inline review can abstain
      // if it needs values that are no longer retained.
      const previewMetadata = evidence
        ? (() => {
          const { rows: _rows, ...withoutRawRows } = evidence;
          return { ...artifact.previewMetadata, resultEvidence: { ...withoutRawRows, numericRows: [], numericCompleteness: "partial" as const } };
        })()
        : artifact.previewMetadata;
      return { ...cloneTaskEvidence(artifact), previewMetadata };
    };
    const state: QueryAssurancePersistedState = {
      version: 1,
      identity: this.currentStateIdentity(),
      specs: this.specAuthority.snapshot?.() ?? [],
      tasks: [...this.taskEvidence.entries()].map(([taskId, evidence]) => ({ taskId, evidence: cloneTaskEvidence(evidence) })),
      artifacts: [...this.artifacts.values()].flatMap((items) => [...items.values()].map(persistedArtifact)),
      repairAttempts: [...this.repairAttempts.entries()],
      failedCandidates: [...this.failedCandidates.entries()].map(([taskId, candidates]) => ({ taskId, candidates: candidates.map((candidate) => ({
        ...candidate,
        claimIds: [...candidate.claimIds],
        ...(candidate.claimFingerprints ? { claimFingerprints: candidate.claimFingerprints.map(([claimId, fingerprint]) => [claimId, fingerprint] as const) } : {}),
      })) })),
      taskStatuses: [...this.taskStatuses.entries()].map(([taskId, status]) => ({ taskId, status })),
      publication: this.publicationRegistry.snapshot(),
      auditRecords: this.auditStore.snapshot?.() ?? [],
    };
    this.stateStore.save(state);
  }

  get mode(): QueryAssuranceMode { return this.modeController?.mode() ?? this.configuredMode; }

  observeMetrics(metrics: AssuranceMetrics): void { this.modeController?.circuitBreaker().observe(metrics); }
  auditRecords(taskId?: string): readonly AssuranceAuditRecord[] { return this.auditStore.list(taskId); }

  async prepareTask(input: TaskEvidence, signal: AbortSignal): Promise<PreparedQueryTask> {
    throwIfAborted(signal);
    const taskId = randomUUID();
    const taskEvidence = cloneTaskEvidence(input);
    this.taskEvidence.set(taskId, taskEvidence);
    this.taskStatuses.set(taskId, "spec_pending");
    this.persistState();
    const specInput = {
      taskId,
      question: taskEvidence.question,
      clarifications: taskEvidence.clarifications,
      constraints: taskEvidence.constraints,
      hypotheses: taskEvidence.hypotheses,
      ambiguities: taskEvidence.ambiguities,
      outputColumns: taskEvidence.outputColumns,
      rowMode: taskEvidence.rowMode,
      rowCount: taskEvidence.rowCount,
      answerContract: taskEvidence.answerContract,
      schema: taskEvidence.schema,
      semanticEvidence: taskEvidence.semanticEvidence,
      physicalMappings: taskEvidence.physicalMappings,
    };
    if (!this.specGenerator) {
      const prepared = this.specAuthority.prepare(specInput);
      this.taskStatuses.set(taskId, "exploration");
      this.persistState();
      return { taskId, mode: this.mode, specVersion: prepared.specVersion, specStatus: "available", answerSpec: prepared };
    }

    try {
      const generated = await this.specGenerator.generate(specInput, signal);
      // The Planner may enrich provisional facets, but it cannot drop or
      // replace trusted task evidence that the Runtime supplied at creation.
      const hypotheses = mergeStableItems(taskEvidence.hypotheses, generated.hypotheses);
      const ambiguities = mergeStableItems(taskEvidence.ambiguities, generated.ambiguities);
      const prepared = this.specAuthority.prepare({
        ...generated,
        taskId,
        question: input.question,
        ...(taskEvidence.clarifications ? { clarifications: taskEvidence.clarifications } : {}),
        ...(hypotheses ? { hypotheses } : {}),
        ...(ambiguities ? { ambiguities } : {}),
        ...(taskEvidence.constraints ? { constraints: taskEvidence.constraints } : {}),
        ...(taskEvidence.outputColumns ? { outputColumns: taskEvidence.outputColumns } : {}),
        ...(taskEvidence.rowMode ? { rowMode: taskEvidence.rowMode } : {}),
        ...(taskEvidence.rowCount !== undefined ? { rowCount: taskEvidence.rowCount } : {}),
        ...(taskEvidence.answerContract ? { answerContract: taskEvidence.answerContract } : {}),
        ...(taskEvidence.schema ? { schema: taskEvidence.schema } : {}),
        ...(taskEvidence.semanticEvidence ? { semanticEvidence: taskEvidence.semanticEvidence } : {}),
        ...(taskEvidence.physicalMappings ? { physicalMappings: taskEvidence.physicalMappings } : {}),
      });
      this.taskStatuses.set(taskId, "exploration");
      this.persistState();
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
        this.taskStatuses.set(taskId, "exploration");
        this.persistState();
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
        this.persistState();
        return { taskId, mode: this.mode, specStatus: "unavailable" };
      }
    }
  }

  getAnswerSpec(taskId: string, specVersion?: string): AnswerSpec | undefined {
    const spec = this.specAuthority.get(taskId, specVersion);
    return spec ? cloneTaskEvidence(spec) : undefined;
  }

  getTaskEvidence(taskId: string): TaskEvidence | undefined {
    const evidence = this.taskEvidence.get(taskId);
    return evidence ? cloneTaskEvidence(evidence) : undefined;
  }
  getTaskStatus(taskId: string): QueryTaskLifecycleStatus | undefined { return this.taskStatuses.get(taskId); }
  hasInternalEvidence(taskId: string): boolean { return (this.artifacts.get(taskId)?.size ?? 0) > 0; }
  hasPublication(taskId: string): boolean { return this.publicationRegistry.hasReceipt(taskId); }
  publicationForArtifact(taskId: string, queryArtifactId: string): PublicationReceipt | undefined {
    const receipt = this.publicationRegistry.receiptForArtifact(taskId, queryArtifactId);
    return receipt ? cloneTaskEvidence(receipt) : undefined;
  }
  publicationForTask(taskId: string): PublicationReceipt | undefined {
    const receipt = this.publicationRegistry.receiptForTask(taskId);
    return receipt ? cloneTaskEvidence(receipt) : undefined;
  }
  claimAutomaticRepair(taskId: string, specVersion: string): { readonly allowed: boolean; readonly attempt: number } {
    const key = `${taskId}:${specVersion}`;
    const attempt = this.repairAttempts.get(key) ?? 0;
    if (attempt >= 1) return { allowed: false, attempt };
    const next = attempt + 1;
    this.repairAttempts.set(key, next);
    try {
      this.persistState();
    } catch (error) {
      // A storage/transaction failure is infrastructure failure, not a
      // semantic repair. Do not burn the one-shot budget in memory.
      if (attempt === 0) this.repairAttempts.delete(key);
      else this.repairAttempts.set(key, attempt);
      throw error;
    }
    return { allowed: true, attempt: next };
  }

  private failedCandidateFor(taskId: string, specVersion: string, fingerprint: string, digest?: QueryDigest, dataSnapshot?: string): { specVersion: string; candidateId?: string; queryArtifactId?: string; digestPaths?: readonly string[]; gatePolicyVersion?: string; gateApplicabilityVersion?: string; fingerprint: string; claimIds: readonly string[]; claimFingerprints?: readonly (readonly [string, string])[] } | undefined {
    const current = this.failedCandidates.get(taskId) ?? [];
    const exact = current.find((candidate) => candidate.specVersion === specVersion && candidate.fingerprint === fingerprint);
    if (exact) return exact;
    if (!digest) return undefined;
    return current.find((candidate) => candidate.specVersion === specVersion
      && candidate.claimFingerprints?.some(([claimId, claimFingerprint]) => {
        const currentClaimFingerprint = candidateSemanticFingerprintForClaim(digest, claimId);
        return currentClaimFingerprint !== undefined
          && failedCandidateFingerprint(`${currentClaimFingerprint}|${candidateEvidenceScope(digest, dataSnapshot)}`) === claimFingerprint;
      }));
  }

  private rememberFailedCandidate(taskId: string, specVersion: string, fingerprint: string | undefined, claimIds: readonly string[], digest?: QueryDigest, dataSnapshot?: string, candidateId?: string, queryArtifactId?: string): void {
    if (!fingerprint) return;
    const ids = [...new Set(claimIds.filter((claimId) => claimId.trim()))];
    const claimFingerprints = digest
      ? ids.map((claimId) => {
        const value = candidateSemanticFingerprintForClaim(digest, claimId);
        return value ? [claimId, failedCandidateFingerprint(`${value}|${candidateEvidenceScope(digest, dataSnapshot)}`)] as const : undefined;
      }).filter((entry): entry is readonly [string, string] => entry !== undefined)
      : [];
    const entries = this.failedCandidates.get(taskId) ?? [];
    if (!entries.some((entry) => entry.specVersion === specVersion && entry.fingerprint === fingerprint)) {
      entries.push({
        specVersion,
        ...(candidateId ? { candidateId } : {}),
        ...(queryArtifactId ? { queryArtifactId } : {}),
        ...(digest ? { digestPaths: ids.map((claimId) => `claim:${claimId}`) } : {}),
        gatePolicyVersion: this.gatePolicyVersion,
        gateApplicabilityVersion: this.gateApplicabilityVersion,
        fingerprint,
        claimIds: ids,
        ...(claimFingerprints.length ? { claimFingerprints } : {}),
      });
      this.failedCandidates.set(taskId, entries);
    }
  }

  applyClarification(taskId: string, baseSpecVersion: string, clarification: string): AnswerSpec {
    const next = this.specAuthority.applyClarification(taskId, baseSpecVersion, clarification);
    this.taskStatuses.set(taskId, "exploration");
    this.persistState();
    return next;
  }

  submitSpecChange(proposal: Parameters<SpecAuthority["submitProposal"]>[0]): ReturnType<SpecAuthority["submitProposal"]> {
    const result = this.specAuthority.submitProposal(proposal);
    if (result.accepted) {
      this.taskStatuses.set(proposal.taskId, "exploration");
      this.persistState();
    }
    return result;
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
    if (digest && input.cardinalityEvidence?.length) digest = { ...digest, cardinalityEvidence: input.cardinalityEvidence };
    const queryArtifactId = randomUUID();
    let artifact: ValidatedQueryArtifact = {
      taskId: input.task.taskId,
      queryArtifactId,
      normalizedSql,
      normalizedSqlHash: digest?.normalizedSqlHash ?? hash(normalizedSql),
      previewMetadata: resultMetadata(input.result, this.reviewEvidence),
      ...(digest ? { queryDigest: digest } : {}),
      ...(schema ? { schemaEvidence: schema } : {}),
      ...(input.task.specVersion ? { specVersion: input.task.specVersion } : {}),
      ...(input.task.specStatus ? { specStatus: input.task.specStatus } : {}),
      ...(input.exploratory ? { exploratory: true } : {}),
      ...((input.dataSnapshot ?? input.result.dataSnapshot) ? { dataSnapshot: input.dataSnapshot ?? input.result.dataSnapshot } : {}),
      internalEvidence: true,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + this.artifactTtlMs).toISOString(),
    };
    const spec = this.getAnswerSpec(input.task.taskId, input.task.specVersion);
    if (this.invariantProbes && spec) {
      const preflightInstances = this.invariantProbes.ids().map((id) => this.invariantProbes!.createInstance(id, {
        claimId: id,
        specVersion: spec.specVersion,
        candidateId: artifact.queryArtifactId,
        digestPaths: artifact.queryDigest ? ["queryDigest"] : [],
        ...(artifact.queryDigest ? {
          queryDigestVersion: artifact.queryDigest.queryDigestVersion,
          normalizedSqlHash: artifact.queryDigest.normalizedSqlHash,
          schemaEvidenceFingerprint: artifact.queryDigest.schemaEvidenceFingerprint,
        } : {}),
        snapshotId: artifact.dataSnapshot,
        frozenAt: artifact.createdAt,
      }));
      const preflightOutcomes = preflightInstances.map((instance) => this.invariantProbes!.evaluateInstance(instance, {
        answerSpec: spec,
        digest: artifact.queryDigest,
        schema: artifact.schemaEvidence,
        dataSnapshot: artifact.dataSnapshot,
        resultMetadata: artifact.previewMetadata,
        candidateId: artifact.queryArtifactId,
      }));
      artifact = { ...artifact, preflightInstances, preflightOutcomes };
    }
    let taskArtifacts = this.artifacts.get(input.task.taskId);
    if (!taskArtifacts) {
      taskArtifacts = new Map();
      this.artifacts.set(input.task.taskId, taskArtifacts);
    }
    const storedArtifact = cloneTaskEvidence(artifact);
    taskArtifacts.set(artifact.queryArtifactId, storedArtifact);
    this.taskStatuses.set(artifact.taskId, artifact.exploratory ? "exploration" : "candidate_review");
    this.auditStore?.append({
      taskId: artifact.taskId,
      queryArtifactId: artifact.queryArtifactId,
      sqlHash: artifact.normalizedSqlHash,
      ...(artifact.specVersion ? { specVersion: artifact.specVersion } : {}),
      ...(artifact.queryDigest ? { queryDigestVersion: artifact.queryDigest.queryDigestVersion, parserVersion: artifact.queryDigest.parserVersion, parserEngine: artifact.queryDigest.parserEngine, dialect: artifact.queryDigest.dialect } : {}),
      reviewCoverageSchemaVersion: this.reviewCoverageSchemaVersion,
      hardConstraintAdmissionPolicy: this.hardConstraintAdmissionPolicy,
      gatePolicyVersion: this.gatePolicyVersion,
      gateApplicabilityVersion: this.gateApplicabilityVersion,
      probeTemplateVersion: this.probeTemplateVersion,
      evidenceAdmissionPolicyVersion: this.evidenceAdmissionPolicyVersion,
      ...(artifact.preflightOutcomes?.length && artifact.preflightInstances?.length ? {
        probeOutcomes: artifact.preflightOutcomes.map((outcome, index) => ({
          instanceId: artifact.preflightInstances![index].instanceId,
          templateId: artifact.preflightInstances![index].templateId,
          templateVersion: artifact.preflightInstances![index].templateVersion,
          claimId: artifact.preflightInstances![index].claimId,
          status: outcome.status,
        })),
      } : {}),
      reviewAvailability: this.mode === "off" ? "off" : "unavailable",
      repairAttempt: 0,
      reviewMode: this.mode,
    });
    this.persistState();
    return cloneTaskEvidence(storedArtifact);
  }

  async getArtifact(taskId: string, queryArtifactId: string, signal: AbortSignal): Promise<ValidatedQueryArtifact | undefined> {
    throwIfAborted(signal);
    const artifact = this.artifacts.get(taskId)?.get(queryArtifactId);
    if (!artifact) return undefined;
    if (Date.parse(artifact.expiresAt) <= this.now()) {
      this.artifacts.get(taskId)?.delete(queryArtifactId);
      return undefined;
    }
    return cloneTaskEvidence(artifact);
  }

  async reviewForPublication(input: PublicationReviewRequest, signal: AbortSignal): Promise<ReviewOutcome> {
    throwIfAborted(signal);
    const startedAt = this.now();
    const candidate = input.candidate as Partial<ExportCandidate> & { normalizedSqlHash?: string; specVersion?: string; schemaEvidenceFingerprint?: string; dataSnapshot?: string };
    const candidateArtifact = typeof candidate?.queryArtifactId === "string"
      ? await this.getArtifact(input.task.taskId, candidate.queryArtifactId, signal)
      : undefined;
    const hasCandidateBinding = Boolean(candidate && typeof candidate.candidateId === "string");
    const expectedSchemaFingerprint = candidateArtifact?.queryDigest?.schemaEvidenceFingerprint ?? "unknown";
    const expectedSpecVersion = candidateArtifact?.specVersion ?? input.task.specVersion ?? "1";
    const storedSpec = this.getAnswerSpec(input.task.taskId, expectedSpecVersion);
    const expectedReviewSchema = candidateArtifact?.schemaEvidence ?? (candidateArtifact?.queryDigest ? { connectionId: "unknown", dialect: candidateArtifact.queryDigest.dialect, tables: [] } : undefined);
    const candidateMetadata = candidate?.metadata;
    const suppliedReviewInput = input.reviewInput;
    const taskSemanticEvidence = this.taskEvidence.get(input.task.taskId)?.semanticEvidence;
    // Coverage is a runtime challenge, not a field the Solver or Reviewer can
    // choose. Recompute it from the canonical stored Digest before invoking a
    // reviewer, so a forged/ stale coverageRequirements field is ignored.
    const reviewInput = suppliedReviewInput && suppliedReviewInput.digest
      ? {
        ...suppliedReviewInput,
        ...(taskSemanticEvidence?.length ? { semanticEvidence: taskSemanticEvidence } : { semanticEvidence: undefined }),
        coverageRequirements: deriveReviewCoverageRequirements(suppliedReviewInput),
      }
      : suppliedReviewInput;
    const reviewInputBindingValid = !hasCandidateBinding || this.mode === "off" || (
      candidateArtifact !== undefined
      && reviewInput !== undefined
      && normalizeQuerySql(reviewInput.sql) === candidateArtifact.normalizedSql
      && reviewInput.digest.normalizedSqlHash === candidateArtifact.normalizedSqlHash
      && reviewInput.digest.schemaEvidenceFingerprint === expectedSchemaFingerprint
      && stable(reviewInput.digest) === stable(candidateArtifact.queryDigest)
      && reviewInput.question === (storedSpec?.question ?? reviewInput.question)
      && reviewInput.answerSpec.taskId === input.task.taskId
      && reviewInput.answerSpec.specVersion === expectedSpecVersion
      && storedSpec !== undefined
      && stable(reviewInput.answerSpec) === stable(storedSpec)
      && (!expectedReviewSchema || stable(reviewInput.schema) === stable(expectedReviewSchema))
      && candidateMetadata !== undefined
      && stable(reviewInput.resultMetadata) === stable(candidateMetadata)
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
      && (!candidateArtifact.dataSnapshot || candidate.dataSnapshot === candidateArtifact.dataSnapshot)
      && typeof candidate.path === "string"
      && typeof candidate.contentSha256 === "string"
      && candidateMetadata !== undefined
      && candidateMetadata.columns.length === candidateArtifact.previewMetadata.columns.length
      && candidateMetadata.columns.every((column, index) => column === candidateArtifact.previewMetadata.columns[index])
      && reviewInputBindingValid
    );
    const candidateFingerprint = candidateArtifact
      ? (() => {
        const digestFingerprint = candidateSemanticFingerprint(candidateArtifact.queryDigest);
        return digestFingerprint && candidateArtifact.queryDigest
          ? `${digestFingerprint}|${candidateEvidenceScope(candidateArtifact.queryDigest, candidateArtifact.dataSnapshot)}`
          : undefined;
      })()
      : undefined;
    const failedCandidate = candidateFingerprint && expectedSpecVersion
      ? this.failedCandidateFor(input.task.taskId, expectedSpecVersion, failedCandidateFingerprint(candidateFingerprint), candidateArtifact?.queryDigest, candidateArtifact?.dataSnapshot)
      : undefined;
    const deterministicGates = storedSpec && candidateMetadata
      ? evaluateGates({
        spec: storedSpec,
        digest: candidateArtifact?.queryDigest,
        metadata: candidateMetadata,
        dataSnapshot: candidateArtifact?.dataSnapshot,
        schema: candidateArtifact?.schemaEvidence,
        gateApplicabilityVersion: this.gateApplicabilityVersion,
        gatePolicyVersion: this.gatePolicyVersion,
        candidateFingerprint,
        candidatePreviouslyFailed: Boolean(failedCandidate),
        failedClaimIds: failedCandidate?.claimIds,
      })
      : [];
    const deterministicGateViolations = deterministicGates.flatMap((gate) => gate.violations);
    const preflightOutcomes = candidateArtifact?.preflightOutcomes ?? [];
    const preflightDiffs: SemanticDiff[] = preflightOutcomes.flatMap((probe, index) => probe.status === "failed" ? [{
      aspect: "invariant_probe",
      required: "probe prerequisites hold",
      observed: "probe failed",
      claimId: candidateArtifact?.preflightInstances?.[index]?.claimId ?? `probe:${index + 1}`,
      blocking: true,
      evidence: { digestPath: "projections" },
    }] : []);
    let outcome: ReviewOutcome;
    if (hasCandidateBinding && !candidateBindingValid) {
      outcome = { availability: "unavailable", failure: { code: "REVIEW_CANDIDATE_BINDING_INVALID", message: "Candidate identity does not match the Validated Query Artifact", retryable: false } };
    } else if (this.mode === "off") {
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
        parserEngine: digest.parserEngine,
        dialect: digest.dialect,
        reviewerModel: this.reviewerModel,
        reviewerPromptVersion: this.reviewerPromptVersion,
        reviewPolicyVersion: this.reviewPolicyVersion,
        hardConstraintAdmissionPolicy: this.hardConstraintAdmissionPolicy,
        reviewCoverageSchemaVersion: this.reviewCoverageSchemaVersion,
        parserVersion: digest.parserVersion,
        gatePolicyVersion: this.gatePolicyVersion,
        gateApplicabilityVersion: this.gateApplicabilityVersion,
        probeTemplateVersion: this.probeTemplateVersion,
        evidenceAdmissionPolicyVersion: this.evidenceAdmissionPolicyVersion,
        semanticEvidenceFingerprint: hash(stable(reviewInput!.semanticEvidence ?? [])),
        // Include the bounded envelope shape as well as its row hash, so a
        // cache entry cannot cross a changed evidence policy (for example
        // numeric-only versus complete categorical rows).
        resultEvidenceHash: reviewInput!.resultMetadata.resultEvidence
          ? hash(stable(reviewInput!.resultMetadata.resultEvidence))
          : hash(stable(reviewInput!.resultMetadata)),
      };
      const cached = await this.reviewCache.getOrCreate(identity, review, signal);
      outcome = { ...cached.outcome, cacheHit: cached.cacheHit };
    }
    if (deterministicGates.length > 0) {
      outcome = outcome.availability === "available"
        ? { ...outcome, decision: { ...outcome.decision, deterministicGates } }
        : { ...outcome, failure: { ...outcome.failure, deterministicGates } };
    }
    if (!candidateBindingValid) {
      this.recordReviewAudit(input, outcome, candidate, startedAt);
      return outcome;
    }
    if (outcome.availability === "unavailable") {
      this.taskStatuses.set(input.task.taskId, "closed_without_publication");
    } else if (hasCandidateBinding && candidateFingerprint && outcome.decision.status === "rejected" && outcome.decision.blocking !== false) {
      this.taskStatuses.set(input.task.taskId, "repair_available");
      const claimIds = outcome.decision.deterministic
        ? [
          ...deterministicGateViolations.filter((violation) => violation.blocking).map((violation) => violation.claimId ?? `${violation.gate}:${violation.code}`),
          ...preflightDiffs.map((diff) => diff.claimId ?? diff.evidence.constraintId ?? diff.aspect),
        ]
        : outcome.decision.diffs?.map((diff) => diff.claimId ?? diff.evidence.constraintId ?? diff.aspect) ?? [];
      this.rememberFailedCandidate(input.task.taskId, expectedSpecVersion, failedCandidateFingerprint(candidateFingerprint), claimIds, candidateArtifact?.queryDigest, candidateArtifact?.dataSnapshot, typeof candidate.candidateId === "string" ? candidate.candidateId : undefined, candidateArtifact?.queryArtifactId);
    } else if (outcome.decision.status === "needs_clarification" || outcome.decision.status === "abstained") {
      this.taskStatuses.set(input.task.taskId, "awaiting_clarification");
    } else if (outcome.decision.status === "rejected") {
      this.taskStatuses.set(input.task.taskId, "awaiting_authorization");
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
        ...(candidateArtifact?.queryDigest ? { queryDigestVersion: candidateArtifact.queryDigest.queryDigestVersion, parserVersion: candidateArtifact.queryDigest.parserVersion, parserEngine: candidateArtifact.queryDigest.parserEngine, dialect: candidateArtifact.queryDigest.dialect } : {}),
        hardConstraintAdmissionPolicy: this.hardConstraintAdmissionPolicy,
        reviewCoverageSchemaVersion: this.reviewCoverageSchemaVersion,
        gatePolicyVersion: this.gatePolicyVersion,
        gateApplicabilityVersion: this.gateApplicabilityVersion,
        probeTemplateVersion: this.probeTemplateVersion,
        evidenceAdmissionPolicyVersion: this.evidenceAdmissionPolicyVersion,
        issuedMode: this.mode,
      });
      const withToken = { ...outcome, reviewToken } as ReviewOutcome;
      this.recordReviewAudit(input, withToken, candidate, startedAt);
      return withToken;
    }
    this.recordReviewAudit(input, outcome, candidate, startedAt);
    return outcome;
  }

  private recordReviewAudit(input: PublicationReviewRequest, outcome: ReviewOutcome, candidate: Partial<ExportCandidate> & { normalizedSqlHash?: string; specVersion?: string; schemaEvidenceFingerprint?: string; dataSnapshot?: string }, startedAt: number): void {
    if (!this.auditStore) return;
    const decision = outcome.availability === "available" ? outcome.decision : undefined;
    const semanticEvidence = this.taskEvidence.get(input.task.taskId)?.semanticEvidence;
    this.auditStore.append({
      taskId: input.task.taskId,
      ...(typeof candidate.queryArtifactId === "string" ? { queryArtifactId: candidate.queryArtifactId } : {}),
      ...(typeof candidate.normalizedSqlHash === "string" ? { sqlHash: candidate.normalizedSqlHash } : {}),
      ...(typeof candidate.specVersion === "string" ? { specVersion: candidate.specVersion } : {}),
      ...(typeof candidate.schemaEvidenceFingerprint === "string" ? { schemaEvidenceFingerprint: candidate.schemaEvidenceFingerprint } : {}),
      ...(semanticEvidence?.length ? { semanticEvidenceFingerprint: hash(stable(semanticEvidence)) } : {}),
      ...(input.reviewInput?.digest ? { queryDigestVersion: input.reviewInput.digest.queryDigestVersion, parserVersion: input.reviewInput.digest.parserVersion, parserEngine: input.reviewInput.digest.parserEngine, dialect: input.reviewInput.digest.dialect } : {}),
      gatePolicyVersion: this.gatePolicyVersion,
      gateApplicabilityVersion: this.gateApplicabilityVersion,
      probeTemplateVersion: this.probeTemplateVersion,
      evidenceAdmissionPolicyVersion: this.evidenceAdmissionPolicyVersion,
      reviewerModel: this.reviewerModel,
      reviewerPromptVersion: this.reviewerPromptVersion,
      reviewPolicyVersion: this.reviewPolicyVersion,
      reviewCoverageSchemaVersion: this.reviewCoverageSchemaVersion,
      hardConstraintAdmissionPolicy: this.hardConstraintAdmissionPolicy,
      reviewAvailability: outcome.availability === "unavailable" && outcome.failure.code === "REVIEW_OFF" ? "off" : outcome.availability,
      ...(outcome.availability === "unavailable" ? {
        reviewFailure: { ...outcome.failure, message: outcome.failure.message.slice(0, 2_000) },
        ...(outcome.failure.deterministicGates ? { deterministicGates: outcome.failure.deterministicGates } : {}),
      } : {}),
      ...(decision ? {
        decision: decision.status,
        ...(decision.reason ? { decisionReason: decision.reason } : {}),
        ...(decision.warnings?.length ? { reviewWarnings: decision.warnings } : {}),
        ...(decision.coverage ? { coverage: decision.coverage } : {}),
        ...(decision.diffs ? { semanticDiffs: decision.diffs } : {}),
        ...(decision.deterministicGates ? { deterministicGates: decision.deterministicGates } : {}),
      } : {}),
      repairAttempt: 0,
      reviewMode: this.mode,
      ...(outcome.cacheHit !== undefined ? { cacheHit: outcome.cacheHit } : {}),
      latencyMs: Math.max(0, this.now() - startedAt),
    });
    this.persistState();
  }

  async publishCandidate(input: { reviewToken: ReviewToken; candidate: ExportCandidate; targetPath: string; authorization?: PublicationAuthorization; promote?: () => Promise<void> }, signal: AbortSignal): Promise<PublicationReceipt> {
    throwIfAborted(signal);
    const artifact = await this.getArtifact(input.reviewToken.taskId, input.reviewToken.queryArtifactId, signal);
    if (!artifact) throw new Error("REVIEW_UNAVAILABLE: QUERY_ARTIFACT_NOT_FOUND_OR_EXPIRED");
    const promote = input.promote ? async (): Promise<void> => {
      throwIfAborted(signal);
      const currentArtifact = await this.getArtifact(input.reviewToken.taskId, input.reviewToken.queryArtifactId, signal);
      if (!currentArtifact) throw new Error("REVIEW_UNAVAILABLE: QUERY_ARTIFACT_NOT_FOUND_OR_EXPIRED");
      await input.promote!();
    } : undefined;
    const receipt = await this.publicationRegistry.publish(input.reviewToken, input.candidate, input.targetPath, input.authorization, promote);
    this.taskStatuses.set(receipt.taskId, "published");
    if (this.auditStore) this.auditStore.append({
      taskId: receipt.taskId,
      queryArtifactId: receipt.queryArtifactId,
      publicationStatus: receipt.status,
      ...(this.taskEvidence.get(receipt.taskId)?.semanticEvidence?.length ? { semanticEvidenceFingerprint: hash(stable(this.taskEvidence.get(receipt.taskId)!.semanticEvidence)) } : {}),
      reviewAvailability: receipt.reviewOutcome.availability === "unavailable" ? "unavailable" : "available",
      ...(receipt.reviewOutcome.availability === "unavailable" ? { reviewFailure: { ...receipt.reviewOutcome.failure, message: receipt.reviewOutcome.failure.message.slice(0, 2_000) } } : {}),
      ...(receipt.reviewOutcome.availability === "available" ? {
        decision: receipt.reviewOutcome.decision.status,
        ...(receipt.reviewOutcome.decision.reason ? { decisionReason: receipt.reviewOutcome.decision.reason } : {}),
        ...(receipt.reviewOutcome.decision.warnings?.length ? { reviewWarnings: receipt.reviewOutcome.decision.warnings } : {}),
        ...(receipt.reviewOutcome.decision.coverage ? { coverage: receipt.reviewOutcome.decision.coverage } : {}),
        ...(receipt.reviewOutcome.decision.diffs ? { semanticDiffs: receipt.reviewOutcome.decision.diffs } : {}),
        ...(receipt.reviewOutcome.decision.deterministicGates ? { deterministicGates: receipt.reviewOutcome.decision.deterministicGates } : {}),
      } : {}),
      reviewerModel: this.reviewerModel,
      reviewerPromptVersion: this.reviewerPromptVersion,
      reviewPolicyVersion: this.reviewPolicyVersion,
      reviewCoverageSchemaVersion: this.reviewCoverageSchemaVersion,
      hardConstraintAdmissionPolicy: this.hardConstraintAdmissionPolicy,
      gatePolicyVersion: this.gatePolicyVersion,
      gateApplicabilityVersion: this.gateApplicabilityVersion,
      probeTemplateVersion: this.probeTemplateVersion,
      evidenceAdmissionPolicyVersion: this.evidenceAdmissionPolicyVersion,
      repairAttempt: 0,
      reviewMode: receipt.mode,
    });
    this.persistState();
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
