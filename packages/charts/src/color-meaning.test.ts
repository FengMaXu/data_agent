import { describe, expect, it } from "vitest";
import type { ChartSpec, DashboardKpiView, FieldMeta } from "@data-agent/contracts";
import { PALETTE, THEME, compileChart, datasetKey, exampleDataset, resolveKpiCards, validateDashboard, type ChartCompileResult } from "./index.js";

const data = { kind: "publication", receiptId: "publication_1" } as const;
const orders: FieldMeta = { type: "quantitative", storage: "raw", unit: "单", additivity: "additive" };
const share: FieldMeta = { type: "quantitative", storage: "percent", additivity: "non_additive", label: "占比" };
const change: FieldMeta = { type: "quantitative", storage: "ratio", additivity: "non_additive" };
const statuses = { columns: ["status", "orders"], rows: [["DELIVERED", 371367], ["CANCELLED", 7253], ["DELIVERING", 223]] };

const pie = (extra: Record<string, unknown> = {}) => ({ version: 1, data, fields: { orders }, chart: { mark: "pie", category: { field: "status" }, value: { field: "orders" }, ...extra } }) as ChartSpec;

function ok(result: ChartCompileResult) {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.errors)}`);
  return result;
}

describe("Colour meaning on a dashboard", () => {
  it("keeps the focus colour out of categorical colours when asked to", () => {
    expect(PALETTE).toContain(THEME.focus);
    const reserved = ok(compileChart(pie(), statuses, { target: "interactive", reserveFocus: true })).option.color as string[];
    expect(reserved).not.toContain(THEME.focus);
    expect(reserved[0]).toBe(PALETTE[0]);
    // Chat charts stand alone and keep the whole palette.
    expect(ok(compileChart(pie(), statuses, { target: "interactive" })).option.color).toEqual([...PALETTE]);
  });

  it("highlights pie slices like bars", () => {
    const { option } = ok(compileChart(pie({ highlight: { values: ["CANCELLED"], tone: "bad" } }), statuses, { target: "interactive" }));
    const slices = (option.series as { data: { name: string; itemStyle: { color: string } }[] }[])[0]!.data;
    expect(slices.map((slice) => [slice.name, slice.itemStyle.color])).toEqual([["DELIVERED", THEME.context], ["CANCELLED", THEME.bad], ["DELIVERING", THEME.context]]);
    const unknown = compileChart(pie({ highlight: { values: ["LOST"] } }), statuses, { target: "interactive" });
    expect(unknown.ok ? [] : unknown.errors.map((error) => error.code)).toEqual(["VALUE_OUT_OF_DOMAIN"]);
    const documented = pie({ highlight: { values: ["CANCELLED"] } });
    expect(compileChart(documented, exampleDataset(documented), { target: "interactive" }).ok).toBe(true);
  });

  it("colours a KPI change by whether a rise is good news, and leaves it uncoloured by default", () => {
    const view = (polarity?: "up_good" | "up_bad" | "neutral") => ({
      id: "k", type: "kpi", data, fields: { value: orders, change },
      cards: [{ value: { field: "value" }, delta: { field: "change", label: "环比", ...(polarity ? { polarity } : {}) } }],
    }) as DashboardKpiView;
    const rising = { columns: ["value", "change"], rows: [[120, 0.05]] };
    const falling = { columns: ["value", "change"], rows: [[120, -0.05]] };
    expect(resolveKpiCards(view(), rising)[0]!.delta).toEqual({ label: "环比", value: "+5.0%", direction: "up" });
    expect(resolveKpiCards(view("neutral"), rising)[0]!.delta!.tone).toBeUndefined();
    expect(resolveKpiCards(view("up_good"), rising)[0]!.delta!.tone).toBe("good");
    expect(resolveKpiCards(view("up_good"), falling)[0]!.delta!.tone).toBe("bad");
    expect(resolveKpiCards(view("up_bad"), rising)[0]!.delta!.tone).toBe("bad");
    expect(resolveKpiCards(view("up_bad"), falling)[0]!.delta!.tone).toBe("good");
  });

  it("shows a share as a plain second value, not as a change", () => {
    const view = { id: "k", type: "kpi", data, fields: { orders, share }, cards: [{ label: "已取消", value: { field: "orders" }, secondary: { field: "share", label: "占比" }, where: { status: "CANCELLED" } }] } as DashboardKpiView;
    const rows = { columns: ["status", "orders", "share"], rows: [["DELIVERED", 371367, "98.03"], ["CANCELLED", 7253, "1.91"]] };
    expect(resolveKpiCards(view, rows)[0]).toEqual({ label: "已取消", value: "7,253", unit: "单", fullValue: "7,253 单", secondary: { label: "占比", value: "1.9%" } });
    const missing = validateDashboard({ version: 1, title: "t", views: [{ ...view, cards: [{ ...view.cards[0], secondary: { field: "ratio" } }] }] }, { [datasetKey(data)]: rows });
    expect(missing.ok ? [] : missing.errors.map((error) => error.code)).toEqual(["FIELD_NOT_FOUND"]);
  });
});
