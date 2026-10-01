import type { ChartMark } from "@data-agent/contracts";
import type { ChartOption } from "../types.js";
import type { CompileContext } from "./shared.js";

/**
 * Everything the charts package knows about one mark. Adding a mark means a
 * schema in contracts' chart-marks.ts and one module exporting this, registered
 * in marks/index.ts; nothing else branches on the mark.
 */
export interface MarkDefinition<C extends ChartMark> {
  /** Compile the mark, reporting errors and notices on the context; never repair data. */
  compile(context: CompileContext, chart: C): ChartOption | undefined;
  /** Every column the mark reads, in the order the chart names them. */
  fields(chart: C): string[];
  /**
   * Example rows, keyed by column, that satisfy the mark's rules (bins that do
   * not overlap, statistics in order, ...). Omitted when any two distinct rows do.
   */
  example?(chart: C): Record<string, unknown>[];
}
