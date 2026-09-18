import { randomUUID } from "node:crypto";
import type { AnswerSpec, CheckCoverage, Finding } from "./model.js";
import type { PrivateResultObject } from "./result-store.js";

type CheckUnknownReason = "digest_unavailable" | "schema_unavailable" | "insufficient_evidence";

type CheckOutcome =
  | { readonly kind: "confirmed"; readonly finding: Finding }
  | { readonly kind: "clear" }
  | { readonly kind: "not_applicable" }
  | { readonly kind: "unknown"; readonly reason: CheckUnknownReason };

export interface CandidateCheckInput {
  readonly spec: AnswerSpec;
  readonly result: PrivateResultObject;
  readonly queryHash: string;
}

export interface CandidateCheck {
  readonly id: string;
  evaluate(input: CandidateCheckInput): CheckOutcome;
}

export interface CandidateCheckReport {
  readonly findings: readonly Finding[];
  readonly coverage: readonly CheckCoverage[];
}

function finding(kind: Finding["kind"], message: string, blocking: boolean, checkId: string): Finding {
  return { id: `finding_${kind}_${cryptoRandomId()}`, kind, message, blocking, checkId };
}

function cryptoRandomId(): string {
  // Candidate findings are informational identities; they are not a second
  // state authority and are recreated with the immutable candidate.
  return randomUUID();
}

const shapeCheck: CandidateCheck = {
  id: "result_shape",
  evaluate(input) {
    if (input.spec.output.state !== "specified") return { kind: "not_applicable" };
    const output = input.spec.output.value;
    if (output.rowMode === "scalar" && input.result.rowCount !== 1) {
      return { kind: "confirmed", finding: finding("shape_conflict", `Expected one scalar row but received ${input.result.rowCount}`, true, "result_shape") };
    }
    if (output.rowMode === "top_n" && output.rowCount !== undefined && input.result.rowCount !== output.rowCount) {
      return { kind: "confirmed", finding: finding("shape_conflict", `Expected ${output.rowCount} rows but received ${input.result.rowCount}`, true, "result_shape") };
    }
    if (output.columns && (output.columns.length !== input.result.columns.length || output.columns.some((column, index) => column !== input.result.columns[index]))) {
      return { kind: "confirmed", finding: finding("shape_conflict", "Result columns do not match the declared output shape", true, "result_shape") };
    }
    return { kind: "clear" };
  },
};

const completenessCheck: CandidateCheck = {
  id: "result_completeness",
  evaluate(input) {
    return input.result.truncated
      ? { kind: "confirmed", finding: finding("result_incomplete", "A truncated result cannot be published as a complete candidate", true, "result_completeness") }
      : { kind: "clear" };
  },
};

const identityCheck: CandidateCheck = {
  id: "result_identity",
  evaluate(input) {
    return input.result.resultRef && input.result.contentHash && input.queryHash
      ? { kind: "clear" }
      : { kind: "confirmed", finding: finding("integrity_conflict", "Result identity is incomplete", true, "result_identity") };
  },
};

const DEFAULT_CANDIDATE_CHECKS: readonly CandidateCheck[] = [completenessCheck, shapeCheck, identityCheck];

/**
 * Keep all check outcomes, not only blocking findings. `unknown` and
 * `not_applicable` are coverage facts for the Candidate; they are never
 * silently converted to `clear` and do not become a generic publish gate.
 */
export function evaluateCandidateCheckReport(input: CandidateCheckInput, checks: readonly CandidateCheck[] = DEFAULT_CANDIDATE_CHECKS): CandidateCheckReport {
  const findings: Finding[] = [];
  const coverage: CheckCoverage[] = [];
  for (const check of checks) {
    const outcome = check.evaluate(input);
    switch (outcome.kind) {
      case "confirmed":
        findings.push(outcome.finding);
        coverage.push({ checkId: check.id, outcome: "finding", reason: outcome.finding.message });
        break;
      case "clear":
        coverage.push({ checkId: check.id, outcome: "clear" });
        break;
      case "not_applicable":
        coverage.push({ checkId: check.id, outcome: "not_applicable" });
        break;
      case "unknown":
        coverage.push({ checkId: check.id, outcome: "unknown", reason: outcome.reason });
        break;
    }
  }
  return { findings, coverage };
}

export function candidateCheckFailure(findings: readonly Finding[]): Finding | undefined {
  return findings.find((item) => item.blocking);
}
