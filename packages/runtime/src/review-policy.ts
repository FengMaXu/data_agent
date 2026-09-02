import type { QueryAssuranceMode, ReviewOutcome } from "./query-assurance.js";
import type { GateName } from "./query-gates.js";
import type { PublicationAuthorization, PublicationStatus } from "./publication.js";
import type { DeterministicGateCalibrationReport } from "./calibration.js";

export interface CalibrationIdentity {
  readonly reviewerModel: string;
  readonly reviewerPromptVersion: string;
  readonly queryDigestVersion: string;
  readonly parserVersion: string;
  readonly reviewCoverageSchemaVersion: string;
  readonly reviewPolicyVersion: string;
  readonly hardConstraintAdmissionPolicy: string;
  readonly gatePolicyVersion?: string;
  readonly gateApplicabilityVersion?: string;
  readonly probeTemplateVersion?: string;
  readonly evidenceAdmissionPolicyVersion?: string;
  readonly dialect?: string;
}

export interface CalibrationRecord {
  readonly identity: CalibrationIdentity;
  readonly eligible: boolean;
  /** Per-gate, per-calibration-scope eligibility. Missing means not calibrated. */
  readonly gateEligibility?: Partial<Record<GateName, boolean>>;
  readonly reportIds?: readonly string[];
  readonly reports?: readonly DeterministicGateCalibrationReport[];
}

/** Only Runtime-generated reports may mint an Enforce calibration record. */
export function calibrationRecordFromReports(identity: CalibrationIdentity, reports: readonly DeterministicGateCalibrationReport[], overallEligible = true): CalibrationRecord {
  if (reports.length === 0) throw new Error("DETERMINISTIC_GATE_CALIBRATION_REPORTS_REQUIRED");
  if (reports.some((report) => !sameIdentity(report.identity, identity) || report.dialect !== identity.dialect)) throw new Error("DETERMINISTIC_GATE_CALIBRATION_IDENTITY_MIXED");
  const gateEligibility = Object.fromEntries(reports.map((report) => [report.gate, report.eligibleForEnforce])) as Partial<Record<GateName, boolean>>;
  const record: CalibrationRecord = {
    identity: { ...identity },
    eligible: overallEligible && reports.every((report) => report.eligibleForEnforce),
    gateEligibility,
    reportIds: reports.map((report) => `${report.dialect}:${report.gate}:${report.caseIds.join(",")}`),
  };
  return { ...record, reports: reports.map((report) => ({ ...report, identity: { ...report.identity } })) };
}

function trustedCalibration(record: CalibrationRecord | undefined): CalibrationRecord | undefined {
  if (!record?.reports?.length || !record.reportIds?.length) return undefined;
  const reports = record.reports;
  const derived = Object.fromEntries(reports.map((report) => [report.gate, report.eligibleForEnforce])) as Partial<Record<GateName, boolean>>;
  if (reports.some((report) => !sameIdentity(report.identity, record.identity) || report.dialect !== record.identity.dialect)
    || JSON.stringify(derived) !== JSON.stringify(record.gateEligibility ?? {})
    || reports.length !== record.reportIds.length) return undefined;
  return record;
}

export const DETERMINISTIC_GATE_NAMES: readonly GateName[] = ["g1_shape", "g2_population", "g3_fanout", "g4_candidate"];

export interface ReviewModeControllerOptions {
  readonly requestedMode?: QueryAssuranceMode;
  readonly reviewerAvailable: boolean;
  readonly calibration?: CalibrationRecord;
  readonly currentCalibrationIdentity?: CalibrationIdentity;
  /** Gates that must have explicit calibrated blocking authority for Enforce. */
  readonly requiredGateNames?: readonly GateName[];
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
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => left[key as keyof CalibrationIdentity] === right[key as keyof CalibrationIdentity]);
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

export type ShadowDeliveryMode = "publish_with_disagreement" | "record_only";

export interface DeliveryDecision {
  readonly allowed: boolean;
  readonly status: PublicationStatus;
  readonly reason?: string;
}

export class DeliveryPolicy {
  constructor(readonly mode: QueryAssuranceMode, readonly options: { allowUnavailablePublication?: boolean; shadowDelivery?: ShadowDeliveryMode } = {}) {}

