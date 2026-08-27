import { describe, expect, it } from "vitest";
import { DataAgentRuntime } from "@data-agent/runtime";
import { createRuntimeServer } from "./index.js";
import { WorkspaceStore } from "@data-agent/runtime";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

 const trustedWebContext = { contextFactory: () => ({ userId: "web-dev", host: "web" as const }) };

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

  it("rejects runtime commands without authentication by default", async () => {
    const app = await createRuntimeServer(new DataAgentRuntime());
    const response = await app.inject({
      method: "POST",
      url: "/api/runtime/command",
      payload: { protocolVersion: 1, requestId: "unauthenticated", command: { type: "runtime.probe" } },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: "AUTH_REQUIRED" } });
    await app.close();
  });

  it("dispatches the same runtime probe contract as Electron", async () => {
    const app = await createRuntimeServer(new DataAgentRuntime(), trustedWebContext);

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

  it("uploads a Workspace file through the dedicated multipart route", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-server-workspace-"));
    const app = await createRuntimeServer(new DataAgentRuntime(), { ...trustedWebContext, workspace: new WorkspaceStore(root) });
    const form = new FormData(); form.append("file", new Blob(["hello"]), "hello.txt");
    const response = await app.inject({ method: "POST", url: "/api/workspace/upload", payload: form as any, headers: { "content-type": "multipart/form-data" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ filename: "hello.txt", relative_path: "hello.txt", size: 5 });
    expect(await readFile(join(root, "hello.txt"), "utf8")).toBe("hello");
    await app.close(); await rm(root, { recursive: true, force: true });
  });

  it("serves workspace images as unmodified binary data with the correct media type", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-server-image-"));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0xfe]);
    await writeFile(join(root, "chart.png"), png);
    const app = await createRuntimeServer(new DataAgentRuntime(), { ...trustedWebContext, workspace: new WorkspaceStore(root) });

    const response = await app.inject({ method: "GET", url: "/api/workspace/download?path=chart.png" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.rawPayload).toEqual(png);
    await app.close(); await rm(root, { recursive: true, force: true });
  });

  it("starts an agent prompt through the HTTP Host", async () => {
    const app = await createRuntimeServer(new DataAgentRuntime({ agent: { prompt: async () => undefined, abort: () => undefined } }), trustedWebContext);
    const response = await app.inject({ method: "POST", url: "/api/runtime/command", payload: { protocolVersion: 1, requestId: "prompt", command: { type: "agent.prompt", prompt: "hello" } } });
    expect(response.statusCode).toBe(200);
    expect(response.json().response.type).toBe("agent.prompt.accepted");
    await app.close();
  });

  it("rejects malformed commands at the HTTP boundary", async () => {
    const app = await createRuntimeServer(new DataAgentRuntime(), trustedWebContext);

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
