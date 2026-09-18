import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { DataAgentEventSchema, isDataAgentEvent, parseDataAgentCommandEnvelope } from "./index.js";

describe("agent tool event contract", () => {
  const base = {
    toolCallId: "call-1",
    toolName: "query",
    result: { rows: [] },
    isError: false,
  };

  it("accepts completion arguments while keeping them optional for older events", () => {
    expect(Value.Check(DataAgentEventSchema, { type: "agent.tool_finished", ...base })).toBe(true);
    expect(Value.Check(DataAgentEventSchema, { type: "agent.tool_finished", ...base, args: { sql: "select 1" } })).toBe(true);
  });

  it("rejects malformed events before they cross the transport boundary", () => {
    expect(isDataAgentEvent({ type: "agent.text_delta", delta: 42 })).toBe(false);
    expect(isDataAgentEvent({ type: "agent.tool_finished", ...base })).toBe(true);
  });

  it("freezes command ingress to the exact supported protocol version", () => {
    const baseCommand = { requestId: "request-1", command: { type: "runtime.probe" } };
    expect(parseDataAgentCommandEnvelope({ protocolVersion: 1, ...baseCommand })).toMatchObject({ protocolVersion: 1 });
    for (const protocolVersion of [0, 2, 1.5, "1", undefined]) {
      expect(() => parseDataAgentCommandEnvelope({ protocolVersion, ...baseCommand })).toThrow("Invalid DataAgent command envelope");
    }
  });
});
