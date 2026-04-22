from __future__ import annotations

from src.agent.tool_providers.base import SessionToolBuildContext, ToolProvider
from src.agent.tool_providers.show_widget import create_show_widget_tool
from src.context.annotations import AnnotationStore
from src.context.knowledge_tools import create_knowledge_tools
from src.ecosystem.http_hooks import HttpHookRegistry, create_http_tools
from src.interaction.clarification import create_clarification_tool
from src.learning.feedback import FeedbackCollector
from src.learning.learning_store import LearningStore


class LocalToolProvider(ToolProvider):
    """装配与 workspace 无关的本地工具。"""

    async def build_tools(self, context: SessionToolBuildContext):
        tools = []

        tools.append(create_show_widget_tool())
        tools.extend(create_knowledge_tools())

        annotation_store = AnnotationStore()
        annotation_store.load()
        tools.extend(annotation_store.create_tools())

        clarification_callback = context.runtime_overrides.get("clarification_callback")
        if callable(clarification_callback):
            tools.append(create_clarification_tool(clarification_callback))

        learning_store = LearningStore()
        tools.extend(learning_store.create_tools())

        feedback_collector = FeedbackCollector(learning_store)
        tools.extend(feedback_collector.create_tools())

        http_registry = HttpHookRegistry()
        tools.extend(create_http_tools(http_registry))

        return tools
