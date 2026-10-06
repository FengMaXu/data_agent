import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Channel, ConversationAddress, DataAgentEvent, Deliverable, DeliveryContent, DeliveryTarget, ProgressView, Submission } from "@data-agent/contracts";
import { DataAgentRuntime } from "../protocol.js";
import { MetadataStore } from "../metadata.js";
import { ClarificationManager } from "../clarification.js";
import { AgentControllerError } from "../facets/agent-controller.js";
import type { ApplicationAgentEvent } from "../application/host.js";
import { ChannelHub } from "./hub.js";
import { MetadataChannelStore } from "./store.js";

class MemoryChannel implements Channel {
  readonly capabilities = { editableMessages: true, actions: true, files: false };
  readonly delivered: { target: DeliveryTarget; deliverable: Deliverable; key: string }[] = [];
  readonly progressViews: ProgressView[] = [];
  readonly progressTargets: DeliveryTarget[] = [];
  readonly contents: (DeliveryContent | undefined)[] = [];
  failures = 0;
  sink: ((submission: Submission) => Promise<void>) | undefined;

  constructor(readonly id = "im") {}
  async start(sink: (submission: Submission) => Promise<void>): Promise<void> { this.sink = sink; }
  async deliver(target: DeliveryTarget, deliverable: Deliverable, key: string, content?: DeliveryContent): Promise<void> {
    this.contents.push(content);
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("platform unavailable");
    }
    this.delivered.push({ target, deliverable, key });
  }
  async progress(target: DeliveryTarget, view: ProgressView): Promise<void> { this.progressTargets.push(target); this.progressViews.push(view); }
  async stop(): Promise<void> {}
}

type AgentCall = { kind: "prompt" | "steer" | "followUp"; text: string; sessionId?: string; userId?: string };

function fakeAgent() {
  const calls: AgentCall[] = [];
  let listener: ((event: ApplicationAgentEvent) => void) | undefined;
  let busy = false;
  let sequence = 1;
  return {
    calls,
    setBusy(value: boolean) { busy = value; },
    emit(sessionId: string, event: DataAgentEvent, runId = "run-1") {
      listener?.({ type: "presentation.event", sessionId, envelope: { protocolVersion: 1, sequence: sequence++, requestId: "request", sessionId, runId, timestamp: 1, event } });
    },
    agent: {
      async prompt(text: string, context?: { sessionId?: string; userId?: string }) {
        if (busy) throw new AgentControllerError("ADMISSION_REJECTED", "Lane \"main\" already has an active operation", { busy: true });
        calls.push({ kind: "prompt", text, ...context });
        return { operationId: `op-${calls.length}` };
      },
      async steer(text: string, context?: { sessionId?: string; userId?: string }) { calls.push({ kind: "steer", text, ...context }); },
      async followUp(text: string, context?: { sessionId?: string; userId?: string }) { calls.push({ kind: "followUp", text, ...context }); },
      subscribe(next: (event: ApplicationAgentEvent) => void) { listener = next; return () => { listener = undefined; }; },
    },
  };
}

const roots: string[] = [];
const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close().catch(() => undefined);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function setup(options: { allowGroupDelivery?: (address: ConversationAddress) => boolean; dbPath?: string; clarificationTimeoutMs?: number; publications?: { read(receiptId: string, context: { userId: string; sessionId: string }): Promise<{ content: string }> }; dashboards?: { read(path: string, context: { userId: string; sessionId: string }): Promise<Uint8Array> }; snapshot?: (html: Uint8Array) => Promise<Uint8Array> } = {}) {
  let dbPath = options.dbPath;
  if (!dbPath) {
    const root = await mkdtemp(join(process.cwd(), ".tmp-channel-hub-"));
    roots.push(root);
    dbPath = join(root, "metadata.db");
  }
  const metadata = new MetadataStore(dbPath);
  const fake = fakeAgent();
  const clarifications = new ClarificationManager(options.clarificationTimeoutMs ?? 60_000);
  const runtime = new DataAgentRuntime({ metadata, clarifications, agent: fake.agent });
  const clock = { now: 1_000 };
  const errors: unknown[] = [];
  const hub = new ChannelHub({
    host: runtime,
    store: new MetadataChannelStore(metadata),
    now: () => clock.now,
    onError: (error) => errors.push(error),
    retry: { baseMs: 100, maxMs: 1_000, maxAttempts: 3, pollMs: 3_600_000 },
    progressIntervalMs: 5,
    ...(options.allowGroupDelivery ? { allowGroupDelivery: options.allowGroupDelivery } : {}),
    ...(options.publications ? { publications: options.publications } : {}),
    ...(options.dashboards ? { dashboards: options.dashboards } : {}),
    ...(options.snapshot ? { snapshot: options.snapshot } : {}),
  });
  const channel = new MemoryChannel();
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await hub.close();
    await metadata.close();
  };
  closers.push(close);
  await hub.register(channel);
  return { hub, channel, fake, runtime, clarifications, clock, errors, dbPath, close };
}

