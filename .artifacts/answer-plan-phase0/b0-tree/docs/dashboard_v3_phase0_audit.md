# Dashboard V3 Phase 0 Audit

## Purpose

Freeze the current Dashboard V3 state before the runtime rewrite. This phase
does not change behavior. It records the compatibility gap that must be fixed
by the following phases.

## Current Public Tool Surface

The public Dashboard provider exposes only:

- `validate_dashboard_spec`
- `build_dashboard`
- `edit_dashboard`

The removed public legacy entry points are not registered:

- `add_chart`
- `remove_chart`

Legacy public input is rejected at the boundary:

- Top-level `charts=[...]`
- `spec.charts`

These guards are intentional migration guards, not supported compatibility
paths.

## Legacy Runtime IR Still In The Execution Path

The public API is V3-only, but the internal runtime model is still the old chart
IR. The current execution path compiles V3 `views` into renderer objects with
legacy names and behavior:

- `charts`
- `chart_type`
- `echarts_option`
- `drilldown_data`
- `charts-data`

Observed locations:

- `src/agent/tool_providers/dashboard_compiler.py`
- `src/agent/tool_providers/dashboard_renderer.py`
- `src/templates/dashboard_template.html`
- `tests/test_dashboard_renderer.py`
- `tests/test_dashboard_browser_smoke.py`
- `tests/test_dashboard_grouped_series.py`
- `tests/test_html_dashboard_provider.py`

## Reproduced Compatibility Gap

`validate_dashboard_spec` accepts a V3 drilldown whose `target_view` is a table.
`build_dashboard` then fails with a raw `KeyError`:

```text
'x'
```

Root cause:

1. The validator only fully validates drilldown `target_view` when
   `target_view.type == "chart"`.
2. The compiler always compiles drilldown `target_view` through the cartesian
   chart path.
3. A table target has no `x` field, so `_compile_cartesian_chart(...)` raises
   `KeyError("x")`.

Baseline test:

- `tests/test_dashboard_v3_phase0_baseline.py::test_phase0_table_drilldown_validates_but_build_fails`

## Phase 0 Acceptance Criteria

- Current public tool surface is documented.
- Legacy runtime IR residue is documented.
- The validate/build mismatch for table drilldown is reproducible by automated
  test.
- The generated dashboard still containing legacy runtime IR is reproducible by
  automated test.
- No production behavior is changed in this phase.
