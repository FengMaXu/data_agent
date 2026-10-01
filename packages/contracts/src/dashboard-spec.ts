import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { ChartSpecSchema, DatasetRefSchema, FieldMetaSchema, checkChartSpec, type DatasetRef } from "./chart-spec.js";

/**
 * DashboardSpec v1 (ADR-0008 step 4): a snapshot dashboard whose views are
 * ChartSpecs, tables and KPI cards. Every view reads one Dataset Reference;
 * a live binding is added later as another DatasetRef kind, not a new spec.
 */
export const DASHBOARD_SPEC_VERSION = 1 as const;

const Strict = { additionalProperties: false } as const;
const Name = Type.String({ minLength: 1 });
const ViewId = Type.String({ pattern: "^[A-Za-z0-9_\\-]{1,64}$" });
/** Placement used only when the spec has no `layout`: kept so dashboards built before rows still open and refresh. */
const Width = Type.Optional(Type.Union([Type.Literal("half"), Type.Literal("full")]));
const Fields = Type.Optional(Type.Record(Type.String(), FieldMetaSchema));

export const DashboardChartViewSchema = Type.Object({
  id: ViewId,
  type: Type.Literal("chart"),
  /** Title and subtitle come from the ChartSpec. */
  chart: ChartSpecSchema,
  width: Width,
}, Strict);

export const DashboardTableViewSchema = Type.Object({
  id: ViewId,
  type: Type.Literal("table"),
  title: Type.Optional(Name),
  subtitle: Type.Optional(Name),
  data: DatasetRefSchema,
  /** Shown in this order; all columns when omitted. */
  columns: Type.Optional(Type.Array(Type.Object({ field: Name, label: Type.Optional(Name) }, Strict), { minItems: 1 })),
  /** Declared semantics format numeric columns; undeclared values are shown as stored. */
  fields: Fields,
  width: Width,
}, Strict);

const CellValue = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]);

export const DashboardKpiCardSchema = Type.Object({
  label: Type.Optional(Name),
  /** The cell shown; never aggregated. */
  value: Type.Object({ field: Name }, Strict),
  /** A second cell of the same row, such as a change rate computed by the query. */
  delta: Type.Optional(Type.Object({ field: Name, label: Type.Optional(Name) }, Strict)),
  /** Picks exactly one row by column values; without it the result must have exactly one row. */
  where: Type.Optional(Type.Record(Type.String(), CellValue)),
}, Strict);
export type DashboardKpiCard = Static<typeof DashboardKpiCardSchema>;

export const DashboardKpiViewSchema = Type.Object({
  id: ViewId,
  type: Type.Literal("kpi"),
  title: Type.Optional(Name),
  subtitle: Type.Optional(Name),
  data: DatasetRefSchema,
  cards: Type.Array(DashboardKpiCardSchema, { minItems: 1, maxItems: 8 }),
  fields: Fields,
  width: Width,
}, Strict);

export const DashboardViewSchema = Type.Union([DashboardChartViewSchema, DashboardTableViewSchema, DashboardKpiViewSchema]);
export type DashboardChartView = Static<typeof DashboardChartViewSchema>;
export type DashboardTableView = Static<typeof DashboardTableViewSchema>;
export type DashboardKpiView = Static<typeof DashboardKpiViewSchema>;
export type DashboardView = Static<typeof DashboardViewSchema>;

/** Chart height of a row's tiles; KPI tiles and tables size to their content. */
export const DashboardRowHeightSchema = Type.Union([Type.Literal("compact"), Type.Literal("standard"), Type.Literal("tall")]);
export type DashboardRowHeight = Static<typeof DashboardRowHeightSchema>;

