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
