import { subscribeRuntimeEvents, getRuntimeClient } from "./runtime-client";
import type { SSEEvent } from "./client";

export interface RuntimeChatHandle { cancel: () => void; finished: Promise<void> }

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
  const unsubscribe = subscribeRuntimeEvents((raw) => {
    const envelope = raw as { event?: { type?: string } & Record<string, unknown> };
    const event = envelope?.event;
    if (!event?.type) return;
    if (event.type === "agent.message_started") {
      onEvent({ type: "message_start", message_id: String(event.messageId ?? "") });
    } else if (event.type === "agent.text_delta") {
      onEvent({ type: "text_delta", content: String(event.delta ?? "") });
    } else if (event.type === "agent.thinking_delta") {
      onEvent({ type: "reasoning_delta", message_id: "", content: String(event.delta ?? "") });
    } else if (event.type === "agent.tool_started") {
      onEvent({ type: "tool_call", message_id: "", tool_call_id: String(event.toolCallId ?? ""), name: String(event.toolName ?? ""), arguments: event.args ?? {} });
    } else if (event.type === "agent.tool_finished") {
      onEvent({ type: "tool_result", message_id: "", tool_call_id: String(event.toolCallId ?? ""), name: String(event.toolName ?? ""), arguments: {}, content: JSON.stringify(event.result ?? null), is_error: Boolean(event.isError) });
    } else if (event.type === "clarification.request") {
      onEvent({ type: "clarification_request", clarification_id: String(event.clarificationId ?? ""), question: String(event.question ?? ""), options: (event.options as string[]) ?? [] });
    } else if (event.type === "workspace.artifact.created") {
      onEvent({ type: "workspace_updated", tool: "" });
    } else if (event.type === "agent.completed") {
      onEvent({ type: "done", reason: "completed" });
    }
  });
  const finished = (async () => {
    try {
      await getRuntimeClient().dispatch({ type: "agent.prompt", prompt });
      onFinish();
    } catch (err) {
      onError(err);
      onFinish();
    }
  })();
  return { cancel: () => { unsubscribe(); }, finished };
}
