import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

export const ProtocolVersion = 1 as const;
export const RequestContextSchema = Type.Object({ userId: Type.String({ minLength: 1 }), host: Type.Union([Type.Literal("electron"), Type.Literal("web")]), sessionId: Type.Optional(Type.String({ minLength: 1 })) });
export type RequestContext = Static<typeof RequestContextSchema>;

const RuntimeProbeCommandSchema = Type.Object({ type: Type.Literal("runtime.probe") });
const AgentPromptCommandSchema = Type.Object({ type: Type.Literal("agent.prompt"), prompt: Type.String({ minLength: 1 }) });
const AgentSteerCommandSchema = Type.Object({ type: Type.Literal("agent.steer"), prompt: Type.String({ minLength: 1 }) });
const AgentFollowUpCommandSchema = Type.Object({ type: Type.Literal("agent.follow_up"), prompt: Type.String({ minLength: 1 }) });
const AgentStopCommandSchema = Type.Object({ type: Type.Literal("agent.stop") });
const WorkspaceListCommandSchema = Type.Object({ type: Type.Literal("workspace.list") });
const WorkspaceReadCommandSchema = Type.Object({ type: Type.Literal("workspace.read"), path: Type.String({ minLength: 1 }) });
const WorkspaceWriteCommandSchema = Type.Object({ type: Type.Literal("workspace.write"), path: Type.String({ minLength: 1 }), content: Type.String() });
const WorkspaceDeleteCommandSchema = Type.Object({ type: Type.Literal("workspace.delete"), path: Type.String({ minLength: 1 }) });
const RunPythonCommandSchema = Type.Object({ type: Type.Literal("python.run"), code: Type.String({ minLength: 1 }), description: Type.Optional(Type.String()) });
const TaskCreateCommandSchema = Type.Object({ type: Type.Literal("task.create"), name: Type.String({ minLength: 1 }) });
const TaskListCommandSchema = Type.Object({ type: Type.Literal("task.list") });
const TaskRenameCommandSchema = Type.Object({ type: Type.Literal("task.rename"), taskId: Type.String({ minLength: 1 }), name: Type.String({ minLength: 1 }) });
const TaskDeleteCommandSchema = Type.Object({ type: Type.Literal("task.delete"), taskId: Type.String({ minLength: 1 }) });
const SessionCreateCommandSchema = Type.Object({ type: Type.Literal("session.create"), taskId: Type.String({ minLength: 1 }), name: Type.Optional(Type.String({ minLength: 1 })) });
const SessionListCommandSchema = Type.Object({ type: Type.Literal("session.list"), taskId: Type.Optional(Type.String({ minLength: 1 })) });
const SessionRenameCommandSchema = Type.Object({ type: Type.Literal("session.rename"), sessionId: Type.String({ minLength: 1 }), name: Type.String({ minLength: 1 }) });
const SessionDeleteCommandSchema = Type.Object({ type: Type.Literal("session.delete"), sessionId: Type.String({ minLength: 1 }) });
export const DataAgentCommandSchema = Type.Union([RuntimeProbeCommandSchema, AgentPromptCommandSchema, AgentSteerCommandSchema, AgentFollowUpCommandSchema, AgentStopCommandSchema, WorkspaceListCommandSchema, WorkspaceReadCommandSchema, WorkspaceWriteCommandSchema, WorkspaceDeleteCommandSchema, RunPythonCommandSchema, TaskCreateCommandSchema, TaskListCommandSchema, TaskRenameCommandSchema, TaskDeleteCommandSchema, SessionCreateCommandSchema, SessionListCommandSchema, SessionRenameCommandSchema, SessionDeleteCommandSchema]);
export type DataAgentCommand = Static<typeof DataAgentCommandSchema>;
export const DataAgentCommandEnvelopeSchema = Type.Object({ protocolVersion: Type.Integer({ minimum: 1 }), requestId: Type.String({ minLength: 1 }), command: DataAgentCommandSchema });
export type DataAgentCommandEnvelope = Static<typeof DataAgentCommandEnvelopeSchema>;

