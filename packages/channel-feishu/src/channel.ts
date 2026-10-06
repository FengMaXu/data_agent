import { createHash } from "node:crypto";
import type { Channel, ConversationAddress, Deliverable, DeliveryContent, DeliveryTarget, ProgressView, Submission } from "@data-agent/contracts";
import type { FeishuApi, FeishuEvents } from "./api.js";
import { answeredCard, progressCard, publicationCard, questionCard } from "./cards.js";
import { cardActionSubmission, FEISHU_CHANNEL_ID, messageSubmission } from "./inbound.js";

export interface FeishuChannelOptions {
  readonly api: FeishuApi;
  readonly events: FeishuEvents;
  readonly onError?: (error: unknown) => void;
}

/** Rows shown in a card before the rest goes out as a file. */
const PREVIEW_ROWS = 10;

const addressKey = (address: ConversationAddress): string => `${address.tenant}|${address.chatId}|${address.threadId ?? ""}`;
const targetKey = (target: DeliveryTarget): string => target.kind === "address" ? `chat|${addressKey(target.address)}` : `user|${target.actor.tenant}|${target.actor.externalUserId}`;

/** Feishu dedupes sends by `uuid` (at most 50 characters) for an hour. */
function uuid(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 40);
}

function previewCsv(csv: string): string {
  const lines = csv.split(/\r?\n/);
  return lines.slice(0, PREVIEW_ROWS + 1).join("\n");
}

/**
 * Feishu as a Channel (ADR-0011). It verifies nothing about data: it turns
 * Feishu events into Submissions and renders Deliverables. Memory here is
 * only presentation state (where to reply, which card to patch); losing it on
 * restart degrades replies to plain sends.
 */
export class FeishuChannel implements Channel {
  readonly id = FEISHU_CHANNEL_ID;
  readonly capabilities = { editableMessages: true, actions: true, files: true };
  private sink: ((submission: Submission) => Promise<void>) | undefined;
  private botOpenId: string | undefined;
  private readonly lastMessage = new Map<string, string>();
  private readonly pendingQuestions = new Map<string, string>();
  private readonly progressCards = new Map<string, Promise<string | undefined>>();

  constructor(private readonly options: FeishuChannelOptions) {}

  async start(sink: (submission: Submission) => Promise<void>): Promise<void> {
    this.sink = sink;
    try {
      this.botOpenId = await this.options.api.botOpenId();
    } catch (error) {
      // Without the bot's identity, group messages cannot be told apart by mention; every one is taken.
      this.report(error);
    }
    await this.options.events.connect({
      message: async (data) => { this.onMessage(data); return undefined; },
      cardAction: async (data) => this.onCardAction(data),
    });
  }

  async stop(): Promise<void> {
    await this.options.events.disconnect();
    this.sink = undefined;
  }

  async deliver(target: DeliveryTarget, deliverable: Deliverable, idempotencyKey: string, content?: DeliveryContent): Promise<void> {
    if (deliverable.kind === "notice") {
      await this.send(target, "text", JSON.stringify({ text: deliverable.text }), idempotencyKey);
      return;
    }
    if (deliverable.kind === "question") {
      const address = target.kind === "address" ? target.address : undefined;
      if (!address) throw new Error("FEISHU_QUESTION_NEEDS_ADDRESS");
      await this.send(target, "interactive", questionCard(deliverable.question, deliverable.options, deliverable.clarificationId, address), idempotencyKey);
      this.pendingQuestions.set(addressKey(address), deliverable.clarificationId);
      return;
    }
    if (deliverable.kind === "dashboard") {
      await this.deliverDashboard(target, deliverable.dashboard.path, idempotencyKey, content);
      return;
    }
    const publication = deliverable.publication;
    if (publication.format === "inline" || !content?.readPublication) {
      await this.send(target, "interactive", publicationCard(publication, publication.inlineContent ? { csv: publication.inlineContent, attached: false } : { attached: false }), idempotencyKey);
      return;
    }
    const csv = await content.readPublication();
    await this.send(target, "interactive", publicationCard(publication, { csv: previewCsv(csv), attached: true }), idempotencyKey);
    // The file message has its own uuid, so a retry after the card went out sends only what is missing.
    const fileKey = await this.options.api.uploadFile(`${publication.receiptId}.csv`, Buffer.from(`﻿${csv}`, "utf8"));
    await this.send(target, "file", JSON.stringify({ file_key: fileKey }), `${idempotencyKey}:file`);
  }

