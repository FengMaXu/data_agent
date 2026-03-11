from __future__ import annotations

from typing import Any


class HttpMCPClient:
    def __init__(self, url: str, headers: dict[str, str] | None = None):
        self.url = url
        self.headers = headers or {}

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> str:
        raise NotImplementedError("HTTP MCP transport is not implemented yet")

    async def list_tools(self) -> list[dict[str, Any]]:
        raise NotImplementedError("HTTP MCP transport is not implemented yet")
