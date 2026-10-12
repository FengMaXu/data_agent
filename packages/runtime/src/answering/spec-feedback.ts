import {
  contentHash,
  type AnswerRevisionRecord,
  type CheckCoverage,
  type Evidence,
  type EvidenceId,
  type FieldRecord,
  type SpecFeedback,
  type SpecFeedbackAssessment,
  type SpecFeedbackChoice,
  type SpecFeedbackDeterministicIssue,
} from "./model.js";
import { REQUIREMENT_ROLES, SPEC_ALIGNMENT_RULE_VERSION, type RequirementPhrase, type SpecAlignmentField, type SpecAlignmentInput } from "../judgment/spec-alignment.js";
import type { OutputValue, SelectionValue } from "./fields.js";
import { undeclaredPaths } from "./qualification.js";

const SPEC_FEEDBACK_RULE_VERSION = "spec-feedback-v3";
export const SPEC_FEEDBACK_CHECK_ID = "spec_feedback";
export const SPEC_FEEDBACK_MAX_INPUT_BYTES = 64 * 1024;
export const SPEC_FEEDBACK_DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Which judgments are reported, replayed on the 2026-10-10 field-tree run
 * (6 confirmed requirement errors, 39 correct cases): contradicted at 0.4,
 * missing at 0.6 for selection and population phrases, an undefined output
 * column at 0.95. Missing computation phrases flagged correct answers whose
 * single measure.formula cannot hold every quantity, so they are not reported.
 */
const CONTRADICTED_AT = 0.4;
const MISSING_AT = 0.6;
const MISSING_ROLES = new Set(["selection", "population"]);
const UNDEFINED_COLUMN_AT = 0.95;

class SpecFeedbackInputError extends Error {
  constructor(readonly code: "original_question_unavailable" | "input_too_large" | "invalid_input", message: string) {
    super(message);
    this.name = "SpecFeedbackInputError";
  }
}

function jsonText(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? { __type: "bigint", value: item.toString() } : item);
}

function settled<T>(field: FieldRecord | undefined): T | undefined {
  return field && (field.state === "specified" || field.state === "decided") ? field.value as T : undefined;
}

/** The only deterministic checks: declared row counts that contradict the declared row mode or selection. */
function deterministicSpecFeedbackIssues(fields: AnswerRevisionRecord["fields"]): readonly SpecFeedbackDeterministicIssue[] {
  const issues: SpecFeedbackDeterministicIssue[] = [];
  const output = settled<OutputValue>(fields.output);
  if (output && output.rowMode === "scalar" && output.rowCount !== undefined && output.rowCount !== 1) {
    issues.push({
      code: "scalar_row_count_conflict",
      paths: ["output"],
      message: `output.rowMode=scalar requires rowCount=1, but the declared rowCount is ${output.rowCount}.`,
      actual: output.rowCount,
      expected: 1,
    });
  }
  const selection = settled<SelectionValue>(fields.selection);
  if (output && selection && output.rowMode === "top_n" && settled<string>(fields["selection.ties"]) === "strict"
    && output.rowCount !== undefined && output.rowCount !== selection.n) {
    issues.push({
      code: "strict_top_n_row_count_conflict",
      paths: ["selection", "selection.ties", "output"],
      message: `strict top_n requires rowCount=${selection.n}, but the declared rowCount is ${output.rowCount}.`,
      actual: output.rowCount,
      expected: selection.n,
    });
  }
  return issues;
}

/** Field claims only: state, value or alternatives. Rationales, reasons and advice are the solver's own account and stay out. */
function claimsOf(fields: AnswerRevisionRecord["fields"]): Readonly<Record<string, SpecAlignmentField>> {
  return Object.fromEntries((Object.entries(fields) as [string, FieldRecord][]).map(([path, field]) => {
    if (field.state === "specified" || field.state === "decided") return [path, { state: field.state, value: field.value }];
    if (field.state === "open") return [path, { state: "open", alternatives: field.alternatives.map((item) => item.value) }];
    return [path, { state: field.state }];
  }));
}

const normalized = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Keep phrases found verbatim in the request (whitespace and case aside),
 * once each, with a known role. Everything else is dropped and counted.
 */
