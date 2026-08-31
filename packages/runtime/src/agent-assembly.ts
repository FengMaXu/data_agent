import { AgentHarness, formatSkillsForSystemPrompt, InMemorySessionRepo } from "@earendil-works/pi-agent-core";
import type { AgentHarnessOptions, AgentHarnessTool, AgentToolResult, Session, Skill as NativeSkill } from "@earendil-works/pi-agent-core";
import { InMemoryCredentialStore, type Model, type Models } from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { boundTextByLines, readBoundedFile } from "./bounded-read.js";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { Type, type Static, type TSchema } from "typebox";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { renderSemanticDashboardHtml, validateDashboardV4Spec } from "./dashboard-v4.js";
import { materializeDashboardV3Spec, renderStandaloneDashboardHtml, validateDashboardV3Spec } from "./dashboard-v3.js";
import { KnowledgeWriter } from "./knowledge-write.js";
import { runPythonJob } from "./python-job.js";
import { canonicalLocalTools, EXPORT_QUERY_PARAMETERS, PUBLISH_QUERY_RESULT_PARAMETERS, QUERY_DATABASE_PARAMETERS, SEMANTIC_VALIDATE_PARAMETERS, SHOW_WIDGET_PARAMETERS, SQL_VALIDATE_PARAMETERS, type CanonicalTool } from "./tools-catalog.js";
import { effectiveTools, loadSkillsFromRoots, resolveSkillRoots } from "./skills.js";
import type { KnowledgeIndex } from "./knowledge.js";
import type { WorkspaceStore } from "./workspace.js";
import type { ClarificationManager } from "./clarification.js";
import { emitWidgetUpdate, validateWidgetSpec, widgetLegacyText, type WidgetLifecycleDetails, type WidgetPayload } from "./widget.js";
import { createReviewOffQueryAssurance, type PreparedQueryTask, type QueryAssurance } from "./query-assurance.js";
import { ExportCandidateStore, type ExportCandidate } from "./export-candidate.js";
import type { SchemaEvidence } from "./query-digest.js";
import { createAnswerSpec, type AmbiguityInput, type AnswerContractInput, type AnswerSpecGenerator, type AnswerSpecInput, type EvidenceAuthority, type HypothesisInput } from "./answer-spec.js";
import { createConversationBlindReviewer, type ConversationBlindReviewer, type ConversationBlindReviewerInput } from "./conversation-blind-reviewer.js";

export interface QueryExportBatch {
  columns: string[];
  rows: unknown[][];
  columnTypes?: string[];
  truncated?: boolean;
}

export interface QueryExecutor {
  run(sql: string, rowLimit: number): Promise<{ columns: string[]; rows: unknown[][]; truncated: boolean; columnTypes?: string[] }>;
  /** Optional database-native EXPLAIN path; falls back to a read-only EXPLAIN query when absent. */
  explain?(sql: string, signal?: AbortSignal): Promise<{ columns: string[]; rows: unknown[][]; truncated: boolean; columnTypes?: string[] }>;
  /** Optional incremental export source. Each batch is released by the executor after consumption. */
  stream?(sql: string, signal?: AbortSignal): AsyncIterable<QueryExportBatch> | Promise<AsyncIterable<QueryExportBatch>>;
  /** Optional formal schema snapshot from the same database connection. */
  getSchema?(): Promise<SchemaEvidence>;
}

export type NativeSkillInvoker = (name: string, additionalInstructions?: string) => Promise<unknown>;
export type PythonExecutableSource = string | (() => string | undefined);
export type DatabaseDialect = "sqlite" | "mysql" | "bigquery" | "snowflake";

export interface AgentTaskProgress {
  turnCount: number;
  maxTurns: number;
}

export interface AgentAssemblyDeps {
  workspace: WorkspaceStore;
  knowledge?: KnowledgeIndex;
  knowledgeRoot?: string;
  pythonExecutable?: PythonExecutableSource;
  pythonWorkspaceDir?: string;
  /** Dialect-specific guidance appended to the model prompt. */
  databaseDialect?: DatabaseDialect;
  /** Per-provider-request wall-clock bound; unset preserves provider defaults. */
  providerTimeoutMs?: number;
  /** Optional UI capabilities. They remain enabled by default for product hosts. */
  enableWidgets?: boolean;
  enableDashboards?: boolean;
  queryExecutor?: QueryExecutor;
  /** Top-level Query Assurance coordinator; defaults to explicit Review Off. */
  queryAssurance?: QueryAssurance;
  /** Optional formal schema evidence for Query Assurance; never inferred here. */
  schemaEvidence?: SchemaEvidence;
  clarifications?: ClarificationManager;
  sessionId?: string;
  /** Persistent Pi session used by this application chat session. */
  session?: Session;
  /** Explicit system prompt; overrides systemPromptRoots resolution. */
  systemPrompt?: string;
  /** Roots scanned for the migrated `.pi/SYSTEM.md` (knowledge root first). */
  systemPromptRoots?: string[];
  /** Runtime event sink for artifact notifications. */
  emitArtifact?: (relativePath: string) => void;
  /** Explicit project root used for development Skills. */
  projectRoot?: string;
  /** Explicit application resources root used for packaged Skills. */
  packagedRoot?: string;
  /** Native AgentHarness skill invocation seam, supplied by createDataAgentHarness. */
  invokeSkill?: NativeSkillInvoker;
  /** Optional per-turn context source for hosts serving multiple sessions. */
  toolContext?: AgentAssemblyToolContextSource;
  /** Current task progress, used to warn when delivery has not happened by 60% of the turn budget. */
  taskProgress?: (context: AgentAssemblyToolContext) => AgentTaskProgress | undefined | Promise<AgentTaskProgress | undefined>;
  /** Maximum metadata/sample probes allowed per session before final SQL is required. */
  explorationQueryBudget?: number;
  /** Require an independent reconciliation query before exporting JOIN aggregates. */
  requireJoinReconciliation?: boolean;
  /** Test/adapter escape hatch; product and evaluation harnesses enforce preview-before-export by default. */
  requireValidatedExportSql?: boolean;
  /** Final-contract opt-in; migration keeps legacy SQL export calls compatible until contract shrink. */
  requireQueryArtifactId?: boolean;
  /** Require a Publication Receipt before a query task can complete. */
  enforceDeliveryReceipt?: boolean;
  /** Reflect task-local Answer Spec version changes back into the active harness context. */
  onTaskSpecVersionChanged?: (taskId: string, specVersion: string) => void;
}

export interface AgentModelProfile {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  /** OpenAI-compatible wire format: "responses" (default) or "chat". */
  apiFormat?: "responses" | "chat";
  /** Whether the selected model exposes a reasoning channel. */
  reasoning?: boolean;
  /** Optional provider-specific mapping for Pi thinking levels. */
  thinkingLevelMap?: Model<any>["thinkingLevelMap"];
}

const DEFAULT_ROW_LIMIT = 50;
const CANONICAL_TOOL_BY_NAME = new Map<string, CanonicalTool>(
  canonicalLocalTools().map((tool) => [tool.name, tool]),
);

function canonicalTool(name: string): CanonicalTool {
  const tool = CANONICAL_TOOL_BY_NAME.get(name);
  if (!tool) throw new Error(`CANONICAL_TOOL_MISSING:${name}`);
  return tool;
}

function text(content: string, details: unknown = undefined): AgentToolResult<unknown> {
  return { content: [{ type: "text", text: content }], details };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("EXPORT_CANCELLED");
}

function normalizeValidatedSql(sql: string): string {
  return sql.trim().replace(/;+\s*$/, "");
}

