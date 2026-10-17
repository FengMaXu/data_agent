import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryAnsweringStore } from "../answering/answering-store.js";
import { InMemoryResultStore } from "../answering/result-store.js";
import { InMemoryAnswering } from "../answering/service.js";
import type { BusinessContext, PublicationId } from "../answering/model.js";
import { ArtifactDirectory } from "../facets/artifact-directory.js";
import { DerivedDatasets, FileDerivedDatasetStore } from "../facets/derived-datasets.js";
import { WorkspaceStore } from "../workspace.js";
import { createChartToolDefinitions, type ChartRenderRecord } from "./charts.js";
import { createCoreAgentToolDefinitions } from "./core.js";
import { createDashboardToolDefinitions } from "./dashboard.js";

const python = process.platform === "win32" ? "python" : "python3";
const context = (invocationId: string, sessionId = "session-1"): BusinessContext => ({ principal: { id: "user-1" }, sessionId, lane: "main", operationId: "operation-1", invocationId });
const invocation = (invocationId: string) => ({ operationId: "operation-1", invocationId, getMemo: async () => undefined, setMemo: async () => undefined }) as never;
const toolContext = { sessionId: "session-1", principalId: "user-1" } as never;
const listSpec = { "population.entity": "industries", "population.eligibility": "n/a", "population.conditions": "n/a", "population.time": "n/a", "measure.formula": { op: "sum", of: "sales" }, grouping: "n/a", selection: "n/a", output: { rowMode: "full" } };

/** Shares computed in Python from the published sales, written as a derived dataset. */
const SHARE_SCRIPT = `
import json
with open("inputs/RECEIPT.json", encoding="utf-8") as f:
    data = json.load(f)
total = sum(float(row[1]) for row in data["rows"])
rows = [[row[0], round(float(row[1]) / total * 100, 2)] for row in data["rows"]]
with open("derived/share.json", "w", encoding="utf-8") as f:
    json.dump({"columns": ["industry", "share_pct"], "rows": rows}, f, ensure_ascii=False)
print("done")
`;

