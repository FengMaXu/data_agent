from __future__ import annotations

"""Read-only Semantic Asset Viewer API.

The semantic project is owned by the host-managed KTX runtime.  This module is
intentionally separate from ``knowledge_api``: the latter exposes the static
``knowledge/`` tree, while semantic assets live under the writable KTX project
managed by ``ConfigManager``.
"""

import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.config_manager import config_manager
from src.mcp.manager import mcp_manager

logger = logging.getLogger("data_agent.api.semantic")
router = APIRouter(prefix="/semantic", tags=["semantic"])

_CONNECTION_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
_SOURCE_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_]*$")
_DESCRIPTION_PRIORITY = ("user", "ai", "dbt", "db", "ktx")

SourceKind = Literal[
    "standalone",
    "manifest_only",
    "manifest_with_overlay",
    "standalone_shadows_manifest",
    "orphan_overlay",
]

AssetType = Literal["semantic_model", "business_knowledge"]


class BusinessRuleView(BaseModel):
    id: str
    name: str
    statement: str
    severity: str = "info"
    source: str = ""
    details: list[str] = Field(default_factory=list)


class QueryTemplateParameterView(BaseModel):
    name: str
    description: str = ""


class QueryTemplateView(BaseModel):
    id: str
    name: str
    category: str = ""
    description: str = ""
    parameters: list[QueryTemplateParameterView] = Field(default_factory=list)
    sql: str
    semanticModels: list[str] = Field(default_factory=list)
    executionStatus: str = "advisory"
    notes: list[str] = Field(default_factory=list)


class ColumnView(BaseModel):
    name: str
    type: str | None = None
    role: str | None = None
    descriptions: dict[str, str] = Field(default_factory=dict)
    primaryDescription: str | None = None
    descriptionProvenance: str | None = None
    isGrain: bool = False
    inherited: bool = False


class MeasureView(BaseModel):
    name: str
    expr: str
    description: str | None = None
    filter: str | None = None
    segments: list[str] | None = None


class SegmentView(BaseModel):
    name: str
    expr: str
    description: str | None = None


class JoinView(BaseModel):
    to: str
    on: str
    relationship: str
    alias: str | None = None


class SemanticSourceSummaryDto(BaseModel):
    sourceName: str
    sourceKind: SourceKind
    assetType: AssetType = "semantic_model"
    title: str | None = None
    isQueryable: bool = False
    hasOverlay: bool = False
    description: str = ""


class SemanticConnectionDto(BaseModel):
    connectionId: str
    sources: list[SemanticSourceSummaryDto] = Field(default_factory=list)


class SemanticSourcesResponse(BaseModel):
    connections: list[SemanticConnectionDto] = Field(default_factory=list)


class SemanticSourceViewDto(BaseModel):
    connectionId: str
    sourceName: str
    sourceKind: SourceKind
    assetType: AssetType = "semantic_model"
    title: str | None = None
    isQueryable: bool = False
    rawYaml: str
    table: str | None = None
    sql: str | None = None
    descriptions: dict[str, str] = Field(default_factory=dict)
    primaryDescription: str | None = None
    descriptionProvenance: str | None = None
    grain: list[str] = Field(default_factory=list)
    columns: list[ColumnView] = Field(default_factory=list)
    measures: list[MeasureView] = Field(default_factory=list)
    segments: list[SegmentView] = Field(default_factory=list)
    joins: list[JoinView] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    defaultTimeDimension: str | None = None
    sourceDocuments: list[str] = Field(default_factory=list)
    businessRules: list[BusinessRuleView] = Field(default_factory=list)
    queryTemplates: list[QueryTemplateView] = Field(default_factory=list)


@dataclass
class _SourceStatus:
    in_manifest: bool = False
    overlay_exists: bool = False
    standalone: bool = False
    manifest_entry: dict[str, Any] | None = None
    raw_yaml: str | None = None
    raw_data: dict[str, Any] | None = None


@dataclass
class _ConnectionScan:
    sources: dict[str, _SourceStatus] = field(default_factory=dict)


