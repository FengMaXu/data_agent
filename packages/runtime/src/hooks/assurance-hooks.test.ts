import { describe, expect, it } from "vitest";
import type { AgentHarness, ToolResultEvent } from "@earendil-works/pi-agent-core";
import { createAssuranceHooks, isSuccessfulAssurancePublication, wireAssuranceHooks } from "./assurance-hooks.js";
import { AnomalyRegistry } from "../anomaly-registry.js";

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
  it("terminates only after a successful publication with a receipt", async () => {
    const hooks = createAssuranceHooks();
    expect(isSuccessfulAssurancePublication(publicationEvent())).toBe(true);
    await expect(hooks.afterToolCall?.(publicationEvent())).resolves.toEqual({ terminate: true });
    await expect(hooks.afterToolCall?.(publicationEvent({ isError: true }))).resolves.toBeUndefined();
    await expect(hooks.afterToolCall?.(publicationEvent({ details: { status: "blocked", taskComplete: false } }))).resolves.toBeUndefined();
    await expect(hooks.afterToolCall?.(publicationEvent({ toolName: "query_database" }))).resolves.toBeUndefined();
  });

  it("lets the query observation Hook append disclosure content without throwing", async () => {
    const hooks = createAssuranceHooks({
      observeQuery: async () => ({ content: [{ type: "text", text: "[ANOMALY A-1]" }] }),
    });
    const result = await hooks.afterToolCall?.(publicationEvent({ toolName: "query_database", details: { status: "success" } }));
    expect(result?.content?.at(-1)).toEqual({ type: "text", text: "[ANOMALY A-1]" });
    const failing = createAssuranceHooks({ observeQuery: async () => { throw new Error("detector failed"); } });
    await expect(failing.afterToolCall?.(publicationEvent({ toolName: "query_database" }))).resolves.toBeUndefined();
  });

  it("injects unresolved interpretations once into the next context", async () => {
    const registry = new AnomalyRegistry();
    registry.register("task-1", [{ detector: "shape_mismatch", slot: "final_shape", observed: { code: "G1" }, note: "shape differs" }]);
    const hooks = createAssuranceHooks({
      anomalyRegistry: registry,
      taskId: () => "task-1",
      getTaskQuestion: () => "How many payments?",
      interpretationPlanner: async () => ({
        slot: "final_shape",
        interpretations: [
          { id: "I1", statement: "统计支付记录数", evidence: { type: "question_span", quote: "payments" } },
          { id: "I2", statement: "统计连接后的记录数", evidence: null },
        ],
      }),
    });
    const first = await hooks.prepareNextTurnWithContext?.({ type: "context", messages: [] });
    expect(first?.messages).toHaveLength(1);
    expect((first?.messages[0] as any).content).toContain("[INTERPRETATIONS for A-1 / slot=final_shape]");
    expect(await hooks.prepareNextTurnWithContext?.({ type: "context", messages: [] })).toBeUndefined();
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
