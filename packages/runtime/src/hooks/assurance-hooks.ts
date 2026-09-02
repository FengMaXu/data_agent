import type {
  AgentHarness,
  ContextEvent,
  ToolCallEvent,
  ToolCallResult,
  ToolResultEvent,
  ToolResultPatch,
  Skill,
} from "@earendil-works/pi-agent-core";

export interface HookFiredEvent {
  readonly type: "hook_fired";
  readonly hookName: "beforeToolCall" | "afterToolCall" | "prepareNextTurnWithContext";
  readonly toolName?: string;
  readonly action: string;
  readonly latencyMs: number;
  readonly taskId?: string;
}

export interface AssuranceHooks {
  beforeToolCall?: (event: ToolCallEvent) => ToolCallResult | Promise<ToolCallResult | undefined> | undefined;
  afterToolCall?: (event: ToolResultEvent) => ToolResultPatch | Promise<ToolResultPatch | undefined> | undefined;
  prepareNextTurnWithContext?: (event: ContextEvent) => { messages: ContextEvent["messages"] } | Promise<{ messages: ContextEvent["messages"] } | undefined> | undefined;
}

export interface AssuranceHookOptions extends AssuranceHooks {
  readonly onHookFired?: (event: HookFiredEvent) => void | Promise<void>;
  readonly taskId?: () => string | undefined;
}

function isSuccessfulPublication(event: ToolResultEvent): boolean {
  if (event.isError || (event.toolName !== "export_query" && event.toolName !== "publish_query_result")) return false;
  const details = event.details && typeof event.details === "object" ? event.details as Record<string, unknown> : undefined;
  return details?.status === "success"
    && details.taskComplete === true
    && Boolean(details.publicationReceipt && typeof details.publicationReceipt === "object");
}

async function notify(options: AssuranceHookOptions, event: HookFiredEvent): Promise<void> {
  try {
    await options.onHookFired?.(event);
  } catch {
    // Hook telemetry must never change the tool or model result.
  }
}

async function runHook<TEvent, TResult>(
  hookName: HookFiredEvent["hookName"],
  event: TEvent,
  taskId: (() => string | undefined) | undefined,
  handler: ((event: TEvent) => TResult | Promise<TResult | undefined> | undefined) | undefined,
  onHookFired: AssuranceHookOptions["onHookFired"],
  toolName?: string,
): Promise<TResult | undefined> {
  if (!handler) return undefined;
  const startedAt = Date.now();
  const result = await handler(event);
  await notify({ onHookFired }, {
    type: "hook_fired",
    hookName,
    ...(toolName ? { toolName } : {}),
    action: result === undefined ? "observe" : "patch",
    latencyMs: Math.max(0, Date.now() - startedAt),
    ...(taskId?.() ? { taskId: taskId() } : {}),
  });
  return result;
}

/**
 * Thin adapter over the installed AgentHarness lifecycle API. The harness
 * exposes hooks through `on(...)`; `subscribe(...)` remains observation-only.
 */
export function wireAssuranceHooks<TContext extends object | undefined, TSkill extends Skill>(
  harness: AgentHarness<TContext, TSkill>,
  options: AssuranceHookOptions,
): () => void {
  const unsubs = [
    harness.on("tool_call", (event) => runHook("beforeToolCall", event, options.taskId, options.beforeToolCall, options.onHookFired, event.toolName)),
    harness.on("tool_result", (event) => runHook("afterToolCall", event, options.taskId, options.afterToolCall, options.onHookFired, event.toolName)),
    harness.on("context", (event) => runHook("prepareNextTurnWithContext", event, options.taskId, options.prepareNextTurnWithContext, options.onHookFired)),
  ];
  return () => { for (const unsubscribe of unsubs) unsubscribe(); };
}

/** Phase 2's non-semantic hook: stop the loop after a successful publication. */
export function createAssuranceHooks(options: Omit<AssuranceHookOptions, "afterToolCall"> = {}): AssuranceHookOptions {
  return {
    ...options,
    afterToolCall: (event) => isSuccessfulPublication(event) ? { terminate: true } : undefined,
  };
}

export const isSuccessfulAssurancePublication = isSuccessfulPublication;
