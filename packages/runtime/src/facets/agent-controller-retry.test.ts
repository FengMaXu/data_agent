import { describe, expect, it } from "vitest";
import { MemorySessionRepo, TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { InMemoryAnswering } from "../answering/service.js";
import { InMemoryAnsweringStore } from "../answering/answering-store.js";
import { InMemoryResultStore } from "../answering/result-store.js";
import { createPiSessionHost } from "../agent/harness-factory.js";

async function hostWith(responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0], maxRetries: number) {
  const faux = fauxProvider({ provider: `retry-${maxRetries}-${Math.random()}`, models: [{ id: "model" }] });
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses(responses);
  const session = await new MemorySessionRepo().create({ id: "retry-session" }, TODO_CONTEXT);
  const answeringStore = new InMemoryAnsweringStore();
  const resultStore = new InMemoryResultStore();
  const host = await createPiSessionHost({
    session,
    sessionId: "retry-session",
    toolContext: { sessionId: "retry-session", principalId: "user-1" },
    toolDefinitions: [],
    answering: new InMemoryAnswering({ store: answeringStore, resultStore, sqlExecutor: { run: async () => ({ columns: [], rows: [], truncated: false }) } }),
    answeringStore,
    resultStore,
    systemPrompt: "You are Data Agent.",
    profile: { provider: faux.provider, model: faux.models[0].id },
    queryTaskProjection: {} as never,
    artifactDirectory: {} as never,
    clarificationDialogs: { subscribe: () => () => undefined } as never,
    piRuntime: { models, model: faux.models[0] },
  });
  await host.harness.setRetryPolicy({ enabled: true, maxRetries, baseDelayMs: 10 }, TODO_CONTEXT);
  return { host, faux };
}

async function settled(host: Awaited<ReturnType<typeof hostWith>>["host"], timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await host.controller.getOpenOperations()).length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("operation did not settle");
}

describe("main operation retries", () => {
  it("drives a scheduled retry instead of leaving the operation waiting", async () => {
    const { host, faux } = await hostWith([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "terminated" }),
      fauxAssistantMessage("Recovered answer"),
    ], 2);
    try {
      await host.controller.prompt("Count orders.");
      await settled(host);
      expect(faux.state.callCount).toBe(2);
      const entries = await host.lane.findEntries({ type: "message", order: "newestFirst" }, TODO_CONTEXT);
      expect(JSON.stringify(entries)).toContain("Recovered answer");
    } finally {
      await host.close();
    }
  });

  it("ends the operation once retries are exhausted", async () => {
    const { host, faux } = await hostWith([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "terminated" }),
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "terminated" }),
      fauxAssistantMessage("never reached"),
    ], 1);
    try {
      await host.controller.prompt("Count orders.");
      await settled(host);
      expect(faux.state.callCount).toBe(2);
    } finally {
      await host.close();
    }
  });
});
