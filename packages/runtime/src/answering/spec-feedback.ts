import {
  clone,
  contentHash,
  type AnswerRevisionRecord,
  type CheckCoverage,
  type Evidence,
  type EvidenceId,
  type SpecFeedback,
  type SpecFeedbackAssessment,
  type SpecFeedbackChoice,
  type SpecFeedbackDeterministicIssue,
} from "./model.js";
import { EVIDENCE_AUTHORITY_RANK, SPEC_ALIGNMENT_RULE_VERSION, type SpecAlignmentEvidence, type SpecAlignmentInput } from "../judgment/spec-alignment.js";
import { FIELD_SECTIONS, type FieldSection, type OutputValue, type SelectionValue } from "./fields.js";

const SPEC_FEEDBACK_RULE_VERSION = "spec-feedback-v2";
export const SPEC_FEEDBACK_CHECK_ID = "spec_feedback";
export const SPEC_FEEDBACK_MAX_INPUT_BYTES = 64 * 1024;
export const SPEC_FEEDBACK_DEFAULT_TIMEOUT_MS = 15_000;

class SpecFeedbackInputError extends Error {
  constructor(readonly code: "original_question_unavailable" | "input_too_large" | "invalid_input", message: string) {
    super(message);
    this.name = "SpecFeedbackInputError";
  }
}

function jsonText(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? { __type: "bigint", value: item.toString() } : item);
}

function serializedByteLength(value: unknown): number {
  return Buffer.byteLength(jsonText(value), "utf8");
}

function settled<T>(field: AnswerRevisionRecord["fields"][keyof AnswerRevisionRecord["fields"]]): T | undefined {
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

function evidenceForInput(item: Evidence): { readonly value: SpecAlignmentEvidence; readonly limitation?: string } {
  const content = item.quote !== undefined
    ? item.quote
    : item.kind === "query_observation"
      ? jsonText(item.preview)
      : undefined;
  // Request wording is supplied separately from the trusted Session message.
  // Other quote-less handles remain explicit coverage limitations.
  const limitation = content === undefined && item.kind !== "request_wording"
    ? `evidence_quote_missing:${item.id}`
    : undefined;
  return {
    value: {
      id: item.id,
      kind: item.kind,
      authority: item.authority,
      authorityRank: EVIDENCE_AUTHORITY_RANK[item.authority],
      sourceRef: item.sourceRef,
      ...(content !== undefined ? { content } : {}),
    },
    ...(limitation ? { limitation } : {}),
  };
}

export interface SpecFeedbackAssembly {
  readonly input: SpecAlignmentInput;
  readonly inputHash: string;
  readonly evidenceIds: readonly EvidenceId[];
  readonly limitations: readonly string[];
}

/**
 * Build the one conversation-blind assessor input. No source is fetched here:
 * only the original message and already-registered, bounded evidence enter the
 * request. The complete original question and Spec are rejected rather than
 * truncated when the serialized request exceeds the safety bound.
 */
export function assembleSpecFeedbackInput(
  revision: AnswerRevisionRecord,
  evidence: readonly Evidence[],
  originalQuestion: string,
  maxInputBytes = SPEC_FEEDBACK_MAX_INPUT_BYTES,
): SpecFeedbackAssembly {
  if (!originalQuestion.trim()) throw new SpecFeedbackInputError("original_question_unavailable", "The original user message has no readable text");
  if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1) throw new SpecFeedbackInputError("invalid_input", "Invalid Spec feedback input byte limit");
  const converted = evidence.map(evidenceForInput);
  const limitations = converted.flatMap((item) => item.limitation ? [item.limitation] : []);
  const input: SpecAlignmentInput = {
    originalQuestion,
    fields: clone(revision.fields),
    evidence: converted.map((item) => item.value),
    limitations,
  };
  if (serializedByteLength(input) > maxInputBytes) {
    throw new SpecFeedbackInputError("input_too_large", `Spec feedback input exceeds ${maxInputBytes} serialized bytes`);
  }
  return {
    input,
    inputHash: contentHash({ taskId: revision.taskId, revisionId: revision.revisionId, input }),
    evidenceIds: evidence.map((item) => item.id),
    limitations,
  };
}

