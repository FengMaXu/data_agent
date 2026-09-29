declare const __filename: string;

import { readEchartsSource, resolveEchartsAssetPath } from "./echarts-asset.js";
import type { WorkspaceStore } from "./workspace.js";

export interface DashboardV3Dataset {
  id: string;
  rows: Array<Record<string, unknown>>;
  schema?: Array<Record<string, unknown>>;
}

export interface DashboardV3View {
  id?: string;
  type: "line" | "bar" | "pie" | "kpi" | "table" | "chart" | "metric_cards";
  title?: string;
  subtitle?: string;
  dataset?: string;
  xField?: string;
  yField?: string;
  nameField?: string;
  valueField?: string;
  field?: string;
  aggregate?: "sum" | "avg" | "count" | "min" | "max";
  cards?: Array<{ label?: string; value?: unknown; change?: unknown }>;
  x?: { field?: string; type?: string };
  axes?: Array<{ id?: string; orient?: string; position?: string; name?: string; unit?: string }>;
  series?: Array<{ id?: string; name?: string; field?: string; mark?: "bar" | "line" | "scatter"; axis?: string; where?: Record<string, unknown> }>;
  series_by?: { field?: string; order?: string[]; colors?: Record<string, string> };
  columns?: Array<{ field?: string; label?: string }>;
}

export interface DashboardV3Spec {
  version?: string;
  title: string;
  filename?: string;
  datasets: DashboardV3Dataset[];
  views: DashboardV3View[];
  filters?: unknown[];
  interactions?: unknown[];
}

const VIEW_TYPES = new Set(["line", "bar", "pie", "kpi", "table", "chart", "metric_cards"]);

export function parseDashboardCsvRows(textValue: string): Array<Record<string, unknown>> {
  const matrix: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const text = textValue.replace(/^\uFEFF/, "");
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"' && quoted && next === '"') { cell += '"'; index++; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index++;
      row.push(cell); matrix.push(row); row = []; cell = "";
    } else cell += character;
  }
  if (cell || row.length) { row.push(cell); matrix.push(row); }
  const headers = matrix.shift() ?? [];
  return matrix.filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(headers.map((header, index) => {
    const raw = values[index] ?? "";
    return [header, raw.trim() !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw];
  })));
}

/** Resolves V3 CSV source bindings within the active workspace before validation. */
export async function materializeDashboardV3Spec(rawSpec: unknown, workspace: WorkspaceStore): Promise<DashboardV3Spec> {
  if (!rawSpec || typeof rawSpec !== "object") return rawSpec as DashboardV3Spec;
  const spec = rawSpec as Record<string, unknown>;
  const datasets = await Promise.all((Array.isArray(spec.datasets) ? spec.datasets : []).map(async (value) => {
    const dataset = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const source = dataset.source && typeof dataset.source === "object" && !Array.isArray(dataset.source) ? dataset.source as Record<string, unknown> : {};
    const id = typeof dataset.id === "string" ? dataset.id : typeof dataset.name === "string" ? dataset.name : "";
    if (Array.isArray(dataset.rows)) return { ...dataset, id, rows: dataset.rows };
    const sourcePath = typeof source.path === "string" ? source.path : typeof dataset.file === "string" ? dataset.file : "";
    return { ...dataset, id, rows: sourcePath ? parseDashboardCsvRows(await workspace.read(sourcePath)) : [] };
  }));
  return { ...spec, title: typeof spec.title === "string" ? spec.title : "Dashboard", datasets } as unknown as DashboardV3Spec;
}

