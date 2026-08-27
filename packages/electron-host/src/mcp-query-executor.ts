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
 * Host-side adapter for the contract MySQL MCP server. The Electron main
 * process owns the MCP client, while the child MCP process owns all database
 * connections; the Runtime never connects to a business database directly.
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
    transport.onclose = () => console.error("[mcp-query-executor] transport closed");
    const next = new Client({ name: "data-agent-electron-query-executor", version: "1.0.0" });
    await next.connect(transport);
    client = next;
    return next;
  };

  const parseResult = (result: unknown): { text: string; isError: boolean } => {
    if (!result || typeof result !== "object") throw new Error("MCP_QUERY_EMPTY_RESPONSE");
    const content = (result as { content?: unknown }).content;
    const text = Array.isArray(content)
      ? content.find((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text") as { text?: unknown } | undefined
      : undefined;
    if (!text || typeof text.text !== "string") throw new Error("MCP_QUERY_EMPTY_RESPONSE");
    return { text: text.text, isError: Boolean((result as { isError?: unknown }).isError) };
  };

  return {
    async run(sql: string, rowLimit: number): Promise<McpQueryResult> {
      const effectiveLimit = Math.min(Math.max(1, Math.floor(rowLimit)), 200);
      const raw = await (await connect()).callTool({ name: "execute_query_preview", arguments: { sql, limit: effectiveLimit } });
      const result = parseResult(raw);
      if (result.isError) throw new Error(`MCP_TOOL_ERROR: ${result.text.slice(0, 300)}`);
      let payload: { error?: { code: string; message?: string }; rows?: unknown[]; truncated?: boolean };
      try { payload = JSON.parse(result.text) as typeof payload; }
      catch { throw new Error(`MCP_QUERY_BAD_RESPONSE: ${result.text.slice(0, 300)}`); }
      if (payload.error) throw new Error(`${payload.error.code}${payload.error.message ? `: ${payload.error.message}` : ""}`);
      const rows = (payload.rows ?? []) as Record<string, unknown>[];
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      return {
        columns,
        rows: rows.map((row) => columns.map((column) => row[column])),
        truncated: Boolean(payload.truncated),
      };
    },

    async *stream(sql: string, signal?: AbortSignal): AsyncGenerator<McpQueryExportBatch> {
      const client = await connect();
      const batchSize = 1000;
      for (let offset = 0; offset < 100000; offset += batchSize) {
        if (signal?.aborted) throw new Error("EXPORT_CANCELLED");
        const raw = await client.callTool({ name: "execute_query_export_batch", arguments: { sql, offset, limit: batchSize, maxRows: 100000 } });
        const result = parseResult(raw);
        if (result.isError) throw new Error(`MCP_TOOL_ERROR: ${result.text.slice(0, 300)}`);
        let payload: { error?: { code: string; message?: string }; rows?: unknown[]; columns?: string[]; done?: boolean };
        try { payload = JSON.parse(result.text) as typeof payload; }
        catch { throw new Error(`MCP_QUERY_BAD_RESPONSE: ${result.text.slice(0, 300)}`); }
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
      if (client) {
        const current = client;
        client = null;
        await current.close();
      }
    },
  };
}
