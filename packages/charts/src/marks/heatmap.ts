import { type HeatmapChart } from "@data-agent/contracts";
import type { ChartOption } from "../types.js";
import { PALETTE, displayScale, fieldLabel, fieldTitle, formatValue } from "../semantics.js";
import { CompileContext, temporalNotice, orderCategories, categoryAxis } from "./shared.js";
import type { MarkDefinition } from "./types.js";

/** Cell labels stay readable up to about this many cells; past it values show in the tooltip only. */
const MAX_LABELLED_CELLS = 150;

/** Light end of a sequential scale and centre of a diverging one. */
const SCALE_LIGHT = "#EEF2F6";

const SCALE_CENTRE = "#F7F7F7";

function compileHeatmap(context: CompileContext, chart: HeatmapChart): ChartOption | undefined {
  const xIndex = context.column(chart.x.field, "/chart/x/field");
  const yIndex = context.column(chart.y.field, "/chart/y/field");
  const color = context.measure(chart.color.field, "/chart/color/field");
  const scale = chart.color.scale ?? "sequential";
  if (scale === "diverging" && chart.color.midpoint === undefined) {
    context.fail({ code: "INVALID_ENCODING", message: "发散色阶必须声明 midpoint", path: "/chart/color/midpoint", hint: "声明对比的基准，例如同比为 0、达成率为 1；不推断中点" });
  }
  if (scale === "sequential" && chart.color.midpoint !== undefined) {
    context.fail({ code: "INVALID_ENCODING", message: "midpoint 只用于 scale: \"diverging\"", path: "/chart/color/midpoint" });
  }
  if (context.spec.selection) context.fail({ code: "INVALID_SELECTION", message: "热力图不支持 top_n：省略行列会改变可比范围", path: "/selection", hint: "在查询中筛选行列" });
  if (context.spec.viewport) context.fail({ code: "INVALID_ENCODING", message: "热力图不支持 viewport", path: "/viewport" });
  if (xIndex === undefined || yIndex === undefined || !color || context.errors.length > 0) return undefined;

  const rows = context.dataset.rows;
  const xMeta = context.meta(chart.x.field);
  const yMeta = context.meta(chart.y.field);
  const xLabels = rows.map((row) => fieldLabel(row[xIndex], xMeta));
  const yLabels = rows.map((row) => fieldLabel(row[yIndex], yMeta));
  temporalNotice(context, chart.x.field, rows.map((row) => row[xIndex]));
  temporalNotice(context, chart.y.field, rows.map((row) => row[yIndex]));
  const seen = new Set<string>();
  for (const [rowIndex, x] of xLabels.entries()) {
    const key = JSON.stringify([x, yLabels[rowIndex]]);
    if (seen.has(key)) {
      context.fail({ code: "DUPLICATE_KEY", message: `单元格 (${x}, ${yLabels[rowIndex]}) 有多行；编译器不合并观测`, path: "/chart/color/field", field: chart.color.field, hint: "在查询中聚合到 (x, y) 粒度，每个单元格一行" });
      return undefined;
    }
    seen.add(key);
  }
  const xCategories = orderCategories(xLabels, xMeta);
  const yCategories = orderCategories(yLabels, yMeta);
  const xAxis = categoryAxis(context, xCategories, false, chart.x.field);
  const yAxis = categoryAxis(context, yCategories, true, chart.y.field);
  if (!xAxis || !yAxis) return undefined;

  const display = displayScale(color.meta);
  const xPosition = new Map(xCategories.map((label, position) => [label, position]));
  const yPosition = new Map(yCategories.map((label, position) => [label, position]));
  const shown = color.values.map((value) => (value === null ? null : value * display));
  // A missing value stays blank ("-"), never zero.
  const data = rows.map((_row, rowIndex) => [xPosition.get(xLabels[rowIndex]!)!, yPosition.get(yLabels[rowIndex]!)!, shown[rowIndex] ?? "-"]);
  const missing = shown.filter((value) => value === null).length;
  if (missing > 0) context.notice({ kind: "layout", code: "NULL_VALUES", message: `${missing} 个单元格缺少数值，按空白显示，未按 0 绘制`, field: color.field });
  const absent = xCategories.length * yCategories.length - rows.length;
  if (absent > 0) context.notice({ kind: "layout", code: "EMPTY_CELLS", message: `${absent} 个行列组合没有数据，按空白显示`, field: color.field });

  const numbers = shown.filter((value): value is number => value !== null);
  const low = numbers.length > 0 ? Math.min(...numbers) : 0;
  const high = numbers.length > 0 ? Math.max(...numbers) : 0;
  let range: { min: number; max: number; colors: string[] };
  if (scale === "diverging") {
    // Symmetric around the declared midpoint, so equal distances get equal colour strength.
    const midpoint = chart.color.midpoint! * display;
    const reach = Math.max(Math.abs(high - midpoint), Math.abs(midpoint - low)) || 1;
    range = { min: midpoint - reach, max: midpoint + reach, colors: [PALETTE[4], SCALE_CENTRE, PALETTE[0]] };
  } else {
    range = { min: low, max: high === low ? low + 1 : high, colors: [SCALE_LIGHT, PALETTE[0]] };
  }
  const format = (value: number) => formatValue(value, color.meta);
  return {
    ...(context.options.target === "static" ? { animation: false } : {}),
    tooltip: {
      trigger: "item",
      formatter: (params: { value: [number, number, number | string] }) => {
        const [x, y, value] = params.value;
        return `${yCategories[y]} · ${xCategories[x]}：${typeof value === "number" ? format(value) : "（空值）"}`;
      },
    },
    grid: { left: 16, right: 24, top: 24, bottom: 64, containLabel: true },
    xAxis: { ...xAxis, splitArea: { show: true } },
    yAxis: { ...yAxis, splitArea: { show: true } },
    visualMap: {
      type: "continuous",
      min: range.min,
      max: range.max,
      calculable: context.options.target === "interactive",
      orient: "horizontal",
      left: "center",
      bottom: 0,
      // Interactive handles label the range themselves; end labels would repeat it.
      ...(context.options.target === "interactive" ? {} : { text: [format(range.max), format(range.min)] }),
      inRange: { color: range.colors },
      formatter: (value: number) => format(value),
    },
    series: [{
      type: "heatmap",
      name: fieldTitle(color.field, color.meta),
      data,
      label: { show: rows.length <= MAX_LABELLED_CELLS, formatter: (params: { value: [number, number, number | string] }) => (typeof params.value[2] === "number" ? format(params.value[2]) : "") },
      emphasis: { itemStyle: { borderColor: "#243142", borderWidth: 1 } },
    }],
  };
}

export const heatmapMark: MarkDefinition<HeatmapChart> = {
  compile: compileHeatmap,
  fields: (chart) => [chart.x.field, chart.y.field, chart.color.field],
};
