import { createHash, randomUUID } from "node:crypto";

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
  readonly [key: string]: unknown;
}

/** The task identity returned by Query Assurance before a query is executed. */
export interface PreparedQueryTask {
  readonly taskId: string;
  readonly mode: QueryAssuranceMode;
  readonly specVersion?: string;
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
}

export interface QueryPreviewRegistration {
  readonly task: PreparedQueryTask;
  readonly sql: string;
  readonly result: QueryPreviewResult;
  readonly purpose?: "reconciliation" | "verification";
}

export interface ValidatedQueryArtifact {
  readonly taskId: string;
  readonly queryArtifactId: string;
  readonly normalizedSql: string;
  readonly normalizedSqlHash: string;
  readonly previewMetadata: ResultMetadata;
  readonly internalEvidence: true;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly purpose?: "reconciliation" | "verification";
}

/** Opaque publication input; candidate details belong to later assurance slices. */
export interface PublicationReviewRequest {
  readonly task: PreparedQueryTask;
  readonly candidate: unknown;
}

export type ReviewDecisionStatus = "approved" | "rejected" | "needs_clarification" | "abstained";

/** The available decision envelope, intentionally without reviewer internals. */
export interface ReviewDecision {
  readonly status: ReviewDecisionStatus;
}

export interface ReviewFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

/** Separates a successful reviewer decision from a reviewer that could not run. */
export type ReviewOutcome =
  | { readonly availability: "available"; readonly decision: ReviewDecision }
  | { readonly availability: "unavailable"; readonly failure: ReviewFailure };

export interface QueryAssurance {
  readonly mode: QueryAssuranceMode;
  prepareTask(input: TaskEvidence, signal: AbortSignal): Promise<PreparedQueryTask>;
  recordPreview?(input: QueryPreviewRegistration, signal: AbortSignal): Promise<ValidatedQueryArtifact>;
  getArtifact?(taskId: string, queryArtifactId: string, signal: AbortSignal): Promise<ValidatedQueryArtifact | undefined>;
  reviewForPublication(input: PublicationReviewRequest, signal: AbortSignal): Promise<ReviewOutcome>;
}

export class QueryAssuranceAbortError extends Error {
  readonly code = "QUERY_ASSURANCE_ABORTED";

  constructor() {
    super("Query Assurance operation was aborted");
    this.name = "AbortError";
  }
}

export interface ReviewOffQueryAssuranceOptions {
  artifactTtlMs?: number;
  now?: () => number;
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
  for (const row of result.rows) {
    for (let index = 0; index < columns.length; index += 1) {
      if (row[index] === null || row[index] === undefined) nullCounts[columns[index]] += 1;
    }
  }
  return {
    columns,
    columnTypes,
    rowCount: result.rows.length,
    truncated: result.truncated,
    nullCounts,
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
  readonly mode: QueryAssuranceMode;
  private readonly artifactTtlMs: number;
  private readonly now: () => number;
  private readonly artifacts = new Map<string, Map<string, ValidatedQueryArtifact>>();

  constructor(options: ReviewOffQueryAssuranceOptions = {}) {
    this.mode = "off";
    this.artifactTtlMs = options.artifactTtlMs ?? 5 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  async prepareTask(_input: TaskEvidence, signal: AbortSignal): Promise<PreparedQueryTask> {
    throwIfAborted(signal);
    return { taskId: randomUUID(), mode: this.mode };
  }

  async recordPreview(input: QueryPreviewRegistration, signal: AbortSignal): Promise<ValidatedQueryArtifact> {
    throwIfAborted(signal);
    const normalizedSql = normalizeQuerySql(input.sql);
    const createdAtMs = this.now();
    const artifact: ValidatedQueryArtifact = {
      taskId: input.task.taskId,
      queryArtifactId: randomUUID(),
      normalizedSql,
      normalizedSqlHash: hash(normalizedSql),
      previewMetadata: resultMetadata(input.result),
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

  async reviewForPublication(_input: PublicationReviewRequest, signal: AbortSignal): Promise<ReviewOutcome> {
    throwIfAborted(signal);
    return {
      availability: "unavailable",
      failure: {
        code: "REVIEW_OFF",
        message: "Query Assurance review is disabled",
        retryable: false,
      },
    };
  }
}

/** The default implementation is explicit Review Off and never fabricates approval. */
export function createReviewOffQueryAssurance(options: ReviewOffQueryAssuranceOptions = {}): QueryAssurance {
  return new InMemoryQueryAssurance(options);
}