const group: ConversationAddress = { channel: "im", tenant: "t1", chatId: "chat-1", audience: "group" };
const direct: ConversationAddress = { channel: "im", tenant: "t1", chatId: "dm-alice", audience: "direct" };
const alice = { channel: "im", tenant: "t1", externalUserId: "alice" };
const bob = { channel: "im", tenant: "t1", externalUserId: "bob" };

function input(requestId: string, address: ConversationAddress, actor = alice, text = "上月销售额是多少？"): Submission {
  return { requestId, address, actor, body: { kind: "input", text, whenBusy: "follow_up" } };
}

const publication = (receiptId: string): DataAgentEvent => ({ type: "publication.delivered", receiptId, taskId: "task-1", format: "inline", publicRef: `/api/runtime/publications/${receiptId}?session_id=s`, disclosure: "口径按字面解释。", inlineContent: "| 销售额 |\n| 100 |" });

describe("ChannelHub inbound", () => {
  it("dispatches a platform event once even when the platform delivers it twice", async () => {
    const { hub, fake } = await setup();
    expect(await hub.submit("im", input("evt-1", direct))).toBe("dispatched");
    expect(await hub.submit("im", input("evt-1", direct))).toBe("duplicate");
    expect(fake.calls).toHaveLength(1);
  });

  it("keeps one Session per speaker of an address and reuses it", async () => {
    const { hub, fake } = await setup();
    await hub.submit("im", input("evt-1", group, alice));
    await hub.submit("im", input("evt-2", group, bob));
    await hub.submit("im", input("evt-3", group, alice, "按区域拆分"));
    const [first, second, third] = fake.calls;
    expect(first!.sessionId).toBeTruthy();
    expect(second!.sessionId).not.toBe(first!.sessionId);
    expect(second!.userId).not.toBe(first!.userId);
    expect(third).toMatchObject({ sessionId: first!.sessionId, userId: first!.userId });
  });

  it("queues input by its whenBusy choice when the Session is already running", async () => {
    const { hub, fake } = await setup();
    await hub.submit("im", input("evt-1", direct));
    fake.setBusy(true);
    await hub.submit("im", { ...input("evt-2", direct, alice, "只看华东"), body: { kind: "input", text: "只看华东", whenBusy: "steer" } });
    await hub.submit("im", input("evt-3", direct, alice, "再按月拆分"));
    expect(fake.calls.map((call) => call.kind)).toEqual(["prompt", "steer", "followUp"]);
  });

  it("refuses a Submission that names another channel", async () => {
    const { hub } = await setup();
    await expect(hub.submit("im", input("evt-1", { ...direct, channel: "other" }))).rejects.toThrow(TypeError);
    await expect(hub.submit("im", input("evt-2", direct, { ...alice, tenant: "t2" }))).rejects.toThrow(TypeError);
  });

  it("tells the conversation when the Runtime refuses a Submission", async () => {
    const { hub, fake, channel } = await setup();
    fake.agent.prompt = async () => { throw new Error("model unavailable"); };
    expect(await hub.submit("im", input("evt-1", direct))).toBe("rejected");
    await hub.flush();
    expect(channel.delivered).toEqual([{ target: { kind: "address", address: direct }, deliverable: expect.objectContaining({ kind: "notice", code: "SUBMISSION_REJECTED" }), key: "notice:rejected:evt-1" }]);
  });

  it("reports a Submission the previous process accepted but never dispatched", async () => {
    const first = await setup();
    await new MetadataChannelStore(first.runtime.metadataStore!).acceptInbound("im", input("evt-lost", direct), 500);
    await first.close();
    const second = await setup({ dbPath: first.dbPath });
    await second.hub.flush();
    expect(second.channel.delivered.map((item) => item.key)).toEqual(["notice:interrupted:evt-lost"]);
    expect(second.fake.calls).toHaveLength(0);
  });
});

