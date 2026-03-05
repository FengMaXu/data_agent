"""
数据库工具集
将 MCP Server 的三个工具包装为 AgentTool，供 Agent Loop 调用

工具链路：
  LLM → agent_loop → db_tools → sql_guard → mcp_client → MCP Server → MySQL
"""

from __future__ import annotations

import logging
from typing import Any

from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent

from .mcp_client import MCPClient
from .sql_guard import SQLGuard

logger = logging.getLogger("data_agent.mcp.db_tools")


def create_db_tools(
    mcp_client: MCPClient, sql_guard: SQLGuard | None = None
) -> list[AgentTool]:
    """
    创建三个数据库 AgentTool 实例

    Args:
        mcp_client: 已连接的 MCP 客户端实例
        sql_guard: SQL 安全拦截器（默认创建严格模式实例）
    """
    guard = sql_guard or SQLGuard(strict=True)

    # ── 工具 1: execute_sql ──
    async def execute_sql(
        tool_call_id: str, arguments: dict[str, Any]
    ) -> AgentToolResult:
        query = arguments.get("query", "")

        # 安全检查
        check = guard.check(query)
        if not check.allowed:
            return AgentToolResult(
                content=[ToolResultContent(text=check.reason)],
                details={"blocked": True, "query": query},
                is_error=True,
            )

        # 通过安全检查，发送到 MCP Server
        result = await mcp_client.call_tool("execute_sql", {"query": query})
        return AgentToolResult(
            content=[ToolResultContent(text=result)],
            details={"query": query},
        )

    # ── 工具 2: get_table_schema ──
    async def get_table_schema(
        tool_call_id: str, arguments: dict[str, Any]
    ) -> AgentToolResult:
        table = arguments.get("table", "")
        if not table:
            return AgentToolResult(
                content=[ToolResultContent(text="错误：必须提供表名。")],
                is_error=True,
            )

        result = await mcp_client.call_tool("get_table_schema", {"table": table})
        return AgentToolResult(
            content=[ToolResultContent(text=result)],
            details={"table": table},
        )

    # ── 工具 3: list_tables ──
    async def list_tables(
        tool_call_id: str, arguments: dict[str, Any]
    ) -> AgentToolResult:
        result = await mcp_client.call_tool("list_tables", {})
        return AgentToolResult(
            content=[ToolResultContent(text=result)],
        )

    return [
        AgentTool(
            name="execute_sql",
            description=(
                "执行一条只读 SQL 查询语句（仅限 SELECT/SHOW/DESCRIBE/EXPLAIN）。"
                "以 JSON 格式返回查询结果。"
                "注意：出于安全考虑，不允许执行任何修改数据的操作（INSERT/UPDATE/DELETE/DROP 等）。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "要执行的 SQL 查询语句",
                    },
                },
                "required": ["query"],
            },
            execute_fn=execute_sql,
            label="执行 SQL 查询",
        ),
        AgentTool(
            name="get_table_schema",
            description=(
                "获取指定数据库表的完整结构信息，包括列名、数据类型、键、默认值和注释。"
                "在编写 SQL 查询前，应先使用此工具了解表结构。"
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
            execute_fn=get_table_schema,
            label="获取表结构",
        ),
        AgentTool(
            name="list_tables",
            description=(
                "列出数据库中所有表的名称、注释信息和行数。"
                "这是了解数据库全貌的第一步，应该在分析前调用。"
            ),
            parameters={
                "type": "object",
                "properties": {},
                "required": [],
            },
            execute_fn=list_tables,
            label="列出所有表",
        ),
    ]
