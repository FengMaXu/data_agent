import type { FieldAlternative, FieldProbeRecord, FieldRecord, ProbeOutputs, ProbeView, ProbeWaiver, SpecFields } from "./model.js";
import type { SpecPath } from "./fields.js";

/** Per-task cap on probe executions; probes do not consume the exploration budget. */
export const MAX_FIELD_PROBES = 24;
/** Probes run to completion up to the executor's exploration cap so the fingerprint covers the whole output. */
export const PROBE_ROW_LIMIT = 10_000;

export interface ProbeSummary {
  readonly probes: readonly ProbeView[];
  readonly outputs: ProbeOutputs;
  /** Every alternative has a probe (of any outcome) or a waiver. */
  readonly covered: boolean;
  readonly missing: readonly string[];
  /** Fingerprint per alternative, only for available probes. */
  readonly fingerprints: ReadonlyMap<string, string>;
}

/**
 * Derives what the Runtime knows about an open field's outputs from the
 * latest probe of each alternative and the declared waivers (ADR-0005).
 */
export function summarizeProbes(path: SpecPath, alternatives: readonly FieldAlternative[], probes: readonly FieldProbeRecord[], waivers: readonly ProbeWaiver[]): ProbeSummary {
  const latest = new Map<string, FieldProbeRecord>();
  for (const probe of probes) if (probe.path === path) latest.set(probe.alternativeId, probe);
  const waived = new Map(waivers.map((waiver) => [waiver.alternativeId as string, waiver]));
  const fingerprints = new Map<string, string>();
  const missing: string[] = [];
  const views = alternatives.map((alternative): ProbeView => {
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
  const complete = fingerprints.size === alternatives.length;
  const distinct = new Set(fingerprints.values()).size;
  const outputs: ProbeOutputs = !complete ? distinct > 1 ? "distinct" : "incomplete" : distinct === 1 ? "identical" : "distinct";
  return { probes: views, outputs, covered: missing.length === 0, missing, fingerprints };
}

/**
 * Open fields whose every alternative produced the same output. The Runtime
 * treats them as handled without a decision: the answer does not depend on
 * them, and the fingerprints are the Runtime's own record.
 */
export function equivalentPaths(fields: SpecFields, probes: readonly FieldProbeRecord[]): ReadonlySet<SpecPath> {
  const paths = new Set<SpecPath>();
  for (const [path, field] of Object.entries(fields) as [SpecPath, FieldRecord][]) {
    if (field.state === "open" && summarizeProbes(path, field.alternatives, probes, field.waivers ?? []).outputs === "identical") paths.add(path);
  }
  return paths;
}

export interface RealizationConflict {
  readonly path: SpecPath;
  readonly adoptedAlternativeId: string;
  /** The alternative whose probe output the result reproduces. */
  readonly realizedAlternativeId: string;
}

/**
 * A result realizes a decision unless it reproduces the probe output of an
 * alternative that was not adopted (ADR-0005). Equality with the adopted
 * alternative's output is not required: other fields may have changed since
 * the probes ran, so only a match with a rejected alternative is conclusive.
 */
export function realizationConflicts(fields: SpecFields, probes: readonly FieldProbeRecord[], resultFingerprint: string): readonly RealizationConflict[] {
  const conflicts: RealizationConflict[] = [];
  for (const [path, field] of Object.entries(fields) as [SpecPath, FieldRecord][]) {
    if (field.state !== "decided") continue;
    const { fingerprints } = summarizeProbes(path, field.alternatives, probes, field.waivers ?? []);
    if (fingerprints.get(field.alternativeId) === resultFingerprint) continue;
    for (const [alternativeId, fingerprint] of fingerprints) {
      if (alternativeId === field.alternativeId || fingerprint !== resultFingerprint) continue;
      conflicts.push({ path, adoptedAlternativeId: field.alternativeId, realizedAlternativeId: alternativeId });
      break;
    }
  }
  return conflicts;
}
