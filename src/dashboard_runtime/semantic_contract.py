from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
import re
from typing import Any, Iterable


SEMANTIC_DASHBOARD_VERSION = "4"
MAX_DATA_NODES = 64
MAX_VIEWS = 128
MAX_PARAMETERS = 32
MAX_LIMIT = 1_000

_ID_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_SOURCE_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_CONNECTION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")


class SemanticDashboardValidationError(ValueError):
    """A structured, user-correctable semantic dashboard error."""

    def __init__(self, errors: list[dict[str, str]] | str):
        if isinstance(errors, str):
            errors = [{"path": "spec", "code": "invalid_spec", "message": errors}]
        self.errors = errors
        super().__init__("; ".join(f"{item['path']}: {item['message']}" for item in errors))


@dataclass(frozen=True)
class SemanticSourceCatalog:
    name: str
    columns: frozenset[str]
    measures: frozenset[str]
    field_types: dict[str, str] = field(default_factory=dict)
    queryable: bool = True

    @property
    def fields(self) -> frozenset[str]:
        return self.columns | self.measures


@dataclass(frozen=True)
class SemanticOutputColumn:
    output_name: str
    source_field: str
    role: str
    granularity: str | None
    expected_header: str
    value_type: str

    @property
    def semantic_ref_suffix(self) -> str:
        return self.source_field


@dataclass(frozen=True)
class SemanticFilterPlan:
    source_field: str
    operator: str
    parameter: str | None = None
    literal: str | int | float | bool | None = None


@dataclass(frozen=True)
class SemanticOrderPlan:
    output_name: str
    source_field: str
    direction: str


@dataclass(frozen=True)
class SemanticDataPlan:
    id: str
    source: str
    dimensions: tuple[SemanticOutputColumn, ...]
    measures: tuple[SemanticOutputColumn, ...]
    filters: tuple[SemanticFilterPlan, ...]
    order_by: tuple[SemanticOrderPlan, ...]
    limit: int
    dependencies: frozenset[str]

    @property
    def outputs(self) -> tuple[SemanticOutputColumn, ...]:
        return self.dimensions + self.measures

    @property
    def output_by_name(self) -> dict[str, SemanticOutputColumn]:
        return {column.output_name: column for column in self.outputs}


@dataclass(frozen=True)
class SemanticParameterPlan:
    name: str
    label: str
    default: str | int | float | bool | None
    options_data: str
    options_field: str


@dataclass(frozen=True)
class CompiledSemanticDashboard:
    spec: dict[str, Any]
    connection: str
    parameters: dict[str, SemanticParameterPlan]
    data: dict[str, SemanticDataPlan]
    dependencies: dict[str, frozenset[str]]
    options_by_parameter: dict[str, str]
    catalog: dict[str, SemanticSourceCatalog]
    view_manifest: dict[str, dict[str, Any]]

    @property
    def option_nodes(self) -> frozenset[str]:
        return frozenset(self.options_by_parameter.values())

    @property
    def parameter_names(self) -> frozenset[str]:
        return frozenset(self.parameters)

    def affected_data(self, changed: Iterable[str] | None) -> set[str]:
        if changed is None:
            return set(self.data)
        changed_names = set(changed)
        if not changed_names:
            return set()
        return {
            node_id
            for parameter in changed_names
            for node_id in self.dependencies.get(parameter, frozenset())
        }


_SCALAR_TYPES = (str, int, float, bool)


