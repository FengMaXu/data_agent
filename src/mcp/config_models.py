from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class MCPTransportType(str, Enum):
    STDIO = "stdio"
    HTTP = "http"
    SSE = "sse"
    STREAMABLE_HTTP = "streamable-http"


@dataclass
class MCPServerConfig:
    name: str
    transport: MCPTransportType = MCPTransportType.STDIO
    enabled: bool = True
    command: str = "python"
    script: str = ""
    url: str = ""
    headers: dict[str, str] = field(default_factory=dict)
    env: dict[str, str] = field(default_factory=dict)
    description: str = ""
    tool_prefix: str = ""
    server_type: str = "service"
    tags: list[str] = field(default_factory=list)

    def resolved_tool_prefix(self) -> str:
        return self.tool_prefix or f"{self.name}_"


@dataclass
class MCPSettings:
    servers: list[MCPServerConfig] = field(default_factory=list)

    def enabled_servers(self) -> list[MCPServerConfig]:
        return [server for server in self.servers if server.enabled]

    def get_server(self, name: str) -> MCPServerConfig | None:
        for server in self.servers:
            if server.name == name:
                return server
        return None

    def to_dict(self) -> dict[str, Any]:
        return {
            "servers": [
                {
                    "name": server.name,
                    "transport": server.transport.value,
                    "enabled": server.enabled,
                    "command": server.command,
                    "script": server.script,
                    "url": server.url,
                    "headers": dict(server.headers),
                    "env": dict(server.env),
                    "description": server.description,
                    "tool_prefix": server.tool_prefix,
                    "server_type": server.server_type,
                    "tags": list(server.tags),
                }
                for server in self.servers
            ]
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "MCPSettings":
        if not data:
            return cls()

        servers = []
        for item in data.get("servers", []):
            transport = item.get("transport", MCPTransportType.STDIO.value)
            servers.append(
                MCPServerConfig(
                    name=item["name"],
                    transport=MCPTransportType(transport),
                    enabled=item.get("enabled", True),
                    command=item.get("command", "python"),
                    script=item.get("script", ""),
                    url=item.get("url", ""),
                    headers=item.get("headers", {}) or {},
                    env=item.get("env", {}) or {},
                    description=item.get("description", ""),
                    tool_prefix=item.get("tool_prefix", ""),
                    server_type=item.get("server_type", "service"),
                    tags=item.get("tags", []) or [],
                )
            )
        return cls(servers=servers)