def _is_valid_connection_id(value: str) -> bool:
    return bool(_CONNECTION_ID_RE.fullmatch(value))


def _is_valid_source_name(value: str) -> bool:
    return bool(_SOURCE_NAME_RE.fullmatch(value))


def _as_record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _parse_yaml_record(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = yaml.safe_load(raw)
    except Exception:
        return {}
    return _as_record(parsed)


def _clean_string_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {
        str(key): text.strip()
        for key, text in value.items()
        if isinstance(text, str) and text.strip()
    }


def _description_map(data: dict[str, Any]) -> dict[str, str]:
    descriptions = _clean_string_map(data.get("descriptions"))
    flat = data.get("description")
    if not descriptions and isinstance(flat, str) and flat.strip():
        descriptions["user"] = flat.strip()
    elif isinstance(flat, str) and flat.strip() and "user" not in descriptions:
        descriptions["user"] = flat.strip()
    return descriptions


def _primary_description(descriptions: dict[str, str]) -> tuple[str | None, str | None]:
    for source in _DESCRIPTION_PRIORITY:
        text = descriptions.get(source)
        if text:
            return text, source
    for source, text in descriptions.items():
        if text:
            return text, source
    return None, None


def _source_kind(status: _SourceStatus) -> SourceKind:
    if status.in_manifest and status.standalone:
        return "standalone_shadows_manifest"
    if status.in_manifest and status.overlay_exists:
        return "manifest_with_overlay"
    if status.in_manifest:
        return "manifest_only"
    if status.overlay_exists and not status.standalone:
        return "orphan_overlay"
    return "standalone"


def _project_manifest_entry(name: str, entry: dict[str, Any]) -> dict[str, Any]:
    raw_columns = entry.get("columns") if isinstance(entry.get("columns"), list) else []
    columns: list[dict[str, Any]] = []
    for raw_column in raw_columns:
        column = _as_record(raw_column)
        column_name = column.get("name")
        if not isinstance(column_name, str) or not column_name:
            continue
        projected = {
            "name": column_name,
            "type": column.get("type"),
            "role": "time" if column.get("type") == "time" else None,
            "descriptions": _clean_string_map(column.get("descriptions")),
        }
        if isinstance(column.get("constraints"), dict):
            projected["constraints"] = column["constraints"]
        columns.append(projected)

    primary_columns = [
        str(_as_record(column).get("name"))
        for column in raw_columns
        if _as_record(column).get("pk") is True and isinstance(_as_record(column).get("name"), str)
    ]
    grain = primary_columns or [column["name"] for column in columns]
    joins = []
    for raw_join in entry.get("joins", []) if isinstance(entry.get("joins"), list) else []:
        join = _as_record(raw_join)
        if isinstance(join.get("to"), str) and isinstance(join.get("on"), str):
            joins.append(
                {
                    "to": join["to"],
                    "on": join["on"],
                    "relationship": join.get("relationship", "unknown"),
                }
            )

    result: dict[str, Any] = {
        "name": name,
        "table": entry.get("table") if isinstance(entry.get("table"), str) else None,
        "descriptions": _clean_string_map(entry.get("descriptions")),
        "grain": grain,
        "columns": columns,
        "measures": [],
        "segments": [],
        "joins": joins,
    }
    if isinstance(entry.get("tags"), dict):
        result["tags"] = entry["tags"]
    if isinstance(entry.get("freshness"), dict):
        result["freshness"] = entry["freshness"]
    return result


def _merge_description_maps(base: Any, override: Any) -> dict[str, str]:
    result = _clean_string_map(base)
    result.update(_clean_string_map(override))
    return result


def _merge_overlay(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    """Project the read-only shape of a KTX manifest + overlay.

    This mirrors the display-relevant branches of KTX ``composeOverlay``.  It
    never writes files and is only used to make the API DTO useful when the
    MCP read operation returns the raw overlay document.
    """
    result = dict(base)
    result["descriptions"] = _merge_description_maps(base.get("descriptions"), overlay.get("descriptions"))

    excluded = {
        item for item in overlay.get("exclude_columns", [])
        if isinstance(item, str)
    } if isinstance(overlay.get("exclude_columns"), list) else set()
    base_columns = [
        column for column in base.get("columns", [])
        if isinstance(column, dict) and column.get("name") not in excluded
    ]
    columns_by_name = {
        str(column.get("name")).lower(): dict(column)
        for column in base_columns
        if isinstance(column.get("name"), str)
    }

    overrides = overlay.get("column_overrides")
    if isinstance(overrides, list):
        for raw_override in overrides:
            override = _as_record(raw_override)
            name = override.get("name")
            if not isinstance(name, str):
                continue
            existing = columns_by_name.get(name.lower())
            if existing is None:
                continue
            merged = {**existing, **override}
            merged["descriptions"] = _merge_description_maps(
                existing.get("descriptions"), override.get("descriptions")
            )
            columns_by_name[name.lower()] = merged

    computed = overlay.get("columns")
    if isinstance(computed, list):
        for raw_column in computed:
            column = _as_record(raw_column)
            name = column.get("name")
            if isinstance(name, str):
                columns_by_name[name.lower()] = dict(column)
    result["columns"] = list(columns_by_name.values())

    for key in ("measures", "segments"):
        if key in overlay and isinstance(overlay[key], list):
            result[key] = overlay[key]
    if isinstance(overlay.get("grain"), list):
        result["grain"] = overlay["grain"]
    if "default_time_dimension" in overlay:
        result["default_time_dimension"] = overlay["default_time_dimension"]

    disabled = {
        " ".join(str(item).split())
        for item in overlay.get("disable_joins", [])
        if isinstance(item, str)
    } if isinstance(overlay.get("disable_joins"), list) else set()
    joins = [
        join for join in base.get("joins", [])
        if isinstance(join, dict) and " ".join(str(join.get("on", "")).split()) not in disabled
    ]
    existing_join_keys = {
        (str(join.get("to")), " ".join(str(join.get("on", "")).split()))
        for join in joins
        if isinstance(join, dict)
    }
    if isinstance(overlay.get("joins"), list):
        for raw_join in overlay["joins"]:
            join = _as_record(raw_join)
            key = (str(join.get("to")), " ".join(str(join.get("on", "")).split()))
            if key not in existing_join_keys:
                joins.append(join)
                existing_join_keys.add(key)
    result["joins"] = joins
    return result


def _semantic_project_dir() -> Path:
    return Path(config_manager.semantic_project_dir).expanduser().resolve()


def _business_semantic_dir(connection_id: str) -> Path:
    return _semantic_project_dir() / "business-semantic" / connection_id


def _scan_business_assets(connection_id: str) -> dict[str, tuple[str, dict[str, Any]]]:
    """Load host-owned business-rule YAML kept outside KTX's executable layer.

    Business rules are explanatory context rather than query sources.  The
    verified SQL templates are stored as executable KTX sources under
    ``semantic-layer/`` and therefore do not pass through this loader.
    """
    root = _business_semantic_dir(connection_id)
    if not root.is_dir():
        return {}
    result: dict[str, tuple[str, dict[str, Any]]] = {}
    root_resolved = root.resolve()
    for path in sorted(root.glob("*.y*ml")):
        try:
            path.resolve().relative_to(root_resolved)
            raw = path.read_text(encoding="utf-8")
            data = _as_record(yaml.safe_load(raw))
        except (OSError, ValueError, yaml.YAMLError):
            logger.warning("Skipping invalid business semantic YAML: %s", path.name)
            continue
        if data.get("asset_type") != "business_knowledge":
            continue
        name = data.get("name")
        if isinstance(name, str) and _is_valid_source_name(name):
            result[name] = (raw, data)
    return result


def _business_rule_views(value: Any) -> list[BusinessRuleView]:
    if not isinstance(value, list):
        return []
    result: list[BusinessRuleView] = []
    for index, raw_rule in enumerate(value):
        rule = _as_record(raw_rule)
        rule_id = rule.get("id")
        name = rule.get("name")
        statement = rule.get("statement")
        if not isinstance(rule_id, str) or not rule_id.strip():
            rule_id = f"rule-{index + 1}"
        if not isinstance(name, str) or not name.strip():
            continue
        if not isinstance(statement, str) or not statement.strip():
            continue
        details = rule.get("details")
        result.append(
            BusinessRuleView(
                id=rule_id,
                name=name,
                statement=statement,
                severity=str(rule.get("severity") or "info"),
                source=str(rule.get("source") or ""),
                details=[item for item in details if isinstance(item, str)] if isinstance(details, list) else [],
            )
        )
    return result


def _query_template_views(value: Any) -> list[QueryTemplateView]:
    if not isinstance(value, list):
        return []
    result: list[QueryTemplateView] = []
    for index, raw_template in enumerate(value):
        template = _as_record(raw_template)
        template_id = template.get("id")
        name = template.get("name")
        sql = template.get("sql")
        if not isinstance(template_id, str) or not template_id.strip():
            template_id = f"template-{index + 1}"
        if not isinstance(name, str) or not name.strip() or not isinstance(sql, str) or not sql.strip():
            continue
        raw_parameters = template.get("parameters")
        parameters: list[QueryTemplateParameterView] = []
        if isinstance(raw_parameters, list):
            for raw_parameter in raw_parameters:
                if isinstance(raw_parameter, str):
                    parameters.append(QueryTemplateParameterView(name=raw_parameter))
                    continue
                parameter = _as_record(raw_parameter)
                parameter_name = parameter.get("name")
                if isinstance(parameter_name, str) and parameter_name.strip():
                    parameters.append(
                        QueryTemplateParameterView(
                            name=parameter_name,
                            description=str(parameter.get("description") or ""),
                        )
                    )
        semantic_models = template.get("semantic_models")
        notes = template.get("notes")
        result.append(
            QueryTemplateView(
                id=template_id,
                name=name,
                category=str(template.get("category") or ""),
                description=str(template.get("description") or ""),
                parameters=parameters,
                sql=sql,
                semanticModels=[item for item in semantic_models if isinstance(item, str)] if isinstance(semantic_models, list) else [],
                executionStatus=str(template.get("execution_status") or "advisory"),
                notes=[item for item in notes if isinstance(item, str)] if isinstance(notes, list) else [],
            )
        )
    return result


def _to_business_view(
    connection_id: str,
    source_name: str,
    raw_yaml: str,
    data: dict[str, Any],
) -> SemanticSourceViewDto:
    descriptions = _description_map(data)
    primary, provenance = _primary_description(descriptions)
    return SemanticSourceViewDto(
        connectionId=connection_id,
        sourceName=source_name,
        sourceKind="standalone",
        assetType="business_knowledge",
        title=data.get("title") if isinstance(data.get("title"), str) else source_name,
        isQueryable=False,
        rawYaml=raw_yaml,
        descriptions=descriptions,
        primaryDescription=primary,
        descriptionProvenance=provenance,
        tags=_flatten_tags(data.get("tags")),
        sourceDocuments=[item for item in data.get("source_documents", []) if isinstance(item, str)]
        if isinstance(data.get("source_documents"), list)
        else [],
        businessRules=_business_rule_views(data.get("business_rules")),
        queryTemplates=_query_template_views(data.get("query_templates")),
    )


def _scan_connection(connection_id: str) -> _ConnectionScan:
    scan = _ConnectionScan()
    connection_dir = _semantic_project_dir() / "semantic-layer" / connection_id
    if not connection_dir.is_dir():
        return scan

    def get_status(name: str) -> _SourceStatus:
        return scan.sources.setdefault(name, _SourceStatus())

    connection_root = connection_dir.resolve()
    for path in sorted(connection_dir.rglob("*.y*ml")):
        try:
            path.resolve().relative_to(connection_root)
        except ValueError:
            # Do not allow a symlinked semantic file to disclose content outside
            # the configured semantic project.
            continue
        relative_parts = path.relative_to(connection_dir).parts
        if "_schema" in relative_parts:
            try:
                data = _as_record(yaml.safe_load(path.read_text(encoding="utf-8")))
            except Exception:
                continue
            tables = data.get("tables")
            if not isinstance(tables, dict):
                continue
            for raw_name, raw_entry in tables.items():
                if not isinstance(raw_name, str) or not _is_valid_source_name(raw_name):
                    continue
                status = get_status(raw_name)
                status.in_manifest = True
                status.manifest_entry = _as_record(raw_entry)
            continue

        try:
            raw_yaml = path.read_text(encoding="utf-8")
            data = _as_record(yaml.safe_load(raw_yaml))
        except Exception:
            continue
        name = data.get("name")
        if not isinstance(name, str) or not _is_valid_source_name(name):
            continue
        status = get_status(name)
        status.raw_yaml = raw_yaml
        status.raw_data = data
        if data.get("table") or data.get("sql"):
            status.standalone = True
        else:
            status.overlay_exists = True

    return scan


def _data_for_status(name: str, status: _SourceStatus, fallback_yaml: str = "") -> tuple[dict[str, Any], set[str]]:
    kind = _source_kind(status)
    if kind == "manifest_only":
        if status.manifest_entry is not None:
            return _project_manifest_entry(name, status.manifest_entry), set()
        return _parse_yaml_record(fallback_yaml), set()
    if kind == "manifest_with_overlay":
        base = _project_manifest_entry(name, status.manifest_entry or {})
        overlay = status.raw_data or _parse_yaml_record(fallback_yaml)
        explicit_columns: set[str] = set()
        raw_columns = overlay.get("columns")
        if isinstance(raw_columns, list):
            explicit_columns.update(
                str(_as_record(column).get("name"))
                for column in raw_columns
                if isinstance(_as_record(column).get("name"), str)
            )
        raw_overrides = overlay.get("column_overrides")
        if isinstance(raw_overrides, list):
            explicit_columns.update(
                str(_as_record(column).get("name"))
                for column in raw_overrides
                if isinstance(_as_record(column).get("name"), str)
            )
        return _merge_overlay(base, overlay), explicit_columns
    if status.raw_data is not None:
        return status.raw_data, set(
            str(_as_record(column).get("name"))
            for column in status.raw_data.get("columns", [])
            if isinstance(_as_record(column).get("name"), str)
        )
    return _parse_yaml_record(fallback_yaml), set()


def _flatten_tags(value: Any) -> list[str]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str) and item.strip()]
    if isinstance(value, dict):
        result: list[str] = []
        for nested in value.values():
            result.extend(_flatten_tags(nested))
        return result
    return []


