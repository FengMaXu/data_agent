import { describe, expect, it } from "vitest";
import type { DashboardKpiView, FieldMeta } from "@data-agent/contracts";
import { datasetKey, formatDashboardCell, resolveKpiCards, validateDashboard, type ChartDataset } from "./index.js";

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

describe("Dashboard display", () => {
  it("formats KPI cells from declared semantics", () => {
    const view = spec.views[0] as DashboardKpiView;
    expect(resolveKpiCards(view, datasets[datasetKey(total)]!)).toEqual([{ label: "销售额", value: "5,733.88 亿元", delta: { label: "同比", value: "10%" } }]);
  });

  it("shows undeclared values as stored and nulls as blank", () => {
    expect(formatDashboardCell(0.12, undefined)).toBe("0.12");
    expect(formatDashboardCell(0.12, growth)).toBe("12%");
    expect(formatDashboardCell(null, growth)).toBe("");
    expect(formatDashboardCell("9007199254740993", undefined)).toBe("9007199254740993");
  });
});
