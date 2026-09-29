import { describe, expect, it } from "vitest";
import { checkChartSpec } from "./index.js";

const valid = {
  version: 1,
  data: { kind: "publication", receiptId: "publication_1" },
  fields: { sales: { type: "quantitative", storage: "raw", additivity: "additive" } },
  chart: { mark: "cartesian", x: { field: "region" }, layers: [{ type: "bar", y: { field: "sales" } }] },
};

describe("ChartSpec schema", () => {
  it("accepts a v1 cartesian spec", () => {
    expect(checkChartSpec(valid).ok).toBe(true);
  });

  it("rejects unknown properties, versions and data references", () => {
    expect(checkChartSpec({ ...valid, option: {} }).ok).toBe(false);
    expect(checkChartSpec({ ...valid, version: 2 }).ok).toBe(false);
    expect(checkChartSpec({ ...valid, data: { kind: "workspace", path: "data/a.csv" } }).ok).toBe(false);
  });

  it("carries no aggregation or transform in encodings", () => {
    const withAggregate = { ...valid, chart: { ...valid.chart, layers: [{ type: "bar", y: { field: "sales", aggregate: "sum" } }] } };
    expect(checkChartSpec(withAggregate).ok).toBe(false);
  });

  it("requires storage and additivity for quantitative fields", () => {
    expect(checkChartSpec({ ...valid, fields: { sales: { type: "quantitative", storage: "raw" } } }).ok).toBe(false);
  });

  it("reports errors for the declared mark only", () => {
    const result = checkChartSpec({ ...valid, chart: { mark: "pie", category: { field: "region" } } });
    expect(result.ok ? [] : result.errors.map((error) => error.path)).toEqual(["/chart"]);
  });
});
