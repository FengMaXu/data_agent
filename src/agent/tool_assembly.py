from __future__ import annotations

from pathlib import Path
from typing import Any

from src.agent.tool_providers.base import GlobalRuntimeServices, SessionToolBuildContext, ToolProvider
from src.agent.tool_providers.local_provider import LocalToolProvider
from src.agent.tool_providers.mcp_provider import MCPToolProvider
from src.agent.tool_providers.skill_provider import SkillToolProvider
from src.agent.tool_providers.workspace_provider import WorkspaceToolProvider
from src.ai.config import AIConfig
from src.mcp.config_loader import MCPConfigLoader
from src.mcp.registry import MCPRegistry


class ToolAssemblyService:
    def __init__(self, project_root: Path, providers: list[ToolProvider] | None = None):
        self.project_root = project_root
        self.providers = providers or [
            MCPToolProvider(),
            LocalToolProvider(),
            SkillToolProvider(),
            WorkspaceToolProvider(),
        ]

    async def build_global_runtime_services(
        self,
        ai_config: AIConfig,
        runtime_overrides: dict[str, Any] | None = None,
        enabled_mcp_servers: list[str] | None = None,
    ) -> GlobalRuntimeServices:
        settings = MCPConfigLoader.load_effective_settings(
            self.project_root,
            ai_config,
            runtime_override=runtime_overrides.get("mcp_config") if runtime_overrides else None,
        )
        return GlobalRuntimeServices(
            metadata={
                "mcp_settings": settings,
            }
        )

    async def build_connected_runtime_services(
        self,
        ai_config: AIConfig,
        runtime_overrides: dict[str, Any] | None = None,
        enabled_mcp_servers: list[str] | None = None,
    ) -> GlobalRuntimeServices:
        settings = MCPConfigLoader.load_effective_settings(
            self.project_root,
            ai_config,
            runtime_override=runtime_overrides.get("mcp_config") if runtime_overrides else None,
        )
        registry = MCPRegistry()
        registry.configure(settings)
        if enabled_mcp_servers:
            await registry.connect_selected(enabled_mcp_servers)
        else:
            await registry.connect_all_enabled()
        return GlobalRuntimeServices(
            metadata={
                "mcp_registry": registry,
                "mcp_settings": settings,
            }
        )

    async def build_session_tools(
        self,
        session_id: str,
        workspace,
        global_services: GlobalRuntimeServices,
        runtime_overrides: dict[str, Any] | None = None,
    ):
        context = SessionToolBuildContext(
            session_id=session_id,
            workspace=workspace,
            project_root=self.project_root,
            global_services=global_services,
            runtime_overrides=runtime_overrides or {},
        )
        tools = []
        for provider in self.providers:
            tools.extend(await provider.build_tools(context))
        return tools
