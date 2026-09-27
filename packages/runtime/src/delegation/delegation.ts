import { randomUUID } from "node:crypto";
import type {
  ChildExecutor,
  ChildOutcome,
  ChildOutcomeStatus,
  Delegation,
  DelegationLedger,
  DelegationLedgerRecord,
  DelegationTaskResolver,
  RawChildExecution,
  SubagentInput,
  SubagentTask,
  TrustedDelegationContext,
} from "./index.js";
import { parseChildReport } from "./report.js";
import { processChildConcurrency, processParentOperationConcurrency, type ConcurrencyLimiter, type ConcurrencyLease, type KeyedConcurrencyLimiter } from "./concurrency.js";

export interface NativeDelegationOptions {
  readonly executor: ChildExecutor;
  readonly resolver: DelegationTaskResolver;
  readonly ledger: DelegationLedger;
  readonly timeoutMs?: number;
  readonly maxBatch?: number;
  readonly maxChildrenPerOperation?: number;
  readonly concurrency?: ConcurrencyLimiter;
  readonly parentConcurrency?: KeyedConcurrencyLimiter;
}

function now(): string { return new Date().toISOString(); }
function boundedError(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 2048); }
function byteLength(value: string): number { return Buffer.byteLength(value, "utf8"); }

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("SUBAGENT_DELEGATION_ABORTED");
}

function isDeadlineAbort(signal?: AbortSignal): boolean {
  return signal?.reason instanceof Error && signal.reason.message === "SUBAGENT_DEADLINE_EXCEEDED";
}

async function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => undefined);
    throw abortError(signal);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

function validateTask(task: SubagentTask, keys: Set<string>): void {
  if (!task.key.trim() || task.key.length > 128 || keys.has(task.key)) throw new Error("SUBAGENT_TASK_KEY_INVALID");
  keys.add(task.key);
  if (task.role !== "explorer" && task.role !== "reviewer") throw new Error("SUBAGENT_ROLE_INVALID");
  if (!task.task.trim() || byteLength(task.task) > 8 * 1024) throw new Error("SUBAGENT_TASK_INVALID");
  if (task.taskId !== undefined && (!task.taskId.trim() || byteLength(task.taskId) > 256)) throw new Error("SUBAGENT_TARGET_INVALID");
  if (task.role === "reviewer" && !task.taskId?.trim()) throw new Error("SUBAGENT_REVIEW_TASK_REQUIRED");
}

function initialTargetRef(task: SubagentTask): string {
  return task.role === "reviewer" && task.taskId ? `query-task:${task.taskId}` : `subagent:${task.key}`;
}

function terminalRecord(base: DelegationLedgerRecord, outcome: ChildOutcome): DelegationLedgerRecord {
  return {
    ...base,
    state: "settled",
    ...(outcome.operationId ? { operationId: outcome.operationId } : {}),
    status: outcome.status,
    terminalConfirmed: outcome.terminalConfirmed,
    ...(outcome.error ? { error: outcome.error } : {}),
    recordedAt: now(),
  };
}

export class NativeDelegation implements Delegation {
  private readonly timeoutMs: number;
  private readonly maxBatch: number;
  private readonly maxChildrenPerOperation: number;
  private readonly initialized: Promise<void>;
  private readonly runControllers = new Set<AbortController>();
  private readonly activeDelegations = new Set<Promise<readonly ChildOutcome[]>>();
  private closed = false;