def normalize_semantic_dashboard_spec(spec: dict[str, Any]) -> dict[str, Any]:
    """Normalize and structurally validate the public V4 document."""
    errors: list[dict[str, str]] = []
    if not isinstance(spec, dict):
        raise SemanticDashboardValidationError("spec must be an object")
    normalized = deepcopy(spec)

    version = str(normalized.get("version") or "")
    if version != SEMANTIC_DASHBOARD_VERSION:
        errors.append({"path": "version", "code": "unsupported_version", "message": "version must be '4'"})

    title = normalized.get("title")
    if not isinstance(title, str) or not title.strip():
        errors.append({"path": "title", "code": "required", "message": "title cannot be empty"})
    else:
        normalized["title"] = title.strip()

    connection = normalized.get("connection")
    if not isinstance(connection, str) or not _CONNECTION_RE.fullmatch(connection.strip()):
        errors.append({"path": "connection", "code": "invalid_connection", "message": "connection must be a valid connection ID"})
    else:
        normalized["connection"] = connection.strip()

    parameters = normalized.get("parameters")
    if not isinstance(parameters, dict):
        errors.append({"path": "parameters", "code": "invalid_type", "message": "parameters must be an object"})
        parameters = {}
    elif len(parameters) > MAX_PARAMETERS:
        errors.append({"path": "parameters", "code": "too_many", "message": f"at most {MAX_PARAMETERS} parameters are supported"})
    _validate_parameters(parameters, errors)

    data = normalized.get("data")
    if not isinstance(data, dict):
        errors.append({"path": "data", "code": "invalid_type", "message": "data must be an object"})
        data = {}
    elif not data:
        errors.append({"path": "data", "code": "required", "message": "data must contain at least one node"})
    elif len(data) > MAX_DATA_NODES:
        errors.append({"path": "data", "code": "too_many", "message": f"at most {MAX_DATA_NODES} data nodes are supported"})
    _validate_data_nodes(data, parameters, errors)

    views = normalized.get("views")
    if not isinstance(views, list):
        errors.append({"path": "views", "code": "invalid_type", "message": "views must be an array"})
        views = []
    elif not views:
        errors.append({"path": "views", "code": "required", "message": "views must be a non-empty array"})
    elif len(views) > MAX_VIEWS:
        errors.append({"path": "views", "code": "too_many", "message": f"at most {MAX_VIEWS} views are supported"})
    _validate_views(views, data, errors)

    interactions = normalized.get("interactions", [])
    if not isinstance(interactions, list):
        errors.append({"path": "interactions", "code": "invalid_type", "message": "interactions must be an array"})
        interactions = []
    _validate_interactions(interactions, parameters, data, views, errors)

    layout = normalized.get("layout", {})
    if not isinstance(layout, dict):
        errors.append({"path": "layout", "code": "invalid_type", "message": "layout must be an object"})
        layout = {}
    if "sidebar" in layout and not isinstance(layout.get("sidebar"), bool):
        errors.append({"path": "layout.sidebar", "code": "invalid_type", "message": "layout.sidebar must be boolean"})
    normalized["layout"] = deepcopy(layout)

    exports = normalized.get("exports", [])
    if not isinstance(exports, list):
        errors.append({"path": "exports", "code": "invalid_type", "message": "exports must be an array"})
        exports = []
    normalized["exports"] = deepcopy(exports)

    filename = normalized.get("filename")
    if filename is not None and (not isinstance(filename, str) or not filename.strip()):
        errors.append({"path": "filename", "code": "invalid_filename", "message": "filename must be a non-empty string when supplied"})
    elif isinstance(filename, str):
        normalized["filename"] = filename.strip()

    for forbidden in ("datasets", "filters"):
        if forbidden in normalized:
            errors.append({"path": forbidden, "code": "unsupported_object", "message": f"V4 does not accept {forbidden}; use parameters and data"})
    for forbidden_path, forbidden_key in _find_forbidden_keys(normalized):
        errors.append({"path": forbidden_path, "code": "forbidden_key", "message": f"key '{forbidden_key}' is not allowed in a semantic dashboard document"})

    if errors:
        raise SemanticDashboardValidationError(errors)
    normalized["version"] = SEMANTIC_DASHBOARD_VERSION
    normalized["parameters"] = deepcopy(parameters)
    normalized["data"] = deepcopy(data)
    normalized["views"] = deepcopy(views)
    normalized["interactions"] = deepcopy(interactions)
    return normalized


