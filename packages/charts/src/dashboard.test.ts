import { describe, expect, it } from "vitest";
import type { DashboardKpiView, FieldMeta } from "@data-agent/contracts";
import { compileChart, dashboardRows, datasetKey, formatDashboardCell, formatTableCell, resolveKpiCards, tableColumnHeader, validateDashboard, type ChartDataset } from "./index.js";

const sales: FieldMeta = { type: "quantitative", storage: "raw", unit: "亿元", additivity: "additive", label: "销售额" };
const growth: FieldMeta = { type: "quantitative", storage: "ratio", additivity: "non_additive", label: "同比增速" };
const byIndustry = { kind: "publication", receiptId: "publication_industry" } as const;
const total = { kind: "publication", receiptId: "publication_total" } as const;

const datasets: Record<string, ChartDataset> = {
  [datasetKey(byIndustry)]: { columns: ["industry", "sales", "growth"], rows: [["批发业", "5234.00", 0.12], ["零售业", "499.88", -0.03]] },
  [datasetKey(total)]: { columns: ["sales", "growth"], rows: [["5733.88", 0.1]] },
};

const spec = {
  version: 1,
  title: "行业经营",
  views: [
    { id: "kpi", type: "kpi", data: total, fields: { sales, growth }, cards: [{ value: { field: "sales" }, delta: { field: "growth", label: "同比" } }] },
    { id: "bar", type: "chart", chart: { version: 1, title: "行业销售额", data: byIndustry, fields: { sales }, chart: { mark: "cartesian", x: { field: "industry" }, layers: [{ type: "bar", y: { field: "sales" } }] } } },
    { id: "detail", type: "table", data: byIndustry, fields: { sales, growth }, columns: [{ field: "industry", label: "行业" }, { field: "growth" }] },
  ],
};

function codes(result: ReturnType<typeof validateDashboard>): string[] {
  return result.ok ? [] : result.errors.map((error) => error.code);
}

