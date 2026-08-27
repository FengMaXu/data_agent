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

function isWidgetKind(value: unknown): value is WidgetKind {
  return value === "kpi" || value === "chart" || value === "table" || value === "steps";
}

function isWidgetPayload(value: unknown): value is WidgetPayload {
  if (!isObject(value)) return false;
  return typeof value.widget_id === "string"
    && isWidgetKind(value.kind)
    && typeof value.title === "string"
    && typeof value.tool_call_id === "string";
}

/** Runtime guard for partial tool updates received from the native Pi event stream. */
export function isWidgetLifecycleDetails(value: unknown): value is WidgetLifecycleDetails {
  if (!isObject(value)) return false;
  if (!["widget", "widget_patch", "widget_done", "widget_remove", "widget_error"].includes(String(value.widgetEvent))) return false;
  if (typeof value.widgetId !== "string" || value.widgetId.length === 0) return false;
  if (typeof value.toolCallId !== "string" || value.toolCallId.length === 0) return false;
  if (value.toolName !== "show_widget" || typeof value.legacyText !== "string") return false;
  if (value.widget !== undefined && !isWidgetPayload(value.widget)) return false;
  if (value.patch !== undefined && !isObject(value.patch)) return false;
  if (value.error !== undefined && typeof value.error !== "string") return false;
  return true;
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