def compile_semantic_dashboard(
    spec: dict[str, Any],
    catalog: dict[str, SemanticSourceCatalog] | None = None,
) -> CompiledSemanticDashboard:
    """Compile a V4 document into immutable query plans and dependency metadata."""
    normalized = normalize_semantic_dashboard_spec(spec)
    errors: list[dict[str, str]] = []
    connection = normalized["connection"]
    catalog = catalog or {}
    parameter_specs = normalized["parameters"]
    data_specs = normalized["data"]

    parameters: dict[str, SemanticParameterPlan] = {}
    options_by_parameter: dict[str, str] = {}
    for name, raw in parameter_specs.items():
        options = raw.get("options") if isinstance(raw, dict) else None
        if not isinstance(options, dict):
            continue
        data_id = str(options.get("data") or "")
        field_name = str(options.get("field") or "")
        if data_id not in data_specs:
            errors.append({"path": f"parameters.{name}.options.data", "code": "unknown_data", "message": f"unknown data node '{data_id}'"})
        options_by_parameter[name] = data_id
        parameters[name] = SemanticParameterPlan(
            name=name,
            label=str(raw.get("label") or name),
            default=raw.get("default"),
            options_data=data_id,
            options_field=field_name,
        )

    # A malformed options object is reported here rather than causing a KeyError
    # in the compiler. Structural validation has already checked its shape.
    for name, raw in parameter_specs.items():
        if name not in parameters:
            options = raw.get("options") if isinstance(raw, dict) else {}
            parameters[name] = SemanticParameterPlan(
                name=name,
                label=str(raw.get("label") or name),
                default=raw.get("default"),
                options_data=str((options or {}).get("data") or ""),
                options_field=str((options or {}).get("field") or ""),
            )

    data_plans: dict[str, SemanticDataPlan] = {}
    dependencies: dict[str, set[str]] = {name: set() for name in parameters}
    for data_id, raw in data_specs.items():
        if not isinstance(raw, dict):
            continue
        source = str(raw.get("source") or "")
        source_catalog = catalog.get(source)
        if catalog and source_catalog is None:
            errors.append({"path": f"data.{data_id}.source", "code": "unknown_source", "message": f"unknown semantic source '{source}'"})
            continue
        if source_catalog is not None and not source_catalog.queryable:
            errors.append({"path": f"data.{data_id}.source", "code": "source_not_queryable", "message": f"semantic source '{source}' is not executable"})
            continue
        plan = _compile_data_node(data_id, raw, source_catalog, set(parameters), errors)
        if plan is None:
            continue
        data_plans[data_id] = plan
        for parameter in plan.dependencies:
            dependencies.setdefault(parameter, set()).add(data_id)

    for parameter, node_id in options_by_parameter.items():
        if node_id and node_id in data_plans and data_plans[node_id].dependencies:
            errors.append({"path": f"parameters.{parameter}.options", "code": "options_node_uses_param", "message": "options node must not reference $param"})

    for parameter, plan in parameters.items():
        if plan.options_data and plan.options_data not in data_plans:
            errors.append({"path": f"parameters.{parameter}.options.data", "code": "unknown_data", "message": f"unknown data node '{plan.options_data}'"})
        if plan.options_data in data_plans:
            output = data_plans[plan.options_data].output_by_name.get(plan.options_field)
            if output is None:
                errors.append({"path": f"parameters.{parameter}.options.field", "code": "unknown_field", "message": f"data node {plan.options_data} has no output field '{plan.options_field}'"})

    view_manifest = _compile_view_manifest(normalized["views"], data_plans, errors)
    _validate_interactions_against_plans(normalized["interactions"], view_manifest, parameters, errors)

    if errors:
        raise SemanticDashboardValidationError(errors)

    return CompiledSemanticDashboard(
        spec=normalized,
        connection=connection,
        parameters=parameters,
        data=data_plans,
        dependencies={key: frozenset(value) for key, value in dependencies.items()},
        options_by_parameter=options_by_parameter,
        catalog=catalog,
        view_manifest=view_manifest,
    )


