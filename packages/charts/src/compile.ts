import { checkChartSpec, type BoxplotChart, type CartesianChart, type ChartLayer, type ChartSpec, type FieldMeta, type HeatmapChart, type HistogramChart, type PieChart } from "@data-agent/contracts";
import type { ChartCompileOptions, ChartCompileResult, ChartDataset, ChartError, ChartOption, PresentationNotice } from "./types.js";
import { PALETTE, axisTitle, categoryLabel, displayScale, fieldLabel, fieldTitle, formatValue, isPercentDisplay, isZonedTemporal, numericCell, type QuantitativeMeta } from "./semantics.js";

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 480;
/** Narrowest band a category may get before its bar and label stop being readable. */
const MIN_CATEGORY_PX = 16;
/** Approximate width of one CJK character in an axis label. */
const LABEL_CHAR_PX = 12;
const MAX_LABEL_CHARS = 16;
const MAX_STATIC_PIE_SLICES = 12;
/** Cell labels stay readable up to about this many cells; past it values show in the tooltip only. */
const MAX_LABELLED_CELLS = 150;
/** Light end of a sequential scale and centre of a diverging one. */
const SCALE_LIGHT = "#EEF2F6";
const SCALE_CENTRE = "#F7F7F7";

interface Measure {
  readonly field: string;
  readonly index: number;
  readonly meta: QuantitativeMeta;
  readonly values: readonly (number | null)[];
}

class CompileContext {
  readonly errors: ChartError[] = [];
  readonly notices: PresentationNotice[] = [];
  readonly width: number;
  readonly height: number;
  private readonly columnIndex = new Map<string, number>();
  private readonly fields: Readonly<Record<string, FieldMeta>>;

  constructor(readonly spec: ChartSpec, readonly dataset: ChartDataset, readonly options: ChartCompileOptions) {
    dataset.columns.forEach((column, index) => this.columnIndex.set(column, index));
    this.fields = options.fields ?? spec.fields ?? {};
    this.width = options.width ?? DEFAULT_WIDTH;
    this.height = options.height ?? DEFAULT_HEIGHT;
  }

  fail(error: ChartError): void {
    if (!this.errors.some((known) => known.code === error.code && known.path === error.path && known.field === error.field)) this.errors.push(error);
  }

  notice(notice: PresentationNotice): void {
    if (!this.notices.some((known) => known.code === notice.code && known.field === notice.field)) this.notices.push(notice);
  }

  meta(field: string): FieldMeta | undefined {
    return this.fields[field];
  }

  column(field: string, path: string): number | undefined {
    const index = this.columnIndex.get(field);
    if (index === undefined) this.fail({ code: "FIELD_NOT_FOUND", message: `字段 ${field} 不在数据集中`, path, field, hint: `可用字段：${this.dataset.columns.join("、")}` });
    return index;
  }

  /** A measure must exist, be declared quantitative, and hold only numbers, DECIMAL text or NULL. */
  measure(field: string, path: string): Measure | undefined {
    const index = this.column(field, path);
    const meta = this.meta(field);
    if (meta?.type !== "quantitative") {
      this.fail({ code: "SEMANTICS_MISSING", message: `度量字段 ${field} 缺少数值语义`, path, field, hint: "为该字段声明 type: \"quantitative\"，以及 storage 与 additivity" });
      return undefined;
    }
    if (index === undefined) return undefined;
    const values: (number | null)[] = [];
    for (const [rowIndex, row] of this.dataset.rows.entries()) {
      const value = numericCell(row[index]);
      if (value === undefined) {
        this.fail({ code: "VALUE_NOT_NUMERIC", message: `度量字段 ${field} 第 ${rowIndex + 1} 行的值 ${JSON.stringify(categoryLabel(row[index]))} 不是数值`, path, field });
        return undefined;
      }
      values.push(value);
    }
    return { field, index, meta, values };
  }
}

/** A floating calendar field whose cells carry a zone cannot be placed on a date; say so instead of guessing one. */
function temporalNotice(context: CompileContext, field: string, values: readonly unknown[]): void {
  const meta = context.meta(field);
  if (meta?.type !== "temporal" || meta.zone !== "floating") return;
  const zoned = values.find(isZonedTemporal);
  if (zoned === undefined) return;
  context.notice({ kind: "layout", code: "TEMPORAL_ZONED_VALUE", message: `${fieldTitle(field, meta)} 声明为不带时区的日期，但值带有时区（如 ${fieldLabel(zoned, undefined)}），按原文显示；请在查询中输出不带时区的日期文本，或声明时区`, field });
}

