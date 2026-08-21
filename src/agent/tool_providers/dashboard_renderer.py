from __future__ import annotations

import json
from html import escape
from typing import Any

from src.agent.tool_providers.dashboard_design import dashboard_design_tokens


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
    default_design = dashboard_design_tokens()
    design = runtime.get("design") or default_design
    semantic = {**default_design["semantic"], **(design.get("semantic") or {})}
    view_shells = "\n".join(_runtime_view_shell(view, index) for index, view in enumerate(runtime.get("views", [])))
    layout = metadata.get("layout") or {}
    sidebar_enabled = layout.get("sidebar", True) is not False
    nav_items = "\n".join(
        '<a class="sidebar-link" href="#view-card-{id}">{title}</a>'.format(
            id=escape(str(view.get("id") or index)),
            title=escape(str(view.get("title") or view.get("id") or f"View {index + 1}")),
        )
        for index, view in enumerate(runtime.get("views", []))
    )
    sidebar_html = (
        f'<aside class="sidebar"><div class="sidebar-title">Views</div>{nav_items}</aside>'
        if sidebar_enabled
        else ""
    )
    shell_class = "dashboard-shell" if sidebar_enabled else "dashboard-shell no-sidebar"
    filter_controls = "\n".join(_runtime_filter_control(item, index) for index, item in enumerate(runtime.get("filters", [])))
    filters_html = f'<section class="filter-bar" aria-label="Dashboard filters">{filter_controls}</section>' if filter_controls else ""
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
    :root { --bg: #f6f4ef; --panel: #ffffff; --text: #202124; --muted: #687076; --line: #ded8ce; --primary: __PRIMARY_COLOR__; --accent: __ACCENT_COLOR__; --positive: __POSITIVE_COLOR__; --warning-color: __WARNING_COLOR__; --negative: __NEGATIVE_COLOR__; }
    [data-theme="dark"] { --bg: #151719; --panel: #202326; --text: #f5f6f7; --muted: #aeb4b8; --line: #363b40; --primary: __SECONDARY_COLOR__; }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; background: var(--bg); color: var(--text); }
    button, select { font: inherit; }
    .dashboard-shell { min-height: 100vh; display: grid; grid-template-columns: 240px minmax(0, 1fr); }
    .dashboard-shell.no-sidebar { grid-template-columns: minmax(0, 1fr); }
    .sidebar { border-right: 1px solid var(--line); padding: 20px 16px; background: var(--panel); position: sticky; top: 0; height: 100vh; overflow: auto; }
    .sidebar-title { font-size: 13px; color: var(--muted); text-transform: uppercase; margin-bottom: 12px; }
    .sidebar-link { display: block; color: var(--text); text-decoration: none; padding: 8px 10px; border-radius: 6px; margin-bottom: 4px; }
    .sidebar-link:hover, .sidebar-link:focus-visible { background: color-mix(in srgb, var(--primary) 12%, transparent); outline: none; }
    .main { padding: 22px; min-width: 0; }
    .topbar { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 18px; }
    h1 { font-size: 24px; margin: 0; font-weight: 650; }
    .toolbar-button { border: 1px solid var(--line); background: var(--panel); color: var(--text); border-radius: 6px; padding: 7px 12px; cursor: pointer; }
    .toolbar-button:focus-visible, .filter-select:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .filter-bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin-bottom: 14px; padding: 12px 14px; border: 1px solid var(--line); background: var(--panel); }
    .filter-control { display: grid; gap: 5px; min-width: 180px; }
    .filter-label { color: var(--muted); font-size: 12px; font-weight: 600; }
    .filter-select { width: 100%; min-height: 34px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--text); padding: 6px 30px 6px 9px; }
    .runtime-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; }
    .view-card { grid-column: span var(--view-span, 12); background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px; min-width: 0; overflow: hidden; }
    .view-title { font-size: 16px; font-weight: 650; margin-bottom: 4px; }
    .view-subtitle { font-size: 13px; color: var(--muted); margin-bottom: 10px; }
    .view-insight { border-left: 3px solid var(--accent); padding-left: 10px; margin: 4px 0 12px; font-size: 13px; line-height: 1.5; }
    .annotation-list { display: grid; gap: 6px; margin-top: 12px; }
    .annotation { border-left: 3px solid __NEUTRAL_COLOR__; background: color-mix(in srgb, __NEUTRAL_COLOR__ 8%, transparent); padding: 7px 9px; font-size: 12px; line-height: 1.45; }
    .annotation.positive { border-left-color: var(--positive); }
    .annotation.warning { border-left-color: var(--warning-color); }
    .annotation.negative { border-left-color: var(--negative); }
    .view-source { color: var(--muted); font-size: 11px; margin-top: 12px; overflow-wrap: anywhere; }
    .view-source a { color: inherit; }
    .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
    .metric-card { border: 1px solid var(--line); border-radius: 6px; padding: 12px; background: var(--panel); min-width: 0; }
    .metric-label { color: var(--muted); font-size: 12px; }
    .metric-value { font-size: 22px; font-weight: 700; margin-top: 6px; overflow-wrap: anywhere; }
    .metric-change { color: var(--accent); font-size: 12px; margin-top: 4px; }
    .chart-host { width: 100%; height: 360px; min-height: 260px; }
    .table-wrap { overflow: auto; max-height: 460px; border: 1px solid var(--line); border-radius: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 9px 10px; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap; }
    th { position: sticky; top: 0; background: var(--panel); z-index: 1; }
    .warning { display: none; margin-bottom: 12px; padding: 10px 12px; border: 1px solid var(--negative); color: var(--negative); background: color-mix(in srgb, var(--negative) 8%, transparent); border-radius: 6px; }
    @media (max-width: 860px) { .dashboard-shell { grid-template-columns: 1fr; } .sidebar { position: static; height: auto; } .main { padding: 16px; } .view-card { grid-column: span 12; } }
    @media (max-width: 520px) { .topbar { align-items: flex-start; } h1 { font-size: 21px; } .filter-control { min-width: 100%; } .metric-grid { grid-template-columns: 1fr 1fr; } }
  </style>
