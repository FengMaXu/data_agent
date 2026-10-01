import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { JsonValue } from "@earendil-works/chord";
import type {
  AgentHarnessTool,
  AgentHarnessToolInvocation,
  AgentToolResult,
  Context,
} from "@earendil-works/pi-agent-core";
import { AnsweringError, CLARIFICATION_SOURCE_PREFIX } from "../answering/public.js";
import { renderSpecFeedback } from "../answering/spec-feedback.js";
import { leanOf, type AdvisoryLedger, type ChoiceAdvisory } from "../answering/public.js";
import type {
  Answering,
  AnswerSpecProposal,
  AnswerTaskView,
  BeginAnswer,
  BusinessContext,
  ChoiceProposal,
  DispositionProposal,
  ExecuteQuery,
  HypothesisProposal,
  InspectAnswer,
  PublishCandidate,
  ReviseAnswer,
  UntrustedEvidenceInput,
} from "../answering/public.js";
import { DECISION_POINTS, isFacetName, isHypothesisKind, isEvidenceKind } from "../answering/public.js";
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
      evidenceIds: Type.Optional(Type.Array(nonEmptyStringSchema, { minItems: 1 })),
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

/**
 * Model-proposed evidence. Runtime admits it only after verifying the quote in
 * a trusted source; the model never chooses which message a request or user
 * quote is checked against.
 */
const evidenceSchema = Type.Object({
  localId: Type.Optional(nonEmptyStringSchema),
  kind: modelEvidenceKindSchema,
  /**
   * Document kinds: knowledgeId. schema_fact: schema reference. user_confirmation:
   * the clarificationId of an answered ask_user_clarification, or omitted for the
   * user's current message. Ignored for request_wording.
   */
  sourceRef: Type.Optional(nonEmptyStringSchema),
  quote: Type.Optional(nonEmptyStringSchema),
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
  decidedAlternativeId: Type.Optional(Type.String({ minLength: 1 })),
  decisionRationale: Type.Optional(nonEmptyStringSchema),
  decisionEvidenceIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
}, { additionalProperties: false });

const evidenceRefsSchema = Type.Array(nonEmptyStringSchema, { minItems: 1 });

const adviceOverrideSchema = Type.Object({
  reason: nonEmptyStringSchema,
  evidenceIds: Type.Array(nonEmptyStringSchema, { minItems: 1 }),
}, { additionalProperties: false });

/** Model-facing dispositions; the domain keeps select/provisional only for legacy callers (ADR-0006). */
const dispositionSchema = Type.Union([
  Type.Object({
    action: Type.Union([Type.Literal("support"), Type.Literal("refute")]),
    hypothesisId: nonEmptyStringSchema,
    evidenceIds: evidenceRefsSchema,
  }, { additionalProperties: false }),
  Type.Object({
    action: Type.Literal("decide"),
    choiceId: nonEmptyStringSchema,
    alternativeId: nonEmptyStringSchema,
    rationale: nonEmptyStringSchema,
    evidenceIds: Type.Optional(Type.Array(nonEmptyStringSchema)),
    adviceOverride: Type.Optional(adviceOverrideSchema),
  }, { additionalProperties: false }),
  Type.Object({
    action: Type.Literal("equivalent"),
    choiceId: nonEmptyStringSchema,
  }, { additionalProperties: false }),
  Type.Object({
    action: Type.Literal("supersede"),
    targetId: nonEmptyStringSchema,
    replacementIds: Type.Array(nonEmptyStringSchema, { minItems: 1 }),
    reason: nonEmptyStringSchema,
  }, { additionalProperties: false }),
]);

const decisionPointSchema = Type.Object({
  name: Type.Union([
    Type.Literal("population"),
    Type.Literal("join_multiplicity"),
    Type.Literal("time_field"),
    Type.Literal("count_grain"),
    Type.Literal("denominator"),
    Type.Literal("window"),
    Type.Literal("ties"),
    Type.Literal("output_shape"),
  ]),
  status: Type.Union([Type.Literal("fixed_by_request"), Type.Literal("not_applicable"), Type.Literal("choice"), Type.Literal("assumed")]),
  quote: Type.Optional(nonEmptyStringSchema),
  choiceId: Type.Optional(nonEmptyStringSchema),
  hypothesisId: Type.Optional(nonEmptyStringSchema),
  observationEvidenceIds: Type.Optional(Type.Array(nonEmptyStringSchema)),
}, { additionalProperties: false });

