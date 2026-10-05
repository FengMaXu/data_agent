import type { ChannelActor, ConversationAddress, Deliverable, DeliveryTarget, Submission } from "@data-agent/contracts";
import type { MetadataStore } from "../metadata.js";

export interface ChannelSessionBinding {
  readonly sessionId: string;
  readonly taskId: string;
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
  settleInbound(channel: string, requestId: string, status: "dispatched" | "rejected" | "interrupted"): Promise<void>;
  /** Accepted before `before` and never dispatched: the process stopped in between. */
  interruptedInbound(channel: string, before: number): Promise<readonly { readonly requestId: string; readonly address: ConversationAddress }[]>;
  resolveActor(actor: ChannelActor, newUserId: string): Promise<string>;
  findSession(address: ConversationAddress, userId: string): Promise<ChannelSessionBinding | undefined>;
  findTask(address: ConversationAddress, userId: string): Promise<string | undefined>;
  /** Returns the binding that won when two submissions raced to create one. */
  bindSession(address: ConversationAddress, actor: ChannelActor, userId: string, binding: ChannelSessionBinding): Promise<ChannelSessionBinding>;
  boundSession(sessionId: string): Promise<BoundSession | undefined>;
  /** False when a Deliverable with this key was already queued for the channel. It is due at `at`. */
  enqueue(channel: string, idempotencyKey: string, target: DeliveryTarget, deliverable: Deliverable, at: number): Promise<boolean>;
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

  async settleInbound(channel: string, requestId: string, status: "dispatched" | "rejected" | "interrupted"): Promise<void> {
    await this.metadata.call("channel.inbound.settle", "system", { channel, requestId, status });
  }

  async interruptedInbound(channel: string, before: number): Promise<readonly { readonly requestId: string; readonly address: ConversationAddress }[]> {
    const rows = await this.metadata.call("channel.inbound.interrupted", "system", { channel, before }) as { requestId: string; addressJson: string }[];
    return rows.map((row) => ({ requestId: row.requestId, address: JSON.parse(row.addressJson) as ConversationAddress }));
  }

  resolveActor(actor: ChannelActor, newUserId: string): Promise<string> {
    return this.metadata.call("channel.actor.resolve", "system", { channel: actor.channel, tenant: actor.tenant, externalUserId: actor.externalUserId, idValue: newUserId });
  }

  async findSession(address: ConversationAddress, userId: string): Promise<ChannelSessionBinding | undefined> {
    return (await this.metadata.call("channel.session.find", "system", { channel: address.channel, tenant: address.tenant, chatId: address.chatId, threadKey: threadKey(address), userId })) ?? undefined;
  }

  async findTask(address: ConversationAddress, userId: string): Promise<string | undefined> {
    const row = await this.metadata.call("channel.task.find", "system", { channel: address.channel, tenant: address.tenant, chatId: address.chatId, userId }) as { taskId: string } | null;
    return row?.taskId;
  }

  bindSession(address: ConversationAddress, actor: ChannelActor, userId: string, binding: ChannelSessionBinding): Promise<ChannelSessionBinding> {
    return this.metadata.call("channel.session.bind", "system", { channel: address.channel, tenant: address.tenant, chatId: address.chatId, threadKey: threadKey(address), userId, sessionId: binding.sessionId, taskId: binding.taskId, addressJson: JSON.stringify(address), actorJson: JSON.stringify(actor) });
  }

  async boundSession(sessionId: string): Promise<BoundSession | undefined> {
    const row = await this.metadata.call("channel.session.get", "system", { sessionId }) as { userId: string; addressJson: string; actorJson: string } | null;
    return row ? { userId: row.userId, address: JSON.parse(row.addressJson) as ConversationAddress, actor: JSON.parse(row.actorJson) as ChannelActor } : undefined;
  }

  async enqueue(channel: string, idempotencyKey: string, target: DeliveryTarget, deliverable: Deliverable, at: number): Promise<boolean> {
    const result = await this.metadata.call("channel.outbox.enqueue", "system", { channel, idempotencyKey, targetJson: JSON.stringify(target), deliverableJson: JSON.stringify(deliverable), at }) as { queued: boolean };
    return result.queued;
  }

  async due(now: number, channel?: string, limit?: number): Promise<readonly OutboxItem[]> {
    const rows = await this.metadata.call("channel.outbox.due", "system", { now, ...(channel ? { channel } : {}), ...(limit ? { limit } : {}) }) as { id: number; channel: string; idempotencyKey: string; targetJson: string; deliverableJson: string; attempts: number }[];
    return rows.map((row) => ({ id: row.id, channel: row.channel, idempotencyKey: row.idempotencyKey, target: JSON.parse(row.targetJson) as DeliveryTarget, deliverable: JSON.parse(row.deliverableJson) as Deliverable, attempts: row.attempts }));
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
