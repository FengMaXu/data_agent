import { THEME, type ChartRendererVersions, type DashboardDatasets, type SemanticsCheck } from "@data-agent/charts";
import type { DashboardSpec } from "@data-agent/contracts";

/**
 * Standalone dashboards (ADR-0008 step 4, ADR-0010). A pure function of a
 * validated spec and the datasets its views read: it neither resolves data
 * nor checks delivery eligibility, which the Runtime tool does first. The page
 * embeds the spec and rows, not ECharts options, and compiles each chart in the
 * browser with the inlined @data-agent/charts bundle.
 *
 * The page shows readers the data: tiles, their data notices and the snapshot
 * date. Provenance (Receipts, content hashes, Disclosures, model-declared
 * semantics) travels in the embedded payload and in the tool's answer to the
 * model, which relays it; it is not printed on the page.
 *
 * Views over live data can ask the hosting app for a refresh. The page only
 * names views; the app reads the spec from the file, refreshes through the
 * Runtime and answers with new rows. Opened outside the app, it is a snapshot.
 */

/** Where a dataset came from, shown on the page and kept for tracing. */
export interface DashboardDataSource {
  readonly kind: "publication" | "derived";
  /** receiptId or derivedId. */
  readonly id: string;
  /** How the page names the source, e.g. "发布记录 …" or "派生数据集 …（…）". */
  readonly label: string;
  readonly contentHash: string;
  /** Disclosure summaries of the results behind the source. */
  readonly disclosures: readonly string[];
  /** A live publication the hosting app may refresh (ADR-0010). */
  readonly live?: boolean;
  readonly publishedAt?: string;
}

export interface DashboardRenderInput {
  readonly spec: DashboardSpec;
  /** JSON-safe rows keyed by `datasetKey`. */
  readonly datasets: DashboardDatasets;
  readonly sources: Readonly<Record<string, DashboardDataSource>>;
  /** Per view id: declared semantics the Physical Profile makes doubtful. */
  readonly checks: Readonly<Record<string, readonly SemanticsCheck[]>>;
  readonly renderer: ChartRendererVersions;
  /** Day the snapshot was built, shown in the page header, e.g. "2026-10-01". */
  readonly builtOn: string;
  /** Ties refresh messages to this document; the app checks it against the file it opened. */
  readonly nonce: string;
}

export interface DashboardAssets {
  /** The @data-agent/charts browser bundle. */
  readonly chartsSource: string;
  /** ECharts; without it charts show a placeholder instead of rendering. */
  readonly echartsSource?: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
}

