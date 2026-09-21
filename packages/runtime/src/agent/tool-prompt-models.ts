import type { Api, Context, Model, Models } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { ToolPromptCatalog } from "./tool-prompt-catalog.js";

function configurationErrorStream(model: Model<Api>, message: string): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  stream.push({
    type: "error",
    reason: "error",
    error: {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "error",
      errorMessage: message,
      timestamp: Date.now(),
    },
  });
  return stream;
}

function appendCatalog(systemPrompt: string | undefined, catalog: string): string {
  return systemPrompt?.trim() ? `${systemPrompt}\n\n${catalog}` : catalog;
}

/**
 * Add the request-local tool directory at the Models seam. The adapter reads
 * only Context.tools from this exact request and leaves every other Models
 * method and stream option untouched.
 */
export function withToolPromptCatalog(source: Models, catalog: ToolPromptCatalog): Models {
  const streamSimple: Models["streamSimple"] = (model, context, options) => {
    let rendered: string;
    try {
      rendered = catalog.render(context.tools?.map((tool) => tool.name) ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return configurationErrorStream(model, message);
    }
    if (!rendered) return source.streamSimple(model, context, options);
    const requestContext: Context = {
      ...context,
      systemPrompt: appendCatalog(context.systemPrompt, rendered),
    };
    return source.streamSimple(model, requestContext, options);
  };

  return new Proxy(source, {
    get(target, property) {
      if (property === "streamSimple") return streamSimple;
      const member = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
}
