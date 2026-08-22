import { describe, expect, it } from "vitest";
import { DataAgentRuntime } from "./index.js";

describe("agent commands", () => {
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
