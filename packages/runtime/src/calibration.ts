import type { CalibrationIdentity } from "./review-policy.js";
import type { ReviewDecisionStatus } from "./query-assurance.js";

export const DEFAULT_CALIBRATION_THRESHOLDS = {
  correctQuerySpecificity: 0.98,
  mismatchPrecision: 0.9,
  repeatAgreement: 0.95,
  timeoutDeltaMax: 0.01,
  nonDeliveryDeltaMax: 0.01,
  p95LatencyAbsoluteMaxMs: 20_000,
  p95LatencyRatioMax: 0.25,
  averageCostDeltaRatioMax: 0.3,
} as const;

export interface CalibrationDiffLabel { readonly aspect: string; readonly valid: boolean; }

export interface CalibrationCase {
  readonly caseId: string;
  readonly expected: "correct" | "mismatch";
  readonly decision: ReviewDecisionStatus;
  readonly diffs: readonly CalibrationDiffLabel[];
  readonly repeatGroup?: string;
  readonly baselineCorrect: boolean;
  readonly assuranceCorrect: boolean;
  readonly submitted: boolean;
  readonly baselineSubmitted?: boolean;
  readonly timedOut: boolean;
  readonly baselineTimedOut?: boolean;
  readonly durationMs: number;
  readonly baselineDurationMs: number;
  readonly tokens: number;
  readonly baselineTokens: number;
  readonly cost: number;
  readonly baselineCost: number;
  readonly identity: CalibrationIdentity;
}

export interface CalibrationMetrics {
  readonly errorRecall: number;
  readonly correctQuerySpecificity: number;
  readonly mismatchPrecision: number;
  readonly repeatAgreement: number;
  readonly netE2ECorrect: number;
  readonly nonDeliveryDelta: number;
  readonly timeoutDelta: number;
  readonly p95LatencyDeltaMs: number;
  readonly averageTokenDeltaRatio: number;
  readonly averageCostDeltaRatio: number;
}

export interface CalibrationReport {
  readonly identity: CalibrationIdentity;
  readonly sampleSize: number;
  readonly metrics: CalibrationMetrics;
  readonly thresholds: typeof DEFAULT_CALIBRATION_THRESHOLDS;
  readonly passes: {
    readonly correctQuerySpecificity: boolean;
    readonly mismatchPrecision: boolean;
    readonly repeatAgreement: boolean;
    readonly timeout: boolean;
    readonly netE2ECorrect: boolean;
    readonly nonDelivery: boolean;
    readonly latency: boolean;
    readonly cost: boolean;
  };
  readonly eligibleForEnforce: boolean;
}

function p95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

function average(values: readonly number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function sameIdentity(left: CalibrationIdentity, right: CalibrationIdentity): boolean { return Object.keys(left).every((key) => left[key as keyof CalibrationIdentity] === right[key as keyof CalibrationIdentity]); }

export function createCalibrationReport(cases: readonly CalibrationCase[]): CalibrationReport {
  if (cases.length === 0) throw new Error("CALIBRATION_CASES_EMPTY");
  const identity = cases[0].identity;
  if (cases.some((item) => !sameIdentity(identity, item.identity))) throw new Error("CALIBRATION_IDENTITY_MIXED");
  const mismatches = cases.filter((item) => item.expected === "mismatch");
  const correct = cases.filter((item) => item.expected === "correct");
  const detected = mismatches.filter((item) => item.decision !== "approved");
  const allDiffs = mismatches.flatMap((item) => item.diffs);
  const validDiffs = allDiffs.filter((item) => item.valid);
  const repeatGroups = new Map<string, CalibrationCase[]>();
  for (const item of cases) if (item.repeatGroup) repeatGroups.set(item.repeatGroup, [...(repeatGroups.get(item.repeatGroup) ?? []), item]);
  const repeatable = [...repeatGroups.values()].filter((group) => group.length > 1);
  const agreement = repeatable.filter((group) => group.every((item) => item.decision === group[0].decision)).length;
  const notDelivered = cases.filter((item) => !item.submitted).length / cases.length;
  const baselineNotDelivered = cases.filter((item) => item.baselineSubmitted === false).length / cases.length;
  const timeouts = cases.filter((item) => item.timedOut).length / cases.length;
  const baselineTimeouts = cases.filter((item) => item.baselineTimedOut === true).length / cases.length;
  const baselineP95Latency = p95(cases.map((item) => item.baselineDurationMs));
  const metrics: CalibrationMetrics = {
    errorRecall: mismatches.length ? detected.length / mismatches.length : 0,
    correctQuerySpecificity: correct.length ? correct.filter((item) => item.decision === "approved").length / correct.length : 0,
    mismatchPrecision: allDiffs.length ? validDiffs.length / allDiffs.length : 0,
    repeatAgreement: repeatable.length ? agreement / repeatable.length : 0,
    netE2ECorrect: cases.filter((item) => item.assuranceCorrect).length - cases.filter((item) => item.baselineCorrect).length,
    nonDeliveryDelta: notDelivered - baselineNotDelivered,
    timeoutDelta: timeouts - baselineTimeouts,
    p95LatencyDeltaMs: p95(cases.map((item) => item.durationMs)) - p95(cases.map((item) => item.baselineDurationMs)),
    averageTokenDeltaRatio: average(cases.map((item) => item.baselineTokens)) ? average(cases.map((item) => item.tokens)) / average(cases.map((item) => item.baselineTokens)) - 1 : 0,
    averageCostDeltaRatio: average(cases.map((item) => item.baselineCost)) ? average(cases.map((item) => item.cost)) / average(cases.map((item) => item.baselineCost)) - 1 : 0,
  };
  const passes = {
    correctQuerySpecificity: metrics.correctQuerySpecificity >= DEFAULT_CALIBRATION_THRESHOLDS.correctQuerySpecificity,
    mismatchPrecision: metrics.mismatchPrecision >= DEFAULT_CALIBRATION_THRESHOLDS.mismatchPrecision,
    repeatAgreement: metrics.repeatAgreement >= DEFAULT_CALIBRATION_THRESHOLDS.repeatAgreement,
    timeout: metrics.timeoutDelta <= DEFAULT_CALIBRATION_THRESHOLDS.timeoutDeltaMax,
    netE2ECorrect: metrics.netE2ECorrect > 0,
    nonDelivery: metrics.nonDeliveryDelta <= DEFAULT_CALIBRATION_THRESHOLDS.nonDeliveryDeltaMax,
    latency: metrics.p95LatencyDeltaMs <= Math.max(DEFAULT_CALIBRATION_THRESHOLDS.p95LatencyAbsoluteMaxMs, baselineP95Latency * DEFAULT_CALIBRATION_THRESHOLDS.p95LatencyRatioMax),
    cost: metrics.averageCostDeltaRatio <= DEFAULT_CALIBRATION_THRESHOLDS.averageCostDeltaRatioMax,
  };
  return { identity, sampleSize: cases.length, metrics, thresholds: DEFAULT_CALIBRATION_THRESHOLDS, passes, eligibleForEnforce: Object.values(passes).every(Boolean) };
}

export function createCalibrationReports(cases: readonly CalibrationCase[]): readonly CalibrationReport[] {
  const groups = new Map<string, CalibrationCase[]>();
  for (const item of cases) {
    const key = JSON.stringify(item.identity, Object.keys(item.identity).sort());
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()].map(createCalibrationReport);
}
