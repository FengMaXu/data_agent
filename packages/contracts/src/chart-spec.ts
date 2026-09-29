import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

/**
 * ChartSpec v1 (ADR-0008): one serializable chart description shared by chat
 * widgets, dashboards and reports. It carries no data transformation or
 * aggregation and reads its data through a Dataset Reference. v1 implements
 * the cartesian (bar/line/scatter layers), pie, heatmap, histogram, boxplot, waterfall, sankey
 * and treemap marks; further marks are
 * added to the `chart` union without changing existing members.
 */
export const CHART_SPEC_VERSION = 1 as const;

const Strict = { additionalProperties: false } as const;
const Name = Type.String({ minLength: 1 });

export const DatasetRefSchema = Type.Union([
  Type.Object({ kind: Type.Literal("publication"), receiptId: Name }, Strict),
  Type.Object({ kind: Type.Literal("derived"), derivedId: Name }, Strict),
  /** A published result whose query the app may run again on request, publishing each refresh as a new Receipt (ADR-0010). */
  Type.Object({ kind: Type.Literal("live"), receiptId: Name }, Strict),
]);
export type DatasetRef = Static<typeof DatasetRefSchema>;

export const MagnitudeSchema = Type.Union([Type.Literal(1), Type.Literal(1e3), Type.Literal(1e4), Type.Literal(1e6), Type.Literal(1e8)]);
export type Magnitude = Static<typeof MagnitudeSchema>;

export const FieldMetaSchema = Type.Union([
  Type.Object({
    type: Type.Literal("quantitative"),
    label: Type.Optional(Name),
    /** What a stored 0.12 means. */
    storage: Type.Union([Type.Literal("raw"), Type.Literal("ratio"), Type.Literal("percent")]),
    /** Defaults from storage: ratio and percent display as percent, raw as raw. */
    display: Type.Optional(Type.Union([Type.Literal("raw"), Type.Literal("percent")])),
    unit: Type.Optional(Name),
    magnitude: Type.Optional(Type.Object({ stored: MagnitudeSchema, shown: Type.Optional(MagnitudeSchema) }, Strict)),
    additivity: Type.Union([Type.Literal("additive"), Type.Literal("non_additive")]),
  }, Strict),
  Type.Object({
    type: Type.Literal("temporal"),
    label: Type.Optional(Name),
    grain: Type.Union([Type.Literal("year"), Type.Literal("quarter"), Type.Literal("month"), Type.Literal("week"), Type.Literal("day"), Type.Literal("hour"), Type.Literal("minute")]),
    /** "floating" for calendar values without a time zone, otherwise an IANA zone name. */
    zone: Name,
  }, Strict),
  Type.Object({ type: Type.Literal("ordinal"), label: Type.Optional(Name), order: Type.Array(Type.String(), { minItems: 1 }) }, Strict),
  Type.Object({ type: Type.Literal("nominal"), label: Type.Optional(Name) }, Strict),
]);
export type FieldMeta = Static<typeof FieldMetaSchema>;

const FieldRefSchema = Type.Object({ field: Name }, Strict);
const PositionRefSchema = Type.Object({ field: Name, axis: Type.Optional(Type.Union([Type.Literal("left"), Type.Literal("right")])) }, Strict);
const SeriesRefSchema = Type.Object({
  field: Name,
  order: Type.Optional(Type.Array(Type.String())),
  colors: Type.Optional(Type.Record(Type.String(), Type.String({ pattern: "^#[0-9A-Fa-f]{6}$" }))),
}, Strict);

export const ChartLayerSchema = Type.Object({
  type: Type.Union([Type.Literal("bar"), Type.Literal("line"), Type.Literal("scatter")]),
  y: PositionRefSchema,
  /** Splits a long table into one series per value of this field. */
  series: Type.Optional(SeriesRefSchema),
  /** Observation identity for scatter points; repeated coordinates are allowed. */
  id: Type.Optional(FieldRefSchema),
  size: Type.Optional(FieldRefSchema),
  label: Type.Optional(FieldRefSchema),
  /** Only bar and line. Any value but "none" is part-of-whole and must be additive, complete and non-negative. */
  stack: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("stacked"), Type.Literal("percent")])),
  name: Type.Optional(Name),
}, Strict);
export type ChartLayer = Static<typeof ChartLayerSchema>;

export const CartesianChartSchema = Type.Object({
  mark: Type.Literal("cartesian"),
  x: FieldRefSchema,
  layers: Type.Array(ChartLayerSchema, { minItems: 1 }),
  orientation: Type.Optional(Type.Union([Type.Literal("vertical"), Type.Literal("horizontal")])),
}, Strict);
export type CartesianChart = Static<typeof CartesianChartSchema>;

export const PieChartSchema = Type.Object({
  mark: Type.Literal("pie"),
  category: FieldRefSchema,
  value: FieldRefSchema,
  donut: Type.Optional(Type.Boolean()),
}, Strict);
export type PieChart = Static<typeof PieChartSchema>;

/** Two category axes and a colour measure; each (x, y) cell holds at most one row. */
export const HeatmapChartSchema = Type.Object({
  mark: Type.Literal("heatmap"),
  x: FieldRefSchema,
  y: FieldRefSchema,
  color: Type.Object({
    field: Name,
    /** "diverging" colours both sides of a midpoint, which must be declared: it is a judgement, never inferred. */
    scale: Type.Optional(Type.Union([Type.Literal("sequential"), Type.Literal("diverging")])),
    /** In the field's stored units, like the data. */
    midpoint: Type.Optional(Type.Number()),
  }, Strict),
}, Strict);
export type HeatmapChart = Static<typeof HeatmapChartSchema>;

