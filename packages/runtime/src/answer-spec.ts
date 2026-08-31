import { randomUUID } from "node:crypto";
import type { SchemaEvidence } from "./query-digest.js";

export const EVIDENCE_AUTHORITY_ORDER = [
  "user_clarification",
  "reviewed_semantic_model",
  "task_document",
  "request_wording",
  "schema_structure",
  "observed_data",
  "model_inference",
] as const;

export type EvidenceAuthority = typeof EVIDENCE_AUTHORITY_ORDER[number];

export interface EvidenceReference {
  readonly authority: EvidenceAuthority;
  readonly source: string;
}

export interface ConstraintInput {
  readonly statement: string;
  readonly authority: EvidenceAuthority;
  readonly scope: string;
  readonly source?: string;
  /** Schema evidence can create only structural constraints. */
  readonly structural?: boolean;
}

export interface HypothesisInput {
  readonly statement: string;
  readonly scope: string;
  readonly confidence?: number;
  readonly authority?: EvidenceAuthority;
  readonly source?: string;
}

export interface AmbiguityInput {
  readonly question: string;
  readonly alternatives: readonly string[];
  readonly scope: string;
  readonly source?: string;
}

export type AnswerRowMode = "scalar" | "top_n" | "grouped" | "full";

/** The structured facets used to compare a request with a Query Digest. */
export type AnswerMeasureKind = "count" | "count_distinct" | "sum" | "avg" | "min" | "max" | "ratio" | "difference" | "unknown";
export type AnswerUnitKind = "absolute" | "count" | "currency" | "ratio" | "percentage";
export type AnswerRoundingMode = "preserve" | "decimal_places" | "significant_digits";
export type AnswerTiePolicy = "strict" | "include_ties" | "unspecified";

export interface AnswerOutputConstraint {
  readonly columns: readonly string[];
  readonly rowMode?: AnswerRowMode;
  readonly rowCount?: number;
}

export interface AnswerGrainConstraint {
  readonly entity?: string;
  readonly keyColumns: readonly string[];
}

export interface AnswerMeasureConstraint {
  readonly kind: AnswerMeasureKind;
  readonly name?: string;
  readonly expression?: string;
  readonly distinctKey?: string;
}

export interface AnswerDenominatorConstraint {
  readonly expression: string;
  readonly population?: string;
  readonly zeroPolicy?: "null" | "zero" | "exclude" | "unspecified";
}

export interface AnswerRankingConstraint {
  readonly n: number;
  readonly partitionBy: readonly string[];
  readonly orderBy: string;
  readonly tiePolicy?: AnswerTiePolicy;
}

export interface AnswerTimeConstraint {
  readonly displayWindow?: string;
  readonly lookback?: string;
  readonly asOf?: string;
  readonly boundary?: "inclusive" | "exclusive" | "mixed" | "unspecified";
}

export interface AnswerUnitConstraint {
  readonly kind: AnswerUnitKind;
  readonly scale?: "0-1" | "0-100" | "native";
  readonly currency?: string;
}

export interface AnswerRoundingConstraint {
  readonly mode: AnswerRoundingMode;
  readonly places?: number;
}

export interface StructuredConstraintInput<T> {
  readonly value: T;
  readonly authority: EvidenceAuthority;
  readonly source?: string;
  /** An exact question/document quote can make a planner extraction auditable. */
  readonly quote?: string;
  /** Required when schema_structure is used; it may only assert structure. */
  readonly structural?: boolean;
}

export interface StructuredConstraint<T> {
  readonly value: T;
  readonly binding: "hard" | "hypothesis";
  readonly provenance: EvidenceReference;
  readonly quote?: string;
}

export interface AnswerContractInput {
  readonly output?: StructuredConstraintInput<AnswerOutputConstraint>;
  readonly grain?: StructuredConstraintInput<AnswerGrainConstraint>;
  readonly measures?: readonly StructuredConstraintInput<AnswerMeasureConstraint>[];
  readonly denominator?: StructuredConstraintInput<AnswerDenominatorConstraint>;
  readonly ranking?: StructuredConstraintInput<AnswerRankingConstraint>;
  readonly time?: StructuredConstraintInput<AnswerTimeConstraint>;
  readonly unit?: StructuredConstraintInput<AnswerUnitConstraint>;
  readonly rounding?: StructuredConstraintInput<AnswerRoundingConstraint>;
}

