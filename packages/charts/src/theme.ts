/**
 * Theme tokens shared by compiled charts and the dashboard page (ADR-0008
 * decision 5). Data colours come from the Miller Stone palette in
 * 设计原则及配色方案.md; the rest is the neutral chrome around them.
 * Changing any value changes rendered output: bump CHART_THEME_VERSION.
 */
export const THEME = {
  /** Body text and headline numbers. */
  ink: "#1f2328",
  /** Secondary text: labels, subtitles. */
  inkSoft: "#4b5058",
  /** Axis labels, captions, notes. */
  muted: "#7a8088",
  /** Axis lines and table rules. */
  rule: "#e3e4e6",
  /** Gridlines inside a plot. */
  grid: "#f0f1f2",
  page: "#f6f6f4",
  surface: "#ffffff",
  /** The one thing a chart wants read first (Focus + Context). */
  focus: "#F47942",
  /** Everything a focused chart shows only for comparison. */
  context: "#B9AA97",
  /** Semantic mapping: on target, profit, improvement. */
  good: "#638B66",
  /** Semantic mapping: off target, loss, deterioration. */
  bad: "#B66353",
  /** Semantic mapping: baselines and reference lines. */
  neutral: "#7E756D",
  /** Tooltip background. */
  tooltip: "#1f2328",
  /** Page and in-chart text, so tile titles and axis labels share one face. */
  font: "\"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", system-ui, sans-serif",
} as const;
