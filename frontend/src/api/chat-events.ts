import { subscribeRuntimeEvents, getRuntimeClient } from "./runtime-client";
import type { SSEEvent } from "./client";

export interface RuntimeChatHandle { cancel: () => void; finished: Promise<void> }

type RuntimeEvent = { type?: string; [key: string]: unknown };

/** Convert a versioned runtime event into the renderer's replayable chat event. */
export function mapRuntimeEvent(event: RuntimeEvent, activeMessageId: string): SSEEvent | undefined {
  if (event.type === "agent.text_delta") {
    return { type: "text_delta", message_id: activeMessageId, content: String(event.delta ?? "") };
  }
  if (event.type === "agent.thinking_delta") {
    return { type: "reasoning_delta", message_id: activeMessageId, content: String(event.delta ?? "") };
  }
  if (event.type === "agent.tool_started") {
    return { type: "tool_call", message_id: activeMessageId, tool_call_id: String(event.toolCallId ?? ""), name: String(event.toolName ?? ""), arguments: event.args ?? {} };
  }
  if (event.type === "agent.tool_finished") {
    return {
      type: "tool_result",
      message_id: activeMessageId,
      tool_call_id: String(event.toolCallId ?? ""),
      name: String(event.toolName ?? ""),
      ...(event.args !== undefined ? { arguments: event.args } : {}),
      content: JSON.stringify(event.result ?? null),
      is_error: Boolean(event.isError),
    };
  }
  if (event.type === "clarification.request") {
    return { type: "clarification_request", clarification_id: String(event.clarificationId ?? ""), question: String(event.question ?? ""), options: (event.options as string[]) ?? [] };
  }
  if (event.type === "workspace.artifact.created") {
    return { type: "workspace_updated", tool: "" };
  }
  if (event.type === "agent.completed") {
    return { type: "done", reason: "completed" };
  }
  return undefined;
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
    const envelope = raw as { event?: { type?: string } & Record<string, unknown> };
    const event = envelope?.event;
    if (!event?.type) return;
    if (event.type === "agent.message_started") {
      activeMessageId = String(event.messageId || `msg-${Date.now()}`);
      onEvent({ type: "message_start", message_id: activeMessageId });
    } else {
      const mapped = mapRuntimeEvent(event, activeMessageId);
      if (mapped) onEvent(mapped);
      if (event.type === "agent.completed") handleFinish();
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
