import type {
  AnswerSpec,
  Choice,
  ChoiceResolution,
  EvidenceAuthority,
  EvidenceKind,
  FacetName,
  Hypothesis,
  Resolution,
  SpecFeedbackAssessment,
} from "../answering/model.js";

/** Version of the fixed seven-facet, two-axis assessment protocol. */
export const SPEC_ALIGNMENT_RULE_VERSION = "spec-alignment-v1";

/** Lower ranks are stronger and mirror CONTEXT.md Evidence Authority. */
export const EVIDENCE_AUTHORITY_RANK: Readonly<Record<EvidenceAuthority, number>> = {
  user: 0,
  reviewed_business_definition: 1,
  task_document: 2,
  request_wording: 3,
  schema: 4,
  observation: 5,
};

export interface SpecAlignmentEvidence {
  readonly id: string;
  readonly kind: EvidenceKind;
  readonly authority: EvidenceAuthority;
  readonly authorityRank: number;
  readonly sourceRef: string;
  /** Only registered quote or a bounded query observation; never a source hash. */
  readonly content?: string;
}

/**
 * Conversation-blind input assembled by Answering from its authoritative
 * Revision and registered evidence. The assessor must treat every text field
 * as data rather than instructions.
 */
export interface SpecAlignmentInput {
  readonly originalQuestion: string;
  readonly spec: AnswerSpec;
  readonly hypotheses: readonly Hypothesis[];
  readonly choices: readonly Choice[];
  readonly resolutions: readonly Resolution[];
  readonly choiceResolutions: readonly ChoiceResolution[];
  readonly evidence: readonly SpecAlignmentEvidence[];
  readonly limitations: readonly string[];
}

export interface SpecAlignmentAssessor {
  assess(input: SpecAlignmentInput, options?: { readonly signal?: AbortSignal }): Promise<SpecFeedbackAssessment>;
}

export function facetNames(): readonly FacetName[] {
  return ["entity", "metric", "filters", "groupBy", "time", "ranking", "output"];
}
