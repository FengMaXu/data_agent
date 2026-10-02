import { type CartesianChart, type ChartLayer } from "@data-agent/contracts";
import type { ChartOption } from "../types.js";
import { PALETTE, axisTitle, categoryLabel, displayScale, fieldLabel, fieldTitle, formatValue, headlineDigits, isPercentDisplay, numericCell, unitText, type QuantitativeMeta } from "../semantics.js";
import { THEME } from "../theme.js";
import { type Measure, CompileContext, temporalNotice, orderCategories, seriesGroups, categoryAxis, viewportZoom, valueAxis, checkPartOfWhole, applySelection } from "./shared.js";
import type { MarkDefinition } from "./types.js";

interface LayerPlan {
  readonly layer: ChartLayer;
  readonly index: number;
  readonly y: Measure;
  readonly seriesIndex?: number;
  readonly size?: Measure;
  readonly labelIndex?: number;
  readonly idIndex?: number;
}

function planLayers(context: CompileContext, chart: CartesianChart, valueX: boolean): LayerPlan[] {
  const plans: LayerPlan[] = [];
  chart.layers.forEach((layer, index) => {
    const path = `/chart/layers/${index}`;
    const stack = layer.stack ?? "none";
    if (layer.type === "scatter" && stack !== "none") context.fail({ code: "INVALID_ENCODING", message: "scatter 不能堆叠", path: `${path}/stack` });
    if (layer.type !== "scatter" && (layer.size || layer.id)) context.fail({ code: "INVALID_ENCODING", message: "size 与 id 只用于 scatter", path });
    if (chart.orientation === "horizontal" && layer.y.axis === "right") context.fail({ code: "INVALID_ENCODING", message: "横向图不支持右侧数值轴", path: `${path}/y/axis` });
    // Horizontal swaps only category bars and lines; points would need their coordinates swapped too.
    if (chart.orientation === "horizontal" && (layer.type === "scatter" || layer.type === "area" || valueX)) context.fail({ code: "INVALID_ENCODING", message: "横向图只支持类目 x 轴上的 bar 与 line", path: "/chart/orientation" });
    if (valueX && layer.type === "bar") context.fail({ code: "INVALID_ENCODING", message: "x 字段声明为 quantitative 时只能使用 line、area 或 scatter，bar 需要类目 x 轴", path: `${path}/type` });
    if (valueX && stack !== "none") context.fail({ code: "INVALID_ENCODING", message: "数值 x 轴不支持堆叠", path: `${path}/stack` });
    const y = context.measure(layer.y.field, `${path}/y/field`);
    const seriesIndex = layer.series ? context.column(layer.series.field, `${path}/series/field`) : undefined;
    const size = layer.size ? context.measure(layer.size.field, `${path}/size/field`) : undefined;
    const labelIndex = layer.label ? context.column(layer.label.field, `${path}/label/field`) : undefined;
    const idIndex = layer.id ? context.column(layer.id.field, `${path}/id/field`) : undefined;
    if (y) plans.push({ layer, index, y, ...(seriesIndex !== undefined ? { seriesIndex } : {}), ...(size ? { size } : {}), ...(labelIndex !== undefined ? { labelIndex } : {}), ...(idIndex !== undefined ? { idIndex } : {}) });
  });
  return plans;
}

function seriesName(baseName: string, group: string, layerCount: number): string {
  if (!group) return baseName;
  return layerCount > 1 ? `${baseName} · ${group}` : group;
}