export function initialSpecFeedback(
  revision: AnswerRevisionRecord,
  evidence: readonly Evidence[],
  enabled: boolean,
  startedAt?: string,
): SpecFeedback {
  const limitations = evidence.map(evidenceForInput).flatMap((item) => item.limitation ? [item.limitation] : []);
  return {
    taskId: revision.taskId,
    revisionId: revision.revisionId,
    ruleVersion: SPEC_FEEDBACK_RULE_VERSION,
    status: enabled ? "pending" : "disabled",
    deterministicIssues: deterministicSpecFeedbackIssues(revision.fields),
    evidenceIds: evidence.map((item) => item.id),
    limitations,
    ...(enabled ? {} : { reason: "spec_alignment_assessor_not_configured" }),
    ...(enabled && startedAt ? { startedAt } : {}),
  };
}

function isFiniteProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function probabilityKeys(value: object): readonly string[] {
  return Object.keys(value).sort();
}

function assertDistribution<T extends string>(
  choice: SpecFeedbackChoice<T, Readonly<Record<T, number>>>,
  expected: readonly T[],
  name: string,
): void {
  if (!expected.includes(choice.choice) || !isFiniteProbability(choice.confidence)) throw new Error(`INVALID_SPEC_FEEDBACK_ASSESSMENT:${name}`);
  const probabilities = choice.probabilities;
  if (!probabilities || typeof probabilities !== "object") throw new Error(`INVALID_SPEC_FEEDBACK_ASSESSMENT:${name}`);
  const expectedKeys = [...expected].sort();
  if (JSON.stringify(probabilityKeys(probabilities)) !== JSON.stringify(expectedKeys)) throw new Error(`INVALID_SPEC_FEEDBACK_ASSESSMENT:${name}`);
  let total = 0;
  for (const key of expected) {
    const probability = probabilities[key];
    if (!isFiniteProbability(probability)) throw new Error(`INVALID_SPEC_FEEDBACK_ASSESSMENT:${name}`);
    total += probability;
  }
  if (Math.abs(total - 1) > 0.02) throw new Error(`INVALID_SPEC_FEEDBACK_ASSESSMENT:${name}`);
}

/** Defensive validation also protects fake/test assessors from creating false coverage. */
export function validateSpecFeedbackAssessment(value: SpecFeedbackAssessment): SpecFeedbackAssessment {
  if (!value || typeof value.model !== "string" || !value.model.trim() || value.ruleVersion !== SPEC_ALIGNMENT_RULE_VERSION) {
    throw new Error("INVALID_SPEC_FEEDBACK_ASSESSMENT:metadata");
  }
  if (!Array.isArray(value.sections) || value.sections.length !== FIELD_SECTIONS.length) throw new Error("INVALID_SPEC_FEEDBACK_ASSESSMENT:sections");
  const seen = new Set<FieldSection>();
  for (const section of value.sections) {
    if (!section || !FIELD_SECTIONS.includes(section.section) || seen.has(section.section)) throw new Error("INVALID_SPEC_FEEDBACK_ASSESSMENT:section");
    seen.add(section.section);
    assertDistribution(section.relation, ["supported", "contradicted", "not_established", "not_applicable"], `${section.section}.relation`);
    assertDistribution(section.coverage, ["complete", "partial", "missing", "not_applicable"], `${section.section}.coverage`);
  }
  return value;
}

function assessmentConcerns(assessment: SpecFeedbackAssessment): readonly string[] {
  return assessment.sections.flatMap((section) => {
    const concerns: string[] = [];
    if (section.relation.choice !== "supported" && section.relation.choice !== "not_applicable") concerns.push(`${section.section}.relation=${section.relation.choice}`);
    if (section.coverage.choice !== "complete" && section.coverage.choice !== "not_applicable") concerns.push(`${section.section}.coverage=${section.coverage.choice}`);
    return concerns;
  });
}

