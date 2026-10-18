/**
 * Theme tokens shared by compiled charts and the dashboard page (ADR-0008
 * decision 5). Data colours are the business palette in 设计原则及配色方案.md;
 * the rest is the neutral chrome around them, one cool grey family so page,
 * rules and receding data never mix warm and cool greys.
 * Changing any value changes rendered output: bump CHART_THEME_VERSION.
 */
export const THEME = {
  /** Body text and headline numbers. */
  ink: "#172033",
  /** Secondary text: labels, subtitles. */
  inkSoft: "#3D4759",
  /** Axis labels, captions, notes. */
  muted: "#6B7588",
  /** Axis lines, tile borders and table rules. */
  rule: "#E4E8EF",
  /** Gridlines inside a plot. */
  grid: "#EEF1F5",
  page: "#F3F5F9",
  surface: "#ffffff",
  /** The one thing a chart wants read first (Focus + Context). */
  focus: "#F2622E",
  /** Everything a focused chart shows only for comparison: a solid cool grey, so it recedes without the focus colour's warmth. */
  context: "#D6DCE4",
  /** Semantic mapping: on target, profit, improvement. */
  good: "#1E9E6A",
  /** Semantic mapping: off target, loss, deterioration. */
  bad: "#D9483B",
  /** Semantic mapping: baselines and reference lines. */
  neutral: "#7A8496",
  /** Tooltip background. */
  tooltip: "#172033",
  /** Page and in-chart text, so tile titles and axis labels share one face. */
  font: "\"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", system-ui, sans-serif",
} as const;