function compileCartesian(context: CompileContext, chart: CartesianChart): ChartOption | undefined {
  const xIndex = context.column(chart.x.field, "/chart/x/field");
  const xMeta = context.meta(chart.x.field);
  const valueX = xMeta?.type === "quantitative";
  const horizontal = chart.orientation === "horizontal";
  const plans = planLayers(context, chart, valueX);
  if (valueX && context.spec.selection) context.fail({ code: "INVALID_SELECTION", message: "x 为数值轴时不支持 top_n", path: "/selection" });
  if (xIndex === undefined || context.errors.length > 0) return undefined;

  const rows = context.dataset.rows;
  const xLabels = rows.map((row) => fieldLabel(row[xIndex], xMeta));
  temporalNotice(context, chart.x.field, rows.map((row) => row[xIndex]));
  let xNumbers: readonly (number | null)[] = [];
  if (valueX) {
    const measured = context.measure(chart.x.field, "/chart/x/field");
    if (!measured) return undefined;
    // Shown values, as for y: the axis labels and tooltip read them with the field's unit.
    const xScale = displayScale(measured.meta);
    xNumbers = measured.values.map((value) => (value === null ? null : value * xScale));
  }
  const categories = valueX ? [] : applySelection(context, orderCategories(xLabels, xMeta), xLabels);
  const categoryPosition = new Map(categories.map((label, position) => [label, position]));
  // Focus + Context: highlighted categories, or scatter points by id, take the tone; the other bars and points the context colour.
  const highlight = chart.highlight;
  const highlightable = (plan: LayerPlan) => plan.layer.type === "bar" || plan.layer.type === "scatter";
  const keyOf = (plan: LayerPlan, rowIndex: number) => (plan.idIndex !== undefined ? categoryLabel(rows[rowIndex]![plan.idIndex]) : xLabels[rowIndex]!);
  if (highlight) {
    if (plans.some((plan) => plan.seriesIndex !== undefined)) {
      context.fail({ code: "INVALID_ENCODING", message: "highlight 只用于单系列图；多系列用 series.colors 区分", path: "/chart/highlight" });
    } else if (!plans.some(highlightable)) {
      context.fail({ code: "INVALID_ENCODING", message: "highlight 需要 bar 或 scatter 图层", path: "/chart/highlight" });
    } else if (valueX && plans.some((plan) => highlightable(plan) && plan.idIndex === undefined)) {
      context.fail({ code: "INVALID_ENCODING", message: "数值 x 轴上的散点用图层的 id 指明要突出的点", path: "/chart/highlight", hint: "给 scatter 图层加 id: { field: <标识列> }，highlight.values 写该列的值" });
    } else {
      const domain = new Set(plans.filter(highlightable).flatMap((plan) => rows.map((_row, rowIndex) => keyOf(plan, rowIndex))));
      highlight.values.forEach((value, index) => {
        if (!domain.has(value)) context.fail({ code: "VALUE_OUT_OF_DOMAIN", message: `highlight 的值 ${value} 不在数据中`, path: `/chart/highlight/values/${index}`, hint: `可选值：${[...domain].slice(0, 12).join("、")}` });
      });
    }
  }
  const focused = new Set(highlight?.values ?? []);
  const toneColor = THEME[highlight?.tone ?? "focus"];
  // Context recedes (lighter, per the palette document) so the focus is read first.
  const contextStyle = { color: THEME.context, opacity: CONTEXT_OPACITY };
  const emphasisOf = (plan: LayerPlan, key: string) => (highlight && highlightable(plan) ? { itemStyle: focused.has(key) ? { color: toneColor, opacity: 1 } : contextStyle } : {});

  if (!valueX && xLabels.includes("（空值）")) context.notice({ kind: "layout", code: "NULL_CATEGORY", message: `${fieldTitle(chart.x.field, xMeta)} 为空的行显示为“（空值）”`, field: chart.x.field });

  // Value axes in left-then-right order; a chart whose layers all sit on the right still gets index 0.
  const sides = (["left", "right"] as const).filter((side) => plans.some((plan) => (plan.layer.y.axis ?? "left") === side));
  const axisIndex = (side: "left" | "right") => sides.indexOf(side);
  const axisMeta = new Map<"left" | "right", { meta: QuantitativeMeta; field: string; share: boolean }>();
  const series: Record<string, unknown>[] = [];
  /** The value axis each series is drawn against, for reference lines. */
  const seriesSides: ("left" | "right")[] = [];
  let missing = 0;
  let paletteIndex = 0;
  const nextColor = (layer: ChartLayer, group: string) => layer.series?.colors?.[group] ?? PALETTE[paletteIndex++ % PALETTE.length];
  const onlyScatter = plans.every((plan) => plan.layer.type === "scatter");

  for (const plan of plans) {
    const { layer, y } = plan;
    const path = `/chart/layers/${plan.index}`;
    const stack = layer.stack ?? "none";
    const side = layer.y.axis ?? "left";
    if (!axisMeta.has(side)) axisMeta.set(side, { meta: y.meta, field: y.field, share: stack === "percent" });
    const onAxis = axisIndex(side) > 0 ? { yAxisIndex: axisIndex(side) } : {};
    const scale = displayScale(y.meta);
    const seriesMeta = plan.layer.series ? context.meta(plan.layer.series.field) : undefined;
    const groupLabels = rows.map((row) => (plan.seriesIndex === undefined ? "" : fieldLabel(row[plan.seriesIndex], seriesMeta)));
    const groups = plan.seriesIndex === undefined ? [""] : seriesGroups(groupLabels, layer.series?.order);
    const baseName = layer.name ?? fieldTitle(y.field, y.meta);
    const labelMeta = layer.label ? context.meta(layer.label.field) : undefined;
    // A declared measure reads as a headline number ("+53.5%" style precision, with its unit); other cells as their labels.
    const labelOf = (rowIndex: number) => {
      if (plan.labelIndex === undefined) return undefined;
      const cell = rows[rowIndex]![plan.labelIndex];
      if (labelMeta?.type !== "quantitative") return fieldLabel(cell, labelMeta);
      // A missing measure leaves its bar unlabelled, as a missing value leaves it blank.
      const number = numericCell(cell);
      if (number === null || number === undefined) return number === null ? "" : categoryLabel(cell);
      const shown = number * displayScale(labelMeta);
      return formatValue(shown, labelMeta, { decimals: headlineDigits(shown, labelMeta) });
    };
    const label = plan.labelIndex === undefined ? {} : { label: { show: true, position: horizontal ? "right" : "top", formatter: (params: { data?: { labelText?: string } }) => params.data?.labelText ?? "" } };

    // An area is a line filled to the axis; it follows the line's rules and adds only its fill.
    const isLine = layer.type === "line" || layer.type === "area";
    const echartsType = layer.type === "area" ? "line" : layer.type;
    const area = layer.type === "area" ? { areaStyle: { opacity: stack === "none" ? 0.25 : 0.85 } } : {};

    // Points: every scatter, and lines over a numeric x. Repeated coordinates are kept, never merged.
    if (layer.type === "scatter" || valueX) {
      const sizes = plan.size ? plan.size.values.filter((value): value is number => value !== null).map(Math.abs) : [];
      const maxSize = Math.max(1, ...sizes);
      for (const group of groups) {
        const points: { value: (number | string | null)[]; name?: string; labelText?: string; itemStyle?: { color: string } }[] = [];
        rows.forEach((row, rowIndex) => {
          if (groupLabels[rowIndex] !== group) return;
          if (!valueX && !categoryPosition.has(xLabels[rowIndex]!)) return;
          const x = valueX ? xNumbers[rowIndex] ?? null : xLabels[rowIndex]!;
          const value = y.values[rowIndex] ?? null;
          if (x === null || value === null) {
            missing += 1;
            // A line keeps the gap at a known x; a point without both coordinates is not drawn.
            if (isLine && x !== null) points.push({ value: [x, null] });
            return;
          }
          const text = labelOf(rowIndex);
          points.push({
            value: [x, value * scale, ...(plan.size ? [plan.size.values[rowIndex] ?? 0] : [])],
            ...(plan.idIndex !== undefined ? { name: categoryLabel(row[plan.idIndex]) } : {}),
            ...(text !== undefined ? { labelText: text } : {}),
            ...emphasisOf(plan, keyOf(plan, rowIndex)),
          });
        });
        if (isLine) points.sort((left, right) => Number(left.value[0]) - Number(right.value[0]));
        const name = seriesName(baseName, group, plans.length);
        series.push({
          type: echartsType,
          name,
          data: points,
          ...area,
          ...onAxis,
          ...label,
          itemStyle: highlight && highlightable(plan) ? contextStyle : { color: nextColor(layer, group) },
          ...(plan.size ? { symbolSize: (value: number[]) => 6 + 24 * Math.sqrt(Math.abs(value[2] ?? 0) / maxSize) } : {}),
          tooltip: {
            formatter: (params: { name?: string; value: (number | string | null)[] }) => {
              const [x, value] = params.value;
              const head = params.name ? `${params.name}<br/>` : "";
              const xText = typeof x === "number" && xMeta?.type === "quantitative" ? formatValue(x, xMeta) : String(x);
              return `${head}${name}<br/>${fieldTitle(chart.x.field, xMeta)}：${xText}<br/>${fieldTitle(y.field, y.meta)}：${typeof value === "number" ? formatValue(value, y.meta) : "—"}`;
            },
          },
        });
        seriesSides.push(side);
      }
      continue;
    }

    // Category bars and lines: one cell per category and series; a second row for a cell is an error.
    const grid = groups.map(() => categories.map((): number | null => null));
    const texts = groups.map(() => categories.map((): string | undefined => undefined));
    const filled = groups.map(() => categories.map(() => false));
    rows.forEach((_row, rowIndex) => {
      const position = categoryPosition.get(xLabels[rowIndex]!);
      if (position === undefined) return;
      const groupPosition = groups.indexOf(groupLabels[rowIndex]!);
      if (filled[groupPosition]![position]) {
        const where = plan.seriesIndex === undefined ? `x = ${xLabels[rowIndex]}` : `x = ${xLabels[rowIndex]}、系列 = ${groupLabels[rowIndex]}`;
        context.fail({ code: "DUPLICATE_KEY", message: `第 ${plan.index + 1} 层在 ${where} 上有多行；编译器不合并观测`, path, field: y.field, hint: "在查询中把数据聚合到 x（及系列）粒度，每个组合一行" });
        return;
      }
      filled[groupPosition]![position] = true;
      grid[groupPosition]![position] = y.values[rowIndex] ?? null;
      texts[groupPosition]![position] = labelOf(rowIndex);
    });
    if (stack !== "none") checkPartOfWhole(context, y, grid.flat(), path);
    missing += grid.flat().filter((value) => value === null).length;

    const totals = categories.map((_label, position) => grid.reduce((sum, values) => sum + (values[position] ?? 0), 0));
    groups.forEach((group, groupPosition) => {
      const data = grid[groupPosition]!.map((value, position) => {
        if (value === null) return null;
        const shown = stack === "percent" ? (totals[position] ? (value / totals[position]!) * 100 : null) : value * scale;
        const text = texts[groupPosition]![position];
        const emphasis = emphasisOf(plan, categories[position]!);
        if (shown === null || (text === undefined && !emphasis.itemStyle)) return shown;
        return { value: shown, ...(text !== undefined ? { labelText: text } : {}), ...emphasis };
      });
      series.push({
        type: echartsType,
        name: seriesName(baseName, group, plans.length),
        data,
        ...area,
        ...onAxis,
        ...(stack !== "none" ? { stack: `layer-${plan.index}` } : {}),
        ...(isLine ? { showSymbol: categories.length <= 60 } : {}),
        ...label,
        itemStyle: highlight && highlightable(plan) ? contextStyle : { color: nextColor(layer, group) },
        tooltip: { valueFormatter: (value: number | null) => (typeof value !== "number" ? "—" : stack === "percent" ? `${value.toFixed(1)}%` : formatValue(value, y.meta)) },
      });
      seriesSides.push(side);
    });
  }
  addReferences(context, chart, axisMeta, series, seriesSides, horizontal);
  addBands(context, chart, categoryPosition, series, horizontal, valueX);
  if (context.errors.length > 0) return undefined;
  if (missing > 0) context.notice({ kind: "layout", code: "NULL_VALUES", message: `${missing} 个位置缺少数值，按空白显示，未按 0 绘制` });

  const valueAxes = sides.map((side) => {
    const entry = axisMeta.get(side)!;
    return { ...valueAxis(entry.meta, entry.field, entry.share), ...(side === "right" ? { position: "right", nameTextStyle: { align: "right" } } : {}) };
  });
  // A value axis along the bottom names itself under its centre; at the axis end the name runs off the canvas.
  const bottomName = { nameLocation: "middle", nameGap: 28, nameTextStyle: { align: "center" } };
  let xAxis: unknown;
  let yAxis: unknown;
  if (valueX) {
    xAxis = { type: "value", name: xMeta?.type === "quantitative" ? axisTitle(chart.x.field, xMeta) : chart.x.field, ...bottomName, scale: true, axisLabel: { formatter: (value: number) => (xMeta?.type === "quantitative" && isPercentDisplay(xMeta) ? `${value}%` : value.toLocaleString("zh-CN", { maximumFractionDigits: 4 })) } };
    yAxis = valueAxes;
  } else {
    const axis = categoryAxis(context, categories, horizontal, chart.x.field);
    if (!axis) return undefined;
    xAxis = horizontal ? { ...valueAxes[0], ...bottomName } : axis;
    yAxis = horizontal ? axis : valueAxes;
  }
  const namedBottom = valueX || horizontal;
  const zoom = valueX ? undefined : viewportZoom(context, categories.length, horizontal);
  return {
    color: [...PALETTE],
    ...(context.options.target === "static" ? { animation: false } : {}),
    tooltip: { trigger: onlyScatter || valueX ? "item" : "axis" },
    ...(series.length > 1 ? { legend: { top: 0 } } : {}),
    // The top margin holds the value-axis names, and above them the legend when there is one: on one
    // line the legend runs into a right-hand axis name.
    grid: { left: 16, right: sides.includes("right") ? 48 : 24, top: series.length > 1 ? 60 : 36, bottom: (zoom ? 48 : 16) + (namedBottom ? 28 : 0), containLabel: true },
    xAxis,
    yAxis,
    ...(zoom ? { dataZoom: zoom } : {}),
    series,
  };
}