export interface AnswerContract {
  readonly output?: StructuredConstraint<AnswerOutputConstraint>;
  readonly grain?: StructuredConstraint<AnswerGrainConstraint>;
  readonly measures?: readonly StructuredConstraint<AnswerMeasureConstraint>[];
  readonly denominator?: StructuredConstraint<AnswerDenominatorConstraint>;
  readonly ranking?: StructuredConstraint<AnswerRankingConstraint>;
  readonly time?: StructuredConstraint<AnswerTimeConstraint>;
  readonly unit?: StructuredConstraint<AnswerUnitConstraint>;
  readonly rounding?: StructuredConstraint<AnswerRoundingConstraint>;
}

export interface AnswerSpecInput {
  readonly taskId: string;
  readonly question: string;
  /** Legacy shape fields; normalized into answerContract.output. */
  readonly outputColumns?: readonly string[];
  readonly rowMode?: AnswerRowMode;
  readonly rowCount?: number;
  readonly answerContract?: AnswerContractInput;
  readonly clarifications?: readonly string[];
  readonly constraints?: readonly ConstraintInput[];
  /** Planner compatibility: legacy generators may return a bare statement. */
  readonly hypotheses?: readonly (HypothesisInput | string)[];
  /** Planner compatibility: legacy generators may return a bare ambiguity question. */
  readonly ambiguities?: readonly (AmbiguityInput | string)[];
  /** Formal schema may inform a planner, but observed rows are never included. */
  readonly schema?: SchemaEvidence;
}

export interface HardConstraint {
  readonly id: string;
  readonly statement: string;
  readonly scope: string;
  readonly provenance: EvidenceReference;
}

export interface Hypothesis {
  readonly id: string;
  readonly statement: string;
  readonly scope: string;
  readonly confidence?: number;
  readonly provenance: EvidenceReference;
}

export interface Ambiguity {
  readonly id: string;
  readonly question: string;
  readonly alternatives: readonly string[];
  readonly scope: string;
  readonly provenance?: EvidenceReference;
}

export interface AnswerSpec {
  readonly taskId: string;
  readonly specVersion: string;
  readonly question: string;
  /** Machine-readable request facets. Missing fields are unresolved, not defaults. */
  readonly answerContract: AnswerContract;
  /** @deprecated Read answerContract.output.value instead. */
  readonly outputColumns?: readonly string[];
  /** @deprecated Read answerContract.output.value.rowMode instead. */
  readonly rowMode?: AnswerRowMode;
  /** @deprecated Read answerContract.output.value.rowCount instead. */
  readonly rowCount?: number;
  readonly hardConstraints: readonly HardConstraint[];
  readonly hypotheses: readonly Hypothesis[];
  readonly ambiguities: readonly Ambiguity[];
  readonly provenance: readonly EvidenceReference[];
}

export interface SpecChangeProposal {
  readonly proposalId?: string;
  readonly taskId: string;
  readonly baseSpecVersion: string;
  readonly statement: string;
  readonly authority: EvidenceAuthority;
  readonly scope: string;
  readonly source?: string;
  readonly structural?: boolean;
}

export interface RejectedSpecChange {
  readonly accepted: false;
  readonly proposal: SpecChangeProposal & { readonly proposalId: string };
  readonly reason: "SOLVER_PROPOSAL_REQUIRES_AUTHORITY";
}

export interface BusinessDefinitionProposal {
  readonly proposalId: string;
  readonly taskId: string;
  readonly statement: string;
  readonly evidence: readonly EvidenceReference[];
  readonly status: "pending_business_review";
}

export function isHardConstraintEligible(input: ConstraintInput | StructuredConstraintInput<unknown>): boolean {
  return input.authority !== "model_inference"
    && input.authority !== "observed_data"
    && (input.authority !== "schema_structure" || input.structural === true);
}

function reference(input: { authority: EvidenceAuthority; source?: string }): EvidenceReference {
  return { authority: input.authority, source: input.source ?? "task-evidence" };
}

function makeHardConstraint(input: ConstraintInput, index: number): HardConstraint {
  return {
    id: `HC-${index + 1}`,
    statement: input.statement,
    scope: input.scope,
    provenance: reference(input),
  };
}

function makeHypothesis(input: HypothesisInput | ConstraintInput | string, index: number): Hypothesis {
  if (typeof input === "string") input = { statement: input.trim(), scope: "task", authority: "model_inference", source: "planner:hypotheses" };
  if (!input.statement) throw new Error("ANSWER_SPEC_HYPOTHESIS_INVALID");
  const authority = input.authority ?? "model_inference";
  return {
    id: `HY-${index + 1}`,
    statement: input.statement,
    scope: input.scope,
    ...("confidence" in input && input.confidence !== undefined ? { confidence: input.confidence } : {}),
    provenance: reference({ authority, source: input.source }),
  };
}

