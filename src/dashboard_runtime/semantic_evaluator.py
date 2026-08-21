from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta
import json
import logging
import math
from typing import Any, Protocol

import yaml

from src.mcp.manager import mcp_manager

from .semantic_contract import (
    CompiledSemanticDashboard,
    SemanticDataPlan,
    SemanticDashboardValidationError,
    SemanticOutputColumn,
    SemanticSourceCatalog,
)

logger = logging.getLogger("data_agent.semantic_dashboard.runtime")

MAX_EVALUATE_NODES = 8
QUERY_CONCURRENCY = 2
NODE_TIMEOUT_SECONDS = 15.0
EVALUATE_TIMEOUT_SECONDS = 25.0


class SemanticDashboardEvaluationError(RuntimeError):
    def __init__(self, code: str, message: str, *, status_code: int = 502, details: Any = None):
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details
        super().__init__(message)


class SemanticQueryExecutor(Protocol):
    async def call_sl_query(self, arguments: dict[str, Any]) -> dict[str, Any]: ...


class HostSemanticQueryExecutor:
    """Execute semantic queries through the host-owned KTX MCP connection."""

    async def call_sl_query(self, arguments: dict[str, Any]) -> dict[str, Any]:
        server = mcp_manager.find_server_by_type("semantic")
        if server is None:
            raise SemanticDashboardEvaluationError("semantic_unavailable", "Semantic MCP is unavailable", status_code=503)
        try:
            raw = await server.call_tool("sl_query", arguments)
            value = json.loads(raw)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("semantic dashboard sl_query failed before response: %s", type(exc).__name__)
            raise SemanticDashboardEvaluationError("semantic_query_failed", "Semantic query failed", status_code=503) from exc
        if not isinstance(value, dict):
            raise SemanticDashboardEvaluationError("invalid_query_response", "Semantic MCP returned an invalid response")
        if value.get("error"):
            code = str(value.get("error"))
            message = _safe_query_error_message(code)
            raise SemanticDashboardEvaluationError(code, message)
        return value


async def load_semantic_catalog(
    connection: str,
    source_names: set[str],
    *,
    executor: HostSemanticQueryExecutor | None = None,
) -> dict[str, SemanticSourceCatalog]:
    """Read the current KTX catalog for exactly the sources used by a document."""
    server = mcp_manager.find_server_by_type("semantic")
    if server is None:
        raise SemanticDashboardEvaluationError("semantic_unavailable", "Semantic MCP is unavailable", status_code=503)
    try:
        raw_discover = await server.call_tool("sl_discover", {"connectionId": connection})
        discovered = json.loads(raw_discover)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        raise SemanticDashboardEvaluationError("semantic_discover_failed", "Semantic catalog discovery failed", status_code=503) from exc
    if not isinstance(discovered, dict):
        raise SemanticDashboardEvaluationError("invalid_discover_response", "Semantic catalog response is invalid")
    if discovered.get("error"):
        code = str(discovered.get("error"))
        raise SemanticDashboardEvaluationError(code, _safe_query_error_message(code), status_code=503)

    available = _discover_source_names(discovered, connection)
    missing = sorted(source_names - available)
    if missing:
        raise SemanticDashboardValidationError([
            {"path": "data", "code": "unknown_source", "message": f"semantic source '{name}' is not in the current KTX catalog"}
            for name in missing
        ])

    catalogs: dict[str, SemanticSourceCatalog] = {}
    for source_name in sorted(source_names):
        try:
            raw_source = await server.call_tool(
                "sl_read_source",
                {"connectionId": connection, "sourceName": source_name},
            )
            payload = json.loads(raw_source)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            raise SemanticDashboardEvaluationError("semantic_source_read_failed", f"Could not read semantic source '{source_name}'", status_code=503) from exc
        if not isinstance(payload, dict) or payload.get("error"):
            code = str((payload or {}).get("error") or "semantic_source_read_failed") if isinstance(payload, dict) else "semantic_source_read_failed"
            raise SemanticDashboardEvaluationError(code, f"Could not read semantic source '{source_name}'", status_code=503)
        raw_yaml = payload.get("yaml")
        if not isinstance(raw_yaml, str) or not raw_yaml.strip():
            raise SemanticDashboardValidationError([
                {"path": f"data", "code": "source_not_queryable", "message": f"semantic source '{source_name}' has no readable YAML"}
            ])
        try:
            source = yaml.safe_load(raw_yaml) or {}
        except Exception as exc:
            raise SemanticDashboardValidationError([
                {"path": f"data", "code": "source_invalid", "message": f"semantic source '{source_name}' is not valid YAML"}
            ]) from exc
        catalogs[source_name] = _catalog_from_yaml(source_name, source)
    return catalogs


