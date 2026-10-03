import { type PieChart } from "@data-agent/contracts";
import type { ChartOption } from "../types.js";
import { displayScale, fieldLabel, fieldTitle, formatValue } from "../semantics.js";
import { THEME } from "../theme.js";
import { CompileContext, temporalNotice, orderCategories, checkPartOfWhole } from "./shared.js";
import type { MarkDefinition } from "./types.js";

const MAX_STATIC_PIE_SLICES = 12;

function compilePie(context: CompileContext, chart: PieChart): ChartOption | undefined {
  const categoryIndex = context.column(chart.category.field, "/chart/category/field");
  const value = context.measure(chart.value.field, "/chart/value/field");
  if (categoryIndex === undefined || !value) return undefined;
  checkPartOfWhole(context, value, value.values, "/chart/value/field");
  const categoryMeta = context.meta(chart.category.field);
  const labels = context.dataset.rows.map((row) => fieldLabel(row[categoryIndex], categoryMeta));
  temporalNotice(context, chart.category.field, context.dataset.rows.map((row) => row[categoryIndex]));
  const duplicate = labels.find((label, index) => labels.indexOf(label) !== index);
  if (duplicate !== undefined) {
    context.fail({ code: "DUPLICATE_KEY", message: `类目 ${duplicate} 有多行；编译器不合并观测`, path: "/chart/category/field", field: chart.category.field, hint: "在查询中按类目聚合，每个类目一行" });
  }
  if (context.options.target === "static" && labels.length > MAX_STATIC_PIE_SLICES) {
    context.fail({ code: "CAPACITY_EXCEEDED", message: `${labels.length} 个扇区超过静态图上限 ${MAX_STATIC_PIE_SLICES}`, field: chart.category.field, hint: "改用排序后的柱形图；需要“其他”项时由查询返回" });
  }
  chart.highlight?.values.forEach((name, index) => {
    if (!labels.includes(name)) context.fail({ code: "VALUE_OUT_OF_DOMAIN", message: `highlight 的值 ${name} 不在数据中`, path: `/chart/highlight/values/${index}`, hint: `可选值：${labels.slice(0, 12).join("、")}` });
  });
  if (context.errors.length > 0) return undefined;
  const order = orderCategories(labels, context.meta(chart.category.field));
  const scale = displayScale(value.meta);
  // Focus + Context, as on cartesian charts: the named slices take the tone, the others recede.
  const focused = new Set(chart.highlight?.values ?? []);
  const styleOf = (label: string) => (chart.highlight ? { itemStyle: focused.has(label) ? { color: THEME[chart.highlight.tone ?? "focus"] } : { color: THEME.context, opacity: 0.6 } } : {});
  const data = order.map((label) => ({ name: label, value: (value.values[labels.indexOf(label)] ?? 0) * scale, ...styleOf(label) }));
  return {
    color: [...context.palette],
    ...(context.options.target === "static" ? { animation: false } : {}),
    tooltip: { trigger: "item", formatter: (params: { name: string; value: number; percent: number }) => `${params.name}：${formatValue(params.value, value.meta)}（${params.percent}%）` },
    legend: { bottom: 0, type: labels.length > 8 ? "scroll" : "plain" },
    series: [{
      type: "pie",
      name: fieldTitle(value.field, value.meta),
      // Leave room around the ring so labels wrap instead of being cut off.
      radius: chart.donut === false ? "60%" : ["36%", "60%"],
      data,
      // Name and share on separate lines, wrapping long names: a truncated label would hide the share.
      label: { formatter: "{b}\n{d}%", overflow: "break", lineHeight: 16 },
    }],
  };
}

export const pieMark: MarkDefinition<PieChart> = {
  compile: compilePie,
  fields: (chart) => [chart.category.field, chart.value.field],
  // Documentation examples name their highlighted slices, so the example rows carry those categories.
  example: (chart) => [...new Set([...(chart.highlight?.values ?? []), "v0", "v1"])].map((label) => ({ [chart.category.field]: label })),
};
