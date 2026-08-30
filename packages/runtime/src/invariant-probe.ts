import type { AnswerSpec } from "./answer-spec.js";
import type { QueryDigest, SchemaEvidence } from "./query-digest.js";

export interface EvidenceRequirement {
  readonly kind: "hard_constraint" | "schema";
  readonly id: string;
}

export interface ProbeInput {
  readonly answerSpec: AnswerSpec;
  readonly digest?: QueryDigest;
  readonly schema?: SchemaEvidence;
  readonly [key: string]: unknown;
}

export type ProbeOutcome =
  | { readonly status: "passed"; readonly evidence: unknown; readonly blocking?: false }
  | { readonly status: "failed"; readonly evidence: unknown; readonly blocking?: boolean }
  | { readonly status: "not_applicable"; readonly missing: readonly string[] }
  | { readonly status: "unsupported"; readonly reason: string };

export interface InvariantProbe {
  readonly id: string;
  readonly requiredEvidence: readonly EvidenceRequirement[];
  evaluate(input: ProbeInput): ProbeOutcome;
}

export class InvariantProbeRegistry {
  private readonly probes = new Map<string, InvariantProbe>();
  constructor(probes: readonly InvariantProbe[] = []) { for (const probe of probes) this.probes.set(probe.id, probe); }
  register(probe: InvariantProbe): void { this.probes.set(probe.id, probe); }

  evaluate(id: string, input: ProbeInput): ProbeOutcome {
    const probe = this.probes.get(id);
    if (!probe) return { status: "unsupported", reason: `PROBE_NOT_REGISTERED:${id}` };
    const missing: string[] = [];
    for (const requirement of probe.requiredEvidence) {
      if (requirement.kind === "hard_constraint" && !input.answerSpec.hardConstraints.some((constraint) => constraint.id === requirement.id)) missing.push(requirement.id);
      if (requirement.kind === "schema" && !input.schema) missing.push(requirement.id);
    }
    if (missing.length > 0) return { status: "not_applicable", missing };
    const outcome = probe.evaluate(input);
    if (outcome.status === "failed") return { ...outcome, blocking: true };
    return outcome;
  }

  ids(): readonly string[] { return [...this.probes.keys()]; }
}
