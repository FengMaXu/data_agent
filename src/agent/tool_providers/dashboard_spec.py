from __future__ import annotations

from copy import deepcopy
from typing import Any

from src.agent.tool_providers.dashboard_recipes import validate_dashboard_recipe


CURRENT_DASHBOARD_SPEC_VERSION = "3"

_LIST_FIELDS = (
    "datasets",
    "filters",
    "kpis",
    "views",
    "interactions",
    "exports",
)


def normalize_dashboard_arguments(arguments: dict[str, Any]) -> dict[str, Any]:
    """Return a normalized dashboard v3 spec.

    New dashboard generation accepts only the versioned `spec` contract. The
    older `charts=[...]` descriptor format is intentionally rejected so the
    model cannot silently fall back to a weaker generation path.
    """
    if not isinstance(arguments, dict):
        raise ValueError("arguments must be an object")
    if "charts" in arguments:
        raise ValueError("legacy charts input is no longer supported; use spec.version='3' with datasets and views")

    raw_spec = arguments.get("spec")
    if raw_spec is None:
        if "version" in arguments or "datasets" in arguments or "views" in arguments:
            raw_spec = arguments
        else:
            raise ValueError("spec is required")
    if not isinstance(raw_spec, dict):
        raise ValueError("spec must be an object")

    spec = deepcopy(raw_spec)
    if "filename" not in spec and arguments.get("filename"):
        spec["filename"] = arguments["filename"]
    return _normalize_spec(spec)


def validate_dashboard_spec(spec: dict[str, Any]) -> list[str]:
    """Validate a normalized dashboard spec and return non-fatal warnings."""
    normalized = _normalize_spec(spec)
    return _collect_dashboard_warnings(normalized)


def _normalize_spec(spec: dict[str, Any]) -> dict[str, Any]:
    normalized = deepcopy(spec)

    version = str(normalized.get("version") or CURRENT_DASHBOARD_SPEC_VERSION)
    if version != CURRENT_DASHBOARD_SPEC_VERSION:
        raise ValueError(f"unsupported dashboard spec version: {version}")
    normalized["version"] = version

    if "charts" in normalized:
        raise ValueError("spec.charts is no longer supported; use spec.views")
    if "tables" in normalized:
        raise ValueError("spec.tables is no longer supported; use table views in spec.views")

    title = str(normalized.get("title") or "").strip()
    if not title:
        raise ValueError("title cannot be empty")
    normalized["title"] = title

    normalized["theme"] = str(normalized.get("theme") or "light")
    normalized["layout"] = _ensure_object(normalized.get("layout"), "layout")
    _validate_dashboard_layout(normalized["layout"])

    for field in _LIST_FIELDS:
        normalized[field] = _ensure_list(normalized.get(field), field)

    if not normalized["views"]:
        raise ValueError("views must be a non-empty array")

    _validate_v3_spec(normalized)

    filename = normalized.get("filename")
    if filename is not None:
        if not isinstance(filename, str):
            raise ValueError("filename must be a string")
        normalized["filename"] = filename.strip() or None

    return normalized


