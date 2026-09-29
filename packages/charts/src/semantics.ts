import type { FieldMeta } from "@data-agent/contracts";

export type QuantitativeMeta = Extract<FieldMeta, { type: "quantitative" }>;

/** The eight-colour business palette, in series order. */
export const PALETTE = ["#4F6980", "#F47942", "#638B66", "#FBB04E", "#B66353", "#849DB1", "#B9AA97", "#7E756D"] as const;

/** Plain decimal text as stored results carry DECIMAL columns; the same rule as the Physical Profile. */
const DECIMAL_TEXT = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/** A measure cell as a number, `null` for SQL NULL, or `undefined` when the cell is not numeric. */
export function numericCell(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && DECIMAL_TEXT.test(value)) return Number(value);
  return undefined;
}

export function categoryLabel(value: unknown): string {
  if (value === null || value === undefined) return "（空值）";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function isPercentDisplay(meta: QuantitativeMeta): boolean {
  return (meta.display ?? (meta.storage === "raw" ? "raw" : "percent")) === "percent";
}

/** The only conversions the compiler performs: ratio to percent, and stored to shown magnitude. */
export function displayScale(meta: QuantitativeMeta): number {
  const percent = isPercentDisplay(meta) && meta.storage === "ratio" ? 100 : 1;
  const magnitude = meta.magnitude ? meta.magnitude.stored / (meta.magnitude.shown ?? meta.magnitude.stored) : 1;
  return percent * magnitude;
}

const MAGNITUDE_PREFIX: Readonly<Record<number, string>> = { 1: "", 1e3: "千", 1e4: "万", 1e6: "百万", 1e8: "亿" };

/** Unit text shown next to values, e.g. "%", "亿元", "kg"; empty when nothing was declared. */
export function unitText(meta: QuantitativeMeta): string {
  if (isPercentDisplay(meta)) return "%";
  const shown = meta.magnitude ? meta.magnitude.shown ?? meta.magnitude.stored : 1;
  return `${MAGNITUDE_PREFIX[shown] ?? ""}${meta.unit ?? ""}`;
}

export function fieldTitle(field: string, meta: FieldMeta | undefined): string {
  return meta?.label ?? field;
}

export function axisTitle(field: string, meta: QuantitativeMeta): string {
  const unit = unitText(meta);
  return unit ? `${fieldTitle(field, meta)}（${unit}）` : fieldTitle(field, meta);
}

export function formatValue(value: number, meta: QuantitativeMeta): string {
  const text = value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
  const unit = unitText(meta);
  return unit === "%" ? `${text}%` : unit ? `${text} ${unit}` : text;
}

/**
 * Display text for one value under declared semantics, for table cells and tooltips.
 * Undefined when the field is not declared quantitative or the value is not numeric,
 * so callers show the raw value instead of guessing a scale.
 */
export function formatFieldValue(value: unknown, meta: FieldMeta | undefined): string | undefined {
  if (meta?.type !== "quantitative") return undefined;
  const number = numericCell(value);
  if (number === null || number === undefined) return undefined;
  return formatValue(number * displayScale(meta), meta);
}
