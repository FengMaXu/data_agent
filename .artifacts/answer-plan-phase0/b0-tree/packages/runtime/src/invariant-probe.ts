import { randomUUID } from "node:crypto";
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
  readonly candidateId?: string;
  readonly dataSnapshot?: string;
  readonly [key: string]: unknown;
}

export type ProbeOutcome =
  | { readonly status: "passed"; readonly evidence: unknown }
  | { readonly status: "failed"; readonly evidence: unknown }
  | { readonly status: "not_applicable"; readonly missing: readonly string[] }
  | { readonly status: "unsupported"; readonly reason: string }
  | { readonly status: "inconclusive"; readonly reason: string };

export interface InvariantProbe {
  readonly id: string;
  readonly requiredEvidence: readonly EvidenceRequirement[];
  evaluate(input: ProbeInput): ProbeOutcome;
}

/** Runtime-owned probe definition; Solver input cannot add blocking policy. */
export interface ProbeTemplate extends InvariantProbe {
  readonly version: string;
  readonly claimKind: string;
}

export interface ProbeInstance {
  readonly instanceId: string;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly claimId: string;
  readonly specVersion: string;
  readonly candidateId?: string;
  readonly digestPaths: readonly string[];
  readonly queryDigestVersion?: string;
  readonly normalizedSqlHash?: string;
  readonly schemaEvidenceFingerprint?: string;
  readonly snapshotId?: string;
  readonly frozenAt: string;
}

export interface ProbeInstanceContext {
  readonly claimId: string;
  readonly specVersion: string;
  readonly candidateId?: string;
  readonly digestPaths: readonly string[];
  readonly queryDigestVersion?: string;
  readonly normalizedSqlHash?: string;
  readonly schemaEvidenceFingerprint?: string;
  readonly snapshotId?: string;
  readonly frozenAt?: string;
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
    // Blocking authority belongs to the Gate Policy, not to a Solver or a
    // probe adapter. The registry only validates evidence prerequisites and
    // returns the probe's observable outcome.
    return probe.evaluate(input);
  }

  /** Freeze a Runtime-owned probe template against one candidate/spec/snapshot. */
  createInstance(id: string, context: ProbeInstanceContext): ProbeInstance {
    const probe = this.probes.get(id);
    if (!probe) throw new Error(`PROBE_NOT_REGISTERED:${id}`);
    const template = probe as Partial<ProbeTemplate>;
    return Object.freeze({
      instanceId: randomUUID(),
      templateId: id,
      templateVersion: typeof template.version === "string" && template.version ? template.version : "1",
      claimId: context.claimId,
      specVersion: context.specVersion,
      ...(context.candidateId ? { candidateId: context.candidateId } : {}),
      digestPaths: Object.freeze([...context.digestPaths]),
      ...(context.queryDigestVersion ? { queryDigestVersion: context.queryDigestVersion } : {}),
      ...(context.normalizedSqlHash ? { normalizedSqlHash: context.normalizedSqlHash } : {}),
      ...(context.schemaEvidenceFingerprint ? { schemaEvidenceFingerprint: context.schemaEvidenceFingerprint } : {}),
      ...(context.snapshotId ? { snapshotId: context.snapshotId } : {}),
      frozenAt: context.frozenAt ?? new Date().toISOString(),
    });
  }

  /** Evaluate only the frozen template; stale spec/snapshot bindings are inconclusive. */
  evaluateInstance(instance: ProbeInstance, input: ProbeInput): ProbeOutcome {
    const probe = this.probes.get(instance.templateId) as Partial<ProbeTemplate> | undefined;
    if (!probe) return { status: "unsupported", reason: `PROBE_TEMPLATE_NOT_REGISTERED:${instance.templateId}` };
    if (typeof probe.version === "string" && probe.version !== instance.templateVersion) return { status: "inconclusive", reason: "PROBE_TEMPLATE_VERSION_CHANGED" };
    if (input.answerSpec.specVersion !== instance.specVersion) return { status: "inconclusive", reason: "PROBE_SPEC_VERSION_CHANGED" };
    if (instance.candidateId !== undefined && input.candidateId !== instance.candidateId) return { status: "inconclusive", reason: "PROBE_CANDIDATE_CHANGED" };
    if (instance.snapshotId !== undefined && input.dataSnapshot !== instance.snapshotId) return { status: "inconclusive", reason: "PROBE_SNAPSHOT_CHANGED" };
    if (instance.queryDigestVersion !== undefined && input.digest?.queryDigestVersion !== instance.queryDigestVersion) return { status: "inconclusive", reason: "PROBE_DIGEST_CHANGED" };
    if (instance.normalizedSqlHash !== undefined && input.digest?.normalizedSqlHash !== instance.normalizedSqlHash) return { status: "inconclusive", reason: "PROBE_DIGEST_CHANGED" };
    if (instance.schemaEvidenceFingerprint !== undefined && input.digest?.schemaEvidenceFingerprint !== instance.schemaEvidenceFingerprint) return { status: "inconclusive", reason: "PROBE_SCHEMA_CHANGED" };
    return this.evaluate(instance.templateId, { ...input, candidateId: instance.candidateId });
  }

  ids(): readonly string[] { return [...this.probes.keys()]; }
}
