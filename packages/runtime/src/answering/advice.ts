import { contentHash, type AdviceView, type FieldAlternative, type QueryTaskRecord } from "./model.js";
import type { ProbeSummary } from "./probes.js";

/**
 * Field Advice (ADR-0005): what the comparison advisor said about one open
 * field's alternatives. The Runtime asks for it once every alternative's
 * output is known and they differ, records it on the Query Task, and reads it
 * when the field is decided. Advice is never Evidence.
 */
export interface FieldAdvisory {
  readonly path: string;
  /** Alternative ids in field order; advice for a different alternative set does not apply. */
  readonly alternativeIds: readonly string[];
  /** adviceBasis of the probe outputs the advisor saw; advice about other outputs does not apply. */
  readonly basis: string;
  readonly model: string;
  readonly probabilities: readonly { readonly alternativeId: string; readonly probability: number }[];
  /** unavailable: the advisor failed; the field may be decided without advice, and the decision is disclosed. */
  readonly recommendation: "alternative" | "insufficient_evidence" | "multiple_plausible" | "none_supported" | "unavailable";
  /** Why the advisor could not answer, when recommendation is unavailable. */
  readonly failure?: string;
  readonly recommendedAlternativeId?: string;
  /** The alternative the advice clearly favours, if any (see leanOf). */
  readonly lean?: { readonly alternativeId: string; readonly probability: number };
  readonly recordedAt: string;
}

/** Minimum probability for an unrecommended top alternative to count as a lean. */
export const LEAN_MIN_PROBABILITY = 0.2;
/** The top alternative must be at least this many times as likely as the runner-up. */
export const LEAN_MIN_RATIO = 2;

/**
 * A clear lean: the recommended alternative, or else a top alternative with
 * probability >= 0.2 and at least twice the runner-up (e.g. 0.25 vs 0).
 */
export function leanOf(
  probabilities: readonly { readonly alternativeId: string; readonly probability: number }[],
  recommendedAlternativeId?: string,
): FieldAdvisory["lean"] {
  if (recommendedAlternativeId) {
    const recommended = probabilities.find((item) => item.alternativeId === recommendedAlternativeId);
    return { alternativeId: recommendedAlternativeId, probability: recommended?.probability ?? 0 };
  }
  const ranked = [...probabilities].sort((left, right) => right.probability - left.probability);
  const top = ranked[0];
  if (!top || top.probability < LEAN_MIN_PROBABILITY) return undefined;
  const runnerUp = ranked[1]?.probability ?? 0;
  return top.probability >= LEAN_MIN_RATIO * runnerUp ? { alternativeId: top.alternativeId, probability: top.probability } : undefined;
}

/** Identity of what the advisor is shown: each alternative and its probe outcome under the current context. */
export function adviceBasis(summary: ProbeSummary): string {
  return contentHash(summary.probes.map((probe) => [probe.alternativeId, probe.state, probe.output ?? "", probe.rowCount ?? ""])).slice(0, 32);
}

/** The recorded advice that still applies to this alternative set and these probe outputs. */
export function applicableAdvice(advice: FieldAdvisory | undefined, alternatives: readonly FieldAlternative[], summary: ProbeSummary): FieldAdvisory | undefined {
  if (!advice) return undefined;
  const ids = alternatives.map((item) => item.id as string);
  const sameSet = advice.alternativeIds.length === ids.length && advice.alternativeIds.every((id, index) => id === ids[index]);
  return sameSet && advice.basis === adviceBasis(summary) ? advice : undefined;
}

/** What a view shows of an advisory. */
export function adviceView(advice: FieldAdvisory): AdviceView {
  return { recommendation: advice.recommendation, probabilities: advice.probabilities, ...(advice.lean ? { lean: advice.lean } : {}) };
}

export function latestAdvice(task: Pick<QueryTaskRecord, "fieldAdvice">, path: string): FieldAdvisory | undefined {
  return task.fieldAdvice?.find((item) => item.path === path);
}
