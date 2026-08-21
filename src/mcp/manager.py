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
from src.mcp.mcp_client import MCPConnectionError, format_mcp_error
from src.resilience.retry import RetryPolicy, async_retry

logger = logging.getLogger("data_agent.mcp.manager")

READ_ONLY_DATABASE_TOOLS = {
    "execute_sql",
    "get_table_schema",
    "list_tables",
    "get_table_detail",
    "introspect_database",
}

SEMANTIC_AGENT_TOOLS = {"sl_discover", "sl_read_source", "sl_query"}


def _mcp_tool_policy(server_type: str, tool_name: str) -> tuple[bool, str, int]:
    if server_type == "database" and tool_name in READ_ONLY_DATABASE_TOOLS:
        return True, "db", 3
    return False, "mcp", 1

MCP_TOOL_RETRY_POLICY = RetryPolicy(
    max_attempts=3,
    base_delay=0.5,
    multiplier=2.0,
    max_delay=4.0,
    jitter=0.2,
    max_server_delay=10.0,
)


class MCPTransientError(RuntimeError):
    pass


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
                logger.warning("[%s] 连接失败，2s 后重试: %s", self._config.name, format_mcp_error(e))
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
                args=self._config.args,
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

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> str:
        """Call an MCP tool with bounded retries for transient readiness errors."""
        try:
            return await async_retry(
                lambda: self._call_tool_once(name, arguments),
                policy=MCP_TOOL_RETRY_POLICY,
                operation_name=f"mcp.{self._config.name}.{name}",
                logger=logger,
            )
        except MCPTransientError as exc:
            return json.dumps({"error": str(exc)}, ensure_ascii=False)

    async def _call_tool_once(self, name: str, arguments: dict[str, Any]) -> str:
        if not self._ready.is_set():
            try:
                await asyncio.wait_for(self._ready.wait(), timeout=10.0)
            except asyncio.TimeoutError as exc:
                raise MCPTransientError(f"[{self._config.name}] MCP 未就绪") from exc

        async with self._semaphore:
            gen_before = self._generation
            try:
                return await self._client.call_tool(name, arguments)

            except MCPConnectionError as exc:
                logger.warning(
                    "[%s] connection dropped gen=%d, reconnecting: %s",
                    self._config.name, gen_before, type(exc).__name__,
                )
                self._reconnect.set()
                try:
                    await asyncio.wait_for(
                        self._wait_new_gen(gen_before), timeout=8.0
                    )
                except asyncio.TimeoutError as wait_exc:
                    logger.error("[%s] reconnect timed out", self._config.name)
                    raise MCPTransientError("MCP 重连超时，请稍后重试") from wait_exc
                return await self._client.call_tool(name, arguments)

    async def _wait_new_gen(self, old_gen: int) -> None:
        """等待 generation 前进（即 _run 建立了新连接）。"""
        while self._generation == old_gen or not self._ready.is_set():
            await asyncio.sleep(0.1)

    # ── 状态 ─────────────────────────────────────────────────────────────────

    def status(self) -> dict[str, Any]:
        return {
            "name": self._config.name,
            "enabled": self._config.enabled,
            "status": "connected" if self._ready.is_set() else "disconnected",
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

            servers_to_start = self._selected_enabled_servers(settings, enabled_names)
            if not servers_to_start:
                logger.info("[MCPManager] 无 enabled server，跳过启动")
                return

            logger.info("[MCPManager] 启动 %d 个 MCP server...", len(servers_to_start))
            start_time = time.perf_counter()

            managed = await self._start_servers(servers_to_start)
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

    async def reconcile(
        self,
        settings: MCPSettings,
        enabled_names: list[str] | None = None,
    ) -> None:
        """按配置差异增量启停/重启 MCP server。"""
        async with self._lock:
            selected_servers = self._selected_enabled_servers(settings, enabled_names)
            selected_by_name = {server.name: server for server in selected_servers}
            running_names = set(self._servers)

            to_stop_names = sorted(running_names - set(selected_by_name))
            to_restart_configs: list[MCPServerConfig] = []
            to_start_configs: list[MCPServerConfig] = []
            unchanged_names: list[str] = []

            for config in selected_servers:
                managed = self._servers.get(config.name)
                if managed is None:
                    to_start_configs.append(config)
                elif managed.config != config:
                    to_restart_configs.append(config)
                else:
                    unchanged_names.append(config.name)

            if not to_stop_names and not to_restart_configs and not to_start_configs:
                self._settings = settings
                logger.info("[MCPManager] 配置无变化，保持现有连接")
                return

            logger.info(
                "[MCPManager] 增量更新: stop=%s restart=%s start=%s keep=%s",
                to_stop_names or [],
                [config.name for config in to_restart_configs],
                [config.name for config in to_start_configs],
                unchanged_names,
            )

            restart_names = [config.name for config in to_restart_configs]
            if to_stop_names or restart_names:
                await self._stop_servers(to_stop_names + restart_names)
                for name in to_stop_names + restart_names:
                    self._servers.pop(name, None)

            started = await self._start_servers(to_restart_configs + to_start_configs)
            self._servers.update(started)
            self._settings = settings

    async def restart_server(
        self,
        name: str,
        settings: MCPSettings | None = None,
    ) -> _ManagedServer | None:
        """仅重连指定 MCP server。"""
        async with self._lock:
            effective_settings = settings or self._settings or MCPSettings()
            target_config = effective_settings.get_server(name)
            if target_config is None:
                raise KeyError(name)

            self._settings = effective_settings
            await self._stop_servers([name])
            self._servers.pop(name, None)

            if not target_config.enabled:
                logger.info("[MCPManager] %s 已禁用，跳过重连", name)
                return None

            started = await self._start_servers([target_config])
            self._servers.update(started)
            logger.info("[MCPManager] 已重连 MCP server: %s", name)
            return self._servers.get(name)

    async def _stop_all(self) -> None:
        if not self._servers:
            return
        await self._stop_servers(list(self._servers))

    async def _stop_servers(self, names: list[str]) -> None:
        targets = [self._servers[name] for name in names if name in self._servers]
        if not targets:
            return
        await asyncio.gather(*(server.stop() for server in targets), return_exceptions=True)

    async def _start_servers(
        self,
        configs: list[MCPServerConfig],
    ) -> dict[str, _ManagedServer]:
        if not configs:
            return {}
        managed = {config.name: _ManagedServer(config) for config in configs}
        await asyncio.gather(*(server.start() for server in managed.values()), return_exceptions=True)
        return managed

    def _selected_enabled_servers(
        self,
        settings: MCPSettings,
        enabled_names: list[str] | None = None,
    ) -> list[MCPServerConfig]:
        return [
            server for server in settings.servers
            if server.enabled and (enabled_names is None or server.name in enabled_names)
        ]

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
                if (
                    server.config.server_type == "semantic"
                    and tool.get("name") not in SEMANTIC_AGENT_TOOLS
                ):
                    continue
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
        source_parts = [f"MCP server: {server_name}"]
        if server.config.description:
            source_parts.append(f"description: {server.config.description}")
        if server.config.tags:
            source_parts.append(f"tags: {', '.join(server.config.tags)}")
        parameters = tool.get("parameters", {"type": "object", "properties": {}})
        read_only, resource, max_concurrency = _mcp_tool_policy(
            server.config.server_type,
            original_name,
        )

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
            description=f"[{'; '.join(source_parts)}] {description}",
            parameters=parameters,
            execute_fn=_execute,
            read_only=read_only,
            resource=resource,
            max_concurrency=max_concurrency,
        )

    def is_ready(self) -> bool:
        return bool(self._servers) and any(m._ready.is_set() for m in self._servers.values())

    def runtime_fingerprint(self, only_names: list[str] | None = None) -> list[dict[str, Any]]:
        """Return a stable snapshot for cache invalidation."""
        snapshot: list[dict[str, Any]] = []
        selected = set(only_names) if only_names is not None else None
        for name, server in sorted(self._servers.items()):
            if selected is not None and name not in selected:
                continue
            snapshot.append({
                "name": name,
                "server_type": server.config.server_type,
                "connected": server._ready.is_set(),
                "generation": server._generation,
                "tool_count": len(server.tools),
            })
        return snapshot


# 进程级单例
mcp_manager = MCPManager()
