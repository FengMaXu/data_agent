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

    const { server, exports_, close } = createReferenceSqliteServer({ databasePath: dbPath });
    const client = new Client({ name: "data-agent-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "execute_query_preview", arguments: { sql: "SELECT * FROM sales", limit: 1 } });
    const payload = JSON.parse((preview.content as any)[0].text);
    expect(payload.rows).toHaveLength(1);
    expect(payload.truncated).toBe(true);
    expect(payload.contractVersion).toBe(1);

    const dangerous = await client.callTool({ name: "execute_query_preview", arguments: { sql: "DROP TABLE sales" } });
    const dangerousPayload = JSON.parse((dangerous.content as any)[0].text);
    expect(dangerousPayload.error.code).toBe("FORBIDDEN_SQL");
    expect(dangerousPayload.error.message).toContain("high-risk");

    const union = await client.callTool({ name: "execute_query_preview", arguments: { sql: "SELECT region FROM sales UNION ALL SELECT region FROM sales" } });
    expect(JSON.parse((union.content as any)[0].text).rows).toHaveLength(4);

    const schema = await client.callTool({ name: "get_schema", arguments: {} });
    expect(JSON.parse((schema.content as any)[0].text).schema[0].table).toBe("sales");

    const exportResult = await client.callTool({ name: "export_query", arguments: { sql: "SELECT * FROM sales ORDER BY id" } });
    const exportPayload = JSON.parse((exportResult.content as any)[0].text);
    expect(exportPayload.resourceUri).toMatch(/^sqlite:\/\/exports\/.+\.csv$/);
    expect(exportPayload.rowCount).toBe(2);
    const resources = await client.listResources();
    expect(resources.resources.some(r => r.uri === exportPayload.resourceUri)).toBe(true);
    const read = await client.readResource({ uri: exportPayload.resourceUri });
    const blob = (read.contents[0] as any).blob as string;
    expect(Buffer.from(blob, "base64").toString("utf8")).toContain("north");
    expect(exports_.size).toBe(1);

    const emptyExport = await client.callTool({ name: "export_query", arguments: { sql: "SELECT id, region FROM sales WHERE 1 = 0" } });
    const emptyPayload = JSON.parse((emptyExport.content as any)[0].text);
    const emptyResource = await client.readResource({ uri: emptyPayload.resourceUri });
    expect(Buffer.from((emptyResource.contents[0] as any).blob, "base64").toString("utf8")).toBe("id,region");

    await client.close();
    await close();
    await rm(root, { recursive: true, force: true });
  });
});
