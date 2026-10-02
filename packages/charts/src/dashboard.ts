import { checkDashboardSpec, dashboardViewData, type DashboardKpiCard, type DashboardKpiView, type DashboardRowHeight, type DashboardSpec, type DashboardTableView, type DatasetRef, type FieldMeta } from "@data-agent/contracts";
import { compileChart } from "./compile.js";
import { categoryLabel, columnDecimals, displayScale, formatFieldValue, formatValue, headlineDigits, numericCell, unitText, valueDecimals, type FormatOptions } from "./semantics.js";
import type { ChartDataset, ChartErrorCode, PresentationNotice } from "./types.js";

export type DashboardErrorCode =
  | ChartErrorCode
  | "DUPLICATE_VIEW_ID"
  | "DATASET_UNAVAILABLE"
  | "KPI_ROW_NOT_FOUND"
  | "KPI_ROW_AMBIGUOUS"
  | "LAYOUT_UNKNOWN_VIEW"
  | "LAYOUT_DUPLICATE_VIEW"
  | "LAYOUT_VIEW_NOT_PLACED"
  | "LAYOUT_WIDTHS_MISMATCH";

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

/** Advice on how the page reads as a BI dashboard; never blocks a build. */
export interface DashboardLayoutAdvice {
  readonly code: "KPI_NOT_FIRST" | "LONE_CHART_ROWS" | "TABLE_BEFORE_CHARTS" | "LABELS_ROTATED_IN_TILE";
  readonly message: string;
  readonly viewId?: string;
}

export type DashboardValidation =
  | { readonly ok: true; readonly spec: DashboardSpec; readonly notices: readonly DashboardViewNotice[]; readonly advice: readonly DashboardLayoutAdvice[] }
  | { readonly ok: false; readonly errors: readonly DashboardError[] };

/** Key of a Dataset Reference in the map a dashboard embeds, shared by the Runtime and the page. */
export function datasetKey(ref: DatasetRef): string {
  return ref.kind === "derived" ? `derived:${ref.derivedId}` : `${ref.kind}:${ref.receiptId}`;
}

export type DashboardDatasets = Readonly<Record<string, ChartDataset>>;

/** One row of tiles as the page draws it. */
export interface DashboardRow {
  readonly views: readonly string[];
  /** Relative widths, one per view. */
  readonly widths: readonly number[];
  readonly height: DashboardRowHeight;
}

/** Chart height in pixels for each row height; shared by the page and the validator's tile estimate. */
export const ROW_CHART_HEIGHTS: Readonly<Record<DashboardRowHeight, number>> = { compact: 220, standard: 300, tall: 420 };

/** Content width the validator assumes when estimating tile sizes, and the page's gaps and tile padding. */
const PAGE_CONTENT_WIDTH = 1360;
const ROW_GAP = 12;
const TILE_PADDING = 32;

/**
 * The rows a dashboard is drawn in: its declared layout, or, for specs
 * without one, views in order with KPI cards and tables full width and
 * charts two per row unless a view asks for `width: "full"`.
 */
export function dashboardRows(spec: DashboardSpec): DashboardRow[] {
  if (spec.layout) return spec.layout.rows.map((row) => ({ views: row.views, widths: row.widths ?? row.views.map(() => 1), height: row.height ?? "standard" }));
  const rows: DashboardRow[] = [];
  let pending: string[] = [];
  const flush = () => {
    if (pending.length > 0) rows.push({ views: pending, widths: pending.map(() => 1), height: "standard" });
    pending = [];
  };
  for (const view of spec.views) {
    if ((view.width ?? (view.type === "chart" ? "half" : "full")) === "half") {
      pending.push(view.id);
      if (pending.length === 2) flush();
    } else {
      flush();
      rows.push({ views: [view.id], widths: [1], height: "standard" });
    }
  }
  flush();
  return rows;
}

/** Estimated chart canvas of one tile at the nominal page width. */
export function tileChartSize(row: DashboardRow, position: number): { readonly width: number; readonly height: number } {
  const total = row.widths.reduce((sum, width) => sum + width, 0);
  const usable = PAGE_CONTENT_WIDTH - ROW_GAP * (row.views.length - 1);
  return { width: Math.round((usable * row.widths[position]!) / total - TILE_PADDING), height: ROW_CHART_HEIGHTS[row.height] };
}

function layoutErrors(spec: DashboardSpec): DashboardError[] {
  if (!spec.layout) return [];
  const errors: DashboardError[] = [];
  const known = new Set(spec.views.map((view) => view.id));
  const placed = new Set<string>();
  spec.layout.rows.forEach((row, rowIndex) => {
    const path = `/layout/rows/${rowIndex}`;
    if (row.widths && row.widths.length !== row.views.length) {
      errors.push({ code: "LAYOUT_WIDTHS_MISMATCH", message: `row has ${row.views.length} views but ${row.widths.length} widths`, path: `${path}/widths`, hint: "give one width per view, or omit widths for equal tiles" });
    }
    row.views.forEach((viewId, position) => {
      const at = `${path}/views/${position}`;
      if (!known.has(viewId)) errors.push({ code: "LAYOUT_UNKNOWN_VIEW", message: `no view has id "${viewId}"`, path: at, hint: `view ids: ${[...known].join(", ")}` });
      else if (placed.has(viewId)) errors.push({ code: "LAYOUT_DUPLICATE_VIEW", message: `view "${viewId}" is placed more than once`, path: at, viewId });
      placed.add(viewId);
    });
  });
  for (const viewId of known) {
    if (!placed.has(viewId)) errors.push({ code: "LAYOUT_VIEW_NOT_PLACED", message: `view "${viewId}" is in no layout row`, path: "/layout/rows", viewId, hint: "add it to a row, or remove the view" });
  }
  return errors;
}

