import { checkDashboardSpec, dashboardViewData, type DashboardKpiCard, type DashboardKpiView, type DashboardRowHeight, type DashboardSpec, type DatasetRef, type FieldMeta } from "@data-agent/contracts";
import { compileChart } from "./compile.js";
import { displayScale, formatFieldValue, formatValue, headlineDigits, numericCell, unitText } from "./semantics.js";
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
export function formatDashboardCell(value: unknown, meta: FieldMeta | undefined): string {
  if (value === null || value === undefined) return "";
  const declared = formatFieldValue(value, meta);
  if (declared !== undefined) return declared;
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number" && Number.isFinite(value)) return value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Column header naming the unit once, so cells show bare numbers: "累计销售额（亿元）". */
export function tableColumnHeader(label: string, meta: FieldMeta | undefined): string {
  const unit = meta?.type === "quantitative" ? unitText(meta) : "";
  return unit ? `${label}（${unit}）` : label;
}

/** A table cell: numbers at two decimals, aligned, without the unit the header names; other cells as declared. */
export function formatTableCell(value: unknown, meta: FieldMeta | undefined): string {
  if (meta?.type === "quantitative") {
    const text = formatFieldValue(value, meta, { digits: 2, fixed: true, unit: false });
    if (text !== undefined) return text;
  }
  return formatDashboardCell(value, meta);
}

/** A headline number at about four significant digits, with the full value kept for its tooltip. */
function headline(value: unknown, meta: FieldMeta | undefined, signed: boolean): { text: string; full: string; sign?: number } {
  const full = formatDashboardCell(value, meta);
  const number = numericCell(value);
  if (meta?.type !== "quantitative" || number === null || number === undefined) return { text: full, full };
  const shown = number * displayScale(meta);
  const text = formatValue(shown, meta, { digits: headlineDigits(shown, meta), fixed: true });
  return { text: signed && shown > 0 ? `+${text}` : text, full, sign: Math.sign(shown) };
}

export interface KpiCardDisplay {
  readonly label: string;
  readonly value: string;
  /** The value at full precision, for the tile's tooltip. */
  readonly fullValue: string;
  readonly delta?: {
    readonly label?: string;
    readonly value: string;
    /** Direction of a numeric delta; absent when the delta is not a number. */
    readonly trend?: "up" | "down" | "flat";
  };
}

/** The cells a validated KPI view shows. Values are read, never aggregated. */
export function resolveKpiCards(view: DashboardKpiView, dataset: ChartDataset): KpiCardDisplay[] {
  return view.cards.map((card) => {
    const row = kpiRows(card, dataset)[0];
    const cell = (field: string) => row?.[dataset.columns.indexOf(field)];
    const value = headline(cell(card.value.field), view.fields?.[card.value.field], false);
    const delta = card.delta ? headline(cell(card.delta.field), view.fields?.[card.delta.field], true) : undefined;
    const trend = delta?.sign === undefined ? undefined : delta.sign > 0 ? "up" : delta.sign < 0 ? "down" : "flat";
    return {
      label: card.label ?? view.fields?.[card.value.field]?.label ?? card.value.field,
      value: value.text || "—",
      fullValue: value.full || "—",
      ...(card.delta && delta ? { delta: { ...(card.delta.label ? { label: card.delta.label } : {}), value: delta.text || "—", ...(trend ? { trend } : {}) } } : {}),
    };
  });
}

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
