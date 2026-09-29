import { describe, expect, it } from "vitest";
import { InMemoryAnsweringStore } from "./answering-store.js";
import { InMemoryResultStore } from "./result-store.js";
import { InMemoryAnswering } from "./service.js";
import type { BusinessContext, PublicationId } from "./model.js";

const context = (invocationId: string, overrides: Partial<BusinessContext> = {}): BusinessContext => ({ principal: { id: "user-1" }, sessionId: "session-1", lane: "main", operationId: "operation-1", invocationId, ...overrides });
const listSpec = { entity: "industries", metric: "sum", filters: [], groupBy: [], time: { state: "not_applicable" }, ranking: { state: "not_applicable" }, output: { rowMode: "full" } };

async function published() {
  const store = new InMemoryAnsweringStore();
  const resultStore = new InMemoryResultStore();
  let rows: unknown[][] = [["批发业", "100.00"]];
  const executed: string[] = [];
  const answering = new InMemoryAnswering({ store, resultStore, sqlExecutor: { run: async (sql) => { executed.push(sql); return { columns: ["industry", "sales"], rows: rows.map((row) => [...row]), truncated: false }; } } });
  const begun = await answering.begin({ requestMessageId: "m", requestId: "b", spec: listSpec }, context("b"));
  const execution = await answering.execute({ kind: "result", taskId: begun.taskId, revisionId: begun.revisionId, sql: "SELECT industry, sales FROM t" }, context("e"));
  if (execution.artifact.kind !== "candidate") throw new Error("expected Result Candidate");
  const receipt = await answering.publish({ candidateId: execution.artifact.candidateId, format: "csv", requestId: "p" }, context("p"));
  const rowsOf = async (receiptId: string) => {
    const found = await store.transact((tx) => tx.getReceipt(receiptId as PublicationId), context("r"));
    return (await resultStore.openAuthorized(found!.resultRef, found!, context("r"))).rows;
  };
  return { store, answering, receipt, executed, setRows: (next: unknown[][]) => { rows = next; }, rowsOf };
}

describe("Answering.refresh", () => {
  it("runs the published query again and publishes the new rows as a new Receipt", async () => {
    const { answering, receipt, executed, setRows, rowsOf, store } = await published();
    setRows([["批发业", "120.00"], ["零售业", "30.00"]]);
    const refreshed = await answering.refresh({ receiptId: receipt.receiptId, requestId: "refresh-1" }, context("f"));
    expect(refreshed.refreshes).toBe(receipt.receiptId);
    expect(refreshed.receiptId).not.toBe(receipt.receiptId);
    expect(refreshed.contentHash).not.toBe(receipt.contentHash);
    expect(executed.at(-1)).toBe("SELECT industry, sales FROM t");
    expect(await rowsOf(refreshed.receiptId)).toEqual([["批发业", "120.00"], ["零售业", "30.00"]]);
    expect(refreshed.physicalProfile?.rowCount).toBe(2);
    // The original Receipt and its rows do not change.
    expect(await store.transact((tx) => tx.getReceipt(receipt.receiptId), context("r"))).toEqual(receipt);
    expect(await rowsOf(receipt.receiptId)).toEqual([["批发业", "100.00"]]);
  });

  it("returns the same Receipt for a retried request without running the query again", async () => {
    const { answering, receipt, executed } = await published();
    const first = await answering.refresh({ receiptId: receipt.receiptId, requestId: "refresh-1" }, context("f1"));
    const runs = executed.length;
    const second = await answering.refresh({ receiptId: receipt.receiptId, requestId: "refresh-1" }, context("f2"));
    expect(second.receiptId).toBe(first.receiptId);
    expect(executed.length).toBe(runs);
  });

  it("refuses other sessions and principals, and unknown Receipts", async () => {
    const { answering, receipt } = await published();
    await expect(answering.refresh({ receiptId: receipt.receiptId, requestId: "x" }, context("f", { sessionId: "session-2" }))).rejects.toThrow();
    await expect(answering.refresh({ receiptId: receipt.receiptId, requestId: "y" }, context("f", { principal: { id: "user-2" } }))).rejects.toThrow();
    await expect(answering.refresh({ receiptId: "publication_missing", requestId: "z" }, context("f"))).rejects.toThrow("was not found");
  });
});
