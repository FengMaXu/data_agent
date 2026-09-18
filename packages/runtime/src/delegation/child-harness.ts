import {
  AgentHarness,
  TODO_CONTEXT,
  withAbortSignal,
  type AgentHarness as NativeAgentHarness,
  type AgentLane,
  type Entry,
  type Session,
} from "@earendil-works/pi-agent-core";
import type { Model, Models } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { ChildExecutionRequest, ChildExecutor, ChildRecovery, ChildUsage, DelegationLedgerRecord, RawChildExecution } from "./index.js";

const MAX_MODEL_REQUESTS = 6;
const MAX_TOOL_CALLS = 8;
const MAX_OUTPUT_TOKENS = 2_048;

export interface ChildSessionRepository {
  create(input: { readonly id: string; readonly parentSessionId: string; readonly signal?: AbortSignal }): Promise<Session<any>>;
  open(id: string, signal?: AbortSignal): Promise<Session<any> | undefined>;
  removeOrphans(knownChildSessionIds: ReadonlySet<string>, signal?: AbortSignal): Promise<void>;
}

export interface HarnessChildExecutorOptions {
  readonly sessions: ChildSessionRepository;
  readonly models: Models;
  readonly model: Model<any>;
}

interface RunningChild {
  readonly completion: Promise<RawChildExecution>;
  abort(reason: "cancel" | "close" | "timeout"): Promise<void>;
}

function finalAssistantText(entries: readonly Entry[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "message" || entry.message.role !== "assistant") continue;
    const text = entry.message.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("")
      .trim();
    if (text) return text;
  }
  return undefined;
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 2048);
}

async function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => undefined);
    throw signal.reason instanceof Error ? signal.reason : new Error("SUBAGENT_OPERATION_ABORTED");
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error("SUBAGENT_OPERATION_ABORTED"));
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

function modelBudgetError(model: Model<any>): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  stream.push({
    type: "error",
    reason: "error",
    error: {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "error",
      errorMessage: "SUBAGENT_MODEL_REQUEST_BUDGET_EXHAUSTED",
      timestamp: Date.now(),
    },
  });
  return stream;
}

