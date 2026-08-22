import { Agent } from "@earendil-works/pi-agent-core";
import { createModels, type Model, type Models } from "@earendil-works/pi-ai";

export interface PiAgentTextEvent {
  type: "text_delta" | "thinking_delta" | "agent_end";
  delta?: string;
}

export interface PiAgentRunnerOptions {
  model: Model<any>;
  models?: Models;
  systemPrompt?: string;
  onEvent?: (event: PiAgentTextEvent) => void;
}

/** Thin infrastructure adapter; application code must not depend on Pi events. */
export function createPiAgentRunner(options: PiAgentRunnerOptions): Agent {
  const models = options.models ?? createModels();
  const agent = new Agent({
    initialState: {
      systemPrompt: options.systemPrompt ?? "You are Data Agent.",
      model: options.model,
      thinkingLevel: "off",
      tools: [],
    },
    convertToLlm: (messages) => messages.filter((message) =>
      message.role === "user" || message.role === "assistant" || message.role === "toolResult",
    ),
    streamFn: models.streamSimple.bind(models),
  });

  if (options.onEvent) {
    agent.subscribe((event) => {
      if (event.type === "message_update") {
        if (event.assistantMessageEvent.type === "text_delta") options.onEvent?.({ type: "text_delta", delta: event.assistantMessageEvent.delta });
        if (event.assistantMessageEvent.type === "thinking_delta") options.onEvent?.({ type: "thinking_delta", delta: event.assistantMessageEvent.delta });
      }
      if (event.type === "agent_end") options.onEvent?.({ type: "agent_end" });
    });
  }
  return agent;
}
