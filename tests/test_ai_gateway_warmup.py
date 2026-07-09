import pytest

from src.ai.base_provider import AssistantResponse, Role, StreamEvent
from src.ai.config import AIConfig
from src.ai.gateway import AIGateway


class FakeProvider:
    def __init__(self):
        self.calls = []

    async def stream(
        self,
        model,
        messages,
        tools,
        *,
        temperature,
        max_tokens,
        api_key,
        **kwargs,
    ):
        self.calls.append(
            {
                "model": model,
                "messages": messages,
                "tools": tools,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "api_key": api_key,
                "kwargs": kwargs,
            }
        )
        yield StreamEvent(type="message_start", message_id="msg_warmup")
        yield StreamEvent(
            type="done",
            message_id="msg_warmup",
            response=AssistantResponse(model=model, message_id="msg_warmup"),
        )


@pytest.mark.asyncio
async def test_gateway_warmup_drains_default_openai_stream():
    gateway = AIGateway(
        AIConfig(
            openai_api_key="test-key",
            openai_base_url="https://api.deepseek.com",
            default_model="deepseek-v4-flash",
        )
    )
    fake_provider = FakeProvider()
    gateway._providers["openai"] = fake_provider

    assert await gateway.warmup(timeout=1.0) is True

    assert len(fake_provider.calls) == 1
    call = fake_provider.calls[0]
    assert call["model"] == "deepseek-v4-flash"
    assert call["messages"][0].role == Role.USER
    assert call["messages"][0].content == "ping"
    assert call["tools"] is None
    assert call["temperature"] == 0.0
    assert call["max_tokens"] == 1
    assert call["api_key"] == "test-key"
    assert call["kwargs"]["base_url"] == "https://api.deepseek.com"
    assert call["kwargs"]["reasoning_effort"] == "off"


@pytest.mark.asyncio
async def test_gateway_warmup_skips_without_api_key():
    gateway = AIGateway(AIConfig(default_model="deepseek-chat"))

    assert await gateway.warmup(timeout=1.0) is False
    assert gateway._providers == {}