def _default_time_dimension(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, dict):
        for candidate in ("dbt", "user", "ai"):
            item = value.get(candidate)
            if isinstance(item, str) and item.strip():
                return item.strip()
        for item in value.values():
            if isinstance(item, str) and item.strip():
                return item.strip()
    return None


def _column_view(column: dict[str, Any], grain: set[str], inherited: bool) -> ColumnView:
    descriptions = _description_map(column)
    primary, provenance = _primary_description(descriptions)
    column_name = str(column.get("name") or "")
    return ColumnView(
        name=column_name,
        type=column.get("type") if isinstance(column.get("type"), str) else None,
        role=column.get("role") if isinstance(column.get("role"), str) else None,
        descriptions=descriptions,
        primaryDescription=primary,
        descriptionProvenance=provenance,
        isGrain=column_name in grain,
        inherited=inherited,
    )


def _to_source_view(
    connection_id: str,
    source_name: str,
    kind: SourceKind,
    data: dict[str, Any],
    explicit_columns: set[str],
    raw_yaml: str,
    has_overlay: bool,
) -> SemanticSourceViewDto:
    descriptions = _description_map(data)
    primary, provenance = _primary_description(descriptions)
    grain_values = [item for item in data.get("grain", []) if isinstance(item, str)] if isinstance(data.get("grain"), list) else []
    grain = set(grain_values)

    raw_columns = data.get("columns") if isinstance(data.get("columns"), list) else []
    columns = [
        _column_view(
            _as_record(column),
            grain,
            kind == "manifest_only" or (kind == "manifest_with_overlay" and str(_as_record(column).get("name")) not in explicit_columns),
        )
        for column in raw_columns
        if isinstance(_as_record(column).get("name"), str)
    ]

    measures: list[MeasureView] = []
    for raw_measure in data.get("measures", []) if isinstance(data.get("measures"), list) else []:
        measure = _as_record(raw_measure)
        name = measure.get("name")
        expr = measure.get("expr")
        if not isinstance(name, str) or not isinstance(expr, str):
            continue
        segments = measure.get("segments")
        measures.append(
            MeasureView(
                name=name,
                expr=expr,
                description=measure.get("description") if isinstance(measure.get("description"), str) else None,
                filter=measure.get("filter") if isinstance(measure.get("filter"), str) else None,
                segments=[item for item in segments if isinstance(item, str)] if isinstance(segments, list) else None,
            )
        )

    segments: list[SegmentView] = []
    for raw_segment in data.get("segments", []) if isinstance(data.get("segments"), list) else []:
        segment = _as_record(raw_segment)
        name = segment.get("name")
        expr = segment.get("expr")
        if isinstance(name, str) and isinstance(expr, str):
            segments.append(
                SegmentView(
                    name=name,
                    expr=expr,
                    description=segment.get("description") if isinstance(segment.get("description"), str) else None,
                )
            )

    joins: list[JoinView] = []
    for raw_join in data.get("joins", []) if isinstance(data.get("joins"), list) else []:
        join = _as_record(raw_join)
        if isinstance(join.get("to"), str) and isinstance(join.get("on"), str):
            joins.append(
                JoinView(
                    to=join["to"],
                    on=join["on"],
                    relationship=str(join.get("relationship") or "unknown"),
                    alias=join.get("alias") if isinstance(join.get("alias"), str) else None,
                )
            )

    return SemanticSourceViewDto(
        connectionId=connection_id,
        sourceName=source_name,
        sourceKind=kind,
        isQueryable=bool(data.get("table") or data.get("sql")),
        rawYaml=raw_yaml,
        table=data.get("table") if isinstance(data.get("table"), str) else None,
        sql=data.get("sql") if isinstance(data.get("sql"), str) else None,
        descriptions=descriptions,
        primaryDescription=primary,
        descriptionProvenance=provenance,
        grain=grain_values,
        columns=columns,
        measures=measures,
        segments=segments,
        joins=joins,
        tags=_flatten_tags(data.get("tags")),
        defaultTimeDimension=_default_time_dimension(data.get("default_time_dimension")),
    )