export function admitRequirements(originalQuestion: string, phrases: readonly RequirementPhrase[]): { readonly admitted: readonly RequirementPhrase[]; readonly dropped: number } {
  const question = normalized(originalQuestion);
  const seen = new Set<string>();
  const admitted: RequirementPhrase[] = [];
  for (const phrase of phrases) {
    const key = normalized(phrase.quote ?? "");
    if (!key || !question.includes(key) || seen.has(key) || !REQUIREMENT_ROLES.includes(phrase.role)) continue;
    seen.add(key);
    admitted.push({ quote: phrase.quote.trim(), role: phrase.role });
  }
  return { admitted, dropped: phrases.length - admitted.length };
}

export interface SpecFeedbackAssembly {
  readonly input: SpecAlignmentInput;
  readonly inputHash: string;
  readonly evidenceIds: readonly EvidenceId[];
  readonly limitations: readonly string[];
}

/**
 * Build the one conversation-blind assessor input from the Revision's claims,
 * the admitted requirement phrases and the declared output columns. The input
 * is rejected rather than truncated when it exceeds the safety bound.
 */
export function assembleSpecFeedbackInput(
  revision: AnswerRevisionRecord,
  evidence: readonly Evidence[],
  originalQuestion: string,
  requirements: readonly RequirementPhrase[],
  limitations: readonly string[] = [],
  maxInputBytes = SPEC_FEEDBACK_MAX_INPUT_BYTES,
): SpecFeedbackAssembly {
  if (!originalQuestion.trim()) throw new SpecFeedbackInputError("original_question_unavailable", "The original user message has no readable text");
  if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1) throw new SpecFeedbackInputError("invalid_input", "Invalid Spec feedback input byte limit");
  const input: SpecAlignmentInput = {
    originalQuestion,
    fields: claimsOf(revision.fields),
    requirements: [...requirements],
    outputColumns: [...settled<OutputValue>(revision.fields.output)?.columns ?? []],
  };
  if (Buffer.byteLength(jsonText(input), "utf8") > maxInputBytes) {
    throw new SpecFeedbackInputError("input_too_large", `Spec feedback input exceeds ${maxInputBytes} serialized bytes`);
  }
  return {
    input,
    inputHash: contentHash({ taskId: revision.taskId, revisionId: revision.revisionId, input }),
    evidenceIds: evidence.map((item) => item.id),
    limitations,
  };
}

/** Feedback runs only on a complete Spec; a Revision with undeclared fields is skipped. */
export function initialSpecFeedback(
  revision: AnswerRevisionRecord,
  evidence: readonly Evidence[],
  enabled: boolean,
  startedAt?: string,
): SpecFeedback {
  const incomplete = enabled && undeclaredPaths(revision.fields).length > 0;
  return {
    taskId: revision.taskId,
    revisionId: revision.revisionId,
    ruleVersion: SPEC_FEEDBACK_RULE_VERSION,
    status: !enabled ? "disabled" : incomplete ? "skipped" : "pending",
    deterministicIssues: deterministicSpecFeedbackIssues(revision.fields),
    evidenceIds: evidence.map((item) => item.id),
    limitations: [],
    ...(!enabled ? { reason: "spec_alignment_assessor_not_configured" } : incomplete ? { reason: "spec_incomplete" } : {}),
    ...(enabled && !incomplete && startedAt ? { startedAt } : {}),
  };
}

function isFiniteProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function assertChoice<T extends string>(choice: SpecFeedbackChoice<T> | undefined, expected: readonly T[], name: string): void {
  if (!choice || !expected.includes(choice.choice) || !isFiniteProbability(choice.confidence)) throw new Error(`INVALID_SPEC_FEEDBACK_ASSESSMENT:${name}`);
  const probabilities = choice.probabilities;
  if (!probabilities || typeof probabilities !== "object") throw new Error(`INVALID_SPEC_FEEDBACK_ASSESSMENT:${name}`);
  if (JSON.stringify(Object.keys(probabilities).sort()) !== JSON.stringify([...expected].sort())) throw new Error(`INVALID_SPEC_FEEDBACK_ASSESSMENT:${name}`);
  let total = 0;
  for (const key of expected) {
    if (!isFiniteProbability(probabilities[key])) throw new Error(`INVALID_SPEC_FEEDBACK_ASSESSMENT:${name}`);
    total += probabilities[key];
  }
  if (Math.abs(total - 1) > 0.02) throw new Error(`INVALID_SPEC_FEEDBACK_ASSESSMENT:${name}`);
}

