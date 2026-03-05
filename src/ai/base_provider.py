"""
LLM Provider 抽象基类与公共数据模型
借鉴 pi-mono/packages/ai 的 Provider Registry 模式
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
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


@dataclass
class TokenUsage:
    """Token 用量统计"""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


@dataclass
class AssistantResponse:
    """LLM 完整响应"""

    content: str = ""
    tool_calls: list[ToolCall] | None = None
    stop_reason: str = "end_turn"
    usage: TokenUsage | None = None
    model: str = ""


# ─────────────────────────────────────────────
# 流式事件
# ─────────────────────────────────────────────


@dataclass
class StreamEvent:
    """流式输出事件"""

    type: str  # "text_delta" | "tool_call_start" | "tool_call_delta" | "done" | "error"
    text: str = ""
    tool_call: ToolCall | None = None
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

        async for event in self.stream(
            model,
            messages,
            tools,
            temperature=temperature,
            max_tokens=max_tokens,
            api_key=api_key,
            **kwargs,
        ):
            if event.type == "text_delta":
                full_text += event.text
            elif event.type == "tool_call_start" and event.tool_call:
                tool_calls.append(event.tool_call)
            elif event.type == "done" and event.response:
                final_response = event.response

        if final_response:
            return final_response

        return AssistantResponse(
            content=full_text,
            tool_calls=tool_calls if tool_calls else None,
            stop_reason="end_turn" if not tool_calls else "tool_use",
        )


def generate_tool_call_id() -> str:
    """生成工具调用 ID"""
    return f"call_{uuid.uuid4().hex[:24]}"