def _semantic_server() -> Any:
    server = mcp_manager.find_server_by_type("semantic")
    if server is None:
        raise HTTPException(status_code=503, detail="Semantic MCP is unavailable")
    return server


async def _call_semantic_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    server = _semantic_server()
    try:
        raw = await server.call_tool(name, arguments)
        value = json.loads(raw)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Semantic MCP call failed: %s (%s)", name, type(exc).__name__)
        raise HTTPException(status_code=503, detail="Semantic MCP request failed") from exc
    if not isinstance(value, dict):
        raise HTTPException(status_code=502, detail="Semantic MCP returned an invalid response")
    if value.get("error"):
        code = str(value.get("error"))
        if code == "semantic_source_not_found":
            raise HTTPException(status_code=404, detail="Semantic source not found")
        if code in {"connection_not_configured", "connection_id_required"}:
            raise HTTPException(status_code=404, detail=code)
        raise HTTPException(status_code=503, detail=code)
    return value


def _discover_connections(payload: dict[str, Any]) -> dict[str, dict[str, dict[str, Any]]]:
    result: dict[str, dict[str, dict[str, Any]]] = {}
    connections = payload.get("connections")
    if not isinstance(connections, list):
        return result
    for raw_connection in connections:
        connection = _as_record(raw_connection)
        connection_id = connection.get("connectionId")
        if not isinstance(connection_id, str) or not _is_valid_connection_id(connection_id):
            continue
        sources: dict[str, dict[str, Any]] = {}
        raw_sources = connection.get("sources")
        if isinstance(raw_sources, list):
            for raw_source in raw_sources:
                source = _as_record(raw_source)
                name = source.get("name")
                if isinstance(name, str) and _is_valid_source_name(name):
                    sources[name] = source
        result[connection_id] = sources
    return result