def _validate_parameters(parameters: dict[str, Any], errors: list[dict[str, str]]) -> None:
    for name, raw in parameters.items():
        path = f"parameters.{name}"
        if not _ID_RE.fullmatch(str(name)):
            errors.append({"path": path, "code": "invalid_id", "message": "parameter ID must contain letters, numbers, and underscores"})
        if not isinstance(raw, dict):
            errors.append({"path": path, "code": "invalid_type", "message": "parameter must be an object"})
            continue
        if str(raw.get("type") or "select") != "select":
            errors.append({"path": f"{path}.type", "code": "unsupported_type", "message": "only select parameters are supported in V4"})
        if "default" in raw and not _is_scalar_or_null(raw.get("default")):
            errors.append({"path": f"{path}.default", "code": "invalid_value", "message": "default must be a scalar or null"})
        options = raw.get("options")
        if not isinstance(options, dict):
            errors.append({"path": f"{path}.options", "code": "required", "message": "select parameters require an options data reference"})
            continue
        if not isinstance(options.get("data"), str) or not str(options.get("data")).strip():
            errors.append({"path": f"{path}.options.data", "code": "required", "message": "options.data is required"})
        if not isinstance(options.get("field"), str) or not _ID_RE.fullmatch(str(options.get("field") or "")):
            errors.append({"path": f"{path}.options.field", "code": "invalid_field", "message": "options.field must be a valid output field"})


def _validate_data_nodes(data: dict[str, Any], parameters: dict[str, Any], errors: list[dict[str, str]]) -> None:
    for data_id, raw in data.items():
        path = f"data.{data_id}"
        if not _ID_RE.fullmatch(str(data_id)):
            errors.append({"path": path, "code": "invalid_id", "message": "data node ID must contain letters, numbers, and underscores"})
        if not isinstance(raw, dict):
            errors.append({"path": path, "code": "invalid_type", "message": "data node must be an object"})
            continue
        source = raw.get("source")
        if not isinstance(source, str) or not _SOURCE_RE.fullmatch(source.strip()):
            errors.append({"path": f"{path}.source", "code": "invalid_source", "message": "source must be a source-relative semantic model name"})
        _validate_output_map(raw.get("dimensions", {}), f"{path}.dimensions", errors, allow_granularity=True)
        measures = raw.get("measures")
        if not isinstance(measures, dict) or not measures:
            errors.append({"path": f"{path}.measures", "code": "required", "message": "each data node requires at least one measure"})
        else:
            _validate_output_map(measures, f"{path}.measures", errors, allow_granularity=False)
        where = raw.get("where", [])
        if not isinstance(where, list):
            errors.append({"path": f"{path}.where", "code": "invalid_type", "message": "where must be an array"})
        else:
            for index, item in enumerate(where):
                item_path = f"{path}.where[{index}]"
                if not isinstance(item, dict):
                    errors.append({"path": item_path, "code": "invalid_type", "message": "where item must be an object"})
                    continue
                if not isinstance(item.get("field"), str) or not _ID_RE.fullmatch(str(item.get("field") or "")):
                    errors.append({"path": f"{item_path}.field", "code": "invalid_field", "message": "where.field must be source-relative"})
                if item.get("operator") != "eq":
                    errors.append({"path": f"{item_path}.operator", "code": "unsupported_operator", "message": "V4 phase 1 supports only eq"})
                value = item.get("value")
                if isinstance(value, dict):
                    keys = set(value)
                    if keys != {"$param"} or not isinstance(value.get("$param"), str) or value.get("$param") not in parameters:
                        errors.append({"path": f"{item_path}.value", "code": "invalid_parameter_ref", "message": "value must be {$param: declared_parameter}"})
                elif value is None:
                    errors.append({"path": f"{item_path}.value", "code": "invalid_value", "message": "eq filter value cannot be null; use a $param and set that parameter to null to omit the filter"})
                elif not _is_scalar_or_null(value):
                    errors.append({"path": f"{item_path}.value", "code": "invalid_value", "message": "value must be a scalar or parameter reference"})
        order_by = raw.get("orderBy", [])
        if not isinstance(order_by, list):
            errors.append({"path": f"{path}.orderBy", "code": "invalid_type", "message": "orderBy must be an array"})
        else:
            for index, item in enumerate(order_by):
                item_path = f"{path}.orderBy[{index}]"
                if not isinstance(item, dict) or not isinstance(item.get("field"), str):
                    errors.append({"path": item_path, "code": "invalid_order", "message": "orderBy item requires field"})
                elif item.get("direction", "asc") not in {"asc", "desc"}:
                    errors.append({"path": f"{item_path}.direction", "code": "invalid_direction", "message": "direction must be asc or desc"})
        limit = raw.get("limit", MAX_LIMIT)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_LIMIT:
            errors.append({"path": f"{path}.limit", "code": "invalid_limit", "message": f"limit must be an integer from 1 to {MAX_LIMIT}"})


