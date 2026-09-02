import { describe, expect, it } from "vitest";
import { buildResultEvidence } from "./result-evidence.js";

describe("ResultEvidence", () => {
  it("carries complete rows and numeric values when the result fits the budget", () => {
    const evidence = buildResultEvidence(
      ["customer_id", "revenue"],
      [["a", 10.5], ["b", 20]],
      false,
      { includeRows: true },
    );

    expect(evidence).toMatchObject({
      completeness: "complete",
      numericCompleteness: "complete",
      rowCount: 2,
      columns: ["customer_id", "revenue"],
      rows: [["a", 10.5], ["b", 20]],
      numericColumns: ["revenue"],
      numericRows: [[10.5], [20]],
    });
    expect(evidence.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("bounds numeric evidence by bytes as well as rows", () => {
    const evidence = buildResultEvidence(
      ["amount"],
      [["12345678901234567890"], ["22345678901234567890"]],
      false,
      { maxBytes: 10 },
    );

    expect(evidence.numericColumns).toEqual(["amount"]);
    expect(evidence.numericRows).toEqual([]);
    expect(evidence.numericCompleteness).toBe("partial");
  });

  it("never labels a truncated or oversized result as complete", () => {
    const evidence = buildResultEvidence(
      ["id", "amount"],
      [["a", 10], ["b", 20], ["c", 30]],
      false,
      { maxRows: 2, maxNumericRows: 2 },
      3,
    );

    expect(evidence.completeness).toBe("partial");
    expect(evidence.numericCompleteness).toBe("partial");
    expect(evidence.rowCount).toBe(3);
    expect(evidence.rows).toBeUndefined();
    expect(evidence.numericRows).toEqual([[10], [20]]);
  });
});
