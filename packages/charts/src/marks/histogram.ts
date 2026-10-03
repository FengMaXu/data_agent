import { type HistogramChart } from "@data-agent/contracts";
import type { ChartOption } from "../types.js";
import { axisTitle, displayScale, fieldTitle, formatValue } from "../semantics.js";
import { CompileContext, categoryAxis, valueAxis, refuseSelection } from "./shared.js";
import type { MarkDefinition } from "./types.js";

function compileHistogram(context: CompileContext, chart: HistogramChart): ChartOption | undefined {
  refuseSelection(context, "直方图");
  const start = context.measure(chart.start.field, "/chart/start/field");
  const end = context.measure(chart.end.field, "/chart/end/field");
  const value = context.measure(chart.value.field, "/chart/value/field");
  if (!start || !end || !value || context.errors.length > 0) return undefined;
  const bins = start.values.map((low, index) => ({ low, high: end.values[index] ?? null, count: value.values[index] ?? null, row: index + 1 }));
  const incomplete = bins.find((bin) => bin.low === null || bin.high === null);
  if (incomplete) {
    context.fail({ code: "BIN_OVERLAP", message: `第 ${incomplete.row} 行的区间缺少起点或终点`, path: "/chart/start/field", hint: "在查询中为每个分箱给出起点与终点" });
    return undefined;
  }
  const sorted = [...bins].sort((left, right) => left.low! - right.low!);
  for (const [index, bin] of sorted.entries()) {
    if (bin.high! <= bin.low!) {
      context.fail({ code: "BIN_OVERLAP", message: `第 ${bin.row} 行的区间 [${bin.low}, ${bin.high}) 终点不大于起点`, path: "/chart/end/field" });
      return undefined;
    }
    const next = sorted[index + 1];
    if (next && next.low! < bin.high!) {
      context.fail({ code: "BIN_OVERLAP", message: `区间 [${bin.low}, ${bin.high}) 与 [${next.low}, ${next.high}) 重叠；一个值只能落在一个分箱`, path: "/chart/start/field", hint: "在查询中使用左闭右开、互不重叠的分箱" });
      return undefined;
    }
  }
  const gaps = sorted.filter((bin, index) => index > 0 && bin.low! > sorted[index - 1]!.high!).length;
  if (gaps > 0) context.notice({ kind: "layout", code: "BIN_GAPS", message: `${gaps} 处分箱之间有间隔，按查询给出的区间显示`, field: start.field });
  const nulls = sorted.filter((bin) => bin.count === null).length;
  if (nulls > 0) context.notice({ kind: "layout", code: "NULL_VALUES", message: `${nulls} 个分箱缺少数值，按空白显示，未按 0 绘制`, field: value.field });
  const boundScale = displayScale(start.meta);
  // The axis name carries the unit, so bin bounds show numbers only.
  const bound = (number: number) => (number * boundScale).toLocaleString("zh-CN", { maximumFractionDigits: 4 });
  const labels = sorted.map((bin) => `${bound(bin.low!)}–${bound(bin.high!)}`);
  const axis = categoryAxis(context, labels, false, start.field);
  if (!axis) return undefined;
  const rotated = Boolean((axis.axisLabel as { rotate?: number }).rotate);
  const countScale = displayScale(value.meta);
  return {
    color: [...context.palette],
    ...(context.options.target === "static" ? { animation: false } : {}),
    tooltip: { trigger: "axis", valueFormatter: (shown: number) => formatValue(shown, value.meta) },
    // Rotated labels need room below them before the axis name.
    grid: { left: 16, right: 24, top: 36, bottom: rotated ? 64 : 44, containLabel: true },
    xAxis: { ...axis, name: axisTitle(start.field, start.meta), nameLocation: "middle", nameGap: rotated ? 60 : 28 },
    yAxis: valueAxis(value.meta, value.field, false),
    series: [{
      type: "bar",
      name: fieldTitle(value.field, value.meta),
      // Adjacent bars: bins are intervals on one continuous scale.
      barCategoryGap: gaps > 0 ? "8%" : "0%",
      data: sorted.map((bin) => (bin.count === null ? null : bin.count * countScale)),
      itemStyle: { borderColor: "#ffffff", borderWidth: 1 },
    }],
  };
}

export const histogramMark: MarkDefinition<HistogramChart> = {
  compile: compileHistogram,
  fields: (chart) => [chart.start.field, chart.end.field, chart.value.field],
  example: (chart) => [[0, 10, 3], [10, 20, 5]].map(([start, end, value]) => ({ [chart.start.field]: start, [chart.end.field]: end, [chart.value.field]: value })),
};