  decide(outcome: ReviewOutcome, authorization?: PublicationAuthorization): DeliveryDecision {
    const approved = outcome.availability === "available" && outcome.decision.status === "approved";
    const blockingRejection = outcome.availability === "available" && outcome.decision.blocking === true;
    // Shadow records the blind review but does not grant its semantic
    // disagreement blocking authority. Runtime-owned deterministic failures
    // remain non-overridable in every mode; an available LLM disagreement may
    // be published only as published_with_disagreement (or acknowledged by a
    // precise Publication Authorization in Enforce).
    const deterministicBlock = blockingRejection && outcome.decision.deterministic === true;
    const unavailable = outcome.availability === "unavailable";
    const deterministicUnavailable = unavailable && outcome.failure.deterministic === true;
    // Shadow is deliberately non-authoritative for LLM decisions, but a
    // deterministic Hard Constraint/Structural Fact failure is never allowed
    // to pass merely because the system is collecting shadow telemetry.
    if (deterministicBlock) return { allowed: false, status: "not_published_rejected", reason: "DETERMINISTIC_PREFLIGHT_FAILED" };
    if (deterministicUnavailable) return { allowed: false, status: "not_published_review_unavailable", reason: "DETERMINISTIC_GATE_UNAVAILABLE" };
    if (this.mode === "shadow" && this.options.shadowDelivery === "record_only" && !authorization) {
      return { allowed: false, status: "not_published_rejected", reason: "SHADOW_REVIEW_RECORD_ONLY" };
    }
    const allowedInShadow = this.mode === "shadow"
      && this.options.shadowDelivery !== "record_only"
      && !deterministicUnavailable
      && (!unavailable || this.options.allowUnavailablePublication === true);
    const allowedInOff = this.mode === "off";
    // Authorization is a user acknowledgement of an available, disclosed
    // semantic disagreement. It cannot manufacture evidence when review is
    // unavailable, and the deterministic block above has already failed
    // closed before this branch.
    const authorizationCanOverride = Boolean(authorization)
      && outcome.availability === "available"
      && outcome.decision.status === "rejected"
      && outcome.decision.deterministic !== true
      && Boolean(outcome.decision.diffs?.length);
    const approvedAllowed = approved && (this.mode !== "shadow" || this.options.shadowDelivery !== "record_only");
    const nonBlockingRejection = outcome.availability === "available"
      && outcome.decision.status === "rejected"
      && outcome.decision.blocking === false;
    if (approvedAllowed || allowedInShadow || allowedInOff || authorizationCanOverride || nonBlockingRejection) {
      // A Shadow reviewer has not earned publication authority. Never emit an
      // Approved receipt in Shadow, even if its model returned `approved`.
      const status = approved && this.mode === "enforce" ? "published_approved" : "published_with_disagreement";
      return { allowed: true, status };
    }
    return {
      allowed: false,
      status: outcome.availability === "unavailable" ? "not_published_review_unavailable" : "not_published_rejected",
      reason: outcome.availability === "unavailable" ? "REVIEW_UNAVAILABLE" : "REVIEW_NOT_APPROVED",
    };
  }
}

export class ReviewModeController {
  private requestedMode: QueryAssuranceMode;
  private reviewerAvailable: boolean;
  private calibration?: CalibrationRecord;
  private readonly currentCalibrationIdentity?: CalibrationIdentity;
  private readonly requiredGateNames: readonly GateName[];
  private invalidated = false;
  private readonly breaker: AssuranceCircuitBreaker;

  constructor(options: ReviewModeControllerOptions & { breaker?: AssuranceCircuitBreaker }) {
    this.requestedMode = options.requestedMode ?? "shadow";
    this.reviewerAvailable = options.reviewerAvailable;
    this.calibration = trustedCalibration(options.calibration);
    this.currentCalibrationIdentity = options.currentCalibrationIdentity;
    this.requiredGateNames = [...new Set(options.requiredGateNames ?? [])];
    if (options.calibration && this.currentCalibrationIdentity && !sameIdentity(options.calibration.identity, this.currentCalibrationIdentity)) this.invalidated = true;
    this.breaker = options.breaker ?? new AssuranceCircuitBreaker();
  }

  private missingGateCalibrations(): readonly GateName[] {
    if (this.requiredGateNames.length === 0) return [];
    return this.requiredGateNames.filter((gate) => this.calibration?.gateEligibility?.[gate] !== true);
  }

  mode(): QueryAssuranceMode {
    if (this.requestedMode === "off") return "off";
    // Missing reviewer capability must not turn a protected product path into
    // Review Off, whose Delivery Policy intentionally preserves legacy output.
    if (!this.reviewerAvailable) return "shadow";
    if (this.requestedMode !== "enforce") return this.requestedMode;
    if (!this.calibration?.eligible || this.invalidated || this.missingGateCalibrations().length > 0) return "shadow";
    return this.breaker.effectiveMode("enforce");
  }

  setMode(mode: QueryAssuranceMode): void {
    if (mode === "enforce" && (!this.reviewerAvailable || !this.calibration?.eligible || this.invalidated || this.missingGateCalibrations().length > 0)) throw new Error("REVIEW_CALIBRATION_REQUIRED");
    this.requestedMode = mode;
  }

  /** Hosts may complete onboarding after construction; capability changes must
   * immediately affect the effective mode instead of leaving a stale Off mode. */
  setReviewerAvailable(available: boolean): void { this.reviewerAvailable = available; }

  updateCalibration(record: CalibrationRecord): void {
    const verified = trustedCalibration(record);
    if (!verified) throw new Error("UNTRUSTED_CALIBRATION_RECORD");
    if (this.currentCalibrationIdentity) this.invalidated = !sameIdentity(verified.identity, this.currentCalibrationIdentity);
    else if (this.calibration && !sameIdentity(this.calibration.identity, verified.identity)) this.invalidated = true;
    this.calibration = verified;
  }

  calibrationInvalidated(): boolean { return this.invalidated; }
  circuitBreaker(): AssuranceCircuitBreaker { return this.breaker; }
  manifest(): { requestedMode: QueryAssuranceMode; mode: QueryAssuranceMode; calibrationInvalidated: boolean; circuitTripped: boolean; gateCalibrationMissing: readonly GateName[] } {
    return { requestedMode: this.requestedMode, mode: this.mode(), calibrationInvalidated: this.invalidated, circuitTripped: this.breaker.isTripped(), gateCalibrationMissing: this.missingGateCalibrations() };
  }
}
