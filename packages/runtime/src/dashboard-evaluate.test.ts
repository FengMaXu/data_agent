import { describe, expect, it } from "vitest";
import { DataAgentRuntime } from "./index.js";

const ctx = { userId: "local", host: "electron" as const };

describe("dashboard.evaluate", () => {
  it("rejects when no query executor is configured", async () => {
    const runtime = new DataAgentRuntime({});
    await expect(runtime.dispatch({ protocolVersion: 1, requestId: "r1", command: { type: "dashboard.evaluate", sql: "SELECT 1" } }, ctx)).rejects.toThrow("QUERY_EXECUTOR_NOT_CONFIGURED");
  });

  it("executes read-only sql through the executor port and enforces row limits", async () => {
    const runtime = new DataAgentRuntime({});
    runtime.queryExecutor = { run: async (sql: string, rowLimit: number) => ({ columns: ["n"], rows: [[1], [2]].slice(0, rowLimit), truncated: false }) };
    const result = await runtime.dispatch({ protocolVersion: 1, requestId: "r2", command: { type: "dashboard.evaluate", sql: "SELECT n FROM t", rowLimit: 1 } }, ctx);
    expect(result.response).toMatchObject({ type: "dashboard.evaluate.result", rowCount: 1 });
  });

  it("rejects write operations", async () => {
    const runtime = new DataAgentRuntime({});
    runtime.queryExecutor = { run: async () => ({ columns: [], rows: [], truncated: false }) };
    await expect(runtime.dispatch({ protocolVersion: 1, requestId: "r3", command: { type: "dashboard.evaluate", sql: "DELETE FROM t" } }, ctx)).rejects.toThrow("FORBIDDEN_SQL_IN_EVALUATE");
  });
});
