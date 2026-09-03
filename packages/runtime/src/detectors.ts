import type { AnswerSpec } from "./answer-spec.js";
import { candidateSemanticFingerprintForClaim, evaluateGates, type GateResult } from "./query-gates.js";
import type { DigestCardinalityEvidence, QueryDigest } from "./query-digest.js";
import type { AnomalyObservation, DetectorId, SpecSlot } from "./anomaly-registry.js";

export interface DetectorInput {
  readonly spec: AnswerSpec;
  readonly digest?: QueryDigest;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
  readonly rowCount: number;
  readonly truncated: boolean;
  readonly sql: string;
  /** Optional Runtime-owned probe results. Missing evidence means no claim is made. */
  readonly entityPopulation?: { readonly factDistinct: number; readonly entityRows: number; readonly factRelation: string; readonly entityRelation: string };
  readonly crossPeriodSet?: { readonly leftCount: number; readonly rightCount: number; readonly symmetricDifference: number };
}

const claimForSlot: Readonly<Record<SpecSlot, string>> = {
  measure: "measure",
  grain: "grain",
  population: "population",
  filter: "filter",
  final_shape: "shape",
};

function fingerprint(input: DetectorInput, slot: SpecSlot): string | undefined {
  return candidateSemanticFingerprintForClaim(input.digest, claimForSlot[slot]);
}

function observation(detector: DetectorId, slot: SpecSlot, input: DetectorInput, observed: Record<string, unknown>, note: string): AnomalyObservation {
  const value = fingerprint(input, slot);
  return {
    detector,
    slot,
    observed,
    note,
    ...(value ? { fingerprint: value } : {}),
  };
}

function gateObservations(input: DetectorInput, gates: readonly GateResult[]): AnomalyObservation[] {
  const result: AnomalyObservation[] = [];
  for (const gate of gates) {
    if (gate.applicability !== "checked") continue;
    for (const violation of gate.violations) {
      if (gate.gate === "g1_shape" && /(?:ROW_COUNT|COLUMN_COUNT|OUTPUT_COLUMN|OUTPUT_FIELD|OUTPUT_ROLE|PROJECTION)/i.test(violation.code)) {
        result.push(observation("shape_mismatch", "final_shape", input, {
          code: violation.code,
          required: violation.required,
          observed: violation.observed,
        }, "候选结果形状与题面声明的输出形状不一致。"));
      } else if (gate.gate === "g2_population") {
        result.push(observation("unauthorized_filter", "filter", input, {
          code: violation.code,
          required: violation.required,
          observed: violation.observed,
        }, "检测到未能由当前 Answer Spec 授权的总体或过滤效果。"));
      }
    }
  }
  return result;
}

function aggregateMeasures(input: DetectorInput): boolean {
  return Boolean(input.digest?.measures.some((measure) => /^(COUNT|SUM|AVG|AVERAGE)$/i.test(measure.function)));
}

function joinEvidence(input: DetectorInput): readonly DigestCardinalityEvidence[] {
  return (input.digest?.cardinalityEvidence ?? []).filter((item) => item.status === "fanout" || item.status === "many_to_many");
}

function probeObservations(input: DetectorInput): AnomalyObservation[] {
  const result: AnomalyObservation[] = [];
  const fanout = joinEvidence(input);
  if (input.digest && input.digest.joins.length > 0 && aggregateMeasures(input) && fanout.length > 0) {
    result.push(observation("join_fanout", "measure", input, {
      joins: fanout.map((item) => `${item.left}->${item.right}`).join("|"),
      fanoutFactor: fanout.map((item) => item.fanoutFactor ?? "unknown").join("|"),
      snapshot: fanout.map((item) => item.snapshotId ?? "unknown").join("|"),
    }, "同一观测快照的连接证据显示连接可能扩大聚合度量的统计粒度。"));
  }
  const hasCountMeasure = Boolean(input.digest?.measures.some((measure) => /^(COUNT|COUNT_DISTINCT)$/i.test(measure.function)));
  const divergence = hasCountMeasure ? input.digest?.cardinalityEvidence?.find((item) => item.countValue !== undefined
    && item.distinctCountValue !== undefined
    && item.countValue !== item.distinctCountValue) : undefined;
  if (divergence) {
    result.push(observation("count_distinct_divergence", "measure", input, {
      count: divergence.countValue,
      distinctCount: divergence.distinctCountValue,
      key: divergence.duplicateKeys ?? [],
    }, "Runtime 探针观测到 COUNT 与 COUNT(DISTINCT key) 的实际值不一致。"));
  }
  if (input.entityPopulation && input.entityPopulation.factDistinct !== input.entityPopulation.entityRows) {
    result.push(observation("entity_population_mismatch", "population", input, {
      factDistinct: input.entityPopulation.factDistinct,
      entityRows: input.entityPopulation.entityRows,
      factRelation: input.entityPopulation.factRelation,
      entityRelation: input.entityPopulation.entityRelation,
    }, "事实表关联实体数与实体表行数不一致。"));
  }
  if (input.crossPeriodSet && input.crossPeriodSet.symmetricDifference > 0) {
    result.push(observation("cross_period_set_mismatch", "population", input, {
      leftCount: input.crossPeriodSet.leftCount,
      rightCount: input.crossPeriodSet.rightCount,
      symmetricDifference: input.crossPeriodSet.symmetricDifference,
    }, "比较期间的实体集合存在对称差异。"));
  }
  return result;
}