export function validateDashboardV3Spec(spec: unknown): { ok: true; spec: DashboardV3Spec } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const s = spec as DashboardV3Spec;
  if (!s || typeof s !== "object") return { ok: false, errors: ["spec must be an object"] };
  if (typeof s.title !== "string" || !s.title) errors.push("title is required");
  if (!Array.isArray(s.datasets) || s.datasets.length === 0) errors.push("at least one dataset is required");
  else for (const d of s.datasets) {
    if (!d.id) errors.push("dataset.id is required");
    if (!Array.isArray(d.rows)) errors.push(`dataset ${d.id} rows must be an array`);
  }
  if (!Array.isArray(s.views) || s.views.length === 0) errors.push("at least one view is required");
  else {
    const ids = new Set((s.datasets ?? []).map((d) => d.id));
    s.views.forEach((v, i) => {
      if (!VIEW_TYPES.has(v.type)) errors.push(`view ${v.id ?? i} has unsupported type`);
      if (v.dataset && !ids.has(v.dataset)) errors.push(`view ${v.id ?? i} references unknown dataset ${v.dataset}`);
      if ((v.type === "line" || v.type === "bar") && (!v.xField || !v.yField)) errors.push(`view ${v.id ?? i} needs xField/yField`);
      if (v.type === "pie" && (!v.nameField || !v.valueField)) errors.push(`view ${v.id ?? i} needs nameField/valueField`);
      if (v.type === "kpi" && !v.field) errors.push(`view ${v.id ?? i} needs field`);
      if (v.type === "metric_cards" && (!Array.isArray(v.cards) || v.cards.length === 0)) errors.push(`view ${v.id ?? i} needs cards`);
      if (v.type === "chart") {
        if (!v.dataset) errors.push(`view ${v.id ?? i} needs dataset`);
        if (!v.x?.field) errors.push(`view ${v.id ?? i} needs x.field`);
        if (!Array.isArray(v.series) || v.series.length === 0 || v.series.some((series) => !series.field || !series.mark)) errors.push(`view ${v.id ?? i} needs series field/mark`);
        if (v.series_by && !v.series_by.field) errors.push(`view ${v.id ?? i} needs series_by.field`);
        if (v.series_by && v.series?.length !== 1) errors.push(`view ${v.id ?? i} series_by requires exactly one base series`);
        const fields = (v.series ?? []).map((series) => series.field).filter(Boolean);
        const repeated = fields.some((field, index) => fields.indexOf(field) !== index);
        if (repeated && !v.series_by && (v.series ?? []).some((series) => !series.where)) errors.push(`view ${v.id ?? i} repeated series fields require series_by or where`);
      }
    });
  }
  return errors.length === 0 ? { ok: true, spec: s } : { ok: false, errors };
}

function aggregate(values: number[], agg: DashboardV3View["aggregate"]): number {
  switch (agg) {
    case "avg": return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
    case "count": return values.length;
    case "min": return Math.min(...values);
    case "max": return Math.max(...values);
    default: return values.reduce((a, b) => a + b, 0);
  }
}

export function seriesForView(view: DashboardV3View, dataset: DashboardV3Dataset): Array<{ name: string; points: Array<{ name: string; value: number }> }> {
  const groups = new Map<string, number[]>();
  for (const row of dataset.rows) {
    const key = String(row[view.xField ?? ""] ?? "");
    const value = Number(row[view.yField ?? view.valueField ?? ""] ?? 0);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(value);
  }
  return [{
    name: view.title ?? view.yField ?? view.valueField ?? "",
    points: [...groups.entries()].map(([name, values]) => ({ name, value: aggregate(values, view.aggregate) })),
  }];
}

function datasetFor(view: DashboardV3View, datasets: DashboardV3Dataset[]): DashboardV3Dataset {
  const dataset = datasets.find((item) => item.id === view.dataset) ?? datasets[0];
  if (!dataset) throw new Error("DASHBOARD_DATASET_MISSING");
  return dataset;
}

