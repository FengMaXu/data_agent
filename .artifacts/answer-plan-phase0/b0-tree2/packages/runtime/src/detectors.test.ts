import { describe, expect, it } from "vitest";
import { createAnswerSpec } from "./answer-spec.js";
import { AnomalyRegistry } from "./anomaly-registry.js";
import { detectAnomalies } from "./detectors.js";
import { createQueryDigestCompiler } from "./query-digest.js";

const compiler = createQueryDigestCompiler();

describe("deterministic anomaly observations", () => {
  it("maps a scalar shape violation to a disclosure anomaly", () => {
    const spec = createAnswerSpec({ taskId: "task-shape", question: "How many answers?", rowMode: "scalar", rowCount: 1 });
    const digest = { ...compiler.compile({ sql: "SELECT answer FROM answers", dialect: "sqlite" }), parserEngine: "sqlglot" as const };
    const anomalies = detectAnomalies({ spec, digest, columns: ["answer"], rows: [[1], [2]], rowCount: 2, truncated: false, sql: digest.normalizedSql });
    expect(anomalies).toEqual(expect.arrayContaining([expect.objectContaining({ detector: "shape_mismatch", slot: "final_shape" })]));
  });

  it("uses Runtime-owned probe evidence for fanout, count, population, and period observations", () => {
    const spec = createAnswerSpec({ taskId: "task-probes", question: "How many orders?", rowMode: "scalar", rowCount: 1 });
    const base = compiler.compile({ sql: "SELECT COUNT(*) AS total FROM orders o JOIN items i ON i.order_id = o.id", dialect: "sqlite" });
    const digest = { ...base, parserEngine: "sqlglot" as const, measures: [{ function: "COUNT", expression: "COUNT(*)", distinct: false }], cardinalityEvidence: [{ left: "orders", right: "items", status: "fanout" as const, fanoutFactor: 2, source: "observed_snapshot" as const, snapshotId: "s1", countValue: 4, distinctCountValue: 2, duplicateKeys: ["order_id"] }] };
    const anomalies = detectAnomalies({
      spec, digest, columns: ["total"], rows: [[2]], rowCount: 1, truncated: false, sql: digest.normalizedSql,
      entityPopulation: { factDistinct: 2, entityRows: 3, factRelation: "orders", entityRelation: "customers" },
      crossPeriodSet: { leftCount: 3, rightCount: 4, symmetricDifference: 1 },
    });
    expect(anomalies.map((item) => item.detector)).toEqual(expect.arrayContaining(["join_fanout", "count_distinct_divergence", "entity_population_mismatch", "cross_period_set_mismatch"]));
  });

  it("detects a candidate that exposes divergent COUNT and COUNT(DISTINCT) measures", () => {
    const spec = createAnswerSpec({ taskId: "task-count-divergence", question: "How many orders?", rowMode: "scalar", rowCount: 1 });
    const digest = {
      ...compiler.compile({ sql: "SELECT COUNT(*) AS n, COUNT(DISTINCT order_id) AS unique_n FROM orders", dialect: "sqlite" }),
      parserEngine: "sqlglot" as const,
      measures: [
        { function: "COUNT", expression: "(*)", output: "n", distinct: false },
        { function: "COUNT", expression: "(DISTINCT order_id)", output: "unique_n", distinct: true },
      ],
    };
    const anomalies = detectAnomalies({ spec, digest, columns: ["n", "unique_n"], rows: [[4, 2]], rowCount: 1, truncated: false, sql: digest.normalizedSql });
    expect(anomalies).toEqual(expect.arrayContaining([expect.objectContaining({ detector: "count_distinct_divergence", slot: "measure" })]));
  });

  it("does not flag a signed derived change amount as an invalid negative amount", () => {
    const spec = createAnswerSpec({ taskId: "task-derived-amount", question: "Return the change amount" });
    const digest = {
      ...compiler.compile({ sql: "SELECT before_amount - after_amount AS change_amount FROM effects", dialect: "sqlite" }),
      parserEngine: "sqlglot" as const,
      outputLineage: [{ output: "change_amount", expression: "before_amount - after_amount", columns: ["before_amount", "after_amount"] }],
    };
    const anomalies = detectAnomalies({ spec, digest, columns: ["change_amount"], rows: [[-10]], rowCount: 1, truncated: false, sql: digest.normalizedSql });
    expect(anomalies.some((item) => item.detector === "physical_bound_violation")).toBe(false);
  });

  it("deduplicates observations and records an unchanged candidate fingerprint", () => {
    const registry = new AnomalyRegistry();
    const observation = { detector: "join_fanout" as const, slot: "measure" as const, observed: { joinedRows: 3 }, note: "fanout", fingerprint: "same" };
    const first = registry.register("task-1", [observation], { queryArtifactId: "artifact-1" });
    expect(first).toHaveLength(1);
    expect(registry.register("task-1", [observation], { queryArtifactId: "artifact-2" })).toHaveLength(0);
    const unchanged = registry.bindCandidate("task-1", "artifact-2", { measure: "same" });
    expect(unchanged).toEqual(expect.arrayContaining([expect.objectContaining({ detector: "fingerprint_unchanged", slot: "measure" })]));
    expect(registry.list("task-1")[0].boundCandidateIds).toEqual(["artifact-2"]);
    expect(registry.distinctFingerprintCount("task-1", "measure")).toBe(1);
    expect(registry.bindCandidate("task-1", "artifact-3", { measure: "different" })).toHaveLength(0);
    expect(registry.distinctFingerprintCount("task-1", "measure")).toBe(2);
  });
});