/** Bins computed by the query: one row per bin with its bounds and count. The compiler never bins. */
export const HistogramChartSchema = Type.Object({
  mark: Type.Literal("histogram"),
  start: FieldRefSchema,
  end: FieldRefSchema,
  value: FieldRefSchema,
}, Strict);
export type HistogramChart = Static<typeof HistogramChartSchema>;

/** Five statistics per category, computed by the query. The whisker definition travels with the chart. */
export const BoxplotChartSchema = Type.Object({
  mark: Type.Literal("boxplot"),
  category: FieldRefSchema,
  min: FieldRefSchema,
  q1: FieldRefSchema,
  median: FieldRefSchema,
  q3: FieldRefSchema,
  max: FieldRefSchema,
  /** What the whiskers mean: the data's extremes, or the furthest point within 1.5 IQR. */
  whisker: Type.Union([Type.Literal("min_max"), Type.Literal("iqr_1_5")]),
}, Strict);
export type BoxplotChart = Static<typeof BoxplotChartSchema>;

/**
 * Steps with running totals computed by the query: each row's start and end.
 * Rows flagged in `total` are totals drawn from zero. The compiler never accumulates.
 */
export const WaterfallChartSchema = Type.Object({
  mark: Type.Literal("waterfall"),
  step: FieldRefSchema,
  start: FieldRefSchema,
  end: FieldRefSchema,
  total: Type.Optional(FieldRefSchema),
}, Strict);
export type WaterfallChart = Static<typeof WaterfallChartSchema>;

/** An edge table: one row per (source, target) flow. Node totals are the visual sum of their flows. */
export const SankeyChartSchema = Type.Object({
  mark: Type.Literal("sankey"),
  source: FieldRefSchema,
  target: FieldRefSchema,
  value: FieldRefSchema,
}, Strict);
export type SankeyChart = Static<typeof SankeyChartSchema>;

/** Leaf rows only, each with its full path; parent areas are the visual sum of their leaves. */
export const TreemapChartSchema = Type.Object({
  mark: Type.Literal("treemap"),
  path: Type.Array(FieldRefSchema, { minItems: 1, maxItems: 4 }),
  value: FieldRefSchema,
}, Strict);
export type TreemapChart = Static<typeof TreemapChartSchema>;

export const ChartSelectionSchema = Type.Object({
  kind: Type.Literal("top_n"),
  by: Name,
  n: Type.Integer({ minimum: 1 }),
  order: Type.Union([Type.Literal("desc"), Type.Literal("asc")]),
}, Strict);
export type ChartSelection = Static<typeof ChartSelectionSchema>;

export const ChartViewportSchema = Type.Object({
  mode: Type.Union([Type.Literal("scroll"), Type.Literal("zoom")]),
  window: Type.Integer({ minimum: 1 }),
}, Strict);
export type ChartViewport = Static<typeof ChartViewportSchema>;

export const ChartSpecSchema = Type.Object({
  version: Type.Literal(CHART_SPEC_VERSION),
  title: Type.Optional(Name),
  subtitle: Type.Optional(Name),
  data: DatasetRefSchema,
  /** Model-declared field semantics; Runtime records them as Dataset Annotations. */
  fields: Type.Optional(Type.Record(Type.String(), FieldMetaSchema)),
  chart: Type.Union([CartesianChartSchema, PieChartSchema, HeatmapChartSchema, HistogramChartSchema, BoxplotChartSchema, WaterfallChartSchema, SankeyChartSchema, TreemapChartSchema]),
  selection: Type.Optional(ChartSelectionSchema),
  viewport: Type.Optional(ChartViewportSchema),
}, Strict);
export type ChartSpec = Static<typeof ChartSpecSchema>;

export interface ChartSpecSchemaError {
  readonly path: string;
  readonly message: string;
}

const CHART_SCHEMAS = { cartesian: CartesianChartSchema, pie: PieChartSchema, heatmap: HeatmapChartSchema, histogram: HistogramChartSchema, boxplot: BoxplotChartSchema, waterfall: WaterfallChartSchema, sankey: SankeyChartSchema, treemap: TreemapChartSchema } as const;

/**
 * Structural validation only; semantic checks against data live in @data-agent/charts.
 * A known `mark` is checked against its own schema, so errors name what that mark needs
 * rather than listing every union member's requirements.
 */
export function checkChartSpec(value: unknown): { readonly ok: true; readonly spec: ChartSpec } | { readonly ok: false; readonly errors: readonly ChartSpecSchemaError[] } {
  if (Value.Check(ChartSpecSchema, value)) return { ok: true, spec: value };
  const toError = (prefix: string) => (error: { instancePath: string; message: string }) => ({ path: `${prefix}${error.instancePath}` || "/", message: error.message });
  const all = Value.Errors(ChartSpecSchema, value);
  const chart = value && typeof value === "object" ? (value as { chart?: unknown }).chart : undefined;
  const mark = chart && typeof chart === "object" ? (chart as { mark?: unknown }).mark : undefined;
  const branch = typeof mark === "string" && Object.hasOwn(CHART_SCHEMAS, mark) ? CHART_SCHEMAS[mark as keyof typeof CHART_SCHEMAS] : undefined;
  if (!branch) return { ok: false, errors: all.map(toError("")) };
  const outside = all.filter((error) => error.instancePath !== "/chart" && !error.instancePath.startsWith("/chart/"));
  return { ok: false, errors: [...outside.map(toError("")), ...Value.Errors(branch, chart).map(toError("/chart"))] };
}
