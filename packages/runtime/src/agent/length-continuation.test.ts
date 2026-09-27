import { describe, expect, it } from "vitest";
import { MemorySessionRepo, TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { createModels, type Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { InMemoryAnswering } from "../answering/service.js";
import { InMemoryAnsweringStore } from "../answering/answering-store.js";
import { InMemoryResultStore } from "../answering/result-store.js";
import { createPiSessionHost } from "./harness-factory.js";
import { LENGTH_CONTINUATION_PROMPT, LengthContinuationGuard, MAX_LENGTH_CONTINUATIONS, endedByOutputLimit } from "./length-continuation.js";

describe("length continuation guard", () => {
  const cut = { role: "assistant", stopReason: "length", content: [{ type: "thinking", thinking: "..." }] };

  it("continues only a run whose last reply was cut before any tool call", () => {
    expect(endedByOutputLimit([cut])).toBe(true);
    expect(endedByOutputLimit([{ ...cut, content: [{ type: "toolCall" }] }])).toBe(false);
    expect(endedByOutputLimit([{ ...cut, stopReason: "stop" }])).toBe(false);
    expect(endedByOutputLimit([cut, { role: "toolResult" }])).toBe(false);
    expect(endedByOutputLimit([])).toBe(false);
  });

  it("bounds continuations per run and resets after a normal ending", () => {
    const guard = new LengthContinuationGuard();
    for (let index = 0; index < MAX_LENGTH_CONTINUATIONS; index += 1) expect(guard.followUp("run-1", [cut])).toBe(LENGTH_CONTINUATION_PROMPT);
    expect(guard.followUp("run-1", [cut])).toBeUndefined();
    expect(guard.followUp("run-2", [cut])).toBe(LENGTH_CONTINUATION_PROMPT);
    expect(guard.followUp("run-2", [{ ...cut, stopReason: "stop" }])).toBeUndefined();
    expect(guard.followUp("run-2", [cut])).toBe(LENGTH_CONTINUATION_PROMPT);
  });
});

async function hostWith(responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0]) {
  const faux = fauxProvider({ provider: `length-continuation-${Math.random()}`, models: [{ id: "model" }] });
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses(responses);
  const session = await new MemorySessionRepo().create({ id: "length-session" }, TODO_CONTEXT);
  const answeringStore = new InMemoryAnsweringStore();
  const resultStore = new InMemoryResultStore();
  const answering = new InMemoryAnswering({ store: answeringStore, resultStore, sqlExecutor: { run: async () => ({ columns: [], rows: [], truncated: false }) } });
  const host = await createPiSessionHost({
    session,
    sessionId: "length-session",
    toolContext: { sessionId: "length-session", principalId: "user-1" },
    toolDefinitions: [],
    answering,
    answeringStore,
    resultStore,
    systemPrompt: "You are the main Data Agent.",
    profile: { provider: faux.provider, model: faux.models[0].id },
    queryTaskProjection: {} as never,
    artifactDirectory: {} as never,
    clarificationDialogs: { subscribe: () => () => undefined } as never,
    piRuntime: { models, model: faux.models[0] },
  });
  return { faux, host };
}

/** A reply that genuinely reaches the output limit: Pi treats it as final, not as overflow. */
function limitReached(maxTokens: number | undefined, fallback: number) {
  return fauxAssistantMessage(`thinking ${"x".repeat((maxTokens ?? fallback) * 4)}`, { stopReason: "length" });
}

describe("main agent length continuation", () => {
  it("continues a run whose reply filled the output limit without a tool call", async () => {
    const contexts: Context[] = [];
    let fallback = 0;
    const { faux, host } = await hostWith([
      async (context, options) => { contexts.push(context); return limitReached(options?.maxTokens, fallback); },
      async (context) => { contexts.push(context); return fauxAssistantMessage("Continued and finished."); },
    ]);
    fallback = faux.models[0].maxTokens;
    try {
      const accepted = await host.controller.prompt("Count orders.");
      const driven = await host.lane.drive({ operationId: accepted.operationId }, TODO_CONTEXT);
      expect(driven.ok).toBe(true);
      expect(faux.state.callCount).toBe(2);
      expect(JSON.stringify(contexts[1]?.messages)).toContain(LENGTH_CONTINUATION_PROMPT);
    } finally {
      await host.close();
    }
  });

  it("does not continue a reply cut with a tool call, and stops after the bounded continuations", async () => {
    let fallback = 0;
    const { faux, host } = await hostWith(Array.from({ length: 5 }, () => async (_context: Context, options?: { maxTokens?: number }) => limitReached(options?.maxTokens, fallback)));
    fallback = faux.models[0].maxTokens;
    try {
      const accepted = await host.controller.prompt("Count orders.");
      await host.lane.drive({ operationId: accepted.operationId }, TODO_CONTEXT);
      expect(faux.state.callCount).toBe(1 + MAX_LENGTH_CONTINUATIONS);
    } finally {
      await host.close();
    }
    expect(endedByOutputLimit([{ role: "assistant", stopReason: "length", content: [fauxToolCall("x", {}, { id: "t" })] }])).toBe(false);
  });
});