describe("Dashboard validation", () => {
  it("accepts views whose fields exist in their datasets", () => {
    const result = validateDashboard(spec, datasets);
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it("reports schema errors for the declared view type and chart mark only", () => {
    const result = validateDashboard({ ...spec, views: [{ id: "t", type: "table" }, { id: "c", type: "chart", chart: { version: 1, data: byIndustry, chart: { mark: "pie" } } }] }, datasets);
    // Missing properties are reported at their parent, named in the message.
    expect(result.ok ? [] : result.errors.map((error) => `${error.path} ${error.message}`)).toEqual([
      "/views/0 must have required properties data",
      "/views/1/chart/chart must have required properties category, value",
    ]);
    expect(new Set(codes(result))).toEqual(new Set(["SCHEMA_INVALID"]));
    expect(codes(validateDashboard({ ...spec, views: [{ id: "x", type: "heatmap" }] }, datasets))).toEqual(["SCHEMA_INVALID"]);
  });

  it("passes chart compiler errors through with the view's path", () => {
    const duplicated = { [datasetKey(byIndustry)]: { columns: ["industry", "sales", "growth"], rows: [["批发业", 1, 0], ["批发业", 2, 0]] }, [datasetKey(total)]: datasets[datasetKey(total)]! };
    const result = validateDashboard(spec, duplicated);
    expect(result.ok ? [] : result.errors).toEqual([expect.objectContaining({ code: "DUPLICATE_KEY", viewId: "bar", path: expect.stringMatching(/^\/views\/1\/chart/) })]);
  });

  it("rejects duplicate view ids, unresolved datasets and unknown columns", () => {
    const views = [spec.views[1], { ...spec.views[2], id: "bar" }, { id: "gone", type: "table", data: { kind: "publication", receiptId: "missing" } }, { ...spec.views[2], id: "cols", columns: [{ field: "region" }] }];
    expect(codes(validateDashboard({ ...spec, views }, datasets))).toEqual(["DUPLICATE_VIEW_ID", "DATASET_UNAVAILABLE", "FIELD_NOT_FOUND"]);
  });

  it("shows exactly one KPI row and never aggregates", () => {
    const perIndustry = { id: "k", type: "kpi", data: byIndustry, fields: { sales }, cards: [{ value: { field: "sales" } }] };
    expect(codes(validateDashboard({ ...spec, views: [perIndustry] }, datasets))).toEqual(["KPI_ROW_AMBIGUOUS"]);
    const picked = { ...perIndustry, cards: [{ value: { field: "sales" }, where: { industry: "零售业" } }] };
    expect(validateDashboard({ ...spec, views: [picked] }, datasets).ok).toBe(true);
    const absent = { ...perIndustry, cards: [{ value: { field: "sales" }, where: { industry: "住宿业" } }] };
    expect(codes(validateDashboard({ ...spec, views: [absent] }, datasets))).toEqual(["KPI_ROW_NOT_FOUND"]);
  });
});

describe("Dashboard layout", () => {
  const layout = { rows: [{ views: ["kpi"] }, { views: ["bar", "detail"], widths: [2, 1], height: "compact" }] };

  it("draws declared rows, and lays out older specs by their widths", () => {
    expect(dashboardRows({ ...spec, layout } as never)).toEqual([
      { views: ["kpi"], widths: [1], height: "standard" },
      { views: ["bar", "detail"], widths: [2, 1], height: "compact" },
    ]);
    const second = { ...spec.views[1], id: "bar2" };
    const wide = { ...spec.views[1], id: "wide", width: "full" };
    expect(dashboardRows({ ...spec, views: [spec.views[0], spec.views[1], second, wide, spec.views[2]] } as never).map((row) => row.views)).toEqual([["kpi"], ["bar", "bar2"], ["wide"], ["detail"]]);
  });

  it("places every view exactly once", () => {
    const result = validateDashboard({ ...spec, layout: { rows: [{ views: ["kpi", "kpi"] }, { views: ["bar", "nope"], widths: [1] }] } }, datasets);
    expect(codes(result)).toEqual(["LAYOUT_DUPLICATE_VIEW", "LAYOUT_WIDTHS_MISMATCH", "LAYOUT_UNKNOWN_VIEW", "LAYOUT_VIEW_NOT_PLACED"]);
    expect(validateDashboard({ ...spec, layout }, datasets).ok).toBe(true);
  });

  it("advises a KPI row first, charts sharing rows and detail last, without blocking", () => {
    const advice = (value: unknown) => {
      const result = validateDashboard(value, datasets);
      return result.ok ? result.advice.map((entry) => entry.code) : codes(result);
    };
    expect(advice({ ...spec, layout })).toEqual([]);
    const second = { ...spec.views[1], id: "bar2" };
    const report = { ...spec, views: [...spec.views, second], layout: { rows: [{ views: ["detail"] }, { views: ["bar"] }, { views: ["bar2"] }, { views: ["kpi"] }] } };
    expect(advice(report)).toEqual(["KPI_NOT_FIRST", "LONE_CHART_ROWS", "TABLE_BEFORE_CHARTS"]);
  });

  it("advises horizontal bars when category labels only fit rotated in their tile", () => {
    const long = { [datasetKey(byIndustry)]: { columns: ["industry", "sales", "growth"], rows: Array.from({ length: 8 }, (_, index) => [`机械设备五金产品及电子产品批发${index}`, index, 0]) }, [datasetKey(total)]: datasets[datasetKey(total)]! };
    const narrow = { ...spec, layout: { rows: [{ views: ["kpi"] }, { views: ["bar", "detail"] }] } };
    const result = validateDashboard(narrow, long);
    expect(result.ok ? result.advice.map((entry) => `${entry.code} ${entry.viewId}`) : codes(result)).toEqual(["LABELS_ROTATED_IN_TILE bar"]);
  });
});

describe("Dashboard display", () => {
  it("formats KPI cells from declared semantics", () => {
    const view = spec.views[0] as DashboardKpiView;
    // Headline precision on the tile, the full value for its tooltip, and the delta's direction.
    expect(resolveKpiCards(view, datasets[datasetKey(total)]!)).toEqual([{ label: "销售额", value: "5,734 亿元", fullValue: "5,733.88 亿元", delta: { label: "同比", value: "+10.0%", trend: "up" } }]);
    const falling = { columns: ["sales", "growth"], rows: [["49.7407", -0.2334]] };
    expect(resolveKpiCards(view, falling)[0]).toMatchObject({ value: "49.74 亿元", delta: { value: "-23.3%", trend: "down" } });
    expect(resolveKpiCards(view, { columns: ["sales", "growth"], rows: [["1", null]] })[0]!.delta).toEqual({ label: "同比", value: "—" });
  });

  it("names a table column's unit once and shows bare numbers in its cells", () => {
    expect(tableColumnHeader("累计销售额", sales)).toBe("累计销售额（亿元）");
    expect(tableColumnHeader("行业", undefined)).toBe("行业");
    expect(formatTableCell("7276.5712", sales)).toBe("7,276.57");
    expect(formatTableCell(-0.2334, growth)).toBe("-23.34");
    expect(formatTableCell(0.14, growth)).toBe("14.00");
    expect(formatTableCell("批发业", undefined)).toBe("批发业");
  });

  it("labels bars with a declared measure at headline precision", () => {
    const chart = { version: 1, data: byIndustry, fields: { sales, growth }, chart: { mark: "cartesian", orientation: "horizontal", x: { field: "industry" }, layers: [{ type: "bar", y: { field: "sales" }, label: { field: "growth" } }] } };
    const compiled = compileChart(chart, datasets[datasetKey(byIndustry)]!, { target: "interactive" });
    const data = compiled.ok ? ((compiled.option.series as { data: { labelText?: string }[] }[])[0]!.data.map((point) => point.labelText)) : [];
    expect(data).toEqual(["12.0%", "-3.0%"]);
    const blank = compileChart(chart, { columns: ["industry", "sales", "growth"], rows: [["批发业", 1, null]] }, { target: "interactive" });
    expect(blank.ok ? (blank.option.series as { data: { labelText?: string }[] }[])[0]!.data[0]!.labelText : undefined).toBe("");
  });

  it("shows undeclared values as stored and nulls as blank", () => {
    expect(formatDashboardCell(0.12, undefined)).toBe("0.12");
    expect(formatDashboardCell(0.12, growth)).toBe("12%");
    expect(formatDashboardCell(null, growth)).toBe("");
    expect(formatDashboardCell("9007199254740993", undefined)).toBe("9007199254740993");
  });
});
