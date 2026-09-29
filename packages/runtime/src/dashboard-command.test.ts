import { describe, expect, it } from "vitest";
import { DataAgentRuntime } from "./protocol.js";

describe("dashboard.refresh command", () => {
  it("passes only the path, the view ids and the request id to the session", async () => {
    const calls: unknown[] = [];
    const runtime = new DataAgentRuntime({ agent: { prompt: async () => ({}), refreshDashboard: async (request, context) => { calls.push({ request, context }); return { datasets: {}, sources: {}, checks: {}, notices: [] }; } } });
    const response = await runtime.dispatch({ protocolVersion: 1, requestId: "req-9", command: { type: "dashboard.refresh", path: "dashboards/a.html", viewIds: ["bar"] } }, { userId: "u", host: "web", sessionId: "s1" });
    expect(response.response).toMatchObject({ type: "dashboard.refresh.result" });
    expect(calls).toEqual([{ request: { path: "dashboards/a.html", viewIds: ["bar"], requestId: "req-9" }, context: { sessionId: "s1", userId: "u" } }]);
    await expect(runtime.dispatch({ protocolVersion: 1, requestId: "req-10", command: { type: "dashboard.refresh", path: "dashboards/a.html", viewIds: ["bar"] } }, { userId: "u", host: "web" })).rejects.toThrow("DASHBOARD_REFRESH_SESSION_REQUIRED");
  });
});

describe("Retired dashboard commands", () => {
  const context = { userId: "local", host: "electron" as const, sessionId: "s1" };

  // dashboard.generate built v3/v4 pages outside publication, dashboard.evaluate ran caller SQL,
  // dashboard.migrate converted v3 to v4 (ADR-0010 decision 7). The agent's generate_dashboard replaces them.
  for (const command of [
    { type: "dashboard.generate", operation: "create", mode: "semantic", version: "v4", spec: {} },
    { type: "dashboard.evaluate", sql: "SELECT 1" },
    { type: "dashboard.migrate", paths: ["dashboards/a.json"] },
    { type: "dashboard.v3.data", path: "dashboards/old.html" },
  ]) {
    it(`rejects ${command.type}`, async () => {
      await expect(new DataAgentRuntime({}).dispatch({ protocolVersion: 1, requestId: command.type, command } as never, context)).rejects.toThrow();
    });
  }
});
