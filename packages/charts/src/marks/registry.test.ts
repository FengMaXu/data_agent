import { describe, expect, it } from "vitest";
import { CHART_MARK_SCHEMAS, type ChartSpec } from "@data-agent/contracts";
import { MARKS, compileChart, exampleDataset } from "../index.js";

const measure = { type: "quantitative", storage: "raw", additivity: "additive" } as const;

/** One minimal spec per mark: a new mark must add itself here, which also exercises its example rows. */
const minimal: Record<string, Record<string, unknown>> = {
  cartesian: { mark: "cartesian", x: { field: "c" }, layers: [{ type: "bar", y: { field: "v" } }] },
  pie: { mark: "pie", category: { field: "c" }, value: { field: "v" } },
  heatmap: { mark: "heatmap", x: { field: "c" }, y: { field: "d" }, color: { field: "v" } },
  histogram: { mark: "histogram", start: { field: "a" }, end: { field: "b" }, value: { field: "v" } },
  boxplot: { mark: "boxplot", category: { field: "c" }, min: { field: "a" }, q1: { field: "b" }, median: { field: "v" }, q3: { field: "q" }, max: { field: "e" }, whisker: "min_max" },
  waterfall: { mark: "waterfall", step: { field: "c" }, start: { field: "a" }, end: { field: "v" }, total: { field: "t" } },
  sankey: { mark: "sankey", source: { field: "c" }, target: { field: "d" }, value: { field: "v" } },
  treemap: { mark: "treemap", path: [{ field: "c" }, { field: "d" }], value: { field: "v" } },
  funnel: { mark: "funnel", stage: { field: "c" }, value: { field: "v" } },
  sunburst: { mark: "sunburst", path: [{ field: "c" }, { field: "d" }], value: { field: "v" } },
};

describe("Mark registry", () => {
  it("defines every mark the contract lists, and nothing else", () => {
    const contract = CHART_MARK_SCHEMAS.map((schema) => schema.properties.mark.const).sort();
    expect(Object.keys(MARKS).sort()).toEqual(contract);
    expect(Object.keys(minimal).sort()).toEqual(contract);
  });

  it("gives every mark example rows its compiler accepts", () => {
    for (const [mark, chart] of Object.entries(minimal)) {
      // Measures are a, b, e, q and v; c and d are categories.
      const spec = { version: 1, data: { kind: "publication", receiptId: "p" }, fields: { a: measure, b: measure, e: measure, q: measure, v: measure }, chart } as unknown as ChartSpec;
      const result = compileChart(spec, exampleDataset(spec), { target: "static" });
      expect(result.ok ? [] : result.errors, mark).toEqual([]);
    }
  });
});
