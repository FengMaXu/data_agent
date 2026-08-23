import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createMcpQueryExecutor } from "./mcp-query-executor.js";

const require_ = createRequire(import.meta.url);
const Database = require_("better-sqlite3");

describe("MCP query executor", () => {
  it("executes read-only SQL against the reference SQLite MCP server over stdio", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mcp-exec-"));
    const dbPath = path.join(dir, "test.db");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (1), (2);");
    db.close();

    const serverScript = path.resolve("dist/reference-sqlite-mcp.js");
    const executor = createMcpQueryExecutor({ command: process.execPath, args: [serverScript, dbPath] });
    try {
      const result = await executor.run("SELECT n FROM t ORDER BY n", 10);
      expect(result.columns).toEqual(["n"]);
      expect(result.rows).toEqual([[1], [2]]);
      expect(result.truncated).toBe(false);
    } finally {
      await executor.close();
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }, 30000);
});

import { rm } from "node:fs/promises";
afterAll(() => {});
