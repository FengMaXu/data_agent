/**
 * Advisory Ledger (ADR-0005): the Runtime's record of what compare_hypotheses
 * advised for an open field. Only trusted code writes it (the comparison tool after
 * calling the advisor); Answering reads it to require a reasoned override when
 * a decision departs from a clear lean. Advice is never Evidence.
 */
export interface FieldAdvisory {
  readonly taskId: string;
  readonly path: string;
  /** Alternative ids in field order; advice for a different alternative set does not apply. */
  readonly alternativeIds: readonly string[];
  readonly model: string;
  readonly probabilities: readonly { readonly alternativeId: string; readonly probability: number }[];
  readonly recommendation: "alternative" | "insufficient_evidence" | "multiple_plausible" | "none_supported";
  readonly recommendedAlternativeId?: string;
  /** The alternative the advice clearly favours, if any (see leanOf). */
  readonly lean?: { readonly alternativeId: string; readonly probability: number };
  readonly recordedAt: string;
}

export interface AdvisoryLedger {
  record(advisory: FieldAdvisory): void;
  latest(taskId: string, path: string): FieldAdvisory | undefined;
}

export class InMemoryAdvisoryLedger implements AdvisoryLedger {
  private readonly entries = new Map<string, FieldAdvisory>();

  record(advisory: FieldAdvisory): void {
    this.entries.set(`${advisory.taskId}\u0000${advisory.path}`, structuredClone(advisory));
  }

  latest(taskId: string, path: string): FieldAdvisory | undefined {
    const entry = this.entries.get(`${taskId}\u0000${path}`);
    return entry ? structuredClone(entry) : undefined;
  }
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