async function setup() {
  const store = new InMemoryAnsweringStore();
  const resultStore = new InMemoryResultStore();
  const answering = new InMemoryAnswering({ store, resultStore, sqlExecutor: { run: async () => ({ columns: ["industry", "sales"], rows: [["批发业", "750.00"], ["零售业", "250.00"]], truncated: false }) } });
  const begun = await answering.set({ requestMessageId: "m", requestId: "b", fields: listSpec }, context("b"));
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
  const root = await mkdtemp(join(tmpdir(), "data-agent-derived-"));
  await mkdir(join(root, "workspace"), { recursive: true });
  const workspace = new WorkspaceStore(join(root, "workspace"), { userId: "user-1", sessionId: "session-1" });
  const derived = new DerivedDatasets(new FileDerivedDatasetStore(join(root, "derived")));
  const core = createCoreAgentToolDefinitions({ workspace, publishedRows: artifacts, derivedDatasets: derived, pythonExecutable: python }).map((definition) => definition.tool);
  const runPython = core.find((tool) => tool.name === "run_python")!;
  const showWidget = core.find((tool) => tool.name === "show_widget")!;
  const renderChart = createChartToolDefinitions({ workspace, artifacts, derived })[0]!.tool;
  const dashboard = createDashboardToolDefinitions({ workspace, artifacts, derived, echartsSource: async () => undefined })[0]!.tool;
  const call = (tool: typeof runPython, input: Record<string, unknown>, id: string) => tool.execute(id, input as never, undefined, toolContext, invocation(id), {} as never);
  const derive = async () => {
    const result = await call(runPython, { code: SHARE_SCRIPT.replace("RECEIPT", receipt.receiptId), derive: { inputs: [receipt.receiptId], outputs: [{ name: "行业占比", path: "derived/share.json" }] } }, "py");
    const details = result.details as { derived: { derivedId: string; rows: number }[] };
    if (!details.derived) throw new Error((result.content[0] as { text: string }).text);
    return { text: (result.content[0] as { text: string }).text, derivedId: details.derived[0]!.derivedId };
  };
  return { receipt, root, workspace, derived, runPython, showWidget, renderChart, dashboard, call, derive, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const shareSpec = (derivedId: string, storage: "percent" | "ratio" = "percent") => ({
  version: 1,
  title: "行业占比",
  data: { kind: "derived", derivedId },
  fields: { share_pct: { type: "quantitative", storage, additivity: "additive", label: "占比" } },
  chart: { mark: "cartesian", x: { field: "industry" }, layers: [{ type: "bar", y: { field: "share_pct" } }] },
});

describe("Derived datasets", () => {
  it("registers a job's declared output with its inputs, script and profile", async () => {
    const { receipt, derived, derive, cleanup } = await setup();
    const { text, derivedId } = await derive();
    expect(text).toMatch(new RegExp(`\\[DERIVED\\] 行业占比 derivedId=derived_[0-9a-f-]+（2 行，派生自 ${receipt.receiptId}）`));
    const record = await derived.resolve(derivedId, context("r"));
    expect(record.rows).toEqual([["批发业", 75], ["零售业", 25]]);
    expect(record.provenance.inputs).toEqual([{ receiptId: receipt.receiptId, contentHash: receipt.contentHash }]);
    expect(record.provenance.scriptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(record.physicalProfile.columns.map((column) => column.kind)).toEqual(["text", "integer"]);
    await cleanup();
  });

  it("stays as registered after the workspace file changes, and is never overwritten", async () => {
    const { derived, workspace, derive, root, cleanup } = await setup();
    const { derivedId } = await derive();
    await workspace.write("derived/share.json", JSON.stringify({ columns: ["industry", "share_pct"], rows: [["批发业", 1]] }));
    expect((await derived.resolve(derivedId, context("r"))).rows).toEqual([["批发业", 75], ["零售业", 25]]);
    const record = await derived.resolve(derivedId, context("r"));
    await expect(new FileDerivedDatasetStore(join(root, "derived")).put(record)).rejects.toThrow();
    await cleanup();
  });

  it("is readable only by the session that made it, and a guessed id is not found", async () => {
    const { derived, derive, cleanup } = await setup();
    const { derivedId } = await derive();
    await expect(derived.resolve(derivedId, context("other", "session-2"))).rejects.toThrow("DERIVED_DATASET_NOT_FOUND");
    await expect(derived.resolve("derived_00000000-0000-0000-0000-000000000000", context("r"))).rejects.toThrow("DERIVED_DATASET_NOT_FOUND");
    await expect(derived.resolve("../../etc/passwd", context("r"))).rejects.toThrow("DERIVED_DATASET_NOT_FOUND");
    await cleanup();
  });

  it("refuses unreadable inputs before running and outputs outside derived/", async () => {
    const { runPython, call, workspace, cleanup } = await setup();
    const marker = "open('ran.txt', 'w').write('ran')";
    await expect(call(runPython, { code: marker, derive: { inputs: ["publication_missing"], outputs: [{ name: "x", path: "derived/x.json" }] } }, "missing")).rejects.toThrow("PUBLICATION_NOT_FOUND");
    await expect(workspace.read("ran.txt")).rejects.toThrow();
    await expect(call(runPython, { code: marker, derive: { inputs: [], outputs: [{ name: "x", path: "charts/x.json" }] } }, "outside")).rejects.toThrow("DERIVED_OUTPUT_INVALID");
    await cleanup();
  });

  it("feeds render_chart, show_widget and dashboards, labelled as derived", async () => {
    const { receipt, root, renderChart, showWidget, dashboard, call, derive, cleanup } = await setup();
    const { derivedId } = await derive();

    const rendered = await call(renderChart, { spec: shareSpec(derivedId), fileName: "share" }, "render");
    expect((rendered.content[0] as { text: string }).text).toContain(`[DERIVED] 派生数据集 ${derivedId}（行业占比`);
    const record = JSON.parse(await readFile(join(root, "workspace", "charts", "share.chart.json"), "utf8")) as ChartRenderRecord;
    expect(record.data).toMatchObject({ kind: "derived", derivedId, inputs: [{ receiptId: receipt.receiptId }] });

    const widget = ((await call(showWidget, { kind: "chart", spec: shareSpec(derivedId) }, "widget")).details as { widget: Record<string, unknown> }).widget;
    expect(widget).toMatchObject({ derivedId, dataSource: { kind: "derived" } });
    expect(widget.derivedFrom).toContain(receipt.receiptId);

    await call(dashboard, { operation: "create", spec: { version: 1, title: "占比", filename: "share", views: [{ id: "share", type: "chart", chart: shareSpec(derivedId) }] } }, "dashboard");
    expect(await readFile(join(root, "workspace", "dashboards", "share.html"), "utf8")).toContain(`派生数据集 ${derivedId}`);
    await cleanup();
  });

  it("checks declared semantics against the derived dataset's profile", async () => {
    const { renderChart, call, derive, cleanup } = await setup();
    const { derivedId } = await derive();
    const result = await call(renderChart, { spec: shareSpec(derivedId, "ratio"), fileName: "share-ratio" }, "ratio");
    expect((result.content[0] as { text: string }).text).toContain("[CHECK] 占比 声明为比率");
    await cleanup();
  });
});
