import type { ChartRendererVersions, DashboardDatasets, SemanticsCheck } from "@data-agent/charts";
import type { DashboardSpec } from "@data-agent/contracts";

/**
 * Standalone dashboards (ADR-0008 step 4, ADR-0010). A pure function of a
 * validated spec and the datasets its views read: it neither resolves data
 * nor checks delivery eligibility, which the Runtime tool does first. The page
 * embeds the spec and rows, not ECharts options, and compiles each chart in the
 * browser with the inlined @data-agent/charts bundle.
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
  /** Fields whose semantics only the model declared. */
  readonly declaredFields: readonly string[];
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

const STYLE = `body{margin:0;background:#f5f6f8;color:#243142;font-family:"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif}
.shell{max-width:1440px;margin:auto;padding:28px}h1{margin:0 0 4px;font-size:24px}.lead{margin:0 0 20px;color:#697586}
.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}
.panel{grid-column:span 6;min-width:0;background:#fff;border:1px solid #e4e8ee;border-radius:12px;padding:18px;box-shadow:0 4px 18px rgba(35,49,66,.05)}
.panel.wide{grid-column:span 12}.panel h2{margin:0;font-size:16px}.subtitle{margin:4px 0 0;color:#697586;font-size:13px}
.chart{height:380px;margin-top:12px}.chart-unavailable{display:flex;align-items:center;justify-content:center;color:#697586;font-size:13px;background:#f7f9fb;border-radius:9px;padding:12px;text-align:center}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:12px}.card{background:#f7f9fb;border-radius:9px;padding:16px}
.label{color:#697586;font-size:13px}.value{font-size:28px;font-weight:700;margin-top:8px}.delta{color:#4f6980;margin-top:5px;font-size:13px}
.table-wrap{overflow-x:auto;margin-top:12px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:9px 10px;border-bottom:1px solid #e8ebef;text-align:left;white-space:nowrap}th{background:#f7f9fb}th.num,td.num{text-align:right;font-variant-numeric:tabular-nums}
.notes{margin:10px 0 0;padding-left:18px;color:#697586;font-size:12px}
.version{margin:10px 0 0;display:flex;gap:10px;align-items:center;color:#697586;font-size:12px}.version button{display:none;border:1px solid #c9d1db;background:#fff;border-radius:6px;padding:2px 10px;color:#243142;cursor:pointer}.hosted .version button{display:inline-block}.version .error{color:#b66353}footer{margin-top:24px;color:#697586;font-size:12px;line-height:1.7}
@media(max-width:800px){.panel{grid-column:span 12}.shell{padding:14px}}`;

