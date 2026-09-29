import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileChart, type ChartDataset } from "@data-agent/charts";
import { InMemoryAnsweringStore } from "./answering/answering-store.js";
import { InMemoryResultStore } from "./answering/result-store.js";
import { InMemoryAnswering } from "./answering/service.js";
import type { BusinessContext, PublicationId } from "./answering/model.js";
import { ArtifactDirectory } from "./facets/artifact-directory.js";
import { WorkspaceStore } from "./workspace.js";
import { createCoreAgentToolDefinitions } from "./tools/core.js";
import { createDashboardToolDefinitions } from "./tools/dashboard.js";

/**
 * ADR-0008 acceptance: one data version shows the same numbers and units in
 * chat (interactive), standalone dashboards (interactive, in the page) and
 * SSR (static). Layout may differ between targets; values may not.
 */

type Option = Record<string, unknown>;
const list = (value: unknown) => (Array.isArray(value) ? value : [value]) as Option[];

/** What a reader can check: categories, series names and values, axis names with their units. */
function readable(option: Option) {
  const categoryAxis = [...list(option.xAxis), ...list(option.yAxis)].find((axis) => axis?.type === "category");
  const valueAxes = [...list(option.xAxis), ...list(option.yAxis)].filter((axis) => axis?.type === "value");
  return {
    categories: categoryAxis?.data ?? null,
    series: list(option.series).map((series) => ({ name: series.name, type: series.type, data: series.data })),
    axisNames: valueAxes.map((axis) => axis.name ?? null),
  };
}

const data = { kind: "publication", receiptId: "publication_1" } as const;
const regions: ChartDataset = { columns: ["region", "sales", "growth", "share_pct"], rows: [["华东", "523400000000", 0.1234, 12.5], ["华南", "49988000000.00", -0.03, 7], ["西北", null, null, 3], ["东北", "1200000000", 0.5, 1]] };

const cases: Record<string, unknown> = {
  "ratio stored, percent shown": { version: 1, data, fields: { growth: { type: "quantitative", storage: "ratio", additivity: "non_additive", label: "同比" } }, chart: { mark: "cartesian", x: { field: "region" }, layers: [{ type: "line", y: { field: "growth" } }] } },
  "percent stored": { version: 1, data, fields: { share_pct: { type: "quantitative", storage: "percent", additivity: "non_additive", label: "占比" } }, chart: { mark: "cartesian", x: { field: "region" }, layers: [{ type: "bar", y: { field: "share_pct" } }] } },
  "magnitude conversion with nulls": { version: 1, data, fields: { sales: { type: "quantitative", storage: "raw", unit: "元", magnitude: { stored: 1, shown: 1e8 }, additivity: "additive", label: "销售额" } }, chart: { mark: "cartesian", x: { field: "region" }, layers: [{ type: "bar", y: { field: "sales" } }] } },
  "top-n selection": { version: 1, data, fields: { share_pct: { type: "quantitative", storage: "percent", additivity: "non_additive" } }, chart: { mark: "cartesian", x: { field: "region" }, layers: [{ type: "bar", y: { field: "share_pct" } }] }, selection: { kind: "top_n", by: "share_pct", n: 2, order: "desc" } },
};

