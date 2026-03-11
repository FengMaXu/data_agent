from __future__ import annotations

from typing import Any, Protocol


class MCPCallable(Protocol):
    async def call_tool(self, name: str, arguments: dict[str, Any]) -> Any: ...
