"""
MCP 客户端
通过 stdio 连接 MySQL MCP Server，发送 JSON-RPC 工具调用

MCP Server 提供三个工具：
- execute_sql: 执行 SQL 查询
- get_table_schema: 获取表结构
- list_tables: 列出所有表
"""

from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

logger = logging.getLogger("data_agent.mcp.client")


class MCPClient:
    """
    MCP (Model Context Protocol) 客户端

    通过 stdio 方式连接到独立运行的 MCP Server 子进程，
    使用 mcp Python SDK 进行通信。

    用法：
        async with MCPClient.connect(command, script, env) as client:
            result = await client.call_tool("list_tables", {})
    """

    def __init__(self, session, _cleanup=None):
        self._session = session
        self._cleanup = _cleanup

    @classmethod
    @asynccontextmanager
    async def connect(
        cls,
        command: str = "python",
        script: str = "",
        env: dict[str, str] | None = None,
    ) -> AsyncIterator["MCPClient"]:
        """
        连接到 MCP Server

        Args:
            command: 运行命令（如 "python"、"uv" 等）
            script: MCP Server 脚本路径
            env: 传递给子进程的环境变量
        """
        try:
            from mcp import ClientSession, StdioServerParameters
            from mcp.client.stdio import stdio_client
        except ImportError:
            raise ImportError(
                "请安装 mcp SDK: pip install mcp\n"
                "参考: https://github.com/modelcontextprotocol/python-sdk"
            )

        server_params = StdioServerParameters(
            command=command,
            args=[script] if script else [],
            env=env,
        )

        logger.info(f"[MCP] 连接到: {command} {script}")

        async with stdio_client(server_params) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                # 初始化 MCP 会话
                await session.initialize()
                logger.info("[MCP] 会话已初始化")

                client = cls(session)
                yield client

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> str:
        """
        调用 MCP Server 上的工具

        Args:
            name: 工具名 (execute_sql / get_table_schema / list_tables)
            arguments: 工具参数

        Returns:
            工具返回的文本内容
        """
        logger.info(f"[MCP] 调用工具: {name}({arguments})")

        try:
            result = await self._session.call_tool(name, arguments)

            # 提取文本内容
            texts = []
            for content_item in result.content:
                if hasattr(content_item, "text"):
                    texts.append(content_item.text)
                else:
                    texts.append(str(content_item))

            response_text = "\n".join(texts)
            logger.info(f"[MCP] {name} 返回 {len(response_text)} 字符")
            return response_text

        except Exception as e:
            logger.error(f"[MCP] 调用 {name} 失败: {e}")
            error_result = {"error": f"MCP 调用失败: {str(e)}"}
            return json.dumps(error_result, ensure_ascii=False)

    async def list_tools(self) -> list[dict[str, Any]]:
        """列出 MCP Server 提供的所有工具"""
        try:
            result = await self._session.list_tools()
            return [
                {
                    "name": tool.name,
                    "description": tool.description or "",
                    "parameters": (
                        tool.inputSchema if hasattr(tool, "inputSchema") else {}
                    ),
                }
                for tool in result.tools
            ]
        except Exception as e:
            logger.error(f"[MCP] 列出工具失败: {e}")
            return []
