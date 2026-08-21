from __future__ import annotations

import json
from html import escape
from typing import Any

from src.agent.tool_providers.dashboard_design import dashboard_design_tokens

from .semantic_contract import CompiledSemanticDashboard


DEFAULT_ECHARTS_CDN = "https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"
DEFAULT_ECHARTS_LOCAL = "assets/echarts.min.js"


def render_semantic_dashboard_html(
    compiled: CompiledSemanticDashboard,
    initial_evaluation: dict[str, Any],
    *,
    assets: dict[str, Any] | None = None,
) -> str:
    """Render a credential-free V4 HTML dashboard with a snapshot and host bridge."""
    spec = compiled.spec
    metadata = {
        "title": spec["title"],
        "theme": str(spec.get("theme") or "light"),
        "layout": spec.get("layout") or {},
        "renderer_version": "dashboard-html-v4-semantic-runtime",
    }
    data = initial_evaluation.get("data") or {}
    parameters = _runtime_parameters(compiled, data)
    runtime = {
        "version": "4",
        "metadata": metadata,
        "parameters": parameters,
        "data": data,
        "views": spec.get("views", []),
        "interactions": spec.get("interactions", []),
        "viewManifest": compiled.view_manifest,
        "design": dashboard_design_tokens(),
    }
    assets = assets or {}
    mode = str(assets.get("mode") or "cdn")
    echarts_url = assets.get("echarts_url") or (DEFAULT_ECHARTS_LOCAL if mode == "local" else DEFAULT_ECHARTS_CDN)
    title = escape(str(metadata["title"]))
    theme = escape(str(metadata["theme"]))
    sidebar = (metadata["layout"] or {}).get("sidebar", True) is not False
    shell_class = "dashboard-shell" if sidebar else "dashboard-shell no-sidebar"
    nav = "".join(
        f'<a class="sidebar-link" href="#view-card-{escape(str(view.get("id") or index))}">{escape(str(view.get("title") or view.get("id") or f"View {index + 1}"))}</a>'
        for index, view in enumerate(spec.get("views", []))
        if isinstance(view, dict)
    )
    sidebar_html = f'<aside class="sidebar"><div class="sidebar-title">Views</div>{nav}</aside>' if sidebar else ""
    shells = "\n".join(_view_shell(view, index) for index, view in enumerate(spec.get("views", [])) if isinstance(view, dict))
    return _HTML_TEMPLATE \
        .replace("__TITLE__", title) \
        .replace("__THEME__", theme) \
        .replace("__SHELL_CLASS__", shell_class) \
        .replace("__SIDEBAR__", sidebar_html) \
        .replace("__VIEW_SHELLS__", shells) \
        .replace("__ECHARTS_URL__", escape(str(echarts_url))) \
        .replace("__DOCUMENT_JSON__", _json_script_payload(spec)) \
        .replace("__RUNTIME_JSON__", _json_script_payload(runtime))


def _runtime_parameters(compiled: CompiledSemanticDashboard, data: dict[str, Any]) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for name, plan in compiled.parameters.items():
        result = data.get(plan.options_data) or {}
        values: list[Any] = []
        seen: set[str] = set()
        for row in result.get("rows", []) if isinstance(result, dict) else []:
            if not isinstance(row, dict):
                continue
            value = row.get(plan.options_field)
            if value is None:
                continue
            key = json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
            if key not in seen:
                seen.add(key)
                values.append(value)
        output[name] = {
            "label": plan.label,
            "default": plan.default,
            "value": plan.default,
            "options": values,
        }
    return output


def _view_shell(view: dict[str, Any], index: int) -> str:
    view_id = escape(str(view.get("id") or f"view_{index}"))
    title = escape(str(view.get("title") or view.get("id") or f"View {index + 1}"))
    subtitle = escape(str(view.get("subtitle") or ""))
    span = (view.get("layout") or {}).get("span", 12)
    height = _css_length((view.get("layout") or {}).get("height"))
    subtitle_html = f'<div class="view-subtitle">{subtitle}</div>' if subtitle else ""
    view_type = view.get("type")
    if view_type == "table":
        body = '<div class="table-wrap"></div>'
    elif view_type == "metric_cards":
        body = '<div class="metric-grid"></div>'
    else:
        body = f'<div class="chart-host" id="view-chart-{view_id}" style="height:{height}"></div>'
    return (
        f'<article class="view-card" id="view-card-{view_id}" data-view-id="{view_id}" style="--view-span:{escape(str(span))}">'
        f'<div class="view-heading"><div><div class="view-title">{title}</div>{subtitle_html}</div><div class="view-status" data-status-for="{view_id}"></div></div>'
        f'<div class="view-runtime-body">{body}</div></article>'
    )


