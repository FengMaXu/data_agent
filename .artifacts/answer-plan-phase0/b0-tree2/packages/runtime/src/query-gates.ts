import type {
  AnswerContract,
  AnswerJoinConstraint,
  AnswerMeasureConstraint,
  AnswerRankingConstraint,
  AnswerSpec,
  StructuredConstraint,
} from "./answer-spec.js";
import type { QueryDigest, PopulationEffectNode, DigestCardinalityEvidence, DigestWindow, SchemaEvidence } from "./query-digest.js";

export type GateName = "g1_shape" | "g2_population" | "g3_fanout" | "g4_candidate";
export const GATE_APPLICABILITY_VERSION = "2";
export type GateApplicability = "checked" | "not_applicable" | "unsupported" | "inconclusive";
export type PopulationEffectStatus = "authorized" | "structural" | "disputed" | "unresolved";

export interface GateViolation {
  readonly code: string;
  readonly gate: GateName;
  readonly aspect: string;
  readonly required: string;
  readonly observed: string;
  readonly claimId?: string;
  readonly digestPath?: string;
  readonly specPath?: string;
  readonly blocking: boolean;
}

export interface GateApplicabilityContract {
  readonly gate: GateName;
  readonly version: string;
  readonly supportedDialects: readonly string[];
  readonly requiredDigestFacets: readonly string[];
}

export const DEFAULT_GATE_APPLICABILITY_CONTRACTS: readonly GateApplicabilityContract[] = [
  { gate: "g1_shape", version: "2", supportedDialects: ["sqlite", "mysql", "postgres", "bigquery", "snowflake"], requiredDigestFacets: ["projections", "outputLineage"] },
  { gate: "g2_population", version: "2", supportedDialects: ["sqlite", "mysql", "postgres", "bigquery", "snowflake"], requiredDigestFacets: ["filters"] },
  { gate: "g3_fanout", version: "2", supportedDialects: ["sqlite", "mysql", "postgres", "bigquery", "snowflake"], requiredDigestFacets: ["joins", "measures", "outputLineage"] },
  { gate: "g4_candidate", version: "2", supportedDialects: ["sqlite", "mysql", "postgres", "bigquery", "snowflake"], requiredDigestFacets: [] },
];

export interface GateResult {
  readonly gate: GateName;
  readonly applicability: GateApplicability;
  readonly passed: boolean;
  readonly blocking: boolean;
  readonly violations: readonly GateViolation[];
  readonly warnings: readonly string[];
  readonly applicabilityVersion?: string;
  readonly policyVersion?: string;
  readonly requiresClarification?: boolean;
  readonly populationEffects?: readonly PopulationEffectNode[];
}

export interface GateEvaluationInput {
  readonly spec: AnswerSpec;
  readonly digest?: QueryDigest;
  readonly metadata?: {
    readonly columns: readonly string[];
    readonly columnTypes?: readonly string[];
    readonly rowCount: number;
    readonly truncated?: boolean;
  };
  readonly dataSnapshot?: string;
  readonly schema?: SchemaEvidence;
  /** Runtime-owned candidate identity state for the repair gate. */
  readonly candidateFingerprint?: string;
  readonly candidatePreviouslyFailed?: boolean;
  readonly gateApplicabilityVersion?: string;
  readonly gatePolicyVersion?: string;
  readonly failedClaimIds?: readonly string[];
}

const emptyResult = (gate: GateName, applicability: GateApplicability, warnings: readonly string[] = []): GateResult => ({
  gate,
  applicability,
  passed: applicability === "not_applicable" || applicability === "checked" && warnings.length === 0,
  blocking: false,
  violations: [],
  warnings,
});