  /**
   * A phone cannot open a local page, so a dashboard goes out as a picture to
   * look at plus the page itself to open in a browser. Without a picture
   * (no browser on the host) the page still goes out.
   */
  private async deliverDashboard(target: DeliveryTarget, dashboardPath: string, idempotencyKey: string, content: DeliveryContent | undefined): Promise<void> {
    if (!content?.readDashboard) throw new Error("FEISHU_DASHBOARD_UNREADABLE");
    const name = dashboardPath.slice(dashboardPath.lastIndexOf("/") + 1);
    if (content.snapshotDashboard) {
      try {
        const imageKey = await this.options.api.uploadImage(Buffer.from(await content.snapshotDashboard()));
        await this.send(target, "image", JSON.stringify({ image_key: imageKey }), `${idempotencyKey}:image`);
      } catch (error) {
        this.report(error);
      }
    }
    const fileKey = await this.options.api.uploadFile(name, Buffer.from(await content.readDashboard()));
    await this.send(target, "file", JSON.stringify({ file_key: fileKey }), `${idempotencyKey}:file`);
  }

  /** One card per run, patched as the run goes; calls for the same run are applied in order. */
  async progress(target: DeliveryTarget, view: ProgressView): Promise<void> {
    const key = `${targetKey(target)}|${view.runId ?? ""}`;
    const previous = this.progressCards.get(key) ?? Promise.resolve(undefined);
    const next = previous.catch(() => undefined).then(async (messageId) => {
      const card = progressCard(view);
      if (messageId) {
        await this.options.api.patchCard(messageId, card);
        return messageId;
      }
      return this.send(target, "interactive", card, `progress:${key}`);
    });
    if (view.state === "completed") this.progressCards.delete(key);
    else this.progressCards.set(key, next);
    await next;
  }

  private onMessage(data: Record<string, unknown>): void {
    const inbound = messageSubmission(data, this.botOpenId ? { botOpenId: this.botOpenId } : {});
    if (!inbound) return;
    const key = addressKey(inbound.submission.address);
    this.lastMessage.set(key, inbound.messageId);
    // Starting over leaves any open question behind with the old conversation.
    if (inbound.submission.body.kind === "new_conversation") this.pendingQuestions.delete(key);
    // A typed reply to an open question is its answer; the core turns it back into input if the wait is over.
    const pending = this.pendingQuestions.get(key);
    let submission = inbound.submission;
    if (pending && submission.body.kind === "input") {
      this.pendingQuestions.delete(key);
      submission = { ...submission, body: { kind: "answer", clarificationId: pending, text: submission.body.text } };
    }
    this.forward(submission);
  }

  private onCardAction(data: Record<string, unknown>): unknown {
    const submission = cardActionSubmission(data);
    if (!submission || submission.body.kind !== "answer") return {};
    this.pendingQuestions.delete(addressKey(submission.address));
    this.forward(submission);
    return { toast: { type: "success", content: "已提交" }, card: { type: "raw", data: answeredCard(submission.body.text) } };
  }

  /** Feishu wants an answer within 3 s; the core deduplicates its redeliveries by event id. */
  private forward(submission: Submission): void {
    const sink = this.sink;
    if (!sink) return;
    void sink(submission).catch((error: unknown) => this.report(error));
  }

  private async send(target: DeliveryTarget, msgType: string, content: string, key: string): Promise<string> {
    const id = uuid(key);
    if (target.kind === "actor") return this.options.api.send("open_id", target.actor.externalUserId, msgType, content, id);
    const { address } = target;
    // In a group, answer under the asker's latest message so the reply is in context (and inside its thread).
    const replyTo = address.audience === "group" ? this.lastMessage.get(addressKey(address)) : undefined;
    if (replyTo) return this.options.api.reply(replyTo, msgType, content, id, address.threadId !== undefined);
    return this.options.api.send("chat_id", address.chatId, msgType, content, id);
  }

  private report(error: unknown): void {
    if (this.options.onError) this.options.onError(error);
    else console.error("[data-agent] feishu channel:", error);
  }
}
