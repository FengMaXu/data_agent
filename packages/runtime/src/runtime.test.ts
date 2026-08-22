import { describe, expect, it } from "vitest";
import { DataAgentRuntime } from "./index.js";

 describe("DataAgentRuntime", () => {
  it("dispatches a versioned runtime probe and emits a product event", async () => {
    const runtime = new DataAgentRuntime();
    const events: unknown[] = [];
    runtime.subscribe((event) => events.push(event));

    const result = await runtime.dispatch(
      {
        protocolVersion: 1,
        requestId: "req-1",
        command: { type: "runtime.probe" },
      },
      { userId: "local", host: "electron" },
    );

    expect(result).toEqual({
      protocolVersion: 1,
      requestId: "req-1",
      response: {
        type: "runtime.probe.result",
        service: "data-agent-runtime",
        runtimeVersion: "0.1.0",
      },
    });
    expect(events).toEqual([
      expect.objectContaining({
        protocolVersion: 1,
        requestId: "req-1",
        event: expect.objectContaining({ type: "runtime.probe.completed" }),
      }),
    ]);
  });

  it("rejects a command from an unsupported protocol version", async () => {
    const runtime = new DataAgentRuntime();

    await expect(
      runtime.dispatch(
        {
          protocolVersion: 99,
          requestId: "req-1",
          command: { type: "runtime.probe" },
        },
        { userId: "local", host: "electron" },
      ),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_PROTOCOL_VERSION" });
  });
});
