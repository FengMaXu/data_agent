import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { JsonValue } from "@earendil-works/chord";
import type {
  AgentHarnessTool,
  AgentHarnessToolInvocation,
  AgentToolResult,
  Context,
} from "@earendil-works/pi-agent-core";
import { AnsweringError } from "../answering/public.js";
import { renderSpecFeedback } from "../answering/spec-feedback.js";
import type {
  Answering,
  AnswerSpecProposal,
  BeginAnswer,
  BusinessContext,
  ChoiceProposal,
  ExecuteQuery,
  HypothesisProposal,
  InspectAnswer,
  PublishCandidate,
  ReviseAnswer,
  UntrustedEvidenceInput,
} from "../answering/public.js";
import { isFacetName, isHypothesisKind, isEvidenceKind } from "../answering/public.js";
import type {
  HypothesisChoiceAdvisor,
  HypothesisChoiceEvidence,
} from "../judgment/hypothesis-choice.js";
import { defineDataAgentTool, type DataAgentToolDefinition } from "./tool-definition.js";

/**
 * The only application state carried into a model tool invocation. Query task
 * and revision identities deliberately do not live here; they are explicit
 * opaque tool arguments and are checked by Answering.
 */
export interface DataAgentToolContext {
  readonly sessionId: string;
  readonly principalId: string;
  /** Supplied by the trusted host for the operation's user message. */
  readonly requestMessageId?: string;
}

const facetNameSchema = Type.Union([
  Type.Literal("entity"),
  Type.Literal("metric"),
  Type.Literal("filters"),
  Type.Literal("groupBy"),
  Type.Literal("time"),
  Type.Literal("ranking"),
  Type.Literal("output"),
]);

const hypothesisKindSchema = Type.Union([
  Type.Literal("business_semantics"),
  Type.Literal("physical_mapping"),
  Type.Literal("data_property"),
]);

const modelEvidenceKindSchema = Type.Union([
  Type.Literal("user_confirmation"),
  Type.Literal("reviewed_definition"),
  Type.Literal("task_document"),
  Type.Literal("request_wording"),
  Type.Literal("schema_fact"),
]);

const unknownFacetSchema = Type.Object({ state: Type.Literal("unknown") }, { additionalProperties: false });
const notApplicableFacetSchema = Type.Object({ state: Type.Literal("not_applicable") }, { additionalProperties: false });
const nonEmptyStringSchema = Type.String({ minLength: 1, pattern: "\\S" });

function facetSchema<T extends import("typebox").TSchema>(value: T) {
  return Type.Union([
    Type.Null(),
    unknownFacetSchema,
    notApplicableFacetSchema,
    value,
    Type.Object({
      value,
      hypothesisId: Type.Optional(nonEmptyStringSchema),
    }, { additionalProperties: false }),
  ]);
}

const entityValueSchema = Type.Union([
  nonEmptyStringSchema,
  Type.Object({
    name: nonEmptyStringSchema,
    keyColumns: Type.Optional(Type.Array(nonEmptyStringSchema)),
  }, { additionalProperties: false }),
]);
const metricValueSchema = Type.Union([
  nonEmptyStringSchema,
  Type.Object({
    kind: nonEmptyStringSchema,
    expression: Type.Optional(nonEmptyStringSchema),
    unit: Type.Optional(nonEmptyStringSchema),
  }, { additionalProperties: false }),
]);
const expressionValueSchema = Type.Union([
  nonEmptyStringSchema,
  Type.Object({ expression: nonEmptyStringSchema }, { additionalProperties: false }),
]);
const timeValueSchema = Type.Union([
  nonEmptyStringSchema,
  Type.Object({
    expression: nonEmptyStringSchema,
    boundary: Type.Optional(Type.Union([
      Type.Literal("inclusive"),
      Type.Literal("exclusive"),
      Type.Literal("mixed"),
      Type.Literal("unspecified"),
    ])),
  }, { additionalProperties: false }),
]);
const rankingValueSchema = Type.Object({
  n: Type.Integer({ minimum: 1 }),
  orderBy: nonEmptyStringSchema,
  tiePolicy: Type.Optional(Type.Union([
    Type.Literal("strict"),
    Type.Literal("include_ties"),
    Type.Literal("unspecified"),
  ])),
}, { additionalProperties: false });
const outputValueSchema = Type.Object({
  rowMode: Type.Optional(Type.Union([
    Type.Literal("scalar"),
    Type.Literal("top_n"),
    Type.Literal("grouped"),
    Type.Literal("full"),
    Type.Literal("detail"),
  ])),
  rowCount: Type.Optional(Type.Integer({ minimum: 0 })),
  columns: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: false, minProperties: 1 });

