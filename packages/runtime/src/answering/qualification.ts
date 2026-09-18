import { randomUUID } from "node:crypto";
import {
  type AnswerRevisionRecord,
  type Evidence,
  type Hypothesis,
  type HypothesisId,
  type QualifiedEvidenceId,
  type ReadyRevision,
  type Resolution,
  type Choice,
  type ChoiceId,
  type ChoiceResolution,
  type Facet,
  type FacetName,
  type AnswerSpec,
} from "./model.js";

export class QualificationError extends Error {
  readonly code:
    | "EVIDENCE_KIND_NOT_QUALIFIED"
    | "HYPOTHESIS_NOT_FOUND"
    | "CHOICE_NOT_FOUND"
    | "ALTERNATIVE_NOT_FOUND"
    | "UNRESOLVED_REVISION";

  constructor(code: QualificationError["code"], message: string) {
    super(message);
    this.name = "QualificationError";
    this.code = code;
  }
}

const allowedEvidence: Record<Hypothesis["kind"], readonly Evidence["kind"][]> = {
  business_semantics: ["user_confirmation", "reviewed_definition", "task_document", "request_wording"],
  physical_mapping: ["reviewed_definition", "schema_fact"],
  data_property: ["schema_fact", "query_observation"],
};

/**
 * Produce the only proof handle accepted by a supported/refuted Resolution.
 * Observation evidence is intentionally excluded from business-semantic
 * hypotheses even when its values look persuasive.
 */
export function qualifyEvidence(hypothesis: Hypothesis, evidence: Evidence): QualifiedEvidenceId {
  if (!allowedEvidence[hypothesis.kind].includes(evidence.kind)) {
    throw new QualificationError(
      "EVIDENCE_KIND_NOT_QUALIFIED",
      `Evidence ${evidence.kind} cannot qualify hypothesis kind ${hypothesis.kind}`,
    );
  }
  return `qualified_${randomUUID()}` as QualifiedEvidenceId;
}

export function unresolvedHypotheses(
  hypotheses: readonly Hypothesis[],
  resolutions: readonly Resolution[],
): readonly HypothesisId[] {
  const resolved = new Set(resolutions.map((resolution) => resolution.hypothesisId));
  return hypotheses.filter((hypothesis) => !resolved.has(hypothesis.id)).map((hypothesis) => hypothesis.id);
}

export function unresolvedChoices(
  choices: readonly Choice[],
  resolutions: readonly ChoiceResolution[],
): readonly ChoiceId[] {
  const resolved = new Set(resolutions.map((resolution) => resolution.choiceId));
  return choices.filter((choice) => !resolved.has(choice.id)).map((choice) => choice.id);
}

/**
 * A revision is implementable only when every declared facet is known. Empty
 * filter/grouping lists are explicit absence; an unknown item in either list
 * remains unresolved. This keeps a technical repair from silently filling in
 * a missing business slot.
 */
export function unresolvedFacets(spec: AnswerSpec): readonly FacetName[] {
  const unresolved: FacetName[] = [];
  const scalar: readonly [FacetName, Facet<unknown>][] = [
    ["entity", spec.entity],
    ["metric", spec.metric],
    ["time", spec.time],
    ["ranking", spec.ranking],
    ["output", spec.output],
  ];
  for (const [name, facet] of scalar) if (facet.state === "unknown") unresolved.push(name);
  if (spec.filters.some((facet) => facet.state === "unknown")) unresolved.push("filters");
  if (spec.groupBy.some((facet) => facet.state === "unknown")) unresolved.push("groupBy");
  return unresolved;
}

/** Seal only after all hypotheses, choices and seven-facet slots are handled. */
export function sealForResult(revision: AnswerRevisionRecord):
  | { readonly ok: true; readonly revision: ReadyRevision }
  | { readonly ok: false; readonly unresolvedFacets: readonly FacetName[]; readonly unresolvedHypotheses: readonly HypothesisId[]; readonly unresolvedChoices: readonly ChoiceId[] } {
  const facets = unresolvedFacets(revision.spec);
  const unresolved = unresolvedHypotheses(revision.hypotheses, revision.resolutions);
  const choices = unresolvedChoices(revision.choices, revision.choiceResolutions);
  if (facets.length > 0 || unresolved.length > 0 || choices.length > 0) {
    return { ok: false, unresolvedFacets: facets, unresolvedHypotheses: unresolved, unresolvedChoices: choices };
  }
  return {
    ok: true,
    revision: {
      state: "ready",
      revisionId: revision.revisionId,
      ready: `ready_${randomUUID()}` as ReadyRevision["ready"],
    },
  };
}

export function assertChoiceAlternative(choice: Choice, alternativeId: string): void {
  if (!choice.alternatives.some((alternative) => alternative.id === alternativeId)) {
    throw new QualificationError("ALTERNATIVE_NOT_FOUND", `Alternative ${alternativeId} is not part of Choice ${choice.id}`);
  }
}
