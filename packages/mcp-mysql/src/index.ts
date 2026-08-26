import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import mysql from "mysql2/promise";
import type { Pool } from "mysql2/promise";

export const DATABASE_MCP_CONTRACT_VERSION = 1;
const DEFAULT_PREVIEW_LIMIT = 20;
const MAX_PREVIEW_LIMIT = 200;

export interface MysqlReferenceServerOptions {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}

/** Credentials come from the environment or an explicitly provided config owned by the MCP Server process. */
export function credentialsFromEnv(): MysqlReferenceServerOptions {
  return {
    host: process.env.DATA_AGENT_MYSQL_HOST ?? "127.0.0.1",
    port: Number(process.env.DATA_AGENT_MYSQL_PORT ?? 3306),
    user: process.env.DATA_AGENT_MYSQL_USER ?? "root",
    password: process.env.DATA_AGENT_MYSQL_PASSWORD,
    database: process.env.DATA_AGENT_MYSQL_DATABASE,
  };
}

function redact(sql: string): string {
  return sql.replace(/'[^']*'/g, "'<REDACTED>'").slice(0, 200);
}

const FORBIDDEN = /\b(drop|truncate|delete|insert|update|alter|grant|revoke|call|replace|load_file|into\s+outfile)\b/i;

export async function createMysqlReferenceServer(options: MysqlReferenceServerOptions) {
  const pool: Pool = mysql.createPool({
    host: options.host, port: options.port, user: options.user, password: options.password,
    database: options.database, connectionLimit: 3, enableKeepAlive: true,
  });

  const server = new McpServer({ name: "data-agent-mysql-reference", version: "1.0.0" });

  server.tool(
    "execute_query_preview",
    "Run a read-only MySQL query and return a bounded preview",
    {
      sql: z.string().min(1),
      limit: z.number().int().positive().max(MAX_PREVIEW_LIMIT).optional(),
    },
    async ({ sql, limit }) => {
      const trimmed = sql.trim().replace(/;+\s*$/, "");
      if (FORBIDDEN.test(trimmed)) {
        return { content: [{ type: "text", text: JSON.stringify({ error: { code: "FORBIDDEN_SQL" } }) }] };
      }
      const effectiveLimit = Math.min(limit ?? maxRows(), maxRows());
      // MySQL does not allow SHOW/DESCRIBE statements inside a derived table.
      // Execute these read-only introspection statements directly while keeping
      // the response preview shape and bound used for ordinary SELECT queries.
      const isIntrospectionQuery = /^(?:show|describe|desc)\b/i.test(trimmed);
      try {
        const query = isIntrospectionQuery
          ? trimmed
          : `SELECT * FROM (${trimmed}) __preview LIMIT ${effectiveLimit + 1}`;
        const [rows] = await pool.query(query);
        const list = rows as any[];
        return { content: [{ type: "text", text: JSON.stringify({ rows: list.slice(0, effectiveLimit), totalRows: list.length, truncated: list.length > effectiveLimit, serverLimit: maxRows(), contractVersion: DATABASE_MCP_CONTRACT_VERSION }) }] };
      } catch (error) {
        return { content: [{ type: "text", text: JSON.stringify({ error: { code: "QUERY_FAILED", message: redact(`${(error as Error).message} in ${redact(trimmed)}`).slice(0, 500) } }) }] };
      }
    },
  );

  function maxRows() { return DEFAULT_PREVIEW_LIMIT; }

  server.tool(
    "execute_query_export_batch",
    "Run one bounded batch of a read-only MySQL export",
    {
      sql: z.string().min(1),
      offset: z.number().int().nonnegative().max(100000).optional(),
      limit: z.number().int().positive().max(1000).optional(),
      maxRows: z.number().int().positive().max(100000).optional(),
    },
    async ({ sql, offset, limit, maxRows: requestedMaxRows }) => {
      const trimmed = sql.trim().replace(/;+\s*$/, "");
      if (FORBIDDEN.test(trimmed)) return { content: [{ type: "text", text: JSON.stringify({ error: { code: "FORBIDDEN_SQL" } }) }] };
      const start = offset ?? 0;
      const batchLimit = Math.min(limit ?? 1000, 1000);
      const rowLimit = Math.min(requestedMaxRows ?? 100000, 100000);
      if (start >= rowLimit) return { content: [{ type: "text", text: JSON.stringify({ rows: [], columns: [], done: true, contractVersion: DATABASE_MCP_CONTRACT_VERSION }) }] };
      try {
        const [rows] = await pool.query(`SELECT * FROM (${trimmed}) __export LIMIT ${Math.min(batchLimit + 1, rowLimit - start + 1)} OFFSET ${start}`);
        const list = rows as Record<string, unknown>[];
        const columns = list.length > 0 ? Object.keys(list[0]) : [];
        const tooMany = list.length > batchLimit && start + batchLimit >= rowLimit;
        if (tooMany) return { content: [{ type: "text", text: JSON.stringify({ error: { code: "EXPORT_ROW_LIMIT_EXCEEDED", rowLimit } }) }] };
        const values = list.slice(0, batchLimit);
        return { content: [{ type: "text", text: JSON.stringify({ rows: values, columns, done: values.length < batchLimit, contractVersion: DATABASE_MCP_CONTRACT_VERSION }) }] };
      } catch (error) {
        return { content: [{ type: "text", text: JSON.stringify({ error: { code: "QUERY_FAILED", message: redact(`${(error as Error).message} in ${redact(trimmed)}`).slice(0, 500) } }) }] };
      }
    },
  );

  server.tool(
    "get_schema",
    "List tables and columns of the MySQL database",
    {},
    async () => {
      const [tables] = await pool.query("SELECT table_name AS `table` FROM information_schema.tables WHERE table_schema = DATABASE()");
      const schema = [];
      for (const t of tables as any[]) {
        const [columns] = await pool.query("SELECT column_name AS name, data_type AS dataType FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?", [t.table]);
        schema.push({ table: t.table, columns });
      }
      return { content: [{ type: "text", text: JSON.stringify({ schema, contractVersion: DATABASE_MCP_CONTRACT_VERSION }) }] };
    },
  );

  async function close() { await pool.end(); }
  return { server, close, contractVersion: DATABASE_MCP_CONTRACT_VERSION };
}

import { z } from "zod";

export async function startMysqlReferenceStdio(options?: MysqlReferenceServerOptions): Promise<void> {
  const { server } = await createMysqlReferenceServer(options ?? credentialsFromEnv());
  await server.connect(new StdioServerTransport());
}