def _validate_output_map(value: Any, path: str, errors: list[dict[str, str]], *, allow_granularity: bool) -> None:
    if value is None:
        value = {}
    if not isinstance(value, dict):
        errors.append({"path": path, "code": "invalid_type", "message": "field map must be an object"})
        return
    for output_name, raw in value.items():
        output_path = f"{path}.{output_name}"
        if not _ID_RE.fullmatch(str(output_name)):
            errors.append({"path": output_path, "code": "invalid_id", "message": "output field name must contain letters, numbers, and underscores"})
        if isinstance(raw, str):
            continue
        if allow_granularity and isinstance(raw, dict) and isinstance(raw.get("field"), str):
            if raw.get("granularity") not in {None, "month", "quarter", "year", "day"}:
                errors.append({"path": f"{output_path}.granularity", "code": "unsupported_granularity", "message": "supported granularities are day, month, quarter, year"})
            continue
        errors.append({"path": output_path, "code": "invalid_field", "message": "field must be a string or a dimension descriptor"})


def _validate_views(views: list[Any], data: dict[str, Any], errors: list[dict[str, str]]) -> None:
    ids: set[str] = set()
    for index, view in enumerate(views):
        path = f"views[{index}]"
        if not isinstance(view, dict):
            errors.append({"path": path, "code": "invalid_type", "message": "view must be an object"})
            continue
        view_id = str(view.get("id") or "")
        if not _ID_RE.fullmatch(view_id):
            errors.append({"path": f"{path}.id", "code": "invalid_id", "message": "view id is invalid"})
        elif view_id in ids:
            errors.append({"path": f"{path}.id", "code": "duplicate_id", "message": f"view id '{view_id}' is duplicated"})
        ids.add(view_id)
        view_type = view.get("type")
        _validate_view_layout(view.get("layout"), path, errors)
        if view_type not in {"chart", "table", "metric_cards"}:
            errors.append({"path": f"{path}.type", "code": "unsupported_type", "message": "supported views are chart, table, metric_cards"})
        data_id = view.get("data")
        if not isinstance(data_id, str) or data_id not in data:
            errors.append({"path": f"{path}.data", "code": "unknown_data", "message": f"unknown data node '{data_id}'"})
        if view_type == "chart":
            if view.get("coordinate", "cartesian") != "cartesian":
                errors.append({"path": f"{path}.coordinate", "code": "unsupported_coordinate", "message": "only cartesian charts are supported"})
            x = view.get("x")
            if not isinstance(x, dict) or not isinstance(x.get("field"), str):
                errors.append({"path": f"{path}.x", "code": "required", "message": "chart x.field is required"})
            axes = view.get("axes")
            if not isinstance(axes, list) or not axes:
                errors.append({"path": f"{path}.axes", "code": "required", "message": "chart axes must be a non-empty array"})
            elif len(axes) > 4:
                errors.append({"path": f"{path}.axes", "code": "too_many", "message": "a chart may define at most four axes"})
            series = view.get("series")
            if not isinstance(series, list) or not series:
                errors.append({"path": f"{path}.series", "code": "required", "message": "chart series must be a non-empty array"})
        elif view_type == "table":
            columns = view.get("columns")
            if not isinstance(columns, list) or not columns:
                errors.append({"path": f"{path}.columns", "code": "required", "message": "table columns must be a non-empty array"})
        elif view_type == "metric_cards":
            cards = view.get("cards")
            if not isinstance(cards, list) or not cards:
                errors.append({"path": f"{path}.cards", "code": "required", "message": "metric_cards.cards must be a non-empty array"})


