from __future__ import annotations

from typing import Any, Protocol


class MCPToolCaller(Protocol):
    async def call_tool(self, name: str, arguments: dict[str, Any]) -> Any: ...

    async def list_tools(self) -> list[dict[str, Any]]: ...
