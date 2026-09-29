import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createMcpQueryExecutor, DATABASE_UNAVAILABLE } from "./mcp-query-executor.js";


/**
 * Proxy MCP server for connection-loss tests. The control file decides its
 * behavior: "ok" forwards to the real server; "crash" (or "crash-then-dead")
 * dies on the next query; "dead" exits immediately at start.
 */
const FLAKY_PROXY = [
  'import { spawn } from "node:child_process";',
  'import fs from "node:fs";',
  'const [realServer, databasePath, control] = process.argv.slice(2);',
  'const mode = () => fs.existsSync(control) ? fs.readFileSync(control, "utf8") : "ok";',
  'if (mode() === "dead") process.exit(1);',
  'const child = spawn(process.execPath, [realServer, databasePath], { stdio: ["pipe", "pipe", "inherit"] });',
  'child.stdout.pipe(process.stdout);',
  'process.stdin.on("data", (chunk) => {',
  '  const current = mode();',
  '  if (current.startsWith("crash") && chunk.toString().includes("execute_query_preview")) {',
  '    fs.writeFileSync(control, current === "crash-then-dead" ? "dead" : "ok");',
  '    child.kill();',
  '    process.exit(1);',
  '  }',
  '  child.stdin.write(chunk);',
  '});',
  'child.on("exit", () => process.exit(0));',
].join("\n");

async function flakyExecutor(root: string, mode: string) {
  const databasePath = path.join(root, "test.db");
  const database = new Database(databasePath);
  database.exec("CREATE TABLE t (v INTEGER); INSERT INTO t VALUES (1), (2);");
  database.close();
  const proxyPath = path.join(root, "proxy.mjs");
  const control = path.join(root, "control.txt");
  await writeFile(proxyPath, FLAKY_PROXY, "utf8");
  await writeFile(control, mode, "utf8");
  return createMcpQueryExecutor({
    command: process.execPath,
    args: [proxyPath, path.resolve("dist/reference-sqlite-mcp.js"), databasePath, control],
    dialect: "sqlite",
    reconnectDelaysMs: [10, 20, 30],
  });
}

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
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 30_000);

  it("keeps declared column types from get_schema and allows the pragma_table_info lookup", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mcp-executor-schema-"));
    const databasePath = path.join(root, "test.db");
    const database = new Database(databasePath);
    database.exec("CREATE TABLE orders (order_id INTEGER PRIMARY KEY, status TEXT NOT NULL, amount REAL)");
    database.close();
    const executor = createMcpQueryExecutor({
      command: process.execPath,
      args: [path.resolve("dist/reference-sqlite-mcp.js"), databasePath],
      dialect: "sqlite",
    });
    try {
      const schema = await executor.getSchema();
      expect(schema.tables).toEqual([expect.objectContaining({
        name: "orders",
        columns: ["order_id", "status", "amount"],
        columnTypes: { order_id: "INTEGER", status: "TEXT", amount: "REAL" },
        primaryKey: ["order_id"],
      })]);
      const lookup = await executor.run("SELECT name, type FROM pragma_table_info('orders')", 1_000, { kind: "exploration", idempotencyKey: "types" });
      expect(lookup.rows).toEqual([["order_id", "INTEGER"], ["status", "TEXT"], ["amount", "REAL"]]);
    } finally {
      await executor.close();
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 30_000);
  it("replaces a lost database process and retries the query", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mcp-executor-reconnect-"));
    const executor = await flakyExecutor(root, "crash");
    try {
      const result = await executor.run("SELECT v FROM t ORDER BY v", 10, { kind: "exploration" });
      expect(result.rows).toEqual([[1], [2]]);
      await expect(executor.getSchema()).resolves.toEqual(expect.objectContaining({ tables: [expect.objectContaining({ name: "t" })] }));
    } finally {
      await executor.close();
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 30_000);

  it("reports DATABASE_UNAVAILABLE when the database process cannot be restored", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mcp-executor-unavailable-"));
    const executor = await flakyExecutor(root, "crash-then-dead");
    try {
      const failure = await executor.run("SELECT v FROM t", 10, { kind: "exploration" }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as { code?: string }).code).toBe(DATABASE_UNAVAILABLE);
      expect((failure as Error).message).toMatch(/^DATABASE_UNAVAILABLE: database process unavailable after 3 reconnects/);
    } finally {
      await executor.close();
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 30_000);
});
