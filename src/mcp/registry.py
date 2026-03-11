from __future__ import annotations

import logging
from contextlib import AsyncExitStack
from dataclasses import dataclass
from typing import Any

from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent
from src.mcp.client.http_client import HttpMCPClient
from src.mcp.client.sse_client import SSEMCPClient
from src.mcp.client.stdio_client import StdioMCPClient
from src.mcp.config_models import MCPServerConfig, MCPSettings, MCPTransportType

logger = logging.getLogger("data_agent.mcp.registry")


@dataclass
class ConnectedMCPServer:
    config: MCPServerConfig
    client: Any
    tools: list[dict[str, Any]]


class MCPRegistry:
    def __init__(self):
        self._settings = MCPSettings()
        self._connections: dict[str, ConnectedMCPServer] = {}
        self._exit_stack: AsyncExitStack | None = None

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
        for server in self._settings.enabled_servers():
            await self._connect_server(server)

    async def connect_selected(self, server_names: list[str]) -> None:
        await self.shutdown()
        self._exit_stack = AsyncExitStack()
        selected = {name for name in server_names}
        for server in self._settings.servers:
            if server.enabled and server.name in selected:
                await self._connect_server(server)

    async def connect_temp(self, settings: MCPSettings, enabled_names: list[str] | None = None) -> "MCPRegistry":
        registry = MCPRegistry()
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

        async def _execute(tool_call_id: str, arguments: dict[str, Any]) -> AgentToolResult:
            try:
                result = await connected.client.call_tool(original_name, arguments)
                text = result if isinstance(result, str) else str(result)
                return AgentToolResult(content=[ToolResultContent(type="text", text=text)])
            except Exception as e:
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
        )

    def bridge_all_tools(self, *, exclude_server_types: set[str] | None = None) -> list[AgentTool]:
        exclude_server_types = exclude_server_types or set()
        tools: list[AgentTool] = []
        for server_name, connected in self._connections.items():
            if connected.config.server_type in exclude_server_types:
                continue
            for remote_tool in connected.tools:
                tools.append(self.bridge_tool(server_name, remote_tool))
        return tools

    async def test_server(self, config: MCPServerConfig) -> dict[str, Any]:
        temp_registry = MCPRegistry()
        temp_registry.configure(MCPSettings(servers=[config]))
        try:
            await temp_registry.connect_all_enabled()
            tools = temp_registry.list_tools()
            return {"success": True, "message": "连接成功", "tools": tools}
        except Exception as e:
            return {"success": False, "message": str(e)}
        finally:
            await temp_registry.shutdown()

    async def _connect_server(self, server: MCPServerConfig) -> None:
        assert self._exit_stack is not None
        client_cm = self._create_client_context(server)
        client = await self._exit_stack.enter_async_context(client_cm)
        tools = await client.list_tools()
        self._connections[server.name] = ConnectedMCPServer(
            config=server,
            client=client,
            tools=tools,
        )
        logger.info("[MCPRegistry] connected %s with %s tools", server.name, len(tools))

    def _create_client_context(self, server: MCPServerConfig):
        if server.transport == MCPTransportType.STDIO:
            return StdioMCPClient.connect(
                command=server.command,
                script=server.script,
                env=server.env or None,
            )
        if server.transport == MCPTransportType.HTTP:
            raise NotImplementedError("HTTP MCP transport is not implemented yet")
        if server.transport == MCPTransportType.SSE:
            raise NotImplementedError("SSE MCP transport is not implemented yet")
        raise ValueError(f"Unsupported MCP transport: {server.transport}")
