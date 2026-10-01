import { type WaterfallChart } from "@data-agent/contracts";
import type { ChartOption } from "../types.js";
import { PALETTE, displayScale, fieldLabel, fieldTitle, formatValue } from "../semantics.js";
import { CompileContext, categoryAxis, valueAxis, refuseSelection } from "./shared.js";
import type { MarkDefinition } from "./types.js";

/** Truthy cells of the optional total column: true, 1, or text such as "true", "1", "total", "合计". */
function isTotal(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  return typeof value === "string" && ["true", "1", "total", "合计", "小计", "总计"].includes(value.trim().toLowerCase());
}

function compileWaterfall(context: CompileContext, chart: WaterfallChart): ChartOption | undefined {
  refuseSelection(context, "瀑布图");
  const stepIndex = context.column(chart.step.field, "/chart/step/field");
  const start = context.measure(chart.start.field, "/chart/start/field");
  const end = context.measure(chart.end.field, "/chart/end/field");
  const totalIndex = chart.total ? context.column(chart.total.field, "/chart/total/field") : undefined;
  if (stepIndex === undefined || !start || !end || context.errors.length > 0) return undefined;
  const scale = displayScale(end.meta);
  if (displayScale(start.meta) !== scale) {
    context.fail({ code: "INVALID_ENCODING", message: "start 与 end 的存储尺度与量级须一致", path: "/fields" });
    return undefined;
  }
  const rows = context.dataset.rows;
  const stepMeta = context.meta(chart.step.field);
  const labels = rows.map((row) => fieldLabel(row[stepIndex], stepMeta));
  const duplicate = labels.find((label, index) => labels.indexOf(label) !== index);
  if (duplicate !== undefined) {
    context.fail({ code: "DUPLICATE_KEY", message: `步骤 ${duplicate} 有多行`, path: "/chart/step/field", field: chart.step.field, hint: "每个步骤一行" });
    return undefined;
  }
  const totals = rows.map((row) => (totalIndex === undefined ? false : isTotal(row[totalIndex])));
  // Steps follow the query's row order: a waterfall is a sequence, and the running totals depend on it.
  for (const [index, label] of labels.entries()) {
    const low = start.values[index] ?? null;
    const high = end.values[index] ?? null;
    if (low === null || high === null) {
      context.fail({ code: "RANGE_INCONSISTENT", message: `步骤 ${label} 缺少起点或终点`, path: "/chart", hint: "在查询中为每一步给出起点与终点" });
      return undefined;
    }
    const previous = index > 0 ? end.values[index - 1] ?? null : null;
    if (totals[index] && low !== 0) {
      context.fail({ code: "RANGE_INCONSISTENT", message: `合计行 ${label} 的起点为 ${low}，合计须从 0 开始`, path: "/chart/start/field", hint: "合计行的 start 为 0，end 为合计值" });
      return undefined;
    }
    if (previous !== null && (totals[index] ? high !== previous : low !== previous)) {
      context.fail({
        code: "RANGE_INCONSISTENT",
        message: totals[index] ? `合计行 ${label} 为 ${high}，与上一步的终点 ${previous} 不一致` : `步骤 ${label} 从 ${low} 开始，与上一步的终点 ${previous} 不衔接`,
        path: "/chart",
        hint: "核对查询中的累计计算；工具不重新累计",
      });
      return undefined;
    }
  }
  const axis = categoryAxis(context, labels, false, chart.step.field);
  if (!axis) return undefined;
  const colorOf = (index: number) => (totals[index] ? PALETTE[0] : end.values[index]! >= start.values[index]! ? PALETTE[2] : PALETTE[4]);
  const format = (value: number) => formatValue(value, end.meta);
  return {
    ...(context.options.target === "static" ? { animation: false } : {}),
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: { dataIndex: number }[]) => {
        const index = params[0]!.dataIndex;
        return `${labels[index]}<br/>${format(start.values[index]! * scale)} → ${format(end.values[index]! * scale)}`;
      },
    },
    grid: { left: 16, right: 24, top: 36, bottom: 16, containLabel: true },
    xAxis: axis,
    yAxis: valueAxis(end.meta, end.field, false),
    series: [
      // An invisible base lifts each bar to where its step begins.
      { type: "bar", stack: "waterfall", silent: true, itemStyle: { color: "transparent" }, emphasis: { disabled: true }, data: labels.map((_label, index) => Math.min(start.values[index]!, end.values[index]!) * scale) },
      {
        type: "bar",
        stack: "waterfall",
        name: fieldTitle(end.field, end.meta),
        // A decrease ends at its bottom edge, so its end-value label goes there.
        data: labels.map((_label, index) => ({ value: Math.abs(end.values[index]! - start.values[index]!) * scale, itemStyle: { color: colorOf(index) }, ...(end.values[index]! < start.values[index]! ? { label: { position: "bottom" } } : {}) })),
        // Each bar is labelled with the query's end value, not a computed difference.
        label: { show: labels.length <= 20, position: "top", formatter: (params: { dataIndex: number }) => format(end.values[params.dataIndex]! * scale) },
      },
    ],
  };
}

export const waterfallMark: MarkDefinition<WaterfallChart> = {
  compile: compileWaterfall,
  fields: (chart) => [chart.step.field, chart.start.field, chart.end.field, ...(chart.total ? [chart.total.field] : [])],
  example: (chart) => [["v0", 0, 100, true], ["v1", 100, 130, false], ["v2", 0, 130, true]].map(([step, start, end, total]) => ({ [chart.step.field]: step, [chart.start.field]: start, [chart.end.field]: end, ...(chart.total ? { [chart.total.field]: total } : {}) })),
};
