/**
 * Theme tokens shared by compiled charts and the dashboard page (ADR-0008
 * decision 5). Data colours come from the Miller Stone palette in
 * 设计原则及配色方案.md; the rest is the neutral chrome around them, one cool
 * grey family so page, rules and receding data never mix warm and cool greys.
 * Changing any value changes rendered output: bump CHART_THEME_VERSION.
 */
export const THEME = {
  /** Body text and headline numbers. */
  ink: "#1f2328",
  /** Secondary text: labels, subtitles. */
  inkSoft: "#424a53",
  /** Axis labels, captions, notes. */
  muted: "#6e7781",
  /** Axis lines and table rules. */
  rule: "#e3e6ea",
  /** Gridlines inside a plot. */
  grid: "#eef0f3",
  page: "#f4f5f7",
  surface: "#ffffff",
  /** The one thing a chart wants read first (Focus + Context). */
  focus: "#F47942",
  /** Everything a focused chart shows only for comparison: a solid cool grey, so it recedes without the focus colour's warmth. */
  context: "#C8CED6",
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
