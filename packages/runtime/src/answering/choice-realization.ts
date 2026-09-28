import type { AnswerRevisionRecord, ChoiceProbeRecord } from "./model.js";
import { summarizeChoiceProbes } from "./choice-probe.js";

export interface RealizationConflict {
  readonly choiceId: string;
  readonly adoptedAlternativeId: string;
  /** The alternative whose probe output the result reproduces. */
  readonly realizedAlternativeId: string;
}

/**
 * A result realizes a Choice decision unless it reproduces the probe output of
 * an alternative that was not adopted (ADR-0005). Equality with the adopted
 * alternative's output is not required: other Choices may have changed since
 * the probes ran, so only a match with a rejected alternative is conclusive.
 */
export function realizationConflicts(revision: Pick<AnswerRevisionRecord, "choices" | "choiceResolutions" | "probeWaivers">, probes: readonly ChoiceProbeRecord[], resultFingerprint: string): readonly RealizationConflict[] {
  const conflicts: RealizationConflict[] = [];
  const choices = new Map(revision.choices.map((choice) => [choice.id as string, choice]));
  for (const resolution of revision.choiceResolutions) {
    if (resolution.outcome === "equivalent") continue;
    const choice = choices.get(resolution.choiceId);
    if (!choice) continue;
    const { fingerprints } = summarizeChoiceProbes(choice, probes, revision.probeWaivers ?? []);
    const adopted = fingerprints.get(resolution.alternativeId);
    if (adopted === resultFingerprint) continue;
    for (const [alternativeId, fingerprint] of fingerprints) {
      if (alternativeId === resolution.alternativeId || fingerprint !== resultFingerprint) continue;
      conflicts.push({ choiceId: choice.id, adoptedAlternativeId: resolution.alternativeId, realizedAlternativeId: alternativeId });
      break;
    }
  }
  return conflicts;
}
