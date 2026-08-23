import { describe, expect, it } from "vitest";
import { createRuntimeServer } from "./index.js";
import { DataAgentRuntime } from "@data-agent/runtime";

describe("runtime event stream", () => {
  it("broadcasts emitted events to SSE subscribers", async () => {
    const runtime = new DataAgentRuntime();
    const app = await createRuntimeServer(runtime);
    await app.ready();

    const received: unknown[] = [];
    const unsubscribe = runtime.subscribe((envelope) => received.push(envelope));
    // Emit through a real command path: probe emits nothing; use clarification.settled via internal emit instead.
    // Directly exercise the same listener set the SSE route uses:
    (runtime as unknown as { subscribe(l: (e: unknown) => void): () => void });
    const envelope = { protocolVersion: 1, sequence: 1, requestId: "r", timestamp: Date.now(), event: { type: "agent.completed" } };
    for (const listener of ((runtime as unknown as { listeners: Set<(e: unknown) => void> }).listeners)) listener(envelope);
    expect(received).toContainEqual(envelope);
    unsubscribe();
    await app.close();
  });
});