const probeWaiverSchema = Type.Object({
  choiceId: nonEmptyStringSchema,
  alternativeId: nonEmptyStringSchema,
  reason: nonEmptyStringSchema,
}, { additionalProperties: false });

/** begin_answer_spec: one shape, no `kind`; the domain use case is begin. */
export const BEGIN_ANSWER_SPEC_PARAMETERS = Type.Object({
  spec: proposalSchema,
  hypotheses: Type.Optional(Type.Array(hypothesisSchema)),
  choices: Type.Optional(Type.Array(choiceSchema)),
  notProbeable: Type.Optional(Type.Array(probeWaiverSchema)),
  decisionPoints: Type.Optional(Type.Array(decisionPointSchema)),
  evidence: Type.Optional(Type.Array(evidenceSchema)),
}, { additionalProperties: false });

/**
 * revise_answer_spec: a delta against the current Revision. Facets not listed
 * and existing items carry forward; items change only through dispositions.
 */
export const REVISE_ANSWER_SPEC_PARAMETERS = Type.Object({
  taskId: Type.String({ minLength: 1 }),
  baseRevisionId: Type.String({ minLength: 1 }),
  spec: Type.Optional(proposalSchema),
  addHypotheses: Type.Optional(Type.Array(hypothesisSchema)),
  addChoices: Type.Optional(Type.Array(choiceSchema)),
  dispositions: Type.Optional(Type.Array(dispositionSchema)),
  notProbeable: Type.Optional(Type.Array(probeWaiverSchema)),
  decisionPoints: Type.Optional(Type.Array(decisionPointSchema)),
  evidence: Type.Optional(Type.Array(evidenceSchema)),
}, { additionalProperties: false });

const FACET_NAMES = ["entity", "metric", "filters", "groupBy", "time", "ranking", "output"] as const;
const SPEC_FACETS = new Set<string>(FACET_NAMES);
const HYPOTHESIS_KINDS = ["business_semantics", "physical_mapping", "data_property"] as const;
const MODEL_EVIDENCE_KINDS = ["user_confirmation", "reviewed_definition", "task_document", "request_wording", "schema_fact"] as const;
const DECISION_POINT_STATUSES = ["fixed_by_request", "not_applicable", "choice", "assumed"] as const;
const DISPOSITION_ACTIONS = ["support", "refute", "decide", "equivalent", "supersede"] as const;

/** Where a misplaced name does belong: the most common slip is crossing the facet and decision-point vocabularies. */
function vocabularyHint(value: string): string {
  if ((DECISION_POINTS as readonly string[]).includes(value)) return ` "${value}" is a decision point name; declare it under decisionPoints.`;
  if (SPEC_FACETS.has(value)) return ` "${value}" is a facet name; facets go in spec or affects.`;
  if (value === "query_observation") return " query_observation is registered by query_database; cite its returned evidenceId instead.";
  return "";
}

function checkName(value: unknown, allowed: readonly string[], path: string, problems: string[]): void {
  if (typeof value !== "string" || allowed.includes(value)) return;
  problems.push(`${path} = ${JSON.stringify(value)}: use one of ${allowed.join(", ")}.${vocabularyHint(value)}`);
}

function eachItem(value: unknown, visit: (item: Record<string, unknown>, index: number) => void): void {
  if (!Array.isArray(value)) return;
  value.forEach((item, index) => { if (item && typeof item === "object" && !Array.isArray(item)) visit(item as Record<string, unknown>, index); });
}

function eachName(value: unknown, allowed: readonly string[], path: string, problems: string[]): void {
  if (Array.isArray(value)) value.forEach((item, index) => checkName(item, allowed, `${path}[${index}]`, problems));
}

