import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataAgentRuntime } from "./index.js";
import { WorkspaceStore } from "./workspace.js";

describe("workspace commands", () => {
  it("writes and reads through DataAgentRuntime", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-workspace-command-"));
    const runtime = new DataAgentRuntime({ workspace: new WorkspaceStore(root) });
    const context = { userId: "local", host: "electron" as const };
    await runtime.dispatch({ protocolVersion: 1, requestId: "write", command: { type: "workspace.write", path: "note.txt", content: "hello" } }, context);
    const result = await runtime.dispatch({ protocolVersion: 1, requestId: "read", command: { type: "workspace.read", path: "note.txt" } }, context);
    expect((result.response as { content: string }).content).toBe("hello");
    await rm(root, { recursive: true, force: true });
  });
});
