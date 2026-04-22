"""
MCP 连接池

设计原则：
  - 每个 DB 配置对应一个 _SlotPool（N 个并发连接）
  - 每个 slot 由独立的 background asyncio.Task 持有，确保 anyio cancel scope
    在同一 task 内进出，避免 "exit cancel scope in different task" 错误
  - 非 DB 服务（知识库等）复用 slot-0 的单连接（无状态，不需并行）
  - RegistryPool 是进程级单例，按配置签名 (sig) 索引

并发模型：
  - DB 调用通过 asyncio.Queue 排队，池满时 await 等待空闲槽
  - 非 DB 调用走 ref registry（slot-0），适合低频的元数据查询
  - 每个 slot 是独立子进程 + 独立 MySQL 连接，互不阻塞

多数据库扩展：
  - 不同 DB 配置 → 不同 sig → 各自独立的 _SlotPool
  - 调用方无需任何修改，透明支持
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from src.mcp.config_models import MCPSettings
from src.mcp.mcp_client import MCPConnectionError
from src.mcp.registry import ConnectedMCPServer, MCPRegistry

logger = logging.getLogger("data_agent.mcp.registry_pool")

DEFAULT_POOL_SIZE = 2  # 每个 DB 配置默认保持 2 个并发连接


# ─── 配置签名 ──────────────────────────────────────────────────────────────────

def _settings_signature(settings: MCPSettings, enabled_names: list[str] | None = None) -> str:
    """生成配置的稳定签名（作为池的 key）。"""
    import json as _json
    payload = {
        "servers": sorted(
            [
                {
                    "name": s.name,
                    "command": s.command,
                    "script": s.script,
                    "url": s.url,
                    "env": sorted((s.env or {}).items()),
                    "enabled": s.enabled,
                    "server_type": s.server_type,
                }
                for s in settings.servers
                if s.enabled
            ],
            key=lambda x: x["name"],
        ),
        "enabled_filter": sorted(enabled_names or []),
    }
    return _json.dumps(payload, sort_keys=True, ensure_ascii=False)


# ─── _Slot：background task 持有一个 MCPRegistry ──────────────────────────────

class _Slot:
    """
    每个 slot 用独立的 asyncio.Task 持有 MCPRegistry。

    anyio 的 cancel scope（来自 stdio_client / ClientSession）在哪个 task
    里进入，就必须在同一个 task 里退出。把 Registry 生命周期锁定在一个
    专属 background task 里，彻底避免跨 task 退出 cancel scope 的错误。

    lifecycle::

        await slot.start(settings, names)   # 启动 background task，等待就绪
        slot.registry                        # 获取 MCPRegistry（可能 None）
        await slot.stop()                    # 信号 task 退出，等待 shutdown 完成
        await slot.restart(settings, names)  # stop + start
    """

    def __init__(self) -> None:
        self._registry: MCPRegistry | None = None
        self._ready: asyncio.Event = asyncio.Event()
        self._stop: asyncio.Event = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._init_error: Exception | None = None

    @property
    def registry(self) -> MCPRegistry | None:
        return self._registry

    async def start(self, settings: MCPSettings, enabled_names: list[str] | None) -> None:
        """启动 background task 并等待 registry 就绪。"""
        self._ready = asyncio.Event()
        self._stop = asyncio.Event()
        self._init_error = None
        self._registry = None
        self._task = asyncio.create_task(self._run(settings, enabled_names))
        await self._ready.wait()
        if self._init_error:
            raise self._init_error

    async def _run(self, settings: MCPSettings, enabled_names: list[str] | None) -> None:
        """
        Background task 主循环：
        1. 建立 MCPRegistry（进入 anyio cancel scope）
        2. 通知 start() 就绪
        3. 等待 stop 信号
        4. shutdown MCPRegistry（退出 anyio cancel scope，在同一 task ✓）
        """
        r = MCPRegistry()
        r.configure(settings)
        try:
            if enabled_names:
                await r.connect_selected(enabled_names)
            else:
                await r.connect_all_enabled()
        except Exception as e:
            self._init_error = e
            self._ready.set()
            return

        self._registry = r
        self._ready.set()

        # 在此 task 中等待 stop 信号，保持 anyio cancel scope 活跃
        await self._stop.wait()

        self._registry = None
        try:
            await r.shutdown()
        except Exception as exc:
            logger.warning("[Slot] 关闭时出错: %s", exc)

    async def stop(self) -> None:
        """通知 background task 退出并等待其完成。"""
        if self._task is None or self._task.done():
            return
        self._stop.set()
        try:
            # shield 防止当前 task 被取消时连带取消 background task
            await asyncio.wait_for(asyncio.shield(self._task), timeout=8.0)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            logger.warning("[Slot] 停止超时，强制取消 background task")
            self._task.cancel()

    async def restart(self, settings: MCPSettings, enabled_names: list[str] | None) -> None:
        """重建连接：stop → start。"""
        await self.stop()
        await self.start(settings, enabled_names)


# ─── PooledClient：每次 call_tool 从池中取槽 ──────────────────────────────────

class PooledClient:
    """
    StdioMCPClient 的池化替代品。

    每次 call_tool() 从 _SlotPool 中 checkout 一个 _Slot，
    用完后自动 checkin，天然支持并发。

    连接断开时触发 rebuild_slot（异步，不阻塞当前请求）。
    对 SQLEvaluator / MetadataStore 等消费方完全透明。
    """

    def __init__(self, slot_pool: "_SlotPool", server_name: str) -> None:
        self._pool = slot_pool
        self._server_name = server_name

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> str:
        slot = await self._pool.checkout()
        try:
            registry = slot.registry
            if registry is None:
                self._pool.checkin(slot)
                return json.dumps({"error": "Slot 未就绪，请稍后重试"}, ensure_ascii=False)
            server = registry.get_connected_server(self._server_name)
            if server is None:
                self._pool.checkin(slot)
                return json.dumps(
                    {"error": f"DB server '{self._server_name}' not found in slot"},
                    ensure_ascii=False,
                )
            result = await server.client.call_tool(name, arguments)
            self._pool.checkin(slot)
            return result
        except MCPConnectionError as e:
            # 不归还坏槽，异步重建后放回队列
            logger.warning("[PooledClient] 检测到断开连接，调度重建: %s", e)
            asyncio.create_task(self._pool.rebuild_slot(slot))
            return json.dumps(
                {"error": f"MCP 连接断开，正在重建，请稍后重试: {e}"},
                ensure_ascii=False,
            )
        except Exception:
            self._pool.checkin(slot)
            raise

    async def list_tools(self) -> list[dict[str, Any]]:
        slot = await self._pool.checkout()
        try:
            registry = slot.registry
            if registry is None:
                self._pool.checkin(slot)
                return []
            server = registry.get_connected_server(self._server_name)
            if server is None:
                self._pool.checkin(slot)
                return []
            result = await server.client.list_tools()
            self._pool.checkin(slot)
            return result
        except MCPConnectionError as e:
            logger.warning("[PooledClient] list_tools 连接断开，调度重建: %s", e)
            asyncio.create_task(self._pool.rebuild_slot(slot))
            return []
        except Exception:
            self._pool.checkin(slot)
            raise


# ─── _SlotPool：管理 N 个 _Slot ───────────────────────────────────────────────

class _SlotPool:
    """
    固定大小的连接池。

    每个 slot 是独立的 _Slot（background task + MCPRegistry + 子进程 + MySQL 连接）。
    通过 asyncio.Queue 实现非阻塞 checkout / checkin。
    """

    def __init__(
        self,
        settings: MCPSettings,
        enabled_names: list[str] | None,
        size: int,
    ) -> None:
        self._settings = settings
        self._enabled_names = enabled_names
        self._size = size
        self._slots: list[_Slot] = []
        self._available: asyncio.Queue[_Slot] = asyncio.Queue()

    async def initialize(self) -> None:
        for i in range(self._size):
            slot = _Slot()
            await slot.start(self._settings, self._enabled_names)
            self._slots.append(slot)
            self._available.put_nowait(slot)
            logger.debug("[SlotPool] slot-%d 就绪", i)

    @property
    def ref_registry(self) -> MCPRegistry | None:
        """返回 slot-0 的 registry，用于非 DB 服务（知识库等）。"""
        if not self._slots:
            return None
        return self._slots[0].registry

    async def checkout(self) -> _Slot:
        """获取一个空闲 slot（无空闲时等待）。"""
        return await self._available.get()

    def checkin(self, slot: _Slot) -> None:
        """归还 slot 到池中。"""
        self._available.put_nowait(slot)

    async def rebuild_slot(self, bad_slot: _Slot) -> None:
        """
        重建损坏的 slot：restart（stop + start）后放回队列。
        由 PooledClient 在 MCPConnectionError 后异步触发。
        """
        logger.info("[SlotPool] 开始重建损坏的连接槽...")
        try:
            await bad_slot.restart(self._settings, self._enabled_names)
            self._available.put_nowait(bad_slot)
            logger.info("[SlotPool] 连接槽重建完成，当前可用: %d", self._available.qsize())
        except Exception as exc:
            logger.error("[SlotPool] 重建连接槽失败: %s", exc)

    async def shutdown(self) -> None:
        for slot in self._slots:
            try:
                await slot.stop()
            except Exception as exc:
                logger.warning("[SlotPool] 关闭 slot 时出错: %s", exc)
        self._slots.clear()

    def stats(self) -> dict[str, Any]:
        ref = self.ref_registry
        return {
            "size": self._size,
            "available": self._available.qsize(),
            "servers": ref.list_servers() if ref is not None else [],
        }


# ─── _RegistryFacade：接口兼容层 ──────────────────────────────────────────────

class _RegistryFacade:
    """
    对 mcp_provider.py 等调用方暴露的接口层，行为等同于 MCPRegistry。

    - 非 DB 操作（bridge_all_tools, list_tools, list_servers）
      → 委托给 ref_registry（slot-0，单连接）
    - DB 操作（find_server_by_type("database")）
      → 返回带 PooledClient 的合成 ConnectedMCPServer
    """

    def __init__(self, slot_pool: _SlotPool) -> None:
        self._slot_pool = slot_pool
        self._ref = slot_pool.ref_registry  # 构造时快照 slot-0 registry

    def bridge_all_tools(self, *, exclude_server_types: set[str] | None = None):
        if self._ref is None:
            return []
        return self._ref.bridge_all_tools(exclude_server_types=exclude_server_types)

    def find_server_by_type(self, server_type: str) -> ConnectedMCPServer | None:
        if self._ref is None:
            return None
        server = self._ref.find_server_by_type(server_type)
        if server is None:
            return None
        if server_type == "database":
            # 替换 client 为池化版本，DB 查询走连接池
            return ConnectedMCPServer(
                config=server.config,
                client=PooledClient(self._slot_pool, server.config.name),
                tools=server.tools,
            )
        return server

    def list_tools(self) -> list[dict[str, Any]]:
        if self._ref is None:
            return []
        return self._ref.list_tools()

    def list_servers(self) -> list[dict[str, Any]]:
        if self._ref is None:
            return []
        return self._ref.list_servers()

    async def shutdown(self) -> None:
        # 生命周期由 RegistryPool 统一管理，这里是 no-op
        pass


# ─── RegistryPool：进程级单例 ──────────────────────────────────────────────────

class RegistryPool:
    """
    全局 MCP 连接池管理器（进程级单例）。

    - 按 settings 签名索引，不同 DB 配置互相独立
    - 同一配置的所有 session 共享同一个连接池
    - 线程安全（asyncio.Lock 双检锁）

    用法::

        # 获取（或创建）连接池 facade
        registry = await registry_pool.acquire(settings, enabled_names)

        # 服务退出时
        await registry_pool.shutdown_all()
    """

    def __init__(self, pool_size: int = DEFAULT_POOL_SIZE) -> None:
        self._pool_size = pool_size
        self._slots: dict[str, _SlotPool] = {}
        self._lock = asyncio.Lock()

    async def acquire(
        self,
        settings: MCPSettings,
        enabled_names: list[str] | None = None,
    ) -> _RegistryFacade:
        """
        获取与 settings 对应的连接池 facade。
        同一配置首次调用时初始化连接池，后续直接复用。
        """
        sig = _settings_signature(settings, enabled_names)

        # fast path
        slot = self._slots.get(sig)
        if slot is not None:
            return _RegistryFacade(slot)

        # double-checked locking
        async with self._lock:
            slot = self._slots.get(sig)
            if slot is not None:
                return _RegistryFacade(slot)

            logger.info(
                "[RegistryPool] 初始化连接池 size=%d sig=%.60s...",
                self._pool_size,
                sig,
            )
            slot = _SlotPool(settings, enabled_names, self._pool_size)
            await slot.initialize()
            self._slots[sig] = slot
            logger.info(
                "[RegistryPool] 连接池就绪，当前池数量: %d",
                len(self._slots),
            )

        return _RegistryFacade(slot)

    async def invalidate(
        self,
        settings: MCPSettings,
        enabled_names: list[str] | None = None,
    ) -> None:
        """作废并关闭某个配置的连接池（配置变更时调用）。"""
        sig = _settings_signature(settings, enabled_names)
        async with self._lock:
            slot = self._slots.pop(sig, None)
        if slot is not None:
            logger.info("[RegistryPool] 作废连接池 sig=%.60s...", sig)
            await slot.shutdown()

    async def reconnect(
        self,
        settings: MCPSettings,
        enabled_names: list[str] | None = None,
    ) -> _RegistryFacade:
        """强制重建连接池（检测到全池故障时调用）。"""
        await self.invalidate(settings, enabled_names)
        return await self.acquire(settings, enabled_names)

    async def shutdown_all(self) -> None:
        """关闭所有连接池（服务退出时调用）。"""
        async with self._lock:
            entries = list(self._slots.items())
            self._slots.clear()

        for sig, slot in entries:
            logger.info("[RegistryPool] 关闭连接池 sig=%.60s...", sig)
            await slot.shutdown()

    def stats(self) -> dict[str, Any]:
        return {
            "pool_count": len(self._slots),
            "pool_size_per_config": self._pool_size,
            "pools": {
                sig[:60]: slot.stats()
                for sig, slot in self._slots.items()
            },
        }


# 进程级单例
registry_pool = RegistryPool(pool_size=DEFAULT_POOL_SIZE)
