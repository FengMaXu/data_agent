"""
OpenAI Provider
基于 openai SDK 实现流式调用与工具调用
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
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
from src.resilience.retry import RetryPolicy, async_retry, is_retryable_exception

logger = logging.getLogger("data_agent.ai.openai")

LLM_RETRY_POLICY = RetryPolicy(
    max_attempts=4,
    base_delay=1.0,
    multiplier=2.0,
    max_delay=12.0,
    jitter=0.2,
    max_server_delay=60.0,
)


@dataclass(frozen=True)
class OpenAICompat:
    requires_reasoning_content_on_assistant_messages: bool = False
    thinking_format: str | None = None
    supports_strict_mode: bool = False


DEFAULT_DEEPSEEK_REASONING_EFFORT = "medium"


class OpenAIProvider(LLMProvider):
    """OpenAI / OpenAI-compatible API Provider"""

    def __init__(self) -> None:
        self._deepseek_http_client = None

    @property
    def provider_name(self) -> str:
        return "openai"

    async def aclose(self) -> None:
        if (
            self._deepseek_http_client is not None
            and not self._deepseek_http_client.is_closed
        ):
            await self._deepseek_http_client.aclose()
        self._deepseek_http_client = None

    def _convert_messages(
        self,
        messages: list[Message],
        *,
        compat: OpenAICompat | None = None,
    ) -> list[dict]:
        """将内部 Message 转为 OpenAI API 格式"""
        compat = compat or OpenAICompat()
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
                if compat.requires_reasoning_content_on_assistant_messages:
                    entry["reasoning_content"] = msg.reasoning_content or ""
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

    def _convert_tools(
        self,
        tools: list[ToolDefinition],
        *,
        compat: OpenAICompat | None = None,
    ) -> list[dict]:
        """将内部 ToolDefinition 转为 OpenAI API 格式"""
        compat = compat or OpenAICompat()
        converted = []
        for t in tools:
            function = {
                "name": t.name,
                "description": t.description,
                "parameters": t.parameters,
            }
            if compat.supports_strict_mode:
                function["strict"] = False
            converted.append(
                {
                    "type": "function",
                    "function": function,
                }
            )
        return converted

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
        """Stream OpenAI-compatible API responses with bounded request retries."""

        try:
            from openai import AsyncOpenAI
        except ImportError:
            raise ImportError("请安装 openai: pip install openai")

        # 支持自定义 API 端点（智谱 GLM、DeepSeek 等 OpenAI-compatible API）
        base_url = _normalize_openai_base_url(model, kwargs.get("base_url", None))
        timing = kwargs.get("timing")
        compat = _detect_openai_compat(model, base_url)
        client_kwargs: dict = {}
        if api_key:
            client_kwargs["api_key"] = api_key
        if base_url:
            client_kwargs["base_url"] = base_url
        if compat.thinking_format == "deepseek":
            import httpx

            if (
                self._deepseek_http_client is None
                or self._deepseek_http_client.is_closed
            ):
                self._deepseek_http_client = httpx.AsyncClient(
                    http2=True,
                    trust_env=False,
                )
            client_kwargs["http_client"] = self._deepseek_http_client
        client = AsyncOpenAI(**client_kwargs)

        request_kwargs: dict = {
            "model": model,
            "messages": self._convert_messages(
                messages,
                compat=compat,
            ),
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }

        # stream_options 并非所有 OpenAI-compatible API 都支持
        if not base_url:
            request_kwargs["stream_options"] = {"include_usage": True}

        if tools:
            request_kwargs["tools"] = self._convert_tools(tools, compat=compat)

        _apply_reasoning_options(
            request_kwargs,
            model=model,
            compat=compat,
            reasoning_effort=kwargs.get("reasoning_effort"),
        )

        request_turn = getattr(timing, "counters", {}).get("turns", 0) if timing else 0
        if timing is not None:
            timing.record_llm_stage(
                "openai_request_prepared",
                turn=request_turn,
                model=model,
                message_count=len(request_kwargs["messages"]),
                tool_count=len(request_kwargs.get("tools", [])),
                has_base_url=bool(base_url),
                base_url_uses_v1=bool(base_url and base_url.rstrip("/").endswith("/v1")),
                deepseek_http2=compat.thinking_format == "deepseek",
                trust_env=compat.thinking_format != "deepseek",
                has_extra_body=bool(request_kwargs.get("extra_body")),
                reasoning_effort=request_kwargs.get("reasoning_effort", ""),
            )

        response = await async_retry(
            lambda: client.chat.completions.create(**request_kwargs),
            policy=LLM_RETRY_POLICY,
            operation_name=f"llm.openai.stream.create.{model}",
            logger=logger,
            is_retryable=is_retryable_exception,
        )
        if timing is not None:
            timing.record_llm_stage(
                "openai_stream_opened",
                turn=request_turn,
                model=model,
            )

        full_text = ""
        full_reasoning_content = ""
        tool_calls_map: dict[int, dict] = {}  # index -> {id, name, arguments_str}
        usage = TokenUsage()
        message_id = generate_message_id()
        yield StreamEvent(type="message_start", message_id=message_id)

        first_chunk_recorded = False
        first_reasoning_recorded = False
        async for chunk in response:
            if timing is not None and not first_chunk_recorded:
                first_chunk_recorded = True
                timing.record_llm_stage(
                    "openai_first_chunk",
                    turn=request_turn,
                    model=model,
                )
            delta = chunk.choices[0].delta if chunk.choices else None

            if delta and delta.content:
                full_text += delta.content
                yield StreamEvent(
                    type="text_delta",
                    text=delta.content,
                    message_id=message_id,
                )

            reasoning_content = _get_delta_reasoning_content(delta)
            if reasoning_content:
                full_reasoning_content += reasoning_content
                if timing is not None and not first_reasoning_recorded:
                    first_reasoning_recorded = True
                    timing.record_llm_stage(
                        "openai_first_reasoning",
                        turn=request_turn,
                        model=model,
                    )
                yield StreamEvent(
                    type="reasoning_delta",
                    text=reasoning_content,
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
                usage = _parse_openai_usage(chunk.usage)

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
                reasoning_content=full_reasoning_content or None,
            ),
        )


def _usage_attr(raw_usage, name: str, default: int = 0) -> int:
    value = getattr(raw_usage, name, default)
    if value is None:
        return default
    return int(value)


def _usage_detail(raw_usage, name: str, default: int = 0) -> int:
    details = getattr(raw_usage, "prompt_tokens_details", None)
    if details is None:
        return default
    if isinstance(details, dict):
        value = details.get(name, default)
    else:
        value = getattr(details, name, default)
    if value is None:
        return default
    return int(value)


def _parse_openai_usage(raw_usage) -> TokenUsage:
    """Normalize OpenAI-compatible usage to match pi cache semantics."""

    prompt_tokens = _usage_attr(raw_usage, "prompt_tokens")
    completion_tokens = _usage_attr(raw_usage, "completion_tokens")
    reported_cached_tokens = _usage_detail(
        raw_usage,
        "cached_tokens",
        _usage_attr(raw_usage, "prompt_cache_hit_tokens"),
    )
    cache_write_tokens = _usage_detail(raw_usage, "cache_write_tokens")
    if cache_write_tokens > 0:
        cache_read_tokens = max(0, reported_cached_tokens - cache_write_tokens)
    else:
        cache_read_tokens = reported_cached_tokens
    billable_prompt_tokens = max(
        0,
        prompt_tokens - cache_read_tokens - cache_write_tokens,
    )
    return TokenUsage(
        prompt_tokens=billable_prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=billable_prompt_tokens
        + completion_tokens
        + cache_read_tokens
        + cache_write_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_write_tokens=cache_write_tokens,
    )


def _detect_openai_compat(model: str, base_url: str | None) -> OpenAICompat:
    model_lower = (model or "").lower()
    base_url_lower = (base_url or "").lower()
    is_deepseek = "deepseek" in model_lower or "deepseek.com" in base_url_lower
    if is_deepseek:
        return OpenAICompat(
            requires_reasoning_content_on_assistant_messages=True,
            thinking_format="deepseek",
            supports_strict_mode=True,
        )
    return OpenAICompat()


def _normalize_openai_base_url(model: str, base_url: str | None) -> str | None:
    if not base_url:
        return base_url

    stripped = base_url.rstrip("/")
    is_deepseek_root = (
        "deepseek" in (model or "").lower()
        or "deepseek.com" in stripped.lower()
    ) and stripped.lower() == "https://api.deepseek.com"
    if is_deepseek_root:
        return f"{stripped}/v1"
    return base_url


def _apply_reasoning_options(
    request_kwargs: dict,
    *,
    model: str,
    compat: OpenAICompat,
    reasoning_effort: str | None = None,
) -> None:
    if compat.thinking_format != "deepseek" or not _is_deepseek_reasoning_model(model):
        return

    effort = reasoning_effort or DEFAULT_DEEPSEEK_REASONING_EFFORT
    extra_body = dict(request_kwargs.get("extra_body") or {})
    if effort == "off":
        extra_body["thinking"] = {"type": "disabled"}
        request_kwargs["extra_body"] = extra_body
        request_kwargs.pop("reasoning_effort", None)
        return

    extra_body["thinking"] = {"type": "enabled"}
    request_kwargs["extra_body"] = extra_body
    request_kwargs["reasoning_effort"] = effort


def _is_deepseek_reasoning_model(model: str) -> bool:
    model_lower = (model or "").lower()
    if "deepseek" not in model_lower:
        return False
    if model_lower.endswith("deepseek-chat") or model_lower == "deepseek-chat":
        return False
    return (
        "v4" in model_lower
        or "reasoner" in model_lower
        or "r1" in model_lower
    )


def _get_delta_reasoning_content(delta) -> str | None:
    if delta is None:
        return None
    for field in ("reasoning_content", "reasoning", "reasoning_text"):
        value = getattr(delta, field, None)
        if not value:
            model_extra = getattr(delta, "model_extra", None) or {}
            value = model_extra.get(field)
        if isinstance(value, str) and value:
            return value
    return None
