from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from src.agent.types import AgentTimingRecorder, AgentTool


@dataclass
class GlobalRuntimeServices:
    """跨会话复用的全局运行资源。"""

    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class SessionToolBuildContext:
    """会话级工具装配上下文。"""

    session_id: str
    workspace: Any
    project_root: Path
    global_services: GlobalRuntimeServices
    runtime_overrides: dict[str, Any] = field(default_factory=dict)
    timing: AgentTimingRecorder | None = None


class ToolProvider:
    """统一工具提供器接口。"""

    async def build_tools(self, context: SessionToolBuildContext) -> list[AgentTool]:
        raise NotImplementedError
