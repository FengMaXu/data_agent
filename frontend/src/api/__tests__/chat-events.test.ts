import { describe, expect, it } from "vitest";
import { mapRuntimeEvent } from "../chat-events";
import { mergeToolResultState } from "../../components/tool-event-state";

describe("runtime tool event replay", () => {
  it("forwards completion args when present and leaves old events optional", () => {
    expect(mapRuntimeEvent({ type: "agent.tool_started", toolCallId: "call-1", toolName: "query", args: { sql: "select 1" } }, "msg-1"))
      .toMatchObject({ type: "tool_call", arguments: { sql: "select 1" } });
    expect(mapRuntimeEvent({ type: "agent.tool_finished", toolCallId: "call-1", toolName: "query", result: "ok", isError: false }, "msg-1"))
      .not.toHaveProperty("arguments");
    expect(mapRuntimeEvent({ type: "agent.tool_finished", toolCallId: "call-1", toolName: "query", args: { sql: "select 1" }, result: "ok", isError: false }, "msg-1"))
      .toMatchObject({ type: "tool_result", arguments: { sql: "select 1" } });
  });

  it("preserves start arguments when a completion has no args or an empty object", () => {
    const existing = {
      toolCallId: "call-1",
      name: "query",
      arguments: { sql: "select 1" },
      status: "calling" as const,
    };
    const oldCompletion = {
      type: "tool_result" as const,
      message_id: "msg-1",
      tool_call_id: "call-1",
      name: "query",
      content: "ok",
    };
    const emptyCompletion = { ...oldCompletion, arguments: {} };
    expect(mergeToolResultState(existing, oldCompletion).arguments).toEqual({ sql: "select 1" });
    expect(mergeToolResultState(existing, emptyCompletion).arguments).toEqual({ sql: "select 1" });
    expect(mergeToolResultState(existing, { ...oldCompletion, arguments: { sql: "select 2" } }).arguments)
      .toEqual({ sql: "select 2" });
  });
});
