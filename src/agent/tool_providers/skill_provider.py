from __future__ import annotations

from src.agent.tool_providers.base import SessionToolBuildContext, ToolProvider
from src.context.skill_activation import create_project_skill_manager, create_skill_tools


class SkillToolProvider(ToolProvider):
    """装配文件型 skill 激活元工具。"""

    async def build_tools(self, context: SessionToolBuildContext):
        skill_manager = create_project_skill_manager(context.project_root)
        return create_skill_tools(skill_manager)
