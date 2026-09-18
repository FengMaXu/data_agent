import { Type } from "typebox";
import { randomUUID } from "node:crypto";
import type { AgentHarnessTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { DEFAULT_KNOWLEDGE_RESULTS, formatKnowledgeSearchResults, MAX_KNOWLEDGE_RESULTS, type KnowledgeIndex } from "../knowledge.js";
import { materializeDashboardV3Spec, renderStandaloneDashboardHtml, validateDashboardV3Spec } from "../dashboard-v3.js";
import { renderSemanticDashboardHtml, validateDashboardV4Spec } from "../dashboard-v4.js";
import { KnowledgeWriter } from "../knowledge-write.js";
import { runPythonJob } from "../python-job.js";
import type { WorkspaceStore } from "../workspace.js";
import { validateWidgetSpec, widgetLegacyText, type WidgetPayload } from "../widget.js";
import type { DataAgentToolContext } from "./answering.js";
import type { ClarificationDialogs } from "../facets/clarification-dialogs.js";

function text(content: string, details?: unknown): AgentToolResult<unknown> {
  return { content: [{ type: "text", text: content }], details: details ?? null };
}

export interface CoreToolOptions {
  readonly workspace: WorkspaceStore;
  readonly knowledge?: KnowledgeIndex;
  readonly knowledgeRoot?: string;
  readonly pythonExecutable?: string | (() => string | undefined);
  readonly skills?: readonly { readonly name: string; readonly description: string; readonly content: string }[];
  readonly enableDashboards?: boolean;
  readonly enableWidgets?: boolean;
  readonly clarifications?: Pick<ClarificationDialogs, "ask">;
}

function executableOf(source: CoreToolOptions["pythonExecutable"]): string | undefined {
  return typeof source === "function" ? source() : source;
}


export function createCoreAgentTools(options: CoreToolOptions): readonly AgentHarnessTool<DataAgentToolContext>[] {
  const tools: AgentHarnessTool<DataAgentToolContext>[] = [
    {
      name: "list_workspace",
      label: "list_workspace",
      description: "List files in the current session workspace.",
      replay: "safe",
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute() { return text((await options.workspace.list()).join("\n") || "(workspace empty)"); },
    },
    {
      name: "read_file",
      label: "read_file",
      description: "Read a workspace file with an optional one-based inclusive line range.",
      replay: "safe",
      parameters: Type.Object({ path: Type.String({ minLength: 1 }), startLine: Type.Optional(Type.Integer({ minimum: 1 })), endLine: Type.Optional(Type.Integer({ minimum: 1 })) }, { additionalProperties: false }),
      async execute(_toolCallId, input) {
        const value = input as { path: string; startLine?: number; endLine?: number };
        const read = await options.workspace.readRange(value.path, {
          ...(value.startLine !== undefined ? { startLine: value.startLine } : {}),
          ...(value.endLine !== undefined ? { endLine: value.endLine } : {}),
        });
        return text(read.content, { path: value.path, truncated: read.truncated });
      },
    },
    {
      name: "write_file",
      label: "write_file",
      description: "Write a file inside the current session workspace.",
      replay: "never",
      parameters: Type.Object({ path: Type.String({ minLength: 1 }), content: Type.String() }, { additionalProperties: false }),
      async execute(_toolCallId, input) {
        const value = input as { path: string; content: string };
        await options.workspace.write(value.path, value.content);
        return text(`written ${value.path} (${value.content.length} bytes)`);
      },
    },
  ];

  if (options.knowledge) {
    const knowledge = options.knowledge;
    tools.push(
      {
        name: "search_knowledge",
        label: "search_knowledge",
        description: "Search the selected Markdown knowledge sources and return bounded relevant content. Search results include source, section, location, score, and content reference; use read_knowledge only when more context is needed.",
        replay: "safe",
        parameters: Type.Object({
          query: Type.String({ minLength: 1 }),
          knowledgeIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 8 })),
          maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_KNOWLEDGE_RESULTS })),
        }, { additionalProperties: false }),
        async execute(_toolCallId, input) {
          const value = input as { query: string; knowledgeIds?: string[]; maxResults?: number };
          const allowed = value.knowledgeIds ? new Set(value.knowledgeIds) : undefined;
          const requestedResults = value.maxResults ?? DEFAULT_KNOWLEDGE_RESULTS;
          const hits = knowledge.search(
            value.query,
            Math.min(requestedResults, MAX_KNOWLEDGE_RESULTS),
            (_relativePath, knowledgeId) => !allowed || allowed.has(knowledgeId),
          );
          const formatted = formatKnowledgeSearchResults(hits, requestedResults);
          return text(JSON.stringify(formatted), formatted);
        },
      },
      {
        name: "read_knowledge",
        label: "read_knowledge",
        description: "Read a knowledge document or one named section. Short documents may be returned in full; large documents require a sectionId. Do not calculate line ranges.",
        replay: "safe",
        parameters: Type.Object({
          knowledgeId: Type.String({ minLength: 1 }),
          sectionId: Type.Optional(Type.String({ minLength: 1 })),
          continuationToken: Type.Optional(Type.String({ minLength: 1 })),
        }, { additionalProperties: false }),
        async execute(_toolCallId, input) {
          const value = input as { knowledgeId: string; sectionId?: string; continuationToken?: string };
          const read = knowledge.read(value);
          return text(JSON.stringify(read), read);
        },
      },
    );
    if (options.knowledgeRoot) {
      const writer = new KnowledgeWriter(options.knowledgeRoot);
      tools.push({
        name: "update_knowledge",
        label: "update_knowledge",
        description: "Append learning or write a knowledge draft through the scoped knowledge capability.",
        replay: "never",
        parameters: Type.Object({ operation: Type.Union([Type.Literal("append_learning"), Type.Literal("write_draft"), Type.Literal("update_schema")]), path: Type.String({ minLength: 1 }), content: Type.String() }, { additionalProperties: false }),
        async execute(_toolCallId, input) {
          const value = input as { operation: "append_learning" | "write_draft" | "update_schema"; path: string; content: string };
          const written = await writer.write(value.operation, value.path, value.content);
          return text(`${written.operation} -> ${written.path} (${written.bytesWritten} bytes)`);
        },
      });
    }
  }

  if (options.pythonExecutable) {
    tools.push({
      name: "run_python",
      label: "run_python",
      description: "Execute Python analysis in the current session workspace.",
      replay: "never",
      parameters: Type.Object({ code: Type.String({ minLength: 1 }), description: Type.Optional(Type.String()) }, { additionalProperties: false }),
      async execute(_toolCallId, input, _onUpdate, toolContext, _invocation, context) {
        const executable = executableOf(options.pythonExecutable);
        if (!executable) throw new Error("PYTHON_RUNTIME_NOT_AVAILABLE");
        const value = input as { code: string; description?: string };
        const job = await runPythonJob(value.code, { workspace: options.workspace.root, executable, timeoutMs: 120_000, ...(context.abortSignal ? { signal: context.abortSignal } : {}) });
        return text(job.stdout || job.stderr || "(no output)", { status: job.status, jobId: job.jobId, artifacts: job.artifacts, sessionId: toolContext?.sessionId });
      },
    });
  }

  if (options.clarifications) {
    tools.push({
      name: "ask_user_clarification",
      label: "ask_user_clarification",
      description: "Ask the user one structured clarification and wait for the Session-owned answer.",
      replay: "never",
      parameters: Type.Object({ question: Type.String({ minLength: 1 }), options: Type.Optional(Type.Array(Type.String())) }, { additionalProperties: false }),
      async execute(_toolCallId, input, _onUpdate, toolContext) {
        const value = input as { question: string; options?: string[] };
        const request = options.clarifications!.ask(toolContext?.sessionId ?? "", value.question, value.options ?? []);
        const answer = await request.promise;
        return text(answer, { clarificationId: request.clarificationId });
      },
    });
  }

  tools.push({
    name: "load_skill",
    label: "load_skill",
    description: "Load a discovered skill without starting a nested Agent operation.",
    replay: "safe",
    parameters: Type.Object({ name: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    async execute(_toolCallId, input) {
      const name = (input as { name: string }).name;
      const skill = options.skills?.find((item) => item.name === name);
      if (!skill) throw new Error(`SKILL_NOT_FOUND: ${name}`);
      return text(skill.content, { nativeSkill: name });
    },
  });

  if (options.enableDashboards !== false) {
    tools.push({
      name: "generate_dashboard",
      label: "generate_dashboard",
      description: "Validate or generate a dashboard in the current workspace.",
      replay: "never",
      parameters: Type.Object({ operation: Type.Union([Type.Literal("create"), Type.Literal("edit"), Type.Literal("validate")]), mode: Type.Union([Type.Literal("static"), Type.Literal("semantic")]), version: Type.Union([Type.Literal("v3"), Type.Literal("v4")]), spec: Type.Unknown(), editPath: Type.Optional(Type.String({ minLength: 1 })) }, { additionalProperties: false }),
      async execute(_toolCallId, input) {
        const value = input as { operation: "create" | "edit" | "validate"; mode: "static" | "semantic"; version: "v3" | "v4"; spec: unknown; editPath?: string };
        let html: string;
        let fileName: string;
        if (value.mode === "static" && value.version === "v3") {
          const materialized = await materializeDashboardV3Spec(value.spec, options.workspace);
          const validated = validateDashboardV3Spec(materialized);
          if (!validated.ok) throw new Error(`DASHBOARD_SPEC_INVALID: ${validated.errors.join("; ")}`);
          if (value.operation === "validate") return text("dashboard spec valid");
          fileName = value.editPath ?? `dashboards/${validated.spec.filename?.replace(/\.html$/i, "") || Date.now()}.html`;
          html = await renderStandaloneDashboardHtml(validated.spec);
        } else if (value.mode === "semantic" && value.version === "v4") {
          const validated = validateDashboardV4Spec(value.spec);
          if (!validated.ok) throw new Error(`DASHBOARD_SPEC_INVALID: ${validated.errors.join("; ")}`);
          if (value.operation === "validate") return text("dashboard spec valid");
          fileName = value.editPath ?? `dashboards/${Date.now()}-semantic.html`;
          html = renderSemanticDashboardHtml(validated.spec, { nonce: randomUUID().replaceAll("-", ""), expectedOrigin: "https://data-agent.local" });
        } else {
          throw new Error("DASHBOARD_MODE_VERSION_MISMATCH");
        }
        await options.workspace.write(fileName, html);
        return text(`[DASHBOARD_CREATED] ${fileName}`, { relativePath: fileName, fileType: "html" });
      },
    });
  }

  if (options.enableWidgets !== false) {
    tools.push({
      name: "show_widget",
      label: "show_widget",
      description: "Render a structured widget for the Presentation layer.",
      replay: "never",
      parameters: Type.Object({ kind: Type.Union([Type.Literal("kpi"), Type.Literal("chart"), Type.Literal("table"), Type.Literal("steps")]), spec: Type.Unknown() }, { additionalProperties: false }),
      async execute(toolCallId, input) {
        const value = input as { kind: WidgetPayload["kind"]; spec: unknown };
        const validation = validateWidgetSpec(value.kind, value.spec);
        if (!validation.ok) throw new Error(`WIDGET_SPEC_INVALID: ${validation.error}`);
        const widget: WidgetPayload = { ...validation.spec, widget_id: `widget-${toolCallId}`, kind: value.kind, title: typeof validation.spec.title === "string" && validation.spec.title.trim() ? validation.spec.title : `${value.kind} widget`, tool_call_id: toolCallId };
        return text(widgetLegacyText(widget), { widgetEvent: "widget", widgetId: `widget-${toolCallId}`, toolCallId, toolName: "show_widget", widget });
      },
    });
  }

  return tools;
}
