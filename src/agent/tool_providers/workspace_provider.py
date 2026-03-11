from __future__ import annotations

from src.agent.tool_providers.base import SessionToolBuildContext, ToolProvider
from src.workspace.code_executor import CodeExecutor, create_code_tools
from src.workspace.file_tools import create_file_tools


class WorkspaceToolProvider(ToolProvider):
    """装配绑定当前会话 workspace 的工具。"""

    async def build_tools(self, context: SessionToolBuildContext):
        workspace = context.workspace
        code_executor = CodeExecutor(workspace)
        return [
            *create_file_tools(workspace),
            *create_code_tools(code_executor),
        ]