function makeAmbiguity(input: AmbiguityInput | string, index: number): Ambiguity {
  if (typeof input === "string") input = { question: input.trim(), alternatives: [], scope: "task", source: "planner:ambiguities" };
  if (!input.question) throw new Error("ANSWER_SPEC_AMBIGUITY_INVALID");
  return {
    id: `AM-${index + 1}`,
    question: input.question,
    alternatives: [...input.alternatives],
    scope: input.scope,
    ...(input.source ? { provenance: { authority: "model_inference", source: input.source } } : {}),
  };
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, cloneValue(item)])) as T;
  }
  return value;
}

function validateContractValue(input: AnswerContractInput): void {
  const output = input.output?.value;
  if (output) {
    if (!Array.isArray(output.columns) || output.columns.some((column) => typeof column !== "string" || !column.trim()) || new Set(output.columns).size !== output.columns.length) throw new Error("ANSWER_SPEC_OUTPUT_COLUMNS_INVALID");
    if (output.rowMode !== undefined && !["scalar", "top_n", "grouped", "full"].includes(output.rowMode)) throw new Error("ANSWER_SPEC_ROW_MODE_INVALID");
    if (output.rowCount !== undefined && (!Number.isInteger(output.rowCount) || output.rowCount < 0)) throw new Error("ANSWER_SPEC_ROW_COUNT_INVALID");
  }
  const grain = input.grain?.value;
  if (grain && (!Array.isArray(grain.keyColumns) || grain.keyColumns.some((column) => typeof column !== "string" || !column.trim()))) throw new Error("ANSWER_SPEC_GRAIN_INVALID");
  if (input.measures !== undefined && !Array.isArray(input.measures)) throw new Error("ANSWER_SPEC_MEASURES_INVALID");
  for (const measure of input.measures ?? []) {
    if (!measure || !measure.value || !["count", "count_distinct", "sum", "avg", "min", "max", "ratio", "difference", "unknown"].includes(measure.value.kind)) throw new Error("ANSWER_SPEC_MEASURE_INVALID");
  }
  if (input.denominator && (!input.denominator.value || typeof input.denominator.value.expression !== "string" || !input.denominator.value.expression.trim())) throw new Error("ANSWER_SPEC_DENOMINATOR_INVALID");
  if (input.ranking && (!input.ranking.value || !Number.isInteger(input.ranking.value.n) || input.ranking.value.n < 1 || typeof input.ranking.value.orderBy !== "string" || !input.ranking.value.orderBy.trim())) throw new Error("ANSWER_SPEC_RANKING_INVALID");
  if (input.rounding?.value.places !== undefined && (!Number.isInteger(input.rounding.value.places) || input.rounding.value.places < 0)) throw new Error("ANSWER_SPEC_ROUNDING_INVALID");
}

function structuredStringValues(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap((item) => structuredStringValues(item));
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap((item) => structuredStringValues(item));
  return [];
}

function makeStructuredConstraint<T>(input: StructuredConstraintInput<T>, question: string): StructuredConstraint<T> {
  const quote = input.quote?.trim();
  const valueStrings = structuredStringValues(input.value).filter((item) => item.length >= 2);
  const plannerExtractionIsGrounded = input.authority !== "request_wording"
    || !input.source?.startsWith("planner:")
    || (Boolean(quote) && question.includes(quote!) && valueStrings.every((item) => quote!.toLowerCase().includes(item.toLowerCase())));
  const binding = plannerExtractionIsGrounded && isHardConstraintEligible(input) ? "hard" : "hypothesis";
  return {
    value: cloneValue(input.value),
    binding,
    provenance: reference(input),
    ...(input.quote?.trim() ? { quote: input.quote.trim() } : {}),
  };
}

function legacyOutputConstraint(input: AnswerSpecInput): StructuredConstraintInput<AnswerOutputConstraint> | undefined {
  if (input.outputColumns === undefined && input.rowMode === undefined && input.rowCount === undefined) return undefined;
  return {
    value: {
      columns: [...(input.outputColumns ?? [])],
      ...(input.rowMode ? { rowMode: input.rowMode } : {}),
      ...(input.rowCount !== undefined ? { rowCount: input.rowCount } : {}),
    },
    authority: "request_wording",
    source: "legacy-answer-shape",
    quote: input.question,
  };
}

