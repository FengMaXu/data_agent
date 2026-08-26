import type { AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";

export type WidgetKind = "kpi" | "chart" | "table" | "steps";

export interface WidgetSpecInput {
  [key: string]: unknown;
}

export interface WidgetPayload extends WidgetSpecInput {
  widget_id: string;
  kind: WidgetKind;
  title: string;
  tool_call_id: string;
}

export interface WidgetLifecycleDetails {
  widgetEvent: "widget" | "widget_patch" | "widget_done" | "widget_remove" | "widget_error";
  widgetId: string;
  toolCallId: string;
  toolName: "show_widget";
  widget?: WidgetPayload;
  patch?: Record<string, unknown>;
  error?: string;
  legacyText: string;
}

export type WidgetValidationResult = {
  ok: true;
  spec: WidgetSpecInput;
} | {
  ok: false;
  error: string;
};

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

/** Minimum server-side validation shared by the tool and its event adapter. */
export function validateWidgetSpec(kind: WidgetKind, value: unknown): WidgetValidationResult {
  if (!isObject(value)) return { ok: false, error: "spec must be an object" };
  if (value.title !== undefined && typeof value.title !== "string") {
    return { ok: false, error: "spec.title must be a string when provided" };
  }

  if (kind === "kpi") {
    const hasValue = typeof value.value === "string" || typeof value.value === "number";
    if (!hasValue && !Array.isArray(value.data)) {
      return { ok: false, error: "kpi spec requires a scalar value or data array" };
    }
  } else if (!Array.isArray(value.data) && !(kind === "chart" && Array.isArray(value.series))) {
    return { ok: false, error: `${kind} spec requires a data array${kind === "chart" ? " or series array" : ""}` };
  }

  return { ok: true, spec: value };
}

export function widgetLegacyText(widget: WidgetPayload): string {
  return `[widget:${widget.kind}] ${widget.title}: ${JSON.stringify(widget)}`;
}

export function emitWidgetUpdate(
  onUpdate: AgentToolUpdateCallback<WidgetLifecycleDetails> | undefined,
  details: WidgetLifecycleDetails,
): void {
  onUpdate?.({
    content: [{ type: "text", text: details.legacyText }],
    details,
  });
}

export type WidgetToolResult = AgentToolResult<WidgetLifecycleDetails>;
