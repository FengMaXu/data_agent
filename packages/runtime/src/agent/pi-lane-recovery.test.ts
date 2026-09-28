import { describe, expect, it } from "vitest";
import { AgentHarness, TODO_CONTEXT, type AgentHarness as NativeAgentHarness, type AgentHarnessTool, type AgentLane } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { PiJsonlSessionStore, unwrapApplicationSession } from "../session-store.js";

const operationContext = { abortSignal: undefined, value: () => undefined, toString: () => "pi-lane-test" };

function modelsFor(faux: ReturnType<typeof fauxProvider>) {
  const models = createModels();
  models.setProvider(faux.provider);
  return models;
}

async function createHarness(session: ReturnType<typeof unwrapApplicationSession>, faux: ReturnType<typeof fauxProvider>, tools: AgentHarnessTool<undefined>[] = []) {
  const models = modelsFor(faux);
  return AgentHarness.create({
    session,
    models,
    model: faux.models[0],
    systemPrompt: "You are a test agent.",
    tools,
  }, operationContext);
}

async function closeStore(store: PiJsonlSessionStore, harness: NativeAgentHarness): Promise<void> {
  await harness.close(operationContext);
  await store.close();
}

describe("Pi 0.85 AgentLane recovery contract", () => {
  it("persists accept-before-drive and resumes it after Session Host reconstruction", async () => {
    const root = await mkdtemp(path.join(process.cwd(), ".tmp-pi-recovery-"));
    const faux = fauxProvider({ provider: "data-agent-test", models: [{ id: "lane-test" }] });
    let store = new PiJsonlSessionStore(root);
    const attached = await store.create({ sessionId: "session-1" });
    const first = await createHarness(unwrapApplicationSession(attached), faux);
    const firstLane = await first.harness.lane("main", operationContext);
    const accepted = await firstLane.accept({ kind: "prompt", prompt: "hello" }, operationContext);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw accepted.error;
    const operationId = accepted.value.operationId;
    const beforeDrive = await firstLane.inspectExecution(operationContext);
    expect(beforeDrive.current?.id).toBe(operationId);
    await closeStore(store, first.harness);

    store = new PiJsonlSessionStore(root);
    const reopened = await store.openByAppSessionId("session-1");
    faux.setResponses([fauxAssistantMessage("recovered")]);
    const second = await createHarness(unwrapApplicationSession(reopened), faux);
    const secondLane = await second.harness.lane("main", operationContext);
    const restored = await secondLane.inspectExecution(operationContext);
    expect(restored.current?.id).toBe(operationId);
    expect(restored.current?.status).not.toBe("cancel_requested");
    const driven = await secondLane.drive({ operationId }, operationContext);
    expect(driven.ok).toBe(true);
    const result = await secondLane.getResult(operationId, operationContext);
    expect(result?.status).toBe("completed");
    expect(faux.state.callCount).toBe(1);
    await closeStore(store, second.harness);
    await rm(root, { recursive: true, force: true });
  });

  it("provides a complete watch snapshot and live accepted-to-settled events", async () => {
    const faux = fauxProvider({ provider: "data-agent-test-watch", models: [{ id: "lane-test" }] });
    faux.setResponses([fauxAssistantMessage("watched")]);
    const storePath = await mkdtemp(path.join(process.cwd(), ".tmp-pi-watch-"));
    const store = new PiJsonlSessionStore(storePath);
    const attached = await store.create({ sessionId: "session-watch" });
    const created = await createHarness(unwrapApplicationSession(attached), faux);
    const lane = await created.harness.lane("main", operationContext);
    const watch = await lane.watch(operationContext);
    const eventTypes: string[] = [];
    watch.start((event) => { eventTypes.push(event.type); });
    expect(watch.snapshot.operation).toBeNull();
    const accepted = await lane.accept({ kind: "prompt", prompt: "watch me" }, operationContext);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw accepted.error;
    const acceptedSnapshot = await watch.resnapshot(operationContext);
    expect(acceptedSnapshot.operation?.id).toBe(accepted.value.operationId);
    await lane.drive({ operationId: accepted.value.operationId }, operationContext);
    const settled = await watch.resnapshot(operationContext);
    expect(settled.operation).toBeNull();
    expect(settled.lastResult?.operationId).toBe(accepted.value.operationId);
    expect(eventTypes).toContain("run_start");
    expect(eventTypes).toContain("run_end");
    watch.unsubscribe();
    await closeStore(store, created.harness);
    await rm(storePath, { recursive: true, force: true });
  });

  it("provides durable invocation memo identity to a native safe tool", async () => {
    const faux = fauxProvider({ provider: "data-agent-test-memo", models: [{ id: "lane-test" }] });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("memo_probe", {}, { id: "memo-call" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]);
    const observed: Array<{ invocationId: string; value: unknown }> = [];
    const tool: AgentHarnessTool<undefined> = {
      name: "memo_probe",
      label: "memo_probe",
      description: "memo probe",
      replay: "safe",
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute(_toolCallId, _params, _onUpdate, _toolContext, invocation) {
        await invocation.setMemo("result-ref", { resultRef: "result-test", contentHash: "hash-test" });
        observed.push({ invocationId: invocation.invocationId, value: await invocation.getMemo("result-ref") });
        return { content: [{ type: "text", text: "ok" }], details: null };
      },
    };
    const storePath = await mkdtemp(path.join(process.cwd(), ".tmp-pi-memo-"));
    const store = new PiJsonlSessionStore(storePath);
    const attached = await store.create({ sessionId: "session-memo" });
    const created = await createHarness(unwrapApplicationSession(attached), faux, [tool]);
    const lane = await created.harness.lane("main", operationContext);
    const accepted = await lane.accept({ kind: "prompt", prompt: "use the tool" }, operationContext);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw accepted.error;
    await lane.drive({ operationId: accepted.value.operationId }, operationContext);
    expect(observed).toEqual([{ invocationId: expect.any(String), value: { resultRef: "result-test", contentHash: "hash-test" } }]);
    await closeStore(store, created.harness);
    await rm(storePath, { recursive: true, force: true });
  });

  it("uses Pi hook repeat semantics for bounded before_run_end follow-up", async () => {
    const faux = fauxProvider({ provider: "data-agent-test-hooks", models: [{ id: "lane-test" }] });
    faux.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
    const storePath = await mkdtemp(path.join(process.cwd(), ".tmp-pi-hooks-"));
    const store = new PiJsonlSessionStore(storePath);
    const attached = await store.create({ sessionId: "session-hooks" });
    const created = await createHarness(unwrapApplicationSession(attached), faux);
    const runIds: string[] = [];
    created.harness.hooks.on("before_run_end", (event) => {
      runIds.push(event.runId);
      return runIds.length === 1 ? { followUp: "one bounded follow-up" } : undefined;
    }, { id: "data-agent-test-bounded-follow-up" });
    const lane = await created.harness.lane("main", operationContext);
    const accepted = await lane.accept({ kind: "prompt", prompt: "start" }, operationContext);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw accepted.error;
    const driven = await lane.drive({ operationId: accepted.value.operationId }, operationContext);
    expect(driven.ok).toBe(true);
    expect(runIds).toEqual([accepted.value.operationId, accepted.value.operationId]);
    expect(faux.state.callCount).toBe(2);
    await closeStore(store, created.harness);
    await rm(storePath, { recursive: true, force: true });
  });

  it("uses the persisted operation identity for abort and rejects a stale identity", async () => {
    const faux = fauxProvider({ provider: "data-agent-test-stale", models: [{ id: "lane-test" }] });
    const storePath = await mkdtemp(path.join(process.cwd(), ".tmp-pi-abort-"));
    const store = new PiJsonlSessionStore(storePath);
    const attached = await store.create({ sessionId: "session-2" });
    const created = await createHarness(unwrapApplicationSession(attached), faux);
    const lane: AgentLane = await created.harness.lane("main", operationContext);
    const first = await lane.accept({ kind: "prompt", prompt: "first" }, operationContext);
    expect(first.ok).toBe(true);
    if (!first.ok) throw first.error;
    faux.setResponses([fauxAssistantMessage("first")]);
    await expect(lane.drive({ operationId: first.value.operationId }, operationContext)).resolves.toMatchObject({ ok: true });
    const second = await lane.accept({ kind: "prompt", prompt: "second" }, operationContext);
    expect(second.ok).toBe(true);
    if (!second.ok) throw second.error;
    const stale = await lane.requestAbort(first.value.operationId, operationContext);
    expect(stale.ok).toBe(false);
    const current = await lane.inspectExecution(operationContext);
    expect(current.current?.id).toBe(second.value.operationId);
    const abort = await lane.requestAbort(second.value.operationId, operationContext);
    expect(abort.ok).toBe(true);
    const ended = await lane.drive({ operationId: second.value.operationId }, operationContext);
    expect(ended.ok).toBe(true);
    if (ended.ok) {
      expect(ended.value.kind).toBe("settled");
      if (ended.value.kind === "settled") expect(ended.value.outcome.status).toBe("aborted");
    }
    await closeStore(store, created.harness);
    await rm(storePath, { recursive: true, force: true });
  });
});
