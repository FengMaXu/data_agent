import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface McpQueryExecutorOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpQueryResult {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
}

/**
 * Infrastructure adapter: connects to a Data Agent contract MCP database
 * server (stdio) and executes read-only preview queries for the
 * dashboard.evaluate runtime command. The Runtime never touches business
 * databases directly; all SQL flows through this MCP client.
 */
export function createMcpQueryExecutor(options: McpQueryExecutorOptions) {
  let client: Client | null = null;
  const connect = async (): Promise<Client> => {
    if (client) return client;
    const transport = new StdioClientTransport({
      command: options.command,
      args: options.args ?? [],
      env: options.env ? { ...options.env } : undefined,
    });
    client = new Client({ name: "data-agent-query-executor", version: "1.0.0" });
    await client.connect(transport);
    return client;
  };
  return {
    async run(sql: string, rowLimit: number): Promise<McpQueryResult> {
      const c = await connect();
      const result = await c.callTool({ name: "execute_query_preview", arguments: { sql, limit: rowLimit } });
      const text = (result as { content?: Array<{ type: string; text?: string }> }).content?.find((part) => part.type === "text")?.text;
      if (!text) throw new Error("MCP_QUERY_EMPTY_RESPONSE");
      const payload = JSON.parse(text) as { error?: { code: string }; rows?: any[]; truncated?: boolean };
      if (payload.error) throw new Error(payload.error.code);
      const rows = payload.rows ?? [];
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      return {
        columns,
        rows: rows.map((row) => columns.map((col) => row[col])),
        truncated: Boolean(payload.truncated),
      };
    },
    async close(): Promise<void> {
      if (client) { await client.close(); client = null; }
    },
  };
}
