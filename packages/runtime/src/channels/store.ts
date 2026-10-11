import type { ChannelActor, ConversationAddress, Deliverable, DeliveryTarget, Submission } from "@data-agent/contracts";
import type { MetadataStore } from "../metadata.js";

/** `account`: linked to a signed-in account with /bind, may approve others. `guest`: approved to use the bot only. */
export type MemberRole = "account" | "guest";

export interface LinkedUser {
  readonly userId: string;
  readonly role: MemberRole;
}

export interface AccessRequest {
  readonly id: string;
  readonly requester: ChannelActor;
  readonly audience: ConversationAddress["audience"];
  readonly text: string;
  readonly at: number;
}

export interface ChannelSessionBinding {
  readonly sessionId: string;
  readonly taskId: string;
}

export interface CurrentSession extends ChannelSessionBinding {
  /** When a Submission last reached this Session. */
  readonly lastActiveAt: number;
}

export interface BoundSession {
  readonly userId: string;
  readonly address: ConversationAddress;
  readonly actor: ChannelActor;
}

export interface OutboxItem {
  readonly id: number;
  readonly channel: string;
  readonly idempotencyKey: string;
  readonly target: DeliveryTarget;
  readonly deliverable: Deliverable;
  /** The Session whose event produced it; content is read with its owner's authority. */
  readonly sessionId?: string;
  readonly attempts: number;
}

export type OutboxSettlement =
  | { readonly status: "delivered"; readonly attempts: number }
  | { readonly status: "pending"; readonly attempts: number; readonly nextAttemptAt: number; readonly error: string }
  | { readonly status: "failed"; readonly attempts: number; readonly error: string };

/** Durable state of the channel boundary (ADR-0011). */
export interface ChannelStore {
  /** False when this platform event was already accepted. */
  acceptInbound(channel: string, submission: Submission, at: number): Promise<boolean>;
  settleInbound(channel: string, requestId: string, status: "dispatched" | "rejected" | "interrupted" | "denied"): Promise<void>;
  /** Accepted before `before` and never dispatched: the process stopped in between. */
  interruptedInbound(channel: string, before: number): Promise<readonly { readonly requestId: string; readonly address: ConversationAddress }[]>;
  /** The account this IM identity is linked to; undefined means it may not use the channel. */
  linkedUser(actor: ChannelActor): Promise<LinkedUser | undefined>;
  link(actor: ChannelActor, userId: string, at: number, role?: MemberRole): Promise<void>;
  unlink(actor: ChannelActor): Promise<void>;
  members(): Promise<readonly { readonly actor: ChannelActor; readonly role: MemberRole; readonly since: number }[]>;
  /** The latest request this identity made to use the bot, if any. */
  latestRequest(actor: ChannelActor): Promise<{ readonly id: string; readonly status: "pending" | "approved" | "denied"; readonly decidedAt: number | null } | undefined>;
  createRequest(request: AccessRequest): Promise<void>;
  request(id: string): Promise<(AccessRequest & { readonly status: "pending" | "approved" | "denied" }) | undefined>;
  pendingRequests(): Promise<readonly AccessRequest[]>;
  /** False when the request was already decided, possibly by someone else just now. */
  decideRequest(id: string, status: "approved" | "denied", decidedBy: string, at: number): Promise<boolean>;
  /** False when the code is already taken; the caller draws another. */
  createLinkCode(code: string, userId: string, expiresAt: number): Promise<boolean>;
  /** The account a valid, unused code was issued to, spending the code; undefined otherwise. */
  consumeLinkCode(code: string, at: number): Promise<string | undefined>;
  /** The current Session of this address and speaker; superseded ones are not returned. */
  findSession(address: ConversationAddress, userId: string): Promise<CurrentSession | undefined>;
  findTask(address: ConversationAddress, userId: string): Promise<string | undefined>;
  /** Returns the binding that won when two submissions raced to create one. */
  bindSession(address: ConversationAddress, actor: ChannelActor, userId: string, binding: ChannelSessionBinding, at: number): Promise<CurrentSession>;
  /** Ends a Session as the current one; it keeps routing its own late events. */
  supersedeSession(sessionId: string, at: number): Promise<void>;
  touchSession(sessionId: string, at: number): Promise<void>;
  /** Any Session a channel ever bound, current or superseded. */
  boundSession(sessionId: string): Promise<BoundSession | undefined>;
  /** False when a Deliverable with this key was already queued for the channel. It is due at `at`. */
  enqueue(channel: string, idempotencyKey: string, target: DeliveryTarget, deliverable: Deliverable, at: number, sessionId?: string): Promise<boolean>;
  due(now: number, channel?: string, limit?: number): Promise<readonly OutboxItem[]>;
  settle(id: number, settlement: OutboxSettlement, at: number): Promise<void>;
}