def _validate_view_layout(value: Any, path: str, errors: list[dict[str, str]]) -> None:
    if value is None:
        return
    if not isinstance(value, dict):
        errors.append({"path": f"{path}.layout", "code": "invalid_type", "message": "view layout must be an object"})
        return
    span = value.get("span")
    if span is not None and (isinstance(span, bool) or not isinstance(span, int) or not 1 <= span <= 12):
        errors.append({"path": f"{path}.layout.span", "code": "invalid_span", "message": "layout.span must be an integer from 1 to 12"})
    height = value.get("height")
    if height is not None and not isinstance(height, (int, float, str)):
        errors.append({"path": f"{path}.layout.height", "code": "invalid_height", "message": "layout.height must be a number or CSS length"})
    if isinstance(height, (int, float)) and (isinstance(height, bool) or height <= 0):
        errors.append({"path": f"{path}.layout.height", "code": "invalid_height", "message": "layout.height must be positive"})
    if isinstance(height, str) and height.strip() and not re.fullmatch(r"[0-9]+(?:\\.[0-9]+)?(?:px|rem|em|vh|vw|%)", height.strip()):
        errors.append({"path": f"{path}.layout.height", "code": "invalid_height", "message": "layout.height must be a positive CSS length"})


def _validate_interactions(interactions: list[Any], parameters: dict[str, Any], data: dict[str, Any], views: list[Any], errors: list[dict[str, str]]) -> None:
    view_ids = {str(view.get("id")) for view in views if isinstance(view, dict)}
    for index, interaction in enumerate(interactions):
        path = f"interactions[{index}]"
        if not isinstance(interaction, dict):
            errors.append({"path": path, "code": "invalid_type", "message": "interaction must be an object"})
            continue
        source = interaction.get("source")
        action = interaction.get("action")
        if not isinstance(source, dict) or source.get("view") not in view_ids or source.get("event", "click") != "click":
            errors.append({"path": f"{path}.source", "code": "invalid_source", "message": "source must reference a view and click event"})
        if not isinstance(action, dict) or action.get("type") != "set_parameter":
            errors.append({"path": f"{path}.action.type", "code": "unsupported_action", "message": "V4 interactions must use set_parameter"})
            continue
        parameter = action.get("parameter")
        if parameter not in parameters:
            errors.append({"path": f"{path}.action.parameter", "code": "unknown_parameter", "message": f"unknown parameter '{parameter}'"})
        value = action.get("value")
        if not isinstance(value, dict) or set(value) != {"$event"} or not isinstance(value.get("$event"), str):
            errors.append({"path": f"{path}.action.value", "code": "invalid_event_ref", "message": "value must be {$event: output_field}"})
        if "toggle" in action and not isinstance(action.get("toggle"), bool):
            errors.append({"path": f"{path}.action.toggle", "code": "invalid_type", "message": "toggle must be boolean"})


