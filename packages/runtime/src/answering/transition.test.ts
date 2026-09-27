import { describe, expect, it } from "vitest";
import { beginTransition, reviseTransition, type EvidenceResolver, type RevisionBody } from "./transition.js";
import { sealForResult, unresolvedChoices, unresolvedHypotheses, inferredFacets } from "./qualification.js";
import type { AnswerRevisionRecord, Evidence } from "./model.js";

const observedAt = "2026-09-24T00:00:00.000Z";
const verifiedRequest = { id: "evidence_request_quote", kind: "request_wording", authority: "request_wording", sourceRef: "message-1", quote: "按年度汇总订单金额", verification: { method: "user_message_quote", sourceContentHash: "hash" }, observedAt } as unknown as Evidence;
const requestHandle = { id: "request_handle", kind: "request_wording", authority: "request_wording", sourceRef: "message-1", observedAt } as unknown as Evidence;
const schemaFact = { id: "evidence_schema", kind: "schema_fact", authority: "schema", sourceRef: "schema:orders", quote: "orders.order_id is the primary key", observedAt } as unknown as Evidence;
const registered = [verifiedRequest, requestHandle, schemaFact];
const resolve: EvidenceResolver = (ref) => registered.find((item) => item.id === ref);

const spec = {
  entity: "orders",
  metric: { value: { kind: "sum", expression: "SUM(subtotal)" }, hypothesisId: "metric-column" },
  filters: [],
  groupBy: [{ value: "year" }],
  time: { state: "not_applicable" },
  ranking: { state: "not_applicable" },
  output: { rowMode: "grouped" },
};

/** Mirrors the Spider2 local141 shape: one unresolved hypothesis and one unresolved choice after begin. */
function local141Begin(): RevisionBody {
  return beginTransition({
    spec,
    hypotheses: [{ localId: "metric-column", kind: "business_semantics", statement: "subtotal is the sales amount", affects: ["metric"], basis: "column name", impact: "changes totals" }],
    choices: [{ localId: "quota-aggregation", affects: ["metric"], alternatives: [{ localId: "sum", statement: "SUM annual quota" }, { localId: "max", statement: "MAX annual quota" }] }],
  }, resolve);
}

function asRecord(body: RevisionBody): AnswerRevisionRecord {
  return { ...body, taskId: "task_1", revisionId: "revision_1", requestId: "r", state: { state: "draft", revisionId: "revision_1" }, createdAt: observedAt } as unknown as AnswerRevisionRecord;
}

