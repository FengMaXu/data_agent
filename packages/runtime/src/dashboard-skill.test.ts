import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { datasetKey, exampleDataset, validateDashboard, type ChartDataset } from "@data-agent/charts";
import type { DashboardView, FieldMeta } from "@data-agent/contracts";

const SKILL_PATH = path.resolve(process.cwd(), "..", "..", ".agents", "skills", "dashboard", "SKILL.md");
const TAGS = ["dashboard-spec", "dashboard-view"] as const;
type Tag = (typeof TAGS)[number];

async function jsonExamples(): Promise<Array<{ tag: string; body: string; line: number }>> {
  // Normalise line endings: a Windows checkout may turn the file into CRLF.
  const text = (await readFile(SKILL_PATH, "utf8")).replace(/\r\n/g, "\n");
  const examples: Array<{ tag: string; body: string; line: number }> = [];
  const fence = /^```json([^\n]*)\n([\s\S]*?)^```/gm;
  for (let match = fence.exec(text); match; match = fence.exec(text)) {
    examples.push({ tag: match[1]!.trim(), body: match[2]!, line: text.slice(0, match.index).split("\n").length });
  }
  return examples;
}

/** Sample rows for a view: the chart registry's example for charts, otherwise one or two rows holding every column the view reads. */
function sampleDataset(view: DashboardView): ChartDataset {
  if (view.type === "chart") return exampleDataset(view.chart);
  const fields: Record<string, FieldMeta> = view.fields ?? {};
  const referenced = view.type === "table" ? (view.columns ?? []).map((column) => column.field)
    : view.cards.flatMap((card) => [card.value.field, ...(card.delta ? [card.delta.field] : []), ...Object.keys(card.where ?? {})]);
  const columns = [...new Set([...referenced, ...Object.keys(fields)])];
  const cell = (column: string, index: number) => (fields[column]?.type === "quantitative" ? index + 1 : `v${index}`);
  if (view.type === "kpi") {
    // One row per card, carrying the values its where selects.
    return { columns, rows: view.cards.map((card, index) => columns.map((column) => (card.where && column in card.where ? card.where[column] : cell(column, index)))) };
  }
  return { columns, rows: [0, 1].map((index) => columns.map((column) => cell(column, index))) };
}

function assertDashboard(raw: { views: DashboardView[] } & Record<string, unknown>, where: string, layoutClean = false): void {
  // Give each view its own sample result.
  const views = raw.views.map((view, index) => {
    const data = { kind: "publication", receiptId: `example_${index}` } as const;
    return view.type === "chart" ? { ...view, chart: { ...view.chart, data } } : { ...view, data };
  });
  const datasets = Object.fromEntries(views.map((view) => [datasetKey(view.type === "chart" ? view.chart.data : view.data), sampleDataset(view as DashboardView)]));
  const validated = validateDashboard({ ...raw, views }, datasets);
  expect(validated.ok ? [] : validated.errors, where).toEqual([]);
  // A whole-dashboard example is what the model copies, so it must already read as a BI page.
  if (layoutClean && validated.ok) expect(validated.advice.map((advice) => advice.message), where).toEqual([]);
}

describe("dashboard Skill examples", () => {
  it("tags every JSON example with the contract it demonstrates", async () => {
    const examples = await jsonExamples();
    expect(examples.length).toBeGreaterThan(0);
    expect(examples.filter((example) => !TAGS.includes(example.tag as Tag)).map((example) => `line ${example.line}: "${example.tag}"`)).toEqual([]);
  });

  it("passes the generate_dashboard validator for every example", async () => {
    for (const example of await jsonExamples()) {
      const where = `SKILL.md line ${example.line} (${example.tag})`;
      const raw = JSON.parse(example.body) as Record<string, unknown>;
      if (example.tag === "dashboard-spec") assertDashboard(raw as { views: DashboardView[] }, where, true);
      else assertDashboard({ version: 1, title: "example", views: [raw as unknown as DashboardView] }, where);
    }
  });
});
