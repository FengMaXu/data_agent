import { describe, expect, it } from "vitest";
import { createCalibrationReport, DEFAULT_CALIBRATION_THRESHOLDS, type CalibrationCase } from "./calibration.js";

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
