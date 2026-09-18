# HTML BI Dashboard Tool Development Log

## 2026-05-18 - Dashboard V3 Hard Cutover

### Completed

Removed the legacy dashboard generation path and made the HTML dashboard tool v3-only.

Files changed:

1. `src/agent/tool_providers/html_dashboard.py`
2. `src/agent/tool_providers/dashboard_spec.py`
3. `src/agent/tool_providers/dashboard_compiler.py`
4. `src/agent/tool_providers/dashboard_data.py`
5. `src/agent/tool_providers/chart_builder.py`
6. `.agents/skills/dashboard/SKILL.md`
7. `C:\Users\Negan\.data_agent\skills\dashboard\SKILL.md`
8. `knowledge/agent.md`
9. `tests/test_dashboard_spec.py`
10. `tests/test_html_dashboard_provider.py`

### What changed

1. `build_dashboard` now accepts only `spec.version="3"` with `datasets` and `views`.
2. Top-level `charts=[...]` and `spec.charts` are rejected instead of normalized.
3. Removed public `add_chart` and `remove_chart` tools from the dashboard provider.
4. Removed the legacy chart builder module.
5. Removed `combo_chart`, `cartesian_chart`, `y_axes`, and `tables` compatibility paths from the public spec.
6. Updated project and global dashboard skills so `edit_dashboard` is the only dashboard edit path.

### Decision

Make dashboard generation one product path: v3 spec to compiler to renderer. Do not keep legacy descriptors as a fallback because they give the model a second, weaker route that can contradict the generated output.

### Verification

Commands run:

1. `python -m pytest tests\test_dashboard_spec.py tests\test_html_dashboard_provider.py tests\test_dashboard_renderer.py tests\test_dashboard_browser_smoke.py`
2. `python -m py_compile src\agent\tool_providers\dashboard_spec.py src\agent\tool_providers\dashboard_data.py src\agent\tool_providers\dashboard_compiler.py src\agent\tool_providers\dashboard_renderer.py src\agent\tool_providers\html_dashboard.py`

Results:

1. Focused dashboard tests passed: 16 passed.
2. Python compile check passed.

## 2026-05-18 - Dashboard Palette and Table Runtime Fix

### Completed

Fixed two runtime gaps found in generated v3 HTML dashboards: commercial palette fallback and table view rendering.

Files changed:

1. `src/agent/tool_providers/dashboard_compiler.py`
2. `src/templates/dashboard_template.html`
3. `tests/test_dashboard_renderer.py`
4. `docs/html_bi_dashboard_dev_log.md`

### What changed

1. Added the commercial BI palette as the default compiled ECharts `color` list.
2. Added template-level palette fallback so legacy and v3 charts do not silently fall back to ECharts default blue/green/yellow.
3. Added native HTML table rendering for `chart_type="table"` outputs.
4. Added table filtering support through the existing dashboard filter runtime.
5. Added renderer regression coverage for palette injection and table view markup.

### Verification

Commands run:

1. `python -m pytest tests\test_dashboard_spec.py tests\test_html_dashboard_provider.py tests\test_dashboard_renderer.py tests\test_dashboard_browser_smoke.py`
2. `python -m py_compile src\agent\tool_providers\dashboard_spec.py src\agent\tool_providers\dashboard_data.py src\agent\tool_providers\dashboard_compiler.py src\agent\tool_providers\dashboard_renderer.py src\agent\tool_providers\html_dashboard.py`

Results:

1. Focused dashboard tests passed: 17 passed.
2. Python compile check passed.
3. Backend restarted on `127.0.0.1:8080`; health check returned 200.

## 2026-05-18 - Dashboard Skill Commercial BI Rewrite

### Completed

Fully rewrote `.agents/skills/dashboard/SKILL.md` for the v3 dashboard tool contract and commercial BI dashboard generation.

Files changed:

1. `.agents/skills/dashboard/SKILL.md`
2. `docs/html_bi_dashboard_dev_log.md`

### What changed

