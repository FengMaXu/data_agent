import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { ChildOutcome, Delegation, SubagentInput } from "../delegation/index.js";
import type { DataAgentToolContext } from "./answering.js";
import { defineDataAgentTool, type DataAgentToolDefinition } from "./tool-definition.js";

export const SUBAGENT_PARAMETERS = Type.Object({
  tasks: Type.Array(Type.Object({
    key: Type.String({ minLength: 1, maxLength: 128, description: "Unique key within this delegation call." }),
    role: Type.Union([
      Type.Literal("explorer", { description: "Gather information: business definitions from knowledge, table schema, and data values via read-only SQL." }),
      Type.Literal("reviewer", { description: "Review the current Result Candidate of taskId; this child has no tools." }),
    ]),
    task: Type.String({ minLength: 1, maxLength: 8192, description: "Exactly one question for this child, with the granularity of the answer you need." }),
    taskId: Type.Optional(Type.String({ maxLength: 256, description: "Required only for a reviewer: the Query Task whose current Candidate is reviewed. Ignored for an explorer." })),
  }), { minItems: 1, maxItems: 4, description: "One to four tasks that are mutually exclusive and together cover the information you need (MECE); they run in parallel." }),
}, { additionalProperties: false });

type Input = Static<typeof SUBAGENT_PARAMETERS>;

/**
 * Tolerate harmless model slips: an explorer's taskId (often an empty string)
 * is ignored and unknown per-task fields are dropped. Identity and authority
 * always come from the trusted invocation context, never from these fields.
 */
function normalizeInput(input: Input): SubagentInput {
  return {
    tasks: input.tasks.map((task) => {
      const taskId = task.taskId?.trim();
      return {
        key: task.key,
        role: task.role,
        task: task.task,
        ...(task.role === "reviewer" && taskId ? { taskId } : {}),
      };
    }),
  };
}

function renderOutcome(outcome: ChildOutcome, input: Input): string {
  const role = input.tasks.find((task) => task.key === outcome.key)?.role ?? "explorer";
  const header = `## ${outcome.key}（${role}）— ${outcome.status}`;
  const notes = [
    ...(outcome.targetState === "stale" ? [`> 报告对应的内容已变化：${outcome.staleReasons.join("、")}`] : []),
    ...(outcome.report?.truncated ? ["> 报告超出长度上限，已截断。"] : []),
  ];
  const body = outcome.report?.markdown ?? `子任务未完成：${outcome.error ?? outcome.status}`;
  return [header, ...notes, "", body].join("\n");
}

export function createSubagentToolDefinition(delegation: Delegation): DataAgentToolDefinition<DataAgentToolContext> {
  return defineDataAgentTool({
    name: "subagent",
    label: "subagent",
    description: "Delegate one to four information-gathering tasks to fresh-context children that run in parallel. An explorer reads business definitions from knowledge, describes table schema, and observes data values with read-only SQL; it needs no taskId. A reviewer reviews the current Result Candidate of taskId. Each child returns a Markdown report; the main Agent decides what to do with it.",
    replay: "never",
    parameters: SUBAGENT_PARAMETERS,
    async execute(_toolCallId, input, _onUpdate, toolContext, invocation, context) {
      if (!Value.Check(SUBAGENT_PARAMETERS, input)) throw new Error("SUBAGENT_INPUT_INVALID");
      const principalId = toolContext?.principalId?.trim();
      const ownerSessionId = toolContext?.sessionId?.trim();
      if (!principalId || !ownerSessionId) throw new Error("SUBAGENT_CONTEXT_INVALID");
      const requestMessageId = toolContext?.requestMessageId?.trim();
      const outcomes = await delegation.run(normalizeInput(input as Input), {
        principalId,
        ownerSessionId,
        parentOperationId: invocation.operationId,
        parentInvocationId: invocation.invocationId,
        ...(requestMessageId ? { requestMessageId } : {}),
        memo: { get: (name) => invocation.getMemo(name), set: (name, value) => invocation.setMemo(name, value) },
        context,
      }, context.abortSignal);
      const rendered = outcomes.map((outcome) => renderOutcome(outcome, input as Input)).join("\n\n---\n\n");
      return { content: [{ type: "text", text: rendered }], details: outcomes };
    },
  }, {
    promptSnippet: "并行委派 1–4 个信息收集子任务，子 Agent 以 Markdown 报告返回。",
    promptGuidelines: [
      "查业务定义、表结构、数据取值（枚举、范围、样例、基数）时优先委派 explorer，避免把大段知识和探索结果放进主上下文。",
      "派发前按 MECE 原则拆分信息需求：子任务之间互不重叠，合起来覆盖所需信息；每个子 Agent 只执行一个子任务，每个子任务只问一个问题，并写明需要的粒度（如只要列名和类型、只要某字段的取值清单）。explorer 不需要 taskId。",
      "报告只提供信息，口径和 Spec 由你决定；引用业务定义作为证据时使用报告中的逐字引文和 knowledgeId，需要数据观测证据时自己执行一次探索查询。",
    ],
  });
}