def _compile_data_node(
    data_id: str,
    raw: dict[str, Any],
    source_catalog: SemanticSourceCatalog | None,
    parameter_names: set[str],
    errors: list[dict[str, str]],
) -> SemanticDataPlan | None:
    source = str(raw.get("source") or "")
    dimensions: list[SemanticOutputColumn] = []
    measures: list[SemanticOutputColumn] = []
    used: set[str] = set()
    for output_name, descriptor in (raw.get("dimensions") or {}).items():
        field_name, granularity = _field_descriptor(descriptor)
        path = f"data.{data_id}.dimensions.{output_name}"
        if source_catalog and field_name not in source_catalog.columns:
            errors.append({"path": path, "code": "unknown_dimension", "message": f"{source}.{field_name} is not a catalog dimension"})
        if output_name in used:
            errors.append({"path": path, "code": "duplicate_output", "message": f"output field '{output_name}' is duplicated"})
        used.add(output_name)
        value_type = (source_catalog.field_types.get(field_name, "string") if source_catalog else "string")
        header = f"{field_name}_{granularity}" if granularity else field_name
        dimensions.append(SemanticOutputColumn(output_name, field_name, "dimension", granularity, header, value_type))
    for output_name, descriptor in (raw.get("measures") or {}).items():
        field_name, _ = _field_descriptor(descriptor)
        path = f"data.{data_id}.measures.{output_name}"
        if source_catalog and field_name not in source_catalog.measures:
            errors.append({"path": path, "code": "unknown_measure", "message": f"{source}.{field_name} is not a catalog measure"})
        if output_name in used:
            errors.append({"path": path, "code": "duplicate_output", "message": f"output field '{output_name}' is duplicated"})
        used.add(output_name)
        value_type = (source_catalog.field_types.get(field_name, "number") if source_catalog else "number")
        measures.append(SemanticOutputColumn(output_name, field_name, "measure", None, field_name, value_type))

    filters: list[SemanticFilterPlan] = []
    dependencies: set[str] = set()
    for index, raw_filter in enumerate(raw.get("where") or []):
        field_name = str(raw_filter.get("field") or "")
        path = f"data.{data_id}.where[{index}]"
        if source_catalog and field_name not in source_catalog.fields:
            errors.append({"path": f"{path}.field", "code": "unknown_filter_field", "message": f"{source}.{field_name} is not a catalog field"})
        value = raw_filter.get("value")
        if isinstance(value, dict):
            parameter = value.get("$param")
            if parameter not in parameter_names:
                errors.append({"path": f"{path}.value", "code": "unknown_parameter", "message": f"unknown parameter '{parameter}'"})
                continue
            dependencies.add(parameter)
            filters.append(SemanticFilterPlan(field_name, "eq", parameter=parameter))
        else:
            filters.append(SemanticFilterPlan(field_name, "eq", literal=value))

    output_by_name = {item.output_name: item for item in dimensions + measures}
    order_by: list[SemanticOrderPlan] = []
    for index, item in enumerate(raw.get("orderBy") or []):
        output_name = str(item.get("field") or "")
        path = f"data.{data_id}.orderBy[{index}].field"
        output = output_by_name.get(output_name)
        if output is None:
            errors.append({"path": path, "code": "unknown_output", "message": f"data node has no output field '{output_name}'"})
            continue
        order_by.append(SemanticOrderPlan(output_name, output.source_field, str(item.get("direction") or "asc")))

    if not dimensions and not measures:
        return None
    return SemanticDataPlan(
        id=data_id,
        source=source,
        dimensions=tuple(dimensions),
        measures=tuple(measures),
        filters=tuple(filters),
        order_by=tuple(order_by),
        limit=int(raw.get("limit") or MAX_LIMIT),
        dependencies=frozenset(dependencies),
    )


