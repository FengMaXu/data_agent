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

    const dangerous = await client.callTool({ name: "execute_query_preview", arguments: { sql: "DELETE FROM contract_sales" } });
    expect(JSON.parse((dangerous.content as any)[0].text).error.code).toBe("FORBIDDEN_SQL");

    const schema = await client.callTool({ name: "get_schema", arguments: {} });
    expect(JSON.parse((schema.content as any)[0].text).schema[0].table).toBe("contract_sales");

    await client.close();
    await close();
  });
});
