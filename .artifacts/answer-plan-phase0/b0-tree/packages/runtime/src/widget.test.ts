import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { DataAgentEventEnvelopeSchema } from "@data-agent/contracts";
import { buildAgentTools } from "./agent-assembly.js";
import { DataAgentRuntime } from "./index.js";

const workspace = { root: "/tmp/widget-test", list: async () => [], read: async () => "", write: async () => undefined } as any;
const context = { userId: "local", host: "electron" as const };

describe("native Widget lifecycle", () => {
  it("passes native execution context and preserves extra widget fields", async () => {
    const updates: any[] = [];
    const tool = buildAgentTools({ workspace }).find((candidate) => candidate.name === "show_widget")!;
    const result = await tool.execute("call-kpi", {
      kind: "kpi",
      spec: { value: 42, label: "Revenue", extra_field: "retained" },
    } as any, undefined, (update) => updates.push(update), { sessionId: "session-1" });

    expect(updates[0].details.widgetId).toBe("widget-call-kpi");
    expect((result.details as any).widget.widget_id).toBe("widget-call-kpi");
    expect((result.details as any).widget.extra_field).toBe("retained");
    expect((result.details as any).widget.data[0].value).toBe(42);
  });

  it("validates the minimum shape for every current kind while retaining extra fields", async () => {
    const tool = buildAgentTools({ workspace }).find((candidate) => candidate.name === "show_widget")!;
    for (const kind of ["kpi", "chart", "table", "steps"] as const) {
      const spec = kind === "kpi" ? { value: 1, extra: true } : { data: [], extra: true };
      await expect(tool.execute(`valid-${kind}`, { kind, spec } as any, undefined, undefined, { sessionId: "session-1" })).resolves.toBeTruthy();
      await expect(tool.execute(`invalid-${kind}`, { kind, spec: { extra: true } } as any, undefined, undefined, { sessionId: "session-1" })).rejects.toThrow("WIDGET_SPEC_INVALID");
    }
  });

  it("maps create, patch, done, and terminal tool-finished events in order", async () => {
    let receive!: (event: any) => void;
    let finishPrompt!: () => void;
    const agent = {
      prompt: () => new Promise<void>((resolve) => { finishPrompt = resolve; }),
      abort: () => undefined,
      subscribe: (listener: (event: any) => void) => { receive = listener; return () => undefined; },
    };
    const runtime = new DataAgentRuntime({ agent });
    const events: any[] = [];
    runtime.subscribe((event) => events.push(event));
    await runtime.dispatch({ protocolVersion: 1, requestId: "req-widget", command: { type: "agent.prompt", prompt: "show KPI" } }, context);

    receive({ type: "message_start", message: { id: "message-1", role: "assistant" } });
    receive({ type: "tool_execution_start", toolCallId: "call-1", toolName: "show_widget", args: { kind: "kpi" } });
    receive({
      type: "tool_execution_update",
      toolCallId: "call-1",
      toolName: "show_widget",
      args: { kind: "kpi" },
      partialResult: { details: { widgetEvent: "widget", widgetId: "wrong-id", toolCallId: "call-1", toolName: "show_widget", widget: { widget_id: "wrong-id", kind: "kpi", title: "Revenue", value: 42, tool_call_id: "call-1" }, legacyText: "[widget:kpi] Revenue" } },
    });
    receive({
      type: "tool_execution_update",
      toolCallId: "call-1",
      toolName: "show_widget",
      args: { kind: "kpi" },
      partialResult: { details: { widgetEvent: "widget_patch", widgetId: "widget-call-1", toolCallId: "call-1", toolName: "show_widget", patch: { subtitle: "Today" }, legacyText: "[widget:kpi] Revenue" } },
    });
    receive({ type: "tool_execution_end", toolCallId: "call-1", toolName: "show_widget", result: { content: [{ type: "text", text: "[widget:kpi] Revenue" }] }, isError: false });
    finishPrompt();
    await Promise.resolve();

    const types = events.map((item) => item.event.type);
    expect(types).toEqual(["agent.message_started", "agent.tool_started", "widget", "widget_patch", "widget_done", "agent.tool_finished", "agent.completed"]);
    const widget = events.find((item) => item.event.type === "widget");
    expect(widget.event.widget.widget_id).toBe("widget-call-1");
    expect(events.every((item) => Value.Check(DataAgentEventEnvelopeSchema, item))).toBe(true);
  });

  it("emits widget_error before a failed terminal tool result without widget_done", async () => {
    let receive!: (event: any) => void;
    let finishPrompt!: () => void;
    const agent = { prompt: () => new Promise<void>((resolve) => { finishPrompt = resolve; }), abort: () => undefined, subscribe: (listener: (event: any) => void) => { receive = listener; return () => undefined; } };
    const runtime = new DataAgentRuntime({ agent });
    const events: any[] = [];
    runtime.subscribe((event) => events.push(event));
    await runtime.dispatch({ protocolVersion: 1, requestId: "req-error", command: { type: "agent.prompt", prompt: "bad widget" } }, context);
    receive({ type: "message_start", message: { id: "message-2", role: "assistant" } });
    receive({ type: "tool_execution_start", toolCallId: "call-2", toolName: "show_widget", args: {} });
    receive({ type: "tool_execution_end", toolCallId: "call-2", toolName: "show_widget", result: "WIDGET_SPEC_INVALID", isError: true });

    expect(events.map((item) => item.event.type)).toEqual(["agent.message_started", "agent.tool_started", "widget_error", "agent.tool_finished"]);
    expect(events.some((item) => item.event.type === "widget_done")).toBe(false);
    expect(events.at(-1).event.isError).toBe(true);
    finishPrompt();
  });
});