def _validate_v3_spec(spec: dict[str, Any]) -> None:
    datasets = spec.get("datasets", [])
    dataset_ids = set()
    dataset_fields: dict[str, set[str]] = {}
    for index, dataset in enumerate(datasets):
        if not isinstance(dataset, dict):
            raise ValueError(f"datasets[{index}] must be an object")
        dataset_id = str(dataset.get("id") or "").strip()
        if not dataset_id:
            raise ValueError(f"datasets[{index}].id cannot be empty")
        if dataset_id in dataset_ids:
            raise ValueError(f"datasets[{index}].id duplicates '{dataset_id}'")
        dataset_ids.add(dataset_id)

        source = _ensure_object(dataset.get("source"), f"datasets[{index}].source")
        if str(source.get("type") or "csv") != "csv":
            raise ValueError(f"datasets[{index}].source.type must be 'csv'")
        if not str(source.get("path") or "").strip():
            raise ValueError(f"datasets[{index}].source.path cannot be empty")

        schema = _ensure_list(dataset.get("schema"), f"datasets[{index}].schema")
        fields = set()
        for field_index, field in enumerate(schema):
            if not isinstance(field, dict):
                raise ValueError(f"datasets[{index}].schema[{field_index}] must be an object")
            field_name = str(field.get("name") or "").strip()
            if not field_name:
                raise ValueError(f"datasets[{index}].schema[{field_index}].name cannot be empty")
            fields.add(field_name)
        dataset_fields[dataset_id] = fields

    view_ids = set()
    view_dataset_by_id: dict[str, str] = {}
    for index, view in enumerate(spec.get("views", [])):
        if not isinstance(view, dict):
            raise ValueError(f"views[{index}] must be an object")
        view_id = str(view.get("id") or "").strip()
        if not view_id:
            raise ValueError(f"views[{index}].id cannot be empty")
        if view_id in view_ids:
            raise ValueError(f"views[{index}].id duplicates '{view_id}'")
        view_ids.add(view_id)

        path = f"views[{index}]"
        _validate_view_metadata(view, path)
        view_type = str(view.get("type") or "").strip()
        if view_type not in {"metric_cards", "chart", "pie_chart", "table"}:
            raise ValueError(f"views[{index}].type unsupported: {view_type}")

        dataset_id = str(view.get("dataset") or "").strip()
        if view_type != "metric_cards":
            if not dataset_id:
                raise ValueError(f"views[{index}].dataset cannot be empty")
            if dataset_id not in dataset_ids:
                raise ValueError(f"views[{index}].dataset references unknown dataset '{dataset_id}'")
            view_dataset_by_id[view_id] = dataset_id

        fields = dataset_fields.get(dataset_id, set())
        if view_type == "metric_cards":
            _validate_metric_cards_view(view, f"views[{index}]")
        elif view_type == "chart":
            coordinate = str(view.get("coordinate") or "cartesian")
            if coordinate != "cartesian":
                raise ValueError(f"views[{index}].coordinate unsupported: {coordinate}")
            _validate_cartesian_view(view, index, fields)
        elif view_type == "pie_chart":
            _require_dataset_field(view.get("name", {}).get("field"), fields, f"views[{index}].name.field")
            _require_dataset_field(view.get("value", {}).get("field"), fields, f"views[{index}].value.field")
        elif view_type == "table":
            _validate_table_view(view, fields, f"views[{index}]")

        recipe_id = str(view.get("recipe") or "").strip()
        if recipe_id:
            validate_dashboard_recipe(recipe_id, view, path)

    _validate_filters(spec.get("filters", []), dataset_fields, view_ids, view_dataset_by_id)

    for index, interaction in enumerate(spec.get("interactions", [])):
        if not isinstance(interaction, dict):
            raise ValueError(f"interactions[{index}] must be an object")
        source = _ensure_object(interaction.get("source"), f"interactions[{index}].source")
        source_view = str(source.get("view") or "").strip()
        if not source_view:
            raise ValueError(f"interactions[{index}].source.view cannot be empty")
        if source_view not in view_ids:
            raise ValueError(f"interactions[{index}].source.view references unknown view '{source_view}'")

        action = _ensure_object(interaction.get("action"), f"interactions[{index}].action")
        action_type = str(action.get("type") or "").strip()
        if action_type != "drilldown":
            raise ValueError(
                f"interactions[{index}].action.type unsupported: {action_type}; "
                "only drilldown interactions are executable, use spec.filters for filtering"
            )
        source_event = str(source.get("event") or "click")
        if source_event != "click":
            raise ValueError(f"interactions[{index}].source.event must be 'click'")

        target_dataset = str(action.get("target_dataset") or "").strip()
        if target_dataset and target_dataset not in dataset_ids:
            raise ValueError(f"interactions[{index}].action.target_dataset references unknown dataset '{target_dataset}'")
        if action_type == "drilldown":
            _validate_drilldown_interaction(
                action,
                index,
                source_view,
                target_dataset,
                view_dataset_by_id,
                dataset_fields,
            )


def _collect_dashboard_warnings(spec: dict[str, Any]) -> list[str]:
    warnings = []
    for index, view in enumerate(spec.get("views", [])):
        path = f"views[{index}]"
        if not str(view.get("insight") or "").strip():
            warnings.append(f"{path}.insight is recommended so the view states one business conclusion")
        if not str(view.get("recipe") or "").strip():
            warnings.append(f"{path}.recipe is recommended so chart selection remains auditable")
        if view.get("source") is None or view.get("source") == "":
            warnings.append(f"{path}.source is recommended for delivery-ready dashboards")
    return warnings


def _validate_dashboard_layout(layout: dict[str, Any]) -> None:
    sidebar = layout.get("sidebar")
    if sidebar is not None and not isinstance(sidebar, bool):
        raise ValueError("layout.sidebar must be a boolean")


