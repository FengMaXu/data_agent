"""
LLM Provider 抽象基类与公共数据模型
借鉴 pi-mono/packages/ai 的 Provider Registry 模式
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Any, AsyncIterator


# ─────────────────────────────────────────────
# 公共数据模型
# ─────────────────────────────────────────────


class Role(str, Enum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL_RESULT = "tool_result"


@dataclass
class ToolParameter:
    """工具参数 JSON Schema 描述"""

    name: str
    type: str
    description: str = ""
    required: bool = True
    enum: list[str] | None = None


@dataclass
class ToolDefinition:
    """工具定义，传递给 LLM"""

    name: str
    description: str
    parameters: dict[str, Any]  # JSON Schema


@dataclass
class ToolCall:
    """LLM 发出的工具调用请求"""

    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class ToolResultContent:
    """工具执行结果内容"""

    type: str = "text"  # "text" | "image"
    text: str = ""


@dataclass
class Message:
    """通用消息"""

    role: Role
    content: str = ""
    tool_calls: list[ToolCall] | None = None
    tool_call_id: str | None = None  # for tool_result
    tool_name: str | None = None  # for tool_result
    name: str | None = None
    message_id: str | None = None
    reasoning_content: str | None = None


@dataclass
class TokenUsage:
    """Token 用量统计"""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0


@dataclass
class AssistantResponse:
    """LLM 完整响应"""

    content: str = ""
    tool_calls: list[ToolCall] | None = None
    stop_reason: str = "end_turn"
    usage: TokenUsage | None = None
    model: str = ""
    message_id: str | None = None
    reasoning_content: str | None = None


# ─────────────────────────────────────────────
# 流式事件
# ─────────────────────────────────────────────


@dataclass
class StreamEvent:
    """流式输出事件"""

    type: str  # "message_start" | "text_delta" | "reasoning_delta" | "tool_call_start" | "tool_call_delta" | "done" | "error"
    text: str = ""
    tool_call: ToolCall | None = None
    message_id: str | None = None
    tool_call_id: str | None = None
    tool_name: str | None = None
    partial_arguments: str = ""
    widget_id: str | None = None
    # 完成时携带最终响应
    response: AssistantResponse | None = None
    error: str | None = None


# ─────────────────────────────────────────────
# Provider 抽象基类
# ─────────────────────────────────────────────


class LLMProvider(ABC):
    """LLM Provider 抽象接口"""

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Provider 名称，如 'openai', 'anthropic'"""
        ...

    @abstractmethod
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
        """流式调用 LLM，逐步产出 StreamEvent"""
        ...

    async def complete(
        self,
        model: str,
        messages: list[Message],
        tools: list[ToolDefinition] | None = None,
        *,
        temperature: float = 0.0,
        max_tokens: int = 4096,
        api_key: str | None = None,
        **kwargs,
    ) -> AssistantResponse:
        """同步调用 LLM，返回完整响应（默认通过 stream 实现）"""
        full_text = ""
        tool_calls: list[ToolCall] = []
        final_response: AssistantResponse | None = None
        current_message_id: str | None = None
        tool_calls_by_id: dict[str, ToolCall] = {}

        async for event in self.stream(
            model,
            messages,
            tools,
            temperature=temperature,
            max_tokens=max_tokens,
            api_key=api_key,
            **kwargs,
        ):
            if event.type == "message_start":
                current_message_id = event.message_id
            elif event.type == "text_delta":
                full_text += event.text
                current_message_id = event.message_id or current_message_id
            elif event.type == "tool_call_start" and event.tool_call:
                tool_calls_by_id[event.tool_call.id] = event.tool_call
                current_message_id = event.message_id or current_message_id
            elif event.type == "done" and event.response:
                final_response = event.response

        if final_response:
            return final_response

        tool_calls = list(tool_calls_by_id.values())
        return AssistantResponse(
            content=full_text,
            tool_calls=tool_calls if tool_calls else None,
            stop_reason="end_turn" if not tool_calls else "tool_use",
            message_id=current_message_id,
        )


def generate_tool_call_id() -> str:
    """生成工具调用 ID"""
    return f"call_{uuid.uuid4().hex[:24]}"


def generate_message_id() -> str:
    """生成消息 ID"""
    return f"msg_{uuid.uuid4().hex[:24]}"


def robust_parse_tool_arguments(raw: str) -> dict[str, Any]:
    """
    容错解析 LLM 工具调用参数 JSON。

    LLM 流式输出大 content（如 HTML）时，转义字符经常损坏导致
    json.loads 失败。此函数尝试多轮解析：
      1. 直接 json.loads
      2. 递归剥离嵌套的 _raw 包装
      3. 截断到最后一个合法 JSON 边界再解析
      4. 降级返回 {"_raw": raw}
    """
    import json
    import re

    if not raw:
        return {}

    # 尝试 1: 直接解析
    try:
        result = json.loads(raw)
        if isinstance(result, dict):
            if "_raw" not in result or any(
                k in result for k in ("path", "content", "query")
            ):
                return result
            # 即使有 _raw，也有其他有效字段，直接返回
            return result
    except (json.JSONDecodeError, ValueError):
        pass

    # 尝试 2: 递归剥离嵌套的 _raw
    def _unwrap_raw(s: str, depth: int = 0) -> dict[str, Any] | None:
        if depth > 5:
            return None
        try:
            parsed = json.loads(s)
        except (json.JSONDecodeError, ValueError):
            return None
        if not isinstance(parsed, dict):
            return None
        if "_raw" in parsed and isinstance(parsed["_raw"], str):
            inner = _unwrap_raw(parsed["_raw"], depth + 1)
            if inner is not None:
                return inner
        if len(parsed) > 1 or "_raw" not in parsed:
            return parsed
        return None

    unwrapped = _unwrap_raw(raw)
    if unwrapped is not None:
        return unwrapped

    # 尝试 3: 截断到最后一个完整的 key-value 对
    for truncate_pattern in [
        r',\s*"(?:content|path)"\s*:',
        r',\s*"(?:content|path)"\s*:\\',
    ]:
        last_match = None
        for m in re.finditer(truncate_pattern, raw):
            last_match = m
        if last_match:
            truncated = raw[: last_match.start()] + "}"
            try:
                result = json.loads(truncated)
                if isinstance(result, dict):
                    return result
            except (json.JSONDecodeError, ValueError):
                pass

    # 降级: 返回 _raw
    return {"_raw": raw}