/**
 * Reference lines read a column holding one value in every row; the spec never carries the number. Each
 * line is drawn on the value axis it names, which must show the same unit.
 */
function addReferences(context: CompileContext, chart: CartesianChart, axes: ReadonlyMap<"left" | "right", { meta: QuantitativeMeta; share: boolean }>, series: Record<string, unknown>[], sides: readonly ("left" | "right")[], horizontal: boolean): void {
  const lines = new Map<"left" | "right", unknown[]>();
  chart.references?.forEach((reference, index) => {
    const path = `/chart/references/${index}`;
    const measured = context.measure(reference.field, `${path}/field`);
    if (!measured) return;
    const side = reference.axis ?? "left";
    const axis = axes.get(side);
    if (!axis) {
      context.fail({ code: "INVALID_ENCODING", message: `图中没有${side === "left" ? "左" : "右"}侧数值轴`, path: `${path}/axis` });
      return;
    }
    if (axis.share || unitText(measured.meta) !== unitText(axis.meta)) {
      context.fail({ code: "INVALID_ENCODING", message: `参考线 ${reference.field} 的单位与${side === "left" ? "左" : "右"}侧数值轴不同`, path: `${path}/field`, field: reference.field, hint: "参考线字段的语义（storage、unit）要与它所在数值轴的度量一致" });
      return;
    }
    const distinct = [...new Set(measured.values.filter((value): value is number => value !== null))];
    if (distinct.length !== 1) {
      context.fail({
        code: "INVALID_ENCODING",
        message: distinct.length === 0 ? `参考线字段 ${reference.field} 没有数值` : `参考线字段 ${reference.field} 在各行取值不同（${distinct.slice(0, 3).join("、")}${distinct.length > 3 ? "…" : ""}）`,
        path: `${path}/field`,
        field: reference.field,
        hint: "在查询中把参考值（如全站均值、目标值）作为一列输出到每一行",
      });
      return;
    }
    const shown = distinct[0]! * displayScale(measured.meta);
    const text = `${reference.label ?? fieldTitle(reference.field, measured.meta)} ${formatValue(shown, measured.meta, { decimals: headlineDigits(shown, measured.meta) })}`;
    lines.set(side, [...(lines.get(side) ?? []), { [horizontal ? "xAxis" : "yAxis"]: shown, label: { formatter: text } }]);
  });
  for (const [side, data] of lines) {
    const target = series[sides.indexOf(side)];
    // A horizontal chart's category axis runs top down, so a line's start is at the top of the plot.
    if (target) target.markLine = { symbol: "none", silent: true, lineStyle: { color: THEME.neutral, type: "dashed", width: 1 }, label: { color: THEME.neutral, fontSize: 11, position: horizontal ? "start" : "insideEndTop" }, data };
  }
}

