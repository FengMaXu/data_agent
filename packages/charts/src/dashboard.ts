import { checkDashboardSpec, dashboardViewData, type DashboardKpiCard, type DashboardKpiView, type DashboardSpec, type DashboardTableView, type DatasetRef, type FieldMeta } from "@data-agent/contracts";
import { compileChart } from "./compile.js";
import { columnDecimals, displayScale, formatFieldValue, numericCell, unitText, valueDecimals, type FormatOptions } from "./semantics.js";
import type { ChartDataset, ChartErrorCode, PresentationNotice } from "./types.js";

export type DashboardErrorCode = ChartErrorCode | "DUPLICATE_VIEW_ID" | "DATASET_UNAVAILABLE" | "KPI_ROW_NOT_FOUND" | "KPI_ROW_AMBIGUOUS";

export interface DashboardError {
  readonly code: DashboardErrorCode;
  readonly message: string;
  readonly path?: string;
  readonly viewId?: string;
  readonly hint?: string;
}

export interface DashboardViewNotice {
  readonly viewId: string;
  readonly notice: PresentationNotice;
}

export type DashboardValidation =
  | { readonly ok: true; readonly spec: DashboardSpec; readonly notices: readonly DashboardViewNotice[] }
  | { readonly ok: false; readonly errors: readonly DashboardError[] };

/** Key of a Dataset Reference in the map a dashboard embeds, shared by the Runtime and the page. */
export function datasetKey(ref: DatasetRef): string {
  return ref.kind === "derived" ? `derived:${ref.derivedId}` : `${ref.kind}:${ref.receiptId}`;
}

export type DashboardDatasets = Readonly<Record<string, ChartDataset>>;

function cellMatches(cell: unknown, expected: string | number | boolean | null): boolean {
  if (expected === null) return cell === null || cell === undefined;
  return cell !== null && cell !== undefined && String(cell) === String(expected);
}

/** Rows a KPI card reads: those matching `where`, or every row when it has none. */
function kpiRows(card: DashboardKpiCard, dataset: ChartDataset): readonly (readonly unknown[])[] {
  const conditions = Object.entries(card.where ?? {}).map(([field, expected]) => [dataset.columns.indexOf(field), expected] as const);
  return dataset.rows.filter((row) => conditions.every(([index, expected]) => cellMatches(row[index], expected)));
}

