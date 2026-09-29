import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { CHART_COMPILER_VERSION, CHART_THEME_VERSION } from "@data-agent/charts";
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
    expect(page.document.querySelector("#view-kpi .value")?.textContent).toBe("5,733.88 亿元");
    expect(page.document.querySelector("#view-kpi .delta")?.textContent).toBe("同比 10%");
    const cells = [...page.document.querySelectorAll("#view-detail tbody tr")].map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent));
    expect(cells).toEqual([["批发业", "5,234 亿元", "12%"], ["零售业", "499.88 亿元", ""], ["住宿和餐饮业", "", "5%"]]);
    expect(page.document.querySelector("#view-sales_bar .notes")?.textContent).toBeTruthy();
    expect(page.document.querySelector("footer")?.textContent).toContain(receipts.industries);
    page.close();
    await cleanup();
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
    await expect(call({ operation: "create", spec: derived })).rejects.toThrow("CHART_DATA_UNSUPPORTED");
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
});
