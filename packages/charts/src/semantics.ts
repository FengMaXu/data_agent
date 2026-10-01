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

export type TemporalMeta = Extract<FieldMeta, { type: "temporal" }>;

/** ISO-like calendar text: date, optional time, optional zone (Z or an offset). */
const TEMPORAL_TEXT = /^(\d{4})-(\d{2})(?:-(\d{2}))?(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** Whether a temporal cell names an instant (carries Z or an offset) rather than a calendar value. */
export function isZonedTemporal(value: unknown): boolean {
  const text = value instanceof Date ? value.toISOString() : typeof value === "string" ? value : undefined;
  return text !== undefined && TEMPORAL_TEXT.exec(text)?.[7] !== undefined;
}

interface CalendarParts { readonly year: string; readonly month: string; readonly day?: string; readonly hour?: string; readonly minute?: string }

/** Wall-clock parts of an instant in an IANA zone; Intl gives the same answer in browsers and Node. */
function partsInZone(instant: Date, zone: string): CalendarParts | undefined {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant);
    const part = (type: string) => parts.find((item) => item.type === type)?.value;
    const year = part("year");
    const month = part("month");
    return year && month ? { year, month, day: part("day"), hour: part("hour"), minute: part("minute") } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A temporal cell shown at its declared grain. Calendar text is cut, never
 * shifted; an instant is placed in the declared IANA zone. Text that is not
 * ISO-like, or lacks a part the grain needs, is shown as written.
 */
export function temporalLabel(value: unknown, meta: TemporalMeta): string {
  if (value === null || value === undefined) return "（空值）";
  const text = value instanceof Date ? value.toISOString() : String(value);
  const match = TEMPORAL_TEXT.exec(text);
  if (!match) return text;
  const [, year = "", month = "", day, hour, minute, , zone] = match;
  let parts: CalendarParts | undefined = { year, month, ...(day ? { day } : {}), ...(hour ? { hour, minute: minute ?? "00" } : {}) };
  // An instant has a calendar date only in some zone; a floating declaration names none, so the text stays as is.
  if (zone) parts = meta.zone === "floating" ? undefined : partsInZone(new Date(text), meta.zone);
  if (!parts) return text;
  const date = parts.day ? `${parts.year}-${parts.month}-${parts.day}` : undefined;
  switch (meta.grain) {
    case "year": return parts.year;
    case "quarter": return `${parts.year}-Q${Math.ceil(Number(parts.month) / 3)}`;
    case "month": return `${parts.year}-${parts.month}`;
    case "week":
    case "day": return date ?? text;
    case "hour": return date && parts.hour ? `${date} ${parts.hour}:00` : text;
    case "minute": return date && parts.hour ? `${date} ${parts.hour}:${parts.minute ?? "00"}` : text;
  }
}

/** Label of a category cell under its declared semantics. */
export function fieldLabel(value: unknown, meta: FieldMeta | undefined): string {
  return meta?.type === "temporal" ? temporalLabel(value, meta) : categoryLabel(value);
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

/**
 * Decimal places a shown value needs: two at or above 1, enough for three
 * significant digits below it (0.0123), none for whole numbers. Rounding hides
 * digits a reader cannot use, never a value's order of magnitude.
 */
export function valueDecimals(value: number): number {
  const magnitude = Math.abs(value);
  if (Number.isInteger(value) || magnitude === 0) return 0;
  const places = magnitude >= 1 ? 2 : Math.min(8, 2 - Math.floor(Math.log10(magnitude)));
  // Drop trailing zeros so 10.2 needs one place and 14.0 none.
  const rounded = value.toFixed(places).replace(/0+$/, "");
  return rounded.endsWith(".") ? 0 : rounded.length - rounded.indexOf(".") - 1;
}

/** One decimal count for values read side by side, such as a table column. */
export function columnDecimals(values: readonly number[]): number {
  return Math.max(0, ...values.map(valueDecimals));
}

export interface FormatOptions {
  /** Fixed decimal places; by default each value takes what `valueDecimals` gives it. */
  readonly decimals?: number;
  /** False when the unit is shown elsewhere, as in a table header. Percent signs stay. */
  readonly unit?: boolean;
}

export function formatValue(value: number, meta: QuantitativeMeta, options: FormatOptions = {}): string {
  const decimals = options.decimals ?? valueDecimals(value);
  const text = value.toLocaleString("zh-CN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const unit = unitText(meta);
  if (unit === "%") return `${text}%`;
  return unit && options.unit !== false ? `${text} ${unit}` : text;
}

/**
 * Display text for one value under declared semantics, for table cells and tooltips:
 * temporal values at their grain, quantitative values scaled with their unit.
 * Undefined for other fields, nulls and non-numeric measures, so callers show the
 * raw value instead of guessing a scale.
 */
export function formatFieldValue(value: unknown, meta: FieldMeta | undefined, options: FormatOptions = {}): string | undefined {
  if (meta?.type === "temporal") return value === null || value === undefined ? undefined : temporalLabel(value, meta);
  if (meta?.type !== "quantitative") return undefined;
  const number = numericCell(value);
  if (number === null || number === undefined) return undefined;
  return formatValue(number * displayScale(meta), meta, options);
}

/**
 * Decimals for a headline number such as a KPI tile or a bar label: about four
 * significant digits, so a tile reads 4,872 亿元 rather than 4,871.7356 亿元.
 * The cell keeps its full value.
 */
export function headlineDigits(shown: number, meta: QuantitativeMeta): number {
  if (isPercentDisplay(meta)) return 1;
  const size = Math.abs(shown);
  return size >= 1000 ? 0 : size >= 100 ? 1 : 2;
}
