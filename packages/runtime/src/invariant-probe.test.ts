import { describe, expect, it } from "vitest";
import { InvariantProbeRegistry, type InvariantProbe } from "./invariant-probe.js";

const spec = {
  taskId: "task-1", specVersion: "1", question: "q",
  hardConstraints: [{ id: "HC-1", statement: "one row", scope: "grain", provenance: { authority: "request_wording", source: "q" } }],
  hypotheses: [], ambiguities: [], provenance: [],
};

describe("InvariantProbeRegistry", () => {
  it("returns a failed probe without allowing the probe to self-assign blocking authority", () => {
    const probe: InvariantProbe = {
      id: "shape",
      requiredEvidence: [{ kind: "hard_constraint", id: "HC-1" }],
      evaluate: () => ({ status: "failed", evidence: { reason: "two rows" } }),
    };
    const registry = new InvariantProbeRegistry([probe]);
    expect(registry.evaluate("shape", { answerSpec: spec })).toMatchObject({ status: "failed", evidence: { reason: "two rows" } });
    expect(registry.evaluate("shape", { answerSpec: spec })).not.toHaveProperty("blocking");

    const missing = new InvariantProbeRegistry([{
      ...probe,
      requiredEvidence: [{ kind: "hard_constraint", id: "missing" }],
    }]);
    expect(missing.evaluate("shape", { answerSpec: spec })).toMatchObject({ status: "not_applicable" });
  });

  it("freezes a versioned probe instance and rejects stale spec or snapshot bindings", () => {
    const registry = new InvariantProbeRegistry([{
      id: "versioned",
      version: "7",
      claimKind: "shape",
      requiredEvidence: [],
      evaluate: () => ({ status: "passed", evidence: { ok: true } }),
    }]);
    const instance = registry.createInstance("versioned", { claimId: "HC-1", specVersion: "1", candidateId: "candidate-1", digestPaths: ["projections"], queryDigestVersion: "2", normalizedSqlHash: "sql-hash", schemaEvidenceFingerprint: "schema-hash", snapshotId: "snapshot-1" });
    expect(instance).toMatchObject({ templateId: "versioned", templateVersion: "7", specVersion: "1", snapshotId: "snapshot-1", queryDigestVersion: "2" });
    expect(registry.evaluateInstance(instance, { answerSpec: spec, candidateId: "candidate-1", digest: { queryDigestVersion: "2", normalizedSqlHash: "sql-hash", schemaEvidenceFingerprint: "schema-hash" } as any, dataSnapshot: "snapshot-1" })).toMatchObject({ status: "passed" });
    expect(registry.evaluateInstance(instance, { answerSpec: { ...spec, specVersion: "2" }, dataSnapshot: "snapshot-1" })).toMatchObject({ status: "inconclusive", reason: "PROBE_SPEC_VERSION_CHANGED" });
    expect(registry.evaluateInstance(instance, { answerSpec: spec, candidateId: "candidate-1", digest: { queryDigestVersion: "2", normalizedSqlHash: "sql-hash", schemaEvidenceFingerprint: "schema-hash" } as any, dataSnapshot: "snapshot-2" })).toMatchObject({ status: "inconclusive", reason: "PROBE_SNAPSHOT_CHANGED" });
    expect(registry.evaluateInstance(instance, { answerSpec: spec, candidateId: "candidate-2", digest: { queryDigestVersion: "2", normalizedSqlHash: "sql-hash", schemaEvidenceFingerprint: "schema-hash" } as any, dataSnapshot: "snapshot-1" })).toMatchObject({ status: "inconclusive", reason: "PROBE_CANDIDATE_CHANGED" });
    expect(registry.evaluateInstance(instance, { answerSpec: spec, candidateId: "candidate-1", digest: { queryDigestVersion: "2", normalizedSqlHash: "changed", schemaEvidenceFingerprint: "schema-hash" } as any, dataSnapshot: "snapshot-1" })).toMatchObject({ status: "inconclusive", reason: "PROBE_DIGEST_CHANGED" });
  });

  it("returns unsupported or inconclusive without guessing for an unapplicable probe", () => {
    const registry = new InvariantProbeRegistry([{
      id: "join",
      requiredEvidence: [{ kind: "schema", id: "fk-1" }],
      evaluate: () => ({ status: "failed", evidence: {} }),
    }]);
    expect(registry.evaluate("join", { answerSpec: spec })).toMatchObject({ status: "not_applicable" });
    expect(registry.evaluate("unknown", { answerSpec: spec })).toMatchObject({ status: "unsupported" });
    const inconclusive = new InvariantProbeRegistry([{
      id: "timeout",
      requiredEvidence: [],
      evaluate: () => ({ status: "inconclusive", reason: "probe timeout" }),
    }]);
    expect(inconclusive.evaluate("timeout", { answerSpec: spec })).toEqual({ status: "inconclusive", reason: "probe timeout" });
  });
});