/** One row of tiles, left to right: a BI page is a few rows of two to four tiles, not one view per screen. */
export const DashboardLayoutRowSchema = Type.Object({
  views: Type.Array(ViewId, { minItems: 1, maxItems: 4 }),
  /** Relative tile widths, one per view; equal when omitted. */
  widths: Type.Optional(Type.Array(Type.Integer({ minimum: 1, maximum: 12 }), { minItems: 1, maxItems: 4 })),
  height: Type.Optional(DashboardRowHeightSchema),
}, Strict);
export type DashboardLayoutRow = Static<typeof DashboardLayoutRowSchema>;

export const DashboardLayoutSchema = Type.Object({
  /** Every view appears in exactly one row. */
  rows: Type.Array(DashboardLayoutRowSchema, { minItems: 1, maxItems: 20 }),
}, Strict);
export type DashboardLayout = Static<typeof DashboardLayoutSchema>;

export const DashboardSpecSchema = Type.Object({
  version: Type.Literal(DASHBOARD_SPEC_VERSION),
  title: Name,
  subtitle: Type.Optional(Name),
  /** File name under dashboards/, without extension. */
  filename: Type.Optional(Type.String({ pattern: "^[A-Za-z0-9_\\-\\u4e00-\\u9fa5]{1,80}$" })),
  views: Type.Array(DashboardViewSchema, { minItems: 1, maxItems: 40 }),
  /** Rows of tiles; without it views are laid out in order, KPI and tables full width, charts two per row. */
  layout: Type.Optional(DashboardLayoutSchema),
}, Strict);
export type DashboardSpec = Static<typeof DashboardSpecSchema>;

export interface DashboardSpecSchemaError {
  readonly path: string;
  readonly message: string;
}

const VIEW_SCHEMAS = { chart: DashboardChartViewSchema, table: DashboardTableViewSchema, kpi: DashboardKpiViewSchema } as const;

/**
 * Structural validation only; checks against data live in @data-agent/charts.
 * Like checkChartSpec, a view with a known `type` reports only its own schema's
 * errors, and a chart view reports the errors of its declared mark.
 */
export function checkDashboardSpec(value: unknown): { readonly ok: true; readonly spec: DashboardSpec } | { readonly ok: false; readonly errors: readonly DashboardSpecSchemaError[] } {
  if (Value.Check(DashboardSpecSchema, value)) return { ok: true, spec: value };
  const toError = (prefix: string) => (error: { instancePath: string; message: string }) => ({ path: `${prefix}${error.instancePath}` || "/", message: error.message });
  const views = value && typeof value === "object" ? (value as { views?: unknown }).views : undefined;
  if (!Array.isArray(views)) return { ok: false, errors: Value.Errors(DashboardSpecSchema, value).map(toError("")) };
  const outside = Value.Errors(DashboardSpecSchema, value).filter((error) => !/^\/views\/\d+/.test(error.instancePath)).map(toError(""));
  const inside = views.flatMap((view, index) => {
    const prefix = `/views/${index}`;
    const type = view && typeof view === "object" ? (view as { type?: unknown }).type : undefined;
    const schema = typeof type === "string" && Object.hasOwn(VIEW_SCHEMAS, type) ? VIEW_SCHEMAS[type as keyof typeof VIEW_SCHEMAS] : undefined;
    if (!schema) return Value.Check(DashboardViewSchema, view) ? [] : [{ path: `${prefix}/type`, message: "must be one of chart, table, kpi" }];
    if (Value.Check(schema, view)) return [];
    const errors = Value.Errors(schema, view).filter((error) => type !== "chart" || (error.instancePath !== "/chart" && !error.instancePath.startsWith("/chart/"))).map(toError(prefix));
    if (type !== "chart") return errors;
    const chart = checkChartSpec((view as { chart?: unknown }).chart);
    return [...errors, ...(chart.ok ? [] : chart.errors.map((error) => ({ path: `${prefix}/chart${error.path === "/" ? "" : error.path}`, message: error.message })))];
  });
  return { ok: false, errors: [...outside, ...inside] };
}

/** The Dataset Reference each view reads, in view order. */
export function dashboardViewData(view: DashboardView): DatasetRef {
  return view.type === "chart" ? view.chart.data : view.data;
}
