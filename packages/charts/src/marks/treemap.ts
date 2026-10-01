import { type SunburstChart, type TreemapChart } from "@data-agent/contracts";
import type { ChartOption } from "../types.js";
import { PALETTE, displayScale, fieldLabel, fieldTitle, formatValue } from "../semantics.js";
import { type Measure, CompileContext, checkPartOfWhole, refuseSelection } from "./shared.js";
import type { MarkDefinition } from "./types.js";

const MAX_STATIC_TREEMAP_LEAVES = 60;

/** A tile below this share of the whole usually cannot show its name and value. */
const SMALL_TILE_SHARE = 0.02;

export interface TreeNode { name: string; value?: number; children?: TreeNode[] }

export interface LeafTree {
  readonly root: TreeNode;
  readonly depth: number;
  readonly value: Measure;
  /** How many leaves are below the given share of the whole; used for notices, never shown. */
  smallLeaves(share: number): number;
}

/**
 * Leaf rows with full paths, checked and nested: part-of-whole, one row per
 * path, and a static capacity. Treemap and sunburst draw the same tree.
 */
export function leafTree(context: CompileContext, chart: TreemapChart | SunburstChart, name: string, maxStaticLeaves: number): LeafTree | undefined {
  refuseSelection(context, name);
  const levels = chart.path.map((level, index) => ({ field: level.field, index: context.column(level.field, `/chart/path/${index}/field`) }));
  const value = context.measure(chart.value.field, "/chart/value/field");
  if (levels.some((level) => level.index === undefined) || !value) return undefined;
  checkPartOfWhole(context, value, value.values, "/chart/value/field");
  if (context.errors.length > 0) return undefined;
  const rows = context.dataset.rows;
  const paths = rows.map((row) => levels.map((level) => fieldLabel(row[level.index!], context.meta(level.field))));
  const seen = new Set<string>();
  for (const path of paths) {
    const key = JSON.stringify(path);
    if (seen.has(key)) {
      context.fail({ code: "DUPLICATE_KEY", message: `路径 ${path.join(" / ")} 有多行；编译器不合并观测`, path: "/chart/value/field", field: value.field, hint: "在查询中按完整路径聚合，每个叶子一行" });
      return undefined;
    }
    seen.add(key);
  }
  if (context.options.target === "static" && rows.length > maxStaticLeaves) {
    context.fail({ code: "CAPACITY_EXCEEDED", message: `${rows.length} 个叶子超过静态图上限 ${maxStaticLeaves}`, field: value.field, hint: "减少路径层级，或在查询中合并次要叶子（由查询返回“其他”）" });
    return undefined;
  }
  const scale = displayScale(value.meta);
  const root: TreeNode = { name: "", children: [] };
  for (const [rowIndex, path] of paths.entries()) {
    let node = root;
    for (const [depth, part] of path.entries()) {
      node.children ??= [];
      let child = node.children.find((item) => item.name === part);
      if (!child) {
        child = { name: part };
        node.children.push(child);
      }
      if (depth === path.length - 1) child.value = value.values[rowIndex]! * scale;
      node = child;
    }
  }
  const whole = value.values.reduce<number>((sum, item) => sum + (item ?? 0), 0);
  return { root, depth: levels.length, value, smallLeaves: (share) => (whole > 0 ? value.values.filter((item) => (item ?? 0) / whole < share).length : 0) };
}

function compileTreemap(context: CompileContext, chart: TreemapChart): ChartOption | undefined {
  const tree = leafTree(context, chart, "树图", MAX_STATIC_TREEMAP_LEAVES);
  if (!tree) return undefined;
  const { root, value } = tree;
  const levels = chart.path;
  if (levels.length > 1) context.notice({ kind: "layout", code: "VISUAL_SUM", message: "上层区块的面积为其下叶子之和", field: value.field });
  // Only a static image lacks the tooltip that names a small tile.
  const small = tree.smallLeaves(SMALL_TILE_SHARE);
  if (context.options.target === "static" && small > 0) {
    context.notice({ kind: "layout", code: "SMALL_TILES", message: `${small} 个区块面积过小，名称与数值可能无法完整显示，完整数据见数据集`, field: value.field });
  }
  const format = (shown: number) => formatValue(shown, value.meta);
  return {
    color: [...PALETTE],
    ...(context.options.target === "static" ? { animation: false } : {}),
    tooltip: { formatter: (params: { treePathInfo: { name: string }[]; value: number }) => `${params.treePathInfo.slice(1).map((item) => item.name).join(" / ")}：${format(params.value)}` },
    series: [{
      type: "treemap",
      name: fieldTitle(value.field, value.meta),
      left: 8, right: 8, top: 8, bottom: context.options.target === "interactive" && levels.length > 1 ? 32 : 8,
      roam: false,
      nodeClick: context.options.target === "interactive" && levels.length > 1 ? "zoomToNode" : false,
      breadcrumb: { show: context.options.target === "interactive" && levels.length > 1 },
      data: root.children,
      label: { formatter: (params: { name: string; value: number }) => `${params.name}\n${format(params.value)}`, overflow: "break" },
      upperLabel: { show: levels.length > 1, height: 22 },
      // Level 0 is the whole, named after the series; only real parents get a header.
      levels: [{ upperLabel: { show: false }, itemStyle: { borderColor: "#ffffff", borderWidth: 2, gapWidth: 2 } }, { itemStyle: { borderColor: "#ffffff", borderWidth: 2, gapWidth: 2 } }, { itemStyle: { borderColor: "#ffffff", borderWidth: 1, gapWidth: 1 }, colorSaturation: [0.35, 0.6] }],
    }],
  };
}

export const treemapMark: MarkDefinition<TreemapChart> = {
  compile: compileTreemap,
  fields: (chart) => [...chart.path.map((level) => level.field), chart.value.field],
};
