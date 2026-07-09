from __future__ import annotations

from typing import Any

from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent


SUPPORTED_WIDGET_KINDS = {
    "metric_cards",
    "table",
    "chart",
    "steps",
    "rich_text",
    "echarts",
}


def _ensure_object(value: Any, field_name: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} 必须是对象")
    return value


def _ensure_list(value: Any, field_name: str) -> list[Any]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{field_name} 必须是数组")
    return value


def _normalize_widget_spec(tool_call_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    kind = arguments.get("kind")
    if kind not in SUPPORTED_WIDGET_KINDS:
        raise ValueError(
            f"kind 必须是 {', '.join(sorted(SUPPORTED_WIDGET_KINDS))} 之一"
        )

    title = str(arguments.get("title") or "").strip()
    if not title:
        raise ValueError("title 不能为空")

    subtitle = str(arguments.get("subtitle") or "").strip()
    data = _ensure_list(arguments.get("data"), "data")
    series = _ensure_list(arguments.get("series"), "series")
    columns = _ensure_list(arguments.get("columns"), "columns")
    actions = _ensure_list(arguments.get("actions"), "actions")
    metadata = _ensure_object(arguments.get("metadata"), "metadata")

    raw_html = arguments.get("raw_html")
    if raw_html is not None and not isinstance(raw_html, str):
        raise ValueError("raw_html 必须是字符串")

    raw_svg = arguments.get("raw_svg")
    if raw_svg is not None and not isinstance(raw_svg, str):
        raise ValueError("raw_svg 必须是字符串")

    config = arguments.get("config")
    if config is not None and not isinstance(config, dict):
        raise ValueError("config must be an object")

    widget_id = str(arguments.get("widget_id") or tool_call_id).strip() or tool_call_id

    spec = {
        "widget_id": widget_id,
        "kind": kind,
        "title": title,
        "subtitle": subtitle,
        "data": data,
        "series": series,
        "columns": columns,
        "actions": actions,
        "metadata": metadata,
    }
    if raw_html:
        spec["raw_html"] = raw_html
    if raw_svg:
        spec["raw_svg"] = raw_svg
    if config is not None:
        spec["config"] = config

    return spec


async def _show_widget(tool_call_id: str, arguments: dict[str, Any]) -> AgentToolResult:
    try:
        spec = _normalize_widget_spec(tool_call_id, arguments)
    except ValueError as exc:
        return AgentToolResult(
            content=[ToolResultContent(type="text", text=f"show_widget 参数错误：{exc}")],
            details={
                "widget_id": str(arguments.get("widget_id") or tool_call_id),
                "error": str(exc),
                "input": arguments,
            },
            is_error=True,
        )

    confirmation = f"已展示{spec['title']}组件"
    return AgentToolResult(
        content=[ToolResultContent(type="text", text=confirmation)],
        details=spec,
    )


def create_show_widget_tool() -> AgentTool:
    return AgentTool(
        name="show_widget",
        label="Show Widget",
        description=(
            "Display a structured UI widget inline in the chat. "
            "Use this for KPI cards, tables, charts, steps, and rich text summaries. "
            "Do not use this tool to display file download links; output Markdown links "
            "directly in the assistant response instead. "
            "Use kind='echarts' ONLY when the user explicitly requests a chart, visualization, "
            "dashboard, or trend analysis. For simple data queries, use table/metric_cards/chart instead. "
            "When kind='echarts', provide a complete ECharts option object in the 'config' field; "
            "the data/series/columns fields are ignored."
        ),
        parameters={
            "type": "object",
            "properties": {
                "widget_id": {
                    "type": "string",
                    "description": "Stable widget ID for this assistant response. Reuse when updating the same widget.",
                },
                "kind": {
                    "type": "string",
                    "enum": sorted(SUPPORTED_WIDGET_KINDS),
                    "description": "Widget kind to render. Use 'echarts' only for explicit visualization requests.",
                },
                "title": {
                    "type": "string",
                    "description": "Short widget title shown in the UI.",
                },
                "subtitle": {
                    "type": "string",
                    "description": "Optional supporting subtitle.",
                },
                "data": {
                    "type": "array",
                    "description": "Primary data rows or card items.",
                    "items": {"type": "object"},
                },
                "series": {
                    "type": "array",
                    "description": "Chart series definitions.",
                    "items": {"type": "object"},
                },
                "columns": {
                    "type": "array",
                    "description": "Table column definitions.",
                    "items": {"type": "object"},
                },
                "actions": {
                    "type": "array",
                    "description": "Optional read-only action metadata for display.",
                    "items": {"type": "object"},
                },
                "metadata": {
                    "type": "object",
                    "description": "Optional rendering metadata.",
                    "additionalProperties": True,
                },
                "raw_html": {
                    "type": "string",
                    "description": "Optional fallback HTML. Not used as the primary rendering path.",
                },
                "raw_svg": {
                    "type": "string",
                    "description": "Optional fallback SVG. Not used as the primary rendering path.",
                },
                "config": {
                    "type": "object",
                    "description": "ECharts option object. ONLY used when kind='echarts'. Include xAxis, yAxis, series, tooltip, legend etc.",
                    "additionalProperties": True,
                },
            },
            "required": ["kind", "title"],
        },
        execute_fn=_show_widget,
        read_only=False,
        resource="ui",
        max_concurrency=1,
    )