describe("Cross-target consistency", () => {
  for (const [name, spec] of Object.entries(cases)) {
    it(`${name}: interactive and static show the same values and units`, () => {
      const interactive = compileChart(spec, regions, { target: "interactive" });
      const staticChart = compileChart(spec, regions, { target: "static" });
      if (!interactive.ok || !staticChart.ok) throw new Error(JSON.stringify([interactive, staticChart]));
      const shown = readable(interactive.option);
      // Guard against comparing two empty extractions.
      expect(shown.categories).not.toBeNull();
      expect(shown.series.length).toBeGreaterThan(0);
      expect((shown.series[0]!.data as unknown[]).length).toBeGreaterThan(0);
      expect(readable(staticChart.option)).toEqual(shown);
      expect(staticChart.notices.map((notice) => notice.code).filter((code) => code !== "VIEWPORT")).toEqual(interactive.notices.map((notice) => notice.code).filter((code) => code !== "VIEWPORT"));
    });
  }

  it("heatmap: interactive and static place the same values in the same cells", () => {
    const spec = { version: 1, data, fields: { growth: { type: "quantitative", storage: "ratio", additivity: "non_additive", label: "同比" } }, chart: { mark: "heatmap", x: { field: "month" }, y: { field: "region" }, color: { field: "growth", scale: "diverging", midpoint: 0 } } };
    const cells: ChartDataset = { columns: ["region", "month", "growth"], rows: [["华东", "1月", 0.12], ["华东", "2月", null], ["华南", "1月", -0.03]] };
    const interactive = compileChart(spec, cells, { target: "interactive" });
    const staticChart = compileChart(spec, cells, { target: "static" });
    if (!interactive.ok || !staticChart.ok) throw new Error(JSON.stringify([interactive, staticChart]));
    const cellsOf = (option: Option) => ({ x: list(option.xAxis)[0]!.data, y: list(option.yAxis)[0]!.data, data: list(option.series)[0]!.data, range: [(option.visualMap as Option).min, (option.visualMap as Option).max] });
    expect(cellsOf(interactive.option)).toEqual({ x: ["1月", "2月"], y: ["华东", "华南"], data: [[0, 0, 12], [1, 0, "-"], [0, 1, -3]], range: [-12, 12] });
    expect(cellsOf(staticChart.option)).toEqual(cellsOf(interactive.option));
  });

  it("chat widgets and dashboards embed the same rows for one published result", async () => {
    const context = (invocationId: string): BusinessContext => ({ principal: { id: "user-1" }, sessionId: "session-1", lane: "main", operationId: "operation-1", invocationId });
    const invocation = (invocationId: string) => ({ operationId: "operation-1", invocationId, getMemo: async () => undefined, setMemo: async () => undefined }) as never;
    const toolContext = { sessionId: "session-1", principalId: "user-1" } as never;
    const store = new InMemoryAnsweringStore();
    const resultStore = new InMemoryResultStore();
    const answering = new InMemoryAnswering({ store, resultStore, sqlExecutor: { run: async () => ({ columns: regions.columns, rows: [...regions.rows.map((row) => [...row])], truncated: false }) } });
    const listSpec = { entity: "regions", metric: "sum", filters: [], groupBy: [], time: { state: "not_applicable" }, ranking: { state: "not_applicable" }, output: { rowMode: "full" } };
    const begun = await answering.begin({ requestMessageId: "m", requestId: "b", spec: listSpec }, context("b"));
    const execution = await answering.execute({ kind: "result", taskId: begun.taskId, revisionId: begun.revisionId, sql: "SELECT 1" }, context("e"));
    if (execution.artifact.kind !== "candidate") throw new Error("expected Result Candidate");
    const receipt = await answering.publish({ candidateId: execution.artifact.candidateId, format: "auto", requestId: "p" }, context("p"));
    const artifacts = new ArtifactDirectory({
      findPublication: (publicationId, business) => store.transact((tx) => tx.getReceipt(publicationId as PublicationId), business),
      readAuthorized: async (found, business) => resultStore.encodeCsv(found.resultRef, business),
      readRowsAuthorized: async (found, business) => {
        const result = await resultStore.openAuthorized(found.resultRef, found, business);
        return { columns: result.columns, rows: result.rows, contentHash: result.contentHash };
      },
    });
    const root = await mkdtemp(join(tmpdir(), "data-agent-cross-target-"));
    try {
      const workspace = new WorkspaceStore(root, { userId: "user-1", sessionId: "session-1" });
      const chart = { ...(cases["magnitude conversion with nulls"] as object), data: { kind: "publication", receiptId: receipt.receiptId } };
      const showWidget = createCoreAgentToolDefinitions({ workspace, publishedRows: artifacts }).map((definition) => definition.tool).find((tool) => tool.name === "show_widget")!;
      const widget = ((await showWidget.execute("w", { kind: "chart", spec: chart } as never, undefined, toolContext, invocation("w"), {} as never)).details as { widget: { dataset: ChartDataset } }).widget;
      const dashboard = createDashboardToolDefinitions({ workspace, artifacts, echartsSource: async () => undefined })[0]!.tool;
      await dashboard.execute("d", { operation: "create", spec: { version: 1, title: "t", filename: "cross", views: [{ id: "c", type: "chart", chart }] } } as never, undefined, toolContext, invocation("d"), {} as never);
      const html = await readFile(join(root, "dashboards", "cross.html"), "utf8");
      const payload = JSON.parse(/window\.__DATA_AGENT_DASHBOARD__=(\{[\s\S]*?\});<\/script>/.exec(html)![1]!) as { datasets: Record<string, ChartDataset> };
      expect(Object.values(payload.datasets)).toEqual([widget.dataset]);
      // And both compile to what the SSR path draws.
      const fromWidget = compileChart(chart, widget.dataset, { target: "interactive" });
      const fromSsr = compileChart(chart, Object.values(payload.datasets)[0]!, { target: "static" });
      if (!fromWidget.ok || !fromSsr.ok) throw new Error("expected both to compile");
      expect(readable(fromSsr.option)).toEqual(readable(fromWidget.option));
      expect(readable(fromWidget.option)).toMatchObject({ axisNames: ["销售额（亿元）"], series: [{ data: [5234, 499.88, null, 12] }] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
