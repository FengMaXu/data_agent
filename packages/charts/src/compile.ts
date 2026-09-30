import { checkChartSpec } from "@data-agent/contracts";
import type { ChartCompileOptions, ChartCompileResult, ChartDataset, ChartError, PresentationNotice } from "./types.js";
import { markOf } from "./marks/index.js";
import { CompileContext } from "./marks/shared.js";

/**
 * Compile a ChartSpec against its resolved dataset. The compiler never
 * aggregates, merges observations or drops data on its own; everything it
 * does to presentation is reported as a Presentation Notice.
 */
export function compileChart(input: unknown, dataset: ChartDataset, options: ChartCompileOptions): ChartCompileResult {
  const checked = checkChartSpec(input);
  if (!checked.ok) return { ok: false, errors: checked.errors.map((error) => ({ code: "SCHEMA_INVALID", message: error.message, path: error.path })) };
  const context = new CompileContext(checked.spec, dataset, options);
  const chart = checked.spec.chart;
  const option = markOf(chart).compile(context, chart);
  if (context.errors.length > 0 || !option) return { ok: false, errors: context.errors };
  return { ok: true, spec: checked.spec, option, notices: context.notices };
}

/** Validate a ChartSpec against its dataset without keeping the compiled option. */
export function validateChart(input: unknown, dataset: ChartDataset, options: ChartCompileOptions): { readonly ok: true; readonly notices: readonly PresentationNotice[] } | { readonly ok: false; readonly errors: readonly ChartError[] } {
  const result = compileChart(input, dataset, options);
  return result.ok ? { ok: true, notices: result.notices } : result;
}
