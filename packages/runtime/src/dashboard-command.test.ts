import { describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataAgentRuntime } from "./protocol.js";
import { WorkspaceStore } from "./workspace.js";

const spec = {
  title: "销售看板",
  datasets: [{ id: "sales", rows: [{ month: "1月", amount: 10 }] }],
  views: [{ type: "line" as const, dataset: "sales", xField: "month", yField: "amount" }],
};

describe("dashboard.generate command", () => {
  const context = { userId: "local", host: "electron" as const, sessionId: "s1" };

  it("no longer builds v3 dashboards, which bypassed publication", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-dashboard-"));
    try {
      const runtime = new DataAgentRuntime({ workspace: new WorkspaceStore(root, { userId: "local", sessionId: "s1" }) });
      for (const operation of ["validate", "create", "edit"] as const) {
        await expect(runtime.dispatch({ protocolVersion: 1, requestId: operation, command: { type: "dashboard.generate", operation, mode: "static", version: "v3", spec, ...(operation === "edit" ? { editPath: "dashboards/old.html" } : {}) } }, context))
          .rejects.toThrow("DASHBOARD_V3_RETIRED");
      }
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("no longer serves the v3 data command", async () => {
    const runtime = new DataAgentRuntime({});
    await expect(runtime.dispatch({ protocolVersion: 1, requestId: "d", command: { type: "dashboard.v3.data", path: "dashboards/old.html" } } as never, context)).rejects.toThrow();
  });
});