/** How the page reads as a BI dashboard: a KPI row first, charts sharing rows, detail last. */
function layoutAdvice(spec: DashboardSpec, rows: readonly DashboardRow[], rotated: ReadonlySet<string>): DashboardLayoutAdvice[] {
  const advice: DashboardLayoutAdvice[] = [];
  const typeOf = new Map(spec.views.map((view) => [view.id, view.type]));
  const firstKpi = rows.findIndex((row) => row.views.some((viewId) => typeOf.get(viewId) === "kpi"));
  if (firstKpi > 0) advice.push({ code: "KPI_NOT_FIRST", message: "KPI 不在第一行；BI 看板先给头部指标，再给图表" });
  const lone = rows.filter((row) => row.views.length === 1 && typeOf.get(row.views[0]!) === "chart");
  if (lone.length > 1) {
    advice.push({ code: "LONE_CHART_ROWS", message: `${lone.length} 张图各占一整行（${lone.map((row) => row.views[0]).join("、")}），页面会拉长成报告；把图两三张一行放进 layout.rows，只给主趋势图整行` });
  }
  const lastChartRow = rows.reduce((last, row, index) => (row.views.some((viewId) => typeOf.get(viewId) === "chart") ? index : last), -1);
  rows.forEach((row, index) => {
    for (const viewId of row.views) {
      if (typeOf.get(viewId) === "table" && index < lastChartRow) advice.push({ code: "TABLE_BEFORE_CHARTS", message: `表格 ${viewId} 排在图表之前；明细表放在最后`, viewId });
    }
  });
  for (const viewId of rotated) {
    advice.push({ code: "LABELS_ROTATED_IN_TILE", message: `${viewId} 的类目标签在格子里放不下，被旋转显示；改为 orientation: "horizontal"，或给它更宽的格子`, viewId });
  }
  return advice;
}

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
    // A missing number stays blank, as charts leave a gap; a missing label reads as charts name it, not as an unnamed row.
    rows: dataset.rows.map((row) => layout.map((column) => (column.numeric
      ? formatDashboardCell(row[column.index], column.meta, { decimals: column.decimals, unit: false })
      : row[column.index] === null || row[column.index] === undefined ? categoryLabel(null) : formatDashboardCell(row[column.index], column.meta)))),
  };
}

export interface KpiCardDisplay {
  readonly label: string;
  /** The number at headline precision, without its unit; a percent sign stays. */
  readonly value: string;
  /** Declared unit shown beside the number. */
  readonly unit?: string;
  /** The value at full precision with its unit, for the tile's tooltip. */
  readonly fullValue: string;
  readonly delta?: { readonly label?: string; readonly value: string; readonly direction?: "up" | "down" | "flat" };
}

/** A headline number: about four significant digits, so a tile reads 4,872 rather than 4,871.7356. */
function headlineText(value: unknown, meta: FieldMeta | undefined, unit: boolean): string {
  const number = numericCell(value);
  if (meta?.type !== "quantitative" || typeof number !== "number") return formatDashboardCell(value, meta, unit ? {} : { unit: false });
  const shown = number * displayScale(meta);
  return formatValue(shown, meta, { decimals: headlineDigits(shown, meta), unit });
}

/** The cells a validated KPI view shows. Values are read, never aggregated. */
export function resolveKpiCards(view: DashboardKpiView, dataset: ChartDataset): KpiCardDisplay[] {
  return view.cards.map((card) => {
    const row = kpiRows(card, dataset)[0];
    const cell = (field: string) => row?.[dataset.columns.indexOf(field)];
    const meta = view.fields?.[card.value.field];
    const unit = meta?.type === "quantitative" ? unitText(meta) : "";
    const value = headlineText(cell(card.value.field), meta, false);
    const deltaCell = card.delta ? cell(card.delta.field) : undefined;
    const deltaNumber = numericCell(deltaCell);
    const direction = typeof deltaNumber === "number" ? (deltaNumber > 0 ? "up" : deltaNumber < 0 ? "down" : "flat") : undefined;
    const deltaText = card.delta ? headlineText(deltaCell, view.fields?.[card.delta.field], true) : "";
    return {
      label: card.label ?? meta?.label ?? card.value.field,
      value: value || "—",
      ...(value && unit && unit !== "%" ? { unit } : {}),
      fullValue: formatDashboardCell(cell(card.value.field), meta) || "—",
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
  const errors: DashboardError[] = layoutErrors(spec);
  const notices: DashboardViewNotice[] = [];
  const seen = new Set<string>();
  const rows = errors.length > 0 ? [] : dashboardRows(spec);
  const tiles = new Map(rows.flatMap((row) => row.views.map((viewId, position) => [viewId, tileChartSize(row, position)] as const)));
  const rotated = new Set<string>();

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
      // Compiled at the tile's estimated size, so layout notices match what the page will show.
      const compiled = compileChart(view.chart, dataset, { target: "interactive", density: "compact", ...(tiles.get(viewId) ?? {}) });
      if (!compiled.ok) {
        for (const error of compiled.errors) errors.push({ ...error, path: `${path}/chart${error.path && error.path !== "/" ? error.path : ""}`, viewId });
      } else {
        for (const notice of compiled.notices) notices.push({ viewId, notice });
        if (compiled.notices.some((notice) => notice.code === "LABELS_ROTATED")) rotated.add(viewId);
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

  return errors.length > 0 ? { ok: false, errors } : { ok: true, spec, notices, advice: layoutAdvice(spec, rows, rotated) };
}
