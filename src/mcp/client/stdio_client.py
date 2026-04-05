from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from src.agent.types import AgentTimingRecorder
from src.mcp.mcp_client import MCPClient


class StdioMCPClient(MCPClient):
    @classmethod
    @asynccontextmanager
    async def connect(
        cls,
        command: str = "python",
        script: str = "",
        env: dict[str, str] | None = None,
        timing: AgentTimingRecorder | None = None,
    ) -> AsyncIterator[MCPClient]:
        async with MCPClient.connect(
            command=command,
            script=script,
            env=env,
            timing=timing,
        ) as client:
            yield client
