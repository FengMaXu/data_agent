import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createMcpQueryExecutor } from "./mcp-query-executor.js";

describe("MCP query executor", () => {
  it("uses bounded preview for exploration and one complete query for a result", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mcp-executor-"));
    const databasePath = path.join(root, "test.db");
    const database = new Database(databasePath);
    database.exec("CREATE TABLE values_table (value INTEGER)");
    const insert = database.prepare("INSERT INTO values_table VALUES (?)");
    database.transaction(() => { for (let value = 0; value < 250; value += 1) insert.run(value); })();
    database.close();

    const executor = createMcpQueryExecutor({
      command: process.execPath,
      args: [path.resolve("dist/reference-sqlite-mcp.js"), databasePath],
      dialect: "sqlite",
      scopedExploration: { scopeId: "sqlite-local-test", connectionId: "sqlite-local-test" },
    });
    try {
      expect(executor.scopedExploration?.scope).toEqual({ scopeId: "sqlite-local-test", connectionId: "sqlite-local-test" });
      const scopedExploration = executor.scopedExploration;
      if (!scopedExploration) throw new Error("SCOPED_EXPLORATION_TEST_CAPABILITY_MISSING");
      const scopedPreview = await scopedExploration.run("SELECT value FROM values_table ORDER BY value", 2, { kind: "exploration" });
      expect(scopedPreview.rows).toHaveLength(2);
      const exploration = await executor.run("SELECT value FROM values_table ORDER BY value", 225, { kind: "exploration", idempotencyKey: "explore-1" });
      expect(exploration.rows).toHaveLength(225);
      expect(exploration.truncated).toBe(true);

      const byteBounded = await executor.run("SELECT value FROM values_table ORDER BY value", 225, { kind: "exploration", idempotencyKey: "explore-bytes", maxPreviewBytes: 1_024 });
      expect(byteBounded.truncated).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(byteBounded), "utf8")).toBeLessThan(1_024);

      const result = await executor.run("SELECT value FROM values_table WHERE value < 2 ORDER BY value", 100, { kind: "result", idempotencyKey: "result-1" });
      expect(result).toEqual({ columns: ["value"], rows: [[0], [1]], truncated: false });
      await expect(executor.run("SELECT value FROM values_table", 100, { kind: "result", idempotencyKey: "result-too-large" })).rejects.toThrow("EXPORT_ROW_LIMIT_EXCEEDED");
    } finally {
      await executor.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
