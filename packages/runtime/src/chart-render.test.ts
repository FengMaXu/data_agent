import { describe, expect, it } from "vitest";
import { SaxesParser } from "saxes";
import { STATIC_CHART_FONT_FAMILY, renderChartSvg } from "./chart-render.js";

/** Standalone .svg files are parsed as XML, which is stricter than an inline <svg> in HTML. */
function expectWellFormedXml(svg: string): void {
  expect(() => new SaxesParser().write(svg).close()).not.toThrow();
}

const spec = {
  version: 1,
  data: { kind: "publication", receiptId: "publication_1" },
  fields: { sales: { type: "quantitative", storage: "raw", unit: "元", magnitude: { stored: 1, shown: 1e8 }, additivity: "additive", label: "销售额" } },
  chart: { mark: "cartesian", x: { field: "industry" }, layers: [{ type: "bar", y: { field: "sales" } }] },
};
const dataset = { columns: ["industry", "sales"], rows: [["批发业", 523400000000], ["零售业", "49988000000.00"], ["住宿和餐饮业", null]] };

describe("Static chart rendering", () => {
  it("renders a standalone SVG with CJK labels, the declared unit and a white background", () => {
    const result = renderChartSvg(spec, dataset, { width: 640, height: 360 });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.svg.startsWith("<svg")).toBe(true);
    expect(result.svg).toContain('width="640"');
    for (const label of ["批发业", "零售业", "住宿和餐饮业", "销售额（亿元）"]) expect(result.svg).toContain(label);
    expect(result.svg).toMatch(/fill="#(?:ffffff|fff)"|fill="rgb\(255,\s*255,\s*255\)"/);
    expect(result.svg).toContain("Microsoft YaHei");
    expect(STATIC_CHART_FONT_FAMILY).toContain("sans-serif");
    expect(result.notices.map((notice) => notice.code)).toContain("NULL_VALUES");
    expectWellFormedXml(result.svg);
  });

  it("renames only generated ids, never label text that looks like one", () => {
    const lookalike = renderChartSvg(spec, { columns: ["industry", "sales"], rows: [["zr0-c0", 1], ["zr12-cls-3", 2]] });
    if (!lookalike.ok) throw new Error(JSON.stringify(lookalike.errors));
    expect(lookalike.svg).toContain(">zr0-c0<");
    expect(lookalike.svg).toContain(">zr12-cls-3<");
    expect(lookalike.svg).not.toMatch(/(?:id="|class="|url\(#)zr\d+-/);
  });

  it("stays well-formed XML when labels carry markup characters", () => {
    const markup = { ...spec, fields: { sales: { ...spec.fields.sales, label: "A&B <v> \"q\"" } } };
    const bar = renderChartSvg(markup, { columns: ["industry", "sales"], rows: [["R&D <部门> \"甲\" 'x'", 1], ["b]]>c", 2]] });
    if (!bar.ok) throw new Error(JSON.stringify(bar.errors));
    expectWellFormedXml(bar.svg);
    const pie = renderChartSvg({ ...markup, chart: { mark: "pie", category: { field: "industry" }, value: { field: "sales" } } }, { columns: ["industry", "sales"], rows: [["R&D <部门>", 1], ["b]]>c", 2]] });
    if (!pie.ok) throw new Error(JSON.stringify(pie.errors));
    expectWellFormedXml(pie.svg);
  });

  it("renders identically for identical input, with ids derived from content", () => {
    const first = renderChartSvg(spec, dataset);
    const second = renderChartSvg(spec, dataset);
    if (!first.ok || !second.ok) throw new Error("expected both renders to succeed");
    expect(second.svg).toBe(first.svg);
    expect(first.svg).not.toMatch(/zr\d+-/);
    const other = renderChartSvg(spec, { ...dataset, rows: dataset.rows.slice(0, 2) });
    const idPrefix = (svg: string) => /dac-[0-9a-f]{8}/.exec(svg)?.[0];
    expect(other.ok && idPrefix(other.svg)).not.toBe(idPrefix(first.svg));
  });

  it("returns compiler errors instead of drawing an altered chart", () => {
    const duplicated = { columns: ["industry", "sales"], rows: [["批发业", 1], ["批发业", 2]] };
    const result = renderChartSvg(spec, duplicated);
    expect(result.ok ? [] : result.errors.map((error) => error.code)).toEqual(["DUPLICATE_KEY"]);
  });
});
