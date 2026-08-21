from __future__ import annotations

import hashlib
import logging
import time
from pathlib import Path
from typing import Any

from src.agent.tool_providers.base import (
    GlobalRuntimeServices,
    SessionToolBuildContext,
    ToolProvider,
)
from src.agent.tool_providers.local_provider import LocalToolProvider
from src.agent.tool_providers.mcp_provider import MCPToolProvider
from src.agent.tool_providers.skill_provider import SkillToolProvider
from src.agent.tool_providers.workspace_provider import WorkspaceToolProvider
from src.agent.tool_providers.html_dashboard import HTMLDashboardProvider
from src.agent.tool_providers.semantic_dashboard import SemanticDashboardProvider
from src.agent.types import AgentTimingRecorder, AgentTool
from src.ai.config import AIConfig
from src.mcp.manager import mcp_manager

logger = logging.getLogger(__name__)

class ToolAssemblyService:
    def __init__(self, project_root: Path, providers: list[ToolProvider] | None = None):
        self.project_root = project_root
        self.providers = providers or [
            MCPToolProvider(),
            LocalToolProvider(),
            SkillToolProvider(),
            WorkspaceToolProvider(),
            HTMLDashboardProvider(),
            SemanticDashboardProvider(),
        ]
        self.provider_fingerprint = self._compute_provider_fingerprint()

    def _compute_provider_fingerprint(self) -> str:
        """根据 provider 类名列表计算指纹，provider 列表变化时缓存自动失效。"""
        names = "|".join(p.__class__.__qualname__ for p in self.providers)
        return hashlib.md5(names.encode()).hexdigest()[:12]

    def build_global_runtime_services(
        self,
        timing: AgentTimingRecorder | None = None,
    ) -> GlobalRuntimeServices:
        """
        返回全局运行时服务（已在 lifespan 启动的 mcp_manager）。
        同步方法，无需 await。
        """
        t0 = time.perf_counter()
        services = GlobalRuntimeServices(metadata={"mcp_manager": mcp_manager})
        if timing is not None:
            timing.mark(
                "runtime_services_ready",
                logger_name="Chat",
                duration_ms=round((time.perf_counter() - t0) * 1000, 3),
            )
        return services

    async def build_session_tools(
        self,
        session_id: str,
        workspace: Any,
        global_services: GlobalRuntimeServices,
        runtime_overrides: dict[str, Any] | None = None,
        timing: AgentTimingRecorder | None = None,
    ) -> list[Any]:
        runtime_overrides = runtime_overrides or {}
        context = SessionToolBuildContext(
            session_id=session_id,
            workspace=workspace,
            project_root=self.project_root,
            global_services=global_services,
            runtime_overrides=runtime_overrides,
            timing=timing,
        )
        tools: list[AgentTool] = []
        for provider in self.providers:
            t0 = time.perf_counter()
            try:
                provider_tools = await provider.build_tools(context)
            except Exception:
                logger.exception(
                    "Provider %s.build_tools() raised, skipping",
                    provider.__class__.__name__,
                )
                continue
            for t in provider_tools:
                if isinstance(t, AgentTool):
                    tools.append(t)
                else:
                    logger.warning(
                        "Provider %s returned non-AgentTool object: %r (%s), skipping",
                        provider.__class__.__name__,
                        t,
                        type(t).__name__,
                    )
            if timing is not None:
                timing.mark(
                    "provider_build_tools",
                    logger_name="Chat",
                    provider=provider.__class__.__name__,
                    tool_count=len(provider_tools),
                    duration_ms=round((time.perf_counter() - t0) * 1000, 3),
                )
        return tools
