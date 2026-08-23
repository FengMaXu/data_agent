import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { Pool } from "pg";

export const DATABASE_MCP_CONTRACT_VERSION = 1;
const DEFAULT_PREVIEW_LIMIT = 20;
const MAX_PREVIEW_LIMIT = 200;

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
        return { content: [{ type: "text", text: JSON.stringify({ rows: result.rows.slice(0, effectiveLimit), totalRows: result.rows.length, truncated: result.rows.length > effectiveLimit, serverLimit: maxRows, contractVersion: DATABASE_MCP_CONTRACT_VERSION }) }] };
      } catch (error) {
        return { content: [{ type: "text", text: JSON.stringify({ error: { code: "QUERY_FAILED", message: redact(`${(error as Error).message} in ${redact(trimmed)}`) } }) }] };
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
        const columns = await pool.query("SELECT column_name AS name, data_type AS \"dataType\" FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [t.table]);
        schema.push({ table: t.table, columns: columns.rows });
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