@router.get("/sources", response_model=SemanticSourcesResponse)
async def list_semantic_sources() -> SemanticSourcesResponse:
    discovered = _discover_connections(await _call_semantic_tool("sl_discover", {}))
    connection_ids = set(discovered)
    project_root = _semantic_project_dir() / "semantic-layer"
    business_root = _semantic_project_dir() / "business-semantic"
    for root in (project_root, business_root):
        if root.is_dir():
            connection_ids.update(
                path.name for path in root.iterdir()
                if path.is_dir() and _is_valid_connection_id(path.name)
            )

    output: list[SemanticConnectionDto] = []
    for connection_id in sorted(connection_ids):
        scan = _scan_connection(connection_id)
        business_assets = _scan_business_assets(connection_id)
        names = set(discovered.get(connection_id, {})) | set(scan.sources) | set(business_assets)
        summaries: list[SemanticSourceSummaryDto] = []
        for source_name in sorted(names):
            business_asset = business_assets.get(source_name)
            if business_asset is not None:
                raw, data = business_asset
                description, _provenance = _primary_description(_description_map(data))
                summaries.append(
                    SemanticSourceSummaryDto(
                        sourceName=source_name,
                        sourceKind="standalone",
                        assetType="business_knowledge",
                        title=data.get("title") if isinstance(data.get("title"), str) else source_name,
                        isQueryable=False,
                        description=description or "",
                    )
                )
                continue

            status = scan.sources.get(source_name, _SourceStatus())
            kind = _source_kind(status)
            # Manifest-only entries are system metadata, not user-facing
            # business semantic models.  They remain available as KTX bases for
            # overlays, but are intentionally absent from this API's catalog.
            if kind == "manifest_only":
                continue
            data, _ = _data_for_status(source_name, status)
            description, _provenance = _primary_description(_description_map(data))
            summaries.append(
                SemanticSourceSummaryDto(
                    sourceName=source_name,
                    sourceKind=kind,
                    assetType="semantic_model",
                    isQueryable=bool(data.get("table") or data.get("sql")),
                    hasOverlay=status.overlay_exists,
                    description=description or "",
                )
            )
        if summaries:
            output.append(SemanticConnectionDto(connectionId=connection_id, sources=summaries))
    return SemanticSourcesResponse(connections=output)