/**
 * The names the model writes come from four fixed vocabularies. A schema
 * union reports "must be equal to constant" once per allowed value; this
 * check names the field, lists the allowed values and says where a
 * misplaced name belongs, collecting every problem in one message.
 */
function assertVocabulary(args: Record<string, unknown>): void {
  const problems: string[] = [];
  for (const key of ["hypotheses", "addHypotheses"]) {
    eachItem(args[key], (item, index) => {
      checkName(item.kind, HYPOTHESIS_KINDS, `${key}[${index}].kind`, problems);
      eachName(item.affects, FACET_NAMES, `${key}[${index}].affects`, problems);
    });
  }
  for (const key of ["choices", "addChoices"]) {
    eachItem(args[key], (item, index) => eachName(item.affects, FACET_NAMES, `${key}[${index}].affects`, problems));
  }
  eachItem(args.decisionPoints, (item, index) => {
    checkName(item.name, DECISION_POINTS, `decisionPoints[${index}].name`, problems);
    checkName(item.status, DECISION_POINT_STATUSES, `decisionPoints[${index}].status`, problems);
  });
  eachItem(args.evidence, (item, index) => checkName(item.kind, MODEL_EVIDENCE_KINDS, `evidence[${index}].kind`, problems));
  eachItem(args.dispositions, (item, index) => checkName(item.action, DISPOSITION_ACTIONS, `dispositions[${index}].action`, problems));
  if (problems.length > 0) throw new Error(`INVALID_NAME: fix every listed field and resend the call.\n${problems.map((problem) => ` - ${problem}`).join("\n")}`);
}

/**
 * Repairs structural slips before Pi validates arguments: top-level fields
 * nested inside `spec` are lifted, a single filter/groupBy entry is wrapped in
 * an array, and a stray `kind` is dropped. Values are never changed; a name
 * outside its vocabulary is rejected here with the allowed values.
 */
export function prepareSpecArguments(topLevel: readonly string[]): (args: unknown) => any {
  return (args) => {
    if (!args || typeof args !== "object" || Array.isArray(args)) return args;
    const next: Record<string, unknown> = { ...(args as Record<string, unknown>) };
    delete next.kind;
    const spec = next.spec;
    if (spec && typeof spec === "object" && !Array.isArray(spec)) {
      const facets: Record<string, unknown> = { ...(spec as Record<string, unknown>) };
      for (const key of Object.keys(facets)) {
        if (SPEC_FACETS.has(key) || !topLevel.includes(key) || key in next) continue;
        next[key] = facets[key];
        delete facets[key];
      }
      for (const key of ["filters", "groupBy"]) {
        const value = facets[key];
        if (value !== undefined && value !== null && !Array.isArray(value)) facets[key] = [value];
      }
      next.spec = facets;
    }
    assertVocabulary(next);
    return next;
  };
}

export const BEGIN_QUERY_TASK_PARAMETERS = Type.Object({}, { additionalProperties: false });

