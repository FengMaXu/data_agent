import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { HarnessChildExecutor } from "./child-harness.js";
import { MemoryChildSessionRepository } from "./child-session-repo.js";

function setup(options: Parameters<typeof fauxProvider>[0] = {}) {
  const faux = fauxProvider({ provider: `child-test-${Math.random()}`, models: [{ id: "child-model" }], ...options });
  const models = createModels();
  models.setProvider(faux.provider);
  const sessions = new MemoryChildSessionRepository();
  const executor = new HarnessChildExecutor({ sessions, models, model: faux.models[0] });
  return { faux, executor };
}

const request = (overrides: Record<string, unknown> = {}) => ({
  runId: "run-1",
  childSessionId: "child-1",
  parentSessionId: "parent-1",
  role: "reviewer" as const,
  prompt: "Review only TARGET_MARKER.",
  systemPrompt: "Return JSON.",
  tools: [],
  timeoutMs: 1_000,
  ...overrides,
});

describe("HarnessChildExecutor", () => {
  it("runs a fresh AgentHarness Session and returns the final assistant text and native usage", async () => {
    const { faux, executor } = setup();
    let providerContext = "";
    let maxTokens: number | undefined;
    faux.setResponses([async (context, options) => {
      providerContext = JSON.stringify(context);
      maxTokens = options?.maxTokens;
      return fauxAssistantMessage(JSON.stringify({ summary: "reviewed", findings: [], unchecked: ["intent"], questions: [] }));
    }]);
    const accepted: string[] = [];
    const result = await executor.execute(request({ onAccepted: (operationId: string) => { accepted.push(operationId); } }));
    expect(result).toMatchObject({ status: "completed", terminalConfirmed: true, text: expect.stringContaining("reviewed") });
    expect(result.usage.inputTokens).toBeTypeOf("number");
    expect(result.usage.outputTokens).toBeTypeOf("number");
    expect(result.usage.totalTokens).toBe(result.usage.inputTokens! + result.usage.outputTokens!);
    expect(result.usage.cost).toBeNull();
    expect(maxTokens).toBe(2_048);
    expect(accepted).toHaveLength(1);
    expect(providerContext).toContain("TARGET_MARKER");
    expect(providerContext).not.toContain("PARENT_HISTORY_SECRET");
    await executor.close();
  });

  it("starts the deadline before child Session creation", async () => {
    const faux = fauxProvider({ provider: `child-admission-timeout-${Math.random()}`, models: [{ id: "child-model" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const executor = new HarnessChildExecutor({
      sessions: {
        async create(input) {
          return new Promise<never>((_resolve, reject) => {
            input.signal?.addEventListener("abort", () => reject(new Error("SESSION_CREATE_CANCELLED")), { once: true });
          });
        },
        async open() { return undefined; },
        async removeOrphans() { return undefined; },
      },
      models,
      model: faux.models[0],
    });
    const started = Date.now();
    const result = await executor.execute(request({ timeoutMs: 20 }));
    expect(Date.now() - started).toBeLessThan(100);
    expect(result).toMatchObject({ status: "timed_out", terminalConfirmed: true });
    expect(faux.state.callCount).toBe(0);
    await executor.close();
  });

  it("close cancels child Session creation before model admission", async () => {
    const faux = fauxProvider({ provider: `child-admission-close-${Math.random()}`, models: [{ id: "child-model" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    let markStarted!: () => void;
    const startedCreating = new Promise<void>((resolve) => { markStarted = resolve; });
    const executor = new HarnessChildExecutor({
      sessions: {
        async create(input) {
          markStarted();
          return new Promise<never>((_resolve, reject) => {
            input.signal?.addEventListener("abort", () => reject(new Error("SESSION_CREATE_CANCELLED")), { once: true });
          });
        },
        async open() { return undefined; },
        async removeOrphans() { return undefined; },
      },
      models,
      model: faux.models[0],
    });
    const running = executor.execute(request({ timeoutMs: 10_000 }));
    await startedCreating;
    const started = Date.now();
    await executor.close();
    expect(Date.now() - started).toBeLessThan(100);
    await expect(running).resolves.toMatchObject({ status: "interrupted", terminalConfirmed: true });
    expect(faux.state.callCount).toBe(0);
  });

  it("does not drive the model when accepted-operation persistence stalls past the deadline", async () => {
    const { faux, executor } = setup();
    faux.setResponses([fauxAssistantMessage("MUST_NOT_RUN")]);
    const started = Date.now();
    const result = await executor.execute(request({
      timeoutMs: 20,
      onAccepted: async () => new Promise<never>(() => undefined),
    }));
    expect(Date.now() - started).toBeLessThan(100);
    expect(result).toMatchObject({ status: "timed_out", terminalConfirmed: true, operationId: expect.any(String) });
    expect(faux.state.callCount).toBe(0);
    await executor.close();
  });

  it("close settles an accepted child even when persistence does not return", async () => {
    const { faux, executor } = setup();
    faux.setResponses([fauxAssistantMessage("MUST_NOT_RUN")]);
    let markAccepted!: () => void;
    const accepted = new Promise<void>((resolve) => { markAccepted = resolve; });
    const running = executor.execute(request({
      timeoutMs: 10_000,
      onAccepted: async () => {
        markAccepted();
        return new Promise<never>(() => undefined);
      },
    }));
    await accepted;
    const started = Date.now();
    await executor.close();
    expect(Date.now() - started).toBeLessThan(100);
    await expect(running).resolves.toMatchObject({ status: "interrupted", terminalConfirmed: true, operationId: expect.any(String) });
    expect(faux.state.callCount).toBe(0);
  });

  it("requests native abort and confirms a timed-out terminal state", async () => {
    const { faux, executor } = setup({ tokensPerSecond: 1 });
    faux.setResponses([fauxAssistantMessage(JSON.stringify({ summary: "x".repeat(2_000), findings: [], unchecked: ["slow"], questions: [] }))]);
    const result = await executor.execute(request({ timeoutMs: 10 }));
    expect(result.status).toBe("timed_out");
    expect(result.terminalConfirmed).toBe(true);
    expect(result.operationId).toBeTruthy();
    await executor.close();
  });

  it("propagates an active parent cancellation to the exact child operation", async () => {
    const { faux, executor } = setup({ tokensPerSecond: 1 });
    faux.setResponses([fauxAssistantMessage(JSON.stringify({ summary: "x".repeat(2_000), findings: [], unchecked: ["slow"], questions: [] }))]);
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 10);
    const result = await executor.execute(request({ signal: abort.signal, timeoutMs: 10_000 }));
    expect(result).toMatchObject({ status: "cancelled", terminalConfirmed: true, operationId: expect.any(String) });
    await executor.close();
  });

  it("aborts active children before executor close returns", async () => {
    const { faux, executor } = setup({ tokensPerSecond: 1 });
    faux.setResponses([fauxAssistantMessage(JSON.stringify({ summary: "x".repeat(2_000), findings: [], unchecked: ["slow"], questions: [] }))]);
    const running = executor.execute(request({ timeoutMs: 10_000 }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await executor.close();
    await expect(running).resolves.toMatchObject({ status: "interrupted", terminalConfirmed: true });
  });

  it("stops before a seventh child model request", async () => {
    const { faux, executor } = setup();
    faux.setResponses(Array.from({ length: 7 }, (_, index) => fauxAssistantMessage(fauxToolCall("missing_tool", {}, { id: `missing-${index}` }), { stopReason: "toolUse" })));
    const result = await executor.execute(request());
    expect(faux.state.callCount).toBe(6);
    expect(result).toMatchObject({ status: "failed", terminalConfirmed: true, error: expect.stringContaining("SUBAGENT_MODEL_REQUEST_BUDGET_EXHAUSTED") });
    await executor.close();
  });

  it("executes at most eight child tools even when one response requests more", async () => {
    const { faux, executor } = setup();
    let calls = 0;
    const probe = {
      name: "probe",
      label: "probe",
      description: "bounded probe",
      replay: "safe" as const,
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute() { calls += 1; return { content: [{ type: "text" as const, text: "ok" }] }; },
    };
    faux.setResponses([fauxAssistantMessage(Array.from({ length: 9 }, (_, index) => fauxToolCall("probe", {}, { id: `probe-${index}` })), { stopReason: "toolUse" })]);
    await executor.execute(request({ tools: [probe] }));
    expect(calls).toBe(8);
    await executor.close();
  });

  it("does not create a model call when the parent signal is already aborted", async () => {
    const { faux, executor } = setup();
    const abort = new AbortController();
    abort.abort();
    const result = await executor.execute(request({ signal: abort.signal }));
    expect(result).toMatchObject({ status: "cancelled", terminalConfirmed: true });
    expect(faux.state.callCount).toBe(0);
    await executor.close();
  });
});