@router.get("/sources/{connection_id}/{source_name}", response_model=SemanticSourceViewDto)
async def get_semantic_source(connection_id: str, source_name: str) -> SemanticSourceViewDto:
    if not _is_valid_connection_id(connection_id):
        raise HTTPException(status_code=400, detail="Invalid semantic connection ID")
    if not _is_valid_source_name(source_name):
        raise HTTPException(status_code=400, detail="Invalid semantic source name")

    business_asset = _scan_business_assets(connection_id).get(source_name)
    if business_asset is not None:
        raw_yaml, data = business_asset
        return _to_business_view(connection_id, source_name, raw_yaml, data)

    payload = await _call_semantic_tool(
        "sl_read_source",
        {"connectionId": connection_id, "sourceName": source_name},
    )
    raw_from_mcp = payload.get("yaml") if isinstance(payload.get("yaml"), str) else ""
    scan = _scan_connection(connection_id)
    status = scan.sources.get(source_name)
    if status is None:
        status = _SourceStatus(raw_yaml=raw_from_mcp or None, raw_data=_parse_yaml_record(raw_from_mcp))
    kind = _source_kind(status)
    if kind == "manifest_only":
        raise HTTPException(status_code=404, detail="System metadata is not a business semantic asset")
    data, explicit_columns = _data_for_status(source_name, status, raw_from_mcp)
    if not data:
        data = _parse_yaml_record(raw_from_mcp)

    raw_yaml = status.raw_yaml or raw_from_mcp
    return _to_source_view(
        connection_id=connection_id,
        source_name=source_name,
        kind=kind,
        data=data,
        explicit_columns=explicit_columns,
        raw_yaml=raw_yaml,
        has_overlay=status.overlay_exists,
    )
