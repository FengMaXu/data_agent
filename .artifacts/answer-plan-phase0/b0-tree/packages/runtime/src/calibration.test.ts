import { describe, expect, it } from "vitest";
import { createCalibrationReport, createDeterministicGateCalibrationReport, createDeterministicGateCalibrationReports, DEFAULT_CALIBRATION_THRESHOLDS, type CalibrationCase, type DeterministicGateCalibrationCase } from "./calibration.js";
import { createAnswerSpec } from "./answer-spec.js";
import { createQueryDigestCompiler, createSqlglotQueryDigestCompiler, type SqlDialect } from "./query-digest.js";
import type { GateEvaluationInput, GateName } from "./query-gates.js";

const base = (overrides: Partial<CalibrationCase>): CalibrationCase => ({
  caseId: "case-1",
  expected: "mismatch",
  decision: "rejected",
  diffs: [{ aspect: "grain", valid: true }],
  baselineCorrect: false,
  assuranceCorrect: false,
  submitted: true,
  timedOut: false,
  durationMs: 100,
  baselineDurationMs: 80,
  tokens: 100,
  baselineTokens: 90,
  cost: 1,
  baselineCost: 0.9,
  identity: { reviewerModel: "model", reviewerPromptVersion: "prompt", queryDigestVersion: "digest", parserVersion: "parser", reviewCoverageSchemaVersion: "coverage", reviewPolicyVersion: "policy", hardConstraintAdmissionPolicy: "hard" },
  ...overrides,
});

