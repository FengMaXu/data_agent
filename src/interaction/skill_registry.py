"""
3.2 工作流与技能集成 (Workflow / Skill Integrator)

提供插件热插拔能力。注册确定性的工作脚本作为"技能"，
LLM 可直接调用来完成结构化任务（如导出 CSV、生成报表等），
弥补生成式 AI 处理确定性任务的短板。
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent

logger = logging.getLogger("data_agent.interaction.skill_registry")

# 技能执行函数类型
SkillExecuteFn = Callable[[dict[str, Any]], Awaitable[str]]


@dataclass
class SkillDefinition:
    """技能定义"""

    name: str
    description: str
    parameters: dict[str, Any]  # JSON Schema
    execute_fn: SkillExecuteFn
    label: str = ""
    category: str = "general"  # general / data / report / notification


class SkillRegistry:
    """
    技能注册中心

    用法：
        registry = SkillRegistry()

        # 注册技能
        registry.register(SkillDefinition(
            name="export_csv",
            description="将查询结果导出为 CSV 文件",
            parameters={...},
            execute_fn=export_csv_handler,
        ))

        # 生成 Agent 工具
        tools = registry.create_tools()
    """

    def __init__(self):
        self._skills: dict[str, SkillDefinition] = {}

    def register(self, skill: SkillDefinition) -> None:
        """注册一个技能"""
        self._skills[skill.name] = skill
        logger.info(f"[Skill] 注册技能: {skill.name} ({skill.category})")

    def unregister(self, name: str) -> bool:
        """注销一个技能"""
        if name in self._skills:
            del self._skills[name]
            logger.info(f"[Skill] 注销技能: {name}")
            return True
        return False

    def list_skills(self) -> list[dict[str, str]]:
        """列出所有已注册技能"""
        return [
            {
                "name": s.name,
                "description": s.description,
                "category": s.category,
                "label": s.label or s.name,
            }
            for s in self._skills.values()
        ]

    def create_tools(self) -> list[AgentTool]:
        """将所有已注册的技能转化为 AgentTool"""
        tools = []

        for skill in self._skills.values():
            # 为每个技能创建闭包
            def make_execute(sk: SkillDefinition):
                async def execute(
                    tool_call_id: str, arguments: dict[str, Any]
                ) -> AgentToolResult:
                    logger.info(f"[Skill] 执行技能: {sk.name}({arguments})")
                    try:
                        result = await sk.execute_fn(arguments)
                        return AgentToolResult(
                            content=[ToolResultContent(text=result)],
                            details={"skill": sk.name, "args": arguments},
                        )
                    except Exception as e:
                        logger.error(f"[Skill] {sk.name} 执行失败: {e}")
                        return AgentToolResult(
                            content=[ToolResultContent(text=f"技能执行失败: {str(e)}")],
                            is_error=True,
                        )

                return execute

            tools.append(
                AgentTool(
                    name=skill.name,
                    description=skill.description,
                    parameters=skill.parameters,
                    execute_fn=make_execute(skill),
                    label=skill.label or skill.name,
                )
            )

        return tools


# ─────────────────────────────────────────────
# 内置技能
# ─────────────────────────────────────────────


def register_builtin_skills(registry: SkillRegistry) -> None:
    """注册内置技能"""

    # 技能 1: 导出 CSV
    async def export_csv(arguments: dict[str, Any]) -> str:
        """将数据导出为 CSV 格式文本"""
        data = arguments.get("data", [])
        filename = arguments.get("filename", "export.csv")

        if not data:
            return "错误：没有数据可导出。请先执行查询获取数据。"

        if isinstance(data, str):
            try:
                data = json.loads(data)
            except json.JSONDecodeError:
                return f"错误：无法解析数据格式。请传入 JSON 数组。"

        if not isinstance(data, list) or not data:
            return "错误：数据必须是非空数组。"

        # 提取表头
        if isinstance(data[0], dict):
            headers = list(data[0].keys())
            rows = [headers]
            for item in data:
                rows.append([str(item.get(h, "")) for h in headers])
        else:
            rows = [[str(cell) for cell in row] for row in data]

        # 生成 CSV
        csv_lines = [",".join(f'"{cell}"' for cell in row) for row in rows]
        csv_content = "\n".join(csv_lines)

        # 写入文件
        try:
            with open(filename, "w", encoding="utf-8-sig") as f:
                f.write(csv_content)
            return f"✅ 已导出 {len(data)} 行数据到 {filename}"
        except Exception as e:
            return f"⚠️ 文件写入失败: {e}\n\nCSV 内容:\n{csv_content[:2000]}"

    registry.register(
        SkillDefinition(
            name="export_csv",
            description=(
                "将查询结果数据导出为 CSV 文件。"
                "传入 data（JSON 数组）和 filename（文件名）。"
                "适用于用户要求'导出'、'下载'、'保存为文件'等场景。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "data": {
                        "type": "array",
                        "description": "要导出的数据，JSON 对象数组格式",
                        "items": {"type": "object"},
                    },
                    "filename": {
                        "type": "string",
                        "description": "输出文件名，默认 export.csv",
                    },
                },
                "required": ["data"],
            },
            execute_fn=export_csv,
            label="导出 CSV",
            category="data",
        )
    )

    # 技能 2: 数据汇总
    async def summarize_data(arguments: dict[str, Any]) -> str:
        """对查询结果进行基础统计汇总"""
        data = arguments.get("data", [])

        if isinstance(data, str):
            try:
                data = json.loads(data)
            except json.JSONDecodeError:
                return "错误：无法解析数据。"

        if not isinstance(data, list) or not data:
            return "错误：无数据可汇总。"

        total_rows = len(data)

        if isinstance(data[0], dict):
            columns = list(data[0].keys())
            summary_lines = [f"**数据汇总** ({total_rows} 行)\n"]

            for col in columns:
                values = [row.get(col) for row in data if row.get(col) is not None]
                # 尝试数值统计
                numeric_values = []
                for v in values:
                    try:
                        numeric_values.append(float(v))
                    except (ValueError, TypeError):
                        pass

                if numeric_values and len(numeric_values) > len(values) * 0.5:
                    avg_val = sum(numeric_values) / len(numeric_values)
                    min_val = min(numeric_values)
                    max_val = max(numeric_values)
                    summary_lines.append(
                        f"- **{col}**: 平均={avg_val:.2f}, 最小={min_val}, 最大={max_val}"
                    )
                else:
                    unique = len(set(str(v) for v in values))
                    summary_lines.append(f"- **{col}**: {unique} 个不同值")

            return "\n".join(summary_lines)
        else:
            return f"共 {total_rows} 行数据"

    registry.register(
        SkillDefinition(
            name="summarize_data",
            description=(
                "对查询结果数据进行基础统计汇总（计数、平均值、最大最小值等）。"
                "适用于用户要求'汇总'、'统计一下'、'概览'等场景。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "data": {
                        "type": "array",
                        "description": "要汇总的数据，JSON 对象数组",
                        "items": {"type": "object"},
                    },
                },
                "required": ["data"],
            },
            execute_fn=summarize_data,
            label="数据汇总",
            category="data",
        )
    )
