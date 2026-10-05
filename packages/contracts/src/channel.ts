import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

/**
 * Channel boundary (ADR-0011): an external platform enters only as a
 * Submission and leaves only as a Deliverable. Platform adapters depend on
 * these schemas, never on Runtime internals.
 */

const Id = Type.String({ minLength: 1, maxLength: 256 });

/** Where a conversation lives on a Channel, and who can see it there. */
export const ConversationAddressSchema = Type.Object({
  channel: Id,
  tenant: Id,
  chatId: Id,
  threadId: Type.Optional(Id),
  audience: Type.Union([Type.Literal("direct"), Type.Literal("group")]),
}, { additionalProperties: false });
export type ConversationAddress = Static<typeof ConversationAddressSchema>;

/** A sender the Channel has verified; identity never comes from message content. */
export const ChannelActorSchema = Type.Object({
  channel: Id,
  tenant: Id,
  externalUserId: Id,
  displayName: Type.Optional(Type.String({ maxLength: 256 })),
}, { additionalProperties: false });
export type ChannelActor = Static<typeof ChannelActorSchema>;

export const SubmissionBodySchema = Type.Union([
  Type.Object({ kind: Type.Literal("input"), text: Type.String({ minLength: 1 }), whenBusy: Type.Union([Type.Literal("steer"), Type.Literal("follow_up")]) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("answer"), clarificationId: Id, text: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
]);
export type SubmissionBody = Static<typeof SubmissionBodySchema>;

/** The only inbound shape. `requestId` is the platform event id, deduplicated per Channel. */
export const SubmissionSchema = Type.Object({
  requestId: Id,
  address: ConversationAddressSchema,
  actor: ChannelActorSchema,
  body: SubmissionBodySchema,
}, { additionalProperties: false });
export type Submission = Static<typeof SubmissionSchema>;

/** A Receipt as delivered: enough to render without reading tool output. */
export const PublicationDeliveredSchema = Type.Object({
  type: Type.Literal("publication.delivered"),
  receiptId: Id,
  taskId: Id,
  format: Type.Union([Type.Literal("inline"), Type.Literal("csv")]),
  publicRef: Type.String({ minLength: 1 }),
  disclosure: Type.Optional(Type.String()),
  inlineContent: Type.Optional(Type.String()),
}, { additionalProperties: false });
export type PublicationDelivered = Static<typeof PublicationDeliveredSchema>;

export const NoticeCodeSchema = Type.Union([
  /** A Publication for a group that is not allowed group delivery went to the asker privately. */
  Type.Literal("GROUP_DELIVERY_REDIRECTED"),
  /** A Submission was accepted but the process stopped before it was dispatched. */
  Type.Literal("SUBMISSION_INTERRUPTED"),
  /** The Runtime refused a Submission. */
  Type.Literal("SUBMISSION_REJECTED"),
]);
export type NoticeCode = Static<typeof NoticeCodeSchema>;

/** What may leave the system through a Channel. Persisted before delivery. */
export const DeliverableSchema = Type.Union([
  Type.Object({ kind: Type.Literal("question"), clarificationId: Id, question: Type.String(), options: Type.Array(Type.String()) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("publication"), publication: PublicationDeliveredSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("notice"), code: NoticeCodeSchema, text: Type.String() }, { additionalProperties: false }),
]);
export type Deliverable = Static<typeof DeliverableSchema>;

/** A Deliverable goes to a conversation, or privately to one actor. */
export const DeliveryTargetSchema = Type.Union([
  Type.Object({ kind: Type.Literal("address"), address: ConversationAddressSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("actor"), actor: ChannelActorSchema }, { additionalProperties: false }),
]);
export type DeliveryTarget = Static<typeof DeliveryTargetSchema>;

/** Latest state of a run. Progress may be dropped; a Channel redraws from the newest view. */
export const ProgressViewSchema = Type.Object({
  runId: Type.Optional(Type.String()),
  state: Type.Union([Type.Literal("running"), Type.Literal("completed")]),
  text: Type.String(),
  activeTool: Type.Optional(Type.String()),
}, { additionalProperties: false });
export type ProgressView = Static<typeof ProgressViewSchema>;

export interface ChannelCapabilities {
  /** A sent message can be edited in place, so progress can stream into it. */
  readonly editableMessages: boolean;
  /** Messages can carry buttons whose clicks come back as Submissions. */
  readonly actions: boolean;
  /** Files can be sent. */
  readonly files: boolean;
}

/** Content the core reads on the Channel's behalf, with the asker's authority, only when asked. */
export interface DeliveryContent {
  /** The published result as CSV; present for publication Deliverables. */
  readonly readPublication?: () => Promise<string>;
}

/**
 * One platform adapter. `start` hands the Channel a sink for verified inbound
 * events; `deliver` must be idempotent on `idempotencyKey`, because the core
 * delivers at least once. Progress follows the same audience rule as
 * publications, so it is addressed by target too.
 */
export interface Channel {
  readonly id: string;
  readonly capabilities: ChannelCapabilities;
  start(sink: (submission: Submission) => Promise<void>): Promise<void>;
  deliver(target: DeliveryTarget, deliverable: Deliverable, idempotencyKey: string, content?: DeliveryContent): Promise<void>;
  progress?(target: DeliveryTarget, view: ProgressView): Promise<void>;
  stop(): Promise<void>;
}

export function parseSubmission(value: unknown): Submission {
  if (!Value.Check(SubmissionSchema, value)) throw new TypeError("Invalid channel submission");
  return value;
}
