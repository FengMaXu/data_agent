import { describe, expect, it } from "vitest";
import { DataAgentRuntime, ClarificationManager } from "./index.js";

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