const RuntimeProbeResponseSchema = Type.Object({ type: Type.Literal("runtime.probe.result"), service: Type.Literal("data-agent-runtime"), runtimeVersion: Type.Literal("0.1.0") });
const AgentPromptResponseSchema = Type.Object({ type: Type.Literal("agent.prompt.accepted"), runId: Type.String({ minLength: 1 }) });
const PythonResponseSchema = Type.Object({ type: Type.Literal("python.result"), jobId: Type.String(), status: Type.Union([Type.Literal("success"), Type.Literal("error"), Type.Literal("timeout"), Type.Literal("aborted")]), exitCode: Type.Union([Type.Number(), Type.Null()]), stdout: Type.String(), stderr: Type.String(), scriptPath: Type.String(), durationMs: Type.Number() });
const WorkspaceResponseSchema = Type.Object({ type: Type.Literal("workspace.result"), operation: Type.Union([Type.Literal("list"), Type.Literal("read"), Type.Literal("write")]), path: Type.Optional(Type.String()), content: Type.Optional(Type.String()), files: Type.Optional(Type.Array(Type.String())) });
const TaskSchema = Type.Object({ id: Type.String(), name: Type.String(), createdAt: Type.Number(), updatedAt: Type.Number() });
const SessionSchema = Type.Object({ id: Type.String(), taskId: Type.String(), name: Type.String(), createdAt: Type.Number(), updatedAt: Type.Number() });
const MutationResponseSchema = Type.Object({ type: Type.Literal("mutation.result"), entity: Type.Union([Type.Literal("task"), Type.Literal("session")]), item: Type.Union([TaskSchema, SessionSchema]) });
const ListResponseSchema = Type.Object({ type: Type.Literal("list.result"), entity: Type.Union([Type.Literal("task"), Type.Literal("session")]), items: Type.Array(Type.Union([TaskSchema, SessionSchema])) });
export const DataAgentResponseSchema = Type.Union([RuntimeProbeResponseSchema, AgentPromptResponseSchema, PythonResponseSchema, WorkspaceResponseSchema, MutationResponseSchema, ListResponseSchema]);
export type DataAgentResponse = Static<typeof DataAgentResponseSchema>;
export const DataAgentResponseEnvelopeSchema = Type.Object({ protocolVersion: Type.Literal(ProtocolVersion), requestId: Type.String({ minLength: 1 }), response: DataAgentResponseSchema });
export type DataAgentResponseEnvelope = Static<typeof DataAgentResponseEnvelopeSchema>;

export const DataAgentEventSchema = Type.Union([Type.Object({ type: Type.Literal("runtime.probe.completed"), service: Type.Literal("data-agent-runtime") }), Type.Object({ type: Type.Literal("agent.text_delta"), delta: Type.String() }), Type.Object({ type: Type.Literal("agent.thinking_delta"), delta: Type.String() }), Type.Object({ type: Type.Literal("agent.completed") }), Type.Object({ type: Type.Literal("workspace.artifact.created"), path: Type.String(), kind: Type.Literal("file") })]);
export type DataAgentEvent = Static<typeof DataAgentEventSchema>;
export const DataAgentEventEnvelopeSchema = Type.Object({ protocolVersion: Type.Literal(ProtocolVersion), sequence: Type.Integer({ minimum: 1 }), requestId: Type.String({ minLength: 1 }), sessionId: Type.Optional(Type.String()), runId: Type.Optional(Type.String()), timestamp: Type.Integer({ minimum: 0 }), event: DataAgentEventSchema });
export type DataAgentEventEnvelope = Static<typeof DataAgentEventEnvelopeSchema>;
export function isDataAgentCommandEnvelope(value: unknown): value is DataAgentCommandEnvelope { return Value.Check(DataAgentCommandEnvelopeSchema, value); }
export function parseDataAgentCommandEnvelope(value: unknown): DataAgentCommandEnvelope { if (!isDataAgentCommandEnvelope(value)) throw new TypeError("Invalid DataAgent command envelope"); return value; }
export function parseDataAgentResponseEnvelope(value: unknown): DataAgentResponseEnvelope { if (!Value.Check(DataAgentResponseEnvelopeSchema, value)) throw new TypeError("Invalid DataAgent response envelope"); return value; }