function isExploratoryQuery(sql: string): boolean {
  const normalized = normalizeValidatedSql(sql).replace(/\s+/g, " ");
  return /^(?:PRAGMA\b|SELECT\s+(?:name|sql)\s+FROM\s+sqlite_master\b|SELECT\s+\*\s+FROM\s+[^\s;]+\s+LIMIT\s+\d+$|SELECT\s+DISTINCT\s+[\w.\[\]`\"]+\s+FROM\s+[^\s;]+(?:\s+LIMIT\s+\d+)?$|SELECT\s+COUNT\s*\(\s*\*\s*\)\s+(?:AS\s+\w+\s+)?FROM\s+[^\s;]+$)/i.test(normalized);
}

function requiresJoinReconciliation(sql: string): boolean {
  const normalized = normalizeValidatedSql(sql);
  const hasJoin = /\b(?:LEFT|RIGHT|FULL|INNER|CROSS)?\s+JOIN\b/i.test(normalized);
  const hasAggregate = /\b(?:COUNT|SUM|AVG|MIN|MAX|GROUP_CONCAT|TOTAL)\s*\(/i.test(normalized)
    || /\bGROUP\s+BY\b/i.test(normalized);
  return hasJoin && hasAggregate;
}

function sameColumns(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((column, index) => column === expected[index]);
}

type ExportQueryParams = Static<typeof EXPORT_QUERY_PARAMETERS>;
type LegacyExportQueryParams = {
  sql: string;
  filename?: string;
  expected_rows?: "scalar" | "top_n" | "grouped" | "full";
  expected_row_count?: number;
  expected_columns?: string[];
};

/** RFC 4180 field encoding; strings remain quoted for compatibility with prior exports. */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  const escaped = raw.replaceAll('"', '""');
  return typeof value === "string" || /[",\r\n]/.test(raw) ? `"${escaped}"` : escaped;
}

function csvHeaderField(value: string): string {
  return /[",\r\n]/.test(value) ? csvField(value) : value;
}

function nativeSkillResult(result: unknown, name: string): AgentToolResult<unknown> {
  if (!result || typeof result !== "object" || !("content" in result) || !Array.isArray(result.content)) {
    throw new Error("NATIVE_SKILL_INVALID_RESULT");
  }
  const content = result.content.filter((item: unknown) => {
    if (!item || typeof item !== "object" || !("type" in item)) return false;
    const type = (item as { type?: unknown }).type;
    return type === "text" || type === "image";
  });
  if (content.length === 0) throw new Error("NATIVE_SKILL_EMPTY_RESULT");
  return { content, details: { nativeSkill: name } } as AgentToolResult<unknown>;
}

function parseReviewerJson(value: string): unknown {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(value.trim());
  const source = fenced?.[1] ?? value.trim();
  const first = source.indexOf("{");
  const last = source.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("REVIEW_RESPONSE_JSON_REQUIRED");
  return JSON.parse(source.slice(first, last + 1)) as unknown;
}

const REVIEWER_SYSTEM_PROMPT = `You are a Conversation-Blind Query Assurance reviewer. You receive only the structured review input below, never solver reasoning or gold answers. Compare the question, Answer Spec, schema evidence, SQL, deterministic Query Digest, result metadata, and resultEvidence. resultEvidence exposes complete numeric values only when numericCompleteness is "complete"; raw rows are intentionally absent unless explicitly enabled. When numericCompleteness is "partial", do not claim complete numeric coverage. Runtime supplies coverageRequirements from the Digest: you must not change a facet's applicability. Return one JSON object and no prose. Required shape: {"status":"approved|rejected|needs_clarification|abstained","coverage":{<every facet>:{"status":"checked|not_applicable|unsupported|insufficient_evidence","evidence":[{"digestPath":"existing.path[0].field","specPath":"answerContract...","resultPath":"resultEvidence.numericRows"}]}}, ...}. Every coverage facet is required. Every evidence value must be an array of objects, never a string. Every checked facet must cite an existing Digest path that belongs to that facet; copy exactly the FIRST path listed for that facet in coverageRequirements and use one evidence object only (for example projections[0].output, groupBy, measures[0].function, filters, joins, windows[0], orderBy, limit, sources, nullHandling). Never invent array indexes or Digest paths. Do not invent specPath values: include specPath only when that exact answerContract path exists. For result_values, a checked claim must include resultPath=resultEvidence.numericRows and numericCompleteness must be complete. For rejected include diffs with aspect, required, observed, and evidence {constraintId|specPath,digestPath}; cite only existing evidence. If evidence is insufficient, use abstained or needs_clarification rather than approving. Do not include reasoning or unknown fields.`;

export function createProfileConversationBlindReviewer(profile: AgentModelProfile): ConversationBlindReviewer {
  const model = buildModel(profile);
  return createConversationBlindReviewer({
    complete: async (input: ConversationBlindReviewerInput, options, signal) => {
      const response = await completeSimple(model, {
        systemPrompt: REVIEWER_SYSTEM_PROMPT,
        messages: [{ role: "user", content: JSON.stringify(input), timestamp: Date.now() }],
      }, { temperature: options.temperature, maxTokens: 2048, signal, apiKey: profile.apiKey });
      return parseReviewerJson(response.content
        .filter((content) => content.type === "text")
        .map((content) => content.text)
        .join("\n"));
    },
  });
}

const ANSWER_CONTRACT_FIELDS = new Set(["output", "grain", "measures", "denominator", "ranking", "time", "unit", "rounding"]);
const SPEC_GENERATOR_FIELDS = new Set(["answerContract", "hypotheses", "ambiguities"]);
const SPEC_GENERATOR_SYSTEM_PROMPT = `You are the Answer Spec planner for a database question. You have no database query results and must not invent observed facts, thresholds, dates, units, or business rules. Return exactly one JSON object and no markdown or prose. The only allowed top-level keys are answerContract, hypotheses, and ambiguities; omit a key when it has no supported content.

Every hypotheses item MUST be an object with exactly these allowed keys: {"statement":"...","scope":"...","confidence":0.0}. statement and scope are non-empty strings; confidence is optional and must be a number from 0 to 1. A hypothesis may also be represented internally as a string by older planners, but you should always return the object form.
Every ambiguities item MUST be an object with exactly these allowed keys: {"question":"...","alternatives":["..."],"scope":"..."}. question and scope are non-empty strings and alternatives is an array of strings; use an empty array when no alternatives are established. A string is not the preferred output form.

answerContract fields are structured wrappers: {"value":...,"authority":"model_inference","source":"planner"}; if and only if a field is literally stated, it may use authority=request_wording and must include quote with the exact question span. Runtime downgrades generated authority unless a request-wording field includes an exact quote from the question; all other generated fields remain hypotheses unless separately supported by authoritative input. Extract only what the wording explicitly requests; leave unresolved fields absent and put plausible alternatives in ambiguities. output.value has columns (aliases/names requested), rowMode (scalar|top_n|grouped|full), and optional rowCount. grain.value has entity and keyColumns. measures.value has kind (count|count_distinct|sum|avg|min|max|ratio|difference|unknown), optional name/expression/distinctKey. denominator.value has expression, optional population and zeroPolicy. ranking.value has n, partitionBy, orderBy, and tiePolicy. time.value has displayWindow, lookback, asOf, and boundary. unit.value has kind (absolute|count|currency|ratio|percentage), scale, and currency. rounding.value has mode and optional places. Do not emit SQL or prose.`;

function plannerField(value: unknown, field: string): { value: unknown; authority: EvidenceAuthority; source: string; quote?: string } {
  const record = asRecord(value);
  if (!record || !("value" in record)) return { value, authority: "model_inference", source: `planner:${field}` };
  const authority = record.authority === "request_wording" ? "request_wording" : "model_inference";
  // A planner cannot self-attest a stronger provenance by changing source.
  // Request-wording extractions must carry an exact quote, checked later by
  // Answer Spec construction.
  const source = `planner:${field}`;
  return { value: record.value, authority, source, ...(typeof record.quote === "string" && record.quote.trim() ? { quote: record.quote } : {}) };
}

function sanitizePlannerContract(value: unknown): AnswerContractInput | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value);
  if (!record) throw new Error("ANSWER_SPEC_GENERATOR_CONTRACT_INVALID");
  for (const key of Object.keys(record)) if (!ANSWER_CONTRACT_FIELDS.has(key)) throw new Error(`ANSWER_SPEC_GENERATOR_UNKNOWN_CONTRACT_FIELD:${key}`);
  const contract: Record<string, unknown> = {};
  for (const field of ANSWER_CONTRACT_FIELDS) {
    const raw = record[field];
    if (raw === undefined) continue;
    if (field === "measures") {
      // Accept the common single-measure object form, then normalize it to
      // the canonical array required by AnswerContractInput.
      const measures = Array.isArray(raw) ? raw : [raw];
      contract[field] = measures.map((item) => plannerField(item, field));
    } else contract[field] = plannerField(raw, field);
  }
  return contract as AnswerContractInput;
}

function normalizePlannerHypothesis(value: unknown): HypothesisInput {
  if (typeof value === "string") {
    const statement = value.trim();
    if (!statement) throw new Error("ANSWER_SPEC_GENERATOR_HYPOTHESIS_INVALID");
    return { statement, scope: "task", authority: "model_inference", source: "planner:hypotheses" };
  }
  const record = asRecord(value);
  if (record && Object.keys(record).some((key) => !["statement", "scope", "confidence"].includes(key))) throw new Error("ANSWER_SPEC_GENERATOR_HYPOTHESIS_FIELDS_INVALID");
  if (!record || typeof record.statement !== "string" || !record.statement.trim() || typeof record.scope !== "string" || !record.scope.trim()) {
    throw new Error("ANSWER_SPEC_GENERATOR_HYPOTHESIS_INVALID");
  }
  if (record.confidence !== undefined && (typeof record.confidence !== "number" || !Number.isFinite(record.confidence) || record.confidence < 0 || record.confidence > 1)) {
    throw new Error("ANSWER_SPEC_GENERATOR_HYPOTHESIS_CONFIDENCE_INVALID");
  }
  return {
    statement: record.statement.trim(),
    scope: record.scope.trim(),
    ...(record.confidence !== undefined ? { confidence: record.confidence } : {}),
    authority: "model_inference",
    source: "planner:hypotheses",
  };
}

function normalizePlannerAmbiguity(value: unknown): AmbiguityInput {
  if (typeof value === "string") {
    const question = value.trim();
    if (!question) throw new Error("ANSWER_SPEC_GENERATOR_AMBIGUITY_INVALID");
    return { question, alternatives: [], scope: "task", source: "planner:ambiguities" };
  }
  const record = asRecord(value);
  if (record && Object.keys(record).some((key) => !["question", "alternatives", "scope"].includes(key))) throw new Error("ANSWER_SPEC_GENERATOR_AMBIGUITY_FIELDS_INVALID");
  if (!record || typeof record.question !== "string" || !record.question.trim() || typeof record.scope !== "string" || !record.scope.trim()) {
    throw new Error("ANSWER_SPEC_GENERATOR_AMBIGUITY_INVALID");
  }
  if (!Array.isArray(record.alternatives) || record.alternatives.some((item) => typeof item !== "string")) {
    throw new Error("ANSWER_SPEC_GENERATOR_AMBIGUITY_ALTERNATIVES_INVALID");
  }
  return {
    question: record.question.trim(),
    alternatives: record.alternatives.map((item) => item.trim()),
    scope: record.scope.trim(),
    source: "planner:ambiguities",
  };
}

export function normalizeAnswerSpecPlannerOutput(input: AnswerSpecInput, value: unknown): AnswerSpecInput {
  const record = asRecord(value);
  if (!record) throw new Error("ANSWER_SPEC_GENERATOR_RESPONSE_INVALID");
  for (const key of Object.keys(record)) if (!SPEC_GENERATOR_FIELDS.has(key)) throw new Error(`ANSWER_SPEC_GENERATOR_UNKNOWN_FIELD:${key}`);
  if (record.hypotheses !== undefined && !Array.isArray(record.hypotheses)) throw new Error("ANSWER_SPEC_GENERATOR_HYPOTHESES_INVALID");
  if (record.ambiguities !== undefined && !Array.isArray(record.ambiguities)) throw new Error("ANSWER_SPEC_GENERATOR_AMBIGUITIES_INVALID");
  const generatedContract = sanitizePlannerContract(record.answerContract);
  const mergedContract = generatedContract || input.answerContract
    ? { ...(generatedContract ?? {}), ...(input.answerContract ?? {}) }
    : undefined;
  const generatedHypotheses = record.hypotheses?.map(normalizePlannerHypothesis) ?? [];
  const generatedAmbiguities = record.ambiguities?.map(normalizePlannerAmbiguity) ?? [];
  const result: AnswerSpecInput = {
    ...input,
    ...(mergedContract ? { answerContract: mergedContract } : {}),
    ...(record.hypotheses !== undefined ? { hypotheses: [...(input.hypotheses ?? []), ...generatedHypotheses] } : {}),
    ...(record.ambiguities !== undefined ? { ambiguities: [...(input.ambiguities ?? []), ...generatedAmbiguities] } : {}),
  };
  // Reuse the authoritative constructor as the generator response validator;
  // this also guarantees malformed planner fields never enter the version
  // chain. Generated fields remain model_inference hypotheses.
  createAnswerSpec(result);
  return result;
}

/** Independent planner context: it receives the question/schema, never solver messages or query results. */
export function createProfileAnswerSpecGenerator(profile: AgentModelProfile): AnswerSpecGenerator {
  const model = buildModel(profile);
  return {
    async generate(input, signal) {
      const response = await completeSimple(model, {
        systemPrompt: SPEC_GENERATOR_SYSTEM_PROMPT,
        messages: [{ role: "user", content: JSON.stringify({ question: input.question, clarifications: input.clarifications ?? [], schema: input.schema, authoritativeEvidence: input.constraints ?? [] }), timestamp: Date.now() }],
      }, { temperature: 0, maxTokens: 3072, signal, apiKey: profile.apiKey });
      const content = response.content.filter((item) => item.type === "text").map((item) => item.text).join("\\n");
      return normalizeAnswerSpecPlannerOutput(input, parseReviewerJson(content));
    },
  };
}

function buildModel(profile: AgentModelProfile): Model<any> {
  const anthropic = profile.provider === "anthropic";
  const openrouter = profile.provider === "openrouter";
  const baseUrl = (profile.baseUrl
    ?? (anthropic ? "https://api.anthropic.com" : openrouter ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1")).replace(/\/$/, "");
  const headers: Record<string, string> | undefined = profile.apiKey
    ? (anthropic
      ? { "x-api-key": profile.apiKey, "anthropic-version": "2023-06-01" }
      : { authorization: `Bearer ${profile.apiKey}` })
    : undefined;
  const apiFormat = profile.apiFormat ?? "responses";
  return {
    id: profile.model,
    name: profile.model,
    api: anthropic ? "anthropic-messages" : (apiFormat === "chat" ? "openai-completions" : "openai-responses"),
    provider: anthropic ? "anthropic" : openrouter ? "openrouter" : "openai",
    baseUrl,
    reasoning: profile.reasoning ?? false,
    ...(profile.thinkingLevelMap ? { thinkingLevelMap: profile.thinkingLevelMap } : {}),
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
    ...(headers ? { headers } : {}),
  };
}

export interface AgentAssemblyToolContext {
  /** Session identity associated with this harness turn, when available. */
  sessionId?: string;
  /** Query Task identity associated with this harness turn, when available. */
  taskId?: string;
  /** Answer Spec version associated with this harness turn, when available. */
  specVersion?: string;
}

export type AgentAssemblyToolContextSource = AgentAssemblyToolContext | (() => AgentAssemblyToolContext | Promise<AgentAssemblyToolContext>);

type PrepareQueryTaskForPrompt = (text: string, signal: AbortSignal) => Promise<PreparedQueryTask>;
type DeliveryRequirement = (task: PreparedQueryTask) => boolean | Promise<boolean>;

interface NativeToolExecution {
  toolCallId: string;
  signal: AbortSignal | undefined;
  onUpdate: Parameters<NonNullable<AgentHarnessTool<AgentAssemblyToolContext>["execute"]>>[3];
  context: AgentAssemblyToolContext;
}

function defineTool<S extends TSchema>(
  name: string, description: string, parameters: S,
  execute: (params: Static<S>, native: NativeToolExecution) => Promise<AgentToolResult<unknown>>,
): AgentHarnessTool<AgentAssemblyToolContext> {
  return {
    name,
    label: name,
    description,
    parameters,
    execute: async (
      toolCallId: string,
      params: Static<S>,
      signal: AbortSignal | undefined,
      onUpdate: NativeToolExecution["onUpdate"],
      context: AgentAssemblyToolContext,
    ) => execute(
      params,
      { toolCallId, signal, onUpdate, context },
    ),
  } as unknown as AgentHarnessTool<AgentAssemblyToolContext>;
}

interface DataAgentSkill extends NativeSkill {
  allowedTools?: string[];
}

/** Keeps native AgentHarness skill invocation while applying legacy allowlists. */
class DataAgentHarness extends AgentHarness<AgentAssemblyToolContext, DataAgentSkill> {
  private promptPreparationController?: AbortController;

  constructor(
    options: AgentHarnessOptions<AgentAssemblyToolContext, DataAgentSkill>,
    private readonly prepareQueryTask?: PrepareQueryTaskForPrompt,
    private readonly deliveryRequired?: DeliveryRequirement,
  ) {
    super(options);
  }

  override async prompt(text: string, options?: Parameters<AgentHarness<AgentAssemblyToolContext, DataAgentSkill>["prompt"]>[1]): ReturnType<AgentHarness<AgentAssemblyToolContext, DataAgentSkill>["prompt"]> {
    // Delivery reminders are internal continuation turns. They must reuse the
    // active task instead of preparing a new Query Task from the reminder text.
    if (text.startsWith("[DELIVERY_REQUIRED]")) return super.prompt(text, options);
    const controller = new AbortController();
    this.promptPreparationController = controller;
    try {
      const task = await this.prepareQueryTask?.(text, controller.signal);
      const solverPrompt = task?.answerSpec
        ? `${text}\n\n[ANSWER_SPEC_READ_ONLY]\n${JSON.stringify(task.answerSpec)}\n[/ANSWER_SPEC_READ_ONLY]`
        : text;
      const response = await super.prompt(solverPrompt, options);
      if (task && await this.deliveryRequired?.(task)) {
        // super.prompt() has returned and the harness is idle, so followUp()
        // would be rejected by AgentHarness. Start a second turn explicitly;
        // this preserves the delivery reminder without racing the idle phase.
        await super.prompt("[DELIVERY_REQUIRED] Query results are Internal Evidence until publication. Use export_query with the exact queryArtifactId for CSV delivery or publish_query_result for a small inline result. Do not answer with unapproved result values.");
      }
      return response;
    } finally {
      if (this.promptPreparationController === controller) this.promptPreparationController = undefined;
    }
  }

  override async abort() {
    this.promptPreparationController?.abort();
    return super.abort();
  }

  override async skill(name: string, additionalInstructions?: string) {
    const skill = this.getResources().skills?.find((candidate) => candidate.name === name);
    if (!skill) return super.skill(name, additionalInstructions);
    const previous = this.getActiveTools().map((tool) => (tool as unknown as { name: string }).name);
    const active = effectiveTools(previous, [skill]);
    await this.setActiveTools(active);
    try {
      return await super.skill(name, additionalInstructions);
    } finally {
      await this.setActiveTools(previous);
    }
  }
}

export function buildAgentTools(deps: AgentAssemblyDeps): AgentHarnessTool<AgentAssemblyToolContext>[] {
  const writer = deps.knowledgeRoot ? new KnowledgeWriter(deps.knowledgeRoot) : undefined;
  const sessionIdFor = (native: NativeToolExecution) => native.context?.sessionId ?? deps.sessionId;
  const taskIdFor = (native: NativeToolExecution) => native.context?.taskId;
  const specVersionFor = (native: NativeToolExecution) => native.context?.specVersion;
  const queryTaskKeyFor = (native: NativeToolExecution) => taskIdFor(native) ?? sessionIdFor(native) ?? "__default__";
  const workspaceFor = async (native: NativeToolExecution) => {
    const sessionId = sessionIdFor(native);
    return sessionId ? deps.workspace.scoped(sessionId) : deps.workspace;
  };
  const artifactPathFor = (native: NativeToolExecution, relativePath: string) => {
    const sessionId = sessionIdFor(native);
    return sessionId ? `${sessionId}/${relativePath}` : relativePath;
  };
  const toolFailures = new Map<string, { message: string; count: number }>();
  const queryAssurance = deps.queryAssurance ?? createReviewOffQueryAssurance();
  const legacyExportEnabled = deps.requireQueryArtifactId === false;
  type QueryTaskState = {
    /** Pre-wired for the next Query Task slice; Review Off is behavior-neutral. */
    queryAssurance: QueryAssurance;
    previewResults: Map<string, { columns: string[]; rows: unknown[][]; truncated: boolean }>;
    exploratoryCount: number;
    hasExported: boolean;
    legacyLastSuccessfulSql?: string;
    legacyLastReconciliationSql?: string;
    legacyReconciliationForSql?: string;
  };
  const queryTaskStates = new Map<string, QueryTaskState>();
  const queryTaskStateFor = (native: NativeToolExecution): QueryTaskState => {
    const key = queryTaskKeyFor(native);
    const existing = queryTaskStates.get(key);
    if (existing) return existing;
    const created: QueryTaskState = { queryAssurance, previewResults: new Map(), exploratoryCount: 0, hasExported: false };
    queryTaskStates.set(key, created);
    return created;
  };
  const withToolFailureGuidance = async <T>(toolName: string, native: NativeToolExecution, operation: () => Promise<T>): Promise<T> => {
    const failureKey = `${sessionIdFor(native) ?? "__default__"}:${toolName}`;
    try {
      const result = await operation();
      toolFailures.delete(failureKey);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const previous = toolFailures.get(failureKey);
      const count = previous?.message === message ? previous.count + 1 : 1;
      toolFailures.set(failureKey, { message, count });
      if (count >= 3) {
        throw new Error(`${message}\nThis exact ${toolName} error has occurred ${count} times. Stop repeating the same call; inspect the schema/knowledge and use a materially different strategy.`);
      }
      throw error;
    }
  };
  let pythonCapabilityUnavailable = false;
  const configuredPythonExecutable = typeof deps.pythonExecutable === "function" ? deps.pythonExecutable() : deps.pythonExecutable;
  const pythonUnavailableMessage = () => [
    "PYTHON_RUNTIME_NOT_AVAILABLE.",
    "Python is not available in this environment. Do NOT call run_python again.",
    "Use SQL (query_database / export_query) or the other currently available tools instead.",
    "For statistics such as median, percentile, or standard deviation, use SQL window functions or subqueries when the database supports them.",
  ].join("\n");
  const tools: AgentHarnessTool<AgentAssemblyToolContext>[] = [
    defineTool("list_workspace", canonicalTool("list_workspace").description, Type.Object({}), async (_p, native) => {
      const workspace = await workspaceFor(native);
      return text((await workspace.list()).filter((entry) => !entry.split(path.sep).includes(".audit.log")).join("\n") || "(workspace empty)");
    }),
    defineTool("read_file", canonicalTool("read_file").description, Type.Object({ path: Type.String(), startLine: Type.Optional(Type.Integer({ minimum: 1 })), endLine: Type.Optional(Type.Integer({ minimum: 1 })) }), async (p, native) => {
      const workspace = await workspaceFor(native);
      const result = await workspace.readRange(p.path, { startLine: p.startLine, endLine: p.endLine });
      return text(result.content, { startLine: p.startLine, endLine: p.endLine, truncated: result.truncated });
    }),
    defineTool("write_file", canonicalTool("write_file").description, Type.Object({ path: Type.String(), content: Type.String() }), async (p, native) => {
      const workspace = await workspaceFor(native);
      await workspace.write(p.path, p.content);
      deps.emitArtifact?.(artifactPathFor(native, p.path));
      return text(`written ${p.path} (${p.content.length} bytes)`);
    }),
  ];
  if (configuredPythonExecutable) {
    tools.push(defineTool("run_python", canonicalTool("run_python").description, Type.Object({ code: Type.String({ minLength: 1 }), description: Type.Optional(Type.String()) }), async (p, native) => {
      const executable = typeof deps.pythonExecutable === "function" ? deps.pythonExecutable() : deps.pythonExecutable;
      if (pythonCapabilityUnavailable || !executable) {
        pythonCapabilityUnavailable = true;
        throw new Error(pythonUnavailableMessage());
      }
      const workspace = deps.pythonWorkspaceDir
        ? { root: deps.pythonWorkspaceDir }
        : await workspaceFor(native);
      const result = await runPythonJob(p.code, { workspace: workspace.root, executable, timeoutMs: 120000 });
      if (result.status === "error" && (/(?:ENOENT|not found|cannot find|not recognized)/i.test(result.stderr) || result.exitCode === 127 || result.exitCode === -4058)) {
        pythonCapabilityUnavailable = true;
        throw new Error(pythonUnavailableMessage());
      }
      return text(result.stdout || result.stderr || "(no output)", { exitCode: result.exitCode, status: result.status });
    }));
  }
  if (deps.knowledge) {
    const knowledge = deps.knowledge;
    tools.push(
      defineTool("search_knowledge", canonicalTool("search_knowledge").description, Type.Object({ query: Type.String({ minLength: 1 }) }), async (p) => {
        const hits = knowledge.search(p.query);
        const details = hits.map(({ path: hitPath, score, title, startLine, endLine, snippet }) => ({ path: hitPath, score, title, startLine, endLine, snippet }));
        const rendered = hits.length
          ? hits.map((h) => `${h.path} (score ${h.score.toFixed(3)}, lines ${h.startLine}-${h.endLine}, title: ${h.title})\n${h.snippet}`).join("\n\n")
          : "(no matches)";
        return text(boundTextByLines(rendered).content, details);
      }),
      defineTool("read_knowledge", canonicalTool("read_knowledge").description, Type.Object({ path: Type.String({ minLength: 1 }), startLine: Type.Optional(Type.Integer({ minimum: 1 })), endLine: Type.Optional(Type.Integer({ minimum: 1 })) }), async (p) => {
        const result = await readBoundedFile(deps.knowledgeRoot!, p.path, { startLine: p.startLine, endLine: p.endLine });
        return text(result.content, { startLine: p.startLine, endLine: p.endLine, truncated: result.truncated });
      }),
    );
  }
  if (writer) {
    tools.push(defineTool("update_knowledge", canonicalTool("update_knowledge").description, Type.Object({ operation: Type.Union([Type.Literal("append_learning"), Type.Literal("write_draft"), Type.Literal("update_schema")]), path: Type.String({ minLength: 1 }), content: Type.String() }), async (p) => {
      const result = await writer.write(p.operation, p.path, p.content);
      return text(`${result.operation} -> ${result.path} (${result.bytesWritten} bytes)`);
    }));
  }
  tools.push(
    defineTool("load_skill", canonicalTool("load_skill").description, Type.Object({ name: Type.String({ minLength: 1 }) }), async (p) => {
      if (!deps.invokeSkill) throw new Error("NATIVE_SKILL_INVOCATION_UNAVAILABLE");
      return nativeSkillResult(await deps.invokeSkill(p.name), p.name);
    }),
  );
  if (deps.enableDashboards !== false) {
    tools.push(defineTool("generate_dashboard", canonicalTool("generate_dashboard").description, Type.Object({ operation: Type.Union([Type.Literal("create"), Type.Literal("edit"), Type.Literal("validate")]), mode: Type.Union([Type.Literal("static"), Type.Literal("semantic")]), version: Type.Union([Type.Literal("v3"), Type.Literal("v4")]), spec: Type.Unknown(), editPath: Type.Optional(Type.String()) }), async (p, native) => withToolFailureGuidance("generate_dashboard", native, async () => {
      const workspace = await workspaceFor(native);
      if (p.mode === "static" && p.version === "v3") {
        const materialized = await materializeDashboardV3Spec(p.spec, workspace);
        const validated = validateDashboardV3Spec(materialized);
        if (!validated.ok) throw new Error(`DASHBOARD_SPEC_INVALID: ${validated.errors.join("; ")}`);
        if (p.operation === "validate") return text("dashboard spec valid");
        const fileName = validated.spec.filename?.replace(/\.html$/i, "") || String(Date.now());
        const target = p.editPath ?? `dashboards/${fileName}.html`;
        const html = await renderStandaloneDashboardHtml(validated.spec);
        await workspace.write(target, html);
        const artifactPath = artifactPathFor(native, target);
        const downloadUrl = `/workspace/files/download?path=${encodeURIComponent(artifactPath)}`;
        deps.emitArtifact?.(artifactPath);
        return text(`[查看 HTML 看板](${downloadUrl})`, { status: "success", relativePath: target, downloadUrl, fileType: "html" });
      }
      if (p.mode === "semantic" && p.version === "v4") {
        const validated = validateDashboardV4Spec(p.spec);
        if (!validated.ok) throw new Error(`DASHBOARD_SPEC_INVALID: ${validated.errors.join("; ")}`);
        if (p.operation === "validate") return text("dashboard spec valid");
        const target = p.editPath ?? `dashboards/${Date.now()}-semantic.html`;
        const html = renderSemanticDashboardHtml(validated.spec, { nonce: randomUUID().replace(/-/g, ""), expectedOrigin: "https://data-agent.local" });
        await workspace.write(target, html);
        const artifactPath = artifactPathFor(native, target);
        const downloadUrl = `/workspace/files/download?path=${encodeURIComponent(artifactPath)}`;
        deps.emitArtifact?.(artifactPath);
        return text(`[查看语义看板](${downloadUrl})`, { status: "success", relativePath: target, downloadUrl, fileType: "html" });
      }
      throw new Error("DASHBOARD_MODE_VERSION_MISMATCH");
    })));
  }
  if (deps.enableWidgets !== false) {
    tools.push(defineTool("show_widget", canonicalTool("show_widget").description, SHOW_WIDGET_PARAMETERS, async (p, native) => withToolFailureGuidance("show_widget", native, async () => {
      const widgetId = `widget-${native.toolCallId}`;
      if (native.signal?.aborted) throw new Error("Operation aborted");
      const validation = validateWidgetSpec(p.kind, p.spec);
      if (!validation.ok) {
        const error = `WIDGET_SPEC_INVALID: ${validation.error}`;
        emitWidgetUpdate(native.onUpdate, {
          widgetEvent: "widget_error",
          widgetId,
          toolCallId: native.toolCallId,
          toolName: "show_widget",
          error,
          legacyText: `[widget error] ${error}`,
        });
        throw new Error(error);
      }
      const spec = { ...validation.spec };
      // The renderer consumes KPI items, while accepting the compact scalar
      // form keeps the tool useful to callers that only have one value.
      if (p.kind === "kpi" && !Array.isArray(spec.data) && (typeof spec.value === "string" || typeof spec.value === "number")) {
        spec.data = [{ label: spec.label ?? "", value: spec.value }];
      }
      const widget: WidgetPayload = {
        ...spec,
        widget_id: widgetId,
        kind: p.kind,
        title: typeof spec.title === "string" && spec.title.trim() ? spec.title : `${p.kind} widget`,
        tool_call_id: native.toolCallId,
      };
      const legacyText = widgetLegacyText(widget);
      emitWidgetUpdate(native.onUpdate, {
        widgetEvent: "widget",
        widgetId,
        toolCallId: native.toolCallId,
        toolName: "show_widget",
        widget,
        legacyText,
      });
      return text(legacyText, {
        widgetEvent: "widget",
        widgetId,
        toolCallId: native.toolCallId,
        toolName: "show_widget",
        widget,
        legacyText,
      } satisfies WidgetLifecycleDetails);
    })));
  }
  if (deps.queryExecutor) {
    const runQuery = async (sql: string, limit?: number) => {
      const result = await deps.queryExecutor!.run(sql, limit ?? DEFAULT_ROW_LIMIT);
      const header = result.columns.join(" | ");
      const body = result.rows.map((row) => row.map((cell) => String(cell ?? "NULL")).join(" | ")).join("\n");
      return {
        rendered: `${header}\n${body}${result.truncated ? `\n(truncated at ${result.rows.length} rows)` : ""}`,
        result,
      };
    };
    const getArtifactForValidation = async (queryArtifactId: string, native: NativeToolExecution) => {
      const taskId = taskIdFor(native);
      if (!taskId) throw new Error("QUERY_TASK_REQUIRED: validation requires an active Query Task");
      if (!queryAssurance.getArtifact) throw new Error("QUERY_ASSURANCE_ARTIFACT_API_UNAVAILABLE");
      const signal = native.signal ?? new AbortController().signal;
      const artifact = await queryAssurance.getArtifact(taskId, queryArtifactId, signal);
      if (!artifact) throw new Error("QUERY_ARTIFACT_NOT_FOUND_OR_EXPIRED");
      return { taskId, artifact, signal };
    };
    const semanticReviewInputForArtifact = (taskId: string, artifact: Awaited<ReturnType<NonNullable<QueryAssurance["getArtifact"]>>>) => {
      const spec = queryAssurance.getAnswerSpec?.(taskId, artifact?.specVersion);
      const digest = artifact?.queryDigest;
      if (!artifact || !spec || !digest) return undefined;
      const schema = artifact.schemaEvidence ?? { connectionId: "unknown", dialect: digest.dialect, tables: [] };
      return { question: spec.question, clarifications: [], answerSpec: spec, schema, sql: artifact.normalizedSql, digest, resultMetadata: artifact.previewMetadata, resultEvidence: artifact.previewMetadata.resultEvidence };
    };
    const exportViaAssurance = async (params: ExportQueryParams, native: NativeToolExecution): Promise<AgentToolResult<unknown>> => {
      const taskId = taskIdFor(native);
      if (!taskId) throw new Error("QUERY_TASK_REQUIRED: queryArtifactId publication requires an active Query Task");
      if (!params.queryArtifactId) throw new Error("QUERY_ARTIFACT_REQUIRED");
      if (!queryAssurance.getArtifact || !queryAssurance.publishCandidate) throw new Error("QUERY_ASSURANCE_ARTIFACT_API_UNAVAILABLE");
      const signal = native.signal ?? new AbortController().signal;
      const artifact = await queryAssurance.getArtifact(taskId, params.queryArtifactId, signal);
      if (!artifact) throw new Error("QUERY_ARTIFACT_NOT_FOUND_OR_EXPIRED");
      const existingReceipt = queryAssurance.publicationForArtifact?.(taskId, artifact.queryArtifactId);
      if (existingReceipt) {
        queryTaskStateFor(native).hasExported = true;
        return text(`[PUBLICATION_ALREADY_COMPLETE] Publication Receipt ${existingReceipt.receiptId} (${existingReceipt.status})`, { status: "success", taskComplete: true, publicationReceipt: existingReceipt, queryArtifactId: artifact.queryArtifactId });
      }
      if (queryAssurance.publicationForTask?.(taskId)) throw new Error("PUBLICATION_TASK_ALREADY_COMPLETE");
      const target = params.filename ?? `exports/query-${Date.now()}.csv`;
      const workspace = await workspaceFor(native);
      const taskSpec = queryAssurance.getAnswerSpec?.(taskId, artifact.specVersion);
      const hardOutputContract = taskSpec?.answerContract?.output?.binding === "hard"
        ? taskSpec.answerContract.output.value
        : undefined;
      // EXPLAIN is performed against the immutable Artifact, not Solver SQL.
      // The helper tool has no publication authority; this preflight is also
      // repeated automatically so calling the tool is not required for safety.
      await sqlValidateTool.execute("export-sql-preflight", { queryArtifactId: artifact.queryArtifactId }, native.signal, native.onUpdate, native.context);
      const candidateStore = new ExportCandidateStore(workspace);
      const batches = (async function* (): AsyncGenerator<{ columns: readonly string[]; rows: readonly (readonly unknown[])[]; columnTypes?: readonly string[]; truncated?: boolean }> {
        if (deps.queryExecutor!.stream) {
          const streamed = await deps.queryExecutor!.stream(artifact.normalizedSql, signal);
          for await (const batch of streamed) yield batch;
          return;
        }
        const bounded = await deps.queryExecutor!.run(artifact.normalizedSql, DEFAULT_ROW_LIMIT);
        if (bounded.truncated) throw new Error("EXPORT_STREAM_REQUIRED");
        yield bounded;
      })();
      let candidate: ExportCandidate | undefined;
      try {
        candidate = await candidateStore.create({
          taskId,
          queryArtifactId: artifact.queryArtifactId,
          batches,
          expectedColumns: taskSpec?.outputColumns ?? hardOutputContract?.columns ?? artifact.previewMetadata.columns,
          expectedRows: taskSpec?.rowMode ?? hardOutputContract?.rowMode,
          expectedRowCount: taskSpec?.rowCount ?? hardOutputContract?.rowCount,
        }, signal);
        const storedCandidate = candidate;
        const specVersion = artifact.specVersion ?? specVersionFor(native) ?? "1";
        const schemaEvidenceFingerprint = artifact.queryDigest?.schemaEvidenceFingerprint ?? "unknown";
        const candidateForReview = { ...storedCandidate, normalizedSqlHash: artifact.normalizedSqlHash, specVersion, schemaEvidenceFingerprint };
        const digest = artifact.queryDigest;
        const spec = taskSpec;
        const schema = artifact.schemaEvidence ?? (digest ? { connectionId: "unknown", dialect: digest.dialect, tables: [] } : undefined);
        const reviewInput = digest && spec && schema
          ? {
            question: spec.question,
            clarifications: [],
            answerSpec: spec,
            schema,
            sql: artifact.normalizedSql,
            digest,
            resultMetadata: storedCandidate.metadata,
            resultEvidence: storedCandidate.metadata.resultEvidence,
          }
          : undefined;
        const outcome = await queryAssurance.reviewForPublication({ task: { taskId, mode: queryAssurance.mode, specVersion }, candidate: candidateForReview, reviewInput }, signal);
        if (outcome.availability === "available" && outcome.decision.status === "rejected" && outcome.decision.blocking !== false && queryAssurance.mode === "enforce" && queryAssurance.claimAutomaticRepair) {
          const repair = queryAssurance.claimAutomaticRepair(taskId, specVersion);
          if (repair.allowed) {
            await candidateStore.discard(storedCandidate);
            throw new Error(`SEMANTIC_DIFF_REPAIR_REQUIRED:${JSON.stringify({ attempt: repair.attempt, diffs: outcome.decision.diffs ?? [] })}`);
          }
        }
        if (!outcome.reviewToken) {
          const failure = outcome.availability === "unavailable" ? outcome.failure : undefined;
          await candidateStore.discard(storedCandidate);
          // Review Unavailable is fail-closed and terminal for this exact
          // candidate. Returning terminate prevents the Agent from launching
          // another provider turn that can only repeat the same blocked export.
          return {
            ...text(`[REVIEW_UNAVAILABLE] ${failure?.code ?? "REVIEW_TOKEN_MISSING"}: ${failure?.message ?? "No Review Token was issued"}. This exact result cannot be published; do not retry export_query or semantic_validate.`, {
              status: "blocked",
              terminal: true,
              queryArtifactId: artifact.queryArtifactId,
              ...(failure ? { reviewFailure: failure } : {}),
            }),
            terminate: true,
          };
        }
        let receipt;
        try {
          receipt = await queryAssurance.publishCandidate({ reviewToken: outcome.reviewToken, candidate: candidateForReview, targetPath: target, promote: () => candidateStore.publish(storedCandidate, target) }, signal);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/REVIEW_UNAVAILABLE|REVIEW_TIMEOUT/.test(message)) {
            await candidateStore.discard(storedCandidate);
            return {
              ...text(`[REVIEW_UNAVAILABLE] ${message}. This exact result cannot be published; do not retry export_query or semantic_validate.`, {
                status: "blocked",
                terminal: true,
                queryArtifactId: artifact.queryArtifactId,
              }),
              terminate: true,
            };
          }
          throw error;
        }
        queryTaskStateFor(native).hasExported = true;
        const artifactPath = artifactPathFor(native, target);
        const downloadUrl = `/workspace/files/download?path=${encodeURIComponent(artifactPath)}`;
        deps.emitArtifact?.(artifactPath);
        return text(`exported ${storedCandidate.metadata.rowCount} rows: [下载 CSV](${downloadUrl})\\n[TASK_COMPLETE] Publication Receipt ${receipt.receiptId} (${receipt.status})`, {
          status: "success",
          taskComplete: true,
          publicationReceipt: receipt,
          relativePath: target,
          downloadUrl,
          fileType: "csv",
          rowCount: storedCandidate.metadata.rowCount,
          columns: storedCandidate.metadata.columns,
          queryArtifactId: artifact.queryArtifactId,
        });
      } catch (error) {
        if (candidate) await candidateStore.discard(candidate);
        throw error;
      }
    };
    const publishInlineViaAssurance = async (params: Static<typeof PUBLISH_QUERY_RESULT_PARAMETERS>, native: NativeToolExecution): Promise<AgentToolResult<unknown>> => {
      const taskId = taskIdFor(native);
      if (!taskId) throw new Error("QUERY_TASK_REQUIRED: inline publication requires an active Query Task");
      if (!queryAssurance.getArtifact || !queryAssurance.publishCandidate) throw new Error("QUERY_ASSURANCE_ARTIFACT_API_UNAVAILABLE");
      const signal = native.signal ?? new AbortController().signal;
      const artifact = await queryAssurance.getArtifact(taskId, params.queryArtifactId, signal);
      if (!artifact) throw new Error("QUERY_ARTIFACT_NOT_FOUND_OR_EXPIRED");
      const existingReceipt = queryAssurance.publicationForArtifact?.(taskId, artifact.queryArtifactId);
      if (existingReceipt) return text(`[PUBLICATION_ALREADY_COMPLETE] Publication Receipt ${existingReceipt.receiptId} (${existingReceipt.status})`, { status: "success", taskComplete: true, publishedInline: true, publicationReceipt: existingReceipt, queryArtifactId: artifact.queryArtifactId });
      if (queryAssurance.publicationForTask?.(taskId)) throw new Error("PUBLICATION_TASK_ALREADY_COMPLETE");
      const preview = queryTaskStateFor(native).previewResults.get(params.queryArtifactId);
      if (!preview) throw new Error("QUERY_ARTIFACT_PREVIEW_NOT_AVAILABLE");
      if (preview.truncated || artifact.previewMetadata.truncated) throw new Error("INLINE_RESULT_TRUNCATED");
      const candidate: ExportCandidate & { normalizedSqlHash: string; specVersion: string; schemaEvidenceFingerprint: string } = {
        candidateId: randomUUID(),
        taskId,
        queryArtifactId: artifact.queryArtifactId,
        path: `inline://${artifact.queryArtifactId}`,
        contentSha256: createHash("sha256").update(JSON.stringify({ columns: preview.columns, rows: preview.rows }), "utf8").digest("hex"),
        metadata: artifact.previewMetadata,
        createdAt: new Date().toISOString(),
        normalizedSqlHash: artifact.normalizedSqlHash,
        specVersion: artifact.specVersion ?? specVersionFor(native) ?? "1",
        schemaEvidenceFingerprint: artifact.queryDigest?.schemaEvidenceFingerprint ?? "unknown",
      };
      const spec = queryAssurance.getAnswerSpec?.(taskId, artifact.specVersion);
      const schema = artifact.schemaEvidence ?? (artifact.queryDigest ? { connectionId: "unknown", dialect: artifact.queryDigest.dialect, tables: [] } : undefined);
      const reviewInput = artifact.queryDigest && spec && schema
        ? {
          question: spec.question,
          clarifications: [],
          answerSpec: spec,
          schema,
          sql: artifact.normalizedSql,
          digest: artifact.queryDigest,
          resultMetadata: artifact.previewMetadata,
          resultEvidence: artifact.previewMetadata.resultEvidence,
        }
        : undefined;
      const outcome = await queryAssurance.reviewForPublication({ task: { taskId, mode: queryAssurance.mode, specVersion: candidate.specVersion }, candidate, reviewInput }, signal);
      if (outcome.availability === "available" && outcome.decision.status === "rejected" && outcome.decision.blocking !== false && queryAssurance.mode === "enforce" && queryAssurance.claimAutomaticRepair) {
        const repair = queryAssurance.claimAutomaticRepair(taskId, candidate.specVersion);
        if (repair.allowed) throw new Error(`SEMANTIC_DIFF_REPAIR_REQUIRED:${JSON.stringify({ attempt: repair.attempt, diffs: outcome.decision.diffs ?? [] })}`);
      }
      if (!outcome.reviewToken) {
        const failure = outcome.availability === "unavailable" ? outcome.failure : undefined;
        return {
          ...text(`[REVIEW_UNAVAILABLE] ${failure?.code ?? "REVIEW_TOKEN_MISSING"}: ${failure?.message ?? "No Review Token was issued"}. This exact result cannot be published; do not retry export_query or semantic_validate.`, {
            status: "blocked",
            terminal: true,
            queryArtifactId: artifact.queryArtifactId,
            ...(failure ? { reviewFailure: failure } : {}),
          }),
          terminate: true,
        };
      }
      let receipt;
      try {
        receipt = await queryAssurance.publishCandidate({ reviewToken: outcome.reviewToken, candidate, targetPath: candidate.path }, signal);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/REVIEW_UNAVAILABLE|REVIEW_TIMEOUT/.test(message)) {
          return {
            ...text(`[REVIEW_UNAVAILABLE] ${message}. This exact result cannot be published; do not retry publish_query_result or semantic_validate.`, {
              status: "blocked",
              terminal: true,
              queryArtifactId: artifact.queryArtifactId,
            }),
            terminate: true,
          };
        }
        throw error;
      }
      queryTaskStateFor(native).hasExported = true;
      const header = preview.columns.join(" | ");
      const body = preview.rows.map((row) => row.map((cell) => String(cell ?? "NULL")).join(" | ")).join("\\n");
      return text(`${header}\\n${body}\\n[PUBLISHED_INLINE] Publication Receipt ${receipt.receiptId} (${receipt.status})`, {
        status: "success",
        taskComplete: true,
        publishedInline: true,
        internalEvidence: false,
        publicationReceipt: receipt,
        queryArtifactId: artifact.queryArtifactId,
        columns: preview.columns,
        rows: preview.rows,
      });
    };
    const sqlValidateTool = defineTool("sql_validate", canonicalTool("sql_validate").description, SQL_VALIDATE_PARAMETERS, async (p, native) => withToolFailureGuidance("sql_validate", native, async () => {
      const { taskId, artifact, signal } = await getArtifactForValidation(p.queryArtifactId, native);
      if (!artifact.queryDigest) return text(JSON.stringify({ status: "unsupported", reason: "SQL_VALIDATE_DIGEST_UNAVAILABLE", queryArtifactId: artifact.queryArtifactId }), { status: "unsupported", queryArtifactId: artifact.queryArtifactId });
      const dialect = artifact.queryDigest.dialect ?? deps.databaseDialect;
      if (!dialect) return text(JSON.stringify({ status: "unsupported", reason: "SQL_VALIDATE_DIALECT_UNAVAILABLE", queryArtifactId: artifact.queryArtifactId }), { status: "unsupported", queryArtifactId: artifact.queryArtifactId });
      const explainSql = dialect === "sqlite" ? `EXPLAIN QUERY PLAN ${artifact.normalizedSql}` : `EXPLAIN ${artifact.normalizedSql}`;
      let explainResult: Awaited<ReturnType<QueryExecutor["run"]>> | undefined;
      let explainError: string | undefined;
      try {
        explainResult = deps.queryExecutor!.explain
          ? await deps.queryExecutor!.explain(artifact.normalizedSql, signal)
          : (await runQuery(explainSql, DEFAULT_ROW_LIMIT)).result;
      } catch (error) {
        // The original Artifact has already executed successfully. EXPLAIN is
        // an advisory capability and differs across engines/permissions; do
        // not turn an unsupported plan verb into a false SQL failure.
        explainError = error instanceof Error ? error.message : String(error);
      }
      const status = explainResult ? "valid" : "unsupported";
      return text(JSON.stringify({
        status,
        queryArtifactId: artifact.queryArtifactId,
        normalizedSqlHash: artifact.normalizedSqlHash,
        parser: { engine: artifact.queryDigest.parserEngine, version: artifact.queryDigest.parserVersion, coverage: artifact.queryDigest.coverage, unsupportedNodes: artifact.queryDigest.unsupportedNodes },
        digest: { sources: artifact.queryDigest.sources, joins: artifact.queryDigest.joins, measures: artifact.queryDigest.measures, projections: artifact.queryDigest.projections, groupBy: artifact.queryDigest.groupBy, windows: artifact.queryDigest.windows, limit: artifact.queryDigest.limit },
        ...(explainResult ? { explain: explainResult } : { explainError }),
        taskId,
      }), { status, queryArtifactId: artifact.queryArtifactId, normalizedSqlHash: artifact.normalizedSqlHash, ...(explainResult ? { explain: explainResult } : { explainError }) });
    }));
    const semanticValidateTool = defineTool("semantic_validate", canonicalTool("semantic_validate").description, SEMANTIC_VALIDATE_PARAMETERS, async (p, native) => withToolFailureGuidance("semantic_validate", native, async () => {
      const { taskId, artifact, signal } = await getArtifactForValidation(p.queryArtifactId, native);
      const reviewInput = semanticReviewInputForArtifact(taskId, artifact);
      if (!reviewInput) throw new Error("SEMANTIC_VALIDATE_INPUT_UNAVAILABLE");
      const outcome = await queryAssurance.reviewForPublication({
        task: { taskId, mode: queryAssurance.mode, ...(artifact.specVersion ? { specVersion: artifact.specVersion } : {}) },
        candidate: "semantic-validation-only",
        reviewInput,
      }, signal);
      // This tool is advisory. It cannot issue a Review Token or publish; the
      // final export path performs a fresh candidate-bound review.
      const advisory = outcome.availability === "available"
        ? { availability: outcome.availability, decision: outcome.decision }
        : { availability: outcome.availability, failure: outcome.failure };
      const rendered = outcome.availability === "unavailable"
        ? `${JSON.stringify(advisory)}\nREVIEW_ADVISORY_UNAVAILABLE: Do not retry semantic_validate. Proceed directly to export_query for the exact Query Artifact; export performs its own candidate-bound review.`
        : JSON.stringify(advisory);
      return text(rendered, { status: "advisory", queryArtifactId: artifact.queryArtifactId, outcome: advisory });
    }));
    tools.push(
      sqlValidateTool,
      semanticValidateTool,
      defineTool("query_database", canonicalTool("query_database").description, QUERY_DATABASE_PARAMETERS, async (p, native) => withToolFailureGuidance("query_database", native, async () => {
        let state = queryTaskStateFor(native);
        if (state.hasExported) {
          state = { queryAssurance, previewResults: new Map(), exploratoryCount: 0, hasExported: false };
          queryTaskStates.set(queryTaskKeyFor(native), state);
        }
        const validationPurpose = p.purpose;
        const exploratory = !validationPurpose && isExploratoryQuery(p.sql);
        const explorationLimit = deps.explorationQueryBudget === undefined
          ? undefined
          : Math.max(1, deps.explorationQueryBudget);
        if (exploratory && explorationLimit !== undefined && state.exploratoryCount >= explorationLimit) {
          return text(
            `You have used ${state.exploratoryCount}/${explorationLimit} exploratory queries. ` +
            "Stop exploring and write your final analytical SQL now. " +
            "If you already have a validated result, call export_query immediately.",
            { warning: "EXPLORATION_BUDGET_EXCEEDED", exploratoryCount: state.exploratoryCount, limit: explorationLimit },
          );
        }
        if (exploratory) state.exploratoryCount++;
        const { rendered, result } = await runQuery(p.sql, p.limit);
        const normalizedSql = normalizeValidatedSql(p.sql);
        const signal = native.signal ?? new AbortController().signal;
        const taskId = taskIdFor(native);
        let schemaEvidence = deps.schemaEvidence;
        if (!schemaEvidence && deps.queryExecutor!.getSchema) {
          schemaEvidence = await deps.queryExecutor!.getSchema().catch((error) => {
            console.warn("[data-agent] schema evidence unavailable:", error instanceof Error ? error.message : String(error));
            return undefined;
          });
        }
        const artifact = taskId && !validationPurpose && queryAssurance.recordPreview
          ? await queryAssurance.recordPreview({
            task: { taskId, mode: queryAssurance.mode, ...(specVersionFor(native) ? { specVersion: specVersionFor(native) } : {}) },
            sql: p.sql,
            result: { columns: result.columns, rows: result.rows, truncated: result.truncated, ...(result.columnTypes ? { columnTypes: result.columnTypes } : {}) },
            ...(deps.databaseDialect ? { dialect: deps.databaseDialect } : {}),
            ...(schemaEvidence ? { schema: schemaEvidence } : {}),
          }, signal)
          : undefined;
        if (artifact) state.previewResults.set(artifact.queryArtifactId, { columns: [...result.columns], rows: result.rows, truncated: result.truncated });
        if (legacyExportEnabled) {
          if (validationPurpose === "reconciliation") {
            state.legacyLastReconciliationSql = normalizedSql;
            state.legacyReconciliationForSql = state.legacyLastSuccessfulSql;
          } else if (!validationPurpose) {
            state.legacyLastSuccessfulSql = normalizedSql;
          }
        }
        const progress = await deps.taskProgress?.(native.context);
        const remindToExport = Boolean(progress
          && progress.maxTurns > 0
          && progress.turnCount >= progress.maxTurns * 0.6
          && !state.hasExported);
        const reminder = remindToExport
          ? `\n\n[EXPORT_DEADLINE] You have used ${progress!.turnCount}/${progress!.maxTurns} turns and have not exported yet. ` +
            "If this result satisfies the declared output contract, call export_query immediately with this validated SQL."
          : "";
        const validationHint = validationPurpose === "reconciliation"
          ? "\n[RECONCILIATION_RECORDED] This independent reconciliation query does not replace the final SQL used for export."
          : validationPurpose === "verification"
            ? "\n[VERIFICATION_RECORDED] This independent verification query does not replace the final SQL used for export."
            : "";
        const artifactHint = artifact ? `\n[INTERNAL_EVIDENCE] queryArtifactId=${artifact.queryArtifactId}` : "";
        return text(`${rendered}${validationHint}${artifactHint}${reminder}`, {
          columns: result.columns,
          rows: result.rows,
          exploratory,
          ...(validationPurpose ? { purpose: validationPurpose } : {}),
          ...(taskId ? { taskId, internalEvidence: true } : {}),
          ...(artifact ? {
            queryArtifactId: artifact.queryArtifactId,
            normalizedSqlHash: artifact.normalizedSqlHash,
            previewMetadata: artifact.previewMetadata,
            expiresAt: artifact.expiresAt,
            ...(artifact.specStatus ? { specStatus: artifact.specStatus } : {}),
          } : {}),
          ...(remindToExport ? { exportReminder: true, turnCount: progress!.turnCount, maxTurns: progress!.maxTurns } : {}),
        });
      })),

      defineTool("export_query", canonicalTool("export_query").description, EXPORT_QUERY_PARAMETERS, async (p, native) => withToolFailureGuidance("export_query", native, async () => {
        if (p.queryArtifactId) return exportViaAssurance(p, native);
        const legacy = p as unknown as LegacyExportQueryParams;
        if (deps.requireQueryArtifactId !== false) throw new Error("EXPORT_QUERY_REQUIRES_QUERY_ARTIFACT_ID: select a Query Artifact instead of submitting SQL directly");
        if (!legacy.expected_rows) {
          throw new Error("SHAPE_DECLARATION_INVALID: expected_rows is required");
        }
        const taskState = queryTaskStateFor(native);
        const normalizedSql = normalizeValidatedSql(legacy.sql);
        if (deps.requireValidatedExportSql !== false && taskState.legacyLastSuccessfulSql !== normalizedSql) {
          throw new Error("EXPORT_SQL_NOT_VALIDATED: export_query SQL must exactly match the last successful final query_database SQL in this session. Validate this SQL, then export it unchanged. Re-derive the expected shape from the question, not from the last query result.");
        }
        if (legacy.expected_rows === "top_n" && legacy.expected_row_count === undefined) {
          throw new Error("SHAPE_DECLARATION_INVALID: expected_row_count is required for top_n");
        }
        if (!legacy.expected_columns || legacy.expected_columns.length === 0) {
          throw new Error("SHAPE_DECLARATION_INVALID: expected_columns is required");
        }
        if (deps.requireJoinReconciliation !== false && requiresJoinReconciliation(legacy.sql)) {
          if (taskState.legacyReconciliationForSql !== normalizedSql || taskState.legacyLastReconciliationSql === normalizedSql) {
            throw new Error("JOIN_RECONCILIATION_REQUIRED: run a different successful query_database call with purpose=reconciliation to audit JOIN aggregate row counts or totals before exporting. The reconciliation query does not replace the final SQL.");
          }
        }
        const signal = native.signal;
        const target = legacy.filename ?? `exports/query-${Date.now()}.csv`;
        const rowCountMaximum = (legacy.expected_rows === "top_n" || legacy.expected_rows === "grouped")
          ? legacy.expected_row_count
          : undefined;
        let rowCount = 0;
        let observedColumns: string[] | undefined;
        const workspace = await workspaceFor(native);
        await workspace.writeStream(target, async (write) => {
          let pending = "";
          let headerWritten = false;
          const append = async (chunk: string) => {
            pending += chunk;
            if (pending.length >= 64 * 1024) {
              await write(pending);
              pending = "";
            }
          };
          const consume = async (batch: QueryExportBatch) => {
            throwIfAborted(signal);
            if (!observedColumns) observedColumns = [...batch.columns];
            if (!sameColumns(batch.columns, observedColumns)) {
              throw new Error(`SHAPE_MISMATCH: export batches changed columns from [${observedColumns.join(", ")}] to [${batch.columns.join(", ")}]`);
            }
            if (!sameColumns(batch.columns, legacy.expected_columns!)) {
              throw new Error(`SHAPE_MISMATCH: expected columns [${legacy.expected_columns!.join(", ")}] but query returned [${batch.columns.join(", ")}]`);
            }
            if (!headerWritten) {
              await append(batch.columns.map(csvHeaderField).join(","));
              headerWritten = true;
            }
            for (const row of batch.rows) {
              throwIfAborted(signal);
              if (row.length !== batch.columns.length) {
                throw new Error(`SHAPE_MISMATCH: row width ${row.length} does not match ${batch.columns.length} columns`);
              }
              rowCount++;
              if (legacy.expected_rows === "scalar" && rowCount > 1) {
                throw new Error("SHAPE_MISMATCH: declared scalar but query produced more than 1 row. Add a final aggregation or LIMIT 1 before exporting.");
              }
              if (rowCountMaximum !== undefined && rowCount > rowCountMaximum) {
                throw new Error(`SHAPE_MISMATCH: declared ${legacy.expected_rows} maximum=${legacy.expected_row_count} but query produced more than ${rowCountMaximum} rows. Add a final LIMIT, aggregation, or stricter filter before exporting.`);
              }
              await append(`\n${row.map(csvField).join(",")}`);
            }
          };
          if (deps.queryExecutor!.stream) {
            const batches = await deps.queryExecutor!.stream(legacy.sql, signal);
            for await (const batch of batches) await consume(batch);
          } else {
            // The legacy preview contract is intentionally bounded. Executors
            // that support complete exports must implement stream().
            const bounded = await deps.queryExecutor!.run(legacy.sql, DEFAULT_ROW_LIMIT);
            if (bounded.truncated) throw new Error("EXPORT_STREAM_REQUIRED");
            await consume(bounded);
          }
          if (!headerWritten) throw new Error("EXPORT_EMPTY_STREAM: executor returned no column metadata");
          if (legacy.expected_rows === "scalar" && rowCount === 0) {
            throw new Error("SHAPE_MISMATCH: declared scalar but query produced 0 rows. Return exactly one aggregate row before exporting.");
          }
          if (pending) await write(pending);
        }, signal);
        queryTaskStateFor(native).hasExported = true;
        // The artifact is observable only after the temporary file was promoted.
        const artifactPath = artifactPathFor(native, target);
        const downloadUrl = `/workspace/files/download?path=${encodeURIComponent(artifactPath)}`;
        deps.emitArtifact?.(artifactPath);
        return text(
          `exported ${rowCount} rows: [下载 CSV](${downloadUrl})\n` +
          `[TASK_COMPLETE] The declared ${legacy.expected_rows} shape and output columns were validated. ` +
          "If the user's request was to query and export data, the task is complete. " +
          "Do not call Python, show_widget, or generate_dashboard unless the user explicitly requested analysis or visualization.",
          {
            status: "success",
            taskComplete: true,
            relativePath: target,
            downloadUrl,
            fileType: "csv",
            rowCount,
            columns: observedColumns ?? [],
            expectedRows: legacy.expected_rows,
          },
        );
      })),

      defineTool("publish_query_result", canonicalTool("publish_query_result").description, PUBLISH_QUERY_RESULT_PARAMETERS, async (p, native) => withToolFailureGuidance("publish_query_result", native, async () => publishInlineViaAssurance(p, native))),
    );
  }
  if (deps.clarifications) {
    const clarifications = deps.clarifications;
    tools.push(defineTool("ask_user_clarification", canonicalTool("ask_user_clarification").description, Type.Object({ question: Type.String({ minLength: 1 }), options: Type.Optional(Type.Array(Type.String())) }), async (p, native) => {
      const sessionId = native.context.sessionId ?? deps.sessionId ?? "web";
      const { clarificationId, promise } = clarifications.ask(sessionId, p.question, p.options ?? []);
      deps.emitArtifact?.(`__clarification__:${clarificationId}`);
      const answer = await promise;
      const taskId = taskIdFor(native);
      const baseSpecVersion = specVersionFor(native);
      let nextSpecVersion: string | undefined;
      if (answer && taskId && baseSpecVersion && queryAssurance.applyClarification) {
        const next = queryAssurance.applyClarification(taskId, baseSpecVersion, answer);
        nextSpecVersion = next.specVersion;
        native.context.specVersion = next.specVersion;
        deps.onTaskSpecVersionChanged?.(taskId, next.specVersion);
      }
      return text(answer || "(no answer)", nextSpecVersion ? { taskId, specVersion: nextSpecVersion } : undefined);
    }));
  }
  return tools;
}

export function composeDataAgentSystemPrompt(basePrompt: string, skills: NativeSkill[]): string {
  const skillsPrompt = formatSkillsForSystemPrompt(skills);
  return [basePrompt.trim(), skillsPrompt].filter(Boolean).join("\n\n");
}

export function dialectHint(dialect: DatabaseDialect): string {
  switch (dialect) {
    case "sqlite":
      return [
        "数据库后端为 SQLite。",
        "系统表查询用 `SELECT name FROM sqlite_master WHERE type='table'`。",
        "日期提取用 `strftime()`；不支持 YEAR()、MONTH()、DATEDIFF()、DATE_FORMAT()。",
        "日期差用 `julianday(d1) - julianday(d2)`。",
        "浮点除法用 `CAST(x AS REAL) / y` 或 `1.0 * x / y`；整数除法会截断。",
        "字符串连接用 `||`，不支持 CONCAT()；条件表达式用 CASE，不使用 IF()。",
        "字符串截取用 `substr()`；不支持 SUBSTRING_INDEX()。",
        "不支持 information_schema，也不支持 LIMIT offset, count；使用 LIMIT count OFFSET offset。",
        "使用 COALESCE() 处理空值。",
      ].join("\n");
    case "mysql":
      return "数据库后端为 MySQL 业务库：系统表查询用 `SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()`；不要使用 sqlite_master。";
    case "bigquery":
      return "数据库后端为 BigQuery。使用 BigQuery Standard SQL；不要假设 SQLite 的 sqlite_master 或 MySQL 的 information_schema 可用。";
    case "snowflake":
      return "数据库后端为 Snowflake。使用 Snowflake SQL；不要假设 SQLite 的 sqlite_master 或 MySQL 的 information_schema 可用。";
  }
}

function dialectGuidance(databaseDialect?: DatabaseDialect): string {
  return databaseDialect
    ? dialectHint(databaseDialect)
    : "数据库方言由当前连接提供；不要默认假设 MySQL、SQLite 或其他方言。先参考知识库和查询工具返回的后端信息。";
}

export function unknownToolRecoveryMessage(errorText: string, toolNames: Iterable<string>): string | undefined {
  const match = /^Tool\s+([A-Za-z0-9_-]+)\s+not found\b/.exec(errorText.trim());
  if (!match) return undefined;
  const available = [...new Set(toolNames)];
  const clarificationFallback = match[1] === "ask_user_clarification"
    ? "Clarification is unavailable in this runtime. Resolve ambiguity by the most literal reading of the request; never invent thresholds, default values, date baselines, or unit conversions, and state the assumption in the final response."
    : undefined;
  return [
    `Tool "${match[1]}" does not exist in this runtime. Do not retry it.`,
    `Available tools: ${available.join(", ") || "none"}.`,
    "Use search_knowledge/read_knowledge for knowledge, query_database for read-only SQL, and export_query for final CSV delivery.",
    ...(clarificationFallback ? [clarificationFallback] : []),
  ].join("\n");
}

export function runtimeCapabilitiesPrompt(toolNames: Iterable<string>): string {
  const available = [...new Set(toolNames)];
  const unavailable = ["run_python", "show_widget", "generate_dashboard", "ask_user_clarification"].filter((name) => !available.includes(name));
  const clarificationFallback = unavailable.includes("ask_user_clarification")
    ? "Clarification is unavailable in this session. Resolve ambiguity by the most literal reading of the request; never invent thresholds, default values, date baselines, or unit conversions, and state the assumption in the final response."
    : undefined;
  return [
    "## Runtime capability contract",
    "Only tools present in the current tool list are available in this session. Never call an absent tool.",
    `Available tools: ${available.join(", ") || "none"}.`,
    ...(unavailable.length ? [`Unavailable tools: ${unavailable.join(", ")}. Do not retry them; complete the task with the available tools.`] : []),
    ...(clarificationFallback ? [clarificationFallback] : []),
  ].join("\n");
}

/**
 * Resolves the versioned system prompt from `.pi/SYSTEM.md` and appends only
 * active database dialect guidance. Tool names come from the canonical catalog.
 */
export async function resolveSystemPrompt(searchRoots: string[], databaseDialect?: DatabaseDialect): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  for (const root of searchRoots) {
    if (!root) continue;
    try {
      const migrated = await readFile(path.join(root, ".pi", "SYSTEM.md"), "utf8");
      return [migrated.trim(), dialectGuidance(databaseDialect)].filter(Boolean).join("\n\n");
    } catch { /* try next root */ }
  }
  throw new Error(`SYSTEM_PROMPT_NOT_FOUND: expected .pi/SYSTEM.md under ${searchRoots.filter(Boolean).join(", ") || "the configured system prompt roots"}`);
}

