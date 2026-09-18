import { createHash } from "node:crypto";

export type ResultEvidenceCompleteness = "complete" | "partial";

/**
 * Data supplied to the blind reviewer. It is deliberately separate from the
 * publication/audit record: a reviewer may inspect values, while audit logs
 * retain only identities and statistics.
 */
export interface ResultEvidence {
  readonly completeness: ResultEvidenceCompleteness;
  readonly rowCount: number;
  readonly columns: readonly string[];
  /** Complete rows when the result fits the review evidence budget. */
  readonly rows?: readonly (readonly unknown[])[];
  readonly numericColumns: readonly string[];
  /** Values aligned with numericColumns and rows retained in this envelope. */
  readonly numericRows: readonly (readonly unknown[])[];
  readonly numericCompleteness: ResultEvidenceCompleteness;
  /** Stable hash of the rows represented by this evidence envelope. */
  readonly evidenceHash: string;
}

export interface ResultEvidenceOptions {
  readonly maxRows?: number;
  readonly maxBytes?: number;
  readonly maxNumericRows?: number;
  /** Raw rows are opt-in; numeric evidence is the safe default for external reviewers. */
  readonly includeRows?: boolean;
}

const DEFAULT_MAX_ROWS = 2_000;
const DEFAULT_MAX_BYTES = 256 * 1024;
const DEFAULT_MAX_NUMERIC_ROWS = 10_000;

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? `${item}n` : item);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function isNumericValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "bigint") return true;
  if (typeof value === "string" && value.trim()) return Number.isFinite(Number(value));
  return false;
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)]));
  return value;
}

/** Build bounded but explicit value evidence from a preview or export stream. */
export function buildResultEvidence(
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
  truncated: boolean,
  options: ResultEvidenceOptions = {},
  totalRowCount = rows.length,
): ResultEvidence {
  const maxRows = Math.max(0, Math.floor(options.maxRows ?? DEFAULT_MAX_ROWS));
  const maxBytes = Math.max(0, Math.floor(options.maxBytes ?? DEFAULT_MAX_BYTES));
  const maxNumericRows = Math.max(0, Math.floor(options.maxNumericRows ?? DEFAULT_MAX_NUMERIC_ROWS));
  const allRowsJson = stableJson(rows);
  const evidenceHash = createHash("sha256").update(stableJson({ columns, rowCount: totalRowCount, truncated, rows }), "utf8").digest("hex");
  const retainedRows: readonly (readonly unknown[])[] = rows.slice(0, maxRows).map((row) => row.map(jsonSafe));
  const rowsFitBudget = Boolean(options.includeRows) && !truncated && totalRowCount === rows.length && rows.length <= maxRows && byteLength(allRowsJson) <= maxBytes;
  const rowForNumeric = rows.slice(0, maxNumericRows);
  const numericColumns = columns.filter((_column, index) => {
    const values = rows.map((row) => row[index]).filter((value) => value !== null && value !== undefined);
    return values.length > 0 && values.every(isNumericValue);
  });
  const numericRows: unknown[][] = [];
  let numericBytes = 0;
  for (const row of rowForNumeric) {
    const projected = numericColumns.map((column) => jsonSafe(row[columns.indexOf(column)] ?? null));
    const encoded = stableJson(projected);
    const separatorBytes = numericRows.length > 0 ? 1 : 0;
    if (numericBytes + separatorBytes + byteLength(encoded) > maxBytes) break;
    numericRows.push(projected);
    numericBytes += separatorBytes + byteLength(encoded);
  }
  const numericComplete = !truncated
    && totalRowCount === rows.length
    && rows.length <= maxNumericRows
    && numericRows.length === rowForNumeric.length;
  return {
    completeness: rowsFitBudget ? "complete" : "partial",
    rowCount: totalRowCount,
    columns: [...columns],
    ...(rowsFitBudget ? { rows: retainedRows } : {}),
    numericColumns,
    numericRows,
    numericCompleteness: numericComplete && totalRowCount === rows.length ? "complete" : "partial",
    evidenceHash,
  };
}
