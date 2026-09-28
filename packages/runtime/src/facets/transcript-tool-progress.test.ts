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

const child = { key: "schema", role: "explorer", task: "列出列", currentTool: "describe_table", toolCalls: 1, startedAt: 1, status: "running", output: "pending" };

describe("TranscriptProjector tool progress", () => {
  it("projects validated tool progress of a non-widget tool", () => {
    const { instance, events } = projector();
    instance.project({ type: "tool_execution_start", runId: "run-1", toolCallId: "call-1", toolName: "subagent", args: {} });
    instance.project({ type: "tool_execution_update", runId: "run-1", toolCallId: "call-1", toolName: "subagent", partialResult: { content: [], details: { toolProgress: { kind: "subagent", children: [child] } } } });
    expect(events().at(-1)).toEqual({ type: "agent.tool_progress", toolCallId: "call-1", toolName: "subagent", progress: { kind: "subagent", children: [child] } });
  });

  it("drops malformed or unrecognized progress instead of emitting it", () => {
    const { instance, events } = projector();
    instance.project({ type: "tool_execution_start", runId: "run-1", toolCallId: "call-1", toolName: "subagent", args: {} });
    const before = events().length;
    instance.project({ type: "tool_execution_update", runId: "run-1", toolCallId: "call-1", toolName: "subagent", partialResult: { content: [], details: { toolProgress: { kind: "subagent", children: [{ ...child, sql: "select 1" }] } } } });
    instance.project({ type: "tool_execution_update", runId: "run-1", toolCallId: "call-1", toolName: "subagent", partialResult: { content: [], details: { rows: [] } } });
    expect(events()).toHaveLength(before);
  });
});
