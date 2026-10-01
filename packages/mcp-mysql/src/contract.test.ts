import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMysqlReferenceServer } from "./index.js";

const enabled = process.env.DATA_AGENT_TEST_MYSQL === "1";
const config = {
  host: process.env.DATA_AGENT_MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.DATA_AGENT_MYSQL_PORT ?? 13306),
  user: process.env.DATA_AGENT_MYSQL_USER ?? "root",
  password: process.env.DATA_AGENT_MYSQL_PASSWORD,
  database: process.env.DATA_AGENT_MYSQL_DATABASE ?? "data_agent_contract",
};

describe.runIf(enabled)("MySQL Reference MCP Server contract", () => {
  it("previews bounded rows, blocks dangerous SQL, and reports schema", async () => {
    const { server, close } = await createMysqlReferenceServer(config);
    const client = new Client({ name: "data-agent-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "execute_query_preview", arguments: { sql: "SELECT * FROM contract_sales", limit: 1 } });
    const payload = JSON.parse((preview.content as any)[0].text);
    expect(payload.rows).toHaveLength(1);
    expect(payload.truncated).toBe(true);
    expect(payload.contractVersion).toBe(1);

    const exportResult = await client.callTool({ name: "execute_query_export", arguments: { sql: "SELECT * FROM contract_sales ORDER BY id" } });
    const exportPayload = JSON.parse((exportResult.content as any)[0].text);
    expect(exportPayload.rows.length).toBeGreaterThan(1);
    expect(exportPayload.truncated).toBe(false);

    const showTables = await client.callTool({ name: "execute_query_preview", arguments: { sql: "SHOW TABLES" } });
    const showTablesPayload = JSON.parse((showTables.content as any)[0].text);
    expect(showTablesPayload.error).toBeUndefined();
    expect(showTablesPayload.rows.length).toBeLessThanOrEqual(20);
    expect(showTablesPayload.totalRows).toBeLessThanOrEqual(21);
    expect(showTablesPayload.rows.some((row: Record<string, unknown>) => Object.values(row).includes("contract_sales"))).toBe(true);

    const boundedShowTables = await client.callTool({ name: "execute_query_preview", arguments: { sql: "SHOW TABLES", limit: 1 } });
    const boundedShowTablesPayload = JSON.parse((boundedShowTables.content as any)[0].text);
    expect(boundedShowTablesPayload.error).toBeUndefined();
    expect(boundedShowTablesPayload.rows.length).toBeLessThanOrEqual(1);
    expect(boundedShowTablesPayload.totalRows).toBeLessThanOrEqual(2);
    expect(boundedShowTablesPayload.truncated).toBe(boundedShowTablesPayload.totalRows > 1);

    const describe = await client.callTool({ name: "execute_query_preview", arguments: { sql: "DESCRIBE contract_sales" } });
    const describePayload = JSON.parse((describe.content as any)[0].text);
    expect(describePayload.error).toBeUndefined();
    expect(describePayload.rows.some((row: Record<string, unknown>) => row.Field === "id")).toBe(true);

    const desc = await client.callTool({ name: "execute_query_preview", arguments: { sql: "DESC contract_sales" } });
    const descPayload = JSON.parse((desc.content as any)[0].text);
    expect(descPayload.error).toBeUndefined();
    expect(descPayload.rows.some((row: Record<string, unknown>) => row.Field === "amount")).toBe(true);

    const dangerous = await client.callTool({ name: "execute_query_preview", arguments: { sql: "DELETE FROM contract_sales" } });
    expect(JSON.parse((dangerous.content as any)[0].text).error.code).toBe("FORBIDDEN_SQL");

    const schema = await client.callTool({ name: "get_schema", arguments: {} });
    expect(JSON.parse((schema.content as any)[0].text).schema[0].table).toBe("contract_sales");

    await client.close();
    await close();
  });

  // A read-only statement slow enough to outlive the limits below, on any database.
  const SLOW = "SELECT COUNT(*) AS n FROM information_schema.COLUMNS a, information_schema.COLUMNS b, information_schema.COLUMNS c";
  const running = async (client: Client, marker: string) => {
    const result = await client.callTool({ name: "execute_query_preview", arguments: { sql: `SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE COMMAND = 'Query' AND INFO LIKE '%${marker}%' AND INFO NOT LIKE '%PROCESSLIST%'` } });
    return Number(JSON.parse((result.content as any)[0].text).rows[0].n);
  };
  const connected = async () => {
    const { server, close } = await createMysqlReferenceServer(config);
    const client = new Client({ name: "data-agent-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return { client, close: async () => { await client.close(); await close(); } };
  };

  it("lets MySQL stop a statement at its time limit and says so", async () => {
    const { client, close } = await connected();
    try {
      for (const name of ["execute_query_preview", "execute_query_export"]) {
        const started = Date.now();
        const result = await client.callTool({ name, arguments: { sql: SLOW, timeoutMs: 500 } });
        expect(JSON.parse((result.content as any)[0].text).error?.code).toBe("QUERY_TIMEOUT");
        expect(Date.now() - started).toBeLessThan(10_000);
      }
    } finally {
      await close();
    }
  }, 30_000);

  it("stops a cancelled preview on the server instead of leaving it running", async () => {
    const { client, close } = await connected();
    try {
      const marker = `cancel_${Date.now()}`;
      const controller = new AbortController();
      const call = client.callTool({ name: "execute_query_preview", arguments: { sql: `${SLOW} WHERE '${marker}' = '${marker}'` } }, undefined, { signal: controller.signal });
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(await running(client, marker)).toBe(1);
      controller.abort();
      await expect(call).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(await running(client, marker)).toBe(0);
    } finally {
      await close();
    }
  }, 30_000);
});
