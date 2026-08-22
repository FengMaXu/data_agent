import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRequire } from "node:module";

const DATABASE_MCP_CONTRACT_VERSION = 1;
const DEFAULT_PREVIEW_LIMIT = 20;
const MAX_PREVIEW_LIMIT = 200;
const FORBIDDEN = /\b(drop|truncate|delete|insert|update|alter|create|grant|revoke|call|replace)\b/i;

export interface ReferenceSqliteServerOptions { databasePath: string; maxPreviewRows?: number }

export function createReferenceSqliteServer(options: ReferenceSqliteServerOptions) {
  const require_ = createRequire(import.meta.url);
  const Database = require_("better-sqlite3");
  const db = new (Database as any)(options.databasePath, { readonly: false });
  const maxRows = Math.min(options.maxPreviewRows ?? DEFAULT_PREVIEW_LIMIT, MAX_PREVIEW_LIMIT);

  const server = new McpServer({ name: "data-agent-sqlite-reference", version: "1.0.0" });

  const previewShape = { sql: z.string().min(1), limit: z.number().int().positive().max(MAX_PREVIEW_LIMIT).optional() };
  server.tool(
    "execute_query_preview",
    "Run a read-only SQLite query and return a bounded preview",
    previewShape,
    async ({ sql, limit }) => {
      const trimmed = sql.trim().replace(/;+\s*$/, "");
      if (FORBIDDEN.test(trimmed)) return { content: [{ type: "text", text: JSON.stringify({ error: { code: "FORBIDDEN_SQL" } }) }] };
      const effectiveLimit = Math.min(limit ?? maxRows, maxRows);
      const rows = (db.prepare(`SELECT * FROM (${trimmed}) __preview LIMIT ?`).all(effectiveLimit + 1)) as any[];
      const truncated = rows.length > effectiveLimit;
      return { content: [{ type: "text", text: JSON.stringify({ rows: rows.slice(0, effectiveLimit), totalRows: rows.length, truncated, serverLimit: maxRows, contractVersion: DATABASE_MCP_CONTRACT_VERSION }) }] };
    },
  );

  server.tool(
    "get_schema",
    "List tables and columns of the reference SQLite database",
    {},
    async () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      const schema = tables.map((t: any) => ({ table: t.name, columns: db.prepare(`PRAGMA table_info(${JSON.stringify(t.name).slice(1, -1)})`).all() }));
      return { content: [{ type: "text", text: JSON.stringify({ schema, contractVersion: DATABASE_MCP_CONTRACT_VERSION }) }] };
    },
  );

  return { server, db, close: () => db.close(), contractVersion: DATABASE_MCP_CONTRACT_VERSION, maxRows };
}

export async function startReferenceSqliteStdio(options: ReferenceSqliteServerOptions): Promise<void> {
  const { server } = createReferenceSqliteServer(options);
  await server.connect(new StdioServerTransport());
}
