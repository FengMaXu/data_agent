import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDataAgentApplication } from "./data-agent-application.js";

const envelope = (requestId: string, command: Record<string, unknown>) => ({ protocolVersion: 1 as const, requestId, command }) as never;

describe("dashboard pages read for channels", () => {
  it("serves only dashboards/ pages of a Session the user owns", async () => {
    const root = await mkdtemp(join(process.cwd(), ".tmp-channel-dashboard-"));
    const application = await createDataAgentApplication({ dataRoot: root, host: "web", resolveProfile: async () => ({ provider: "openai", model: "test", apiKey: "test" }), systemPrompt: "You are Data Agent." });
    try {
      const context = { userId: "user-a", host: "web" as const };
      const task = await application.dispatch(envelope("t", { type: "task.create", name: "Task" }), context);
      const taskId = (task.response as { item: { id: string } }).item.id;
      const session = await application.dispatch(envelope("s", { type: "session.create", taskId, name: "S" }), context);
      const sessionId = (session.response as { item: { id: string } }).item.id;
      await mkdir(join(root, "workspace", sessionId, "dashboards"), { recursive: true });
      await writeFile(join(root, "workspace", sessionId, "dashboards", "sales.html"), "<html>");
      await writeFile(join(root, "workspace", sessionId, "notes.txt"), "secret");
      // The reader is private: channels reach it only through the hub that createChannelHub wires.
      const read = (path: string, userId: string) => application["readDashboard"](path, { userId, sessionId });

      expect(new TextDecoder().decode(await read("dashboards/sales.html", "user-a"))).toBe("<html>");
      await expect(read("dashboards/sales.html", "user-b")).rejects.toThrow("SESSION_ACCESS_DENIED");
      await expect(read("notes.txt", "user-a")).rejects.toThrow("DASHBOARD_PATH_INVALID");
      await expect(read("dashboards/../notes.html", "user-a")).rejects.toThrow("DASHBOARD_PATH_INVALID");
    } finally {
      await application.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
