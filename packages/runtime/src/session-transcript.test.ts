import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DataAgentRuntime } from "./index.js";
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
  });
});