/** JSON that cannot close the surrounding script tag. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, (c) => (c === "\u2028" ? "\\u2028" : "\\u2029"));
}

// A BI page: a header, rows of tiles, then sources and data notes. Tile sizes come from the spec's layout rows.
// Colours are the chart theme's, so the chrome around a chart matches the chart (ADR-0008 decision 5).
const STYLE = `:root{--bg:${THEME.page};--tile:${THEME.surface};--rule:${THEME.rule};--ink:${THEME.ink};--ink-soft:${THEME.inkSoft};--muted:${THEME.muted};--up:${THEME.bad};--down:${THEME.good};--error:${THEME.bad};--shadow:0 1px 2px rgba(31,35,40,.04),0 8px 24px -16px rgba(31,35,40,.14)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:${THEME.font};-webkit-font-smoothing:antialiased}
.shell{max-width:1440px;margin:auto;padding:28px 32px 40px}
.page-head{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-bottom:20px}
h1{margin:0;font-size:24px;font-weight:700;letter-spacing:-.01em}.stamp{color:var(--muted);font-size:12px;white-space:nowrap}
.scope{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0;padding:0;list-style:none}.scope li{font-size:12px;color:var(--ink-soft);background:var(--tile);border:1px solid var(--rule);border-radius:999px;padding:3px 10px}
.board{display:flex;flex-direction:column;gap:16px}.row{display:grid;gap:16px;align-items:stretch}.panel{min-width:0}
.tile{background:var(--tile);border-radius:12px;box-shadow:var(--shadow);padding:18px 22px 16px;display:flex;flex-direction:column}
.tile h2{margin:0;font-size:15px;font-weight:600;line-height:1.45}.subtitle{margin:4px 0 0;color:var(--muted);font-size:12px;line-height:1.5}
.chart{margin-top:10px;flex:none}.chart-unavailable{display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px;background:var(--bg);border-radius:8px;padding:12px;text-align:center}
.kpi-caption{margin:0 0 8px;color:var(--muted);font-size:12px;font-weight:600}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px}
.card{background:var(--tile);border-radius:12px;box-shadow:var(--shadow);padding:16px 20px}
.tile .cards{grid-template-columns:1fr;gap:0;margin-top:6px}.tile .card{box-shadow:none;border-top:1px solid var(--rule);border-radius:0;padding:12px 0}.tile .card:first-child{border-top:0}
.label{color:var(--ink-soft);font-size:13px}.value{font-size:28px;font-weight:700;margin-top:4px;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.2}.value .unit{margin-left:3px;font-size:13px;font-weight:500;color:var(--muted);letter-spacing:0}
.delta{margin-top:4px;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}.delta b{font-weight:600;margin-left:4px}.delta.up b{color:var(--up)}.delta.down b{color:var(--down)}
.table-wrap{overflow:auto;max-height:480px;margin-top:10px}table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:9px 10px;border-bottom:1px solid var(--bg);text-align:left;white-space:nowrap}th{color:var(--muted);font-weight:500;font-size:12px;border-bottom:1px solid var(--rule);background:var(--tile);position:sticky;top:0}
tbody tr:hover td{background:var(--bg)}th.num,td.num{text-align:right;font-variant-numeric:tabular-nums}
.notes{margin-top:8px;color:var(--muted);font-size:11.5px}.notes summary{cursor:pointer}.notes ul{margin:4px 0 0;padding-left:18px}
.version{margin-top:8px;display:flex;gap:10px;align-items:center;color:var(--muted);font-size:12px}.version button{display:none;border:1px solid var(--rule);background:var(--tile);border-radius:6px;padding:2px 10px;color:var(--ink);cursor:pointer}.hosted .version button{display:inline-block}.version .error{color:var(--error)}
@media(max-width:900px){.row{grid-template-columns:1fr!important}.shell{padding:16px}.page-head{flex-direction:column;align-items:flex-start}}`;

// Plain ES2020 so it runs wherever the dashboard is opened; all data logic lives in DataAgentCharts.
const PAGE_SCRIPT = `(function(){
var D=window.__DATA_AGENT_DASHBOARD__,C=window.DataAgentCharts,host=document.getElementById("dashboard"),charts={},panels={},heights={},strips={},errors={},byId={};
D.spec.views.forEach(function(v){byId[v.id]=v});
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
function keyOf(v){return C.datasetKey(v.type==="chart"?v.chart.data:v.data)}
function cards(v,data,p){
  var box=el("div","cards");
  C.resolveKpiCards(v,data).forEach(function(c){
    var d=el("div","card"),value=el("div","value",c.value);value.title=c.fullValue;
    d.appendChild(el("div","label",c.label));if(c.unit)value.appendChild(el("span","unit",c.unit));d.appendChild(value);
    if(c.delta){var line=el("div","delta"+(c.delta.direction?" "+c.delta.direction:""),c.delta.label||null);line.appendChild(el("b",null,(c.delta.direction==="up"?"▲ ":c.delta.direction==="down"?"▼ ":"")+c.delta.value));d.appendChild(line)}
    box.appendChild(d);
  });
  p.appendChild(box);
}
function render(v){
  var data=D.datasets[keyOf(v)],source=D.sources[keyOf(v)]||{},p=panels[v.id],notes=[],checks=D.checks[v.id]||[];
  if(charts[v.id]){charts[v.id].dispose();delete charts[v.id]}
  p.textContent="";
  var title=v.type==="chart"?v.chart.title:v.title,subtitle=v.type==="chart"?v.chart.subtitle:v.subtitle;
  if(strips[v.id]){if(title)p.appendChild(el("p","kpi-caption",title+(subtitle?" · "+subtitle:"")))}
  else{if(title)p.appendChild(el("h2",null,title));if(subtitle)p.appendChild(el("p","subtitle",subtitle))}
  if(v.type==="chart"){
    var box=el("div","chart");box.style.height=heights[v.id]+"px";p.appendChild(box);
    var compiled=C.compileChart(v.chart,data,{target:"interactive",density:"compact",width:box.clientWidth||undefined,height:heights[v.id]});
    if(!compiled.ok){box.className="chart chart-unavailable";box.textContent="图表无法编译："+compiled.errors.map(function(e){return e.message}).join("；")}
    else if(!window.echarts){box.className="chart chart-unavailable";box.textContent="图表组件未加载，无法渲染此图表。"}
    else{charts[v.id]=echarts.init(box);charts[v.id].setOption(compiled.option);C.readerNotices(compiled.notices).forEach(function(n){notes.push(n.message)})}
  }else if(v.type==="table"){
    var shown=C.resolveTable(v,data),wrap=el("div","table-wrap"),table=el("table"),head=el("tr"),thead=el("thead"),body=el("tbody");
    shown.headers.forEach(function(h){head.appendChild(el("th",h.numeric?"num":null,h.label))});
    thead.appendChild(head);table.appendChild(thead);
    shown.rows.forEach(function(r){var tr=el("tr");r.forEach(function(text,i){tr.appendChild(el("td",shown.headers[i].numeric?"num":null,text))});body.appendChild(tr)});
    table.appendChild(body);wrap.appendChild(table);p.appendChild(wrap);
  }else cards(v,data,p);
  checks.forEach(function(c){notes.push(c.message)});
  if(notes.length){
    // Collapsed so tiles stay compact; a doubtful declaration opens it, since it changes how the numbers read.
    var details=el("details","notes"),ul=el("ul");if(checks.length)details.open=true;
    details.appendChild(el("summary",null,"说明 "+notes.length));notes.forEach(function(n){ul.appendChild(el("li",null,n))});details.appendChild(ul);p.appendChild(details);
  }
  if(source.live){
    var version=el("div","version");version.appendChild(el("span",null,"数据版本："+source.label));
    var button=el("button",null,"刷新数据");button.type="button";button.onclick=function(){refresh([v.id])};version.appendChild(button);
    if(errors[v.id])version.appendChild(el("span","error","刷新失败（"+errors[v.id]+"），仍显示上一版数据"));
    p.appendChild(version);
  }
}
C.dashboardRows(D.spec).forEach(function(row){
  var strip=row.views.length===1&&byId[row.views[0]].type==="kpi",line=el("div","row");
  line.style.gridTemplateColumns=strip?"1fr":row.widths.map(function(w){return w+"fr"}).join(" ");
  host.appendChild(line);
  row.views.forEach(function(id){
    var p=el("section","panel "+(strip?"kpi-strip":"tile"));p.id="view-"+id;
    // Attach first: ECharts sizes a chart from its container, and a detached one measures zero.
    line.appendChild(p);panels[id]=p;heights[id]=C.ROW_CHART_HEIGHTS[row.height];if(strip)strips[id]=true;
  });
});
D.spec.views.forEach(function(v){if(panels[v.id])render(v)});
window.addEventListener("resize",function(){Object.keys(charts).forEach(function(id){charts[id].resize()})});
// Refresh bridge: only a hosting app that answers the handshake with this document's nonce can refresh it.
var pending={};
function post(message){message.nonce=D.nonce;window.parent.postMessage(message,"*")}
function refresh(viewIds){var requestId="r"+Date.now()+Math.random().toString(16).slice(2);pending[requestId]=viewIds;post({kind:"dashboard.refresh",requestId:requestId,viewIds:viewIds})}
window.addEventListener("message",function(event){
  var m=event.data||{};
  if(event.source!==window.parent||m.nonce!==D.nonce)return;
  if(m.kind==="dashboard.host"){document.body.classList.add("hosted");return}
  var viewIds=pending[m.requestId];if(!viewIds)return;delete pending[m.requestId];
  if(m.kind==="dashboard.refreshed"){
    Object.keys(m.datasets||{}).forEach(function(k){D.datasets[k]=m.datasets[k]});
    Object.keys(m.sources||{}).forEach(function(k){D.sources[k]=m.sources[k]});
    Object.keys(m.checks||{}).forEach(function(id){D.checks[id]=m.checks[id]});
    var changed=Object.keys(m.datasets||{});
    D.spec.views.forEach(function(v){if(changed.indexOf(keyOf(v))>=0){delete errors[v.id];render(v)}});
  }else if(m.kind==="dashboard.refresh_error"){
    viewIds.forEach(function(id){errors[id]=m.code||"REFRESH_FAILED"});
    D.spec.views.forEach(function(v){if(viewIds.indexOf(v.id)>=0)render(v)});
  }
});
if(window.parent!==window&&D.spec.views.some(function(v){return (D.sources[keyOf(v)]||{}).live}))post({kind:"dashboard.ready"});
})();`;

/** The subtitle's scope parts (data, period, basis, units) as chips; the skill writes them joined by " · ". */
function scopeList(subtitle: string | undefined): string {
  const parts = (subtitle ?? "").split(/\s*·\s*/).filter((part) => part.length > 0);
  return parts.length > 0 ? `<ul class="scope">${parts.map((part) => `<li>${escapeHtml(part)}</li>`).join("")}</ul>` : "";
}

export function renderDashboardHtml(input: DashboardRenderInput, assets: DashboardAssets): string {
  const { spec } = input;
  const payload = scriptJson({ spec, datasets: input.datasets, sources: input.sources, checks: input.checks, renderer: input.renderer, nonce: input.nonce });
  const live = Object.values(input.sources).some((source) => source.live);
  const stamp = live ? `实时数据 · ${input.builtOn} 生成，应用内可刷新` : `数据快照 · ${input.builtOn}`;
  const echarts = assets.echartsSource ? `<script>${assets.echartsSource}</script>` : "";
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(spec.title)}</title><style>${STYLE}</style></head>
<body><main class="shell"><header class="page-head"><div><h1>${escapeHtml(spec.title)}</h1>${scopeList(spec.subtitle)}</div><div class="stamp">${escapeHtml(stamp)}</div></header>
<div id="dashboard" class="board"></div></main>
${echarts}<script>${assets.chartsSource}</script>
<script>window.__DATA_AGENT_DASHBOARD__=${payload};</script>
<script>${PAGE_SCRIPT}</script></body></html>`;
}