describe("ChannelHub clarification answers", () => {
  it("answers a pending clarification of the asking Session", async () => {
    const { hub, fake, runtime, channel } = await setup();
    await hub.submit("im", input("evt-1", direct));
    const sessionId = fake.calls[0]!.sessionId!;
    const asked = runtime.askClarification(sessionId, "订单量指什么？", ["全部订单", "已支付订单"]);
    await hub.idle();
    await hub.flush();
    expect(channel.delivered.at(-1)).toMatchObject({ key: `question:${asked.clarificationId}`, deliverable: { kind: "question", question: "订单量指什么？", options: ["全部订单", "已支付订单"] } });

    await hub.submit("im", { requestId: "evt-2", address: direct, actor: alice, body: { kind: "answer", clarificationId: asked.clarificationId, text: "已支付订单" } });
    await expect(asked.promise).resolves.toBe("已支付订单");
    expect(fake.calls).toHaveLength(1);
  });

  it("turns an answer that arrives after the wait ended into the user's next input", async () => {
    const { hub, fake, runtime } = await setup({ clarificationTimeoutMs: 10 });
    await hub.submit("im", input("evt-1", direct));
    const asked = runtime.askClarification(fake.calls[0]!.sessionId!, "订单量指什么？", []);
    await expect(asked.promise).resolves.toBe("");
    await hub.submit("im", { requestId: "evt-2", address: direct, actor: alice, body: { kind: "answer", clarificationId: asked.clarificationId, text: "已支付订单" } });
    expect(fake.calls.at(-1)).toMatchObject({ kind: "prompt", text: "已支付订单" });
  });

  it("does not let one Session answer another Session's clarification", async () => {
    const { hub, fake, runtime } = await setup();
    await hub.submit("im", input("evt-1", group, alice));
    await hub.submit("im", input("evt-2", group, bob));
    const asked = runtime.askClarification(fake.calls[0]!.sessionId!, "订单量指什么？", []);
    await hub.submit("im", { requestId: "evt-3", address: group, actor: bob, body: { kind: "answer", clarificationId: asked.clarificationId, text: "全部订单" } });
    // Bob's words went to Bob's own Session as input; Alice's question is still waiting.
    expect(fake.calls.at(-1)).toMatchObject({ kind: "prompt", text: "全部订单", sessionId: fake.calls[1]!.sessionId });
    expect(runtime.clarificationManager.pendingFor(fake.calls[0]!.sessionId!)?.clarificationId).toBe(asked.clarificationId);
  });
});

