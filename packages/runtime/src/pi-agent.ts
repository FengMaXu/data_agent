import { Agent } from "@earendil-works/pi-agent-core";
import { createModels, type Model, type Models } from "@earendil-works/pi-ai";

export interface PiAgentTextEvent {
  type: "text_delta" | "thinking_delta" | "agent_end";
  delta?: string;
}

export interface DataAgentModelProfile {
  provider: string;
  model: string;
  apiKey?: string;
}

export function resolvePiModel(models: Models, profile: DataAgentModelProfile): Model<any> {
  if (profile.apiKey && "setRuntimeApiKey" in models && typeof models.setRuntimeApiKey === "function") {
    models.setRuntimeApiKey(profile.provider, profile.apiKey);
  }
  const model = models.getModel(profile.provider, profile.model);
  if (!model) throw new Error(`Model not found: ${profile.provider}/${profile.model}`);
  return model;
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
