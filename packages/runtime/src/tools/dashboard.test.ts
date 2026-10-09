import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { CHART_COMPILER_VERSION, CHART_RENDERER_VERSIONS, CHART_THEME_VERSION } from "@data-agent/charts";
import { CHARTS_BROWSER_SOURCE } from "@data-agent/charts/browser-source";
import { renderDashboardHtml } from "../dashboard.js";
import { InMemoryAnsweringStore } from "../answering/answering-store.js";
import { InMemoryResultStore } from "../answering/result-store.js";
import { InMemoryAnswering } from "../answering/service.js";
import type { BusinessContext, PublicationId } from "../answering/model.js";
import { ArtifactDirectory } from "../facets/artifact-directory.js";
import { WorkspaceStore } from "../workspace.js";
import { MAX_DASHBOARD_DATASET_ROWS, createDashboardToolDefinitions } from "./dashboard.js";

const context = (invocationId: string): BusinessContext => ({ principal: { id: "user-1" }, sessionId: "session-1", lane: "main", operationId: "operation-1", invocationId });
const invocation = (invocationId: string) => ({ operationId: "operation-1", invocationId, getMemo: async () => undefined, setMemo: async () => undefined }) as never;
const toolContext = { sessionId: "session-1", principalId: "user-1" } as never;
const listSpec = { entity: "industries", metric: "sum", filters: [], groupBy: [], time: { state: "not_applicable" }, ranking: { state: "not_applicable" }, output: { rowMode: "full" } };

/** Records what the page hands ECharts; jsdom has no canvas to draw on. */
const ECHARTS_STUB = "window.echarts={init:function(el){return{setOption:function(o){(window.__options=window.__options||[]).push({id:el.parentNode.id,option:o})},resize:function(){}}}};";

type Result = { columns: string[]; rows: unknown[][] };

async function setup(results: Record<string, Result>) {
  const store = new InMemoryAnsweringStore();
  const resultStore = new InMemoryResultStore();
  let current: Result = { columns: [], rows: [] };
  const answering = new InMemoryAnswering({ store, resultStore, sqlExecutor: { run: async () => ({ ...current, truncated: false }) } });
  const receipts: Record<string, string> = {};
  for (const [name, result] of Object.entries(results)) {
    current = result;
    const begun = await answering.begin({ requestMessageId: `message-${name}`, requestId: `begin-${name}`, spec: listSpec }, context(`begin-${name}`));
    const execution = await answering.execute({ kind: "result", taskId: begun.taskId, revisionId: begun.revisionId, sql: "SELECT 1" }, context(`execute-${name}`));
    if (execution.artifact.kind !== "candidate") throw new Error("expected Result Candidate");
    receipts[name] = (await answering.publish({ candidateId: execution.artifact.candidateId, format: "auto", requestId: `publish-${name}` }, context(`publish-${name}`))).receiptId;
  }
  const artifacts = new ArtifactDirectory({
    findPublication: (publicationId, business) => store.transact((tx) => tx.getReceipt(publicationId as PublicationId), business),
    readAuthorized: async (found, business) => resultStore.encodeCsv(found.resultRef, business),
    readRowsAuthorized: async (found, business) => {
      const result = await resultStore.openAuthorized(found.resultRef, found, business);
      return { columns: result.columns, rows: result.rows, contentHash: result.contentHash };
    },
  });
  const root = await mkdtemp(join(tmpdir(), "data-agent-dashboard-"));
  const workspace = new WorkspaceStore(root, { userId: "user-1", sessionId: "session-1" });
  const tool = createDashboardToolDefinitions({ workspace, artifacts, echartsSource: async () => ECHARTS_STUB })[0]!.tool;
  const call = (input: Record<string, unknown>, id = "dashboard") => tool.execute(id, input as never, undefined, toolContext, invocation(id), {} as never);
  return { receipts, root, call, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const sales = { type: "quantitative", storage: "raw", unit: "亿元", additivity: "additive", label: "销售额" };
const growth = { type: "quantitative", storage: "ratio", additivity: "non_additive", label: "同比增速" };
const industries = { columns: ["industry", "sales", "growth"], rows: [["批发业", "5234.00", 0.12], ["零售业", "499.88", null], ["住宿和餐饮业", null, 0.05]] };
const totals = { columns: ["sales", "growth"], rows: [["5733.88", 0.1]] };

function dashboardSpec(receipts: Record<string, string>) {
  const byIndustry = { kind: "publication", receiptId: receipts.industries };
  return {
    version: 1,
    title: "行业经营 <快照>",
    filename: "industry",
    views: [
      { id: "kpi", type: "kpi", title: "核心指标", data: { kind: "publication", receiptId: receipts.totals }, fields: { sales, growth }, cards: [{ value: { field: "sales" }, delta: { field: "growth", label: "同比" } }] },
      { id: "sales_bar", type: "chart", chart: { version: 1, title: "行业销售额", data: byIndustry, fields: { sales }, chart: { mark: "cartesian", x: { field: "industry" }, layers: [{ type: "bar", y: { field: "sales" } }] } } },
      { id: "detail", type: "table", title: "明细", data: byIndustry, fields: { sales, growth }, columns: [{ field: "industry", label: "行业" }, { field: "sales" }, { field: "growth" }] },
    ],
  };
}

function openPage(html: string) {
  const errors: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error.message));
  // Browsers have TextEncoder (the bundled schema validator uses it); jsdom does not.
  const dom = new JSDOM(html, { runScripts: "dangerously", virtualConsole, beforeParse: (window) => Object.assign(window, { TextEncoder, TextDecoder }) });
  const window = dom.window as unknown as Window & { __options?: { id: string; option: Record<string, unknown> }[] };
  return { document: window.document, options: window.__options ?? [], errors, close: () => dom.window.close() };
}

