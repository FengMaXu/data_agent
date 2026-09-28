import { describe, expect, it } from "vitest";
import { AgentHarness, MemorySessionRepo, TODO_CONTEXT, type AgentHarnessTool } from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { Type } from "typebox";
import { defineDataAgentTool, type DataAgentToolDefinition } from "../tools/tool-definition.js";
import { ToolPromptCatalog } from "./tool-prompt-catalog.js";
import { withToolPromptCatalog } from "./tool-prompt-models.js";

function definition(name: string, guideline = `守则 ${name}`): DataAgentToolDefinition<undefined> {
  const tool: AgentHarnessTool<undefined> = {
    name,
    label: name,
    description: `test ${name}`,
    replay: "safe",
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute() {
      return { content: [{ type: "text", text: "ok" }], details: null };
    },
  };
  return defineDataAgentTool(tool, { promptSnippet: `能力 ${name}`, promptGuidelines: [guideline, guideline] });
}

describe("ToolPromptCatalog", () => {
  it("renders a deterministic selected subset and deduplicates local guidelines", () => {
    const catalog = new ToolPromptCatalog([definition("z"), definition("a")]);
    expect(catalog.render(["z", "a"])).toBe([
      "## 当前可用工具",
      "- `a`：能力 a",
      "- `z`：能力 z",
      "",
      "## 工具使用守则",
      "- `a`：守则 a",
      "- `z`：守则 z",
    ].join("\n"));
    expect(catalog.render([])).toBe("");
  });

  it("rejects malformed, duplicate, or unknown definitions and active names", () => {
    expect(() => new ToolPromptCatalog([{ ...definition("bad"), promptSnippet: "" }])).toThrow("TOOL_PROMPT_SNIPPET_INVALID");
    expect(() => new ToolPromptCatalog([{ ...definition("bad"), promptGuidelines: ["two\nlines"] }])).toThrow("TOOL_PROMPT_GUIDELINE_INVALID");
    expect(() => new ToolPromptCatalog([definition("same"), definition("same")])).toThrow("TOOL_PROMPT_DUPLICATE_DEFINITION");
    const catalog = new ToolPromptCatalog([definition("known")]);
    expect(() => catalog.render(["missing"])).toThrow("TOOL_PROMPT_UNKNOWN_ACTIVE_TOOL");
    expect(() => catalog.render(["known", "known"])).toThrow("TOOL_PROMPT_DUPLICATE_ACTIVE_TOOL");
  });

  it("takes an immutable snapshot of definitions", () => {
    const definitions = [definition("one")];
    const catalog = new ToolPromptCatalog(definitions);
    definitions[0] = definition("two");
    expect(catalog.render(["one"])).toContain("`one`");
    expect(() => catalog.render(["two"])).toThrow("TOOL_PROMPT_UNKNOWN_ACTIVE_TOOL");
  });
});