const proposalSchema = Type.Object({
  entity: Type.Optional(facetSchema(entityValueSchema)),
  metric: Type.Optional(facetSchema(metricValueSchema)),
  filters: Type.Optional(Type.Array(facetSchema(expressionValueSchema))),
  groupBy: Type.Optional(Type.Array(facetSchema(expressionValueSchema))),
  time: Type.Optional(facetSchema(timeValueSchema)),
  ranking: Type.Optional(facetSchema(rankingValueSchema)),
  output: Type.Optional(facetSchema(outputValueSchema)),
}, { additionalProperties: false });

const evidenceSchema = Type.Object({
  kind: modelEvidenceKindSchema,
  sourceRef: Type.String({ minLength: 1 }),
  contentHash: Type.Optional(Type.String({ minLength: 1 })),
  quote: Type.Optional(Type.String()),
}, { additionalProperties: false });

const hypothesisSchema = Type.Object({
  localId: Type.String({ minLength: 1 }),
  kind: hypothesisKindSchema,
  statement: Type.String({ minLength: 1 }),
  affects: Type.Array(facetNameSchema, { minItems: 1 }),
  basis: Type.String({ minLength: 1 }),
  impact: Type.String({ minLength: 1 }),
  proposedEvidenceIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
}, { additionalProperties: false });

const choiceSchema = Type.Object({
  localId: Type.String({ minLength: 1 }),
  affects: Type.Array(facetNameSchema, { minItems: 1 }),
  alternatives: Type.Array(Type.Object({
    localId: Type.String({ minLength: 1 }),
    statement: Type.String({ minLength: 1 }),
  }, { additionalProperties: false }), { minItems: 2 }),
  selectedAlternativeId: Type.Optional(Type.String({ minLength: 1 })),
  selectionEvidenceIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  provisionalAlternativeId: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false });

/** One model-facing update tool; the domain still exposes begin/revise only. */
export const UPDATE_ANSWER_PARAMETERS = Type.Union([
  Type.Object({
    kind: Type.Literal("begin"),
    spec: proposalSchema,
    hypotheses: Type.Optional(Type.Array(hypothesisSchema)),
    choices: Type.Optional(Type.Array(choiceSchema)),
    evidence: Type.Optional(Type.Array(evidenceSchema)),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal("revise"),
    taskId: Type.String({ minLength: 1 }),
    baseRevisionId: Type.String({ minLength: 1 }),
    spec: proposalSchema,
    hypotheses: Type.Optional(Type.Array(hypothesisSchema)),
    choices: Type.Optional(Type.Array(choiceSchema)),
    evidence: Type.Optional(Type.Array(evidenceSchema)),
  }, { additionalProperties: false }),
], { type: "object" } as any);

export const ANSWERING_QUERY_PARAMETERS = Type.Union([
  Type.Object({
    kind: Type.Literal("exploration"),
    taskId: Type.String({ minLength: 1 }),
    sql: Type.String({ minLength: 1 }),
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal("result"),
    taskId: Type.String({ minLength: 1 }),
    revisionId: Type.String({ minLength: 1 }),
    sql: Type.String({ minLength: 1 }),
  }, { additionalProperties: false }),
], { type: "object" } as any);

export const ANSWERING_PUBLISH_PARAMETERS = Type.Object({
  candidateId: Type.String({ minLength: 1 }),
  format: Type.Union([Type.Literal("auto"), Type.Literal("inline"), Type.Literal("csv")]),
}, { additionalProperties: false });

