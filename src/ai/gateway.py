"""
AI Gateway 统一路由器
按模型名自动分发到对应的 LLM Provider
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING, AsyncIterator

if TYPE_CHECKING:
    from src.agent.types import AgentTimingRecorder

from .base_provider import (
    AssistantResponse,
    LLMProvider,
    Message,
    Role,
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

    async def warmup(self, *, timeout: float = 10.0) -> bool:
        """Open the default LLM stream once so the provider connection pool is hot."""
        model = self.config.default_model
        provider_name = _detect_provider(model)
        api_key = self._get_api_key(provider_name)
        if not api_key:
            logger.info(
                "[Warmup] skip LLM warmup: missing API key for %s",
                provider_name,
            )
            return False

        provider = self._get_provider(provider_name)
        extra_kwargs: dict = {}
        if provider_name == "openai":
            if self.config.openai_base_url:
                extra_kwargs["base_url"] = self.config.openai_base_url
            # Keep the preflight cheap for reasoning-capable OpenAI-compatible models.
            extra_kwargs["reasoning_effort"] = "off"

        async def _drain() -> None:
            async for event in provider.stream(
                model,
                [Message(role=Role.USER, content="ping")],
                tools=None,
                temperature=0.0,
                max_tokens=1,
                api_key=api_key,
                **extra_kwargs,
            ):
                if event.type == "done":
                    break

        started_at = time.perf_counter()
        try:
            await asyncio.wait_for(_drain(), timeout=timeout)
        except TimeoutError:
            duration_ms = round((time.perf_counter() - started_at) * 1000, 1)
            logger.warning(
                "[Warmup] LLM warmup timed out provider=%s model=%s duration_ms=%.1f",
                provider_name,
                model,
                duration_ms,
            )
            return False
        except Exception as exc:
            duration_ms = round((time.perf_counter() - started_at) * 1000, 1)
            logger.warning(
                "[Warmup] LLM warmup failed provider=%s model=%s duration_ms=%.1f error=%s",
                provider_name,
                model,
                duration_ms,
                exc,
            )
            return False

        duration_ms = round((time.perf_counter() - started_at) * 1000, 1)
        logger.info(
            "[Warmup] LLM channel warmed provider=%s model=%s duration_ms=%.1f",
            provider_name,
            model,
            duration_ms,
        )
        return True

    async def aclose(self) -> None:
        for provider in self._providers.values():
            close = getattr(provider, "aclose", None)
            if close is not None:
                await close()
        self._providers.clear()

    async def stream(
        self,
        model: str,
        messages: list[Message],
        tools: list[ToolDefinition] | None = None,
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
        timing: "AgentTimingRecorder | None" = None,
    ) -> AsyncIterator[StreamEvent]:
        """流式调用 LLM"""
        provider_name = _detect_provider(model)
        provider = self._get_provider(provider_name)
        api_key = self._get_api_key(provider_name)

        temp = temperature if temperature is not None else self.config.temperature
        tokens = max_tokens if max_tokens is not None else self.config.max_tokens

        logger.info(f"[Gateway] model={model}, provider={provider_name}")
        if timing is not None:
            timing.record_llm_stage(
                "gateway_stream_start",
                turn=timing.counters.get("turns", 0),
                provider=provider_name,
                model=model,
            )

        extra_kwargs: dict = {}
        if provider_name == "openai" and self.config.openai_base_url:
            extra_kwargs["base_url"] = self.config.openai_base_url
        if timing is not None:
            extra_kwargs["timing"] = timing

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
