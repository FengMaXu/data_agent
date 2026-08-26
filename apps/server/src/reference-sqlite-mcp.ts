import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { ReadResourceRequestSchema, ListResourcesRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { SqlGuard } from "@data-agent/runtime";

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
      if (!new SqlGuard().check(trimmed).allowed) return { content: [{ type: "text", text: JSON.stringify({ error: { code: "FORBIDDEN_SQL" } }) }] };
      const effectiveLimit = Math.min(limit ?? maxRows, maxRows);
      const rows = (db.prepare(`SELECT * FROM (${trimmed}) __preview LIMIT ?`).all(effectiveLimit + 1)) as any[];
      const truncated = rows.length > effectiveLimit;
      return { content: [{ type: "text", text: JSON.stringify({ rows: rows.slice(0, effectiveLimit), totalRows: rows.length, truncated, serverLimit: maxRows, contractVersion: DATABASE_MCP_CONTRACT_VERSION }) }] };
    },
  );

  server.tool(
    "execute_query_export_batch",
    "Run one bounded batch of a read-only SQLite export",
    { sql: z.string().min(1), offset: z.number().int().nonnegative().max(100000).optional(), limit: z.number().int().positive().max(1000).optional(), maxRows: z.number().int().positive().max(100000).optional() },
    async ({ sql, offset, limit, maxRows: requestedMaxRows }) => {
      const trimmed = sql.trim().replace(/;+\s*$/, "");
      if (!new SqlGuard().check(trimmed).allowed) return { content: [{ type: "text", text: JSON.stringify({ error: { code: "FORBIDDEN_SQL" } }) }] };
      const start = offset ?? 0;
      const batchLimit = Math.min(limit ?? 1000, 1000);
      const rowLimit = Math.min(requestedMaxRows ?? 100000, 100000);
      if (start >= rowLimit) return { content: [{ type: "text", text: JSON.stringify({ rows: [], columns: [], done: true, contractVersion: DATABASE_MCP_CONTRACT_VERSION }) }] };
      const rows = db.prepare(`SELECT * FROM (${trimmed}) __export LIMIT ? OFFSET ?`).all(Math.min(batchLimit + 1, rowLimit - start + 1), start) as Record<string, unknown>[];
      if (rows.length > batchLimit && start + batchLimit >= rowLimit) return { content: [{ type: "text", text: JSON.stringify({ error: { code: "EXPORT_ROW_LIMIT_EXCEEDED", rowLimit } }) }] };
      const values = rows.slice(0, batchLimit);
      const columns = values.length > 0 ? Object.keys(values[0]) : [];
      return { content: [{ type: "text", text: JSON.stringify({ rows: values, columns, done: values.length < batchLimit, contractVersion: DATABASE_MCP_CONTRACT_VERSION }) }] };
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

  const exports_ = new Map<string, { uri: string; name: string; mimeType: string; blob: Buffer }>();

  server.tool(
    "export_query",
    "Run a read-only SQLite query and register the full result as a CSV Resource",
    { sql: z.string().min(1), maxRows: z.number().int().positive().max(100000).optional() },
    async ({ sql, maxRows: rowLimitArg }) => {
      const trimmed = sql.trim().replace(/;+\s*$/, "");
      if (!new SqlGuard().check(trimmed).allowed) return { content: [{ type: "text", text: JSON.stringify({ error: { code: "FORBIDDEN_SQL" } }) }] };
      const rowLimit = Math.min(rowLimitArg ?? 100000, 100000);
      const rows = db.prepare(`SELECT * FROM (${trimmed}) __export LIMIT ?`).all(rowLimit + 1) as any[];
      if (rows.length > rowLimit) return { content: [{ type: "text", text: JSON.stringify({ error: { code: "EXPORT_ROW_LIMIT_EXCEEDED", rowLimit } }) }] };
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      const escape = (value: unknown) => {
        const text = value === null || value === undefined ? "" : String(value);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      const csv = [columns.join(","), ...rows.map(row => columns.map(c => escape(row[c])).join(","))].join("\n");
      const resourceId = randomUUID();
      exports_.set(resourceId, { uri: `sqlite://exports/${resourceId}.csv`, name: `${resourceId}.csv`, mimeType: "text/csv", blob: Buffer.from(csv, "utf8") });
      return { content: [{ type: "text", text: JSON.stringify({ resourceUri: `sqlite://exports/${resourceId}.csv`, rowCount: rows.length, columnCount: columns.length, contractVersion: DATABASE_MCP_CONTRACT_VERSION }) }] };
    },
  );

  server.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri as string;
    for (const entry of exports_.values()) {
      if (entry.uri === uri) return { contents: [{ uri: entry.uri, mimeType: entry.mimeType, blob: entry.blob.toString("base64") }] };
    }
    throw new Error(`Resource not found: ${uri}`);
  });

  server.server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [...exports_.values()].map(e => ({ uri: e.uri, name: e.name, mimeType: e.mimeType })) }));

  return { server, db, exports_, close: () => db.close(), contractVersion: DATABASE_MCP_CONTRACT_VERSION, maxRows };
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