describe("ChannelHub deliverables", () => {
  it("delivers a publication once per Receipt even when the event repeats", async () => {
    const { hub, fake, channel } = await setup();
    await hub.submit("im", input("evt-1", direct));
    const sessionId = fake.calls[0]!.sessionId!;
    fake.emit(sessionId, publication("pub-1"));
    fake.emit(sessionId, publication("pub-1"));
    await hub.idle();
    await hub.flush();
    expect(channel.delivered).toEqual([{ target: { kind: "address", address: direct }, deliverable: { kind: "publication", publication: publication("pub-1") }, key: "publication:pub-1" }]);
  });

  it("retries a failed delivery with backoff and gives up after the last attempt", async () => {
    const { hub, fake, channel, clock } = await setup();
    await hub.submit("im", input("evt-1", direct));
    const sessionId = fake.calls[0]!.sessionId!;
    channel.failures = 1;
    fake.emit(sessionId, publication("pub-1"));
    await hub.idle();
    await hub.flush();
    expect(channel.delivered).toHaveLength(0);
    await hub.flush();
    expect(channel.delivered).toHaveLength(0);
    clock.now += 100;
    await hub.flush();
    expect(channel.delivered.map((item) => item.key)).toEqual(["publication:pub-1"]);

    channel.failures = 10;
    fake.emit(sessionId, publication("pub-2"));
    await hub.idle();
    for (let step = 0; step < 5; step += 1) {
      await hub.flush();
      clock.now += 1_000;
    }
    expect(channel.failures).toBe(7);
    expect(channel.delivered.map((item) => item.key)).toEqual(["publication:pub-1"]);
  });

  it("sends a group's result to the asker privately unless the group is allowed", async () => {
    const { hub, fake, channel } = await setup();
    await hub.submit("im", input("evt-1", group, alice));
    fake.emit(fake.calls[0]!.sessionId!, publication("pub-1"));
    await hub.idle();
    await hub.flush();
    expect(channel.delivered).toEqual([
      { target: { kind: "actor", actor: alice }, deliverable: { kind: "publication", publication: publication("pub-1") }, key: "publication:pub-1" },
      { target: { kind: "address", address: group }, deliverable: expect.objectContaining({ kind: "notice", code: "GROUP_DELIVERY_REDIRECTED" }), key: "notice:redirected:pub-1" },
    ]);

    const allowed = await setup({ allowGroupDelivery: (address) => address.chatId === "chat-1" });
    await allowed.hub.submit("im", input("evt-1", group, alice));
    allowed.fake.emit(allowed.fake.calls[0]!.sessionId!, publication("pub-1"));
    await allowed.hub.idle();
    await allowed.hub.flush();
    expect(allowed.channel.delivered).toEqual([{ target: { kind: "address", address: group }, deliverable: { kind: "publication", publication: publication("pub-1") }, key: "publication:pub-1" }]);
  });

  it("ignores events of Sessions that no channel owns", async () => {
    const { hub, fake, channel } = await setup();
    fake.emit("web-session", publication("pub-1"));
    await hub.idle();
    await hub.flush();
    expect(channel.delivered).toHaveLength(0);
  });

  it("coalesces progress and sends the final view when the run completes", async () => {
    const { hub, fake, channel } = await setup();
    await hub.submit("im", input("evt-1", direct));
    const sessionId = fake.calls[0]!.sessionId!;
    fake.emit(sessionId, { type: "agent.text_delta", delta: "正在" });
    fake.emit(sessionId, { type: "agent.tool_started", toolCallId: "c1", toolName: "query_database", args: {} });
    fake.emit(sessionId, { type: "agent.text_delta", delta: "查询" });
    await hub.idle();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(channel.progressViews).toEqual([{ state: "running", runId: "run-1", text: "正在查询", activeTool: "query_database" }]);
    fake.emit(sessionId, { type: "agent.tool_finished", toolCallId: "c1", toolName: "query_database", result: null, isError: false });
    fake.emit(sessionId, { type: "agent.completed" });
    await hub.idle();
    expect(channel.progressViews.at(-1)).toEqual({ state: "completed", runId: "run-1", text: "正在查询" });
    expect(channel.progressTargets.at(-1)).toEqual({ kind: "address", address: direct });
  });

  it("sends a group run's narrative to the asker privately, because it quotes the results", async () => {
    const { hub, fake, channel } = await setup();
    await hub.submit("im", input("evt-1", group, alice));
    const sessionId = fake.calls[0]!.sessionId!;
    fake.emit(sessionId, { type: "agent.text_delta", delta: "上月销售额为 100 万" });
    fake.emit(sessionId, { type: "agent.completed" });
    await hub.idle();
    expect(channel.progressTargets).toEqual([{ kind: "actor", actor: alice }]);
  });

  it("lets a channel read a published CSV as the asker, only when it asks", async () => {
    const reads: { receiptId: string; userId: string; sessionId: string }[] = [];
    const { hub, fake, channel } = await setup({ publications: { read: async (receiptId, context) => { reads.push({ receiptId, ...context }); return { content: "销售额,100" }; } } });
    await hub.submit("im", input("evt-1", direct));
    const { sessionId, userId } = fake.calls[0]!;
    fake.emit(sessionId!, publication("pub-1"));
    await hub.idle();
    await hub.flush();
    expect(reads).toHaveLength(0);
    await expect(channel.contents[0]!.readPublication!()).resolves.toBe("销售额,100");
    expect(reads).toEqual([{ receiptId: "pub-1", userId, sessionId }]);
  });

  it("delivers each version of a dashboard once, where results may go, with its page and picture on demand", async () => {
    const reads: string[] = [];
    const page = new Uint8Array([60, 104]);
    const { hub, fake, channel } = await setup({
      dashboards: { read: async (path, context) => { reads.push(`${path}@${context.sessionId}`); return page; } },
      snapshot: async (html) => new Uint8Array([html.length]),
    });
    await hub.submit("im", input("evt-1", group, alice));
    const sessionId = fake.calls[0]!.sessionId!;
    const dashboard = (contentHash: string): DataAgentEvent => ({ type: "dashboard.delivered", path: "dashboards/sales.html", contentHash, receiptIds: ["pub-1"] });
    fake.emit(sessionId, dashboard("v1"));
    fake.emit(sessionId, dashboard("v1"));
    fake.emit(sessionId, dashboard("v2"));
    await hub.idle();
    await hub.flush();
    expect(channel.delivered.map((item) => [item.key, item.target.kind])).toEqual([["dashboard:v1", "actor"], ["dashboard:v2", "actor"]]);
    expect(reads).toHaveLength(0);
    await expect(channel.contents[0]!.snapshotDashboard!()).resolves.toEqual(new Uint8Array([2]));
    await expect(channel.contents[0]!.readDashboard!()).resolves.toBe(page);
    expect(reads).toEqual([`dashboards/sales.html@${sessionId}`, `dashboards/sales.html@${sessionId}`]);
  });
});