1. Replaced the legacy `charts=[...]` and `show_widget` workflow with the v3 `build_dashboard(spec=...)` workflow.
2. Added explicit guidance to use `validate_dashboard_spec` before complex generation and `edit_dashboard` for v3 structural edits.
3. Documented the general chart grammar: `type="chart"`, `coordinate="cartesian"`, `axes`, and `series`.
4. Added reusable dataset, KPI, cartesian chart, table, and drilldown examples.
5. Integrated the visual principles and palette from `设计原则及配色方案.md`.
6. Added commercial layout, chart selection, interaction, accessibility, error handling, and final delivery standards.

### Decision

Make the skill teach analysts and the LLM the product-level dashboard contract, not a sample-specific dual-axis chart recipe.

### Decision reasons

1. The skill should guide broad BI generation across trends, comparisons, structure, ranking, details, and drilldowns.
2. A single v3 spec workflow is easier to validate and maintain than mixing old chart descriptors, widget previews, and raw ECharts escape hatches.
3. Commercial BI quality depends on design discipline as much as tool invocation, so layout and palette rules belong in the skill.

### Verification

Manual checks:

1. Confirmed the rewritten skill renders as UTF-8 text.
2. Confirmed old `show_widget` guidance was removed.
3. Confirmed `validate_dashboard_spec`, `build_dashboard`, and `edit_dashboard` are present.

## 2026-05-18 - Phase v3 Foundation: Spec, Cartesian Chart, and Drilldown Path

### Completed

Implemented the first production-oriented HTML dashboard tool foundation from `docs/html_dashboard_tool_refactor_plan.md`.

Files changed:

1. `src/agent/tool_providers/dashboard_spec.py`
2. `src/agent/tool_providers/dashboard_data.py`
3. `src/agent/tool_providers/dashboard_compiler.py`
4. `src/agent/tool_providers/dashboard_renderer.py`
5. `src/agent/tool_providers/html_dashboard.py`
6. `src/templates/dashboard_template.html`
7. `tests/test_dashboard_spec.py`
8. `tests/test_html_dashboard_provider.py`
9. `tests/test_dashboard_renderer.py`

### What changed

1. Added version 3 dashboard spec validation for `datasets`, `views`, and `interactions`.
2. Added the `validate_dashboard_spec` tool so complex dashboard specs can be checked before rendering.
3. Added typed CSV dataset loading in `dashboard_data.py`.
4. Added `dashboard_compiler.py` and implemented generic cartesian chart compilation to ECharts bar/line dual-axis options.
5. Wired `build_dashboard(spec=...)` so v3 `views` compile into the existing renderer format.
6. Added drilldown compilation for v3 interactions where a parent chart can drill into a child chart.
7. Embedded `dashboard-spec` and `dashboard-metadata` JSON blocks in generated HTML.
8. Updated the template filter rebuild path so cartesian charts preserve each series mark type.

### Decision

Use a compatibility bridge first: compile v3 BI views into the current chart object model instead of replacing the full HTML runtime immediately.

### Decision reasons

1. This makes the target acceptance path available without a risky template rewrite.
2. Existing legacy chart generation, preview, and browser smoke tests stay compatible.
3. The embedded canonical spec creates the foundation for a later structural `edit_dashboard` tool.

### Verification

Commands run:

1. `python -m pytest tests\test_dashboard_spec.py tests\test_html_dashboard_provider.py tests\test_dashboard_renderer.py tests\test_dashboard_browser_smoke.py`
2. `python -m py_compile src\agent\tool_providers\dashboard_spec.py src\agent\tool_providers\dashboard_data.py src\agent\tool_providers\dashboard_compiler.py src\agent\tool_providers\dashboard_renderer.py src\agent\tool_providers\html_dashboard.py`

Results:

1. Focused dashboard tests passed: 13 passed.
2. Python compile check passed.

## 2026-05-18 - Phase v3 Structural Editing and Drilldown Browser QA

### Completed

Extended the v3 dashboard foundation with structural editing and browser-level drilldown verification.

Files changed:

1. `src/agent/tool_providers/html_dashboard.py`
2. `tests/test_html_dashboard_provider.py`
3. `tests/test_dashboard_browser_smoke.py`

### What changed

