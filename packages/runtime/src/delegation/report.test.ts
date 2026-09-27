import { describe, expect, it } from "vitest";
import { MAX_CHILD_REPORT_BYTES, parseChildReport } from "./report.js";

describe("subagent Markdown report", () => {
  it("accepts a Markdown document and strips one outer fence", () => {
    expect(parseChildReport("## 结论\n\norders.status 取值为 A/B")).toEqual({ markdown: "## 结论\n\norders.status 取值为 A/B", truncated: false });
    expect(parseChildReport("```markdown\n## 结论\n\n- x\n```")).toEqual({ markdown: "## 结论\n\n- x", truncated: false });
  });

  it("drops a conversational preamble before the first heading", () => {
    expect(parseChildReport("I have all the information needed. Let me write the final report.\n\n## 结论\n\nx").markdown).toBe("## 结论\n\nx");
    expect(parseChildReport("No headings, just an answer.").markdown).toBe("No headings, just an answer.");
  });

  it("rejects an empty report", () => {
    expect(() => parseChildReport("   ")).toThrow("SUBAGENT_REPORT_EMPTY");
  });

  it("truncates an oversized report instead of discarding it", () => {
    const report = parseChildReport(`## 数据取值\n\n${"值".repeat(MAX_CHILD_REPORT_BYTES)}`);
    expect(report.truncated).toBe(true);
    expect(Buffer.byteLength(report.markdown, "utf8")).toBeLessThan(MAX_CHILD_REPORT_BYTES + 128);
    expect(report.markdown).toContain("已截断");
  });
});
