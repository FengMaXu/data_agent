import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createMcpQueryExecutor } from "./mcp-query-executor.js";

const require_ = createRequire(import.meta.url);
const Database = require_("better-sqlite3");

describe("MCP query executor", () => {
  it("replaces a stuck stdio worker after a query timeout", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mcp-timeout-"));
    const dbPath = path.join(dir, "test.db");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE t (n INTEGER);");
    const insert = db.prepare("INSERT INTO t VALUES (?)");
    const transaction = db.transaction(() => { for (let i = 0; i < 400; i++) insert.run(i); });
    transaction();
    db.close();
    const serverScript = path.resolve("dist/reference-sqlite-mcp.js");
    const executor = createMcpQueryExecutor({ command: process.execPath, args: [serverScript, dbPath], dialect: "sqlite", requestTimeoutMs: 25 });
    try {
      await expect(executor.run("SELECT COUNT(*) FROM t a CROSS JOIN t b CROSS JOIN t c", 1)).rejects.toThrow(/timed out|timeout|RequestTimeout/i);
      await expect(executor.run("SELECT 1 AS healthy", 1)).resolves.toMatchObject({ columns: ["healthy"], rows: [[1]] });
    } finally {
      await executor.close();
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }, 30000);

  it("executes read-only SQL against the reference SQLite MCP server over stdio", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mcp-exec-"));
    const dbPath = path.join(dir, "test.db");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (1), (2);");
    db.close();

    const serverScript = path.resolve("dist/reference-sqlite-mcp.js");
    const executor = createMcpQueryExecutor({ command: process.execPath, args: [serverScript, dbPath], dialect: "sqlite" });
    try {
      const result = await executor.run("SELECT n FROM t ORDER BY n", 10);
      expect(result.columns).toEqual(["n"]);
      expect(result.rows).toEqual([[1], [2]]);
      expect(result.truncated).toBe(false);
      const schema = await executor.getSchema();
      expect(schema).toMatchObject({ dialect: "sqlite", tables: [{ name: "t", columns: ["n"] }] });
      const plan = await executor.explain!("SELECT n FROM t ORDER BY n");
      expect(plan.columns).toContain("detail");
      expect(plan.rows.length).toBeGreaterThan(0);
      const emptyBatches = [];
      for await (const batch of executor.stream("SELECT n FROM t WHERE 1 = 0")) emptyBatches.push(batch);
      expect(emptyBatches).toEqual([{ columns: ["n"], rows: [] }]);
    } finally {
      await executor.close();
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }, 30000);
});

import { rm } from "node:fs/promises";
afterAll(() => {});