export const ANSWERING_INSPECT_PARAMETERS = Type.Object({
  taskId: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

export const HYPOTHESIS_COMPARISON_PARAMETERS = Type.Object({
  hypotheses: Type.Array(Type.Object({
    id: Type.String({ minLength: 1 }),
    statement: Type.String({ minLength: 1 }),
  }, { additionalProperties: false }), { minItems: 2, maxItems: 32 }),
  evidence: Type.Optional(Type.Array(Type.Object({
    content: Type.String({ minLength: 1 }),
    sourceRef: Type.Optional(Type.String({ minLength: 1 })),
  }, { additionalProperties: false }), { maxItems: 32 })),
}, { additionalProperties: false });

type UpdateAnswerInput = Static<typeof UPDATE_ANSWER_PARAMETERS>;
type QueryInput = Static<typeof ANSWERING_QUERY_PARAMETERS>;
type PublishInput = Static<typeof ANSWERING_PUBLISH_PARAMETERS>;
type InspectInput = Static<typeof ANSWERING_INSPECT_PARAMETERS>;
export type HypothesisComparisonInput = Static<typeof HYPOTHESIS_COMPARISON_PARAMETERS>;

type ToolContext = DataAgentToolContext | undefined;

function json(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? { __type: "bigint", value: item.toString() } : item);
}

function result(content: string, details?: unknown): AgentToolResult<unknown> {
  return { content: [{ type: "text", text: content }], details: details ?? null };
}

function checked<TSchema extends import("typebox").TSchema>(schema: TSchema, input: unknown): Static<TSchema> {
  if (!Value.Check(schema, input)) throw new Error("ANSWERING_TOOL_INPUT_INVALID");
  return input as Static<TSchema>;
}

function memoJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint") return { __type: "bigint", value: item.toString() };
    if (item instanceof Date) return { __type: "date", value: item.toISOString() };
    if (item === undefined) return { __type: "undefined" };
    return item;
  })) as JsonValue;
}

function fromMemoJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromMemoJson);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.__type === "bigint" && typeof record.value === "string") return BigInt(record.value);
    if (record.__type === "date" && typeof record.value === "string") return new Date(record.value);
    if (record.__type === "undefined") return undefined;
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, fromMemoJson(item)]));
  }
  return value;
}

function trustedContext(
  toolContext: ToolContext,
  invocation: AgentHarnessToolInvocation,
  context: Context,
): BusinessContext {
  const sessionId = toolContext?.sessionId?.trim();
  const principalId = toolContext?.principalId?.trim();
  if (!sessionId || !principalId) throw new Error("ANSWERING_CONTEXT_INVALID");
  return {
    principal: { id: principalId },
    sessionId,
    lane: "main",
    operationId: invocation.operationId,
    invocationId: invocation.invocationId,
    memo: {
      get: (name) => invocation.getMemo(name).then(fromMemoJson),
      set: (name, value) => invocation.setMemo(name, memoJson(value)),
    },
    ...(context.abortSignal ? { signal: context.abortSignal } : {}),
  };
}

function proposalEvidence(value: readonly { readonly kind: string; readonly sourceRef: string; readonly contentHash?: string; readonly quote?: string }[] | undefined): readonly UntrustedEvidenceInput[] | undefined {
  if (!value) return undefined;
  return value.map((item) => {
    if (!isEvidenceKind(item.kind) || item.kind === "query_observation") throw new Error("ANSWERING_TOOL_INPUT_INVALID");
    return {
      kind: item.kind,
      sourceRef: item.sourceRef,
      ...(item.contentHash ? { contentHash: item.contentHash } : {}),
      ...(item.quote !== undefined ? { quote: item.quote } : {}),
    };
  });
}

function proposalHypotheses(value: readonly Static<typeof hypothesisSchema>[] | undefined): readonly HypothesisProposal[] | undefined {
  if (!value) return undefined;
  return value.map((item) => {
    if (!isHypothesisKind(item.kind) || item.affects.some((facet) => !isFacetName(facet))) throw new Error("ANSWERING_TOOL_INPUT_INVALID");
    return item;
  });
}

function proposalChoices(value: readonly Static<typeof choiceSchema>[] | undefined): readonly ChoiceProposal[] | undefined {
  if (!value) return undefined;
  return value.map((item) => {
    if (item.affects.some((facet) => !isFacetName(facet))) throw new Error("ANSWERING_TOOL_INPUT_INVALID");
    return item;
  });
}

