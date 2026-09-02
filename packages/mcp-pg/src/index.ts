import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { Pool } from "pg";

export const DATABASE_MCP_CONTRACT_VERSION = 1;
const DEFAULT_PREVIEW_LIMIT = 20;
const MAX_PREVIEW_LIMIT = 200;
const MAX_EXPORT_ROWS = 100_000;
const MAX_EXPORT_BATCH = 1_000;

export interface PgReferenceServerOptions {
  pool: Pool;
  maxPreviewRows?: number;
}

function redact(sql: string): string {
  return sql.replace(/'[^']*'/g, "'<REDACTED>'").slice(0, 200);
}

const FORBIDDEN = /\b(drop|truncate|delete|insert|update|alter|grant|revoke|call|replace|copy)\b/i;

export async function createPgReferenceServer(options: PgReferenceServerOptions) {
  const pool = options.pool;
  const maxRows = Math.min(options.maxPreviewRows ?? DEFAULT_PREVIEW_LIMIT, MAX_PREVIEW_LIMIT);

  const server = new McpServer({ name: "data-agent-pg-reference", version: "1.0.0" });

  server.tool(
    "execute_query_preview",
    "Run a read-only PostgreSQL query and return a bounded preview",
    {
      sql: z.string().min(1),
      limit: z.number().int().positive().max(MAX_PREVIEW_LIMIT).optional(),
    },
    async ({ sql, limit }) => {
      const trimmed = sql.trim().replace(/;+\s*$/, "");
      if (FORBIDDEN.test(trimmed)) {
        return { content: [{ type: "text", text: JSON.stringify({ error: { code: "FORBIDDEN_SQL" } }) }] };
      }
      const effectiveLimit = Math.min(limit ?? maxRows, maxRows);
      try {
        const result = await pool.query(`SELECT * FROM (${trimmed}) __preview LIMIT ${effectiveLimit + 1}`);
        return { content: [{ type: "text", text: JSON.stringify({ rows: result.rows.slice(0, effectiveLimit), columns: result.fields.map((field) => field.name), totalRows: result.rows.length, truncated: result.rows.length > effectiveLimit, serverLimit: maxRows, contractVersion: DATABASE_MCP_CONTRACT_VERSION }) }] };
      } catch (error) {
        return { content: [{ type: "text", text: JSON.stringify({ error: { code: "QUERY_FAILED", message: redact(`${(error as Error).message} in ${redact(trimmed)}`) } }) }] };
      }
    },
  );

  server.tool(
    "explain_query",
    "Compile a read-only PostgreSQL query and return its EXPLAIN plan",
    { sql: z.string().min(1) },
    async ({ sql }) => {
      const trimmed = sql.trim().replace(/;+\s*$/, "");
      if (FORBIDDEN.test(trimmed)) return { content: [{ type: "text", text: JSON.stringify({ error: { code: "FORBIDDEN_SQL" } }) }] };
      try {
        const result = await pool.query(`EXPLAIN ${trimmed}`);
        const columns = result.fields.map((field) => field.name);
        return { content: [{ type: "text", text: JSON.stringify({ columns, rows: result.rows, truncated: false, contractVersion: DATABASE_MCP_CONTRACT_VERSION }) }] };
      } catch (error) {
        return { content: [{ type: "text", text: JSON.stringify({ error: { code: "EXPLAIN_FAILED", message: redact(String((error as Error).message)).slice(0, 300) } }) }] };
      }
    },
  );

  server.tool(
    "execute_query_export_batch",
    "Run one bounded batch of a read-only PostgreSQL export",
    {
      sql: z.string().min(1),
      offset: z.number().int().nonnegative().max(MAX_EXPORT_ROWS).optional(),
      limit: z.number().int().positive().max(MAX_EXPORT_BATCH).optional(),
      maxRows: z.number().int().positive().max(MAX_EXPORT_ROWS).optional(),
    },
    async ({ sql, offset, limit, maxRows: requestedMaxRows }) => {
      const trimmed = sql.trim().replace(/;+\s*$/, "");
      if (FORBIDDEN.test(trimmed)) return { content: [{ type: "text", text: JSON.stringify({ error: { code: "FORBIDDEN_SQL" } }) }] };
      const start = offset ?? 0;
      const batchLimit = Math.min(limit ?? MAX_EXPORT_BATCH, MAX_EXPORT_BATCH);
      const rowLimit = Math.min(requestedMaxRows ?? MAX_EXPORT_ROWS, MAX_EXPORT_ROWS);
      if (start >= rowLimit) return { content: [{ type: "text", text: JSON.stringify({ rows: [], columns: [], done: true, contractVersion: DATABASE_MCP_CONTRACT_VERSION }) }] };
      try {
        const result = await pool.query(`SELECT * FROM (${trimmed}) __export LIMIT ${Math.min(batchLimit + 1, rowLimit - start + 1)} OFFSET ${start}`);
        const columns = result.fields.map((field) => field.name);
        const tooMany = result.rows.length > batchLimit && start + batchLimit >= rowLimit;
        if (tooMany) return { content: [{ type: "text", text: JSON.stringify({ error: { code: "EXPORT_ROW_LIMIT_EXCEEDED", rowLimit } }) }] };
        const rows = result.rows.slice(0, batchLimit);
        return { content: [{ type: "text", text: JSON.stringify({ rows, columns, done: rows.length < batchLimit, contractVersion: DATABASE_MCP_CONTRACT_VERSION }) }] };
      } catch (error) {
        return { content: [{ type: "text", text: JSON.stringify({ error: { code: "QUERY_FAILED", message: redact(`${(error as Error).message} in ${redact(trimmed)}`).slice(0, 500) } }) }] };
      }
    },
  );

  server.tool(
    "get_schema",
    "List tables and columns of the PostgreSQL database",
    {},
    async () => {
      const tables = await pool.query("SELECT table_name AS \"table\" FROM information_schema.tables WHERE table_schema='public'");
      const schema = [];
      for (const t of tables.rows as any[]) {
        const columns = await pool.query("SELECT column_name AS name, data_type AS \"dataType\" FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [t.table]);
        const constraints = await pool.query("SELECT tc.constraint_name AS \"constraintName\", tc.constraint_type AS \"constraintType\", kcu.column_name AS \"columnName\", ccu.table_name AS \"referencedTable\", ccu.column_name AS \"referencedColumn\", kcu.ordinal_position AS \"ordinalPosition\" FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_schema=kcu.constraint_schema AND tc.table_schema=kcu.table_schema AND tc.table_name=kcu.table_name AND tc.constraint_name=kcu.constraint_name LEFT JOIN information_schema.constraint_column_usage ccu ON tc.constraint_schema=ccu.constraint_schema AND tc.constraint_name=ccu.constraint_name WHERE tc.constraint_schema='public' AND tc.table_name=$1 ORDER BY kcu.constraint_name, kcu.ordinal_position", [t.table]);
        const rows = constraints.rows as Array<{ constraintName?: string; constraintType?: string; columnName?: string; referencedTable?: string; referencedColumn?: string }>;
        const primaryKey = rows.filter((row) => row.constraintType === "PRIMARY KEY" && row.columnName).map((row) => row.columnName!);
        const uniqueGroups = new Map<string, string[]>();
        for (const row of rows) if (row.constraintType === "UNIQUE" && row.constraintName && row.columnName) uniqueGroups.set(row.constraintName, [...(uniqueGroups.get(row.constraintName) ?? []), row.columnName]);
        const foreignGroups = new Map<string, { columns: string[]; references: { table: string; columns: string[] } }>();
        for (const row of rows) if (row.constraintType === "FOREIGN KEY" && row.constraintName && row.columnName && row.referencedTable && row.referencedColumn) {
          const existing = foreignGroups.get(row.constraintName) ?? { columns: [], references: { table: row.referencedTable, columns: [] } };
          existing.columns.push(row.columnName);
          existing.references.columns.push(row.referencedColumn);
          foreignGroups.set(row.constraintName, existing);
        }
        schema.push({ table: t.table, columns: columns.rows, ...(primaryKey.length ? { primaryKey } : {}), ...(uniqueGroups.size ? { uniqueKeys: [...uniqueGroups.values()] } : {}), ...(foreignGroups.size ? { foreignKeys: [...foreignGroups.values()] } : {}) });
      }
      return { content: [{ type: "text", text: JSON.stringify({ schema, contractVersion: DATABASE_MCP_CONTRACT_VERSION }) }] };
    },
  );

  async function close() { await pool.end(); }
  return { server, close, contractVersion: DATABASE_MCP_CONTRACT_VERSION };
}

export async function startPgReferenceStdio(pool: Pool): Promise<void> {
  const { server } = await createPgReferenceServer({ pool });
  await server.connect(new StdioServerTransport());
}
