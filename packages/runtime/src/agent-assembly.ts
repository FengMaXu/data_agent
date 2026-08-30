import { AgentHarness, formatSkillsForSystemPrompt, InMemorySessionRepo } from "@earendil-works/pi-agent-core";
import type { AgentHarnessTool, AgentToolResult, Session, Skill as NativeSkill } from "@earendil-works/pi-agent-core";
import { InMemoryCredentialStore, type Model, type Models } from "@earendil-works/pi-ai";
import { boundTextByLines, readBoundedFile } from "./bounded-read.js";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { Type, type Static, type TSchema } from "typebox";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { renderSemanticDashboardHtml, validateDashboardV4Spec } from "./dashboard-v4.js";
import { materializeDashboardV3Spec, renderStandaloneDashboardHtml, validateDashboardV3Spec } from "./dashboard-v3.js";
import { KnowledgeWriter } from "./knowledge-write.js";
import { runPythonJob } from "./python-job.js";
import { canonicalLocalTools, EXPORT_QUERY_PARAMETERS, QUERY_DATABASE_PARAMETERS, SHOW_WIDGET_PARAMETERS, type CanonicalTool } from "./tools-catalog.js";
import { effectiveTools, loadSkillsFromRoots, resolveSkillRoots } from "./skills.js";
import type { KnowledgeIndex } from "./knowledge.js";
import type { WorkspaceStore } from "./workspace.js";
import type { ClarificationManager } from "./clarification.js";
import { emitWidgetUpdate, validateWidgetSpec, widgetLegacyText, type WidgetLifecycleDetails, type WidgetPayload } from "./widget.js";
import { createReviewOffQueryAssurance, type QueryAssurance } from "./query-assurance.js";

export interface QueryExportBatch {
  columns: string[];
  rows: unknown[][];
}

export interface QueryExecutor {
  run(sql: string, rowLimit: number): Promise<{ columns: string[]; rows: unknown[][]; truncated: boolean }>;
  /** Optional incremental export source. Each batch is released by the executor after consumption. */
  stream?(sql: string, signal?: AbortSignal): AsyncIterable<QueryExportBatch> | Promise<AsyncIterable<QueryExportBatch>>;
}

export type NativeSkillInvoker = (name: string, additionalInstructions?: string) => Promise<unknown>;
export type PythonExecutableSource = string | (() => string | undefined);
export type DatabaseDialect = "sqlite" | "mysql" | "bigquery" | "snowflake";

export interface AgentTaskProgress {
  turnCount: number;
  maxTurns: number;
}

export interface AgentAssemblyDeps {
  workspace: WorkspaceStore;
  knowledge?: KnowledgeIndex;
  knowledgeRoot?: string;
  pythonExecutable?: PythonExecutableSource;
  pythonWorkspaceDir?: string;
  /** Dialect-specific guidance appended to the model prompt. */
  databaseDialect?: DatabaseDialect;
  /** Optional UI capabilities. They remain enabled by default for product hosts. */
  enableWidgets?: boolean;
  enableDashboards?: boolean;
  queryExecutor?: QueryExecutor;
  /** Top-level Query Assurance coordinator; defaults to explicit Review Off. */
  queryAssurance?: QueryAssurance;
  clarifications?: ClarificationManager;
  sessionId?: string;
  /** Persistent Pi session used by this application chat session. */
  session?: Session;
  /** Explicit system prompt; overrides systemPromptRoots resolution. */
  systemPrompt?: string;
  /** Roots scanned for the migrated `.pi/SYSTEM.md` (knowledge root first). */
  systemPromptRoots?: string[];
  /** Runtime event sink for artifact notifications. */
  emitArtifact?: (relativePath: string) => void;
  /** Explicit project root used for development Skills. */
  projectRoot?: string;
  /** Explicit application resources root used for packaged Skills. */
  packagedRoot?: string;
  /** Native AgentHarness skill invocation seam, supplied by createDataAgentHarness. */
  invokeSkill?: NativeSkillInvoker;
  /** Optional per-turn context source for hosts serving multiple sessions. */
  toolContext?: AgentAssemblyToolContextSource;
  /** Current task progress, used to warn when delivery has not happened by 60% of the turn budget. */
  taskProgress?: (context: AgentAssemblyToolContext) => AgentTaskProgress | undefined | Promise<AgentTaskProgress | undefined>;
  /** Maximum metadata/sample probes allowed per session before final SQL is required. */
  explorationQueryBudget?: number;
  /** Require an independent reconciliation query before exporting JOIN aggregates. */
  requireJoinReconciliation?: boolean;
  /** Test/adapter escape hatch; product and evaluation harnesses enforce preview-before-export by default. */
  requireValidatedExportSql?: boolean;
}

export interface AgentModelProfile {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  /** OpenAI-compatible wire format: "responses" (default) or "chat". */
  apiFormat?: "responses" | "chat";
}

const DEFAULT_ROW_LIMIT = 50;
const CANONICAL_TOOL_BY_NAME = new Map<string, CanonicalTool>(
  canonicalLocalTools().map((tool) => [tool.name, tool]),
);

