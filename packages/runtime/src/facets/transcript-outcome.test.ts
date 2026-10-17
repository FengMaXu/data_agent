import { describe, expect, it } from "vitest";
import type { DataAgentEventEnvelope } from "@data-agent/contracts";
import { TranscriptProjector } from "./transcript.js";

function projector() {
  const emitted: DataAgentEventEnvelope[] = [];
  let sequence = 1;
  const instance = new TranscriptProjector({
    resolve: (event) => ({ operationId: String(event.runId), operation: { requestId: "request-1", runId: String(event.runId), sessionId: "session-1" } }),
    nextSequence: () => sequence++,
    emit: (envelope) => emitted.push(envelope),
    onTerminal: () => undefined,
  });
  return { instance, events: () => emitted.map((envelope) => envelope.event) };
}

const LOST = "DATABASE_UNAVAILABLE: database process unavailable after 3 reconnects (Connection closed)";

describe("TranscriptProjector run outcome", () => {
  it("reports a completed run as completed", () => {
    const { instance, events } = projector();
    instance.project({ type: "agent_end", runId: "run-1", aborted: false });
    expect(events()).toEqual([{ type: "agent.completed", outcome: "completed" }]);
  });

  it("reports an aborted run as stopped", () => {
    const { instance, events } = projector();
    instance.project({ type: "agent_end", runId: "run-1", aborted: true });
    expect(events()).toEqual([{ type: "agent.completed", outcome: "stopped" }]);
  });

  it("reports a failed run as failed", () => {
    const { instance, events } = projector();
    instance.project({ type: "agent_error", runId: "run-1", error: "boom" });
    expect(events().at(-1)).toEqual({ type: "agent.completed", outcome: "failed" });
  });

  it("says the database was lost when the Runtime stops the run for it", () => {
    const { instance, events } = projector();
    instance.project({ type: "tool_execution_start", runId: "run-1", toolCallId: "call-1", toolName: "subagent", args: {} });
    instance.project({ type: "tool_execution_end", runId: "run-1", toolCallId: "call-1", toolName: "subagent", result: { content: [{ type: "text", text: `## probe（explorer）— failed\n\n子任务未完成：${LOST}` }] }, isError: false });
    instance.project({ type: "agent_end", runId: "run-1", aborted: true });
    const [notice, completed] = events().slice(-2);
    expect(notice).toEqual({ type: "agent.text_delta", delta: `\n\n> ⚠️ **数据库不可用，任务已停止**: ${LOST}` });
    expect(completed).toEqual({ type: "agent.completed", outcome: "failed" });
  });
});