</head>
<body>
  <div class="__SHELL_CLASS__">
    __SIDEBAR_HTML__
    <main class="main" id="dashboard-root">
      <div class="topbar"><h1>__TITLE__</h1><div>__PDF_BUTTON__</div></div>
      <div id="dependency-warning" class="warning"></div>
      __FILTERS_HTML__
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
    const dashboardDesign = dashboardRuntime.design || {};
    const palette = dashboardDesign.palette || ['#4F6980', '#F47942', '#638B66', '#FBB04E', '#B66353', '#849DB1', '#B9AA97', '#7E756D'];
    const semantic = dashboardDesign.semantic || { positive: '#638B66', negative: '#B66353' };
    const chartInstances = new Map();
    const datasetsById = new Map((dashboardRuntime.datasets || []).map(dataset => [dataset.id, dataset]));
    const filterState = new Map((dashboardRuntime.filters || []).map(filter => [filter.id, String(filter.default ?? '')]));

    function warn(message) {
      const el = document.getElementById('dependency-warning');
      el.textContent = message;
      el.style.display = 'block';
    }
    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
    }
    function sameValue(left, right) { return String(left ?? '') === String(right ?? ''); }
    function uniqueValues(values) {
      const seen = new Set();
      return values.filter(value => {
        const key = String(value ?? '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    function colorForKey(value) {
      const text = String(value ?? '');
      let hash = 0;
      for (let index = 0; index < text.length; index += 1) hash = ((hash * 31) + text.charCodeAt(index)) >>> 0;
      return palette[hash % palette.length];
    }
    function cssLength(value, fallback = '360px') {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) return `${value}px`;
      if (typeof value === 'string' && /^\\d+(?:\\.\\d+)?(?:px|rem|vh|vw|%)$/.test(value.trim())) return value.trim();
      return fallback;
    }
    function viewCard(viewId) { return document.getElementById(`view-card-${viewId}`); }
    function rowsForDataset(datasetId) { return ((datasetsById.get(datasetId) || {}).rows || []); }
    function filterTargetsView(filter, view) {
      const targets = Array.isArray(filter.targets) ? filter.targets : [];
      return filter.dataset === view.dataset && (!targets.length || targets.includes(view.id));
    }
    function rowsForView(view) {
      let rows = ((view.data && view.data.rows) || []).slice();
      for (const filter of dashboardRuntime.filters || []) {
        if (!filterTargetsView(filter, view)) continue;
        const selected = filterState.get(filter.id) ?? '';
        if (selected !== '') rows = rows.filter(row => sameValue(row[filter.field], selected));
      }
      return rows;
    }

    function renderFilters() {
      for (const filter of dashboardRuntime.filters || []) {
        const select = document.getElementById(`dashboard-filter-${filter.id}`);
        if (!select) continue;
        const values = uniqueValues(rowsForDataset(filter.dataset).map(row => row[filter.field]));
        const allLabel = filter.all_label || '全部';
        const selected = filterState.get(filter.id) ?? '';
        select.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>` + values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
        select.value = selected;
        select.addEventListener('change', event => applyFilter(filter.id, event.target.value));
      }
    }
    function applyFilter(filterId, value) {
      filterState.set(filterId, String(value ?? ''));
      const filter = (dashboardRuntime.filters || []).find(item => item.id === filterId);
      if (!filter) return;
      for (const view of dashboardRuntime.views || []) {
        if (filterTargetsView(filter, view)) resetDrilldown(view.id);
      }
    }

    function renderMetricCards(view) {
      const card = viewCard(view.id);
      const host = card && card.querySelector('.metric-grid');
      if (!host) return;
      host.innerHTML = (view.render.cards || []).map(item => `<div class="metric-card"><div class="metric-label">${escapeHtml(item.label)}</div><div class="metric-value">${escapeHtml(item.value)}</div><div class="metric-change">${escapeHtml(item.change || '')}</div></div>`).join('');
    }
    function renderTable(view) {
      const card = viewCard(view.id);
      const host = card && card.querySelector('.table-wrap');
      if (!host) return;
      const columns = view.render.columns || [];
      const rows = rowsForView(view);
      const head = columns.map(col => `<th>${escapeHtml(col.label || col.field)}</th>`).join('');
      const body = rows.map(row => `<tr>${columns.map(col => `<td>${escapeHtml(row[col.field])}</td>`).join('')}</tr>`).join('');
      host.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }
    function renderChart(view) {
      const host = document.getElementById(`view-chart-${view.id}`);
      if (!host) return;
      if (typeof echarts === 'undefined') { warn('ECharts dependency failed to load.'); return; }
      const existing = chartInstances.get(view.id);
      if (existing && existing.dispose) existing.dispose();
      const chart = echarts.init(host);
      chart.setOption(buildChartOption(view, rowsForView(view)));
      chart.on('click', params => handleDrilldown(view, params));
      chartInstances.set(view.id, chart);
    }
    function buildChartOption(view, rows) {
      const bindings = (view.data && view.data.bindings) || {};
      if (bindings.name && bindings.value) return buildPieOption(view, rows, bindings);
      return buildCartesianOption(bindings, rows, view.recipe);
    }
    function buildPieOption(view, rows, bindings) {
      const nameField = bindings.name.field;
      const valueField = bindings.value.field;
      return {
        color: palette,
        tooltip: { trigger: 'item' },
        legend: { orient: 'vertical', left: 'left' },
        series: [{
          name: view.title || '',
          type: 'pie',
          radius: bindings.radius || '60%',
          data: rows.map(row => ({
            name: row[nameField],
            value: row[valueField],
            itemStyle: { color: colorForKey(row[nameField]) },
          })),
        }],
      };
    }
    function buildCartesianOption(bindings, rows, recipe) {
      const xField = (bindings.x || {}).field;
      const xType = (bindings.x || {}).type || 'category';
      const axes = (bindings.axes || []).filter(axis => String(axis.orient || axis.dimension || 'y') === 'y');
      const seriesSpecs = bindings.series || [];
      const seriesBy = bindings.series_by;
      const xData = xType === 'category' ? uniqueValues(rows.map(row => row[xField])) : [];
      const compiledSeries = [];

      if (seriesBy && seriesBy.field) {
        let groupValues = uniqueValues(rows.map(row => row[seriesBy.field]));
        if (Array.isArray(seriesBy.order) && seriesBy.order.length) {
          const ordered = seriesBy.order.filter(value => groupValues.some(current => sameValue(current, value)));
          groupValues = ordered.concat(groupValues.filter(value => !ordered.some(current => sameValue(current, value))));
        }
        groupValues.forEach((groupValue, groupIndex) => {
          const groupRows = rows.filter(row => sameValue(row[seriesBy.field], groupValue));
          seriesSpecs.forEach(spec => {
            const baseName = spec.name || spec.field || '';
            const template = String(seriesBy.name_template || '');
            const name = template
              ? template.replaceAll('{{ value }}', String(groupValue)).replaceAll('{{ series }}', String(baseName))
              : (seriesSpecs.length === 1 ? String(groupValue) : `${groupValue} ${baseName}`);
            let groupColor;
            if (Array.isArray(seriesBy.colors) && seriesBy.colors.length) groupColor = seriesBy.colors[groupIndex % seriesBy.colors.length];
            else if (seriesBy.colors && typeof seriesBy.colors === 'object') groupColor = seriesBy.colors[String(groupValue)];
            compiledSeries.push(compileSeries(spec, groupRows, xField, xType, xData, axes, name, groupColor || colorForKey(groupValue), recipe));
          });
        });
      } else {
        seriesSpecs.forEach(spec => {
          const filteredRows = spec.where && typeof spec.where === 'object'
            ? rows.filter(row => Object.entries(spec.where).every(([field, expected]) => sameValue(row[field], expected)))
            : rows;
          const name = spec.name || spec.field || '';
          compiledSeries.push(compileSeries(spec, filteredRows, xField, xType, xData, axes, name, spec.color || colorForKey(name), recipe));
        });
      }

      return {
        color: palette,
        tooltip: { trigger: xType === 'value' ? 'item' : 'axis' },
        legend: { data: compiledSeries.map(item => item.name) },
        grid: { left: 48, right: axes.length > 1 ? 54 : 24, top: 54, bottom: 42, containLabel: true },
        xAxis: xType === 'value' ? { type: 'value' } : { type: 'category', data: xData, axisLabel: { hideOverlap: true } },
        yAxis: axes.map(axis => ({
          type: 'value',
          name: axis.name || '',
          position: axis.position || 'left',
          axisLabel: { formatter: axis.unit ? `{value} ${axis.unit}` : '{value}' },
        })),
        series: compiledSeries,
      };
    }
    function compileSeries(spec, rows, xField, xType, xData, axes, name, color, recipe) {
      const mark = spec.mark || 'bar';
      const axisId = spec.axis || ((axes[0] || {}).id);
      const axisIndex = Math.max(0, axes.findIndex(axis => axis.id === axisId));
      const valuesByX = new Map(rows.map(row => [String(row[xField] ?? ''), row[spec.field]]));
      const values = xType === 'value'
        ? rows.map(row => [row[xField], row[spec.field]])
        : xData.map(value => valuesByX.has(String(value ?? '')) ? valuesByX.get(String(value ?? '')) : null);
      const data = recipe === 'positive-negative'
        ? values.map(value => ({ value, itemStyle: { color: Number(value) < 0 ? semantic.negative : semantic.positive } }))
        : values;
      const series = {
        name,
        type: mark,
        yAxisIndex: axisIndex,
        data,
        smooth: spec.smooth ?? (mark === 'line'),
      };
      for (const key of ['stack', 'barWidth', 'symbol', 'symbolSize', 'label', 'areaStyle']) {
        if (spec[key] !== undefined) series[key] = spec[key];
      }
      series.itemStyle = { ...(spec.itemStyle || {}), color };
      if (mark === 'line' || mark === 'scatter') series.lineStyle = { ...(spec.lineStyle || {}), color };
      else if (spec.lineStyle) series.lineStyle = spec.lineStyle;
      return series;
    }

    function findDrilldown(viewId) {
      return (dashboardRuntime.interactions || []).find(item => item && item.source && item.source.view === viewId && item.action && item.action.type === 'drilldown');
    }
    function selectedDrillValue(sourceView, params, sourceField) {
      if (params && params.data && typeof params.data === 'object' && params.data[sourceField] !== undefined) return params.data[sourceField];
      const bindings = (sourceView.data && sourceView.data.bindings) || {};
      if ((bindings.x || {}).field === sourceField) return params && params.name;
      if ((bindings.name || {}).field === sourceField) return params && params.name;
      if ((bindings.series_by || {}).field === sourceField) return params && params.seriesName;
      return params && (params.name ?? params.value);
    }
    function handleDrilldown(sourceView, params) {
      const interaction = findDrilldown(sourceView.id);
      if (!interaction) return;
      const action = interaction.action || {};
      const match = action.match || {};
      const selectedValue = selectedDrillValue(sourceView, params, match.source_field);
      if (selectedValue === undefined || selectedValue === null || selectedValue === '') return;
      const rows = rowsForDataset(action.target_dataset).filter(row => sameValue(row[match.target_field], selectedValue));
      renderDrillTarget(sourceView, action.target_view || {}, action.target_dataset, rows, selectedValue);
    }
    function renderDrillTarget(sourceView, targetView, targetDataset, rows, selectedValue) {
      const card = viewCard(sourceView.id);
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
      const base = {
        id: sourceViewId,
        type: targetView.type,
        title: targetView.title || '',
        dataset: targetDataset,
        layout: targetView.layout || {},
        data: { rows },
      };
      if (targetView.type === 'table') {
        return { ...base, render: { engine: 'html-table', columns: targetView.columns || [] } };
      }
      return {
        ...base,
        type: 'chart',
        render: { engine: 'echarts' },
        data: {
          rows,
          bindings: {
            coordinate: targetView.coordinate || 'cartesian',
            x: targetView.x || {},
            axes: targetView.axes || [],
            series: targetView.series || [],
            series_by: targetView.series_by || null,
          },
        },
      };
    }
    function renderViewBody(body, view) {
      if (!body) return;
      if (view.type === 'table') body.innerHTML = '<div class="table-wrap"></div>';
      else if (view.type === 'chart') body.innerHTML = `<div id="view-chart-${view.id}" class="chart-host" style="height:${cssLength((view.layout || {}).height)}"></div>`;
      else if (view.type === 'metric_cards') body.innerHTML = '<div class="metric-grid"></div>';
    }
    function renderRuntimeView(view) {
      if (view.type === 'metric_cards') renderMetricCards(view);
      else if (view.type === 'table') renderTable(view);
      else if (view.type === 'chart') renderChart(view);
    }
    function resetDrilldown(viewId) {
      const view = (dashboardRuntime.views || []).find(item => item.id === viewId);
      const card = viewCard(viewId);
      if (!view || !card) return;
      const titleEl = card.querySelector('.view-title');
      const breadcrumb = card.querySelector('.drill-breadcrumb');
      const body = card.querySelector('.view-runtime-body');
      if (titleEl) titleEl.textContent = view.title || view.id || '';
      if (breadcrumb) breadcrumb.style.display = 'none';
      const chart = chartInstances.get(viewId);
      if (chart && chart.dispose) chart.dispose();
      chartInstances.delete(viewId);
      renderViewBody(body, view);
      renderRuntimeView(view);
    }
    function renderDashboard() {
      renderFilters();
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
        .replace("__SHELL_CLASS__", shell_class)
        .replace("__SIDEBAR_HTML__", sidebar_html)
        .replace("__FILTERS_HTML__", filters_html)
        .replace("__PRIMARY_COLOR__", semantic["primary"])
        .replace("__ACCENT_COLOR__", semantic["accent"])
        .replace("__POSITIVE_COLOR__", semantic["positive"])
        .replace("__WARNING_COLOR__", semantic["warning"])
        .replace("__NEGATIVE_COLOR__", semantic["negative"])
        .replace("__SECONDARY_COLOR__", semantic["secondary"])
        .replace("__NEUTRAL_COLOR__", semantic["neutral"])
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
    insight = escape(str(view.get("insight") or ""))
    layout = view.get("layout") or {}
    span = layout.get("span", 12)
    subtitle_html = f'<div class="view-subtitle">{subtitle}</div>' if subtitle else ""
    insight_html = f'<div class="view-insight">{insight}</div>' if insight else ""
    annotations_html = "".join(
        '<div class="annotation {tone}">{text}</div>'.format(
            tone=escape(str(annotation.get("tone") or "neutral")),
            text=escape(str(annotation.get("text") or "")),
        )
        for annotation in view.get("annotations", [])
        if isinstance(annotation, dict) and annotation.get("text")
    )
    annotations_html = f'<div class="annotation-list">{annotations_html}</div>' if annotations_html else ""
    source_html = _source_html(view.get("source"))

    if view.get("type") == "metric_cards":
        body = '<div class="metric-grid"></div>'
    elif view.get("type") == "table":
        body = '<div class="table-wrap"></div>'
    else:
        height = escape(_css_length(layout.get("height")))
        body = f'<div id="view-chart-{view_id}" class="chart-host" style="height:{height};"></div>'

    breadcrumb = (
        f'<div class="drill-breadcrumb" style="display:none; gap:8px; align-items:center; margin:8px 0 12px;">'
        f'<button class="toolbar-button" type="button" title="返回" aria-label="返回" '
        f"""onclick="resetDrilldown(this.closest('[data-view-id]').dataset.viewId)">&larr;</button><span></span></div>"""
    )
    return (
        f'        <article id="view-card-{view_id}" class="view-card" style="--view-span:{span};" '
        f'data-view-id="{view_id}"><div class="view-title">{title}</div>{subtitle_html}{insight_html}'
        f'{breadcrumb}<div class="view-runtime-body">{body}</div>{annotations_html}{source_html}</article>'
    )


def _runtime_filter_control(filter_spec: dict[str, Any], index: int) -> str:
    filter_id = escape(str(filter_spec.get("id") or f"filter_{index}"))
    label = escape(str(filter_spec.get("label") or filter_spec.get("field") or filter_id))
    return (
        f'<label class="filter-control" for="dashboard-filter-{filter_id}">'
        f'<span class="filter-label">{label}</span>'
        f'<select class="filter-select" id="dashboard-filter-{filter_id}" data-filter-id="{filter_id}"></select>'
        f'</label>'
    )


def _css_length(value: Any, fallback: str = "360px") -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
        return f"{value:g}px"
    if isinstance(value, str):
        stripped = value.strip()
        for unit in ("px", "rem", "vh", "vw", "%"):
            if stripped.endswith(unit):
                try:
                    if float(stripped[:-len(unit)]) > 0:
                        return stripped
                except ValueError:
                    break
    return fallback


def _source_html(source: Any) -> str:
    if not source:
        return ""
    if isinstance(source, str):
        return f'<div class="view-source">SOURCE · {escape(source)}</div>'
    if not isinstance(source, dict):
        return ""
    label = str(source.get("label") or source.get("url") or "")
    updated_at = str(source.get("updated_at") or "")
    url = str(source.get("url") or "")
    label_html = escape(label)
    if url.startswith(("https://", "http://")):
        label_html = f'<a href="{escape(url)}" target="_blank" rel="noreferrer">{label_html}</a>'
    detail = f" · {escape(updated_at)}" if updated_at else ""
    return f'<div class="view-source">SOURCE · {label_html}{detail}</div>'

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