1. Added the `edit_dashboard` tool.
2. `edit_dashboard` reads the embedded `dashboard-spec`, applies structured operations, and re-renders the dashboard.
3. Supported operations:
   - `add_view`, `replace_view`, `remove_view`
   - `add_interaction`, `replace_interaction`, `remove_interaction`
   - `add_dataset`, `replace_dataset`, `remove_dataset`
4. Updated `remove_chart` so v3 dashboards remove views from the embedded spec and re-render instead of falling back to legacy chart JSON mutation.
5. Added provider tests for replacing a v3 view and removing a v3 view.
6. Added browser smoke coverage that simulates an ECharts click and verifies drilldown replaces the option and shows the breadcrumb.

### Decision

Keep `add_chart` as a legacy compatibility path for now, and introduce `edit_dashboard` as the production path for v3 dashboards.

### Decision reasons

1. Existing users may still call `add_chart` with legacy chart descriptors.
2. Complex BI dashboards need structural edits against the canonical spec, not regex mutation of generated HTML.
3. Keeping both paths avoids breaking legacy workflows while giving new workflows a reliable editing API.

### Verification

Commands run:

1. `python -m pytest tests\test_dashboard_spec.py tests\test_html_dashboard_provider.py tests\test_dashboard_renderer.py tests\test_dashboard_browser_smoke.py`
2. `python -m py_compile src\agent\tool_providers\dashboard_spec.py src\agent\tool_providers\dashboard_data.py src\agent\tool_providers\dashboard_compiler.py src\agent\tool_providers\dashboard_renderer.py src\agent\tool_providers\html_dashboard.py`

Results:

1. Focused dashboard tests passed: 16 passed.
2. Python compile check passed.

## 2026-05-18 - Phase v3 General Chart Grammar

### Completed

Converted the public v3 dashboard chart contract from a special-purpose combination chart shape into a general chart grammar.

Files changed:

1. `src/agent/tool_providers/dashboard_spec.py`
2. `src/agent/tool_providers/dashboard_compiler.py`
3. `src/agent/tool_providers/html_dashboard.py`
4. `src/templates/dashboard_template.html`
5. `tests/test_dashboard_spec.py`
6. `tests/test_html_dashboard_provider.py`
7. `tests/test_dashboard_browser_smoke.py`
8. `docs/html_dashboard_tool_refactor_plan.md`

### What changed

1. Public v3 specs now use `type="chart"`, `coordinate="cartesian"`, `axes`, and `series`.
2. `series.mark` drives bar, line, and future mark compilation instead of a dedicated combo-chart API.
3. `combo_chart` remains only as a compatibility alias for older generated specs.
4. Runtime compiled charts now use internal `chart_type="cartesian"`.
5. Template filtering preserves per-series marks for cartesian charts during filter and drilldown rebuilds.

### Decision

Use one extensible chart grammar for analysts and generated specs. Treat named variants like dual-axis and mixed bar-line charts as configurations of the same grammar, not separate tools.

### Decision reasons

1. Data analysts need a general BI contract that can grow to scatter, area, stacked, multi-axis, and drilldown workflows.
2. A single grammar reduces skill prompt burden and avoids teaching the model special-case tool names.
3. Compatibility aliases keep older specs working without making them the product design center.

### Verification

Commands run:

1. `python -m pytest tests\test_dashboard_spec.py tests\test_html_dashboard_provider.py tests\test_dashboard_renderer.py tests\test_dashboard_browser_smoke.py`
2. `python -m py_compile src\agent\tool_providers\dashboard_spec.py src\agent\tool_providers\dashboard_data.py src\agent\tool_providers\dashboard_compiler.py src\agent\tool_providers\dashboard_renderer.py src\agent\tool_providers\html_dashboard.py`

Results:

1. Focused dashboard tests passed: 16 passed.
2. Python compile check passed.

## 2026-04-27 - Phase 0: Baseline and direction

### Completed

Created the long-term upgrade plan for the HTML BI dashboard tool.

Files added:

1. `docs/html_bi_dashboard_upgrade_plan.md`
2. `docs/html_bi_dashboard_dev_log.md`

### Current project facts

The current implementation already has the right strategic direction:

1. `src/agent/tool_providers/html_dashboard.py` exposes `build_dashboard`, `add_chart`, and `remove_chart`.
2. `src/agent/tool_providers/chart_builder.py` converts declarative chart descriptions plus CSV content into ECharts options.
3. `src/templates/dashboard_template.html` renders standalone HTML with ECharts.
4. `.agents/skills/dashboard/SKILL.md` instructs the Agent to use SQL, CSV files, `build_dashboard`, and `show_widget`.

### Decision

Continue with a schema-driven ECharts renderer as the primary path. Do not replace the primary dashboard tool with Amis, Pyecharts, Plotly, PyGWalker, or YData Profiling in this upgrade cycle.

### Decision reasons

1. The project already has a working declarative dashboard provider, so replacing it would create migration risk without solving the core problem.
2. The current weakness is not the chart engine. The weakness is the dashboard contract, layout template, and interaction runtime.
3. ECharts remains a strong charting engine for standalone HTML, drilldown, and polished BI interactions.
4. A project-owned dashboard schema is more controllable and model-friendly than asking the Agent to emit a large third-party DSL.
5. Keeping CSV as the data transport avoids pushing large datasets through LLM tool arguments.

### Tradeoffs

This path requires us to implement more dashboard runtime code ourselves. The benefit is stronger control over compatibility, generated quality, security posture, and offline packaging.

Amis remains a possible future renderer, but only after the project-owned dashboard spec is stable.

### Verification

Phase 0 verification is document-level:

1. Upgrade plan created.
2. Development log created.
3. The next implementation phase is clearly defined as the dashboard spec contract.

## 2026-04-27 - Phase 1: Dashboard spec contract

### Completed

Added the first version of the dashboard spec normalization layer.

Files changed:

1. `src/agent/tool_providers/dashboard_spec.py`
2. `src/agent/tool_providers/html_dashboard.py`
3. `tests/test_dashboard_spec.py`

### What changed

`build_dashboard` now normalizes incoming arguments before resolving charts. The legacy input shape still works:

```json
{
  "title": "Sales",
  "theme": "dark",
  "filename": "sales_dashboard",
  "charts": []
}
```

The tool can also accept a versioned spec through `spec`:

```json
{
  "spec": {
    "version": "2",
    "title": "Operations",
    "layout": {},
    "filters": [],
    "charts": []
  }
}
```

The new normalizer fills stable defaults for future dashboard sections:

1. `layout`
2. `datasets`
3. `filters`
4. `kpis`
5. `tables`
6. `interactions`
7. `exports`

### Decision

Introduce the contract before changing the HTML template.

### Decision reasons

1. Sidebar, filters, KPI cards, and interaction features need stable dashboard semantics before UI work begins.
2. Keeping the generated HTML unchanged in this phase isolates risk to input normalization.
3. Legacy compatibility is easier to preserve when old inputs are normalized into the same internal shape as new inputs.
4. Tests can now target the contract directly instead of relying only on generated HTML markers.

### Tradeoffs

The v2 spec fields are normalized but not fully rendered yet. This is intentional. Rendering will be added phase by phase after the contract is stable.

The validation is deliberately small: it checks the fields needed by the current renderer and leaves deeper schema rules for later phases.

### Verification

Commands run:

1. `python -m pytest tests\test_dashboard_spec.py`
2. `python -m py_compile src\agent\tool_providers\dashboard_spec.py src\agent\tool_providers\html_dashboard.py`
3. `python test_dashboard.py`

Results:

1. Dashboard spec tests passed: 4 passed.
2. Python compile check passed.
3. Existing dashboard script passed all four checks: build dashboard, add chart, drilldown, and custom ECharts fallback.

## 2026-04-27 - Phase 2: Renderer boundary cleanup

### Completed

Separated dashboard HTML rendering from tool orchestration.

Files changed:

1. `src/agent/tool_providers/dashboard_renderer.py`
2. `src/agent/tool_providers/html_dashboard.py`
3. `tests/test_dashboard_renderer.py`

### What changed

Added `dashboard_renderer.py` with two renderer responsibilities:

1. `render_dashboard_html(...)` renders the full dashboard HTML from the Jinja template.
2. `build_chart_card_html(...)` builds the chart card HTML used by `add_chart`.