describe("withToolPromptCatalog", () => {
  it("uses the exact downstream Context.tools snapshot without mutating the base Context", async () => {
    const faux = fauxProvider({ provider: "tool-prompt-adapter", models: [{ id: "model" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const a = definition("a");
    const b = definition("b");
    const catalog = new ToolPromptCatalog([a, b]);
    let downstream: Context | undefined;
    let downstreamMaxTokens: number | undefined;
    faux.setResponses([async (context, options) => {
      downstream = context;
      downstreamMaxTokens = options?.maxTokens;
      return fauxAssistantMessage("ok");
    }]);
    const wrapped = withToolPromptCatalog(models, catalog);
    expect(wrapped.getProvider(faux.provider)).toBe(models.getProvider(faux.provider));
    const base: Context = { systemPrompt: "BASE", messages: [], tools: [b.tool, a.tool] };
    await wrapped.streamSimple(faux.models[0], base, { maxTokens: 17 }).result();
    expect(downstream?.tools?.map((tool) => tool.name)).toEqual(["b", "a"]);
    expect(downstream?.systemPrompt).toContain("`a`");
    expect(downstream?.systemPrompt).toContain("`b`");
    expect(downstream?.systemPrompt).toMatch(/`a`[\s\S]*`b`/u);
    expect(downstream?.messages).toBe(base.messages);
    expect(downstream?.tools).toBe(base.tools);
    expect(base.systemPrompt).toBe("BASE");
    expect(downstreamMaxTokens).toBe(17);
  });

  it("does not add a directory to no-tool requests or accumulate it across retries", async () => {
    const faux = fauxProvider({ provider: "tool-prompt-repeat", models: [{ id: "model" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const a = definition("a");
    const catalog = new ToolPromptCatalog([a]);
    const prompts: string[] = [];
    faux.setResponses([async (context) => { prompts.push(context.systemPrompt ?? ""); return fauxAssistantMessage("one"); }, async (context) => { prompts.push(context.systemPrompt ?? ""); return fauxAssistantMessage("two"); }, async (context) => { prompts.push(context.systemPrompt ?? ""); return fauxAssistantMessage("three"); }]);
    const wrapped = withToolPromptCatalog(models, catalog);
    const base: Context = { systemPrompt: "BASE", messages: [] };
    await wrapped.streamSimple(faux.models[0], base).result();
    await wrapped.streamSimple(faux.models[0], { ...base, tools: [a.tool] }).result();
    await wrapped.streamSimple(faux.models[0], { ...base, tools: [a.tool] }).result();
    expect(prompts[0]).toBe("BASE");
    expect(prompts[1]).toBe(prompts[2]);
    expect(prompts[2].match(/## 当前可用工具/gu)).toHaveLength(1);
  });

  it("keeps catalogs isolated for concurrent sessions", async () => {
    const faux = fauxProvider({ provider: "tool-prompt-concurrent", models: [{ id: "model" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const firstTool = definition("shared", "first-only");
    const secondTool = definition("shared", "second-only");
    const prompts: string[] = [];
    faux.setResponses([
      async (context) => { prompts.push(context.systemPrompt ?? ""); return fauxAssistantMessage("first"); },
      async (context) => { prompts.push(context.systemPrompt ?? ""); return fauxAssistantMessage("second"); },
    ]);
    const first = withToolPromptCatalog(models, new ToolPromptCatalog([firstTool]));
    const second = withToolPromptCatalog(models, new ToolPromptCatalog([secondTool]));
    await Promise.all([
      first.streamSimple(faux.models[0], { systemPrompt: "FIRST", messages: [], tools: [firstTool.tool] }).result(),
      second.streamSimple(faux.models[0], { systemPrompt: "SECOND", messages: [], tools: [secondTool.tool] }).result(),
    ]);
    expect(prompts.some((prompt) => prompt.startsWith("FIRST") && prompt.includes("first-only"))).toBe(true);
    expect(prompts.some((prompt) => prompt.startsWith("SECOND") && prompt.includes("second-only"))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes("first-only") && prompt.includes("second-only"))).toBe(false);
  });

  it("works through a real AgentHarness request and follows the active tool set", async () => {
    const faux = fauxProvider({ provider: "tool-prompt-harness", models: [{ id: "model" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const a = definition("a");
    const b = definition("b");
    const catalog = new ToolPromptCatalog([a, b]);
    let downstream: Context | undefined;
    faux.setResponses([async (context) => {
      downstream = context;
      return fauxAssistantMessage("done");
    }]);
    const session = await new MemorySessionRepo().create({}, TODO_CONTEXT);
    const created = await AgentHarness.create({
      session,
      models: withToolPromptCatalog(models, catalog),
      model: faux.models[0],
      systemPrompt: "BASE",
      tools: [a.tool, b.tool],
      activeToolNames: ["b"],
    }, TODO_CONTEXT);
    try {
      const lane = await created.harness.lane("main", TODO_CONTEXT);
      const accepted = await lane.accept({ kind: "prompt", prompt: "finish" }, TODO_CONTEXT);
      expect(accepted.ok).toBe(true);
      if (!accepted.ok) throw accepted.error;
      const driven = await lane.drive({ operationId: accepted.value.operationId }, TODO_CONTEXT);
      expect(driven.ok).toBe(true);
      expect(downstream?.tools?.map((tool) => tool.name)).toEqual(["b"]);
      expect(downstream?.systemPrompt).toContain("`b`");
      expect(downstream?.systemPrompt).not.toContain("`a`");
    } finally {
      await created.harness.close(TODO_CONTEXT);
    }
  });
});