function canonicalTool(name: string): CanonicalTool {
  const tool = CANONICAL_TOOL_BY_NAME.get(name);
  if (!tool) throw new Error(`CANONICAL_TOOL_MISSING:${name}`);
  return tool;
}

function text(content: string, details: unknown = undefined): AgentToolResult<unknown> {
  return { content: [{ type: "text", text: content }], details };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("EXPORT_CANCELLED");
}

function normalizeValidatedSql(sql: string): string {
  return sql.trim().replace(/;+\s*$/, "");
}

function isExploratoryQuery(sql: string): boolean {
  const normalized = normalizeValidatedSql(sql).replace(/\s+/g, " ");
  return /^(?:PRAGMA\b|SELECT\s+(?:name|sql)\s+FROM\s+sqlite_master\b|SELECT\s+\*\s+FROM\s+[^\s;]+\s+LIMIT\s+\d+$|SELECT\s+DISTINCT\s+[\w.\[\]`\"]+\s+FROM\s+[^\s;]+(?:\s+LIMIT\s+\d+)?$|SELECT\s+COUNT\s*\(\s*\*\s*\)\s+(?:AS\s+\w+\s+)?FROM\s+[^\s;]+$)/i.test(normalized);
}

function requiresJoinReconciliation(sql: string): boolean {
  const normalized = normalizeValidatedSql(sql);
  const hasJoin = /\b(?:LEFT|RIGHT|FULL|INNER|CROSS)?\s+JOIN\b/i.test(normalized);
  const hasAggregate = /\b(?:COUNT|SUM|AVG|MIN|MAX|GROUP_CONCAT|TOTAL)\s*\(/i.test(normalized)
    || /\bGROUP\s+BY\b/i.test(normalized);
  return hasJoin && hasAggregate;
}

function sameColumns(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((column, index) => column === expected[index]);
}

/** RFC 4180 field encoding; strings remain quoted for compatibility with prior exports. */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  const escaped = raw.replaceAll('"', '""');
  return typeof value === "string" || /[",\r\n]/.test(raw) ? `"${escaped}"` : escaped;
}

function csvHeaderField(value: string): string {
  return /[",\r\n]/.test(value) ? csvField(value) : value;
}

function nativeSkillResult(result: unknown, name: string): AgentToolResult<unknown> {
  if (!result || typeof result !== "object" || !("content" in result) || !Array.isArray(result.content)) {
    throw new Error("NATIVE_SKILL_INVALID_RESULT");
  }
  const content = result.content.filter((item: unknown) => {
    if (!item || typeof item !== "object" || !("type" in item)) return false;
    const type = (item as { type?: unknown }).type;
    return type === "text" || type === "image";
  });
  if (content.length === 0) throw new Error("NATIVE_SKILL_EMPTY_RESULT");
  return { content, details: { nativeSkill: name } } as AgentToolResult<unknown>;
}

function buildModel(profile: AgentModelProfile): Model<any> {
  const anthropic = profile.provider === "anthropic";
  const baseUrl = (profile.baseUrl
    ?? (anthropic ? "https://api.anthropic.com" : "https://api.openai.com/v1")).replace(/\/$/, "");
  const headers: Record<string, string> | undefined = profile.apiKey
    ? (anthropic
      ? { "x-api-key": profile.apiKey, "anthropic-version": "2023-06-01" }
      : { authorization: `Bearer ${profile.apiKey}` })
    : undefined;
  const apiFormat = profile.apiFormat ?? "responses";
  return {
    id: profile.model,
    name: profile.model,
    api: anthropic ? "anthropic-messages" : (apiFormat === "chat" ? "openai-completions" : "openai-responses"),
    provider: anthropic ? "anthropic" : "openai",
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
    ...(headers ? { headers } : {}),
  };
}

export interface AgentAssemblyToolContext {
  /** Session identity associated with this harness turn, when available. */
  sessionId?: string;
}

export type AgentAssemblyToolContextSource = AgentAssemblyToolContext | (() => AgentAssemblyToolContext | Promise<AgentAssemblyToolContext>);

interface NativeToolExecution {
  toolCallId: string;
  signal: AbortSignal | undefined;
  onUpdate: Parameters<NonNullable<AgentHarnessTool<AgentAssemblyToolContext>["execute"]>>[3];
  context: AgentAssemblyToolContext;
}

function defineTool<S extends TSchema>(
  name: string, description: string, parameters: S,
  execute: (params: Static<S>, native: NativeToolExecution) => Promise<AgentToolResult<unknown>>,
): AgentHarnessTool<AgentAssemblyToolContext> {
  return {
    name,
    label: name,
    description,
    parameters,
    execute: async (
      toolCallId: string,
      params: Static<S>,
      signal: AbortSignal | undefined,
      onUpdate: NativeToolExecution["onUpdate"],
      context: AgentAssemblyToolContext,
    ) => execute(
      params,
      { toolCallId, signal, onUpdate, context },
    ),
  } as unknown as AgentHarnessTool<AgentAssemblyToolContext>;
}

interface DataAgentSkill extends NativeSkill {
  allowedTools?: string[];
}

/** Keeps native AgentHarness skill invocation while applying legacy allowlists. */
class DataAgentHarness extends AgentHarness<AgentAssemblyToolContext, DataAgentSkill> {
  override async skill(name: string, additionalInstructions?: string) {
    const skill = this.getResources().skills?.find((candidate) => candidate.name === name);
    if (!skill) return super.skill(name, additionalInstructions);
    const previous = this.getActiveTools().map((tool) => (tool as unknown as { name: string }).name);
    const active = effectiveTools(previous, [skill]);
    await this.setActiveTools(active);
    try {
      return await super.skill(name, additionalInstructions);
    } finally {
      await this.setActiveTools(previous);
    }
  }
}

export function buildAgentTools(deps: AgentAssemblyDeps): AgentHarnessTool<AgentAssemblyToolContext>[] {
  const writer = deps.knowledgeRoot ? new KnowledgeWriter(deps.knowledgeRoot) : undefined;
  const sessionIdFor = (native: NativeToolExecution) => native.context?.sessionId ?? deps.sessionId;
  const workspaceFor = async (native: NativeToolExecution) => {
    const sessionId = sessionIdFor(native);
    return sessionId ? deps.workspace.scoped(sessionId) : deps.workspace;
  };
  const artifactPathFor = (native: NativeToolExecution, relativePath: string) => {
    const sessionId = sessionIdFor(native);
    return sessionId ? `${sessionId}/${relativePath}` : relativePath;
  };
  const toolFailures = new Map<string, { message: string; count: number }>();
  const queryAssurance = deps.queryAssurance ?? createReviewOffQueryAssurance();
  type QueryTaskState = {
    /** Pre-wired for the next Query Task slice; Review Off is behavior-neutral. */
    queryAssurance: QueryAssurance;
    exploratoryCount: number;
    hasExported: boolean;
    lastSuccessfulSql?: string;
    lastReconciliationSql?: string;
    reconciliationForSql?: string;
    lastVerificationSql?: string;
  };
  const queryTaskStates = new Map<string, QueryTaskState>();
  const queryTaskStateFor = (native: NativeToolExecution): QueryTaskState => {
    const key = sessionIdFor(native) ?? "__default__";
    const existing = queryTaskStates.get(key);
    if (existing) return existing;
    const created: QueryTaskState = { queryAssurance, exploratoryCount: 0, hasExported: false };
    queryTaskStates.set(key, created);
    return created;
  };
  const withToolFailureGuidance = async <T>(toolName: string, native: NativeToolExecution, operation: () => Promise<T>): Promise<T> => {
    const failureKey = `${sessionIdFor(native) ?? "__default__"}:${toolName}`;
    try {
      const result = await operation();
      toolFailures.delete(failureKey);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const previous = toolFailures.get(failureKey);
      const count = previous?.message === message ? previous.count + 1 : 1;
      toolFailures.set(failureKey, { message, count });
      if (count >= 3) {
        throw new Error(`${message}\nThis exact ${toolName} error has occurred ${count} times. Stop repeating the same call; inspect the schema/knowledge and use a materially different strategy.`);
      }
      throw error;
    }
  };
  let pythonCapabilityUnavailable = false;
  const configuredPythonExecutable = typeof deps.pythonExecutable === "function" ? deps.pythonExecutable() : deps.pythonExecutable;
  const pythonUnavailableMessage = () => [
    "PYTHON_RUNTIME_NOT_AVAILABLE.",
    "Python is not available in this environment. Do NOT call run_python again.",
    "Use SQL (query_database / export_query) or the other currently available tools instead.",
    "For statistics such as median, percentile, or standard deviation, use SQL window functions or subqueries when the database supports them.",
  ].join("\n");
  const tools: AgentHarnessTool<AgentAssemblyToolContext>[] = [
    defineTool("list_workspace", canonicalTool("list_workspace").description, Type.Object({}), async (_p, native) => {
      const workspace = await workspaceFor(native);
      return text((await workspace.list()).filter((entry) => !entry.split(path.sep).includes(".audit.log")).join("\n") || "(workspace empty)");
    }),
    defineTool("read_file", canonicalTool("read_file").description, Type.Object({ path: Type.String(), startLine: Type.Optional(Type.Integer({ minimum: 1 })), endLine: Type.Optional(Type.Integer({ minimum: 1 })) }), async (p, native) => {
      const workspace = await workspaceFor(native);
      const result = await workspace.readRange(p.path, { startLine: p.startLine, endLine: p.endLine });
      return text(result.content, { startLine: p.startLine, endLine: p.endLine, truncated: result.truncated });
    }),
    defineTool("write_file", canonicalTool("write_file").description, Type.Object({ path: Type.String(), content: Type.String() }), async (p, native) => {
      const workspace = await workspaceFor(native);
      await workspace.write(p.path, p.content);
      deps.emitArtifact?.(artifactPathFor(native, p.path));
      return text(`written ${p.path} (${p.content.length} bytes)`);
    }),
  ];
  if (configuredPythonExecutable) {
    tools.push(defineTool("run_python", canonicalTool("run_python").description, Type.Object({ code: Type.String({ minLength: 1 }), description: Type.Optional(Type.String()) }), async (p, native) => {
      const executable = typeof deps.pythonExecutable === "function" ? deps.pythonExecutable() : deps.pythonExecutable;
      if (pythonCapabilityUnavailable || !executable) {
        pythonCapabilityUnavailable = true;
        throw new Error(pythonUnavailableMessage());
      }
      const workspace = deps.pythonWorkspaceDir
        ? { root: deps.pythonWorkspaceDir }
        : await workspaceFor(native);
      const result = await runPythonJob(p.code, { workspace: workspace.root, executable, timeoutMs: 120000 });
      if (result.status === "error" && (/(?:ENOENT|not found|cannot find|not recognized)/i.test(result.stderr) || result.exitCode === 127 || result.exitCode === -4058)) {
        pythonCapabilityUnavailable = true;
        throw new Error(pythonUnavailableMessage());
      }
      return text(result.stdout || result.stderr || "(no output)", { exitCode: result.exitCode, status: result.status });
    }));
  }
  if (deps.knowledge) {
    const knowledge = deps.knowledge;
    tools.push(
      defineTool("search_knowledge", canonicalTool("search_knowledge").description, Type.Object({ query: Type.String({ minLength: 1 }) }), async (p) => {
        const hits = knowledge.search(p.query);
        const details = hits.map(({ path: hitPath, score, title, startLine, endLine, snippet }) => ({ path: hitPath, score, title, startLine, endLine, snippet }));
        const rendered = hits.length
          ? hits.map((h) => `${h.path} (score ${h.score.toFixed(3)}, lines ${h.startLine}-${h.endLine}, title: ${h.title})\n${h.snippet}`).join("\n\n")
          : "(no matches)";
        return text(boundTextByLines(rendered).content, details);
      }),
      defineTool("read_knowledge", canonicalTool("read_knowledge").description, Type.Object({ path: Type.String({ minLength: 1 }), startLine: Type.Optional(Type.Integer({ minimum: 1 })), endLine: Type.Optional(Type.Integer({ minimum: 1 })) }), async (p) => {
        const result = await readBoundedFile(deps.knowledgeRoot!, p.path, { startLine: p.startLine, endLine: p.endLine });
        return text(result.content, { startLine: p.startLine, endLine: p.endLine, truncated: result.truncated });
      }),
    );
  }
  if (writer) {
    tools.push(defineTool("update_knowledge", canonicalTool("update_knowledge").description, Type.Object({ operation: Type.Union([Type.Literal("append_learning"), Type.Literal("write_draft"), Type.Literal("update_schema")]), path: Type.String({ minLength: 1 }), content: Type.String() }), async (p) => {
      const result = await writer.write(p.operation, p.path, p.content);
      return text(`${result.operation} -> ${result.path} (${result.bytesWritten} bytes)`);
    }));
  }
  tools.push(
    defineTool("load_skill", canonicalTool("load_skill").description, Type.Object({ name: Type.String({ minLength: 1 }) }), async (p) => {
      if (!deps.invokeSkill) throw new Error("NATIVE_SKILL_INVOCATION_UNAVAILABLE");
      return nativeSkillResult(await deps.invokeSkill(p.name), p.name);
    }),
  );
  if (deps.enableDashboards !== false) {
    tools.push(defineTool("generate_dashboard", canonicalTool("generate_dashboard").description, Type.Object({ operation: Type.Union([Type.Literal("create"), Type.Literal("edit"), Type.Literal("validate")]), mode: Type.Union([Type.Literal("static"), Type.Literal("semantic")]), version: Type.Union([Type.Literal("v3"), Type.Literal("v4")]), spec: Type.Unknown(), editPath: Type.Optional(Type.String()) }), async (p, native) => withToolFailureGuidance("generate_dashboard", native, async () => {
      const workspace = await workspaceFor(native);
      if (p.mode === "static" && p.version === "v3") {
        const materialized = await materializeDashboardV3Spec(p.spec, workspace);
        const validated = validateDashboardV3Spec(materialized);
        if (!validated.ok) throw new Error(`DASHBOARD_SPEC_INVALID: ${validated.errors.join("; ")}`);
        if (p.operation === "validate") return text("dashboard spec valid");
        const fileName = validated.spec.filename?.replace(/\.html$/i, "") || String(Date.now());
        const target = p.editPath ?? `dashboards/${fileName}.html`;
        const html = await renderStandaloneDashboardHtml(validated.spec);
        await workspace.write(target, html);
        const artifactPath = artifactPathFor(native, target);
        const downloadUrl = `/workspace/files/download?path=${encodeURIComponent(artifactPath)}`;
        deps.emitArtifact?.(artifactPath);
        return text(`[查看 HTML 看板](${downloadUrl})`, { status: "success", relativePath: target, downloadUrl, fileType: "html" });
      }
      if (p.mode === "semantic" && p.version === "v4") {
        const validated = validateDashboardV4Spec(p.spec);
        if (!validated.ok) throw new Error(`DASHBOARD_SPEC_INVALID: ${validated.errors.join("; ")}`);
        if (p.operation === "validate") return text("dashboard spec valid");
        const target = p.editPath ?? `dashboards/${Date.now()}-semantic.html`;
        const html = renderSemanticDashboardHtml(validated.spec, { nonce: randomUUID().replace(/-/g, ""), expectedOrigin: "https://data-agent.local" });
        await workspace.write(target, html);
        const artifactPath = artifactPathFor(native, target);
        const downloadUrl = `/workspace/files/download?path=${encodeURIComponent(artifactPath)}`;
        deps.emitArtifact?.(artifactPath);
        return text(`[查看语义看板](${downloadUrl})`, { status: "success", relativePath: target, downloadUrl, fileType: "html" });
      }
      throw new Error("DASHBOARD_MODE_VERSION_MISMATCH");
    })));
  }
  if (deps.enableWidgets !== false) {
    tools.push(defineTool("show_widget", canonicalTool("show_widget").description, SHOW_WIDGET_PARAMETERS, async (p, native) => withToolFailureGuidance("show_widget", native, async () => {
      const widgetId = `widget-${native.toolCallId}`;
      if (native.signal?.aborted) throw new Error("Operation aborted");
      const validation = validateWidgetSpec(p.kind, p.spec);
      if (!validation.ok) {
        const error = `WIDGET_SPEC_INVALID: ${validation.error}`;
        emitWidgetUpdate(native.onUpdate, {
          widgetEvent: "widget_error",
          widgetId,
          toolCallId: native.toolCallId,
          toolName: "show_widget",
          error,
          legacyText: `[widget error] ${error}`,
        });
        throw new Error(error);
      }
      const spec = { ...validation.spec };
      // The renderer consumes KPI items, while accepting the compact scalar
      // form keeps the tool useful to callers that only have one value.
      if (p.kind === "kpi" && !Array.isArray(spec.data) && (typeof spec.value === "string" || typeof spec.value === "number")) {
        spec.data = [{ label: spec.label ?? "", value: spec.value }];
      }
      const widget: WidgetPayload = {
        ...spec,
        widget_id: widgetId,
        kind: p.kind,
        title: typeof spec.title === "string" && spec.title.trim() ? spec.title : `${p.kind} widget`,
        tool_call_id: native.toolCallId,
      };
      const legacyText = widgetLegacyText(widget);
      emitWidgetUpdate(native.onUpdate, {
        widgetEvent: "widget",
        widgetId,
        toolCallId: native.toolCallId,
        toolName: "show_widget",
        widget,
        legacyText,
      });
      return text(legacyText, {
        widgetEvent: "widget",
        widgetId,
        toolCallId: native.toolCallId,
        toolName: "show_widget",
        widget,
        legacyText,
      } satisfies WidgetLifecycleDetails);
    })));
  }
  if (deps.queryExecutor) {
    const runQuery = async (sql: string, limit?: number) => {
      const result = await deps.queryExecutor!.run(sql, limit ?? DEFAULT_ROW_LIMIT);
      const header = result.columns.join(" | ");
      const body = result.rows.map((row) => row.map((cell) => String(cell ?? "NULL")).join(" | ")).join("\n");
      return {
        rendered: `${header}\n${body}${result.truncated ? `\n(truncated at ${result.rows.length} rows)` : ""}`,
        result,
      };
    };
    tools.push(
      defineTool("query_database", canonicalTool("query_database").description, QUERY_DATABASE_PARAMETERS, async (p, native) => withToolFailureGuidance("query_database", native, async () => {
        let state = queryTaskStateFor(native);
        if (state.hasExported) {
          state = { queryAssurance, exploratoryCount: 0, hasExported: false };
          queryTaskStates.set(sessionIdFor(native) ?? "__default__", state);
        }
        const validationPurpose = p.purpose;
        const exploratory = !validationPurpose && isExploratoryQuery(p.sql);
        const explorationLimit = deps.explorationQueryBudget === undefined
          ? undefined
          : Math.max(1, deps.explorationQueryBudget);
        if (exploratory && explorationLimit !== undefined && state.exploratoryCount >= explorationLimit) {
          return text(
            `You have used ${state.exploratoryCount}/${explorationLimit} exploratory queries. ` +
            "Stop exploring and write your final analytical SQL now. " +
            "If you already have a validated result, call export_query immediately.",
            { warning: "EXPLORATION_BUDGET_EXCEEDED", exploratoryCount: state.exploratoryCount, limit: explorationLimit },
          );
        }
        if (exploratory) state.exploratoryCount++;
        const { rendered, result } = await runQuery(p.sql, p.limit);
        const normalizedSql = normalizeValidatedSql(p.sql);
        if (validationPurpose === "reconciliation") {
          state.lastReconciliationSql = normalizedSql;
          state.reconciliationForSql = state.lastSuccessfulSql;
        } else if (validationPurpose === "verification") {
          state.lastVerificationSql = normalizedSql;
        } else {
          state.lastSuccessfulSql = normalizedSql;
        }
        const progress = await deps.taskProgress?.(native.context);
        const remindToExport = Boolean(progress
          && progress.maxTurns > 0
          && progress.turnCount >= progress.maxTurns * 0.6
          && !state.hasExported);
        const reminder = remindToExport
          ? `\n\n[EXPORT_DEADLINE] You have used ${progress!.turnCount}/${progress!.maxTurns} turns and have not exported yet. ` +
            "If this result satisfies the declared output contract, call export_query immediately with this validated SQL."
          : "";
        const validationHint = validationPurpose === "reconciliation"
          ? "\n[RECONCILIATION_RECORDED] This independent reconciliation query does not replace the final SQL used for export."
          : validationPurpose === "verification"
            ? "\n[VERIFICATION_RECORDED] This independent verification query does not replace the final SQL used for export."
            : "";
        return text(`${rendered}${validationHint}${reminder}`, {
          columns: result.columns,
          rows: result.rows,
          exploratory,
          ...(validationPurpose ? { purpose: validationPurpose } : {}),
          ...(remindToExport ? { exportReminder: true, turnCount: progress!.turnCount, maxTurns: progress!.maxTurns } : {}),
        });
      })),

      defineTool("export_query", canonicalTool("export_query").description, EXPORT_QUERY_PARAMETERS, async (p, native) => withToolFailureGuidance("export_query", native, async () => {
        if (!p.expected_rows) {
          throw new Error("SHAPE_DECLARATION_INVALID: expected_rows is required");
        }
        const taskState = queryTaskStateFor(native);
        const normalizedSql = normalizeValidatedSql(p.sql);
        if (deps.requireValidatedExportSql !== false && taskState.lastSuccessfulSql !== normalizedSql) {
          throw new Error("EXPORT_SQL_NOT_VALIDATED: export_query SQL must exactly match the last successful final query_database SQL in this session. Validate this SQL, then export it unchanged. Re-derive the expected shape from the question, not from the last query result.");
        }
        if (p.expected_rows === "top_n" && p.expected_row_count === undefined) {
          throw new Error("SHAPE_DECLARATION_INVALID: expected_row_count is required for top_n");
        }
        if (!p.expected_columns || p.expected_columns.length === 0) {
          throw new Error("SHAPE_DECLARATION_INVALID: expected_columns is required");
        }
        if (deps.requireJoinReconciliation !== false && requiresJoinReconciliation(p.sql)) {
          if (taskState.reconciliationForSql !== normalizedSql || taskState.lastReconciliationSql === normalizedSql) {
            throw new Error("JOIN_RECONCILIATION_REQUIRED: run a different successful query_database call with purpose=reconciliation to audit JOIN aggregate row counts or totals before exporting. The reconciliation query does not replace the final SQL.");
          }
        }
        const signal = native.signal;
        const target = p.filename ?? `exports/query-${Date.now()}.csv`;
        const rowCountMaximum = (p.expected_rows === "top_n" || p.expected_rows === "grouped")
          ? p.expected_row_count
          : undefined;
        let rowCount = 0;
        let observedColumns: string[] | undefined;
        const workspace = await workspaceFor(native);
        await workspace.writeStream(target, async (write) => {
          let pending = "";
          let headerWritten = false;
          const append = async (chunk: string) => {
            pending += chunk;
            if (pending.length >= 64 * 1024) {
              await write(pending);
              pending = "";
            }
          };
          const consume = async (batch: QueryExportBatch) => {
            throwIfAborted(signal);
            if (!observedColumns) observedColumns = [...batch.columns];
            if (!sameColumns(batch.columns, observedColumns)) {
              throw new Error(`SHAPE_MISMATCH: export batches changed columns from [${observedColumns.join(", ")}] to [${batch.columns.join(", ")}]`);
            }
            if (!sameColumns(batch.columns, p.expected_columns)) {
              throw new Error(`SHAPE_MISMATCH: expected columns [${p.expected_columns.join(", ")}] but query returned [${batch.columns.join(", ")}]`);
            }
            if (!headerWritten) {
              await append(batch.columns.map(csvHeaderField).join(","));
              headerWritten = true;
            }
            for (const row of batch.rows) {
              throwIfAborted(signal);
              if (row.length !== batch.columns.length) {
                throw new Error(`SHAPE_MISMATCH: row width ${row.length} does not match ${batch.columns.length} columns`);
              }
              rowCount++;
              if (p.expected_rows === "scalar" && rowCount > 1) {
                throw new Error("SHAPE_MISMATCH: declared scalar but query produced more than 1 row. Add a final aggregation or LIMIT 1 before exporting.");
              }
              if (rowCountMaximum !== undefined && rowCount > rowCountMaximum) {
                throw new Error(`SHAPE_MISMATCH: declared ${p.expected_rows} maximum=${p.expected_row_count} but query produced more than ${rowCountMaximum} rows. Add a final LIMIT, aggregation, or stricter filter before exporting.`);
              }
              await append(`\n${row.map(csvField).join(",")}`);
            }
          };
          if (deps.queryExecutor!.stream) {
            const batches = await deps.queryExecutor!.stream(p.sql, signal);
            for await (const batch of batches) await consume(batch);
          } else {
            // The legacy preview contract is intentionally bounded. Executors
            // that support complete exports must implement stream().
            const bounded = await deps.queryExecutor!.run(p.sql, DEFAULT_ROW_LIMIT);
            if (bounded.truncated) throw new Error("EXPORT_STREAM_REQUIRED");
            await consume(bounded);
          }
          if (!headerWritten) throw new Error("EXPORT_EMPTY_STREAM: executor returned no column metadata");
          if (p.expected_rows === "scalar" && rowCount === 0) {
            throw new Error("SHAPE_MISMATCH: declared scalar but query produced 0 rows. Return exactly one aggregate row before exporting.");
          }
          if (pending) await write(pending);
        }, signal);
        queryTaskStateFor(native).hasExported = true;
        // The artifact is observable only after the temporary file was promoted.
        const artifactPath = artifactPathFor(native, target);
        const downloadUrl = `/workspace/files/download?path=${encodeURIComponent(artifactPath)}`;
        deps.emitArtifact?.(artifactPath);
        return text(
          `exported ${rowCount} rows: [下载 CSV](${downloadUrl})\n` +
          `[TASK_COMPLETE] The declared ${p.expected_rows} shape and output columns were validated. ` +
          "If the user's request was to query and export data, the task is complete. " +
          "Do not call Python, show_widget, or generate_dashboard unless the user explicitly requested analysis or visualization.",
          {
            status: "success",
            taskComplete: true,
            relativePath: target,
            downloadUrl,
            fileType: "csv",
            rowCount,
            columns: observedColumns ?? [],
            expectedRows: p.expected_rows,
          },
        );
      })),
    );
  }
  if (deps.clarifications) {
    const clarifications = deps.clarifications;
    tools.push(defineTool("ask_user_clarification", canonicalTool("ask_user_clarification").description, Type.Object({ question: Type.String({ minLength: 1 }), options: Type.Optional(Type.Array(Type.String())) }), async (p, native) => {
      const sessionId = native.context.sessionId ?? deps.sessionId ?? "web";
      const { clarificationId, promise } = clarifications.ask(sessionId, p.question, p.options ?? []);
      deps.emitArtifact?.(`__clarification__:${clarificationId}`);
      const answer = await promise;
      return text(answer || "(no answer)");
    }));
  }
  return tools;
}

export function composeDataAgentSystemPrompt(basePrompt: string, skills: NativeSkill[]): string {
  const skillsPrompt = formatSkillsForSystemPrompt(skills);
  return [basePrompt.trim(), skillsPrompt].filter(Boolean).join("\n\n");
}

export function dialectHint(dialect: DatabaseDialect): string {
  switch (dialect) {
    case "sqlite":
      return [
        "数据库后端为 SQLite。",
        "系统表查询用 `SELECT name FROM sqlite_master WHERE type='table'`。",
        "日期提取用 `strftime()`；不支持 YEAR()、MONTH()、DATEDIFF()、DATE_FORMAT()。",
        "日期差用 `julianday(d1) - julianday(d2)`。",
        "浮点除法用 `CAST(x AS REAL) / y` 或 `1.0 * x / y`；整数除法会截断。",
        "字符串连接用 `||`，不支持 CONCAT()；条件表达式用 CASE，不使用 IF()。",
        "字符串截取用 `substr()`；不支持 SUBSTRING_INDEX()。",
        "不支持 information_schema，也不支持 LIMIT offset, count；使用 LIMIT count OFFSET offset。",
        "使用 COALESCE() 处理空值。",
      ].join("\n");
    case "mysql":
      return "数据库后端为 MySQL 业务库：系统表查询用 `SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()`；不要使用 sqlite_master。";
    case "bigquery":
      return "数据库后端为 BigQuery。使用 BigQuery Standard SQL；不要假设 SQLite 的 sqlite_master 或 MySQL 的 information_schema 可用。";
    case "snowflake":
      return "数据库后端为 Snowflake。使用 Snowflake SQL；不要假设 SQLite 的 sqlite_master 或 MySQL 的 information_schema 可用。";
  }
}

function dialectGuidance(databaseDialect?: DatabaseDialect): string {
  return databaseDialect
    ? dialectHint(databaseDialect)
    : "数据库方言由当前连接提供；不要默认假设 MySQL、SQLite 或其他方言。先参考知识库和查询工具返回的后端信息。";
}

export function unknownToolRecoveryMessage(errorText: string, toolNames: Iterable<string>): string | undefined {
  const match = /^Tool\s+([A-Za-z0-9_-]+)\s+not found\b/.exec(errorText.trim());
  if (!match) return undefined;
  const available = [...new Set(toolNames)];
  const clarificationFallback = match[1] === "ask_user_clarification"
    ? "Clarification is unavailable in this runtime. Resolve ambiguity by the most literal reading of the request; never invent thresholds, default values, date baselines, or unit conversions, and state the assumption in the final response."
    : undefined;
  return [
    `Tool "${match[1]}" does not exist in this runtime. Do not retry it.`,
    `Available tools: ${available.join(", ") || "none"}.`,
    "Use search_knowledge/read_knowledge for knowledge, query_database for read-only SQL, and export_query for final CSV delivery.",
    ...(clarificationFallback ? [clarificationFallback] : []),
  ].join("\n");
}

export function runtimeCapabilitiesPrompt(toolNames: Iterable<string>): string {
  const available = [...new Set(toolNames)];
  const unavailable = ["run_python", "show_widget", "generate_dashboard", "ask_user_clarification"].filter((name) => !available.includes(name));
  const clarificationFallback = unavailable.includes("ask_user_clarification")
    ? "Clarification is unavailable in this session. Resolve ambiguity by the most literal reading of the request; never invent thresholds, default values, date baselines, or unit conversions, and state the assumption in the final response."
    : undefined;
  return [
    "## Runtime capability contract",
    "Only tools present in the current tool list are available in this session. Never call an absent tool.",
    `Available tools: ${available.join(", ") || "none"}.`,
    ...(unavailable.length ? [`Unavailable tools: ${unavailable.join(", ")}. Do not retry them; complete the task with the available tools.`] : []),
    ...(clarificationFallback ? [clarificationFallback] : []),
  ].join("\n");
}

/**
 * Resolves the versioned system prompt from `.pi/SYSTEM.md` and appends only
 * active database dialect guidance. Tool names come from the canonical catalog.
 */
export async function resolveSystemPrompt(searchRoots: string[], databaseDialect?: DatabaseDialect): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  for (const root of searchRoots) {
    if (!root) continue;
    try {
      const migrated = await readFile(path.join(root, ".pi", "SYSTEM.md"), "utf8");
      return [migrated.trim(), dialectGuidance(databaseDialect)].filter(Boolean).join("\n\n");
    } catch { /* try next root */ }
  }
  throw new Error(`SYSTEM_PROMPT_NOT_FOUND: expected .pi/SYSTEM.md under ${searchRoots.filter(Boolean).join(", ") || "the configured system prompt roots"}`);
}

export async function createDataAgentHarness(deps: AgentAssemblyDeps, profile: AgentModelProfile): Promise<AgentHarness<AgentAssemblyToolContext>> {
  if (!profile.apiKey) throw new Error("LLM_API_KEY_MISSING");
  // Keep credentials scoped to this harness. Never place them in process.env,
  // because tool subprocesses (notably Python jobs) inherit that environment.
  const credentials = new InMemoryCredentialStore();
  const providerId = profile.provider === "anthropic" ? "anthropic" : "openai";
  await credentials.modify(providerId, async () => ({ type: "api_key", key: profile.apiKey }));
  const models: Models = builtinModels({ credentials });
  const skillLoad = await loadSkillsFromRoots(resolveSkillRoots({ projectRoot: deps.projectRoot, packagedRoot: deps.packagedRoot }));
  for (const item of skillLoad.diagnostics) console.warn(`[data-agent] Skill diagnostic (${item.code ?? "warning"}) ${item.path}: ${item.message}`);
  let skills: DataAgentSkill[] = [];
  const tools = buildAgentTools({
    ...deps,
    invokeSkill: async (name, additionalInstructions) => {
      const skill = skills.find((candidate) => candidate.name === name);
      if (!skill) throw new Error(`SKILL_NOT_FOUND: ${name}`);
      const content = additionalInstructions
        ? `${skill.content}\n\nAdditional instructions:\n${additionalInstructions}`
        : skill.content;
      return { content: [{ type: "text", text: content }] };
    },
  });
  const registeredToolNames = new Set(tools.map((tool) => tool.name));
  // A Skill allowlist can only narrow the actual harness surface. In
  // particular, loading a Skill must never resurrect a capability that the
  // host intentionally omitted (for example Python in a minimal deployment).
  skills = skillLoad.skills.map((skill) => skill.allowedTools === undefined
    ? skill
    : { ...skill, allowedTools: skill.allowedTools.filter((name) => registeredToolNames.has(name)) });
  const baseSystemPrompt = deps.systemPrompt
    ? [deps.systemPrompt.trim(), dialectGuidance(deps.databaseDialect)].filter(Boolean).join("\n\n")
    : await resolveSystemPrompt(deps.systemPromptRoots ?? (deps.knowledgeRoot ? [deps.knowledgeRoot] : []), deps.databaseDialect);
  const capabilityPrompt = runtimeCapabilitiesPrompt(registeredToolNames);
  const harness = new DataAgentHarness({
    session: deps.session ?? await new InMemorySessionRepo().create(),
    models,
    model: buildModel(profile),
    thinkingLevel: "off",
    // Use Pi's per-turn prompt callback rather than freezing a prompt string.
    // The callback receives the current resources snapshot, so a later
    // setResources() immediately changes the model-visible skill catalog.
    systemPrompt: ({ resources }) => composeDataAgentSystemPrompt(`${baseSystemPrompt}\n\n${capabilityPrompt}`, resources.skills ?? []),
    tools,
    resources: { skills },
    toolContext: deps.toolContext ?? { sessionId: deps.sessionId },
  });
  harness.subscribe((event) => {
    if (event?.type !== "tool_execution_end" || !event.isError) return;
    const content = event.result?.content;
    const errorText = Array.isArray(content)
      ? content.find((item: unknown) => asRecord(item)?.type === "text" && typeof asRecord(item)?.text === "string")
      : undefined;
    const guidance = unknownToolRecoveryMessage(String(asRecord(errorText)?.text ?? ""), registeredToolNames);
    if (guidance) void harness.steer(guidance).catch(() => undefined);
  });
  return harness;
}
