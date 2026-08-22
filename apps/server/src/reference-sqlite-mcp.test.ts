import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createReferenceSqliteServer } from "./reference-sqlite-mcp.js";
import Database from "better-sqlite3";

describe("Reference SQLite MCP Server", () => {
  it("negotiates the contract, enforces limits, and blocks dangerous SQL", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-mcp-sqlite-"));
    const dbPath = join(root, "ref.sqlite3");
    const seed = new (Database as any)(dbPath);
    seed.exec("CREATE TABLE sales (id INTEGER PRIMARY KEY, region TEXT, amount REAL)");
    seed.prepare("INSERT INTO sales (region, amount) VALUES (?, ?)").run("north", 10);
    seed.prepare("INSERT INTO sales (region, amount) VALUES (?, ?)").run("south", 20);
    seed.close();

    const { server, close } = createReferenceSqliteServer({ databasePath: dbPath });
    const client = new Client({ name: "data-agent-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "execute_query_preview", arguments: { sql: "SELECT * FROM sales", limit: 1 } });
    const payload = JSON.parse((preview.content as any)[0].text);
    expect(payload.rows).toHaveLength(1);
    expect(payload.truncated).toBe(true);
    expect(payload.contractVersion).toBe(1);

    const dangerous = await client.callTool({ name: "execute_query_preview", arguments: { sql: "DROP TABLE sales" } });
    expect(JSON.parse((dangerous.content as any)[0].text).error.code).toBe("FORBIDDEN_SQL");

    const schema = await client.callTool({ name: "get_schema", arguments: {} });
    expect(JSON.parse((schema.content as any)[0].text).schema[0].table).toBe("sales");

    await client.close();
    await close();
    await rm(root, { recursive: true, force: true });
  });
});
