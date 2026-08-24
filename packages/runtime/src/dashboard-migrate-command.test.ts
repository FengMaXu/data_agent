import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataAgentRuntime } from "./index.js";
import { WorkspaceStore } from "./workspace.js";

/**
 * Gate #29 — dashboard.migrate command seam: workspace-scoped, versioned
 * report, backup + idempotency through the production dispatch path.
 */
describe("dashboard.migrate command", () => {
  const context = { userId: "local", host: "electron" as const, sessionId: "s1" };

  it("migrates a workspace V3 spec and reports converted/unchanged/unsupported", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-migrate-"));
    try {
      const v3Spec = {
        title: "迁移看板",
        datasets: [{ id: "d", rows: [{ k: "a", v: 1 }] }],
        views: [{ id: "v1", type: "bar", dataset: "d", xField: "k", yField: "v" }],
      };
      await mkdir(join(root, "dashboards"), { recursive: true });
      await writeFile(join(root, "dashboards", "m.json"), JSON.stringify(v3Spec), "utf8");
      await writeFile(join(root, "dashboards", "bad.json"), JSON.stringify({ title: "x", datasets: [], views: [] }), "utf8");

      const runtime = new DataAgentRuntime({ workspace: new WorkspaceStore(root, { userId: "local", sessionId: "s1" }) });
      const response = await runtime.dispatch(
        { protocolVersion: 1, requestId: "m1", command: { type: "dashboard.migrate", paths: ["dashboards/m.json", "dashboards/bad.json"] } },
        context,
      );
      const result = response.response as { type: string; migrationId: string; fromVersion: string; toVersion: string; converted: string[]; unchanged: string[]; unsupported: Array<{ path: string; reasons: string[] }> };
      expect(result.type).toBe("dashboard.migrate.result");
      expect(result.fromVersion).toBe("v3");
      expect(result.toVersion).toBe("v4");
      expect(result.converted).toEqual(["dashboards/m.json"]);
      expect(result.unsupported).toHaveLength(1);
      expect(result.unsupported[0].path).toBe("dashboards/bad.json");

      // Backup + explicit V4 metadata on the converted file.
      const converted = JSON.parse(await readFile(join(root, "dashboards", "m.json"), "utf8"));
      expect(converted.dashboardVersion).toBe(4);
      const backup = JSON.parse(await readFile(join(root, "dashboards", "m.json.v3.bak"), "utf8"));
      expect(backup.title).toBe("迁移看板");

      // Idempotent: re-running reports the file unchanged.
      const second = await runtime.dispatch(
        { protocolVersion: 1, requestId: "m2", command: { type: "dashboard.migrate", paths: ["dashboards/m.json"] } },
        context,
      );
      expect((second.response as { unchanged: string[] }).unchanged).toEqual(["dashboards/m.json"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