def _validate_view_metadata(view: dict[str, Any], path: str) -> None:
    for field in ("title", "subtitle", "insight", "recipe"):
        value = view.get(field)
        if value is not None and not isinstance(value, str):
            raise ValueError(f"{path}.{field} must be a string")

    reading_mode = view.get("reading_mode")
    if reading_mode is not None and reading_mode not in {"glance", "analysis", "detail"}:
        raise ValueError(f"{path}.reading_mode must be glance, analysis, or detail")

    source = view.get("source")
    if source is not None and not isinstance(source, (str, dict)):
        raise ValueError(f"{path}.source must be a string or object")
    if isinstance(source, dict):
        for field in ("label", "url", "updated_at"):
            value = source.get(field)
            if value is not None and not isinstance(value, str):
                raise ValueError(f"{path}.source.{field} must be a string")

    annotations = _ensure_list(view.get("annotations"), f"{path}.annotations")
    for annotation_index, annotation in enumerate(annotations):
        annotation_path = f"{path}.annotations[{annotation_index}]"
        if not isinstance(annotation, dict):
            raise ValueError(f"{annotation_path} must be an object")
        if not str(annotation.get("text") or "").strip():
            raise ValueError(f"{annotation_path}.text cannot be empty")
        tone = str(annotation.get("tone") or "neutral")
        if tone not in {"neutral", "positive", "warning", "negative"}:
            raise ValueError(f"{annotation_path}.tone unsupported: {tone}")

    layout = _ensure_object(view.get("layout"), f"{path}.layout")
    span = layout.get("span")
    if span is not None and (not isinstance(span, int) or isinstance(span, bool) or not 1 <= span <= 12):
        raise ValueError(f"{path}.layout.span must be an integer from 1 to 12")
    height = layout.get("height")
    if isinstance(height, (int, float)) and (isinstance(height, bool) or height <= 0):
        raise ValueError(f"{path}.layout.height must be positive")
    if height is not None and not isinstance(height, (int, float, str)):
        raise ValueError(f"{path}.layout.height must be a number or CSS length string")


def _validate_filters(
    filters: list[Any],
    dataset_fields: dict[str, set[str]],
    view_ids: set[str],
    view_dataset_by_id: dict[str, str],
) -> None:
    filter_ids = set()
    for index, filter_spec in enumerate(filters):
        path = f"filters[{index}]"
        if not isinstance(filter_spec, dict):
            raise ValueError(f"{path} must be an object")
        filter_id = str(filter_spec.get("id") or "").strip()
        if not filter_id:
            raise ValueError(f"{path}.id cannot be empty")
        if filter_id in filter_ids:
            raise ValueError(f"{path}.id duplicates '{filter_id}'")
        filter_ids.add(filter_id)

        filter_type = str(filter_spec.get("type") or "select")
        if filter_type != "select":
            raise ValueError(f"{path}.type unsupported: {filter_type}; only select filters are executable")
        dataset_id = str(filter_spec.get("dataset") or "").strip()
        if dataset_id not in dataset_fields:
            raise ValueError(f"{path}.dataset references unknown dataset '{dataset_id}'")
        _require_dataset_field(filter_spec.get("field"), dataset_fields[dataset_id], f"{path}.field")

        targets = filter_spec.get("targets")
        if targets is not None and not isinstance(targets, list):
            raise ValueError(f"{path}.targets must be an array")
        for target_index, target in enumerate(targets or []):
            target_id = str(target or "").strip()
            if target_id not in view_ids:
                raise ValueError(f"{path}.targets[{target_index}] references unknown view '{target_id}'")
            if view_dataset_by_id.get(target_id) != dataset_id:
                raise ValueError(f"{path}.targets[{target_index}] must use dataset '{dataset_id}'")

        default = filter_spec.get("default")
        if isinstance(default, str) and default.strip().casefold() in {"all", "全部"}:
            raise ValueError(f"{path}.default must use an empty value for the all option")
        for field in ("label", "all_label"):
            value = filter_spec.get(field)
            if value is not None and not isinstance(value, str):
                raise ValueError(f"{path}.{field} must be a string")


def _validate_drilldown_interaction(
    action: dict[str, Any],
    index: int,
    source_view: str,
    target_dataset: str,
    view_dataset_by_id: dict[str, str],
    dataset_fields: dict[str, set[str]],
) -> None:
    if not target_dataset:
        raise ValueError(f"interactions[{index}].action.target_dataset cannot be empty")

    match = _ensure_object(action.get("match"), f"interactions[{index}].action.match")
    source_dataset = view_dataset_by_id.get(source_view, "")
    _require_dataset_field(
        match.get("source_field"),
        dataset_fields.get(source_dataset, set()),
        f"interactions[{index}].action.match.source_field",
    )
    _require_dataset_field(
        match.get("target_field"),
        dataset_fields.get(target_dataset, set()),
        f"interactions[{index}].action.match.target_field",
    )

    target_view = _ensure_object(action.get("target_view"), f"interactions[{index}].action.target_view")
    target_type = str(target_view.get("type") or "").strip()
    target_path = f"interactions[{index}].action.target_view"
    target_fields = dataset_fields.get(target_dataset, set())
    if target_type == "chart":
        _validate_cartesian_view(target_view, index, target_fields, path=target_path)
    elif target_type == "table":
        _validate_table_view(target_view, target_fields, target_path)
    else:
        raise ValueError(f"{target_path}.type unsupported: {target_type}")


