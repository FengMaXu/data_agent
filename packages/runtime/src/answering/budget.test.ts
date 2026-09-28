import { describe, expect, it } from "vitest";
import { DEFAULT_QUERY_BUDGET_POLICY, budgetFailure, newBudget, validateBudgetPolicy } from "./budget.js";

describe("Query Task budget", () => {
  const startedAt = "2026-09-24T00:00:00.000Z";
  const at = Date.parse(startedAt) + 1_000;

  it("charges each attempt kind against its own limit and shares time and rows", () => {
    const budget = newBudget(DEFAULT_QUERY_BUDGET_POLICY, startedAt);
    expect(budgetFailure(budget, "exploration", at)).toBeUndefined();
    expect(budgetFailure({ ...budget, explorationAttempts: 16 }, "exploration", at)).toBe("exploration budget exhausted");
    expect(budgetFailure({ ...budget, explorationAttempts: 16 }, "result", at)).toBeUndefined();
    expect(budgetFailure({ ...budget, revisionCount: 8 }, "revision", at)).toBe("revision budget exhausted");
    expect(budgetFailure({ ...budget, resultAttempts: 8 }, "result", at)).toBe("result implementation budget exhausted");
    expect(budgetFailure({ ...budget, observedRows: 200_000 }, "revision", at)).toBe("observed-row budget exhausted");
    expect(budgetFailure(budget, "result", Date.parse(startedAt) + DEFAULT_QUERY_BUDGET_POLICY.maxElapsedMs)).toBe("task time budget exhausted");
  });

  it("rejects an unversioned or non-positive policy", () => {
    expect(() => validateBudgetPolicy({ ...DEFAULT_QUERY_BUDGET_POLICY, maxExplorationAttempts: 0 })).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
    expect(() => validateBudgetPolicy({ ...DEFAULT_QUERY_BUDGET_POLICY, version: "v0" as never })).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });
});
