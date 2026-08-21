from __future__ import annotations

import json
import re
from typing import Any

from src.agent.tool_providers.base import SessionToolBuildContext, ToolProvider
from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent
from src.dashboard_runtime.semantic_contract import (
    SemanticDashboardValidationError,
    compile_semantic_dashboard,
    normalize_semantic_dashboard_spec,
)
from src.dashboard_runtime.semantic_evaluator import (
    SemanticDashboardEvaluationError,
    evaluate_semantic_dashboard,
    load_semantic_catalog,
)
from src.dashboard_runtime.semantic_renderer import render_semantic_dashboard_html


_FILENAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$")


class SemanticDashboardProvider(ToolProvider):
    """Agent tools for the canonical KTX semantic dashboard V4 path."""

    async def build_tools(self, context: SessionToolBuildContext) -> list[AgentTool]:
        workspace = context.workspace

        def download_url(relative_path: str) -> str:
            session_id = getattr(workspace, "_session_id", "default")
            return f"/workspace/files/download?path={session_id}/{relative_path}"

        async def prepare(spec: dict[str, Any], *, execute: bool) -> tuple[Any, dict[str, Any] | None]:
            normalized = normalize_semantic_dashboard_spec(spec)
            source_names = {
                str(node.get("source"))
                for node in normalized.get("data", {}).values()
                if isinstance(node, dict) and node.get("source")
            }
            catalog = await load_semantic_catalog(normalized["connection"], source_names)
            compiled = compile_semantic_dashboard(normalized, catalog)
            if not execute:
                return compiled, None
            evaluation = await evaluate_semantic_dashboard(compiled, request_id="build", initial=True)
            if evaluation.get("errors"):
                errors = [
                    {
                        "path": f"data.{node_id}",
                        "code": error.get("code", "query_failed"),
                        "message": error.get("message", "Initial query failed"),
                    }
                    for node_id, error in evaluation["errors"].items()
                ]
                raise SemanticDashboardEvaluationError(
                    "initial_query_failed",
                    "One or more default semantic dashboard queries failed",
                    details=errors,
                )
            return compiled, evaluation

        async def validate_tool(tool_call_id: str, arguments: dict[str, Any]) -> AgentToolResult:
            try:
                spec = arguments.get("spec") if isinstance(arguments, dict) else None
                compiled, _ = await prepare(spec, execute=False)
                return AgentToolResult(
                    content=[ToolResultContent(type="text", text=json.dumps({
                        "status": "valid",
                        "spec_version": compiled.spec["version"],
                        "connection": compiled.connection,
                        "data_nodes": list(compiled.data),
                        "view_count": len(compiled.view_manifest),
                    }, ensure_ascii=False, indent=2))],
                    details={
                        "status": "valid",
                        "spec_version": compiled.spec["version"],
                        "connection": compiled.connection,
                        "data_nodes": list(compiled.data),
                        "view_count": len(compiled.view_manifest),
                    },
                )
            except Exception as exc:
                details = _error_details(exc)
                return AgentToolResult(
                    content=[ToolResultContent(type="text", text=json.dumps(details, ensure_ascii=False, indent=2))],
                    details=details,
                    is_error=True,
                )

        async def build_tool(tool_call_id: str, arguments: dict[str, Any]) -> AgentToolResult:
            try:
                if not isinstance(arguments, dict):
                    raise SemanticDashboardValidationError("arguments must be an object")
                spec = arguments.get("spec")
                compiled, evaluation = await prepare(spec, execute=True)
                filename = compiled.spec.get("filename") or _default_filename(compiled.spec["title"])
                if not isinstance(filename, str) or not _FILENAME_RE.fullmatch(filename):
                    raise SemanticDashboardValidationError([
                        {"path": "filename", "code": "invalid_filename", "message": "filename must contain only letters, numbers, '_' or '-'"}
                    ])
                relative_path = f"dashboards/{filename}.html"
                html = render_semantic_dashboard_html(
                    compiled,
                    evaluation or {},
                    assets=compiled.spec.get("assets") if isinstance(compiled.spec.get("assets"), dict) else None,
                )
                workspace.write_file(relative_path, html)
                details = {
                    "status": "success",
                    "filename": f"{filename}.html",
                    "relative_path": relative_path,
                    "download_url": download_url(relative_path),
                    "spec_version": "4",
                    "view_count": len(compiled.view_manifest),
                    "data_node_count": len(compiled.data),
                    "live_preview": True,
                }
                text = (
                    f"Semantic HTML dashboard generated: {filename}.html\n"
                    f"Use this Markdown download link in the final response: "
                    f"[下载 {compiled.spec['title']}]({details['download_url']})"
                )
                return AgentToolResult(content=[ToolResultContent(type="text", text=text)], details=details)
            except Exception as exc:
                details = _error_details(exc)
                return AgentToolResult(
                    content=[ToolResultContent(type="text", text=json.dumps(details, ensure_ascii=False, indent=2))],
                    details=details,
                    is_error=True,
                )

        spec_parameter = {
            "type": "object",
            "description": "Dashboard V4 semantic document. Required: version='4', title, connection, parameters, data, views.",
            "additionalProperties": True,
        }
        return [
            AgentTool(
                name="validate_semantic_dashboard_spec",
                label="Validate Semantic Dashboard Spec",
                description=(
                    "Validate a V4 KTX semantic dashboard, including the live semantic catalog. "
                    "No dashboard file or query result snapshot is written."
                ),
                parameters={"type": "object", "properties": {"spec": spec_parameter}, "required": ["spec"]},
                execute_fn=validate_tool,
                read_only=True,
                resource="semantic_query",
                max_concurrency=1,
            ),
            AgentTool(
                name="build_semantic_dashboard",
                label="Build Semantic Dashboard",
                description=(
                    "Build a V4 KTX semantic dashboard. It executes the default data nodes through the host-managed "
                    "semantic MCP, embeds only a snapshot and canonical document, and enables authenticated live preview refresh."
                ),
                parameters={"type": "object", "properties": {"spec": spec_parameter}, "required": ["spec"]},
                execute_fn=build_tool,
                read_only=False,
                resource="semantic_query",
                max_concurrency=1,
            ),
        ]


def _default_filename(title: str) -> str:
    candidate = re.sub(r"[^A-Za-z0-9_-]+", "_", title).strip("_") or "semantic_dashboard"
    return candidate[:96]


def _error_details(exc: Exception) -> dict[str, Any]:
    if isinstance(exc, SemanticDashboardValidationError):
        return {"status": "invalid_spec", "errors": exc.errors}
    if isinstance(exc, SemanticDashboardEvaluationError):
        error = {"code": exc.code, "message": exc.message}
        if exc.details is not None:
            error["details"] = exc.details
        return {"status": "evaluation_failed", "error": error}
    return {"status": "error", "error": str(exc)}