describe("Review Calibration", () => {
  it("computes case and aspect metrics without treating a wrong diff reason as precision", () => {
    const report = createCalibrationReport([
      base({ caseId: "bad-1" }),
      base({ caseId: "bad-2", diffs: [{ aspect: "grain", valid: false }] }),
      base({ caseId: "good-1", expected: "correct", decision: "approved", diffs: [], assuranceCorrect: true, baselineCorrect: true }),
      base({ caseId: "good-2", expected: "correct", decision: "rejected", diffs: [{ aspect: "projection", valid: true }], assuranceCorrect: false, baselineCorrect: true }),
    ]);

    expect(report.metrics.errorRecall).toBe(1);
    expect(report.metrics.correctQuerySpecificity).toBe(0.5);
    expect(report.metrics.mismatchPrecision).toBe(0.5);
    expect(report.metrics.netE2ECorrect).toBe(-1);
    expect(report.passes).toMatchObject({ mismatchPrecision: false, correctQuerySpecificity: false });
  });

  it("replays frozen deterministic inputs instead of accepting observed labels", () => {
    const identity = { ...base({}).identity, dialect: "sqlite", gatePolicyVersion: "1", gateApplicabilityVersion: "1" };
    const compiler = createQueryDigestCompiler();
    const spec = (columns: readonly string[]) => ({ taskId: "task", specVersion: "1", question: "return answer", answerContract: { output: { value: { columns, rowMode: "scalar" as const }, binding: "hard" as const, provenance: { authority: "request_wording" as const, source: "question" } } }, hardConstraints: [], hypotheses: [], ambiguities: [], provenance: [] });
    const make = (caseId: string, variant: DeterministicGateCalibrationCase["variant"], expected: DeterministicGateCalibrationCase["expected"], actualColumn: string): DeterministicGateCalibrationCase => {
      const digest = { ...compiler.compile({ sql: `SELECT 1 AS ${actualColumn}`, dialect: "sqlite" }), parserEngine: "sqlglot" as const };
      return { caseId, dialect: "sqlite", gate: "g1_shape", expected, variant, candidate: { queryArtifactId: caseId, normalizedSqlHash: digest.normalizedSqlHash }, identity, input: { spec: spec(["answer"]), digest, metadata: { columns: [actualColumn], rowCount: 1 }, gatePolicyVersion: "1", gateApplicabilityVersion: "1" }, submitted: true, e2eCorrect: true, durationMs: 1 };
    };
    const report = createDeterministicGateCalibrationReport([
      make("correct", "positive", "pass", "answer"),
      make("error", "neighbor_negative", "block", "wrong"),
      make("rewrite", "equivalent_rewrite", "pass", "answer"),
    ]);
    expect(report.metrics).toMatchObject({ recall: 1, specificity: 1, precision: 1, hardGateBypasses: 0 });
    expect(report.fixtureCoverage).toEqual({ positive: true, neighbor_negative: true, equivalent_rewrite: true });
    expect(report.identity).toEqual(identity);
    expect(report.eligibleForEnforce).toBe(true);
  });

  it("generates independent authoritative G1-G4 replay reports for every supported product dialect", () => {
    const compiler = createSqlglotQueryDigestCompiler({ executable: "python" });
    const dialects: readonly SqlDialect[] = ["sqlite", "mysql", "bigquery", "snowflake"];
    const cases: DeterministicGateCalibrationCase[] = [];
    const add = (dialect: SqlDialect, gate: GateName, variant: DeterministicGateCalibrationCase["variant"], expected: DeterministicGateCalibrationCase["expected"], input: GateEvaluationInput) => {
      const caseId = `${dialect}-${gate}-${variant}`;
      cases.push({
        caseId,
        dialect,
        gate,
        variant,
        expected,
        input: { ...input, gatePolicyVersion: "1", gateApplicabilityVersion: "2" },
        candidate: { queryArtifactId: caseId, normalizedSqlHash: input.digest!.normalizedSqlHash },
        identity: { ...base({}).identity, dialect, parserVersion: input.digest!.parserVersion, gatePolicyVersion: "1", gateApplicabilityVersion: "2" },
        submitted: true,
        e2eCorrect: true,
        timedOut: false,
        durationMs: 1,
        scannedRows: 1,
        cost: 0,
      });
    };
    for (const dialect of dialects) {
      const compile = (sql: string) => compiler.compile({ sql, dialect });
      const g1Spec = createAnswerSpec({ taskId: `${dialect}-g1`, question: "Return answer", answerContract: { output: { value: { columns: ["answer"], rowMode: "scalar" }, authority: "request_wording", source: "question" } } });
      add(dialect, "g1_shape", "positive", "pass", { spec: g1Spec, digest: compile("SELECT 1 AS answer"), metadata: { columns: ["answer"], rowCount: 1 } });
      add(dialect, "g1_shape", "neighbor_negative", "block", { spec: g1Spec, digest: compile("SELECT 1 AS wrong"), metadata: { columns: ["wrong"], rowCount: 1 } });
      add(dialect, "g1_shape", "equivalent_rewrite", "pass", { spec: g1Spec, digest: compile("SELECT (1) AS answer"), metadata: { columns: ["answer"], rowCount: 1 } });

      const g2Spec = createAnswerSpec({ taskId: `${dialect}-g2`, question: "Only delivered orders", constraints: [{ statement: "Only delivered orders", authority: "request_wording", scope: "filter", source: "question" }], physicalMappings: [{ mappingId: "delivered", hardConstraintId: "HC-1", physicalField: "order_status", physicalValue: "delivered", authority: "observed_data", source: "controlled" }] });
      add(dialect, "g2_population", "positive", "pass", { spec: g2Spec, digest: compile("SELECT order_id FROM orders WHERE order_status = 'delivered'"), metadata: { columns: ["order_id"], rowCount: 1 } });
      add(dialect, "g2_population", "neighbor_negative", "block", { spec: g2Spec, digest: compile("SELECT order_id FROM orders WHERE promo_id <> 999"), metadata: { columns: ["order_id"], rowCount: 1 } });
      add(dialect, "g2_population", "equivalent_rewrite", "pass", { spec: g2Spec, digest: compile("SELECT o.order_id FROM orders AS o WHERE o.order_status = 'delivered'"), metadata: { columns: ["order_id"], rowCount: 1 } });

      const schema = { connectionId: `${dialect}-connection`, dialect, tables: [{ name: "orders", columns: ["id", "amount"], primaryKey: ["id"] }, { name: "order_items", columns: ["order_id", "amount"] }] };
      const g3Spec = (sourceRelation: string) => createAnswerSpec({ taskId: `${dialect}-g3-${sourceRelation}`, question: "Return total", answerContract: { measures: [{ value: { kind: "sum", sourceRelation }, authority: "request_wording", source: "question" }], joins: [{ value: { left: "orders", right: "order_items", keys: ["order_id"], leftKeys: ["id"], rightKeys: ["order_id"], expectedCardinality: "1:N", preservedSide: "left" }, authority: "schema_structure", source: "schema", structural: true }] } });
      const joinSql = "SELECT o.id, SUM(i.amount) AS total FROM orders o JOIN order_items i ON i.order_id = o.id GROUP BY o.id";
      add(dialect, "g3_fanout", "positive", "pass", { spec: g3Spec("order_items"), digest: compile(joinSql), schema, metadata: { columns: ["id", "total"], rowCount: 1 } });
      add(dialect, "g3_fanout", "neighbor_negative", "block", { spec: g3Spec("orders"), digest: compile(joinSql), schema, metadata: { columns: ["id", "total"], rowCount: 1 } });
      add(dialect, "g3_fanout", "equivalent_rewrite", "pass", { spec: g3Spec("order_items"), digest: compile("SELECT orders.id, SUM(order_items.amount) AS total FROM orders JOIN order_items ON order_items.order_id = orders.id GROUP BY orders.id"), schema, metadata: { columns: ["id", "total"], rowCount: 1 } });

      const g4Spec = createAnswerSpec({ taskId: `${dialect}-g4`, question: "Return orders" });
      const g4Digest = compile("SELECT order_id FROM orders");
      add(dialect, "g4_candidate", "positive", "pass", { spec: g4Spec, digest: g4Digest, candidateFingerprint: "fresh", candidatePreviouslyFailed: false, metadata: { columns: ["order_id"], rowCount: 1 } });
      add(dialect, "g4_candidate", "neighbor_negative", "block", { spec: g4Spec, digest: g4Digest, candidateFingerprint: "failed", candidatePreviouslyFailed: true, failedClaimIds: ["population-effect-1"], metadata: { columns: ["order_id"], rowCount: 1 } });
      add(dialect, "g4_candidate", "equivalent_rewrite", "pass", { spec: g4Spec, digest: compile("SELECT orders.order_id FROM orders"), candidateFingerprint: "fresh-rewrite", candidatePreviouslyFailed: false, metadata: { columns: ["order_id"], rowCount: 1 } });
    }
    const reports = createDeterministicGateCalibrationReports(cases);
    expect(reports).toHaveLength(dialects.length * 4);
    expect(reports.every((report) => report.eligibleForEnforce)).toBe(true);
    expect(new Set(reports.map((report) => `${report.dialect}:${report.gate}`)).size).toBe(dialects.length * 4);
  }, 30_000);

  it("reports repeat agreement, fixed denominator delivery delta, p95 and cost deltas", () => {
    const report = createCalibrationReport([
      base({ caseId: "repeat-a", repeatGroup: "r", decision: "approved", expected: "mismatch", assuranceCorrect: false, diffs: [] }),
      base({ caseId: "repeat-b", repeatGroup: "r", decision: "rejected", expected: "mismatch", durationMs: 500, baselineDurationMs: 100, cost: 2, baselineCost: 1, assuranceCorrect: true }),
      base({ caseId: "missing", expected: "correct", submitted: false, assuranceCorrect: false, baselineCorrect: false, durationMs: 50, baselineDurationMs: 50, cost: 1, baselineCost: 1, diffs: [] }),
    ]);

    expect(report.metrics.repeatAgreement).toBe(0);
    expect(report.metrics.nonDeliveryDelta).toBeGreaterThan(0);
    expect(report.metrics.p95LatencyDeltaMs).toBeGreaterThan(0);
    expect(report.metrics.averageCostDeltaRatio).toBeGreaterThan(0);
    expect(report.thresholds).toEqual(DEFAULT_CALIBRATION_THRESHOLDS);
  });
});
