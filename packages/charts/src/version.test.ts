import { describe, expect, it } from "vitest";
import type { ChartSpec, FieldMeta } from "@data-agent/contracts";
import { CHART_COMPILER_VERSION, CHART_THEME_VERSION, compileChart, type ChartCompileOptions, type ChartDataset } from "./index.js";

/**
 * Compiled output per recorded version pair. A change to the compiled option
 * must come with a new entry under bumped versions (see version.ts), never an
 * edit of an existing one: delivered charts cite these versions.
 */
const OUTPUT_FINGERPRINTS: Readonly<Record<string, string>> = {
  "1.1": "9e2dcdfc",
  // 2: temporal fields shown at their declared grain and zone.
  "2.1": "014da502",
  // 3: the heatmap mark.
  "3.1": "2c1b8a96",
  // 4: histogram and boxplot marks.
  "4.1": "44229561",
  // 5: the waterfall mark.
  "5.1": "2f02dc39",
  // 6: sankey and treemap marks; value-axis names start at the axis instead of centring on it.
  "6.1": "a6b17e41",
  // 7: area layers, funnel and sunburst marks.
  "7.1": "91989973",
  // 8: values show two decimals (three significant digits below 1) instead of up to four; layer labels read
  //    declared semantics at headline precision; axis-label rotation measures ASCII at about half a CJK character.
  // Theme 2: compact density for dashboard tiles. Formatters call formatValue by name, so these fixtures did not change.
  "8.2": "91989973",
  // 9: a ratio x axis places points at their shown percent; a legend sits above the value-axis names.
  "9.2": "6051fa59",
};

const data = { kind: "publication", receiptId: "publication_1" } as const;
const sales: FieldMeta = { type: "quantitative", storage: "raw", unit: "元", magnitude: { stored: 1, shown: 1e4 }, additivity: "additive", label: "销售额" };
const growth: FieldMeta = { type: "quantitative", storage: "ratio", additivity: "non_additive", label: "增速" };
const regions: ChartDataset = { columns: ["region", "sales", "growth"], rows: [["华东地区", 120000, 0.12], ["华南", "80500.50", -0.03], ["西北", null, null]] };

const samples: readonly [unknown, ChartDataset, ChartCompileOptions][] = [
  [{ version: 1, data, title: "双轴", fields: { sales, growth }, chart: { mark: "cartesian", x: { field: "region" }, layers: [{ type: "bar", y: { field: "sales" } }, { type: "line", y: { field: "growth", axis: "right" } }] } }, regions, { target: "interactive" }],
  [{ version: 1, data, fields: { sales }, chart: { mark: "cartesian", x: { field: "region" }, layers: [{ type: "bar", y: { field: "sales" } }], orientation: "horizontal" } }, regions, { target: "static", width: 640, height: 360 }],
  [{ version: 1, data, fields: { sales }, chart: { mark: "pie", category: { field: "region" }, value: { field: "sales" } } }, { columns: ["region", "sales"], rows: [["华东地区", 3], ["华南", 1]] }, { target: "static" }],
  [{ version: 1, data, fields: { sales, growth }, chart: { mark: "cartesian", x: { field: "growth" }, layers: [{ type: "scatter", y: { field: "sales" } }] } }, regions, { target: "interactive" }],
  [{ version: 1, data, fields: { sales, month: { type: "temporal", grain: "month", zone: "Asia/Shanghai" } }, chart: { mark: "cartesian", x: { field: "month" }, layers: [{ type: "line", y: { field: "sales" } }] } }, { columns: ["month", "sales"], rows: [["2025-10-31T16:00:00.000Z", 1], ["2025-12-01", 2]] }, { target: "interactive" }],
  [{ version: 1, data, fields: { growth }, chart: { mark: "heatmap", x: { field: "region" }, y: { field: "sales" }, color: { field: "growth", scale: "diverging", midpoint: 0 } } }, regions, { target: "static" }],
  [{ version: 1, data, fields: { lo: sales, hi: sales, n: sales }, chart: { mark: "histogram", start: { field: "lo" }, end: { field: "hi" }, value: { field: "n" } } }, { columns: ["lo", "hi", "n"], rows: [[0, 100, 3], [100, 200, null], [300, 400, 1]] }, { target: "static" }],
  [{ version: 1, data, fields: { mn: sales, q1: sales, md: sales, q3: sales, mx: sales }, chart: { mark: "boxplot", category: { field: "region" }, min: { field: "mn" }, q1: { field: "q1" }, median: { field: "md" }, q3: { field: "q3" }, max: { field: "mx" }, whisker: "min_max" } }, { columns: ["region", "mn", "q1", "md", "q3", "mx"], rows: [["华东地区", 1, 2, 3, 4, 5]] }, { target: "interactive" }],
  [{ version: 1, data, fields: { s: sales, e: sales }, chart: { mark: "waterfall", step: { field: "step" }, start: { field: "s" }, end: { field: "e" }, total: { field: "t" } } }, { columns: ["step", "s", "e", "t"], rows: [["期初", 0, 100, true], ["收入", 100, 160, false], ["成本", 160, 90, false], ["期末", 0, 90, true]] }, { target: "static" }],
  [{ version: 1, data, fields: { n: sales }, chart: { mark: "sankey", source: { field: "a" }, target: { field: "b" }, value: { field: "n" } } }, { columns: ["a", "b", "n"], rows: [["访问", "注册", 60], ["访问", "离开", 40], ["注册", "付费", 12]] }, { target: "static" }],
  [{ version: 1, data, fields: { n: sales }, chart: { mark: "treemap", path: [{ field: "a" }, { field: "b" }], value: { field: "n" } } }, { columns: ["a", "b", "n"], rows: [["批发零售", "批发", 60], ["批发零售", "零售", 30], ["住宿餐饮", "餐饮", 10]] }, { target: "interactive" }],
  [{ version: 1, data, fields: { sales }, chart: { mark: "cartesian", x: { field: "region" }, layers: [{ type: "area", y: { field: "sales" } }] } }, regions, { target: "static" }],
  [{ version: 1, data, fields: { n: sales }, chart: { mark: "funnel", stage: { field: "a" }, value: { field: "n" } } }, { columns: ["a", "n"], rows: [["访问", 1000], ["注册", 300], ["付费", 45]] }, { target: "static" }],
  [{ version: 1, data, fields: { n: sales }, chart: { mark: "sunburst", path: [{ field: "a" }, { field: "b" }], value: { field: "n" } } }, { columns: ["a", "b", "n"], rows: [["批发零售", "批发", 60], ["批发零售", "零售", 30], ["住宿餐饮", "餐饮", 10]] }, { target: "interactive" }],
];

/** Stable text of an option, formatter functions included by source with whitespace collapsed (CRLF and LF checkouts agree). */
function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (typeof item === "function" ? `fn:${item.toString().replace(/\s+/g, " ")}` : item));
}

/** FNV-1a, enough to notice a change without depending on node:crypto. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

describe("Compiler and theme versions", () => {
  it("pins the compiled output to the recorded versions", () => {
    const outputs = samples.map(([spec, dataset, options]) => {
      const result = compileChart(spec as ChartSpec, dataset, options);
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      return { option: result.option, notices: result.notices };
    });
    expect(fingerprint(serialize(outputs)), "compiled output changed: bump CHART_COMPILER_VERSION or CHART_THEME_VERSION and add a fingerprint entry")
      .toBe(OUTPUT_FINGERPRINTS[`${CHART_COMPILER_VERSION}.${CHART_THEME_VERSION}`]);
  });
});
