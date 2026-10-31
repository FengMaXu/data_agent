import { describe, expect, it } from "vitest";
import { createMcpPluginToolDefinitions, type McpPluginTool } from "./mcp-plugins.js";

const tool = (name: string, result = { text: "ok", isError: false }): McpPluginTool & { calls: unknown[] } => {
  const calls: unknown[] = [];
  return {
    calls,
    plugin: "qcc",
    name,
    description: "查询企业\n工商信息",
    inputSchema: { type: "object", properties: { keyword: { type: "string" } }, required: ["keyword"] },
    call: async (args) => { calls.push(args); return result; },
  };
};

describe("MCP plugin tools", () => {
  it("labels results as external and never as query results", async () => {
    const search = tool("qcc_company__search");
    const [definition] = createMcpPluginToolDefinitions([search]);
    expect(definition!.tool).toMatchObject({ name: "qcc_company__search", replay: "never", description: "[外部插件 qcc] 查询企业\n工商信息" });
    expect(definition!.tool.parameters).toMatchObject({ type: "object", required: ["keyword"] });
    const result = await definition!.tool.execute("call-1", { keyword: "腾讯" }, () => undefined, { sessionId: "s", principalId: "u" }, {} as never, {} as never);
    expect(search.calls).toEqual([{ keyword: "腾讯" }]);
    expect((result.content[0] as { text: string }).text).toBe("[PLUGIN_RESULT plugin=qcc] 以下内容来自外部插件「qcc」，不是数据库查询结果。\nok");
  });

  it("passes a plugin error on as a labelled result", async () => {
    const [definition] = createMcpPluginToolDefinitions([tool("qcc_risk__check", { text: "quota exceeded", isError: true })]);
    const result = await definition!.tool.execute("call-2", { keyword: "x" }, () => undefined, { sessionId: "s", principalId: "u" }, {} as never, {} as never);
    expect((result.content[0] as { text: string }).text).toMatch(/^\[PLUGIN_TOOL_ERROR plugin=qcc\][\s\S]*quota exceeded$/);
  });

  it("states the external-data rule once per plugin, on a one-line snippet", () => {
    const definitions = createMcpPluginToolDefinitions([tool("qcc_company__a"), tool("qcc_company__b")]);
    expect(definitions.map((definition) => definition.promptGuidelines.length)).toEqual([1, 0]);
    expect(definitions[0]!.promptSnippet).toBe("外部插件「qcc」：查询企业 工商信息");
  });
});
