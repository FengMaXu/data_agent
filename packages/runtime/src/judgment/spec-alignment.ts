import type {
  EvidenceAuthority,
  RequirementRole,
  SpecFeedbackAssessment,
} from "../answering/model.js";

/**
 * Version of the requirement-coverage protocol: one Choice per verbatim
 * requirement phrase and one per declared output column, decided by a
 * decision model over the Spec's claims (no rationale or advice text).
 */
export const SPEC_ALIGNMENT_RULE_VERSION = "spec-alignment-v3";

/** Lower ranks are stronger and mirror CONTEXT.md Evidence Authority. */
export const EVIDENCE_AUTHORITY_RANK: Readonly<Record<EvidenceAuthority, number>> = {
  user: 0,
  reviewed_business_definition: 1,
  task_document: 2,
  request_wording: 3,
  schema: 4,
  observation: 5,
};

export const REQUIREMENT_ROLES: readonly RequirementRole[] = ["population", "scope", "computation", "selection", "time"];

/** A phrase of the original request, copied verbatim, with what it constrains. */
export interface RequirementPhrase {
  readonly quote: string;
  readonly role: RequirementRole;
}

/**
 * Lists the requirement phrases of a request. It reads only the request, never
 * a Spec, SQL or conversation, and decides nothing; the Runtime keeps only
 * phrases found verbatim in the request.
 */
export interface RequirementExtractor {
  extract(originalQuestion: string, options?: { readonly signal?: AbortSignal }): Promise<readonly RequirementPhrase[]>;
}

/** A field as the assessor sees it: its state and value or alternatives, never a rationale, reason or advice. */
export interface SpecAlignmentField {
  readonly state: string;
  readonly value?: unknown;
  readonly alternatives?: readonly unknown[];
}

/**
 * Conversation-blind input assembled by Answering from its authoritative
 * Revision. The assessor must treat every text field as data rather than
 * instructions.
 */
export interface SpecAlignmentInput {
  readonly originalQuestion: string;
  readonly fields: Readonly<Record<string, SpecAlignmentField>>;
  readonly requirements: readonly RequirementPhrase[];
  readonly outputColumns: readonly string[];
}

export interface SpecAlignmentAssessor {
  assess(input: SpecAlignmentInput, options?: { readonly signal?: AbortSignal }): Promise<SpecFeedbackAssessment>;
}
