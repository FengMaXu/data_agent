import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { DataAgentEventSchema } from "./index.js";

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
});
