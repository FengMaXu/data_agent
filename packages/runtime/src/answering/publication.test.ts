import { describe, expect, it } from "vitest";
import { composeDisclosure } from "./publication.js";
import type { AnswerRevisionRecord, ResultCandidateRecord } from "./model.js";

const evidenceBasis = { kind: "evidence", evidenceIds: ["evidence_q"] } as const;
const spec = {
  entity: { state: "specified", value: { name: "orders" }, basis: evidenceBasis },
  metric: { state: "specified", value: { kind: "count" }, basis: evidenceBasis },
  filters: [],
  groupBy: [],
  time: { state: "not_applicable" },
  ranking: { state: "not_applicable" },
  output: { state: "specified", value: { rowMode: "scalar" }, basis: evidenceBasis },
};

function revision(overrides: Partial<AnswerRevisionRecord> = {}): AnswerRevisionRecord {
  return { taskId: "task_1", revisionId: "revision_1", requestId: "r", spec, hypotheses: [], choices: [], resolutions: [], choiceResolutions: [], state: { state: "draft", revisionId: "revision_1" }, createdAt: "t", ...overrides } as unknown as AnswerRevisionRecord;
}

function candidate(overrides: Partial<ResultCandidateRecord> = {}): ResultCandidateRecord {
  return { candidateId: "candidate_1", coverage: [], findings: [], ...overrides } as unknown as ResultCandidateRecord;
}

describe("Publication disclosure", () => {
  it("discloses nothing when every facet has evidence and nothing is provisional", () => {
    expect(composeDisclosure(revision(), candidate())).toBeUndefined();
  });

  it("discloses provisional choices, inferred facets and fanout findings together", () => {
    const disclosure = composeDisclosure(
      revision({
        spec: { ...spec, metric: { state: "specified", value: { kind: "count" }, basis: { kind: "inference" } } } as never,
        choiceResolutions: [{ outcome: "provisional", choiceId: "choice_1", alternativeId: "alternative_1", disclosureRequired: true }] as never,
      }),
      candidate({ fanout: { ruleVersion: "answering-fanout-v1", status: "finding", snapshotScope: "result_snapshot", targets: [] } }),
    );
    expect(disclosure).toMatchObject({ required: true, provisionalChoiceIds: ["choice_1"], inferredFacets: ["metric"], fanoutStatus: "finding" });
    expect(disclosure?.summary).toContain("字面解释");
    expect(disclosure?.summary).toContain("metric");
    expect(disclosure?.summary).toContain("JOIN fanout");
  });

  it("discloses hypotheses supported without qualifying evidence with the facets they affect", () => {
    const disclosure = composeDisclosure(
      revision({
        hypotheses: [{ id: "hypothesis_1", kind: "data_property", statement: "amounts are in 亿元", affects: ["metric"], basis: "b", impact: "i" }] as never,
        resolutions: [{ outcome: "provisional", hypothesisId: "hypothesis_1", disclosureRequired: true, citedEvidenceIds: ["evidence_def"] }] as never,
      }),
      candidate(),
    );
    expect(disclosure).toMatchObject({ required: true, provisionalChoiceIds: [], provisionalHypothesisIds: ["hypothesis_1"] });
    expect(disclosure?.summary).toContain("未被合格证据证实的假设：metric");
  });
});
