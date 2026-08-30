import { randomUUID } from "node:crypto";

export const EVIDENCE_AUTHORITY_ORDER = [
  "user_clarification",
  "reviewed_semantic_model",
  "task_document",
  "request_wording",
  "schema_structure",
  "observed_data",
  "model_inference",
] as const;

export type EvidenceAuthority = typeof EVIDENCE_AUTHORITY_ORDER[number];

export interface EvidenceReference {
  readonly authority: EvidenceAuthority;
  readonly source: string;
}

export interface ConstraintInput {
  readonly statement: string;
  readonly authority: EvidenceAuthority;
  readonly scope: string;
  readonly source?: string;
  /** Schema evidence can create only structural constraints. */
  readonly structural?: boolean;
}

export interface HypothesisInput {
  readonly statement: string;
  readonly scope: string;
  readonly confidence?: number;
  readonly authority?: EvidenceAuthority;
  readonly source?: string;
}

export interface AmbiguityInput {
  readonly question: string;
  readonly alternatives: readonly string[];
  readonly scope: string;
  readonly source?: string;
}

export interface AnswerSpecInput {
  readonly taskId: string;
  readonly question: string;
  readonly clarifications?: readonly string[];
  readonly constraints?: readonly ConstraintInput[];
  readonly hypotheses?: readonly HypothesisInput[];
  readonly ambiguities?: readonly AmbiguityInput[];
}

export interface HardConstraint {
  readonly id: string;
  readonly statement: string;
  readonly scope: string;
  readonly provenance: EvidenceReference;
}

export interface Hypothesis {
  readonly id: string;
  readonly statement: string;
  readonly scope: string;
  readonly confidence?: number;
  readonly provenance: EvidenceReference;
}

export interface Ambiguity {
  readonly id: string;
  readonly question: string;
  readonly alternatives: readonly string[];
  readonly scope: string;
  readonly provenance?: EvidenceReference;
}

export interface AnswerSpec {
  readonly taskId: string;
  readonly specVersion: string;
  readonly question: string;
  readonly hardConstraints: readonly HardConstraint[];
  readonly hypotheses: readonly Hypothesis[];
  readonly ambiguities: readonly Ambiguity[];
  readonly provenance: readonly EvidenceReference[];
}

export interface SpecChangeProposal {
  readonly proposalId?: string;
  readonly taskId: string;
  readonly baseSpecVersion: string;
  readonly statement: string;
  readonly authority: EvidenceAuthority;
  readonly scope: string;
  readonly source?: string;
  readonly structural?: boolean;
}

export interface RejectedSpecChange {
  readonly accepted: false;
  readonly proposal: SpecChangeProposal & { readonly proposalId: string };
  readonly reason: "SOLVER_PROPOSAL_REQUIRES_AUTHORITY";
}

export interface BusinessDefinitionProposal {
  readonly proposalId: string;
  readonly taskId: string;
  readonly statement: string;
  readonly evidence: readonly EvidenceReference[];
  readonly status: "pending_business_review";
}

export function isHardConstraintEligible(input: ConstraintInput): boolean {
  return input.authority !== "model_inference"
    && input.authority !== "observed_data"
    && (input.authority !== "schema_structure" || input.structural === true);
}

function reference(input: { authority: EvidenceAuthority; source?: string }): EvidenceReference {
  return { authority: input.authority, source: input.source ?? "task-evidence" };
}

function makeHardConstraint(input: ConstraintInput, index: number): HardConstraint {
  return {
    id: `HC-${index + 1}`,
    statement: input.statement,
    scope: input.scope,
    provenance: reference(input),
  };
}

function makeHypothesis(input: HypothesisInput | ConstraintInput, index: number): Hypothesis {
  const authority = input.authority ?? "model_inference";
  return {
    id: `HY-${index + 1}`,
    statement: input.statement,
    scope: input.scope,
    ...("confidence" in input && input.confidence !== undefined ? { confidence: input.confidence } : {}),
    provenance: reference({ authority, source: input.source }),
  };
}

function makeAmbiguity(input: AmbiguityInput, index: number): Ambiguity {
  return {
    id: `AM-${index + 1}`,
    question: input.question,
    alternatives: [...input.alternatives],
    scope: input.scope,
    ...(input.source ? { provenance: { authority: "model_inference", source: input.source } } : {}),
  };
}

