"""
MCP 连接管理器

设计原则：
  - 每个 MCP server 对应一个 _ManagedServer
  - _ManagedServer 用独立的 background asyncio.Task 持有连接
    （anyio cancel scope 始终在同一 task 内进出）
  - 连接断开时透明重连，不把错误暴露给 agent
  - MCPManager 是进程级单例，在 server lifespan 里 start / stop
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent
from src.mcp.config_models import MCPServerConfig, MCPSettings
from src.mcp.mcp_client import MCPConnectionError

logger = logging.getLogger("data_agent.mcp.manager")


# ─── _ManagedServer ───────────────────────────────────────────────────────────

class _ManagedServer:
    """
    单个 MCP server 的托管连接。

    - background task 持有 anyio cancel scope（连接建立 / 断开全在同一 task）
    - call_tool 可从任意 task 并发调用，semaphore 控制最大并发数
    - 连接断开时：触发 _run 重连，call_tool 等待新连接后自动重试一次
    """

    def __init__(self, config: MCPServerConfig, max_concurrent: int = 3) -> None:
        self._config = config
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._client: Any | None = None          # MCPClient 实例
        self._tools: list[dict[str, Any]] = []   # connect 时缓存
        self._generation: int = 0                # 每次成功建连 +1
        self._ready = asyncio.Event()            # 仅由 _run 设置/清除
        self._stop = asyncio.Event()
        self._reconnect = asyncio.Event()
        self._task: asyncio.Task | None = None

    # ── 属性 ──────────────────────────────────────────────────────────────────

    @property
    def config(self) -> MCPServerConfig:
        return self._config

    @property
    def tools(self) -> list[dict[str, Any]]:
        return self._tools

    # ── 生命周期 ──────────────────────────────────────────────────────────────

    async def start(self) -> None:
        """启动 background task，等待连接就绪（最多 30s）。"""
        self._task = asyncio.create_task(self._run(), name=f"mcp-{self._config.name}")
        try:
            await asyncio.wait_for(self._ready.wait(), timeout=30.0)
        except asyncio.TimeoutError:
            logger.warning("[%s] 启动超时，将在后台继续重试", self._config.name)

    async def stop(self) -> None:
        """通知 background task 退出，等待其完成 cleanup。"""
        self._stop.set()
        self._reconnect.set()  # 解除 _run 里的 asyncio.wait 等待
        if self._task and not self._task.done():
            try:
                await asyncio.wait_for(self._task, timeout=8.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()

    # ── background task ───────────────────────────────────────────────────────

    async def _run(self) -> None:
        """
        连接主循环。anyio cancel scope 在此 task 内进出，与请求 task 无关。
        连接建立 → 等待 stop/reconnect 信号 → 退出 context（同 task ✓） → 循环。
        """
        while not self._stop.is_set():
            self._reconnect.clear()
            try:
                async with self._create_client_context() as client:
                    # 连接成功：缓存 tools，标记就绪
                    try:
                        self._tools = await client.list_tools()
                    except Exception as e:
                        logger.warning("[%s] list_tools 失败: %s", self._config.name, e)

                    self._client = client
                    self._generation += 1
                    self._ready.set()
                    logger.info(
                        "[%s] 就绪 gen=%d，%d 个工具",
                        self._config.name, self._generation, len(self._tools),
                    )

                    # 等待 stop 或 reconnect 信号
                    stop_t = asyncio.create_task(self._stop.wait())
                    recon_t = asyncio.create_task(self._reconnect.wait())
                    done, pending = await asyncio.wait(
                        {stop_t, recon_t}, return_when=asyncio.FIRST_COMPLETED
                    )
                    for t in pending:
                        t.cancel()
                        try:
                            await t
                        except asyncio.CancelledError:
                            pass

                    # 退出 context（anyio cancel scope 在此 task 内退出 ✓）
                    self._ready.clear()
                    self._client = None

                    if self._stop.is_set():
                        return
                    logger.info("[%s] 重建连接中...", self._config.name)

            except asyncio.CancelledError:
                return
            except Exception as e:
                if self._stop.is_set():
                    return
                logger.warning("[%s] 连接失败，2s 后重试: %s", self._config.name, e)
                self._ready.clear()
                self._client = None
                await asyncio.sleep(2)

    def _create_client_context(self):
        """根据 transport 类型返回对应的 async context manager。"""
        from src.mcp.config_models import MCPTransportType
        from src.mcp.client.stdio_client import StdioMCPClient

        transport = self._config.transport

        if transport == MCPTransportType.STDIO:
            return StdioMCPClient.connect(
                command=self._config.command,
                script=self._config.script,
                env=self._config.env or None,
            )
        elif transport == MCPTransportType.SSE:
            from src.mcp.client.sse_client import SSEMCPClient
            return SSEMCPClient.connect(
                url=self._config.url,
                headers=self._config.headers or None,
            )
        elif transport == MCPTransportType.STREAMABLE_HTTP:
            from src.mcp.client.streamable_http_client import StreamableHTTPMCPClient
            return StreamableHTTPMCPClient.connect(
                url=self._config.url,
                headers=self._config.headers or None,
            )
        else:
            raise ValueError(f"Unsupported MCP transport: {transport}")

    # ── 工具调用 ─────────────────────────────────────────────────────────────

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> str:
        """
        调用 MCP tool。

        - 等待连接就绪
        - 连接断开时自动触发重连并重试一次，对上层透明
        """
        if not self._ready.is_set():
            try:
                await asyncio.wait_for(self._ready.wait(), timeout=30.0)
            except asyncio.TimeoutError:
                return json.dumps({"error": f"[{self._config.name}] MCP 未就绪"}, ensure_ascii=False)

        async with self._semaphore:
            gen_before = self._generation
            try:
                return await self._client.call_tool(name, arguments)

            except MCPConnectionError as e:
                logger.warning(
                    "[%s] 连接断开 gen=%d，触发重连: %s",
                    self._config.name, gen_before, type(e).__name__,
                )
                self._reconnect.set()
                # 等待 _run 建立新连接（generation 递增）
                try:
                    await asyncio.wait_for(
                        self._wait_new_gen(gen_before), timeout=20.0
                    )
                except asyncio.TimeoutError:
                    logger.error("[%s] 重连超时", self._config.name)
                    return json.dumps({"error": "MCP 重连超时，请稍后重试"}, ensure_ascii=False)
                # 重试一次
                return await self._client.call_tool(name, arguments)

    async def _wait_new_gen(self, old_gen: int) -> None:
        """等待 generation 前进（即 _run 建立了新连接）。"""
        while self._generation == old_gen or not self._ready.is_set():
            await asyncio.sleep(0.1)

    # ── 状态 ─────────────────────────────────────────────────────────────────

    def status(self) -> dict[str, Any]:
        return {
            "name": self._config.name,
            "server_type": self._config.server_type,
            "transport": self._config.transport.value,
            "connected": self._ready.is_set(),
            "generation": self._generation,
            "tool_count": len(self._tools),
            "description": self._config.description,
            "tool_prefix": self._config.resolved_tool_prefix(),
            "tags": list(self._config.tags),
        }


# ─── MCPManager ───────────────────────────────────────────────────────────────

class MCPManager:
    """
    进程级 MCP 连接管理器单例。

    - start(settings) 在 server lifespan 里调用，启动所有 enabled server
    - stop()          在 server lifespan 结束时调用
    - restart()       配置热更新时调用（stop + start）

    对外接口：
        manager.find_server_by_type("database") → _ManagedServer | None
        manager.bridge_tools(exclude_server_types={"database"}) → list[AgentTool]
        manager.list_servers() → list[dict]
    """

    def __init__(self) -> None:
        self._servers: dict[str, _ManagedServer] = {}
        self._settings: MCPSettings | None = None
        self._lock = asyncio.Lock()

    # ── 生命周期 ──────────────────────────────────────────────────────────────

    async def start(
        self,
        settings: MCPSettings,
        enabled_names: list[str] | None = None,
    ) -> None:
        """启动所有 enabled MCP server（在 lifespan 或 reload 时调用）。"""
        async with self._lock:
            await self._stop_all()
            self._settings = settings
            self._servers = {}

            servers_to_start = [
                s for s in settings.servers
                if s.enabled and (enabled_names is None or s.name in enabled_names)
            ]
            if not servers_to_start:
                logger.info("[MCPManager] 无 enabled server，跳过启动")
                return

            logger.info("[MCPManager] 启动 %d 个 MCP server...", len(servers_to_start))
            start_time = time.perf_counter()

            # 并发启动所有 server
            managed = {s.name: _ManagedServer(s) for s in servers_to_start}
            await asyncio.gather(
                *(m.start() for m in managed.values()),
                return_exceptions=True,
            )
            self._servers = managed
            elapsed = round((time.perf_counter() - start_time) * 1000)
            logger.info(
                "[MCPManager] 启动完成 %d/%d 就绪，耗时 %dms",
                sum(1 for m in managed.values() if m._ready.is_set()),
                len(managed),
                elapsed,
            )

    async def stop(self) -> None:
        """停止所有 MCP server。"""
        async with self._lock:
            await self._stop_all()
            self._servers = {}

    async def restart(
        self,
        settings: MCPSettings,
        enabled_names: list[str] | None = None,
    ) -> None:
        """配置热更新：stop all → start with new settings。"""
        logger.info("[MCPManager] 重启所有连接（配置热更新）...")
        await self.start(settings, enabled_names)

    async def _stop_all(self) -> None:
        if not self._servers:
            return
        await asyncio.gather(
            *(m.stop() for m in self._servers.values()),
            return_exceptions=True,
        )

    # ── 查询接口 ──────────────────────────────────────────────────────────────

    def get_server(self, name: str) -> _ManagedServer | None:
        return self._servers.get(name)

    def find_server_by_type(self, server_type: str) -> _ManagedServer | None:
        for m in self._servers.values():
            if m.config.server_type == server_type:
                return m
        return None

    def list_servers(self) -> list[dict[str, Any]]:
        return [m.status() for m in self._servers.values()]

    def list_tools(self) -> list[dict[str, Any]]:
        result = []
        for m in self._servers.values():
            prefix = m.config.resolved_tool_prefix()
            for tool in m.tools:
                result.append({
                    "server": m.config.name,
                    "server_type": m.config.server_type,
                    "name": f"{prefix}{tool['name']}",
                    "remote_name": tool["name"],
                    "description": tool.get("description", ""),
                    "parameters": tool.get("parameters", {}),
                })
        return result

    # ── 工具桥接 ──────────────────────────────────────────────────────────────

    def bridge_tools(
        self,
        *,
        exclude_server_types: set[str] | None = None,
        only_names: list[str] | None = None,
    ) -> list[AgentTool]:
        """
        将 MCP server 的工具转换为 AgentTool 列表。

        Args:
            exclude_server_types: 排除指定 server_type（如 {"database"}）
            only_names: 仅包含指定 server 名称
        """
        exclude = exclude_server_types or set()
        tools: list[AgentTool] = []

        for name, server in self._servers.items():
            if server.config.server_type in exclude:
                continue
            if only_names is not None and name not in only_names:
                continue
            prefix = server.config.resolved_tool_prefix()
            for tool in server.tools:
                tools.append(self._make_agent_tool(server, prefix, tool))

        return tools

    def _make_agent_tool(
        self,
        server: _ManagedServer,
        prefix: str,
        tool: dict[str, Any],
    ) -> AgentTool:
        original_name = tool["name"]
        prefixed_name = f"{prefix}{original_name}"
        server_name = server.config.name
        description = tool.get("description", "")
        parameters = tool.get("parameters", {"type": "object", "properties": {}})

        async def _execute(
            tool_call_id: str, arguments: dict[str, Any]
        ) -> AgentToolResult:
            try:
                result = await server.call_tool(original_name, arguments)
                return AgentToolResult(
                    content=[ToolResultContent(type="text", text=result)]
                )
            except Exception as e:
                return AgentToolResult(
                    content=[ToolResultContent(
                        type="text",
                        text=f"[{server_name}] {original_name} 失败: {e}",
                    )],
                    is_error=True,
                )

        return AgentTool(
            name=prefixed_name,
            label=f"[{server_name}] {original_name}",
            description=f"[来源: {server_name}] {description}",
            parameters=parameters,
            execute_fn=_execute,
        )

    def is_ready(self) -> bool:
        return bool(self._servers) and any(m._ready.is_set() for m in self._servers.values())


# 进程级单例
mcp_manager = MCPManager()
