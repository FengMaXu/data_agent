import { AgentHarness, InMemorySessionRepo } from "@earendil-works/pi-agent-core";
import type { AgentHarnessTool, AgentToolResult, Skill as NativeSkill } from "@earendil-works/pi-agent-core";
import { InMemoryCredentialStore, type Model, type Models } from "@earendil-works/pi-ai";
import { boundTextByLines, readBoundedFile } from "./bounded-read.js";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { Type, type Static, type TSchema } from "typebox";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { renderSemanticDashboardHtml, validateDashboardV4Spec } from "./dashboard-v4.js";
import { KnowledgeWriter } from "./knowledge-write.js";
import { runPythonJob } from "./python-job.js";
import { canonicalLocalTools, type CanonicalTool } from "./tools-catalog.js";
import { effectiveTools, loadSkillsFromRoots, resolveSkillRoots } from "./skills.js";
import type { KnowledgeIndex } from "./knowledge.js";
import type { WorkspaceStore } from "./workspace.js";
import type { ClarificationManager } from "./clarification.js";
import { emitWidgetUpdate, validateWidgetSpec, widgetLegacyText, type WidgetLifecycleDetails, type WidgetPayload } from "./widget.js";

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

export interface AgentAssemblyDeps {
  workspace: WorkspaceStore;
  knowledge?: KnowledgeIndex;
  knowledgeRoot?: string;
  pythonExecutable?: PythonExecutableSource;
  pythonWorkspaceDir?: string;
  queryExecutor?: QueryExecutor;
  clarifications?: ClarificationManager;
  sessionId?: string;
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("EXPORT_CANCELLED");
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
  const workspaceDir = deps.pythonWorkspaceDir ?? deps.workspace.root;
  const tools: AgentHarnessTool<AgentAssemblyToolContext>[] = [
    defineTool("list_workspace", canonicalTool("list_workspace").description, Type.Object({}), async () =>
      text((await deps.workspace.list()).filter((entry) => !entry.split(path.sep).includes(".audit.log")).join("\n") || "(workspace empty)")),
    defineTool("read_file", canonicalTool("read_file").description, Type.Object({ path: Type.String(), startLine: Type.Optional(Type.Integer({ minimum: 1 })), endLine: Type.Optional(Type.Integer({ minimum: 1 })) }), async (p) => {
      const result = await deps.workspace.readRange(p.path, { startLine: p.startLine, endLine: p.endLine });
      return text(result.content, { startLine: p.startLine, endLine: p.endLine, truncated: result.truncated });
    }),
    defineTool("write_file", canonicalTool("write_file").description, Type.Object({ path: Type.String(), content: Type.String() }), async (p) => {
      await deps.workspace.write(p.path, p.content);
      deps.emitArtifact?.(p.path);
      return text(`written ${p.path} (${p.content.length} bytes)`);
    }),
    defineTool("run_python", canonicalTool("run_python").description, Type.Object({ code: Type.String({ minLength: 1 }), description: Type.Optional(Type.String()) }), async (p) => {
      const executable = typeof deps.pythonExecutable === "function" ? deps.pythonExecutable() : deps.pythonExecutable;
      if (!executable) throw new Error("PYTHON_RUNTIME_NOT_AVAILABLE");
      const result = await runPythonJob(p.code, { workspace: workspaceDir, executable, timeoutMs: 120000 });
      return text(result.stdout || result.stderr || "(no output)", { exitCode: result.exitCode });
    }),
  ];
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
    defineTool("generate_dashboard", canonicalTool("generate_dashboard").description, Type.Object({ operation: Type.Union([Type.Literal("create"), Type.Literal("edit"), Type.Literal("validate")]), mode: Type.Union([Type.Literal("static"), Type.Literal("semantic")]), version: Type.Union([Type.Literal("v3"), Type.Literal("v4")]), spec: Type.Unknown(), editPath: Type.Optional(Type.String()) }), async (p) => {
      const validated = validateDashboardV4Spec(p.spec);
      if (!validated.ok) throw new Error(`DASHBOARD_SPEC_INVALID: ${validated.errors.join("; ")}`);
      if (p.operation === "validate") return text("dashboard spec valid");
      const target = p.editPath ?? `dashboards/${Date.now()}-semantic.html`;
      const html = renderSemanticDashboardHtml(validated.spec, { nonce: randomUUID().replace(/-/g, ""), expectedOrigin: "https://data-agent.local" });
      await deps.workspace.write(target, html);
      deps.emitArtifact?.(target);
      return text(`dashboard written to ${target}`);
    }),
    defineTool("show_widget", canonicalTool("show_widget").description, Type.Object({ kind: Type.Union([Type.Literal("kpi"), Type.Literal("chart"), Type.Literal("table"), Type.Literal("steps")]), spec: Type.Unknown() }), async (p, native) => {
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
    }),
  );
  if (deps.queryExecutor) {
    const runQuery = async (sql: string, limit?: number) => {
      const result = await deps.queryExecutor!.run(sql, limit ?? DEFAULT_ROW_LIMIT);
      const header = result.columns.join(" | ");
      const body = result.rows.map((row) => row.map((cell) => String(cell ?? "NULL")).join(" | ")).join("\n");
      return text(`${header}\n${body}${result.truncated ? `\n(truncated at ${result.rows.length} rows)` : ""}`, { columns: result.columns, rows: result.rows });
    };
    tools.push(
      defineTool("query_database", canonicalTool("query_database").description, Type.Object({ sql: Type.String({ minLength: 1 }), limit: Type.Optional(Type.Number()) }), async (p) => runQuery(p.sql, p.limit)),
      defineTool("export_query", canonicalTool("export_query").description, Type.Object({ sql: Type.String({ minLength: 1 }), filename: Type.Optional(Type.String()) }), async (p, native) => {
        const signal = native.signal;
        const target = p.filename ?? `exports/query-${Date.now()}.csv`;
        let rowCount = 0;
        await deps.workspace.writeStream(target, async (write) => {
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
            if (!headerWritten) {
              await append(batch.columns.map(csvHeaderField).join(","));
              headerWritten = true;
            }
            for (const row of batch.rows) {
              throwIfAborted(signal);
              await append(`\n${row.map(csvField).join(",")}`);
              rowCount++;
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
          if (pending) await write(pending);
        }, signal);
        // The artifact is observable only after the temporary file was promoted.
        deps.emitArtifact?.(target);
        return text(`exported ${rowCount} rows to ${target}`);
      }),
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

export const DATA_AGENT_SYSTEM_PROMPT = [
  "你是 Data Agent，一个数据分析助手。",
  "你可以使用工作区文件、Python、知识库和数据库工具来回答数据分析问题。",
  "查询数据库时使用 query_database 工具执行只读 SQL；需要导出完整结果时使用 export_query。",
  "涉及公司、行业、月份等业务条件时，先参考知识库中的业务口径（search_knowledge），再编写 SQL。",
  "回答使用用户提问的语言，结论先行、证据随后，结构化输出。",
].join("\n");

/** Legacy → canonical tool-name mapping appended to the migrated SYSTEM.md. */
export const TOOL_NAME_MAPPING = [
  "## 工具名映射（当前运行时）",
  "",
  "本运行时的规范工具名与上文历史名称不同，一律使用下表当前名：",
  "",
  "| 历史名称（本文档中的） | 当前工具名 |",
  "|---|---|",
  "| execute_sql | query_database（只读预览，默认 50 行） |",
  "| export_sql_to_csv | export_query（全量导出 CSV 到工作区） |",
  "| search_knowledge / search_past_learnings | search_knowledge |",
  "| read_knowledge_file | read_knowledge |",
  "| edit_knowledge_file / write_knowledge_file / save_learning | update_knowledge（append_learning 追加 doc/learning/） |",
  "| activate_skill | load_skill |",
  "| read_workspace_file / write_workspace_file | read_file / write_file |",
  "| introspect_database / list_tables / get_table_schema | 先 search_knowledge 查 doc/db_schema.md，再用 query_database 试探 |",
  "| build_dashboard / add_chart / remove_chart | generate_dashboard |",
  "| semantic_sl_discover / semantic_sl_query | 语义模型清单见知识库；执行用 query_database |",
  "",
  "数据库为 MySQL 业务库：系统表查询用 `SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()`，禁止使用 sqlite_master。",
].join("\n");

/**
 * Resolves the versioned system prompt: the migrated `.pi/SYSTEM.md`
 * (ticket #12 source of truth) plus the tool-name mapping; falls back to the
 * built-in short prompt only when no migrated file exists.
 */
export async function resolveSystemPrompt(searchRoots: string[]): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  for (const root of searchRoots) {
    if (!root) continue;
    try {
      const migrated = await readFile(path.join(root, ".pi", "SYSTEM.md"), "utf8");
      return `${migrated.trim()}\n\n${TOOL_NAME_MAPPING}`;
    } catch { /* try next root */ }
  }
  return DATA_AGENT_SYSTEM_PROMPT;
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
  let harness: DataAgentHarness | undefined;
  const tools = buildAgentTools({
    ...deps,
    invokeSkill: (name, additionalInstructions) => {
      if (!harness) throw new Error("NATIVE_SKILL_INVOCATION_UNAVAILABLE");
      return harness.skill(name, additionalInstructions);
    },
  });
  harness = new DataAgentHarness({
    session: await new InMemorySessionRepo().create(),
    models,
    model: buildModel(profile),
    thinkingLevel: "off",
    systemPrompt: deps.systemPrompt ?? await resolveSystemPrompt(deps.systemPromptRoots ?? (deps.knowledgeRoot ? [deps.knowledgeRoot] : [])),
    tools,
    resources: { skills: skillLoad.skills },
    toolContext: deps.toolContext ?? { sessionId: deps.sessionId },
  });
  return harness;
}