  constructor(private readonly options: NativeDelegationOptions) {
    this.timeoutMs = options.timeoutMs ?? 180_000;
    this.maxBatch = options.maxBatch ?? 4;
    this.maxChildrenPerOperation = options.maxChildrenPerOperation ?? 16;
    if (![this.timeoutMs, this.maxBatch, this.maxChildrenPerOperation].every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error("SUBAGENT_LIMIT_INVALID");
    const initializationController = new AbortController();
    this.runControllers.add(initializationController);
    const initializationDeadline = setTimeout(
      () => initializationController.abort(new Error("SUBAGENT_INITIALIZATION_DEADLINE_EXCEEDED")),
      this.timeoutMs,
    );
    initializationDeadline.unref?.();
    this.initialized = (async () => {
      const records = await awaitWithSignal(options.ledger.list(initializationController.signal), initializationController.signal);
      if (this.closed) return;
      const recovery = options.executor.reconcile
        ? await awaitWithSignal(options.executor.reconcile(records, initializationController.signal), initializationController.signal)
        : undefined;
      if (this.closed) return;
      await awaitWithSignal(options.ledger.reconcile(recovery, initializationController.signal), initializationController.signal);
    })().finally(() => {
      clearTimeout(initializationDeadline);
      this.runControllers.delete(initializationController);
    });
    void this.initialized.catch(() => undefined);
  }

  run(input: SubagentInput, context: TrustedDelegationContext, signal?: AbortSignal): Promise<readonly ChildOutcome[]> {
    const execution = this.executeRun(input, context, signal);
    this.activeDelegations.add(execution);
    void execution.finally(() => this.activeDelegations.delete(execution)).catch(() => undefined);
    return execution;
  }

  private async executeRun(input: SubagentInput, context: TrustedDelegationContext, signal?: AbortSignal): Promise<readonly ChildOutcome[]> {
    if (this.closed) throw new Error("SUBAGENT_DELEGATION_CLOSED");
    const runController = new AbortController();
    this.runControllers.add(runController);
    const sourceSignal = signal ?? context.context.abortSignal;
    const onParentAbort = () => runController.abort(sourceSignal?.reason instanceof Error ? sourceSignal.reason : new Error("SUBAGENT_DELEGATION_CANCELLED"));
    sourceSignal?.addEventListener("abort", onParentAbort, { once: true });
    if (sourceSignal?.aborted) onParentAbort();
    else if (this.closed) runController.abort(new Error("SUBAGENT_DELEGATION_CLOSED"));
    const deadline = setTimeout(() => runController.abort(new Error("SUBAGENT_DEADLINE_EXCEEDED")), this.timeoutMs);
    deadline.unref?.();
    const effectiveSignal = runController.signal;
    try {
    if (!context.principalId.trim() || !context.ownerSessionId.trim() || !context.parentOperationId.trim() || !context.parentInvocationId.trim()) {
      throw new Error("SUBAGENT_TRUSTED_CONTEXT_INVALID");
    }
    if (!Array.isArray(input.tasks) || input.tasks.length < 1 || input.tasks.length > this.maxBatch) throw new Error("SUBAGENT_BATCH_INVALID");
    const keys = new Set<string>();
    input.tasks.forEach((task) => validateTask(task, keys));

    const assigned = input.tasks.map((task) => {
      const runId = randomUUID();
      return {
        task,
        base: {
          runId,
          childSessionId: `subagent-${runId}`,
          parentOperationId: context.parentOperationId,
          parentInvocationId: context.parentInvocationId,
          role: task.role,
          key: task.key,
          state: "reserved",
          recordedAt: now(),
        } satisfies DelegationLedgerRecord,
      };
    });
    const beforeAdmission = (forcedStatus?: ChildOutcomeStatus) => assigned.map(({ task, base }): ChildOutcome => ({
      key: task.key,
      runId: base.runId,
      childSessionId: base.childSessionId,
      targetRef: initialTargetRef(task),
      targetState: "unavailable",
      staleReasons: ["delegation stopped before child admission"],
      status: forcedStatus ?? (isDeadlineAbort(effectiveSignal) ? "timed_out" : this.closed ? "interrupted" : "cancelled"),
      terminalConfirmed: true,
      usage: { inputTokens: null, outputTokens: null, cost: null },
    }));
    try {
      await this.initialized;
      if (effectiveSignal.aborted) return beforeAdmission();
      if (this.closed) throw new Error("SUBAGENT_DELEGATION_CLOSED");
      await awaitWithSignal(
        this.options.ledger.reserve(context.parentOperationId, assigned.map((item) => item.base), this.maxChildrenPerOperation, effectiveSignal),
        effectiveSignal,
      );
    } catch (error) {
      if (effectiveSignal.aborted) return beforeAdmission();
      if (error instanceof Error && error.message === "SUBAGENT_INITIALIZATION_DEADLINE_EXCEEDED") return beforeAdmission("timed_out");
      if (!(error instanceof Error) || error.message !== "SUBAGENT_OPERATION_BUDGET_EXHAUSTED") throw error;
      return assigned.map(({ task, base }) => ({
        key: task.key,
        runId: base.runId,
        childSessionId: base.childSessionId,
        targetRef: initialTargetRef(task),
        targetState: "unavailable",
        staleReasons: ["delegation budget exhausted"],
        status: "budget_exhausted",
        terminalConfirmed: true,
        usage: { inputTokens: null, outputTokens: null, cost: null },
      }));
    }
      if (context.memo) {
        try {
          await awaitWithSignal(
            context.memo.set("subagent-runs", assigned.map(({ task, base }) => ({ key: task.key, role: task.role, runId: base.runId, childSessionId: base.childSessionId }))),
            effectiveSignal,
          );
        } catch (error) {
          if (effectiveSignal.aborted) return beforeAdmission();
          throw error;
        }
      }
      return await Promise.all(assigned.map(async ({ task, base }) => {
        try {
          return await this.runOne(task, base, context, effectiveSignal);
        } catch (error) {
          return {
            key: task.key,
            runId: base.runId,
            childSessionId: base.childSessionId,
            targetRef: initialTargetRef(task),
            targetState: "unavailable" as const,
            staleReasons: ["child outcome could not be durably recorded"],
            status: "failed" as const,
            terminalConfirmed: false,
            usage: { inputTokens: null, outputTokens: null, cost: null },
            error: boundedError(error),
          };
        }
      }));
    } finally {
      clearTimeout(deadline);
      sourceSignal?.removeEventListener("abort", onParentAbort);
      this.runControllers.delete(runController);
    }
  }

  private async runOne(task: SubagentTask, base: DelegationLedgerRecord, context: TrustedDelegationContext, signal?: AbortSignal): Promise<ChildOutcome> {
    let targetRef = initialTargetRef(task);
    const startedAt = Date.now();
    let deadlineExpired = false;
    let parentLease: ConcurrencyLease | undefined;
    const runController = new AbortController();
    this.runControllers.add(runController);
    let rejectAdmissionGuard!: (error: Error) => void;
    const admissionGuard = new Promise<never>((_, reject) => { rejectAdmissionGuard = reject; });
    void admissionGuard.catch(() => undefined);
    const onDelegatedAbort = () => rejectAdmissionGuard(abortError(runController.signal));
    runController.signal.addEventListener("abort", onDelegatedAbort, { once: true });
    const onParentAbort = () => runController.abort(new Error("SUBAGENT_CANCELLED_BEFORE_ADMISSION"));
    signal?.addEventListener("abort", onParentAbort, { once: true });
    if (signal?.aborted) runController.abort(new Error("SUBAGENT_CANCELLED_BEFORE_ADMISSION"));
    else if (this.closed) runController.abort(new Error("SUBAGENT_DELEGATION_CLOSED"));
    const deadline = setTimeout(() => {
      deadlineExpired = true;
      runController.abort(new Error("SUBAGENT_DEADLINE_EXCEEDED"));
    }, this.timeoutMs);
    deadline.unref?.();
    const delegatedSignal = runController.signal;
    const delegatedContext: TrustedDelegationContext = { ...context, deadlineAt: startedAt + this.timeoutMs };
    try {
      if (delegatedSignal.aborted) {
        const outcome: ChildOutcome = {
          key: task.key, runId: base.runId, childSessionId: base.childSessionId, targetRef,
          targetState: "unavailable", staleReasons: ["delegation cancelled before child admission"],
          status: deadlineExpired || isDeadlineAbort(signal) ? "timed_out" : this.closed ? "interrupted" : "cancelled", terminalConfirmed: true,
          usage: { inputTokens: null, outputTokens: null, cost: null },
        };
        if (!delegatedSignal.aborted) {
          await awaitWithSignal(this.options.ledger.append(terminalRecord(base, outcome), delegatedSignal), delegatedSignal);
        }
        return outcome;
      }
      parentLease = await (this.options.parentConcurrency ?? processParentOperationConcurrency).acquire(context.parentOperationId, delegatedSignal);
      const resolved = await Promise.race([
        this.options.resolver.resolve(task, { runId: base.runId, childSessionId: base.childSessionId }, delegatedContext, delegatedSignal),
        admissionGuard,
      ]);
      if (delegatedSignal.aborted) throw new Error("SUBAGENT_DEADLINE_OR_CANCELLATION_BEFORE_ADMISSION");
      targetRef = resolved.targetRef;
      const lease = await (this.options.concurrency ?? processChildConcurrency).acquire(delegatedSignal);
      let raw: RawChildExecution;
      try {
        const remainingMs = Math.max(1, this.timeoutMs - (Date.now() - startedAt));
        raw = await this.options.executor.execute({
          runId: base.runId,
          childSessionId: base.childSessionId,
          parentSessionId: context.ownerSessionId,
          role: task.role,
          prompt: resolved.prompt,
          systemPrompt: resolved.systemPrompt,
          toolDefinitions: resolved.toolDefinitions,
          timeoutMs: remainingMs,
          signal: delegatedSignal,
          onAccepted: async (operationId, acceptedSignal) => {
            await this.options.ledger.append({ ...base, state: "accepted", operationId, recordedAt: now() }, acceptedSignal);
            if (context.memo) await awaitWithSignal(context.memo.set(`subagent-${base.runId}`, { childSessionId: base.childSessionId, operationId }), acceptedSignal);
          },
        });
      } finally {
        lease.release();
      }
      const target = await awaitWithSignal(resolved.checkTarget(delegatedSignal), delegatedSignal)
        .catch((error) => ({ state: "unavailable" as const, reasons: [boundedError(error)] }));
      let status: ChildOutcomeStatus = deadlineExpired || isDeadlineAbort(signal) ? "timed_out" : this.closed ? "interrupted" : signal?.aborted ? "cancelled" : raw.status;
      let report;
      let error = raw.error;
      if (status === "completed") {
        try { report = parseChildReport(raw.text ?? ""); }
        catch (parseError) { status = "invalid_output"; error = boundedError(parseError); }
      }
      const outcome: ChildOutcome = {
        key: task.key,
        runId: base.runId,
        childSessionId: base.childSessionId,
        ...(raw.operationId ? { operationId: raw.operationId } : {}),
        targetRef,
        targetState: target.state,
        staleReasons: [...target.reasons],
        status,
        terminalConfirmed: raw.terminalConfirmed,
        ...(report ? { report } : {}),
        usage: raw.usage,
        ...(error ? { error } : {}),
      };
      await awaitWithSignal(this.options.ledger.append(terminalRecord(base, outcome), delegatedSignal), delegatedSignal);
      if (context.memo) {
        await awaitWithSignal(
          context.memo.set(`subagent-${base.runId}-result`, { status: outcome.status, targetRef: outcome.targetRef, targetState: outcome.targetState }),
          delegatedSignal,
        ).catch(() => undefined);
      }
      return outcome;
    } catch (error) {
      const outcome: ChildOutcome = {
        key: task.key, runId: base.runId, childSessionId: base.childSessionId, targetRef,
        targetState: "unavailable", staleReasons: ["target resolution, admission or child creation failed"],
        status: deadlineExpired || isDeadlineAbort(signal) ? "timed_out" : this.closed ? "interrupted" : signal?.aborted ? "cancelled" : "failed",
        terminalConfirmed: true,
        usage: { inputTokens: null, outputTokens: null, cost: null }, error: boundedError(error),
      };
      if (!delegatedSignal.aborted) {
        await awaitWithSignal(this.options.ledger.append(terminalRecord(base, outcome), delegatedSignal), delegatedSignal);
      }
      return outcome;
    } finally {
      clearTimeout(deadline);
      rejectAdmissionGuard(new Error("SUBAGENT_ADMISSION_FINISHED"));
      signal?.removeEventListener("abort", onParentAbort);
      runController.signal.removeEventListener("abort", onDelegatedAbort);
      parentLease?.release();
      this.runControllers.delete(runController);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const controller of this.runControllers) controller.abort();
    await Promise.allSettled([this.initialized, ...this.activeDelegations]);
    await this.options.executor.close();
  }
}
