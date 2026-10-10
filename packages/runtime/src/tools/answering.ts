import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { JsonValue } from "@earendil-works/chord";
import type {
  AgentHarnessTool,
  AgentHarnessToolInvocation,
  AgentToolResult,
  Context,
} from "@earendil-works/pi-agent-core";
import { AnsweringError, FIELD_FORMS, FIELD_PATHS } from "../answering/public.js";
import { renderSpecFeedback } from "../answering/spec-feedback.js";
import { leanOf, type AdvisoryLedger, type FieldAdvisory } from "../answering/public.js";
import type {
  Answering,
  AnswerRevisionView,
  AnswerTaskView,
  BusinessContext,
  ExecuteQuery,
  FieldView,
  InspectAnswer,
  PublishCandidate,
} from "../answering/public.js";
import type {
  HypothesisChoiceAdvisor,
  HypothesisChoiceAssessment,
  HypothesisChoiceEvidence,
} from "../judgment/hypothesis-choice.js";
import { defineDataAgentTool, type DataAgentToolDefinition, type ToolPromptMetadata } from "./tool-definition.js";

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

/**
 * Experimental evaluation factor. `disabled` removes the model-authored
 * semantic envelope while preserving Query Task, Candidate and Receipt
 * identity. Product composition defaults to `required` and does not expose
 * this switch.
 */
export type SemanticSpecMode = "required" | "disabled";

export interface AnsweringToolOptions {
  readonly semanticSpecMode?: SemanticSpecMode;
}

const nonEmptyStringSchema = Type.String({ minLength: 1, pattern: "\\S" });

export const BEGIN_QUERY_TASK_PARAMETERS = Type.Object({}, { additionalProperties: false });

