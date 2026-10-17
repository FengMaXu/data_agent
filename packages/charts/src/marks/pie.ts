import { type PieChart } from "@data-agent/contracts";
import type { ChartOption } from "../types.js";
import { PALETTE, displayScale, fieldLabel, fieldTitle, formatValue, headlineDigits } from "../semantics.js";
import { THEME } from "../theme.js";
import { CompileContext, temporalNotice, orderCategories, checkPartOfWhole } from "./shared.js";
import type { MarkDefinition } from "./types.js";

const MAX_STATIC_PIE_SLICES = 12;

/** Slices below this share of the whole get no outside label: their leader lines collide. The legend carries every share. */
const MIN_LABELLED_SHARE = 0.04;

/** A part this large leaves the others as slivers; one number tells it better than a ring. */
const DOMINANT_SHARE = 0.9;

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
  if (context.errors.length > 0) return undefined;
  const order = orderCategories(labels, context.meta(chart.category.field));
  const scale = displayScale(value.meta);
  const total = order.reduce((sum, label) => sum + (value.values[labels.indexOf(label)] ?? 0) * scale, 0);
  const shareOf = (shown: number) => (total > 0 ? shown / total : 0);
  // Slivers keep their slice and legend entry but no leader line, so the labels that remain never overlap.
  const data = order.map((label) => {
    const shown = (value.values[labels.indexOf(label)] ?? 0) * scale;
    return { name: label, value: shown, ...(shareOf(shown) < MIN_LABELLED_SHARE ? { label: { show: false }, labelLine: { show: false } } : {}) };
  });
  const largest = Math.max(0, ...data.map((slice) => shareOf(slice.value)));
  if (largest >= DOMINANT_SHARE) {
    context.notice({ kind: "layout", code: "PIE_DOMINATED", message: `最大的一类占 ${(largest * 100).toFixed(1)}%，其余扇区细到读不出；改用 KPI 卡写出这个占比，或用排序后的条形图比较其余类目`, field: chart.category.field });
  }
  // Each legend entry carries its share, so slices too thin to label are still read.
  const shareByName = new Map(data.map((slice) => {
    const share = shareOf(slice.value) * 100;
    return [slice.name, `${share.toFixed(share < 1 ? 2 : 1)}%`];
  }));
  const donut = chart.donut !== false;
  return {
    color: [...PALETTE],
    ...(context.options.target === "static" ? { animation: false } : {}),
    tooltip: { trigger: "item", formatter: (params: { name: string; value: number; percent: number }) => `${params.name}：${formatValue(params.value, value.meta)}（${params.percent}%）` },
    legend: { bottom: 0, type: labels.length > 8 ? "scroll" : "plain", formatter: (name: string) => `${name}  ${shareByName.get(name) ?? ""}` },
    // The ring's hole holds the whole every share is a part of.
    ...(donut ? {
      graphic: [{
        type: "text",
        left: "center",
        top: "middle",
        style: { text: `${formatValue(total, value.meta, { decimals: headlineDigits(total, value.meta) })}\n合计`, textAlign: "center", fill: THEME.ink, fontSize: 15, fontWeight: 600, lineHeight: 20 },
      }],
    } : {}),
    series: [{
      type: "pie",
      name: fieldTitle(value.field, value.meta),
      // The ring sits at the centre the hole's text is drawn at; room around it lets labels wrap instead of being cut off.
      radius: donut ? ["42%", "62%"] : "60%",
      avoidLabelOverlap: true,
      itemStyle: { borderColor: THEME.surface, borderWidth: 2 },
      data,
      // Name and share on separate lines, wrapping long names: a truncated label would hide the share.
      label: { formatter: "{b}\n{d}%", overflow: "break", lineHeight: 16, color: THEME.inkSoft },
      labelLine: { length: 8, length2: 8, lineStyle: { color: THEME.muted } },
    }],
  };
}

export const pieMark: MarkDefinition<PieChart> = {
  compile: compilePie,
  fields: (chart) => [chart.category.field, chart.value.field],
};