// Plain ES2020 so it runs wherever the dashboard is opened; all data logic lives in DataAgentCharts.
const PAGE_SCRIPT = `(function(){
var D=window.__DATA_AGENT_DASHBOARD__,C=window.DataAgentCharts,host=document.getElementById("dashboard"),charts={},panels={},errors={};
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
function keyOf(v){return C.datasetKey(v.type==="chart"?v.chart.data:v.data)}
function render(v){
  var key=keyOf(v),data=D.datasets[key],source=D.sources[key]||{},p=panels[v.id];
  if(charts[v.id]){charts[v.id].dispose();delete charts[v.id]}
  p.textContent="";
  var title=v.type==="chart"?v.chart.title:v.title,subtitle=v.type==="chart"?v.chart.subtitle:v.subtitle,notes=[];
  if(title)p.appendChild(el("h2",null,title));if(subtitle)p.appendChild(el("p","subtitle",subtitle));
  if(v.type==="chart"){
    var box=el("div","chart");p.appendChild(box);
    var compiled=C.compileChart(v.chart,data,{target:"interactive"});
    if(!compiled.ok){box.className="chart chart-unavailable";box.textContent="图表无法编译："+compiled.errors.map(function(e){return e.message}).join("；")}
    else if(!window.echarts){box.className="chart chart-unavailable";box.textContent="图表组件未加载，无法渲染此图表。"}
    else{charts[v.id]=echarts.init(box);charts[v.id].setOption(compiled.option);compiled.notices.forEach(function(n){notes.push(n.message)})}
  }else if(v.type==="table"){
    var cols=v.columns||data.columns.map(function(f){return{field:f}}),fields=v.fields||{},index=cols.map(function(c){return data.columns.indexOf(c.field)});
    var wrap=el("div","table-wrap"),table=el("table"),head=el("tr"),thead=el("thead"),body=el("tbody");
    cols.forEach(function(c){var meta=fields[c.field];head.appendChild(el("th",meta&&meta.type==="quantitative"?"num":null,c.label||(meta&&meta.label)||c.field))});
    thead.appendChild(head);table.appendChild(thead);
    data.rows.forEach(function(r){var tr=el("tr");cols.forEach(function(c,i){var meta=fields[c.field];tr.appendChild(el("td",meta&&meta.type==="quantitative"?"num":null,C.formatDashboardCell(r[index[i]],meta)))});body.appendChild(tr)});
    table.appendChild(body);wrap.appendChild(table);p.appendChild(wrap);
  }else{
    var cards=el("div","cards");
    C.resolveKpiCards(v,data).forEach(function(c){var d=el("div","card");d.appendChild(el("div","label",c.label));d.appendChild(el("div","value",c.value));if(c.delta)d.appendChild(el("div","delta",(c.delta.label?c.delta.label+" ":"")+c.delta.value));cards.appendChild(d)});
    p.appendChild(cards);
  }
  (D.checks[v.id]||[]).forEach(function(c){notes.push(c.message)});
  if(source.kind==="derived")notes.push(source.label);
  (source.disclosures||[]).forEach(function(d){notes.push(d)});
  if(notes.length){var ul=el("ul","notes");notes.forEach(function(n){ul.appendChild(el("li",null,n))});p.appendChild(ul)}
  if(source.live){
    var version=el("div","version");version.appendChild(el("span",null,"数据版本："+source.label));
    var button=el("button",null,"刷新数据");button.type="button";button.onclick=function(){refresh([v.id])};version.appendChild(button);
    if(errors[v.id])version.appendChild(el("span","error","刷新失败（"+errors[v.id]+"），仍显示上一版数据"));
    p.appendChild(version);
  }
}
D.spec.views.forEach(function(v){
  var p=el("section","panel"+((v.width||(v.type==="chart"?"half":"full"))==="full"?" wide":""));p.id="view-"+v.id;
  // Attach first: ECharts sizes a chart from its container, and a detached one measures zero.
  host.appendChild(p);panels[v.id]=p;render(v);
});
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

export function renderDashboardHtml(input: DashboardRenderInput, assets: DashboardAssets): string {
  const { spec } = input;
  const payload = scriptJson({ spec, datasets: input.datasets, sources: input.sources, checks: input.checks, renderer: input.renderer, nonce: input.nonce });
  const sources = Object.values(input.sources).map((source) => `<li>${escapeHtml(source.label)}（内容哈希 ${escapeHtml(source.contentHash.slice(0, 12))}）</li>`).join("");
  const semantics = input.declaredFields.length > 0 ? `<p>以下字段的语义来自模型声明，未经业务定义核实：${escapeHtml(input.declaredFields.join("、"))}</p>` : "";
  const echarts = assets.echartsSource ? `<script>${assets.echartsSource}</script>` : "";
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(spec.title)}</title><style>${STYLE}</style></head>
<body><main class="shell"><h1>${escapeHtml(spec.title)}</h1>${spec.subtitle ? `<p class="lead">${escapeHtml(spec.subtitle)}</p>` : ""}<div id="dashboard" class="grid"></div>
<footer><div>${Object.values(input.sources).some((source) => source.live) ? "数据来自（实时数据在应用内可刷新，离开应用后为快照）：" : "数据快照，来自："}</div><ul>${sources}</ul>${semantics}</footer></main>
${echarts}<script>${assets.chartsSource}</script>
<script>window.__DATA_AGENT_DASHBOARD__=${payload};</script>
<script>${PAGE_SCRIPT}</script></body></html>`;
}
