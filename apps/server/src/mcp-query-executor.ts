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

export interface McpQueryExportBatch {
  columns: string[];
  rows: unknown[][];
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
    transport.onerror = (error) => console.error("[mcp-query-executor] transport error:", error.message);
    // Note: client.connect(transport) invokes start(); do not call it here.
    transport.onclose = () => console.error("[mcp-query-executor] transport closed");
    client = new Client({ name: "data-agent-query-executor", version: "1.0.0" });
    await client.connect(transport);
    return client;
  };
  return {
    async run(sql: string, rowLimit: number): Promise<McpQueryResult> {
      const c = await connect();
      // mcp-mysql caps preview rows at 200 (MAX_PREVIEW_LIMIT); exceeding it
      // fails server-side schema validation with an opaque -32602.
      const effectiveLimit = Math.min(Math.max(1, Math.floor(rowLimit)), 200);
      const result = await c.callTool({ name: "execute_query_preview", arguments: { sql, limit: effectiveLimit } }) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
      const text = result.content?.find((part) => part.type === "text")?.text;
      if (!text) throw new Error("MCP_QUERY_EMPTY_RESPONSE");
      if (result.isError) throw new Error(`MCP_TOOL_ERROR: ${text.slice(0, 300)}`);
      let payload: { error?: { code: string; message?: string }; rows?: unknown[]; truncated?: boolean };
      try { payload = JSON.parse(text) as typeof payload; }
      catch { throw new Error(`MCP_QUERY_BAD_RESPONSE: ${text.slice(0, 300)}`); }
      if (payload.error) throw new Error(`${payload.error.code}${payload.error.message ? `: ${payload.error.message}` : ""}`);
      const rows = (payload.rows ?? []) as Record<string, unknown>[];
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      return {
        columns,
        rows: rows.map((row) => columns.map((col) => row[col])),
        truncated: Boolean(payload.truncated),
      };
    },
    async *stream(sql: string, signal?: AbortSignal): AsyncGenerator<McpQueryExportBatch> {
      const c = await connect();
      const batchSize = 1000;
      for (let offset = 0; offset < 100000; offset += batchSize) {
        if (signal?.aborted) throw new Error("EXPORT_CANCELLED");
        const result = await c.callTool({ name: "execute_query_export_batch", arguments: { sql, offset, limit: batchSize, maxRows: 100000 } }) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
        const text = result.content?.find((part) => part.type === "text")?.text;
        if (!text) throw new Error("MCP_QUERY_EMPTY_RESPONSE");
        if (result.isError) throw new Error(`MCP_TOOL_ERROR: ${text.slice(0, 300)}`);
        let payload: { error?: { code: string; message?: string }; rows?: unknown[]; columns?: string[]; done?: boolean };
        try { payload = JSON.parse(text) as typeof payload; }
        catch { throw new Error(`MCP_QUERY_BAD_RESPONSE: ${text.slice(0, 300)}`); }
        if (payload.error) throw new Error(`${payload.error.code}${payload.error.message ? `: ${payload.error.message}` : ""}`);
        const rows = (payload.rows ?? []) as Record<string, unknown>[];
        const columns = payload.columns ?? (rows.length > 0 ? Object.keys(rows[0]) : []);
        const values = rows.map((row) => columns.map((column) => row[column]));
        if (values.length > 0) yield { columns, rows: values };
        if (payload.done || values.length < batchSize) return;
      }
      throw new Error("EXPORT_ROW_LIMIT_EXCEEDED");
    },
    async close(): Promise<void> {
      if (client) { await client.close(); client = null; }
    },
  };
}