const threadKey = (address: ConversationAddress): string => address.threadId ?? "";

export class MetadataChannelStore implements ChannelStore {
  constructor(private readonly metadata: MetadataStore) {}

  async acceptInbound(channel: string, submission: Submission, at: number): Promise<boolean> {
    const result = await this.metadata.call("channel.inbound.accept", "system", { channel, requestId: submission.requestId, addressJson: JSON.stringify(submission.address), actorJson: JSON.stringify(submission.actor), at }) as { accepted: boolean };
    return result.accepted;
  }

  async settleInbound(channel: string, requestId: string, status: "dispatched" | "rejected" | "interrupted" | "denied"): Promise<void> {
    await this.metadata.call("channel.inbound.settle", "system", { channel, requestId, status });
  }

  async interruptedInbound(channel: string, before: number): Promise<readonly { readonly requestId: string; readonly address: ConversationAddress }[]> {
    const rows = await this.metadata.call("channel.inbound.interrupted", "system", { channel, before }) as { requestId: string; addressJson: string }[];
    return rows.map((row) => ({ requestId: row.requestId, address: JSON.parse(row.addressJson) as ConversationAddress }));
  }

  async linkedUser(actor: ChannelActor): Promise<LinkedUser | undefined> {
    return (await this.metadata.call("channel.link.get", "system", { channel: actor.channel, tenant: actor.tenant, externalUserId: actor.externalUserId })) ?? undefined;
  }

  async link(actor: ChannelActor, userId: string, at: number, role: MemberRole = "account"): Promise<void> {
    await this.metadata.call("channel.link.set", "system", { channel: actor.channel, tenant: actor.tenant, externalUserId: actor.externalUserId, userId, at, role });
  }

  async unlink(actor: ChannelActor): Promise<void> {
    await this.metadata.call("channel.link.remove", "system", { channel: actor.channel, tenant: actor.tenant, externalUserId: actor.externalUserId });
  }

  async members(): Promise<readonly { readonly actor: ChannelActor; readonly role: MemberRole; readonly since: number }[]> {
    const rows = await this.metadata.call("channel.link.list", "system") as { channel: string; tenant: string; externalUserId: string; role: MemberRole; linkedAt: number }[];
    return rows.map((row) => ({ actor: { channel: row.channel, tenant: row.tenant, externalUserId: row.externalUserId }, role: row.role, since: row.linkedAt }));
  }

  async latestRequest(actor: ChannelActor): Promise<{ readonly id: string; readonly status: "pending" | "approved" | "denied"; readonly decidedAt: number | null } | undefined> {
    return (await this.metadata.call("channel.request.latest", "system", { channel: actor.channel, tenant: actor.tenant, externalUserId: actor.externalUserId })) ?? undefined;
  }

  async createRequest(request: AccessRequest): Promise<void> {
    const { requester } = request;
    await this.metadata.call("channel.request.create", "system", { requestId: request.id, channel: requester.channel, tenant: requester.tenant, externalUserId: requester.externalUserId, actorJson: JSON.stringify(requester), audience: request.audience, text: request.text, at: request.at });
  }

  async request(id: string): Promise<(AccessRequest & { readonly status: "pending" | "approved" | "denied" }) | undefined> {
    const row = await this.metadata.call("channel.request.get", "system", { requestId: id }) as { id: string; actorJson: string; audience: AccessRequest["audience"]; text: string; status: "pending" | "approved" | "denied"; createdAt: number } | null;
    return row ? { id: row.id, requester: JSON.parse(row.actorJson) as ChannelActor, audience: row.audience, text: row.text, at: row.createdAt, status: row.status } : undefined;
  }

