import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { datasetKey, validateDashboard, type ChartDataset } from "@data-agent/charts";
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

/** Sample rows holding every column a view references: numbers for declared measures, text otherwise. */
function sampleDataset(view: DashboardView): ChartDataset {
  const fields: Record<string, FieldMeta> = (view.type === "chart" ? view.chart.fields : view.fields) ?? {};
  const referenced = view.type === "chart"
    ? (view.chart.chart.mark === "pie" ? [view.chart.chart.category.field, view.chart.chart.value.field]
      : view.chart.chart.mark === "heatmap" ? [view.chart.chart.x.field, view.chart.chart.y.field, view.chart.chart.color.field]
        : view.chart.chart.mark === "histogram" ? [view.chart.chart.start.field, view.chart.chart.end.field, view.chart.chart.value.field]
          : view.chart.chart.mark === "waterfall" ? [view.chart.chart.step.field, view.chart.chart.start.field, view.chart.chart.end.field, ...(view.chart.chart.total ? [view.chart.chart.total.field] : [])]
          : view.chart.chart.mark === "boxplot" ? [view.chart.chart.category.field, view.chart.chart.min.field, view.chart.chart.q1.field, view.chart.chart.median.field, view.chart.chart.q3.field, view.chart.chart.max.field]
        : [view.chart.chart.x.field, ...view.chart.chart.layers.flatMap((layer) => [layer.y.field, ...(layer.series ? [layer.series.field] : [])])])
    : view.type === "table" ? (view.columns ?? []).map((column) => column.field)
      : view.cards.flatMap((card) => [card.value.field, ...(card.delta ? [card.delta.field] : []), ...Object.keys(card.where ?? {})]);
  const columns = [...new Set([...referenced, ...Object.keys(fields)])];
  const cell = (column: string, index: number) => (fields[column]?.type === "quantitative" ? index + 1 : `v${index}`);
  // Marks whose rows must be ordered: bins that do not overlap, statistics in order.
  if (view.type === "chart" && view.chart.chart.mark === "histogram") {
    const bins = view.chart.chart;
    const order = [bins.start.field, bins.end.field, bins.value.field];
    return { columns, rows: [[0, 10, 3], [10, 20, 5]].map((row) => columns.map((column) => row[order.indexOf(column)])) };
  }
  if (view.type === "chart" && view.chart.chart.mark === "boxplot") {
    const box = view.chart.chart;
    const order = [box.category.field, box.min.field, box.q1.field, box.median.field, box.q3.field, box.max.field];
    return { columns, rows: [["v0", 1, 2, 3, 4, 5], ["v1", 2, 3, 4, 5, 6]].map((row) => columns.map((column) => row[order.indexOf(column)])) };
  }
  if (view.type === "chart" && view.chart.chart.mark === "waterfall") {
    const flow = view.chart.chart;
    const order = [flow.step.field, flow.start.field, flow.end.field, flow.total?.field];
    return { columns, rows: [["v0", 0, 100, true], ["v1", 100, 130, false], ["v2", 0, 130, true]].map((row) => columns.map((column) => row[order.indexOf(column)])) };
  }
  if (view.type === "kpi") {
    // One row per card, carrying the values its where selects.
    return { columns, rows: view.cards.map((card, index) => columns.map((column) => (card.where && column in card.where ? card.where[column] : cell(column, index)))) };
  }
  return { columns, rows: [0, 1].map((index) => columns.map((column) => cell(column, index))) };
}

function assertDashboard(raw: { views: DashboardView[] } & Record<string, unknown>, where: string): void {
  // Give each view its own sample result.
  const views = raw.views.map((view, index) => {
    const data = { kind: "publication", receiptId: `example_${index}` } as const;
    return view.type === "chart" ? { ...view, chart: { ...view.chart, data } } : { ...view, data };
  });
  const datasets = Object.fromEntries(views.map((view) => [datasetKey(view.type === "chart" ? view.chart.data : view.data), sampleDataset(view as DashboardView)]));
  const validated = validateDashboard({ ...raw, views }, datasets);
  expect(validated.ok ? [] : validated.errors, where).toEqual([]);
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
      if (example.tag === "dashboard-spec") assertDashboard(raw as { views: DashboardView[] }, where);
      else assertDashboard({ version: 1, title: "example", views: [raw as unknown as DashboardView] }, where);
    }
  });
});
