import { describe, expect, it } from "vitest";
import { DataAgentRuntime } from "./protocol.js";
import { ClarificationManager } from "./clarification.js";

describe("clarification flow", () => {
  const context = { userId: "local", host: "electron" as const };

  it("suspends on ask, resumes on answer, and enforces one pending per session", async () => {
    const runtime = new DataAgentRuntime({ clarifications: new ClarificationManager(5000) });
    const events: any[] = [];
    runtime.subscribe((event) => events.push(event));
    const first = runtime.askClarification("session-1", "Which region?", ["north", "south"]);
    const second = runtime.askClarification("session-1", "Second?", []);
    expect(events.filter((e) => e.event.type === "clarification.request").length).toBe(2);
    expect(events.filter((e) => e.event.type === "clarification.settled").length).toBe(1);

    await expect(first.promise).resolves.toBe("");
    await runtime.dispatch({ protocolVersion: 1, requestId: "a", command: { type: "clarification.answer", clarificationId: second.clarificationId, answer: "north" } }, context);
    await expect(second.promise).resolves.toBe("north");
  });

  it("retains and consumes the exact answered Host event once", async () => {
    const manager = new ClarificationManager(5000);
    const { clarificationId, promise } = manager.ask("session", "Which mapping?", [], undefined, { taskId: "task-1", baseRevisionId: "1", hypothesisId: "H1" });
    expect(manager.answer(clarificationId, "Use done")).toBe(true);
    await expect(promise).resolves.toBe("Use done");
    expect(manager.consumeAnswered(clarificationId)).toMatchObject({ clarificationId, taskId: "task-1", baseRevisionId: "1", hypothesisId: "H1", answer: "Use done", outcome: "answered" });
    expect(manager.consumeAnswered(clarificationId)).toBeUndefined();
  });

  it("expires pending clarifications after the timeout", async () => {
    const runtime = new DataAgentRuntime({ clarifications: new ClarificationManager(50) });
    const asked = runtime.askClarification("session-2", "?", []);
    await expect(asked.promise).resolves.toBe("");
  });

  it("marks waits cancelled on stop without pretending to resume", async () => {
    const manager = new ClarificationManager(60000);
    const runtime = new DataAgentRuntime({ clarifications: manager });
    const asked = runtime.askClarification("session-3", "?", []);
    runtime.cancelSessionClarifications("session-3");
    await expect(asked.promise).resolves.toBe("");
  });
});

describe("clarification visibility across Sessions", () => {
  const context = { userId: "local", host: "electron" as const };

  it("tags each request with the asking Session even when several Session facades share the manager", async () => {
    const { ClarificationDialogs } = await import("./facets/clarification-dialogs.js");
    const manager = new ClarificationManager(5000);
    const runtime = new DataAgentRuntime({ clarifications: manager });
    const events: any[] = [];
    runtime.subscribe((event) => events.push(event));
    const sessionA = new ClarificationDialogs(manager);
    new ClarificationDialogs(manager);
    const dialog = sessionA.ask("session-a", "Which region?", ["north"]);
    const requests = events.filter((event) => event.event.type === "clarification.request");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ sessionId: "session-a", event: { clarificationId: dialog.clarificationId } });
    await runtime.dispatch({ protocolVersion: 1, requestId: "a", command: { type: "clarification.answer", clarificationId: dialog.clarificationId, answer: "north" } }, context);
    await expect(dialog.promise).resolves.toBe("north");
  });

  it("reports the active run, the pending clarification and the resume cursor with the transcript", async () => {
    const manager = new ClarificationManager(5000);
    const runtime = new DataAgentRuntime({
      clarifications: manager,
      agent: {
        prompt: async () => ({ operationId: "op" }),
        getTranscript: async () => [],
        getExecutionSnapshot: async (agentContext) => ({ current: agentContext?.sessionId === "session-a" ? { id: "run-1", startedAt: 42 } : null }),
      },
    });
    const pending = manager.ask("session-a", "Which region?", ["north", "south"]);
    const busy = await runtime.dispatch({ protocolVersion: 1, requestId: "t1", command: { type: "session.transcript", sessionId: "session-a" } }, context);
    expect(busy.response).toMatchObject({
      inProgressRun: { runId: "run-1", startedAt: 42 },
      pendingClarification: { clarificationId: pending.clarificationId, question: "Which region?", options: ["north", "south"] },
      eventSequence: 1,
    });
    const idle = await runtime.dispatch({ protocolVersion: 1, requestId: "t2", command: { type: "session.transcript", sessionId: "session-b" } }, context);
    expect(idle.response).toMatchObject({ inProgressRun: null, pendingClarification: null });
  });
});
