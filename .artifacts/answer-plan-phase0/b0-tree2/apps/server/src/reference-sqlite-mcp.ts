import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { SqlGuard } from "@data-agent/runtime";

const DATABASE_MCP_CONTRACT_VERSION = 1;
const DEFAULT_PREVIEW_LIMIT = 20;
const MAX_PREVIEW_LIMIT = 200;
export interface ReferenceSqliteServerOptions { databasePath: string; maxPreviewRows?: number }

function forbiddenSql(reason: string) {
  const message = `${reason}. Only read-only SELECT/WITH queries are supported; rewrite the request without write operations or multiple statements.`;
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: { code: "FORBIDDEN_SQL", message } }) }] };
}

export function createReferenceSqliteServer(options: ReferenceSqliteServerOptions) {
  const require_ = createRequire(import.meta.url);
  const Database = require_("better-sqlite3");
  const db = new (Database as any)(options.databasePath, { readonly: false });
  const maxRows = Math.min(options.maxPreviewRows ?? DEFAULT_PREVIEW_LIMIT, MAX_PREVIEW_LIMIT);

  const server = new McpServer(
    { name: "data-agent-sqlite-reference", version: "1.0.0" },
    { capabilities: { resources: {} } },
  );

  const previewShape = { sql: z.string().min(1), limit: z.number().int().positive().max(MAX_PREVIEW_LIMIT).optional() };
  server.tool(
    "execute_query_preview",
    "Run a read-only SQLite query and return a bounded preview",
    previewShape,
    async ({ sql, limit }) => {
      const trimmed = sql.trim().replace(/;+\s*$/, "");
      const guard = new SqlGuard().check(trimmed);
      if (!guard.allowed) return forbiddenSql(guard.reason);
      if (!/^(?:SELECT|WITH)\b/i.test(trimmed)) return forbiddenSql("Only SELECT/WITH statements are supported");
      const effectiveLimit = Math.min(limit ?? maxRows, maxRows);
      const statement = db.prepare(`SELECT * FROM (${trimmed}) __preview LIMIT ?`);
      const columns: string[] = statement.columns().map((column: { name: string }) => column.name);
      const rows = statement.all(effectiveLimit + 1) as any[];
      const truncated = rows.length > effectiveLimit;
      return { content: [{ type: "text", text: JSON.stringify({ columns, rows: rows.slice(0, effectiveLimit), totalRows: rows.length, truncated, serverLimit: maxRows, contractVersion: DATABASE_MCP_CONTRACT_VERSION }) }] };
    },
  );

  server.tool(
    "execute_query_export_batch",
    "Run one bounded batch of a read-only SQLite export",
    { sql: z.string().min(1), offset: z.number().int().nonnegative().max(100000).optional(), limit: z.number().int().positive().max(1000).optional(), maxRows: z.number().int().positive().max(100000).optional() },
    async ({ sql, offset, limit, maxRows: requestedMaxRows }) => {
      const trimmed = sql.trim().replace(/;+\s*$/, "");
      const guard = new SqlGuard().check(trimmed);
      if (!guard.allowed) return forbiddenSql(guard.reason);
      if (!/^(?:SELECT|WITH)\b/i.test(trimmed)) return forbiddenSql("Only SELECT/WITH statements are supported");
      const start = offset ?? 0;
      const batchLimit = Math.min(limit ?? 1000, 1000);
      const rowLimit = Math.min(requestedMaxRows ?? 100000, 100000);
      if (start >= rowLimit) return { content: [{ type: "text", text: JSON.stringify({ rows: [], columns: [], done: true, contractVersion: DATABASE_MCP_CONTRACT_VERSION }) }] };
      const statement = db.prepare(`SELECT * FROM (${trimmed}) __export LIMIT ? OFFSET ?`);
      const columns: string[] = statement.columns().map((column: { name: string }) => column.name);
      const rows = statement.all(Math.min(batchLimit + 1, rowLimit - start + 1), start) as Record<string, unknown>[];
      if (rows.length > batchLimit && start + batchLimit >= rowLimit) return { content: [{ type: "text", text: JSON.stringify({ error: { code: "EXPORT_ROW_LIMIT_EXCEEDED", rowLimit } }) }] };
      const values = rows.slice(0, batchLimit);
      return { content: [{ type: "text", text: JSON.stringify({ rows: values, columns, done: values.length < batchLimit, contractVersion: DATABASE_MCP_CONTRACT_VERSION }) }] };
    },
  );

  server.tool(
    "explain_query",
    "Compile a read-only SQLite query and return its EXPLAIN QUERY PLAN",
    { sql: z.string().min(1) },
    async ({ sql }) => {
      const trimmed = sql.trim().replace(/;+\s*$/, "");
      const guard = new SqlGuard().check(trimmed);
      if (!guard.allowed) return forbiddenSql(guard.reason);
      try {
        const statement = db.prepare(`EXPLAIN QUERY PLAN ${trimmed}`);
        const columns: string[] = statement.columns().map((column: { name: string }) => column.name);
        const rows = statement.all() as Record<string, unknown>[];
        return { content: [{ type: "text", text: JSON.stringify({ columns, rows, truncated: false, contractVersion: DATABASE_MCP_CONTRACT_VERSION }) }] };
      } catch (error) {
        return { content: [{ type: "text", text: JSON.stringify({ error: { code: "EXPLAIN_FAILED", message: String((error as Error).message).slice(0, 300) } }) }] };
      }
    },
  );

  server.tool(
    "get_schema",
    "List tables and columns of the reference SQLite database",
    {},
    async () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      const schema = tables.map((t: any) => {
        const quoted = JSON.stringify(t.name).slice(1, -1);
        const columns = db.prepare(`PRAGMA table_info(${quoted})`).all() as Array<{ name: string; type?: string; pk?: number }>;
        const primaryKey = columns.filter((column) => Number(column.pk) > 0).sort((left, right) => Number(left.pk) - Number(right.pk)).map((column) => column.name);
        const indexes = db.prepare(`PRAGMA index_list(${quoted})`).all() as Array<{ name: string; unique?: number }>;
        const uniqueKeys = indexes.filter((index) => Number(index.unique) === 1).flatMap((index) => {
          const entries = db.prepare(`PRAGMA index_info(${JSON.stringify(index.name).slice(1, -1)})`).all() as Array<{ name?: string; seqno?: number }>;
          return [entries.sort((left, right) => Number(left.seqno) - Number(right.seqno)).flatMap((entry) => entry.name ? [entry.name] : [])];
        }).filter((key) => key.length > 0);
        const foreignRows = db.prepare(`PRAGMA foreign_key_list(${quoted})`).all() as Array<{ id?: number; seq?: number; from?: string; table?: string; to?: string }>;
        const foreignKeys = [...new Set(foreignRows.map((row) => row.id).filter((id): id is number => id !== undefined))].flatMap((id) => {
          const rows = foreignRows.filter((row) => row.id === id).sort((left, right) => Number(left.seq) - Number(right.seq));
          const first = rows[0];
          if (!first?.table) return [];
          return [{ columns: rows.flatMap((row) => row.from ? [row.from] : []), references: { table: first.table, columns: rows.flatMap((row) => row.to ? [row.to] : []) } }];
        });
        return { table: t.name, columns, ...(primaryKey.length ? { primaryKey } : {}), ...(uniqueKeys.length ? { uniqueKeys } : {}), ...(foreignKeys.length ? { foreignKeys } : {}) };
      });
      return { content: [{ type: "text", text: JSON.stringify({ schema, contractVersion: DATABASE_MCP_CONTRACT_VERSION }) }] };
    },
  );

  // The database MCP server deliberately has no raw export_query(sql) tool.
  // Full publication is owned by the Query Assurance Runtime, which binds a
  // Query Artifact, Candidate, Review Outcome and Publication Receipt.
  return { server, db, close: () => db.close(), contractVersion: DATABASE_MCP_CONTRACT_VERSION, maxRows };
}

export async function startReferenceSqliteStdio(options: ReferenceSqliteServerOptions): Promise<void> {
  const { server } = createReferenceSqliteServer(options);
  await server.connect(new StdioServerTransport());
}

const invokedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href : false;
if (invokedDirectly) {
  const dbArg = process.argv[2];
  if (!dbArg) { console.error("usage: reference-sqlite-mcp <database-path>"); process.exit(2); }
  void startReferenceSqliteStdio({ databasePath: path.resolve(dbArg) });
}