def _compile_view_manifest(views: list[dict[str, Any]], data: dict[str, SemanticDataPlan], errors: list[dict[str, str]]) -> dict[str, dict[str, Any]]:
    manifest: dict[str, dict[str, Any]] = {}
    for index, view in enumerate(views):
        if not isinstance(view, dict):
            continue
        view_id = str(view.get("id") or "")
        data_plan = data.get(str(view.get("data") or ""))
        if data_plan is None:
            continue
        fields = set(data_plan.output_by_name)
        path = f"views[{index}]"
        if view.get("type") == "chart":
            x_field = str((view.get("x") or {}).get("field") or "")
            if x_field not in fields:
                errors.append({"path": f"{path}.x.field", "code": "unknown_field", "message": f"data node {data_plan.id} has no output field '{x_field}'"})
            axis_ids = {str(axis.get("id")) for axis in view.get("axes", []) if isinstance(axis, dict)}
            for series_index, series in enumerate(view.get("series") or []):
                if not isinstance(series, dict):
                    continue
                field_name = str(series.get("field") or "")
                if field_name not in fields:
                    errors.append({"path": f"{path}.series[{series_index}].field", "code": "unknown_field", "message": f"data node {data_plan.id} has no output field '{field_name}'"})
                axis = str(series.get("axis") or "")
                if axis and axis not in axis_ids:
                    errors.append({"path": f"{path}.series[{series_index}].axis", "code": "unknown_axis", "message": f"unknown axis '{axis}'"})
        elif view.get("type") == "table":
            for column_index, column in enumerate(view.get("columns") or []):
                field_name = str((column or {}).get("field") or "") if isinstance(column, dict) else ""
                if field_name not in fields:
                    errors.append({"path": f"{path}.columns[{column_index}].field", "code": "unknown_field", "message": f"data node {data_plan.id} has no output field '{field_name}'"})
        elif view.get("type") == "metric_cards":
            for card_index, card in enumerate(view.get("cards") or []):
                field_name = str((card or {}).get("field") or "") if isinstance(card, dict) else ""
                if field_name not in fields:
                    errors.append({"path": f"{path}.cards[{card_index}].field", "code": "unknown_field", "message": f"data node {data_plan.id} has no output field '{field_name}'"})
                if isinstance(card, dict) and card.get("agg", "first") not in {"first", "sum", "avg", "max", "min"}:
                    errors.append({"path": f"{path}.cards[{card_index}].agg", "code": "unsupported_aggregation", "message": "supported aggregations are first, sum, avg, max, min"})
        manifest[view_id] = {"data": data_plan.id, "type": view.get("type"), "fields": sorted(fields)}
    return manifest


def _validate_interactions_against_plans(interactions: list[dict[str, Any]], manifest: dict[str, dict[str, Any]], parameters: dict[str, SemanticParameterPlan], errors: list[dict[str, str]]) -> None:
    for index, interaction in enumerate(interactions):
        if not isinstance(interaction, dict):
            continue
        source = interaction.get("source") or {}
        action = interaction.get("action") or {}
        view_id = str(source.get("view") or "")
        event_field = str(action.get("value", {}).get("$event") or "") if isinstance(action.get("value"), dict) else ""
        manifest_item = manifest.get(view_id)
        if manifest_item and event_field not in set(manifest_item.get("fields") or []):
            errors.append({"path": f"interactions[{index}].action.value", "code": "unknown_event_field", "message": f"view {view_id} has no output field '{event_field}'"})
        if action.get("parameter") not in parameters:
            # Already reported by structural validation; avoid duplicate noise.
            continue


def _field_descriptor(value: Any) -> tuple[str, str | None]:
    if isinstance(value, str):
        return value, None
    if isinstance(value, dict):
        return str(value.get("field") or ""), value.get("granularity")
    return "", None


def _is_scalar_or_null(value: Any) -> bool:
    return value is None or (isinstance(value, _SCALAR_TYPES) and not isinstance(value, (dict, list, tuple)))


def _find_forbidden_keys(value: Any, path: str = "spec") -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}"
            if key in {"sql", "sqlTemplate", "queryRegistry", "queries", "query", "password", "token", "secret", "apiKey", "api_key", "authorization", "access_token", "accessToken", "bearer"}:
                found.append((child_path, str(key)))
            else:
                found.extend(_find_forbidden_keys(child, child_path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(_find_forbidden_keys(child, f"{path}[{index}]"))
    return found