/** Categories in the order the field semantics call for: declared order, time order, or first appearance. */
function orderCategories(labels: readonly string[], meta: FieldMeta | undefined): string[] {
  const seen = [...new Set(labels)];
  if (meta?.type === "ordinal") return [...meta.order.filter((value) => seen.includes(value)), ...seen.filter((value) => !meta.order.includes(value))];
  if (meta?.type === "temporal") return [...seen].sort();
  return seen;
}

function seriesGroups(labels: readonly string[], declared: readonly string[] | undefined): string[] {
  const seen = [...new Set(labels)];
  return declared ? [...declared.filter((value) => seen.includes(value)), ...seen.filter((value) => !declared.includes(value))] : seen;
}

function truncate(label: string): string {
  return label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…` : label;
}

/** Layout of a category axis: static targets must fit every category; interactive ones may scroll. */
function categoryAxis(context: CompileContext, categories: readonly string[], horizontal: boolean, field: string): Record<string, unknown> | undefined {
  const extent = horizontal ? context.height - 80 : context.width - 120;
  const band = extent / Math.max(1, categories.length);
  const viewport = context.options.target === "interactive" ? context.spec.viewport : undefined;
  if (context.options.target === "static" && band < MIN_CATEGORY_PX) {
    context.fail({
      code: "CAPACITY_EXCEEDED",
      message: `${categories.length} 个类目在 ${context.width}×${context.height} 的画布上放不下`,
      field,
      hint: horizontal ? "加大画布高度，或声明 selection 选取前 N 项" : "加大画布宽度、改为 orientation: \"horizontal\"，或声明 selection 选取前 N 项",
    });
    return undefined;
  }
  const longest = Math.max(0, ...categories.map((label) => Math.min(label.length, MAX_LABEL_CHARS)));
  if (categories.some((label) => label.length > MAX_LABEL_CHARS)) {
    context.notice({ kind: "layout", code: "LABELS_TRUNCATED", message: `过长的类目标签截断显示为前 ${MAX_LABEL_CHARS - 1} 个字符，完整名称见提示框`, field });
  }
  const rotate = !horizontal && longest * LABEL_CHAR_PX > (viewport ? extent / viewport.window : band);
  if (rotate) context.notice({ kind: "layout", code: "LABELS_ROTATED", message: "类目标签旋转 45° 显示", field });
  return {
    type: "category",
    data: categories,
    ...(horizontal ? { inverse: true } : {}),
    axisLabel: { interval: 0, ...(rotate ? { rotate: 45 } : {}), formatter: (value: string) => truncate(value) },
  };
}

function viewportZoom(context: CompileContext, categoryCount: number, horizontal: boolean): unknown[] | undefined {
  const viewport = context.options.target === "interactive" ? context.spec.viewport : undefined;
  if (!viewport || categoryCount <= viewport.window) return undefined;
  context.notice({ kind: "viewport", code: "VIEWPORT", message: `当前显示 ${viewport.window} / ${categoryCount} 项，${viewport.mode === "zoom" ? "可缩放或拖动" : "可拖动"}查看其余`, field: context.spec.chart.mark === "cartesian" ? context.spec.chart.x.field : undefined });
  const axis = horizontal ? { yAxisIndex: 0 } : { xAxisIndex: 0 };
  const window = { startValue: 0, endValue: viewport.window - 1 };
  return viewport.mode === "zoom"
    ? [{ type: "inside", ...axis, ...window }, { type: "slider", ...axis, ...window }]
    : [{ type: "slider", ...axis, ...window, zoomLock: true }];
}

function valueAxis(meta: QuantitativeMeta, field: string, share: boolean): Record<string, unknown> {
  return {
    type: "value",
    name: share ? `${fieldTitle(field, meta)}占比（%）` : axisTitle(field, meta),
    ...(share ? { max: 100 } : {}),
    // The axis name carries the unit; ticks show numbers, keeping % for percent display.
    axisLabel: { formatter: (value: number) => (share || isPercentDisplay(meta) ? `${value}%` : value.toLocaleString("zh-CN", { maximumFractionDigits: 4 })) },
  };
}

/** Part-of-whole marks show sums and shares, so their measure must be additive, complete and non-negative. */
function checkPartOfWhole(context: CompileContext, measure: Measure, values: readonly (number | null)[], path: string): void {
  if (measure.meta.additivity !== "additive") {
    context.fail({ code: "NON_ADDITIVE_PART_OF_WHOLE", message: `字段 ${measure.field} 不可加，不能用于堆叠或饼图`, path, field: measure.field, hint: "比率、均值等指标改用不堆叠的柱形或折线" });
  }
  if (context.spec.selection) {
    context.fail({ code: "INCOMPLETE_PART_OF_WHOLE", message: "堆叠或饼图不能与 selection 同时使用：省略部分项会改变整体", path: "/selection", hint: "需要“其他”项时，由查询返回该行" });
  }
  if (values.some((value) => value === null)) {
    context.fail({ code: "INCOMPLETE_PART_OF_WHOLE", message: `字段 ${measure.field} 存在空值或缺失的组合，无法构成完整的整体`, path, field: measure.field, hint: "在查询中补全各组合，或改用不堆叠的图" });
  }
  if (values.some((value) => value !== null && value < 0)) {
    context.fail({ code: "NEGATIVE_IN_PART_OF_WHOLE", message: `字段 ${measure.field} 含负值，不能用于堆叠或饼图`, path, field: measure.field, hint: "正负值改用不堆叠的柱形图" });
  }
}

function applySelection(context: CompileContext, categories: string[], labels: readonly string[]): string[] {
  const selection = context.spec.selection;
  if (!selection) return categories;
  const by = context.measure(selection.by, "/selection/by");
  if (!by) return categories;
  if (labels.length !== new Set(labels).size) {
    context.fail({ code: "INVALID_SELECTION", message: "top_n 要求每个类目只有一行，否则排名需要先聚合", path: "/selection", hint: "在查询中把数据聚合到 x 粒度，或去掉 selection" });
    return categories;
  }
  const valueOf = new Map(labels.map((label, rowIndex) => [label, by.values[rowIndex] ?? null]));
  const direction = selection.order === "desc" ? -1 : 1;
  const ranked = [...categories].sort((left, right) => {
    const a = valueOf.get(left) ?? null;
    const b = valueOf.get(right) ?? null;
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
    return (a - b) * direction;
  });
  const kept = ranked.slice(0, selection.n);
  if (kept.length < categories.length) {
    context.notice({ kind: "selection", code: "TOP_N", message: `按 ${fieldTitle(by.field, by.meta)} 显示${selection.order === "desc" ? "最高" : "最低"}的 ${kept.length} 项，共 ${categories.length} 项；完整数据见数据集`, field: by.field });
  }
  return kept;
}

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
    if (chart.orientation === "horizontal" && (layer.type === "scatter" || valueX)) context.fail({ code: "INVALID_ENCODING", message: "横向图只支持类目 x 轴上的 bar 与 line", path: "/chart/orientation" });
    if (valueX && layer.type === "bar") context.fail({ code: "INVALID_ENCODING", message: "x 字段声明为 quantitative 时只能使用 line 或 scatter，bar 需要类目 x 轴", path: `${path}/type` });
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
    xNumbers = measured.values;
  }
  const categories = valueX ? [] : applySelection(context, orderCategories(xLabels, xMeta), xLabels);
  const categoryPosition = new Map(categories.map((label, position) => [label, position]));
  if (!valueX && xLabels.includes("（空值）")) context.notice({ kind: "layout", code: "NULL_CATEGORY", message: `${fieldTitle(chart.x.field, xMeta)} 为空的行显示为“（空值）”`, field: chart.x.field });

  // Value axes in left-then-right order; a chart whose layers all sit on the right still gets index 0.
  const sides = (["left", "right"] as const).filter((side) => plans.some((plan) => (plan.layer.y.axis ?? "left") === side));
  const axisIndex = (side: "left" | "right") => sides.indexOf(side);
  const axisMeta = new Map<"left" | "right", { meta: QuantitativeMeta; field: string; share: boolean }>();
  const series: unknown[] = [];
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
    const labelOf = (rowIndex: number) => (plan.labelIndex === undefined ? undefined : categoryLabel(rows[rowIndex]![plan.labelIndex]));
    const label = plan.labelIndex === undefined ? {} : { label: { show: true, position: horizontal ? "right" : "top", formatter: (params: { data?: { labelText?: string } }) => params.data?.labelText ?? "" } };

    // Points: every scatter, and lines over a numeric x. Repeated coordinates are kept, never merged.
    if (layer.type === "scatter" || valueX) {
      const sizes = plan.size ? plan.size.values.filter((value): value is number => value !== null).map(Math.abs) : [];
      const maxSize = Math.max(1, ...sizes);
      for (const group of groups) {
        const points: { value: (number | string | null)[]; name?: string; labelText?: string }[] = [];
        rows.forEach((row, rowIndex) => {
          if (groupLabels[rowIndex] !== group) return;
          if (!valueX && !categoryPosition.has(xLabels[rowIndex]!)) return;
          const x = valueX ? xNumbers[rowIndex] ?? null : xLabels[rowIndex]!;
          const value = y.values[rowIndex] ?? null;
          if (x === null || value === null) {
            missing += 1;
            // A line keeps the gap at a known x; a point without both coordinates is not drawn.
            if (layer.type === "line" && x !== null) points.push({ value: [x, null] });
            return;
          }
          const text = labelOf(rowIndex);
          points.push({
            value: [x, value * scale, ...(plan.size ? [plan.size.values[rowIndex] ?? 0] : [])],
            ...(plan.idIndex !== undefined ? { name: categoryLabel(row[plan.idIndex]) } : {}),
            ...(text !== undefined ? { labelText: text } : {}),
          });
        });
        if (layer.type === "line") points.sort((left, right) => Number(left.value[0]) - Number(right.value[0]));
        const name = seriesName(baseName, group, plans.length);
        series.push({
          type: layer.type,
          name,
          data: points,
          ...onAxis,
          ...label,
          itemStyle: { color: nextColor(layer, group) },
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
        return text === undefined || shown === null ? shown : { value: shown, labelText: text };
      });
      series.push({
        type: layer.type,
        name: seriesName(baseName, group, plans.length),
        data,
        ...onAxis,
        ...(stack !== "none" ? { stack: `layer-${plan.index}` } : {}),
        ...(layer.type === "line" ? { showSymbol: categories.length <= 60 } : {}),
        ...label,
        itemStyle: { color: nextColor(layer, group) },
        tooltip: { valueFormatter: (value: number | null) => (typeof value !== "number" ? "—" : stack === "percent" ? `${value.toFixed(1)}%` : formatValue(value, y.meta)) },
      });
    });
  }
  if (context.errors.length > 0) return undefined;
  if (missing > 0) context.notice({ kind: "layout", code: "NULL_VALUES", message: `${missing} 个位置缺少数值，按空白显示，未按 0 绘制` });

  const valueAxes = sides.map((side) => {
    const entry = axisMeta.get(side)!;
    return { ...valueAxis(entry.meta, entry.field, entry.share), ...(side === "right" ? { position: "right" } : {}) };
  });
  // A value axis along the bottom names itself under its centre; at the axis end the name runs off the canvas.
  const bottomName = { nameLocation: "middle", nameGap: 28 };
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
    // The top margin holds the value-axis names (and the legend when there is one).
    grid: { left: 16, right: sides.includes("right") ? 48 : 24, top: series.length > 1 ? 48 : 36, bottom: (zoom ? 48 : 16) + (namedBottom ? 28 : 0), containLabel: true },
    xAxis,
    yAxis,
    ...(zoom ? { dataZoom: zoom } : {}),
    series,
  };
}

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
  const data = order.map((label) => ({ name: label, value: (value.values[labels.indexOf(label)] ?? 0) * scale }));
  return {
    color: [...PALETTE],
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
      text: [format(range.max), format(range.min)],
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

/** Marks outside cartesian charts take neither data selection nor a viewport: they show every row as given. */
function refuseSelection(context: CompileContext, name: string): void {
  if (context.spec.selection) context.fail({ code: "INVALID_SELECTION", message: `${name}不支持 top_n`, path: "/selection", hint: "在查询中筛选" });
  if (context.spec.viewport) context.fail({ code: "INVALID_ENCODING", message: `${name}不支持 viewport`, path: "/viewport" });
}

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
    color: [...PALETTE],
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
    color: [...PALETTE],
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
  const option = chart.mark === "pie" ? compilePie(context, chart)
    : chart.mark === "heatmap" ? compileHeatmap(context, chart)
      : chart.mark === "histogram" ? compileHistogram(context, chart)
        : chart.mark === "boxplot" ? compileBoxplot(context, chart)
          : compileCartesian(context, chart);
  if (context.errors.length > 0 || !option) return { ok: false, errors: context.errors };
  return { ok: true, spec: checked.spec, option, notices: context.notices };
}

/** Validate a ChartSpec against its dataset without keeping the compiled option. */
export function validateChart(input: unknown, dataset: ChartDataset, options: ChartCompileOptions): { readonly ok: true; readonly notices: readonly PresentationNotice[] } | { readonly ok: false; readonly errors: readonly ChartError[] } {
  const result = compileChart(input, dataset, options);
  return result.ok ? { ok: true, notices: result.notices } : result;
}
