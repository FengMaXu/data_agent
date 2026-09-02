import { describe, expect, it } from "vitest";
import type { AgentHarness, ToolResultEvent } from "@earendil-works/pi-agent-core";
import { createAssuranceHooks, isSuccessfulAssurancePublication, wireAssuranceHooks } from "./assurance-hooks.js";

const publicationEvent = (overrides: Partial<ToolResultEvent> = {}): ToolResultEvent => ({
  type: "tool_result",
  toolCallId: "call-1",
  toolName: "export_query",
  input: {},
  content: [{ type: "text", text: "exported" }],
  details: { status: "success", taskComplete: true, publicationReceipt: { receiptId: "receipt-1" } },
  isError: false,
  ...overrides,
});

describe("assurance hooks", () => {
  it("terminates only after a successful publication with a receipt", () => {
    const hooks = createAssuranceHooks();
    expect(isSuccessfulAssurancePublication(publicationEvent())).toBe(true);
    expect(hooks.afterToolCall?.(publicationEvent())).toEqual({ terminate: true });
    expect(hooks.afterToolCall?.(publicationEvent({ isError: true }))).toBeUndefined();
    expect(hooks.afterToolCall?.(publicationEvent({ details: { status: "blocked", taskComplete: false } }))).toBeUndefined();
    expect(hooks.afterToolCall?.(publicationEvent({ toolName: "query_database" }))).toBeUndefined();
  });

  it("wires the three lifecycle points and releases all handlers", async () => {
    const handlers = new Map<string, (event: any) => unknown>();
    const subscriptions: Array<() => void> = [];
    const harness = {
      on(type: string, handler: (event: any) => unknown) {
        handlers.set(type, handler);
        const unsubscribe = () => handlers.delete(type);
        subscriptions.push(unsubscribe);
        return unsubscribe;
      },
    } as unknown as AgentHarness<any, any>;
    const fired: string[] = [];
    const unsubscribe = wireAssuranceHooks(harness, {
      beforeToolCall: () => ({ block: false }),
      afterToolCall: () => ({ terminate: true }),
      prepareNextTurnWithContext: (event) => ({ messages: event.messages }),
      onHookFired: (event) => { fired.push(event.hookName); },
    });

    expect(await handlers.get("tool_call")?.({ type: "tool_call", toolCallId: "call-1", toolName: "query_database", input: {} })).toEqual({ block: false });
    expect(await handlers.get("tool_result")?.(publicationEvent())).toEqual({ terminate: true });
    expect(await handlers.get("context")?.({ type: "context", messages: [] })).toEqual({ messages: [] });
    expect(fired).toEqual(["beforeToolCall", "afterToolCall", "prepareNextTurnWithContext"]);
    unsubscribe();
    expect(handlers.size).toBe(0);
    expect(subscriptions).toHaveLength(3);
  });
});