export async function createDataAgentHarness(deps: AgentAssemblyDeps, profile: AgentModelProfile): Promise<AgentHarness<AgentAssemblyToolContext>> {
  if (!profile.apiKey) throw new Error("LLM_API_KEY_MISSING");
  // Keep credentials scoped to this harness. Never place them in process.env,
  // because tool subprocesses (notably Python jobs) inherit that environment.
  const credentials = new InMemoryCredentialStore();
  const providerId = profile.provider === "anthropic" ? "anthropic" : profile.provider === "openrouter" ? "openrouter" : "openai";
  await credentials.modify(providerId, async () => ({ type: "api_key", key: profile.apiKey }));
  const models: Models = builtinModels({ credentials });
  const skillLoad = await loadSkillsFromRoots(resolveSkillRoots({ projectRoot: deps.projectRoot, packagedRoot: deps.packagedRoot }));
  for (const item of skillLoad.diagnostics) console.warn(`[data-agent] Skill diagnostic (${item.code ?? "warning"}) ${item.path}: ${item.message}`);
  let skills: DataAgentSkill[] = [];
  const queryAssurance = deps.queryAssurance ?? createReviewOffQueryAssurance();
  let activeTask: PreparedQueryTask | undefined;
  const baseToolContext = deps.toolContext ?? { sessionId: deps.sessionId };
  const toolContext: AgentAssemblyToolContextSource = async () => {
    const base = typeof baseToolContext === "function" ? await baseToolContext() : baseToolContext;
    return activeTask ? { ...base, taskId: activeTask.taskId, ...(activeTask.specVersion ? { specVersion: activeTask.specVersion } : {}) } : base;
  };
  const tools = buildAgentTools({
    ...deps,
    queryAssurance,
    toolContext,
    onTaskSpecVersionChanged: (taskId, specVersion) => {
      if (activeTask?.taskId === taskId) activeTask = { ...activeTask, specVersion };
      deps.onTaskSpecVersionChanged?.(taskId, specVersion);
    },
    invokeSkill: async (name, additionalInstructions) => {
      const skill = skills.find((candidate) => candidate.name === name);
      if (!skill) throw new Error(`SKILL_NOT_FOUND: ${name}`);
      const content = additionalInstructions
        ? `${skill.content}\n\nAdditional instructions:\n${additionalInstructions}`
        : skill.content;
      return { content: [{ type: "text", text: content }] };
    },
  });
  const registeredToolNames = new Set(tools.map((tool) => tool.name));
  // A Skill allowlist can only narrow the actual harness surface. In
  // particular, loading a Skill must never resurrect a capability that the
  // host intentionally omitted (for example Python in a minimal deployment).
  skills = skillLoad.skills.map((skill) => skill.allowedTools === undefined
    ? skill
    : { ...skill, allowedTools: skill.allowedTools.filter((name) => registeredToolNames.has(name)) });
  const baseSystemPrompt = deps.systemPrompt
    ? [deps.systemPrompt.trim(), dialectGuidance(deps.databaseDialect)].filter(Boolean).join("\n\n")
    : await resolveSystemPrompt(deps.systemPromptRoots ?? (deps.knowledgeRoot ? [deps.knowledgeRoot] : []), deps.databaseDialect);
  const capabilityPrompt = runtimeCapabilitiesPrompt(registeredToolNames);
  const harness = new DataAgentHarness({
    session: deps.session ?? await new InMemorySessionRepo().create(),
    models,
    model: buildModel(profile),
    ...(deps.providerTimeoutMs !== undefined ? { streamOptions: { timeoutMs: Math.max(1, deps.providerTimeoutMs) } } : {}),
    thinkingLevel: "off",
    // Use Pi's per-turn prompt callback rather than freezing a prompt string.
    // The callback receives the current resources snapshot, so a later
    // setResources() immediately changes the model-visible skill catalog.
    systemPrompt: ({ resources }) => composeDataAgentSystemPrompt(`${baseSystemPrompt}\n\n${capabilityPrompt}`, resources.skills ?? []),
    tools,
    resources: { skills },
    toolContext,
  }, async (text, signal) => {
    activeTask = await queryAssurance.prepareTask({
      question: text,
      ...(deps.databaseDialect ? { dialect: deps.databaseDialect } : {}),
      ...(deps.schemaEvidence ? { schema: deps.schemaEvidence } : {}),
    }, signal);
    return activeTask;
  }, async (task) => Boolean(
    deps.enforceDeliveryReceipt !== false
      && queryAssurance.hasInternalEvidence?.(task.taskId)
      && !queryAssurance.hasPublication?.(task.taskId),
  ));
  harness.subscribe((event) => {
    if (event?.type !== "tool_execution_end" || !event.isError) return;
    const content = event.result?.content;
    const errorText = Array.isArray(content)
      ? content.find((item: unknown) => asRecord(item)?.type === "text" && typeof asRecord(item)?.text === "string")
      : undefined;
    const guidance = unknownToolRecoveryMessage(String(asRecord(errorText)?.text ?? ""), registeredToolNames);
    if (guidance) void harness.steer(guidance).catch(() => undefined);
  });
  return harness;
}