function normalizeAnswerContract(input: AnswerSpecInput): AnswerContract {
  const supplied = input.answerContract ?? {};
  const output = supplied.output ?? legacyOutputConstraint(input);
  validateContractValue({ ...supplied, ...(output ? { output } : {}) });
  return {
    ...(output ? { output: makeStructuredConstraint(output, input.question) } : {}),
    ...(supplied.grain ? { grain: makeStructuredConstraint(supplied.grain, input.question) } : {}),
    ...(supplied.measures ? { measures: supplied.measures.map((item) => makeStructuredConstraint(item, input.question)) } : {}),
    ...(supplied.denominator ? { denominator: makeStructuredConstraint(supplied.denominator, input.question) } : {}),
    ...(supplied.ranking ? { ranking: makeStructuredConstraint(supplied.ranking, input.question) } : {}),
    ...(supplied.time ? { time: makeStructuredConstraint(supplied.time, input.question) } : {}),
    ...(supplied.unit ? { unit: makeStructuredConstraint(supplied.unit, input.question) } : {}),
    ...(supplied.rounding ? { rounding: makeStructuredConstraint(supplied.rounding, input.question) } : {}),
  };
}

function contractProvenance(contract: AnswerContract): EvidenceReference[] {
  const fields: Array<StructuredConstraint<unknown> | readonly StructuredConstraint<unknown>[] | undefined> = [
    contract.output,
    contract.grain,
    contract.measures,
    contract.denominator,
    contract.ranking,
    contract.time,
    contract.unit,
    contract.rounding,
  ];
  const result: EvidenceReference[] = [];
  for (const field of fields) {
    if (Array.isArray(field)) result.push(...(field as readonly StructuredConstraint<unknown>[]).map((item) => item.provenance));
    else if (field) result.push((field as StructuredConstraint<unknown>).provenance);
  }
  return result;
}

function cloneAnswerContract(contract: AnswerContract): AnswerContract {
  return {
    ...(contract.output ? { output: { ...contract.output, value: cloneValue(contract.output.value), provenance: { ...contract.output.provenance } } } : {}),
    ...(contract.grain ? { grain: { ...contract.grain, value: cloneValue(contract.grain.value), provenance: { ...contract.grain.provenance } } } : {}),
    ...(contract.measures ? { measures: contract.measures.map((item) => ({ ...item, value: cloneValue(item.value), provenance: { ...item.provenance } })) } : {}),
    ...(contract.denominator ? { denominator: { ...contract.denominator, value: cloneValue(contract.denominator.value), provenance: { ...contract.denominator.provenance } } } : {}),
    ...(contract.ranking ? { ranking: { ...contract.ranking, value: cloneValue(contract.ranking.value), provenance: { ...contract.ranking.provenance } } } : {}),
    ...(contract.time ? { time: { ...contract.time, value: cloneValue(contract.time.value), provenance: { ...contract.time.provenance } } } : {}),
    ...(contract.unit ? { unit: { ...contract.unit, value: cloneValue(contract.unit.value), provenance: { ...contract.unit.provenance } } } : {}),
    ...(contract.rounding ? { rounding: { ...contract.rounding, value: cloneValue(contract.rounding.value), provenance: { ...contract.rounding.provenance } } } : {}),
  };
}

export function createAnswerSpec(input: AnswerSpecInput): AnswerSpec {
  const constraints = [...(input.constraints ?? [])];
  for (const clarification of input.clarifications ?? []) {
    constraints.push({ statement: clarification, authority: "user_clarification", scope: "task", source: "user-clarification" });
  }
  const hardConstraints: HardConstraint[] = [];
  const hypotheses: Hypothesis[] = [...(input.hypotheses ?? []).map((item, index) => makeHypothesis(item, index))];
  for (const constraint of constraints) {
    if (isHardConstraintEligible(constraint)) hardConstraints.push(makeHardConstraint(constraint, hardConstraints.length));
    else hypotheses.push(makeHypothesis(constraint, hypotheses.length));
  }
  const answerContract = normalizeAnswerContract(input);
  const provenance = [
    ...constraints.map((item) => reference(item)),
    ...(input.hypotheses ?? []).map((item) => {
      const normalized = typeof item === "string" ? { authority: "model_inference" as const, source: "planner:hypotheses" } : item;
      return reference({ authority: normalized.authority ?? "model_inference", source: normalized.source });
    }),
    ...(input.clarifications ?? []).map(() => ({ authority: "user_clarification" as const, source: "user-clarification" })),
    ...contractProvenance(answerContract),
  ];
  return {
    taskId: input.taskId,
    specVersion: "1",
    question: input.question,
    answerContract,
    ...(input.outputColumns ? { outputColumns: [...input.outputColumns] } : {}),
    ...(input.rowMode ? { rowMode: input.rowMode } : {}),
    ...(input.rowCount !== undefined ? { rowCount: input.rowCount } : {}),
    hardConstraints,
    hypotheses,
    ambiguities: (input.ambiguities ?? []).map((item, index) => makeAmbiguity(item, index)),
    provenance,
  };
}