function fanoutText(view: Awaited<ReturnType<Answering["execute"]>>): string {
  const report = view.fanout;
  if (!report || report.status === "not_applicable") return "";
  const findings = report.targets.filter((target) => target.status === "finding").map((target) => {
    const observation = target.observation;
    return `${target.sourceRelation}.${target.sourceKey} joined=${observation?.joinedNonNullKeys ?? "?"} distinct=${observation?.joinedDistinctKeys ?? "?"}`;
  });
  const reason = report.unsupportedReasons?.length ? ` reasons=${report.unsupportedReasons.join(",")}` : "";
  return `[FANOUT_CHECK] status=${report.status}${reason}\n${findings.length ? `Observed source-key duplication: ${findings.join("; ")}. This is a bounded metric-copy observation, not a business-semantic verdict.` : "No source-key duplication was observed within the supported probe coverage."}`;
}

function queryText(view: Awaited<ReturnType<Answering["execute"]>>): string {
  const artifact = view.artifact.kind === "exploration"
    ? `[EXPLORATION_EVIDENCE] evidenceId=${view.artifact.evidenceId}\nReference this evidenceId from proposedEvidenceIds or selectionEvidenceIds; do not resubmit the observation body.`
    : `[RESULT_CANDIDATE] candidateId=${view.artifact.candidateId} revisionId=${view.artifact.revisionId}`;
  const preview = `${view.preview.columns.join(" | ")}\n${view.preview.rows.map((row) => row.map((cell) => cell === null || cell === undefined ? "NULL" : String(cell)).join(" | ")).join("\n")}${view.preview.truncated ? "\n(truncated preview)" : ""}`;
  const fanout = fanoutText(view);
  return `${artifact}${fanout ? `\n${fanout}` : ""}\n${preview}`;
}

function updateTool(answering: Answering): AgentHarnessTool<DataAgentToolContext> {
  return {
    name: "update_answer_spec",
    label: "update_answer_spec",
    description: "Begin or revise the one canonical seven-facet Answer Spec. Only opaque task/revision handles returned by this tool may be reused.",
    replay: "never",
    parameters: UPDATE_ANSWER_PARAMETERS,
    async execute(toolCallId, input, _onUpdate, toolContext, invocation, context) {
      void toolCallId;
      const value = checked(UPDATE_ANSWER_PARAMETERS, input) as UpdateAnswerInput;
      const business = trustedContext(toolContext, invocation, context);
      const requestId = invocation.invocationId;
      if (value.kind === "begin") {
        // requestMessageId is supplied by the trusted Session Host tool
        // context; it is never accepted from model arguments.
        const hypotheses = proposalHypotheses(value.hypotheses);
        const choices = proposalChoices(value.choices);
        const evidence = proposalEvidence(value.evidence);
        const requestMessageId = toolContext?.requestMessageId?.trim();
        if (!requestMessageId) throw new Error("ANSWERING_REQUEST_MESSAGE_REQUIRED");
        const begin: BeginAnswer = {
          requestMessageId,
          requestId,
          spec: value.spec as AnswerSpecProposal,
          ...(hypotheses ? { hypotheses } : {}),
          ...(choices ? { choices } : {}),
          ...(evidence ? { evidence } : {}),
        };
        const view = await answering.begin(begin, business);
        const feedback = renderSpecFeedback(view.specFeedback);
        return result(`[ANSWER_SPEC_STARTED] taskId=${view.taskId} revisionId=${view.revisionId}${feedback ? `\n${feedback}` : ""}\n${json(view)}`, view);
      }
      const hypotheses = proposalHypotheses(value.hypotheses);
      const choices = proposalChoices(value.choices);
      const evidence = proposalEvidence(value.evidence);
      const revise: ReviseAnswer = {
        taskId: value.taskId,
        baseRevisionId: value.baseRevisionId,
        requestId,
        spec: value.spec as AnswerSpecProposal,
        ...(hypotheses ? { hypotheses } : {}),
        ...(choices ? { choices } : {}),
        ...(evidence ? { evidence } : {}),
      };
      const view = await answering.revise(revise, business);
      const feedback = renderSpecFeedback(view.specFeedback);
      return result(`[ANSWER_SPEC_REVISED] taskId=${view.taskId} revisionId=${view.revisionId}${feedback ? `\n${feedback}` : ""}\n${json(view)}`, view);
    },
  };
}

