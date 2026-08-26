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
