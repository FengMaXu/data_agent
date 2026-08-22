import { describe, expect, it } from "vitest";
import { DataAgentRuntime } from "@data-agent/runtime";
import { createRuntimeServer } from "./index.js";

 describe("Fastify Host", () => {
  it("supports Web registration and Bearer-token login", async () => {
    const app = await createRuntimeServer(new DataAgentRuntime());
    const registered = await app.inject({ method: "POST", url: "/auth/register", payload: { username: "alice", password: "secret" } });
    expect(registered.statusCode).toBe(200);
    const loggedIn = await app.inject({ method: "POST", url: "/auth/login", payload: { username: "alice", password: "secret" } });
    expect(loggedIn.statusCode).toBe(200);
    expect(loggedIn.json().token).toEqual(expect.any(String));
    await app.close();
  });

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

  it("starts an agent prompt through the HTTP Host", async () => {
    const app = await createRuntimeServer(new DataAgentRuntime({ agent: { prompt: async () => undefined, abort: () => undefined } }));
    const response = await app.inject({ method: "POST", url: "/api/runtime/command", payload: { protocolVersion: 1, requestId: "prompt", command: { type: "agent.prompt", prompt: "hello" } } });
    expect(response.statusCode).toBe(200);
    expect(response.json().response.type).toBe("agent.prompt.accepted");
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
