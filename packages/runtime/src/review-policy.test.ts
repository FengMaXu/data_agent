import { describe, expect, it } from "vitest";
import { AssuranceCircuitBreaker, calibrationRecordFromReports, DETERMINISTIC_GATE_NAMES, DeliveryPolicy, ReviewModeController, type CalibrationIdentity } from "./review-policy.js";
import { DETERMINISTIC_GATE_CALIBRATION_THRESHOLDS, DEFAULT_CALIBRATION_THRESHOLDS, type CalibrationReport, type DeterministicGateCalibrationReport } from "./calibration.js";

const identity: CalibrationIdentity = {
  reviewerModel: "model-1",
  reviewerPromptVersion: "prompt-1",
  queryDigestVersion: "digest-1",
  parserVersion: "parser-1",
  reviewCoverageSchemaVersion: "coverage-1",
  reviewPolicyVersion: "policy-1",
  hardConstraintAdmissionPolicy: "hard-1",
  dialect: "sqlite",
};

function calibrated(gates = DETERMINISTIC_GATE_NAMES, calibratedIdentity = identity) {
  const reports = gates.map((gate): DeterministicGateCalibrationReport => ({
    gate,
    dialect: calibratedIdentity.dialect!,
    identity: calibratedIdentity,
    sampleSize: 3,
    caseIds: [`${gate}-positive`, `${gate}-negative`, `${gate}-rewrite`],
    metrics: { recall: 1, specificity: 1, precision: 1, falseBlocks: 0, missedBlocks: 0, unsupportedCases: 0, hardGateBypasses: 0, e2eRate: 1, nonDeliveryRate: 0, timeoutRate: 0, averageLatencyMs: 1, scannedRows: 3, averageCost: 0 },
    fixtureCoverage: { positive: true, neighbor_negative: true, equivalent_rewrite: true },
    thresholds: DETERMINISTIC_GATE_CALIBRATION_THRESHOLDS,
    eligibleForEnforce: true,
  }));
  const reviewerCalibration: CalibrationReport = {
    identity: calibratedIdentity,
    sampleSize: 1,
    metrics: { errorRecall: 1, correctQuerySpecificity: 1, mismatchPrecision: 1, repeatAgreement: 1, netE2ECorrect: 1, nonDeliveryDelta: 0, timeoutDelta: 0, p95LatencyDeltaMs: 0, averageTokenDeltaRatio: 0, averageCostDeltaRatio: 0 },
    thresholds: DEFAULT_CALIBRATION_THRESHOLDS,
    passes: { correctQuerySpecificity: true, mismatchPrecision: true, repeatAgreement: true, timeout: true, netE2ECorrect: true, nonDelivery: true, latency: true, cost: true },
    eligibleForEnforce: true,
  };
  return calibrationRecordFromReports(calibratedIdentity, reports, reviewerCalibration);
}

describe("DeliveryPolicy", () => {
  it("keeps unavailable and rejected decisions distinct from Approved", () => {
    const policy = new DeliveryPolicy("enforce");
    expect(policy.decide({ availability: "unavailable", failure: { code: "TIMEOUT", message: "timeout", retryable: true } })).toMatchObject({ allowed: false, status: "not_published_review_unavailable" });
    expect(policy.decide({ availability: "available", decision: { status: "rejected" } })).toMatchObject({ allowed: false, status: "not_published_rejected" });
    expect(new DeliveryPolicy("shadow").decide({ availability: "available", decision: { status: "rejected" } })).toMatchObject({ allowed: true, status: "published_with_disagreement" });
    expect(new DeliveryPolicy("shadow").decide({ availability: "available", decision: { status: "approved" } })).toMatchObject({ allowed: true, status: "published_with_disagreement" });
    expect(new DeliveryPolicy("enforce").decide({ availability: "available", decision: { status: "approved" } })).toMatchObject({ allowed: true, status: "published_approved" });
    expect(new DeliveryPolicy("enforce").decide({ availability: "available", decision: { status: "rejected", blocking: false, diffs: [{ aspect: "semantic", required: "x", observed: "y", evidence: { digestPath: "filters" } }] } })).toMatchObject({ allowed: false, status: "not_published_rejected" });
    expect(new DeliveryPolicy("shadow").decide({ availability: "available", decision: { status: "rejected", blocking: true } })).toMatchObject({ allowed: true, status: "published_with_disagreement" });
    expect(new DeliveryPolicy("shadow").decide({ availability: "available", decision: { status: "rejected", blocking: true, deterministic: true } })).toMatchObject({ allowed: false, status: "not_published_rejected" });
    expect(new DeliveryPolicy("shadow", { shadowDelivery: "record_only" }).decide({ availability: "available", decision: { status: "approved" } })).toMatchObject({ allowed: false, reason: "SHADOW_REVIEW_RECORD_ONLY" });
    expect(new DeliveryPolicy("shadow").decide({ availability: "unavailable", failure: { code: "TIMEOUT", message: "timeout", retryable: true } })).toMatchObject({ allowed: false, status: "not_published_review_unavailable" });
    expect(new DeliveryPolicy("shadow", { allowUnavailablePublication: true }).decide({ availability: "unavailable", failure: { code: "TIMEOUT", message: "timeout", retryable: true } })).toMatchObject({ allowed: true, status: "published_with_disagreement" });
    const authorization = { taskId: "task", queryArtifactId: "artifact", normalizedSqlHash: "sql", specVersion: "1", candidateId: "candidate", candidatePath: "path", contentSha256: "content", semanticDiffHashes: [] };
    expect(new DeliveryPolicy("enforce").decide({ availability: "available", decision: { status: "needs_clarification", ambiguities: ["scope"] } }, authorization)).toMatchObject({ allowed: false, status: "not_published_rejected" });
    expect(new DeliveryPolicy("enforce").decide({ availability: "available", decision: { status: "abstained", reason: "insufficient" } }, authorization)).toMatchObject({ allowed: false, status: "not_published_rejected" });
    expect(new DeliveryPolicy("enforce").decide({ availability: "available", decision: { status: "rejected", blocking: true } }, authorization)).toMatchObject({ allowed: false, status: "not_published_rejected" });
    expect(new DeliveryPolicy("enforce").decide({ availability: "unavailable", failure: { code: "DIGEST_UNAVAILABLE", message: "missing coverage", retryable: false } }, authorization)).toMatchObject({ allowed: false, status: "not_published_review_unavailable" });
    expect(new DeliveryPolicy("enforce").decide({ availability: "available", decision: { status: "rejected", blocking: true, deterministic: true } }, authorization)).toMatchObject({ allowed: false, status: "not_published_rejected" });
  });
});