function cloneSpec(spec: AnswerSpec, specVersion: string, hardConstraints: readonly HardConstraint[], hypotheses = spec.hypotheses, ambiguities = spec.ambiguities): AnswerSpec {
  return {
    ...spec,
    specVersion,
    answerContract: cloneAnswerContract(spec.answerContract),
    hardConstraints: hardConstraints.map((item) => ({ ...item, provenance: { ...item.provenance } })),
    hypotheses: hypotheses.map((item) => ({ ...item, provenance: { ...item.provenance } })),
    ambiguities: ambiguities.map((item) => ({ ...item, alternatives: [...item.alternatives], ...(item.provenance ? { provenance: { ...item.provenance } } : {}) })),
    provenance: spec.provenance.map((item) => ({ ...item })),
  };
}

export interface AnswerSpecGenerator {
  generate(input: AnswerSpecInput, signal: AbortSignal): Promise<AnswerSpecInput>;
}

export function createAnswerSpecGenerator(): AnswerSpecGenerator {
  return { async generate(input) { return input; } };
}

export interface SpecAuthority {
  prepare(input: AnswerSpecInput): AnswerSpec;
  get(taskId: string, specVersion?: string): AnswerSpec | undefined;
  applyClarification(taskId: string, baseSpecVersion: string, clarification: string): AnswerSpec;
  submitProposal(proposal: SpecChangeProposal): RejectedSpecChange;
  applyAuthoritativeChange(taskId: string, baseSpecVersion: string, change: ConstraintInput): AnswerSpec;
}

/**
 * Owns Answer Spec versions. Solver proposals are deliberately recorded as
 * rejected proposals and cannot mutate the version chain.
 */
export function createSpecAuthority(): SpecAuthority {
  const versions = new Map<string, AnswerSpec[]>();
  const proposals = new Map<string, RejectedSpecChange>();

  const current = (taskId: string, specVersion: string): AnswerSpec => {
    const spec = versions.get(taskId)?.find((item) => item.specVersion === specVersion);
    if (!spec) throw new Error(`ANSWER_SPEC_NOT_FOUND:${taskId}:${specVersion}`);
    return spec;
  };

  const append = (spec: AnswerSpec): AnswerSpec => {
    const history = versions.get(spec.taskId) ?? [];
    history.push(spec);
    versions.set(spec.taskId, history);
    return spec;
  };

  return {
    prepare(input) {
      if (!input.taskId || !input.question.trim()) throw new Error("ANSWER_SPEC_INPUT_INVALID");
      const spec = createAnswerSpec(input);
      return append(spec);
    },
    get(taskId, specVersion) {
      const history = versions.get(taskId);
      return specVersion ? history?.find((item) => item.specVersion === specVersion) : history?.at(-1);
    },
    applyClarification(taskId, baseSpecVersion, clarification) {
      if (!clarification.trim()) throw new Error("ANSWER_SPEC_CLARIFICATION_EMPTY");
      const base = current(taskId, baseSpecVersion);
      const nextConstraint: HardConstraint = {
        id: `HC-${base.hardConstraints.length + 1}`,
        statement: clarification,
        scope: "task",
        provenance: { authority: "user_clarification", source: "user-clarification" },
      };
      return append(cloneSpec(base, String(Number(base.specVersion) + 1), [...base.hardConstraints, nextConstraint]));
    },
    submitProposal(proposal) {
      const rejected: RejectedSpecChange = {
        accepted: false,
        proposal: { ...proposal, proposalId: proposal.proposalId ?? randomUUID() },
        reason: "SOLVER_PROPOSAL_REQUIRES_AUTHORITY",
      };
      proposals.set(rejected.proposal.proposalId, rejected);
      return rejected;
    },
    applyAuthoritativeChange(taskId, baseSpecVersion, change) {
      if (!isHardConstraintEligible(change)) throw new Error("ANSWER_SPEC_HARD_CONSTRAINT_EVIDENCE_INSUFFICIENT");
      const base = current(taskId, baseSpecVersion);
      const nextConstraint = makeHardConstraint(change, base.hardConstraints.length);
      return append(cloneSpec(base, String(Number(base.specVersion) + 1), [...base.hardConstraints, nextConstraint]));
    },
  };
}
