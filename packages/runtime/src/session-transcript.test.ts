import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DataAgentRuntime } from "./index.js";
import { createDataAgentHarness } from "./agent-assembly.js";
import { WorkspaceStore } from "./workspace.js";
import { PiJsonlSessionStore } from "./session-store.js";

const ctx = { userId: "local", host: "electron" as const };

describe("session.transcript", () => {
  it("returns empty messages when the session has no entries and works without store", async () => {
    const runtime = new DataAgentRuntime({});
    await expect(runtime.dispatch({ protocolVersion: 1, requestId: "r0", command: { type: "session.transcript", sessionId: "missing" } }, ctx)).rejects.toThrow("SESSION_STORE_NOT_CONFIGURED");

    const root = await mkdtemp(path.join(tmpdir(), "transcript-"));
    const store = new PiJsonlSessionStore(root);
    const session = await store.create({ userId: "local", taskId: "t1", sessionId: "chat-1" });
    const runtime2 = new DataAgentRuntime({ sessions: store });
    const result = await runtime2.dispatch({ protocolVersion: 1, requestId: "r1", command: { type: "session.transcript", sessionId: "chat-1" } }, ctx);
    expect(result.response).toMatchObject({ type: "session.transcript.result", messages: [] });
    await rm(root, { recursive: true, force: true });
  });

  it("persists harness messages into the supplied application session", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "transcript-harness-"));
    const workspaceRoot = path.join(root, "workspace");
    const store = new PiJsonlSessionStore(path.join(root, "sessions"));
    const session = await store.create({ userId: "local", taskId: "t1", sessionId: "chat-harness" });
    const harness = await createDataAgentHarness({
      workspace: new WorkspaceStore(workspaceRoot),
      session,
      sessionId: "chat-harness",
      systemPrompt: "test",
    }, { provider: "openai", model: "test-model", apiKey: "test-key" });

    await harness.appendMessage({ role: "user", content: "durable", timestamp: 100 });

    const reopened = await store.openByAppSessionId("chat-harness");
    expect(await reopened.getEntries()).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "message", message: expect.objectContaining({ role: "user", content: "durable" }) }),
    ]));
    await rm(root, { recursive: true, force: true });
  });

  it("restores user and assistant text while excluding tool-result protocol messages", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "transcript-content-"));
    const store = new PiJsonlSessionStore(root);
    const session = await store.create({ userId: "local", taskId: "t1", sessionId: "chat-persisted" });
    await session.appendMessage({ role: "user", content: "persist this question", timestamp: 100 });
    await session.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "persist this answer" }],
      api: "openai-responses",
      provider: "openai",
      model: "test",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: 200,
    });
    await session.appendMessage({ role: "toolResult", toolCallId: "call-1", toolName: "read_file", content: [{ type: "text", text: "protocol-only" }], isError: false, timestamp: 150 });
    const runtime = new DataAgentRuntime({ sessions: store });

    const result = await runtime.dispatch({ protocolVersion: 1, requestId: "persisted", command: { type: "session.transcript", sessionId: "chat-persisted" } }, ctx);

    expect(result.response).toMatchObject({
      type: "session.transcript.result",
      messages: [
        expect.objectContaining({ role: "user", content: "persist this question" }),
        expect.objectContaining({ role: "agent", content: "persist this answer" }),
      ],
    });
    await rm(root, { recursive: true, force: true });
  });
});
