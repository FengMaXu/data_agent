from __future__ import annotations

from copy import deepcopy
from typing import Any

from src.agent.tool_providers.dashboard_data import DashboardDataset
from src.agent.tool_providers.dashboard_design import (
    COMMERCIAL_PALETTE,
    dashboard_design_tokens,
)


def compile_dashboard_runtime(
    spec: dict[str, Any],
    datasets: dict[str, DashboardDataset],
) -> dict[str, Any]:
    """Compile a Dashboard V3 spec into the canonical V3 runtime payload."""
    return {
        "version": "3",
        "metadata": {
            "title": spec.get("title", ""),
            "theme": spec.get("theme", "light"),
            "layout": deepcopy(spec.get("layout") or {}),
            "filename": spec.get("filename"),
        },
        "datasets": [
            {
                "id": dataset_id,
                "schema": deepcopy(dataset.schema),
                "rows": deepcopy(dataset.rows),
            }
            for dataset_id, dataset in datasets.items()
        ],
        "views": [_compile_runtime_view(view, datasets) for view in spec.get("views", [])],
        "filters": deepcopy(spec.get("filters", [])),
        "interactions": deepcopy(spec.get("interactions", [])),
        "exports": deepcopy(spec.get("exports", [])),
        "design": dashboard_design_tokens(),
        "state": {"filters": {}, "drill_path": []},
    }


def _compile_runtime_view(view: dict[str, Any], datasets: dict[str, DashboardDataset]) -> dict[str, Any]:
    view_type = str(view.get("type") or "")
    if view_type == "metric_cards":
        return _compile_metric_cards_view(view)
    if view_type == "table":
        return _compile_table_view(view, datasets)
    if view_type == "chart":
        return _compile_chart_view(view, datasets)
    if view_type == "pie_chart":
        return _compile_pie_view(view, datasets)
    raise ValueError(f"Unsupported dashboard runtime view type: {view_type}")


def _runtime_view_base(view: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": view.get("id", ""),
        "type": view.get("type", ""),
        "title": view.get("title", ""),
        "subtitle": view.get("subtitle", ""),
        "insight": view.get("insight", ""),
        "source": deepcopy(view.get("source")),
        "annotations": deepcopy(view.get("annotations") or []),
        "reading_mode": view.get("reading_mode"),
        "recipe": view.get("recipe"),
        "layout": deepcopy(view.get("layout") or {}),
    }


def _compile_metric_cards_view(view: dict[str, Any]) -> dict[str, Any]:
    runtime_view = _runtime_view_base(view)
    runtime_view["render"] = {
        "engine": "metric-cards",
        "cards": deepcopy(view.get("cards", [])),
    }
    return runtime_view


def _compile_table_view(view: dict[str, Any], datasets: dict[str, DashboardDataset]) -> dict[str, Any]:
    dataset = datasets[str(view["dataset"])]
    columns = view.get("columns") or [
        {"field": field.get("name"), "label": field.get("name")}
        for field in dataset.schema
    ]
    runtime_view = _runtime_view_base(view)
    runtime_view["dataset"] = dataset.id
    runtime_view["render"] = {"engine": "html-table", "columns": deepcopy(columns)}
    runtime_view["data"] = {"rows": deepcopy(dataset.rows)}
    return runtime_view


def _compile_chart_view(view: dict[str, Any], datasets: dict[str, DashboardDataset]) -> dict[str, Any]:
    dataset = datasets[str(view["dataset"])]
    runtime_view = _runtime_view_base(view)
    runtime_view["dataset"] = dataset.id
    runtime_view["render"] = {
        "engine": "echarts",
        "option": _compile_cartesian_option(view, dataset.rows),
    }
    runtime_view["data"] = {
        "rows": deepcopy(dataset.rows),
        "bindings": {
            "coordinate": view.get("coordinate", "cartesian"),
            "x": deepcopy(view.get("x", {})),
            "axes": deepcopy(view.get("axes", [])),
            "series": deepcopy(view.get("series", [])),
            "series_by": deepcopy(view.get("series_by")),
        },
    }
    return runtime_view