def _css_length(value: Any) -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
        return f"{value:g}px"
    if isinstance(value, str) and value.strip() and value.strip()[-2:] in {"px", "em", "vh", "vw", "%"}:
        return value.strip()
    return "360px"


def _json_script_payload(value: Any) -> str:
    return (
        json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        .replace("&", "\\u0026")
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
    )


_HTML_TEMPLATE = r'''<!doctype html>
<html lang="zh-CN" data-theme="__THEME__">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>__TITLE__</title>
<style>
:root { --bg:#f6f4ef; --panel:#fff; --text:#202124; --muted:#687076; --line:#ded8ce; --primary:#4f6980; --accent:#f47942; --positive:#638b66; --negative:#b66353; }
[data-theme="dark"] { --bg:#151719; --panel:#202326; --text:#f5f6f7; --muted:#aeb4b8; --line:#363b40; }
* { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--text); font-family:"Segoe UI",Arial,sans-serif; }
button,select { font:inherit; } .dashboard-shell { min-height:100vh; display:grid; grid-template-columns:220px minmax(0,1fr); }
.dashboard-shell.no-sidebar { grid-template-columns:minmax(0,1fr); } .sidebar { border-right:1px solid var(--line); background:var(--panel); padding:20px 14px; position:sticky; top:0; height:100vh; overflow:auto; }
.sidebar-title { color:var(--muted); font-size:12px; text-transform:uppercase; margin-bottom:10px; } .sidebar-link { display:block; padding:8px 10px; border-radius:6px; color:var(--text); text-decoration:none; font-size:13px; }
.sidebar-link:hover { background:color-mix(in srgb,var(--primary) 12%,transparent); } .main { min-width:0; padding:22px; } .topbar { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:14px; }
h1 { margin:0; font-size:24px; } .live-state { color:var(--muted); font-size:12px; } .live-state.live { color:var(--positive); } .live-state.offline { color:var(--muted); }
.filter-bar { display:flex; flex-wrap:wrap; align-items:end; gap:12px; padding:12px 14px; margin-bottom:14px; background:var(--panel); border:1px solid var(--line); border-radius:8px; }
.filter-control { display:grid; gap:5px; min-width:180px; } .filter-label { color:var(--muted); font-size:12px; font-weight:600; } select { min-height:34px; padding:6px 9px; border:1px solid var(--line); border-radius:6px; color:var(--text); background:var(--panel); }
.reset-button { min-height:34px; padding:6px 12px; border:1px solid var(--line); border-radius:6px; color:var(--text); background:var(--panel); cursor:pointer; }
.chips { display:flex; gap:6px; flex-wrap:wrap; margin:-3px 0 14px; } .chip { border:1px solid var(--line); border-radius:999px; background:var(--panel); color:var(--muted); padding:4px 9px; font-size:12px; cursor:pointer; }
.runtime-grid { display:grid; grid-template-columns:repeat(12,minmax(0,1fr)); gap:14px; } .view-card { grid-column:span var(--view-span,12); min-width:0; overflow:hidden; padding:16px; border:1px solid var(--line); border-radius:8px; background:var(--panel); }
.view-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:10px; } .view-title { font-size:16px; font-weight:650; } .view-subtitle { color:var(--muted); font-size:13px; margin-top:3px; }
.view-status { min-height:18px; color:var(--muted); font-size:12px; white-space:nowrap; } .view-status.error { color:var(--negative); } .view-status.loading { color:var(--accent); }
.chart-host { width:100%; min-height:260px; } .metric-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; } .metric-card { border:1px solid var(--line); border-radius:6px; padding:12px; }
.metric-label { color:var(--muted); font-size:12px; } .metric-value { margin-top:6px; font-size:22px; font-weight:700; overflow-wrap:anywhere; } .table-wrap { max-height:460px; overflow:auto; border:1px solid var(--line); border-radius:6px; }
table { width:100%; border-collapse:collapse; font-size:13px; } th,td { padding:9px 10px; border-bottom:1px solid var(--line); text-align:left; white-space:nowrap; } th { position:sticky; top:0; background:var(--panel); }
.notice { display:none; margin-bottom:12px; padding:10px 12px; border:1px solid var(--negative); color:var(--negative); background:color-mix(in srgb,var(--negative) 8%,transparent); border-radius:6px; font-size:13px; }
@media (max-width:860px) { .dashboard-shell { grid-template-columns:1fr; } .sidebar { position:static; height:auto; } .main { padding:16px; } .view-card { grid-column:span 12; } }
</style>
</head>
<body>
<div class="__SHELL_CLASS__">__SIDEBAR__<main class="main" id="dashboard-root">
<div class="topbar"><h1>__TITLE__</h1><div id="live-state" class="live-state"></div></div>
<div id="runtime-notice" class="notice"></div>
<section id="parameter-controls" class="filter-bar"></section><div id="active-chips" class="chips"></div>
<section class="runtime-grid">__VIEW_SHELLS__</section>
</main></div>
<script src="__ECHARTS_URL__"></script>
<script id="dashboard-document" type="application/json">__DOCUMENT_JSON__</script>
<script id="dashboard-runtime" type="application/json">__RUNTIME_JSON__</script>
<script>
(function () {
  'use strict';
  const documentSpec = JSON.parse(document.getElementById('dashboard-document').textContent);
  const runtime = JSON.parse(document.getElementById('dashboard-runtime').textContent);
  const dataById = new Map(Object.entries(runtime.data || {}));
  const errorsById = new Map();
  const charts = new Map();
  const parameters = Object.fromEntries(Object.entries(runtime.parameters || {}).map(([key, item]) => [key, item.value ?? item.default ?? null]));
  const liveState = document.getElementById('live-state');
  const notice = document.getElementById('runtime-notice');
  const pending = { id: '', timer: null, sequence: 0 };
  const isLive = window.parent !== window;
  const palette = (runtime.design || {}).palette || ['#4f6980','#f47942','#638b66','#fbb04e','#b66353','#849db1','#b9aa97','#7e756d'];

  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function key(value) { return JSON.stringify(value); }
  function same(a,b) { return key(a) === key(b); }
  function unique(values) { const seen = new Set(); return values.filter(v => { const k = key(v); if (seen.has(k)) return false; seen.add(k); return true; }); }
  function rows(dataId) { return ((dataById.get(dataId) || {}).rows || []).slice(); }
  function viewById(id) { return (runtime.views || []).find(view => view.id === id); }
  function viewStatus(viewId) { return document.querySelector(`[data-status-for="${CSS.escape(viewId)}"]`); }
  function setStatus(viewId, text, kind) { const el = viewStatus(viewId); if (!el) return; el.textContent = text || ''; el.className = `view-status ${kind || ''}`; }
  function showNotice(text) { notice.textContent = text; notice.style.display = 'block'; }
  function clearNotice() { notice.textContent = ''; notice.style.display = 'none'; }

  function renderControls() {
    const host = document.getElementById('parameter-controls');
    host.innerHTML = '';
    Object.entries(runtime.parameters || {}).forEach(([name, item]) => {
      const label = document.createElement('label'); label.className = 'filter-control'; label.htmlFor = `dashboard-parameter-${name}`;
      label.innerHTML = `<span class="filter-label">${esc(item.label || name)}</span>`;
      const select = document.createElement('select'); select.id = `dashboard-parameter-${name}`; select.disabled = !isLive;
      const all = document.createElement('option'); all.value = ''; all.textContent = '全部'; select.appendChild(all);
      (item.options || []).forEach(value => { const option = document.createElement('option'); option.value = String(value); option.textContent = String(value); select.appendChild(option); });
      select.value = parameters[name] == null ? '' : String(parameters[name]);
      select.addEventListener('change', event => setParameter(name, event.target.value === '' ? null : event.target.value));
      label.appendChild(select); host.appendChild(label);
    });
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'reset-button'; reset.textContent = '重置'; reset.disabled = !isLive; reset.addEventListener('click', resetParameters); host.appendChild(reset);
    renderChips();
  }
  function renderChips() {
    const host = document.getElementById('active-chips'); host.innerHTML = '';
    Object.entries(parameters).forEach(([name, value]) => { if (value == null) return; const item = runtime.parameters[name] || {}; const chip = document.createElement('button'); chip.type='button'; chip.className='chip'; chip.textContent=`${item.label || name}: ${value} ×`; chip.disabled=!isLive; chip.addEventListener('click', () => setParameter(name, null)); host.appendChild(chip); });
  }
  function setParameter(name, value) {
    if (!(name in parameters) || pending.id) return;
    const item = runtime.parameters[name] || {};
    if (value !== null && !(item.options || []).some(option => String(option) === String(value))) { showNotice('筛选值不在允许范围内'); return; }
    parameters[name] = value; renderControls();
    if (!isLive) { showNotice('当前为离线快照，实时刷新不可用'); return; }
    const requestId = `v4-${++pending.sequence}`; pending.id = requestId;
    Object.keys(runtime.parameters || {}).forEach(keyName => { const select = document.getElementById(`dashboard-parameter-${keyName}`); if (select) select.disabled = true; });
    (runtime.views || []).forEach(view => setStatus(view.id, '刷新中…', 'loading'));
    pending.timer = setTimeout(() => { pending.id=''; showNotice('实时刷新不可用，已保留当前快照'); renderControls(); }, 8000);
    window.parent.postMessage({ type:'dashboard_parameters_changed', requestId, parameters:{...parameters}, changed:[name] }, '*');
  }
  function resetParameters() {
    if (pending.id) return;
    Object.entries(runtime.parameters || {}).forEach(([name, item]) => { parameters[name] = item.default ?? null; });
    renderControls();
    if (!isLive) { showNotice('当前为离线快照，实时刷新不可用'); return; }
    const requestId = `v4-${++pending.sequence}`; pending.id=requestId;
    (runtime.views || []).forEach(view => setStatus(view.id, '刷新中…', 'loading'));
    pending.timer=setTimeout(() => { pending.id=''; showNotice('实时刷新不可用，已保留当前快照'); renderControls(); },8000);
    window.parent.postMessage({type:'dashboard_parameters_changed',requestId,parameters:{...parameters},changed:null},'*');
  }
  function format(value, format) {
    if (value == null) return '—'; const text=String(format || ''); const match=text.match(/^(number|percent):(\d+)$/); if (!match) return String(value);
    const digits=Number(match[2]); const n=Number(value); if (!Number.isFinite(n)) return String(value); return match[1]==='percent' ? `${n.toFixed(digits)}%` : n.toLocaleString(undefined,{minimumFractionDigits:digits,maximumFractionDigits:digits});
  }
  function aggregate(rowsList, field, agg) { const values=rowsList.map(row=>Number(row[field])).filter(Number.isFinite); if (!values.length) return null; if (agg==='first') return rowsList[0] ? rowsList[0][field] : null; if (agg==='sum') return values.reduce((a,b)=>a+b,0); if (agg==='avg') return values.reduce((a,b)=>a+b,0)/values.length; if (agg==='max') return Math.max(...values); if (agg==='min') return Math.min(...values); return rowsList[0][field]; }
  function renderMetric(view) { const host=document.querySelector(`#view-card-${CSS.escape(view.id)} .metric-grid`); if (!host) return; const result=dataById.get(view.data)||{}; const dataRows=result.rows||[]; host.innerHTML=(view.cards||[]).map(card=>`<div class="metric-card"><div class="metric-label">${esc(card.label||card.field)}${card.unit ? ` (${esc(card.unit)})`:''}</div><div class="metric-value">${esc(format(aggregate(dataRows,card.field,card.agg||'first'),card.format))}</div></div>`).join(''); }
  function renderTable(view) { const host=document.querySelector(`#view-card-${CSS.escape(view.id)} .table-wrap`); if (!host) return; const result=dataById.get(view.data)||{}; const cols=view.columns||[]; host.innerHTML=`<table><thead><tr>${cols.map(col=>`<th>${esc(col.label||col.field)}</th>`).join('')}</tr></thead><tbody>${(result.rows||[]).map(row=>`<tr>${cols.map(col=>`<td>${esc(format(row[col.field],col.format))}</td>`).join('')}</tr>`).join('')}</tbody></table>`; }
  function chartOption(view) { const result=dataById.get(view.data)||{}; const rowsList=result.rows||[]; const x=view.x||{}; const xField=x.field; const xData=unique(rowsList.map(row=>row[xField])); const axes=(view.axes||[]).filter(axis=>String(axis.orient||'y')==='y'); const series=(view.series||[]).map((spec,index)=>{ const byX=new Map(rowsList.map(row=>[String(row[xField]??''),row[spec.field]])); const color=spec.color||palette[index%palette.length]; return {name:spec.name||spec.field,type:spec.mark||'bar',yAxisIndex:Math.max(0,axes.findIndex(axis=>axis.id===spec.axis)),data:xData.map(value=>byX.has(String(value??''))?byX.get(String(value??'')):null),smooth:spec.smooth ?? (spec.mark==='line'),itemStyle:{...(spec.itemStyle||{}),color},lineStyle:{...(spec.lineStyle||{}),color}}; }); return {color:palette,tooltip:{trigger:'axis'},legend:{data:series.map(item=>item.name)},grid:{left:48,right:axes.length>1?58:24,top:54,bottom:42,containLabel:true},xAxis:{type:x.type||'category',data:xData},yAxis:axes.map(axis=>({type:'value',name:axis.name||'',position:axis.position||'left',axisLabel:{formatter:axis.unit?`{value} ${axis.unit}`:'{value}'}})),series}; }
  function renderChart(view) { const host=document.getElementById(`view-chart-${view.id}`); if (!host) return; if (typeof echarts==='undefined') { setStatus(view.id,'图表依赖不可用','error'); return; } const old=charts.get(view.id); if(old && old.dispose) old.dispose(); const chart=echarts.init(host); chart.setOption(chartOption(view)); chart.on('click', params => handleInteraction(view,params)); charts.set(view.id,chart); }
  function handleInteraction(view, params) { const interaction=(runtime.interactions||[]).find(item=>item.source && item.source.view===view.id && item.action && item.action.type==='set_parameter'); if(!interaction) return; const action=interaction.action; const eventField=action.value && action.value.$event; const rowsList=(dataById.get(view.data)||{}).rows||[]; const xField=(view.x||{}).field; const selected=rowsList.find(row=>String(row[xField]??'')===String(params.name??'')); const value=selected ? selected[eventField] : (eventField===xField ? params.name : params.value); const current=parameters[action.parameter]; setParameter(action.parameter, action.toggle && same(current,value) ? null : value); }
  function renderAll() { renderControls(); (runtime.views||[]).forEach(view=>{ if(view.type==='chart') renderChart(view); else if(view.type==='table') renderTable(view); else if(view.type==='metric_cards') renderMetric(view); }); }
  function applyPatch(message) { if(message.requestId!==pending.id) return; clearTimeout(pending.timer); pending.id=''; if(message.parameters) Object.assign(parameters,message.parameters); Object.entries(message.data||{}).forEach(([id,value])=>dataById.set(id,value)); errorsById.clear(); Object.entries(message.errors||{}).forEach(([id,value])=>errorsById.set(id,value)); renderControls(); (runtime.views||[]).forEach(view=>{ const error=errorsById.get(view.data); setStatus(view.id,error ? (error.message||'查询失败') : '',error?'error':''); if(view.type==='chart') renderChart(view); else if(view.type==='table') renderTable(view); else renderMetric(view); }); if(!Object.keys(message.errors||{}).length) clearNotice(); }
  window.addEventListener('message', event => { if(event.source!==window.parent || !event.data || typeof event.data!=='object') return; if(event.data.type==='dashboard_data_patch') applyPatch(event.data); if(event.data.type==='dashboard_data_error' && event.data.requestId===pending.id) { clearTimeout(pending.timer); pending.id=''; showNotice(event.data.message||'实时刷新失败'); renderControls(); } });
  if(isLive) { liveState.textContent='在线数据'; liveState.className='live-state live'; } else { liveState.textContent='离线快照'; liveState.className='live-state offline'; showNotice('当前为离线快照，实时刷新不可用'); }
  window.addEventListener('resize',()=>charts.forEach(chart=>chart.resize())); renderAll();
})();
</script>
</body>
</html>'''
