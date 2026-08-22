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
import { randomUUID } from "node:crypto";
import { PiJsonlSessionStore } from "./session-store.js";
import { WorkspaceStore } from "./workspace.js";

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
  private readonly eventBuffer: DataAgentEventEnvelope[] = [];
  private readonly metadata?: MetadataStore;
  private readonly sessions?: PiJsonlSessionStore;
  private readonly workspace?: WorkspaceStore;
  private activeRun?: { requestId: string; runId: string };
  private readonly agent?: { prompt(text: string): Promise<unknown>; steer?(text: string): void; followUp?(text: string): void; abort(): void; subscribe?(listener: (event: any) => void): () => void };

  constructor(options: { metadata?: MetadataStore; sessions?: PiJsonlSessionStore; workspace?: WorkspaceStore; agent?: { prompt(text: string): Promise<unknown>; steer?(text: string): void; followUp?(text: string): void; abort(): void; subscribe?(listener: (event: any) => void): () => void } } = {}) {
    this.metadata = options.metadata;
    this.sessions = options.sessions;
    this.workspace = options.workspace;
    this.agent = options.agent;
    this.agent?.subscribe?.((event) => this.mapPiEvent(event));
  }
  private nextSequence = 1;

  eventsAfter(sequence: number): DataAgentEventEnvelope[] {
    return this.eventBuffer.filter((event) => event.sequence > sequence);
  }

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

    if (command.command.type === "workspace.list" || command.command.type === "workspace.read" || command.command.type === "workspace.write" || command.command.type === "workspace.delete") {
      if (!this.workspace) throw new DataAgentRuntimeError("INVALID_COMMAND", "Workspace is not configured");
      this.workspace.assertAccess(context);
      if (command.command.type === "workspace.list") return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "workspace.result", operation: "list", files: await this.workspace.list() } };
      if (command.command.type === "workspace.read") return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "workspace.result", operation: "read", path: command.command.path, content: await this.workspace.read(command.command.path) } };
      if (command.command.type === "workspace.delete") { await this.workspace.delete(command.command.path); return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "workspace.result", operation: "write", path: command.command.path } }; }
      await this.workspace.write(command.command.path, command.command.content);
      this.emit({ protocolVersion: ProtocolVersion, sequence: this.nextSequence++, requestId: command.requestId, sessionId: context.sessionId, timestamp: Date.now(), event: { type: "workspace.artifact.created", path: command.command.path, kind: "file" } });
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "workspace.result", operation: "write", path: command.command.path } };
    }

    if (command.command.type === "agent.steer" || command.command.type === "agent.follow_up") {
      if (!this.agent) throw new DataAgentRuntimeError("INVALID_COMMAND", "Pi Agent is not configured");
      const method = command.command.type === "agent.steer" ? this.agent.steer : this.agent.followUp;
      if (!method) throw new DataAgentRuntimeError("INVALID_COMMAND", "Agent queue operation is not configured");
      method.call(this.agent, command.command.prompt);
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "agent.prompt.accepted", runId: "queued" } };
    }
    if (command.command.type === "agent.stop") {
      if (!this.agent) throw new DataAgentRuntimeError("INVALID_COMMAND", "Pi Agent is not configured");
      this.agent.abort();
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "agent.prompt.accepted", runId: "stopped" } };
    }

    if (command.command.type === "agent.prompt") {
      if (!this.agent) throw new DataAgentRuntimeError("INVALID_COMMAND", "Pi Agent is not configured");
      const runId = randomUUID();
      this.activeRun = { requestId: command.requestId, runId };
      void this.agent.prompt(command.command.prompt).then(() => { this.emit({ protocolVersion: ProtocolVersion, sequence: this.nextSequence++, requestId: command.requestId, runId, timestamp: Date.now(), event: { type: "agent.completed" } }); this.activeRun = undefined; });
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "agent.prompt.accepted", runId } };
    }

    if (command.command.type !== "runtime.probe") {
      if (!this.metadata) throw new DataAgentRuntimeError("INVALID_COMMAND", "Metadata store is not configured");
      const c = command.command;
      const userId = context.userId;
      if (c.type === "task.create") return this.mutation(command.requestId, "task", await this.metadata.call(c.type, userId, { idValue: MetadataStore.createId(), name: c.name }));
      if (c.type === "task.list") return this.list(command.requestId, "task", await this.metadata.call(c.type, userId));
      if (c.type === "task.rename" || c.type === "task.delete") return this.mutation(command.requestId, "task", await this.metadata.call(c.type, userId, c));
      if (c.type === "session.create") {
        const item = await this.metadata.call(c.type, userId, { ...c, idValue: MetadataStore.createId() });
        if (this.sessions) await this.sessions.create({ userId, taskId: c.taskId, sessionId: item.id });
        await this.metadata.call("outbox.enqueue", userId, { sessionId: item.id, sequence: 0 });
        return this.mutation(command.requestId, "session", item);
      }
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

  private mapPiEvent(event: any): void {
    const run = this.activeRun;
    if (!run || event?.type !== "message_update") return;
    const update = event.assistantMessageEvent;
    if (update?.type !== "text_delta" && update?.type !== "thinking_delta") return;
    this.emit({ protocolVersion: ProtocolVersion, sequence: this.nextSequence++, requestId: run.requestId, runId: run.runId, timestamp: Date.now(), event: { type: update.type === "text_delta" ? "agent.text_delta" : "agent.thinking_delta", delta: update.delta } });
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
    this.eventBuffer.push(event);
    if (this.eventBuffer.length > 256) this.eventBuffer.shift();
    for (const listener of this.listeners) listener(event);
  }
}

export { LocalAuthService } from "./auth.js";
export { migrateLegacyData, type MigrationReport } from "./legacy-migration.js";
export { runPythonJob, type PythonJobResult } from "./python-job.js";
export { WorkspaceStore } from "./workspace.js";
export type { RequestContext } from "@data-agent/contracts";