def _compile_pie_view(view: dict[str, Any], datasets: dict[str, DashboardDataset]) -> dict[str, Any]:
    dataset = datasets[str(view["dataset"])]
    name_field = view["name"]["field"]
    value_field = view["value"]["field"]
    runtime_view = _runtime_view_base(view)
    runtime_view["type"] = "chart"
    runtime_view["dataset"] = dataset.id
    runtime_view["render"] = {
        "engine": "echarts",
        "option": {
            "color": COMMERCIAL_PALETTE,
            "tooltip": {"trigger": "item"},
            "legend": {"orient": "vertical", "left": "left"},
            "series": [{
                "name": view.get("title", ""),
                "type": "pie",
                "radius": view.get("radius", "60%"),
                "data": [
                    {"name": row.get(name_field, ""), "value": row.get(value_field, 0)}
                    for row in dataset.rows
                ],
            }],
        },
    }
    runtime_view["data"] = {
        "rows": deepcopy(dataset.rows),
        "bindings": {
            "name": deepcopy(view.get("name", {})),
            "value": deepcopy(view.get("value", {})),
            "radius": view.get("radius", "60%"),
        },
    }
    return runtime_view


def _compile_cartesian_option(view: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    coordinate = str(view.get("coordinate") or "cartesian")
    if coordinate != "cartesian":
        raise ValueError(f"Unsupported chart coordinate: {coordinate}")
    x_field = view["x"]["field"]
    x_type = str(view["x"].get("type") or "category")
    y_axes = _cartesian_y_axes(view)
    axis_index_by_id = {axis["id"]: index for index, axis in enumerate(y_axes)}
    series_specs = view.get("series", [])
    series_by = view.get("series_by")
    align_by_x = x_type == "category" and (
        isinstance(series_by, dict) or any(isinstance(item.get("where"), dict) for item in series_specs)
    )
    if x_type == "category":
        x_data = _unique_values(rows, x_field) if align_by_x else [row.get(x_field, "") for row in rows]
    else:
        x_data = []
    series = _compile_cartesian_series(
        rows,
        x_field,
        x_type,
        x_data,
        series_specs,
        y_axes,
        axis_index_by_id,
        series_by if isinstance(series_by, dict) else None,
        align_by_x=align_by_x,
    )
    return {
        "color": COMMERCIAL_PALETTE,
        "tooltip": {"trigger": "item" if x_type == "value" else "axis"},
        "legend": {"data": [item.get("name") for item in series]},
        "xAxis": {"type": x_type, **({"data": x_data} if x_type == "category" else {})},
        "yAxis": [
            {
                "type": "value",
                "name": axis.get("name", ""),
                "position": axis.get("position", "left"),
                "axisLabel": {"formatter": _axis_formatter(axis.get("unit"))},
            }
            for axis in y_axes
        ],
        "series": series,
    }


def _compile_cartesian_series(
    rows: list[dict[str, Any]],
    x_field: str,
    x_type: str,
    x_data: list[Any],
    series_specs: list[dict[str, Any]],
    y_axes: list[dict[str, Any]],
    axis_index_by_id: dict[str, int],
    series_by: dict[str, Any] | None,
    *,
    align_by_x: bool,
) -> list[dict[str, Any]]:
    if series_by:
        group_field = str(series_by["field"])
        group_values = _ordered_group_values(rows, group_field, series_by.get("order"))
        compiled = []
        for group_index, group_value in enumerate(group_values):
            group_rows = [row for row in rows if _same_value(row.get(group_field), group_value)]
            for spec in series_specs:
                series_index = len(compiled)
                name = _grouped_series_name(series_by, group_value, spec, len(series_specs))
                color = _grouped_series_color(series_by, group_value, group_index)
                compiled.append(_compile_series_spec(
                    spec,
                    group_rows,
                    x_field,
                    x_type,
                    x_data,
                    y_axes,
                    axis_index_by_id,
                    series_index,
                    align_by_x=True,
                    name=name,
                    color=color,
                ))
        return compiled

    compiled = []
    for series_index, spec in enumerate(series_specs):
        spec_rows = _filter_rows(rows, spec.get("where"))
        compiled.append(_compile_series_spec(
            spec,
            spec_rows,
            x_field,
            x_type,
            x_data,
            y_axes,
            axis_index_by_id,
            series_index,
            align_by_x=align_by_x,
        ))
    return compiled


def _compile_series_spec(
    spec: dict[str, Any],
    rows: list[dict[str, Any]],
    x_field: str,
    x_type: str,
    x_data: list[Any],
    y_axes: list[dict[str, Any]],
    axis_index_by_id: dict[str, int],
    series_index: int,
    *,
    align_by_x: bool,
    name: str | None = None,
    color: str | None = None,
) -> dict[str, Any]:
    axis_id = spec.get("axis") or y_axes[0]["id"]
    mark = spec.get("mark") or "bar"
    field = spec["field"]
    series = {
        "name": name or spec.get("name") or field,
        "type": mark,
        "yAxisIndex": axis_index_by_id.get(axis_id, 0),
        "data": (
            [[row.get(x_field), row.get(field)] for row in rows]
            if x_type == "value"
            else _aligned_series_data(rows, x_field, x_data, field) if align_by_x
            else [row.get(field, 0) for row in rows]
        ),
        "smooth": bool(spec.get("smooth", mark == "line")),
    }
    _apply_series_style(series, spec, color, series_index)
    return series


def _apply_series_style(series: dict[str, Any], spec: dict[str, Any], color: str | None, series_index: int) -> None:
    resolved_color = color or spec.get("color")
    for key in ("stack", "barWidth", "symbol", "symbolSize", "label", "areaStyle"):
        if key in spec:
            series[key] = spec[key]
    if resolved_color:
        item_style = dict(spec.get("itemStyle") or {})
        item_style.setdefault("color", resolved_color)
        series["itemStyle"] = item_style
        if series.get("type") in {"line", "scatter"}:
            line_style = dict(spec.get("lineStyle") or {})
            line_style.setdefault("color", resolved_color)
            series["lineStyle"] = line_style
    elif spec.get("itemStyle"):
        series["itemStyle"] = spec["itemStyle"]
    if spec.get("lineStyle") and "lineStyle" not in series:
        series["lineStyle"] = spec["lineStyle"]


def _aligned_series_data(rows: list[dict[str, Any]], x_field: str, x_data: list[Any], value_field: str) -> list[Any]:
    values_by_x = {_value_key(row.get(x_field)): row.get(value_field) for row in rows}
    return [values_by_x.get(_value_key(x_value)) for x_value in x_data]


def _filter_rows(rows: list[dict[str, Any]], where: Any) -> list[dict[str, Any]]:
    if not isinstance(where, dict) or not where:
        return rows
    return [row for row in rows if all(_same_value(row.get(field), expected) for field, expected in where.items())]


def _ordered_group_values(rows: list[dict[str, Any]], field: str, order: Any) -> list[Any]:
    values = _unique_values(rows, field)
    if not isinstance(order, list) or not order:
        return values
    ordered = [value for value in order if any(_same_value(value, current) for current in values)]
    ordered_keys = {_value_key(value) for value in ordered}
    ordered.extend(value for value in values if _value_key(value) not in ordered_keys)
    return ordered


def _unique_values(rows: list[dict[str, Any]], field: str) -> list[Any]:
    values = []
    seen = set()
    for row in rows:
        value = row.get(field, "")
        key = _value_key(value)
        if key in seen:
            continue
        seen.add(key)
        values.append(value)
    return values


def _grouped_series_name(series_by: dict[str, Any], group_value: Any, spec: dict[str, Any], template_count: int) -> str:
    series_name = str(spec.get("name") or spec.get("field") or "")
    template = str(series_by.get("name_template") or "").strip()
    if template:
        return template.replace("{{ value }}", str(group_value)).replace("{{ series }}", series_name)
    if template_count == 1:
        return str(group_value)
    return f"{group_value} {series_name}".strip()


def _grouped_series_color(series_by: dict[str, Any], group_value: Any, group_index: int) -> str | None:
    colors = series_by.get("colors") or series_by.get("color_map")
    if isinstance(colors, dict):
        return colors.get(str(group_value))
    if isinstance(colors, list) and colors:
        return str(colors[group_index % len(colors)])
    return None


def _same_value(left: Any, right: Any) -> bool:
    return _value_key(left) == _value_key(right)


def _value_key(value: Any) -> str:
    return str(value if value is not None else "")


def _cartesian_y_axes(view: dict[str, Any]) -> list[dict[str, Any]]:
    axes = view.get("axes")
    if isinstance(axes, list) and axes:
        y_axes = [
            axis for axis in axes
            if isinstance(axis, dict) and str(axis.get("orient") or axis.get("dimension") or "y") == "y"
        ]
        if y_axes:
            return y_axes
    raise ValueError("cartesian chart views require at least one y axis in axes")


def _axis_formatter(unit: Any) -> str:
    if not unit:
        return "{value}"
    return "{value} " + str(unit)