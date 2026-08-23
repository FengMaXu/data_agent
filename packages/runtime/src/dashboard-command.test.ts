import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataAgentRuntime } from "./index.js";
import { WorkspaceStore } from "./workspace.js";

const spec = {
  title: "销售看板",
  datasets: [{ id: "sales", rows: [{ month: "1月", amount: 10 }] }],
  views: [{ type: "line" as const, dataset: "sales", xField: "month", yField: "amount" }],
};

describe("generate_dashboard command", () => {
  const context = { userId: "local", host: "electron" as const, sessionId: "s1" };

  it("validates and creates a standalone v3 dashboard artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-dashboard-"));
    const runtime = new DataAgentRuntime({ workspace: new WorkspaceStore(root, { userId: "local", sessionId: "s1" }) });
    const events: any[] = [];
    runtime.subscribe((event) => events.push(event));

    const invalid = await runtime.dispatch({ protocolVersion: 1, requestId: "v", command: { type: "dashboard.generate", operation: "validate", mode: "static", version: "v3", spec: { title: "" } } }, context);
    expect((invalid.response as { valid: boolean }).valid).toBe(false);

    const created = await runtime.dispatch({ protocolVersion: 1, requestId: "c", command: { type: "dashboard.generate", operation: "create", mode: "static", version: "v3", spec } }, context);
    const path = (created.response as { path?: string }).path!;
    expect(path).toMatch(/dashboards\/.+\.html$/);
    const html = await readFile(join(root, path), "utf8");
    expect(html).toContain("销售看板");
    expect(events.some((e) => e.event.type === "workspace.artifact.created")).toBe(true);

    const edited = await runtime.dispatch({ protocolVersion: 1, requestId: "e", command: { type: "dashboard.generate", operation: "edit", mode: "static", version: "v3", spec: { ...spec, title: "改版" }, editPath: path } }, context);
    expect((edited.response as { path?: string }).path).toBe(path);
    await rm(root, { recursive: true, force: true });
  });
});
