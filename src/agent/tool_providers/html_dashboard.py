"""HTML BI dashboard tools.

The public dashboard contract is v3-only:

    datasets -> views -> filters/interactions -> standalone HTML

Legacy `charts=[...]`, `add_chart`, and `remove_chart` entry points were
removed so new dashboard generation cannot drift into a weaker rendering path.
Use `edit_dashboard` with structural operations for existing v3 dashboards.
"""

from __future__ import annotations

from copy import deepcopy
import json
import logging
import re
import time
from typing import Any

from src.agent.tool_providers.base import SessionToolBuildContext, ToolProvider
from src.agent.tool_providers.dashboard_compiler import compile_dashboard_runtime
from src.agent.tool_providers.dashboard_data import load_dashboard_datasets
from src.agent.tool_providers.dashboard_renderer import render_dashboard_runtime_html
from src.agent.tool_providers.dashboard_spec import (
    normalize_dashboard_arguments,
    validate_dashboard_spec,
)
from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent


logger = logging.getLogger("data_agent.html_dashboard")


def _coerce_tool_arguments(arguments: dict[str, Any]) -> dict[str, Any]:
    """Recover tool arguments when a model wraps JSON in a raw payload."""
    if not isinstance(arguments, dict):
        raise ValueError("arguments must be an object")
    if "_raw" not in arguments:
        return arguments

    raw_value = arguments.get("_raw")
    if isinstance(raw_value, str):
        parsed = json.loads(raw_value)
    elif isinstance(raw_value, dict):
        parsed = raw_value
    else:
        raise ValueError("_raw must be a JSON object or JSON object string")
    if not isinstance(parsed, dict):
        raise ValueError("_raw must decode to a JSON object")

    explicit_arguments = {key: value for key, value in arguments.items() if key != "_raw"}
    return {**parsed, **explicit_arguments}


def _normalize_dashboard_operation(operation: dict[str, Any]) -> dict[str, Any]:
    normalized = deepcopy(operation)
    if "op" not in normalized and "type" in normalized:
        normalized["op"] = normalized["type"]

    target = normalized.get("target")
    if isinstance(target, dict):
        for key in ("view_id", "dataset_id", "filter_id", "interaction_id"):
            if key in target and key not in normalized:
                normalized[key] = target[key]
        if "id" in target:
            op = str(normalized.get("op") or "")
            if "view" in op and "view_id" not in normalized:
                normalized["view_id"] = target["id"]
            if "dataset" in op and "dataset_id" not in normalized:
                normalized["dataset_id"] = target["id"]
            if "filter" in op and "filter_id" not in normalized:
                normalized["filter_id"] = target["id"]
            if "interaction" in op and "interaction_id" not in normalized:
                normalized["interaction_id"] = target["id"]
    return normalized


