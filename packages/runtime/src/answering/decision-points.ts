import type { AnswerRevisionRecord, Choice, Hypothesis, Resolution } from "./model.js";

/**
 * Fixed decision points every query makes (ADR-0005). Declaring each one
 * makes an unexamined ambiguity visible; the Runtime checks that a
 * declaration exists and is well-formed, never whether it is right.
 */
export const DECISION_POINTS = [
  "population",
  "join_multiplicity",
  "time_field",
  "count_grain",
  "denominator",
  "window",
  "ties",
  "output_shape",
] as const;

export type DecisionPointName = typeof DECISION_POINTS[number];

export type DecisionPoint = (
  | { readonly status: "fixed_by_request"; readonly quote: string }
  | { readonly status: "not_applicable" }
  | { readonly status: "choice"; readonly choiceId: Choice["id"] }
  | { readonly status: "assumed"; readonly hypothesisId: Hypothesis["id"] }
  /** Declared by the parent Report Task (ADR-0009), which must have handled it. */
  | { readonly status: "inherited" }
) & { readonly observationEvidenceIds?: readonly string[] };

export type DecisionPoints = Readonly<Partial<Record<DecisionPointName, DecisionPoint>>>;

export interface DecisionPointProposal {
  readonly name: string;
  readonly status: string;
  /** fixed_by_request: verbatim text of the original request that settles this point. */
  readonly quote?: string;
  /** choice: an existing Choice id or the localId of a Choice added in the same call. */
  readonly choiceId?: string;
  /** assumed: an existing Hypothesis id or the localId of one added in the same call. */
  readonly hypothesisId?: string;
  /** Evidence ids of the data checks behind the declaration. */
  readonly observationEvidenceIds?: readonly string[];
}

export function isDecisionPointName(value: string): value is DecisionPointName {
  return (DECISION_POINTS as readonly string[]).includes(value);
}

/** Legacy revisions (no decisionPoints field) are exempt. */
export function undeclaredDecisionPoints(revision: Pick<AnswerRevisionRecord, "decisionPoints">): readonly DecisionPointName[] {
  const declared = revision.decisionPoints;
  if (!declared) return [];
  return DECISION_POINTS.filter((name) => !declared[name]);
}

export interface DecisionPointContext {
  readonly choices: readonly Choice[];
  readonly hypotheses: readonly Hypothesis[];
  readonly resolutions: readonly Resolution[];
  readonly choiceByRef: (ref: string) => Choice | undefined;
  readonly hypothesisByRef: (ref: string) => Hypothesis | undefined;
  readonly evidenceExists: (ref: string) => boolean;
  readonly invalid: (message: string) => never;
}

/** Applies declarations over the carried-forward ones; a later declaration of the same point replaces it. */
export function applyDecisionPoints(previous: DecisionPoints, proposals: readonly DecisionPointProposal[], context: DecisionPointContext): DecisionPoints {
  const next: Partial<Record<DecisionPointName, DecisionPoint>> = { ...previous };
  const seen = new Set<string>();
  for (const proposal of proposals) {
    const name = typeof proposal.name === "string" ? proposal.name.trim() : "";
    if (!isDecisionPointName(name)) context.invalid(`Unknown decision point ${name}; use one of ${DECISION_POINTS.join(", ")}`);
    if (seen.has(name)) context.invalid(`Decision point ${name} is declared more than once in the same call`);
    seen.add(name);
    const observations = (proposal.observationEvidenceIds ?? []).map((ref) => {
      if (!context.evidenceExists(ref)) context.invalid(`Decision point ${name} references unknown evidence ${ref}`);
      return ref;
    });
    const extra = observations.length > 0 ? { observationEvidenceIds: observations } : {};
    switch (proposal.status) {
      case "fixed_by_request": {
        const quote = typeof proposal.quote === "string" ? proposal.quote.trim() : "";
        if (!quote) context.invalid(`Decision point ${name} fixed_by_request needs the verbatim request text that settles it`);
        next[name] = { status: "fixed_by_request", quote, ...extra };
        break;
      }
      case "not_applicable":
        next[name] = { status: "not_applicable", ...extra };
        break;
      case "choice": {
        const choice = proposal.choiceId ? context.choiceByRef(proposal.choiceId.trim()) : undefined;
        if (!choice) context.invalid(`Decision point ${name} references unknown choice ${proposal.choiceId ?? ""}`);
        next[name] = { status: "choice", choiceId: choice.id, ...extra };
        break;
      }
      case "assumed": {
        const hypothesis = proposal.hypothesisId ? context.hypothesisByRef(proposal.hypothesisId.trim()) : undefined;
        if (!hypothesis) context.invalid(`Decision point ${name} references unknown hypothesis ${proposal.hypothesisId ?? ""}`);
        next[name] = { status: "assumed", hypothesisId: hypothesis.id, ...extra };
        break;
      }
      default:
        context.invalid(`Decision point ${name} has unknown status ${String(proposal.status)}; use fixed_by_request, not_applicable, choice or assumed`);
    }
  }
  // A declaration may not rest on an item that left the Revision or was refuted.
  const present = new Set<string>([...context.choices.map((item) => item.id), ...context.hypotheses.map((item) => item.id)]);
  const refuted = new Set<string>(context.resolutions.filter((item) => item.outcome === "refuted").map((item) => item.hypothesisId));
  for (const [name, point] of Object.entries(next) as [DecisionPointName, DecisionPoint][]) {
    const ref = point.status === "choice" ? point.choiceId : point.status === "assumed" ? point.hypothesisId : undefined;
    if (ref && !present.has(ref)) context.invalid(`Decision point ${name} still references removed item ${ref}; redeclare it in the same revision`);
    if (ref && refuted.has(ref)) context.invalid(`Decision point ${name} rests on refuted hypothesis ${ref}; redeclare it in the same revision`);
  }
  return next;
}

/** Quotes of fixed_by_request declarations, verified against the original request before the transaction. */
export function decisionPointQuotes(proposals: readonly DecisionPointProposal[] | undefined): readonly string[] {
  return (proposals ?? []).flatMap((proposal) => proposal.status === "fixed_by_request" && typeof proposal.quote === "string" && proposal.quote.trim() ? [proposal.quote.trim()] : []);
}
