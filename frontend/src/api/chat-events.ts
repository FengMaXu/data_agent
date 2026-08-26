import { subscribeRuntimeEvents, getRuntimeClient } from "./runtime-client";
import type { SSEEvent } from "./client";

export interface RuntimeChatHandle { cancel: () => void; finished: Promise<void> }

type RuntimeEvent = { type?: string; [key: string]: unknown };

/** Extract the text content retained for clients that do not understand Widget events. */
function readableToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const text = content.find((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text");
      if (text && typeof (text as { text?: unknown }).text === "string") return (text as { text: string }).text;
    }
  }
  return JSON.stringify(result ?? null);
}

/**
 * Compatibility adapter from one versioned Runtime event to the existing chat
 * event model. In particular, terminal tool results retain readable text for
 * clients that predate structured Widget events.
 */
export function mapRuntimeEvent(event: RuntimeEvent, activeMessageId: string): { event: SSEEvent; messageId?: string } | null {
  if (event.type === "agent.message_started") {
    const messageId = String(event.messageId || `msg-${Date.now()}`);
    return { event: { type: "message_start", message_id: messageId }, messageId };
  }
  if (event.type === "agent.text_delta") return { event: { type: "text_delta", message_id: activeMessageId, content: String(event.delta ?? "") } };
  if (event.type === "agent.thinking_delta") return { event: { type: "reasoning_delta", message_id: activeMessageId, content: String(event.delta ?? "") } };
  if (event.type === "agent.tool_started") return { event: { type: "tool_call", message_id: activeMessageId, tool_call_id: String(event.toolCallId ?? ""), name: String(event.toolName ?? ""), arguments: event.args ?? {} } };
  if (event.type === "widget" || event.type === "widget_patch" || event.type === "widget_done" || event.type === "widget_remove" || event.type === "widget_error") {
    const messageId = String(event.messageId ?? activeMessageId ?? "");
    const toolCallId = String(event.toolCallId ?? "");
    const widgetId = String(event.widgetId ?? "");
    if (event.type === "widget") return { event: { type: "widget", message_id: messageId, tool_call_id: toolCallId, widget_id: widgetId, tool_name: String(event.toolName ?? "show_widget"), widget: event.widget as any } };
    if (event.type === "widget_patch") return { event: { type: "widget_patch", message_id: messageId, tool_call_id: toolCallId, widget_id: widgetId, tool_name: String(event.toolName ?? "show_widget"), patch: (event.patch ?? {}) as any } };
    if (event.type === "widget_done") return { event: { type: "widget_done", message_id: messageId, tool_call_id: toolCallId, widget_id: widgetId } };
    if (event.type === "widget_remove") return { event: { type: "widget_remove", message_id: messageId, tool_call_id: toolCallId || undefined, widget_id: widgetId } };
    return { event: { type: "widget_error", message_id: messageId, tool_call_id: toolCallId, widget_id: widgetId, error: String(event.error ?? "Widget execution failed") } };
  }
  if (event.type === "agent.tool_finished") {
    const result = event.result;
    const details = result && typeof result === "object" ? (result as { details?: unknown }).details : undefined;
    const widgetId = details && typeof details === "object" ? (details as { widgetId?: unknown }).widgetId : undefined;
    return { event: { type: "tool_result", message_id: activeMessageId, tool_call_id: String(event.toolCallId ?? ""), name: String(event.toolName ?? ""), arguments: event.args ?? {}, content: readableToolResult(result), details, widget_id: widgetId ? String(widgetId) : undefined, is_error: Boolean(event.isError) } };
  }
  if (event.type === "clarification.request") return { event: { type: "clarification_request", clarification_id: String(event.clarificationId ?? ""), question: String(event.question ?? ""), options: (event.options as string[]) ?? [] } };
  if (event.type === "workspace.artifact.created") return { event: { type: "workspace_updated", tool: "" } };
  if (event.type === "agent.completed") return { event: { type: "done", reason: "completed" } };
  return null;
}

/**
 * Transitional bridge: consumes versioned runtime event envelopes over the
 * shared transport and adapts them to the renderer's chat event model. The
 * adapter dissolves when ChatArea renders versioned events natively.
 */
export function sendChatViaRuntime(
  prompt: string,
  onEvent: (event: SSEEvent) => void,
  onError: (err: unknown) => void,
  onFinish: () => void,
): RuntimeChatHandle {
  let activeMessageId = "";
  let isDone = false;

  const handleFinish = () => {
    if (isDone) return;
    isDone = true;
    unsubscribe();
    onFinish();
  };

  const unsubscribe = subscribeRuntimeEvents((raw) => {
    const envelope = raw as { event?: RuntimeEvent };
    const event = envelope?.event;
    if (!event?.type) return;
    const mapped = mapRuntimeEvent(event, activeMessageId);
    if (!mapped) return;
    if (mapped.messageId !== undefined) activeMessageId = mapped.messageId;
    onEvent(mapped.event);
    if (event.type === "agent.completed") handleFinish();
  });
  const finished = (async () => {
    try {
      await getRuntimeClient().dispatch({ type: "agent.prompt", prompt });
    } catch (err) {
      onError(err);
      handleFinish();
    }
  })();
  return { cancel: () => { unsubscribe(); handleFinish(); }, finished };
}