export function specFeedbackCoverage(feedback: SpecFeedback | undefined): CheckCoverage {
  if (!feedback) {
    return { checkId: SPEC_FEEDBACK_CHECK_ID, ruleVersion: SPEC_FEEDBACK_RULE_VERSION, outcome: "unknown", reason: "Spec feedback was not executed for this Revision." };
  }
  const deterministic = feedback.deterministicIssues.map((issue) => issue.message);
  const concerns = feedback.assessment ? assessmentConcerns(feedback.assessment) : [];
  const relationRisks = feedback.assessment?.sections.flatMap((section) => section.relation.choice === "contradicted" ? [`${section.section}.relation=contradicted`] : []) ?? [];
  const requirementRisks = feedback.assessment?.sections.flatMap((section) => ["partial", "missing"].includes(section.coverage.choice) ? [`${section.section}.coverage=${section.coverage.choice}`] : []) ?? [];
  const risks = [...deterministic, ...relationRisks, ...requirementRisks];
  const limitations = [
    ...feedback.limitations,
    ...(feedback.reason ? [`reason=${feedback.reason}`] : []),
    ...(feedback.status !== "completed" ? [`status=${feedback.status}`] : []),
    ...feedback.assessment?.sections.flatMap((section) => section.relation.choice === "not_established" ? [`${section.section}.relation=not_established`] : []) ?? [],
  ];
  if (risks.length > 0) {
    return {
      checkId: SPEC_FEEDBACK_CHECK_ID,
      ruleVersion: feedback.ruleVersion,
      outcome: "finding",
      reason: `Advisory Spec feedback risks: ${risks.join("; ")}${limitations.length ? `; limitations: ${limitations.join(", ")}` : ""}. This does not change qualification or authorize a revision.`,
    };
  }
  // No assessor in this deployment: nothing was observed about this result, so it is recorded here and
  // reported once at startup, not disclosed with every result. Deterministic risks above still disclose.
  if (feedback.status === "disabled") {
    return {
      checkId: SPEC_FEEDBACK_CHECK_ID,
      ruleVersion: feedback.ruleVersion,
      outcome: "not_applicable",
      reason: `Spec feedback assessor is not configured in this deployment${limitations.length ? `; limitations: ${limitations.join(", ")}` : ""}.`,
    };
  }
  if (feedback.status !== "completed" || limitations.length > 0 || concerns.length > 0) {
    return {
      checkId: SPEC_FEEDBACK_CHECK_ID,
      ruleVersion: feedback.ruleVersion,
      outcome: "unknown",
      reason: `Spec feedback is not a semantic proof: ${[...limitations, ...concerns].join("; ") || "coverage is incomplete"}.`,
    };
  }
  return {
    checkId: SPEC_FEEDBACK_CHECK_ID,
    ruleVersion: feedback.ruleVersion,
    outcome: "clear",
    reason: "Within the supplied original question and registered evidence, no Spec feedback relation or coverage concern was reported; this is not a semantic proof.",
  };
}

export function specFeedbackDisclosureSummary(coverage: CheckCoverage | undefined): string | undefined {
  if (!coverage || coverage.checkId !== SPEC_FEEDBACK_CHECK_ID || coverage.outcome === "clear" || coverage.outcome === "not_applicable") return undefined;
  if (coverage.outcome === "finding") return `Answer Spec 反馈器报告了建议性风险：${coverage.reason ?? "存在题意偏离或要求遗漏候选。"}`;
  return `Answer Spec 反馈覆盖不可用或不完整：${coverage.reason ?? "未完成评估，结果未知。"}`;
}

export function renderSpecFeedback(feedback: SpecFeedback | undefined): string {
  if (!feedback) return "";
  const lines = [`[SPEC_FEEDBACK] revisionId=${feedback.revisionId} status=${feedback.status} advisory_only=true`];
  const concerns = feedback.assessment ? assessmentConcerns(feedback.assessment) : [];
  for (const issue of feedback.deterministicIssues) lines.push(`deterministic: code=${issue.code} paths=${issue.paths.join(",")} message=${issue.message}`);
  for (const concern of concerns) lines.push(`assessment: ${concern}`);
  if (feedback.status !== "completed" && feedback.reason) lines.push(`reason: ${feedback.reason}`);
  if (feedback.limitations.length > 0) lines.push(`limitations: ${feedback.limitations.join(", ")}`);
  if (feedback.stale && feedback.currentRevisionId) lines.push(`stale=true currentRevisionId=${feedback.currentRevisionId}`);
  if (lines.length === 1) lines.push("No advisory relation or coverage concern was reported within the supplied materials.");
  lines.push("以上是模型建议，不是证据或修订授权；请结合原题和已有依据处理。");
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