describe("Runtime-owned Answer Spec transitions (ADR-0004)", () => {
  it("keeps unresolved items, their ids and the seal block when a revision omits them", () => {
    const first = local141Begin();
    const next = reviseTransition(first, { spec: { metric: { value: { kind: "sum", expression: "SUM(subtotal)" }, hypothesisId: first.hypotheses[0]!.id } } }, resolve);
    expect(next.hypotheses.map((item) => item.id)).toEqual(first.hypotheses.map((item) => item.id));
    expect(next.choices.map((item) => item.id)).toEqual(first.choices.map((item) => item.id));
    expect(unresolvedHypotheses(next.hypotheses, next.resolutions)).toHaveLength(1);
    expect(unresolvedChoices(next.choices, next.choiceResolutions)).toHaveLength(1);
    expect(sealForResult(asRecord(next)).ok).toBe(false);
  });

  it("carries omitted facets with their basis and replaces only patched keys", () => {
    const first = local141Begin();
    const next = reviseTransition(first, { spec: { groupBy: [{ value: "fiscal_year", evidenceIds: ["evidence_request_quote"] }] } }, resolve);
    expect(next.spec.metric).toEqual(first.spec.metric);
    expect(next.spec.entity).toEqual(first.spec.entity);
    expect(next.spec.groupBy).toEqual([{ state: "specified", value: { expression: "fiscal_year" }, basis: { kind: "evidence", evidenceIds: ["evidence_request_quote"] } }]);
  });

  it("labels a plain facet value as inference instead of request evidence", () => {
    const body = local141Begin();
    expect(body.spec.entity).toMatchObject({ state: "specified", basis: { kind: "inference" } });
    expect(inferredFacets(body.spec)).toEqual(expect.arrayContaining(["entity", "groupBy", "output"]));
    expect(inferredFacets(body.spec)).not.toContain("metric");
  });

  it("rejects a facet evidence basis that has no verified quote", () => {
    expect(() => beginTransition({ spec: { ...spec, entity: { value: "orders", evidenceIds: ["request_handle"] } }, hypotheses: [{ localId: "metric-column", kind: "business_semantics", statement: "s", affects: ["metric"], basis: "b", impact: "i" }] }, resolve))
      .toThrow(expect.objectContaining({ code: "EVIDENCE_REJECTED" }));
  });

  it("never lets the quote-less request handle prove a business hypothesis: the support stays unverified", () => {
    const first = local141Begin();
    const hypothesisId = first.hypotheses[0]!.id;
    const next = reviseTransition(first, { dispositions: [{ action: "support", hypothesisId, evidenceIds: ["request_handle"] }] }, resolve);
    expect(next.resolutions).toEqual([{ outcome: "provisional", hypothesisId, disclosureRequired: true, citedEvidenceIds: ["request_handle"] }]);
    expect(unresolvedHypotheses(next.hypotheses, next.resolutions)).toEqual([]);
  });

  it("derives whether a support is verified instead of rejecting wrong-kind evidence (ADR-0006 for Hypotheses)", () => {
    const first = local141Begin();
    const hypothesisId = first.hypotheses[0]!.id;
    // schema_fact cannot qualify business_semantics, and one qualifying citation is enough to verify.
    const unverified = reviseTransition(first, { dispositions: [{ action: "support", hypothesisId, evidenceIds: ["evidence_schema"] }] }, resolve);
    expect(unverified.resolutions[0]).toMatchObject({ outcome: "provisional", citedEvidenceIds: ["evidence_schema"] });
    const verified = reviseTransition(first, { dispositions: [{ action: "support", hypothesisId, evidenceIds: ["evidence_schema", "evidence_request_quote"] }] }, resolve);
    expect(verified.resolutions[0]).toMatchObject({ outcome: "supported" });
    // Unknown ids and refutations stay strict.
    expect(() => reviseTransition(first, { dispositions: [{ action: "support", hypothesisId, evidenceIds: ["missing"] }] }, resolve))
      .toThrow(expect.objectContaining({ code: "EVIDENCE_REJECTED" }));
    expect(() => reviseTransition(first, { dispositions: [{ action: "refute", hypothesisId, evidenceIds: ["evidence_schema"] }] }, resolve))
      .toThrow(expect.objectContaining({ code: "EVIDENCE_REJECTED", message: expect.stringContaining("it accepts user_confirmation, reviewed_definition, task_document, request_wording") }));
  });

  it("still rejects an unverified business support of the population when a clarification path exists", () => {
    const population = { localId: "population", kind: "business_semantics" as const, statement: "only completed orders count", affects: ["filters" as const], basis: "b", impact: "i", proposedEvidenceIds: ["evidence_schema"] };
    expect(() => beginTransition({ spec, hypotheses: [population, { localId: "metric-column", kind: "business_semantics", statement: "s", affects: ["metric"], basis: "b", impact: "i" }] }, resolve, { probes: [], populationDecisions: "require_evidence" }))
      .toThrow(expect.objectContaining({ code: "SPEC_TRANSITION_INVALID", message: expect.stringContaining("material population") }));
    const disclosed = beginTransition({ spec, hypotheses: [population, { localId: "metric-column", kind: "business_semantics", statement: "s", affects: ["metric"], basis: "b", impact: "i" }] }, resolve, { probes: [], populationDecisions: "allow_disclosed" });
    expect(disclosed.resolutions[0]).toMatchObject({ outcome: "provisional" });
    // Physical and data hypotheses about the population are not questions for the user.
    const physical = beginTransition({ spec, hypotheses: [{ ...population, kind: "physical_mapping", proposedEvidenceIds: ["evidence_request_quote"] }, { localId: "metric-column", kind: "business_semantics", statement: "s", affects: ["metric"], basis: "b", impact: "i" }] }, resolve, { probes: [], populationDecisions: "require_evidence" });
    expect(physical.resolutions[0]).toMatchObject({ outcome: "provisional" });
  });

  it("names what the call carried when a reference cannot be resolved", () => {
    const withLocals = Object.assign((ref: string) => resolve(ref), { localIds: ["q-year"] });
    expect(() => beginTransition({ spec: { ...spec, entity: { value: "orders", evidenceIds: ["def-ind51"] } } }, Object.assign((ref: string) => resolve(ref), { localIds: [] })))
      .toThrow(expect.objectContaining({ message: expect.stringContaining("carries no evidence localIds") }));
    expect(() => beginTransition({ spec: { ...spec, entity: { value: "orders", evidenceIds: ["def-ind51"] } } }, withLocals))
      .toThrow(expect.objectContaining({ message: expect.stringContaining("localIds are q-year") }));
    const first = local141Begin();
    expect(() => reviseTransition(first, { addHypotheses: [{ localId: "h-src", kind: "data_property", statement: "only 2026-06 in marts", affects: ["time"], basis: "b", impact: "i" }], dispositions: [{ action: "support", hypothesisId: "h-src", evidenceIds: ["evidence_schema"] }] }, resolve))
      .toThrow(expect.objectContaining({ message: expect.stringContaining("added in this same call") }));
  });

  it("resolves a hypothesis with verified request wording and carries the resolution forward", () => {
    const first = local141Begin();
    const supported = reviseTransition(first, { dispositions: [{ action: "support", hypothesisId: first.hypotheses[0]!.id, evidenceIds: ["evidence_request_quote"] }] }, resolve);
    expect(unresolvedHypotheses(supported.hypotheses, supported.resolutions)).toEqual([]);
    const later = reviseTransition(supported, { spec: { output: { rowMode: "grouped", columns: ["year", "amount"] } } }, resolve);
    expect(later.resolutions).toEqual(supported.resolutions);
    expect(() => reviseTransition(later, { dispositions: [{ action: "refute", hypothesisId: first.hypotheses[0]!.id, evidenceIds: ["evidence_request_quote"] }] }, resolve))
      .toThrow(expect.objectContaining({ code: "SPEC_TRANSITION_INVALID" }));
  });

  it("rejects business evidence of the wrong kind for a choice selection", () => {
    const first = local141Begin();
    const choice = first.choices[0]!;
    expect(() => reviseTransition(first, { dispositions: [{ action: "select", choiceId: choice.id, alternativeId: choice.alternatives[0].id, evidenceIds: ["evidence_schema"], rationale: "The request says quota per year, which excludes a single-row MAX alternative." }] }, resolve))
      .toThrow(expect.objectContaining({ code: "EVIDENCE_REJECTED" }));
    expect(() => reviseTransition(first, { dispositions: [{ action: "select", choiceId: choice.id, alternativeId: "not-an-alternative", evidenceIds: ["evidence_request_quote"], rationale: "The request says quota per year, which excludes a single-row MAX alternative." }] }, resolve))
      .toThrow(expect.objectContaining({ code: "SPEC_TRANSITION_INVALID" }));
    expect(() => reviseTransition(first, { dispositions: [{ action: "select", choiceId: choice.id, alternativeId: choice.alternatives[1].id, evidenceIds: ["evidence_request_quote"], rationale: "see quote" }] }, resolve))
      .toThrow(expect.objectContaining({ code: "SPEC_TRANSITION_INVALID", message: expect.stringContaining("rules out every other alternative") }));
    const selected = reviseTransition(first, { dispositions: [{ action: "select", choiceId: choice.id, alternativeId: choice.alternatives[1].id, evidenceIds: ["evidence_request_quote"], rationale: "The request says quota per year, which excludes a single-row MAX alternative." }] }, resolve);
    expect(selected.choiceResolutions).toEqual([expect.objectContaining({ outcome: "selected", choiceId: choice.id, alternativeId: choice.alternatives[1].id, rationale: expect.stringContaining("excludes") })]);
  });

  it("requires a selection rationale when a new Choice is created already selected", () => {
    const proposal = (selectionRationale?: string) => ({
      spec: { ...spec, metric: "count" },
      choices: [{ localId: "grain", affects: ["groupBy" as const], alternatives: [{ localId: "league", statement: "one champion per league and season" }, { localId: "season", statement: "one champion per season across leagues" }], selectedAlternativeId: "season", selectionEvidenceIds: ["evidence_request_quote"], ...(selectionRationale ? { selectionRationale } : {}) }],
    });
    expect(() => beginTransition(proposal(), resolve)).toThrow(expect.objectContaining({ code: "SPEC_TRANSITION_INVALID" }));
    const body = beginTransition(proposal("The request says across all countries and leagues, so per-league champions are excluded."), resolve);
    expect(body.choiceResolutions).toEqual([expect.objectContaining({ outcome: "selected", rationale: expect.stringContaining("across all countries") })]);
  });

  it("allows a disclosed provisional choice but not for the material population", () => {
    const first = beginTransition({
      spec: { ...spec, metric: "count" },
      choices: [
        { localId: "ties", affects: ["ranking"], alternatives: [{ localId: "strict", statement: "exactly N" }, { localId: "ties", statement: "include ties" }] },
        { localId: "population", affects: ["filters"], alternatives: [{ localId: "all", statement: "all orders" }, { localId: "done", statement: "completed orders" }] },
      ],
    }, resolve);
    const [ties, population] = first.choices;
    const provisional = reviseTransition(first, { dispositions: [{ action: "provisional", choiceId: ties!.id, alternativeId: ties!.alternatives[0].id }] }, resolve);
    expect(provisional.choiceResolutions).toEqual([expect.objectContaining({ outcome: "provisional", disclosureRequired: true })]);
    expect(() => reviseTransition(first, { dispositions: [{ action: "provisional", choiceId: population!.id, alternativeId: population!.alternatives[0].id }] }, resolve))
      .toThrow(expect.objectContaining({ code: "SPEC_TRANSITION_INVALID" }));
  });

  it("removes an item only by supersession whose replacements cover every affected facet", () => {
    const first = local141Begin();
    const choice = first.choices[0]!;
    expect(() => reviseTransition(first, {
      addHypotheses: [{ localId: "time-only", kind: "business_semantics", statement: "fiscal year starts in July", affects: ["time"], basis: "b", impact: "i" }],
      dispositions: [{ action: "supersede", targetId: choice.id, replacementIds: ["time-only"], reason: "reframed" }],
    }, resolve)).toThrow(expect.objectContaining({ code: "SPEC_TRANSITION_INVALID" }));

    const next = reviseTransition(first, {
      addChoices: [{ localId: "quota-source", affects: ["metric"], alternatives: [{ localId: "annual", statement: "annual quota table" }, { localId: "monthly", statement: "sum of monthly quotas" }] }],
      dispositions: [{ action: "supersede", targetId: choice.id, replacementIds: ["quota-source"], reason: "the real ambiguity is the quota source" }],
    }, resolve);
    expect(next.choices.map((item) => item.id)).not.toContain(choice.id);
    expect(next.supersessions).toEqual([{ targetId: choice.id, replacementIds: [next.choices[0]!.id], reason: "the real ambiguity is the quota source" }]);
    expect(unresolvedChoices(next.choices, next.choiceResolutions)).toEqual([next.choices[0]!.id]);
  });

  it("requires facets that depend on a refuted or superseded hypothesis to change in the same revision", () => {
    const first = local141Begin();
    const hypothesis = first.hypotheses[0]!;
    expect(() => reviseTransition(first, { dispositions: [{ action: "refute", hypothesisId: hypothesis.id, evidenceIds: ["evidence_request_quote"] }] }, resolve))
      .toThrow(expect.objectContaining({ code: "SPEC_TRANSITION_INVALID" }));
    const refuted = reviseTransition(first, {
      spec: { metric: { value: { kind: "sum", expression: "SUM(totaldue)" }, evidenceIds: ["evidence_request_quote"] } },
      dispositions: [{ action: "refute", hypothesisId: hypothesis.id, evidenceIds: ["evidence_request_quote"] }],
    }, resolve);
    expect(refuted.resolutions).toEqual([expect.objectContaining({ outcome: "refuted", hypothesisId: hypothesis.id })]);

    expect(() => reviseTransition(first, {
      addHypotheses: [{ localId: "total-due", kind: "business_semantics", statement: "totaldue is the sales amount", affects: ["metric"], basis: "b", impact: "i" }],
      dispositions: [{ action: "supersede", targetId: hypothesis.id, replacementIds: ["total-due"], reason: "column reconsidered" }],
    }, resolve)).toThrow(expect.objectContaining({ code: "SPEC_TRANSITION_INVALID" }));
  });

  it("rejects resubmitting an existing item and double disposition of one target", () => {
    const first = local141Begin();
    expect(() => reviseTransition(first, {
      addHypotheses: [{ localId: "again", kind: "business_semantics", statement: "  Subtotal is the SALES amount ", affects: ["metric"], basis: "b", impact: "i" }],
    }, resolve)).toThrow(expect.objectContaining({ code: "SPEC_TRANSITION_INVALID", message: expect.stringContaining(first.hypotheses[0]!.id) }));
    expect(() => reviseTransition(first, {
      addChoices: [{ localId: "again", affects: ["metric"], alternatives: [{ localId: "a", statement: "MAX annual quota" }, { localId: "b", statement: "sum annual quota" }] }],
    }, resolve)).toThrow(expect.objectContaining({ code: "SPEC_TRANSITION_INVALID" }));
    const choice = first.choices[0]!;
    expect(() => reviseTransition(first, {
      dispositions: [
        { action: "provisional", choiceId: choice.id, alternativeId: choice.alternatives[0].id },
        { action: "provisional", choiceId: choice.id, alternativeId: choice.alternatives[1].id },
      ],
    }, resolve)).toThrow(expect.objectContaining({ code: "SPEC_TRANSITION_INVALID" }));
  });

  it("does not resolve evidence by sourceRef", () => {
    const first = local141Begin();
    expect(() => reviseTransition(first, { dispositions: [{ action: "support", hypothesisId: first.hypotheses[0]!.id, evidenceIds: ["message-1"] }] }, resolve))
      .toThrow(expect.objectContaining({ code: "EVIDENCE_REJECTED" }));
  });
});
