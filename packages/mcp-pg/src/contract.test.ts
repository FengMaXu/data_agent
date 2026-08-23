import { describe, expect, it, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPgReferenceServer } from "./index.js";

const db = new PGlite();
const serverSocket = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0 });
let port: number;

afterAll(async () => {
  await serverSocket.stop();
  await db.close();
});

describe("PostgreSQL Reference MCP Server contract", () => {
  it("previews bounded rows, blocks dangerous SQL, and reports schema over the PG wire protocol", async () => {
      await serverSocket.start();
    const port = Number(serverSocket.getServerConn().split(":")[1]);
    await db.exec("CREATE TABLE contract_sales (id INT PRIMARY KEY, region TEXT, amount NUMERIC); INSERT INTO contract_sales VALUES (1,'north',10),(2,'south',20);");

    const { Pool } = await import("pg");
    const pool = new Pool({ host: "127.0.0.1", port, user: "postgres", database: "postgres", connectionTimeoutMillis: 5000 });
    await pool.query("SELECT 1");

    const { server, close } = await createPgReferenceServer({ pool });
    const client = new Client({ name: "data-agent-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "execute_query_preview", arguments: { sql: "SELECT * FROM contract_sales", limit: 1 } });
    const payload = JSON.parse((preview.content as any)[0].text);
    expect(payload.rows).toHaveLength(1);
    expect(payload.truncated).toBe(true);
    expect(payload.contractVersion).toBe(1);

    const dangerous = await client.callTool({ name: "execute_query_preview", arguments: { sql: "DELETE FROM contract_sales" } });
    expect(JSON.parse((dangerous.content as any)[0].text).error.code).toBe("FORBIDDEN_SQL");

    const schema = await client.callTool({ name: "get_schema", arguments: {} });
    expect(JSON.parse((schema.content as any)[0].text).schema[0].table).toBe("contract_sales");

    await client.close();
    await close();
  }, 30000);
});
