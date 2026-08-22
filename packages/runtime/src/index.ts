import {
  DataAgentEventEnvelopeSchema,
  DataAgentResponseEnvelopeSchema,
  ProtocolVersion,
  RequestContextSchema,
  type DataAgentCommandEnvelope,
  type DataAgentEventEnvelope,
  type DataAgentResponseEnvelope,
  type RequestContext,
} from "@data-agent/contracts";
import { Value } from "typebox/value";
import { MetadataStore } from "./metadata.js";

export class DataAgentRuntimeError extends Error {
  readonly code: "INVALID_COMMAND" | "UNSUPPORTED_PROTOCOL_VERSION" | "INVALID_CONTEXT";
  readonly details?: unknown;

  constructor(
    code: DataAgentRuntimeError["code"],
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "DataAgentRuntimeError";
    this.code = code;
    this.details = details;
  }
}

export type DataAgentEventListener = (event: DataAgentEventEnvelope) => void;

export class DataAgentRuntime {
  private readonly listeners = new Set<DataAgentEventListener>();
  private readonly metadata?: MetadataStore;

  constructor(options: { metadata?: MetadataStore } = {}) {
    this.metadata = options.metadata;
  }
  private nextSequence = 1;

  subscribe(listener: DataAgentEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async dispatch(
    command: DataAgentCommandEnvelope,
    context: RequestContext,
  ): Promise<DataAgentResponseEnvelope> {
    this.assertContext(context);

    if (command.protocolVersion !== ProtocolVersion) {
      throw new DataAgentRuntimeError(
        "UNSUPPORTED_PROTOCOL_VERSION",
        `Unsupported protocol version: ${command.protocolVersion}`,
        { supported: ProtocolVersion },
      );
    }

    if (command.command.type !== "runtime.probe") {
      if (!this.metadata) throw new DataAgentRuntimeError("INVALID_COMMAND", "Metadata store is not configured");
      const c = command.command;
      const userId = context.userId;
      if (c.type === "task.create") return this.mutation(command.requestId, "task", await this.metadata.call(c.type, userId, { idValue: MetadataStore.createId(), name: c.name }));
      if (c.type === "task.list") return this.list(command.requestId, "task", await this.metadata.call(c.type, userId));
      if (c.type === "task.rename" || c.type === "task.delete") return this.mutation(command.requestId, "task", await this.metadata.call(c.type, userId, c));
      if (c.type === "session.create") return this.mutation(command.requestId, "session", await this.metadata.call(c.type, userId, { ...c, idValue: MetadataStore.createId() }));
      if (c.type === "session.list") return this.list(command.requestId, "session", await this.metadata.call(c.type, userId, c));
      if (c.type === "session.rename" || c.type === "session.delete") return this.mutation(command.requestId, "session", await this.metadata.call(c.type, userId, c));
      throw new DataAgentRuntimeError("INVALID_COMMAND", "Unsupported DataAgent command");
    }

    const response: DataAgentResponseEnvelope = {
      protocolVersion: ProtocolVersion,
      requestId: command.requestId,
      response: {
        type: "runtime.probe.result",
        service: "data-agent-runtime",
        runtimeVersion: "0.1.0",
      },
    };

    if (!Value.Check(DataAgentResponseEnvelopeSchema, response)) {
      throw new DataAgentRuntimeError("INVALID_COMMAND", "Runtime produced an invalid response");
    }

    this.emit({
      protocolVersion: ProtocolVersion,
      sequence: this.nextSequence++,
      requestId: command.requestId,
      timestamp: Date.now(),
      event: {
        type: "runtime.probe.completed",
        service: "data-agent-runtime",
      },
    });

    return response;
  }

  private mutation(requestId: string, entity: "task" | "session", item: unknown): DataAgentResponseEnvelope { return { protocolVersion: ProtocolVersion, requestId, response: { type: "mutation.result", entity, item: item as never } }; }
  private list(requestId: string, entity: "task" | "session", items: unknown): DataAgentResponseEnvelope { return { protocolVersion: ProtocolVersion, requestId, response: { type: "list.result", entity, items: items as never[] } }; }

  private assertContext(context: RequestContext): void {
    if (!Value.Check(RequestContextSchema, context)) {
      throw new DataAgentRuntimeError("INVALID_CONTEXT", "Invalid request context");
    }
  }

  private emit(event: DataAgentEventEnvelope): void {
    if (!Value.Check(DataAgentEventEnvelopeSchema, event)) {
      throw new DataAgentRuntimeError("INVALID_COMMAND", "Runtime produced an invalid event");
    }
    for (const listener of this.listeners) listener(event);
  }
}

export type { RequestContext } from "@data-agent/contracts";
