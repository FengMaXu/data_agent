import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface McpQueryExecutorOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Explicit local-test capability; callers must provide server-side scoped enforcement before using it in production. */
  scopedExploration?: { readonly scopeId: string; readonly connectionId: string };
}

export interface McpQueryResult {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
}

export interface McpQueryExecutionOptions {
  readonly kind?: "exploration" | "result";
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
  readonly deadlineAt?: number;
  readonly maxPreviewBytes?: number;
  readonly scope?: { readonly scopeId: string; readonly connectionId: string };
}

/**
 * Host-side adapter for the contract MySQL MCP server. The Electron main
 * process owns the MCP client, while the child MCP process owns all database
 * connections; the Runtime never connects to a business database directly.
 */
export function createMcpQueryExecutor(options: McpQueryExecutorOptions) {
  let client: Client | null = null;
  let activeTransport: StdioClientTransport | null = null;
  const connect = async (): Promise<Client> => {
    if (client) return client;
    const transport = new StdioClientTransport({
      command: options.command,
      args: options.args ?? [],
      env: options.env ? { ...options.env } : undefined,
    });
    activeTransport = transport;
    transport.onclose = () => {
      if (activeTransport === transport) activeTransport = null;
      client = null;
      console.error("[mcp-query-executor] transport closed");
    };
    transport.onerror = (error) => console.error("[mcp-query-executor] transport error:", error.message);
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

  const resetConnection = async (): Promise<void> => {
    const transport = activeTransport;
    client = null;
    activeTransport = null;
    await transport?.close().catch(() => undefined);
  };
  const run = async (sql: string, rowLimit: number, execution?: McpQueryExecutionOptions): Promise<McpQueryResult> => {
      if (execution?.signal?.aborted) throw new Error("QUERY_CANCELLED");
      const finalResult = execution?.kind === "result";
      const effectiveLimit = Math.min(Math.max(1, Math.floor(rowLimit)), finalResult ? 100000 : 10000);
      const remaining = execution?.deadlineAt ? Math.max(1, execution.deadlineAt - Date.now()) : undefined;
      let raw;
      try {
        raw = await (await connect()).callTool({
          name: finalResult ? "execute_query_export" : "execute_query_preview",
          arguments: finalResult
            ? { sql, maxRows: effectiveLimit }
            : { sql, limit: effectiveLimit, ...(execution?.maxPreviewBytes ? { maxBytes: execution.maxPreviewBytes } : {}) },
        }, undefined, {
          timeout: Math.max(1, Math.floor(Math.min(60_000, remaining ?? Number.POSITIVE_INFINITY))),
          ...(execution?.signal ? { signal: execution.signal } : {}),
        });
      } catch (error) {
        if (execution?.signal?.aborted || /timed out|timeout|AbortError|RequestTimeout/i.test(error instanceof Error ? error.message : String(error))) await resetConnection();
        throw error;
      }
      const result = parseResult(raw);
      if (result.isError) throw new Error(`MCP_TOOL_ERROR: ${result.text.slice(0, 300)}`);
      let payload: { error?: { code: string; message?: string }; columns?: string[]; rows?: unknown[]; truncated?: boolean };
      try { payload = JSON.parse(result.text) as typeof payload; }
      catch { throw new Error(`MCP_QUERY_BAD_RESPONSE: ${result.text.slice(0, 300)}`); }
      if (payload.error) throw new Error(`${payload.error.code}${payload.error.message ? `: ${payload.error.message}` : ""}`);
      const rows = (payload.rows ?? []) as Record<string, unknown>[];
      const columns = payload.columns ?? (rows.length > 0 ? Object.keys(rows[0]) : []);
      return {
        columns,
        rows: rows.map((row) => columns.map((column) => row[column])),
        truncated: Boolean(payload.truncated),
      };
    };
  const scopedExploration = options.scopedExploration ? {
    scope: options.scopedExploration,
    run: (sql: string, rowLimit: number, execution: McpQueryExecutionOptions) => run(sql, rowLimit, { ...execution, kind: "exploration", scope: options.scopedExploration }),
  } : undefined;
  return {
    dialect: "mysql" as const,
    run,
    ...(scopedExploration ? { scopedExploration } : {}),
    async explain(sql: string, signal?: AbortSignal): Promise<McpQueryResult> {
      if (signal?.aborted) throw new Error("EXPORT_CANCELLED");
      const result = parseResult(await (await connect()).callTool({ name: "explain_query", arguments: { sql } }));
      if (result.isError) throw new Error(`MCP_TOOL_ERROR: ${result.text.slice(0, 300)}`);
      let payload: { error?: { code: string; message?: string }; columns?: string[]; rows?: unknown[]; truncated?: boolean };
      try { payload = JSON.parse(result.text) as typeof payload; }
      catch { throw new Error(`MCP_EXPLAIN_BAD_RESPONSE: ${result.text.slice(0, 300)}`); }
      if (payload.error) throw new Error(`${payload.error.code}${payload.error.message ? `: ${payload.error.message}` : ""}`);
      const rows = (payload.rows ?? []) as Record<string, unknown>[];
      const columns = payload.columns ?? (rows.length > 0 ? Object.keys(rows[0]) : []);
      return { columns, rows: rows.map((row) => columns.map((column) => row[column])), truncated: Boolean(payload.truncated) };
    },

    async getSchema(): Promise<{ connectionId: string; dialect: "mysql"; tables: Array<{ name: string; columns: string[]; primaryKey?: string[]; uniqueKeys?: string[][]; foreignKeys?: Array<{ columns: string[]; references: { table: string; columns: string[] } }> }> }> {
      const result = parseResult(await (await connect()).callTool({ name: "get_schema", arguments: {} }));
      if (result.isError) throw new Error(`MCP_TOOL_ERROR: ${result.text.slice(0, 300)}`);
      let payload: { schema?: Array<{ table?: unknown; columns?: Array<{ name?: unknown }>; primaryKey?: unknown; uniqueKeys?: unknown; foreignKeys?: unknown }> };
      try { payload = JSON.parse(result.text) as typeof payload; }
      catch { throw new Error(`MCP_SCHEMA_BAD_RESPONSE: ${result.text.slice(0, 300)}`); }
      return {
        connectionId: `mysql:${String(options.env?.DATA_AGENT_MYSQL_DATABASE ?? "configured")}`,
        dialect: "mysql",
        tables: (payload.schema ?? []).flatMap((table) => typeof table.table === "string" ? [{
          name: table.table,
          columns: (table.columns ?? []).flatMap((column) => typeof column.name === "string" ? [column.name] : []),
          ...(Array.isArray(table.primaryKey) ? { primaryKey: table.primaryKey.filter((column): column is string => typeof column === "string") } : {}),
          ...(Array.isArray(table.uniqueKeys) ? { uniqueKeys: table.uniqueKeys.filter((key): key is string[] => Array.isArray(key) && key.every((column) => typeof column === "string")) } : {}),
          ...(Array.isArray(table.foreignKeys) ? { foreignKeys: table.foreignKeys.filter((key): key is { columns: string[]; references: { table: string; columns: string[] } } => Boolean(key && typeof key === "object" && Array.isArray((key as any).columns) && (key as any).references && typeof (key as any).references.table === "string" && Array.isArray((key as any).references.columns))).map((key) => ({ columns: key.columns, references: key.references })) } : {}),
        }] : []),
      };
    },

    resetConnection,
    async close(): Promise<void> {
      await resetConnection();
    },
  };
}