`html_dashboard.py` now delegates rendering to this module. It still owns tool definitions, workspace file reads/writes, chart resolution, and tool result formatting.

### Decision

Only extract the existing rendering boundary. Do not redesign the template, layout, sidebar, or runtime interactions in this phase.

### Decision reasons

1. The phase goal was to reduce coupling before changing UI behavior.
2. Moving renderer code first makes Phase 3 layout work easier to test and review.
3. Keeping generated HTML behavior unchanged protects legacy users while internal boundaries improve.
4. The new renderer tests provide a stable place to add layout assertions later.

### Tradeoffs

The provider still contains chart resolution and some HTML mutation logic for `add_chart`. That is acceptable for now because Phase 2 targeted renderer isolation only. A later phase can move dashboard document mutation into a dedicated module if `add_chart` grows more complex.

### Verification

Commands run:

1. `python -m pytest tests\test_dashboard_spec.py tests\test_dashboard_renderer.py`
2. `python -m py_compile src\agent\tool_providers\dashboard_spec.py src\agent\tool_providers\dashboard_renderer.py src\agent\tool_providers\html_dashboard.py`
3. `python test_dashboard.py`

Results:

1. Focused tests passed: 6 passed.
2. Python compile check passed.
3. Existing dashboard script passed all four checks: build dashboard, add chart, drilldown, and custom ECharts fallback.

## 2026-04-27 - Phase 6: Asset and export strategy

### Completed

Made dashboard script dependencies and export behavior explicit.

Files changed:

1. `src/agent/tool_providers/dashboard_renderer.py`
2. `src/agent/tool_providers/html_dashboard.py`
3. `src/templates/dashboard_template.html`
4. `tests/test_dashboard_renderer.py`

### What changed

The renderer now accepts an `assets` object:

```json
{
  "mode": "cdn",
  "echarts_url": "https://...",
  "html2pdf_url": "https://..."
}
```

Supported modes are:

1. `cdn`: default CDN URLs.
2. `local`: local relative asset paths.
3. `custom`: caller-provided URLs.

The renderer also accepts `exports`. PDF export is enabled by default for legacy compatibility. Passing an empty `exports` list disables the PDF button, script, and function.

The template now declares the selected asset mode with `data-assets-mode`, loads scripts from renderer-provided URLs, and shows an in-page dependency warning if ECharts or html2pdf fails to load.

### Decision

Define the asset strategy interface before bundling local JavaScript files.

### Decision reasons

1. The project does not yet have a committed vendor asset directory or packaging convention for dashboard HTML dependencies.
2. Downloading or vendoring third-party assets in this phase would create a packaging decision larger than the dashboard renderer itself.
3. Making dependencies explicit now removes hidden CDN assumptions and gives desktop/offline packaging a stable integration point later.
4. Keeping CDN as the default preserves current behavior while allowing local mode when assets are available.

### Tradeoffs

`local` mode currently points to expected relative paths; it does not create those files. That is intentional. The next packaging-focused change should decide where local assets live and how they are copied into generated dashboard folders.

The dependency warning is runtime-visible but not yet browser-tested. Browser-level checks remain part of the planned visual verification phase.

### Verification

Commands run:

1. `python -m pytest tests\test_dashboard_spec.py tests\test_dashboard_renderer.py`
2. `python -m py_compile src\agent\tool_providers\chart_builder.py src\agent\tool_providers\dashboard_spec.py src\agent\tool_providers\dashboard_renderer.py src\agent\tool_providers\html_dashboard.py`
3. `python test_dashboard.py`

Results:

1. Focused tests passed: 7 passed.
2. Python compile check passed.
3. Existing dashboard script passed all four checks: build dashboard, add chart, drilldown, and custom ECharts fallback.

## 2026-04-27 - Phase 7: Quality gates and browser smoke test

### Completed

Added a browser-level smoke test for generated dashboard HTML.

Files changed:

1. `tests/test_dashboard_browser_smoke.py`

### What changed

The new test renders a generated dashboard through Playwright Chromium and verifies:

1. The dashboard shell is present.
2. The sidebar is present.
3. A filter control is present.
4. The chart card exists.
5. The chart container is initialized by an ECharts-compatible runtime.
6. The dependency warning remains hidden when assets load successfully.