  async pendingRequests(): Promise<readonly AccessRequest[]> {
    const rows = await this.metadata.call("channel.request.pending", "system") as { id: string; actorJson: string; audience: AccessRequest["audience"]; text: string; createdAt: number }[];
    return rows.map((row) => ({ id: row.id, requester: JSON.parse(row.actorJson) as ChannelActor, audience: row.audience, text: row.text, at: row.createdAt }));
  }

  async decideRequest(id: string, status: "approved" | "denied", decidedBy: string, at: number): Promise<boolean> {
    return (await this.metadata.call("channel.request.decide", "system", { requestId: id, status, decidedBy, at }) as { decided: boolean }).decided;
  }

  async createLinkCode(code: string, userId: string, expiresAt: number): Promise<boolean> {
    return (await this.metadata.call("channel.code.create", "system", { code, userId, expiresAt }) as { created: boolean }).created;
  }

  async consumeLinkCode(code: string, at: number): Promise<string | undefined> {
    return (await this.metadata.call("channel.code.consume", "system", { code, at })) ?? undefined;
  }

  async findSession(address: ConversationAddress, userId: string): Promise<CurrentSession | undefined> {
    return (await this.metadata.call("channel.session.find", "system", { channel: address.channel, tenant: address.tenant, chatId: address.chatId, threadKey: threadKey(address), userId })) ?? undefined;
  }

  async findTask(address: ConversationAddress, userId: string): Promise<string | undefined> {
    const row = await this.metadata.call("channel.task.find", "system", { channel: address.channel, tenant: address.tenant, chatId: address.chatId, userId }) as { taskId: string } | null;
    return row?.taskId;
  }

  bindSession(address: ConversationAddress, actor: ChannelActor, userId: string, binding: ChannelSessionBinding, at: number): Promise<CurrentSession> {
    return this.metadata.call("channel.session.bind", "system", { channel: address.channel, tenant: address.tenant, chatId: address.chatId, threadKey: threadKey(address), userId, sessionId: binding.sessionId, taskId: binding.taskId, addressJson: JSON.stringify(address), actorJson: JSON.stringify(actor), at });
  }

  async supersedeSession(sessionId: string, at: number): Promise<void> {
    await this.metadata.call("channel.session.supersede", "system", { sessionId, at });
  }

  async touchSession(sessionId: string, at: number): Promise<void> {
    await this.metadata.call("channel.session.touch", "system", { sessionId, at });
  }

  async boundSession(sessionId: string): Promise<BoundSession | undefined> {
    const row = await this.metadata.call("channel.session.get", "system", { sessionId }) as { userId: string; addressJson: string; actorJson: string } | null;
    return row ? { userId: row.userId, address: JSON.parse(row.addressJson) as ConversationAddress, actor: JSON.parse(row.actorJson) as ChannelActor } : undefined;
  }

  async enqueue(channel: string, idempotencyKey: string, target: DeliveryTarget, deliverable: Deliverable, at: number, sessionId?: string): Promise<boolean> {
    const result = await this.metadata.call("channel.outbox.enqueue", "system", { channel, idempotencyKey, targetJson: JSON.stringify(target), deliverableJson: JSON.stringify(deliverable), at, ...(sessionId ? { sessionId } : {}) }) as { queued: boolean };
    return result.queued;
  }

  async due(now: number, channel?: string, limit?: number): Promise<readonly OutboxItem[]> {
    const rows = await this.metadata.call("channel.outbox.due", "system", { now, ...(channel ? { channel } : {}), ...(limit ? { limit } : {}) }) as { id: number; channel: string; idempotencyKey: string; targetJson: string; deliverableJson: string; sessionId: string | null; attempts: number }[];
    return rows.map((row) => ({ id: row.id, channel: row.channel, idempotencyKey: row.idempotencyKey, target: JSON.parse(row.targetJson) as DeliveryTarget, deliverable: JSON.parse(row.deliverableJson) as Deliverable, ...(row.sessionId ? { sessionId: row.sessionId } : {}), attempts: row.attempts }));
  }

  async settle(id: number, settlement: OutboxSettlement, at: number): Promise<void> {
    await this.metadata.call("channel.outbox.settle", "system", {
      outboxId: id,
      at,
      status: settlement.status,
      attempts: settlement.attempts,
      ...(settlement.status === "pending" ? { nextAttemptAt: settlement.nextAttemptAt } : {}),
      ...(settlement.status !== "delivered" ? { error: settlement.error } : {}),
    });
  }
}
