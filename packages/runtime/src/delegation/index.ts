import type { Context, JsonValue } from "@earendil-works/pi-agent-core";
import type { DataAgentToolDefinition } from "../tools/tool-definition.js";

export type ChildRole = "explorer" | "reviewer";

export interface SubagentTask {
  readonly key: string;
  readonly role: ChildRole;
  readonly task: string;
  readonly taskId: string;
  readonly revisionId: string;
}

export interface SubagentInput {
  readonly tasks: readonly SubagentTask[];
}

export interface ChildReportFinding {
  readonly statement: string;
  readonly evidenceRefs: readonly string[];
}

export interface ChildReport {
  readonly summary: string;
  readonly findings: readonly ChildReportFinding[];
  readonly unchecked: readonly string[];
  readonly questions: readonly string[];
}

export type ChildOutcomeStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "timed_out"
  | "budget_exhausted"
  | "invalid_output"
  | "abort_unconfirmed";

export interface ChildUsage {
  /** Total prompt-side tokens, including provider-reported cache reads and writes. */
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens?: number | null;
  readonly cost: number | null;
}

export interface ChildOutcome {
  readonly key: string;
  readonly runId: string;
  readonly childSessionId: string;
  readonly operationId?: string;
  readonly targetRef: string;
  readonly targetState: "current" | "stale" | "unavailable";
  readonly staleReasons: readonly string[];
  readonly status: ChildOutcomeStatus;
  readonly terminalConfirmed: boolean;
  readonly report?: ChildReport;
  readonly usage: ChildUsage;
  readonly error?: string;
}

export interface DelegationMemo {
  get(name: string): Promise<JsonValue | undefined>;
  set(name: string, value: JsonValue | undefined): Promise<void>;
}

export interface DelegationQueryScope {
  readonly scopeId: string;
  readonly connectionId: string;
}

export interface TrustedDelegationContext {
  readonly principalId: string;
  readonly ownerSessionId: string;
  readonly parentOperationId: string;
  readonly parentInvocationId: string;
  readonly memo?: DelegationMemo;
  readonly context: Context;
  /** Set by NativeDelegation for one child admission/execution window. */
  readonly deadlineAt?: number;
  /** Optional host-issued scoped exploration capability. */
  readonly queryScope?: DelegationQueryScope;
}

export interface ChildToolContext {
  readonly childSessionId: string;
  readonly runId: string;
  readonly role: ChildRole;
}

export interface ResolvedChildTask {
  readonly targetRef: string;
  readonly prompt: string;
  readonly systemPrompt: string;
  readonly toolDefinitions: readonly DataAgentToolDefinition<ChildToolContext>[];
  readonly allowedEvidenceRefs: Set<string>;
  checkTarget(signal?: AbortSignal): Promise<{ readonly state: "current" | "stale" | "unavailable"; readonly reasons: readonly string[] }>;
}

export interface DelegationTaskResolver {
  resolve(task: SubagentTask, run: { readonly runId: string; readonly childSessionId: string }, context: TrustedDelegationContext, signal?: AbortSignal): Promise<ResolvedChildTask>;
}

export interface RawChildExecution {
  readonly status: "completed" | "failed" | "cancelled" | "interrupted" | "timed_out" | "abort_unconfirmed";
  readonly terminalConfirmed: boolean;
  readonly operationId?: string;
  readonly text?: string;
  readonly usage: ChildUsage;
  readonly error?: string;
}

export interface ChildExecutionRequest {
  readonly runId: string;
  readonly childSessionId: string;
  readonly parentSessionId: string;
  readonly role: ChildRole;
  readonly prompt: string;
  readonly systemPrompt: string;
  readonly toolDefinitions: readonly DataAgentToolDefinition<ChildToolContext>[];
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly onAccepted?: (operationId: string, signal: AbortSignal) => void | Promise<void>;
}

export interface ChildRecovery {
  readonly runId: string;
  readonly operationId?: string;
  readonly status: "interrupted" | "abort_unconfirmed";
  readonly terminalConfirmed: boolean;
  readonly error?: string;
}

export interface ChildExecutor {
  execute(request: ChildExecutionRequest): Promise<RawChildExecution>;
  /** Abort/reconcile durable child operations, then remove orphan Sessions. */
  reconcile?(records: readonly DelegationLedgerRecord[], signal?: AbortSignal): Promise<readonly ChildRecovery[]>;
  close(): Promise<void>;
}

export interface DelegationLedgerRecord {
  readonly runId: string;
  readonly childSessionId: string;
  readonly parentOperationId: string;
  readonly parentInvocationId: string;
  readonly role: ChildRole;
  readonly key: string;
  readonly state: "reserved" | "accepted" | "settled" | "interrupted";
  readonly operationId?: string;
  readonly status?: ChildOutcomeStatus;
  readonly terminalConfirmed?: boolean;
  readonly error?: string;
  readonly recordedAt: string;
}

export interface DelegationLedger {
  reconcile(recovery?: readonly ChildRecovery[], signal?: AbortSignal): Promise<void>;
  reserve(parentOperationId: string, records: readonly DelegationLedgerRecord[], maximum: number, signal?: AbortSignal): Promise<void>;
  append(record: DelegationLedgerRecord, signal?: AbortSignal): Promise<void>;
  list(signal?: AbortSignal): Promise<readonly DelegationLedgerRecord[]>;
}

export interface Delegation {
  run(input: SubagentInput, context: TrustedDelegationContext, signal?: AbortSignal): Promise<readonly ChildOutcome[]>;
  close(): Promise<void>;
}

export { HarnessChildExecutor, type ChildSessionRepository } from "./child-harness.js";
export { JsonlChildSessionRepository, MemoryChildSessionRepository } from "./child-session-repo.js";
export { InMemoryDelegationLedger, PiSessionDelegationLedger } from "./ledger.js";
export { NativeDelegation } from "./delegation.js";
export { BoundedConcurrencyLimiter, BoundedKeyedConcurrencyLimiter, processParentOperationConcurrency, processChildConcurrency, processExplorationConcurrency, type ConcurrencyLimiter, type KeyedConcurrencyLimiter } from "./concurrency.js";
export { parseChildReport } from "./report.js";
