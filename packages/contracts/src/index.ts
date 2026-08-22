import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

export const ProtocolVersion = 1 as const;

export const RequestContextSchema = Type.Object({
  userId: Type.String({ minLength: 1 }),
  host: Type.Union([Type.Literal("electron"), Type.Literal("web")]),
  sessionId: Type.Optional(Type.String({ minLength: 1 })),
});
export type RequestContext = Static<typeof RequestContextSchema>;

export const DataAgentCommandSchema = Type.Union([
  Type.Object({ type: Type.Literal("runtime.probe") }),
]);
export type DataAgentCommand = Static<typeof DataAgentCommandSchema>;

export const DataAgentCommandEnvelopeSchema = Type.Object({
  protocolVersion: Type.Integer({ minimum: 1 }),
  requestId: Type.String({ minLength: 1 }),
  command: DataAgentCommandSchema,
});
export type DataAgentCommandEnvelope = Static<typeof DataAgentCommandEnvelopeSchema>;

export const RuntimeProbeResponseSchema = Type.Object({
  type: Type.Literal("runtime.probe.result"),
  service: Type.Literal("data-agent-runtime"),
  runtimeVersion: Type.Literal("0.1.0"),
});
export type RuntimeProbeResponse = Static<typeof RuntimeProbeResponseSchema>;

export const DataAgentResponseSchema = Type.Union([
  RuntimeProbeResponseSchema,
]);
export type DataAgentResponse = Static<typeof DataAgentResponseSchema>;

export const DataAgentResponseEnvelopeSchema = Type.Object({
  protocolVersion: Type.Literal(ProtocolVersion),
  requestId: Type.String({ minLength: 1 }),
  response: DataAgentResponseSchema,
});
export type DataAgentResponseEnvelope = Static<typeof DataAgentResponseEnvelopeSchema>;

export const RuntimeProbeCompletedSchema = Type.Object({
  type: Type.Literal("runtime.probe.completed"),
  service: Type.Literal("data-agent-runtime"),
});
export type RuntimeProbeCompleted = Static<typeof RuntimeProbeCompletedSchema>;

export const DataAgentEventSchema = Type.Union([
  RuntimeProbeCompletedSchema,
]);
export type DataAgentEvent = Static<typeof DataAgentEventSchema>;

export const DataAgentEventEnvelopeSchema = Type.Object({
  protocolVersion: Type.Literal(ProtocolVersion),
  sequence: Type.Integer({ minimum: 1 }),
  requestId: Type.String({ minLength: 1 }),
  sessionId: Type.Optional(Type.String({ minLength: 1 })),
  runId: Type.Optional(Type.String({ minLength: 1 })),
  timestamp: Type.Integer({ minimum: 0 }),
  event: DataAgentEventSchema,
});
export type DataAgentEventEnvelope = Static<typeof DataAgentEventEnvelopeSchema>;

export function isDataAgentCommandEnvelope(value: unknown): value is DataAgentCommandEnvelope {
  return Value.Check(DataAgentCommandEnvelopeSchema, value);
}

export function parseDataAgentCommandEnvelope(value: unknown): DataAgentCommandEnvelope {
  if (!isDataAgentCommandEnvelope(value)) {
    throw new TypeError("Invalid DataAgent command envelope");
  }
  return value;
}

export function parseDataAgentResponseEnvelope(value: unknown): DataAgentResponseEnvelope {
  if (!Value.Check(DataAgentResponseEnvelopeSchema, value)) {
    throw new TypeError("Invalid DataAgent response envelope");
  }
  return value;
}
