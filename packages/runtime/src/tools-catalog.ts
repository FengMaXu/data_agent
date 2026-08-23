import { Type } from "typebox";

export interface CanonicalTool {
  /** Model-visible short name. */
  name: string;
  /** Internal identity; MCP-backed dynamic tools use server-scoped ids. */
  identity: string;
  description: string;
  parameters: any;
  /** Where execution happens. */
  origin: "local" | "mcp-dynamic";
}

/**
 * The single source of truth for the model-visible local tool surface.
 * Legacy names (execute_sql, build_dashboard, activate_skill, tool_search,
 * write_workspace_file, read_workspace_file, call_webhook, …) are intentionally absent.
 */
export function canonicalLocalTools(): CanonicalTool[] {
  return [
    { name: "list_workspace", identity: "list_workspace", origin: "local", description: "List files in the session workspace.", parameters: Type.Object({}) },
    { name: "read_file", identity: "read_file", origin: "local", description: "Read a workspace file.", parameters: Type.Object({ path: Type.String() }) },
    { name: "write_file", identity: "write_file", origin: "local", description: "Write a workspace file.", parameters: Type.Object({ path: Type.String(), content: Type.String() }) },
    { name: "run_python", identity: "run_python", origin: "local", description: "Execute Python analysis code in an isolated job.", parameters: Type.Object({ code: Type.String({ minLength: 1 }), description: Type.Optional(Type.String()) }) },
    { name: "search_knowledge", identity: "search_knowledge", origin: "local", description: "Search the Markdown knowledge base.", parameters: Type.Object({ query: Type.String({ minLength: 1 }) }) },
    { name: "read_knowledge", identity: "read_knowledge", origin: "local", description: "Read a knowledge document.", parameters: Type.Object({ path: Type.String({ minLength: 1 }) }) },
    { name: "update_knowledge", identity: "update_knowledge", origin: "local", description: "Append learning, write drafts, or update schema snapshots.", parameters: Type.Object({ operation: Type.Union([Type.Literal("append_learning"), Type.Literal("write_draft"), Type.Literal("update_schema")]), path: Type.String({ minLength: 1 }), content: Type.String() }) },
    { name: "load_skill", identity: "load_skill", origin: "local", description: "Load a discovered skill by name.", parameters: Type.Object({ name: Type.String({ minLength: 1 }) }) },
    { name: "generate_dashboard", identity: "generate_dashboard", origin: "local", description: "Validate, create or edit static/semantic dashboards.", parameters: Type.Object({ operation: Type.Union([Type.Literal("create"), Type.Literal("edit"), Type.Literal("validate")]), mode: Type.Union([Type.Literal("static"), Type.Literal("semantic")]), version: Type.Union([Type.Literal("v3"), Type.Literal("v4")]), spec: Type.Unknown(), editPath: Type.Optional(Type.String()) }) },
    { name: "show_widget", identity: "show_widget", origin: "local", description: "Render an inline UI widget card.", parameters: Type.Object({ kind: Type.Union([Type.Literal("kpi"), Type.Literal("chart"), Type.Literal("table"), Type.Literal("steps")]), spec: Type.Unknown() }) },
    { name: "query_database", identity: "query_database", origin: "mcp-dynamic", description: "Preview a read-only query through the database MCP server.", parameters: Type.Object({ sql: Type.String({ minLength: 1 }), limit: Type.Optional(Type.Number()) }) },
    { name: "ask_user_clarification", identity: "ask_user_clarification", origin: "local", description: "Ask the user a structured clarifying question.", parameters: Type.Object({ question: Type.String({ minLength: 1 }), options: Type.Optional(Type.Array(Type.String())) }) },
    { name: "export_query", identity: "mcp__database__export_query", origin: "mcp-dynamic", description: "Export full query results as a CSV artifact via MCP Resource transfer.", parameters: Type.Object({ sql: Type.String({ minLength: 1 }), filename: Type.Optional(Type.String()) }) },
  ];
}

const FORBIDDEN_LEGACY = new Set([
  "execute_sql", "export_sql_to_csv", "read_workspace_file", "write_workspace_file",
  "validate_dashboard_spec", "build_dashboard", "edit_dashboard",
  "validate_semantic_dashboard_spec", "build_semantic_dashboard",
  "search_query_patterns", "search_business_context", "grep_context",
  "search_column_metadata", "save_column_metadata",
  "search_past_learnings", "save_learning", "report_query_feedback",
  "activate_skill", "tool_search", "call_webhook",
]);

/** Fails if any legacy name sneaks back into the surface. */
export function assertNoLegacyTools(names: Iterable<string>): void {
  const offenders = [...names].filter(name => FORBIDDEN_LEGACY.has(name));
  if (offenders.length > 0) throw new Error(`LEGACY_TOOL_NAMES_PRESENT:${offenders.join(",")}`);
}
