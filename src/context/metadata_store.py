"""
Layer 1：表结构元数据存储 (Metadata Store)

通过 MCP 自动拉取数据库全部表的 DDL 元数据，
缓存后作为上下文注入 LLM，消灭表结构幻觉。
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent
from src.mcp.mcp_client import MCPClient

logger = logging.getLogger("data_agent.context.metadata")


@dataclass
class TableMeta:
    """表元数据"""

    name: str
    comment: str = ""
    row_count: int = 0
    columns: list[dict[str, Any]] = field(default_factory=list)
    key_columns: list[dict[str, str]] = field(default_factory=list)


class MetadataStore:
    """
    表结构元数据存储

    使用流程：
    1. 启动时调用 refresh() 从 MCP 拉取全库元数据
    2. LLM 通过 introspect_database 工具获取全库简报
    3. LLM 通过 get_table_detail 工具获取单表详情

    缓存策略：内存缓存，调 refresh() 可刷新
    """

    def __init__(self, mcp_client: MCPClient):
        self._mcp = mcp_client
        self._tables: dict[str, TableMeta] = {}
        self._initialized = False

    async def refresh(self) -> None:
        """从 MCP Server 拉取全库表元数据"""
        logger.info("[Metadata] 开始拉取数据库元数据...")

        # Step 1: 列出所有表
        tables_raw = await self._mcp.call_tool("list_tables", {})
        try:
            tables_data = json.loads(tables_raw)
        except json.JSONDecodeError:
            logger.error(f"[Metadata] 解析 list_tables 响应失败: {tables_raw[:200]}")
            return

        if tables_data.get("status") != "success":
            logger.error(f"[Metadata] list_tables 返回错误: {tables_data}")
            return

        table_list = tables_data.get("data", [])
        logger.info(f"[Metadata] 发现 {len(table_list)} 张表")

        # Step 2: 逐表拉取详细 schema
        for table_info in table_list:
            table_name = table_info.get("name", "")
            if not table_name:
                continue

            schema_raw = await self._mcp.call_tool(
                "get_table_schema", {"table": table_name}
            )
            try:
                schema_data = json.loads(schema_raw)
            except json.JSONDecodeError:
                logger.warning(f"[Metadata] 解析 {table_name} schema 失败")
                schema_data = {}

            self._tables[table_name] = TableMeta(
                name=table_name,
                comment=table_info.get("comment", schema_data.get("tableComment", "")),
                row_count=table_info.get("rowCount", 0),
                columns=schema_data.get("columns", []),
                key_columns=table_info.get("keyColumns", []),
            )

        self._initialized = True
        logger.info(f"[Metadata] 元数据缓存完成：{len(self._tables)} 张表")

    def get_overview(self) -> str:
        """
        生成全库简报

        格式：表名 | 注释 | 行数 | 核心列
        用于一次性注入 LLM 上下文
        """
        if not self._tables:
            return "⚠️ 元数据未加载。请先调用 introspect_database 工具。"

        lines = ["# 数据库全览\n"]

        for name, meta in sorted(self._tables.items()):
            comment = meta.comment or "无注释"
            row_info = f"~{meta.row_count:,} 行" if meta.row_count else "行数未知"

            # 核心列摘要
            key_cols = []
            for col in meta.columns[:8]:  # 最多展示 8 列
                col_name = col.get("name", "")
                col_type = col.get("type", "")
                col_comment = col.get("comment", "")
                is_pk = col.get("isPrimaryKey", False)

                desc = f"{col_name}({col_type})"
                if is_pk:
                    desc += " PK"
                if col_comment:
                    desc += f" [{col_comment}]"
                key_cols.append(desc)

            cols_str = ", ".join(key_cols)
            if len(meta.columns) > 8:
                cols_str += f" ...及其他{len(meta.columns) - 8}列"

            lines.append(f"## {name}")
            lines.append(f"**说明**: {comment} | {row_info}")
            lines.append(f"**列**: {cols_str}")
            lines.append("")

        return "\n".join(lines)

    def get_table_detail(self, table_name: str) -> str:
        """获取单表详细 schema"""
        meta = self._tables.get(table_name)
        if not meta:
            available = ", ".join(sorted(self._tables.keys()))
            return f"❌ 表 '{table_name}' 不存在。可用表: {available}"

        lines = [f"# 表: {meta.name}"]
        lines.append(f"说明: {meta.comment or '无'}")
        lines.append(f"行数: ~{meta.row_count:,}")
        lines.append("")
        lines.append("## 列详情")
        lines.append("| 列名 | 类型 | 可空 | 键 | 默认值 | 注释 |")
        lines.append("|------|------|------|-----|--------|------|")

        for col in meta.columns:
            name = col.get("name", "")
            ctype = col.get("type", "")
            nullable = "✓" if col.get("isNullable", False) else "✗"
            key = ""
            if col.get("isPrimaryKey"):
                key = "PK"
            elif col.get("isUniqueKey"):
                key = "UNI"
            elif col.get("isForeignKeyIndex"):
                key = "FK"
            default = str(col.get("default", "")) or "-"
            comment = col.get("comment", "") or ""
            lines.append(
                f"| {name} | {ctype} | {nullable} | {key} | {default} | {comment} |"
            )

        return "\n".join(lines)

    def create_tools(self) -> list[AgentTool]:
        """创建元数据相关的 Agent 工具"""

        store = self

        async def introspect_database(
            tool_call_id: str, arguments: dict[str, Any]
        ) -> AgentToolResult:
            """自动拉取并返回全库元数据简报"""
            if not store._initialized:
                await store.refresh()
            overview = store.get_overview()
            return AgentToolResult(content=[ToolResultContent(text=overview)])

        async def get_table_detail_tool(
            tool_call_id: str, arguments: dict[str, Any]
        ) -> AgentToolResult:
            """获取单表详细结构"""
            table = arguments.get("table", "")
            if not store._initialized:
                await store.refresh()
            detail = store.get_table_detail(table)
            return AgentToolResult(content=[ToolResultContent(text=detail)])

        return [
            AgentTool(
                name="introspect_database",
                description=(
                    "获取数据库全部表的元数据概览，包括表名、注释、行数和核心列信息。"
                    "这是了解数据库全貌的最佳起点，会返回比 list_tables 更丰富的上下文信息。"
                    "首次调用时会自动从数据库拉取元数据。"
                ),
                parameters={
                    "type": "object",
                    "properties": {},
                    "required": [],
                },
                execute_fn=introspect_database,
                label="数据库全景透视",
            ),
            AgentTool(
                name="get_table_detail",
                description=(
                    "获取某张表的完整列定义，包括列名、类型、是否可空、键约束、默认值和注释。"
                    "在编写涉及该表的 SQL 之前，建议先调用此工具确认列信息。"
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "table": {
                            "type": "string",
                            "description": "目标表名",
                        },
                    },
                    "required": ["table"],
                },
                execute_fn=get_table_detail_tool,
                label="表结构详情",
            ),
        ]
