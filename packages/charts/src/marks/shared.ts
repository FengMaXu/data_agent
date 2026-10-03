import { type ChartSpec, type FieldMeta } from "@data-agent/contracts";
import type { ChartCompileOptions, ChartDataset, ChartError, PresentationNotice } from "../types.js";
import { PALETTE, axisTitle, categoryLabel, fieldLabel, fieldTitle, isPercentDisplay, isZonedTemporal, numericCell, type QuantitativeMeta } from "../semantics.js";
import { THEME } from "../theme.js";

/** Compile context and helpers shared by every mark. */

export const DEFAULT_WIDTH = 800;

export const DEFAULT_HEIGHT = 480;

/** Narrowest band a category may get before its bar and label stop being readable. */
export const MIN_CATEGORY_PX = 16;

/** Approximate width of one CJK character in an axis label. */
export const LABEL_CHAR_PX = 12;

export const MAX_LABEL_CHARS = 16;

/** Approximate width of one ASCII character (digits, Latin, punctuation) in an axis label. */
const ASCII_CHAR_PX = 7;

/** Estimated pixel width of an axis label as shown: CJK characters are full width, ASCII about half. */
export function labelWidth(label: string): number {
  return [...truncate(label)].reduce((width, character) => width + (character.charCodeAt(0) < 128 ? ASCII_CHAR_PX : LABEL_CHAR_PX), 0);
}

export interface Measure {
  readonly field: string;
  readonly index: number;
  readonly meta: QuantitativeMeta;
  readonly values: readonly (number | null)[];
}

export class CompileContext {
  readonly errors: ChartError[] = [];
  readonly notices: PresentationNotice[] = [];
  readonly width: number;
  readonly height: number;
  /** Colours for categorical series, slices and nodes, in order. */
  readonly palette: readonly string[];
  private readonly columnIndex = new Map<string, number>();
  private readonly fields: Readonly<Record<string, FieldMeta>>;

  constructor(readonly spec: ChartSpec, readonly dataset: ChartDataset, readonly options: ChartCompileOptions) {
    dataset.columns.forEach((column, index) => this.columnIndex.set(column, index));
    this.fields = options.fields ?? spec.fields ?? {};
    this.width = options.width ?? DEFAULT_WIDTH;
    this.height = options.height ?? DEFAULT_HEIGHT;
    this.palette = options.reserveFocus ? PALETTE.filter((colour) => colour !== THEME.focus) : PALETTE;
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
export function temporalNotice(context: CompileContext, field: string, values: readonly unknown[]): void {
  const meta = context.meta(field);
  if (meta?.type !== "temporal" || meta.zone !== "floating") return;
  const zoned = values.find(isZonedTemporal);
  if (zoned === undefined) return;
  context.notice({ kind: "layout", code: "TEMPORAL_ZONED_VALUE", message: `${fieldTitle(field, meta)} 声明为不带时区的日期，但值带有时区（如 ${fieldLabel(zoned, undefined)}），按原文显示；请在查询中输出不带时区的日期文本，或声明时区`, field });
}

/** Categories in the order the field semantics call for: declared order, time order, or first appearance. */
export function orderCategories(labels: readonly string[], meta: FieldMeta | undefined): string[] {
  const seen = [...new Set(labels)];
  if (meta?.type === "ordinal") return [...meta.order.filter((value) => seen.includes(value)), ...seen.filter((value) => !meta.order.includes(value))];
  if (meta?.type === "temporal") return [...seen].sort();
  return seen;
}

export function seriesGroups(labels: readonly string[], declared: readonly string[] | undefined): string[] {
  const seen = [...new Set(labels)];
  return declared ? [...declared.filter((value) => seen.includes(value)), ...seen.filter((value) => !declared.includes(value))] : seen;
}

export function truncate(label: string): string {
  return label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…` : label;
}

/** Layout of a category axis: static targets must fit every category; interactive ones may scroll. */
export function categoryAxis(context: CompileContext, categories: readonly string[], horizontal: boolean, field: string): Record<string, unknown> | undefined {
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
  const longest = Math.max(0, ...categories.map(labelWidth));
  if (categories.some((label) => label.length > MAX_LABEL_CHARS)) {
    context.notice({ kind: "layout", code: "LABELS_TRUNCATED", message: `过长的类目标签截断显示为前 ${MAX_LABEL_CHARS - 1} 个字符，完整名称见提示框`, field });
  }
  // A time axis reads in order, so labels that do not fit are thinned, never rotated: 2017-01, 2017-04, ...
  // Categories have no such order and keep every label.
  const temporal = context.meta(field)?.type === "temporal";
  const rotate = !horizontal && !temporal && longest > (viewport ? extent / viewport.window : band);
  if (rotate) context.notice({ kind: "layout", code: "LABELS_ROTATED", message: "类目标签旋转 45° 显示", field });
  const thinned = temporal && !horizontal && longest + 8 > (viewport ? extent / viewport.window : band);
  return {
    type: "category",
    data: categories,
    ...(horizontal ? { inverse: true } : {}),
    axisLabel: { interval: thinned ? "auto" : 0, hideOverlap: thinned, ...(rotate ? { rotate: 45 } : {}), formatter: (value: string) => truncate(value) },
  };
}

export function viewportZoom(context: CompileContext, categoryCount: number, horizontal: boolean): unknown[] | undefined {
  const viewport = context.options.target === "interactive" ? context.spec.viewport : undefined;
  if (!viewport || categoryCount <= viewport.window) return undefined;
  context.notice({ kind: "viewport", code: "VIEWPORT", message: `当前显示 ${viewport.window} / ${categoryCount} 项，${viewport.mode === "zoom" ? "可缩放或拖动" : "可拖动"}查看其余`, field: context.spec.chart.mark === "cartesian" ? context.spec.chart.x.field : undefined });
  const axis = horizontal ? { yAxisIndex: 0 } : { xAxisIndex: 0 };
  const window = { startValue: 0, endValue: viewport.window - 1 };
  return viewport.mode === "zoom"
    ? [{ type: "inside", ...axis, ...window }, { type: "slider", ...axis, ...window }]
    : [{ type: "slider", ...axis, ...window, zoomLock: true }];
}

export function valueAxis(meta: QuantitativeMeta, field: string, share: boolean): Record<string, unknown> {
  return {
    type: "value",
    name: share ? `${fieldTitle(field, meta)}占比（%）` : axisTitle(field, meta),
    ...(share ? { max: 100 } : {}),
    // Starts at the axis and runs inward: centred on it, a long name is cut off when tick labels are short.
    nameTextStyle: { align: "left" },
    // The axis name carries the unit; ticks show numbers, keeping % for percent display.
    axisLabel: { formatter: (value: number) => (share || isPercentDisplay(meta) ? `${value}%` : value.toLocaleString("zh-CN", { maximumFractionDigits: 4 })) },
  };
}

/** Part-of-whole marks show sums and shares, so their measure must be additive, complete and non-negative. */
export function checkPartOfWhole(context: CompileContext, measure: Measure, values: readonly (number | null)[], path: string): void {
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

export function applySelection(context: CompileContext, categories: string[], labels: readonly string[]): string[] {
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

/** Marks outside cartesian charts take neither data selection nor a viewport: they show every row as given. */
export function refuseSelection(context: CompileContext, name: string): void {
  if (context.spec.selection) context.fail({ code: "INVALID_SELECTION", message: `${name}不支持 top_n`, path: "/selection", hint: "在查询中筛选" });
  if (context.spec.viewport) context.fail({ code: "INVALID_ENCODING", message: `${name}不支持 viewport`, path: "/viewport" });
}