/** set_answer_spec: field writes are parsed and checked per path by Answering, so the schema stays open. */
export const SET_ANSWER_SPEC_PARAMETERS = Type.Object({
  taskId: Type.Optional(nonEmptyStringSchema),
  fields: Type.Record(Type.String({ minLength: 1 }), Type.Unknown()),
  /** ADR-0009: start a Report Task that holds the shared fields of a report or dashboard. */
  report: Type.Optional(Type.Boolean()),
  /** ADR-0009: start a chart query under this Report Task. */
  parentTaskId: Type.Optional(nonEmptyStringSchema),
  /** ADR-0009: copy the Report Task's current shared fields into this chart query again. */
  rebind: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export const ANSWERING_QUERY_PARAMETERS = Type.Union([
  Type.Object({
    kind: Type.Literal("exploration"),
    taskId: Type.String({ minLength: 1 }),
    sql: Type.String({ minLength: 1 }),
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
    probe: Type.Optional(Type.Object({
      path: Type.String({ minLength: 1 }),
      alternativeId: Type.String({ minLength: 1 }),
    }, { additionalProperties: false })),
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

/** Comparison is over one open field: its alternatives are read from the Answer Spec, never supplied by the model. */
export const HYPOTHESIS_COMPARISON_PARAMETERS = Type.Object({
  taskId: Type.String({ minLength: 1 }),
  path: Type.String({ minLength: 1 }),
  evidence: Type.Optional(Type.Array(Type.Object({
    content: Type.String({ minLength: 1 }),
    sourceRef: Type.Optional(Type.String({ minLength: 1 })),
  }, { additionalProperties: false }), { maxItems: 32 })),
}, { additionalProperties: false });

type SetAnswerSpecInput = Static<typeof SET_ANSWER_SPEC_PARAMETERS>;
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

export function trustedContext(
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
    ? `[EXPLORATION_EVIDENCE] evidenceId=${view.artifact.evidenceId}\nCite this evidenceId in a field's evidenceIds; do not resubmit the observation body.`
    : `[RESULT_CANDIDATE] candidateId=${view.artifact.candidateId} revisionId=${view.artifact.revisionId}`;
  const preview = `${view.preview.columns.join(" | ")}\n${view.preview.rows.map((row) => row.map((cell) => cell === null || cell === undefined ? "NULL" : String(cell)).join(" | ")).join("\n")}${view.preview.truncated ? "\n(truncated preview)" : ""}`;
  const fanout = fanoutText(view);
  const probe = view.probe
    ? `[PROBE] path=${view.probe.path} alternativeId=${view.probe.alternativeId} rows=${view.probe.rowCount} ${view.probe.state === "available" ? `output=${view.probe.output}` : `output unavailable: ${view.probe.reason}`}\nAlternatives of the same field with equal output ids produce the same answer.`
    : "";
  return `${artifact}${probe ? `\n${probe}` : ""}${fanout ? `\n${fanout}` : ""}\n${preview}`;
}

function beginQueryTaskTool(answering: Answering): AgentHarnessTool<DataAgentToolContext> {
  return {
    name: "begin_query_task",
    label: "begin_query_task",
    description: "Start an evaluation Query Task without a model-authored semantic Answer Spec. This preserves task, revision, candidate and publication identity for a semantic-spec ablation arm.",
    replay: "never",
    parameters: BEGIN_QUERY_TASK_PARAMETERS,
    async execute(toolCallId, input, _onUpdate, toolContext, invocation, context) {
      void toolCallId;
      checked(BEGIN_QUERY_TASK_PARAMETERS, input);
      const business = trustedContext(toolContext, invocation, context);
      const requestMessageId = toolContext?.requestMessageId?.trim();
      if (!requestMessageId) throw new Error("ANSWERING_REQUEST_MESSAGE_REQUIRED");
      const view = await answering.set({
        requestMessageId,
        // Stable across model retries or duplicate bootstrap calls so a second
        // invocation cannot mint a fresh Query Task budget.
        requestId: `semantic-spec-disabled:${requestMessageId}`,
        fields: {},
      }, business);
      return result(`[QUERY_TASK_STARTED] taskId=${view.taskId} revisionId=${view.revisionId}\n${json(view)}`, view);
    },
  };
}

function valueText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** One entry per alternative: its id, value and what its probe produced. */
function alternativesText(field: FieldView): string {
  return (field.alternatives ?? []).map((alternative) => {
    const probe = alternative.probe;
    const output = probe?.state === "available" ? ` output=${probe.output}` : probe ? ` ${probe.state}` : "";
    return `${alternative.id}=${valueText(alternative.value)}${output}`;
  }).join("; ");
}

/**
 * What still needs attention after a call (ADR-0007 decision 5): open fields
 * with their probe handles, unverified fields, and required fields not yet set.
 */
export function fieldStateTable(view: AnswerRevisionView): string {
  const lines: string[] = [];
  const report = view.role === "report";
  if (report) lines.push("- 报告任务：只设共享字段（population.* 与 measures.<名字>），本身不出结果；每张图用 parentTaskId 建一个图表查询");
  if (view.parent) {
    lines.push(`- 报告任务 ${view.parent.taskId}：继承自 ${view.parent.revisionId}${view.parent.current ? "" : "；报告任务已修改，先用 rebind: true 重新绑定"}`);
    if (view.measureRef) lines.push(`- 度量取自报告任务的 measures.${view.measureRef}`);
    if (view.deviations && view.deviations.length > 0) lines.push(`- 偏离共享口径（发布时披露）: ${view.deviations.map((item) => `${item.path}（${item.reason}）`).join("；")}`);
  }
  const open = new Set<string>(view.open);
  for (const field of view.fields) {
    if (open.has(field.path)) lines.push(`- 待定 ${field.path}: ${alternativesText(field)}${field.outputs ? `; outputs=${field.outputs}` : ""}`);
    if (field.status === "equivalent") lines.push(`- 等价 ${field.path}: 各候选输出相同，无需决定`);
  }
  if (view.unverified.length > 0) lines.push(`- 未证实（发布时披露）: ${view.unverified.join(", ")}`);
  if (view.undeclared.length > 0) lines.push(`- 未声明: ${view.undeclared.join(", ")}`);
  if (view.open.length === 0 && view.undeclared.length === 0) lines.push(report ? "- 共享字段已处理，图表查询可以执行结果查询" : "- 没有待处理的字段，可以执行结果查询");
  return lines.join("\n");
}

/** Field states in compact form for the model: status, value and alternatives. */
function fieldsJson(view: AnswerRevisionView): string {
  return json(Object.fromEntries(view.fields.map((field) => [field.path, {
    status: field.status,
    ...(field.value !== undefined ? { value: field.value } : {}),
    ...(field.verified !== undefined ? { verified: field.verified } : {}),
    ...(field.alternatives && field.status !== "decided" ? { alternatives: field.alternatives.map((item) => ({ id: item.id, value: item.value })) } : {}),
  }])));
}

/**
 * The single ADR-0007 write: each path is checked and applied on its own;
 * the call lands as one Revision.
 */
function setSpecTool(answering: Answering): AgentHarnessTool<DataAgentToolContext> {
  return {
    name: "set_answer_spec",
    label: "set_answer_spec",
    description: `Set Answer Spec fields by path. Without taskId the call starts the Query Task. Paths: ${FIELD_PATHS.join(", ")}, and measures.<name> on a Report Task. Each path is checked and applied on its own; the result lists every path's outcome and what is still open, unverified or undeclared.`,
    replay: "never",
    parameters: SET_ANSWER_SPEC_PARAMETERS,
    async execute(toolCallId, input, _onUpdate, toolContext, invocation, context) {
      void toolCallId;
      const value = checked(SET_ANSWER_SPEC_PARAMETERS, input) as SetAnswerSpecInput;
      if (value.taskId && (value.report || value.parentTaskId)) throw new Error("ANSWERING_TOOL_INPUT_INVALID: report and parentTaskId only start a task; omit taskId");
      if (!value.taskId && value.rebind) throw new Error("ANSWERING_TOOL_INPUT_INVALID: rebind needs the chart query's taskId");
      if (Object.keys(value.fields).length === 0 && !value.rebind) throw new Error("ANSWERING_TOOL_INPUT_INVALID: fields must set at least one path");
      const business = trustedContext(toolContext, invocation, context);
      // Request and current message identities come from the trusted Session Host, never from model arguments.
      const requestMessageId = toolContext?.requestMessageId?.trim();
      if (!value.taskId && !requestMessageId) throw new Error("ANSWERING_REQUEST_MESSAGE_REQUIRED");
      const before = value.taskId ? await answering.inspect({ taskId: value.taskId }, business) : undefined;
      const view = await answering.set({
        ...(value.taskId ? { taskId: value.taskId } : { requestMessageId: requestMessageId! }),
        ...(requestMessageId ? { currentMessageId: requestMessageId } : {}),
        requestId: invocation.invocationId,
        fields: value.fields,
        ...(value.report ? { report: true } : {}),
        ...(value.parentTaskId ? { parent: { taskId: value.parentTaskId } } : {}),
        ...(value.rebind ? { rebind: true } : {}),
      }, business);
      const lines = (view.outcomes ?? []).map((outcome) => outcome.status === "applied" ? `- ✓ ${outcome.path}` : `- ✗ ${outcome.path}: ${outcome.message ?? "not applied"}`);
      const rejected = (view.outcomes ?? []).some((outcome) => outcome.status === "rejected");
      const stale = before && view.revisionId !== before.task.currentRevisionId && before.candidate && before.publication?.candidateId !== before.candidate.candidateId
        ? [`- 失效: 上一版的结果候选 ${before.candidate.candidateId} 未发布，已不能发布`]
        : [];
      const feedback = renderSpecFeedback(view.specFeedback);
      const changed = !before || view.revisionId !== before.task.currentRevisionId;
      return result([
        `[${changed ? "ANSWER_SPEC_SET" : "ANSWER_SPEC_UNCHANGED"}] taskId=${view.taskId} revisionId=${view.revisionId}`,
        ...lines,
        ...(rejected ? [`字段写法：${FIELD_FORMS}`] : []),
        "状态：",
        fieldStateTable(view),
        ...stale,
        ...(feedback ? [feedback] : []),
        fieldsJson(view),
      ].join("\n"), view);
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
  /** Trusted record of advice per open field; Answering reads it when the field is decided (ADR-0005). */
  readonly ledger?: AdvisoryLedger;
}

const ADVISORY_NOTE = "This recommendation is not evidence. Deciding against a clear lean requires adviceOverride with a reason and evidence ids.";

type OpenField = Extract<AnswerTaskView["currentRevision"]["fields"][keyof AnswerTaskView["currentRevision"]["fields"]], { alternatives: unknown }>;

/** Probe outputs the Runtime already holds, stated so the advisor can see which alternatives actually differ. */
function probeEvidence(task: AnswerTaskView, path: string, field: OpenField): HypothesisChoiceEvidence[] {
  const probes = (task.task.fieldProbes ?? []).filter((probe) => probe.path === path);
  if (probes.length === 0) return [];
  const labels = new Map(field.alternatives.map((alternative, index) => [alternative.id as string, `alternative ${index + 1}`]));
  const outputs = new Map<string, string[]>();
  for (const probe of probes) {
    if (probe.outcome.state !== "available") continue;
    outputs.set(probe.outcome.fingerprint, [...(outputs.get(probe.outcome.fingerprint) ?? []), labels.get(probe.alternativeId) ?? probe.alternativeId]);
  }
  const lines = probes.map((probe) => `${labels.get(probe.alternativeId) ?? probe.alternativeId}: ${probe.rowCount} output rows${probe.outcome.state === "available" ? "" : ` (output not comparable: ${probe.outcome.reason})`}`);
  const same = [...outputs.values()].filter((group) => group.length > 1).map((group) => `${group.join(" and ")} produce identical output`);
  return [{ id: "probe_outputs", kind: "observation", authority: "observation", authorityRank: 5, sourceRef: "field_probes", content: [...lines, ...same].join("\n") }];
}

function hypothesisComparisonTool(answering: Answering, options: HypothesisComparisonToolOptions): AgentHarnessTool<DataAgentToolContext> {
  return {
    name: "compare_hypotheses",
    label: "compare_hypotheses",
    description: "Ask the configured Jev advisor to compare the alternatives of one open Answer Spec field against the original request, recorded probe outputs and optional evidence. The advice is recorded for that field; it never revises the Answer Spec or authorizes publication.",
    replay: "safe",
    parameters: HYPOTHESIS_COMPARISON_PARAMETERS,
    async execute(toolCallId, input, _onUpdate, toolContext, invocation, context) {
      void toolCallId;
      const value = checked(HYPOTHESIS_COMPARISON_PARAMETERS, input) as HypothesisComparisonInput;
      const business = trustedContext(toolContext, invocation, context);
      const task = await answering.inspect({ taskId: value.taskId }, business);
      const field = task.currentRevision.fields[value.path as keyof typeof task.currentRevision.fields];
      if (!field || field.state !== "open") throw new AnsweringError("INVALID_REQUEST", `${value.path} is not an open field of the current Revision; compare the alternatives of an open field`);
      const originalQuestion = await options.getOriginalQuestion(toolContext?.requestMessageId);
      const hypotheses = field.alternatives.map((alternative) => ({ id: alternative.id as string, statement: `${value.path}: ${valueText(alternative.value)}` }));
      const evidence: HypothesisChoiceEvidence[] = [
        { id: "request", kind: "request_wording", authority: "request_wording", authorityRank: 3, sourceRef: "user_request", content: originalQuestion },
        ...probeEvidence(task, value.path, field),
        ...(value.evidence ?? []).map((item, index) => ({
          id: `inline_${index}`,
          kind: "observation" as const,
          authority: "observation" as const,
          authorityRank: 5,
          sourceRef: item.sourceRef ?? `inline_${index}`,
          content: item.content.slice(0, 8_000),
        })),
      ];
      const signature = json({ taskId: value.taskId, path: value.path, hypotheses, evidence });
      const memo = fromMemoJson(await invocation.getMemo("answering.hypothesis-comparison"));
      if (memo && typeof memo === "object" && !Array.isArray(memo)) {
        const record = memo as Record<string, unknown>;
        if (record.signature !== signature) throw new Error("HYPOTHESIS_COMPARISON_INVOCATION_CONFLICT");
        if (record.advisory && record.assessment) {
          // A replay returns and re-records the same advice.
          const replayed = record.advisory as FieldAdvisory;
          options.ledger?.record(replayed);
          return comparisonResult(replayed, record.assessment as HypothesisChoiceAssessment);
        }
      }
      const assessment = await options.advisor.compare({ originalQuestion, hypotheses, evidence }, { ...(context.abortSignal ? { signal: context.abortSignal } : {}) });
      const probabilities = assessment.probabilities.map((item) => ({ alternativeId: item.hypothesisId, probability: item.probability }));
      const recommendedAlternativeId = assessment.recommendation.kind === "hypothesis" ? assessment.recommendation.hypothesisId : undefined;
      const lean = leanOf(probabilities, recommendedAlternativeId);
      const advisory: FieldAdvisory = {
        taskId: value.taskId,
        path: value.path,
        alternativeIds: field.alternatives.map((alternative) => alternative.id as string),
        model: assessment.model,
        probabilities,
        recommendation: assessment.recommendation.kind === "hypothesis" ? "alternative" : assessment.recommendation.kind,
        ...(recommendedAlternativeId ? { recommendedAlternativeId } : {}),
        ...(lean ? { lean } : {}),
        recordedAt: new Date().toISOString(),
      };
      await invocation.setMemo("answering.hypothesis-comparison", memoJson({ signature, assessment, advisory }));
      options.ledger?.record(advisory);
      return comparisonResult(advisory, assessment);
    },
  };
}

function comparisonResult(advisory: FieldAdvisory, assessment: HypothesisChoiceAssessment): AgentToolResult<unknown> {
  const lean = advisory.lean ? `\n[ADVICE_LEAN] alternativeId=${advisory.lean.alternativeId} probability=${advisory.lean.probability}` : "\n[ADVICE_LEAN] none";
  return result(`[HYPOTHESIS_COMPARISON_ADVISORY] path=${advisory.path}${lean}\n${json(assessment)}\n${ADVISORY_NOTE}`, { ...advisory, assessment });
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
      // receiptId is the Dataset Reference charts cite; it must not have to be parsed out of the link.
      return result(`[PUBLISHED] ${view.format} ${link} receiptId=${view.receiptId}${disclosure}${inline ? `\n${inline}` : ""}`, view);
    },
  };
}

/** The Physical Profile serves chart compilation, not the model; keep it out of model-visible text. */
function modelVisibleTaskView(view: AnswerTaskView): AnswerTaskView {
  if (!view.publication?.physicalProfile) return view;
  const { physicalProfile: _profile, ...publication } = view.publication;
  return { ...view, publication };
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
      return result(json(modelVisibleTaskView(view)), view);
    },
  };
}

/**
 * An Answering protocol tool. Pinned: the protocol can require any of them at
 * any step (compare_hypotheses before a decision, inspect_answer to recover
 * ids), so a Skill's tool allowlist must not hide them.
 */
function protocolTool(tool: AgentHarnessTool<DataAgentToolContext>, metadata: ToolPromptMetadata): DataAgentToolDefinition<DataAgentToolContext> {
  return defineDataAgentTool(tool, metadata, { pinned: true });
}

/**
 * Static model-tool registry for Answering. Inline and CSV delivery names
 * share one publish implementation and one authorization policy.
 */
export function createAnsweringAgentToolDefinitions(
  answering: Answering,
  contentReader?: PublishedContentReader,
  hypothesisComparison?: HypothesisComparisonToolOptions,
  options: AnsweringToolOptions = {},
): readonly DataAgentToolDefinition<DataAgentToolContext>[] {
  const semanticSpecMode = options.semanticSpecMode ?? "required";
  return [
    ...(semanticSpecMode === "required" ? [protocolTool(setSpecTool(answering), {
      promptSnippet: "按字段路径设置当前请求的 Answer Spec；不带 taskId 时开始任务。",
      promptGuidelines: [
        "字段写法：\"n/a\"；直接写值（视为假定，发布时披露）；{value, basis:\"request\", quote}（原题逐字片段）；{value, cite:[{source, quote}]}（source 为 knowledge:<id>、schema:<表.列>、clarification:<id> 或 message）；{value, evidenceIds}（query_database 返回的观测证据）；{value, basis:\"assumed\", rationale}；{open:[候选,…]}。",
        "必须声明：population.entity、population.eligibility、population.conditions、population.time、measure.formula、grouping、selection、output（不适用写 \"n/a\"）；measure.formula 的 op 为计数、平均、比率类时还要 measure.countGrain，平均与比率类要 measure.denominator，cumulative/rolling 要 measure.window；selection 不是 n/a 时要 selection.ties；population.source 有多张表时要 population.joinMultiplicity。返回的「未声明」列出还缺的字段。",
        "measure.formula 是逐层表达式 {op, per?, of | numerator+denominator | from+to}；嵌套顺序就是聚合顺序，多于一层时每个内层都写 per（最外层按 grouping 计算，可省略）。op 取 count、count_distinct、sum、avg、median、min、max、ratio、percentage、difference、change_rate、pp_difference、cumulative、rolling；以上都不适用时用 custom 并写 description。",
        "待定字段先用 query_database 的 probe={path, alternativeId} 跑每个候选（alternativeId 见返回的状态表），无法单独执行的候选写 {notProbeable:{<alternativeId>: 理由}}；输出全部相同时系统视为等价；不同时调用 compare_hypotheses，再写 {value:<候选原值>, rationale, evidenceIds?} 决定。",
        "改写已设置的字段须附 reason；每个路径独立生效，失败的路径不影响其他路径，按返回的 ✗ 原因只重发失败的路径。",
        "报告和看板：先用 report: true 建一个报告任务，写共享的 population.* 和各度量定义 measures.<名字>（value 为 {formula, countGrain?, denominator?, window?}）；再为每张图用 parentTaskId 建图表查询，写 measure.formula: {ref:\"<名字>\"}、grouping、selection、output 等。图表查询改 population.* 须附 reason（记为偏离并披露）；报告任务修改后，图表查询先 rebind: true 再查询。",
      ],
    })] : []),
    ...(semanticSpecMode === "disabled" ? [protocolTool(beginQueryTaskTool(answering), {
      promptSnippet: "为语义规格消融实验创建一个不含模型字段定义的 Query Task。",
      promptGuidelines: ["每个问题只调用一次；精确复用返回的 taskId/revisionId，仍须区分 exploration 与 result，并通过 Candidate/Receipt 发布。"],
    })] : []),
    protocolTool(queryTool(answering), {
      promptSnippet: "执行有界探索或当前版本的一次结果查询。",
      promptGuidelines: ["探索产物不可发布；结果查询必须绑定当前 Ready Revision，遇到实现障碍先按分类修复或回到取证，不要盲目重跑未知结果。", "探针：exploration 加 probe={path, alternativeId}，SQL 按该候选口径计算最终输出；输出标识相同表示答案相同。探针不占探索次数。", "结果与未采纳候选的探针输出相同时会被 DECISION_NOT_REALIZED 拒绝：改 SQL 实现已采纳的候选，或附 reason 改写该字段。"],
    }),
    ...(hypothesisComparison ? [protocolTool(hypothesisComparisonTool(answering, hypothesisComparison), {
      promptSnippet: "请求 Jev 比较一个待定字段的全部候选。",
      promptGuidelines: ["传入 taskId 和 path，候选由系统从 Answer Spec 读取；先给每个候选做探针，输出全部相同的字段由系统视为等价，无需比较或决定。建议不是 Evidence，不能单独决定字段；决定偏离建议的明显倾向时，须附 adviceOverride（理由与证据）。"],
    })] : []),
    protocolTool(publishTool(answering, contentReader, "publish_query_result"), {
      promptSnippet: "发布当前不可变 Candidate 的小结果。",
      promptGuidelines: ["只使用当前 Candidate；行数不超过 10 时使用 inline，不重跑 SQL，Publication Receipt 才授权读取。"],
    }),
    protocolTool(publishTool(answering, contentReader, "export_query"), {
      promptSnippet: "导出当前不可变 Candidate 的完整 CSV。",
      promptGuidelines: ["只使用当前 Candidate；完整结果超过 10 行时使用 csv，不从 Preview 拼接或重跑 SQL。"],
    }),
    protocolTool(inspectTool(answering), {
      promptSnippet: "读取 Query Task 的只读投影。",
      promptGuidelines: ["投影不是第二份可写状态；修改定义只能使用 set_answer_spec。"],
    }),
  ];
}
