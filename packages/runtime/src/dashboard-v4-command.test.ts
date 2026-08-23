import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataAgentRuntime } from "./index.js";
import { WorkspaceStore } from "./workspace.js";

const semanticSpec = {
  title: "语义看板",
  views: [{ id: "v1", type: "line" as const, query: "sales by month" }],
};

describe("semantic dashboard command", () => {
  const context = { userId: "local", host: "electron" as const, sessionId: "s1" };

  it("creates a bridge-only semantic artifact with no inline data and no node access", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-dashboard-v4-"));
    const runtime = new DataAgentRuntime({ workspace: new WorkspaceStore(root, { userId: "local", sessionId: "s1" }) });
    const created = await runtime.dispatch({ protocolVersion: 1, requestId: "c", command: { type: "dashboard.generate", operation: "create", mode: "semantic", version: "v4", spec: semanticSpec } }, context);
    const path = (created.response as { path?: string }).path!;
    const html = await readFile(join(root, path), "utf8");
    expect(html).toContain("__SEMANTIC_DASHBOARD__");
    expect(html).toContain("postMessage");
    expect(html).not.toContain("require(");
    expect(html).not.toContain("\"rows\"");
    await rm(root, { recursive: true, force: true });
  });
});
