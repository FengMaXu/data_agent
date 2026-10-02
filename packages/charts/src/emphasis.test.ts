import { describe, expect, it } from "vitest";
import type { ChartSpec, FieldMeta } from "@data-agent/contracts";
import { THEME, compileChart, exampleDataset, type ChartCompileResult, type ChartDataset } from "./index.js";

const data = { kind: "publication", receiptId: "publication_1" } as const;
const rate: FieldMeta = { type: "quantitative", storage: "ratio", additivity: "non_additive", label: "延迟率" };
const orders: FieldMeta = { type: "quantitative", storage: "raw", unit: "单", additivity: "additive" };

const routes: ChartDataset = {
  columns: ["route", "delay_rate", "site_rate", "orders"],
  rows: [["RJ->SP", "0.1410", "0.0789", 8171], ["CE->SP", "0.1375", "0.0789", 967], ["RJ->PR", "0.1200", "0.0789", 975]],
};

function bars(chart: Record<string, unknown>, extra: Record<string, unknown> = {}): ChartSpec {
  return { version: 1, data, fields: { delay_rate: rate, site_rate: rate, orders }, chart: { mark: "cartesian", x: { field: "route" }, layers: [{ type: "bar", y: { field: "delay_rate" } }], ...chart }, ...extra } as ChartSpec;
}

function ok(result: ChartCompileResult) {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.errors)}`);
  return result;
}

function codes(result: ChartCompileResult): string[] {
  return result.ok ? [] : result.errors.map((error) => error.code);
}

const series = (result: ChartCompileResult) => ok(result).option.series as Record<string, unknown>[];

describe("Chart emphasis", () => {
  it("colours highlighted bars with the tone and the rest with the context colour", () => {
    const [bar] = series(compileChart(bars({ highlight: { values: ["RJ->SP"], tone: "bad" } }), routes, { target: "interactive" }));
    expect((bar!.data as { itemStyle: { color: string } }[]).map((point) => point.itemStyle.color)).toEqual([THEME.bad, THEME.context, THEME.context]);
    // The legend swatch shows what most bars are drawn in.
    expect(bar!.itemStyle).toEqual({ color: THEME.context, opacity: 0.6 });
  });

  it("highlights scatter points by their id", () => {
    const spec = { version: 1, data, fields: { delay_rate: rate, orders }, chart: { mark: "cartesian", x: { field: "delay_rate" }, layers: [{ type: "scatter", y: { field: "orders" }, id: { field: "route" } }], highlight: { values: ["CE->SP"] } } } as ChartSpec;
    const [points] = series(compileChart(spec, routes, { target: "interactive" }));
    expect((points!.data as { name: string; itemStyle: { color: string } }[]).map((point) => [point.name, point.itemStyle.color])).toEqual([["RJ->SP", THEME.context], ["CE->SP", THEME.focus], ["RJ->PR", THEME.context]]);
  });

  it("rejects a highlight it cannot draw", () => {
    expect(codes(compileChart(bars({ highlight: { values: ["SP->RJ"] } }), routes, { target: "interactive" }))).toEqual(["VALUE_OUT_OF_DOMAIN"]);
    const lineOnly = bars({ layers: [{ type: "line", y: { field: "delay_rate" } }], highlight: { values: ["RJ->SP"] } });
    expect(codes(compileChart(lineOnly, routes, { target: "interactive" }))).toEqual(["INVALID_ENCODING"]);
    const split = bars({ layers: [{ type: "bar", y: { field: "delay_rate" }, series: { field: "orders" } }], highlight: { values: ["RJ->SP"] } });
    expect(codes(compileChart(split, routes, { target: "interactive" }))).toContain("INVALID_ENCODING");
  });

  it("draws a reference line from a column that holds one value, at its shown scale", () => {
    const [bar] = series(compileChart(bars({ orientation: "horizontal", references: [{ field: "site_rate", label: "全站" }] }), routes, { target: "interactive" }));
    const markLine = bar!.markLine as { data: { xAxis: number; label: { formatter: string } }[] };
    expect(markLine.data).toEqual([{ xAxis: 7.89, label: { formatter: "全站 7.9%" } }]);
  });

  it("rejects a reference column whose rows differ or whose unit is not the axis's", () => {
    const varying = { ...routes, rows: routes.rows.map((row, index) => [...row.slice(0, 2), index === 0 ? "0.05" : "0.0789", row[3]]) };
    expect(compileChart(bars({ references: [{ field: "site_rate" }] }), varying, { target: "interactive" })).toMatchObject({ ok: false, errors: [{ code: "INVALID_ENCODING", path: "/chart/references/0/field" }] });
    expect(codes(compileChart(bars({ references: [{ field: "orders" }] }), routes, { target: "interactive" }))).toEqual(["INVALID_ENCODING"]);
    expect(codes(compileChart(bars({ references: [{ field: "site_rate", axis: "right" }] }), routes, { target: "interactive" }))).toEqual(["INVALID_ENCODING"]);
  });

  it("shades a labelled span of x categories", () => {
    const [bar] = series(compileChart(bars({ bands: [{ from: "CE->SP", to: "RJ->PR", label: "南线" }] }), routes, { target: "interactive" }));
    expect((bar!.markArea as { data: unknown[] }).data).toEqual([[{ name: "南线", xAxis: "CE->SP" }, { xAxis: "RJ->PR" }]]);
    expect(codes(compileChart(bars({ bands: [{ from: "RJ->PR", to: "RJ->SP", label: "x" }] }), routes, { target: "interactive" }))).toEqual(["INVALID_ENCODING"]);
    expect(codes(compileChart(bars({ bands: [{ from: "2017-11", label: "黑五" }] }), routes, { target: "interactive" }))).toEqual(["VALUE_OUT_OF_DOMAIN", "VALUE_OUT_OF_DOMAIN"]);
  });

  it("gives documentation examples rows that satisfy highlight, references and bands", () => {
    const spec = bars({ highlight: { values: ["RJ->SP"] }, references: [{ field: "site_rate" }], bands: [{ from: "RJ->SP", label: "x" }] });
    expect(compileChart(spec, exampleDataset(spec), { target: "interactive" }).ok).toBe(true);
  });
});
