import type { ColumnProfile, PhysicalProfile } from "./model.js";

/** Distinct values are counted exactly up to this bound; past it the count is omitted. */
export const DISTINCT_COUNT_LIMIT = 1000;

/**
 * Plain decimal text, the form mysql2 returns for DECIMAL columns: an optional
 * minus sign, no leading zeros, and an optional fraction. A plus sign,
 * exponent, surrounding spaces or digit separators make the value text.
 */
const DECIMAL_TEXT = /^-?(0|[1-9]\d*)(\.\d+)?$/;

type ValueClass =
  | { readonly kind: "integer" | "decimal"; readonly encodedAs: "number" | "bigint" | "string"; readonly decimal: string }
  | { readonly kind: "text" | "boolean" | "json" };

/** Expand JavaScript exponent notation ("1e+21", "1.5e-7") into plain decimal text. */
function plainDecimal(text: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(text);
  if (!match) return text;
  const [, sign = "", integer = "", fraction = "", exponent = "0"] = match;
  const digits = integer + fraction;
  const point = integer.length + Number(exponent);
  const body = point <= 0
    ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length
      ? `${digits}${"0".repeat(point - digits.length)}`
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return sign + body.replace(/^0+(?=\d)/, "");
}

function classify(value: unknown): ValueClass {
  if (typeof value === "bigint") return { kind: "integer", encodedAs: "bigint", decimal: value.toString() };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { kind: "text" };
    return { kind: Number.isInteger(value) ? "integer" : "decimal", encodedAs: "number", decimal: plainDecimal(String(value)) };
  }
  if (typeof value === "string") return DECIMAL_TEXT.test(value) ? { kind: "decimal", encodedAs: "string", decimal: value } : { kind: "text" };
  if (typeof value === "boolean") return { kind: "boolean" };
  // Dates reach the CSV artifact as ISO text, so they profile as text.
  if (value instanceof Date) return { kind: "text" };
  return { kind: "json" };
}

function isNegative(decimal: string): boolean {
  return decimal.startsWith("-") && !/^-0(\.0+)?$/.test(decimal);
}

function compareMagnitude(left: string, right: string): number {
  const [leftInteger = "", leftFraction = ""] = left.split(".");
  const [rightInteger = "", rightFraction = ""] = right.split(".");
  if (leftInteger.length !== rightInteger.length) return leftInteger.length < rightInteger.length ? -1 : 1;
  if (leftInteger !== rightInteger) return leftInteger < rightInteger ? -1 : 1;
  const width = Math.max(leftFraction.length, rightFraction.length);
  const a = leftFraction.padEnd(width, "0");
  const b = rightFraction.padEnd(width, "0");
  return a === b ? 0 : a < b ? -1 : 1;
}

/** Exact comparison of plain decimal text without converting to floating point. */
export function compareDecimal(left: string, right: string): number {
  const leftNegative = isNegative(left);
  const rightNegative = isNegative(right);
  if (leftNegative !== rightNegative) return leftNegative ? -1 : 1;
  const magnitude = compareMagnitude(left.replace(/^-/, ""), right.replace(/^-/, ""));
  return leftNegative ? -magnitude : magnitude;
}

/** Numbers and bigints compare by value; text, including DECIMAL text, compares as written. */
function distinctKey(value: unknown, valueClass: ValueClass): string {
  if (typeof value === "string") return `s:${value}`;
  if (valueClass.kind === "integer" || valueClass.kind === "decimal") return `n:${valueClass.decimal}`;
  if (value instanceof Date) return `d:${value.toISOString()}`;
  if (typeof value === "boolean") return `b:${value}`;
  return `j:${JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item)}`;
}

function profileColumn(name: string, values: readonly unknown[]): ColumnProfile {
  let nullCount = 0;
  const kinds = new Set<ValueClass["kind"]>();
  const encodings = new Set<"number" | "bigint" | "string">();
  const distinct = new Set<string>();
  let distinctOverflow = false;
  let min: string | undefined;
  let max: string | undefined;
  for (const value of values) {
    if (value === null || value === undefined) {
      nullCount += 1;
      continue;
    }
    const valueClass = classify(value);
    kinds.add(valueClass.kind);
    if (valueClass.kind === "integer" || valueClass.kind === "decimal") {
      encodings.add(valueClass.encodedAs);
      if (min === undefined || compareDecimal(valueClass.decimal, min) < 0) min = valueClass.decimal;
      if (max === undefined || compareDecimal(valueClass.decimal, max) > 0) max = valueClass.decimal;
    }
    if (!distinctOverflow) {
      distinct.add(distinctKey(value, valueClass));
      if (distinct.size > DISTINCT_COUNT_LIMIT) distinctOverflow = true;
    }
  }
  const counted = { nullCount, ...(distinctOverflow ? {} : { distinctCount: distinct.size }) };
  if (kinds.size === 0) return { name, kind: "null", ...counted };
  const numeric = [...kinds].every((kind) => kind === "integer" || kind === "decimal");
  // Numbers and DECIMAL text in one column are different value types, not one numeric column.
  if (numeric && !(encodings.has("string") && encodings.size > 1)) {
    return {
      name,
      kind: kinds.has("decimal") ? "decimal" : "integer",
      ...(encodings.size === 1 ? { encodedAs: [...encodings][0]! } : {}),
      ...counted,
      ...(min !== undefined && max !== undefined ? { min, max } : {}),
    };
  }
  if (kinds.size === 1 && !numeric) return { name, kind: [...kinds][0]!, ...counted };
  return { name, kind: "mixed", ...counted };
}

/**
 * Build the Physical Profile of one stored result by scanning every row. It
 * states observed facts only and never infers scale, unit or additivity.
 */
export function buildPhysicalProfile(result: { readonly columns: readonly string[]; readonly rows: readonly (readonly unknown[])[]; readonly truncated: boolean }): PhysicalProfile {
  return {
    version: 1,
    rowCount: result.rows.length,
    truncated: result.truncated,
    columns: result.columns.map((name, index) => profileColumn(name, result.rows.map((row) => row[index]))),
  };
}
