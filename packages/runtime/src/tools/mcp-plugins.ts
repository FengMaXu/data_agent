import { Type } from "typebox";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { DataAgentToolContext } from "./answering.js";
import { defineDataAgentTool, type DataAgentToolDefinition } from "./tool-definition.js";

/** One tool of a connected MCP plugin, as the host's supervisor serves it. */
export interface McpPluginTool {
  readonly plugin: string;
  /** Unique across plugins; already prefixed with the plugin connection. */
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  call(args: Record<string, unknown>, options?: { readonly signal?: AbortSignal }): Promise<{ readonly text: string; readonly isError: boolean }>;
}

/** The host's MCP plugin supervisor: the settings view, connection control and the tools sessions get. */
export interface McpPluginPort {
  view(): Promise<unknown>;
  save(config: unknown): Promise<unknown>;
  status(): Promise<Array<{ name: string; enabled: boolean; connected: boolean; toolCount: number; hostManaged: boolean }>>;
  test(name: string): Promise<{ ok: boolean; message: string }>;
  restart(name: string): Promise<{ ok: boolean }>;
  tools(): Promise<readonly McpPluginTool[]>;
}

const MAX_SNIPPET = 120;
const EXTERNAL_GUIDELINE = "外部插件的结果不是数据库数据：不要用它代替 query_database 取数，也不能发布为查询结果；回答中使用时注明来自哪个插件。";

function oneLine(value: string, max: number): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function text(content: string, details?: unknown): AgentToolResult<unknown> {
  return { content: [{ type: "text", text: content }], details: details ?? null };
}

/**
 * The tools of the MCP plugins the user enabled. Their results are external
 * reference information, labelled with the plugin: Answering never admits
 * them as query results.
 */
export function createMcpPluginToolDefinitions(tools: readonly McpPluginTool[]): DataAgentToolDefinition<DataAgentToolContext>[] {
  const guided = new Set<string>();
  return tools.map((tool) => {
    const schema = tool.inputSchema.type === "object" ? tool.inputSchema : { type: "object", properties: {}, ...tool.inputSchema };
    const firstOfPlugin = !guided.has(tool.plugin);
    guided.add(tool.plugin);
    return defineDataAgentTool<DataAgentToolContext, ReturnType<typeof Type.Unsafe<Record<string, unknown>>>, unknown>({
      name: tool.name,
      label: tool.name,
      description: `[外部插件 ${tool.plugin}] ${tool.description}`,
      // A plugin call may have effects outside yourdb, so it is never replayed.
      replay: "never",
      parameters: Type.Unsafe<Record<string, unknown>>(schema),
      async execute(_toolCallId, input) {
        const result = await tool.call((input ?? {}) as Record<string, unknown>);
        const label = `[${result.isError ? "PLUGIN_TOOL_ERROR" : "PLUGIN_RESULT"} plugin=${tool.plugin}]`;
        return text(`${label} 以下内容来自外部插件「${tool.plugin}」，不是数据库查询结果。\n${result.text}`, { plugin: tool.plugin, isError: result.isError });
      },
    }, {
      promptSnippet: `外部插件「${tool.plugin}」：${oneLine(tool.description, MAX_SNIPPET)}`,
      promptGuidelines: firstOfPlugin ? [EXTERNAL_GUIDELINE] : [],
    });
  });
}
