import { describe, expect, it } from "vitest";
import type { DashboardInsightsView, DashboardKpiView, DashboardTableView, FieldMeta } from "@data-agent/contracts";
import { datasetKey, resolveInsights, resolveKpiCards, resolveTable, sparklinePath, validateDashboard, type ChartDataset } from "./index.js";

const rate: FieldMeta = { type: "quantitative", storage: "ratio", additivity: "non_additive", label: "差评率" };
const share: FieldMeta = { type: "quantitative", storage: "ratio", additivity: "non_additive" };
const monthly = { kind: "publication", receiptId: "publication_monthly" } as const;
const findings = { kind: "publication", receiptId: "publication_findings" } as const;
const categories = { kind: "publication", receiptId: "publication_categories" } as const;

// A period total repeated on every monthly row, beside the monthly series it summarises.
const months: ChartDataset = { columns: ["month", "neg_rate", "total_rate"], rows: [["2018-02", "0.2004", "0.1453"], ["2017-11", "0.1774", "0.1453"], ["2018-03", "0.2250", "0.1453"]] };
const facts: ChartDataset = { columns: ["finding", "value"], rows: [["late_share_of_negatives", "0.326"], ["on_time_share_of_negatives", "0.661"]] };
const cats: ChartDataset = { columns: ["category", "neg_rate", "site_rate"], rows: [["moveis_escritorio", "0.2223", "0.1453"], ["bebes", "0.1488", "0.1453"], ["automotivo", "0.1399", "0.1453"]] };

const datasets = { [datasetKey(monthly)]: months, [datasetKey(findings)]: facts, [datasetKey(categories)]: cats };

const kpi = { id: "kpi", type: "kpi", data: monthly, fields: { total_rate: rate, neg_rate: rate }, cards: [{ label: "差评率", value: { field: "total_rate" }, trend: { x: { field: "month" }, y: { field: "neg_rate" } } }] } as DashboardKpiView;
const insights = {
  id: "findings",
  type: "insights",
  data: findings,
  fields: { value: share },
  items: [
    { value: { field: "value" }, where: { finding: "late_share_of_negatives" }, text: "延迟订单只占 6.7%，却贡献了 32.6% 的差评", tone: "bad" },
    { value: { field: "value" }, where: { finding: "on_time_share_of_negatives" }, text: "三分之二的差评来自提前送达的订单" },
  ],
} as DashboardInsightsView;
const table = { id: "cats", type: "table", data: categories, fields: { neg_rate: rate, site_rate: rate }, columns: [{ field: "category" }, { field: "neg_rate", bar: true, compare: { field: "site_rate", above: "bad" } }] } as DashboardTableView;

const only = (...views: unknown[]) => ({ version: 1, title: "履约", views });
const spec = { version: 1, title: "履约", views: [insights, kpi, table], layout: { rows: [{ views: ["findings", "kpi"], widths: [2, 1] }, { views: ["cats"] }] } };

describe("Dashboard findings, trends and table marks", () => {
  it("accepts findings, a KPI total repeated on every row, a trend and table marks", () => {
    const result = validateDashboard(spec, datasets);
    expect(result.ok ? result.advice : result.errors).toEqual([]);
  });

  it("shows each finding's number from one cell with the sentence beside it", () => {
    expect(resolveInsights(insights, facts)).toEqual([
      { value: "32.6%", fullValue: "32.6%", text: "延迟订单只占 6.7%，却贡献了 32.6% 的差评", tone: "bad" },
      { value: "66.1%", fullValue: "66.1%", text: "三分之二的差评来自提前送达的订单" },
    ]);
  });

  it("refuses rows that disagree on a shown cell, since showing them would need an aggregate", () => {
    const disagreeing = { ...insights, items: [{ value: { field: "value" }, text: "x" }] } as DashboardInsightsView;
    const result = validateDashboard({ ...spec, views: [disagreeing, kpi, table] }, datasets);
    expect(result.ok ? [] : result.errors.map((error) => [error.code, error.path])).toEqual([["KPI_ROW_AMBIGUOUS", "/views/0/items/0"]]);
  });

  it("orders a trend by x and scales it like the value", () => {
    expect(resolveKpiCards(kpi, months)[0]!.trend!.map((value) => Number(value!.toFixed(2)))).toEqual([17.74, 20.04, 22.5]);
    const path = sparklinePath([1, null, 3, 2], 100, 30);
    expect(path.d).toBe("M3.0,27.0M65.7,3.0L97.0,15.0");
    expect(path.last).toEqual([97, 15]);
    expect(sparklinePath([1], 100, 30).d).toBe("");
  });

  it("rejects a trend with repeated x or undeclared y", () => {
    const repeated = { ...months, rows: [...months.rows, ["2018-03", "0.1", "0.1453"]] };
    const result = validateDashboard(only(kpi), { ...datasets, [datasetKey(monthly)]: repeated });
    expect(result.ok ? [] : result.errors.map((error) => error.code)).toEqual(["DUPLICATE_KEY"]);
    const undeclared = { ...kpi, fields: { total_rate: rate } } as DashboardKpiView;
    const missing = validateDashboard(only(undeclared), datasets);
    expect(missing.ok ? [] : missing.errors.map((error) => error.code)).toEqual(["SEMANTICS_MISSING"]);
  });

  it("marks table cells with a bar of the column's largest value and a tone above the comparison", () => {
    const marks = resolveTable(table, cats).marks.map((row) => row.map((mark) => (mark ? { ...mark, bar: Number(mark.bar!.toFixed(4)) } : mark)));
    expect(marks).toEqual([
      [undefined, { bar: 1, tone: "bad" }],
      [undefined, { bar: Number((14.88 / 22.23).toFixed(4)), tone: "bad" }],
      [undefined, { bar: Number((13.99 / 22.23).toFixed(4)) }],
    ]);
    const plain = { ...table, fields: {} } as DashboardTableView;
    const result = validateDashboard(only(plain), datasets);
    expect(result.ok ? [] : result.errors.map((error) => error.code)).toEqual(["SEMANTICS_MISSING"]);
  });

  it("advises comparisons on KPI cards and findings at the top", () => {
    const bare = { ...kpi, cards: [{ value: { field: "total_rate" } }] } as DashboardKpiView;
    const late = validateDashboard({ ...spec, views: [insights, bare, table], layout: { rows: [{ views: ["kpi"] }, { views: ["cats"] }, { views: ["findings"] }] } }, datasets);
    expect(late.ok ? late.advice.map((advice) => advice.code) : []).toEqual(["INSIGHTS_NOT_FIRST", "KPI_WITHOUT_COMPARISON"]);
  });
});
