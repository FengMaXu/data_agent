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
});
