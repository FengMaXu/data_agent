import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface McpQueryExecutorOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  dialect?: "sqlite" | "mysql" | "postgres" | "bigquery" | "snowflake";
  connectionId?: string;
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

export interface McpSchemaEvidence {
  connectionId: string;
  dialect: "sqlite" | "mysql" | "postgres" | "bigquery" | "snowflake";
  tables: Array<{
    name: string;
    columns: string[];
    primaryKey?: string[];
    uniqueKeys?: string[][];
    foreignKeys?: Array<{ columns: string[]; references: { table: string; columns: string[] } }>;
  }>;
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
      let payload: { error?: { code: string; message?: string }; columns?: string[]; rows?: unknown[]; truncated?: boolean };
      try { payload = JSON.parse(text) as typeof payload; }
      catch { throw new Error(`MCP_QUERY_BAD_RESPONSE: ${text.slice(0, 300)}`); }
      if (payload.error) throw new Error(`${payload.error.code}${payload.error.message ? `: ${payload.error.message}` : ""}`);
      const rows = (payload.rows ?? []) as Record<string, unknown>[];
      const columns = payload.columns ?? (rows.length > 0 ? Object.keys(rows[0]) : []);
      return {
        columns,
        rows: rows.map((row) => columns.map((col) => row[col])),
        truncated: Boolean(payload.truncated),
      };
    },
    async getCardinalityEvidence(sql: string, _schema?: McpSchemaEvidence, signal?: AbortSignal) {
      if (signal?.aborted) throw new Error("PROBE_CANCELLED");
      const tables = probeTableNames(sql);
      if (tables.length < 2 || !/\bJOIN\b/i.test(sql)) return [];
      const cleanSql = sql.replace(/;\s*$/, "");
      const boundedCount = async (query: string) => Number((await this.run(`SELECT COUNT(*) FROM (SELECT 1 FROM (${query}) AS _data_agent_count_source LIMIT 2000001) AS _data_agent_count`, 1)).rows[0]?.[0]);
      const counts = await Promise.all(tables.slice(0, 8).map(async (table) => [table, await boundedCount(`SELECT 1 FROM ${table}`)] as const));
      if (counts.some(([, count]) => !Number.isFinite(count) || count > 2_000_000)) return [];
      const joinedRows = await boundedCount(cleanSql);
      if (!Number.isFinite(joinedRows) || joinedRows > 2_000_000) return [];
      const snapshotId = createHash("sha256").update(cleanSql, "utf8").digest("hex").slice(0, 16);
      const maxSide = Math.max(...counts.map(([, count]) => count));
      if (joinedRows <= maxSide) return [];
      return [{
        left: tables[0],
        right: tables[1],
        status: "fanout" as const,
        fanoutFactor: maxSide > 0 ? joinedRows / maxSide : undefined,
        source: "observed_snapshot" as const,
        snapshotId,
        duplicatedSide: counts[0][1] <= counts[1][1] ? "left" as const : "right" as const,
      }];
    },
    async getProbeEvidence(sql: string, schema?: McpSchemaEvidence, signal?: AbortSignal) {
      const cardinalityEvidence = await this.getCardinalityEvidence(sql, schema, signal);
      let entityPopulation;
      if (schema) {
        const names = new Set(probeTableNames(sql));
        for (const fact of schema.tables) {
          if (!names.has(fact.name) || !fact.foreignKeys?.length) continue;
          const relation = fact.foreignKeys.find((foreignKey) => names.has(foreignKey.references.table) && foreignKey.columns.length === 1 && foreignKey.references.columns.length === 1);
          if (!relation) continue;
          const factColumn = relation.columns[0];
          const factCount = await this.run(`SELECT COUNT(DISTINCT ${factColumn}) FROM ${fact.name}`, 1);
          const entityCount = await this.run(`SELECT COUNT(*) FROM ${relation.references.table}`, 1);
          const factDistinct = Number(factCount.rows[0]?.[0]);
          const entityRows = Number(entityCount.rows[0]?.[0]);
          if (Number.isFinite(factDistinct) && Number.isFinite(entityRows) && factDistinct <= 2_000_000 && entityRows <= 2_000_000) {
            entityPopulation = { factDistinct, entityRows, factRelation: fact.name, entityRelation: relation.references.table };
          }
          break;
        }
      }
      return { cardinalityEvidence, ...(entityPopulation ? { entityPopulation } : {}) };
    },
    async explain(sql: string): Promise<McpQueryResult> {
      const c = await connect();
      const result = await c.callTool({ name: "explain_query", arguments: { sql } }) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
      const text = result.content?.find((part) => part.type === "text")?.text;
      if (!text) throw new Error("MCP_EXPLAIN_EMPTY_RESPONSE");
      if (result.isError) throw new Error(`MCP_TOOL_ERROR: ${text.slice(0, 300)}`);
      let payload: { error?: { code: string; message?: string }; columns?: string[]; rows?: unknown[]; truncated?: boolean };
      try { payload = JSON.parse(text) as typeof payload; }
      catch { throw new Error(`MCP_EXPLAIN_BAD_RESPONSE: ${text.slice(0, 300)}`); }
      if (payload.error) throw new Error(`${payload.error.code}${payload.error.message ? `: ${payload.error.message}` : ""}`);
      const rows = (payload.rows ?? []) as Record<string, unknown>[];
      const columns = payload.columns ?? (rows.length > 0 ? Object.keys(rows[0]) : []);
      return { columns, rows: rows.map((row) => columns.map((column) => row[column])), truncated: Boolean(payload.truncated) };
    },
    async getSchema(): Promise<McpSchemaEvidence> {
      const c = await connect();
      const result = await c.callTool({ name: "get_schema", arguments: {} }) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
      const text = result.content?.find((part) => part.type === "text")?.text;
      if (!text) throw new Error("MCP_SCHEMA_EMPTY_RESPONSE");
      if (result.isError) throw new Error(`MCP_TOOL_ERROR: ${text.slice(0, 300)}`);
      let payload: { schema?: Array<{ table?: unknown; columns?: Array<{ name?: unknown; type?: unknown }>; primaryKey?: unknown; uniqueKeys?: unknown; foreignKeys?: unknown }> };
      try { payload = JSON.parse(text) as typeof payload; }
      catch { throw new Error(`MCP_SCHEMA_BAD_RESPONSE: ${text.slice(0, 300)}`); }
      return {
        connectionId: options.connectionId ?? `${options.dialect ?? "mysql"}:${String(options.env?.DATA_AGENT_MYSQL_DATABASE ?? "configured")}`,
        dialect: options.dialect ?? "mysql",
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
      const c = await connect();
      const batchSize = 1000;
      let previousColumns: string[] | undefined;
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
        const reportedColumns = payload.columns?.length ? payload.columns : rows.length > 0 ? Object.keys(rows[0]) : [];
        if (previousColumns && reportedColumns.length === 0 && rows.length === 0 && payload.done) return;
        const columns = reportedColumns.length > 0 ? reportedColumns : previousColumns ?? [];
        const values = rows.map((row) => columns.map((column) => row[column]));
        // Preserve an empty first batch with its column metadata so an empty
        // result still produces a header-only CSV, but suppress the terminal
        // schema-less batch some MCP servers emit at an exact boundary.
        if (columns.length > 0) previousColumns = [...columns];
        yield { columns, rows: values };
        if (payload.done || values.length < batchSize) return;
      }
      throw new Error("EXPORT_ROW_LIMIT_EXCEEDED");
    },
    async close(): Promise<void> {
      if (client) { await client.close(); client = null; }
    },
  };
}