function normalized(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\[\]`"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sameExpression(left: string, right: string): boolean {
  return normalized(left) === normalized(right);
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => sameExpression(value, right[index]));
}

function hasAggregate(digest: QueryDigest, kind: string): boolean {
  // Ratio/difference are composite measures. Their SQL expression normally
  // contains two or more aggregate terms, so requiring a literal RATIO or
  // DIFFERENCE aggregate would reject every valid implementation.
  if (kind === "ratio" || kind === "difference") return digest.measures.length > 0;
  const expected = kind === "count_distinct" ? "COUNT" : kind.toUpperCase();
  return digest.measures.some((measure) => measure.function.toUpperCase() === expected
    && (kind !== "count_distinct" || /\bDISTINCT\b/i.test(measure.expression))
    && (kind !== "count" || !/\bDISTINCT\b/i.test(measure.expression)));
}

function hardField<T>(field: StructuredConstraint<T> | undefined): T | undefined {
  return field?.binding === "hard" ? field.value : undefined;
}

function hardMeasures(contract: AnswerContract): readonly AnswerMeasureConstraint[] {
  return (contract.measures ?? []).filter((measure) => measure.binding === "hard").map((measure) => measure.value);
}

function hardJoins(contract: AnswerContract): readonly AnswerJoinConstraint[] {
  return (contract.joins ?? []).filter((join) => join.binding === "hard").map((join) => join.value);
}

function rowCountViolation(
  spec: AnswerSpec,
  rowCount: number,
  gate: GateName = "g1_shape",
): GateViolation | undefined {
  const output = hardField(spec.answerContract.output);
  const ranking = hardField(spec.answerContract.ranking);
  const allowsTies = ranking?.tiePolicy === "include_ties";
  if (!output) {
    if (spec.rowMode === "top_n" && spec.rowCount !== undefined && !allowsTies && rowCount !== spec.rowCount) {
      return { code: "G1_TOP_N_ROW_COUNT_MISMATCH", gate, aspect: "row_count", required: `exactly ${spec.rowCount}`, observed: String(rowCount), specPath: "rowCount", blocking: true };
    }
    if (spec.rowMode !== "top_n" && spec.rowCount !== undefined && rowCount !== spec.rowCount) {
      return { code: "G1_ROW_COUNT_MISMATCH", gate, aspect: "row_count", required: String(spec.rowCount), observed: String(rowCount), specPath: "rowCount", blocking: true };
    }
    if (spec.rowMode === "scalar" && rowCount !== 1) {
      return { code: "G1_SCALAR_ROW_COUNT_MISMATCH", gate, aspect: "row_mode", required: "exactly one scalar row", observed: `${rowCount} rows`, specPath: "rowMode", blocking: true };
    }
    return undefined;
  }
  const range = output.rowCountRange;
  if (range?.exact !== undefined && rowCount !== range.exact) {
    return { code: "G1_ROW_COUNT_MISMATCH", gate, aspect: "row_count", required: `exactly ${range.exact}`, observed: String(rowCount), specPath: "answerContract.output.value.rowCountRange.exact", blocking: true };
  }
  if (range?.min !== undefined && rowCount < range.min) {
    return { code: "G1_ROW_COUNT_BELOW_MINIMUM", gate, aspect: "row_count", required: `at least ${range.min}`, observed: String(rowCount), specPath: "answerContract.output.value.rowCountRange.min", blocking: true };
  }
  if (range?.max !== undefined && rowCount > range.max) {
    return { code: "G1_ROW_COUNT_ABOVE_MAXIMUM", gate, aspect: "row_count", required: `at most ${range.max}`, observed: String(rowCount), specPath: "answerContract.output.value.rowCountRange.max", blocking: true };
  }
  if (output.rowMode !== "top_n" && output.rowCount !== undefined && rowCount !== output.rowCount) {
    return { code: "G1_ROW_COUNT_MISMATCH", gate, aspect: "row_count", required: String(output.rowCount), observed: String(rowCount), specPath: "answerContract.output.value.rowCount", blocking: true };
  }
  if (output.rowMode === "scalar" && rowCount !== 1) {
    return { code: "G1_SCALAR_ROW_COUNT_MISMATCH", gate, aspect: "row_mode", required: "exactly one scalar row", observed: `${rowCount} rows`, specPath: "answerContract.output.value.rowMode", blocking: true };
  }
  if (output.rowMode === "top_n" && output.rowCount !== undefined && !allowsTies && !(range?.min !== undefined || range?.max !== undefined || range?.exact !== undefined) && rowCount !== output.rowCount) {
    return { code: "G1_TOP_N_ROW_COUNT_MISMATCH", gate, aspect: "row_count", required: `exactly ${output.rowCount}`, observed: String(rowCount), specPath: "answerContract.output.value.rowCount", blocking: true };
  }
  return undefined;
}

function rankingWindowFor(digest: QueryDigest, ranking: AnswerRankingConstraint): DigestWindow | undefined {
  const expectedPartition = ranking.partitionBy.map(normalized);
  const expectedOrder = ranking.orderBy.split(",").map((value) => value.trim()).filter(Boolean);
  return digest.windows.find((candidate) => {
    const rankFunction = /^(ROW_NUMBER|RANK|DENSE_RANK)$/i.test(candidate.function);
    return rankFunction
      && sameStringArray(expectedPartition, candidate.partitionBy.map(normalized))
      && sameStringArray(expectedOrder, candidate.orderBy);
  });
}

function hasWindowTopNQualifier(digest: QueryDigest, ranking: AnswerRankingConstraint, window: DigestWindow): boolean {
  const qualify = digest.qualify?.trim();
  if (!qualify || !/\bQUALIFY\b/i.test(digest.normalizedSql)) return false;
  const n = Math.trunc(ranking.n);
  if (!Number.isFinite(n) || n < 1) return false;
  const text = qualify.replace(/\s+/g, " ");
  const referencesWindow = window.output
    ? containsIdentifier(text, window.output)
    : new RegExp(`\\b${window.function.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
  if (!referencesWindow) return false;
  const upperBound = new RegExp(`(?:<=\\s*${n}\\b|<\\s*${n + 1}\\b|\\bBETWEEN\\s+1\\s+AND\\s+${n}\\b)`, "i");
  return upperBound.test(text);
}

function outputViolation(input: GateEvaluationInput, digest: QueryDigest): GateViolation[] {
  const output = hardField(input.spec.answerContract.output);
  const violations: GateViolation[] = [];
  const rowMode = output?.rowMode ?? input.spec.rowMode;
  if (rowMode === "scalar" && input.metadata && input.metadata.columns.length !== 1) {
    violations.push({
      code: "G1_SCALAR_COLUMN_COUNT_MISMATCH",
      gate: "g1_shape",
      aspect: "projection",
      required: "exactly one output column",
      observed: `${input.metadata.columns.length} columns`,
      specPath: output ? "answerContract.output.value.rowMode" : "rowMode",
      digestPath: "projections",
      blocking: true,
    });
  }
  if (output?.columns.length && input.metadata && !sameStringArray(output.columns, input.metadata.columns)) {
    violations.push({
      code: "G1_OUTPUT_COLUMNS_MISMATCH",
      gate: "g1_shape",
      aspect: "projection",
      required: output.columns.join(", "),
      observed: input.metadata.columns.join(", "),
      specPath: "answerContract.output.value.columns",
      digestPath: digest.projections.length ? "projections" : "outputLineage",
      blocking: true,
    });
  }
  const outputFields = output?.schema ?? output?.outputSchema ?? [];
  if (outputFields.length && input.metadata) {
    const requiredFields = outputFields.filter((field) => field.required !== false);
    for (const field of requiredFields) {
      const label = field.label;
      const role = field.semanticRole;
      const position = field.position !== undefined ? Math.max(0, field.position - 1) : label ? input.metadata.columns.findIndex((column) => sameExpression(column, label!)) : -1;
      if (label && !input.metadata.columns.some((column) => sameExpression(column, label!))) {
        violations.push({
          code: "G1_OUTPUT_FIELD_MISSING",
          gate: "g1_shape",
          aspect: "projection",
          required: label,
          observed: input.metadata.columns.join(", "),
          specPath: "answerContract.output.value.schema",
          digestPath: "projections",
          blocking: true,
        });
      } else if (role) {
        const lineage = position >= 0 ? digest.outputLineage[position] : digest.outputLineage.find((item) => item.columns.some((column) => containsIdentifier(column, role)) || containsIdentifier(item.expression, role));
        const roleTokens = stringTokens(role);
        const lineageText = lineage ? normalized(`${lineage.expression} ${lineage.columns.join(" ")}`) : "";
        if (!lineage || roleTokens.length === 0 || !roleTokens.some((token) => lineageText.includes(token))) {
          violations.push({
            code: "G1_OUTPUT_ROLE_LINEAGE_MISMATCH",
            gate: "g1_shape",
            aspect: "output_role",
            required: role,
            observed: position >= 0 ? input.metadata.columns[position] ?? "missing" : input.metadata.columns.join(", "),
            specPath: "answerContract.output.value.schema.semanticRole",
            digestPath: "outputLineage",
            blocking: true,
          });
        }
      }
      if (field.type && position >= 0 && input.metadata.columnTypes?.[position] && !sameExpression(input.metadata.columnTypes[position], field.type)) {
        violations.push({
          code: "G1_OUTPUT_FIELD_TYPE_MISMATCH",
          gate: "g1_shape",
          aspect: "projection_type",
          required: field.type,
          observed: input.metadata.columnTypes[position],
          specPath: "answerContract.output.value.schema",
          digestPath: "projections",
          blocking: true,
        });
      }
    }
    const labeledFields = outputFields.filter((field) => field.label ?? field.semanticRole);
    if (labeledFields.length > 0 && input.metadata.columns.length > labeledFields.length && !output?.columns.length) {
      violations.push({
        code: "G1_OUTPUT_EXTRA_COLUMN",
        gate: "g1_shape",
        aspect: "projection",
        required: labeledFields.map((field) => field.label ?? field.semanticRole ?? "unnamed output").join(", "),
        observed: input.metadata.columns.join(", "),
        specPath: "answerContract.output.value.schema",
        digestPath: "projections",
        blocking: true,
      });
    }
  }
  if (input.metadata?.truncated) {
    violations.push({
      code: "G1_RESULT_TRUNCATED",
      gate: "g1_shape",
      aspect: "completeness",
      required: "complete Candidate result",
      observed: "truncated",
      digestPath: "projections",
      blocking: true,
    });
  }
  const count = input.metadata ? rowCountViolation(input.spec, input.metadata.rowCount) : undefined;
  if (count) violations.push(count);
  const grain = hardField(input.spec.answerContract.grain);
  if (grain && grain.keyColumns.length > 0) {
    const grouped = digest.groupBy.map(normalized);
    const missing = grain.keyColumns.filter((key) => !grouped.includes(normalized(key)));
    if (missing.length > 0) {
      violations.push({
        code: "G1_GRAIN_MISMATCH",
        gate: "g1_shape",
        aspect: "grain",
        required: `grouped by ${missing.join(", ")}`,
        observed: digest.groupBy.join(", ") || "no GROUP BY",
        specPath: "answerContract.grain.value.keyColumns",
        digestPath: digest.groupBy.length ? "groupBy" : "projections",
        blocking: true,
      });
    }
  }
  for (const measure of hardMeasures(input.spec.answerContract)) {
    if (measure.kind === "unknown" || hasAggregate(digest, measure.kind)) continue;
    violations.push({
      code: "G1_MEASURE_MISSING",
      gate: "g1_shape",
      aspect: "measure",
      required: measure.kind,
      observed: digest.measures.map((candidate) => candidate.function).join(", ") || "no aggregate",
      specPath: "answerContract.measures",
      digestPath: digest.measures.length ? "measures" : "outputLineage",
      blocking: true,
    });
  }
  const ranking = hardField(input.spec.answerContract.ranking);
  if (ranking) {
    const expectedPartition = ranking.partitionBy.map(normalized);
    const window = digest.windows.find((candidate) => sameStringArray(expectedPartition, candidate.partitionBy.map(normalized)));
    const windowTopN = rankingWindowFor(digest, ranking);
    const windowQualified = windowTopN !== undefined && hasWindowTopNQualifier(digest, ranking, windowTopN);
    const global = expectedPartition.length === 0;
    if (!window && !(global && digest.limit !== undefined && digest.orderBy.length > 0)) {
      violations.push({
        code: "G1_RANKING_PARTITION_MISMATCH",
        gate: "g1_shape",
        aspect: "ranking_partition",
        required: global ? "global" : expectedPartition.join(", "),
        observed: digest.windows.map((candidate) => candidate.partitionBy.join(", ")).join("; ") || "global/non-window",
        specPath: "answerContract.ranking.value.partitionBy",
        digestPath: digest.windows.length ? "windows" : "orderBy",
        blocking: true,
      });
    }
    const tieAwareRanking = /\bWITH\s+TIES\b/i.test(digest.normalizedSql)
      || digest.windows.some((candidate) => /\b(?:RANK|DENSE_RANK)\b/i.test(candidate.function)
        && sameStringArray(expectedPartition, candidate.partitionBy.map(normalized))
        && candidate.orderBy.length > 0);
    if (ranking.tiePolicy === "include_ties" && !tieAwareRanking) {
      // The requested tie semantics are business semantics. Do not silently
      // replace them with a strict LIMIT or an arbitrary secondary sort.
      violations.push({
        code: "G1_TIE_POLICY_UNRESOLVED",
        gate: "g1_shape",
        aspect: "tie_policy",
        required: `include ties for top ${ranking.n}`,
        observed: "no tie-aware ranking or WITH TIES construct",
        specPath: "answerContract.ranking.value.tiePolicy",
        digestPath: digest.windows.length ? "windows" : digest.limit === undefined ? "orderBy" : "limit",
        blocking: false,
      });
    }
    if (ranking.tiePolicy === undefined || ranking.tiePolicy === "unspecified") {
      violations.push({
        code: "G1_TIE_POLICY_UNRESOLVED",
        gate: "g1_shape",
        aspect: "tie_policy",
        required: `tie policy for top ${ranking.n}`,
        observed: "unspecified",
        specPath: "answerContract.ranking.value.tiePolicy",
        digestPath: digest.windows.length ? "windows" : "limit",
        blocking: false,
      });
    }
    // A ROW_NUMBER/RANK window with a matching QUALIFY bound is the bounded
    // per-partition Top-N form; it has no top-level LIMIT or ORDER BY by design.
    if (!windowQualified && digest.limit !== ranking.n && ranking.tiePolicy !== "include_ties" && ranking.tiePolicy !== "unspecified") {
      violations.push({
        code: "G1_RANKING_LIMIT_MISMATCH",
        gate: "g1_shape",
        aspect: "ranking_limit",
        required: `LIMIT ${ranking.n} or QUALIFY rank <= ${ranking.n}`,
        observed: digest.limit === undefined ? "no LIMIT or qualifying window" : `LIMIT ${digest.limit}`,
        specPath: "answerContract.ranking.value.n",
        digestPath: digest.limit === undefined ? "windows" : "limit",
        blocking: true,
      });
    }
    if (ranking.tiePolicy === "include_ties" && !windowQualified && digest.limit !== undefined && digest.limit !== ranking.n && !/\bWITH\s+TIES\b/i.test(digest.normalizedSql)) {
      violations.push({
        code: "G1_RANKING_LIMIT_MISMATCH",
        gate: "g1_shape",
        aspect: "ranking_limit",
        required: `tie-aware top ${ranking.n}`,
        observed: `LIMIT ${digest.limit}`,
        specPath: "answerContract.ranking.value.n",
        digestPath: "limit",
        blocking: true,
      });
    }
    const expectedOrder = ranking.orderBy.split(",").map((value) => value.trim()).filter(Boolean);
    if (!windowQualified && expectedOrder.length > 0 && !sameStringArray(expectedOrder, digest.orderBy)) {
      violations.push({
        code: "G1_RANKING_ORDER_MISMATCH",
        gate: "g1_shape",
        aspect: "ordering",
        required: ranking.orderBy,
        observed: digest.orderBy.join(", "),
        specPath: "answerContract.ranking.value.orderBy",
        digestPath: digest.orderBy.length ? "orderBy" : "windows",
        blocking: true,
      });
    }
  }
  return violations;
}

export function evaluateG1(input: GateEvaluationInput): GateResult {
  const contract = input.spec.answerContract;
  const hasContract = Boolean(
    hardField(contract.output)
    || hardField(contract.grain)
    || hardMeasures(contract).length
    || hardField(contract.ranking)
    || input.spec.rowMode !== undefined
    || input.spec.rowCount !== undefined,
  );
  if (!hasContract) return emptyResult("g1_shape", "not_applicable");
  const digest = input.digest;
  if (!digest) return emptyResult("g1_shape", "unsupported", ["Query Digest is unavailable"]);
  const requiredCoverage = ["projections", "outputLineage"];
  if (digest.lineageCompleteness === "unsupported" || requiredCoverage.some((field) => digest.coverage[field] === "unsupported" || digest.coverage[field] === "insufficient_evidence")) {
    return emptyResult("g1_shape", "unsupported", ["Required projection or output lineage coverage is unavailable"]);
  }
  const violations = outputViolation(input, digest);
  const tiePolicyUnresolved = violations.some((violation) => violation.code === "G1_TIE_POLICY_UNRESOLVED");
  const blockingViolations = violations.filter((violation) => violation.blocking);
  return {
    gate: "g1_shape",
    applicability: tiePolicyUnresolved && blockingViolations.length === 0 ? "inconclusive" : "checked",
    passed: violations.length === 0,
    blocking: blockingViolations.length > 0,
    violations,
    warnings: tiePolicyUnresolved ? ["Top-N tie policy is unresolved; user clarification is required"] : [],
    ...(tiePolicyUnresolved && blockingViolations.length === 0 ? { requiresClarification: true } : {}),
  };
}

function stringTokens(value: string): string[] {
  return normalized(value).split(/[^a-z0-9_]+/i).filter((token) => token.length > 1);
}

type PredicateShape = { readonly left: string; readonly operator: string; readonly right: string };

function predicateShapes(value: string): PredicateShape[] {
  const result: PredicateShape[] = [];
  const pattern = /([A-Za-z_][A-Za-z0-9_$.[\]`"]*)\s*(NOT\s+IN|IS\s+NOT|NOT\s+LIKE|<>|!=|>=|<=|=|>|<|\bIN\b|\bLIKE\b|\bIS\b)\s*(\([^)]*\)|'[^']*'|"[^"]*"|[^\s,)]+)/gi;
  for (const match of value.matchAll(pattern)) {
    result.push({
      left: normalized(match[1]),
      operator: normalized(match[2]).replace(/\s+/g, " "),
      right: normalized(match[3]).replace(/^['"]|['"]$/g, ""),
    });
  }
  return result;
}

function negativePopulationExpression(value: string): boolean {
  return /(?:!=|<>|\bNOT\s+(?:IN|LIKE)|\bIS\s+NOT\b|\bEXCLUDE(?:D)?\b|\bWITHOUT\b|\bNOT\b)/i.test(value);
}

function constraintMatchesEffect(statement: string, effect: PopulationEffectNode): boolean {
  const statementTokens = new Set(stringTokens(statement));
  if (/(?:do not|don't|must not|never|include all|keep all)\b/i.test(statement) && /(?:exclude|filter|where)\b/i.test(statement)) return false;
  const expression = `${effect.expression} ${effect.value ?? ""}`;
  const statementPredicates = predicateShapes(statement);
  const effectPredicates = predicateShapes(expression);
  // A positive contract cannot authorize a negative predicate merely because
  // the same literal appears. When both sides expose a predicate, require the
  // physical field, operator and value to agree exactly.
  if (negativePopulationExpression(expression) && !negativePopulationExpression(statement)) return false;
  if (statementPredicates.length > 0 && effectPredicates.length > 0) {
    const exact = effectPredicates.some((candidate) => statementPredicates.some((declared) =>
      candidate.left === declared.left && candidate.operator === declared.operator && candidate.right === declared.right));
    if (!exact) return false;
  }
  const meaningful = stringTokens(expression).filter((token) => !["where", "and", "or", "not", "is", "null", "inner", "join", "on", "from"].includes(token));
  if (meaningful.length === 0) return false;
  // A business phrase may omit the physical field name, but the trusted
  // mapping still has to mention that field somewhere. Otherwise a matching
  // literal such as `paid` could authorize an unrelated predicate.
  const physicalFields = effectPredicates.map((predicate) => predicate.left.split(".").at(-1)!).filter(Boolean);
  if (physicalFields.length > 0 && physicalFields.some((field) => !statementTokens.has(field))) return false;
  return meaningful.length > 0
    && meaningful.some((token) => statementTokens.has(token))
    && meaningful.filter((token) => token.length > 2).every((token) => statementTokens.has(token) || statementTokens.has(token.replace(/s$/, "")));
}

function classifyEffect(spec: AnswerSpec, effect: PopulationEffectNode): PopulationEffectStatus {
  if (effect.kind === "structural") return "structural";
  const filterConstraints = spec.hardConstraints.filter((constraint) => /filter|population|exclude|include|where/i.test(`${constraint.scope} ${constraint.statement}`));
  const mappings = spec.physicalMappings ?? [];
  const mappedConstraintForPredicate = (predicate: PredicateShape) => {
    const predicateField = predicate.left.split(".").at(-1);
    return filterConstraints.find((constraint) => mappings.some((mapping) => {
      if (mapping.hardConstraintId !== constraint.id || !mapping.physicalField.trim()) return false;
      const mappedField = normalized(mapping.physicalField).split(".").at(-1);
      if (!predicateField || predicateField !== mappedField) return false;
      if (mapping.physicalValue && normalized(mapping.physicalValue) !== predicate.right) return false;
      const expression = `${predicate.left} ${predicate.operator} ${predicate.right}`;
      return !(negativePopulationExpression(expression) && !negativePopulationExpression(constraint.statement));
    }));
  };
  const authorizePredicate = (predicate: PredicateShape): boolean => Boolean(mappedConstraintForPredicate(predicate));
  const fullExpression = `${effect.expression} ${effect.value ?? ""}`;
  const predicates = predicateShapes(fullExpression);
  // The bounded first version can prove conjunctions predicate-by-predicate,
  // but it does not preserve arbitrary boolean branch semantics. Never turn
  // separately authorized predicates joined by OR into an authorized total.
  if (predicates.length > 1 && /\bOR\b/i.test(fullExpression)) return "unresolved";
  // SQLGlot keeps a compound AND WHERE as one population node. Authorize it
  // only when every concrete predicate has its own Hard Constraint and mapping.
  if (predicates.length > 1) return predicates.every(authorizePredicate) ? "authorized" : "disputed";
  if (predicates.length === 1 && authorizePredicate(predicates[0])) return "authorized";
  const matchingConstraint = filterConstraints.find((constraint) => constraintMatchesEffect(constraint.statement, effect));
  if (matchingConstraint) return "unresolved";
  const explicitPredicate = ["filter", "having", "qualify"].includes(effect.kind);
  if (explicitPredicate && filterConstraints.length > 0) return "disputed";
  return "unresolved";
}

export function classifyPopulationEffects(spec: AnswerSpec, digest: QueryDigest): readonly PopulationEffectNode[] {
  const declared = digest.populationEffects;
  const effects = declared && declared.length > 0
    ? declared
    : [
      ...digest.filters.map((expression, index) => ({ path: `filters[${index}]`, kind: "filter" as const, expression })),
      ...digest.joins.filter((join) => join.type.toUpperCase() === "INNER").map((join, index) => ({ path: `joins[${index}]`, kind: "inner_join" as const, expression: join.condition ?? "", source: join.source.name })),
    ];
  return effects.map((effect) => ({ ...effect, status: classifyEffect(spec, effect) }));
}

const G2_OUTSIDE_SUPPORTED_QUERY_CLASS = new Set([
  "cte",
  "recursive_cte",
  "subquery",
  "set_operation",
  "case_expression",
]);

/**
 * G2 v1 intentionally understands only a single, non-windowed SELECT block.
 * Complex queries are outside this narrow gate rather than failed attempts to
 * inspect it. Only an authoritative AST Digest may establish that boundary;
 * a fallback parser error must remain Review Unavailable.
 */
function g2OutsideSupportedQueryClass(digest: QueryDigest): boolean {
  if (digest.parserEngine !== "sqlglot") return false;
  return digest.windows.length > 0
    || digest.setOperations.length > 0
    || digest.unsupportedNodes.some((node) => G2_OUTSIDE_SUPPORTED_QUERY_CLASS.has(node));
}

export function evaluateG2(input: GateEvaluationInput): GateResult {
  const hasFilterContract = input.spec.hardConstraints.some((constraint) => /filter|population|exclude|include|where/i.test(`${constraint.scope} ${constraint.statement}`));
  if (!input.digest) return emptyResult("g2_population", "unsupported", ["Query Digest is unavailable"]);
  if (g2OutsideSupportedQueryClass(input.digest)) {
    return emptyResult("g2_population", "not_applicable", ["Query is outside the bounded G2 v1 query class"]);
  }
  if (input.digest.lineageCompleteness === "unsupported" || input.digest.coverage.filters === "unsupported" || input.digest.coverage.joins === "unsupported") {
    return emptyResult("g2_population", "unsupported", ["Population effect lineage is unavailable"]);
  }
  const effects = classifyPopulationEffects(input.spec, input.digest);
  if (effects.length === 0) return emptyResult("g2_population", "not_applicable");
  if (!hasFilterContract) {
    const reductionWithoutContract = effects.some((effect) => ["filter", "having", "qualify", "distinct", "inner_join", "semi_join", "anti_join"].includes(effect.kind)
      || effect.kind === "set_operation" && !/\bUNION\s+ALL\b/i.test(effect.expression));
    if (reductionWithoutContract) {
      return {
        gate: "g2_population",
        applicability: "inconclusive",
        passed: false,
        blocking: false,
        violations: [],
        warnings: ["Population effect has no authoritative Hard Constraint or Physical Mapping"],
        requiresClarification: true,
        populationEffects: effects,
      };
    }
    return { ...emptyResult("g2_population", "not_applicable"), populationEffects: effects };
  }
  const violations: GateViolation[] = effects.filter((effect) => effect.status === "disputed").map((effect, index) => ({
    code: "G2_UNAUTHORIZED_POPULATION_EFFECT",
    gate: "g2_population",
    aspect: "population",
    required: "authorized population effect",
    observed: `${effect.kind}: ${effect.expression}`,
    claimId: `population-effect-${index + 1}`,
    digestPath: effect.path,
    blocking: true,
  }));
  const unresolved = effects.filter((effect) => effect.status === "unresolved");
  if (unresolved.length > 0 && violations.length === 0) {
    return {
      gate: "g2_population",
      applicability: "inconclusive",
      passed: false,
      blocking: false,
      violations: [],
      warnings: [`Population effect evidence is unresolved: ${unresolved.map((effect) => effect.path).join(", ")}`],
      requiresClarification: true,
      populationEffects: effects,
    };
  }
  return { gate: "g2_population", applicability: "checked", passed: violations.length === 0, blocking: violations.length > 0, violations, warnings: [], populationEffects: effects };
}

function tableFor(schema: SchemaEvidence | undefined, relation: string) {
  return schema?.tables.find((table) => normalized(table.name) === normalized(relation));
}

function hasUniqueKey(schema: SchemaEvidence | undefined, relation: string, keys: readonly string[]): boolean {
  const table = tableFor(schema, relation);
  if (!table) return false;
  return [table.primaryKey, ...(table.uniqueKeys ?? [])].some((unique) => unique !== undefined && sameStringArray(unique, keys));
}

function formalCardinalityEvidence(schema: SchemaEvidence | undefined, join: AnswerJoinConstraint): DigestCardinalityEvidence | undefined {
  const leftKeys = join.leftKeys ?? join.keys;
  const rightKeys = join.rightKeys ?? join.keys;
  if (!schema || leftKeys.length === 0 || rightKeys.length === 0) return undefined;
  const leftUnique = hasUniqueKey(schema, join.left, leftKeys);
  const rightUnique = hasUniqueKey(schema, join.right, rightKeys);
  if (!leftUnique && !rightUnique) return undefined;
  return {
    left: join.left,
    right: join.right,
    status: leftUnique && rightUnique ? "one_to_one" : leftUnique ? "one_to_many" : "many_to_one",
    source: "formal",
  };
}

function invertCardinalityStatus(status: DigestCardinalityEvidence["status"]): DigestCardinalityEvidence["status"] {
  if (status === "one_to_many") return "many_to_one";
  if (status === "many_to_one") return "one_to_many";
  return status;
}

function orientCardinalityEvidence(evidence: DigestCardinalityEvidence, join: AnswerJoinConstraint): DigestCardinalityEvidence | undefined {
  if (normalized(evidence.left) === normalized(join.left) && normalized(evidence.right) === normalized(join.right)) return evidence;
  if (normalized(evidence.left) !== normalized(join.right) || normalized(evidence.right) !== normalized(join.left)) return undefined;
  return {
    ...evidence,
    left: join.left,
    right: join.right,
    status: invertCardinalityStatus(evidence.status),
    ...(evidence.duplicatedSide ? { duplicatedSide: evidence.duplicatedSide === "left" ? "right" : "left" } : {}),
  };
}

function cardinalityForJoin(digest: QueryDigest, join: AnswerJoinConstraint, schema?: SchemaEvidence): DigestCardinalityEvidence | undefined {
  const observed = digest.cardinalityEvidence?.find((evidence) => {
    const relationNames = [evidence.left, evidence.right].map(normalized);
    return relationNames.includes(normalized(join.left)) && relationNames.includes(normalized(join.right));
  });
  return (observed ? orientCardinalityEvidence(observed, join) : undefined) ?? formalCardinalityEvidence(schema, join);
}

function relationPairMatches(left: string, right: string, join: AnswerJoinConstraint): boolean {
  const expected = new Set([normalized(join.left), normalized(join.right)]);
  return expected.size === 2 && new Set([normalized(left), normalized(right)]).size === 2
    && expected.has(normalized(left)) && expected.has(normalized(right));
}

function keyName(value: string): string {
  return normalized(value).split(".").at(-1) ?? "";
}

function qualifierNames(source: { name: string; alias?: string }): readonly string[] {
  return [source.name, source.alias].filter((value): value is string => Boolean(value)).map(normalized);
}

function conditionKeyPairs(condition: string): readonly (readonly [string, string])[] {
  const pairs: [string, string][] = [];
  const expression = normalized(condition);
  const pattern = /(?:^|[\s(])([a-z0-9_$]+(?:\.[a-z0-9_$]+)?)\s*=\s*([a-z0-9_$]+(?:\.[a-z0-9_$]+)?)(?=$|[\s)])/gi;
  for (const match of expression.matchAll(pattern)) pairs.push([match[1], match[2]]);
  return pairs;
}

function joinKeysMatch(condition: string | undefined, candidate: { left: { name: string; alias?: string }; source: { name: string; alias?: string } }, join: AnswerJoinConstraint): boolean {
  const leftKeys = (join.leftKeys ?? join.keys).map(keyName).filter(Boolean);
  const rightKeys = (join.rightKeys ?? join.keys).map(keyName).filter(Boolean);
  if (leftKeys.length === 0 && rightKeys.length === 0) return true;
  const text = normalized(condition ?? "");
  const using = /\bUSING\s*\(([^)]*)\)/i.exec(text);
  if (using) {
    const columns = using[1].split(",").map(keyName).filter(Boolean);
    return columns.length > 0
      && columns.every((column) => leftKeys.includes(column) && rightKeys.includes(column));
  }
  const leftQualifiers = new Set(qualifierNames(candidate.left));
  const rightQualifiers = new Set(qualifierNames(candidate.source));
  const sideOf = (term: string): "left" | "right" | undefined => {
    const parts = normalized(term).split(".");
    const qualifier = parts.length > 1 ? parts.at(-2) : undefined;
    if (!qualifier) return undefined;
    if (leftQualifiers.has(qualifier)) return "left";
    if (rightQualifiers.has(qualifier)) return "right";
    return undefined;
  };
  return conditionKeyPairs(text).some(([first, second]) => {
    const firstSide = sideOf(first);
    const secondSide = sideOf(second);
    if (firstSide === "left" && secondSide === "right") return leftKeys.includes(keyName(first)) && rightKeys.includes(keyName(second));
    if (firstSide === "right" && secondSide === "left") return leftKeys.includes(keyName(second)) && rightKeys.includes(keyName(first));
    return false;
  });
}

/** A cardinality assertion only applies when this candidate actually contains
 * the contracted relationship, not merely because the same two tables occur
 * somewhere else in the query. */
function contractedJoinAppears(digest: QueryDigest, join: AnswerJoinConstraint): boolean {
  return digest.joins.some((candidate) => {
    if (candidate.left && relationPairMatches(candidate.left.name, candidate.source.name, join)) {
      return joinKeysMatch(candidate.condition, { left: candidate.left, source: candidate.source }, join);
    }
    // Older/injected digests without an immediate-left relation are accepted
    // only when the ON/USING expression itself names both contracted tables.
    const condition = normalized(candidate.condition ?? "");
    const virtualCandidate = { left: { name: join.left }, source: { name: join.right } };
    return condition.length > 0
      && relationPairMatchesFromCondition(condition, join)
      && joinKeysMatch(condition, virtualCandidate, join);
  });
}

function containsIdentifier(condition: string, identifier: string): boolean {
  const escaped = normalized(identifier).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9_$])${escaped}(?:$|[^a-z0-9_$])`, "i").test(condition);
}

function relationPairMatchesFromCondition(condition: string, join: AnswerJoinConstraint): boolean {
  return containsIdentifier(condition, join.left) && containsIdentifier(condition, join.right);
}

function fanoutViolation(input: GateEvaluationInput, digest: QueryDigest): GateViolation[] {
  const contractJoins = hardJoins(input.spec.answerContract);
  const measures = hardMeasures(input.spec.answerContract);
  const violations: GateViolation[] = [];
  for (const [index, join] of contractJoins.entries()) {
    if (join.fanoutAllowed === true || !join.expectedCardinality || join.expectedCardinality === "N:M") continue;
    if (!contractedJoinAppears(digest, join)) continue;
    const evidence = cardinalityForJoin(digest, join, input.schema);
    if (!evidence) continue;
    const expectedStatus = join.expectedCardinality === "1:N" ? "one_to_many" : join.expectedCardinality === "N:1" ? "many_to_one" : join.expectedCardinality === "1:1" ? "one_to_one" : undefined;
    if (evidence.status !== "fanout" && expectedStatus && evidence.status !== expectedStatus) {
      violations.push({
        code: "G3_CARDINALITY_CONTRACT_MISMATCH",
        gate: "g3_fanout",
        aspect: "join_cardinality",
        required: join.expectedCardinality,
        observed: evidence.status,
        claimId: `join-cardinality-${index + 1}`,
        digestPath: `joins[${index}]`,
        specPath: "answerContract.joins",
        blocking: true,
      });
      continue;
    }
    const formalFanout = evidence.source === "formal" && (evidence.status === "one_to_many" || evidence.status === "many_to_one");
    if (evidence.status !== "fanout" && !formalFanout) continue;
    // For a declared 1:N relationship, the preserved/one side is the side
    // whose measure is repeated by the join. The N-side's own row measure is
    // not automatically wrong merely because the join returns more rows.
    // Observed `fanout` evidence may override this with an explicit duplicated
    // side when it proves a less ordinary propagation pattern.
    const inferredDuplicatedSide = join.preservedSide === "left" || join.preservedSide === "right"
      ? join.preservedSide
      : join.expectedCardinality === "1:N" ? "left" : join.expectedCardinality === "N:1" ? "right" : undefined;
    const duplicatedSide = evidence.status === "fanout"
      ? evidence.duplicatedSide ?? inferredDuplicatedSide
      : formalFanout ? inferredDuplicatedSide : undefined;
    const duplicatedRelation = duplicatedSide === "left" ? join.left : duplicatedSide === "right" ? join.right : undefined;
    const affected = measures.filter((measure) => measure.sourceRelation && duplicatedRelation
      && normalized(measure.sourceRelation) === normalized(duplicatedRelation)
      && measure.distinctPolicy !== "distinct"
      && !(measure.kind === "count_distinct"));
    if (affected.length === 0) continue;
    violations.push({
      code: "G3_JOIN_FANOUT_MEASURE_DUPLICATION",
      gate: "g3_fanout",
      aspect: "join_cardinality",
      required: join.measureEffect ?? `${join.expectedCardinality} without duplicating source measures`,
      observed: `fanout factor ${evidence.fanoutFactor ?? "unknown"} on ${join.left} ↔ ${join.right}`,
      claimId: `join-cardinality-${index + 1}`,
      digestPath: `joins[${index}]`,
      specPath: "answerContract.joins",
      blocking: true,
    });
  }
  return violations;
}

export function evaluateG3(input: GateEvaluationInput): GateResult {
  const measures = hardMeasures(input.spec.answerContract);
  const joins = hardJoins(input.spec.answerContract);
  if (measures.length === 0 || joins.length === 0) return emptyResult("g3_fanout", "not_applicable");
  if (!input.digest || input.digest.joins.length === 0) return emptyResult("g3_fanout", "unsupported", ["Query Digest JOIN lineage is unavailable"]);
  if (input.digest.lineageCompleteness !== "complete" || input.digest.coverage.joins === "unsupported" || input.digest.coverage.measures === "unsupported") {
    return emptyResult("g3_fanout", "unsupported", ["JOIN or measure lineage is unavailable"]);
  }
  const relevantJoins = joins.filter((join) => join.expectedCardinality && join.expectedCardinality !== "N:M" && join.fanoutAllowed !== true);
  if (relevantJoins.length === 0) return emptyResult("g3_fanout", "not_applicable");
  if (measures.some((measure) => !measure.sourceRelation?.trim())) {
    return emptyResult("g3_fanout", "inconclusive", ["Measure source relation is required to assess JOIN fanout propagation"]);
  }
  if (relevantJoins.some((join) => !contractedJoinAppears(input.digest!, join))) {
    return emptyResult("g3_fanout", "unsupported", ["Contracted JOIN is absent from the Candidate Query Digest"]);
  }
  if (relevantJoins.some((join) => !cardinalityForJoin(input.digest!, join, input.schema))) {
    return emptyResult("g3_fanout", "unsupported", ["Cardinality evidence is unavailable for a contracted JOIN"]);
  }
  const evidence = relevantJoins.map((join) => cardinalityForJoin(input.digest!, join, input.schema)!);
  const observedEvidence = evidence.filter((item) => item.source === "observed_snapshot");
  if (observedEvidence.length > 0 && (!input.dataSnapshot || observedEvidence.some((item) => !item.snapshotId || item.snapshotId !== input.dataSnapshot))) {
    return emptyResult("g3_fanout", "inconclusive", ["Cardinality evidence and Candidate do not share a stable data snapshot"]);
  }
  const violations = fanoutViolation(input, input.digest);
  return { gate: "g3_fanout", applicability: "checked", passed: violations.length === 0, blocking: violations.length > 0, violations, warnings: [] };
}

export function evaluateG4(input: GateEvaluationInput): GateResult {
  if (!input.candidateFingerprint || !input.candidatePreviouslyFailed) return emptyResult("g4_candidate", "not_applicable");
  return {
    gate: "g4_candidate",
    applicability: "checked",
    passed: false,
    blocking: true,
    violations: [{
      code: "G4_CANDIDATE_REPAIR_REQUIRED",
      gate: "g4_candidate",
      aspect: "candidate_repair",
      required: "a materially changed candidate for the failed claim",
      observed: "the candidate has the same semantic fingerprint as a previously failed candidate",
      claimId: input.failedClaimIds?.[0] ?? "candidate-repair",
      digestPath: "projections",
      blocking: true,
    }],
    warnings: [],
  };
}

interface CanonicalDigestParts {
  readonly sources: readonly string[];
  readonly joins: readonly { readonly type: string; readonly source: string; readonly condition: string }[];
  readonly filters: readonly string[];
  readonly populationEffects: readonly { readonly kind: string; readonly expression: string; readonly value?: string }[] | undefined;
  readonly measures: readonly { readonly function: string; readonly expression: string; readonly inputRelations?: readonly string[]; readonly aggregationLevel?: readonly string[]; readonly distinct?: boolean }[];
  readonly groupBy: readonly string[];
  readonly projections: readonly string[];
  readonly outputLineage: readonly { readonly expression: string; readonly columns: readonly string[] }[];
  readonly windows: readonly { readonly function: string; readonly partitionBy: readonly string[]; readonly orderBy: readonly string[]; readonly frame?: string }[];
  readonly orderBy: readonly string[];
  readonly limit: number | undefined;
  readonly setOperations: readonly string[];
}

function canonicalDigestParts(digest: QueryDigest): CanonicalDigestParts {
  const aliases = new Map(digest.sources.flatMap((source) => source.alias ? [[normalized(source.alias), normalized(source.name)] as const] : []));
  const canonicalExpression = (value: string): string => {
    let result = normalized(value);
    for (const [alias, name] of aliases) {
      const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(new RegExp(`\\b${escapedAlias}\\.`, "g"), `${name}.`);
    }
    return result;
  };
  return {
    // Labels and aliases are presentation details, not evidence that a failed
    // semantic claim was repaired.
    sources: digest.sources.map((source) => normalized(source.name)),
    joins: digest.joins.map((join) => ({ type: normalized(join.type), source: normalized(join.source.name), condition: canonicalExpression(join.condition ?? "") })),
    filters: digest.filters.map(canonicalExpression),
    populationEffects: digest.populationEffects?.map((effect) => ({ kind: effect.kind, expression: canonicalExpression(effect.expression), value: effect.value })),
    measures: digest.measures.map((measure) => ({ function: normalized(measure.function), expression: canonicalExpression(measure.expression), inputRelations: measure.inputRelations?.map(normalized), aggregationLevel: measure.aggregationLevel?.map(canonicalExpression), distinct: measure.distinct })),
    groupBy: digest.groupBy.map(canonicalExpression),
    projections: digest.projections.map((projection) => canonicalExpression(projection.expression)),
    outputLineage: digest.outputLineage.map((lineage) => ({
      expression: canonicalExpression(lineage.expression),
      columns: lineage.columns.map(canonicalExpression).filter((column) => column !== canonicalExpression(lineage.output)),
    })),
    windows: digest.windows.map((window) => ({ function: normalized(window.function), partitionBy: window.partitionBy.map(canonicalExpression), orderBy: window.orderBy.map(canonicalExpression), frame: window.frame ? canonicalExpression(window.frame) : undefined })),
    orderBy: digest.orderBy.map(canonicalExpression),
    limit: digest.limit,
    setOperations: digest.setOperations.map(normalized),
  };
}

export function candidateSemanticFingerprint(digest: QueryDigest | undefined): string | undefined {
  return digest ? JSON.stringify(canonicalDigestParts(digest)) : undefined;
}

/**
 * Return the portion of a candidate's semantics relevant to one failed claim.
 * G4 compares this value rather than the whole query, so an unrelated filter
 * or formatting-only rewrite cannot masquerade as a repair while a targeted
 * aggregation, join, shape, population, or ranking change can.
 */
export function candidateSemanticFingerprintForClaim(digest: QueryDigest | undefined, claimId: string): string | undefined {
  if (!digest) return undefined;
  const parts = canonicalDigestParts(digest);
  const claim = claimId.toLowerCase();
  if (/(?:population|filter|where|having|qualify|set[_ ]?operation|distinct)/.test(claim)) {
    return JSON.stringify({ filters: parts.filters, populationEffects: parts.populationEffects, setOperations: parts.setOperations });
  }
  if (/(?:join|fanout|cardinality)/.test(claim)) {
    return JSON.stringify({ sources: parts.sources, joins: parts.joins, measures: parts.measures, groupBy: parts.groupBy, projections: parts.projections });
  }
  if (/(?:ranking|order|limit|tie)/.test(claim)) {
    return JSON.stringify({ windows: parts.windows, orderBy: parts.orderBy, limit: parts.limit });
  }
  if (/(?:measure|aggregate|count|sum|avg|ratio|difference|unit|round)/.test(claim)) {
    return JSON.stringify({ measures: parts.measures, projections: parts.projections, outputLineage: parts.outputLineage, groupBy: parts.groupBy });
  }
  if (/(?:grain|row|projection|column|shape|output)/.test(claim)) {
    return JSON.stringify({ projections: parts.projections, outputLineage: parts.outputLineage, groupBy: parts.groupBy, measures: parts.measures });
  }
  return JSON.stringify(parts);
}

export function evaluateGates(input: GateEvaluationInput): readonly GateResult[] {
  const dialect = input.digest?.dialect;
  const contracts = new Map(DEFAULT_GATE_APPLICABILITY_CONTRACTS.map((contract) => [contract.gate, contract]));
  return [evaluateG1(input), evaluateG2(input), evaluateG3(input), evaluateG4(input)].map((result) => {
    const contract = contracts.get(result.gate);
    if (dialect && contract && !contract.supportedDialects.includes(dialect)) {
      return {
        gate: result.gate,
        applicability: "unsupported" as const,
        passed: false,
        blocking: false,
        violations: [],
        warnings: [`Gate ${result.gate} does not support dialect ${dialect}`],
        applicabilityVersion: input.gateApplicabilityVersion ?? GATE_APPLICABILITY_VERSION,
        ...(input.gatePolicyVersion ? { policyVersion: input.gatePolicyVersion } : {}),
      };
    }
    const requiredDigestFacets = result.gate === "g2_population"
      ? result.populationEffects?.some((effect) => effect.kind === "inner_join" || effect.kind === "semi_join" || effect.kind === "anti_join") ? ["joins"] : ["filters"]
      : contract?.requiredDigestFacets ?? [];
    if (result.applicability !== "not_applicable" && input.digest && contract
      && (input.digest.parserEngine !== "sqlglot" || requiredDigestFacets.some((facet) => input.digest!.coverage[facet] !== "checked"))) {
      return {
        gate: result.gate,
        applicability: "unsupported" as const,
        passed: false,
        blocking: false,
        violations: [],
        warnings: [input.digest.parserEngine !== "sqlglot"
          ? `Authoritative Query Digest requires sqlglot for ${result.gate}`
          : `Required Digest facet is unavailable for ${result.gate}: ${requiredDigestFacets.join(", ")}`],
        applicabilityVersion: input.gateApplicabilityVersion ?? GATE_APPLICABILITY_VERSION,
        ...(input.gatePolicyVersion ? { policyVersion: input.gatePolicyVersion } : {}),
      };
    }
    return {
      ...result,
      violations: result.violations.map((violation) => violation.claimId ? violation : {
        ...violation,
        claimId: `${violation.gate}:${violation.code}:${violation.digestPath ?? violation.aspect}`,
      }),
      applicabilityVersion: input.gateApplicabilityVersion ?? GATE_APPLICABILITY_VERSION,
      ...(input.gatePolicyVersion ? { policyVersion: input.gatePolicyVersion } : {}),
    };
  });
}