function nullLikeObservations(input: DetectorInput): AnomalyObservation[] {
  if (!input.digest) return [];
  const values = [...input.sql.matchAll(/\b(?:IN\s*\(([^)]*)\)|(?:=|<>|!=)\s*(['"])([^'"\n]+)\2)/gi)]
    .flatMap((match) => (match[1] ? match[1].split(",") : [match[3] ?? ""]))
    .map((value) => value.replace(/^\s*['"]|['"]\s*$/g, "").trim().toUpperCase())
    .filter((value) => ["NO PROMOTION", "UNKNOWN", "N/A", "NONE", "OTHER"].includes(value));
  if (!values.length) return [];
  return [observation("null_like_member_in_filter", "filter", input, { members: [...new Set(values)].join("|") }, "过滤条件包含可能代表空值或未知成员的维度成员；仅记录观测，不推断业务含义。")];
}

function physicalBoundObservations(input: DetectorInput): AnomalyObservation[] {
  const candidates = input.columns.map((column, index) => ({ column: column.toLowerCase(), index })).filter(({ column }) => /(^|_)(lat|latitude|lng|longitude|lon|quantity|amount|count|number)(_|$)/.test(column));
  const violations: Record<string, unknown>[] = [];
  for (const { column, index } of candidates) {
    for (const row of input.rows) {
      const value = typeof row[index] === "number" ? row[index] as number : Number(row[index]);
      if (!Number.isFinite(value)) continue;
      const lineage = input.digest?.outputLineage?.find((item) => item.output.toLowerCase() === input.columns[index].toLowerCase());
      const isDerivedSignedValue = Boolean(lineage && /(?:-|change|delta|diff|variance)/i.test(`${lineage.output} ${lineage.expression}`));
      const invalid = /lat|latitude/.test(column) && (value < -90 || value > 90)
        || /lng|longitude|lon/.test(column) && (value < -180 || value > 180)
        || /quantity|amount|count|number/.test(column) && value < 0 && !isDerivedSignedValue;
      if (invalid) violations.push({ column: input.columns[index], value });
    }
  }
  if (!violations.length) return [];
  return [observation("physical_bound_violation", "population", input, { values: violations.slice(0, 8) }, "结果样本中出现超出物理或非负数边界的值。")];
}

function intermediateObservations(input: DetectorInput): AnomalyObservation[] {
  const hardMeasures = input.spec.answerContract.measures?.filter((measure) => measure.binding === "hard") ?? [];
  if (!hardMeasures.length || !input.digest || input.digest.measures.length > 0) return [];
  return [observation("intermediate_candidate", "final_shape", input, { requiredMeasures: hardMeasures.length, observedMeasures: 0 }, "题面要求聚合度量，但当前 Query Digest 未识别到最终聚合。")];
}

/** Run only deterministic observations; this function never decides delivery. */
export function detectAnomalies(input: DetectorInput): readonly AnomalyObservation[] {
  const gates = evaluateGates({ spec: input.spec, digest: input.digest, metadata: { columns: input.columns, rowCount: input.rowCount, truncated: input.truncated } });
  const observations = [
    ...gateObservations(input, gates),
    ...probeObservations(input),
    ...nullLikeObservations(input),
    ...physicalBoundObservations(input),
    ...intermediateObservations(input),
  ];
  if (input.rowCount === 0 && observations.some((item) => item.detector === "unauthorized_filter")) {
    observations.push(observation("empty_after_filter", "filter", input, { rowCount: 0 }, "候选结果为空，且同一候选已登记未授权过滤异常。"));
  }
  const seen = new Set<string>();
  return observations.filter((item) => {
    const key = `${item.detector}:${item.slot}:${JSON.stringify(item.observed)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
