import { checkDashboardSpec, dashboardViewData, type DashboardKpiCard, type DashboardKpiView, type DashboardSpec, type DatasetRef, type FieldMeta } from "@data-agent/contracts";
import { compileChart } from "./compile.js";
import { formatFieldValue } from "./semantics.js";
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
export function formatDashboardCell(value: unknown, meta: FieldMeta | undefined): string {
  if (value === null || value === undefined) return "";
  const declared = formatFieldValue(value, meta);
  if (declared !== undefined) return declared;
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number" && Number.isFinite(value)) return value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export interface KpiCardDisplay {
  readonly label: string;
  readonly value: string;
  readonly delta?: { readonly label?: string; readonly value: string };
}

/** The cells a validated KPI view shows. Values are read, never aggregated. */
export function resolveKpiCards(view: DashboardKpiView, dataset: ChartDataset): KpiCardDisplay[] {
  return view.cards.map((card) => {
    const row = kpiRows(card, dataset)[0];
    const cell = (field: string) => row?.[dataset.columns.indexOf(field)];
    const value = formatDashboardCell(cell(card.value.field), view.fields?.[card.value.field]);
    const deltaValue = card.delta ? formatDashboardCell(cell(card.delta.field), view.fields?.[card.delta.field]) : "";
    return {
      label: card.label ?? view.fields?.[card.value.field]?.label ?? card.value.field,
      value: value || "—",
      ...(card.delta ? { delta: { ...(card.delta.label ? { label: card.delta.label } : {}), value: deltaValue || "—" } } : {}),
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
