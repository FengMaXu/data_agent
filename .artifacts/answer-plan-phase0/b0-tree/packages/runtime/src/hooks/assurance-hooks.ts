import { createCustomMessage, type AgentHarness, type ContextEvent, type ToolCallEvent, type ToolCallResult, type ToolResultEvent, type ToolResultPatch, type Skill } from "@earendil-works/pi-agent-core";
import type { AnomalyRecord, AnomalyRegistry, SpecSlot } from "../anomaly-registry.js";
import type { AnswerSpec } from "../answer-spec.js";
import type { SchemaEvidence } from "../query-digest.js";

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

export interface InterpretationItem {
  readonly id: string;
  readonly statement: string;
  readonly evidence?: { readonly type: "question_span"; readonly quote: string } | null;
}

export interface InterpretationPlan {
  readonly slot: SpecSlot;
  readonly interpretations: readonly InterpretationItem[];
}

export type InterpretationPlanner = (input: {
  readonly taskId: string;
  readonly question: string;
  readonly answerSpec?: AnswerSpec;
  readonly schema?: SchemaEvidence;
  readonly anomalies: readonly AnomalyRecord[];
}) => Promise<InterpretationPlan | undefined>;

export interface AssuranceHookOptions extends AssuranceHooks {
  readonly onHookFired?: (event: HookFiredEvent) => void | Promise<void>;
  readonly taskId?: () => string | undefined;
  readonly anomalyRegistry?: AnomalyRegistry;
  readonly interpretationPlanner?: InterpretationPlanner;
  readonly getTaskQuestion?: (taskId: string) => string | undefined;
  readonly getTaskAnswerSpec?: (taskId: string, specVersion?: string) => AnswerSpec | undefined;
  readonly getTaskSchema?: (taskId: string) => SchemaEvidence | undefined;
  readonly observeQuery?: (event: ToolResultEvent) => ToolResultPatch | Promise<ToolResultPatch | undefined> | undefined;
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
export function createAssuranceHooks(options: Omit<AssuranceHookOptions, "afterToolCall" | "prepareNextTurnWithContext"> = {}): AssuranceHookOptions {
  const injected = new Set<string>();
  return {
    ...options,
    afterToolCall: async (event) => {
      let observed: ToolResultPatch | undefined;
      try {
        observed = event.toolName === "query_database" ? await options.observeQuery?.(event) : undefined;
      } catch {
        // An observation failure must never turn a successful read into a failed tool call.
        observed = undefined;
      }
      const terminate = isSuccessfulPublication(event);
      return observed || terminate ? { ...(observed ?? {}), ...(terminate ? { terminate: true } : {}) } : undefined;
    },
    prepareNextTurnWithContext: async (event) => {
      const taskId = options.taskId?.();
      if (!taskId || !options.anomalyRegistry || !options.interpretationPlanner) return undefined;
      const question = options.getTaskQuestion?.(taskId) ?? "";
      const pending = options.anomalyRegistry.unresolved(taskId).filter((record) => !injected.has(record.id));
      if (!pending.length) return undefined;
      const groups = [...new Set(pending.map((record) => record.slot))].map((slot) => pending.filter((record) => record.slot === slot));
      const sections: string[] = [];
      const anomalyIds: string[] = [];
      for (const group of groups) {
        let plan: InterpretationPlan | undefined;
        try {
          plan = await options.interpretationPlanner({
            taskId,
            question,
            answerSpec: options.getTaskAnswerSpec?.(taskId, group[0].specVersion),
            schema: options.getTaskSchema?.(taskId),
            anomalies: group,
          });
        } catch {
          continue;
        }
        if (!plan || plan.slot !== group[0].slot || plan.interpretations.length < 2) continue;
        const interpretations = plan.interpretations
          .filter((item) => item.id.trim() && item.statement.trim())
          .map((item) => ({ ...item, evidence: item.evidence?.quote && question.includes(item.evidence.quote) ? item.evidence : null }));
        if (interpretations.length < 2) continue;
        for (const record of group) {
          injected.add(record.id);
          anomalyIds.push(record.id);
          sections.push([
            `[INTERPRETATIONS for ${record.id} / slot=${record.slot}]`,
            ...interpretations.map((item) => `${item.id}: ${item.statement}${item.evidence?.quote ? ` — evidence: question "${item.evidence.quote}"` : " — evidence: none"}`),
            `Observed: ${record.note}`,
            `Required: submit one candidate per interpretation via query_database.`,
            `Digest must differ on slot=${record.slot}. Then choose one for export and state which interpretation it implements.`,
          ].join("\\n"));
        }
      }
      if (!sections.length) return undefined;
      return {
        messages: [
          ...event.messages,
          createCustomMessage("assurance_interpretations", sections.join("\n\n"), true, { anomalyIds }, new Date().toISOString()),
        ],
      };
    },
  };
}

export const isSuccessfulAssurancePublication = isSuccessfulPublication;
