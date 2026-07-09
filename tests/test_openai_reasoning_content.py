import asyncio
import sys
import types

from src.ai.base_provider import Message, Role, ToolDefinition
from src.ai.openai_provider import (
    DEFAULT_DEEPSEEK_REASONING_EFFORT,
    OpenAIProvider,
    _apply_reasoning_options,
    _detect_openai_compat,
    _get_delta_reasoning_content,
    _normalize_openai_base_url,
    _parse_openai_usage,
)


def test_deepseek_messages_preserve_reasoning_content():
    provider = OpenAIProvider()
    compat = _detect_openai_compat("deepseek-v4-flash", "https://api.deepseek.com")
    messages = [
        Message(role=Role.USER, content="question"),
        Message(
            role=Role.ASSISTANT,
            content="answer",
            reasoning_content="hidden reasoning payload",
        ),
    ]

    converted = provider._convert_messages(messages, compat=compat)

    assert converted[1]["reasoning_content"] == "hidden reasoning payload"


def test_deepseek_messages_include_empty_reasoning_content_when_missing():
    provider = OpenAIProvider()
    compat = _detect_openai_compat("deepseek-v4-flash", "https://api.deepseek.com")

    converted = provider._convert_messages(
        [Message(role=Role.ASSISTANT, content="answer")],
        compat=compat,
    )

    assert converted[0]["reasoning_content"] == ""


def test_plain_openai_messages_omit_reasoning_content():
    provider = OpenAIProvider()
    messages = [
        Message(
            role=Role.ASSISTANT,
            content="answer",
            reasoning_content="hidden reasoning payload",
        ),
    ]

    converted = provider._convert_messages(messages)

    assert "reasoning_content" not in converted[0]


def test_detects_reasoning_content_aliases_from_delta_model_extra():
    class Delta:
        model_extra = {"reasoning": "thoughts"}

    assert _get_delta_reasoning_content(Delta()) == "thoughts"


def test_parse_openai_usage_tracks_prompt_cache_reads():
    raw_usage = types.SimpleNamespace(
        prompt_tokens=1200,
        completion_tokens=80,
        total_tokens=1280,
        prompt_tokens_details=types.SimpleNamespace(cached_tokens=1000),
    )

    usage = _parse_openai_usage(raw_usage)

    assert usage.prompt_tokens == 200
    assert usage.completion_tokens == 80
    assert usage.cache_read_tokens == 1000
    assert usage.cache_write_tokens == 0
    assert usage.total_tokens == 1280


def test_parse_openai_usage_separates_cache_write_from_cached_tokens():
    raw_usage = types.SimpleNamespace(
        prompt_tokens=1200,
        completion_tokens=80,
        total_tokens=1280,
        prompt_tokens_details={
            "cached_tokens": 1000,
            "cache_write_tokens": 300,
        },
    )

    usage = _parse_openai_usage(raw_usage)

    assert usage.prompt_tokens == 200
    assert usage.cache_read_tokens == 700
    assert usage.cache_write_tokens == 300


def test_deepseek_reasoning_models_send_pi_style_thinking_options():
    request_kwargs = {}
    compat = _detect_openai_compat("deepseek-v4-flash", "https://api.deepseek.com")

    _apply_reasoning_options(
        request_kwargs,
        model="deepseek-v4-flash",
        compat=compat,
    )

    assert request_kwargs["extra_body"] == {"thinking": {"type": "enabled"}}
    assert request_kwargs["reasoning_effort"] == DEFAULT_DEEPSEEK_REASONING_EFFORT


def test_deepseek_reasoning_options_can_be_disabled():
    request_kwargs = {}
    compat = _detect_openai_compat("deepseek-v4-flash", "https://api.deepseek.com")

    _apply_reasoning_options(
        request_kwargs,
        model="deepseek-v4-flash",
        compat=compat,
        reasoning_effort="off",
    )

    assert request_kwargs["extra_body"] == {"thinking": {"type": "disabled"}}
    assert "reasoning_effort" not in request_kwargs


def test_deepseek_chat_legacy_model_keeps_existing_request_options():
    request_kwargs = {}
    compat = _detect_openai_compat("deepseek-chat", "https://api.deepseek.com")

    _apply_reasoning_options(
        request_kwargs,
        model="deepseek-chat",
        compat=compat,
    )

    assert request_kwargs == {}


def test_deepseek_root_base_url_normalizes_to_pi_v1_endpoint():
    assert (
        _normalize_openai_base_url("deepseek-v4-flash", "https://api.deepseek.com")
        == "https://api.deepseek.com/v1"
    )
    assert (
        _normalize_openai_base_url("deepseek-v4-flash", "https://api.deepseek.com/v1")
        == "https://api.deepseek.com/v1"
    )
    assert (
        _normalize_openai_base_url("other-model", "https://example.com")
        == "https://example.com"
    )


def test_deepseek_tools_include_pi_style_strict_false():
    provider = OpenAIProvider()
    compat = _detect_openai_compat("deepseek-v4-flash", "https://api.deepseek.com")

    converted = provider._convert_tools(
        [
            ToolDefinition(
                name="tool_search",
                description="Search tools.",
                parameters={"type": "object", "properties": {}},
            )
        ],
        compat=compat,
    )

    assert converted[0]["function"]["strict"] is False


def test_deepseek_stream_sends_thinking_request_options(monkeypatch):
    captured_kwargs = {}

    class FakeResponse:
        def __aiter__(self):
            return self

        async def __anext__(self):
            raise StopAsyncIteration

    class FakeCompletions:
        async def create(self, **kwargs):
            captured_kwargs.update(kwargs)
            return FakeResponse()

    class FakeChat:
        completions = FakeCompletions()

    class FakeAsyncOpenAI:
        chat = FakeChat()

        def __init__(self, **kwargs):
            self.kwargs = kwargs

    monkeypatch.setitem(
        sys.modules,
        "openai",
        types.SimpleNamespace(AsyncOpenAI=FakeAsyncOpenAI),
    )

    async def run_stream():
        provider = OpenAIProvider()
        events = []
        async for event in provider.stream(
            "deepseek-v4-flash",
            [Message(role=Role.USER, content="hi")],
            api_key="test-key",
            base_url="https://api.deepseek.com",
        ):
            events.append(event)
        return events

    events = asyncio.run(run_stream())

    assert [event.type for event in events] == ["message_start", "done"]
    assert captured_kwargs["model"] == "deepseek-v4-flash"
    assert captured_kwargs["messages"] == [{"role": "user", "content": "hi"}]
    assert captured_kwargs["extra_body"] == {"thinking": {"type": "enabled"}}
    assert captured_kwargs["reasoning_effort"] == DEFAULT_DEEPSEEK_REASONING_EFFORT
