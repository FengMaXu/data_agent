import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore } from "./workspace.js";
import { compileEChartsOptions, materializeDashboardV3Spec, renderStandaloneDashboardHtml, resolveEchartsAssetPath, validateDashboardV3Spec } from "./dashboard-v3.js";

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

  it("groups long-form multi-series charts by series_by without duplicating a measure", () => {
    const options = compileEChartsOptions({
      type: "chart",
      dataset: "sales",
      x: { field: "month", type: "category" },
      series_by: { field: "industry", order: ["批发业", "零售业"], colors: { "批发业": "#111111" } },
      series: [{ field: "amount", mark: "line" }],
    }, [{ id: "sales", rows: [
      { month: "1月", industry: "批发业", amount: 10 },
      { month: "1月", industry: "零售业", amount: 4 },
      { month: "2月", industry: "批发业", amount: 12 },
    ] }]) as any;
    expect(options.xAxis.data).toEqual(["1月", "2月"]);
    expect(options.series.map((series: any) => series.data)).toEqual([[10, 12], [4, 0]]);
    expect(options.series[0].itemStyle.color).toBe("#111111");
  });

  it("materializes CSV datasets with quoted fields before rendering", async () => {
    const root = await mkdtemp(join(tmpdir(), "dashboard-v3-csv-"));
    try {
      const workspace = new WorkspaceStore(root);
      await workspace.write("data/sales.csv", "month,amount,note\n1月,10,\"包含,逗号\"\n");
      const materialized = await materializeDashboardV3Spec({ title: "CSV", datasets: [{ id: "sales", source: { type: "csv", path: "data/sales.csv" } }], views: [{ type: "table", dataset: "sales" }] }, workspace);
      expect(materialized.datasets[0].rows).toEqual([{ month: "1月", amount: 10, note: "包含,逗号" }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("renders a standalone offline HTML artifact", async () => {
    const html = await renderStandaloneDashboardHtml(validateDashboardV3Spec(spec).ok ? (validateDashboardV3Spec(spec) as { spec: typeof spec }).spec : spec);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("__DASHBOARD__");
    expect(html).toContain("销售看板");
    expect(html).toContain("月度销售额");
    // No network dependency: no external script/image references. (The inlined ECharts
    // build mentions XML namespace and license URLs as plain strings, which load nothing.)
    expect(html).not.toMatch(/\b(?:src|href)\s*=\s*["']?https?:/i);
  });

  it("inlines ECharts so charts render without a network", async () => {
    const html = await renderStandaloneDashboardHtml(spec);
    expect(resolveEchartsAssetPath()).toMatch(/echarts\.min\.js$/);
    expect(html).not.toContain("__DATA_AGENT_OFFLINE__");
    expect(html).toContain("echarts.init(el)");
    // The library precedes the renderer that calls it.
    expect(html.indexOf("window.__DASHBOARD__")).toBeGreaterThan(html.indexOf("</script>"));
    expect(html.length).toBeGreaterThan(500_000);
  });

  it("falls back to a readable note instead of raw chart config when ECharts is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "echarts-"));
    try {
      const html = await renderStandaloneDashboardHtml(spec, { echartsAssetPath: join(root, "missing.js") }).catch(() => "");
      expect(html).toBe("");
      const offline = await renderStandaloneDashboardHtml(spec, { echartsAssetPath: "" });
      expect(offline).toContain("__DATA_AGENT_OFFLINE__");
      expect(offline).toContain("图表组件未加载");
      expect(offline).not.toContain("JSON.stringify(v.option)");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps a closing script tag inside the library from ending the inline script", async () => {
    const root = await mkdtemp(join(tmpdir(), "echarts-"));
    try {
      const asset = join(root, "echarts.js");
      await writeFile(asset, 'window.echarts={init:function(){}};var s="</script><b>";');
      const html = await renderStandaloneDashboardHtml(spec, { echartsAssetPath: asset });
      expect(html).toContain('var s="<\\/script><b>"');
      expect(html.match(/<\/script>/g)).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