The test uses `data:` JavaScript URLs with small ECharts/html2pdf stubs. This avoids network dependency and keeps the smoke test focused on generated HTML structure and runtime wiring.

### Decision

Use a browser smoke test with stubbed chart/export libraries instead of loading real CDN dependencies.

### Decision reasons

1. Browser verification should not depend on external network availability.
2. The dashboard renderer needs a fast structural/runtime check before full visual regression testing.
3. Stubbing ECharts confirms the template calls the expected initialization path without making the test brittle against ECharts internals.
4. Real screenshot comparison can be added later once the visual design stabilizes further.

### Tradeoffs

This is not a full visual regression test. It does not compare screenshots, inspect rendered canvas pixels, or validate actual ECharts drawing quality. It proves that the generated dashboard boots in a browser and core DOM/runtime paths are connected.

### Verification

Commands run:

1. `python -m pytest tests\test_dashboard_spec.py tests\test_dashboard_renderer.py tests\test_dashboard_browser_smoke.py`
2. `python -m py_compile src\agent\tool_providers\chart_builder.py src\agent\tool_providers\dashboard_spec.py src\agent\tool_providers\dashboard_renderer.py src\agent\tool_providers\html_dashboard.py tests\test_dashboard_browser_smoke.py`
3. `python test_dashboard.py`

Results:

1. Focused tests and browser smoke passed: 8 passed.
2. Python compile check passed.
3. Existing dashboard script passed all four checks: build dashboard, add chart, drilldown, and custom ECharts fallback.

## 2026-04-27 - Phase 5: Click-to-filter interaction

### Completed

Added the first declarative cross-chart interaction: `click-to-filter`.

Files changed:

1. `src/agent/tool_providers/dashboard_renderer.py`
2. `src/agent/tool_providers/html_dashboard.py`
3. `src/templates/dashboard_template.html`
4. `tests/test_dashboard_renderer.py`

### What changed

The renderer now accepts `interactions` and emits an `interactions-data` JSON block.

The dashboard runtime now supports interaction entries like:

```json
{
  "type": "click-to-filter",
  "chart_title": "Revenue",
  "filter_id": "region"
}
```

When a configured chart point is clicked, the runtime updates the target filter, updates the visible filter control, and reapplies dashboard filters.

### Decision

Keep embedded drilldown higher priority than `click-to-filter`.

### Decision reasons

1. Existing dashboards already rely on click behavior for drilldown.
2. Drilldown is a chart-local navigation action, while click-to-filter is dashboard-level state. Preserving drilldown priority avoids surprising behavior for current outputs.
3. Reusing the Phase 4 filter runtime keeps cross-chart interaction consistent instead of adding a separate state path.

### Tradeoffs

This phase supports one clear interaction type. It does not yet implement multiple simultaneous interactions per click, filter chips, or richer conflict resolution. Those can be added once real dashboard specs show the patterns users need.

### Verification

Commands run:

1. `python -m pytest tests\test_dashboard_spec.py tests\test_dashboard_renderer.py`
2. `python -m py_compile src\agent\tool_providers\chart_builder.py src\agent\tool_providers\dashboard_spec.py src\agent\tool_providers\dashboard_renderer.py src\agent\tool_providers\html_dashboard.py`
3. `python test_dashboard.py`

Results:

1. Focused tests passed: 6 passed.
2. Python compile check passed.
3. Existing dashboard script passed all four checks: build dashboard, add chart, drilldown, and custom ECharts fallback.

## 2026-04-27 - Phase 4: Global filters and dashboard runtime state

### Completed

Added the first dashboard-level filter runtime.

Files changed:

1. `src/agent/tool_providers/chart_builder.py`
2. `src/agent/tool_providers/dashboard_renderer.py`
3. `src/agent/tool_providers/html_dashboard.py`
4. `src/templates/dashboard_template.html`
5. `tests/test_dashboard_renderer.py`

### What changed

The renderer now accepts `filters` and emits a `filters-data` JSON block.

The dashboard template now includes:

1. Sidebar filter controls.
2. A reset filters action.
3. `activeFilters` runtime state.
4. Client-side filtering for charts that include `source_rows`.
5. Rebuilding support for `bar`, `line`, and `pie` charts.

The provider now preserves parsed CSV rows and chart field mappings inside each resolved chart. This lets generated HTML recompute chart options without another Agent/tool call.

`chart_builder.py` now exposes `parse_csv_rows(...)` so CSV parsing remains shared instead of being duplicated in the provider.

### Decision

Implement filter state at the dashboard runtime layer and preserve source rows for non-custom charts.

### Decision reasons

1. Existing ECharts options are already rendered data, so they cannot be reliably filtered after the fact.
2. Keeping source rows with chart metadata gives the standalone HTML enough information to update itself.
3. This approach keeps the Agent contract simple: it only names filter fields, while the renderer derives options when needed.
4. Sharing CSV parsing avoids a second parser with subtly different behavior.

### Tradeoffs

The generated HTML is larger because it now embeds `source_rows` for non-custom charts. This is acceptable for Phase 4 because the current tool targets standalone dashboards and already embeds chart data in HTML.

The first runtime supports `bar`, `line`, and `pie`. `scatter`, `radar`, `custom`, tables, and cross-chart click-to-filter are intentionally deferred. Those need more explicit semantics and belong in later interaction phases.

### Verification

Commands run:

1. `python -m pytest tests\test_dashboard_spec.py tests\test_dashboard_renderer.py`
2. `python -m py_compile src\agent\tool_providers\chart_builder.py src\agent\tool_providers\dashboard_spec.py src\agent\tool_providers\dashboard_renderer.py src\agent\tool_providers\html_dashboard.py`
3. `python test_dashboard.py`

Results:

1. Focused tests passed: 6 passed.
2. Python compile check passed.
3. Existing dashboard script passed all four checks: build dashboard, add chart, drilldown, and custom ECharts fallback.

## 2026-04-27 - Phase 3: Layout v2 foundation

### Completed

Added the first version of the richer dashboard layout.

Files changed:

1. `src/agent/tool_providers/dashboard_renderer.py`
2. `src/agent/tool_providers/html_dashboard.py`
3. `src/templates/dashboard_template.html`
4. `tests/test_dashboard_renderer.py`

### What changed

The dashboard renderer now accepts optional `layout` and `kpis` inputs.

The HTML template now includes:

1. A dashboard shell layout.
2. A left sidebar with chart navigation links.
3. A top header with title and existing theme/export actions.
4. An optional KPI card section.
5. Chart card anchors for sidebar navigation.
6. Responsive behavior for narrower screens.

Legacy dashboards still render without requiring new fields. By default, the renderer enables the sidebar and builds chart navigation from the chart titles.

### Decision

Implement layout structure before filters and cross-chart state.

### Decision reasons

1. The previous output quality issue was partly structural: the dashboard looked like a set of cards, not a BI workspace.
2. Sidebar, topbar, KPI, and chart anchors are stable UI regions that later phases can reuse for filters, state chips, reset actions, and section navigation.
3. Adding layout before interactive filtering keeps Phase 4 focused on data/state behavior rather than visual restructuring.
4. The default sidebar improves legacy dashboards without requiring the Agent to learn new fields immediately.

### Tradeoffs

The sidebar currently lists charts only. It does not yet host filters because filter state belongs to Phase 4.

`add_chart` can insert a new chart card into both old and new dashboard layouts. The sidebar navigation for incrementally added charts is not yet fully regenerated from a stored dashboard spec. This is acceptable for Phase 3 because `add_chart` already works as an HTML mutation tool; a later dashboard document model can make incremental edits fully structural.

### Verification

Commands run:

1. `python -m pytest tests\test_dashboard_spec.py tests\test_dashboard_renderer.py`
2. `python -m py_compile src\agent\tool_providers\dashboard_spec.py src\agent\tool_providers\dashboard_renderer.py src\agent\tool_providers\html_dashboard.py`
3. `python test_dashboard.py`

Results:

1. Focused tests passed: 6 passed.
2. Python compile check passed.
3. Existing dashboard script passed all four checks: build dashboard, add chart, drilldown, and custom ECharts fallback.
