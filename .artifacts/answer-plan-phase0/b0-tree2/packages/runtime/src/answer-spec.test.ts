import { describe, expect, it } from "vitest";
import {
  EVIDENCE_AUTHORITY_ORDER,
  createAnswerSpec,
  createSpecAuthority,
  type SpecChangeProposal,
} from "./answer-spec.js";

describe("Answer Spec Authority", () => {
  it("keeps authoritative evidence ordered and only admits eligible Hard Constraints", () => {
    const spec = createAnswerSpec({
      taskId: "task-1",
      question: "List customer names",
      constraints: [
        { statement: "Only active customers", authority: "user_clarification", scope: "population" },
        { statement: "Use customer_name as the display field", authority: "model_inference", scope: "projection" },
        { statement: "customer_id is unique", authority: "schema_structure", scope: "grain", structural: true },
      ],
      hypotheses: [
        { statement: "Customers with no orders are included", confidence: 0.61, scope: "population" },
      ],
    });

    expect(EVIDENCE_AUTHORITY_ORDER).toEqual([
      "user_clarification",
      "reviewed_semantic_model",
      "task_document",
      "request_wording",
      "schema_structure",
      "observed_data",
      "model_inference",
    ]);
    expect(spec.hardConstraints.map((item) => item.statement)).toEqual([
      "Only active customers",
      "customer_id is unique",
    ]);
    expect(spec.hypotheses.map((item) => item.statement)).toContain("Use customer_name as the display field");
    expect(spec.hypotheses.map((item) => item.statement)).toContain("Customers with no orders are included");
  });

  it("normalizes legacy string hypotheses and ambiguities at the authority boundary", () => {
    const spec = createAnswerSpec({
      taskId: "task-legacy-planner",
      question: "Calculate the requested metric",
      hypotheses: ["The reference date is the latest purchase date"] as any,
      ambiguities: ["The segment thresholds are not specified"] as any,
    });

    expect(spec.hypotheses[0]).toMatchObject({
      statement: "The reference date is the latest purchase date",
      scope: "task",
      provenance: { authority: "model_inference", source: "planner:hypotheses" },
    });
    expect(spec.ambiguities[0]).toMatchObject({
      question: "The segment thresholds are not specified",
      alternatives: [],
      scope: "task",
      provenance: { authority: "model_inference", source: "planner:ambiguities" },
    });
  });

  it("retains source conflicts as a separate record instead of silently selecting one", () => {
    const spec = createAnswerSpec({
      taskId: "task-conflict",
      question: "Which population?",
      conflicts: [{
        conflictId: "conflict-1",
        scope: "population",
        evidenceRefs: [{ authority: "task_document", source: "business.md", evidenceId: "doc-1" }, { authority: "request_wording", source: "question", evidenceId: "question-1" }],
        authorityLevels: ["task_document", "request_wording"],
        conflictKind: "population_definition",
        resolution: "unresolved",
        status: "open",
      }],
    });
    expect(spec.conflicts).toMatchObject([{ conflictId: "conflict-1", resolution: "unresolved", status: "open" }]);
  });

  it("resolves a conflict into a new spec version and records user clarification", () => {
    const authority = createSpecAuthority();
    const initial = authority.prepare({
      taskId: "task-conflict-resolution",
      question: "Which population?",
      conflicts: [{
        conflictId: "conflict-1",
        scope: "population",
        evidenceRefs: [{ authority: "task_document", source: "business.md" }, { authority: "request_wording", source: "question" }],
        authorityLevels: ["task_document", "request_wording"],
        conflictKind: "population_definition",
        resolution: "unresolved",
        status: "open",
      }],
    });
    const resolved = authority.resolveConflict(initial.taskId, initial.specVersion, {
      conflictId: "conflict-1",
      resolution: "user_clarification",
      clarification: "Use the population stated by the user",
    });
    expect(resolved.specVersion).toBe("2");
    expect(resolved.conflicts?.[0]).toMatchObject({ status: "resolved", resolution: "user_clarification" });
    expect(resolved.hardConstraints.at(-1)?.provenance.authority).toBe("user_clarification");
    expect(initial.conflicts?.[0].status).toBe("open");
  });

  it("normalizes output, grain, measure, and denominator into typed contract facets", () => {
    const spec = createAnswerSpec({
      taskId: "task-contract",
      question: "What is the average payment count per customer?",
      answerContract: {
        output: { value: { columns: ["customer_id", "average_payments"], rowMode: "grouped" }, authority: "request_wording", source: "question" },
        grain: { value: { entity: "customer", keyColumns: ["customer_id"] }, authority: "request_wording", source: "question" },
        measures: [{ value: { kind: "avg", name: "average_payments", expression: "payment_count" }, authority: "task_document", source: "business.md" }],
        denominator: { value: { expression: "COUNT(DISTINCT customer_id)", population: "all customers", zeroPolicy: "null" }, authority: "task_document", source: "business.md" },
      },
    });

    expect(spec.answerContract.output).toMatchObject({ binding: "hard", value: { columns: ["customer_id", "average_payments"], rowMode: "grouped" } });
    expect(spec.answerContract.grain).toMatchObject({ value: { entity: "customer", keyColumns: ["customer_id"] } });
    expect(spec.answerContract.measures?.[0]).toMatchObject({ value: { kind: "avg" }, binding: "hard" });
    expect(spec.answerContract.denominator).toMatchObject({ value: { population: "all customers", zeroPolicy: "null" } });
  });

  it("only promotes planner-extracted wording when it carries an exact quote", () => {
    const grounded = createAnswerSpec({
      taskId: "task-grounded",
      question: "Return exactly the customer_id column",
      answerContract: {
        output: { value: { columns: ["customer_id"] }, authority: "request_wording", source: "planner:output", quote: "customer_id" },
      },
    });
    const ungrounded = createAnswerSpec({
      taskId: "task-ungrounded",
      question: "Return the customer column",
      answerContract: {
        output: { value: { columns: ["customer_id"] }, authority: "request_wording", source: "planner:output", quote: "revenue" },
      },
    });
    expect(grounded.answerContract.output?.binding).toBe("hard");
    expect(ungrounded.answerContract.output?.binding).toBe("hypothesis");
  });

  it("keeps model-inferred structured facets as hypotheses rather than blockers", () => {
    const spec = createAnswerSpec({
      taskId: "task-soft-contract",
      question: "Revenue by customer",
      answerContract: {
        grain: { value: { keyColumns: ["customer_id"] }, authority: "model_inference", source: "planner" },
        denominator: { value: { expression: "COUNT(*)" }, authority: "observed_data", source: "query" },
      },
    });

    expect(spec.answerContract.grain?.binding).toBe("hypothesis");
    expect(spec.answerContract.denominator?.binding).toBe("hypothesis");
  });

  it("versions user clarifications without mutating the previous spec", () => {
    const authority = createSpecAuthority();
    const initial = authority.prepare({ taskId: "task-1", question: "Revenue by month" });
    const next = authority.applyClarification(initial.taskId, initial.specVersion, "Include refunds in revenue");

    expect(initial.specVersion).toBe("1");
    expect(next.specVersion).toBe("2");
    expect(initial.hardConstraints).toHaveLength(0);
    expect(next.hardConstraints.at(-1)?.statement).toBe("Include refunds in revenue");
    expect(authority.get("task-1", "1")).toEqual(initial);
  });

  it("admits a Solver proposal only after a trusted evidence reference is resolved", () => {
    const evidence = { evidenceId: "doc-1", authority: "task_document" as const, source: "business.md", contentHash: "hash-1" };
    const authority = createSpecAuthority({ evidenceStore: { get: (id) => id === "doc-1" ? evidence : undefined } });
    const initial = authority.prepare({ taskId: "task-1", question: "Top customers" });
    const accepted = authority.submitProposal({
      taskId: "task-1",
      baseSpecVersion: initial.specVersion,
      statement: "Use the documented customer population",
      authority: "model_inference",
      scope: "population",
      evidence: [evidence],
    });

    expect(accepted).toMatchObject({ accepted: true, spec: { specVersion: "2", hardConstraints: [{ statement: "Use the documented customer population" }] } });
    expect(authority.get("task-1", "1")).toEqual(initial);
  });

  it("records Solver proposals without letting them mutate the Answer Spec", () => {
    const authority = createSpecAuthority();
    const initial = authority.prepare({ taskId: "task-1", question: "Top customers" });
    const proposal: SpecChangeProposal = {
      taskId: "task-1",
      baseSpecVersion: initial.specVersion,
      statement: "Use the order table as the authoritative population",
      authority: "model_inference",
      scope: "population",
    };

    expect(authority.submitProposal(proposal)).toMatchObject({ accepted: false, proposal });
    expect(authority.get("task-1", initial.specVersion)).toEqual(initial);
  });
});
