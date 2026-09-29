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
