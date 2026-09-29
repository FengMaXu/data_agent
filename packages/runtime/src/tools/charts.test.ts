import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryAnsweringStore } from "../answering/answering-store.js";
import { InMemoryResultStore } from "../answering/result-store.js";
import { InMemoryAnswering } from "../answering/service.js";
import type { BusinessContext, PublicationId } from "../answering/model.js";
import { ArtifactDirectory } from "../facets/artifact-directory.js";
import { WorkspaceStore } from "../workspace.js";
import { createAnsweringAgentToolDefinitions } from "./answering.js";
import { createChartToolDefinitions } from "./charts.js";

const context = (invocationId: string): BusinessContext => ({ principal: { id: "user-1" }, sessionId: "session-1", lane: "main", operationId: "operation-1", invocationId });
const invocation = (invocationId: string) => ({ operationId: "operation-1", invocationId, getMemo: async () => undefined, setMemo: async () => undefined }) as never;
const toolContext = { sessionId: "session-1", principalId: "user-1" } as never;
const listSpec = { entity: "industries", metric: "sum", filters: [], groupBy: [], time: { state: "not_applicable" }, ranking: { state: "not_applicable" }, output: { rowMode: "full" } };

async function setup(rows: unknown[][]) {
  const store = new InMemoryAnsweringStore();
  const resultStore = new InMemoryResultStore();
  const answering = new InMemoryAnswering({ store, resultStore, sqlExecutor: { run: async () => ({ columns: ["industry", "sales"], rows, truncated: false }) } });
  const begun = await answering.begin({ requestMessageId: "message-1", requestId: "begin-1", spec: listSpec }, context("begin-1"));
  const execution = await answering.execute({ kind: "result", taskId: begun.taskId, revisionId: begun.revisionId, sql: "SELECT industry, sales FROM t" }, context("execute-1"));
  if (execution.artifact.kind !== "candidate") throw new Error("expected Result Candidate");
  const receipt = await answering.publish({ candidateId: execution.artifact.candidateId, format: "auto", requestId: "publish-1" }, context("publish-1"));
  // The same Receipt-bound wiring the session runtime uses.
  const artifacts = new ArtifactDirectory({
    findPublication: (publicationId, business) => store.transact((tx) => tx.getReceipt(publicationId as PublicationId), business),
    readAuthorized: async (found, business) => resultStore.encodeCsv(found.resultRef, business),
    readRowsAuthorized: async (found, business) => {
      const result = await resultStore.openAuthorized(found.resultRef, found, business);
      return { columns: result.columns, rows: result.rows, contentHash: result.contentHash };
    },
  });
  const root = await mkdtemp(join(tmpdir(), "data-agent-charts-"));
  const workspace = new WorkspaceStore(root, { userId: "user-1", sessionId: "session-1" });
  const tool = createChartToolDefinitions({ workspace, artifacts })[0]!.tool;
  const publishText = async () => {
    const publish = createAnsweringAgentToolDefinitions(answering, artifacts).map((definition) => definition.tool).find((item) => item.name === "publish_query_result")!;
    const result = await publish.execute("publish", { candidateId: execution.artifact.candidateId, format: "auto" } as never, undefined, toolContext, invocation("publish-2"), {} as never);
    return (result.content[0] as { text: string }).text;
  };
  return { receipt, root, tool, publishText, cleanup: () => rm(root, { recursive: true, force: true }) };
}

function chartSpec(receiptId: string, extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    data: { kind: "publication", receiptId },
    fields: { sales: { type: "quantitative", storage: "raw", unit: "亿元", additivity: "additive", label: "销售额" } },
    chart: { mark: "cartesian", x: { field: "industry" }, layers: [{ type: "bar", y: { field: "sales" } }] },
    ...extra,
  };
}

describe("render_chart", () => {
  it("renders a published result into the workspace and reports notices and semantics", async () => {
    const { receipt, root, tool, cleanup } = await setup([["批发业", "5234.00"], ["零售业", "499.88"], ["住宿和餐饮业", null]]);
    const result = await tool.execute("render", { spec: chartSpec(receipt.receiptId), fileName: "行业销售额" } as never, undefined, toolContext, invocation("render-1"), {} as never);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/^\[CHART_RENDERED\] charts\/行业销售额\.svg \(800×480\)/);
    expect(text).toContain("[NOTICE]");
    expect(text).toContain("[SEMANTICS]");
    expect(text).toContain("![标题](charts/行业销售额.svg)");
    const svg = await readFile(join(root, "charts", "行业销售额.svg"), "utf8");
    expect(svg).toContain("住宿和餐饮业");
    expect(svg).toContain("销售额（亿元）");
    await cleanup();
  });

  it("names the receipt explicitly in publish tool text so charts can cite it", async () => {
    const { receipt, publishText, cleanup } = await setup([["批发业", 1]]);
    expect(await publishText()).toContain(`receiptId=${receipt.receiptId}`);
    await cleanup();
  });

  it("only reads published results", async () => {
    const { tool, cleanup } = await setup([["批发业", 1]]);
    const derived = { ...chartSpec("x"), data: { kind: "derived", derivedId: "d1" } };
    await expect(tool.execute("render", { spec: derived } as never, undefined, toolContext, invocation("render-derived"), {} as never)).rejects.toThrow("CHART_DATA_UNSUPPORTED");
    await expect(tool.execute("render", { spec: chartSpec("publication_missing") } as never, undefined, toolContext, invocation("render-missing"), {} as never)).rejects.toThrow("PUBLICATION_NOT_FOUND");
    await cleanup();
  });

  it("returns the compiler's structured errors and writes nothing", async () => {
    const { receipt, root, tool, cleanup } = await setup([["批发业", 1], ["批发业", 2]]);
    await expect(tool.execute("render", { spec: chartSpec(receipt.receiptId), fileName: "dup" } as never, undefined, toolContext, invocation("render-dup"), {} as never))
      .rejects.toThrow(/CHART_SPEC_INVALID[\s\S]*\[DUPLICATE_KEY\][\s\S]*建议/);
    await expect(readFile(join(root, "charts", "dup.svg"), "utf8")).rejects.toThrow();
    await cleanup();
  });

  it("rejects rows that do not match the Receipt's content hash", async () => {
    const { receipt } = await setup([["批发业", 1]]);
    const tampered = new ArtifactDirectory({
      findPublication: async () => receipt,
      readAuthorized: async () => ({ content: "", contentHash: "" }),
      readRowsAuthorized: async () => ({ columns: ["industry", "sales"], rows: [["批发业", 999]], contentHash: "forged" }),
    });
    await expect(tampered.resolveRows(receipt.receiptId, context("tampered"))).rejects.toThrow("PUBLICATION_INTEGRITY_MISMATCH");
  });
});
