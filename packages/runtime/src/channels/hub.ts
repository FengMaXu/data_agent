import { randomUUID } from "node:crypto";
import {
  ProtocolVersion,
  parseSubmission,
  type Channel,
  type ConversationAddress,
  type DataAgentCommand,
  type DataAgentEventEnvelope,
  type DataAgentResponseEnvelope,
  type DeliveryContent,
  type DeliveryTarget,
  type ProgressView,
  type RequestContext,
  type Submission,
  type SubmissionBody,
} from "@data-agent/contracts";
import type { ApplicationCommandHost } from "../application/protocol-host.js";
import type { BoundSession, ChannelSessionBinding, ChannelStore, OutboxItem } from "./store.js";

export type SubmitOutcome = "dispatched" | "duplicate" | "rejected";

export interface ChannelHubOptions {
  /** The same versioned protocol seam Web and Electron use; the hub reaches nothing else. */
  readonly host: Pick<ApplicationCommandHost, "dispatch" | "subscribe">;
  readonly store: ChannelStore;
  /** Groups whose members may all see published results. Others get them privately (ADR-0011 decision 5). */
  readonly allowGroupDelivery?: (address: ConversationAddress) => boolean;
  /** Reads a published result as CSV with the asking user's authority. */
  readonly publications?: { read(receiptId: string, context: { readonly userId: string; readonly sessionId: string }): Promise<{ readonly content: string }> };
  /** Reads a dashboard page from the asking user's Session workspace. */
  readonly dashboards?: { read(path: string, context: { readonly userId: string; readonly sessionId: string }): Promise<Uint8Array> };
  /** Renders a self-contained page to PNG. Optional: without it dashboards go out as files only. */
  readonly snapshot?: (html: Uint8Array) => Promise<Uint8Array>;
  readonly retry?: { readonly baseMs?: number; readonly maxMs?: number; readonly maxAttempts?: number; readonly pollMs?: number };
  readonly progressIntervalMs?: number;
  /** A speaker's next input after this much quiet starts a new Session, so one chat does not grow one context forever. */
  readonly idleSessionMs?: number;
  readonly now?: () => number;
  readonly createId?: () => string;
  readonly onError?: (error: unknown) => void;
}

type ProgressState = { target: DeliveryTarget; runId?: string; text: string; activeTool?: string; timer?: ReturnType<typeof setTimeout> };

const PROGRESS_TEXT_LIMIT = 4000;
const OUTBOX_BATCH = 50;

const NOTICE_TEXT = {
  SUBMISSION_REJECTED: "这条消息没有被处理，请稍后重试。",
  SUBMISSION_INTERRUPTED: "服务重启前收到的一条消息没有被处理，请重新发送。",
  GROUP_DELIVERY_REDIRECTED: "查询结果已私聊发送给提问人。",
  CONVERSATION_STARTED: "已开始新对话，之前的上下文不会带入。",
} as const;