/** Shaded spans of x categories, such as promotion periods, behind the first series. */
function addBands(context: CompileContext, chart: CartesianChart, positions: ReadonlyMap<string, number>, series: Record<string, unknown>[], horizontal: boolean, valueX: boolean): void {
  if (!chart.bands) return;
  if (valueX) {
    context.fail({ code: "INVALID_ENCODING", message: "bands 用于类目 x 轴", path: "/chart/bands" });
    return;
  }
  const key = horizontal ? "yAxis" : "xAxis";
  const areas: unknown[] = [];
  const markers: Record<string, unknown>[] = [];
  chart.bands.forEach((band, index) => {
    const path = `/chart/bands/${index}`;
    const to = band.to ?? band.from;
    for (const [end, value] of [["from", band.from], ["to", to]] as const) {
      if (!positions.has(value)) context.fail({ code: "VALUE_OUT_OF_DOMAIN", message: `bands 的 ${end} 值 ${value} 不在 x 轴类目中`, path: `${path}/${end}`, hint: `x 轴类目：${[...positions.keys()].slice(0, 12).join("、")}` });
    }
    const start = positions.get(band.from);
    const end = positions.get(to);
    if (start === undefined || end === undefined) return;
    if (start > end) {
      context.fail({ code: "INVALID_ENCODING", message: `bands 的 from（${band.from}）应在 to（${to}）之前`, path });
      return;
    }
    // One category has no width on a line's axis, so it is marked with a line instead of an area.
    if (start === end) markers.push({ [key]: band.from, label: { formatter: band.label, position: horizontal ? "insideStartTop" : "end", color: THEME.muted } });
    else areas.push([{ name: band.label, [key]: band.from }, { [key]: to }]);
  });
  const target = series[0];
  if (!target) return;
  if (areas.length > 0) target.markArea = { silent: true, itemStyle: { color: BAND_FILL }, label: { color: THEME.muted, fontSize: 11, position: horizontal ? "insideLeft" : "insideTop" }, data: areas };
  if (markers.length > 0) {
    const existing: Record<string, unknown> & { data?: unknown[] } = (target.markLine as Record<string, unknown> & { data?: unknown[] } | undefined) ?? { symbol: "none", silent: true, lineStyle: { color: THEME.neutral, type: "dashed", width: 1 }, label: { color: THEME.neutral, fontSize: 11 } };
    target.markLine = { ...existing, data: [...(existing.data ?? []), ...markers.map((marker) => ({ ...marker, lineStyle: { color: THEME.context, type: "solid", width: 1 } }))] };
  }
}

