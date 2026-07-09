from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Iterable

from src.ai.base_provider import Message, Role
from src.skills import SkillRuntimeState

from .types import AgentContext, AgentTimingRecorder, AgentTool

logger = logging.getLogger("data_agent.agent.context_builder")


@dataclass(frozen=True)
class ContextBuildResult:
    context: AgentContext
    removed_tool_call_ids: list[str]
    message_count: int
    tool_count: int
    known_tool_count: int


class AgentContextBuilder:
    """Build the model-facing context from persisted session state."""

    def build(
        self,
        *,
        system_prompt: str,
        messages: Iterable[Message],
        tools: list[AgentTool],
        known_tools: list[AgentTool] | None = None,
        tool_catalog: Any | None = None,
        active_skills: SkillRuntimeState | None = None,
        timing: AgentTimingRecorder | None = None,
    ) -> ContextBuildResult:
        sanitizing_tools = known_tools if known_tools is not None else tools
        sanitized, removed_tool_call_ids = self._sanitize_messages(messages, sanitizing_tools)
        context = AgentContext(
            system_prompt=system_prompt,
            messages=sanitized,
            tools=tools,
            tool_catalog=tool_catalog,
            active_skills=active_skills or SkillRuntimeState(),
            timing=timing,
        )
        if removed_tool_call_ids:
            logger.info(
                "[ContextBuilder] removed unavailable tool calls: %s",
                ",".join(removed_tool_call_ids),
            )
        if timing is not None:
            timing.mark_once(
                "context_builder_ready",
                message_count=len(sanitized),
                tool_count=len(tools),
                known_tool_count=len(sanitizing_tools),
                removed_tool_call_count=len(removed_tool_call_ids),
            )
        return ContextBuildResult(
            context=context,
            removed_tool_call_ids=removed_tool_call_ids,
            message_count=len(sanitized),
            tool_count=len(tools),
            known_tool_count=len(sanitizing_tools),
        )

    def _sanitize_messages(
        self,
        messages: Iterable[Message],
        tools: list[AgentTool],
    ) -> tuple[list[Message], list[str]]:
        available_tool_names = {tool.name for tool in tools}
        removed_tool_call_ids: list[str] = []
        sanitized: list[Message] = []

        for message in messages:
            if message.role == Role.SYSTEM:
                continue

            if message.role == Role.ASSISTANT and message.tool_calls:
                kept_tool_calls = []
                for tool_call in message.tool_calls:
                    if tool_call.name in available_tool_names:
                        kept_tool_calls.append(tool_call)
                    else:
                        removed_tool_call_ids.append(tool_call.id)

                if kept_tool_calls or message.content:
                    sanitized.append(
                        Message(
                            role=message.role,
                            content=message.content,
                            tool_calls=kept_tool_calls or None,
                            tool_call_id=message.tool_call_id,
                            tool_name=message.tool_name,
                            name=message.name,
                            message_id=message.message_id,
                            reasoning_content=message.reasoning_content,
                        )
                    )
                continue

            if message.role == Role.TOOL_RESULT and message.tool_call_id in removed_tool_call_ids:
                continue

            sanitized.append(message)

        return sanitized, removed_tool_call_ids