export const ANSWERING_QUERY_PARAMETERS = Type.Union([
  Type.Object({
    kind: Type.Literal("exploration"),
    taskId: Type.String({ minLength: 1 }),
    sql: Type.String({ minLength: 1 }),
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
    probe: Type.Optional(Type.Object({
      choiceId: Type.String({ minLength: 1 }),
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

/** Comparison is over one Choice: its alternatives are read from the Answer Spec, never supplied by the model. */
export const HYPOTHESIS_COMPARISON_PARAMETERS = Type.Object({
  taskId: Type.String({ minLength: 1 }),
  choiceId: Type.String({ minLength: 1 }),
  evidence: Type.Optional(Type.Array(Type.Object({
    content: Type.String({ minLength: 1 }),
    sourceRef: Type.Optional(Type.String({ minLength: 1 })),
  }, { additionalProperties: false }), { maxItems: 32 })),
}, { additionalProperties: false });

type BeginAnswerSpecInput = Static<typeof BEGIN_ANSWER_SPEC_PARAMETERS>;
type ReviseAnswerSpecInput = Static<typeof REVISE_ANSWER_SPEC_PARAMETERS>;
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

/**
 * The tool layer is the trust boundary for message identity: a user
 * confirmation is always bound to the Host-supplied user message of the
 * current operation, and request wording is bound by Answering to the task's
 * original request. Model-supplied sourceRefs for either are discarded.
 */
/**
 * Where a user_confirmation was said: the clarification answer the model names
 * by id, or the Host's current user message. Admission verifies either against
 * text the Host recorded; the model only points.
 */
function confirmationSource(named: string | undefined, currentUserMessageId: string | undefined): string | undefined {
  const clarificationId = named?.trim().replace(CLARIFICATION_SOURCE_PREFIX, "");
  return clarificationId ? `${CLARIFICATION_SOURCE_PREFIX}${clarificationId}` : currentUserMessageId;
}

function proposalEvidence(
  value: readonly { readonly localId?: string; readonly kind: string; readonly sourceRef?: string; readonly quote?: string }[] | undefined,
  currentUserMessageId: string | undefined,
): readonly UntrustedEvidenceInput[] | undefined {
  if (!value) return undefined;
  return value.map((item) => {
    if (!isEvidenceKind(item.kind) || item.kind === "query_observation") throw new Error("ANSWERING_TOOL_INPUT_INVALID");
    const sourceRef = item.kind === "user_confirmation"
      ? confirmationSource(item.sourceRef, currentUserMessageId)
      : item.kind === "request_wording" ? undefined : item.sourceRef;
    if (item.kind === "user_confirmation" && !sourceRef) throw new Error("ANSWERING_USER_MESSAGE_REQUIRED");
    return {
      ...(item.localId ? { localId: item.localId } : {}),
      kind: item.kind,
      ...(sourceRef ? { sourceRef } : {}),
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

function proposalDispositions(value: readonly Static<typeof dispositionSchema>[] | undefined): readonly DispositionProposal[] | undefined {
  return value ? value.map((item) => item as DispositionProposal) : undefined;
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
  const probe = view.probe
    ? `[CHOICE_PROBE] choiceId=${view.probe.choiceId} alternativeId=${view.probe.alternativeId} rows=${view.probe.rowCount} ${view.probe.state === "available" ? `output=${view.probe.output}` : `output unavailable: ${view.probe.reason}`}\nAlternatives of the same Choice with equal output ids produce the same answer.`
    : "";
  return `${artifact}${probe ? `\n${probe}` : ""}${fanout ? `\n${fanout}` : ""}\n${preview}`;
}

const SEMANTIC_SPEC_DISABLED_PROPOSAL: AnswerSpecProposal = {};

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
      const view = await answering.begin({
        requestMessageId,
        // Stable across model retries or duplicate bootstrap calls so a second
        // invocation cannot mint a fresh Query Task budget.
        requestId: `semantic-spec-disabled:${requestMessageId}`,
        spec: SEMANTIC_SPEC_DISABLED_PROPOSAL,
      }, business);
      return result(`[QUERY_TASK_STARTED] taskId=${view.taskId} revisionId=${view.revisionId}\n${json(view)}`, view);
    },
  };
}

function beginSpecTool(answering: Answering): AgentHarnessTool<DataAgentToolContext> {
  return {
    name: "begin_answer_spec",
    label: "begin_answer_spec",
    description: "Begin the one canonical seven-facet Answer Spec for the current request: facets, hypotheses, choices, evidence and the eight decision points. Only opaque handles returned by this tool may be reused.",
    replay: "never",
    parameters: BEGIN_ANSWER_SPEC_PARAMETERS,
    prepareArguments: prepareSpecArguments(["hypotheses", "choices", "notProbeable", "decisionPoints", "evidence"]),
    async execute(toolCallId, input, _onUpdate, toolContext, invocation, context) {
      void toolCallId;
      const value = checked(BEGIN_ANSWER_SPEC_PARAMETERS, input) as BeginAnswerSpecInput;
      const business = trustedContext(toolContext, invocation, context);
      // requestMessageId comes from the trusted Session Host tool context, never from model arguments.
      const requestMessageId = toolContext?.requestMessageId?.trim();
      if (!requestMessageId) throw new Error("ANSWERING_REQUEST_MESSAGE_REQUIRED");
      const hypotheses = proposalHypotheses(value.hypotheses);
      const choices = proposalChoices(value.choices);
      const evidence = proposalEvidence(value.evidence, requestMessageId);
      const begin: BeginAnswer = {
        requestMessageId,
        requestId: invocation.invocationId,
        spec: value.spec as AnswerSpecProposal,
        ...(hypotheses ? { hypotheses } : {}),
        ...(choices ? { choices } : {}),
        ...(value.notProbeable ? { notProbeable: value.notProbeable } : {}),
        ...(value.decisionPoints ? { decisionPoints: value.decisionPoints } : {}),
        ...(evidence ? { evidence } : {}),
      };
      const view = await answering.begin(begin, business);
      const feedback = renderSpecFeedback(view.specFeedback);
      return result(`[ANSWER_SPEC_STARTED] taskId=${view.taskId} revisionId=${view.revisionId}${feedback ? `\n${feedback}` : ""}\n${json(view)}`, view);
    },
  };
}

function reviseSpecTool(answering: Answering): AgentHarnessTool<DataAgentToolContext> {
  return {
    name: "revise_answer_spec",
    label: "revise_answer_spec",
    description: "Revise the current Answer Spec with a delta: a facet patch, new hypotheses/choices, decision points, and dispositions of existing items by their returned ids (support/refute a hypothesis; decide or mark equivalent a Choice; supersede an item). Omitted facets and items carry forward.",
    replay: "never",
    parameters: REVISE_ANSWER_SPEC_PARAMETERS,
    prepareArguments: prepareSpecArguments(["addHypotheses", "addChoices", "dispositions", "notProbeable", "decisionPoints", "evidence"]),
    async execute(toolCallId, input, _onUpdate, toolContext, invocation, context) {
      void toolCallId;
      const value = checked(REVISE_ANSWER_SPEC_PARAMETERS, input) as ReviseAnswerSpecInput;
      const business = trustedContext(toolContext, invocation, context);
      const addHypotheses = proposalHypotheses(value.addHypotheses);
      const addChoices = proposalChoices(value.addChoices);
      const dispositions = proposalDispositions(value.dispositions);
      const evidence = proposalEvidence(value.evidence, toolContext?.requestMessageId?.trim());
      const revise: ReviseAnswer = {
        taskId: value.taskId,
        baseRevisionId: value.baseRevisionId,
        requestId: invocation.invocationId,
        ...(value.spec ? { spec: value.spec as AnswerSpecProposal } : {}),
        ...(addHypotheses ? { addHypotheses } : {}),
        ...(addChoices ? { addChoices } : {}),
        ...(dispositions ? { dispositions } : {}),
        ...(value.notProbeable ? { notProbeable: value.notProbeable } : {}),
        ...(value.decisionPoints ? { decisionPoints: value.decisionPoints } : {}),
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
  /** Trusted record of advice per Choice; Answering reads it when the Choice is decided (ADR-0005). */
  readonly ledger?: AdvisoryLedger;
}

const ADVISORY_NOTE = "This recommendation is not evidence. Deciding against a clear lean requires adviceOverride with a reason and evidence ids.";

/** Probe outputs the Runtime already holds, stated so the advisor can see which alternatives actually differ. */
function probeEvidence(task: AnswerTaskView, choice: AnswerTaskView["currentRevision"]["choices"][number]): HypothesisChoiceEvidence[] {
  const probes = (task.task.choiceProbes ?? []).filter((probe) => probe.choiceId === choice.id);
  if (probes.length === 0) return [];
  const labels = new Map(choice.alternatives.map((alternative, index) => [alternative.id as string, `alternative ${index + 1}`]));
  const outputs = new Map<string, string[]>();
  for (const probe of probes) {
    if (probe.outcome.state !== "available") continue;
    outputs.set(probe.outcome.fingerprint, [...(outputs.get(probe.outcome.fingerprint) ?? []), labels.get(probe.alternativeId) ?? probe.alternativeId]);
  }
  const lines = probes.map((probe) => `${labels.get(probe.alternativeId) ?? probe.alternativeId}: ${probe.rowCount} output rows${probe.outcome.state === "available" ? "" : ` (output not comparable: ${probe.outcome.reason})`}`);
  const same = [...outputs.values()].filter((group) => group.length > 1).map((group) => `${group.join(" and ")} produce identical output`);
  return [{ id: "probe_outputs", kind: "observation", authority: "observation", authorityRank: 5, sourceRef: "choice_probes", content: [...lines, ...same].join("\n") }];
}

function hypothesisComparisonTool(answering: Answering, options: HypothesisComparisonToolOptions): AgentHarnessTool<DataAgentToolContext> {
  return {
    name: "compare_hypotheses",
    label: "compare_hypotheses",
    description: "Ask the configured Jev advisor to compare the alternatives of one Choice in the Answer Spec against the original request, recorded probe outputs and optional evidence. The advice is recorded for that Choice; it never revises the Answer Spec or authorizes publication.",
    replay: "safe",
    parameters: HYPOTHESIS_COMPARISON_PARAMETERS,
    async execute(toolCallId, input, _onUpdate, toolContext, invocation, context) {
      void toolCallId;
      const value = checked(HYPOTHESIS_COMPARISON_PARAMETERS, input) as HypothesisComparisonInput;
      const business = trustedContext(toolContext, invocation, context);
      const task = await answering.inspect({ taskId: value.taskId }, business);
      const choice = task.currentRevision.choices.find((item) => item.id === value.choiceId);
      if (!choice) throw new AnsweringError("INVALID_REQUEST", `Choice ${value.choiceId} is not part of the current Revision; compare the alternatives of an existing Choice`);
      const originalQuestion = await options.getOriginalQuestion(toolContext?.requestMessageId);
      const hypotheses = choice.alternatives.map((alternative) => ({ id: alternative.id as string, statement: alternative.statement }));
      const evidence: HypothesisChoiceEvidence[] = [
        { id: "request", kind: "request_wording", authority: "request_wording", authorityRank: 3, sourceRef: "user_request", content: originalQuestion },
        ...probeEvidence(task, choice),
        ...(value.evidence ?? []).map((item, index) => ({
          id: `inline_${index}`,
          kind: "observation" as const,
          authority: "observation" as const,
          authorityRank: 5,
          sourceRef: item.sourceRef ?? `inline_${index}`,
          content: item.content.slice(0, 8_000),
        })),
      ];
      const signature = json({ taskId: value.taskId, choiceId: value.choiceId, hypotheses, evidence });
      const memo = fromMemoJson(await invocation.getMemo("answering.hypothesis-comparison"));
      if (memo && typeof memo === "object" && !Array.isArray(memo)) {
        const record = memo as Record<string, unknown>;
        if (record.signature !== signature) throw new Error("HYPOTHESIS_COMPARISON_INVOCATION_CONFLICT");
        if (record.advisory && record.assessment) {
          // A replay returns and re-records the same advice.
          const replayed = record.advisory as ChoiceAdvisory;
          options.ledger?.record(replayed);
          return comparisonResult(replayed, record.assessment as HypothesisChoiceAssessment);
        }
      }
      const assessment = await options.advisor.compare({ originalQuestion, hypotheses, evidence }, { ...(context.abortSignal ? { signal: context.abortSignal } : {}) });
      const probabilities = assessment.probabilities.map((item) => ({ alternativeId: item.hypothesisId, probability: item.probability }));
      const recommendedAlternativeId = assessment.recommendation.kind === "hypothesis" ? assessment.recommendation.hypothesisId : undefined;
      const lean = leanOf(probabilities, recommendedAlternativeId);
      const advisory: ChoiceAdvisory = {
        taskId: value.taskId,
        choiceId: value.choiceId,
        alternativeIds: choice.alternatives.map((alternative) => alternative.id as string),
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

function comparisonResult(advisory: ChoiceAdvisory, assessment: HypothesisChoiceAssessment): AgentToolResult<unknown> {
  const lean = advisory.lean ? `\n[ADVICE_LEAN] alternativeId=${advisory.lean.alternativeId} probability=${advisory.lean.probability}` : "\n[ADVICE_LEAN] none";
  return result(`[HYPOTHESIS_COMPARISON_ADVISORY] choiceId=${advisory.choiceId}${lean}\n${json(assessment)}\n${ADVISORY_NOTE}`, { ...advisory, assessment });
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
 * Static model-tool registry for Answering. Inline and CSV delivery names
 * share one publish implementation and one authorization policy.
 */
/**
 * An Answering protocol tool. Pinned: the protocol can require any of them at
 * any step (compare_hypotheses before a decision, inspect_answer to recover
 * ids), so a Skill's tool allowlist must not hide them.
 */
function protocolTool(tool: AgentHarnessTool<DataAgentToolContext>, metadata: ToolPromptMetadata): DataAgentToolDefinition<DataAgentToolContext> {
  return defineDataAgentTool(tool, metadata, { pinned: true });
}

export function createAnsweringAgentToolDefinitions(
  answering: Answering,
  contentReader?: PublishedContentReader,
  hypothesisComparison?: HypothesisComparisonToolOptions,
  options: AnsweringToolOptions = {},
): readonly DataAgentToolDefinition<DataAgentToolContext>[] {
  const semanticSpecMode = options.semanticSpecMode ?? "required";
  return [
    ...(semanticSpecMode === "required" ? [protocolTool(beginSpecTool(answering), {
      promptSnippet: "为当前请求建立唯一的七槽位 Answer Spec。",
      promptGuidelines: ["每个请求只建立一次；证据须附逐字引文，由系统核验。", "同时声明 8 个决策点（population、join_multiplicity、time_field、count_grain、denominator、window、ties、output_shape）；fixed_by_request 须引用原题逐字片段。", "会相互排斥的解释建成 Choice；Choice 要先探针再决定，建立时一般不直接决定。"],
    }), protocolTool(reviseSpecTool(answering), {
      promptSnippet: "增量修订当前 Answer Spec 并处置已有项。",
      promptGuidelines: ["只提交变化，用返回的 ID 处置已有项；未提及的内容保留。", "Choice 的每个候选先做探针：输出相同的处置为 equivalent；否则用 decide，必须写 rationale，可附 evidenceIds；证据不够格时自动记为未证实并披露，不会失败。", "decide 的结果不是 compare_hypotheses 的明显倾向时，须附 adviceOverride（理由与至少一条证据）。", "SpecFeedback 只提供核对信息，不能替代业务证据或静默改变口径。"],
    })] : [protocolTool(beginQueryTaskTool(answering), {
      promptSnippet: "为语义规格消融实验创建一个不含模型七槽位定义的 Query Task。",
      promptGuidelines: ["每个问题只调用一次；精确复用返回的 taskId/revisionId，仍须区分 exploration 与 result，并通过 Candidate/Receipt 发布。"],
    })]),
    protocolTool(queryTool(answering), {
      promptSnippet: "执行有界探索或当前版本的一次结果查询。",
      promptGuidelines: ["探索产物不可发布；结果查询必须绑定当前 Ready Revision，遇到实现障碍先按分类修复或回到取证，不要盲目重跑未知结果。", "探针：exploration 加 probe={choiceId, alternativeId}，SQL 按该候选口径计算最终输出；输出标识相同表示答案相同。探针不占探索次数。", "结果与未采纳候选的探针输出相同时会被 CHOICE_NOT_REALIZED 拒绝：改 SQL 实现已采纳的候选，或带理由修订处置。"],
    }),
    ...(hypothesisComparison ? [protocolTool(hypothesisComparisonTool(answering, hypothesisComparison), {
      promptSnippet: "请求 Jev 比较一个 Choice 的全部候选。",
      promptGuidelines: ["传入 taskId 和 choiceId，候选由系统从 Answer Spec 读取；先给每个候选做探针，输出相同的 Choice 直接处置为 equivalent，无需比较。建议不是 Evidence，不能单独处置 Choice；处置结果偏离建议的明显倾向时，须附 adviceOverride（理由与证据）。"],
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
      promptGuidelines: ["投影不是第二份可写状态；修改定义只能使用 Answering 修订流程。"],
    }),
  ];
}
