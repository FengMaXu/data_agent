"""
MCP 客户端（底层传输层）

职责：建立与 MCP Server 子进程的 stdio 连接，执行单次 RPC 调用。
重连 / 透明恢复由上层 _ManagedServer 负责，本层不做任何重试逻辑。
"""

from __future__ import annotations

import json
import logging
import time
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from src.agent.types import AgentTimingRecorder

logger = logging.getLogger("data_agent.mcp.client")


class MCPConnectionError(Exception):
    """MCP 底层流断开（anyio.EndOfStream / BrokenPipeError 等）。"""


class MCPClient:
    """
    通过 stdio 连接 MCP Server 子进程，执行工具调用。

    用法：
        async with MCPClient.connect(command, script, env) as client:
            result = await client.call_tool("list_tables", {})
    """

    # 连接错误类型（anyio 在模块加载时追加）
    _CONNECTION_ERRORS: tuple[type[BaseException], ...] = (
        EOFError,
        ConnectionError,
        BrokenPipeError,
        OSError,
    )

    def __init__(
        self,
        session: Any,
        timing: AgentTimingRecorder | None = None,
    ) -> None:
        self._session = session
        self._timing = timing

    @classmethod
    @asynccontextmanager
    async def connect(
        cls,
        command: str = "python",
        script: str = "",
        env: dict[str, str] | None = None,
        timing: AgentTimingRecorder | None = None,
    ) -> AsyncIterator["MCPClient"]:
        try:
            from mcp import ClientSession, StdioServerParameters
            from mcp.client.stdio import stdio_client
        except ImportError:
            raise ImportError("请安装 mcp SDK: pip install mcp")

        server_params = StdioServerParameters(
            command=command,
            args=[script] if script else [],
            env=env,
        )
        logger.info("[MCP] 连接到: %s %s", command, script)

        async with stdio_client(server_params) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                t0 = time.perf_counter()
                if timing:
                    timing.record_mcp_stage("initialize_start")
                await session.initialize()
                if timing:
                    timing.record_mcp_stage(
                        "initialize_done",
                        duration_ms=round((time.perf_counter() - t0) * 1000, 3),
                    )
                logger.info("[MCP] 会话已初始化")
                yield cls(session, timing=timing)

    @classmethod
    @asynccontextmanager
    async def connect_sse(
        cls,
        url: str,
        headers: dict[str, str] | None = None,
        timing: AgentTimingRecorder | None = None,
    ) -> AsyncIterator["MCPClient"]:
        try:
            from mcp import ClientSession
            from mcp.client.sse import sse_client
        except ImportError:
            raise ImportError("请安装 mcp SDK: pip install mcp")

        logger.info("[MCP] SSE 连接到: %s", url)

        async with sse_client(url=url, headers=headers) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                t0 = time.perf_counter()
                if timing:
                    timing.record_mcp_stage("initialize_start")
                await session.initialize()
                if timing:
                    timing.record_mcp_stage(
                        "initialize_done",
                        duration_ms=round((time.perf_counter() - t0) * 1000, 3),
                    )
                logger.info("[MCP] SSE 会话已初始化")
                yield cls(session, timing=timing)

    @classmethod
    @asynccontextmanager
    async def connect_streamable_http(
        cls,
        url: str,
        headers: dict[str, str] | None = None,
        timing: AgentTimingRecorder | None = None,
    ) -> AsyncIterator["MCPClient"]:
        try:
            from mcp import ClientSession
            from mcp.client.streamable_http import streamablehttp_client
        except ImportError:
            raise ImportError("请安装 mcp SDK (>=1.12.3支持streamable_http): pip install mcp")

        logger.info("[MCP] Streamable HTTP 连接到: %s", url)

        async with streamablehttp_client(url=url, headers=headers) as (read_stream, write_stream, _):
            async with ClientSession(read_stream, write_stream) as session:
                t0 = time.perf_counter()
                if timing:
                    timing.record_mcp_stage("initialize_start")
                await session.initialize()
                if timing:
                    timing.record_mcp_stage(
                        "initialize_done",
                        duration_ms=round((time.perf_counter() - t0) * 1000, 3),
                    )
                logger.info("[MCP] Streamable HTTP 会话已初始化")
                yield cls(session, timing=timing)

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> str:
        """
        调用 MCP tool，返回文本结果。

        Raises:
            MCPConnectionError: 底层流断开（由上层 _ManagedServer 处理重连）
        """
        logger.info("[MCP] 调用工具: %s", name)
        t0 = time.perf_counter()

        try:
            result = await self._session.call_tool(name, arguments)
            texts = [
                c.text if hasattr(c, "text") else str(c)
                for c in result.content
            ]
            response = "\n".join(texts)
            duration = round((time.perf_counter() - t0) * 1000, 3)
            logger.info("[MCP] %s 返回 %d 字符 (%.1fms)", name, len(response), duration)
            if self._timing:
                self._timing.record_mcp_stage("tool_rpc_done", server=name,
                                               duration_ms=duration)
            return response

        except self._CONNECTION_ERRORS as e:
            duration = round((time.perf_counter() - t0) * 1000, 3)
            logger.warning("[MCP] %s 连接断开: %s (%s)", name, type(e).__name__, e)
            if self._timing:
                self._timing.record_mcp_stage("tool_rpc_done", server=name,
                                               duration_ms=duration, is_error=True)
            raise MCPConnectionError(f"{type(e).__name__}: {e}") from e

        except Exception as e:
            duration = round((time.perf_counter() - t0) * 1000, 3)
            logger.error("[MCP] %s 调用失败: %s (%s)", name, type(e).__name__, e)
            if self._timing:
                self._timing.record_mcp_stage("tool_rpc_done", server=name,
                                               duration_ms=duration, is_error=True)
            return json.dumps({"error": f"MCP 调用失败: {e}"}, ensure_ascii=False)

    async def list_tools(self) -> list[dict[str, Any]]:
        try:
            result = await self._session.list_tools()
            return [
                {
                    "name": t.name,
                    "description": t.description or "",
                    "parameters": t.inputSchema if hasattr(t, "inputSchema") else {},
                }
                for t in result.tools
            ]
        except Exception as e:
            logger.error("[MCP] list_tools 失败: %s", e)
            return []


# 运行时追加 anyio 流异常（anyio 是 mcp SDK 的传递依赖）
try:
    import anyio as _anyio
    MCPClient._CONNECTION_ERRORS = MCPClient._CONNECTION_ERRORS + (
        _anyio.EndOfStream,
        _anyio.ClosedResourceError,
    )
    del _anyio
except (ImportError, AttributeError):
    pass