/** Defensive validation also protects fake/test assessors from creating false coverage. */
export function validateSpecFeedbackAssessment(value: SpecFeedbackAssessment): SpecFeedbackAssessment {
  if (!value || typeof value.model !== "string" || !value.model.trim() || value.ruleVersion !== SPEC_ALIGNMENT_RULE_VERSION) {
    throw new Error("INVALID_SPEC_FEEDBACK_ASSESSMENT:metadata");
  }
  if (!Array.isArray(value.requirements) || !Array.isArray(value.columns)) throw new Error("INVALID_SPEC_FEEDBACK_ASSESSMENT:items");
  value.requirements.forEach((item, index) => {
    if (!item || typeof item.quote !== "string" || !REQUIREMENT_ROLES.includes(item.role)) throw new Error(`INVALID_SPEC_FEEDBACK_ASSESSMENT:requirement${index}`);
    assertChoice(item.judgment, ["expressed", "contradicted", "missing"], `requirement${index}`);
  });
  value.columns.forEach((item, index) => {
    if (!item || typeof item.column !== "string") throw new Error(`INVALID_SPEC_FEEDBACK_ASSESSMENT:column${index}`);
    assertChoice(item.judgment, ["defined", "undefined"], `column${index}`);
  });
  return value;
}

/** The reported judgments, as one line each. */
export function assessmentConcerns(assessment: SpecFeedbackAssessment | undefined): readonly string[] {
  if (!assessment) return [];
  const requirements = (assessment.requirements ?? []).flatMap((item) => {
    const { contradicted, missing } = item.judgment.probabilities;
    if (contradicted >= CONTRADICTED_AT) return [`contradicted(p=${contradicted.toFixed(2)}) [${item.role}] "${item.quote}"`];
    if (MISSING_ROLES.has(item.role) && missing >= MISSING_AT) return [`missing(p=${missing.toFixed(2)}) [${item.role}] "${item.quote}"`];
    return [];
  });
  const columns = (assessment.columns ?? []).flatMap((item) => item.judgment.probabilities.undefined >= UNDEFINED_COLUMN_AT
    ? [`output column "${item.column}" has no defining field (p=${item.judgment.probabilities.undefined.toFixed(2)})`]
    : []);
  return [...requirements, ...columns];
}

export function specFeedbackCoverage(feedback: SpecFeedback | undefined): CheckCoverage {
  if (!feedback) {
    return { checkId: SPEC_FEEDBACK_CHECK_ID, ruleVersion: SPEC_FEEDBACK_RULE_VERSION, outcome: "unknown", reason: "Spec feedback was not executed for this Revision." };
  }
  const risks = [...feedback.deterministicIssues.map((issue) => issue.message), ...assessmentConcerns(feedback.assessment)];
  const limitations = [
    ...feedback.limitations,
    ...(feedback.reason ? [`reason=${feedback.reason}`] : []),
    ...(feedback.status !== "completed" ? [`status=${feedback.status}`] : []),
  ];
  if (risks.length > 0) {
    return {
      checkId: SPEC_FEEDBACK_CHECK_ID,
      ruleVersion: feedback.ruleVersion,
      outcome: "finding",
      reason: `Advisory Spec feedback: ${risks.join("; ")}${limitations.length ? `; limitations: ${limitations.join(", ")}` : ""}. This does not change qualification or authorize a revision.`,
    };
  }
  // No assessor in this deployment: nothing was observed about this result, so it is recorded here and
  // reported once at startup, not disclosed with every result. Deterministic risks above still disclose.
  if (feedback.status === "disabled") {
    return { checkId: SPEC_FEEDBACK_CHECK_ID, ruleVersion: feedback.ruleVersion, outcome: "not_applicable", reason: "Spec feedback assessor is not configured in this deployment." };
  }
  if (feedback.status !== "completed" || limitations.length > 0) {
    return { checkId: SPEC_FEEDBACK_CHECK_ID, ruleVersion: feedback.ruleVersion, outcome: "unknown", reason: `Spec feedback is not a semantic proof: ${limitations.join("; ") || "coverage is incomplete"}.` };
  }
  return {
    checkId: SPEC_FEEDBACK_CHECK_ID,
    ruleVersion: feedback.ruleVersion,
    outcome: "clear",
    reason: "No requirement phrase was judged contradicted or missing above the reporting thresholds; this is not a semantic proof.",
  };
}

