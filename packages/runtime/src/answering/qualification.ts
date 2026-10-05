import { undeclaredDecisionPoints, type DecisionPointName } from "./decision-points.js";
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
  type Supersession,
  isTextEvidenceKind,
} from "./model.js";

export class QualificationError extends Error {
  readonly code:
    | "EVIDENCE_KIND_NOT_QUALIFIED"
    | "EVIDENCE_NOT_VERIFIED"
    | "CONTINUITY_VIOLATION"
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
 * Text evidence carries authority only through a quote that Runtime found in a
 * trusted source. Legacy or auto-registered text evidence without that record
 * remains readable context but never qualifies a Resolution.
 */
export function isAdmissibleProof(evidence: Evidence): boolean {
  if (!isTextEvidenceKind(evidence.kind)) return true;
  return Boolean(evidence.verification && evidence.quote?.trim());
}

/**
 * Produce the only proof handle accepted by a supported/refuted Resolution.
 * Observation evidence is intentionally excluded from business-semantic
 * hypotheses even when its values look persuasive.
 */
export function qualifyEvidence(hypothesis: Hypothesis, evidence: Evidence): QualifiedEvidenceId {
  if (!allowedEvidence[hypothesis.kind].includes(evidence.kind)) {
    throw new QualificationError(
      "EVIDENCE_KIND_NOT_QUALIFIED",
      `Evidence ${evidence.kind} cannot qualify hypothesis kind ${hypothesis.kind}; it accepts ${allowedEvidence[hypothesis.kind].join(", ")}`,
    );
  }
  if (!isAdmissibleProof(evidence)) {
    throw new QualificationError(
      "EVIDENCE_NOT_VERIFIED",
      `Evidence ${evidence.id} has no Runtime-verified quote and cannot qualify a Resolution; submit it again in the evidence array with its verbatim quote`,
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

/** `equivalent` lists Choices the Runtime derived as equivalent from identical probe outputs. */
export function unresolvedChoices(
  choices: readonly Choice[],
  resolutions: readonly ChoiceResolution[],
  equivalent: ReadonlySet<string> = new Set(),
): readonly ChoiceId[] {
  const resolved = new Set(resolutions.map((resolution) => resolution.choiceId));
  return choices.filter((choice) => !resolved.has(choice.id) && !equivalent.has(choice.id)).map((choice) => choice.id);
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

/** Specified facets whose basis is model inference; disclosed, never a seal blocker. */
export function inferredFacets(spec: AnswerSpec): readonly FacetName[] {
  const inferred = new Set<FacetName>();
  const scalar: readonly [FacetName, Facet<unknown>][] = [
    ["entity", spec.entity],
    ["metric", spec.metric],
    ["time", spec.time],
    ["ranking", spec.ranking],
    ["output", spec.output],
  ];
  for (const [name, facet] of scalar) if (facet.state === "specified" && facet.basis.kind === "inference") inferred.add(name);
  if (spec.filters.some((facet) => facet.state === "specified" && facet.basis.kind === "inference")) inferred.add("filters");
  if (spec.groupBy.some((facet) => facet.state === "specified" && facet.basis.kind === "inference")) inferred.add("groupBy");
  return [...inferred];
}

/**
 * Cross-revision invariant (ADR-0004): an item leaves a Revision only through
 * explicit supersession, keeps its identity, and a previously unresolved item
 * is either still unresolved or resolved in the next Revision. Resolutions are
 * never silently dropped for carried items.
 */
export function assertContinuity(
  previous: Pick<AnswerRevisionRecord, "hypotheses" | "choices" | "resolutions" | "choiceResolutions">,
  next: Pick<AnswerRevisionRecord, "hypotheses" | "choices" | "resolutions" | "choiceResolutions">,
  supersessions: readonly Supersession[],
): void {
  const superseded = new Set<string>(supersessions.map((item) => item.targetId));
  const nextHypotheses = new Map(next.hypotheses.map((item) => [item.id as string, item]));
  const nextChoices = new Map(next.choices.map((item) => [item.id as string, item]));
  for (const hypothesis of previous.hypotheses) {
    if (superseded.has(hypothesis.id)) continue;
    const carried = nextHypotheses.get(hypothesis.id);
    if (!carried || carried.kind !== hypothesis.kind || carried.statement !== hypothesis.statement) {
      throw new QualificationError("CONTINUITY_VIOLATION", `Hypothesis ${hypothesis.id} disappeared or changed without supersession`);
    }
  }
  for (const choice of previous.choices) {
    if (superseded.has(choice.id)) continue;
    const carried = nextChoices.get(choice.id);
    if (!carried || carried.alternatives.map((item) => item.id).join("|") !== choice.alternatives.map((item) => item.id).join("|")) {
      throw new QualificationError("CONTINUITY_VIOLATION", `Choice ${choice.id} disappeared or changed without supersession`);
    }
  }
  const nextResolutions = new Map(next.resolutions.map((item) => [item.hypothesisId as string, item]));
  for (const resolution of previous.resolutions) {
    if (superseded.has(resolution.hypothesisId)) continue;
    const carried = nextResolutions.get(resolution.hypothesisId);
    if (!carried || carried.outcome !== resolution.outcome) {
      throw new QualificationError("CONTINUITY_VIOLATION", `Resolution for ${resolution.hypothesisId} was dropped or changed`);
    }
  }
  const nextChoiceResolutions = new Map(next.choiceResolutions.map((item) => [item.choiceId as string, item]));
  for (const resolution of previous.choiceResolutions) {
    if (superseded.has(resolution.choiceId)) continue;
    const carried = nextChoiceResolutions.get(resolution.choiceId);
    const alternativeOf = (item: ChoiceResolution) => item.outcome === "equivalent" ? undefined : item.alternativeId;
    if (!carried || carried.outcome !== resolution.outcome || alternativeOf(carried) !== alternativeOf(resolution)) {
      throw new QualificationError("CONTINUITY_VIOLATION", `Choice resolution for ${resolution.choiceId} was dropped or changed`);
    }
  }
}

/** Seal only after all hypotheses, choices, seven-facet slots and decision points are handled; derived-equivalent Choices count as handled. */
export function sealForResult(revision: AnswerRevisionRecord, equivalent: ReadonlySet<string> = new Set()):
  | { readonly ok: true; readonly revision: ReadyRevision }
  | { readonly ok: false; readonly unresolvedFacets: readonly FacetName[]; readonly unresolvedHypotheses: readonly HypothesisId[]; readonly unresolvedChoices: readonly ChoiceId[]; readonly undeclaredDecisionPoints: readonly DecisionPointName[] } {
  const facets = unresolvedFacets(revision.spec);
  const unresolved = unresolvedHypotheses(revision.hypotheses, revision.resolutions);
  const choices = unresolvedChoices(revision.choices, revision.choiceResolutions, equivalent);
  const undeclared = undeclaredDecisionPoints(revision);
  if (facets.length > 0 || unresolved.length > 0 || choices.length > 0 || undeclared.length > 0) {
    return { ok: false, unresolvedFacets: facets, unresolvedHypotheses: unresolved, unresolvedChoices: choices, undeclaredDecisionPoints: undeclared };
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
