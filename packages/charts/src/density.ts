import type { ChartOption } from "./types.js";
import { THEME } from "./theme.js";

/**
 * Compact density for charts in dashboard tiles: smaller type, quieter axes
 * and gridlines, slimmer bars. It restyles only; data, scales and the
 * formatters the marks set are kept.
 */

type Record_ = Record<string, unknown>;

const asRecord = (value: unknown): Record_ => (value && typeof value === "object" ? (value as Record_) : {});

function restyleAxis(axis: unknown): unknown {
  const current = asRecord(axis);
  // A value axis is read through its gridlines; its own line only adds ink.
  const valueAxis = current.type === "value";
  return {
    ...current,
    axisLabel: { fontSize: 11, color: THEME.muted, ...asRecord(current.axisLabel) },
    nameTextStyle: { fontSize: 11, color: THEME.muted, ...asRecord(current.nameTextStyle) },
    axisLine: { ...(valueAxis ? { show: false } : {}), ...asRecord(current.axisLine), lineStyle: { color: THEME.rule, ...asRecord(asRecord(current.axisLine).lineStyle) } },
    axisTick: { show: false, ...asRecord(current.axisTick) },
    splitLine: { ...asRecord(current.splitLine), lineStyle: { color: THEME.grid, ...asRecord(asRecord(current.splitLine).lineStyle) } },
  };
}

const eachAxis = (axes: unknown): unknown => (Array.isArray(axes) ? axes.map(restyleAxis) : axes === undefined ? undefined : restyleAxis(axes));

const isCategoryAxis = (axes: unknown): boolean => (Array.isArray(axes) ? axes : [axes]).some((axis) => asRecord(axis).type === "category");

function restyleSeries(series: unknown, horizontal: boolean): unknown {
  const current = asRecord(series);
  const label = current.label ? { label: { fontSize: 11, color: THEME.inkSoft, ...asRecord(current.label) } } : {};
  if (current.type === "bar") {
    // Rounded at the value end only; a stacked segment stays square so the stack reads as one bar.
    const radius = current.stack ? 0 : horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0];
    return { barMaxWidth: 28, ...current, itemStyle: { borderRadius: radius, ...asRecord(current.itemStyle) }, ...label };
  }
  if (current.type === "line") return { symbolSize: 5, ...current, lineStyle: { width: 2, ...asRecord(current.lineStyle) }, ...label };
  return { ...current, ...label };
}

const TOOLTIP = { backgroundColor: THEME.tooltip, borderWidth: 0, padding: [8, 10], textStyle: { color: "#ffffff", fontSize: 12 }, extraCssText: "border-radius:8px;box-shadow:none" };

export function applyCompactDensity(option: ChartOption): ChartOption {
  const current = option as Record_;
  const grid = asRecord(current.grid);
  const horizontal = isCategoryAxis(current.yAxis);
  return {
    ...current,
    textStyle: { fontSize: 11, fontFamily: THEME.font, color: THEME.inkSoft, ...asRecord(current.textStyle) },
    tooltip: { ...TOOLTIP, ...asRecord(current.tooltip) },
    // Right-aligned so a narrow tile's legend stays clear of the value-axis name at the top left.
    ...(current.legend ? { legend: { type: "scroll", icon: "roundRect", itemWidth: 10, itemHeight: 8, itemGap: 12, ...asRecord(current.legend), ...(asRecord(current.legend).top !== undefined ? { right: 0, left: "auto" } : {}), textStyle: { fontSize: 11, color: THEME.inkSoft, ...asRecord(asRecord(current.legend).textStyle) } } } : {}),
    ...(current.grid ? { grid: { ...grid, ...(typeof grid.top === "number" ? { top: Math.max(28, grid.top - 6) } : {}) } } : {}),
    ...(current.xAxis !== undefined ? { xAxis: eachAxis(current.xAxis) } : {}),
    ...(current.yAxis !== undefined ? { yAxis: eachAxis(current.yAxis) } : {}),
    ...(Array.isArray(current.series) ? { series: current.series.map((series) => restyleSeries(series, horizontal)) } : {}),
  } as ChartOption;
}
