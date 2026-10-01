import type { ChartMark, ChartMarkName, ChartSpec } from "@data-agent/contracts";
import type { ChartDataset } from "../types.js";
import type { MarkDefinition } from "./types.js";
import { boxplotMark } from "./boxplot.js";
import { cartesianMark } from "./cartesian.js";
import { funnelMark } from "./funnel.js";
import { heatmapMark } from "./heatmap.js";
import { histogramMark } from "./histogram.js";
import { pieMark } from "./pie.js";
import { sankeyMark } from "./sankey.js";
import { sunburstMark } from "./sunburst.js";
import { treemapMark } from "./treemap.js";
import { waterfallMark } from "./waterfall.js";

/** Every mark the compiler draws. The type makes a mark in the contract without a definition here a compile error. */
export const MARKS: { readonly [Mark in ChartMarkName]: MarkDefinition<Extract<ChartMark, { mark: Mark }>> } = {
  cartesian: cartesianMark,
  pie: pieMark,
  heatmap: heatmapMark,
  histogram: histogramMark,
  boxplot: boxplotMark,
  waterfall: waterfallMark,
  sankey: sankeyMark,
  treemap: treemapMark,
  funnel: funnelMark,
  sunburst: sunburstMark,
};

/** The definition for a chart's own mark. */
export function markOf<C extends ChartMark>(chart: C): MarkDefinition<C> {
  return MARKS[chart.mark] as unknown as MarkDefinition<C>;
}

/** Every column a spec reads: its mark's fields, its selection and its declared semantics. */
export function chartFields(spec: ChartSpec): string[] {
  return [...new Set([...markOf(spec.chart).fields(spec.chart), ...(spec.selection ? [spec.selection.by] : []), ...Object.keys(spec.fields ?? {})])];
}

/**
 * A small dataset a spec compiles against: the mark's example rows, or two
 * distinct rows (numbers for declared measures, text otherwise). For checking
 * documentation examples against the real compiler, never for delivered charts.
 */
export function exampleDataset(spec: ChartSpec): ChartDataset {
  const columns = chartFields(spec);
  const measure = (field: string) => spec.fields?.[field]?.type === "quantitative";
  const rows = markOf(spec.chart).example?.(spec.chart) ?? [{}, {}];
  return { columns, rows: rows.map((row, index) => columns.map((column) => (column in row ? row[column] : measure(column) ? index + 1 : `v${index}`))) };
}
