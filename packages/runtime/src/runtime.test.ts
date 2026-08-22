import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataAgentRuntime } from "./index.js";
import { MetadataStore } from "./metadata.js";

describe("DataAgentRuntime", () => {
  it("dispatches a versioned runtime probe and emits a product event", async () => {
    const runtime = new DataAgentRuntime();
    const events: unknown[] = [];
    runtime.subscribe((event) => events.push(event));
    const result = await runtime.dispatch({ protocolVersion: 1, requestId: "req-1", command: { type: "runtime.probe" } }, { userId: "local", host: "electron" });
    expect(result.response.type).toBe("runtime.probe.result");
    expect(events).toHaveLength(1);
  });

  it("rejects an unsupported protocol version", async () => {
    const runtime = new DataAgentRuntime();
    await expect(runtime.dispatch({ protocolVersion: 99, requestId: "req-1", command: { type: "runtime.probe" } }, { userId: "local", host: "electron" })).rejects.toMatchObject({ code: "UNSUPPORTED_PROTOCOL_VERSION" });
  });

  it("persists task and session metadata through the worker", async () => {
    const dir = await mkdtemp(join(tmpdir(), "data-agent-runtime-"));
    const metadata = new MetadataStore(join(dir, "app.sqlite3"));
    const runtime = new DataAgentRuntime({ metadata });
    const context = { userId: "local", host: "electron" as const };
    const task = await runtime.dispatch({ protocolVersion: 1, requestId: "task", command: { type: "task.create", name: "Analysis" } }, context);
    const taskId = (task.response as { item: { id: string } }).item.id;
    const listed = await runtime.dispatch({ protocolVersion: 1, requestId: "list", command: { type: "task.list" } }, context);
    expect((listed.response as { items: unknown[] }).items).toHaveLength(1);
    await runtime.dispatch({ protocolVersion: 1, requestId: "session", command: { type: "session.create", taskId, name: "First" } }, context);
    await metadata.close();
    await rm(dir, { recursive: true, force: true });
  });
});
