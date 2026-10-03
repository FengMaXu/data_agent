import { type BoxplotChart } from "@data-agent/contracts";
import type { ChartOption } from "../types.js";
import { PALETTE, displayScale, fieldLabel, fieldTitle, formatValue } from "../semantics.js";
import { type Measure, CompileContext, temporalNotice, orderCategories, categoryAxis, valueAxis, refuseSelection } from "./shared.js";
import type { MarkDefinition } from "./types.js";

const WHISKER_TEXT = { min_max: "须线为最小值与最大值", iqr_1_5: "须线为 1.5 倍四分位距以内的最远观测值" } as const;

function compileBoxplot(context: CompileContext, chart: BoxplotChart): ChartOption | undefined {
  refuseSelection(context, "箱线图");
  const categoryIndex = context.column(chart.category.field, "/chart/category/field");
  const roles = (["min", "q1", "median", "q3", "max"] as const).map((role) => context.measure(chart[role].field, `/chart/${role}/field`));
  if (categoryIndex === undefined || roles.some((role) => !role) || context.errors.length > 0) return undefined;
  const stats = roles as Measure[];
  const categoryMeta = context.meta(chart.category.field);
  const labels = context.dataset.rows.map((row) => fieldLabel(row[categoryIndex], categoryMeta));
  temporalNotice(context, chart.category.field, context.dataset.rows.map((row) => row[categoryIndex]));
  const duplicate = labels.find((label, index) => labels.indexOf(label) !== index);
  if (duplicate !== undefined) {
    context.fail({ code: "DUPLICATE_KEY", message: `类目 ${duplicate} 有多行统计量；编译器不合并观测`, path: "/chart/category/field", field: chart.category.field, hint: "在查询中每个类目算一组统计量" });
    return undefined;
  }
  // All five share one axis, so they must share one scale.
  const scale = displayScale(stats[0]!.meta);
  if (stats.some((stat) => displayScale(stat.meta) !== scale)) {
    context.fail({ code: "INVALID_ENCODING", message: "五个统计量的存储尺度与量级须一致", path: "/fields" });
    return undefined;
  }
  for (const [rowIndex, label] of labels.entries()) {
    const values = stats.map((stat) => stat.values[rowIndex] ?? null);
    if (values.some((value) => value === null)) {
      context.fail({ code: "STAT_ORDER_VIOLATION", message: `类目 ${label} 缺少统计量，无法画出箱体`, path: "/chart", hint: "在查询中为每个类目给出完整的五个统计量" });
      return undefined;
    }
    const numbers = values as number[];
    if (numbers.some((value, index) => index > 0 && value < numbers[index - 1]!)) {
      context.fail({ code: "STAT_ORDER_VIOLATION", message: `类目 ${label} 的统计量不满足 最小值 ≤ Q1 ≤ 中位数 ≤ Q3 ≤ 最大值：${numbers.join(", ")}`, path: "/chart", hint: "核对查询中各统计量的计算与列对应关系" });
      return undefined;
    }
  }
  context.notice({ kind: "layout", code: "WHISKER_DEFINITION", message: `${WHISKER_TEXT[chart.whisker]}；统计量由查询计算`, field: stats[2]!.field });
  const order = orderCategories(labels, categoryMeta);
  const axis = categoryAxis(context, order, false, chart.category.field);
  if (!axis) return undefined;
  const meta = stats[2]!.meta;
  const names = ["最小值", "Q1", "中位数", "Q3", "最大值"];
  return {
    color: [...context.palette],
    ...(context.options.target === "static" ? { animation: false } : {}),
    tooltip: {
      trigger: "item",
      formatter: (params: { name: string; value: number[] }) => [params.name, ...params.value.slice(-5).map((shown, index) => `${names[index]}：${formatValue(shown, meta)}`)].join("<br/>"),
    },
    grid: { left: 16, right: 24, top: 36, bottom: 16, containLabel: true },
    xAxis: axis,
    yAxis: { ...valueAxis(meta, stats[2]!.field, false), scale: true },
    series: [{
      type: "boxplot",
      name: fieldTitle(stats[2]!.field, meta),
      data: order.map((label) => stats.map((stat) => stat.values[labels.indexOf(label)]! * scale)),
      itemStyle: { color: "#EEF2F6", borderColor: PALETTE[0] },
    }],
  };
}

export const boxplotMark: MarkDefinition<BoxplotChart> = {
  compile: compileBoxplot,
  fields: (chart) => [chart.category.field, chart.min.field, chart.q1.field, chart.median.field, chart.q3.field, chart.max.field],
  example: (chart) => [0, 1].map((offset) => ({ [chart.category.field]: `v${offset}`, [chart.min.field]: 1 + offset, [chart.q1.field]: 2 + offset, [chart.median.field]: 3 + offset, [chart.q3.field]: 4 + offset, [chart.max.field]: 5 + offset })),
};
