import {
  TODO_CONTEXT,
  appendList,
  list,
  setValue,
  value,
  withAbortSignal,
  type JsonValue,
  type Session,
} from "@earendil-works/pi-agent-core";
import type { ChildRecovery, DelegationLedger, DelegationLedgerRecord } from "./index.js";

const COUNTS = value<Record<string, number>>("data-agent.delegation", "operation-counts");
const RECORDS = list<DelegationLedgerRecord & JsonValue>("data-agent.delegation", "runs");

function asJson(record: DelegationLedgerRecord): DelegationLedgerRecord & JsonValue {
  return JSON.parse(JSON.stringify(record)) as DelegationLedgerRecord & JsonValue;
}

export class InMemoryDelegationLedger implements DelegationLedger {
  private readonly records: DelegationLedgerRecord[] = [];
  private readonly counts = new Map<string, number>();

  async reconcile(recovery: readonly ChildRecovery[] = [], signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error("SUBAGENT_LEDGER_RECONCILE_CANCELLED");
    const recoveryByRun = new Map(recovery.map((item) => [item.runId, item]));
    const terminal = new Set(this.records.filter((record) => record.state === "settled" || record.state === "interrupted").map((record) => record.runId));
    const latest = new Map<string, DelegationLedgerRecord>();
    for (const record of this.records) latest.set(record.runId, record);
    for (const record of latest.values()) {
      if (signal?.aborted) throw new Error("SUBAGENT_LEDGER_RECONCILE_CANCELLED");
      if ((record.state !== "reserved" && record.state !== "accepted") || terminal.has(record.runId)) continue;
      const recovered = recoveryByRun.get(record.runId);
      this.records.push({ ...record, state: "interrupted", ...(recovered?.operationId ? { operationId: recovered.operationId } : {}), status: recovered?.status ?? "interrupted", terminalConfirmed: recovered?.terminalConfirmed ?? true, ...(recovered?.error ? { error: recovered.error } : {}), recordedAt: new Date().toISOString() });
    }
  }

  async reserve(parentOperationId: string, records: readonly DelegationLedgerRecord[], maximum: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error("SUBAGENT_LEDGER_RESERVE_CANCELLED");
    const prior = this.counts.get(parentOperationId) ?? 0;
    if (prior + records.length > maximum) throw new Error("SUBAGENT_OPERATION_BUDGET_EXHAUSTED");
    this.counts.set(parentOperationId, prior + records.length);
    this.records.push(...records.map((record) => ({ ...record })));
  }

  async append(record: DelegationLedgerRecord, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error("SUBAGENT_LEDGER_APPEND_CANCELLED");
    this.records.push({ ...record });
  }
  async list(signal?: AbortSignal): Promise<readonly DelegationLedgerRecord[]> {
    if (signal?.aborted) throw new Error("SUBAGENT_LEDGER_LIST_CANCELLED");
    return this.records.map((record) => ({ ...record }));
  }
}

export class PiSessionDelegationLedger implements DelegationLedger {
  constructor(private readonly session: Session<any>) {}

  async reconcile(recovery: readonly ChildRecovery[] = [], signal?: AbortSignal): Promise<void> {
    const records = await this.list(signal);
    const recoveryByRun = new Map(recovery.map((item) => [item.runId, item]));
    const terminal = new Set(records.filter((record) => record.state === "settled" || record.state === "interrupted").map((record) => record.runId));
    const latest = new Map<string, DelegationLedgerRecord>();
    for (const record of records) latest.set(record.runId, record);
    for (const record of latest.values()) {
      if (terminal.has(record.runId) || (record.state !== "reserved" && record.state !== "accepted")) continue;
      const recovered = recoveryByRun.get(record.runId);
      await this.append({ ...record, state: "interrupted", ...(recovered?.operationId ? { operationId: recovered.operationId } : {}), status: recovered?.status ?? "interrupted", terminalConfirmed: recovered?.terminalConfirmed ?? true, ...(recovered?.error ? { error: recovered.error } : {}), recordedAt: new Date().toISOString() }, signal);
    }
  }

  async reserve(parentOperationId: string, records: readonly DelegationLedgerRecord[], maximum: number, signal?: AbortSignal): Promise<void> {
    const context = signal ? withAbortSignal(signal, TODO_CONTEXT) : TODO_CONTEXT;
    await this.session.mutate(async (mutation) => {
      const counts = { ...((await mutation.getValue(COUNTS, context))?.value ?? {}) };
      const prior = counts[parentOperationId] ?? 0;
      if (prior + records.length > maximum) throw new Error("SUBAGENT_OPERATION_BUDGET_EXHAUSTED");
      counts[parentOperationId] = prior + records.length;
      await mutation.commit([
        setValue(COUNTS, counts),
        ...records.map((record) => appendList(RECORDS, asJson(record))),
      ], context);
    }, context);
  }

  async append(record: DelegationLedgerRecord, signal?: AbortSignal): Promise<void> {
    await this.session.appendList(RECORDS, asJson(record), signal ? withAbortSignal(signal, TODO_CONTEXT) : TODO_CONTEXT);
  }

  async list(signal?: AbortSignal): Promise<readonly DelegationLedgerRecord[]> {
    const context = signal ? withAbortSignal(signal, TODO_CONTEXT) : TODO_CONTEXT;
    return (await this.session.readList(RECORDS, undefined, context)).map((item) => item.value as DelegationLedgerRecord);
  }
}
