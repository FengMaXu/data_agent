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
  /** Stable evidence identity when the source is persisted in Evidence Store. */
  readonly evidenceId?: string;
  readonly sourceKind?: string;
  readonly sourceIdentity?: string;
  readonly sourceRevision?: string | number;
  readonly locator?: string;
  readonly quotedValue?: string;
  readonly contentHash?: string;
  readonly capturedAt?: string;
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

export type AnswerRowMode = "scalar" | "top_n" | "grouped" | "full" | "detail";

/** The structured facets used to compare a request with a Query Digest. */
export type AnswerMeasureKind = "count" | "count_distinct" | "sum" | "avg" | "min" | "max" | "ratio" | "difference" | "unknown";
export type AnswerUnitKind = "absolute" | "count" | "currency" | "ratio" | "percentage";
export type AnswerRoundingMode = "preserve" | "decimal_places" | "significant_digits";
export type AnswerTiePolicy = "strict" | "include_ties" | "unspecified";

export interface AnswerOutputField {
  readonly semanticRole?: string;
  readonly label?: string;
  readonly type?: string;
  readonly required?: boolean;
  readonly position?: number;
}

export interface AnswerRowCountRange {
  readonly exact?: number;
  readonly min?: number;
  readonly max?: number;
}

export interface AnswerOutputConstraint {
  readonly columns: readonly string[];
  readonly rowMode?: AnswerRowMode;
  /** Legacy exact count; rowCountRange is preferred for new contracts. */
  readonly rowCount?: number;
  readonly rowCountRange?: AnswerRowCountRange;
  readonly schema?: readonly AnswerOutputField[];
  readonly outputSchema?: readonly AnswerOutputField[];
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
  readonly entity?: string;
  readonly sourceRelation?: string;
  readonly sourceGrain?: string;
  readonly aggregation?: string;
  readonly distinctPolicy?: "none" | "distinct" | "unspecified";
  readonly population?: string;
  readonly numerator?: string;
  readonly denominator?: string;
  readonly nullPolicy?: "include" | "exclude" | "null" | "unspecified";
}

export interface AnswerDenominatorConstraint {
  readonly expression: string;
  readonly population?: string;
  readonly zeroPolicy?: "null" | "zero" | "exclude" | "unspecified";
}

export interface AnswerJoinConstraint {
  readonly left: string;
  readonly right: string;
  /** Shared key list for simple fixtures; side-specific keys are preferred. */
  readonly keys: readonly string[];
  readonly leftKeys?: readonly string[];
  readonly rightKeys?: readonly string[];
  readonly expectedCardinality?: "1:1" | "1:N" | "N:1" | "N:M" | "unknown";
  readonly preservedSide?: "left" | "right" | "none" | "unknown";
  readonly fanoutAllowed?: boolean;
  readonly measureEffect?: string;
  readonly evidenceRefs?: readonly string[];
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

export interface PhysicalMappingEvidence {
  readonly mappingId: string;
  readonly hardConstraintId: string;
  readonly physicalField: string;
  readonly physicalValue?: string;
  readonly authority: "reviewed_semantic_model" | "schema_structure" | "observed_data";
  readonly source: string;
  readonly evidenceId?: string;
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
  readonly joins?: readonly StructuredConstraintInput<AnswerJoinConstraint>[];
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
  readonly joins?: readonly StructuredConstraint<AnswerJoinConstraint>[];
}

export interface SemanticEvidenceExcerpt {
  readonly id: string;
  readonly authority: "task_document" | "reviewed_semantic_model";
  readonly path: string;
  readonly title: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly revision: number;
  /** Bounded evidence text; it is data, never executable instructions. */
  readonly content: string;
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
  readonly conflicts?: readonly ConflictRecord[];
  /** Formal schema may inform a planner, but observed rows are never included. */
  readonly schema?: SchemaEvidence;
  /** Runtime-retrieved business evidence available to the independent planner. */
  readonly semanticEvidence?: readonly SemanticEvidenceExcerpt[];
  /** Runtime-owned physical field/value mappings; never inferred from rows by the planner. */
  readonly physicalMappings?: readonly PhysicalMappingEvidence[];
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

export interface ConflictRecord {
  readonly conflictId: string;
  readonly scope: string;
  readonly evidenceRefs: readonly EvidenceReference[];
  readonly authorityLevels: readonly EvidenceAuthority[];
  readonly conflictKind: string;
  readonly resolution: "higher_authority" | "user_clarification" | "unresolved";
  readonly status: "open" | "resolved";
  readonly resolvedBy?: string;
}

export interface ConflictResolutionInput {
  readonly conflictId: string;
  readonly resolution: "higher_authority" | "user_clarification";
  readonly evidenceRefs?: readonly EvidenceReference[];
  readonly resolvedBy?: string;
  /** Optional user wording to be added as the new task-scoped constraint. */
  readonly clarification?: string;
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
  readonly conflicts?: readonly ConflictRecord[];
  readonly provenance: readonly EvidenceReference[];
  readonly physicalMappings?: readonly PhysicalMappingEvidence[];
}

export interface SpecChangeProposal {
  readonly proposalId?: string;
  readonly taskId: string;
  readonly baseSpecVersion: string;
  readonly statement: string;
  /** Solver-provided authority is informational and is re-derived below. */
  readonly authority: EvidenceAuthority;
  readonly scope: string;
  readonly source?: string;
  readonly structural?: boolean;
  readonly evidence?: readonly EvidenceReference[];
}

export interface TrustedEvidenceStore {
  get(evidenceId: string): EvidenceReference | undefined;
}

/** Minimal trusted Evidence Store for hosts/tests; it is not populated by Solver claims. */
export class InMemoryEvidenceStore implements TrustedEvidenceStore {
  private readonly references = new Map<string, EvidenceReference>();

