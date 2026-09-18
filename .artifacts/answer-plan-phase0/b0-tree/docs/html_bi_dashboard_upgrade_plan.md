# HTML BI Dashboard Tool Upgrade Plan

## 1. Assumptions

1. The dashboard tool is a long-term product capability, not a one-off HTML export helper.
2. The Agent should describe intent with structured data. It should not hand-write large HTML, CSS, or JavaScript.
3. Query results should remain outside the prompt whenever possible. CSV files are still the default data transport because they are compact and already fit the current workflow.
4. The generated HTML must be useful as a standalone artifact and also embeddable in the desktop/chat UI.
5. The tool should support richer BI patterns over time: sidebar navigation, filters, KPI cards, tables, chart grids, drilldown, chart linking, export, theming, and versioned compatibility.

## 2. Target Outcome

The upgraded tool should become a schema-driven dashboard renderer:

Agent intent JSON + workspace data files -> normalized dashboard spec -> validated ECharts/options/data bindings -> HTML renderer -> standalone dashboard file.

The long-term goal is not to adopt the largest BI framework. The goal is to own a stable, model-friendly dashboard contract that can be rendered by different engines later.

## 3. Recommended Direction

Use the existing ECharts-based provider as the foundation and upgrade it into a versioned dashboard rendering layer.

Do not make Amis, Pyecharts, Plotly, PyGWalker, or YData Profiling the primary dashboard path right now.

Reasons:

1. The current project already has `build_dashboard`, `add_chart`, `remove_chart`, CSV data flow, ECharts option generation, and a Jinja HTML template.
2. A controlled schema is easier for an Agent to produce reliably than raw Amis DSL or Python plotting code.
3. ECharts remains the strongest fit for polished chart interaction, drilldown, and standalone HTML output.
4. A custom dashboard schema lets the project keep data transport, security, offline packaging, and UI conventions under its own control.
5. Other tools can still be added as secondary renderers or exploration tools later.

## 4. Architectural Principles

### 4.1 Contract first

Define a versioned dashboard spec before expanding UI features.

Example top-level shape:

```json
{
  "version": "2",
  "title": "Sales Dashboard",
  "description": "Optional short context",
  "theme": "light",
  "layout": {},
  "datasets": [],
  "filters": [],
  "kpis": [],
  "charts": [],
  "tables": [],
  "interactions": [],
  "exports": []
}
```

The tool should accept the legacy `title + charts` shape during migration and normalize it into this richer spec.

### 4.2 Data stays in files

The Agent should write query results to workspace files and reference those files from the spec. Avoid putting full result sets into tool arguments unless the data is tiny.

### 4.3 Renderer isolation

Keep these responsibilities separate:

1. Tool input schema and validation.
2. Dashboard spec normalization.
3. CSV parsing and typed data preparation.
4. Chart option generation.
5. HTML template rendering.
6. Frontend runtime behavior.

This avoids turning `html_dashboard.py` into a large mixed-responsibility file.

### 4.4 Progressive compatibility

Existing calls to `build_dashboard(title, charts=[...])` must keep working during the upgrade. New features should be additive.

### 4.5 Generated HTML should be self-contained enough

The first implementation may continue using CDN scripts, but the design should allow local bundled assets later. The renderer should make external dependencies explicit.

## 5. Feature Scope

### 5.1 Core dashboard structure

1. Sidebar with dashboard sections, chart list, and optional filter panel.
2. Topbar with title, theme switch, export controls, and reset filters.
3. KPI cards for headline metrics.
4. Responsive grid layout for charts.
5. Table blocks for detail data.

### 5.2 Interaction model

1. Global filters: select, multi-select, date range, numeric range.
2. Chart-to-filter interaction: clicking chart points can update a dashboard-level filter.
3. Drilldown: preserve current embedded drilldown support and make it part of the spec.
4. Reset: one action returns the dashboard to its initial state.
5. Cross-chart refresh: charts and tables should respond to filter state consistently.

### 5.3 Quality controls

1. Schema validation errors should be actionable for the Agent.
2. Generated HTML should include a spec version marker.
3. Unit tests should cover legacy compatibility, spec normalization, and rendered HTML markers.
4. Later phases should add browser smoke tests for nonblank charts and responsive layout.

## 6. Phased Development Plan

### Phase 0 - Baseline and decision record

Goal: record the long-term direction and the reasons behind it.

Deliverables:

1. Upgrade plan document.
2. Development log document.

Verification:

1. The plan exists in `docs/html_bi_dashboard_upgrade_plan.md`.
2. The development log exists in `docs/html_bi_dashboard_dev_log.md`.

### Phase 1 - Dashboard spec contract

Goal: introduce a versioned dashboard spec without changing rendered output yet.

Deliverables:

1. Add a small spec/normalization module, for example `src/agent/tool_providers/dashboard_spec.py`.
2. Normalize legacy input into a versioned internal spec.
3. Keep `build_dashboard` legacy behavior compatible.
4. Add focused tests for normalization.

Verification:

1. Legacy `build_dashboard(title, charts=[...])` still passes.
2. New versioned spec input normalizes to the same internal structure.
3. Invalid spec errors name the bad field clearly.

Decision reason:

Start with the contract because all later UI and interaction work depends on stable semantics. This reduces rework and prevents template details from defining the product model accidentally.

### Phase 2 - Renderer boundary cleanup

Goal: separate rendering from tool orchestration.

Deliverables:

1. Move template rendering helpers out of nested functions where practical.
2. Keep chart resolution and file writing small and testable.
3. Preserve public tool names.

Verification:

1. Existing dashboard generation tests still pass.
2. Generated HTML still contains `charts-data`, ECharts script reference, and chart containers.

Decision reason:

The current provider mixes schema, data loading, option building, HTML rendering, and tool responses. Cleaning the boundary before major UI work keeps later changes surgical.

### Phase 3 - Layout v2: sidebar, topbar, KPI area, grid

Goal: improve generated dashboard quality at the template level.

Deliverables:

1. Add sidebar and topbar layout to the HTML template.
2. Add optional KPI cards in the spec.
3. Add chart section metadata for sidebar navigation.
4. Keep legacy charts rendered in the main grid.

Verification:

1. Rendered HTML contains sidebar, topbar, KPI, and grid markers when configured.
2. Legacy dashboards still render without requiring sidebar config.
3. Mobile width does not collapse chart containers into unreadable layout.

Decision reason:

This gives the largest visible quality improvement while keeping data and interaction semantics simple.

### Phase 4 - Filters and dashboard runtime state

Goal: add real BI interaction instead of static chart panels.

Deliverables:

1. Add filter spec: field, source dataset, control type, default value.
2. Add frontend runtime state for active filters.
3. Apply filters to chart and table datasets client-side.
4. Add reset filters action.

Verification:

1. Filter controls appear from spec.
2. Changing a filter updates at least one chart and one table.
3. Reset returns to initial values.

Decision reason:

Filters are the feature that makes the output feel like a BI dashboard rather than a report page. They should be implemented after the layout foundation is stable.

### Phase 5 - Cross-chart interaction and drilldown v2

Goal: formalize interactions across charts.

Deliverables:

1. Add interaction spec for `click-to-filter`, `click-to-drilldown`, and `navigate-back`.
2. Keep the current embedded drilldown path compatible.
3. Add breadcrumb and filter chips as first-class UI.

Verification:

1. Clicking a configured chart point updates dashboard state.
2. Drilldown preserves breadcrumb navigation.
3. Back/reset behavior is predictable.

Decision reason:

Cross-chart interaction is powerful but easy to make inconsistent. It should build on the same runtime state introduced for filters.

### Phase 6 - Export, packaging, and asset strategy

Goal: make output reliable outside the development environment.

Deliverables:

1. Make script/style dependencies explicit in the renderer.
2. Add a strategy flag for CDN vs local assets.
3. Improve PDF/export behavior and filename handling.

Verification:

1. Generated HTML declares its dependency mode.
2. Export controls work for standard dashboards.
3. Missing dependencies produce visible, understandable errors.

Decision reason:

Asset strategy affects desktop packaging and offline usage. It should be handled deliberately after the dashboard runtime is clearer.

### Phase 7 - Quality gates and visual verification

Goal: make regressions visible before users see them.

Deliverables:

1. Add browser smoke tests for generated dashboard HTML.
2. Verify nonblank ECharts containers.
3. Verify desktop and mobile responsive layout.
4. Add sample dashboards as fixtures.

Verification:

1. Automated tests open generated HTML and assert key UI regions render.
2. At least one generated dashboard is visually checked after template changes.

Decision reason:

Visual dashboard bugs are often missed by unit tests. This phase adds confidence once the UI surface is large enough to justify browser-level checks.

## 7. Defer Explicitly

1. Do not migrate the primary renderer to Amis in the first upgrade cycle.
2. Do not require the Agent to write Python plotting code for normal dashboards.
3. Do not add a frontend build system unless the asset strategy requires it.
4. Do not remove legacy `build_dashboard` input support until a migration window is defined.
5. Do not add drag-and-drop dashboard editing inside generated HTML until the read-only BI output is stable.

## 8. Success Criteria

The upgrade is successful when:

1. An Agent can create a dashboard with sidebar, filters, KPI cards, charts, tables, and drilldown using structured tool arguments.
2. The generated HTML works as a standalone file and through `show_widget(kind="file_link")`.
3. Legacy dashboard calls still work.
4. Tests cover the spec contract and rendered HTML structure.
5. Each completed development phase has a log entry with what changed, why, verification, and tradeoffs.

