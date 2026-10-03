import { type SankeyChart } from "@data-agent/contracts";
import type { ChartOption } from "../types.js";
import { displayScale, fieldLabel, fieldTitle, formatValue } from "../semantics.js";
import { LABEL_CHAR_PX, CompileContext, checkPartOfWhole, refuseSelection } from "./shared.js";
import type { MarkDefinition } from "./types.js";

/** Beyond these a static canvas cannot keep nodes or tiles and their labels legible. */
const MAX_STATIC_SANKEY_NODES = 40;

/** Node names wider than this are truncated beside the node. */
const SANKEY_LABEL_CHARS = 7;

function compileSankey(context: CompileContext, chart: SankeyChart): ChartOption | undefined {
  refuseSelection(context, "桑基图");
  const sourceIndex = context.column(chart.source.field, "/chart/source/field");
  const targetIndex = context.column(chart.target.field, "/chart/target/field");
  const value = context.measure(chart.value.field, "/chart/value/field");
  if (sourceIndex === undefined || targetIndex === undefined || !value) return undefined;
  checkPartOfWhole(context, value, value.values, "/chart/value/field");
  if (context.errors.length > 0) return undefined;
  const rows = context.dataset.rows;
  const sources = rows.map((row) => fieldLabel(row[sourceIndex], context.meta(chart.source.field)));
  const targets = rows.map((row) => fieldLabel(row[targetIndex], context.meta(chart.target.field)));
  const edges = new Set<string>();
  const next = new Map<string, string[]>();
  for (const [index, source] of sources.entries()) {
    const target = targets[index]!;
    const key = JSON.stringify([source, target]);
    if (edges.has(key)) {
      context.fail({ code: "DUPLICATE_KEY", message: `流向 ${source} → ${target} 有多行；编译器不合并观测`, path: "/chart/value/field", field: value.field, hint: "在查询中按来源与去向聚合，每条流向一行" });
      return undefined;
    }
    edges.add(key);
    next.set(source, [...(next.get(source) ?? []), target]);
  }
  // Flows must run one way: a cycle has no left-to-right layout and double-counts node totals.
  const state = new Map<string, "visiting" | "done">();
  const cycle = (node: string, trail: string[]): string[] | undefined => {
    if (state.get(node) === "visiting") return [...trail.slice(trail.indexOf(node)), node];
    if (state.get(node) === "done") return undefined;
    state.set(node, "visiting");
    for (const target of next.get(node) ?? []) {
      const found = cycle(target, [...trail, node]);
      if (found) return found;
    }
    state.set(node, "done");
    return undefined;
  };
  for (const node of next.keys()) {
    const found = cycle(node, []);
    if (found) {
      context.fail({ code: "FLOW_CYCLE", message: `流向构成环：${found.join(" → ")}`, path: "/chart", hint: "桑基图只表示单向流动；拆分阶段或去掉回流" });
      return undefined;
    }
  }
  const nodes = [...new Set([...sources, ...targets])];
  if (context.options.target === "static" && nodes.length > MAX_STATIC_SANKEY_NODES) {
    context.fail({ code: "CAPACITY_EXCEEDED", message: `${nodes.length} 个节点超过静态图上限 ${MAX_STATIC_SANKEY_NODES}`, field: chart.source.field, hint: "在查询中合并次要节点（由查询返回“其他”），或拆成多张图" });
    return undefined;
  }
  const scale = displayScale(value.meta);
  const format = (shown: number) => formatValue(shown, value.meta);
  context.notice({ kind: "layout", code: "VISUAL_SUM", message: "节点大小为其流入或流出之和，由连线相加得到", field: value.field });
  if (nodes.some((name) => name.length > SANKEY_LABEL_CHARS)) {
    context.notice({ kind: "layout", code: "LABELS_TRUNCATED", message: `过长的节点名称截断显示为前 ${SANKEY_LABEL_CHARS} 个字符左右，完整名称见提示框或数据集`, field: chart.source.field });
  }
  return {
    color: [...context.palette],
    ...(context.options.target === "static" ? { animation: false } : {}),
    tooltip: {
      trigger: "item",
      formatter: (params: { dataType: string; name: string; value: number; data: { source?: string; target?: string } }) =>
        params.dataType === "edge" ? `${params.data.source} → ${params.data.target}：${format(params.value)}` : `${params.name}：${format(params.value)}`,
    },
    series: [{
      type: "sankey",
      name: fieldTitle(value.field, value.meta),
      left: 16, right: 96, top: 24, bottom: 24,
      emphasis: { focus: "adjacency" },
      nodeGap: 12,
      data: nodes.map((name) => ({ name })),
      links: sources.map((source, index) => ({ source, target: targets[index]!, value: value.values[index]! * scale })),
      lineStyle: { color: "gradient", opacity: 0.35 },
      label: { overflow: "truncate", width: SANKEY_LABEL_CHARS * LABEL_CHAR_PX },
    }],
  };
}

export const sankeyMark: MarkDefinition<SankeyChart> = {
  compile: compileSankey,
  fields: (chart) => [chart.source.field, chart.target.field, chart.value.field],
  example: (chart) => [["s0", "s1", 3], ["s1", "s2", 2]].map(([source, target, value]) => ({ [chart.source.field]: source, [chart.target.field]: target, [chart.value.field]: value })),
};
