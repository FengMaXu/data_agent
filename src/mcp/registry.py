from __future__ import annotations

import logging
import time
from contextlib import AsyncExitStack
from dataclasses import dataclass
from typing import Any

from src.agent.types import AgentTimingRecorder, AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent
from src.mcp.client.stdio_client import StdioMCPClient
from src.mcp.client.sse_client import SSEMCPClient
from src.mcp.client.streamable_http_client import StreamableHTTPMCPClient
from src.mcp.config_models import MCPServerConfig, MCPSettings, MCPTransportType
from src.mcp.mcp_client import format_mcp_error

logger = logging.getLogger("data_agent.mcp.registry")

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


@dataclass
class ConnectedMCPServer:
    config: MCPServerConfig
    client: Any
    tools: list[dict[str, Any]]


class MCPRegistry:
    def __init__(self, timing: AgentTimingRecorder | None = None):
        self._settings = MCPSettings()
        self._connections: dict[str, ConnectedMCPServer] = {}
        self._exit_stack: AsyncExitStack | None = None
        self._timing = timing

    @property
    def settings(self) -> MCPSettings:
        return self._settings

    def configure(self, settings: MCPSettings) -> None:
        self._settings = settings

    def register(self, config: MCPServerConfig) -> None:
        existing = [server for server in self._settings.servers if server.name != config.name]
        existing.append(config)
        self._settings = MCPSettings(servers=existing)

    def unregister(self, name: str) -> None:
        self._settings = MCPSettings(
            servers=[server for server in self._settings.servers if server.name != name]
        )

    def list_registered(self) -> list[dict[str, Any]]:
        return [
            {
                "name": server.name,
                "transport": server.transport.value,
                "enabled": server.enabled,
                "command": server.command,
                "script": server.script,
                "url": server.url,
                "description": server.description,
                "tool_prefix": server.resolved_tool_prefix(),
                "server_type": server.server_type,
                "tags": list(server.tags),
            }
            for server in self._settings.servers
        ]

    def list_servers(self) -> list[dict[str, Any]]:
        status = []
        for server in self._settings.servers:
            status.append(
                {
                    "name": server.name,
                    "transport": server.transport.value,
                    "enabled": server.enabled,
                    "connected": server.name in self._connections,
                    "description": server.description,
                    "tool_prefix": server.resolved_tool_prefix(),
                    "server_type": server.server_type,
                    "tags": list(server.tags),
                }
            )
        return status

    async def shutdown(self) -> None:
        if self._exit_stack is not None:
            await self._exit_stack.aclose()
        self._exit_stack = None
        self._connections = {}

    async def connect_all_enabled(self) -> None:
        await self.shutdown()
        self._exit_stack = AsyncExitStack()
        started_at = time.perf_counter()
        for server in self._settings.enabled_servers():
            await self._connect_server(server)
        self._record_total_connect("all_enabled", started_at)

    async def connect_selected(self, server_names: list[str]) -> None:
        await self.shutdown()
        self._exit_stack = AsyncExitStack()
        selected = {name for name in server_names}
        started_at = time.perf_counter()
        for server in self._settings.servers:
            if server.enabled and server.name in selected:
                await self._connect_server(server)
        self._record_total_connect("selected", started_at)

    async def connect_temp(
        self,
        settings: MCPSettings,
        enabled_names: list[str] | None = None,
    ) -> "MCPRegistry":
        registry = MCPRegistry(timing=self._timing)
        registry.configure(settings)
        if enabled_names:
            await registry.connect_selected(enabled_names)
        else:
            await registry.connect_all_enabled()
        return registry

    def get_connected_server(self, name: str) -> ConnectedMCPServer | None:
        return self._connections.get(name)

    def find_server_by_type(self, server_type: str) -> ConnectedMCPServer | None:
        for server in self._connections.values():
            if server.config.server_type == server_type:
                return server
        return None

    def list_tools(self) -> list[dict[str, Any]]:
        bridged = []
        for server in self._connections.values():
            prefix = server.config.resolved_tool_prefix()
            for tool in server.tools:
                bridged.append(
                    {
                        "server": server.config.name,
                        "server_type": server.config.server_type,
                        "name": f"{prefix}{tool['name']}",
                        "remote_name": tool["name"],
                        "description": tool.get("description", ""),
                        "parameters": tool.get("parameters", {}),
                    }
                )
        return bridged

    def bridge_tool(self, server_name: str, remote_tool: dict[str, Any]) -> AgentTool:
        connected = self._connections[server_name]
        original_name = remote_tool["name"]
        prefixed_name = f"{connected.config.resolved_tool_prefix()}{original_name}"
        description = remote_tool.get("description", "")
        parameters = remote_tool.get("parameters", {"type": "object", "properties": {}})
        read_only, resource, max_concurrency = _mcp_tool_policy(
            connected.config.server_type,
            original_name,
        )

        async def _execute(tool_call_id: str, arguments: dict[str, Any]) -> AgentToolResult:
            started_at = time.perf_counter()
            if self._timing is not None:
                self._timing.record_tool_stage(
                    "mcp_tool_start",
                    tool_name=prefixed_name,
                    tool_call_id=tool_call_id,
                    server=server_name,
                    remote_tool=original_name,
                )
            try:
                result = await connected.client.call_tool(original_name, arguments)
                text = result if isinstance(result, str) else str(result)
                duration_ms = round((time.perf_counter() - started_at) * 1000, 3)
                if self._timing is not None:
                    self._timing.record_tool_stage(
                        "mcp_tool_done",
                        tool_name=prefixed_name,
                        tool_call_id=tool_call_id,
                        server=server_name,
                        remote_tool=original_name,
                        duration_ms=duration_ms,
                        is_error=False,
                    )
                return AgentToolResult(content=[ToolResultContent(type="text", text=text)])
            except Exception as e:
                duration_ms = round((time.perf_counter() - started_at) * 1000, 3)
                if self._timing is not None:
                    self._timing.record_tool_stage(
                        "mcp_tool_done",
                        tool_name=prefixed_name,
                        tool_call_id=tool_call_id,
                        server=server_name,
                        remote_tool=original_name,
                        duration_ms=duration_ms,
                        is_error=True,
                    )
                return AgentToolResult(
                    content=[
                        ToolResultContent(
                            type="text",
                            text=f"[{server_name}] 调用 {original_name} 失败: {e}",
                        )
                    ],
                    is_error=True,
                )

        return AgentTool(
            name=prefixed_name,
            label=f"[{server_name}] {original_name}",
            description=f"[来源: {server_name}] {description}",
            parameters=parameters,
            execute_fn=_execute,
            read_only=read_only,
            resource=resource,
            max_concurrency=max_concurrency,
        )

    def bridge_all_tools(
        self,
        *,
        exclude_server_types: set[str] | None = None,
    ) -> list[AgentTool]:
        exclude_server_types = exclude_server_types or set()
        tools: list[AgentTool] = []
        for server_name, connected in self._connections.items():
            if connected.config.server_type in exclude_server_types:
                continue
            for remote_tool in connected.tools:
                if (
                    connected.config.server_type == "semantic"
                    and remote_tool.get("name") not in SEMANTIC_AGENT_TOOLS
                ):
                    continue
                tools.append(self.bridge_tool(server_name, remote_tool))
        return tools

    async def test_server(self, config: MCPServerConfig) -> dict[str, Any]:
        temp_registry = MCPRegistry(timing=self._timing)
        temp_registry.configure(MCPSettings(servers=[config]))
        try:
            await temp_registry.connect_all_enabled()
            tools = temp_registry.list_tools()
            return {"success": True, "message": "连接成功", "tools": tools}
        except Exception as e:
            return {"success": False, "message": format_mcp_error(e)}
        finally:
            await temp_registry.shutdown()

    async def _connect_server(self, server: MCPServerConfig) -> None:
        assert self._exit_stack is not None
        connect_started_at = time.perf_counter()
        if self._timing is not None:
            self._timing.record_mcp_stage("connect_start", server=server.name)
        client_cm = self._create_client_context(server)
        client = await self._exit_stack.enter_async_context(client_cm)
        connect_ms = round((time.perf_counter() - connect_started_at) * 1000, 3)
        if self._timing is not None:
            self._timing.record_mcp_stage(
                "connect_done",
                server=server.name,
                duration_ms=connect_ms,
            )

        list_started_at = time.perf_counter()
        if self._timing is not None:
            self._timing.record_mcp_stage("list_tools_start", server=server.name)
        tools = await client.list_tools()
        list_ms = round((time.perf_counter() - list_started_at) * 1000, 3)
        if self._timing is not None:
            self._timing.record_mcp_stage(
                "list_tools_done",
                server=server.name,
                duration_ms=list_ms,
                tool_count=len(tools),
            )
        self._connections[server.name] = ConnectedMCPServer(
            config=server,
            client=client,
            tools=tools,
        )
        logger.info("[MCPRegistry] connected %s with %s tools", server.name, len(tools))

    def _record_total_connect(self, scope: str, started_at: float) -> None:
        if self._timing is None:
            return
        self._timing.record_mcp_stage(
            "connect_total_done",
            server=scope,
            duration_ms=round((time.perf_counter() - started_at) * 1000, 3),
            connected_servers=len(self._connections),
        )

    def _create_client_context(self, server: MCPServerConfig):
        if server.transport == MCPTransportType.STDIO:
            return StdioMCPClient.connect(
                command=server.command,
                script=server.script,
                args=server.args,
                env=server.env or None,
                timing=self._timing,
            )
        if server.transport == MCPTransportType.HTTP:
            raise NotImplementedError("HTTP MCP transport is not implemented yet")
        if server.transport == MCPTransportType.SSE:
            return SSEMCPClient.connect(
                url=server.url,
                headers=server.headers or None,
                timing=self._timing,
            )
        if server.transport == MCPTransportType.STREAMABLE_HTTP:
            return StreamableHTTPMCPClient.connect(
                url=server.url,
                headers=server.headers or None,
                timing=self._timing,
            )
        raise ValueError(f"Unsupported MCP transport: {server.transport}")
