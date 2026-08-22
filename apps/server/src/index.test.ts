import { describe, expect, it } from "vitest";
import { DataAgentRuntime } from "@data-agent/runtime";
import { createRuntimeServer } from "./index.js";

 describe("Fastify Host", () => {
  it("dispatches the same runtime probe contract as Electron", async () => {
    const app = await createRuntimeServer(new DataAgentRuntime());

    const response = await app.inject({
      method: "POST",
      url: "/api/runtime/command",
      payload: {
        protocolVersion: 1,
        requestId: "req-1",
        command: { type: "runtime.probe" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      protocolVersion: 1,
      requestId: "req-1",
      response: { type: "runtime.probe.result" },
    });
    await app.close();
  });

  it("rejects malformed commands at the HTTP boundary", async () => {
    const app = await createRuntimeServer(new DataAgentRuntime());

    const response = await app.inject({
      method: "POST",
      url: "/api/runtime/command",
      payload: { protocolVersion: 1, requestId: "req-1", command: { type: "unknown" } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_COMMAND" } });
    await app.close();
  });
});
