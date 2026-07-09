# Dashboard V3 Runtime Contract

## Scope

This is the canonical Dashboard V3 contract for the full runtime migration.
Public tools, validation, compilation, rendering, browser runtime, tests, and
skills must align to this contract.

V3 uses ECharts as a rendering engine for chart views. ECharts options are an
internal render artifact, not the public dashboard contract.

## Public Spec

The public tool input is a single `spec` object:

```json
{
  "version": "3",
  "title": "Dashboard title",
  "filename": "dashboard_file_name",
  "layout": {},
  "datasets": [],
  "views": [],
  "filters": [],
  "interactions": [],
  "exports": []
}
```

The only supported public generation path is:

```text
spec.version=3 -> validate -> compile V3 runtime -> render standalone HTML
```

## Rejected Public Inputs

These inputs are not compatibility paths. They are rejected at the boundary:

- top-level `charts`
- `spec.charts`
- public `add_chart`
- public `remove_chart`
- public `chart_type`
- public `echarts_option`
- chart-local public `drilldown`

Boundary rejection is allowed so old callers fail clearly. Runtime dependence
on those shapes is not allowed after the migration.

## Dataset Contract

Each dataset declares where data comes from and which fields exist:

```json
{
  "id": "summary",
  "source": { "type": "csv", "path": "data/summary.csv" },
  "schema": [
    { "name": "category", "type": "string", "role": "dimension" },
    { "name": "sales", "type": "number", "role": "measure", "unit": "yuan" }
  ]
}
```

Runtime datasets preserve typed rows and schema:

```json
{
  "id": "summary",
  "schema": [],
  "rows": []
}
```

## View Contract

Every view has a stable `id`, `type`, optional `title`, optional `subtitle`,
optional `layout`, and type-specific content.

Supported view types:

- `metric_cards`
- `chart`
- `table`

### Chart View

```json
{
  "id": "sales_chart",
  "type": "chart",
  "coordinate": "cartesian",
  "dataset": "summary",
  "x": { "field": "category", "type": "category" },
  "axes": [{ "id": "sales_axis", "orient": "y", "name": "Sales" }],
  "series": [{ "field": "sales", "mark": "bar", "axis": "sales_axis" }]
}
```

Chart runtime view:

```json
{
  "id": "sales_chart",
  "type": "chart",
  "dataset": "summary",
  "render": {
    "engine": "echarts",
    "option": {}
  },
  "data": {
    "rows": [],
    "bindings": {}
  }
}
```

### Table View

```json
{
  "id": "detail_table",
  "type": "table",
  "dataset": "detail",
  "columns": [
    { "field": "item", "label": "Item" },
    { "field": "sales", "label": "Sales" }
  ]
}
```

Table runtime view:

```json
{
  "id": "detail_table",
  "type": "table",
  "dataset": "detail",
  "render": {
    "engine": "html-table",
    "columns": []
  },
  "data": {
    "rows": []
  }
}
```

### Metric Cards View

```json
{
  "id": "kpis",
  "type": "metric_cards",
  "cards": [
    { "label": "Sales", "value": "100", "change": "+5%" }
  ]
}
```

Metric runtime view:

```json
{
  "id": "kpis",
  "type": "metric_cards",
  "render": {
    "engine": "metric-cards",
    "cards": []
  }
}
```

## Interaction Contract

Interactions are first-class Dashboard V3 objects. They are not embedded inside
chart config.

Supported interaction types:

- `drilldown`
- `click-to-filter`
- `filter`
- `navigate-back`

### Drilldown

```json
{
  "id": "drill_to_detail",
  "source": { "view": "sales_chart", "event": "click" },
  "action": {
    "type": "drilldown",
    "target_dataset": "detail",
    "match": {
      "source_field": "category",
      "target_field": "category"
    },
    "target_view": {
      "type": "table",
      "title": "{{ value }} detail",
      "columns": [
        { "field": "item", "label": "Item" },
        { "field": "sales", "label": "Sales" }
      ]
    }
  }
}
```

Drilldown must support at least:

- chart-to-chart
- chart-to-table

The runtime state tracks:

- active filters
- active drill path
- selected source value
- current rows per rendered view
- breadcrumb stack

## Runtime Payload

The HTML template must consume one V3 runtime payload:

```json
{
  "version": "3",
  "metadata": {},
  "datasets": [],
  "views": [],
  "filters": [],
  "interactions": [],
  "state": {
    "filters": {},
    "drill_path": []
  }
}
```

The template should expose this as `dashboard-runtime`, not `charts-data`.

## Non-Goals

The migration does not require replacing ECharts. It requires removing ECharts
options from the public contract and removing old chart IR from the core
runtime model.

## Phase 1 Acceptance Criteria

- This contract defines the single V3 public input path.
- This contract defines supported view and interaction types.
- This contract explicitly separates public spec from internal render artifacts.
- This contract identifies rejected legacy public inputs.
- Later phases can test implementation against this document.
