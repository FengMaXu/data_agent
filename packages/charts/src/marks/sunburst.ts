import { type SunburstChart } from "@data-agent/contracts";
import type { ChartOption } from "../types.js";
import { PALETTE, fieldTitle, formatValue } from "../semantics.js";
import { LABEL_CHAR_PX, CompileContext } from "./shared.js";
import { leafTree, type TreeNode } from "./treemap.js";
import type { MarkDefinition } from "./types.js";

const MAX_STATIC_SUNBURST_LEAVES = 40;
/** A slice below this share of the whole usually cannot show its name. */
const SMALL_SLICE_SHARE = 0.03;

function compileSunburst(context: CompileContext, chart: SunburstChart): ChartOption | undefined {
  const tree = leafTree(context, chart, "旭日图", MAX_STATIC_SUNBURST_LEAVES);
  if (!tree) return undefined;
  const { root, value, depth } = tree;
  if (depth > 1) context.notice({ kind: "layout", code: "VISUAL_SUM", message: "内环扇区的角度为其外层叶子之和", field: value.field });
  const small = tree.smallLeaves(SMALL_SLICE_SHARE);
  if (context.options.target === "static" && small > 0) {
    context.notice({ kind: "layout", code: "SMALL_TILES", message: `${small} 个扇区过小，名称可能无法显示，完整数据见数据集`, field: value.field });
  }
  const format = (shown: number) => formatValue(shown, value.meta);
  // A radial label runs along its ring: it may be as long as the ring is wide.
  const ringPx = (Math.min(context.width, context.height) / 2) * ((88 - 12) / 100) / depth;
  const labelChars = Math.max(2, Math.floor((ringPx - 8) / LABEL_CHAR_PX));
  const names: string[] = [];
  const collect = (nodes: readonly TreeNode[]): void => nodes.forEach((node) => { names.push(node.name); collect(node.children ?? []); });
  collect(root.children ?? []);
  if (names.some((name) => name.length > labelChars)) {
    context.notice({ kind: "layout", code: "LABELS_TRUNCATED", message: "过长的名称在环内截断显示，完整名称见提示框或数据集", field: value.field });
  }
  // Rings from the centre out, one per path level.
  const inner = 12;
  const band = (88 - inner) / depth;
  return {
    color: [...PALETTE],
    ...(context.options.target === "static" ? { animation: false } : {}),
    tooltip: { formatter: (params: { treePathInfo: { name: string }[]; value: number }) => `${params.treePathInfo.slice(1).map((item) => item.name).join(" / ")}：${format(params.value)}` },
    series: [{
      type: "sunburst",
      name: fieldTitle(value.field, value.meta),
      data: root.children,
      radius: [`${inner}%`, "88%"],
      nodeClick: context.options.target === "interactive" && depth > 1 ? "rootToNode" : false,
      emphasis: { focus: "ancestor" },
      itemStyle: { borderColor: "#ffffff", borderWidth: 1 },
      label: { rotate: "radial", overflow: "truncate", width: ringPx - 8, minAngle: 8 },
      levels: [{}, ...Array.from({ length: depth }, (_level, index) => ({ r0: `${inner + band * index}%`, r: `${inner + band * (index + 1)}%` }))],
    }],
  };
}

export const sunburstMark: MarkDefinition<SunburstChart> = {
  compile: compileSunburst,
  fields: (chart) => [...chart.path.map((level) => level.field), chart.value.field],
};
