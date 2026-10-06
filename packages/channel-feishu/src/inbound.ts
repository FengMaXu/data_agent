import type { ConversationAddress, Submission } from "@data-agent/contracts";

export const FEISHU_CHANNEL_ID = "feishu";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** What a question card's button carries back; the card is the only writer of this value. */
export interface AnswerActionValue {
  readonly kind: "answer";
  readonly clarificationId: string;
  readonly text: string;
  readonly audience: ConversationAddress["audience"];
  readonly threadId?: string;
}

/** Typed alone, these start a new conversation instead of being asked as a question. */
const NEW_CONVERSATION = new Set(["/new", "/新对话", "新对话"]);

export interface InboundMessage {
  readonly submission: Submission;
  readonly messageId: string;
}

/**
 * `im.message.receive_v1` → Submission. Only text from a person counts; in a
 * group only a message that mentions the bot does. Mentions of the bot are
 * removed, other mentions become `@name`.
 */
export function messageSubmission(data: Record<string, unknown>, options: { readonly botOpenId?: string } = {}): InboundMessage | undefined {
  const eventId = text(data.event_id);
  const tenant = text(data.tenant_key);
  const sender = record(data.sender);
  const message = record(data.message);
  const openId = text(record(sender?.sender_id)?.open_id);
  if (!eventId || !tenant || !sender || !message || !openId || sender.sender_type !== "user") return undefined;
  const messageId = text(message.message_id);
  const chatId = text(message.chat_id);
  const chatType = message.chat_type;
  if (!messageId || !chatId || (chatType !== "p2p" && chatType !== "group") || message.message_type !== "text") return undefined;
  let body: string | undefined;
  try {
    body = text(record(JSON.parse(String(message.content)))?.text);
  } catch {
    return undefined;
  }
  if (!body) return undefined;
  const mentions = Array.isArray(message.mentions) ? message.mentions.map(record).filter((item) => item !== undefined) : [];
  const mentionsBot = mentions.some((mention) => options.botOpenId !== undefined && record(mention.id)?.open_id === options.botOpenId);
  if (chatType === "group" && options.botOpenId !== undefined && !mentionsBot) return undefined;
  for (const mention of mentions) {
    const key = text(mention.key);
    if (!key) continue;
    const isBot = options.botOpenId !== undefined && record(mention.id)?.open_id === options.botOpenId;
    body = body.split(key).join(isBot ? "" : `@${text(mention.name) ?? ""}`);
  }
  body = body.trim();
  if (!body) return undefined;
  const threadId = text(message.thread_id);
  return {
    messageId,
    submission: {
      requestId: eventId,
      address: { channel: FEISHU_CHANNEL_ID, tenant, chatId, ...(threadId ? { threadId } : {}), audience: chatType === "p2p" ? "direct" : "group" },
      actor: { channel: FEISHU_CHANNEL_ID, tenant, externalUserId: openId },
      body: NEW_CONVERSATION.has(body.toLowerCase()) ? { kind: "new_conversation" } : { kind: "input", text: body, whenBusy: "follow_up" },
    },
  };
}

/** `card.action.trigger` on a question card → an answer Submission from whoever clicked. */
export function cardActionSubmission(data: Record<string, unknown>): Submission | undefined {
  const eventId = text(data.event_id);
  const operator = record(data.operator);
  const openId = text(operator?.open_id);
  const tenant = text(data.tenant_key) ?? text(operator?.tenant_key);
  const chatId = text(record(data.context)?.open_chat_id);
  const value = record(record(data.action)?.value);
  if (!eventId || !openId || !tenant || !chatId || value?.kind !== "answer") return undefined;
  const clarificationId = text(value.clarificationId);
  const answer = text(value.text);
  const audience = value.audience === "direct" || value.audience === "group" ? value.audience : undefined;
  const threadId = text(value.threadId);
  if (!clarificationId || !answer || !audience) return undefined;
  return {
    requestId: eventId,
    address: { channel: FEISHU_CHANNEL_ID, tenant, chatId, ...(threadId ? { threadId } : {}), audience },
    actor: { channel: FEISHU_CHANNEL_ID, tenant, externalUserId: openId },
    body: { kind: "answer", clarificationId, text: answer },
  };
}
