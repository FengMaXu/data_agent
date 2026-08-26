import { describe, expect, it } from "vitest";
import { mapRuntimeEvent } from "../chat-events";

describe("Runtime Widget event replay adapter", () => {
  it("maps the lifecycle vocabulary while keeping the active message", () => {
    const common = { messageId: "message-1", toolCallId: "call-1", widgetId: "widget-call-1", toolName: "show_widget" };
    const types = ["widget", "widget_patch", "widget_done", "widget_remove", "widget_error"] as const;
    const events = types.map((type) => {
      const event = type === "widget"
        ? { type, ...common, widget: { widget_id: common.widgetId, kind: "kpi", title: "Revenue" } }
        : type === "widget_patch"
          ? { type, ...common, patch: { subtitle: "Today" } }
          : type === "widget_error"
            ? { type, ...common, error: "failed" }
            : { type, ...common };
      return mapRuntimeEvent(event, "message-1")!.event;
    });

    expect(events.map((event) => event.type)).toEqual(types);
    expect(events.every((event) => "message_id" in event && event.message_id === "message-1")).toBe(true);
  });

  it("turns a structured tool result into readable legacy fallback text", () => {
    const mapped = mapRuntimeEvent({
      type: "agent.tool_finished",
      toolCallId: "call-1",
      toolName: "show_widget",
      args: {},
      result: {
        content: [{ type: "text", text: "[widget:kpi] Revenue: 42" }],
        details: { widgetId: "widget-call-1" },
      },
      isError: false,
    }, "message-1");

    expect(mapped?.event).toMatchObject({
      type: "tool_result",
      content: "[widget:kpi] Revenue: 42",
      widget_id: "widget-call-1",
    });
  });
});
