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

/** A #rrggbb colour at the given opacity, or undefined for any other colour value. */
function withAlpha(color: unknown, alpha: number): string | undefined {
  if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) return undefined;
  return `rgba(${[1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16)).join(", ")}, ${alpha})`;
}

/** Shown values of a series: plain numbers, `{ value }` items and `[x, y]` points alike. */
function seriesValues(series: Record_): (number | null)[] {
  return (Array.isArray(series.data) ? series.data : []).map((point) => {
    const raw = point && typeof point === "object" && !Array.isArray(point) ? (point as Record_).value : point;
    const value = Array.isArray(raw) ? raw[1] : raw;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  });
}

/** More points than this on one line and its markers become noise; they show on hover instead. */
const LINE_MARKER_POINTS = 12;

function restyleSeries(series: unknown, horizontal: boolean, lone: boolean): unknown {
  const current = asRecord(series);
  const label = current.label ? { label: { fontSize: 11, color: THEME.inkSoft, ...asRecord(current.label) } } : {};
  const color = asRecord(current.itemStyle).color;
  if (current.type === "bar") {
    // Rounded at the value end only; a stacked segment stays square so the stack reads as one bar.
    const radius = current.stack ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];
    // A ranking reads against a full-length track; bars that cross zero have no single track to fill.
    const track = horizontal && !current.stack && seriesValues(current).every((value) => value === null || value >= 0)
      ? { showBackground: true, backgroundStyle: { color: THEME.grid, borderRadius: radius } }
      : {};
    return { barMaxWidth: horizontal ? 18 : 28, barCategoryGap: "38%", ...track, ...current, itemStyle: { borderRadius: radius, ...asRecord(current.itemStyle) }, ...label };
  }
  if (current.type === "line") {
    const points = seriesValues(current).length;
    // A lone, unstacked line gets a soft wash under it, so the tile reads as one trend at a glance.
    const fill = withAlpha(color, 0.16);
    const wash = lone && !current.areaStyle && !current.stack && fill
      ? { areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: fill }, { offset: 1, color: withAlpha(color, 0) }] } } }
      : {};
    return {
      symbol: "circle",
      symbolSize: 6,
      ...wash,
      ...current,
      showSymbol: current.showSymbol !== false && points <= LINE_MARKER_POINTS,
      lineStyle: { width: 2.25, ...asRecord(current.lineStyle) },
      itemStyle: { borderColor: THEME.surface, borderWidth: 1.5, ...asRecord(current.itemStyle) },
      emphasis: { focus: lone ? "none" : "series", ...asRecord(current.emphasis) },
      ...label,
    };
  }
  return { ...current, ...label };
}

const TOOLTIP = { backgroundColor: THEME.tooltip, borderWidth: 0, padding: [8, 12], textStyle: { color: "#ffffff", fontSize: 12 }, extraCssText: "border-radius:8px;box-shadow:0 8px 24px -8px rgba(23,32,51,.35)" };

export function applyCompactDensity(option: ChartOption): ChartOption {
  const current = option as Record_;
  const grid = asRecord(current.grid);
  const horizontal = isCategoryAxis(current.yAxis);
  const series = Array.isArray(current.series) ? current.series.map(asRecord) : [];
  const lone = series.length === 1;
  const tooltip = asRecord(current.tooltip);
  // Bars are read as a band, so the pointer shades the hovered category; lines get a quiet guide line.
  const onlyBars = series.length > 0 && series.every((entry) => entry.type === "bar");
  const pointer = tooltip.trigger === "axis" && !tooltip.axisPointer
    ? { axisPointer: onlyBars ? { type: "shadow", shadowStyle: { color: withAlpha(THEME.neutral, 0.08) } } : { type: "line", lineStyle: { color: THEME.neutral, type: "dashed", width: 1 } } }
    : {};
  return {
    ...current,
    textStyle: { fontSize: 11, fontFamily: THEME.font, color: THEME.inkSoft, ...asRecord(current.textStyle) },
    tooltip: { ...TOOLTIP, ...pointer, ...tooltip },
    // Right-aligned so a narrow tile's legend stays clear of the value-axis name at the top left.
    ...(current.legend ? { legend: { type: "scroll", icon: "roundRect", itemWidth: 12, itemHeight: 6, itemGap: 14, ...asRecord(current.legend), ...(asRecord(current.legend).top !== undefined ? { right: 0, left: "auto" } : {}), textStyle: { fontSize: 11, color: THEME.inkSoft, ...asRecord(asRecord(current.legend).textStyle) } } } : {}),
    ...(current.grid ? { grid: { ...grid, ...(typeof grid.top === "number" ? { top: Math.max(28, grid.top - 6) } : {}) } } : {}),
    ...(current.xAxis !== undefined ? { xAxis: eachAxis(current.xAxis) } : {}),
    ...(current.yAxis !== undefined ? { yAxis: eachAxis(current.yAxis) } : {}),
    ...(Array.isArray(current.series) ? { series: current.series.map((entry) => restyleSeries(entry, horizontal, lone)) } : {}),
  } as ChartOption;
}