def _validate_metric_cards_view(view: dict[str, Any], path: str) -> None:
    cards = _ensure_list(view.get("cards"), f"{path}.cards")
    if not cards:
        raise ValueError(f"{path}.cards must be a non-empty array")
    for card_index, card in enumerate(cards):
        if not isinstance(card, dict):
            raise ValueError(f"{path}.cards[{card_index}] must be an object")


def _validate_table_view(view: dict[str, Any], fields: set[str], path: str) -> None:
    columns = _ensure_list(view.get("columns"), f"{path}.columns")
    if not columns:
        raise ValueError(f"{path}.columns must be a non-empty array")
    for column_index, column in enumerate(columns):
        if not isinstance(column, dict):
            raise ValueError(f"{path}.columns[{column_index}] must be an object")
        _require_dataset_field(column.get("field"), fields, f"{path}.columns[{column_index}].field")


def _validate_cartesian_view(
    view: dict[str, Any],
    index: int,
    fields: set[str],
    *,
    prefix: str = "views",
    path: str | None = None,
) -> None:
    path = path or f"{prefix}[{index}]"
    _require_dataset_field(view.get("x", {}).get("field"), fields, f"{path}.x.field")
    x_type = str(view.get("x", {}).get("type") or "category")
    if x_type not in {"category", "value"}:
        raise ValueError(f"{path}.x.type unsupported: {x_type}")
    axes = _cartesian_y_axes(view, path)
    axis_ids = set()
    for axis_index, axis in enumerate(axes):
        if not isinstance(axis, dict):
            raise ValueError(f"{path}.axes[{axis_index}] must be an object")
        axis_id = str(axis.get("id") or "").strip()
        if not axis_id:
            raise ValueError(f"{path}.axes[{axis_index}].id cannot be empty")
        axis_ids.add(axis_id)

    series_by = view.get("series_by")
    if series_by is not None:
        if not isinstance(series_by, dict):
            raise ValueError(f"{path}.series_by must be an object")
        _require_dataset_field(series_by.get("field"), fields, f"{path}.series_by.field")
        order = series_by.get("order")
        if order is not None and not isinstance(order, list):
            raise ValueError(f"{path}.series_by.order must be an array")

    series_items = _ensure_list(view.get("series"), f"{path}.series")
    if not series_items:
        raise ValueError(f"{path}.series must be a non-empty array")
    field_usage: dict[str, list[bool]] = {}
    for series_index, series in enumerate(series_items):
        if not isinstance(series, dict):
            raise ValueError(f"{path}.series[{series_index}] must be an object")
        field_name = _require_dataset_field(series.get("field"), fields, f"{path}.series[{series_index}].field")
        mark = str(series.get("mark") or "bar")
        if mark not in {"bar", "line", "scatter"}:
            raise ValueError(f"{path}.series[{series_index}].mark unsupported: {mark}")
        axis = str(series.get("axis") or "").strip()
        if axis and axis not in axis_ids:
            raise ValueError(f"{path}.series[{series_index}].axis references unknown axis id '{axis}'")

        where = series.get("where")
        has_where = where is not None
        if where is not None:
            if not isinstance(where, dict):
                raise ValueError(f"{path}.series[{series_index}].where must be an object")
            for field in where:
                _require_dataset_field(field, fields, f"{path}.series[{series_index}].where.{field}")
        field_usage.setdefault(field_name, []).append(has_where)

    if series_by is None:
        for field_name, has_where_values in field_usage.items():
            if len(has_where_values) > 1 and not all(has_where_values):
                raise ValueError(
                    f"{path}.series repeats field '{field_name}'; use series_by or give every repeated series a where filter"
                )


def _cartesian_y_axes(view: dict[str, Any], path: str) -> list[dict[str, Any]]:
    axes = view.get("axes")
    if not isinstance(axes, list) or not axes:
        raise ValueError(f"{path}.axes must be a non-empty array")
    y_axes = [
        axis for axis in axes
        if isinstance(axis, dict) and str(axis.get("orient") or axis.get("dimension") or "y") == "y"
    ]
    if not y_axes:
        raise ValueError(f"{path}.axes must include at least one y axis")
    return y_axes


def _require_dataset_field(field_name: Any, fields: set[str], path: str) -> str:
    field = str(field_name or "").strip()
    if not field:
        raise ValueError(f"{path} cannot be empty")
    if fields and field not in fields:
        raise ValueError(f"{path} references unknown field '{field}'")
    return field


def _ensure_object(value: Any, field_name: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object")
    return deepcopy(value)


def _ensure_list(value: Any, field_name: str) -> list[Any]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{field_name} must be an array")
    return deepcopy(value)
