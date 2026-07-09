from __future__ import annotations

import json
from html import escape
from typing import Any


DEFAULT_ECHARTS_CDN = "https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"
DEFAULT_HTML2PDF_CDN = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"
DEFAULT_ECHARTS_LOCAL = "assets/echarts.min.js"
DEFAULT_HTML2PDF_LOCAL = "assets/html2pdf.bundle.min.js"


def render_dashboard_runtime_html(
    runtime: dict[str, Any],
    *,
    dashboard_spec: dict[str, Any] | None = None,
    assets: dict[str, Any] | None = None,
    exports: list[dict[str, Any]] | None = None,
) -> str:
    """Render a standalone Dashboard V3 HTML document from a V3 runtime payload."""
    metadata = runtime.get("metadata") or {}
    title = str(metadata.get("title") or "Dashboard")
    theme = str(metadata.get("theme") or "light")
    asset_config = _normalize_assets(assets or {})
    export_config = _normalize_exports(exports)
    view_shells = "\n".join(_runtime_view_shell(view, index) for index, view in enumerate(runtime.get("views", [])))
    nav_items = "\n".join(
        '<a class="sidebar-link" href="#view-card-{id}">{title}</a>'.format(
            id=escape(str(view.get("id") or index)),
            title=escape(str(view.get("title") or view.get("id") or f"View {index + 1}")),
        )
        for index, view in enumerate(runtime.get("views", []))
    )
    pdf_button = '<button class="toolbar-button" onclick="exportPdf()">Export PDF</button>' if export_config.get("pdf") else ""
    html2pdf_script = '<script src="{}"></script>'.format(escape(asset_config["html2pdf_url"])) if export_config.get("pdf") else ""
    export_pdf_function = (
        "function exportPdf() { if (typeof html2pdf === 'undefined') { warn('PDF dependency failed to load.'); return; } html2pdf().from(document.getElementById('dashboard-root')).save(); }"
        if export_config.get("pdf")
        else "function exportPdf() { warn('PDF export is disabled.'); }"
    )
    metadata_json = _json_script_payload({
        **metadata,
        "renderer_version": "dashboard-html-v3-runtime",
        "view_count": len(runtime.get("views", [])),
        "dataset_count": len(runtime.get("datasets", [])),
        "interaction_count": len(runtime.get("interactions", [])),
    })

    template = """<!doctype html>
<html lang="zh-CN" data-theme="__THEME__">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>__TITLE__</title>
  <style>
    :root { --bg: #f6f4ef; --panel: #ffffff; --text: #202124; --muted: #687076; --line: #ded8ce; --accent: #4F6980; }
    [data-theme="dark"] { --bg: #151719; --panel: #202326; --text: #f5f6f7; --muted: #aeb4b8; --line: #363b40; --accent: #849DB1; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; background: var(--bg); color: var(--text); }
    .dashboard-shell { min-height: 100vh; display: grid; grid-template-columns: 240px 1fr; }
    .sidebar { border-right: 1px solid var(--line); padding: 20px 16px; background: var(--panel); position: sticky; top: 0; height: 100vh; overflow: auto; }
    .sidebar-title { font-size: 13px; color: var(--muted); text-transform: uppercase; margin-bottom: 12px; }
    .sidebar-link { display: block; color: var(--text); text-decoration: none; padding: 8px 10px; border-radius: 6px; margin-bottom: 4px; }
    .sidebar-link:hover { background: rgba(79, 105, 128, 0.12); }
    .main { padding: 22px; min-width: 0; }
    .topbar { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 18px; }
    h1 { font-size: 24px; margin: 0; font-weight: 650; }
    .toolbar-button { border: 1px solid var(--line); background: var(--panel); color: var(--text); border-radius: 6px; padding: 7px 12px; cursor: pointer; }
    .runtime-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; }
    .view-card { grid-column: span 12; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px; min-width: 0; }
    .view-card.span-6 { grid-column: span 6; }
    .view-title { font-size: 16px; font-weight: 650; margin-bottom: 4px; }
    .view-subtitle { font-size: 13px; color: var(--muted); margin-bottom: 12px; }
    .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
    .metric-card { border: 1px solid var(--line); border-radius: 6px; padding: 12px; background: var(--panel); }
    .metric-label { color: var(--muted); font-size: 12px; }
    .metric-value { font-size: 22px; font-weight: 700; margin-top: 6px; }
    .metric-change { color: var(--accent); font-size: 12px; margin-top: 4px; }
    .chart-host { width: 100%; height: 360px; min-height: 260px; }
    .table-wrap { overflow: auto; max-height: 460px; border: 1px solid var(--line); border-radius: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 9px 10px; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap; }
    th { position: sticky; top: 0; background: var(--panel); z-index: 1; }
    .warning { display: none; margin-bottom: 12px; padding: 10px 12px; border: 1px solid #B66353; color: #B66353; background: rgba(182, 99, 83, 0.08); border-radius: 6px; }
    @media (max-width: 860px) { .dashboard-shell { grid-template-columns: 1fr; } .sidebar { position: static; height: auto; } .view-card.span-6 { grid-column: span 12; } }
  </style>
</head>
<body>
  <div class="dashboard-shell">
    <aside class="sidebar"><div class="sidebar-title">Views</div>__NAV_ITEMS__</aside>
    <main class="main" id="dashboard-root">
      <div class="topbar"><h1>__TITLE__</h1><div>__PDF_BUTTON__</div></div>
      <div id="dependency-warning" class="warning"></div>
      <section class="runtime-grid">
__VIEW_SHELLS__
      </section>
    </main>
  </div>
  <script src="__ECHARTS_URL__"></script>
  __HTML2PDF_SCRIPT__
  <script id="dashboard-runtime" type="application/json">__RUNTIME_JSON__</script>
  <script id="dashboard-spec" type="application/json">__SPEC_JSON__</script>
  <script id="dashboard-metadata" type="application/json">__METADATA_JSON__</script>
  <script>
    const dashboardRuntime = JSON.parse(document.getElementById('dashboard-runtime').textContent);
    const chartInstances = new Map();
    function warn(message) { const el = document.getElementById('dependency-warning'); el.textContent = message; el.style.display = 'block'; }
    function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch])); }
    function renderMetricCards(view) {
      const host = document.querySelector(`[data-view-id="${view.id}"] .metric-grid`);
      if (!host) return;
      host.innerHTML = (view.render.cards || []).map(card => `<div class="metric-card"><div class="metric-label">${escapeHtml(card.label)}</div><div class="metric-value">${escapeHtml(card.value)}</div><div class="metric-change">${escapeHtml(card.change || '')}</div></div>`).join('');
    }
    function renderTable(view) {
      const host = document.querySelector(`[data-view-id="${view.id}"] .table-wrap`);
      if (!host) return;
      const columns = view.render.columns || [];
      const rows = (view.data && view.data.rows) || [];
      const head = columns.map(col => `<th>${escapeHtml(col.label || col.field)}</th>`).join('');
      const body = rows.map(row => `<tr>${columns.map(col => `<td>${escapeHtml(row[col.field])}</td>`).join('')}</tr>`).join('');
      host.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }
    function renderChart(view) {
      const host = document.getElementById(`view-chart-${view.id}`);
      if (!host) return;
      if (typeof echarts === 'undefined') { warn('ECharts dependency failed to load.'); return; }
      const chart = echarts.init(host);
      chart.setOption(view.render.option || {});
      chart.off('click');
      chart.on('click', params => handleDrilldown(view, params));
      chartInstances.set(view.id, chart);
    }
    const datasetsById = new Map((dashboardRuntime.datasets || []).map(dataset => [dataset.id, dataset]));
    function rowsForDataset(datasetId) { return ((datasetsById.get(datasetId) || {}).rows || []); }
    function sameValue(left, right) { return String(left ?? '') === String(right ?? ''); }
    function findDrilldown(viewId) {
      return (dashboardRuntime.interactions || []).find(item => item && item.source && item.source.view === viewId && item.action && item.action.type === 'drilldown');
    }
    function handleDrilldown(sourceView, params) {
      const interaction = findDrilldown(sourceView.id);
      if (!interaction) return;
      const action = interaction.action || {};
      const match = action.match || {};
      const selectedValue = params && (params.name ?? params.value);
      if (selectedValue === undefined || selectedValue === null || selectedValue === '') return;
      const rows = rowsForDataset(action.target_dataset).filter(row => sameValue(row[match.target_field], selectedValue));
      renderDrillTarget(sourceView, action.target_view || {}, action.target_dataset, rows, selectedValue);
    }
    function renderDrillTarget(sourceView, targetView, targetDataset, rows, selectedValue) {
      const card = document.querySelector(`[data-view-id="${sourceView.id}"]`);
      if (!card) return;
      const titleEl = card.querySelector('.view-title');
      const breadcrumb = card.querySelector('.drill-breadcrumb');
      const crumbText = card.querySelector('.drill-breadcrumb span');
      const body = card.querySelector('.view-runtime-body');
      const title = String(targetView.title || sourceView.title || '').replaceAll('{{ value }}', String(selectedValue));
      if (titleEl) titleEl.textContent = title;
      if (breadcrumb) breadcrumb.style.display = 'flex';
      if (crumbText) crumbText.textContent = String(selectedValue);
      const runtimeTarget = buildRuntimeTargetView(sourceView.id, targetView, targetDataset, rows);
      renderViewBody(body, runtimeTarget);
      renderRuntimeView(runtimeTarget);
    }
    function buildRuntimeTargetView(sourceViewId, targetView, targetDataset, rows) {
      if (targetView.type === 'table') {
        return { id: sourceViewId, type: 'table', dataset: targetDataset, render: { engine: 'html-table', columns: targetView.columns || [] }, data: { rows } };
      }
      return { id: sourceViewId, type: 'chart', dataset: targetDataset, render: { engine: 'echarts', option: buildCartesianOption(targetView, rows) }, data: { rows } };
    }
    function buildCartesianOption(view, rows) {
      const xField = (view.x || {}).field;
      const axes = (view.axes || []).filter(axis => String(axis.orient || axis.dimension || 'y') === 'y');
      const seriesSpecs = view.series || [];
      const xData = [...new Set(rows.map(row => row[xField]))];
      return {
        color: ['#4F6980', '#F47942', '#638B66', '#FBB04E', '#B66353', '#849DB1'],
        tooltip: { trigger: 'axis' },
        legend: { data: seriesSpecs.map(item => item.name || item.field) },
        xAxis: { type: 'category', data: xData },
        yAxis: axes.map(axis => ({ type: 'value', name: axis.name || '', position: axis.position || 'left' })),
        series: seriesSpecs.map(spec => ({ name: spec.name || spec.field, type: spec.mark || 'bar', yAxisIndex: Math.max(0, axes.findIndex(axis => axis.id === spec.axis)), data: xData.map(x => ((rows.find(row => sameValue(row[xField], x)) || {})[spec.field] ?? 0)), smooth: Boolean(spec.smooth || spec.mark === 'line') }))
      };
    }
    function renderViewBody(body, view) {
      if (!body) return;
      if (view.type === 'table') body.innerHTML = '<div class="table-wrap"></div>';
      else if (view.type === 'chart') body.innerHTML = `<div id="view-chart-${view.id}" class="chart-host"></div>`;
      else if (view.type === 'metric_cards') body.innerHTML = '<div class="metric-grid"></div>';
    }
    function renderRuntimeView(view) {
      if (view.type === 'metric_cards') renderMetricCards(view);
      else if (view.type === 'table') renderTable(view);
      else if (view.type === 'chart') renderChart(view);
    }
    function resetDrilldown(viewId) {
      const view = (dashboardRuntime.views || []).find(item => item.id === viewId);
      const card = document.querySelector(`[data-view-id="${viewId}"]`);
      if (!view || !card) return;
      const titleEl = card.querySelector('.view-title');
      const breadcrumb = card.querySelector('.drill-breadcrumb');
      const body = card.querySelector('.view-runtime-body');
      if (titleEl) titleEl.textContent = view.title || view.id || '';
      if (breadcrumb) breadcrumb.style.display = 'none';
      const chart = chartInstances.get(viewId);
      if (chart && chart.dispose) chart.dispose();
      renderViewBody(body, view);
      renderRuntimeView(view);
    }
    function renderDashboard() {
      for (const view of dashboardRuntime.views || []) renderRuntimeView(view);
    }
    __EXPORT_PDF_FUNCTION__
    window.addEventListener('resize', () => chartInstances.forEach(chart => chart.resize()));
    renderDashboard();
  </script>
</body>
</html>"""
    return (template
        .replace("__THEME__", escape(theme))
        .replace("__TITLE__", escape(title))
        .replace("__NAV_ITEMS__", nav_items)
        .replace("__VIEW_SHELLS__", view_shells)
        .replace("__PDF_BUTTON__", pdf_button)
        .replace("__ECHARTS_URL__", escape(asset_config["echarts_url"]))
        .replace("__HTML2PDF_SCRIPT__", html2pdf_script)
        .replace("__RUNTIME_JSON__", _json_script_payload(runtime))
        .replace("__SPEC_JSON__", _json_script_payload(dashboard_spec or {}))
        .replace("__METADATA_JSON__", metadata_json)
        .replace("__EXPORT_PDF_FUNCTION__", export_pdf_function))