function chartOption(view: DashboardV3View, dataset: DashboardV3Dataset): Record<string, unknown> {
  const xField = view.x?.field ?? view.xField ?? "";
  const legacySeries = !view.series?.length && (view.xField || view.yField) ? seriesForView(view, dataset) : undefined;
  const categories = legacySeries?.[0]
    ? legacySeries[0].points.map((point) => point.name)
    : [...new Set(dataset.rows.map((row) => String(row[xField] ?? "")))];
  const axes = (view.axes ?? []).filter((axis) => axis.orient === "y");
  const yAxis = axes.length
    ? axes.map((axis) => ({ type: "value", name: [axis.name, axis.unit].filter(Boolean).join(" "), position: axis.position ?? "left" }))
    : [{ type: "value" }];
  const axisIndex = (axisId: string | undefined) => Math.max(0, axes.findIndex((axis) => axis.id === axisId));
  const palette = ["#4F6980", "#F47942", "#638B66", "#FBB04E", "#B66353", "#849DB1", "#B9AA97", "#7E756D"];
  const rowsFor = (where: Record<string, unknown> | undefined) => where
    ? dataset.rows.filter((row) => Object.entries(where).every(([field, value]) => row[field] === value))
    : dataset.rows;
  const valuesFor = (field: string | undefined, rows: Array<Record<string, unknown>>) => categories.map((category) => rows
    .filter((row) => String(row[xField] ?? "") === category)
    .reduce((sum, row) => sum + Number(row[field ?? ""] ?? 0), 0));
  type SeriesDescriptor = { name?: string | undefined; field?: string | undefined; mark?: "bar" | "line" | "scatter" | undefined; axis?: string | undefined; where?: Record<string, unknown> | undefined; color?: string | undefined };
  const baseSeries: SeriesDescriptor[] = view.series
    ? view.series.map((series) => ({ name: series.name, field: series.field, mark: series.mark, axis: series.axis, where: series.where }))
    : [{ ...(view.title ? { name: view.title } : {}), ...(view.yField ? { field: view.yField } : {}), mark: view.type === "line" ? "line" : "bar" }];
  const descriptors: SeriesDescriptor[] = view.series_by?.field && baseSeries.length === 1
    ? (() => {
      const groupField = view.series_by!.field!;
      const observed = [...new Set(dataset.rows.map((row) => String(row[groupField] ?? "")))];
      const groups = [...(view.series_by!.order ?? []).filter((group) => observed.includes(group)), ...observed.filter((group) => !view.series_by!.order?.includes(group))];
      return groups.map((group) => ({ ...baseSeries[0], name: group, where: { [groupField]: group }, color: view.series_by!.colors?.[group] }));
    })()
    : baseSeries;
  const series = descriptors.map((item, index) => ({
    name: item.name ?? item.field ?? `series-${index + 1}`,
    type: item.mark ?? (view.type === "line" ? "line" : "bar"),
    yAxisIndex: axisIndex(item.axis),
    data: legacySeries?.[0] && index === 0 ? legacySeries[0].points.map((point) => point.value) : valuesFor(item.field, rowsFor(item.where)),
    smooth: item.mark === "line",
    itemStyle: { color: "color" in item && typeof item.color === "string" ? item.color : palette[index % palette.length] },
  }));
  return {
    color: palette,
    tooltip: { trigger: "axis" },
    legend: { top: 8 },
    grid: { left: 52, right: 42, top: 52, bottom: 48, containLabel: true },
    xAxis: { type: "category", data: categories, axisLabel: { interval: 0 } },
    yAxis,
    series,
  };
}

export function compileDashboardView(view: DashboardV3View, datasets: DashboardV3Dataset[]): Record<string, unknown> {
  const dataset = datasetFor(view, datasets);
  if (view.type === "metric_cards") return { kind: "metric_cards", cards: view.cards ?? [] };
  if (view.type === "table") {
    const columns = view.columns?.length
      ? view.columns.map((column) => ({ field: column.field ?? "", label: column.label ?? column.field ?? "" }))
      : (dataset.rows[0] ? Object.keys(dataset.rows[0]).map((field) => ({ field, label: field })) : []);
    return { kind: "table", columns, rows: dataset.rows };
  }
  if (view.type === "kpi") {
    const values = dataset.rows.map((row) => Number(row[view.field ?? ""] ?? 0));
    return { kind: "metric_cards", cards: [{ label: view.title ?? view.field ?? "", value: aggregate(values, view.aggregate) }] };
  }
  if (view.type === "pie") {
    return {
      kind: "chart",
      option: {
        tooltip: { trigger: "item" },
        legend: { bottom: 4 },
        series: [{ type: "pie", radius: ["42%", "70%"], data: dataset.rows.map((row) => ({ name: String(row[view.nameField ?? ""] ?? ""), value: Number(row[view.valueField ?? ""] ?? 0) })) }],
      },
    };
  }
  return { kind: "chart", option: chartOption(view, dataset) };
}