function queryTool(answering: Answering): AgentHarnessTool<DataAgentToolContext> {
  return {
    name: "query_database",
    label: "query_database",
    description: "Execute bounded exploration or one final result query. Result mode requires the current opaque revisionId and cannot be replaced by an exploration artifact.",
    replay: "safe",
    parameters: ANSWERING_QUERY_PARAMETERS,
    async execute(toolCallId, input, _onUpdate, toolContext, invocation, context) {
      void toolCallId;
      const value = checked(ANSWERING_QUERY_PARAMETERS, input) as QueryInput;
      const business = trustedContext(toolContext, invocation, context);
      try {
        const view = await answering.execute(value as ExecuteQuery, business);
        return result(queryText(view), view);
      } catch (error) {
        // An inner-loop obstacle is structured feedback for the main Agent,
        // not permission to mutate the Spec or publish anything. Preserve the
        // existing tool error path for non-Answering failures.
        if (error instanceof AnsweringError && error.obstacle) {
          return result(`[IMPLEMENTATION_OBSTACLE] ${error.obstacle.message}\n${json(error.obstacle)}`, { obstacle: error.obstacle, code: error.code });
        }
        throw error;
      }
    },
  };
}

export interface PublishedContentReader {
  resolve(publicationId: string, context: BusinessContext): Promise<{ readonly content: string }>;
}

export interface HypothesisComparisonToolOptions {
  readonly advisor: HypothesisChoiceAdvisor;
  readonly getOriginalQuestion: (requestMessageId?: string) => Promise<string>;
}

function hypothesisComparisonTool(options: HypothesisComparisonToolOptions): AgentHarnessTool<DataAgentToolContext> {
  return {
    name: "compare_hypotheses",
    label: "compare_hypotheses",
    description: "Ask the configured Jev advisor to compare competing hypotheses against the original user request and optional evidence. Pass the hypotheses you want compared and any supporting evidence as text. The result is advisory only: it never revises the Answer Spec or authorizes publication.",
    replay: "safe",
    parameters: HYPOTHESIS_COMPARISON_PARAMETERS,
    async execute(toolCallId, input, _onUpdate, toolContext, invocation, context) {
      void toolCallId;
      const value = checked(HYPOTHESIS_COMPARISON_PARAMETERS, input) as HypothesisComparisonInput;
      const originalQuestion = await options.getOriginalQuestion(toolContext?.requestMessageId);
      const evidence: HypothesisChoiceEvidence[] = [
        { id: "request", kind: "request_wording", authority: "request_wording", authorityRank: 3, sourceRef: "user_request", content: originalQuestion },
        ...(value.evidence ?? []).map((item, index) => ({
          id: `inline_${index}`,
          kind: "observation" as const,
          authority: "observation" as const,
          authorityRank: 5,
          sourceRef: item.sourceRef ?? `inline_${index}`,
          content: item.content.slice(0, 8_000),
        })),
      ];
      const signature = json({ hypotheses: value.hypotheses, evidence });
      const memo = fromMemoJson(await invocation.getMemo("answering.hypothesis-comparison"));
      if (memo && typeof memo === "object" && !Array.isArray(memo)) {
        const record = memo as Record<string, unknown>;
        if (record.signature !== signature) throw new Error("HYPOTHESIS_COMPARISON_INVOCATION_CONFLICT");
        if (record.assessment) {
          return result(`[HYPOTHESIS_COMPARISON_ADVISORY]\n${json(record.assessment)}\nThis recommendation is not evidence and may only inform a disclosed provisional choice unless the underlying evidence independently qualifies.`, record.assessment);
        }
      }
      const assessment = await options.advisor.compare({ originalQuestion, hypotheses: value.hypotheses, evidence }, { ...(context.abortSignal ? { signal: context.abortSignal } : {}) });
      await invocation.setMemo("answering.hypothesis-comparison", memoJson({ signature, assessment }));
      return result(`[HYPOTHESIS_COMPARISON_ADVISORY]\n${json(assessment)}\nThis recommendation is not evidence and may only inform a disclosed provisional choice unless the underlying evidence independently qualifies.`, assessment);
    },
  };
}