/** Opacity of the bars and points a highlight puts in context. */
const CONTEXT_OPACITY = 0.6;

/** The neutral reference colour as a wash light enough to sit behind data. */
const BAND_FILL = `rgba(${[1, 3, 5].map((offset) => parseInt(THEME.neutral.slice(offset, offset + 2), 16)).join(", ")}, 0.1)`;

/** Rows whose x (or scatter id) names every highlighted and banded category, and whose reference columns hold one value. */
function exampleRows(chart: CartesianChart): Record<string, unknown>[] {
  if (!chart.highlight && !chart.references && !chart.bands) return [{}, {}];
  const ids = chart.layers.flatMap((layer) => (layer.id ? [layer.id.field] : []));
  const named = [...new Set([...(chart.highlight?.values ?? []), ...(chart.bands ?? []).flatMap((band) => [band.from, band.to ?? band.from]), "v0", "v1"])];
  const constant = Object.fromEntries((chart.references ?? []).map((reference) => [reference.field, 1]));
  return named.map((label) => ({ ...(ids.length > 0 ? Object.fromEntries(ids.map((field) => [field, label])) : { [chart.x.field]: label }), ...constant }));
}

export const cartesianMark: MarkDefinition<CartesianChart> = {
  compile: compileCartesian,
  fields: (chart) => [chart.x.field, ...chart.layers.flatMap((layer) => [layer.y.field, ...[layer.series, layer.size, layer.label, layer.id].flatMap((ref) => (ref ? [ref.field] : []))]), ...(chart.references ?? []).map((reference) => reference.field)],
  example: exampleRows,
};
