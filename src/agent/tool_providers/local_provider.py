from __future__ import annotations

from src.agent.tool_providers.base import SessionToolBuildContext, ToolProvider
from src.context.knowledge_tools import create_knowledge_tools
from src.learning.feedback import FeedbackCollector
from src.learning.learning_store import LearningStore
from src.ecosystem.http_hooks import HttpHookRegistry, create_http_tools


class LocalToolProvider(ToolProvider):
    """装配与 workspace 无关的本地工具。"""

    async def build_tools(self, context: SessionToolBuildContext):
        tools = []

        tools.extend(create_knowledge_tools())

        learning_store = LearningStore()
        tools.extend(learning_store.create_tools())

        feedback_collector = FeedbackCollector(learning_store)
        tools.extend(feedback_collector.create_tools())

        http_registry = HttpHookRegistry()
        tools.extend(create_http_tools(http_registry))

        return tools
