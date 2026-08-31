import { describe, expect, it } from "vitest";
import { AssuranceCircuitBreaker, DeliveryPolicy, ReviewModeController, type CalibrationIdentity } from "./review-policy.js";

const identity: CalibrationIdentity = {
  reviewerModel: "model-1",
  reviewerPromptVersion: "prompt-1",
  queryDigestVersion: "digest-1",
  parserVersion: "parser-1",
  reviewCoverageSchemaVersion: "coverage-1",
  reviewPolicyVersion: "policy-1",
  hardConstraintAdmissionPolicy: "hard-1",
};

describe("DeliveryPolicy", () => {
  it("keeps unavailable and rejected decisions distinct from Approved", () => {
    const policy = new DeliveryPolicy("enforce");
    expect(policy.decide({ availability: "unavailable", failure: { code: "TIMEOUT", message: "timeout", retryable: true } })).toMatchObject({ allowed: false, status: "not_published_review_unavailable" });
    expect(policy.decide({ availability: "available", decision: { status: "rejected" } })).toMatchObject({ allowed: false, status: "not_published_rejected" });
    expect(new DeliveryPolicy("shadow").decide({ availability: "available", decision: { status: "rejected" } })).toMatchObject({ allowed: true, status: "published_with_disagreement" });
    expect(new DeliveryPolicy("shadow").decide({ availability: "unavailable", failure: { code: "TIMEOUT", message: "timeout", retryable: true } })).toMatchObject({ allowed: false, status: "not_published_review_unavailable" });
    expect(new DeliveryPolicy("shadow", { allowUnavailablePublication: true }).decide({ availability: "unavailable", failure: { code: "TIMEOUT", message: "timeout", retryable: true } })).toMatchObject({ allowed: true, status: "published_with_disagreement" });
    const authorization = { taskId: "task", queryArtifactId: "artifact", normalizedSqlHash: "sql", specVersion: "1", candidateId: "candidate", candidatePath: "path", contentSha256: "content", semanticDiffHashes: [] };
    expect(new DeliveryPolicy("enforce").decide({ availability: "available", decision: { status: "needs_clarification", ambiguities: ["scope"] } }, authorization)).toMatchObject({ allowed: false, status: "not_published_rejected" });
  });
});

describe("ReviewModeController", () => {
  it("defaults product-style configuration to Shadow Review and refuses uncalibrated enforce", () => {
    const controller = new ReviewModeController({ requestedMode: "shadow", reviewerAvailable: true });
    expect(controller.mode()).toBe("shadow");
    expect(() => controller.setMode("enforce")).toThrow("REVIEW_CALIBRATION_REQUIRED");
    expect(new ReviewModeController({ requestedMode: "enforce", reviewerAvailable: false }).mode()).toBe("off");
  });

  it("invalidates enforce eligibility when any calibration identity component changes", () => {
    const controller = new ReviewModeController({ requestedMode: "enforce", reviewerAvailable: true, calibration: { identity, eligible: true } });
    expect(controller.mode()).toBe("enforce");
    controller.updateCalibration({ identity: { ...identity, parserVersion: "parser-2" }, eligible: true });
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
