import { describe, expect, it } from "vitest";
import { DataAgentRuntime } from "./index.js";

describe("agent commands", () => {
  it("rejects concurrent prompts and cross-session queue commands", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const runtime = new DataAgentRuntime({
      agent: {
        prompt: async () => pending,
        steer: () => undefined,
        followUp: () => undefined,
        abort: () => undefined,
      },
    });
    const firstContext = { userId: "local", host: "electron" as const, sessionId: "session-1" };
    await runtime.dispatch({ protocolVersion: 1, requestId: "first", sessionId: "session-1", command: { type: "agent.prompt", prompt: "first" } }, firstContext);
    await expect(runtime.dispatch({ protocolVersion: 1, requestId: "second", sessionId: "session-2", command: { type: "agent.prompt", prompt: "second" } }, { ...firstContext, sessionId: "session-2" })).rejects.toThrow("AGENT_BUSY");
    await expect(runtime.dispatch({ protocolVersion: 1, requestId: "steer", sessionId: "session-2", command: { type: "agent.steer", prompt: "wrong session" } }, { ...firstContext, sessionId: "session-2" })).rejects.toThrow("another session");
    finish();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("accepts a prompt, maps streaming deltas, and completes the run", async () => {
    let listener: ((event: any) => void) | undefined;
    const agent = {
      subscribe: (next: (event: any) => void) => { listener = next; return () => { listener = undefined; }; },
      prompt: async () => { listener?.({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } }); },
      abort: () => undefined,
    };
    const runtime = new DataAgentRuntime({ agent });
    const events: any[] = [];
    runtime.subscribe((event) => events.push(event));
    const result = await runtime.dispatch({ protocolVersion: 1, requestId: "prompt", command: { type: "agent.prompt", prompt: "Say hello" } }, { userId: "local", host: "electron" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.response.type).toBe("agent.prompt.accepted");
    expect(events.map((event) => event.event.type)).toEqual(["agent.text_delta", "agent.completed"]);
  });
});
