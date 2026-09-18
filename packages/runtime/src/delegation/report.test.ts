import { describe, expect, it } from "vitest";
import { parseChildReport } from "./report.js";

const valid = JSON.stringify({
  summary: "checked",
  findings: [{ statement: "Observed mismatch", evidenceRefs: ["revision:r1"] }],
  unchecked: [],
  questions: [],
});

describe("subagent report protocol", () => {
  it("accepts only bounded reports whose evidence references were authorized", () => {
    expect(parseChildReport(valid, new Set(["revision:r1"]))).toEqual({
      summary: "checked",
      findings: [{ statement: "Observed mismatch", evidenceRefs: ["revision:r1"] }],
      unchecked: [],
      questions: [],
    });
    expect(() => parseChildReport(valid, new Set())).toThrow("SUBAGENT_REPORT_EVIDENCE_REF_INVALID");
  });

  it("rejects malformed, extra-field and oversized output", () => {
    expect(() => parseChildReport("not-json", new Set())).toThrow("SUBAGENT_REPORT_INVALID_JSON");
    expect(() => parseChildReport(JSON.stringify({ summary: "x", findings: [], unchecked: [], questions: [], approved: true }), new Set())).toThrow("SUBAGENT_REPORT_INVALID_SHAPE");
    expect(() => parseChildReport(JSON.stringify({ summary: "x".repeat(9_000), findings: [], unchecked: [], questions: [] }), new Set())).toThrow("SUBAGENT_REPORT_TOO_LARGE_OR_EMPTY");
  });

  it("does not treat an empty finding list as approval", () => {
    const report = parseChildReport(JSON.stringify({ summary: "No mismatch found in supplied material", findings: [], unchecked: ["business intent"], questions: [] }), new Set());
    expect(report.unchecked).toEqual(["business intent"]);
    expect(report).not.toHaveProperty("approved");
  });
});
