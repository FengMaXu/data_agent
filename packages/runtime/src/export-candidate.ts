import { createHash, randomUUID } from "node:crypto";
import type { ResultMetadata } from "./query-assurance.js";
import { WorkspaceStore } from "./workspace.js";

export interface ExportCandidateBatch {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
  readonly columnTypes?: readonly string[];
  readonly truncated?: boolean;
}

export interface ExportCandidate {
  readonly candidateId: string;
  readonly taskId: string;
  readonly queryArtifactId: string;
  readonly path: string;
  readonly contentSha256: string;
  readonly metadata: ResultMetadata;
  readonly createdAt: string;
}

export interface ExportCandidateInput {
  readonly taskId: string;
  readonly queryArtifactId: string;
  readonly batches: AsyncIterable<ExportCandidateBatch> | Promise<AsyncIterable<ExportCandidateBatch>>;
  readonly expectedColumns?: readonly string[];
  readonly expectedRows?: "scalar" | "top_n" | "grouped" | "full";
  readonly expectedRowCount?: number;
  readonly maxRows?: number;
}

export interface ExportCandidateStoreOptions {
  now?: () => number;
  maxRows?: number;
}

function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  const escaped = raw.replaceAll('"', '""');
  return typeof value === "string" || /[",\r\n]/.test(raw) ? `"${escaped}"` : escaped;
}

function csvHeaderField(value: string): string { return /[",\r\n]/.test(value) ? csvField(value) : value; }
function inferType(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isInteger(value) ? "INTEGER" : "REAL";
  if (typeof value === "boolean") return "BOOLEAN";
  if (typeof value === "bigint") return "BIGINT";
  if (typeof value === "object") return "JSON";
  return "TEXT";
}
function sameColumns(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }

/** Stores a complete result privately until Delivery Policy authorizes promotion. */
export class ExportCandidateStore {
  private readonly now: () => number;
  private readonly maxRows: number;

  constructor(private readonly workspace: WorkspaceStore, options: ExportCandidateStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxRows = options.maxRows ?? 100_000;
  }

  async create(input: ExportCandidateInput, signal?: AbortSignal): Promise<ExportCandidate> {
    const candidateId = randomUUID();
    const relativePath = `.query-assurance/candidates/${candidateId}.csv`;
    const maxRows = input.maxRows ?? this.maxRows;
    let observedColumns: string[] | undefined;
    let columnTypes: string[] | undefined;
    let rowCount = 0;
    let truncated = false;
    const contentHash = createHash("sha256");
    const nullCounts: Record<string, number> = {};
    const distinct: Array<Set<string>> = [];
    const minMax: Record<string, { min?: unknown; max?: unknown }> = {};
    let headerWritten = false;
    try {
      await this.workspace.writeStream(relativePath, async (write) => {
        let pending = "";
        const append = async (chunk: string) => {
          contentHash.update(chunk, "utf8");
          pending += chunk;
          if (pending.length >= 64 * 1024) { await write(pending); pending = ""; }
        };
        const consume = async (batch: ExportCandidateBatch) => {
          if (!observedColumns) {
            observedColumns = [...batch.columns];
            columnTypes = [...(batch.columnTypes ?? batch.columns.map((_, index) => inferType(batch.rows[0]?.[index])))];
            for (let index = 0; index < observedColumns.length; index += 1) {
              nullCounts[observedColumns[index]] = 0;
              distinct[index] = new Set();
            }
          }
          if (!sameColumns(batch.columns, observedColumns)) throw new Error("CANDIDATE_COLUMNS_CHANGED");
          if (input.expectedColumns && !sameColumns(batch.columns, input.expectedColumns)) throw new Error(`CANDIDATE_COLUMNS_MISMATCH: expected [${input.expectedColumns.join(", ")}] got [${batch.columns.join(", ")}]`);
          if (!headerWritten) { await append(batch.columns.map(csvHeaderField).join(",")); headerWritten = true; }
          truncated ||= Boolean(batch.truncated);
          for (const row of batch.rows) {
            if (row.length !== batch.columns.length) throw new Error("CANDIDATE_ROW_WIDTH_MISMATCH");
            rowCount += 1;
            if (input.expectedRows === "scalar" && rowCount > 1) throw new Error("CANDIDATE_SCALAR_SHAPE_MISMATCH");
            if ((input.expectedRows === "top_n" || input.expectedRows === "grouped") && input.expectedRowCount !== undefined && rowCount > input.expectedRowCount) throw new Error("CANDIDATE_ROW_COUNT_MISMATCH");
            if (rowCount > maxRows) throw new Error("CANDIDATE_ROW_LIMIT_EXCEEDED");
            for (let index = 0; index < row.length; index += 1) {
              if (row[index] === null || row[index] === undefined) nullCounts[batch.columns[index]] += 1;
              else {
                distinct[index].add(JSON.stringify(row[index]));
                const current = minMax[batch.columns[index]];
                if (!current) minMax[batch.columns[index]] = { min: row[index], max: row[index] };
                else {
                  if (current.min === undefined || String(row[index]) < String(current.min)) current.min = row[index];
                  if (current.max === undefined || String(row[index]) > String(current.max)) current.max = row[index];
                }
                if (columnTypes?.[index] === "NULL") columnTypes[index] = inferType(row[index]);
              }
            }
            await append(`\n${row.map(csvField).join(",")}`);
          }
        };
        for await (const batch of await input.batches) await consume(batch);
        if (!headerWritten) throw new Error("CANDIDATE_EMPTY_STREAM");
        if (input.expectedRows === "scalar" && rowCount !== 1) throw new Error("CANDIDATE_SCALAR_SHAPE_MISMATCH");
        if (pending) await write(pending);
      }, signal);
      return {
        candidateId,
        taskId: input.taskId,
        queryArtifactId: input.queryArtifactId,
        path: relativePath,
        contentSha256: contentHash.digest("hex"),
        metadata: {
          columns: observedColumns ?? [],
          columnTypes: columnTypes ?? [],
          rowCount,
          truncated,
          nullCounts,
          ...(observedColumns?.length ? { minMax, distinctCounts: Object.fromEntries(observedColumns.map((column, index) => [column, distinct[index].size])) } : {}),
        },
        createdAt: new Date(this.now()).toISOString(),
      };
    } catch (error) {
      await this.discardPath(relativePath);
      throw error;
    }
  }

  async publish(candidate: ExportCandidate, targetRelativePath: string): Promise<void> {
    try {
      await this.workspace.promote(candidate.path, targetRelativePath);
    } catch (error) {
      // A QueryAssurance publisher may already have promoted the same
      // candidate. Treat that exact existing target as an idempotent success.
      if (!(error instanceof Error) || !/ENOENT|not found/i.test(error.message)) throw error;
      try { await this.workspace.artifact(targetRelativePath); } catch { throw error; }
    }
  }

  async discard(candidate: ExportCandidate): Promise<void> { await this.discardPath(candidate.path); }

  private async discardPath(relativePath: string): Promise<void> {
    try { await this.workspace.delete(relativePath); } catch { /* Candidate may not have been promoted. */ }
  }
}
