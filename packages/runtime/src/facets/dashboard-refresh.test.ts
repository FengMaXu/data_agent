import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryAnsweringStore } from "../answering/answering-store.js";
import { InMemoryResultStore } from "../answering/result-store.js";
import { InMemoryAnswering } from "../answering/service.js";
import type { BusinessContext, PublicationId } from "../answering/model.js";
import { WorkspaceStore } from "../workspace.js";
import { createDashboardToolDefinitions } from "../tools/dashboard.js";
import { ArtifactDirectory } from "./artifact-directory.js";
import { DashboardRefresher } from "./dashboard-refresh.js";

const context = (invocationId: string, sessionId = "session-1"): BusinessContext => ({ principal: { id: "user-1" }, sessionId, lane: "main", operationId: "operation-1", invocationId });
const invocation = (invocationId: string) => ({ operationId: "operation-1", invocationId, getMemo: async () => undefined, setMemo: async () => undefined }) as never;
const toolContext = { sessionId: "session-1", principalId: "user-1" } as never;
const listSpec = { entity: "industries", metric: "sum", filters: [], groupBy: [], time: { state: "not_applicable" }, ranking: { state: "not_applicable" }, output: { rowMode: "full" } };
const sales = { type: "quantitative", storage: "raw", unit: "亿元", additivity: "additive", label: "销售额" };

async function setup() {
  const store = new InMemoryAnsweringStore();
  const resultStore = new InMemoryResultStore();
  let rows: unknown[][] = [["批发业", "100.00"], ["零售业", "40.00"]];
  const answering = new InMemoryAnswering({ store, resultStore, sqlExecutor: { run: async () => ({ columns: ["industry", "sales"], rows: rows.map((row) => [...row]), truncated: false }) } });
  const begun = await answering.begin({ requestMessageId: "m", requestId: "b", spec: listSpec }, context("b"));
  const execution = await answering.execute({ kind: "result", taskId: begun.taskId, revisionId: begun.revisionId, sql: "SELECT industry, sales FROM t" }, context("e"));
  if (execution.artifact.kind !== "candidate") throw new Error("expected Result Candidate");
  const receipt = await answering.publish({ candidateId: execution.artifact.candidateId, format: "csv", requestId: "p" }, context("p"));
  const artifacts = new ArtifactDirectory({
    findPublication: (publicationId, business) => store.transact((tx) => tx.getReceipt(publicationId as PublicationId), business),
    readAuthorized: async (found, business) => resultStore.encodeCsv(found.resultRef, business),
    readRowsAuthorized: async (found, business) => {
      const result = await resultStore.openAuthorized(found.resultRef, found, business);
      return { columns: result.columns, rows: result.rows, contentHash: result.contentHash };
    },
  });
  const root = await mkdtemp(join(tmpdir(), "data-agent-refresh-"));
  const workspace = new WorkspaceStore(root, { userId: "user-1", sessionId: "session-1" });
  const tool = createDashboardToolDefinitions({ workspace, artifacts, echartsSource: async () => undefined })[0]!.tool;
  const live = { kind: "live", receiptId: receipt.receiptId };
  await tool.execute("d", { operation: "create", spec: { version: 1, title: "实时", filename: "live", views: [
    { id: "bar", type: "chart", chart: { version: 1, title: "销售额", data: live, fields: { sales }, chart: { mark: "cartesian", x: { field: "industry" }, layers: [{ type: "bar", y: { field: "sales" } }] } } },
    { id: "detail", type: "table", data: live, fields: { sales } },
    { id: "fixed", type: "table", data: { kind: "publication", receiptId: receipt.receiptId } },
  ] } } as never, undefined, toolContext, invocation("d"), {} as never);
  const refresher = new DashboardRefresher({ workspace, answering, artifacts });
  return { receipt, workspace, refresher, setRows: (next: unknown[][]) => { rows = next; }, cleanup: () => rm(root, { recursive: true, force: true }) };
}

describe("Dashboard refresh", () => {
  it("refreshes a live view's Receipt and returns new rows under the page's key, for every view on it", async () => {
    const { receipt, refresher, setRows, cleanup } = await setup();
    setRows([["批发业", "130.00"], ["零售业", "45.00"], ["餐饮业", "5.00"]]);
    const result = await refresher.refresh({ path: "dashboards/live.html", viewIds: ["bar"], requestId: "req-1" }, context("r"));
    const key = `live:${receipt.receiptId}`;
    expect(Object.keys(result.datasets)).toEqual([key]);
    expect(result.datasets[key]!.rows).toEqual([["批发业", "130.00"], ["零售业", "45.00"], ["餐饮业", "5.00"]]);
    expect(result.sources[key]).toMatchObject({ kind: "publication", live: true, label: expect.stringContaining("实时数据") });
    expect(result.sources[key]!.id).not.toBe(receipt.receiptId);
    expect(Object.keys(result.checks).sort()).toEqual(["bar", "detail"]);
    await cleanup();
  });

  it("names views only: refuses views that are not live, unknown views and other paths", async () => {
    const { refresher, workspace, cleanup } = await setup();
    await expect(refresher.refresh({ path: "dashboards/live.html", viewIds: ["fixed"], requestId: "a" }, context("r"))).rejects.toThrow("DASHBOARD_VIEW_NOT_LIVE");
    await expect(refresher.refresh({ path: "dashboards/live.html", viewIds: ["nope"], requestId: "b" }, context("r"))).rejects.toThrow("DASHBOARD_VIEW_NOT_FOUND");
    await expect(refresher.refresh({ path: "../secrets.html", viewIds: ["bar"], requestId: "c" }, context("r"))).rejects.toThrow("DASHBOARD_PATH_INVALID");
    await workspace.write("dashboards/fake.html", "<html>not a dashboard</html>");
    await expect(refresher.refresh({ path: "dashboards/fake.html", viewIds: ["bar"], requestId: "d" }, context("r"))).rejects.toThrow("DASHBOARD_FILE_INVALID");
    await cleanup();
  });

  it("refreshes only through Answering, which refuses another session's Receipt", async () => {
    const { refresher, cleanup } = await setup();
    await expect(refresher.refresh({ path: "dashboards/live.html", viewIds: ["bar"], requestId: "x" }, context("r", "session-2"))).rejects.toThrow();
    await cleanup();
  });

  it("returns an error instead of rows the dashboard cannot show", async () => {
    const { refresher, setRows, cleanup } = await setup();
    setRows([["批发业", "1"], ["批发业", "2"]]);
    await expect(refresher.refresh({ path: "dashboards/live.html", viewIds: ["bar"], requestId: "dup" }, context("r"))).rejects.toThrow(/DASHBOARD_REFRESH_INVALID[\s\S]*DUPLICATE_KEY/);
    await cleanup();
  });
});
