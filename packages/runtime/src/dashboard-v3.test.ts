import { describe, expect, it } from "vitest";
import { compileEChartsOptions, renderStandaloneDashboardHtml, validateDashboardV3Spec } from "./dashboard-v3.js";

const spec = {
  title: "销售看板",
  datasets: [{ id: "sales", rows: [{ month: "1月", amount: 10 }, { month: "2月", amount: 20 }] }],
  views: [
    { type: "line" as const, title: "月度销售额", dataset: "sales", xField: "month", yField: "amount" },
    { type: "kpi" as const, title: "总额", field: "amount", aggregate: "sum" as const },
  ],
};

describe("Dashboard V3", () => {
  it("validates specs and reports precise errors", () => {
    expect(validateDashboardV3Spec(spec).ok).toBe(true);
    const bad = validateDashboardV3Spec({ title: "", datasets: [], views: [{ type: "gauge" }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("compiles ECharts options for line and kpi views", () => {
    const options = compileEChartsOptions(spec.views[0], spec.datasets) as any;
    expect(options.xAxis.data).toEqual(["1月", "2月"]);
    expect(options.series[0].data).toEqual([10, 20]);
    const kpi = compileEChartsOptions(spec.views[1], spec.datasets) as any;
    expect(kpi.kpi.value).toBe(30);
  });

  it("renders a standalone offline HTML artifact", async () => {
    const html = await renderStandaloneDashboardHtml(validateDashboardV3Spec(spec).ok ? (validateDashboardV3Spec(spec) as { spec: typeof spec }).spec : spec);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("__DASHBOARD__");
    expect(html).toContain("销售看板");
    expect(html).toContain("月度销售额");
    // No network dependency: no external script/image references.
    expect(html).not.toMatch(/https?:\/\//);
  });
});