describe("ReviewModeController", () => {
  it("defaults product-style configuration to Shadow Review and refuses uncalibrated enforce", () => {
    const controller = new ReviewModeController({ requestedMode: "shadow", reviewerAvailable: true });
    expect(controller.mode()).toBe("shadow");
    expect(() => controller.setMode("enforce")).toThrow("REVIEW_CALIBRATION_REQUIRED");
    expect(new ReviewModeController({ requestedMode: "enforce", reviewerAvailable: false }).mode()).toBe("shadow");
  });

  it("keeps a protected path in Shadow while a reviewer is unavailable", () => {
    const controller = new ReviewModeController({ requestedMode: "shadow", reviewerAvailable: false });
    expect(controller.mode()).toBe("shadow");
    controller.setReviewerAvailable(true);
    expect(controller.mode()).toBe("shadow");
    controller.setReviewerAvailable(false);
    expect(controller.mode()).toBe("shadow");
  });

  it("requires explicit calibration for every deterministic gate before Enforce", () => {
    const controller = new ReviewModeController({ requestedMode: "enforce", reviewerAvailable: true, requiredGateNames: DETERMINISTIC_GATE_NAMES, calibration: calibrated(["g1_shape", "g2_population", "g3_fanout"]) });
    expect(controller.mode()).toBe("shadow");
    expect(controller.manifest().gateCalibrationMissing).toEqual(["g4_candidate"]);
    controller.updateCalibration(calibrated());
    expect(controller.mode()).toBe("enforce");
  });

  it("invalidates enforce eligibility when any calibration identity component changes", () => {
    const controller = new ReviewModeController({ requestedMode: "enforce", reviewerAvailable: true, calibration: calibrated() });
    expect(controller.mode()).toBe("enforce");
    const changedIdentity = { ...identity, parserVersion: "parser-2" };
    controller.updateCalibration(calibrated(DETERMINISTIC_GATE_NAMES, changedIdentity));
    expect(controller.mode()).toBe("shadow");
    expect(controller.calibrationInvalidated()).toBe(true);
  });
});

describe("AssuranceCircuitBreaker", () => {
  it("falls back to shadow, emits one trip and does not automatically recover", () => {
    const events: string[] = [];
    const breaker = new AssuranceCircuitBreaker({ onTrip: (reason) => events.push(reason) });
    expect(breaker.effectiveMode("enforce")).toBe("enforce");
    breaker.observe({ unavailableRate: 0.25, timeoutRate: 0, invalidResponseRate: 0, userOverrideRate: 0, specificity: 1, p95LatencyMs: 1, p95BaselineLatencyMs: 1, averageCost: 1, baselineCost: 1 });
    expect(breaker.effectiveMode("enforce")).toBe("shadow");
    expect(events).toHaveLength(1);
    breaker.observe({ unavailableRate: 0, timeoutRate: 0, invalidResponseRate: 0, userOverrideRate: 0, specificity: 1, p95LatencyMs: 1, p95BaselineLatencyMs: 1, averageCost: 1, baselineCost: 1 });
    expect(breaker.effectiveMode("enforce")).toBe("shadow");
    expect(events).toHaveLength(1);
    expect(() => breaker.reset()).toThrow("CIRCUIT_BREAKER_RECALIBRATION_REQUIRED");
  });
});
