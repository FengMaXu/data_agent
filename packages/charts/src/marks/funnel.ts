import { type FunnelChart } from "@data-agent/contracts";
import type { ChartOption } from "../types.js";
import { displayScale, fieldLabel, fieldTitle, formatValue } from "../semantics.js";
import { LABEL_CHAR_PX, CompileContext, refuseSelection } from "./shared.js";
import type { MarkDefinition } from "./types.js";

const MAX_STATIC_FUNNEL_STAGES = 12;
/** Stage labels sit beside the funnel; longer names are truncated. */
const FUNNEL_LABEL_CHARS = 12;

function compileFunnel(context: CompileContext, chart: FunnelChart): ChartOption | undefined {
  refuseSelection(context, "漏斗图");
  const stageIndex = context.column(chart.stage.field, "/chart/stage/field");
  const value = context.measure(chart.value.field, "/chart/value/field");
  if (stageIndex === undefined || !value || context.errors.length > 0) return undefined;
  const stageMeta = context.meta(chart.stage.field);
  const stages = context.dataset.rows.map((row) => fieldLabel(row[stageIndex], stageMeta));
  const duplicate = stages.find((stage, index) => stages.indexOf(stage) !== index);
  if (duplicate !== undefined) {
    context.fail({ code: "DUPLICATE_KEY", message: `阶段 ${duplicate} 有多行；编译器不合并观测`, path: "/chart/stage/field", field: chart.stage.field, hint: "在查询中每个阶段一行" });
    return undefined;
  }
  // A stage's width is its value: a missing or negative one has no width to draw.
  const invalid = value.values.findIndex((item) => item === null || item < 0);
  if (invalid >= 0) {
    context.fail({ code: "VALUE_OUT_OF_DOMAIN", message: `阶段 ${stages[invalid]} 的值为 ${value.values[invalid] ?? "空值"}，漏斗图只能画非负的数值`, path: "/chart/value/field", field: value.field, hint: "在查询中补全各阶段的数值，或改用柱形图" });
    return undefined;
  }
  if (context.options.target === "static" && stages.length > MAX_STATIC_FUNNEL_STAGES) {
    context.fail({ code: "CAPACITY_EXCEEDED", message: `${stages.length} 个阶段超过静态图上限 ${MAX_STATIC_FUNNEL_STAGES}`, field: chart.stage.field, hint: "合并阶段，或改用柱形图" });
    return undefined;
  }
  const numbers = value.values as number[];
  // Stages keep the query's order; a later stage larger than an earlier one is shown as it is.
  if (numbers.some((item, index) => index > 0 && item > numbers[index - 1]!)) {
    context.notice({ kind: "layout", code: "FUNNEL_NOT_MONOTONIC", message: "有阶段的数值大于前一阶段，按查询给出的顺序与数值显示", field: value.field });
  }
  if (stages.some((stage) => stage.length > FUNNEL_LABEL_CHARS)) {
    context.notice({ kind: "layout", code: "LABELS_TRUNCATED", message: `过长的阶段名称截断显示为前 ${FUNNEL_LABEL_CHARS} 个字符左右，完整名称见提示框或数据集`, field: chart.stage.field });
  }
  const scale = displayScale(value.meta);
  const widest = Math.max(0, ...numbers);
  const format = (shown: number) => formatValue(shown, value.meta);
  return {
    color: [...context.palette],
    ...(context.options.target === "static" ? { animation: false } : {}),
    tooltip: { trigger: "item", formatter: (params: { name: string; value: number }) => `${params.name}：${format(params.value)}` },
    series: [{
      type: "funnel",
      name: fieldTitle(value.field, value.meta),
      left: 16, right: FUNNEL_LABEL_CHARS * LABEL_CHAR_PX + 32, top: 16, bottom: 16,
      // Keep stage order: sorting by value would reorder the process.
      sort: "none",
      min: 0,
      max: widest * scale || 1,
      gap: 2,
      data: stages.map((stage, index) => ({ name: stage, value: numbers[index]! * scale })),
      // Each stage shows its own value; conversion rates would be computed numbers.
      // Beside the funnel, where every stage has room: inside, narrow stages and long names would be cut off.
      label: { position: "right", formatter: (params: { name: string; value: number }) => `${params.name}\n${format(params.value)}`, color: "#243142", width: FUNNEL_LABEL_CHARS * LABEL_CHAR_PX, overflow: "truncate" },
      labelLine: { show: true },
      itemStyle: { borderColor: "#ffffff", borderWidth: 1 },
    }],
  };
}

export const funnelMark: MarkDefinition<FunnelChart> = {
  compile: compileFunnel,
  fields: (chart) => [chart.stage.field, chart.value.field],
  example: (chart) => [["v0", 100], ["v1", 40]].map(([stage, count]) => ({ [chart.stage.field]: stage, [chart.value.field]: count })),
};
