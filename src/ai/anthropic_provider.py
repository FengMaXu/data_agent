"""
Anthropic Provider
基于 anthropic SDK 实现流式调用与工具调用
"""

from __future__ import annotations

import json
import logging
from typing import AsyncIterator

from .base_provider import (
    AssistantResponse,
    LLMProvider,
    Message,
    Role,
    StreamEvent,
    TokenUsage,
    ToolCall,
    ToolDefinition,
    generate_message_id,
    generate_tool_call_id,
    robust_parse_tool_arguments,
)

logger = logging.getLogger("data_agent.ai.anthropic")


class AnthropicProvider(LLMProvider):
    """Anthropic (Claude) API Provider"""

    @property
    def provider_name(self) -> str:
        return "anthropic"

    def _convert_messages(self, messages: list[Message]) -> tuple[str, list[dict]]:
        """
        将内部 Message 转为 Anthropic API 格式。
        Anthropic 的 system prompt 是顶层参数，不在 messages 列表里。
        返回 (system_prompt, messages_list)
        """
        system_prompt = ""
        result = []

        for msg in messages:
            if msg.role == Role.SYSTEM:
                system_prompt = msg.content
            elif msg.role == Role.USER:
                result.append({"role": "user", "content": msg.content})
            elif msg.role == Role.ASSISTANT:
                content_blocks: list[dict] = []
                if msg.content:
                    content_blocks.append({"type": "text", "text": msg.content})
                if msg.tool_calls:
                    for tc in msg.tool_calls:
                        content_blocks.append(
                            {
                                "type": "tool_use",
                                "id": tc.id,
                                "name": tc.name,
                                "input": tc.arguments,
                            }
                        )
                result.append({"role": "assistant", "content": content_blocks})
            elif msg.role == Role.TOOL_RESULT:
                result.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": msg.tool_call_id or "",
                                "content": msg.content,
                            }
                        ],
                    }
                )

        return system_prompt, result

    def _convert_tools(self, tools: list[ToolDefinition]) -> list[dict]:
        """将内部 ToolDefinition 转为 Anthropic API 格式"""
        return [
            {
                "name": t.name,
                "description": t.description,
                "input_schema": t.parameters,
            }
            for t in tools
        ]

    async def stream(
        self,
        model: str,
        messages: list[Message],
        tools: list[ToolDefinition] | None = None,
        *,
        temperature: float = 0.0,
        max_tokens: int = 4096,
        api_key: str | None = None,
        **kwargs,
    ) -> AsyncIterator[StreamEvent]:
        """流式调用 Anthropic API"""
        try:
            import anthropic
        except ImportError:
            raise ImportError("请安装 anthropic: pip install anthropic")

        client = (
            anthropic.AsyncAnthropic(api_key=api_key)
            if api_key
            else anthropic.AsyncAnthropic()
        )

        system_prompt, api_messages = self._convert_messages(messages)

        request_kwargs: dict = {
            "model": model,
            "messages": api_messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

        if system_prompt:
            request_kwargs["system"] = system_prompt

        if tools:
            request_kwargs["tools"] = self._convert_tools(tools)

        full_text = ""
        tool_calls: list[ToolCall] = []
        tool_calls_by_id: dict[str, ToolCall] = {}
        tool_json_buffers: dict[int, str] = {}
        tool_meta_by_index: dict[int, dict[str, str]] = {}
        usage = TokenUsage()
        message_id = generate_message_id()

        async with client.messages.stream(**request_kwargs) as stream:
            async for event in stream:
                event_type = event.type

                if event_type == "message_start":
                    yield StreamEvent(type="message_start", message_id=message_id)
                    msg = event.message
                    if hasattr(msg, "usage") and msg.usage:
                        usage.prompt_tokens = msg.usage.input_tokens

                elif event_type == "content_block_start":
                    block = event.content_block
                    block_index = getattr(event, "index", None)
                    if block.type == "tool_use" and block_index is not None:
                        tool_id = getattr(block, "id", "") or generate_tool_call_id()
                        tool_name = getattr(block, "name", "")
                        tool_meta_by_index[block_index] = {
                            "id": tool_id,
                            "name": tool_name,
                        }
                        tool_json_buffers[block_index] = ""
                        yield StreamEvent(
                            type="tool_call_start",
                            message_id=message_id,
                            tool_call_id=tool_id,
                            tool_name=tool_name,
                            tool_call=ToolCall(
                                id=tool_id,
                                name=tool_name,
                                arguments={},
                            ),
                        )

                elif event_type == "content_block_delta":
                    delta = event.delta
                    block_index = getattr(event, "index", None)
                    if delta.type == "text_delta":
                        full_text += delta.text
                        yield StreamEvent(
                            type="text_delta",
                            text=delta.text,
                            message_id=message_id,
                        )
                    elif delta.type == "input_json_delta" and block_index is not None:
                        partial = delta.partial_json
                        tool_json_buffers[block_index] = (
                            tool_json_buffers.get(block_index, "") + partial
                        )
                        tool_meta = tool_meta_by_index.get(block_index, {})
                        yield StreamEvent(
                            type="tool_call_delta",
                            message_id=message_id,
                            tool_call_id=tool_meta.get("id"),
                            tool_name=tool_meta.get("name"),
                            partial_arguments=partial,
                        )

                elif event_type == "content_block_stop":
                    block_index = getattr(event, "index", None)
                    tool_meta = (
                        tool_meta_by_index.get(block_index, {})
                        if block_index is not None
                        else {}
                    )
                    if tool_meta:
                        current_tool_json = tool_json_buffers.get(block_index, "")
                        args = robust_parse_tool_arguments(current_tool_json)

                        tc = ToolCall(
                            id=tool_meta.get("id") or generate_tool_call_id(),
                            name=tool_meta.get("name", ""),
                            arguments=args,
                        )
                        tool_calls.append(tc)
                        tool_calls_by_id[tc.id] = tc
                        tool_json_buffers.pop(block_index, None)
                        tool_meta_by_index.pop(block_index, None)

                elif event_type == "message_delta":
                    if hasattr(event, "usage") and event.usage:
                        usage.completion_tokens = event.usage.output_tokens
                        usage.total_tokens = (
                            usage.prompt_tokens + usage.completion_tokens
                        )

        stop_reason = "tool_use" if tool_calls else "end_turn"
        yield StreamEvent(
            type="done",
            message_id=message_id,
            response=AssistantResponse(
                content=full_text,
                tool_calls=list(tool_calls_by_id.values()) or None,
                stop_reason=stop_reason,
                usage=usage,
                model=model,
                message_id=message_id,
            ),
        )
