import { createHash } from "node:crypto";
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

function probeTableNames(sql: string): string[] {
  const names: string[] = [];
  for (const match of sql.matchAll(/\b(?:FROM|JOIN)\s+([`\"\w.]+)/gi)) {
    const name = match[1].replace(/[`\"]/g, "");
    if (/^[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)?$/.test(name)) names.push(name);
  }
  return [...new Set(names)];
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
    },

    async getCardinalityEvidence(sql: string, _schema?: unknown, signal?: AbortSignal) {
      if (signal?.aborted) throw new Error("PROBE_CANCELLED");
      const tables = probeTableNames(sql);
      if (tables.length < 2 || !/\bJOIN\b/i.test(sql)) return [];
      const cleanSql = sql.replace(/;\s*$/, "");
      const boundedCount = async (query: string) => Number((await this.run(`SELECT COUNT(*) FROM (SELECT 1 FROM (${query}) AS _data_agent_count_source LIMIT 2000001) AS _data_agent_count`, 1)).rows[0]?.[0]);
      const counts = await Promise.all(tables.slice(0, 8).map(async (table) => [table, await boundedCount(`SELECT 1 FROM ${table}`)] as const));
      if (counts.some(([, count]) => !Number.isFinite(count) || count > 2_000_000)) return [];
      const joinedRows = await boundedCount(cleanSql);
      if (!Number.isFinite(joinedRows) || joinedRows > 2_000_000) return [];
      const maxSide = Math.max(...counts.map(([, count]) => count));
      if (joinedRows <= maxSide) return [];
      return [{ left: tables[0], right: tables[1], status: "fanout" as const, fanoutFactor: maxSide > 0 ? joinedRows / maxSide : undefined, source: "observed_snapshot" as const, snapshotId: createHash("sha256").update(cleanSql, "utf8").digest("hex").slice(0, 16) }];
    },

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

    async *stream(sql: string, signal?: AbortSignal): AsyncGenerator<McpQueryExportBatch> {
      const client = await connect();
      const batchSize = 1000;
      let previousColumns: string[] | undefined;
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
        const reportedColumns = payload.columns?.length ? payload.columns : rows.length > 0 ? Object.keys(rows[0]) : [];
        if (previousColumns && reportedColumns.length === 0 && rows.length === 0 && payload.done) return;
        const columns = reportedColumns.length > 0 ? reportedColumns : previousColumns ?? [];
        const values = rows.map((row) => columns.map((column) => row[column]));
        // Preserve an empty first batch with column metadata for header-only
        // CSV publication, but do not expose a terminal empty batch without
        // columns after a complete batch boundary.
        if (columns.length > 0) previousColumns = [...columns];
        yield { columns, rows: values };
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
