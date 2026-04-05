"""HTML BI 看板生成工具 — 声明式数据驱动架构

工具列表:
  - build_dashboard: 通过声明式图表描述 + CSV 数据文件创建完整看板
  - add_chart: 向已有看板增量追加单个图表
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any

from jinja2 import Template

from src.agent.tool_providers.base import SessionToolBuildContext, ToolProvider
from src.agent.tool_providers.chart_builder import (
    build_drilldown_data,
    build_echarts_option,
)
from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent

logger = logging.getLogger("data_agent.html_dashboard")

# ─────────────────────────────────────────────
# 图表描述 JSON Schema（复用于两个工具）
# ─────────────────────────────────────────────

_CHART_DESCRIPTOR_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "图表标题"},
        "subtitle": {"type": "string", "description": "图表副标题（可选）"},
        "chart_type": {
            "type": "string",
            "enum": ["line", "bar", "pie", "scatter", "radar", "custom"],
            "description": (
                "图表类型。line/bar/pie/scatter/radar 会自动从 data_file "
                "构建 ECharts option；custom 需手动提供 echarts_option"
            ),
        },
        "data_file": {
            "type": "string",
            "description": "CSV 数据文件路径（相对于 workspace），如 'data/sales.csv'",
        },
        "x_column": {"type": "string", "description": "X 轴列名（line/bar/scatter 用）"},
        "y_columns": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Y 轴列名列表（line/bar 用）",
        },
        "y_column": {"type": "string", "description": "Y 轴列名（scatter 用）"},
        "name_column": {"type": "string", "description": "名称列（pie 用）"},
        "value_column": {"type": "string", "description": "数值列（pie 用）"},
        "indicator_column": {"type": "string", "description": "指标列（radar 用）"},
        "value_columns": {
            "type": "array",
            "items": {"type": "string"},
            "description": "数值列列表（radar 用）",
        },
        "width": {"type": "string", "description": "图表宽度，如 '50%' 或 '100%'，默认 '50%'"},
        "height": {"type": "string", "description": "图表高度，如 '400px'，默认 '360px'"},
        "echarts_option": {
            "type": "object",
            "description": "chart_type='custom' 时的完整 ECharts option，或作为其他类型的覆盖配置",
        },
        "drilldown": {
            "type": "object",
            "description": "下钻配置（可选）",
            "properties": {
                "detail_data_file": {
                    "type": "string",
                    "description": "下钻明细数据 CSV 路径",
                },
                "detail_chart_type": {
                    "type": "string",
                    "enum": ["line", "bar", "pie", "scatter"],
                    "description": "下钻图表类型，默认 bar",
                },
                "detail_x_column": {"type": "string"},
                "detail_y_columns": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "detail_name_column": {"type": "string"},
                "detail_value_column": {"type": "string"},
                "group_column": {
                    "type": "string",
                    "description": "按此列分组，值对应父图表的数据点名称",
                },
            },
            "required": ["detail_data_file", "group_column"],
        },
    },
    "required": ["title", "chart_type"],
}


# ─────────────────────────────────────────────
# Provider
# ─────────────────────────────────────────────


class HTMLDashboardProvider(ToolProvider):
    """声明式 HTML BI 看板生成器"""

    async def build_tools(self, context: SessionToolBuildContext) -> list[AgentTool]:
        workspace = context.workspace
        template_path = os.path.join(
            os.path.dirname(__file__),
            "../../templates/dashboard_template.html",
        )

        # ─── 内部辅助 ───

        def _resolve_chart(chart_desc: dict[str, Any]) -> dict[str, Any]:
            """将单个声明式图表描述解析为模板所需的完整 chart 对象。"""
            chart_type = chart_desc.get("chart_type", "custom")
            data_file = chart_desc.get("data_file")

            # 读取 CSV 数据
            csv_content = None
            if data_file and chart_type != "custom":
                try:
                    csv_content = workspace.read_file(data_file)
                except FileNotFoundError:
                    raise ValueError(f"数据文件不存在: {data_file}")

            # 构建 ECharts option
            echarts_option = build_echarts_option(chart_desc, csv_content)

            # 构建下钻数据
            drilldown_data = None
            drilldown = chart_desc.get("drilldown")
            if drilldown:
                dd_file = drilldown.get("detail_data_file")
                if dd_file:
                    try:
                        dd_csv = workspace.read_file(dd_file)
                        drilldown_data = build_drilldown_data(drilldown, dd_csv)
                    except FileNotFoundError:
                        logger.warning("下钻数据文件不存在: %s，跳过下钻配置", dd_file)

            return {
                "title": chart_desc.get("title", ""),
                "subtitle": chart_desc.get("subtitle", ""),
                "width": chart_desc.get("width", "50%"),
                "height": chart_desc.get("height", "360px"),
                "echarts_option": echarts_option,
                "drilldown_data": drilldown_data,
            }

        def _render_html(title: str, charts: list[dict], theme: str) -> str:
            """使用 Jinja2 模板渲染 HTML。"""
            with open(template_path, "r", encoding="utf-8") as f:
                template = Template(f.read())
            return template.render(
                title=title,
                charts=charts,
                charts_json=json.dumps(charts, ensure_ascii=False),
                theme=theme,
            )

        def _make_result(title: str, fname: str, relative_path: str) -> AgentToolResult:
            """构建统一的成功返回结果。"""
            session_id = getattr(workspace, "_session_id", "default")
            full_relative_path = f"{session_id}/{relative_path}"
            download_url = f"/workspace/files/download?path={full_relative_path}"
            return AgentToolResult(
                content=[ToolResultContent(
                    type="text",
                    text=(
                        f"HTML 看板已生成：{fname}.html\n"
                        f"请接下来调用 show_widget(kind='file_link', title='{title}', "
                        f"file_path='{relative_path}', download_url='{download_url}', "
                        f"file_type='html') 将看板展示给用户。"
                    ),
                )],
                details={
                    "status": "success",
                    "filename": f"{fname}.html",
                    "relative_path": relative_path,
                    "download_url": download_url,
                },
            )

        # ─── 工具 1: build_dashboard ───

        async def _build_dashboard(
            tool_call_id: str,
            arguments: dict[str, Any],
        ) -> AgentToolResult:
            try:
                title = arguments.get("title", "Dashboard")
                chart_descs = arguments.get("charts", [])
                filename = arguments.get("filename")
                theme = arguments.get("theme", "light")

                if not isinstance(chart_descs, list) or not chart_descs:
                    return AgentToolResult(
                        content=[ToolResultContent(type="text", text="charts 参数必须是非空数组")],
                        is_error=True,
                    )

                # 解析每个图表
                resolved_charts = []
                for i, desc in enumerate(chart_descs):
                    try:
                        resolved_charts.append(_resolve_chart(desc))
                    except Exception as e:
                        return AgentToolResult(
                            content=[ToolResultContent(
                                type="text",
                                text=f"图表 #{i + 1} ({desc.get('title', '未命名')}) 构建失败: {e}",
                            )],
                            is_error=True,
                        )

                # 渲染 HTML
                fname = filename or f"dashboard_{int(time.time())}"
                relative_path = f"dashboards/{fname}.html"
                html_content = _render_html(title, resolved_charts, theme)
                workspace.write_file(relative_path, html_content)

                return _make_result(title, fname, relative_path)

            except Exception as exc:
                return AgentToolResult(
                    content=[ToolResultContent(type="text", text=f"生成看板失败：{exc}")],
                    details={"error": str(exc)},
                    is_error=True,
                )

        # ─── 工具 2: add_chart ───

        async def _add_chart(
            tool_call_id: str,
            arguments: dict[str, Any],
        ) -> AgentToolResult:
            try:
                dashboard_path = arguments.get("dashboard_path", "")
                chart_desc = arguments.get("chart")

                if not dashboard_path:
                    return AgentToolResult(
                        content=[ToolResultContent(type="text", text="必须指定 dashboard_path")],
                        is_error=True,
                    )
                if not chart_desc or not isinstance(chart_desc, dict):
                    return AgentToolResult(
                        content=[ToolResultContent(type="text", text="必须指定 chart（图表配置对象）")],
                        is_error=True,
                    )

                # 读取现有 HTML
                try:
                    html_content = workspace.read_file(dashboard_path)
                except FileNotFoundError:
                    return AgentToolResult(
                        content=[ToolResultContent(type="text", text=f"看板文件不存在: {dashboard_path}")],
                        is_error=True,
                    )

                # 解析新图表
                try:
                    new_chart = _resolve_chart(chart_desc)
                except Exception as e:
                    return AgentToolResult(
                        content=[ToolResultContent(type="text", text=f"图表构建失败: {e}")],
                        is_error=True,
                    )

                # 从 HTML 中提取现有 chartsData
                data_pattern = r'<script\s+id="charts-data"\s+type="application/json">\s*(.*?)\s*</script>'
                match = re.search(data_pattern, html_content, re.DOTALL)
                if not match:
                    return AgentToolResult(
                        content=[ToolResultContent(
                            type="text",
                            text="无法解析现有看板的图表数据，请确认文件格式正确",
                        )],
                        is_error=True,
                    )

                existing_charts = json.loads(match.group(1))
                new_index = len(existing_charts)
                existing_charts.append(new_chart)

                # 更新 JSON 数据块
                new_json = json.dumps(existing_charts, ensure_ascii=False)
                html_content = re.sub(
                    data_pattern,
                    f'<script id="charts-data" type="application/json">\n{new_json}\n</script>',
                    html_content,
                    flags=re.DOTALL,
                )

                # 在 charts-container 末尾插入新的 chart-card DOM 节点
                card_html = _build_chart_card_html(new_chart, new_index)
                insert_marker = "</div>\n\n    <script"
                html_content = html_content.replace(
                    insert_marker,
                    f"{card_html}\n    </div>\n\n    <script",
                    1,
                )

                workspace.write_file(dashboard_path, html_content)

                session_id = getattr(workspace, "_session_id", "default")
                full_relative_path = f"{session_id}/{dashboard_path}"
                download_url = f"/workspace/files/download?path={full_relative_path}"

                return AgentToolResult(
                    content=[ToolResultContent(
                        type="text",
                        text=(
                            f"已向看板追加图表 '{chart_desc.get('title', '')}'，"
                            f"现共 {len(existing_charts)} 个图表。\n"
                            f"下载链接: {download_url}"
                        ),
                    )],
                    details={
                        "status": "success",
                        "dashboard_path": dashboard_path,
                        "chart_count": len(existing_charts),
                        "download_url": download_url,
                    },
                )

            except Exception as exc:
                return AgentToolResult(
                    content=[ToolResultContent(type="text", text=f"追加图表失败：{exc}")],
                    details={"error": str(exc)},
                    is_error=True,
                )

        # ─── 工具 3: remove_chart ───

        async def _remove_chart(
            tool_call_id: str,
            arguments: dict[str, Any],
        ) -> AgentToolResult:
            try:
                dashboard_path = arguments.get("dashboard_path", "")
                chart_index = arguments.get("chart_index")
                chart_title = arguments.get("chart_title", "")

                if not dashboard_path:
                    return AgentToolResult(
                        content=[ToolResultContent(type="text", text="必须指定 dashboard_path")],
                        is_error=True,
                    )
                if chart_index is None and not chart_title:
                    return AgentToolResult(
                        content=[ToolResultContent(
                            type="text",
                            text="必须指定 chart_index（从0开始的序号）或 chart_title（图表标题）",
                        )],
                        is_error=True,
                    )

                # 读取现有 HTML
                try:
                    html_content = workspace.read_file(dashboard_path)
                except FileNotFoundError:
                    return AgentToolResult(
                        content=[ToolResultContent(type="text", text=f"看板文件不存在: {dashboard_path}")],
                        is_error=True,
                    )

                # 提取 chartsData
                data_pattern = r'<script\s+id="charts-data"\s+type="application/json">\s*(.*?)\s*</script>'
                match = re.search(data_pattern, html_content, re.DOTALL)
                if not match:
                    return AgentToolResult(
                        content=[ToolResultContent(type="text", text="无法解析现有看板的图表数据")],
                        is_error=True,
                    )

                existing_charts = json.loads(match.group(1))

                # 确定要删除的索引
                if chart_index is not None:
                    idx = int(chart_index)
                    if idx < 0 or idx >= len(existing_charts):
                        return AgentToolResult(
                            content=[ToolResultContent(
                                type="text",
                                text=f"chart_index={idx} 超出范围，当前共 {len(existing_charts)} 个图表（索引 0-{len(existing_charts)-1}）",
                            )],
                            is_error=True,
                        )
                else:
                    # 按标题查找
                    idx = None
                    for i, c in enumerate(existing_charts):
                        if c.get("title", "") == chart_title:
                            idx = i
                            break
                    if idx is None:
                        titles = [c.get("title", f"#{i}") for i, c in enumerate(existing_charts)]
                        return AgentToolResult(
                            content=[ToolResultContent(
                                type="text",
                                text=f"未找到标题为 '{chart_title}' 的图表。现有图表: {titles}",
                            )],
                            is_error=True,
                        )

                removed_title = existing_charts[idx].get("title", f"#{idx}")
                existing_charts.pop(idx)

                if not existing_charts:
                    return AgentToolResult(
                        content=[ToolResultContent(
                            type="text",
                            text="删除后看板将没有图表，操作已取消。如需删除整个看板请直接删除文件。",
                        )],
                        is_error=True,
                    )

                # 提取标题和主题
                title_match = re.search(r'<title>(.*?)</title>', html_content)
                dashboard_title = title_match.group(1) if title_match else "Dashboard"
                theme_match = re.search(r'data-theme="(\w+)"', html_content)
                theme = theme_match.group(1) if theme_match else "light"

                # 用模板重新渲染（保证索引一致性）
                html_content = _render_html(dashboard_title, existing_charts, theme)
                workspace.write_file(dashboard_path, html_content)

                session_id = getattr(workspace, "_session_id", "default")
                full_relative_path = f"{session_id}/{dashboard_path}"
                download_url = f"/workspace/files/download?path={full_relative_path}"

                return AgentToolResult(
                    content=[ToolResultContent(
                        type="text",
                        text=(
                            f"已从看板删除图表 '{removed_title}'，"
                            f"现剩 {len(existing_charts)} 个图表。\n"
                            f"下载链接: {download_url}"
                        ),
                    )],
                    details={
                        "status": "success",
                        "removed_title": removed_title,
                        "dashboard_path": dashboard_path,
                        "chart_count": len(existing_charts),
                        "download_url": download_url,
                    },
                )

            except Exception as exc:
                return AgentToolResult(
                    content=[ToolResultContent(type="text", text=f"删除图表失败：{exc}")],
                    details={"error": str(exc)},
                    is_error=True,
                )

        # ─── 返回工具列表 ───

        return [
            AgentTool(
                name="build_dashboard",
                label="Build Dashboard",
                description=(
                    "声明式创建交互式 HTML BI 看板。每个图表只需指定 chart_type + data_file + 列名，"
                    "工具自动从 CSV 文件读取数据并构建 ECharts 图表。\n"
                    "支持图表类型: line, bar, pie, scatter, radar, custom。\n"
                    "数据必须先用 write_workspace_file 保存为 CSV 文件。\n"
                    "使用时机：用户要求'生成看板'、'综合分析'、'导出报告'、'多图表对比'时使用。\n"
                    "简单单图表请使用 show_widget(kind='echarts')。"
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "看板标题"},
                        "charts": {
                            "type": "array",
                            "description": "图表配置数组，每个图表用声明式描述",
                            "items": _CHART_DESCRIPTOR_SCHEMA,
                        },
                        "filename": {
                            "type": "string",
                            "description": "文件名（不含 .html），默认自动生成",
                        },
                        "theme": {
                            "type": "string",
                            "enum": ["light", "dark", "blue"],
                            "description": "主题样式，默认 light",
                        },
                    },
                    "required": ["title", "charts"],
                },
                execute_fn=_build_dashboard,
            ),
            AgentTool(
                name="add_chart",
                label="Add Chart to Dashboard",
                description=(
                    "向已有的 HTML 看板增量追加一个图表。\n"
                    "使用时机：用户说'再加一个图表'、分步构建看板、追加下钻图表时使用。\n"
                    "图表配置格式与 build_dashboard 的 charts 元素相同。"
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "dashboard_path": {
                            "type": "string",
                            "description": "已有看板的文件路径（相对于 workspace），如 'dashboards/sales.html'",
                        },
                        "chart": _CHART_DESCRIPTOR_SCHEMA,
                    },
                    "required": ["dashboard_path", "chart"],
                },
                execute_fn=_add_chart,
            ),
            AgentTool(
                name="remove_chart",
                label="Remove Chart from Dashboard",
                description=(
                    "从已有的 HTML 看板中删除一个图表。\n"
                    "可通过 chart_index（从0开始的序号）或 chart_title（图表标题）指定要删除的图表。\n"
                    "使用时机：用户说'删除这个图表'、'去掉xxx图'时使用。"
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "dashboard_path": {
                            "type": "string",
                            "description": "看板文件路径（相对于 workspace），如 'dashboards/sales.html'",
                        },
                        "chart_index": {
                            "type": "integer",
                            "description": "要删除的图表序号（从0开始），与 chart_title 二选一",
                        },
                        "chart_title": {
                            "type": "string",
                            "description": "要删除的图表标题，与 chart_index 二选一",
                        },
                    },
                    "required": ["dashboard_path"],
                },
                execute_fn=_remove_chart,
            ),
        ]


def _build_chart_card_html(chart: dict[str, Any], index: int) -> str:
    """构建单个图表卡片的 HTML 片段，用于 add_chart 时插入。"""
    width = chart.get("width", "50%")
    height = chart.get("height", "360px")
    title = chart.get("title", "")
    subtitle = chart.get("subtitle", "")

    subtitle_html = f'\n                <div class="chart-subtitle">{subtitle}</div>' if subtitle else ""

    return f"""        <div class="chart-card" style="width: calc({width} - 10px);">
            <div class="chart-header">
                <div id="breadcrumb-{index}" class="breadcrumb" style="display: none;"></div>
                <div class="chart-title">{title}</div>{subtitle_html}
            </div>
            <div id="chart-{index}" class="chart-container" style="min-height: {height};"></div>
        </div>"""
