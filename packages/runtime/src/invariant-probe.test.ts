import { describe, expect, it } from "vitest";
import { InvariantProbeRegistry, type InvariantProbe } from "./invariant-probe.js";

const spec = {
  taskId: "task-1", specVersion: "1", question: "q",
  hardConstraints: [{ id: "HC-1", statement: "one row", scope: "grain", provenance: { authority: "request_wording", source: "q" } }],
  hypotheses: [], ambiguities: [], provenance: [],
};

describe("InvariantProbeRegistry", () => {
  it("only gives a failed probe blocking authority when its evidence prerequisites are authoritative", () => {
    const probe: InvariantProbe = {
      id: "shape",
      requiredEvidence: [{ kind: "hard_constraint", id: "HC-1" }],
      evaluate: () => ({ status: "failed", evidence: { reason: "two rows" } }),
    };
    const registry = new InvariantProbeRegistry([probe]);
    expect(registry.evaluate("shape", { answerSpec: spec })).toMatchObject({ status: "failed", blocking: true });

    const missing = new InvariantProbeRegistry([{
      ...probe,
      requiredEvidence: [{ kind: "hard_constraint", id: "missing" }],
    }]);
    expect(missing.evaluate("shape", { answerSpec: spec })).toMatchObject({ status: "not_applicable" });
  });

  it("returns unsupported without guessing for an unapplicable probe", () => {
    const registry = new InvariantProbeRegistry([{
      id: "join",
      requiredEvidence: [{ kind: "schema", id: "fk-1" }],
      evaluate: () => ({ status: "failed", evidence: {} }),
    }]);
    expect(registry.evaluate("join", { answerSpec: spec })).toMatchObject({ status: "not_applicable" });
    expect(registry.evaluate("unknown", { answerSpec: spec })).toMatchObject({ status: "unsupported" });
  });
});