/** Display text for one cell: declared semantics first, then the stored value as is. */
export function formatDashboardCell(value: unknown, meta: FieldMeta | undefined, options: FormatOptions = {}): string {
  if (value === null || value === undefined) return "";
  const declared = formatFieldValue(value, meta, options);
  if (declared !== undefined) return declared;
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number" && Number.isFinite(value)) {
    const decimals = options.decimals ?? valueDecimals(value);
    return value.toLocaleString("zh-CN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Notices that only tell the model how the chart was laid out; the page does
 * not show them to readers, whose tooltips already carry the full labels.
 */
const LAYOUT_ONLY_NOTICES: ReadonlySet<string> = new Set(["LABELS_ROTATED", "LABELS_TRUNCATED", "TEMPORAL_UNDECLARED"]);

/** The notices a dashboard reader sees: those about the data, not about label layout. */
export function readerNotices(notices: readonly PresentationNotice[]): PresentationNotice[] {
  return notices.filter((notice) => !LAYOUT_ONLY_NOTICES.has(notice.code));
}

export interface DashboardTableDisplay {
  readonly headers: readonly { readonly label: string; readonly numeric: boolean }[];
  readonly rows: readonly (readonly string[])[];
}

/** Values of one column as shown, before formatting; undefined for cells that are not numbers. */
function shownNumbers(dataset: ChartDataset, index: number, meta: FieldMeta | undefined): number[] {
  const scale = meta?.type === "quantitative" ? displayScale(meta) : 1;
  return dataset.rows.flatMap((row) => {
    const number = numericCell(row[index]);
    return typeof number === "number" && (meta?.type === "quantitative" || typeof row[index] === "number") ? [number * scale] : [];
  });
}

/**
 * A table view as shown: every numeric column with one decimal count, and a
 * declared unit in the header instead of every cell (percent signs stay).
 */
export function resolveTable(view: DashboardTableView, dataset: ChartDataset): DashboardTableDisplay {
  const columns = view.columns ?? dataset.columns.map((field) => ({ field, label: undefined }));
  const fields = view.fields ?? {};
  const layout = columns.map((column) => {
    const meta = fields[column.field];
    const index = dataset.columns.indexOf(column.field);
    const numbers = shownNumbers(dataset, index, meta);
    const numeric = meta?.type === "quantitative" || (meta === undefined && numbers.length > 0 && dataset.rows.every((row) => row[index] === null || row[index] === undefined || typeof row[index] === "number"));
    const title = column.label ?? meta?.label ?? column.field;
    const unit = meta?.type === "quantitative" ? unitText(meta) : "";
    const headerUnit = unit && unit !== "%" && !title.includes(unit) ? `（${unit}）` : "";
    return { index, meta, numeric, decimals: numeric ? columnDecimals(numbers) : undefined, header: { label: `${title}${headerUnit}`, numeric } };
  });
  return {
    headers: layout.map((column) => column.header),
    rows: dataset.rows.map((row) => layout.map((column) => formatDashboardCell(row[column.index], column.meta, column.numeric ? { decimals: column.decimals, unit: false } : {}))),
  };
}

export interface KpiCardDisplay {
  readonly label: string;
  /** The number, without its unit. */
  readonly value: string;
  /** Declared unit shown beside the number; a percent sign stays in `value`. */
  readonly unit?: string;
  readonly delta?: { readonly label?: string; readonly value: string; readonly direction?: "up" | "down" | "flat" };
}

/** The cells a validated KPI view shows. Values are read, never aggregated. */
export function resolveKpiCards(view: DashboardKpiView, dataset: ChartDataset): KpiCardDisplay[] {
  return view.cards.map((card) => {
    const row = kpiRows(card, dataset)[0];
    const cell = (field: string) => row?.[dataset.columns.indexOf(field)];
    const meta = view.fields?.[card.value.field];
    const unit = meta?.type === "quantitative" ? unitText(meta) : "";
    const value = formatDashboardCell(cell(card.value.field), meta, { unit: false });
    const deltaCell = card.delta ? cell(card.delta.field) : undefined;
    const deltaNumber = numericCell(deltaCell);
    const direction = typeof deltaNumber === "number" ? (deltaNumber > 0 ? "up" : deltaNumber < 0 ? "down" : "flat") : undefined;
    const deltaText = card.delta ? formatDashboardCell(deltaCell, view.fields?.[card.delta.field]) : "";
    return {
      label: card.label ?? meta?.label ?? card.value.field,
      value: value || "—",
      ...(value && unit && unit !== "%" ? { unit } : {}),
      ...(card.delta ? { delta: { ...(card.delta.label ? { label: card.delta.label } : {}), value: deltaText ? `${direction === "up" ? "+" : ""}${deltaText}` : "—", ...(direction ? { direction } : {}) } } : {}),
    };
  });
}

/** Calendar text such as 2025-12-01 or 2025-12-01T00:00:00, the shape SQL dates arrive in. */
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Checks a dashboard against the datasets its views reference: the schema,
 * unique view ids, each chart through the compiler, and that every table
 * column and KPI cell exists. It repairs nothing.
 */
export function validateDashboard(value: unknown, datasets: DashboardDatasets): DashboardValidation {
  const checked = checkDashboardSpec(value);
  if (!checked.ok) return { ok: false, errors: checked.errors.map((error) => ({ code: "SCHEMA_INVALID", message: error.message, path: error.path })) };
  const spec = checked.spec;
  const errors: DashboardError[] = [];
  const notices: DashboardViewNotice[] = [];
  const seen = new Set<string>();

  spec.views.forEach((view, index) => {
    const path = `/views/${index}`;
    const viewId = view.id;
    if (seen.has(viewId)) errors.push({ code: "DUPLICATE_VIEW_ID", message: `view id "${viewId}" is used more than once`, path: `${path}/id`, viewId });
    seen.add(viewId);
    const dataset = datasets[datasetKey(dashboardViewData(view))];
    if (!dataset) {
      errors.push({ code: "DATASET_UNAVAILABLE", message: "the view's dataset was not resolved", path: view.type === "chart" ? `${path}/chart/data` : `${path}/data`, viewId });
      return;
    }
    const missing = (field: string, at: string) => {
      if (!dataset.columns.includes(field)) errors.push({ code: "FIELD_NOT_FOUND", message: `column "${field}" is not in the result (columns: ${dataset.columns.join(", ")})`, path: `${path}${at}`, viewId, hint: "use a column name from the published result" });
    };

    if (view.type === "chart") {
      const compiled = compileChart(view.chart, dataset, { target: "interactive" });
      if (!compiled.ok) {
        for (const error of compiled.errors) errors.push({ ...error, path: `${path}/chart${error.path && error.path !== "/" ? error.path : ""}`, viewId });
      } else {
        for (const notice of compiled.notices) notices.push({ viewId, notice });
      }
      return;
    }

    for (const field of Object.keys(view.fields ?? {})) missing(field, `/fields/${field}`);
    if (view.type === "table") {
      view.columns?.forEach((column, columnIndex) => missing(column.field, `/columns/${columnIndex}/field`));
      // Undeclared dates are shown as stored ("2025-12-01" for a month); only a declared grain shortens them.
      for (const field of (view.columns ?? []).map((column) => column.field).concat(view.columns ? [] : dataset.columns)) {
        const index = dataset.columns.indexOf(field);
        const values = dataset.rows.map((row) => row[index]).filter((cell) => cell !== null && cell !== undefined);
        if (index < 0 || view.fields?.[field] || values.length === 0 || !values.every((cell) => typeof cell === "string" && DATE_TEXT.test(cell))) continue;
        notices.push({ viewId, notice: { kind: "layout", code: "TEMPORAL_UNDECLARED", message: `列 "${field}" 是日期但未声明语义，按原样显示；在 fields 中声明 { type: "temporal", grain, zone } 后按粒度显示（如月份显示为 2025-12）`, field } });
      }
      return;
    }

    view.cards.forEach((card, cardIndex) => {
      const at = `/cards/${cardIndex}`;
      missing(card.value.field, `${at}/value/field`);
      if (card.delta) missing(card.delta.field, `${at}/delta/field`);
      for (const field of Object.keys(card.where ?? {})) missing(field, `${at}/where/${field}`);
      if (errors.some((error) => error.path?.startsWith(`${path}${at}/`))) return;
      const matched = kpiRows(card, dataset).length;
      if (matched === 0) errors.push({ code: "KPI_ROW_NOT_FOUND", message: card.where ? "no row matches the card's where" : "the result has no rows", path: `${path}${at}`, viewId, hint: "check the where values against the published result" });
      else if (matched > 1) errors.push({ code: "KPI_ROW_AMBIGUOUS", message: `${matched} rows match; a card shows exactly one cell and never aggregates`, path: `${path}${at}`, viewId, hint: card.where ? "narrow where to one row" : "add where to pick one row, or aggregate in the query" });
    });
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, spec, notices };
}