function boundedModels(source: Models): Models {
  let requests = 0;
  const streamSimple: Models["streamSimple"] = (model, context, options) => {
    requests += 1;
    if (requests > MAX_MODEL_REQUESTS) return modelBudgetError(model);
    const requested = options?.maxTokens ?? model.maxTokens;
    const maxTokens = requested > 0 ? Math.min(requested, MAX_OUTPUT_TOKENS) : MAX_OUTPUT_TOKENS;
    return source.streamSimple(model, context, { ...options, maxTokens });
  };
  return new Proxy(source, {
    get(target, property) {
      if (property === "streamSimple") return streamSimple;
      const member = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
}

function nullUsage(): ChildUsage {
  return { inputTokens: null, outputTokens: null, cost: null };
}

export class HarnessChildExecutor implements ChildExecutor {
  private readonly running = new Map<string, RunningChild>();
  private readonly active = new Set<Promise<void>>();
  private closing = false;

  constructor(private readonly options: HarnessChildExecutorOptions) {}

  async reconcile(records: readonly DelegationLedgerRecord[], signal?: AbortSignal): Promise<readonly ChildRecovery[]> {
    const latest = new Map<string, DelegationLedgerRecord>();
    for (const record of records) latest.set(record.runId, record);
    const recovery: ChildRecovery[] = [];
    for (const record of latest.values()) {
      if (signal?.aborted) throw (signal.reason instanceof Error ? signal.reason : new Error("SUBAGENT_RECOVERY_CANCELLED"));
      if (record.state === "reserved") {
        recovery.push(await this.reconcileReserved(record, signal));
      } else if (record.state === "accepted") {
        const operationId = record.operationId;
        if (operationId) recovery.push(await this.reconcileAccepted({ ...record, operationId }, signal));
        else recovery.push({ runId: record.runId, status: "abort_unconfirmed", terminalConfirmed: false, error: "SUBAGENT_ACCEPTED_OPERATION_ID_MISSING" });
      }
    }
    await this.options.sessions.removeOrphans(new Set(records.map((record) => record.childSessionId)), signal);
    return recovery;
  }

  private async reconcileReserved(record: DelegationLedgerRecord, signal?: AbortSignal): Promise<ChildRecovery> {
    const recoveryContext = signal ? withAbortSignal(signal, TODO_CONTEXT) : TODO_CONTEXT;
    const session = await this.options.sessions.open(record.childSessionId, signal);
    if (!session) return { runId: record.runId, status: "interrupted", terminalConfirmed: true };
    let harness: NativeAgentHarness<any> | undefined;
    try {
      const created = await AgentHarness.create({
        session,
        models: boundedModels(this.options.models),
        model: this.options.model,
        thinkingLevel: "low",
        tools: [],
        activeToolNames: [],
        toolContext: { childSessionId: record.childSessionId, runId: record.runId, role: record.role },
        systemPrompt: "Recovery only: do not resume the child operation.",
        toolExecution: "sequential",
        streamOptions: { maxRetries: 0 },
      }, recoveryContext);
      harness = created.harness;
      const lane = await harness.lane("main", recoveryContext);
      const inspection = await lane.inspectExecution(recoveryContext);
      const operationId = inspection.current?.id;
      if (!operationId) return { runId: record.runId, status: "interrupted", terminalConfirmed: true };
      const requested = await lane.requestAbort(operationId, recoveryContext);
      if (!requested.ok) return { runId: record.runId, operationId, status: "abort_unconfirmed", terminalConfirmed: false, error: "SUBAGENT_RECOVERY_ABORT_REQUEST_FAILED" };
      const driven = await lane.drive({ operationId }, recoveryContext);
      if (driven.ok && driven.value.kind === "settled" && driven.value.outcome.status === "aborted") {
        return { runId: record.runId, operationId, status: "interrupted", terminalConfirmed: true };
      }
      return { runId: record.runId, operationId, status: "abort_unconfirmed", terminalConfirmed: false, error: "SUBAGENT_RECOVERY_ABORT_NOT_SETTLED" };
    } catch (error) {
      if (signal?.aborted) throw (signal.reason instanceof Error ? signal.reason : error);
      return { runId: record.runId, status: "abort_unconfirmed", terminalConfirmed: false, error: errorText(error) };
    } finally {
      if (harness) await harness.close(TODO_CONTEXT).catch(() => undefined);
      else await session.close(TODO_CONTEXT).catch(() => undefined);
    }
  }

  private async reconcileAccepted(record: DelegationLedgerRecord & { readonly operationId: string }, signal?: AbortSignal): Promise<ChildRecovery> {
    const recoveryContext = signal ? withAbortSignal(signal, TODO_CONTEXT) : TODO_CONTEXT;
    const session = await this.options.sessions.open(record.childSessionId, signal);
    if (!session) return { runId: record.runId, operationId: record.operationId, status: "abort_unconfirmed", terminalConfirmed: false, error: "SUBAGENT_CHILD_SESSION_MISSING" };
    let harness: NativeAgentHarness<any> | undefined;
    try {
      const created = await AgentHarness.create({
        session,
        models: boundedModels(this.options.models),
        model: this.options.model,
        thinkingLevel: "low",
        tools: [],
        activeToolNames: [],
        toolContext: { childSessionId: record.childSessionId, runId: record.runId, role: record.role },
        systemPrompt: "Recovery only: do not resume the child operation.",
        toolExecution: "sequential",
        streamOptions: { maxRetries: 0 },
      }, recoveryContext);
      harness = created.harness;
      const lane = await harness.lane("main", recoveryContext);
      const result = await lane.getResult(record.operationId, recoveryContext);
      if (result?.status === "aborted") return { runId: record.runId, operationId: record.operationId, status: "interrupted", terminalConfirmed: true };
      if (result) return { runId: record.runId, operationId: record.operationId, status: "interrupted", terminalConfirmed: true, error: `SUBAGENT_RECOVERY_RESULT_NOT_DELIVERED:${result.status}` };
      const inspection = await lane.inspectExecution(recoveryContext);
      if (inspection.current?.id === record.operationId) {
        const requested = await lane.requestAbort(record.operationId, recoveryContext);
        if (!requested.ok) return { runId: record.runId, operationId: record.operationId, status: "abort_unconfirmed", terminalConfirmed: false, error: "SUBAGENT_RECOVERY_ABORT_REQUEST_FAILED" };
        const driven = await lane.drive({ operationId: record.operationId }, recoveryContext);
        if (driven.ok && driven.value.kind === "settled" && driven.value.outcome.status === "aborted") {
          return { runId: record.runId, operationId: record.operationId, status: "interrupted", terminalConfirmed: true };
        }
        return { runId: record.runId, operationId: record.operationId, status: "abort_unconfirmed", terminalConfirmed: false, error: "SUBAGENT_RECOVERY_ABORT_NOT_SETTLED" };
      }
      return { runId: record.runId, operationId: record.operationId, status: "abort_unconfirmed", terminalConfirmed: false, error: "SUBAGENT_RECOVERY_OPERATION_NOT_FOUND" };
    } catch (error) {
      if (signal?.aborted) throw (signal.reason instanceof Error ? signal.reason : error);
      return { runId: record.runId, operationId: record.operationId, status: "abort_unconfirmed", terminalConfirmed: false, error: errorText(error) };
    } finally {
      if (harness) await harness.close(TODO_CONTEXT).catch(() => undefined);
      else await session.close(TODO_CONTEXT).catch(() => undefined);
    }
  }

  async execute(request: ChildExecutionRequest): Promise<RawChildExecution> {
    let release!: () => void;
    const tracked = new Promise<void>((resolve) => { release = resolve; });
    this.active.add(tracked);
    try {
      return await this.executeOne(request);
    } finally {
      release();
      this.active.delete(tracked);
    }
  }

  private async executeOne(request: ChildExecutionRequest): Promise<RawChildExecution> {
    if (this.closing) return { status: "interrupted", terminalConfirmed: true, usage: nullUsage(), error: "SUBAGENT_EXECUTOR_CLOSED" };
    if (request.signal?.aborted) return { status: "cancelled", terminalConfirmed: true, usage: nullUsage() };

    let session: Session<any> | undefined;
    let harness: NativeAgentHarness<any> | undefined;
    let operationId: string | undefined;
    let resolveCompletion!: (value: RawChildExecution) => void;
    const completion = new Promise<RawChildExecution>((resolve) => { resolveCompletion = resolve; });
    let outcome: RawChildExecution | undefined;
    let timedOut = false;
    let cancelled = false;
    let interrupted = false;
    let abortRequested = false;
    const executionAbort = new AbortController();
    let lane: AgentLane | undefined;
    let abortPromise: Promise<void> | undefined;

    const abort = (reason: "timeout" | "cancel" | "close"): Promise<void> => {
      if (reason === "timeout") timedOut = true;
      if (reason === "cancel") cancelled = true;
      if (reason === "close") interrupted = true;
      executionAbort.abort();
      if (!lane || !operationId) return Promise.resolve();
      if (abortPromise) return abortPromise;
      abortPromise = (async () => {
        const requested = await lane.requestAbort(operationId, TODO_CONTEXT).catch(() => undefined);
        abortRequested = requested?.ok === true || abortRequested;
      })();
      return abortPromise;
    };
    this.running.set(request.runId, { completion, abort });
    const onAbort = () => { void abort("cancel"); };
    request.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => { void abort("timeout"); }, request.timeoutMs);
    timer.unref?.();
    const operationContext = withAbortSignal(executionAbort.signal, TODO_CONTEXT);

    try {
      session = await this.options.sessions.create({ id: request.childSessionId, parentSessionId: request.parentSessionId, signal: executionAbort.signal });
      if (executionAbort.signal.aborted) {
        outcome = { status: timedOut ? "timed_out" : this.closing ? "interrupted" : "cancelled", terminalConfirmed: true, usage: nullUsage() };
        return outcome;
      }
      const created = await AgentHarness.create({
        session,
        models: boundedModels(this.options.models),
        model: this.options.model,
        thinkingLevel: "low",
        tools: [...request.tools],
        activeToolNames: request.tools.map((tool) => tool.name),
        toolContext: { childSessionId: request.childSessionId, runId: request.runId, role: request.role },
        systemPrompt: request.systemPrompt,
        toolExecution: "sequential",
        streamOptions: { maxRetries: 0 },
      }, operationContext);
      harness = created.harness;
      let toolCalls = 0;
      harness.hooks.on("before_tool", () => {
        toolCalls += 1;
        return toolCalls > MAX_TOOL_CALLS
          ? { block: { reason: "SUBAGENT_TOOL_CALL_BUDGET_EXHAUSTED", terminate: true } }
          : undefined;
      }, { id: "data-agent-subagent-tool-budget" });
      lane = await harness.lane("main", operationContext);
      if (executionAbort.signal.aborted) {
        outcome = { status: timedOut ? "timed_out" : this.closing ? "interrupted" : "cancelled", terminalConfirmed: true, usage: nullUsage() };
        return outcome;
      }
      const accepted = await lane.accept({ kind: "prompt", prompt: request.prompt }, operationContext);
      if (!accepted.ok) {
        outcome = { status: "failed", terminalConfirmed: true, usage: nullUsage(), error: errorText(accepted.error) };
        return outcome;
      }
      operationId = accepted.value.operationId;
      if (request.onAccepted) {
        try {
          await awaitWithSignal(Promise.resolve(request.onAccepted(operationId, executionAbort.signal)), executionAbort.signal);
        } catch (error) {
          if (!executionAbort.signal.aborted) throw error;
        }
      }
      if (request.signal?.aborted) await abort("cancel");
      if (this.closing) await abort("close");

      let driven = await lane.drive({ operationId }, operationContext).catch((error) => ({ ok: false as const, error }));
      if (!driven.ok && (timedOut || cancelled || interrupted || abortRequested)) {
        await abortPromise?.catch(() => undefined);
        driven = await lane.drive({ operationId }, TODO_CONTEXT).catch((error) => ({ ok: false as const, error }));
      }
      while (driven.ok && driven.value.kind === "waiting" && !timedOut && !cancelled && !interrupted) {
        const delay = driven.value.reason === "retry"
          ? Math.max(0, driven.value.notBefore - Date.now())
          : Math.max(10, driven.value.deferred.pollAfterMs ?? 250);
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(delay, 1_000)));
        driven = await lane.drive({ operationId }, operationContext).catch((error) => ({ ok: false as const, error }));
      }
      if (driven.ok && driven.value.kind === "waiting") {
        await abort(timedOut ? "timeout" : cancelled ? "cancel" : "close");
        driven = await lane.drive({ operationId }, TODO_CONTEXT).catch((error) => ({ ok: false as const, error }));
      }

      const stats = await session.getStats(TODO_CONTEXT);
      const usage: ChildUsage = {
        inputTokens: stats.usage.input + stats.usage.cacheRead + stats.usage.cacheWrite,
        outputTokens: stats.usage.output,
        totalTokens: stats.usage.totalTokens,
        cost: null,
      };
      if (!driven.ok) {
        outcome = {
          status: timedOut || cancelled || interrupted || abortRequested ? "abort_unconfirmed" : "failed",
          terminalConfirmed: false,
          operationId,
          usage,
          error: errorText(driven.error),
        };
      } else if (driven.value.kind !== "settled") {
        outcome = { status: "abort_unconfirmed", terminalConfirmed: false, operationId, usage, error: "SUBAGENT_OPERATION_DID_NOT_SETTLE" };
      } else if (driven.value.outcome.status === "aborted") {
        outcome = {
          status: timedOut ? "timed_out" : cancelled ? "cancelled" : "interrupted",
          terminalConfirmed: true,
          operationId,
          usage,
        };
      } else if (driven.value.outcome.status !== "completed") {
        outcome = {
          status: "failed",
          terminalConfirmed: true,
          operationId,
          usage,
          error: driven.value.outcome.error?.message ?? `SUBAGENT_${driven.value.outcome.status.toUpperCase()}`,
        };
      } else {
        const childText = finalAssistantText(await lane.findEntries(undefined, TODO_CONTEXT));
        outcome = childText
          ? { status: "completed", terminalConfirmed: true, operationId, text: childText, usage }
          : { status: "failed", terminalConfirmed: true, operationId, usage, error: "SUBAGENT_FINAL_TEXT_MISSING" };
      }
      return outcome;
    } catch (error) {
      if (operationId) await abort(this.closing ? "close" : request.signal?.aborted ? "cancel" : "close");
      outcome = {
        status: operationId && (timedOut || cancelled || interrupted || abortRequested)
          ? "abort_unconfirmed"
          : timedOut ? "timed_out" : interrupted ? "interrupted" : cancelled ? "cancelled" : "failed",
        terminalConfirmed: !operationId,
        ...(operationId ? { operationId } : {}),
        usage: nullUsage(),
        error: errorText(error),
      };
      return outcome;
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
      this.running.delete(request.runId);
      if (harness) await harness.close(TODO_CONTEXT).catch(() => undefined);
      else if (session) await session.close(TODO_CONTEXT).catch(() => undefined);
      resolveCompletion(outcome ?? { status: "failed", terminalConfirmed: false, ...(operationId ? { operationId } : {}), usage: nullUsage(), error: "SUBAGENT_EXECUTION_UNKNOWN" });
    }
  }

  async close(): Promise<void> {
    if (this.closing) {
      await Promise.all([...this.active]);
      return;
    }
    this.closing = true;
    const running = [...this.running.values()];
    await Promise.all(running.map((child) => child.abort("close")));
    await Promise.all([...this.active]);
  }
}