export function specFeedbackDisclosureSummary(coverage: CheckCoverage | undefined): string | undefined {
  if (!coverage || coverage.checkId !== SPEC_FEEDBACK_CHECK_ID || coverage.outcome === "clear" || coverage.outcome === "not_applicable") return undefined;
  if (coverage.outcome === "finding") return `Answer Spec 反馈器报告了建议性风险：${coverage.reason ?? "存在题意偏离或要求遗漏候选。"}`;
  return `Answer Spec 反馈覆盖不可用或不完整：${coverage.reason ?? "未完成评估，结果未知。"}`;
}

export function renderSpecFeedback(feedback: SpecFeedback | undefined): string {
  if (!feedback || feedback.status === "skipped") return "";
  const lines = [`[SPEC_FEEDBACK] revisionId=${feedback.revisionId} status=${feedback.status} advisory_only=true`];
  for (const issue of feedback.deterministicIssues) lines.push(`deterministic: code=${issue.code} paths=${issue.paths.join(",")} message=${issue.message}`);
  for (const concern of assessmentConcerns(feedback.assessment)) lines.push(`requirement: ${concern}`);
  if (feedback.status !== "completed" && feedback.reason) lines.push(`reason: ${feedback.reason}`);
  if (feedback.limitations.length > 0) lines.push(`limitations: ${feedback.limitations.join(", ")}`);
  if (feedback.stale && feedback.currentRevisionId) lines.push(`stale=true currentRevisionId=${feedback.currentRevisionId}`);
  if (lines.length === 1) lines.push("No requirement phrase of the request was judged contradicted or missing.");
  else lines.push("Each line quotes the request. Check the named field against that phrase: rewrite it with a reason, open alternatives for it, or keep it if the phrase does not apply.");
  lines.push("以上是决策模型的建议，不是证据或修订授权；请结合原题和已有依据处理。");
  return lines.join("\n");
}

export function completedSpecFeedback(
  revision: AnswerRevisionRecord,
  base: SpecFeedback,
  assessment: SpecFeedbackAssessment,
  inputHash: string,
  evidenceIds: readonly EvidenceId[],
  limitations: readonly string[],
  startedAt: string,
  completedAt: string,
): SpecFeedback {
  const durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
  return {
    taskId: revision.taskId,
    revisionId: revision.revisionId,
    ruleVersion: base.ruleVersion,
    status: "completed",
    deterministicIssues: base.deterministicIssues,
    assessment: validateSpecFeedbackAssessment(assessment),
    inputHash,
    evidenceIds: [...evidenceIds],
    limitations: [...limitations],
    startedAt,
    completedAt,
    durationMs,
  };
}

export function unavailableSpecFeedback(
  revision: AnswerRevisionRecord,
  base: SpecFeedback,
  reason: string,
  details: { readonly inputHash?: string; readonly evidenceIds?: readonly EvidenceId[]; readonly limitations?: readonly string[]; readonly startedAt: string; readonly completedAt: string },
): SpecFeedback {
  const durationMs = Math.max(0, Date.parse(details.completedAt) - Date.parse(details.startedAt));
  return {
    ...base,
    taskId: revision.taskId,
    revisionId: revision.revisionId,
    status: "unavailable",
    ...(details.inputHash ? { inputHash: details.inputHash } : {}),
    evidenceIds: [...(details.evidenceIds ?? base.evidenceIds)],
    limitations: [...new Set([...base.limitations, ...(details.limitations ?? [])])],
    reason,
    startedAt: details.startedAt,
    completedAt: details.completedAt,
    durationMs,
  };
}
