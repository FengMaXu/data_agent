from __future__ import annotations

from src.agent.tool_providers.base import SessionToolBuildContext, ToolProvider
from src.context.metadata_store import MetadataStore
from src.interaction.sql_evaluator import SQLEvaluator
from src.mcp.db_tools import create_db_tools
from src.mcp.sql_guard import SQLGuard


class MCPToolProvider(ToolProvider):
    """装配 MCP 桥接工具与数据库适配工具。"""

    async def build_tools(self, context: SessionToolBuildContext):
        registry = context.global_services.metadata.get("mcp_registry")
        if registry is None:
            return []

        tools = []

        tools.extend(registry.bridge_all_tools(exclude_server_types={"database"}))

        db_server = registry.find_server_by_type("database")
        if db_server is not None:
            guard = SQLGuard(strict=True)
            db_tools = create_db_tools(db_server.client, guard)
            evaluator = SQLEvaluator(db_server.client, guard)
            tools.extend([t for t in db_tools if t.name != "execute_sql"])
            tools.append(evaluator.create_validated_execute_tool())

            metadata_store = MetadataStore(db_server.client)
            tools.extend(metadata_store.create_tools())

        return tools