async def evaluate_semantic_dashboard(
    compiled: CompiledSemanticDashboard,
    parameters: dict[str, Any] | None = None,
    changed: list[str] | None = None,
    *,
    executor: SemanticQueryExecutor | None = None,
    request_id: str = "",
    initial: bool = False,
) -> dict[str, Any]:
    """Evaluate one V4 document using the same plans used by build time and API runtime."""
    query_executor = executor or HostSemanticQueryExecutor()
    normalized_parameters = _normalize_parameters(compiled, parameters or {})
    if changed is not None:
        unknown_changed = sorted(set(changed) - set(compiled.parameters))
        if unknown_changed:
            raise SemanticDashboardEvaluationError("unknown_parameter", f"unknown parameter '{unknown_changed[0]}'", status_code=400)
    try:
        return await asyncio.wait_for(
            _evaluate_inner(
                compiled,
                normalized_parameters,
                changed,
                query_executor,
                request_id=request_id,
                initial=initial,
            ),
            timeout=EVALUATE_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as exc:
        raise SemanticDashboardEvaluationError("evaluate_timeout", "Dashboard evaluation timed out", status_code=504) from exc


async def _evaluate_inner(
    compiled: CompiledSemanticDashboard,
    parameters: dict[str, Any],
    changed: list[str] | None,
    executor: SemanticQueryExecutor,
    *,
    request_id: str,
    initial: bool,
) -> dict[str, Any]:
    option_nodes = set(compiled.option_nodes)
    if initial or changed is None:
        target_nodes = set(compiled.data)
    else:
        target_nodes = compiled.affected_data(changed)
    query_nodes = option_nodes | target_nodes
    if len(query_nodes) > MAX_EVALUATE_NODES:
        raise SemanticDashboardEvaluationError(
            "too_many_query_nodes",
            f"one evaluation may execute at most {MAX_EVALUATE_NODES} data nodes",
            status_code=400,
        )

    results: dict[str, dict[str, Any]] = {}
    errors: dict[str, dict[str, str]] = {}
    semaphore = asyncio.Semaphore(QUERY_CONCURRENCY)

    async def run_node(node_id: str, current_parameters: dict[str, Any]) -> None:
        plan = compiled.data[node_id]
        async with semaphore:
            try:
                result = await asyncio.wait_for(
                    _evaluate_node(compiled, plan, current_parameters, executor),
                    timeout=NODE_TIMEOUT_SECONDS,
                )
                results[node_id] = result
                logger.info("semantic dashboard node=%s rows=%s", node_id, result.get("totalRows", 0))
            except asyncio.CancelledError:
                raise
            except SemanticDashboardEvaluationError as exc:
                logger.warning("semantic dashboard node=%s failed code=%s", node_id, exc.code)
                errors[node_id] = {"code": exc.code, "message": exc.message}
            except Exception:
                logger.exception("semantic dashboard node=%s failed unexpectedly", node_id)
                errors[node_id] = {"code": "query_failed", "message": "Dashboard data query failed"}

    # Options are evaluated first. This is both the allow-list check and the
    # security boundary: an invalid browser value must not trigger a business
    # query before it is rejected.
    await asyncio.gather(*(run_node(node_id, parameters) for node_id in sorted(option_nodes)))
    for parameter, node_id in compiled.options_by_parameter.items():
        if node_id in errors:
            raise SemanticDashboardEvaluationError(
                "options_unavailable",
                f"parameter '{parameter}' options could not be verified",
                status_code=503,
            )
        if node_id not in results:
            continue
        allowed = _option_values(compiled, parameter, results[node_id])
        value = parameters.get(parameter)
        if value is not None and not _contains_value(allowed, value):
            raise SemanticDashboardEvaluationError(
                "parameter_value_not_allowed",
                f"parameter '{parameter}' value is not in its declared options",
                status_code=400,
            )
        if value is not None:
            parameters[parameter] = _canonical_option_value(allowed, value)

    business_nodes = target_nodes - option_nodes
    await asyncio.gather(*(run_node(node_id, parameters) for node_id in sorted(business_nodes)))

    if initial:
        returned_nodes = set(results)
    else:
        returned_nodes = target_nodes & set(results)
    return {
        "requestId": request_id,
        "parameters": parameters,
        "data": {node_id: results[node_id] for node_id in sorted(returned_nodes)},
        "errors": {node_id: errors[node_id] for node_id in sorted(errors) if node_id not in option_nodes},
    }


async def _evaluate_node(
    compiled: CompiledSemanticDashboard,
    plan: SemanticDataPlan,
    parameters: dict[str, Any],
    executor: SemanticQueryExecutor,
) -> dict[str, Any]:
    filters: list[dict[str, Any]] = []
    for item in plan.filters:
        value = parameters.get(item.parameter) if item.parameter else item.literal
        if item.parameter and value is None:
            continue
        if value is None:
            raise SemanticDashboardEvaluationError("invalid_filter_value", f"data node '{plan.id}' has a null eq filter")
        filters.append({
            "field": f"{plan.source}.{item.source_field}",
            "operator": item.operator,
            "value": value,
        })
    dimensions: list[Any] = []
    for column in plan.dimensions:
        ref = f"{plan.source}.{column.source_field}"
        dimensions.append({"field": ref, "granularity": column.granularity} if column.granularity else ref)
    measures = [f"{plan.source}.{column.source_field}" for column in plan.measures]
    order_by = [
        {"field": f"{plan.source}.{item.source_field}", "direction": item.direction}
        for item in plan.order_by
    ]
    payload = await executor.call_sl_query({
        "connectionId": compiled.connection,
        "measures": measures,
        "dimensions": dimensions,
        "filters": filters,
        "orderBy": order_by,
        "limit": plan.limit,
        "maxRows": plan.limit,
    })
    return _map_query_result(plan, payload, parameters)


def _map_query_result(plan: SemanticDataPlan, payload: dict[str, Any], parameters: dict[str, Any]) -> dict[str, Any]:
    headers = payload.get("headers")
    rows = payload.get("rows")
    if not isinstance(headers, list) or not all(isinstance(header, str) for header in headers):
        raise SemanticDashboardEvaluationError("invalid_query_headers", f"data node '{plan.id}' returned invalid headers")
    if len(headers) != len(plan.outputs):
        raise SemanticDashboardEvaluationError(
            "column_contract_mismatch",
            f"data node '{plan.id}' returned {len(headers)} columns; expected {len(plan.outputs)}",
        )
    if not isinstance(rows, list):
        raise SemanticDashboardEvaluationError("invalid_query_rows", f"data node '{plan.id}' returned invalid rows")

    expected = [column.expected_header for column in plan.outputs]
    if len(set(headers)) != len(headers):
        raise SemanticDashboardEvaluationError("duplicate_query_headers", f"data node '{plan.id}' returned duplicate headers")
    if all(name in headers for name in expected):
        positions = [headers.index(name) for name in expected]
    else:
        # KTX connectors can expose a driver-specific name for a derived column.
        # Once the column count is proven, position is still deterministic because
        # KTX preserves request order. The mismatch is retained in logs, not hidden.
        positions = list(range(len(expected)))
        logger.warning("semantic dashboard node=%s using position column mapping headers=%s expected=%s", plan.id, headers, expected)

    mapped_rows: list[dict[str, Any]] = []
    for row_index, raw_row in enumerate(rows):
        if not isinstance(raw_row, list) or len(raw_row) != len(headers):
            raise SemanticDashboardEvaluationError("invalid_query_row", f"data node '{plan.id}' row {row_index} has an invalid column count")
        mapped_rows.append({
            column.output_name: _coerce_output_value(raw_row[position], column)
            for column, position in zip(plan.outputs, positions)
        })

    return {
        "rows": mapped_rows,
        "totalRows": int(payload.get("totalRows") or len(mapped_rows)),
        "fingerprint": _fingerprint(parameters, plan.dependencies),
    }


def _normalize_parameters(compiled: CompiledSemanticDashboard, parameters: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(parameters, dict):
        raise SemanticDashboardEvaluationError("invalid_parameters", "parameters must be an object", status_code=400)
    unknown = sorted(set(parameters) - set(compiled.parameters))
    if unknown:
        raise SemanticDashboardEvaluationError("unknown_parameter", f"unknown parameter '{unknown[0]}'", status_code=400)
    normalized: dict[str, Any] = {}
    for name, plan in compiled.parameters.items():
        value = parameters[name] if name in parameters else plan.default
        if value is not None and not isinstance(value, (str, int, float, bool)):
            raise SemanticDashboardEvaluationError("invalid_parameter_type", f"parameter '{name}' must be a scalar or null", status_code=400)
        if isinstance(value, str) and len(value) > 500:
            raise SemanticDashboardEvaluationError("parameter_too_long", f"parameter '{name}' is too long", status_code=400)
        normalized[name] = value
    return normalized


def _option_values(compiled: CompiledSemanticDashboard, parameter: str, result: dict[str, Any]) -> list[Any]:
    plan = compiled.parameters[parameter]
    values = []
    seen: set[str] = set()
    for row in result.get("rows", []):
        value = row.get(plan.options_field) if isinstance(row, dict) else None
        if value is None:
            continue
        key = _value_key(value)
        if key not in seen:
            seen.add(key)
            values.append(value)
    return values


def _contains_value(values: list[Any], value: Any) -> bool:
    # HTML select controls submit strings even when an option originates from a
    # numeric connector value. Compare primitive display values consistently.
    return any(_value_key(item) == _value_key(value) or str(item) == str(value) for item in values)


def _canonical_option_value(values: list[Any], value: Any) -> Any:
    for item in values:
        if _value_key(item) == _value_key(value) or str(item) == str(value):
            return item
    return value


def _value_key(value: Any) -> str:
    if isinstance(value, float) and math.isnan(value):
        return "NaN"
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


def _fingerprint(parameters: dict[str, Any], dependencies: frozenset[str]) -> str:
    relevant = {key: parameters.get(key) for key in sorted(dependencies)}
    return json.dumps(relevant, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _coerce_output_value(value: Any, column: SemanticOutputColumn) -> Any:
    if value is None:
        return None
    if column.granularity == "month":
        return _normalize_month_value(value)
    value_type = str(column.value_type or "").lower()
    if value_type in {"number", "integer", "float", "decimal"}:
        if isinstance(value, (int, float)):
            return value
        text = str(value).strip().replace(",", "").replace("%", "")
        try:
            number = float(text)
            return int(number) if number.is_integer() else number
        except ValueError:
            return value
    if value_type in {"boolean", "bool"} and isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes"}
    return value


def _normalize_month_value(value: Any) -> str:
    text = str(value).strip()
    try:
        if text.endswith("Z"):
            parsed = datetime.fromisoformat(text[:-1] + "+00:00")
            # The observed MySQL connector represents a DATE at UTC midnight
            # with the previous local calendar day at 16:00Z. Adding one day
            # only for a non-midnight timestamp restores the source month.
            if parsed.time() != datetime.min.time():
                parsed = parsed + timedelta(days=1)
            return f"{parsed.year:04d}-{parsed.month:02d}-01"
        parsed_date = date.fromisoformat(text[:10])
        return f"{parsed_date.year:04d}-{parsed_date.month:02d}-01"
    except (TypeError, ValueError):
        return text


def _catalog_from_yaml(name: str, source: dict[str, Any]) -> SemanticSourceCatalog:
    columns: set[str] = set()
    field_types: dict[str, str] = {}
    raw_columns = source.get("columns") if isinstance(source, dict) else []
    if isinstance(raw_columns, list):
        for raw in raw_columns:
            if isinstance(raw, dict) and isinstance(raw.get("name"), str):
                field_name = raw["name"]
                columns.add(field_name)
                if isinstance(raw.get("type"), str):
                    field_types[field_name] = raw["type"]
    measures: set[str] = set()
    raw_measures = source.get("measures") if isinstance(source, dict) else []
    if isinstance(raw_measures, list):
        for raw in raw_measures:
            if isinstance(raw, dict) and isinstance(raw.get("name"), str):
                measures.add(raw["name"])
                field_types.setdefault(raw["name"], "number")
    queryable = bool(source.get("table") or source.get("sql")) if isinstance(source, dict) else False
    return SemanticSourceCatalog(name=name, columns=frozenset(columns), measures=frozenset(measures), field_types=field_types, queryable=queryable)


def _discover_source_names(payload: dict[str, Any], connection: str) -> set[str]:
    for raw_connection in payload.get("connections", []) if isinstance(payload.get("connections"), list) else []:
        if not isinstance(raw_connection, dict) or raw_connection.get("connectionId") != connection:
            continue
        return {
            str(item.get("name"))
            for item in raw_connection.get("sources", [])
            if isinstance(item, dict) and isinstance(item.get("name"), str)
        }
    return set()


def _safe_query_error_message(code: str) -> str:
    messages = {
        "connection_not_configured": "Semantic connection is not configured",
        "connection_id_required": "A semantic connection ID is required",
        "semantic_source_not_found": "Semantic source was not found",
        "semantic_operation_failed": "Semantic query execution failed",
        "query_budget_exceeded": "Semantic query exceeded its row budget",
    }
    return messages.get(code, "Semantic query failed")