class HTMLDashboardProvider(ToolProvider):
    """Build and edit standalone HTML BI dashboards from v3 specs."""

    async def build_tools(self, context: SessionToolBuildContext) -> list[AgentTool]:
        workspace = context.workspace

        def _make_download_url(relative_path: str) -> str:
            session_id = getattr(workspace, "_session_id", "default")
            return f"/workspace/files/download?path={session_id}/{relative_path}"

        def _resolve_v3_dashboard(dashboard_spec: dict[str, Any]) -> dict[str, Any]:
            datasets = load_dashboard_datasets(dashboard_spec, workspace)
            return compile_dashboard_runtime(dashboard_spec, datasets)

        def _render_dashboard_spec_to_path(
            dashboard_spec: dict[str, Any],
            relative_path: str,
        ) -> tuple[list[str], int]:
            validation_warnings = validate_dashboard_spec(dashboard_spec)
            runtime = _resolve_v3_dashboard(dashboard_spec)
            html_content = render_dashboard_runtime_html(
                runtime,
                dashboard_spec=dashboard_spec,
                assets=dashboard_spec.get("assets", {}),
                exports=dashboard_spec.get("exports"),
            )
            workspace.write_file(relative_path, html_content)
            return validation_warnings, len(runtime.get("views", []))

        def _extract_json_script(html_content: str, script_id: str) -> Any:
            pattern = rf'<script\s+id="{re.escape(script_id)}"\s+type="application/json">\s*(.*?)\s*</script>'
            match = re.search(pattern, html_content, re.DOTALL)
            if not match:
                raise ValueError(f"dashboard does not contain {script_id}")
            return json.loads(match.group(1))

        def _load_embedded_dashboard_spec(dashboard_path: str) -> dict[str, Any]:
            html_content = workspace.read_file(dashboard_path)
            spec = _extract_json_script(html_content, "dashboard-spec")
            if not isinstance(spec, dict) or not spec:
                raise ValueError("dashboard does not contain an editable v3 dashboard-spec; regenerate it with build_dashboard")
            return normalize_dashboard_arguments({"spec": spec})

        def _find_index_by_id(items: list[dict[str, Any]], item_id: str) -> int | None:
            for index, item in enumerate(items):
                if str(item.get("id") or "") == item_id:
                    return index
            return None

        def _apply_dashboard_operation(spec: dict[str, Any], operation: dict[str, Any]) -> str:
            op = str(operation.get("op") or "").strip()
            if not op:
                raise ValueError("operations[].op cannot be empty")

            if op in {"add_view", "replace_view", "remove_view"}:
                views = spec.setdefault("views", [])
                view_id = str(operation.get("view_id") or (operation.get("view") or {}).get("id") or "").strip()
                if op == "add_view":
                    view = deepcopy(operation.get("view"))
                    if not isinstance(view, dict):
                        raise ValueError("add_view requires operation.view")
                    if _find_index_by_id(views, str(view.get("id") or "")) is not None:
                        raise ValueError(f"view id already exists: {view.get('id')}")
                    views.append(view)
                    return f"added view {view.get('id')}"

                if not view_id:
                    raise ValueError(f"{op} requires operation.view_id")
                index = _find_index_by_id(views, view_id)
                if index is None:
                    raise ValueError(f"view not found: {view_id}")
                if op == "remove_view":
                    views.pop(index)
                    spec["interactions"] = [
                        interaction for interaction in spec.get("interactions", [])
                        if (interaction.get("source") or {}).get("view") != view_id
                    ]
                    return f"removed view {view_id}"

                view = deepcopy(operation.get("view"))
                if not isinstance(view, dict):
                    raise ValueError("replace_view requires operation.view")
                view.setdefault("id", view_id)
                views[index] = view
                return f"replaced view {view_id}"

            if op in {"add_filter", "replace_filter", "remove_filter"}:
                filters = spec.setdefault("filters", [])
                filter_id = str(operation.get("filter_id") or (operation.get("filter") or {}).get("id") or "").strip()
                if op == "add_filter":
                    filter_spec = deepcopy(operation.get("filter"))
                    if not isinstance(filter_spec, dict):
                        raise ValueError("add_filter requires operation.filter")
                    if _find_index_by_id(filters, str(filter_spec.get("id") or "")) is not None:
                        raise ValueError(f"filter id already exists: {filter_spec.get('id')}")
                    filters.append(filter_spec)
                    return f"added filter {filter_spec.get('id')}"

                if not filter_id:
                    raise ValueError(f"{op} requires operation.filter_id")
                index = _find_index_by_id(filters, filter_id)
                if index is None:
                    raise ValueError(f"filter not found: {filter_id}")
                if op == "remove_filter":
                    filters.pop(index)
                    return f"removed filter {filter_id}"

                filter_spec = deepcopy(operation.get("filter"))
                if not isinstance(filter_spec, dict):
                    raise ValueError("replace_filter requires operation.filter")
                filter_spec.setdefault("id", filter_id)
                filters[index] = filter_spec
                return f"replaced filter {filter_id}"
            if op in {"add_interaction", "replace_interaction", "remove_interaction"}:
                interactions = spec.setdefault("interactions", [])
                interaction_id = str(operation.get("interaction_id") or (operation.get("interaction") or {}).get("id") or "").strip()
                if op == "add_interaction":
                    interaction = deepcopy(operation.get("interaction"))
                    if not isinstance(interaction, dict):
                        raise ValueError("add_interaction requires operation.interaction")
                    if interaction.get("id") and _find_index_by_id(interactions, str(interaction.get("id"))) is not None:
                        raise ValueError(f"interaction id already exists: {interaction.get('id')}")
                    interactions.append(interaction)
                    return f"added interaction {interaction.get('id', '')}".strip()

                if not interaction_id:
                    raise ValueError(f"{op} requires operation.interaction_id")
                index = _find_index_by_id(interactions, interaction_id)
                if index is None:
                    raise ValueError(f"interaction not found: {interaction_id}")
                if op == "remove_interaction":
                    interactions.pop(index)
                    return f"removed interaction {interaction_id}"

                interaction = deepcopy(operation.get("interaction"))
                if not isinstance(interaction, dict):
                    raise ValueError("replace_interaction requires operation.interaction")
                interaction.setdefault("id", interaction_id)
                interactions[index] = interaction
                return f"replaced interaction {interaction_id}"

            if op in {"add_dataset", "replace_dataset", "remove_dataset"}:
                datasets = spec.setdefault("datasets", [])
                dataset_id = str(operation.get("dataset_id") or (operation.get("dataset") or {}).get("id") or "").strip()
                if op == "add_dataset":
                    dataset = deepcopy(operation.get("dataset"))
                    if not isinstance(dataset, dict):
                        raise ValueError("add_dataset requires operation.dataset")
                    if _find_index_by_id(datasets, str(dataset.get("id") or "")) is not None:
                        raise ValueError(f"dataset id already exists: {dataset.get('id')}")
                    datasets.append(dataset)
                    return f"added dataset {dataset.get('id')}"

                if not dataset_id:
                    raise ValueError(f"{op} requires operation.dataset_id")
                index = _find_index_by_id(datasets, dataset_id)
                if index is None:
                    raise ValueError(f"dataset not found: {dataset_id}")
                if op == "remove_dataset":
                    datasets.pop(index)
                    return f"removed dataset {dataset_id}"

                dataset = deepcopy(operation.get("dataset"))
                if not isinstance(dataset, dict):
                    raise ValueError("replace_dataset requires operation.dataset")
                dataset.setdefault("id", dataset_id)
                datasets[index] = dataset
                return f"replaced dataset {dataset_id}"

            raise ValueError(f"unsupported dashboard edit op: {op}")

        async def _validate_dashboard_spec(
            tool_call_id: str,
            arguments: dict[str, Any],
        ) -> AgentToolResult:
            try:
                arguments = _coerce_tool_arguments(arguments)
                dashboard_spec = normalize_dashboard_arguments(arguments)
                warnings = validate_dashboard_spec(dashboard_spec)
                return AgentToolResult(
                    content=[ToolResultContent(
                        type="text",
                        text=json.dumps(
                            {
                                "status": "valid",
                                "spec_version": dashboard_spec.get("version"),
                                "warnings": warnings,
                            },
                            ensure_ascii=False,
                            indent=2,
                        ),
                    )],
                    details={
                        "status": "valid",
                        "spec_version": dashboard_spec.get("version"),
                        "warnings": warnings,
                    },
                )
            except Exception as exc:
                return AgentToolResult(
                    content=[ToolResultContent(type="text", text=f"Dashboard spec validation failed: {exc}")],
                    details={"status": "invalid", "error": str(exc)},
                    is_error=True,
                )

        async def _build_dashboard(
            tool_call_id: str,
            arguments: dict[str, Any],
        ) -> AgentToolResult:
            try:
                arguments = _coerce_tool_arguments(arguments)
                dashboard_spec = normalize_dashboard_arguments(arguments)
                validation_warnings = validate_dashboard_spec(dashboard_spec)
                filename = dashboard_spec.get("filename") or f"dashboard_{int(time.time())}"
                relative_path = f"dashboards/{filename}.html"
                _, view_count = _render_dashboard_spec_to_path(dashboard_spec, relative_path)
                download_url = _make_download_url(relative_path)
                return AgentToolResult(
                    content=[ToolResultContent(
                        type="text",
                        text=(
                            f"HTML dashboard generated: {filename}.html\n"
                            f"Use this Markdown download link in the final response: "
                            f"[涓嬭浇 {dashboard_spec['title']}]({download_url})"
                        ),
                    )],
                    details={
                        "status": "success",
                        "filename": f"{filename}.html",
                        "relative_path": relative_path,
                        "download_url": download_url,
                        "spec_version": dashboard_spec.get("version"),
                        "view_count": view_count,
                        "validation_warnings": validation_warnings,
                    },
                )
            except Exception as exc:
                return AgentToolResult(
                    content=[ToolResultContent(type="text", text=f"Dashboard generation failed: {exc}")],
                    details={"error": str(exc)},
                    is_error=True,
                )

        async def _edit_dashboard(
            tool_call_id: str,
            arguments: dict[str, Any],
        ) -> AgentToolResult:
            try:
                arguments = _coerce_tool_arguments(arguments)
                dashboard_path = str(arguments.get("dashboard_path") or "").strip()
                operations = arguments.get("operations")
                if not dashboard_path:
                    return AgentToolResult(
                        content=[ToolResultContent(type="text", text="dashboard_path is required")],
                        is_error=True,
                    )
                if not isinstance(operations, list) or not operations:
                    return AgentToolResult(
                        content=[ToolResultContent(type="text", text="operations must be a non-empty array")],
                        is_error=True,
                    )

                try:
                    dashboard_spec = _load_embedded_dashboard_spec(dashboard_path)
                except FileNotFoundError:
                    return AgentToolResult(
                        content=[ToolResultContent(type="text", text=f"dashboard file not found: {dashboard_path}")],
                        is_error=True,
                    )

                applied = []
                for index, operation in enumerate(operations):
                    if not isinstance(operation, dict):
                        return AgentToolResult(
                            content=[ToolResultContent(type="text", text=f"operations[{index}] must be an object")],
                            is_error=True,
                        )
                    applied.append(_apply_dashboard_operation(dashboard_spec, _normalize_dashboard_operation(operation)))

                validation_warnings, view_count = _render_dashboard_spec_to_path(
                    dashboard_spec,
                    dashboard_path,
                )
                download_url = _make_download_url(dashboard_path)
                return AgentToolResult(
                    content=[ToolResultContent(
                        type="text",
                        text=(
                            f"Dashboard updated: {dashboard_path}; current rendered view count: {view_count}.\n"
                            f"Use this Markdown download link in the final response: "
                            f"[涓嬭浇 {dashboard_path}]({download_url})"
                        ),
                    )],
                    details={
                        "status": "success",
                        "dashboard_path": dashboard_path,
                        "download_url": download_url,
                        "applied_operations": applied,
                        "view_count": view_count,
                        "validation_warnings": validation_warnings,
                    },
                )
            except Exception as exc:
                return AgentToolResult(
                    content=[ToolResultContent(type="text", text=f"Dashboard edit failed: {exc}")],
                    details={"error": str(exc)},
                    is_error=True,
                )

        spec_parameter = {
            "type": "object",
            "description": "Dashboard v3 spec. Required fields: version='3', title, datasets, views. Use filters for select controls, interactions for click drilldown, and view insight/recipe/reading_mode/source for auditable presentation intent.",
            "additionalProperties": True,
        }

        return [
            AgentTool(
                name="validate_dashboard_spec",
                label="Validate Dashboard Spec",
                description=(
                    "Validate a v3 HTML BI dashboard spec without generating a file. "
                    "Only the v3 datasets/views/interactions contract is supported; legacy charts input is rejected."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "spec": spec_parameter,
                    },
                    "required": ["spec"],
                },
                execute_fn=_validate_dashboard_spec,
                read_only=True,
                resource="workspace_fs",
                max_concurrency=1,
            ),
            AgentTool(
                name="build_dashboard",
                label="Build Dashboard",
                description=(
                    "Create a standalone HTML BI dashboard from a v3 spec. "
                    "Use datasets/views/filters/interactions only. Do not pass legacy charts, chart_type, add_chart, or remove_chart style descriptors."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "spec": spec_parameter,
                    },
                    "required": ["spec"],
                },
                execute_fn=_build_dashboard,
                read_only=False,
                resource="workspace_fs",
                max_concurrency=1,
            ),
            AgentTool(
                name="edit_dashboard",
                label="Edit Dashboard",
                description=(
                    "Structurally edit an existing v3 HTML dashboard by reading its embedded dashboard-spec, "
                    "applying dataset/view/interaction operations, and re-rendering the whole dashboard."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "dashboard_path": {
                            "type": "string",
                            "description": "Dashboard file path relative to the workspace, for example dashboards/sales.html",
                        },
                        "operations": {
                            "type": "array",
                            "description": (
                                "Structural edit operations. Supports add_view/replace_view/remove_view, "
                                "add_filter/replace_filter/remove_filter, "
                                "add_interaction/replace_interaction/remove_interaction, "
                                "add_dataset/replace_dataset/remove_dataset."
                            ),
                            "items": {
                                "type": "object",
                                "additionalProperties": True,
                            },
                        },
                    },
                    "required": ["dashboard_path", "operations"],
                },
                execute_fn=_edit_dashboard,
                read_only=False,
                resource="workspace_fs",
                max_concurrency=1,
            ),
        ]
