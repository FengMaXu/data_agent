import type { QueryAssuranceMode, ReviewOutcome } from "./query-assurance.js";
import type { PublicationAuthorization, PublicationStatus } from "./publication.js";

export interface CalibrationIdentity {
  readonly reviewerModel: string;
  readonly reviewerPromptVersion: string;
  readonly queryDigestVersion: string;
  readonly parserVersion: string;
  readonly reviewCoverageSchemaVersion: string;
  readonly reviewPolicyVersion: string;
  readonly hardConstraintAdmissionPolicy: string;
}

export interface CalibrationRecord {
  readonly identity: CalibrationIdentity;
  readonly eligible: boolean;
}

export interface ReviewModeControllerOptions {
  readonly requestedMode?: QueryAssuranceMode;
  readonly reviewerAvailable: boolean;
  readonly calibration?: CalibrationRecord;
  readonly currentCalibrationIdentity?: CalibrationIdentity;
}

export interface AssuranceMetrics {
  readonly unavailableRate: number;
  readonly timeoutRate: number;
  readonly invalidResponseRate: number;
  readonly userOverrideRate: number;
  readonly specificity: number;
  readonly p95LatencyMs: number;
  readonly p95BaselineLatencyMs: number;
  readonly averageCost: number;
  readonly baselineCost: number;
}

export interface CircuitBreakerThresholds {
  readonly unavailableRate: number;
  readonly timeoutRate: number;
  readonly invalidResponseRate: number;
  readonly userOverrideRate: number;
  readonly specificity: number;
  readonly latencyAbsoluteMs: number;
  readonly latencyRatio: number;
  readonly costRatio: number;
}

const DEFAULT_THRESHOLDS: CircuitBreakerThresholds = {
  unavailableRate: 0.1,
  timeoutRate: 0.1,
  invalidResponseRate: 0.05,
  userOverrideRate: 0.2,
  specificity: 0.98,
  latencyAbsoluteMs: 20_000,
  latencyRatio: 0.25,
  costRatio: 1.3,
};

function sameIdentity(left: CalibrationIdentity | undefined, right: CalibrationIdentity | undefined): boolean {
  if (!left || !right) return left === right;
  return Object.keys(left).every((key) => left[key as keyof CalibrationIdentity] === right[key as keyof CalibrationIdentity]);
}

export class AssuranceCircuitBreaker {
  private readonly thresholds: CircuitBreakerThresholds;
  private readonly onTrip?: (reason: string) => void;
  private tripped = false;
  private reason?: string;

  constructor(options: { thresholds?: Partial<CircuitBreakerThresholds>; onTrip?: (reason: string) => void } = {}) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
    this.onTrip = options.onTrip;
  }

  observe(metrics: AssuranceMetrics): void {
    if (this.tripped) return;
    const reasons = [
      metrics.unavailableRate > this.thresholds.unavailableRate ? "unavailable_rate" : undefined,
      metrics.timeoutRate > this.thresholds.timeoutRate ? "timeout_rate" : undefined,
      metrics.invalidResponseRate > this.thresholds.invalidResponseRate ? "invalid_response_rate" : undefined,
      metrics.userOverrideRate > this.thresholds.userOverrideRate ? "user_override_rate" : undefined,
      metrics.specificity < this.thresholds.specificity ? "specificity" : undefined,
      metrics.p95LatencyMs > metrics.p95BaselineLatencyMs + Math.max(this.thresholds.latencyAbsoluteMs, metrics.p95BaselineLatencyMs * this.thresholds.latencyRatio) ? "latency" : undefined,
      metrics.baselineCost > 0 && metrics.averageCost > metrics.baselineCost * this.thresholds.costRatio ? "cost" : undefined,
    ].filter((reason): reason is string => Boolean(reason));
    if (reasons.length > 0) {
      this.tripped = true;
      this.reason = reasons[0];
      this.onTrip?.(reasons[0]);
    }
  }

  effectiveMode(requested: QueryAssuranceMode): QueryAssuranceMode {
    return this.tripped && requested === "enforce" ? "shadow" : requested;
  }

  isTripped(): boolean { return this.tripped; }
  tripReason(): string | undefined { return this.reason; }
  reset(options: { recalibrated?: boolean } = {}): void {
    if (!options.recalibrated) throw new Error("CIRCUIT_BREAKER_RECALIBRATION_REQUIRED");
    this.tripped = false;
    this.reason = undefined;
  }
}

export interface DeliveryDecision {
  readonly allowed: boolean;
  readonly status: PublicationStatus;
  readonly reason?: string;
}

export class DeliveryPolicy {
  constructor(readonly mode: QueryAssuranceMode, readonly options: { allowUnavailablePublication?: boolean } = {}) {}

  decide(outcome: ReviewOutcome, authorization?: PublicationAuthorization): DeliveryDecision {
    const approved = outcome.availability === "available" && outcome.decision.status === "approved";
    const unavailable = outcome.availability === "unavailable";
    const allowedInShadow = this.mode === "shadow" && (!unavailable || this.options.allowUnavailablePublication === true);
    const allowedInOff = this.mode === "off";
    if (approved || allowedInShadow || allowedInOff || authorization) return { allowed: true, status: approved ? "published_approved" : "published_with_disagreement" };
    return {
      allowed: false,
      status: outcome.availability === "unavailable" ? "not_published_review_unavailable" : "not_published_rejected",
      reason: outcome.availability === "unavailable" ? "REVIEW_UNAVAILABLE" : "REVIEW_NOT_APPROVED",
    };
  }
}

export class ReviewModeController {
  private requestedMode: QueryAssuranceMode;
  private readonly reviewerAvailable: boolean;
  private calibration?: CalibrationRecord;
  private invalidated = false;
  private readonly breaker: AssuranceCircuitBreaker;

  constructor(options: ReviewModeControllerOptions & { breaker?: AssuranceCircuitBreaker }) {
    this.requestedMode = options.requestedMode ?? "shadow";
    this.reviewerAvailable = options.reviewerAvailable;
    this.calibration = options.calibration;
    if (options.calibration && options.currentCalibrationIdentity && !sameIdentity(options.calibration.identity, options.currentCalibrationIdentity)) this.invalidated = true;
    this.breaker = options.breaker ?? new AssuranceCircuitBreaker();
  }

  mode(): QueryAssuranceMode {
    if (!this.reviewerAvailable) return "off";
    if (this.requestedMode !== "enforce") return this.requestedMode;
    if (!this.calibration?.eligible || this.invalidated) return "shadow";
    return this.breaker.effectiveMode("enforce");
  }

  setMode(mode: QueryAssuranceMode): void {
    if (mode === "enforce" && (!this.reviewerAvailable || !this.calibration?.eligible || this.invalidated)) throw new Error("REVIEW_CALIBRATION_REQUIRED");
    this.requestedMode = mode;
  }

  updateCalibration(record: CalibrationRecord): void {
    if (this.calibration && !sameIdentity(this.calibration.identity, record.identity)) this.invalidated = true;
    this.calibration = record;
  }

  calibrationInvalidated(): boolean { return this.invalidated; }
  circuitBreaker(): AssuranceCircuitBreaker { return this.breaker; }
  manifest(): { mode: QueryAssuranceMode; calibrationInvalidated: boolean; circuitTripped: boolean } {
    return { mode: this.mode(), calibrationInvalidated: this.invalidated, circuitTripped: this.breaker.isTripped() };
  }
}
