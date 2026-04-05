from __future__ import annotations

from src.agent.tool_providers.base import SessionToolBuildContext, ToolProvider
from src.context.metadata_store import MetadataStore
from src.interaction.sql_evaluator import SQLEvaluator
from src.mcp.db_tools import create_db_tools
from src.mcp.manager import MCPManager
from src.mcp.sql_guard import SQLGuard


class MCPToolProvider(ToolProvider):
    """装配 MCP 桥接工具与数据库适配工具。"""

    async def build_tools(self, context: SessionToolBuildContext):
        manager: MCPManager | None = context.global_services.metadata.get("mcp_manager")
        if manager is None:
            return []

        enabled: list[str] | None = context.runtime_overrides.get("enabled_mcp_servers")

        # 非 DB 工具：直接桥接（知识库、文件系统等）
        tools = manager.bridge_tools(
            exclude_server_types={"database"},
            only_names=enabled,
        )

        # DB 工具：SQLEvaluator 验证 + MetadataStore
        db_server = manager.find_server_by_type("database")
        if db_server is not None:
            if enabled is None or db_server.config.name in enabled:
                guard = SQLGuard(strict=True)
                db_tools = create_db_tools(db_server, guard)
                evaluator = SQLEvaluator(db_server, guard)
                metadata_store = MetadataStore(db_server)

                tools.extend(t for t in db_tools if t.name != "execute_sql")
                tools.append(evaluator.create_validated_execute_tool())
                tools.extend(metadata_store.create_tools())

        return tools
