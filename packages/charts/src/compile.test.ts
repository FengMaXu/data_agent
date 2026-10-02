import { describe, expect, it } from "vitest";
import type { ChartSpec, FieldMeta } from "@data-agent/contracts";
import { compileChart, formatFieldValue, validateChart, type ChartCompileResult, type ChartDataset } from "./index.js";

const additive: FieldMeta = { type: "quantitative", storage: "raw", additivity: "additive" };
const data = { kind: "publication", receiptId: "publication_1" } as const;

function cartesian(layers: ChartSpec extends { chart: infer C } ? (C extends { mark: "cartesian"; layers: infer L } ? L : never) : never, extra: Partial<ChartSpec> = {}, x = "region"): ChartSpec {
  return { version: 1, data, fields: { sales: additive }, chart: { mark: "cartesian", x: { field: x }, layers }, ...extra } as ChartSpec;
}

const regions: ChartDataset = { columns: ["region", "sales"], rows: [["east", 10], ["west", "12.50"], ["north", 7]] };

function ok(result: ChartCompileResult) {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.errors)}`);
  return result;
}

function codes(result: ChartCompileResult): string[] {
  return result.ok ? [] : result.errors.map((error) => error.code);
}

function axis(option: Record<string, unknown>, key: "xAxis" | "yAxis"): Record<string, unknown>[] {
  const value = option[key];
  return (Array.isArray(value) ? value : [value]) as Record<string, unknown>[];
}

function seriesOf(option: Record<string, unknown>): Record<string, unknown>[] {
  return option.series as Record<string, unknown>[];
}

describe("ChartSpec schema", () => {
  it("rejects structurally invalid specs with a JSON path", () => {
    const result = compileChart({ version: 1, data, chart: { mark: "cartesian", x: { field: "region" }, layers: [] } }, regions, { target: "interactive" });
    // Only the cartesian requirements are reported, not those of every other mark.
    expect(result.ok ? [] : result.errors).toEqual([{ code: "SCHEMA_INVALID", path: "/chart/layers", message: expect.any(String) }]);
    const unknownMark = compileChart({ version: 1, data, chart: { mark: "sankey" } }, regions, { target: "interactive" });
    expect(codes(unknownMark).length).toBeGreaterThan(0);
    expect(new Set(codes(unknownMark))).toEqual(new Set(["SCHEMA_INVALID"]));
  });

  it("rejects fields the dataset does not have", () => {
    const result = compileChart(cartesian([{ type: "bar", y: { field: "revenue" } }]), regions, { target: "interactive" });
    expect(codes(result)).toContain("FIELD_NOT_FOUND");
  });
});

describe("Field semantics", () => {
  it("requires declared quantitative semantics for every measure", () => {
    const spec = { ...cartesian([{ type: "bar", y: { field: "sales" } }]), fields: {} };
    expect(codes(compileChart(spec, regions, { target: "interactive" }))).toEqual(["SEMANTICS_MISSING"]);
  });

  it("rejects measure cells that are neither numbers, DECIMAL text nor NULL", () => {
    const dataset = { columns: ["region", "sales"], rows: [["east", "10%"]] };
    expect(codes(compileChart(cartesian([{ type: "bar", y: { field: "sales" } }]), dataset, { target: "interactive" }))).toEqual(["VALUE_NOT_NUMERIC"]);
  });

  it("reads DECIMAL text as numbers and keeps categories in first-appearance order", () => {
    const { option } = ok(compileChart(cartesian([{ type: "bar", y: { field: "sales" } }]), regions, { target: "interactive" }));
    expect(axis(option, "xAxis")[0]!.data).toEqual(["east", "west", "north"]);
    expect(seriesOf(option)[0]!.data).toEqual([10, 12.5, 7]);
  });

  it("shows a ratio as percent without guessing from the values", () => {
    const spec = { ...cartesian([{ type: "line", y: { field: "rate" } }]), fields: { rate: { type: "quantitative", storage: "ratio", additivity: "non_additive" } as FieldMeta } };
    const { option } = ok(compileChart(spec, { columns: ["region", "rate"], rows: [["east", 0.12], ["west", 1.5]] }, { target: "interactive" }));
    expect(seriesOf(option)[0]!.data).toEqual([12, 150]);
    expect(axis(option, "yAxis")[0]!.name).toBe("rate（%）");
    const raw = { ...spec, fields: { rate: { type: "quantitative", storage: "raw", additivity: "non_additive" } as FieldMeta } };
    expect(seriesOf(ok(compileChart(raw, { columns: ["region", "rate"], rows: [["east", 0.12]] }, { target: "interactive" })).option)[0]!.data).toEqual([0.12]);
  });

  it("converts only between declared magnitudes and names the unit", () => {
    const spec = { ...cartesian([{ type: "bar", y: { field: "sales" } }]), fields: { sales: { type: "quantitative", storage: "raw", unit: "元", magnitude: { stored: 1, shown: 1e8 }, additivity: "additive", label: "销售额" } as FieldMeta } };
    const { option } = ok(compileChart(spec, { columns: ["region", "sales"], rows: [["east", 250000000]] }, { target: "interactive" }));
    expect(seriesOf(option)[0]!.data).toEqual([2.5]);
    expect(axis(option, "yAxis")[0]!.name).toBe("销售额（亿元）");
  });

  it("uses resolved fields from the caller over the spec's own declarations", () => {
    const spec = { ...cartesian([{ type: "bar", y: { field: "sales" } }]), fields: {} };
    expect(compileChart(spec, regions, { target: "interactive", fields: { sales: additive } }).ok).toBe(true);
  });

  it("orders ordinal and temporal categories by their semantics", () => {
    const ordinal = { ...cartesian([{ type: "bar", y: { field: "sales" } }], {}, "size"), fields: { sales: additive, size: { type: "ordinal", order: ["S", "M", "L"] } as FieldMeta } };
    expect(axis(ok(compileChart(ordinal, { columns: ["size", "sales"], rows: [["L", 1], ["S", 2], ["M", 3]] }, { target: "interactive" })).option, "xAxis")[0]!.data).toEqual(["S", "M", "L"]);
    const temporal = { ...cartesian([{ type: "line", y: { field: "sales" } }], {}, "month"), fields: { sales: additive, month: { type: "temporal", grain: "month", zone: "floating" } as FieldMeta } };
    expect(axis(ok(compileChart(temporal, { columns: ["month", "sales"], rows: [["2026-03", 1], ["2026-01", 2]] }, { target: "interactive" })).option, "xAxis")[0]!.data).toEqual(["2026-01", "2026-03"]);
  });
});

describe("Observations are never merged or zero-filled", () => {
  it("rejects two rows for one category instead of summing them", () => {
    const dataset = { columns: ["region", "sales"], rows: [["east", 1], ["east", 2]] };
    const result = compileChart(cartesian([{ type: "bar", y: { field: "sales" } }]), dataset, { target: "interactive" });
    expect(codes(result)).toEqual(["DUPLICATE_KEY"]);
  });

  it("allows repeated scatter coordinates and keeps both points", () => {
    const dataset = { columns: ["region", "sales"], rows: [["east", 1], ["east", 1]] };
    const { option } = ok(compileChart(cartesian([{ type: "scatter", y: { field: "sales" } }]), dataset, { target: "interactive" }));
    expect((seriesOf(option)[0]!.data as unknown[]).length).toBe(2);
  });

  it("places points on a ratio x axis at their shown percent", () => {
    const rate: FieldMeta = { type: "quantitative", storage: "ratio", additivity: "non_additive", label: "逾期率" };
    const spec = { version: 1, data, fields: { rate, sales: additive }, chart: { mark: "cartesian", x: { field: "rate" }, layers: [{ type: "scatter", y: { field: "sales" } }] } } as ChartSpec;
    const { option } = ok(compileChart(spec, { columns: ["rate", "sales"], rows: [["0.5652", 17], [0.2, 3]] }, { target: "interactive" }));
    expect((seriesOf(option)[0]!.data as { value: number[] }[]).map((point) => point.value[0])).toEqual([56.52, 20]);
    const formatter = (axis(option, "xAxis")[0]!.axisLabel as { formatter: (value: number) => string }).formatter;
    expect(formatter(50)).toBe("50%");
  });

  it("draws NULL and missing combinations as gaps and says so", () => {
    const dataset = { columns: ["region", "industry", "sales"], rows: [["east", "retail", 1], ["west", "retail", null], ["east", "food", 3]] };
    const spec = cartesian([{ type: "bar", y: { field: "sales" }, series: { field: "industry" } }]);
    const { option, notices } = ok(compileChart(spec, dataset, { target: "interactive" }));
    expect(seriesOf(option).map((series) => series.data)).toEqual([[1, null], [3, null]]);
    expect(notices.map((notice) => notice.code)).toContain("NULL_VALUES");
  });

  it("splits long tables into series in the declared order with declared colours", () => {
    const dataset = { columns: ["region", "industry", "sales"], rows: [["east", "retail", 1], ["east", "food", 2]] };
    const spec = cartesian([{ type: "line", y: { field: "sales" }, series: { field: "industry", order: ["food", "retail"], colors: { food: "#638B66" } } }]);
    const series = seriesOf(ok(compileChart(spec, dataset, { target: "interactive" })).option);
    expect(series.map((item) => item.name)).toEqual(["food", "retail"]);
    expect(series[0]!.itemStyle).toEqual({ color: "#638B66" });
  });
});

describe("Axes and layers", () => {
  it("binds a right-axis layer to the second value axis", () => {
    const dataset = { columns: ["region", "sales", "growth"], rows: [["east", 10, 0.1]] };
    const spec = { ...cartesian([{ type: "bar", y: { field: "sales" } }, { type: "line", y: { field: "growth", axis: "right" } }]), fields: { sales: additive, growth: { type: "quantitative", storage: "ratio", additivity: "non_additive" } as FieldMeta } };
    const { option } = ok(compileChart(spec, dataset, { target: "interactive" }));
    expect(axis(option, "yAxis")).toHaveLength(2);
    expect(seriesOf(option)[1]!.yAxisIndex).toBe(1);
    expect(seriesOf(option)[0]!.yAxisIndex).toBeUndefined();
  });

  it("keeps a chart whose only layer is on the right on axis 0", () => {
    const { option } = ok(compileChart(cartesian([{ type: "bar", y: { field: "sales", axis: "right" } }]), regions, { target: "interactive" }));
    expect(axis(option, "yAxis")).toHaveLength(1);
    expect(seriesOf(option)[0]!.yAxisIndex).toBeUndefined();
  });

  it("swaps axes for horizontal bars and rejects a right axis there", () => {
    const horizontal = { ...cartesian([{ type: "bar", y: { field: "sales" } }]), chart: { mark: "cartesian", x: { field: "region" }, layers: [{ type: "bar", y: { field: "sales" } }], orientation: "horizontal" } } as ChartSpec;
    const { option } = ok(compileChart(horizontal, regions, { target: "interactive" }));
    expect(axis(option, "yAxis")[0]!).toMatchObject({ type: "category", inverse: true });
    expect(axis(option, "xAxis")[0]!.type).toBe("value");
    const right = { ...horizontal, chart: { ...horizontal.chart, layers: [{ type: "bar", y: { field: "sales", axis: "right" } }] } } as ChartSpec;
    expect(codes(compileChart(right, regions, { target: "interactive" }))).toEqual(["INVALID_ENCODING"]);
  });

  it("rejects horizontal orientation where points would be drawn with swapped coordinates", () => {
    const horizontalScatter = { ...cartesian([]), chart: { mark: "cartesian", x: { field: "region" }, layers: [{ type: "scatter", y: { field: "sales" } }], orientation: "horizontal" } } as ChartSpec;
    expect(codes(compileChart(horizontalScatter, regions, { target: "interactive" }))).toEqual(["INVALID_ENCODING"]);
    const fields = { sales: additive, price: { type: "quantitative", storage: "raw", additivity: "non_additive" } as FieldMeta };
    const horizontalValueX = { version: 1, data, fields, chart: { mark: "cartesian", x: { field: "price" }, layers: [{ type: "line", y: { field: "sales" } }], orientation: "horizontal" } } as ChartSpec;
    expect(codes(compileChart(horizontalValueX, { columns: ["price", "sales"], rows: [[1, 2]] }, { target: "interactive" }))).toEqual(["INVALID_ENCODING"]);
  });

  it("labels value-axis ticks with numbers only, leaving the unit to the axis name", () => {
    const spec = { ...cartesian([{ type: "bar", y: { field: "sales" } }]), fields: { sales: { type: "quantitative", storage: "raw", unit: "元", magnitude: { stored: 1, shown: 1e8 }, additivity: "additive" } as FieldMeta } };
    const tick = (axis(ok(compileChart(spec, regions, { target: "interactive" })).option, "yAxis")[0]!.axisLabel as { formatter: (value: number) => string }).formatter;
    expect(tick(12000)).toBe("12,000");
    const ratio = { ...spec, fields: { sales: { type: "quantitative", storage: "ratio", additivity: "non_additive" } as FieldMeta } };
    expect((axis(ok(compileChart(ratio, regions, { target: "interactive" })).option, "yAxis")[0]!.axisLabel as { formatter: (value: number) => string }).formatter(12)).toBe("12%");
  });

  it("draws lines over a numeric x as points sorted by x and rejects bars there", () => {
    const fields = { sales: additive, price: { type: "quantitative", storage: "raw", additivity: "non_additive" } as FieldMeta };
    const dataset = { columns: ["price", "sales"], rows: [[3, 30], [1, 10], [2, null]] };
    const line = { ...cartesian([{ type: "line", y: { field: "sales" } }], {}, "price"), fields };
    const { option } = ok(compileChart(line, dataset, { target: "interactive" }));
    expect((seriesOf(option)[0]!.data as { value: unknown[] }[]).map((point) => point.value)).toEqual([[1, 10], [2, null], [3, 30]]);
    expect(axis(option, "xAxis")[0]!.type).toBe("value");
    expect(codes(compileChart({ ...line, chart: { mark: "cartesian", x: { field: "price" }, layers: [{ type: "bar", y: { field: "sales" } }] } } as ChartSpec, dataset, { target: "interactive" }))).toEqual(["INVALID_ENCODING"]);
  });

  it("returns formatter functions only in memory and compiles deterministically", () => {
    const run = () => ok(compileChart(cartesian([{ type: "bar", y: { field: "sales" } }]), regions, { target: "static" }));
    const first = run();
    expect(typeof (axis(first.option, "yAxis")[0]!.axisLabel as { formatter: unknown }).formatter).toBe("function");
    expect(JSON.stringify(first.option)).toBe(JSON.stringify(run().option));
    expect(first.option.animation).toBe(false);
  });
});

describe("Part-of-whole marks", () => {
  const stacked = (stack: "stacked" | "percent", meta: FieldMeta = additive) => ({ ...cartesian([{ type: "bar", y: { field: "sales" }, series: { field: "industry" }, stack }]), fields: { sales: meta } });
  const complete = { columns: ["region", "industry", "sales"], rows: [["east", "retail", 1], ["east", "food", 3], ["west", "retail", 2], ["west", "food", 2]] };

  it("stacks additive, complete, non-negative measures and derives shares for percent stacks", () => {
    expect(seriesOf(ok(compileChart(stacked("stacked"), complete, { target: "interactive" })).option)[0]!.stack).toBe("layer-0");
    const shares = seriesOf(ok(compileChart(stacked("percent"), complete, { target: "interactive" })).option).map((series) => series.data);
    expect(shares).toEqual([[25, 50], [75, 50]]);
  });

  it("rejects non-additive, incomplete, negative or selected stacks", () => {
    expect(codes(compileChart(stacked("stacked", { type: "quantitative", storage: "ratio", additivity: "non_additive" }), complete, { target: "interactive" }))).toContain("NON_ADDITIVE_PART_OF_WHOLE");
    const gap = { ...complete, rows: complete.rows.slice(0, 3) };
    expect(codes(compileChart(stacked("percent"), gap, { target: "interactive" }))).toContain("INCOMPLETE_PART_OF_WHOLE");
    const negative = { ...complete, rows: [...complete.rows.slice(0, 3), ["west", "food", -1]] };
    expect(codes(compileChart(stacked("stacked"), negative, { target: "interactive" }))).toContain("NEGATIVE_IN_PART_OF_WHOLE");
    const selected = { ...stacked("stacked"), selection: { kind: "top_n", by: "sales", n: 1, order: "desc" } } as ChartSpec;
    expect(codes(compileChart(selected, complete, { target: "interactive" }))).toContain("INCOMPLETE_PART_OF_WHOLE");
  });

  const pie = (meta: FieldMeta = additive, extra: Partial<ChartSpec> = {}): ChartSpec => ({ version: 1, data, fields: { sales: meta }, chart: { mark: "pie", category: { field: "region" }, value: { field: "sales" } }, ...extra } as ChartSpec);

  it("draws a pie from one row per category", () => {
    const { option } = ok(compileChart(pie(), regions, { target: "interactive" }));
    expect((seriesOf(option)[0]!.data as unknown[])).toEqual([{ name: "east", value: 10 }, { name: "west", value: 12.5 }, { name: "north", value: 7 }]);
  });

  it("rejects pies that would change the whole", () => {
    expect(codes(compileChart(pie({ type: "quantitative", storage: "ratio", additivity: "non_additive" }), regions, { target: "interactive" }))).toContain("NON_ADDITIVE_PART_OF_WHOLE");
    expect(codes(compileChart(pie(), { columns: ["region", "sales"], rows: [["east", 1], ["east", 2]] }, { target: "interactive" }))).toContain("DUPLICATE_KEY");
    expect(codes(compileChart(pie(), { columns: ["region", "sales"], rows: [["east", -1]] }, { target: "interactive" }))).toContain("NEGATIVE_IN_PART_OF_WHOLE");
    expect(codes(compileChart(pie(), { columns: ["region", "sales"], rows: [["east", null]] }, { target: "interactive" }))).toContain("INCOMPLETE_PART_OF_WHOLE");
    expect(codes(compileChart(pie(additive, { selection: { kind: "top_n", by: "sales", n: 2, order: "desc" } }), regions, { target: "interactive" }))).toContain("INCOMPLETE_PART_OF_WHOLE");
  });

  it("caps static pies instead of merging slices into an implicit other", () => {
    const many = { columns: ["region", "sales"], rows: Array.from({ length: 13 }, (_, index) => [`r${index}`, 1]) };
    expect(codes(compileChart(pie(), many, { target: "static" }))).toEqual(["CAPACITY_EXCEEDED"]);
    expect(compileChart(pie(), many, { target: "interactive" }).ok).toBe(true);
  });
});

describe("Selection, capacity and viewport", () => {
  const wide: ChartDataset = { columns: ["region", "sales"], rows: Array.from({ length: 100 }, (_, index) => [`r${index}`, index]) };

  it("keeps only the declared top N and reports the shown range", () => {
    const spec = cartesian([{ type: "bar", y: { field: "sales" } }], { selection: { kind: "top_n", by: "sales", n: 2, order: "desc" } });
    const { option, notices } = ok(compileChart(spec, regions, { target: "interactive" }));
    expect(axis(option, "xAxis")[0]!.data).toEqual(["west", "east"]);
    expect(notices).toContainEqual(expect.objectContaining({ kind: "selection", code: "TOP_N" }));
  });

  it("refuses to rank categories that have several rows", () => {
    const dataset = { columns: ["region", "industry", "sales"], rows: [["east", "a", 1], ["east", "b", 2]] };
    const spec = cartesian([{ type: "bar", y: { field: "sales" }, series: { field: "industry" } }], { selection: { kind: "top_n", by: "sales", n: 1, order: "desc" } });
    expect(codes(compileChart(spec, dataset, { target: "interactive" }))).toEqual(["INVALID_SELECTION"]);
  });

  it("fails static charts that cannot fit every category rather than cropping them", () => {
    const spec = cartesian([{ type: "bar", y: { field: "sales" } }]);
    const result = compileChart(spec, wide, { target: "static", width: 800 });
    expect(codes(result)).toEqual(["CAPACITY_EXCEEDED"]);
    expect(result.ok ? "" : result.errors[0]!.hint).toContain("selection");
    expect(compileChart({ ...spec, selection: { kind: "top_n", by: "sales", n: 10, order: "desc" } }, wide, { target: "static" }).ok).toBe(true);
    expect(compileChart(spec, wide, { target: "static", width: 2400 }).ok).toBe(true);
  });

  it("uses a declared viewport only on interactive targets", () => {
    const spec = cartesian([{ type: "bar", y: { field: "sales" } }], { viewport: { mode: "scroll", window: 20 } });
    const interactive = ok(compileChart(spec, wide, { target: "interactive" }));
    expect(interactive.option.dataZoom).toEqual([expect.objectContaining({ type: "slider", startValue: 0, endValue: 19 })]);
    expect(interactive.notices).toContainEqual(expect.objectContaining({ kind: "viewport" }));
    expect(codes(compileChart(spec, wide, { target: "static" }))).toEqual(["CAPACITY_EXCEEDED"]);
  });

  it("reports truncated labels", () => {
    const dataset = { columns: ["region", "sales"], rows: [["an unusually long region name here", 1]] };
    const { notices } = ok(compileChart(cartesian([{ type: "bar", y: { field: "sales" } }]), dataset, { target: "interactive" }));
    expect(notices.map((notice) => notice.code)).toContain("LABELS_TRUNCATED");
  });

  it("validates without keeping the option", () => {
    expect(validateChart(cartesian([{ type: "bar", y: { field: "sales" } }]), regions, { target: "static" })).toEqual({ ok: true, notices: [] });
  });
});

describe("formatFieldValue", () => {
  it("formats values only under declared quantitative semantics", async () => {
    const { formatFieldValue } = await import("./index.js");
    expect(formatFieldValue(0.1234, { type: "quantitative", storage: "ratio", additivity: "non_additive" })).toBe("12.34%");
    expect(formatFieldValue("250000000", { type: "quantitative", storage: "raw", unit: "元", magnitude: { stored: 1, shown: 1e8 }, additivity: "additive" })).toBe("2.5 亿元");
    expect(formatFieldValue(0.12, undefined)).toBeUndefined();
    expect(formatFieldValue(0.12, { type: "nominal" })).toBeUndefined();
    expect(formatFieldValue("n/a", { type: "quantitative", storage: "raw", additivity: "additive" })).toBeUndefined();
  });
});

describe("Temporal fields", () => {
  const monthly = (zone: string, grain: "month" | "day" | "quarter" | "hour" = "month"): ChartSpec => ({
    version: 1, data, fields: { sales: additive, month: { type: "temporal", grain, zone } },
    chart: { mark: "cartesian", x: { field: "month" }, layers: [{ type: "line", y: { field: "sales" } }] },
  } as ChartSpec);
  const xData = (result: ChartCompileResult) => (axis(ok(result).option, "xAxis")[0]!.data as string[]);

  it("cuts calendar text to the declared grain without shifting it", () => {
    const dates = { columns: ["month", "sales"], rows: [["2025-12-01", 2], ["2025-11-01", 1]] };
    expect(xData(compileChart(monthly("floating"), dates, { target: "interactive" }))).toEqual(["2025-11", "2025-12"]);
    expect(xData(compileChart(monthly("floating", "day"), dates, { target: "interactive" }))).toEqual(["2025-11-01", "2025-12-01"]);
    expect(xData(compileChart(monthly("floating", "quarter"), { columns: ["month", "sales"], rows: [["2025-12-01", 2], ["2025-08-01", 1]] }, { target: "interactive" }))).toEqual(["2025-Q3", "2025-Q4"]);
    const times = { columns: ["month", "sales"], rows: [["2025-12-01 08:30:00", 1]] };
    expect(xData(compileChart(monthly("floating", "hour"), times, { target: "interactive" }))).toEqual(["2025-12-01 08:00"]);
  });

  it("rejects two rows that fall in one period instead of merging them", () => {
    const days = { columns: ["month", "sales"], rows: [["2025-12-01", 1], ["2025-12-15", 2]] };
    expect(codes(compileChart(monthly("floating"), days, { target: "interactive" }))).toEqual(["DUPLICATE_KEY"]);
  });

  it("places instants in the declared zone, whatever zone the process runs in", () => {
    // DATE '2025-12-01' read at local midnight in UTC+8 and serialised as UTC.
    const instants = { columns: ["month", "sales"], rows: [["2025-11-30T16:00:00.000Z", 1], [new Date("2025-12-31T16:00:00.000Z"), 2]] };
    const original = process.env.TZ;
    try {
      const options = ["UTC", "Asia/Shanghai", "America/New_York"].map((zone) => {
        process.env.TZ = zone;
        return JSON.stringify(ok(compileChart(monthly("Asia/Shanghai", "day"), instants, { target: "static" })).option);
      });
      expect(new Set(options).size).toBe(1);
      expect(xData(compileChart(monthly("Asia/Shanghai", "day"), instants, { target: "interactive" }))).toEqual(["2025-12-01", "2026-01-01"]);
    } finally {
      if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
    }
  });

  it("shows zoned values of a floating field as written, with a notice", () => {
    const result = ok(compileChart(monthly("floating", "day"), { columns: ["month", "sales"], rows: [["2025-11-30T16:00:00.000Z", 1]] }, { target: "interactive" }));
    expect(axis(result.option, "xAxis")[0]!.data).toEqual(["2025-11-30T16:00:00.000Z"]);
    expect(result.notices.map((notice) => notice.code)).toContain("TEMPORAL_ZONED_VALUE");
  });

  it("formats temporal cells for tables by grain", () => {
    expect(formatFieldValue("2025-12-01", { type: "temporal", grain: "month", zone: "floating" })).toBe("2025-12");
    expect(formatFieldValue(null, { type: "temporal", grain: "month", zone: "floating" })).toBeUndefined();
    expect(formatFieldValue("2025年12月", { type: "temporal", grain: "month", zone: "floating" })).toBe("2025年12月");
  });
});

describe("Heatmap", () => {
  const growth: FieldMeta = { type: "quantitative", storage: "ratio", additivity: "non_additive", label: "同比" };
  const heat = (color: Record<string, unknown> = { field: "growth" }, extra: Partial<ChartSpec> = {}) =>
    ({ version: 1, data, fields: { growth, month: { type: "temporal", grain: "month", zone: "floating" } }, chart: { mark: "heatmap", x: { field: "month" }, y: { field: "region" }, color }, ...extra }) as ChartSpec;
  const cells: ChartDataset = { columns: ["region", "month", "growth"], rows: [["东", "2025-02-01", 0.3], ["东", "2025-01-01", 0.1], ["西", "2025-01-01", -0.2], ["西", "2025-02-01", null]] };

  it("places one row per cell on two category axes, blanks for nulls", () => {
    const { option, notices } = ok(compileChart(heat(), cells, { target: "interactive" }));
    expect(axis(option, "xAxis")[0]!.data).toEqual(["2025-01", "2025-02"]);
    expect(axis(option, "yAxis")[0]!.data).toEqual(["东", "西"]);
    expect(seriesOf(option)[0]!.data).toEqual([[1, 0, 30], [0, 0, 10], [0, 1, -20], [1, 1, "-"]]);
    expect(notices.map((notice) => notice.code)).toContain("NULL_VALUES");
  });

  it("rejects two rows in one cell instead of summing them", () => {
    const duplicated = { columns: cells.columns, rows: [["东", "2025-01-01", 0.1], ["东", "2025-01-01", 0.3]] };
    expect(codes(compileChart(heat(), duplicated, { target: "interactive" }))).toEqual(["DUPLICATE_KEY"]);
  });

  it("leaves absent combinations blank and says so", () => {
    const sparse = { columns: cells.columns, rows: [["东", "2025-01-01", 0.1], ["西", "2025-02-01", 0.2]] };
    const { option, notices } = ok(compileChart(heat(), sparse, { target: "interactive" }));
    expect(seriesOf(option)[0]!.data).toHaveLength(2);
    expect(notices.map((notice) => notice.code)).toContain("EMPTY_CELLS");
  });

  it("needs a declared midpoint for a diverging scale, and centres the scale on it", () => {
    expect(codes(compileChart(heat({ field: "growth", scale: "diverging" }), cells, { target: "interactive" }))).toEqual(["INVALID_ENCODING"]);
    expect(codes(compileChart(heat({ field: "growth", midpoint: 0 }), cells, { target: "interactive" }))).toEqual(["INVALID_ENCODING"]);
    const { option } = ok(compileChart(heat({ field: "growth", scale: "diverging", midpoint: 0 }), cells, { target: "interactive" }));
    expect(option.visualMap).toMatchObject({ min: -30, max: 30 });
  });

  it("requires colour semantics and refuses data selection", () => {
    expect(codes(compileChart({ ...heat(), fields: {} } as ChartSpec, cells, { target: "interactive" }))).toEqual(["SEMANTICS_MISSING"]);
    expect(codes(compileChart(heat({ field: "growth" }, { selection: { kind: "top_n", by: "growth", n: 1, order: "desc" } }), cells, { target: "interactive" }))).toEqual(["INVALID_SELECTION"]);
  });

  it("refuses more columns than a static canvas can show", () => {
    const wide = { columns: cells.columns, rows: Array.from({ length: 60 }, (_, index) => ["东", `c${index}`, 0.1]) };
    const spec = { ...heat(), fields: { growth } } as ChartSpec;
    expect(codes(compileChart(spec, wide, { target: "static" }))).toEqual(["CAPACITY_EXCEEDED"]);
  });
});

describe("Histogram", () => {
  const amount: FieldMeta = { type: "quantitative", storage: "raw", unit: "元", additivity: "additive", label: "订单金额" };
  const count: FieldMeta = { type: "quantitative", storage: "raw", unit: "单", additivity: "additive", label: "订单数" };
  const histogram = (): ChartSpec => ({ version: 1, data, fields: { lo: amount, hi: amount, n: count }, chart: { mark: "histogram", start: { field: "lo" }, end: { field: "hi" }, value: { field: "n" } } } as ChartSpec);
  const bins = (rows: unknown[][]): ChartDataset => ({ columns: ["lo", "hi", "n"], rows });

  it("draws the query's bins in order as adjacent bars, never binning itself", () => {
    const { option } = ok(compileChart(histogram(), bins([[100, 200, 7], [0, 100, 3], [200, 300, null]]), { target: "interactive" }));
    expect(axis(option, "xAxis")[0]!.data).toEqual(["0–100", "100–200", "200–300"]);
    expect(axis(option, "xAxis")[0]!.name).toBe("订单金额（元）");
    expect(seriesOf(option)[0]!).toMatchObject({ type: "bar", barCategoryGap: "0%", data: [3, 7, null] });
  });

  it("rejects overlapping or inverted bins, and notes gaps", () => {
    expect(codes(compileChart(histogram(), bins([[0, 150, 3], [100, 200, 7]]), { target: "interactive" }))).toEqual(["BIN_OVERLAP"]);
    expect(codes(compileChart(histogram(), bins([[100, 100, 3]]), { target: "interactive" }))).toEqual(["BIN_OVERLAP"]);
    const gap = ok(compileChart(histogram(), bins([[0, 100, 3], [200, 300, 1]]), { target: "interactive" }));
    expect(gap.notices.map((notice) => notice.code)).toContain("BIN_GAPS");
  });
});

describe("Boxplot", () => {
  const price: FieldMeta = { type: "quantitative", storage: "raw", unit: "元", additivity: "non_additive", label: "单价" };
  const boxplot = (whisker = "iqr_1_5"): ChartSpec => ({ version: 1, data, fields: { mn: price, q1: price, md: price, q3: price, mx: price }, chart: { mark: "boxplot", category: { field: "region" }, min: { field: "mn" }, q1: { field: "q1" }, median: { field: "md" }, q3: { field: "q3" }, max: { field: "mx" }, whisker } } as ChartSpec);
  const stats = (rows: unknown[][]): ChartDataset => ({ columns: ["region", "mn", "q1", "md", "q3", "mx"], rows });

  it("draws the five statistics the query computed and states the whisker definition", () => {
    const { option, notices } = ok(compileChart(boxplot(), stats([["东", 1, 2, 3, 4, 5], ["西", 2, 3, "3.5", 5, 9]]), { target: "static" }));
    expect(seriesOf(option)[0]!).toMatchObject({ type: "boxplot", data: [[1, 2, 3, 4, 5], [2, 3, 3.5, 5, 9]] });
    expect(notices.find((notice) => notice.code === "WHISKER_DEFINITION")?.message).toContain("1.5 倍四分位距");
  });

  it("rejects statistics out of order, missing, or repeated per category", () => {
    expect(codes(compileChart(boxplot(), stats([["东", 1, 3, 2, 4, 5]]), { target: "interactive" }))).toEqual(["STAT_ORDER_VIOLATION"]);
    expect(codes(compileChart(boxplot(), stats([["东", 1, 2, null, 4, 5]]), { target: "interactive" }))).toEqual(["STAT_ORDER_VIOLATION"]);
    expect(codes(compileChart(boxplot(), stats([["东", 1, 2, 3, 4, 5], ["东", 1, 2, 3, 4, 6]]), { target: "interactive" }))).toEqual(["DUPLICATE_KEY"]);
    expect(new Set(codes(compileChart(boxplot("tukey"), stats([["东", 1, 2, 3, 4, 5]]), { target: "interactive" })))).toEqual(new Set(["SCHEMA_INVALID"]));
  });
});

describe("Waterfall", () => {
  const profit: FieldMeta = { type: "quantitative", storage: "raw", unit: "万元", additivity: "non_additive", label: "利润" };
  const waterfall = (): ChartSpec => ({ version: 1, data, fields: { s: profit, e: profit }, chart: { mark: "waterfall", step: { field: "step" }, start: { field: "s" }, end: { field: "e" }, total: { field: "is_total" } } } as ChartSpec);
  const steps = (rows: unknown[][]): ChartDataset => ({ columns: ["step", "s", "e", "is_total"], rows });
  const bridge = [["期初", 0, 100, true], ["收入", 100, 160, false], ["成本", 160, 90, false], ["期末", 0, 90, "合计"]];

  it("draws the query's running totals in row order, labelled with their end values", () => {
    const { option } = ok(compileChart(waterfall(), steps(bridge), { target: "static" }));
    expect(axis(option, "xAxis")[0]!.data).toEqual(["期初", "收入", "成本", "期末"]);
    const [base, bars] = seriesOf(option);
    expect(base!.data).toEqual([0, 100, 90, 0]);
    expect((bars!.data as { value: number; itemStyle: { color: string } }[]).map((bar) => bar.value)).toEqual([100, 60, 70, 90]);
    expect((bars!.data as { itemStyle: { color: string } }[]).map((bar) => bar.itemStyle.color)).toEqual(["#4F6980", "#638B66", "#B66353", "#4F6980"]);
  });

  it("rejects steps that do not continue from the previous end, and totals that disagree", () => {
    const broken = bridge.map((row) => [...row]);
    broken[2]![1] = 150;
    expect(codes(compileChart(waterfall(), steps(broken), { target: "interactive" }))).toEqual(["RANGE_INCONSISTENT"]);
    const wrongTotal = bridge.map((row) => [...row]);
    wrongTotal[3]![2] = 95;
    expect(codes(compileChart(waterfall(), steps(wrongTotal), { target: "interactive" }))).toEqual(["RANGE_INCONSISTENT"]);
    const floating = bridge.map((row) => [...row]);
    floating[3]![1] = 10;
    expect(codes(compileChart(waterfall(), steps(floating), { target: "interactive" }))).toEqual(["RANGE_INCONSISTENT"]);
    expect(codes(compileChart(waterfall(), steps([["期初", 0, null, true]]), { target: "interactive" }))).toEqual(["RANGE_INCONSISTENT"]);
  });
});

describe("Sankey", () => {
  const flow: FieldMeta = { type: "quantitative", storage: "raw", unit: "人", additivity: "additive", label: "人数" };
  const sankey = (extra: Partial<ChartSpec> = {}): ChartSpec => ({ version: 1, data, fields: { n: flow }, chart: { mark: "sankey", source: { field: "from" }, target: { field: "to" }, value: { field: "n" } }, ...extra } as ChartSpec);
  const edges = (rows: unknown[][]): ChartDataset => ({ columns: ["from", "to", "n"], rows });

  it("draws one link per row and names node totals as a visual sum", () => {
    const { option, notices } = ok(compileChart(sankey(), edges([["访问", "注册", 60], ["访问", "离开", 40], ["注册", "付费", 12]]), { target: "static" }));
    const series = seriesOf(option)[0]!;
    expect(series.links).toEqual([{ source: "访问", target: "注册", value: 60 }, { source: "访问", target: "离开", value: 40 }, { source: "注册", target: "付费", value: 12 }]);
    expect((series.data as { name: string }[]).map((node) => node.name)).toEqual(["访问", "注册", "离开", "付费"]);
    expect(notices.map((notice) => notice.code)).toContain("VISUAL_SUM");
  });

  it("rejects cycles, repeated flows and non-part-of-whole measures", () => {
    expect(codes(compileChart(sankey(), edges([["A", "B", 1], ["B", "C", 1], ["C", "A", 1]]), { target: "interactive" }))).toEqual(["FLOW_CYCLE"]);
    expect(codes(compileChart(sankey(), edges([["A", "A", 1]]), { target: "interactive" }))).toEqual(["FLOW_CYCLE"]);
    expect(codes(compileChart(sankey(), edges([["A", "B", 1], ["A", "B", 2]]), { target: "interactive" }))).toEqual(["DUPLICATE_KEY"]);
    expect(codes(compileChart(sankey(), edges([["A", "B", -1]]), { target: "interactive" }))).toEqual(["NEGATIVE_IN_PART_OF_WHOLE"]);
    expect(codes(compileChart(sankey(), edges([["A", "B", null]]), { target: "interactive" }))).toEqual(["INCOMPLETE_PART_OF_WHOLE"]);
    expect(codes(compileChart({ ...sankey(), fields: { n: { ...flow, additivity: "non_additive" } } } as ChartSpec, edges([["A", "B", 1]]), { target: "interactive" }))).toEqual(["NON_ADDITIVE_PART_OF_WHOLE"]);
  });
});

describe("Treemap", () => {
  const sales: FieldMeta = { type: "quantitative", storage: "raw", unit: "亿元", additivity: "additive", label: "销售额" };
  const treemap = (path = ["sector", "industry"]): ChartSpec => ({ version: 1, data, fields: { v: sales }, chart: { mark: "treemap", path: path.map((field) => ({ field })), value: { field: "v" } } } as ChartSpec);
  const leaves = (rows: unknown[][]): ChartDataset => ({ columns: ["sector", "industry", "v"], rows });

  it("nests leaf rows by path; only leaves carry values", () => {
    const { option, notices } = ok(compileChart(treemap(), leaves([["批发零售", "批发", 60], ["批发零售", "零售", 30], ["住宿餐饮", "餐饮", 10]]), { target: "static" }));
    expect(seriesOf(option)[0]!.data).toEqual([
      { name: "批发零售", children: [{ name: "批发", value: 60 }, { name: "零售", value: 30 }] },
      { name: "住宿餐饮", children: [{ name: "餐饮", value: 10 }] },
    ]);
    expect(notices.map((notice) => notice.code)).toContain("VISUAL_SUM");
  });

  it("rejects repeated paths, top-n, and measures that cannot form a whole", () => {
    expect(codes(compileChart(treemap(), leaves([["A", "a", 1], ["A", "a", 2]]), { target: "interactive" }))).toEqual(["DUPLICATE_KEY"]);
    expect(codes(compileChart({ ...treemap(), selection: { kind: "top_n", by: "v", n: 1, order: "desc" } } as ChartSpec, leaves([["A", "a", 1]]), { target: "interactive" }))).toContain("INVALID_SELECTION");
    expect(codes(compileChart(treemap(), leaves([["A", "a", -1]]), { target: "interactive" }))).toEqual(["NEGATIVE_IN_PART_OF_WHOLE"]);
  });
});

describe("Area layers", () => {
  const area = (stack?: string): ChartSpec => ({ version: 1, data, fields: { sales: additive, growth: { type: "quantitative", storage: "ratio", additivity: "non_additive" } }, chart: { mark: "cartesian", x: { field: "region" }, layers: [{ type: "area", y: { field: "sales" }, ...(stack ? { stack, series: { field: "kind" } } : {}) }] } } as ChartSpec);
  const stacked: ChartDataset = { columns: ["region", "kind", "sales"], rows: [["east", "a", 1], ["east", "b", 2], ["west", "a", 3], ["west", "b", 4]] };

  it("draws a filled line, breaking at nulls like a line", () => {
    const { option, notices } = ok(compileChart(area(), { columns: ["region", "sales"], rows: [["east", 1], ["west", null], ["north", 3]] }, { target: "interactive" }));
    expect(seriesOf(option)[0]).toMatchObject({ type: "line", areaStyle: { opacity: 0.25 }, data: [1, null, 3] });
    expect(notices.map((notice) => notice.code)).toContain("NULL_VALUES");
  });

  it("stacks as part of a whole, with the same rules as bars and lines", () => {
    const { option } = ok(compileChart(area("stacked"), stacked, { target: "interactive" }));
    expect(seriesOf(option).map((series) => series.stack)).toEqual(["layer-0", "layer-0"]);
    expect(codes(compileChart({ ...area("stacked"), fields: { sales: { ...additive, additivity: "non_additive" } } } as ChartSpec, stacked, { target: "interactive" }))).toContain("NON_ADDITIVE_PART_OF_WHOLE");
    expect(codes(compileChart({ ...area(), chart: { ...(area().chart as object), orientation: "horizontal" } } as ChartSpec, { columns: ["region", "sales"], rows: [["east", 1]] }, { target: "interactive" }))).toEqual(["INVALID_ENCODING"]);
  });
});

describe("Funnel", () => {
  const users: FieldMeta = { type: "quantitative", storage: "raw", unit: "人", additivity: "additive", label: "人数" };
  const funnel = (): ChartSpec => ({ version: 1, data, fields: { n: users }, chart: { mark: "funnel", stage: { field: "stage" }, value: { field: "n" } } } as ChartSpec);
  const stages = (rows: unknown[][]): ChartDataset => ({ columns: ["stage", "n"], rows });

  it("keeps stage order and shows each stage's own value", () => {
    const { option, notices } = ok(compileChart(funnel(), stages([["访问", 1000], ["注册", 300], ["付费", 45]]), { target: "static" }));
    expect(seriesOf(option)[0]).toMatchObject({ type: "funnel", sort: "none", data: [{ name: "访问", value: 1000 }, { name: "注册", value: 300 }, { name: "付费", value: 45 }] });
    expect(notices).toEqual([]);
    const rising = ok(compileChart(funnel(), stages([["访问", 100], ["注册", 120]]), { target: "static" }));
    expect(rising.notices.map((notice) => notice.code)).toEqual(["FUNNEL_NOT_MONOTONIC"]);
  });

  it("refuses repeated stages and values it cannot draw", () => {
    expect(codes(compileChart(funnel(), stages([["访问", 1], ["访问", 2]]), { target: "interactive" }))).toEqual(["DUPLICATE_KEY"]);
    expect(codes(compileChart(funnel(), stages([["访问", 10], ["注册", null]]), { target: "interactive" }))).toEqual(["VALUE_OUT_OF_DOMAIN"]);
    expect(codes(compileChart(funnel(), stages([["访问", -1]]), { target: "interactive" }))).toEqual(["VALUE_OUT_OF_DOMAIN"]);
  });
});

describe("Sunburst", () => {
  const sales: FieldMeta = { type: "quantitative", storage: "raw", unit: "亿元", additivity: "additive" };
  const sunburst = (): ChartSpec => ({ version: 1, data, fields: { v: sales }, chart: { mark: "sunburst", path: [{ field: "sector" }, { field: "industry" }], value: { field: "v" } } } as ChartSpec);
  const leaves = (rows: unknown[][]): ChartDataset => ({ columns: ["sector", "industry", "v"], rows });

  it("draws the treemap's tree as rings, one per level", () => {
    const { option, notices } = ok(compileChart(sunburst(), leaves([["批发零售", "批发", 60], ["批发零售", "零售", 30], ["住宿餐饮", "餐饮", 10]]), { target: "interactive" }));
    const series = seriesOf(option)[0]!;
    expect(series.data).toEqual([{ name: "批发零售", children: [{ name: "批发", value: 60 }, { name: "零售", value: 30 }] }, { name: "住宿餐饮", children: [{ name: "餐饮", value: 10 }] }]);
    expect((series.levels as unknown[]).length).toBe(3);
    expect(notices.map((notice) => notice.code)).toContain("VISUAL_SUM");
  });

  it("applies the treemap's rules", () => {
    expect(codes(compileChart(sunburst(), leaves([["A", "a", 1], ["A", "a", 2]]), { target: "interactive" }))).toEqual(["DUPLICATE_KEY"]);
    expect(codes(compileChart(sunburst(), leaves([["A", "a", -1]]), { target: "interactive" }))).toEqual(["NEGATIVE_IN_PART_OF_WHOLE"]);
  });
});
