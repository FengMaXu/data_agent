import { describe, expect, it } from "vitest";
import { createCalibrationReport, createDeterministicGateCalibrationReport, DEFAULT_CALIBRATION_THRESHOLDS, type CalibrationCase, type DeterministicGateCalibrationCase } from "./calibration.js";
import { createQueryDigestCompiler } from "./query-digest.js";

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
      return { caseId, dialect: "sqlite", gate: "g1_shape", expected, variant, candidate: { queryArtifactId: caseId, normalizedSqlHash: digest.normalizedSqlHash }, identity, input: { spec: spec(["answer"]), digest, metadata: { columns: [actualColumn], rowCount: 1 }, gatePolicyVersion: "1", gateApplicabilityVersion: "1" } };
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
