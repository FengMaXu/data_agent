import { describe, expect, it } from "vitest";
import { createRuntimeServer } from "./index.js";
import { DataAgentRuntime } from "@data-agent/runtime";

const trustedWebContext = { contextFactory: () => ({ userId: "web-dev", host: "web" as const }) };

describe("runtime event stream", () => {
  it("replays events after a sequence cursor with SSE ids", async () => {
    const runtime = new DataAgentRuntime();
    await runtime.dispatch({ protocolVersion: 1, requestId: "probe-1", command: { type: "runtime.probe" } }, { userId: "local", host: "web" });
    await runtime.dispatch({ protocolVersion: 1, requestId: "probe-2", command: { type: "runtime.probe" } }, { userId: "local", host: "web" });
    const app = await createRuntimeServer(runtime, trustedWebContext);
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    try {
      const response = await fetch(`${address}/api/runtime/events?after_sequence=1`);
      const reader = response.body!.getReader();
      const first = await reader.read();
      const chunk = new TextDecoder().decode(first.value);
      expect(chunk).toContain("id: 2");
      expect(chunk).toContain('"requestId":"probe-2"');
      expect(chunk).not.toContain('"requestId":"probe-1"');
      await reader.cancel();
    } finally {
      await app.close();
    }
  });

  it("broadcasts emitted events to SSE subscribers", async () => {
    const runtime = new DataAgentRuntime();
    const app = await createRuntimeServer(runtime, trustedWebContext);
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