function publishTool(answering: Answering, contentReader: PublishedContentReader | undefined, name: "publish_query_result" | "export_query"): AgentHarnessTool<DataAgentToolContext> {
  return {
    name,
    label: name,
    description: "Publish the exact immutable candidate returned by query_database. This tool never executes SQL.",
    replay: "safe",
    parameters: ANSWERING_PUBLISH_PARAMETERS,
    async execute(toolCallId, input, _onUpdate, toolContext, invocation, context) {
      void toolCallId;
      const value = checked(ANSWERING_PUBLISH_PARAMETERS, input) as PublishInput;
      const business = trustedContext(toolContext, invocation, context);
      const view = await answering.publish({ candidateId: value.candidateId, format: value.format, requestId: invocation.invocationId } satisfies PublishCandidate, business);
      // A Receipt is the authorization handle. Large CSV/typed rows stay in
      // ResultStore and are never copied into the Pi tool settlement. Bounded
      // inline content is reread through the Receipt for user-visible display.
      const inline = view.format === "inline" && contentReader
        ? (await contentReader.resolve(view.receiptId, business)).content
        : undefined;
      const link = `[download](${view.publicRef})`;
      const disclosure = view.disclosure ? `\n[DISCLOSURE] ${view.disclosure.summary}` : "";
      return result(`[PUBLISHED] ${view.format} ${link}${disclosure}${inline ? `\n${inline}` : ""}`, view);
    },
  };
}

function inspectTool(answering: Answering): AgentHarnessTool<DataAgentToolContext> {
  return {
    name: "inspect_answer",
    label: "inspect_answer",
    description: "Inspect the read-only Answering projection for a Query Task.",
    replay: "safe",
    parameters: ANSWERING_INSPECT_PARAMETERS,
    async execute(toolCallId, input, _onUpdate, toolContext, invocation, context) {
      void toolCallId;
      const value = checked(ANSWERING_INSPECT_PARAMETERS, input) as InspectInput;
      const business = trustedContext(toolContext, invocation, context);
      const view = await answering.inspect(value as InspectAnswer, business);
      return result(json(view), view);
    },
  };
}

/**
 * Static model-tool registry for Answering. Inline and CSV delivery names
 * share one publish implementation and one authorization policy.
 */
export function createAnsweringAgentToolDefinitions(
  answering: Answering,
  contentReader?: PublishedContentReader,
  hypothesisComparison?: HypothesisComparisonToolOptions,
): readonly DataAgentToolDefinition<DataAgentToolContext>[] {
  return [
    defineDataAgentTool(updateTool(answering), {
      promptSnippet: "开始或修订唯一的七槽位 Answer Spec。",
      promptGuidelines: ["提交完整 Proposal 和当前不透明句柄；SpecFeedback 只提供核对信息，不能替代业务证据或静默改变口径。"],
    }),
    defineDataAgentTool(queryTool(answering), {
      promptSnippet: "执行有界探索或当前版本的一次结果查询。",
      promptGuidelines: ["探索产物不可发布；结果查询必须绑定当前 Ready Revision，遇到实现障碍先按分类修复或回到取证，不要盲目重跑未知结果。"],
    }),
    ...(hypothesisComparison ? [defineDataAgentTool(hypothesisComparisonTool(hypothesisComparison), {
      promptSnippet: "比较互斥假说并请求 Jev 提供建议。",
      promptGuidelines: ["提交全部竞争假说及相关依据；建议不是 Evidence 或 Resolution，不能单独解除未决总体选择。"],
    })] : []),
    defineDataAgentTool(publishTool(answering, contentReader, "publish_query_result"), {
      promptSnippet: "发布当前不可变 Candidate 的小结果。",
      promptGuidelines: ["只使用当前 Candidate；行数不超过 10 时使用 inline，不重跑 SQL，Publication Receipt 才授权读取。"],
    }),
    defineDataAgentTool(publishTool(answering, contentReader, "export_query"), {
      promptSnippet: "导出当前不可变 Candidate 的完整 CSV。",
      promptGuidelines: ["只使用当前 Candidate；完整结果超过 10 行时使用 csv，不从 Preview 拼接或重跑 SQL。"],
    }),
    defineDataAgentTool(inspectTool(answering), {
      promptSnippet: "读取 Query Task 的只读投影。",
      promptGuidelines: ["投影不是第二份可写状态；修改定义只能使用 Answering 修订流程。"],
    }),
  ];
}
