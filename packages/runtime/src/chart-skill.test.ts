import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkChartSpec, type ChartSpec } from "@data-agent/contracts";
import { renderChartSvg } from "./chart-render.js";

const SKILLS = ["demo-report", "analysis"];
const repo = path.resolve(process.cwd(), "..", "..");

async function chartExamples(skill: string): Promise<{ body: string; line: number }[]> {
  // Normalise line endings: a Windows checkout may turn the file into CRLF.
  const text = (await readFile(path.join(repo, ".agents", "skills", skill, "SKILL.md"), "utf8")).replace(/\r\n/g, "\n");
  const fence = /^```json chart-spec\n([\s\S]*?)^```/gm;
  const examples: { body: string; line: number }[] = [];
  for (let match = fence.exec(text); match; match = fence.exec(text)) examples.push({ body: match[1]!, line: text.slice(0, match.index).split("\n").length });
  return examples;
}

/** Two sample rows whose columns are the fields the spec references: numbers for measures, text otherwise. */
function sampleRows(spec: ChartSpec) {
  const chart = spec.chart;
  const fields = chart.mark === "pie"
    ? [chart.category.field, chart.value.field]
    : [chart.x.field, ...chart.layers.flatMap((layer) => [layer.y.field, ...(layer.series ? [layer.series.field] : [])])];
  const columns = [...new Set(fields)];
  const measure = (field: string) => spec.fields?.[field]?.type === "quantitative";
  return { columns, rows: [0, 1].map((index) => columns.map((field) => (measure(field) ? index + 1 : `v${index}`))) };
}

describe("Chart examples in Skills", () => {
  for (const skill of SKILLS) {
    it(`${skill}: every chart-spec example passes the schema and renders`, async () => {
      const examples = await chartExamples(skill);
      expect(examples.length).toBeGreaterThan(0);
      for (const example of examples) {
        const where = `${skill}/SKILL.md line ${example.line}`;
        const checked = checkChartSpec(JSON.parse(example.body));
        expect(checked.ok ? [] : checked.errors, where).toEqual([]);
        const spec = (checked as { spec: ChartSpec }).spec;
        const rendered = renderChartSvg(spec, sampleRows(spec));
        expect(rendered.ok ? [] : rendered.errors, where).toEqual([]);
      }
    });
  }
});
