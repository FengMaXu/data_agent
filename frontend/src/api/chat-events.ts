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
  let activeMessageId = "";
  let isDone = false;
  const toolArgumentsById = new Map<string, unknown>();

  const handleFinish = () => {
    if (isDone) return;
    isDone = true;
    unsubscribe();
    onFinish();
  };

  const unsubscribe = subscribeRuntimeEvents((raw) => {
    const envelope = raw as {
      sessionId?: string;
      event?: { type?: string } & Record<string, unknown>;
    };
    const event = envelope?.event;
    if (!event?.type) return;
    const sessionId = envelope.sessionId;
    const emit = (adapted: SSEEvent) => {
      // Preserve the envelope identity so ChatArea can ignore replayed events
      // belonging to another session.
      onEvent(sessionId ? { ...adapted, session_id: sessionId } as SSEEvent : adapted);
    };
    if (event.type === "agent.message_started") {
      activeMessageId = String(event.messageId || `msg-${Date.now()}`);
      emit({ type: "message_start", message_id: activeMessageId });
    } else if (event.type === "agent.text_delta") {
      emit({ type: "text_delta", message_id: activeMessageId, content: String(event.delta ?? "") });
    } else if (event.type === "agent.thinking_delta") {
      emit({ type: "reasoning_delta", message_id: activeMessageId, content: String(event.delta ?? "") });
    } else if (event.type === "agent.tool_started") {
      const toolCallId = String(event.toolCallId ?? "");
      const args = event.args ?? {};
      toolArgumentsById.set(toolCallId, args);
      emit({ type: "tool_call", message_id: activeMessageId, tool_call_id: toolCallId, name: String(event.toolName ?? ""), arguments: args });
    } else if (event.type === "agent.tool_finished") {
      const toolCallId = String(event.toolCallId ?? "");
      const args = event.args ?? toolArgumentsById.get(toolCallId) ?? {};
      toolArgumentsById.delete(toolCallId);
      emit({ type: "tool_result", message_id: activeMessageId, tool_call_id: toolCallId, name: String(event.toolName ?? ""), arguments: args, content: JSON.stringify(event.result ?? null), details: event.details, is_error: Boolean(event.isError) });
    } else if (event.type === "clarification.request") {
      emit({ type: "clarification_request", clarification_id: String(event.clarificationId ?? ""), question: String(event.question ?? ""), options: (event.options as string[]) ?? [] });
    } else if (event.type === "workspace.artifact.created") {
      emit({ type: "workspace_updated", tool: "" });
    } else if (event.type === "agent.completed") {
      emit({ type: "done", reason: "completed" });
      handleFinish();
    }
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