function idleNotice(idleMs: number): string {
  const minutes = Math.round(idleMs / 60_000);
  const span = minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} 小时` : `${minutes} 分钟`;
  return `距上次对话已超过 ${span}，已开始新对话，之前的上下文不会带入。`;
}

type ConversationBody = Exclude<SubmissionBody, { kind: "new_conversation" }>;

function errorCode(error: unknown): unknown {
  return error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
}

function addressTarget(address: ConversationAddress): DeliveryTarget {
  return { kind: "address", address };
}

/**
 * The core side of the channel boundary (ADR-0011). It turns Submissions into
 * protocol commands for a channel-bound Session, and turns that Session's
 * events into durable Deliverables and droppable progress. It owns no agent,
 * query or publication state.
 */
export class ChannelHub {
  private readonly channels = new Map<string, Channel>();
  private readonly boundSessions = new Map<string, Promise<BoundSession | undefined>>();
  private readonly sessionChoices = new Map<string, Promise<unknown>>();
  private readonly eventQueues = new Map<string, Promise<void>>();
  private readonly progress = new Map<string, ProgressState>();
  private readonly unsubscribe: () => void;
  private readonly startedAt: number;
  private poller: ReturnType<typeof setInterval> | undefined;
  private flushing: Promise<void> | undefined;
  private flushAgain = false;

  constructor(private readonly options: ChannelHubOptions) {
    this.startedAt = this.now();
    this.unsubscribe = options.host.subscribe((envelope) => this.receive(envelope));
  }

  async register(channel: Channel): Promise<void> {
    if (this.channels.has(channel.id)) throw new Error(`CHANNEL_ALREADY_REGISTERED: ${channel.id}`);
    this.channels.set(channel.id, channel);
    // Accepted by an earlier process but never dispatched: say so instead of replaying a non-idempotent run.
    for (const interrupted of await this.options.store.interruptedInbound(channel.id, this.startedAt)) {
      await this.options.store.enqueue(channel.id, `notice:interrupted:${interrupted.requestId}`, addressTarget(interrupted.address), { kind: "notice", code: "SUBMISSION_INTERRUPTED", text: NOTICE_TEXT.SUBMISSION_INTERRUPTED }, this.now());
      await this.options.store.settleInbound(channel.id, interrupted.requestId, "interrupted");
    }
    await channel.start(async (submission) => { await this.submit(channel.id, submission); });
    this.poller ??= setInterval(() => { void this.flush(); }, this.options.retry?.pollMs ?? 5_000);
    this.poller.unref?.();
    await this.flush();
  }

  /** Accepts one inbound platform event. Throws only for a malformed or foreign Submission. */
  async submit(channelId: string, value: unknown): Promise<SubmitOutcome> {
    const submission = parseSubmission(value);
    const { address, actor } = submission;
    if (address.channel !== channelId || actor.channel !== channelId || actor.tenant !== address.tenant) {
      throw new TypeError("Submission does not belong to this channel");
    }
    if (!(await this.options.store.acceptInbound(channelId, submission, this.now()))) return "duplicate";
    try {
      const userId = await this.options.store.resolveActor(actor, this.createId());
      const { body } = submission;
      if (body.kind === "new_conversation") await this.startOver(submission, userId);
      else {
        const session = await this.ensureSession(submission, body, userId);
        await this.dispatchBody(submission.requestId, body, { userId, host: "channel", sessionId: session.sessionId });
        await this.options.store.touchSession(session.sessionId, this.now());
      }
      await this.options.store.settleInbound(channelId, submission.requestId, "dispatched");
      return "dispatched";
    } catch (error) {
      this.report(error);
      await this.options.store.settleInbound(channelId, submission.requestId, "rejected");
      await this.options.store.enqueue(channelId, `notice:rejected:${submission.requestId}`, addressTarget(address), { kind: "notice", code: "SUBMISSION_REJECTED", text: NOTICE_TEXT.SUBMISSION_REJECTED }, this.now());
      void this.flush();
      return "rejected";
    }
  }

  /** Delivers every due Deliverable once; failures are retried with backoff. */
  async flush(): Promise<void> {
    if (this.flushing) {
      this.flushAgain = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      do {
        this.flushAgain = false;
        await this.deliverDue();
      } while (this.flushAgain);
    })();
    try {
      await this.flushing;
    } finally {
      this.flushing = undefined;
    }
  }

  /** Resolves once every event received so far has been turned into Deliverables. */
  async idle(): Promise<void> {
    while (this.eventQueues.size > 0) await Promise.all([...this.eventQueues.values()]);
  }

  async close(): Promise<void> {
    this.unsubscribe();
    if (this.poller) clearInterval(this.poller);
    for (const state of this.progress.values()) if (state.timer) clearTimeout(state.timer);
    this.progress.clear();
    await this.idle();
    await this.flushing;
    for (const channel of this.channels.values()) await channel.stop().catch((error: unknown) => this.report(error));
    this.channels.clear();
  }

  private async dispatchBody(requestId: string, body: ConversationBody, context: RequestContext): Promise<void> {
    if (body.kind === "answer") {
      try {
        await this.command({ type: "clarification.answer", clarificationId: body.clarificationId, answer: body.text }, context, requestId);
        return;
      } catch (error) {
        if (errorCode(error) !== "CLARIFICATION_SETTLED") throw error;
        // The wait is over; the answer still reaches the model as the user's own words.
      }
    }
    try {
      await this.command({ type: "agent.prompt", prompt: body.text }, context, requestId);
    } catch (error) {
      if (errorCode(error) !== "SESSION_BUSY") throw error;
      const whenBusy = body.kind === "input" ? body.whenBusy : "follow_up";
      await this.command({ type: whenBusy === "steer" ? "agent.steer" : "agent.follow_up", prompt: body.text }, context, requestId);
    }
  }

  /** The speaker's current Session; a new one when there is none, or when input arrives after a long quiet. */
  private ensureSession(submission: Submission, body: ConversationBody, userId: string): Promise<ChannelSessionBinding> {
    const { address, actor } = submission;
    return this.serialized(address, userId, async () => {
      const found = await this.options.store.findSession(address, userId);
      const idleMs = this.options.idleSessionMs;
      // An answer belongs to the Session that asked, however long it took.
      const idle = found !== undefined && idleMs !== undefined && body.kind === "input" && this.now() - found.lastActiveAt > idleMs;
      if (found && !idle) return found;
      if (found && idleMs !== undefined) {
        await this.options.store.supersedeSession(found.sessionId, this.now());
        await this.options.store.enqueue(address.channel, `notice:started:${submission.requestId}`, addressTarget(address), { kind: "notice", code: "CONVERSATION_STARTED", text: idleNotice(idleMs) }, this.now());
        void this.flush();
      }
      const name = `${address.channel}:${address.chatId}`;
      const taskId = await this.options.store.findTask(address, userId) ?? await this.createEntity({ type: "task.create", name }, userId);
      const started = new Date(this.now()).toLocaleString("sv-SE").slice(5, 16);
      const sessionId = await this.createEntity({ type: "session.create", taskId, name: `${address.threadId ? `${name}:${address.threadId}` : name} ${started}` }, userId);
      const bound = await this.options.store.bindSession(address, actor, userId, { sessionId, taskId }, this.now());
      this.boundSessions.set(bound.sessionId, this.options.store.boundSession(bound.sessionId));
      return bound;
    });
  }

  /** Ends the current Session on request. The next input opens a new one; a run still going keeps delivering. */
  private startOver(submission: Submission, userId: string): Promise<void> {
    const { address } = submission;
    return this.serialized(address, userId, async () => {
      const found = await this.options.store.findSession(address, userId);
      if (found) await this.options.store.supersedeSession(found.sessionId, this.now());
      await this.options.store.enqueue(address.channel, `notice:started:${submission.requestId}`, addressTarget(address), { kind: "notice", code: "CONVERSATION_STARTED", text: NOTICE_TEXT.CONVERSATION_STARTED }, this.now());
      void this.flush();
    });
  }

  /** Session choices of one address and speaker happen one at a time. */
  private async serialized<T>(address: ConversationAddress, userId: string, work: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([address.channel, address.tenant, address.chatId, address.threadId ?? "", userId]);
    const previous = this.sessionChoices.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.sessionChoices.set(key, next);
    try {
      return await next;
    } finally {
      if (this.sessionChoices.get(key) === next) this.sessionChoices.delete(key);
    }
  }

  private async createEntity(command: Extract<DataAgentCommand, { type: "task.create" | "session.create" }>, userId: string): Promise<string> {
    const response = await this.command(command, { userId, host: "channel" }, `${command.type}:${this.createId()}`);
    if (response.response.type !== "mutation.result") throw new Error(`CHANNEL_${command.type.toUpperCase()}_FAILED`);
    return response.response.item.id;
  }

  private command(command: DataAgentCommand, context: RequestContext, requestId: string): Promise<DataAgentResponseEnvelope> {
    return this.options.host.dispatch({ protocolVersion: ProtocolVersion, requestId, ...(context.sessionId ? { sessionId: context.sessionId } : {}), command }, context);
  }

  /** Events of one Session are handled in order; a failure never reaches the event emitter. */
  private receive(envelope: DataAgentEventEnvelope): void {
    const sessionId = envelope.sessionId;
    if (!sessionId) return;
    const previous = this.eventQueues.get(sessionId) ?? Promise.resolve();
    const next = previous.then(() => this.handle(sessionId, envelope)).catch((error: unknown) => this.report(error));
    this.eventQueues.set(sessionId, next);
    void next.then(() => { if (this.eventQueues.get(sessionId) === next) this.eventQueues.delete(sessionId); });
  }

  private async handle(sessionId: string, envelope: DataAgentEventEnvelope): Promise<void> {
    let lookup = this.boundSessions.get(sessionId);
    if (!lookup) {
      lookup = this.options.store.boundSession(sessionId);
      this.boundSessions.set(sessionId, lookup);
    }
    const bound = await lookup;
    if (!bound) return;
    const channelId = bound.address.channel;
    const event = envelope.event;
    if (event.type === "clarification.request") {
      await this.options.store.enqueue(channelId, `question:${event.clarificationId}`, addressTarget(bound.address), { kind: "question", clarificationId: event.clarificationId, question: event.question, options: event.options }, this.now());
      void this.flush();
      return;
    }
    if (event.type === "publication.delivered") {
      const target = this.resultTarget(bound);
      await this.options.store.enqueue(channelId, `publication:${event.receiptId}`, target, { kind: "publication", publication: event }, this.now(), sessionId);
      if (target.kind === "actor") {
        await this.options.store.enqueue(channelId, `notice:redirected:${event.receiptId}`, addressTarget(bound.address), { kind: "notice", code: "GROUP_DELIVERY_REDIRECTED", text: NOTICE_TEXT.GROUP_DELIVERY_REDIRECTED }, this.now());
      }
      void this.flush();
      return;
    }
    if (event.type === "dashboard.delivered") {
      // A dashboard shows published numbers, so it goes where results may go.
      await this.options.store.enqueue(channelId, `dashboard:${event.contentHash}`, this.resultTarget(bound), { kind: "dashboard", dashboard: event }, this.now(), sessionId);
      void this.flush();
      return;
    }
    this.track(sessionId, bound, envelope);
  }

  /**
   * Where anything carrying result data goes: published rows, and the run's
   * narrative, which quotes them. A group not allowed group delivery gets
   * neither; the asker gets both privately (ADR-0011 decision 5).
   */
  private resultTarget(bound: BoundSession): DeliveryTarget {
    if (bound.address.audience === "group" && !(this.options.allowGroupDelivery?.(bound.address) ?? false)) return { kind: "actor", actor: bound.actor };
    return addressTarget(bound.address);
  }

  /** Progress is the latest view only: coalesced on a timer, sent at once when the run completes. */
  private track(sessionId: string, bound: BoundSession, envelope: DataAgentEventEnvelope): void {
    const channel = this.channels.get(bound.address.channel);
    if (!channel?.progress) return;
    const event = envelope.event;
    if (event.type !== "agent.text_delta" && event.type !== "agent.tool_started" && event.type !== "agent.tool_finished" && event.type !== "agent.completed") return;
    const state = this.progress.get(sessionId) ?? { target: this.resultTarget(bound), text: "" };
    this.progress.set(sessionId, state);
    if (envelope.runId) state.runId = envelope.runId;
    if (event.type === "agent.text_delta") state.text = (state.text + event.delta).slice(-PROGRESS_TEXT_LIMIT);
    else if (event.type === "agent.tool_started") state.activeTool = event.toolName;
    else if (event.type === "agent.tool_finished") delete state.activeTool;
    if (event.type === "agent.completed") {
      this.progress.delete(sessionId);
      this.sendProgress(channel, state, "completed");
      return;
    }
    state.timer ??= setTimeout(() => this.sendProgress(channel, state, "running"), this.options.progressIntervalMs ?? 1_000);
  }

  private sendProgress(channel: Channel, state: ProgressState, phase: ProgressView["state"]): void {
    if (state.timer) clearTimeout(state.timer);
    delete state.timer;
    const view: ProgressView = { state: phase, text: state.text, ...(state.runId ? { runId: state.runId } : {}), ...(state.activeTool ? { activeTool: state.activeTool } : {}) };
    channel.progress?.(state.target, view).catch((error: unknown) => this.report(error));
  }

  private async deliverDue(): Promise<void> {
    const retry = this.options.retry ?? {};
    for (const item of await this.options.store.due(this.now(), undefined, OUTBOX_BATCH)) {
      const channel = this.channels.get(item.channel);
      // An unregistered channel's items wait for it.
      if (!channel) continue;
      const attempts = item.attempts + 1;
      try {
        await channel.deliver(item.target, item.deliverable, item.idempotencyKey, this.content(item));
        await this.options.store.settle(item.id, { status: "delivered", attempts }, this.now());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempts >= (retry.maxAttempts ?? 8)) {
          this.report(error);
          await this.options.store.settle(item.id, { status: "failed", attempts, error: message }, this.now());
        } else {
          const delay = Math.min(retry.maxMs ?? 300_000, (retry.baseMs ?? 2_000) * 2 ** (attempts - 1));
          await this.options.store.settle(item.id, { status: "pending", attempts, nextAttemptAt: this.now() + delay, error: message }, this.now());
        }
      }
    }
  }

  /** Published rows are read only when a Channel asks, as the asker, and never stored in the outbox. */
  private content(item: OutboxItem): DeliveryContent | undefined {
    const { deliverable, sessionId } = item;
    if (!sessionId) return undefined;
    const asker = async () => {
      const bound = await this.options.store.boundSession(sessionId);
      if (!bound) throw new Error("CHANNEL_SESSION_UNBOUND");
      return { userId: bound.userId, sessionId };
    };
    const { publications, dashboards, snapshot } = this.options;
    if (deliverable.kind === "publication" && publications) {
      return { readPublication: async () => (await publications.read(deliverable.publication.receiptId, await asker())).content };
    }
    if (deliverable.kind === "dashboard" && dashboards) {
      const readDashboard = async () => dashboards.read(deliverable.dashboard.path, await asker());
      return { readDashboard, ...(snapshot ? { snapshotDashboard: async () => snapshot(await readDashboard()) } : {}) };
    }
    return undefined;
  }

  private now(): number { return this.options.now?.() ?? Date.now(); }
  private createId(): string { return this.options.createId?.() ?? randomUUID(); }
  private report(error: unknown): void {
    if (this.options.onError) this.options.onError(error);
    else console.error("[data-agent] channel hub:", error);
  }
}
