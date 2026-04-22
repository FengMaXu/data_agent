"""
OpenAI Provider
基于 openai SDK 实现流式调用与工具调用
"""

from __future__ import annotations

import json
import logging
from typing import AsyncIterator

from .base_provider import (
    AssistantResponse,
    LLMProvider,
    Message,
    robust_parse_tool_arguments,
    Role,
    StreamEvent,
    TokenUsage,
    ToolCall,
    ToolDefinition,
    generate_message_id,
    generate_tool_call_id,
)

logger = logging.getLogger("data_agent.ai.openai")


class OpenAIProvider(LLMProvider):
    """OpenAI / OpenAI-compatible API Provider"""

    @property
    def provider_name(self) -> str:
        return "openai"

    def _convert_messages(self, messages: list[Message]) -> list[dict]:
        """将内部 Message 转为 OpenAI API 格式"""
        result = []
        for msg in messages:
            if msg.role == Role.SYSTEM:
                result.append({"role": "system", "content": msg.content})
            elif msg.role == Role.USER:
                result.append({"role": "user", "content": msg.content})
            elif msg.role == Role.ASSISTANT:
                entry: dict = {"role": "assistant"}
                if msg.content:
                    entry["content"] = msg.content
                if msg.tool_calls:
                    entry["tool_calls"] = [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.name,
                                "arguments": json.dumps(
                                    tc.arguments, ensure_ascii=False
                                ),
                            },
                        }
                        for tc in msg.tool_calls
                    ]
                result.append(entry)
            elif msg.role == Role.TOOL_RESULT:
                result.append(
                    {
                        "role": "tool",
                        "tool_call_id": msg.tool_call_id or "",
                        "content": msg.content,
                    }
                )
        return result

    def _convert_tools(self, tools: list[ToolDefinition]) -> list[dict]:
        """将内部 ToolDefinition 转为 OpenAI API 格式"""
        return [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                },
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
        """流式调用 OpenAI API（含自动重试）"""
        import asyncio

        try:
            from openai import AsyncOpenAI
        except ImportError:
            raise ImportError("请安装 openai: pip install openai")

        # 支持自定义 API 端点（智谱 GLM、DeepSeek 等 OpenAI-compatible API）
        base_url = kwargs.get("base_url", None)
        client_kwargs: dict = {}
        if api_key:
            client_kwargs["api_key"] = api_key
        if base_url:
            client_kwargs["base_url"] = base_url
        client = AsyncOpenAI(**client_kwargs)

        request_kwargs: dict = {
            "model": model,
            "messages": self._convert_messages(messages),
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }

        # stream_options 并非所有 OpenAI-compatible API 都支持
        if not base_url:
            request_kwargs["stream_options"] = {"include_usage": True}

        if tools:
            request_kwargs["tools"] = self._convert_tools(tools)

        # 自动重试：处理 429 速率限制
        max_retries = 3
        base_delay = 3.0  # 首次等待 3 秒

        for attempt in range(max_retries + 1):
            try:
                response = await client.chat.completions.create(**request_kwargs)
                break  # 请求成功，跳出重试循环
            except Exception as e:
                error_str = str(e)
                if "429" in error_str or "rate" in error_str.lower():
                    if attempt < max_retries:
                        delay = base_delay * (2**attempt)  # 3s → 6s → 12s
                        logger.warning(
                            f"[OpenAI] 速率限制，{delay:.0f}秒后重试 "
                            f"(第{attempt + 1}/{max_retries}次)"
                        )
                        yield StreamEvent(
                            type="text_delta",
                            text=f"\n⏳ API 速率限制，等待 {delay:.0f} 秒后重试...\n",
                        )
                        await asyncio.sleep(delay)
                        continue
                raise  # 非 429 错误或重试耗尽，抛出

        full_text = ""
        tool_calls_map: dict[int, dict] = {}  # index -> {id, name, arguments_str}
        usage = TokenUsage()
        message_id = generate_message_id()
        yield StreamEvent(type="message_start", message_id=message_id)

        async for chunk in response:
            delta = chunk.choices[0].delta if chunk.choices else None

            if delta and delta.content:
                full_text += delta.content
                yield StreamEvent(
                    type="text_delta",
                    text=delta.content,
                    message_id=message_id,
                )

            if delta and delta.tool_calls:
                for tc_delta in delta.tool_calls:
                    idx = tc_delta.index
                    if idx not in tool_calls_map:
                        tool_calls_map[idx] = {
                            "id": tc_delta.id or generate_tool_call_id(),
                            "name": (
                                tc_delta.function.name or ""
                                if tc_delta.function
                                else ""
                            ),
                            "arguments_str": "",
                            "started": False,
                        }
                    if tc_delta.function and tc_delta.function.name:
                        tool_calls_map[idx]["name"] = tc_delta.function.name
                    if tc_delta.id:
                        tool_calls_map[idx]["id"] = tc_delta.id
                    if not tool_calls_map[idx]["started"]:
                        tool_calls_map[idx]["started"] = True
                        yield StreamEvent(
                            type="tool_call_start",
                            message_id=message_id,
                            tool_call_id=tool_calls_map[idx]["id"],
                            tool_name=tool_calls_map[idx]["name"],
                            tool_call=ToolCall(
                                id=tool_calls_map[idx]["id"],
                                name=tool_calls_map[idx]["name"],
                                arguments={},
                            ),
                        )
                    if tc_delta.function and tc_delta.function.arguments:
                        partial_arguments = tc_delta.function.arguments
                        tool_calls_map[idx]["arguments_str"] += partial_arguments
                        yield StreamEvent(
                            type="tool_call_delta",
                            message_id=message_id,
                            tool_call_id=tool_calls_map[idx]["id"],
                            tool_name=tool_calls_map[idx]["name"],
                            partial_arguments=partial_arguments,
                        )

            # Token 统计在最后一个 chunk（usage 字段）
            if chunk.usage:
                usage = TokenUsage(
                    prompt_tokens=chunk.usage.prompt_tokens,
                    completion_tokens=chunk.usage.completion_tokens,
                    total_tokens=chunk.usage.total_tokens,
                )

        # 解析工具调用
        final_tool_calls: list[ToolCall] = []
        for idx in sorted(tool_calls_map.keys()):
            tc_data = tool_calls_map[idx]
            args = robust_parse_tool_arguments(tc_data["arguments_str"])

            tc = ToolCall(id=tc_data["id"], name=tc_data["name"], arguments=args)
            final_tool_calls.append(tc)

        # 最终 done 事件
        stop_reason = "tool_use" if final_tool_calls else "end_turn"
        yield StreamEvent(
            type="done",
            message_id=message_id,
            response=AssistantResponse(
                content=full_text,
                tool_calls=final_tool_calls if final_tool_calls else None,
                stop_reason=stop_reason,
                usage=usage,
                model=model,
                message_id=message_id,
            ),
        )