describe("generate_dashboard", () => {
  it("builds a snapshot dashboard that compiles its charts in the page", async () => {
    const { receipts, root, call, cleanup } = await setup({ industries, totals });
    const result = await call({ operation: "create", spec: dashboardSpec(receipts) });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/^\[DASHBOARD_CREATED\] dashboards\/industry\.html/);
    expect(text).toContain("[NOTICE] sales_bar:");
    expect(text).toContain("[SEMANTICS]");
    expect(result.details).toMatchObject({ relativePath: "dashboards/industry.html", receiptIds: [receipts.totals, receipts.industries], renderer: { compiler: CHART_COMPILER_VERSION, theme: CHART_THEME_VERSION } });

    const html = await readFile(join(root, "dashboards", "industry.html"), "utf8");
    expect(html).toContain("<title>行业经营 &lt;快照&gt;</title>");
    // The page carries the spec and rows, never a compiled option.
    expect(html).not.toContain("\"series\":");
    const page = openPage(html);
    expect(page.errors).toEqual([]);
    expect(page.options.map((entry) => entry.id)).toEqual(["view-sales_bar"]);
    expect(JSON.stringify(page.options[0]!.option.xAxis)).toContain("零售业");
    // A headline number beside its unit, the full value as the tooltip, and a signed change with its direction.
    const value = page.document.querySelector("#view-kpi .value");
    expect([value?.firstChild?.textContent, value?.querySelector(".unit")?.textContent, value?.getAttribute("title")]).toEqual(["5,734", "亿元", "5,733.88 亿元"]);
    expect(page.document.querySelector("#view-kpi .delta.up")?.textContent).toBe("同比▲ +10.0%");
    // A table column shares one decimal count and names its unit in the header.
    const headers = [...page.document.querySelectorAll("#view-detail th")].map((cell) => cell.textContent);
    expect(headers).toEqual(["行业", "销售额（亿元）", "同比增速"]);
    const cells = [...page.document.querySelectorAll("#view-detail tbody tr")].map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent));
    expect(cells).toEqual([["批发业", "5,234.00", "12%"], ["零售业", "499.88", ""], ["住宿和餐饮业", "", "5%"]]);
    // Without a layout, KPI and the table take full rows and the chart its own half row.
    expect([...page.document.querySelectorAll(".row")].map((row) => [...row.querySelectorAll("section.panel")].map((panel) => panel.id))).toEqual([["view-kpi"], ["view-sales_bar"], ["view-detail"]]);
    expect(page.document.querySelector("#view-sales_bar .notes")?.textContent).toBeTruthy();
    // Readers see the data and its date; Receipts stay in the embedded payload for tracing.
    expect(page.document.querySelector(".stamp")?.textContent).toMatch(/^数据快照 · \d{4}-\d{2}-\d{2}$/);
    expect(page.document.querySelector("main")?.textContent).not.toContain(receipts.industries);
    expect(page.document.querySelector("footer")).toBeNull();
    expect(html).toContain(receipts.industries);
    page.close();
    await cleanup();
  });

  it("keeps disclosures off the page; the model relays them", () => {
    const data = { kind: "publication", receiptId: "r1" } as const;
    const spec = { version: 1 as const, title: "t", views: [
      { id: "a", type: "table" as const, data },
      { id: "b", type: "table" as const, data },
    ] };
    const disclosure = "结果包含按字面解释选择的口径。";
    const html = renderDashboardHtml(
      { spec, datasets: { "publication:r1": { columns: ["n"], rows: [[1]] } }, sources: { "publication:r1": { kind: "publication", id: "r1", label: "发布记录 r1", contentHash: "abc", disclosures: [disclosure] } }, checks: {}, renderer: CHART_RENDERER_VERSIONS, builtOn: "2026-10-01", nonce: "n" },
      { chartsSource: CHARTS_BROWSER_SOURCE, echartsSource: ECHARTS_STUB },
    );
    const page = openPage(html);
    expect(page.errors).toEqual([]);
    expect(page.document.querySelectorAll(".panel .notes")).toHaveLength(0);
    expect(page.document.querySelector("main")?.textContent).not.toContain(disclosure);
    page.close();
  });

  it("validates without writing and overwrites on edit", async () => {
    const { receipts, root, call, cleanup } = await setup({ industries, totals });
    const spec = dashboardSpec(receipts);
    const validated = await call({ operation: "validate", spec });
    expect((validated.content[0] as { text: string }).text).toMatch(/^dashboard spec valid/);
    await expect(readFile(join(root, "dashboards", "industry.html"), "utf8")).rejects.toThrow();
    await call({ operation: "edit", spec: { ...spec, title: "改版" }, editPath: "dashboards/old.html" });
    expect(await readFile(join(root, "dashboards", "old.html"), "utf8")).toContain("<title>改版</title>");
    await expect(call({ operation: "edit", spec })).rejects.toThrow("edit requires editPath");
    await cleanup();
  });

  it("only reads published results, through the Receipt", async () => {
    const { receipts, call, cleanup } = await setup({ industries, totals });
    const spec = dashboardSpec(receipts);
    const derived = { ...spec, views: [{ ...spec.views[2], data: { kind: "derived", derivedId: "d1" } }] };
    // This host keeps no derived store; the derived tests cover a host that does.
    await expect(call({ operation: "create", spec: derived })).rejects.toThrow("DERIVED_DATASET_UNAVAILABLE");
    const missing = { ...spec, views: [{ ...spec.views[2], data: { kind: "publication", receiptId: "publication_missing" } }] };
    await expect(call({ operation: "create", spec: missing })).rejects.toThrow("PUBLICATION_NOT_FOUND");
    await expect(call({ operation: "create", spec: { ...spec, views: [{ id: "v3", type: "chart", dataset: "x" }] } })).rejects.toThrow(/DASHBOARD_SPEC_INVALID[\s\S]*SCHEMA_INVALID/);
    await cleanup();
  });

  it("returns structured errors instead of aggregating or dropping rows", async () => {
    const { receipts, call, cleanup } = await setup({ industries, totals });
    const spec = dashboardSpec(receipts);
    const ambiguous = { ...spec, views: [{ id: "kpi", type: "kpi", data: { kind: "publication", receiptId: receipts.industries }, cards: [{ value: { field: "sales" } }] }] };
    await expect(call({ operation: "validate", spec: ambiguous })).rejects.toThrow(/\[KPI_ROW_AMBIGUOUS\][\s\S]*建议/);
    await cleanup();
    const large = await setup({ industries: { columns: ["industry", "sales"], rows: Array.from({ length: MAX_DASHBOARD_DATASET_ROWS + 1 }, (_, index) => [`r${index}`, index]) }, totals });
    await expect(large.call({ operation: "validate", spec: dashboardSpec(large.receipts) })).rejects.toThrow("DASHBOARD_TOO_MANY_ROWS");
    await large.cleanup();
  });

  it("shows doubtful declarations on the page and in the text", async () => {
    const { receipts, root, call, cleanup } = await setup({ industries, totals });
    const spec = dashboardSpec(receipts);
    // Growth stored as a ratio, declared as percent points.
    const views = [{ ...spec.views[2], fields: { sales, growth: { ...growth, storage: "percent" } } }];
    const result = await call({ operation: "create", spec: { ...spec, views } });
    expect((result.content[0] as { text: string }).text).toContain("[CHECK] detail: 同比增速 声明为百分数");
    const page = openPage(await readFile(join(root, "dashboards", "industry.html"), "utf8"));
    expect(page.errors).toEqual([]);
    expect(page.document.querySelector("#view-detail .notes")?.textContent).toContain("可能是比率");
    page.close();
    await cleanup();
  });
});