  constructor(references: readonly EvidenceReference[] = []) {
    for (const reference of references) this.put(reference);
  }

  put(reference: EvidenceReference): void {
    if (!reference.evidenceId?.trim()) throw new Error("EVIDENCE_ID_REQUIRED");
    this.references.set(reference.evidenceId, { ...reference });
  }

  get(evidenceId: string): EvidenceReference | undefined {
    const reference = this.references.get(evidenceId);
    return reference ? { ...reference } : undefined;
  }
}

export interface AcceptedSpecChange {
  readonly accepted: true;
  readonly proposal: SpecChangeProposal & { readonly proposalId: string };
  readonly spec: AnswerSpec;
}

export interface RejectedSpecChange {
  readonly accepted: false;
  readonly proposal: SpecChangeProposal & { readonly proposalId: string };
  readonly reason: "SOLVER_PROPOSAL_REQUIRES_AUTHORITY" | "SPEC_PROPOSAL_EVIDENCE_UNAVAILABLE" | "SPEC_PROPOSAL_EVIDENCE_INSUFFICIENT";
}

export type SpecChangeResult = AcceptedSpecChange | RejectedSpecChange;

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

function makeHardConstraint(input: ConstraintInput, index: number, evidence?: EvidenceReference): HardConstraint {
  return {
    id: `HC-${index + 1}`,
    statement: input.statement,
    scope: input.scope,
    provenance: evidence ?? reference(input),
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

function validateConflicts(conflicts: readonly ConflictRecord[] | undefined): void {
  if (conflicts === undefined) return;
  if (!Array.isArray(conflicts) || conflicts.some((conflict) => !conflict
    || typeof conflict.conflictId !== "string" || !conflict.conflictId.trim()
    || typeof conflict.scope !== "string" || !conflict.scope.trim()
    || typeof conflict.conflictKind !== "string" || !conflict.conflictKind.trim()
    || !Array.isArray(conflict.evidenceRefs)
    || !Array.isArray(conflict.authorityLevels)
    || conflict.authorityLevels.some((authority: unknown) => !EVIDENCE_AUTHORITY_ORDER.includes(authority as EvidenceAuthority))
    || !["higher_authority", "user_clarification", "unresolved"].includes(conflict.resolution)
    || !["open", "resolved"].includes(conflict.status))) throw new Error("ANSWER_SPEC_CONFLICT_INVALID");
}

function validateContractValue(input: AnswerContractInput): void {
  const output = input.output?.value;
  if (output) {
    if (!Array.isArray(output.columns) || output.columns.some((column) => typeof column !== "string" || !column.trim()) || new Set(output.columns).size !== output.columns.length) throw new Error("ANSWER_SPEC_OUTPUT_COLUMNS_INVALID");
    if (output.rowMode !== undefined && !["scalar", "top_n", "grouped", "full", "detail"].includes(output.rowMode)) throw new Error("ANSWER_SPEC_ROW_MODE_INVALID");
    if (output.rowCount !== undefined && (!Number.isInteger(output.rowCount) || output.rowCount < 0)) throw new Error("ANSWER_SPEC_ROW_COUNT_INVALID");
    if (output.rowCountRange?.exact !== undefined && output.rowCount !== undefined && output.rowCountRange.exact !== output.rowCount) throw new Error("ANSWER_SPEC_ROW_COUNT_RANGE_INVALID");
    if (output.rowCountRange) {
      const { exact, min, max } = output.rowCountRange;
      if ([exact, min, max].some((value) => value !== undefined && (!Number.isInteger(value) || value < 0))) throw new Error("ANSWER_SPEC_ROW_COUNT_RANGE_INVALID");
      if (exact !== undefined && (min !== undefined || max !== undefined)) throw new Error("ANSWER_SPEC_ROW_COUNT_RANGE_INVALID");
      if (min !== undefined && max !== undefined && min > max) throw new Error("ANSWER_SPEC_ROW_COUNT_RANGE_INVALID");
    }
    for (const schema of [output.schema, output.outputSchema]) if (schema !== undefined && (!Array.isArray(schema) || schema.some((field) => !field || typeof field !== "object"))) throw new Error("ANSWER_SPEC_OUTPUT_SCHEMA_INVALID");
  }
  const grain = input.grain?.value;
  if (grain && (!Array.isArray(grain.keyColumns) || grain.keyColumns.some((column) => typeof column !== "string" || !column.trim()))) throw new Error("ANSWER_SPEC_GRAIN_INVALID");
  if (input.measures !== undefined && !Array.isArray(input.measures)) throw new Error("ANSWER_SPEC_MEASURES_INVALID");
  for (const measure of input.measures ?? []) {
    if (!measure || !measure.value || !["count", "count_distinct", "sum", "avg", "min", "max", "ratio", "difference", "unknown"].includes(measure.value.kind)) throw new Error("ANSWER_SPEC_MEASURE_INVALID");
  }
  if (input.joins !== undefined && (!Array.isArray(input.joins) || input.joins.some((join) => {
    const value = join?.value;
    return !value
      || typeof value.left !== "string" || !value.left.trim()
      || typeof value.right !== "string" || !value.right.trim()
      || !Array.isArray(value.keys) || value.keys.some((key: unknown) => typeof key !== "string" || !key.trim())
      || value.expectedCardinality !== undefined && !["1:1", "1:N", "N:1", "N:M", "unknown"].includes(value.expectedCardinality)
      || value.preservedSide !== undefined && !["left", "right", "none", "unknown"].includes(value.preservedSide);
  }))) throw new Error("ANSWER_SPEC_JOINS_INVALID");
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
    ...(supplied.joins ? { joins: supplied.joins.map((item) => makeStructuredConstraint(item, input.question)) } : {}),
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
    contract.joins,
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
    ...(contract.joins ? { joins: contract.joins.map((item) => ({ ...item, value: cloneValue(item.value), provenance: { ...item.provenance } })) } : {}),
  };
}

export function createAnswerSpec(input: AnswerSpecInput): AnswerSpec {
  validateConflicts(input.conflicts);
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
    ...(input.conflicts?.length ? { conflicts: input.conflicts.map((conflict) => ({ ...conflict, evidenceRefs: conflict.evidenceRefs.map((reference) => ({ ...reference })), authorityLevels: [...conflict.authorityLevels] })) } : {}),
    provenance,
    ...(input.physicalMappings?.length ? { physicalMappings: input.physicalMappings.map((mapping) => ({ ...mapping })) } : {}),
  };
}

function cloneSpec(spec: AnswerSpec, specVersion: string, hardConstraints: readonly HardConstraint[], hypotheses = spec.hypotheses, ambiguities = spec.ambiguities, conflicts = spec.conflicts): AnswerSpec {
  return {
    ...spec,
    specVersion,
    answerContract: cloneAnswerContract(spec.answerContract),
    hardConstraints: hardConstraints.map((item) => ({ ...item, provenance: { ...item.provenance } })),
    hypotheses: hypotheses.map((item) => ({ ...item, provenance: { ...item.provenance } })),
    ambiguities: ambiguities.map((item) => ({ ...item, alternatives: [...item.alternatives], ...(item.provenance ? { provenance: { ...item.provenance } } : {}) })),
    ...(conflicts ? { conflicts: conflicts.map((conflict) => ({ ...conflict, evidenceRefs: conflict.evidenceRefs.map((reference) => ({ ...reference })), authorityLevels: [...conflict.authorityLevels] })) } : {}),
    ...(spec.physicalMappings ? { physicalMappings: spec.physicalMappings.map((mapping) => ({ ...mapping })) } : {}),
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
  resolveConflict?(taskId: string, baseSpecVersion: string, resolution: ConflictResolutionInput): AnswerSpec;
  applyAuthoritativeChange(taskId: string, baseSpecVersion: string, change: ConstraintInput): AnswerSpec;
  /** Trusted evidence resolver used for solver proposals. */
  submitProposal(proposal: SpecChangeProposal): SpecChangeResult;
  /** Optional persistence seam for the trusted Enforce coordinator. */
  snapshot?(): readonly AnswerSpec[];
  restore?(specs: readonly AnswerSpec[]): void;
}

/**
 * Owns Answer Spec versions. Solver proposals can only mutate the version
 * chain when a trusted evidence resolver independently admits their evidence.
 */
export function createSpecAuthority(options: { evidenceStore?: TrustedEvidenceStore } = {}): SpecAuthority {
  const versions = new Map<string, AnswerSpec[]>();
  const proposals = new Map<string, SpecChangeResult>();

  const current = (taskId: string, specVersion: string): AnswerSpec => {
    const spec = versions.get(taskId)?.find((item) => item.specVersion === specVersion);
    if (!spec) throw new Error(`ANSWER_SPEC_NOT_FOUND:${taskId}:${specVersion}`);
    return spec;
  };

  const append = (spec: AnswerSpec): AnswerSpec => {
    const stored = cloneSpec(spec, spec.specVersion, spec.hardConstraints);
    const history = versions.get(stored.taskId) ?? [];
    history.push(stored);
    versions.set(stored.taskId, history);
    return cloneSpec(stored, stored.specVersion, stored.hardConstraints);
  };

  return {
    prepare(input) {
      if (!input.taskId || !input.question.trim()) throw new Error("ANSWER_SPEC_INPUT_INVALID");
      const spec = createAnswerSpec(input);
      return append(spec);
    },
    get(taskId, specVersion) {
      const history = versions.get(taskId);
      const spec = specVersion ? history?.find((item) => item.specVersion === specVersion) : history?.at(-1);
      return spec ? cloneSpec(spec, spec.specVersion, spec.hardConstraints) : undefined;
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
      const proposalWithId = { ...proposal, proposalId: proposal.proposalId ?? randomUUID() };
      const evidence = proposal.evidence ?? [];
      const resolved = evidence
        .map((reference) => {
          const trusted = reference.evidenceId ? options.evidenceStore?.get(reference.evidenceId) : undefined;
          if (!trusted || trusted.evidenceId !== reference.evidenceId) return undefined;
          const identityFields: Array<keyof EvidenceReference> = ["sourceKind", "sourceIdentity", "sourceRevision", "locator", "quotedValue", "contentHash"];
          return identityFields.every((field) => reference[field] === undefined || reference[field] === trusted[field]) ? trusted : undefined;
        })
        .filter((reference): reference is EvidenceReference => reference !== undefined);
      const authoritative = resolved.find((reference) => isHardConstraintEligible({
        statement: proposal.statement,
        authority: reference.authority,
        scope: proposal.scope,
        source: reference.sourceIdentity ?? reference.source,
        structural: proposal.structural,
      }));
      if (evidence.length === 0) {
        const rejected: RejectedSpecChange = { accepted: false, proposal: proposalWithId, reason: "SOLVER_PROPOSAL_REQUIRES_AUTHORITY" };
        proposals.set(proposalWithId.proposalId, rejected);
        return rejected;
      }
      if (resolved.length !== evidence.length) {
        const rejected: RejectedSpecChange = { accepted: false, proposal: proposalWithId, reason: "SPEC_PROPOSAL_EVIDENCE_UNAVAILABLE" };
        proposals.set(proposalWithId.proposalId, rejected);
        return rejected;
      }
      if (!authoritative) {
        const rejected: RejectedSpecChange = { accepted: false, proposal: proposalWithId, reason: "SPEC_PROPOSAL_EVIDENCE_INSUFFICIENT" };
        proposals.set(proposalWithId.proposalId, rejected);
        return rejected;
      }
      const spec = current(proposal.taskId, proposal.baseSpecVersion);
      const next = append(cloneSpec(spec, String(Number(spec.specVersion) + 1), [
        ...spec.hardConstraints,
        makeHardConstraint({
          statement: proposal.statement,
          authority: authoritative.authority,
          scope: proposal.scope,
          source: authoritative.sourceIdentity ?? authoritative.source,
          structural: proposal.structural,
        }, spec.hardConstraints.length, authoritative),
      ]));
      const accepted: AcceptedSpecChange = { accepted: true, proposal: proposalWithId, spec: next };
      proposals.set(proposalWithId.proposalId, accepted);
      return accepted;
    },
    resolveConflict(taskId, baseSpecVersion, resolution) {
      const base = current(taskId, baseSpecVersion);
      const conflict = base.conflicts?.find((candidate) => candidate.conflictId === resolution.conflictId);
      if (!conflict) throw new Error("ANSWER_SPEC_CONFLICT_NOT_FOUND");
      if (conflict.status === "resolved") throw new Error("ANSWER_SPEC_CONFLICT_ALREADY_RESOLVED");
      const evidenceRefs = resolution.evidenceRefs ?? conflict.evidenceRefs;
      if (resolution.resolution === "higher_authority") {
        if (evidenceRefs.length === 0) throw new Error("ANSWER_SPEC_CONFLICT_EVIDENCE_REQUIRED");
        const highestExisting = Math.min(...conflict.authorityLevels.map((authority) => EVIDENCE_AUTHORITY_ORDER.indexOf(authority)));
        const hasHigherAuthority = evidenceRefs.some((reference) => EVIDENCE_AUTHORITY_ORDER.indexOf(reference.authority) >= 0 && EVIDENCE_AUTHORITY_ORDER.indexOf(reference.authority) < highestExisting);
        if (!hasHigherAuthority) throw new Error("ANSWER_SPEC_CONFLICT_HIGHER_AUTHORITY_REQUIRED");
      }
      if (resolution.resolution === "user_clarification" && !resolution.clarification?.trim()) throw new Error("ANSWER_SPEC_CONFLICT_CLARIFICATION_REQUIRED");
      const updatedConflict: ConflictRecord = {
        ...conflict,
        evidenceRefs: evidenceRefs.map((reference) => ({ ...reference })),
        authorityLevels: [...new Set([...conflict.authorityLevels, ...evidenceRefs.map((reference) => reference.authority)])],
        resolution: resolution.resolution,
        status: "resolved",
        ...(resolution.resolvedBy ? { resolvedBy: resolution.resolvedBy } : {}),
      };
      const conflicts = (base.conflicts ?? []).map((candidate) => candidate.conflictId === conflict.conflictId ? updatedConflict : candidate);
      const hardConstraints = resolution.clarification?.trim()
        ? [...base.hardConstraints, { id: `HC-${base.hardConstraints.length + 1}`, statement: resolution.clarification.trim(), scope: conflict.scope, provenance: { authority: "user_clarification" as const, source: resolution.resolvedBy ?? "user-clarification" } }]
        : base.hardConstraints;
      const provenance = resolution.clarification?.trim()
        ? [...base.provenance, { authority: "user_clarification" as const, source: resolution.resolvedBy ?? "user-clarification" }]
        : base.provenance;
      return append(cloneSpec({ ...base, provenance, conflicts }, String(Number(base.specVersion) + 1), hardConstraints));
    },
    applyAuthoritativeChange(taskId, baseSpecVersion, change) {
      if (!isHardConstraintEligible(change)) throw new Error("ANSWER_SPEC_HARD_CONSTRAINT_EVIDENCE_INSUFFICIENT");
      const base = current(taskId, baseSpecVersion);
      const nextConstraint = makeHardConstraint(change, base.hardConstraints.length);
      return append(cloneSpec(base, String(Number(base.specVersion) + 1), [...base.hardConstraints, nextConstraint]));
    },
    snapshot() {
      return [...versions.values()].flat().map((spec) => cloneSpec(spec, spec.specVersion, spec.hardConstraints));
    },
    restore(specs) {
      versions.clear();
      for (const spec of specs) {
        const history = versions.get(spec.taskId) ?? [];
        history.push(cloneSpec(spec, spec.specVersion, spec.hardConstraints));
        versions.set(spec.taskId, history);
      }
      for (const history of versions.values()) history.sort((left, right) => Number(left.specVersion) - Number(right.specVersion));
    },
  };
}
