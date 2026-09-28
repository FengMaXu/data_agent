import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDataAgentApplication } from "./data-agent-application.js";

const envelope = (requestId: string, command: Record<string, unknown>, sessionId?: string) => ({
  protocolVersion: 1 as const,
  requestId,
  ...(sessionId ? { sessionId } : {}),
  command,
}) as never;

describe("DataAgent product Application", () => {
  it("surfaces fatal knowledge metadata errors instead of silently disabling knowledge", async () => {
    const root = await mkdtemp(join(process.cwd(), ".tmp-product-knowledge-invalid-"));
    try {
      const knowledgeRoot = join(root, "knowledge");
      await mkdir(knowledgeRoot, { recursive: true });
      await writeFile(join(knowledgeRoot, "invalid.md"), "---\nknowledgeId: INVALID\nname: Invalid\ndescription: Invalid identifier.\n---\n\n# Invalid", "utf8");
      await expect(createDataAgentApplication({
        dataRoot: root,
        host: "web",
        resolveProfile: async () => ({ provider: "openai", model: "test", apiKey: "test" }),
        systemPrompt: "You are Data Agent.",
      })).rejects.toThrow("KNOWLEDGE_METADATA_INVALID_ID");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("owns command routing and Session composition behind one public Host surface", async () => {
    const root = await mkdtemp(join(process.cwd(), ".tmp-product-application-"));
    const context = { userId: "user-a", host: "web" as const };
    let application = await createDataAgentApplication({
      dataRoot: root,
      host: "web",
      resolveProfile: async () => ({ provider: "openai", model: "test", apiKey: "test" }),
      systemPrompt: "You are Data Agent.",
    });
    try {
      const task = await application.dispatch(envelope("task-create", { type: "task.create", name: "Task" }), context);
      const taskId = (task.response as { item: { id: string } }).item.id;
      const created = await application.dispatch(envelope("session-create", { type: "session.create", taskId, name: "Session" }), context);
      const sessionId = (created.response as { item: { id: string } }).item.id;
      expect(await application.authorizeSession("user-a", sessionId)).toBe("owned");
      expect(await application.authorizeSession("user-b", sessionId)).toBe("forbidden");
      await application.close();

      application = await createDataAgentApplication({
        dataRoot: root,
        host: "web",
        resolveProfile: async () => ({ provider: "openai", model: "test", apiKey: "test" }),
        systemPrompt: "You are Data Agent.",
      });
      expect(await application.authorizeSession("user-a", sessionId)).toBe("owned");
      expect(await application.authorizeSession("user-b", sessionId)).toBe("forbidden");
      await expect(application.dispatch(envelope("probe-other", { type: "agent.prompt", prompt: "no" }, sessionId), { userId: "user-b", host: "web", sessionId })).rejects.toThrow();
    } finally {
      await application.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });
});
