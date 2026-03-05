"""
AI Gateway 统一路由器
按模型名自动分发到对应的 LLM Provider
"""

from __future__ import annotations

import logging
from typing import AsyncIterator

from .base_provider import (
    AssistantResponse,
    LLMProvider,
    Message,
    StreamEvent,
    ToolDefinition,
)
from .config import AIConfig

logger = logging.getLogger("data_agent.ai.gateway")

# ─────────────────────────────────────────────
# 模型名 → Provider 映射规则
# ─────────────────────────────────────────────

OPENAI_PREFIXES = ("gpt-", "o1", "o3", "o4")
ANTHROPIC_PREFIXES = ("claude-",)


def _detect_provider(model: str) -> str:
    """根据模型名推断 provider 类型"""
    model_lower = model.lower()

    if any(model_lower.startswith(p) for p in ANTHROPIC_PREFIXES):
        return "anthropic"

    if any(model_lower.startswith(p) for p in OPENAI_PREFIXES):
        return "openai"

    # 默认走 OpenAI（兼容 API 的第三方模型）
    return "openai"


class AIGateway:
    """
    AI 网关 —— 统一的 LLM 调用入口

    用法：
        gateway = AIGateway(config)
        response = await gateway.complete("gpt-4o-mini", messages, tools)
    """

    def __init__(self, config: AIConfig | None = None):
        self.config = config or AIConfig.from_env()
        self._providers: dict[str, LLMProvider] = {}

    def _get_provider(self, provider_name: str) -> LLMProvider:
        """懒加载并缓存 Provider 实例"""
        if provider_name not in self._providers:
            if provider_name == "openai":
                from .openai_provider import OpenAIProvider

                self._providers["openai"] = OpenAIProvider()
            elif provider_name == "anthropic":
                from .anthropic_provider import AnthropicProvider

                self._providers["anthropic"] = AnthropicProvider()
            else:
                raise ValueError(f"未知的 Provider: {provider_name}")
        return self._providers[provider_name]

    def _get_api_key(self, provider_name: str) -> str | None:
        """获取对应 provider 的 API Key"""
        if provider_name == "openai":
            return self.config.openai_api_key or None
        elif provider_name == "anthropic":
            return self.config.anthropic_api_key or None
        return None

    async def stream(
        self,
        model: str,
        messages: list[Message],
        tools: list[ToolDefinition] | None = None,
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncIterator[StreamEvent]:
        """流式调用 LLM"""
        provider_name = _detect_provider(model)
        provider = self._get_provider(provider_name)
        api_key = self._get_api_key(provider_name)

        temp = temperature if temperature is not None else self.config.temperature
        tokens = max_tokens if max_tokens is not None else self.config.max_tokens

        logger.info(f"[Gateway] model={model}, provider={provider_name}")

        # 构建额外参数（如自定义 base_url）
        extra_kwargs: dict = {}
        if provider_name == "openai" and self.config.openai_base_url:
            extra_kwargs["base_url"] = self.config.openai_base_url

        async for event in provider.stream(
            model,
            messages,
            tools,
            temperature=temp,
            max_tokens=tokens,
            api_key=api_key,
            **extra_kwargs,
        ):
            yield event

    async def complete(
        self,
        model: str,
        messages: list[Message],
        tools: list[ToolDefinition] | None = None,
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AssistantResponse:
        """同步调用 LLM，返回完整响应"""
        provider_name = _detect_provider(model)
        provider = self._get_provider(provider_name)
        api_key = self._get_api_key(provider_name)

        temp = temperature if temperature is not None else self.config.temperature
        tokens = max_tokens if max_tokens is not None else self.config.max_tokens

        logger.info(f"[Gateway] complete: model={model}, provider={provider_name}")

        extra_kwargs: dict = {}
        if provider_name == "openai" and self.config.openai_base_url:
            extra_kwargs["base_url"] = self.config.openai_base_url

        return await provider.complete(
            model,
            messages,
            tools,
            temperature=temp,
            max_tokens=tokens,
            api_key=api_key,
            **extra_kwargs,
        )
