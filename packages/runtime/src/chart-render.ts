import { createHash } from "node:crypto";
import * as echarts from "echarts";
import { compileChart, type ChartCompileOptions, type ChartDataset, type ChartError, type PresentationNotice } from "@data-agent/charts";

/**
 * Font stack for static charts. ECharts SSR estimates text width without a
 * canvas: CJK characters count as one em, which matches full-width glyphs in
 * these fonts; Latin characters use ECharts' built-in width table.
 */
// Single quotes: ECharts SSR writes this into a double-quoted style attribute without escaping.
export const STATIC_CHART_FONT_FAMILY = "'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', 'Source Han Sans SC', sans-serif";

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 480;

export type StaticChartResult =
  | { readonly ok: true; readonly svg: string; readonly notices: readonly PresentationNotice[]; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly errors: readonly ChartError[] };

// Only where zrender writes ids: attributes, url(#...) references and CSS class selectors.
// Label text that happens to read "zr0-c0" must never be rewritten.
const ZRENDER_TOKEN = /(?<=id="|class="|url\(#|href="#|\.)zr\d+-(?:cls-\d+|[a-z]+\d+)/g;

/**
 * zrender names clip paths and style classes with a per-instance counter
 * (zr0-c0, zr1-cls-2), so identical charts differ between renders and two
 * inline SVGs on one page can collide. Rename them from the content instead.
 */
function stabilizeIds(svg: string): string {
  const order = new Map<string, number>();
  const placeholder = svg.replace(ZRENDER_TOKEN, (token) => {
    if (!order.has(token)) order.set(token, order.size);
    return `@@${order.get(token)}@@`;
  });
  const prefix = `dac-${createHash("sha256").update(placeholder).digest("hex").slice(0, 8)}`;
  return placeholder.replace(/@@(\d+)@@/g, (_match, index: string) => `${prefix}-${index}`);
}

/** Render a ChartSpec to a standalone SVG document with ECharts server-side rendering. */
export function renderChartSvg(spec: unknown, dataset: ChartDataset, options: Omit<ChartCompileOptions, "target"> = {}): StaticChartResult {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const compiled = compileChart(spec, dataset, { ...options, target: "static", width, height });
  if (!compiled.ok) return compiled;
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width, height });
  try {
    chart.setOption({ ...compiled.option, backgroundColor: "#ffffff", textStyle: { fontFamily: STATIC_CHART_FONT_FAMILY } });
    return { ok: true, svg: stabilizeIds(chart.renderToSVGString()), notices: compiled.notices, width, height };
  } finally {
    chart.dispose();
  }
}
