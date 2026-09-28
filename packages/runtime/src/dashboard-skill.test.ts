import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { compileDashboardView, materializeDashboardV3Spec, validateDashboardV3Spec, type DashboardV3Spec } from "./dashboard-v3.js";
import { validateDashboardV4Spec } from "./dashboard-v4.js";
import type { WorkspaceStore } from "./workspace.js";

const SKILL_PATH = path.resolve(process.cwd(), "..", "..", ".agents", "skills", "dashboard", "SKILL.md");
const TAGS = ["dashboard-v3-spec", "dashboard-v3-view", "dashboard-v4-spec"] as const;
type Tag = (typeof TAGS)[number];

async function jsonExamples(): Promise<Array<{ tag: string; body: string; line: number }>> {
  const text = await readFile(SKILL_PATH, "utf8");
  const examples: Array<{ tag: string; body: string; line: number }> = [];
  const fence = /^```json([^\n]*)\n([\s\S]*?)^```/gm;
  for (let match = fence.exec(text); match; match = fence.exec(text)) {
    examples.push({ tag: match[1]!.trim(), body: match[2]!, line: text.slice(0, match.index).split("\n").length });
  }
  return examples;
}

// CSV sources resolve to empty files: validation checks spec structure, not data.
const emptyWorkspace = { read: async () => "" } as unknown as WorkspaceStore;

async function assertV3Spec(raw: unknown, where: string): Promise<void> {
  const validated = validateDashboardV3Spec(await materializeDashboardV3Spec(raw, emptyWorkspace));
  expect(validated.ok ? [] : validated.errors, where).toEqual([]);
  const spec = (validated as { spec: DashboardV3Spec }).spec;
  for (const view of spec.views) expect(() => compileDashboardView(view, spec.datasets), where).not.toThrow();
}

describe("dashboard Skill examples", () => {
  it("tags every JSON example with the contract it demonstrates", async () => {
    const examples = await jsonExamples();
    expect(examples.length).toBeGreaterThan(0);
    expect(examples.filter((example) => !TAGS.includes(example.tag as Tag)).map((example) => `line ${example.line}: "${example.tag}"`)).toEqual([]);
  });

  it("passes the generate_dashboard validators for every example", async () => {
    for (const example of await jsonExamples()) {
      const where = `SKILL.md line ${example.line} (${example.tag})`;
      const raw = JSON.parse(example.body) as Record<string, unknown>;
      if (example.tag === "dashboard-v3-spec") {
        await assertV3Spec(raw, where);
      } else if (example.tag === "dashboard-v3-view") {
        const dataset = typeof raw.dataset === "string" ? raw.dataset : "example";
        await assertV3Spec({ title: "example", datasets: [{ id: dataset, rows: [] }], views: [raw] }, where);
      } else {
        const validated = validateDashboardV4Spec(raw);
        expect(validated.ok ? [] : validated.errors, where).toEqual([]);
      }
    }
  });
});
