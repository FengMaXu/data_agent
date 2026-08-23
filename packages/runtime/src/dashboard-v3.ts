import { readFile } from "node:fs/promises";

export interface DashboardV3View {
  id?: string;
  type: "line" | "bar" | "pie" | "kpi" | "table";
  title?: string;
  dataset?: string;
  xField?: string;
  yField?: string;
  nameField?: string;
  valueField?: string;
  field?: string;
  aggregate?: "sum" | "avg" | "count" | "min" | "max";
}
export interface DashboardV3Dataset { id: string; rows: Array<Record<string, unknown>> }
export interface DashboardV3Spec { title: string; datasets: DashboardV3Dataset[]; views: DashboardV3View[] }

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
    const ids = new Set((s.datasets ?? []).map(d => d.id));
    s.views.forEach((v, i) => {
      if (!["line", "bar", "pie", "kpi", "table"].includes(v.type)) errors.push(`view ${i} has unsupported type`);
      if (v.dataset && !ids.has(v.dataset)) errors.push(`view ${i} references unknown dataset ${v.dataset}`);
      if ((v.type === "line" || v.type === "bar") && (!v.xField || !v.yField)) errors.push(`view ${i} needs xField/yField`);
      if (v.type === "pie" && (!v.nameField || !v.valueField)) errors.push(`view ${i} needs nameField/valueField`);
      if (v.type === "kpi" && !v.field) errors.push(`view ${i} needs field`);
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
  return [{ name: view.title ?? view.yField ?? view.valueField ?? "", points: [...groups.entries()].map(([name, values]) => ({ name, value: aggregate(values, view.aggregate) })) }];
}

export function compileEChartsOptions(view: DashboardV3View, datasets: DashboardV3Dataset[]): unknown {
  const dataset = datasets.find(d => d.id === view.dataset) ?? datasets[0];
  switch (view.type) {
    case "pie": {
      const data = dataset.rows.map(row => ({ name: String(row[view.nameField!] ?? ""), value: Number(row[view.valueField!] ?? 0) }));
      return { title: { text: view.title }, series: [{ type: "pie", data }] };
    }
    case "kpi": {
      const values = dataset.rows.map(row => Number(row[view.field!] ?? 0));
      return { kpi: { label: view.title, value: aggregate(values, view.aggregate) } };
    }
    case "table":
      return { table: { columns: dataset.rows.length ? Object.keys(dataset.rows[0]) : [], rows: dataset.rows } };
    default: {
      const series = seriesForView(view, dataset)[0];
      return { xAxis: { data: series.points.map(p => p.name) }, yAxis: {}, series: [{ name: series.name, type: view.type, data: series.points.map(p => p.value) }] };
    }
  }
}

/** Renders a fully standalone HTML document; echartsSource makes it work with zero network. */
export async function renderStandaloneDashboardHtml(spec: DashboardV3Spec, options: { echartsAssetPath?: string } = {}): Promise<string> {
  const charts = spec.views.map(view => ({ viewId: view.id ?? view.title ?? view.type, options: compileEChartsOptions(view, spec.datasets) }));
  const payload = JSON.stringify({ title: spec.title, charts });
  let echartsScript = "";
  if (options.echartsAssetPath) echartsScript = `<script>${await readFile(options.echartsAssetPath, "utf8")}</script>`;
  else echartsScript = "<script>/* offline build requires bundled echarts asset */window.__DATA_AGENT_OFFLINE__=true;</script>";
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${spec.title}</title></head>
<body><h1>${spec.title}</h1><div id="charts"></div>
${echartsScript}
<script>window.__DASHBOARD__=${payload};
(function(){
  var host=document.getElementById('charts');
  var hasEcharts=typeof window.echarts!=='undefined';
  window.__DASHBOARD__.charts.forEach(function(c){
    var el=document.createElement('div');el.style.width='600px';el.style.height='400px';host.appendChild(el);
    if(hasEcharts){var chart=window.echarts.init(el);chart.setOption(c.options.kpi?{title:{text:c.options.kpi.label,textAlign:'center',top:'40%'},series:[]}:c.options);}
    else{el.textContent=JSON.stringify(c.options);}
  });
})();
</script></body></html>`;
}
