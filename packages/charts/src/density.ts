import type { ChartOption } from "./types.js";

/**
 * Compact density for charts in dashboard tiles: smaller type, quieter axes
 * and gridlines, slimmer bars. It restyles only; data, scales and the
 * formatters the marks set are kept.
 */

const MUTED = "#6b7280";
const RULE = "#d9dde3";
const GRID = "#eef0f3";

type Record_ = Record<string, unknown>;

const asRecord = (value: unknown): Record_ => (value && typeof value === "object" ? (value as Record_) : {});

function restyleAxis(axis: unknown): unknown {
  const current = asRecord(axis);
  return {
    ...current,
    axisLabel: { fontSize: 11, color: MUTED, ...asRecord(current.axisLabel) },
    nameTextStyle: { fontSize: 11, color: MUTED, ...asRecord(current.nameTextStyle) },
    axisLine: { ...asRecord(current.axisLine), lineStyle: { color: RULE, ...asRecord(asRecord(current.axisLine).lineStyle) } },
    axisTick: { show: false, ...asRecord(current.axisTick) },
    splitLine: { ...asRecord(current.splitLine), lineStyle: { color: GRID, ...asRecord(asRecord(current.splitLine).lineStyle) } },
  };
}

const eachAxis = (axes: unknown): unknown => (Array.isArray(axes) ? axes.map(restyleAxis) : axes === undefined ? undefined : restyleAxis(axes));

function restyleSeries(series: unknown): unknown {
  const current = asRecord(series);
  const label = current.label ? { label: { fontSize: 11, ...asRecord(current.label) } } : {};
  if (current.type === "bar") return { barMaxWidth: 28, ...current, ...label };
  if (current.type === "line") return { symbolSize: 5, ...current, lineStyle: { width: 2, ...asRecord(current.lineStyle) }, ...label };
  return { ...current, ...label };
}

export function applyCompactDensity(option: ChartOption): ChartOption {
  const current = option as Record_;
  const grid = asRecord(current.grid);
  return {
    ...current,
    textStyle: { fontSize: 11, ...asRecord(current.textStyle) },
    // Right-aligned so a narrow tile's legend stays clear of the value-axis name at the top left.
    ...(current.legend ? { legend: { type: "scroll", itemWidth: 10, itemHeight: 8, itemGap: 12, ...asRecord(current.legend), ...(asRecord(current.legend).top !== undefined ? { right: 0, left: "auto" } : {}), textStyle: { fontSize: 11, color: MUTED, ...asRecord(asRecord(current.legend).textStyle) } } } : {}),
    ...(current.grid ? { grid: { ...grid, ...(typeof grid.top === "number" ? { top: Math.max(28, grid.top - 6) } : {}) } } : {}),
    ...(current.xAxis !== undefined ? { xAxis: eachAxis(current.xAxis) } : {}),
    ...(current.yAxis !== undefined ? { yAxis: eachAxis(current.yAxis) } : {}),
    ...(Array.isArray(current.series) ? { series: current.series.map(restyleSeries) } : {}),
  } as ChartOption;
}
