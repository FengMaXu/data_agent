import type { Choice, ChoiceOutputs, ChoiceProbeRecord, ChoiceProbeView, ProbeWaiver } from "./model.js";

/** Per-task cap on probe executions; probes do not consume the exploration budget. */
export const MAX_CHOICE_PROBES = 24;
/** Probes run to completion up to the executor's exploration cap so the fingerprint covers the whole output. */
export const CHOICE_PROBE_ROW_LIMIT = 10_000;

export interface ChoiceProbeSummary {
  readonly probes: readonly ChoiceProbeView[];
  readonly outputs: ChoiceOutputs;
  /** Every alternative has a probe (of any outcome) or a waiver. */
  readonly covered: boolean;
  readonly missing: readonly string[];
  /** Fingerprint per alternative, only for available probes. */
  readonly fingerprints: ReadonlyMap<string, string>;
}

/**
 * Derives what the Runtime knows about a Choice's outputs from the latest
 * probe of each alternative and the declared waivers.
 */
export function summarizeChoiceProbes(choice: Choice, probes: readonly ChoiceProbeRecord[], waivers: readonly ProbeWaiver[]): ChoiceProbeSummary {
  const latest = new Map<string, ChoiceProbeRecord>();
  for (const probe of probes) if (probe.choiceId === choice.id) latest.set(probe.alternativeId, probe);
  const waived = new Map(waivers.filter((waiver) => waiver.choiceId === choice.id).map((waiver) => [waiver.alternativeId as string, waiver]));
  const fingerprints = new Map<string, string>();
  const missing: string[] = [];
  const views = choice.alternatives.map((alternative): ChoiceProbeView => {
    const probe = latest.get(alternative.id);
    if (probe?.outcome.state === "available") {
      fingerprints.set(alternative.id, probe.outcome.fingerprint);
      return { alternativeId: alternative.id, state: "available", rowCount: probe.rowCount, output: probe.outcome.fingerprint.slice(0, 12) };
    }
    if (probe) return { alternativeId: alternative.id, state: "unavailable", rowCount: probe.rowCount, reason: probe.outcome.reason };
    const waiver = waived.get(alternative.id);
    if (waiver) return { alternativeId: alternative.id, state: "waived", reason: waiver.reason };
    missing.push(alternative.id);
    return { alternativeId: alternative.id, state: "missing" };
  });
  const complete = fingerprints.size === choice.alternatives.length;
  const outputs: ChoiceOutputs = !complete
    ? new Set(fingerprints.values()).size > 1 ? "distinct" : "incomplete"
    : new Set(fingerprints.values()).size === 1 ? "identical" : "distinct";
  return { probes: views, outputs, covered: missing.length === 0, missing, fingerprints };
}

/**
 * Unresolved Choices whose every alternative produced the same output. The
 * Runtime treats them as equivalent without a disposition: the answer does
 * not depend on the Choice, and the fingerprints are the Runtime's own record.
 */
export function equivalentChoiceIds(
  revision: { readonly choices: readonly Choice[]; readonly choiceResolutions: readonly { readonly choiceId: string }[]; readonly probeWaivers?: readonly ProbeWaiver[] },
  probes: readonly ChoiceProbeRecord[],
): ReadonlySet<string> {
  const resolved = new Set(revision.choiceResolutions.map((resolution) => resolution.choiceId));
  return new Set(revision.choices
    .filter((choice) => !resolved.has(choice.id) && summarizeChoiceProbes(choice, probes, revision.probeWaivers ?? []).outputs === "identical")
    .map((choice) => choice.id));
}
