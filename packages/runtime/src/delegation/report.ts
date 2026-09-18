import type { ChildReport } from "./index.js";

const MAX_REPORT_BYTES = 8 * 1024;
const MAX_SUMMARY_BYTES = 2 * 1024;
const MAX_ITEMS = 16;
const MAX_ITEM_BYTES = 1024;

function bytes(value: string): number { return Buffer.byteLength(value, "utf8"); }

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const expected = [...allowed].sort();
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function stringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return undefined;
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || bytes(item) > MAX_ITEM_BYTES) return undefined;
    items.push(item);
  }
  return items;
}

function stripFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

export function parseChildReport(text: string, allowedEvidenceRefs: ReadonlySet<string>): ChildReport {
  if (!text.trim() || bytes(text) > MAX_REPORT_BYTES) throw new Error("SUBAGENT_REPORT_TOO_LARGE_OR_EMPTY");
  let parsed: unknown;
  try { parsed = JSON.parse(stripFence(text)); }
  catch { throw new Error("SUBAGENT_REPORT_INVALID_JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("SUBAGENT_REPORT_INVALID_SHAPE");
  const record = parsed as Record<string, unknown>;
  if (!exactKeys(record, ["summary", "findings", "unchecked", "questions"])) throw new Error("SUBAGENT_REPORT_INVALID_SHAPE");
  if (typeof record.summary !== "string" || !record.summary.trim() || bytes(record.summary) > MAX_SUMMARY_BYTES) throw new Error("SUBAGENT_REPORT_INVALID_SHAPE");
  const unchecked = stringList(record.unchecked);
  const questions = stringList(record.questions);
  if (!unchecked || !questions || !Array.isArray(record.findings) || record.findings.length > MAX_ITEMS) throw new Error("SUBAGENT_REPORT_INVALID_SHAPE");
  const findings = record.findings.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("SUBAGENT_REPORT_INVALID_SHAPE");
    const finding = item as Record<string, unknown>;
    if (!exactKeys(finding, ["statement", "evidenceRefs"]) || typeof finding.statement !== "string" || !finding.statement.trim() || bytes(finding.statement) > MAX_ITEM_BYTES) throw new Error("SUBAGENT_REPORT_INVALID_SHAPE");
    const evidenceRefs = stringList(finding.evidenceRefs);
    if (!evidenceRefs) throw new Error("SUBAGENT_REPORT_INVALID_SHAPE");
    if (evidenceRefs.some((ref) => !allowedEvidenceRefs.has(ref))) throw new Error("SUBAGENT_REPORT_EVIDENCE_REF_INVALID");
    return { statement: finding.statement, evidenceRefs: [...new Set(evidenceRefs)] };
  });
  if (findings.length === 0 && unchecked.length === 0) throw new Error("SUBAGENT_REPORT_COVERAGE_REQUIRED");
  return { summary: record.summary, findings, unchecked, questions };
}