/** Compile a validated V3 view into its ECharts option. */
export function compileEChartsOptions(view: DashboardV3View, datasets: DashboardV3Dataset[]): unknown {
  const compiled = compileDashboardView(view, datasets);
  if (compiled.kind === "metric_cards") {
    const card = (compiled.cards as Array<Record<string, unknown>>)[0] ?? {};
    return { kpi: { label: card.label, value: card.value } };
  }
  if (compiled.kind === "table") return { table: { columns: compiled.columns, rows: compiled.rows } };
  return compiled.option;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

// The asset helpers moved to echarts-asset.ts; re-exported for this frozen module's callers.
export { readEchartsSource, resolveEchartsAssetPath } from "./echarts-asset.js";

/** Renders a standalone HTML document backed by embedded data. */
export async function renderStandaloneDashboardHtml(spec: DashboardV3Spec, options: { echartsAssetPath?: string } = {}): Promise<string> {
  const views = spec.views.map((view) => ({ id: view.id ?? view.title ?? view.type, title: view.title ?? "", subtitle: view.subtitle ?? "", ...compileDashboardView(view, spec.datasets) }));
  const payload = safeJson({ title: spec.title, views });
  const echartsAssetPath = options.echartsAssetPath ?? resolveEchartsAssetPath();
  const echartsScript = echartsAssetPath
    ? `<script>${await readEchartsSource(echartsAssetPath)}</script>`
    : "<script>window.__DATA_AGENT_OFFLINE__=true;</script>";
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(spec.title)}</title>
<style>body{margin:0;background:#f5f6f8;color:#243142;font-family:"Segoe UI","Microsoft YaHei",sans-serif}.shell{max-width:1440px;margin:auto;padding:28px}.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}.panel{grid-column:span 6;background:#fff;border:1px solid #e4e8ee;border-radius:12px;padding:18px;min-height:160px;box-shadow:0 4px 18px rgba(35,49,66,.05)}.panel.wide{grid-column:span 12}.chart{height:380px}.chart-unavailable{display:flex;align-items:center;justify-content:center;color:#697586;font-size:13px;background:#f7f9fb;border-radius:9px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.card{background:#f7f9fb;border-radius:9px;padding:16px}.label{color:#697586;font-size:13px}.value{font-size:28px;font-weight:700;margin-top:8px}.change{color:#638b66;margin-top:5px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #e8ebef;text-align:left}th{background:#f7f9fb}@media(max-width:800px){.panel{grid-column:span 12}.shell{padding:14px}}</style></head>
<body><main class="shell"><h1>${escapeHtml(spec.title)}</h1><div id="dashboard" class="grid"></div></main>${echartsScript}
<script>window.__DASHBOARD__=${payload};(function(){var host=document.getElementById('dashboard');window.__DASHBOARD__.views.forEach(function(v){var p=document.createElement('section');p.className='panel'+(v.kind==='table'?' wide':'');p.innerHTML='<h2></h2>'+(v.subtitle?'<p class="label"></p>':'');p.querySelector('h2').textContent=v.title;if(v.subtitle)p.querySelector('p').textContent=v.subtitle;if(v.kind==='metric_cards'){var cards=document.createElement('div');cards.className='cards';(v.cards||[]).forEach(function(c){var d=document.createElement('div');d.className='card';d.innerHTML='<div class="label"></div><div class="value"></div><div class="change"></div>';d.children[0].textContent=c.label||'';d.children[1].textContent=String(c.value??'');d.children[2].textContent=String(c.change??'');cards.appendChild(d)});p.appendChild(cards)}else if(v.kind==='table'){var table=document.createElement('table'),thead=document.createElement('thead'),tr=document.createElement('tr');(v.columns||[]).forEach(function(c){var th=document.createElement('th');th.textContent=c.label;tr.appendChild(th)});thead.appendChild(tr);table.appendChild(thead);var tb=document.createElement('tbody');(v.rows||[]).forEach(function(r){var row=document.createElement('tr');v.columns.forEach(function(c){var td=document.createElement('td');td.textContent=String(r[c.field]??'');row.appendChild(td)});tb.appendChild(row)});table.appendChild(tb);p.appendChild(table)}else{var el=document.createElement('div');el.className='chart';p.appendChild(el);if(window.echarts){var chart=echarts.init(el);chart.setOption(v.option);window.addEventListener('resize',function(){chart.resize()})}else{el.className='chart chart-unavailable';el.textContent='图表组件未加载，无法渲染此图表。'}}host.appendChild(p)})})();</script></body></html>`;
}