def _runtime_view_shell(view: dict[str, Any], index: int) -> str:
    view_id = escape(str(view.get("id") or f"view_{index}"))
    title = escape(str(view.get("title") or view.get("id") or f"View {index + 1}"))
    subtitle = escape(str(view.get("subtitle") or ""))
    layout = view.get("layout") or {}
    span = str(layout.get("span") or "12")
    span_class = " span-6" if span == "6" else ""
    subtitle_html = f'<div class="view-subtitle">{subtitle}</div>' if subtitle else ""
    if view.get("type") == "metric_cards":
        body = '<div class="metric-grid"></div>'
    elif view.get("type") == "table":
        body = '<div class="table-wrap"></div>'
    else:
        height = escape(str(layout.get("height") or "360px"))
        body = f'<div id="view-chart-{view_id}" class="chart-host" style="height: {height};"></div>'
    return f'        <article id="view-card-{view_id}" class="view-card{span_class}" data-view-id="{view_id}"><div class="view-title">{title}</div>{subtitle_html}<div class="drill-breadcrumb" style="display:none; gap:8px; align-items:center; margin:8px 0 12px;"><button class="toolbar-button" onclick="resetDrilldown(\'{view_id}\')">Back</button><span></span></div><div class="view-runtime-body">{body}</div></article>'


def _normalize_assets(assets: dict[str, Any]) -> dict[str, Any]:
    mode = str(assets.get("mode") or "cdn")
    if mode == "local":
        echarts_url = assets.get("echarts_url") or DEFAULT_ECHARTS_LOCAL
        html2pdf_url = assets.get("html2pdf_url") or DEFAULT_HTML2PDF_LOCAL
    else:
        mode = "cdn" if mode not in {"cdn", "custom"} else mode
        echarts_url = assets.get("echarts_url") or DEFAULT_ECHARTS_CDN
        html2pdf_url = assets.get("html2pdf_url") or DEFAULT_HTML2PDF_CDN
    return {"mode": mode, "echarts_url": echarts_url, "html2pdf_url": html2pdf_url}


def _normalize_exports(exports: list[dict[str, Any]] | None) -> dict[str, Any]:
    if exports is None:
        return {"pdf": True}
    return {"pdf": any(item.get("type") == "pdf" and item.get("enabled", True) for item in exports if isinstance(item, dict))}


def _json_script_payload(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False).replace("</", "<\\/")
