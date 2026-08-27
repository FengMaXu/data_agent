import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { DataAgentRuntime } from "./index.js";
import { MetadataStore } from "./metadata.js";

describe("DataAgentRuntime", () => {
  it("dispatches a versioned runtime probe and emits a product event", async () => {
    const runtime = new DataAgentRuntime();
    const events: unknown[] = [];
    runtime.subscribe((event) => events.push(event));
    const result = await runtime.dispatch({ protocolVersion: 1, requestId: "req-1", command: { type: "runtime.probe" } }, { userId: "local", host: "electron" });
    expect(result.response.type).toBe("runtime.probe.result");
    expect(events).toHaveLength(1);
    expect(runtime.eventsAfter(0)).toHaveLength(1);
    expect(runtime.eventsAfter(1)).toHaveLength(0);
  });

  it("emits a distinct renderer message for each assistant turn", async () => {
    let receive: ((event: unknown) => void) | undefined;
    const agent = {
      subscribe(listener: (event: unknown) => void) { receive = listener; return () => undefined; },
      async prompt() {
        receive?.({ type: "message_start", message: { role: "user", content: "question" } });
        receive?.({ type: "message_start", message: { role: "assistant" } });
        receive?.({ type: "tool_execution_start", toolCallId: "call-1", toolName: "query", args: { sql: "select 1" } });
        receive?.({ type: "tool_execution_end", toolCallId: "call-1", toolName: "query", result: "ok", isError: false });
        receive?.({ type: "message_start", message: { role: "toolResult", content: [] } });
        receive?.({ type: "message_start", message: { role: "assistant" } });
      },
      abort() { return undefined; },
    };
    const runtime = new DataAgentRuntime({ agent });
    await runtime.dispatch({ protocolVersion: 1, requestId: "turns", command: { type: "agent.prompt", prompt: "question" } }, { userId: "local", host: "electron" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const events = runtime.eventsAfter(0).map((envelope) => envelope.event);
    const starts = events.filter((event) => event.type === "agent.message_started");
    expect(starts).toHaveLength(2);
    expect(starts[0].messageId).not.toBe(starts[1].messageId);
    expect(events.filter((event) => event.type === "agent.tool_started")).toHaveLength(1);
  });

  it("keeps tool arguments on completion events, including legacy and empty-args completions", async () => {
    let receive: ((event: unknown) => void) | undefined;
    const agent = {
      subscribe(listener: (event: unknown) => void) { receive = listener; return () => undefined; },
      async prompt() {
        receive?.({ type: "tool_execution_start", toolCallId: "call-sql", toolName: "query", args: { sql: "select 1" } });
        receive?.({ type: "tool_execution_end", toolCallId: "call-sql", toolName: "query", args: { sql: "select 1" }, result: { rows: [] }, isError: false });
        receive?.({ type: "tool_execution_start", toolCallId: "call-file", toolName: "read_file", args: { path: "report.csv" } });
        receive?.({ type: "tool_execution_end", toolCallId: "call-file", toolName: "read_file", result: "contents", isError: false });
        receive?.({ type: "tool_execution_start", toolCallId: "call-skill", toolName: "load_skill", args: { name: "analysis" } });
        receive?.({ type: "tool_execution_end", toolCallId: "call-skill", toolName: "load_skill", args: {}, result: "ok", isError: false });
      },
      abort() { return undefined; },
    };
    const runtime = new DataAgentRuntime({ agent });
    await runtime.dispatch({ protocolVersion: 1, requestId: "req-tools", command: { type: "agent.prompt", prompt: "inspect" } }, { userId: "local", host: "electron" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const toolEvents = runtime.eventsAfter(0)
      .map((envelope) => envelope.event)
      .filter((event) => event.type === "agent.tool_finished");
    expect(toolEvents).toEqual([
      expect.objectContaining({ toolCallId: "call-sql", args: { sql: "select 1" } }),
      expect.objectContaining({ toolCallId: "call-file" }),
      expect.objectContaining({ toolCallId: "call-skill", args: {} }),
    ]);
    expect(toolEvents[1]).not.toHaveProperty("args");
  });

  it("passes the requested session to queued agent operations", async () => {
    let received: { prompt: string; context?: { sessionId?: string } } | undefined;
    const runtime = new DataAgentRuntime({
      agent: {
        prompt: async () => undefined,
        steer: (prompt, context) => { received = { prompt, context }; },
        abort: () => undefined,
      },
    });
    await runtime.dispatch({ protocolVersion: 1, requestId: "steer", sessionId: "session-7", command: { type: "agent.steer", prompt: "continue" } }, { userId: "local", host: "electron", sessionId: "session-7" });
    expect(received).toEqual({ prompt: "continue", context: { sessionId: "session-7" } });
  });

  it("keeps terminal agent events correlated to the requested session", async () => {
    const runtime = new DataAgentRuntime({ agent: { prompt: async () => undefined, abort: () => undefined } });
    await runtime.dispatch({ protocolVersion: 1, requestId: "session-run", sessionId: "session-1", command: { type: "agent.prompt", prompt: "hello" } }, { userId: "local", host: "electron", sessionId: "session-1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.eventsAfter(0).at(-1)).toMatchObject({ sessionId: "session-1", event: { type: "agent.completed" } });
  });

  it("rejects an unsupported protocol version", async () => {
    const runtime = new DataAgentRuntime();
    await expect(runtime.dispatch({ protocolVersion: 99, requestId: "req-1", command: { type: "runtime.probe" } }, { userId: "local", host: "electron" })).rejects.toMatchObject({ code: "UNSUPPORTED_PROTOCOL_VERSION" });
  });

  it("refreshes native Skill resources when skills are listed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "data-agent-runtime-skills-"));
    const skillDir = join(dir, "refreshable");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: refreshable\ndescription: refresh test\n---\nbody", "utf8");
    await mkdir(join(dir, "broken"), { recursive: true });
    await writeFile(join(dir, "broken", "SKILL.md"), "not a skill", "utf8");
    let resources: any = {};
    const agent = {
      prompt: async () => ({}),
      abort: () => undefined,
      getResources: () => resources,
      setResources: async (next: any) => { resources = next; },
    };
    const runtime = new DataAgentRuntime({ agent, skillRoots: [dir] });
    const result = await runtime.dispatch({ protocolVersion: 1, requestId: "skills", command: { type: "skills.list" } }, { userId: "local", host: "electron" });
    expect((result.response as any).skills).toEqual([{ name: "refreshable", description: "refresh test", tools: [] }]);
    expect((result.response as any).diagnostics.length).toBeGreaterThan(0);
    expect(resources.skills[0].content).toBe("body");
    await rm(dir, { recursive: true, force: true });
  });

  it("rejects knowledge paths that only share a root-name prefix", async () => {
    const dir = await mkdtemp(join(tmpdir(), "data-agent-knowledge-path-"));
    const root = join(dir, "knowledge");
    const metadata = new MetadataStore(join(dir, "app.db"));
    const runtime = new DataAgentRuntime({ metadata, knowledgeRoot: root });
    await expect(runtime.dispatch({ protocolVersion: 1, requestId: "escape", command: { type: "knowledge.save", path: "../knowledge-evil/escape.md", content: "nope" } }, { userId: "local", host: "electron" })).rejects.toMatchObject({ code: "INVALID_COMMAND" });
    await expect(runtime.dispatch({ protocolVersion: 1, requestId: "system", command: { type: "knowledge.save", path: ".pi\\SYSTEM.md", content: "nope" } }, { userId: "local", host: "electron" })).rejects.toMatchObject({ code: "INVALID_COMMAND" });
    await metadata.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps desktop LLM secrets out of Runtime metadata responses", async () => {
    const dir = await mkdtemp(join(tmpdir(), "data-agent-desktop-config-"));
    const metadata = new MetadataStore(join(dir, "app.sqlite3"));
    const runtime = new DataAgentRuntime({ metadata, pythonExecutable: "bundled-python", bundledPythonExecutable: "bundled-python" });
    const command = {
      protocolVersion: 1 as const,
      requestId: "desktop-config",
      command: {
        type: "config.save" as const,
        patch: { provider: "openai", model: "test", api_key: "secret", python_runtime: { mode: "external", executable: "custom-python" } },
      },
    };
    const saved = await runtime.dispatch(command, { userId: "local", host: "electron" });
    expect((saved.response as { config?: Record<string, unknown> }).config).toEqual({ provider: "openai", model: "test", python_runtime: { mode: "external", executable: "custom-python" } });
    const stored = await metadata.getConfig("ui.settings");
    expect(stored).toEqual({ provider: "openai", model: "test", python_runtime: { mode: "external", executable: "custom-python" } });
    expect(runtime.pythonExecutablePath).toBe("custom-python");
    await runtime.dispatch({ protocolVersion: 1, requestId: "desktop-config-bundled", command: { type: "config.save", patch: { python_runtime: { mode: "bundled" } } } }, { userId: "local", host: "electron" });
    expect(runtime.pythonExecutablePath).toBe("bundled-python");
    await metadata.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("persists task and session metadata through the worker", async () => {
    const dir = await mkdtemp(join(tmpdir(), "data-agent-runtime-"));
    const metadata = new MetadataStore(join(dir, "app.sqlite3"));
    const runtime = new DataAgentRuntime({ metadata });
    const context = { userId: "local", host: "electron" as const };
    const task = await runtime.dispatch({ protocolVersion: 1, requestId: "task", command: { type: "task.create", name: "Analysis" } }, context);
    const taskId = (task.response as { item: { id: string } }).item.id;
    const listed = await runtime.dispatch({ protocolVersion: 1, requestId: "list", command: { type: "task.list" } }, context);
    expect((listed.response as { items: unknown[] }).items).toHaveLength(1);
    await runtime.dispatch({ protocolVersion: 1, requestId: "session", command: { type: "session.create", taskId, name: "First" } }, context);
    await metadata.close();
    await rm(dir, { recursive: true, force: true });
  });
});