export function createAnswerSpec(input: AnswerSpecInput): AnswerSpec {
  const constraints = [...(input.constraints ?? [])];
  for (const clarification of input.clarifications ?? []) {
    constraints.push({ statement: clarification, authority: "user_clarification", scope: "task", source: "user-clarification" });
  }
  const hardConstraints: HardConstraint[] = [];
  const hypotheses: Hypothesis[] = [...(input.hypotheses ?? []).map((item, index) => makeHypothesis(item, index))];
  for (const constraint of constraints) {
    if (isHardConstraintEligible(constraint)) hardConstraints.push(makeHardConstraint(constraint, hardConstraints.length));
    else hypotheses.push(makeHypothesis(constraint, hypotheses.length));
  }
  const provenance = [
    ...constraints.map((item) => reference(item)),
    ...(input.hypotheses ?? []).map((item) => reference({ authority: item.authority ?? "model_inference", source: item.source })),
    ...(input.clarifications ?? []).map(() => ({ authority: "user_clarification" as const, source: "user-clarification" })),
  ];
  return {
    taskId: input.taskId,
    specVersion: "1",
    question: input.question,
    hardConstraints,
    hypotheses,
    ambiguities: (input.ambiguities ?? []).map((item, index) => makeAmbiguity(item, index)),
    provenance,
  };
}

function cloneSpec(spec: AnswerSpec, specVersion: string, hardConstraints: readonly HardConstraint[], hypotheses = spec.hypotheses, ambiguities = spec.ambiguities): AnswerSpec {
  return {
    ...spec,
    specVersion,
    hardConstraints: hardConstraints.map((item) => ({ ...item, provenance: { ...item.provenance } })),
    hypotheses: hypotheses.map((item) => ({ ...item, provenance: { ...item.provenance } })),
    ambiguities: ambiguities.map((item) => ({ ...item, alternatives: [...item.alternatives], ...(item.provenance ? { provenance: { ...item.provenance } } : {}) })),
    provenance: spec.provenance.map((item) => ({ ...item })),
  };
}

export interface SpecAuthority {
  prepare(input: AnswerSpecInput): AnswerSpec;
  get(taskId: string, specVersion?: string): AnswerSpec | undefined;
  applyClarification(taskId: string, baseSpecVersion: string, clarification: string): AnswerSpec;
  submitProposal(proposal: SpecChangeProposal): RejectedSpecChange;
  applyAuthoritativeChange(taskId: string, baseSpecVersion: string, change: ConstraintInput): AnswerSpec;
}

/**
 * Owns Answer Spec versions. Solver proposals are deliberately recorded as
 * rejected proposals and cannot mutate the version chain.
 */
export function createSpecAuthority(): SpecAuthority {
  const versions = new Map<string, AnswerSpec[]>();
  const proposals = new Map<string, RejectedSpecChange>();

  const current = (taskId: string, specVersion: string): AnswerSpec => {
    const spec = versions.get(taskId)?.find((item) => item.specVersion === specVersion);
    if (!spec) throw new Error(`ANSWER_SPEC_NOT_FOUND:${taskId}:${specVersion}`);
    return spec;
  };

  const append = (spec: AnswerSpec): AnswerSpec => {
    const history = versions.get(spec.taskId) ?? [];
    history.push(spec);
    versions.set(spec.taskId, history);
    return spec;
  };

  return {
    prepare(input) {
      if (!input.taskId || !input.question.trim()) throw new Error("ANSWER_SPEC_INPUT_INVALID");
      const spec = createAnswerSpec(input);
      return append(spec);
    },
    get(taskId, specVersion) {
      const history = versions.get(taskId);
      return specVersion ? history?.find((item) => item.specVersion === specVersion) : history?.at(-1);
    },
    applyClarification(taskId, baseSpecVersion, clarification) {
      if (!clarification.trim()) throw new Error("ANSWER_SPEC_CLARIFICATION_EMPTY");
      const base = current(taskId, baseSpecVersion);
      const nextConstraint: HardConstraint = {
        id: `HC-${base.hardConstraints.length + 1}`,
        statement: clarification,
        scope: "task",
        provenance: { authority: "user_clarification", source: "user-clarification" },
      };
      return append(cloneSpec(base, String(Number(base.specVersion) + 1), [...base.hardConstraints, nextConstraint]));
    },
    submitProposal(proposal) {
      const rejected: RejectedSpecChange = {
        accepted: false,
        proposal: { ...proposal, proposalId: proposal.proposalId ?? randomUUID() },
        reason: "SOLVER_PROPOSAL_REQUIRES_AUTHORITY",
      };
      proposals.set(rejected.proposal.proposalId, rejected);
      return rejected;
    },
    applyAuthoritativeChange(taskId, baseSpecVersion, change) {
      if (!isHardConstraintEligible(change)) throw new Error("ANSWER_SPEC_HARD_CONSTRAINT_EVIDENCE_INSUFFICIENT");
      const base = current(taskId, baseSpecVersion);
      const nextConstraint = makeHardConstraint(change, base.hardConstraints.length);
      return append(cloneSpec(base, String(Number(base.specVersion) + 1), [...base.hardConstraints, nextConstraint]));
    },
  };
}
