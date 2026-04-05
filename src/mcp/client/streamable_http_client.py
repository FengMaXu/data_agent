from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from src.agent.types import AgentTimingRecorder
from src.mcp.mcp_client import MCPClient


class StreamableHTTPMCPClient(MCPClient):
    @classmethod
    @asynccontextmanager
    async def connect(
        cls,
        url: str,
        headers: dict[str, str] | None = None,
        timing: AgentTimingRecorder | None = None,
    ) -> AsyncIterator[MCPClient]:
        async with MCPClient.connect_streamable_http(
            url=url,
            headers=headers,
            timing=timing,
        ) as client:
            yield client
